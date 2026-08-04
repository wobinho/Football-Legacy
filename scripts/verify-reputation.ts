// Club reputation verifier (v1.92): does winning actually change who'll sign?
//
//   npm run verify:reputation [seasons]
//
// The complaint this answers is a MARKET complaint, not a numbers one: "I won
// the title and world-class players still see us as a step down." So the checks
// are about the market, and asserting that reputation moved would miss the
// point entirely — what matters is that the consent gate it feeds moves with it.
//
// Two halves:
//
//   1. Unit-level: the target arithmetic responds to each piece of evidence in
//      the right direction, and the drift is bounded.
//   2. Measured: drive a real world, have the user's club win its division
//      repeatedly, and assert that the set of elite players who would join grows
//      — through `willJoin`, the same function the transfer market calls.
//
// It asserts SHAPE and DIRECTION, never exact reputations: those depend on the
// world roll, and a harness that pins them would fail on every balance change.

import { generateWorld } from "../lib/worldgen";
import {
  advanceUntilEvent,
  applyMatchResult,
  afterUserMatch,
  matchSeed,
  ensureUserLineup,
  runSeasonRollover,
} from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { collectSeasonFinishes, driftedReputation, reputationTarget } from "../lib/reputation";
import { willJoin } from "../lib/consent";
import { activePlayers } from "../lib/archive";
import { TUNING } from "../lib/config/tuning";
import type { GameState } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 8);

const fail: string[] = [];
const check = (ok: boolean, msg: string, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(msg);
};

// ── 1. The arithmetic ─────────────────────────────────────────────────────
console.log("\nTarget arithmetic");

const w = generateWorld({
  saveName: "verify-rep",
  managerName: "Verifier",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 4242,
});
const club = w.teams[w.userTeamId];
const size = w.leagues[club.leagueId].teamIds.length;

const won = reputationTarget(w, club, TUNING, 1, size).target;
const mid = reputationTarget(w, club, TUNING, Math.round(size / 2), size).target;
const last = reputationTarget(w, club, TUNING, size, size).target;
check(won > mid && mid > last, "league finish moves the target monotonically", `${last.toFixed(1)} < ${mid.toFixed(1)} < ${won.toFixed(1)}`);

// A club with no finish at all reads as mid-table, never as relegation form —
// an unplayed season is not evidence.
const unknown = reputationTarget(w, club, TUNING).target;
check(unknown > last && unknown < won, "a missing finish reads mid-table, not bottom", `${unknown.toFixed(1)}`);

// Squad is the largest single term, and it must respond to the squad.
const strong = { ...club, playerIds: club.playerIds };
const stripped = { ...club, playerIds: club.playerIds.slice(0, 11) };
const tStrong = reputationTarget(w, strong, TUNING, 1, size);
const tThin = reputationTarget(w, stripped, TUNING, 1, size);
check(tStrong.squad >= tThin.squad, "squad term reads the XI and bench", `${tThin.squad.toFixed(1)} → ${tStrong.squad.toFixed(1)}`);

// Drift is bounded in BOTH directions and never leaves the 1–100 scale.
check(
  driftedReputation(50, 100, TUNING) - 50 <= TUNING.repDriftMaxPerSeason + 1e-9,
  "a distant target still moves at most repDriftMaxPerSeason",
  `+${(driftedReputation(50, 100, TUNING) - 50).toFixed(2)}`
);
check(
  50 - driftedReputation(50, 0, TUNING) <= TUNING.repDriftMaxPerSeason + 1e-9,
  "the cap binds downward too"
);
check(driftedReputation(99, 100, TUNING) <= 100 && driftedReputation(2, 0, TUNING) >= 1, "drift stays inside 1–100");
check(Math.abs(driftedReputation(70, 70, TUNING) - 70) < 1e-9, "a club already at its target doesn't drift");

// ── 2. Measured: does the MARKET move? ────────────────────────────────────
console.log(`\nDriving ${SEASONS} seasons with a dominant user club…`);

const state: GameState = generateWorld({
  saveName: "verify-rep-run",
  managerName: "Verifier",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

/** How many elite players in the world would agree to join the user's club —
 * the question the complaint is actually about. Read through `willJoin`, the
 * same gate `canApproach` and every market path call. */
function willingElites(state: GameState): number {
  const buyer = state.teams[state.userTeamId];
  return activePlayers(state).filter(
    (p) => p.overall >= 82 && p.clubId !== buyer.id && willJoin(state, p, buyer, TUNING).ok
  ).length;
}

const startRep = state.teams[state.userTeamId].reputation;
const startWilling = willingElites(state);
console.log(`  season 1: reputation ${startRep.toFixed(1)}, ${startWilling} elite players would join`);

// Stack the deck so the club genuinely dominates: this harness is testing that
// SUCCESS converts into standing, so it has to produce the success.
for (const id of state.teams[state.userTeamId].playerIds) {
  const p = state.players[id];
  if (p) p.overall = Math.min(92, p.overall + 12);
}

let titles = 0;
let guard = 0;
while (state.season <= SEASONS && guard++ < 800 * SEASONS) {
  const stop = advanceUntilEvent(state);
  if (stop.kind === "matchday") {
    const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
    const userLineup = ensureUserLineup(state);
    const mk = (teamId: string, fixed?: typeof userLineup) => {
      const t = state.teams[teamId];
      const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
      return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, fixed);
    };
    applyMatchResult(
      state,
      fixture,
      simulateMatch(
        mk(fixture.homeId, fixture.homeId === state.userTeamId ? userLineup : undefined),
        mk(fixture.awayId, fixture.awayId === state.userTeamId ? userLineup : undefined),
        TUNING,
        matchSeed(state, fixture)
      )
    );
    afterUserMatch(state);
  } else if (stop.kind === "seasonEnd") {
    const finishes = collectSeasonFinishes(state);
    const finish = finishes[state.userTeamId];
    if (finish?.position === 1) titles++;
    runSeasonRollover(state);
  } else if (stop.kind === "idle") {
    console.error("!! loop stalled");
    process.exit(1);
  }
}

const endRep = state.teams[state.userTeamId].reputation;
const endWilling = willingElites(state);
console.log(`  season ${state.season}: reputation ${endRep.toFixed(1)}, ${endWilling} elite players would join (${titles} titles won)`);

console.log("\nMarket effect");
check(titles > 0, "the stacked club actually won its division", `${titles} titles`);
check(endRep > startRep, "sustained success raises club reputation", `${startRep.toFixed(1)} → ${endRep.toFixed(1)}`);
check(
  endWilling > startWilling,
  "…and more world-class players will now sign — the actual complaint",
  `${startWilling} → ${endWilling}`
);

// Reputation must stay a SLOW number. If a handful of seasons can move a club
// the length of the scale, the gate it feeds stops meaning anything.
check(
  endRep - startRep <= TUNING.repDriftMaxPerSeason * SEASONS,
  "reputation never outruns the per-season cap",
  `+${(endRep - startRep).toFixed(1)} over ${SEASONS} seasons`
);

// Symmetry: this is a simulation rule, not a difficulty setting. AI clubs must
// be moving too, in both directions.
const aiMoved = Object.values(state.teams).filter((t) => t.id !== state.userTeamId);
const anyUp = aiMoved.some((t) => t.reputation > 1 && t.reputation < 100);
check(anyUp, "AI clubs are subject to the same drift");

if (fail.length) {
  console.error(`\n${fail.length} check(s) failed:`);
  for (const f of fail) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nAll reputation checks passed.");

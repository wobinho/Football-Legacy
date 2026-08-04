// Squad shape over a long save (v1.89).
//   npm run verify:squads [seasons]
//
// Drives a real world for N seasons and asserts the thing the AI got wrong for
// five versions: that every club can still field the positions its own formation
// asks for, with players who actually play there.
//
// This is a MEASURED check, not a table check. Every one of the four defects
// behind "Arsenal has no centre-back" was invisible in the tuning tables and only
// showed up in a sweep like this one — a marginal-starter field that reported the
// best player, a stance that sold the last centre-back, adjacent cover counted as
// natural cover, and a world population with no floor under it. See CLAUDE.md.
//
// It asserts SHAPE, never exact numbers: the world is random and a single club
// caught mid-window between selling and buying is ordinary football, not a bug.

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
import { TUNING } from "../lib/config/tuning";
import { FORMATIONS } from "../lib/config/formations";
import type { GameState, Pos } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 12);

let failures = 0;
function ok(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!pass) failures++;
}

const state = generateWorld({
  saveName: "verify-squads",
  managerName: "Verifier",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

console.log(`Driving ${SEASONS} seasons…`);
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
    runSeasonRollover(state);
  } else if (stop.kind === "idle") {
    console.error("!! loop stalled");
    process.exit(1);
  }
}

// ── Coverage ───────────────────────────────────────────────────────────────
/** Formation slots a club has no natural body for. */
function uncoveredOf(st: GameState, teamId: string): { pos: Pos; have: number; need: number }[] {
  const t = st.teams[teamId];
  const squad = t.playerIds.map((id) => st.players[id]).filter((p) => p && !p.retired);
  const formation = FORMATIONS.find((f) => f.id === t.tactic?.formationId) ?? FORMATIONS[0];
  const need = new Map<Pos, number>();
  for (const s of formation.slots) need.set(s.pos, (need.get(s.pos) ?? 0) + 1);
  const out: { pos: Pos; have: number; need: number }[] = [];
  for (const [pos, n] of need) {
    const have = squad.filter((p) => p.positions.includes(pos)).length;
    if (have < n) out.push({ pos, have, need: n });
  }
  return out;
}

const playable = Object.values(state.teams).filter((t) => state.leagues[t.leagueId]?.playable);
const shortfalls = playable.flatMap((t) => uncoveredOf(state, t.id).map((u) => ({ club: t.name, ...u })));
const sizes = playable
  .map((t) => t.playerIds.filter((id) => !state.players[id]?.retired).length)
  .sort((a, b) => a - b);
const emptySlots = shortfalls.filter((s) => s.have === 0);

console.log(`\nAfter season ${state.season} — ${playable.length} playable clubs\n`);
for (const s of shortfalls.slice(0, 12)) {
  console.log(`    ${s.club.padEnd(28)} ${s.pos.padEnd(4)} has ${s.have}, needs ${s.need}`);
}

console.log(`\nSquad shape`);
// The headline: a position NOBODY on the books can play. This is the actual bug
// — a thin position is football, an empty one is a broken squad.
ok(
  "no club is left with a formation slot nobody can play",
  emptySlots.length === 0,
  `${emptySlots.length} empty slots`
);
// Thin positions are tolerated in small numbers: a club caught between a sale and
// a signing is ordinary. A tenth of the league is not.
ok(
  "positional shortfalls stay rare",
  shortfalls.length <= Math.ceil(playable.length * 0.1),
  `${shortfalls.length} across ${playable.length} clubs`
);

console.log(`\nSquad size`);
const median = sizes[Math.floor(sizes.length / 2)];
ok("no club falls below the matchday squad", sizes[0] >= TUNING.matchdaySquad, `min ${sizes[0]}`);
// The regression that mattered: squads ratcheting down to the legal minimum over
// a long save because every AI buy path is discretionary.
ok(
  "squads have not decayed toward the minimum",
  median >= TUNING.aiSquadFloor - 2,
  `median ${median}, floor ${TUNING.aiSquadFloor}`
);

console.log(`\nThe free-agent market`);
const unattached = Object.values(state.players).filter((p) => p && !p.retired && !p.clubId);
// `ensureAiSquads` draws on this pool every rollover; if it empties, the user's
// Free Agents screen is bare all season and the AI has nowhere to fill a gap.
ok(
  "the market is never emptied by the AI's own top-up",
  unattached.length >= TUNING.freeAgentPoolFloor,
  `${unattached.length} free agents, floor ${TUNING.freeAgentPoolFloor}`
);
const faPositions = new Set(unattached.flatMap((p) => p.positions));
ok("the market carries a spread of positions", faPositions.size >= 8, `${faPositions.size} positions`);

console.log(
  failures === 0 ? `\nAll squad-shape checks passed.` : `\n${failures} squad-shape check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);

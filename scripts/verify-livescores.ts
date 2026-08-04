// ── Final-day scoreboard verifier (v1.92) ───────────────────────────────────
//
//   npm run verify:livescores
//
// The panel's one promise is that it shows the SAME season the save records —
// only earlier, and a minute at a time. That is exactly the kind of claim a
// table check can't make, so this drives a real world to its final league round
// and asserts the promise end to end:
//
//   • at 90' every other scoreline equals the fixture the engine actually played
//   • at 90' the live table is identical to `computeTable` over the real
//     fixtures — same order, same points, same goal difference. This is the one
//     that matters: a title decided on GD must not be shown wrong on the day.
//   • the reveal is monotonic (a score never goes DOWN as the clock runs)
//   • it is deterministic (same seed → same minutes), so a reload mid-match
//     doesn't reshuffle when the goals went in
//   • the toggle is offered on the last round and on no other

import { generateWorld } from "../lib/worldgen";
import {
  advanceUntilEvent,
  applyMatchResult,
  afterUserMatch,
  matchSeed,
  ensureUserLineup,
} from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { computeTable } from "../lib/season";
import { isFinalLeagueRound, liveScoresFor, liveTable, scoreAt } from "../lib/livescores";
import { TUNING } from "../lib/config/tuning";
import type { Fixture } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label} — ${detail}`);
}

const state = generateWorld({
  saveName: "livescores",
  managerName: "Live Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 4242,
});

const league = state.leagues[state.teams[state.userTeamId].leagueId];
const finalRound = 2 * (league.teamIds.length - 1);
console.log(`\n${league.name}: ${league.teamIds.length} clubs, ${finalRound} rounds\n`);

const playUserFixture = (fixture: Fixture) => {
  const userLineup = ensureUserLineup(state);
  const mk = (teamId: string, fixed?: typeof userLineup) => {
    const t = state.teams[teamId];
    const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
    return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, fixed, 1, t.assignments);
  };
  const isHome = fixture.homeId === state.userTeamId;
  const res = simulateMatch(
    mk(fixture.homeId, isHome ? userLineup : undefined),
    mk(fixture.awayId, isHome ? undefined : userLineup),
    TUNING,
    matchSeed(state, fixture)
  );
  return res;
};

// Drive to the user's LAST league fixture, stopping just before playing it —
// that is the exact state the Match Day screen opens the panel in.
let decider: Fixture | null = null;
let roundsSeen = 0;
let guard = 0;
while (guard++ < 30_000) {
  const stop = advanceUntilEvent(state);
  if (stop.kind !== "matchday") {
    if (stop.kind === "seasonEnd") break;
    // an offer or a gate — nothing to answer in a headless run
    if (stop.kind === "offer" || stop.kind === "gate" || stop.kind === "contracts") continue;
    break;
  }
  const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
  if (state.leagues[fixture.competition]) roundsSeen++;
  if (isFinalLeagueRound(state, fixture)) {
    decider = fixture;
    break;
  }
  const res = playUserFixture(fixture);
  applyMatchResult(state, fixture, res);
  afterUserMatch(state);
}

if (!decider) {
  console.log("FAIL — never reached the final league round");
  process.exit(1);
}

console.log(`Reached the decider: round ${decider.round} of ${finalRound}\n`);
check("the toggle is offered here", isFinalLeagueRound(state, decider), `round ${decider.round}`);
check(
  "and on no earlier round",
  !state.fixtures.some(
    (f) => f.competition === decider!.competition && f.round < finalRound && isFinalLeagueRound(state, f)
  ),
  `${roundsSeen - 1} earlier user rounds, none flagged`
);

// ── The panel's data ────────────────────────────────────────────────────────
const scores = liveScoresFor(state, decider);
console.log(`\nOther matches in the division today: ${scores.length}`);

// Every other fixture on the day is ALREADY played — that is the premise the
// whole design rests on, so it is asserted rather than assumed.
const sameRound = state.fixtures.filter(
  (f) => f.competition === decider!.competition && f.round === decider!.round && f.id !== decider!.id
);
check(
  "every other fixture was already played before kick-off",
  sameRound.every((f) => f.played),
  `${sameRound.filter((f) => f.played).length}/${sameRound.length} settled`
);

// 1. Final scorelines match the real fixtures.
let mismatches = 0;
for (const s of scores) {
  const f = state.fixtures.find((x) => x.id === s.fixtureId)!;
  const at90 = scoreAt(s, 90);
  if (at90.home !== f.homeGoals || at90.away !== f.awayGoals) mismatches++;
}
check("at 90' every scoreline equals the real result", mismatches === 0, `${mismatches} mismatched`);

// 2. Monotonic reveal — a score never goes backwards.
let regressions = 0;
for (const s of scores) {
  let prevH = 0;
  let prevA = 0;
  for (let m = 0; m <= 90; m++) {
    const { home, away } = scoreAt(s, m);
    if (home < prevH || away < prevA) regressions++;
    prevH = home;
    prevA = away;
  }
}
check("scores only ever go up as the clock runs", regressions === 0, `${regressions} regressions`);

// 3. Determinism — the same call gives the same minutes.
const again = liveScoresFor(state, decider);
const sameMinutes =
  JSON.stringify(scores.map((s) => s.goals)) === JSON.stringify(again.map((s) => s.goals));
check("the reveal is deterministic across reloads", sameMinutes, sameMinutes ? "identical minutes" : "DIFFERED");

// 4. THE important one: at full time the live table is the real table.
const res = playUserFixture(decider);
const userHome = res.homeGoals;
const userAway = res.awayGoals;

const live = liveTable(state, decider, scores, 90, userHome, userAway);

// Now actually record the user's result and build the table the save will show.
applyMatchResult(state, decider, res);
afterUserMatch(state);
const real = computeTable(state.fixtures, decider.competition, league.teamIds);

const sameOrder = live.map((r) => r.teamId).join(",") === real.map((r) => r.teamId).join(",");
const samePoints = live.every((r, i) => r.points === real[i].points);
const sameGd = live.every((r, i) => r.gf - r.ga === real[i].gf - real[i].ga);
const samePlayed = live.every((r, i) => r.played === real[i].played);

console.log(
  `\nFinal table check (user's match finished ${userHome}–${userAway}):`
);
check("live table order == real final table", sameOrder, sameOrder ? "identical" : "ORDER DIFFERS");
check("points match row for row", samePoints, samePoints ? "identical" : "POINTS DIFFER");
check("goal difference matches row for row", sameGd, sameGd ? "identical" : "GD DIFFERS");
check("games played matches row for row", samePlayed, samePlayed ? "identical" : "PLAYED DIFFERS");

const champion = state.teams[real[0].teamId];
const userPos = real.findIndex((r) => r.teamId === state.userTeamId) + 1;
console.log(
  `\nChampions: ${champion.name} (${real[0].points} pts) · you finished ${userPos}${
    [, "st", "nd", "rd"][userPos % 10] ?? "th"
  }`
);

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);

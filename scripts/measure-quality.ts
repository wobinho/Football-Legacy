// Squad QUALITY over a long save (v1.92) — a measurement, not an assertion.
//   npx tsx scripts/measure-quality.ts [seasons]
//
// `verify:squads` asks whether every club can still field its SHAPE. This asks
// the different question behind "squads degrade after ten seasons": whether the
// world still contains world-class FOOTBALLERS. A pyramid can pass the shape
// check with a full complement of 68-rated journeymen.
//
// Prints, per season: the world's top-end population by overall band, the mean
// overall of the top division's clubs, ages, and how many players the world
// gained and lost. Run before and after a change to see what actually moved.

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
import { buildSideInput, squadOverall } from "../lib/selection";
import { getFormation } from "../lib/config/formations";
import { TUNING } from "../lib/config/tuning";
import type { GameState } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 15);

const state = generateWorld({
  saveName: "measure-quality",
  managerName: "Measurer",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

function snapshot(state: GameState) {
  const living = Object.values(state.players).filter((p) => p && !p.retired);
  const band = (lo: number, hi = 200) => living.filter((p) => p.overall >= lo && p.overall < hi).length;
  const top = state.leagues[state.divisionIds[0]];
  const clubOveralls = top.teamIds.map((id) => {
    const t = state.teams[id];
    const players = t.playerIds.map((pid) => state.players[pid]).filter((p) => p && !p.retired && !p.loan);
    return squadOverall(players, getFormation(t.tactic?.formationId ?? "433"), TUNING).overall;
  });
  const mean = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : 0);
  const best = living.slice().sort((a, b) => b.overall - a.overall);
  return {
    season: state.season,
    living: living.length,
    b85: band(85),
    b80: band(80, 85),
    b75: band(75, 80),
    topLeagueMean: mean(clubOveralls),
    topLeagueBest: Math.max(...clubOveralls),
    best10: mean(best.slice(0, 10).map((p) => p.overall)),
    meanAge: mean(living.map((p) => p.age)),
    freeAgents: living.filter((p) => !p.clubId).length,
    // The age pyramid is the diagnostic that actually found the v1.92 defect:
    // the headcount and the positional cover both looked healthy for ten
    // seasons while the 22–25 cohort fell from 712 players to 27. If quality
    // ever decays again, read these two columns first.
    u22: living.filter((p) => p.age < 22).length,
    over30: living.filter((p) => p.age >= 30).length,
    meanSquad: mean(
      Object.values(state.teams).map(
        (t) => t.playerIds.filter((id) => state.players[id] && !state.players[id].retired).length
      )
    ),
  };
}

const rows: ReturnType<typeof snapshot>[] = [snapshot(state)];

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
    rows.push(snapshot(state));
  } else if (stop.kind === "idle") {
    console.error("!! loop stalled");
    process.exit(1);
  }
}

console.log(
  "\nS   living  85+   80-84  75-79  topLgMean  best10  meanAge  u22   30+   squad  freeAg"
);
for (const r of rows) {
  console.log(
    `${String(r.season).padEnd(3)} ${String(r.living).padEnd(7)} ${String(r.b85).padEnd(5)} ` +
      `${String(r.b80).padEnd(6)} ${String(r.b75).padEnd(6)} ${r.topLeagueMean.toFixed(1).padEnd(10)} ` +
      `${r.best10.toFixed(1).padEnd(7)} ${r.meanAge.toFixed(1).padEnd(8)} ${String(r.u22).padEnd(5)} ` +
      `${String(r.over30).padEnd(5)} ${r.meanSquad.toFixed(1).padEnd(6)} ${r.freeAgents}`
  );
}

const first = rows[0];
const last = rows[rows.length - 1];
console.log(
  `\nΔ over ${rows.length - 1} seasons: 85+ ${first.b85}→${last.b85}, 80-84 ${first.b80}→${last.b80}, ` +
    `top-league mean ${first.topLeagueMean.toFixed(1)}→${last.topLeagueMean.toFixed(1)}, ` +
    `best10 ${first.best10.toFixed(1)}→${last.best10.toFixed(1)}`
);

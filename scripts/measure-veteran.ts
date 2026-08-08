// Veteran season gain by AGE — a measurement, not an assertion.
//   npx tsx scripts/measure-veteran.ts [seasons]
//
// `measure:growth` reports gain by the age a player STARTED at, which is the
// right question for "did his career pay off" and the wrong one for "should a
// 34-year-old still be improving". A player who starts at 25 and runs ten
// seasons is counted once, in the 25–27 band, however much of that gain landed
// after he turned 33.
//
// This tracks every player-season in the world and buckets the overall delta by
// the age he was WHEN HE PLAYED IT. That is the reported symptom directly:
// "some players aged 34 still got +4 rating".

import { generateWorld } from "../lib/worldgen";
import { advanceUntilEvent, applyMatchResult, afterUserMatch, matchSeed, ensureUserLineup, runSeasonRollover } from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";
import type { GameState } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 8);

const state: GameState = generateWorld({
  saveName: "measure-veteran",
  managerName: "Measurer",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 4242,
});

/** age → deltas observed for a season played at that age */
const byAge = new Map<number, number[]>();
/** the standout cases: a big gain at a veteran age */
let bigVeteranGains = 0;
let veteranSeasons = 0;

function snapshot(): Map<string, { age: number; overall: number; apps: number }> {
  const m = new Map<string, { age: number; overall: number; apps: number }>();
  for (const p of Object.values(state.players)) {
    if (!p || p.retired || !p.clubId) continue;
    m.set(p.id, { age: p.age, overall: p.overall, apps: p.stats?.apps ?? 0 });
  }
  return m;
}

function playSeason() {
  const before = snapshot();
  let guard = 0;
  while (guard++ < 4000) {
    const stop = advanceUntilEvent(state);
    if (stop.kind === "seasonEnd") break;
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
    } else if (stop.kind === "idle") {
      console.error("!! loop stalled");
      process.exit(1);
    }
  }
  const mid = snapshot();
  runSeasonRollover(state);

  for (const [id, b] of before) {
    const a = mid.get(id);
    if (!a) continue;
    // Only count a season he actually PLAYED — an unused squad player's flat
    // rating would drown the signal we are looking for.
    const played = a.apps - b.apps;
    if (played < 15) continue;
    const delta = a.overall - b.overall;
    const list = byAge.get(b.age) ?? [];
    list.push(delta);
    byAge.set(b.age, list);
    if (b.age >= 33) {
      veteranSeasons++;
      if (delta >= 3) bigVeteranGains++;
    }
  }
}

for (let s = 0; s < SEASONS; s++) playSeason();

console.log(`\nVeteran season-gain by AGE PLAYED — ${SEASONS} seasons, ≥15 apps\n`);
console.log("  age      n     mean    median      max    % gaining    % +3 or more");
const ages = [...byAge.keys()].sort((a, b) => a - b);
for (const age of ages) {
  if (age < 24) continue;
  const list = byAge.get(age)!;
  if (list.length < 10) continue;
  const sorted = [...list].sort((a, b) => a - b);
  const mean = list.reduce((s, d) => s + d, 0) / list.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  const gaining = list.filter((d) => d > 0).length / list.length;
  const big = list.filter((d) => d >= 3).length / list.length;
  console.log(
    `  ${String(age).padStart(3)} ${String(list.length).padStart(6)} ${mean.toFixed(2).padStart(8)} ${String(median).padStart(9)} ${String(max).padStart(8)} ${(gaining * 100).toFixed(1).padStart(11)}% ${(big * 100).toFixed(1).padStart(15)}%`
  );
}
console.log(
  `\n  Seasons played at 33+: ${veteranSeasons}; of those ${bigVeteranGains} gained +3 or more (${((bigVeteranGains / Math.max(1, veteranSeasons)) * 100).toFixed(1)}%).`
);
console.log("  A healthy world has the mean crossing zero around the late twenties and clearly negative by 33.\n");

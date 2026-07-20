// Long-save performance harness (§13). Plays N seasons headlessly and reports
// how the save scales: player-object growth, career rows, serialisation cost,
// and the wall-clock cost of a season rollover.
//
//   npx tsx scripts/perf.ts [seasons] [sampleEvery]
//
// The point is to distinguish costs that grow with the LIVING world (bounded —
// squads are capped) from costs that grow with everything that has ever existed
// (unbounded — the thing that actually decides whether season 100 is playable).

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

const SEASONS = Number(process.argv[2] ?? 30);
const SAMPLE_EVERY = Number(process.argv[3] ?? 5);

const state = generateWorld({
  saveName: "perf",
  managerName: "Perf Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

interface Sample {
  season: number;
  players: number;
  retired: number;
  careers: number;
  careerRows: number;
  saveMB: number;
  serialiseMs: number;
  rolloverMs: number;
}
const samples: Sample[] = [];
let lastRolloverMs = 0;

function measure(season: number) {
  const players = Object.values(state.players);
  const retired = players.filter((p) => p.retired).length;
  const careers = Object.values(state.careers);
  const careerRows = careers.reduce((n, c) => n + c.seasons.length + c.transfers.length, 0);

  const t0 = performance.now();
  const json = JSON.stringify(state);
  const serialiseMs = performance.now() - t0;

  samples.push({
    season,
    players: players.length,
    retired,
    careers: careers.length,
    careerRows,
    saveMB: json.length / 1_048_576,
    serialiseMs,
    rolloverMs: lastRolloverMs,
  });
}

let guard = 0;
const runStart = performance.now();

while (state.season <= SEASONS && guard++ < 30_000) {
  const stop = advanceUntilEvent(state);
  if (stop.kind === "matchday") {
    const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
    const userLineup = ensureUserLineup(state);
    const mk = (teamId: string, fixed?: typeof userLineup) => {
      const t = state.teams[teamId];
      const ps = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
      return buildSideInput(teamId, t.name, t.short, ps, t.tactic, TUNING, fixed);
    };
    const res = simulateMatch(
      mk(fixture.homeId, fixture.homeId === state.userTeamId ? userLineup : undefined),
      mk(fixture.awayId, fixture.awayId === state.userTeamId ? userLineup : undefined),
      TUNING,
      matchSeed(state, fixture)
    );
    applyMatchResult(state, fixture, res);
    afterUserMatch(state);
  } else if (stop.kind === "seasonEnd") {
    const season = state.season;
    const t0 = performance.now();
    runSeasonRollover(state);
    lastRolloverMs = performance.now() - t0;
    if (season % SAMPLE_EVERY === 0 || season === 1) measure(season);
  }
}

const totalS = (performance.now() - runStart) / 1000;

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`\nPlayed ${SEASONS} seasons in ${totalS.toFixed(1)}s\n`);
console.log("  S   players  retired   careers  careerRows   saveMB  JSON ms  rollover ms");
for (const s of samples) {
  console.log(
    `${pad(s.season, 3)}  ${pad(s.players, 8)} ${pad(s.retired, 8)} ${pad(s.careers, 9)} ${pad(
      s.careerRows,
      11
    )} ${pad(s.saveMB.toFixed(2), 8)} ${pad(s.serialiseMs.toFixed(0), 8)} ${pad(s.rolloverMs.toFixed(0), 12)}`
  );
}

const first = samples[0];
const last = samples[samples.length - 1];
if (first && last && last !== first) {
  const span = last.season - first.season;
  console.log(
    `\nPer season: +${((last.players - first.players) / span).toFixed(0)} players, ` +
      `+${((last.careerRows - first.careerRows) / span).toFixed(0)} career rows, ` +
      `+${((last.saveMB - first.saveMB) / span).toFixed(3)} MB`
  );
  console.log(
    `Extrapolated to S100: ~${(first.players + ((last.players - first.players) / span) * 100).toFixed(0)} players, ` +
      `~${(first.saveMB + ((last.saveMB - first.saveMB) / span) * 100).toFixed(1)} MB save, ` +
      `~${(first.serialiseMs + ((last.serialiseMs - first.serialiseMs) / span) * 100).toFixed(0)} ms per autosave`
  );
}

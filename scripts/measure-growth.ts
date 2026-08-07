// Career GROWTH over a long save (v2.0) — a measurement, not an assertion.
//   npx tsx scripts/measure-growth.ts [seasons]
//
// `measure:quality` asks whether the WORLD still contains world-class players.
// This asks the question a manager actually asks about one of his own: "he has
// started 40 games a season for eight years — how much better has he got?"
//
// Those are different questions and a world can pass the first while failing
// the second, because population can be held up by intake and recruitment while
// every individual career is flat. The reported symptom (+2 overall across
// eight seasons of ever-present football) is invisible in every aggregate
// `measure:quality` prints.
//
// It tracks a fixed COHORT — every player at a club at kickoff — and reports
// how far each got, split by the age he started at and by how much he played.
// Run before and after a growth change to see what actually moved.

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
import type { GameState } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 8);

const state = generateWorld({
  saveName: "measure-growth",
  managerName: "Measurer",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

/** The cohort: everyone at a club on day one, with where they started. */
type Tracked = {
  id: string;
  startAge: number;
  startOverall: number;
  startPotential: number;
  apps: number; // cumulative, across the whole run
};

const cohort = new Map<string, Tracked>();
for (const p of Object.values(state.players)) {
  if (!p || p.retired || !p.clubId) continue;
  cohort.set(p.id, {
    id: p.id,
    startAge: p.age,
    startOverall: p.overall,
    startPotential: p.potential,
    apps: 0,
  });
}

// Appearances are reset every rollover, so they have to be banked as we go.
function bankApps(state: GameState) {
  for (const t of cohort.values()) {
    const p = state.players[t.id];
    if (p) t.apps += p.stats.apps;
  }
}

/** Play out one season, forcing the user's own matches exactly as
 * `measure-quality` does — same loop, so the two measurements describe the same
 * world rather than two differently-driven ones. */
function playSeason(state: GameState) {
  let guard = 0;
  while (guard++ < 4000) {
    const stop = advanceUntilEvent(state);
    if (stop.kind === "seasonEnd") return;
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
}

const mean = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : 0);
const median = (ns: number[]) => {
  if (!ns.length) return 0;
  const s = ns.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log(`Growth cohort: ${cohort.size} players at a club on day one. Playing ${SEASONS} seasons…\n`);

for (let i = 0; i < SEASONS; i++) {
  playSeason(state);
  bankApps(state);
  runSeasonRollover(state);
}

// ── Report ────────────────────────────────────────────────────────────────
// Only players who SURVIVED the run are meaningful: a retiree's final overall
// includes his decline, which is a different question.
type Row = Tracked & { endOverall: number; gain: number; appsPerSeason: number };
const rows: Row[] = [];
for (const t of cohort.values()) {
  const p = state.players[t.id];
  if (!p || p.retired) continue;
  rows.push({
    ...t,
    endOverall: p.overall,
    gain: p.overall - t.startOverall,
    appsPerSeason: t.apps / SEASONS,
  });
}

console.log(`${rows.length} of the cohort are still playing after ${SEASONS} seasons.\n`);

// The headline case: a REGULAR, i.e. someone who actually played. 25+ apps a
// season averaged over the run is a first-choice player by any reading.
const regulars = rows.filter((r) => r.appsPerSeason >= 25);
console.log(`── Regulars (≥25 apps/season averaged over the run): ${regulars.length}`);
const bands: [string, (r: Row) => boolean][] = [
  ["started 16–18", (r) => r.startAge >= 16 && r.startAge <= 18],
  ["started 19–21", (r) => r.startAge >= 19 && r.startAge <= 21],
  ["started 22–24", (r) => r.startAge >= 22 && r.startAge <= 24],
  ["started 25–27", (r) => r.startAge >= 25 && r.startAge <= 27],
  ["started 28–30", (r) => r.startAge >= 28 && r.startAge <= 30],
];
console.log(
  "  band".padEnd(18) +
    "n".padStart(5) +
    "startOvr".padStart(10) +
    "endOvr".padStart(9) +
    "gain".padStart(8) +
    "median".padStart(9) +
    "headroom".padStart(10)
);
for (const [label, pred] of bands) {
  const g = regulars.filter(pred);
  if (!g.length) continue;
  console.log(
    `  ${label}`.padEnd(18) +
      String(g.length).padStart(5) +
      mean(g.map((r) => r.startOverall)).toFixed(1).padStart(10) +
      mean(g.map((r) => r.endOverall)).toFixed(1).padStart(9) +
      mean(g.map((r) => r.gain)).toFixed(2).padStart(8) +
      median(g.map((r) => r.gain)).toFixed(1).padStart(9) +
      mean(g.map((r) => r.startPotential - r.startOverall)).toFixed(1).padStart(10)
  );
}

// The complaint restated: how many ever-present players went essentially
// nowhere? This is the number the change has to move.
const flat = regulars.filter((r) => r.gain <= 2);
const roomToGrow = regulars.filter((r) => r.startPotential - r.startOverall >= 5);
const flatWithRoom = roomToGrow.filter((r) => r.gain <= 2);
console.log(
  `\n  ${flat.length}/${regulars.length} regulars (${((100 * flat.length) / Math.max(1, regulars.length)).toFixed(0)}%) gained ≤2 overall across ${SEASONS} seasons.`
);
console.log(
  `  Of the ${roomToGrow.length} who STARTED with ≥5 points of headroom, ${flatWithRoom.length} (${(
    (100 * flatWithRoom.length) /
    Math.max(1, roomToGrow.length)
  ).toFixed(0)}%) gained ≤2 — that is the defect case: room to grow, minutes played, no growth.`
);
console.log(
  `  Mean gain, regulars with headroom: ${mean(roomToGrow.map((r) => r.gain)).toFixed(2)} over ${SEASONS} seasons ` +
    `(${(mean(roomToGrow.map((r) => r.gain)) / SEASONS).toFixed(2)}/season).`
);

// And the counterweight: the change must not make the world's ceiling silly.
const best = Object.values(state.players)
  .filter((p) => p && !p.retired)
  .sort((a, b) => b.overall - a.overall);
console.log(
  `\n  World top 10 mean overall: ${mean(best.slice(0, 10).map((p) => p.overall)).toFixed(1)} ` +
    `(best ${best[0]?.overall}); 85+ population ${best.filter((p) => p.overall >= 85).length}.`
);

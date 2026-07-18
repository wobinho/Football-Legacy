// Calibration harness (§7): simulate ~1,000+ matches and print distributions.
// All tuning happens by turning knobs in lib/config/tuning.ts and re-running:
//   npm run calibrate
// Targets: ~2.7 goals/match, home win ~45%, realistic draw + upset rates.

import { generateWorld } from "../lib/worldgen";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput, teamStrength } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";
import { mulberry32 } from "../lib/rng";

const N = Number(process.argv[2] ?? 2000);

const world = generateWorld({
  saveName: "calibration",
  managerName: "Harness",
  userTeamId: "ENG1_t0",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 12345,
});

const teamIds = world.leagues["ENG1"].teamIds;
const strengths = new Map<string, number>();
for (const id of teamIds) {
  const players = world.teams[id].playerIds.map((pid) => world.players[pid]);
  strengths.set(id, teamStrength(players, TUNING));
}

const rng = mulberry32(999);
let goals = 0;
let homeWins = 0, draws = 0, awayWins = 0;
let homeCS = 0, awayCS = 0;
let upsets = 0, decidedWithFavorite = 0;
let bigGaps = 0, bigGapUpsets = 0;
const goalDist = new Map<number, number>();
let shots = 0;

for (let i = 0; i < N; i++) {
  const hi = Math.floor(rng() * teamIds.length);
  let ai = Math.floor(rng() * teamIds.length);
  while (ai === hi) ai = Math.floor(rng() * teamIds.length);
  const homeId = teamIds[hi];
  const awayId = teamIds[ai];

  const mk = (id: string) => {
    const t = world.teams[id];
    return buildSideInput(id, t.name, t.short, t.playerIds.map((p) => world.players[p]), t.tactic, TUNING);
  };
  const res = simulateMatch(mk(homeId), mk(awayId), TUNING, Math.floor(rng() * 2 ** 31));

  const total = res.homeGoals + res.awayGoals;
  goals += total;
  shots += res.stats.shots[0] + res.stats.shots[1];
  goalDist.set(total, (goalDist.get(total) ?? 0) + 1);
  if (res.homeGoals > res.awayGoals) homeWins++;
  else if (res.homeGoals < res.awayGoals) awayWins++;
  else draws++;
  if (res.awayGoals === 0) homeCS++;
  if (res.homeGoals === 0) awayCS++;

  const sh = strengths.get(homeId)!;
  const sa = strengths.get(awayId)!;
  const gap = Math.abs(sh - sa);
  if (res.homeGoals !== res.awayGoals) {
    const winnerStrength = res.homeGoals > res.awayGoals ? sh : sa;
    const loserStrength = res.homeGoals > res.awayGoals ? sa : sh;
    decidedWithFavorite++;
    if (winnerStrength < loserStrength - 1) upsets++;
    if (gap >= 8) {
      bigGaps++;
      if (winnerStrength < loserStrength) bigGapUpsets++;
    }
  }
}

const pct = (x: number, of = N) => ((100 * x) / of).toFixed(1) + "%";
console.log(`\n── Calibration: ${N} matches (ENG1 squads) ─────────────────`);
console.log(`avg goals/match      ${(goals / N).toFixed(2)}   (target ${TUNING.targetGoalsPerMatch})`);
console.log(`home / draw / away   ${pct(homeWins)} / ${pct(draws)} / ${pct(awayWins)}   (target ~${TUNING.targetHomeWinPct}% home)`);
console.log(`clean sheets         home ${pct(homeCS)}  away ${pct(awayCS)}`);
console.log(`upset rate           ${pct(upsets, Math.max(1, decidedWithFavorite))} of decided matches (weaker team wins)`);
console.log(`big-gap upsets       ${pct(bigGapUpsets, Math.max(1, bigGaps))} (strength gap ≥ 8)`);
console.log(`avg chances/match    ${(shots / N).toFixed(1)}`);
console.log(`goal totals:`);
for (let g = 0; g <= 8; g++) {
  const c = goalDist.get(g) ?? 0;
  console.log(`  ${g}: ${"#".repeat(Math.round((300 * c) / N))} ${pct(c)}`);
}
const strengthArr = [...strengths.values()].sort((a, b) => b - a);
console.log(`\nteam strength spread: best ${strengthArr[0].toFixed(1)}, median ${strengthArr[10].toFixed(1)}, worst ${strengthArr[19].toFixed(1)}`);

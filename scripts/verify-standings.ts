// Standings verifier (v1.91): does a league table actually reflect squad quality?
//
//   npx tsx scripts/verify-standings.ts [seasons]
//
// The match engine can hit every calibration target — ~2.7 goals/match, ~45%
// home wins — and still produce nonsense seasons, because those targets say
// nothing about WHO wins. Before v1.91 a 67-rated promoted side could win a
// division of 70+ clubs, and a top-flight club could free-fall two divisions,
// while `npm run calibrate` reported everything on target. This is the check
// that would have caught it, and it is deliberately a measured sweep of whole
// seasons rather than a table assertion: the defect was a single mis-centred
// constant that no table could show.
//
// It plays real 38-game double round-robins with the real engine and asserts
// the SHAPE of the result, never exact numbers — a seeded world is stable but
// tuning is meant to move, so pinning rho to 0.65 would make every future tweak
// a test failure.

import { generateWorld } from "../lib/worldgen";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput, squadOverall } from "../lib/selection";
import { getFormation } from "../lib/config/formations";
import { TUNING } from "../lib/config/tuning";
import { mulberry32 } from "../lib/rng";

const SEASONS = Number(process.argv[2] ?? 30);

const world = generateWorld({
  saveName: "verify-standings",
  managerName: "Harness",
  userTeamId: "ENG1_t0",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 12345,
});

const teamIds = world.leagues["ENG1"].teamIds;
const gamesPerTeam = (teamIds.length - 1) * 2;

/** Each club's XI+bench overall — the same number the team card shows. */
const ovr = new Map<string, number>();
for (const id of teamIds) {
  const t = world.teams[id];
  const players = t.playerIds.map((p) => world.players[p]).filter(Boolean);
  ovr.set(id, squadOverall(players, getFormation(t.tactic.formationId), TUNING).overall);
}
const byQuality = [...ovr.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
const best = ovr.get(byQuality[0])!;
const worst = ovr.get(byQuality[byQuality.length - 1])!;

/** Spearman rank correlation between squad quality and finishing position. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(a.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length, m = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - m) * (ry[i] - m);
    dx += (rx[i] - m) ** 2;
    dy += (ry[i] - m) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

const mk = (id: string) => {
  const t = world.teams[id];
  return buildSideInput(id, t.name, t.short, t.playerIds.map((p) => world.players[p]), t.tactic, TUNING);
};

let rhoSum = 0, champPtsSum = 0, champQualityRankSum = 0;
let draws = 0, games = 0, goals = 0, homeWins = 0;
// How often the title goes to a club from the bottom half of the quality table —
// the exact complaint that motivated v1.91.
let champFromBottomHalf = 0;

for (let s = 0; s < SEASONS; s++) {
  const rng = mulberry32(s * 977 + 3);
  const pts = new Map(teamIds.map((t) => [t, 0]));
  for (const home of teamIds) {
    for (const away of teamIds) {
      if (home === away) continue;
      const r = simulateMatch(mk(home), mk(away), TUNING, Math.floor(rng() * 2 ** 31));
      games++;
      goals += r.homeGoals + r.awayGoals;
      if (r.homeGoals > r.awayGoals) { homeWins++; pts.set(home, pts.get(home)! + 3); }
      else if (r.homeGoals < r.awayGoals) pts.set(away, pts.get(away)! + 3);
      else { draws++; pts.set(home, pts.get(home)! + 1); pts.set(away, pts.get(away)! + 1); }
    }
  }
  const table = [...pts.entries()].sort((a, b) => b[1] - a[1]);
  rhoSum += spearman(table.map(([id]) => ovr.get(id)!), table.map((_, i) => -i));
  champPtsSum += table[0][1];
  const champQ = byQuality.indexOf(table[0][0]) + 1;
  champQualityRankSum += champQ;
  if (champQ > teamIds.length / 2) champFromBottomHalf++;
}

const rho = rhoSum / SEASONS;
const champPts = champPtsSum / SEASONS;
const champRank = champQualityRankSum / SEASONS;
const drawPct = (draws / games) * 100;
const homePct = (homeWins / games) * 100;
const gpm = goals / games;
const bottomHalfPct = (champFromBottomHalf / SEASONS) * 100;

console.log(`Standings check — ${SEASONS} seasons × ${gamesPerTeam} games, ${teamIds.length} clubs`);
console.log(`  squad overall spread   ${worst} … ${best}`);
console.log(`  quality→finish rho     ${rho.toFixed(3)}`);
console.log(`  champion points        ${champPts.toFixed(1)}`);
console.log(`  champion quality rank  ${champRank.toFixed(2)} (1 = best squad won)`);
console.log(`  champion from bottom ½ ${bottomHalfPct.toFixed(1)}%`);
console.log(`  goals/match            ${gpm.toFixed(2)}`);
console.log(`  home wins / draws      ${homePct.toFixed(1)}% / ${drawPct.toFixed(1)}%`);

const fail: string[] = [];

// The headline invariant. Below ~0.5 the table is closer to a shuffle than a
// season; a real league sits around 0.7-0.85. Set well under the measured 0.65
// so ordinary tuning has room to move without tripping it.
if (rho < 0.5) fail.push(`quality→finish rho ${rho.toFixed(3)} < 0.50 — the table barely reflects squad quality`);

// The user-visible symptom: the champion should be a genuinely good side.
if (champRank > 4) fail.push(`champion averages the ${champRank.toFixed(1)}th-best squad — expected top 4`);
if (bottomHalfPct > 5) fail.push(`${bottomHalfPct.toFixed(1)}% of titles go to bottom-half squads — expected ≤5%`);

// A season has to stay a plausible season. These bracket both directions: too
// few points means the engine is a coin flip, too many means it is deterministic
// and every mismatch is a foregone conclusion.
if (champPts < 70 || champPts > 100) fail.push(`champion points ${champPts.toFixed(1)} outside 70-100`);
if (drawPct < 18 || drawPct > 32) fail.push(`draw rate ${drawPct.toFixed(1)}% outside 18-32%`);

// The calibration targets, re-checked here so a standings fix can't quietly
// wreck what `npm run calibrate` guards.
if (gpm < 2.3 || gpm > 3.1) fail.push(`goals/match ${gpm.toFixed(2)} outside 2.3-3.1`);
if (homePct < 40 || homePct > 52) fail.push(`home wins ${homePct.toFixed(1)}% outside 40-52%`);

if (fail.length) {
  console.error("\nFAIL");
  for (const f of fail) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nPASS — squad quality decides seasons, and the season still looks like football.");

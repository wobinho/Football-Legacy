// Match-rating spread measurement (v2.0).
//
//   npx tsx scripts/measure-ratings.ts [seasons]
//
// The question this answers is the one that motivated the v2.0 rating rework:
// does a season of match ratings actually SEPARATE players, or does everyone
// come out at the same number?
//
// Before v2.0 a rating was `6.5 + goals + assists/2 + gd×0.15 + ±0.4`, so a
// player who neither scored nor assisted rated 6.5 every week and his season
// average converged on 6.5 as the noise cancelled — the more matches he played,
// the LESS his average said about him. That is exactly backwards for the
// end-of-season awards, which score `avgRating × (1 + teamSuccess)`: with the
// rating term flat, the awards were decided almost entirely by which club
// finished highest, and a defensive midfielder could not win one at all.
//
// This is a MEASUREMENT, not an assertion. It prints the distribution and the
// correlation between a player's quality and his season average; run it before
// and after touching any `rating*` constant in tuning. The numbers it should
// produce are stated at the bottom of the output.

import { generateWorld } from "../lib/worldgen";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";
import { posGroup } from "../lib/config/positions";
import { mulberry32 } from "../lib/rng";
import type { PlayerBio } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 3);

const world = generateWorld({
  saveName: "measure-ratings",
  managerName: "Harness",
  userTeamId: "ENG1_t0",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 4242,
});

const teamIds = world.leagues["ENG1"].teamIds;

/** Every rating a player collected, keyed by player id. */
const collected = new Map<string, number[]>();
const record = (id: string, r: number) => {
  const arr = collected.get(id);
  if (arr) arr.push(r);
  else collected.set(id, [r]);
};

/** One club's side input, picked and configured exactly as the matchday does. */
const side = (id: string) => {
  const t = world.teams[id];
  return buildSideInput(
    id,
    t.name,
    t.short,
    t.playerIds.map((p) => world.players[p]).filter(Boolean),
    t.tactic,
    TUNING
  );
};

const rng = mulberry32(99);
let matches = 0;

for (let season = 0; season < SEASONS; season++) {
  // A full double round-robin, played with the real engine exactly as the
  // matchday does — a synthetic fixture list would be measuring something else.
  for (let round = 0; round < (teamIds.length - 1) * 2; round++) {
    for (let i = 0; i < teamIds.length; i += 2) {
      const homeId = teamIds[(i + round) % teamIds.length];
      const awayId = teamIds[(i + 1 + round) % teamIds.length];
      if (homeId === awayId) continue;
      const home = side(homeId);
      const away = side(awayId);
      const res = simulateMatch(home, away, TUNING, Math.floor(rng() * 1e9));
      matches++;
      for (const [pid, r] of Object.entries(res.ratings)) record(pid, r);
    }
  }
}

// ── Distribution over individual match ratings ─────────────────────────────

const all: number[] = [];
for (const rs of collected.values()) all.push(...rs);
all.sort((a, b) => a - b);

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];

console.log(`\n=== MATCH RATINGS — ${matches} matches, ${all.length} ratings ===\n`);
console.log(`  mean            ${mean(all).toFixed(2)}`);
console.log(`  std deviation   ${sd(all).toFixed(2)}`);
console.log(
  `  p05 / p25 / p50 / p75 / p95   ${pct(all, 0.05).toFixed(1)} / ${pct(all, 0.25).toFixed(
    1
  )} / ${pct(all, 0.5).toFixed(1)} / ${pct(all, 0.75).toFixed(1)} / ${pct(all, 0.95).toFixed(1)}`
);
console.log(`  min / max       ${all[0].toFixed(1)} / ${all[all.length - 1].toFixed(1)}`);

// A histogram, because the shape matters as much as the spread — the failure
// mode being fixed is a spike at one value, which a standard deviation alone
// can hide behind a couple of outliers.
console.log(`\n  distribution:`);
const buckets = new Map<string, number>();
for (const r of all) {
  const k = (Math.floor(r * 2) / 2).toFixed(1);
  buckets.set(k, (buckets.get(k) ?? 0) + 1);
}
for (const k of [...buckets.keys()].sort((a, b) => Number(a) - Number(b))) {
  const n = buckets.get(k)!;
  const share = n / all.length;
  console.log(`    ${k.padStart(4)}  ${"█".repeat(Math.round(share * 120))} ${(share * 100).toFixed(1)}%`);
}

// ── Season averages: do they separate players? ─────────────────────────────
//
// The award-relevant question. A season average over ~30 matches should still
// vary, and it should VARY WITH QUALITY — that is what lets a Player of the
// Season be a player who was actually good rather than the striker at the club
// that happened to win the league.

const MIN_APPS = 15;
const rows: { p: PlayerBio; avg: number; apps: number }[] = [];
for (const [pid, rs] of collected) {
  if (rs.length < MIN_APPS) continue;
  const p = world.players[pid];
  if (!p) continue;
  rows.push({ p, avg: mean(rs), apps: rs.length });
}
const avgs = rows.map((r) => r.avg);

console.log(`\n=== SEASON AVERAGES — ${rows.length} players with ${MIN_APPS}+ apps ===\n`);
console.log(`  mean            ${mean(avgs).toFixed(3)}`);
console.log(`  std deviation   ${sd(avgs).toFixed(3)}`);
console.log(
  `  p05 / p50 / p95 ${pct([...avgs].sort((a, b) => a - b), 0.05).toFixed(2)} / ${pct(
    [...avgs].sort((a, b) => a - b),
    0.5
  ).toFixed(2)} / ${pct([...avgs].sort((a, b) => a - b), 0.95).toFixed(2)}`
);
console.log(
  `  range           ${Math.min(...avgs).toFixed(2)} – ${Math.max(...avgs).toFixed(2)}`
);

/** Pearson correlation. */
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy || 1);
}

const rho = pearson(rows.map((r) => r.p.overall), avgs);
console.log(`\n  correlation with overall   ${rho.toFixed(3)}`);

// Per position group — the specific defect being fixed is that non-scoring
// roles had no way to earn a rating, so DEF and MID mattered most here.
console.log(`\n  by position group:`);
for (const g of ["GK", "DEF", "MID", "ATT"] as const) {
  const sub = rows.filter((r) => posGroup(r.p.positions[0]) === g);
  if (!sub.length) continue;
  const sa = sub.map((r) => r.avg);
  console.log(
    `    ${g.padEnd(4)} n=${String(sub.length).padStart(3)}  mean ${mean(sa).toFixed(2)}  sd ${sd(
      sa
    ).toFixed(3)}  range ${Math.min(...sa).toFixed(2)}–${Math.max(...sa).toFixed(2)}`
  );
}

console.log(`\n  top 10 season averages:`);
for (const r of [...rows].sort((a, b) => b.avg - a.avg).slice(0, 10)) {
  console.log(
    `    ${r.avg.toFixed(2)}  ${r.p.name.padEnd(22)} ${String(r.p.overall).padStart(2)} ovr  ${r.p.positions[0].padEnd(3)}  ${r.apps} apps`
  );
}

console.log(`
=== WHAT TO LOOK FOR ===

  Match ratings     sd ≥ 0.55, and the distribution should be a hump rather
                    than a spike — before v2.0 over half of all ratings landed
                    in a single 0.5-wide bucket at 6.5.
  Season averages   sd ≥ 0.15 and a range spanning at least a full point. A
                    season average is a mean over ~30 matches so it is MEANT to
                    be tighter than a single rating; what it must not be is
                    identical for everyone.
  Correlation       positive and ≥ 0.3. This is what makes the awards decidable:
                    a better player should, over a season, rate better. It is
                    deliberately not near 1 — a great season by an ordinary
                    player is the thing an award exists to find.
  By group          every group should show real spread. GK/DEF having sd near
                    zero is the exact v1.x defect: no way to earn a rating
                    without scoring.
`);

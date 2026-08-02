/**
 * Does a training plan actually change who a player is? (v1.85)
 *
 * The design's loop is `Training Plan → Attributes → Archetype → Tactical
 * effect`, and the third arrow is the one that kept silently not happening. Two
 * separate bugs made a plan change almost inert, and neither was visible in the
 * tables — only in a measured sweep, which is what this file is:
 *
 *  1. `fitAttrsToOverall` settled the attribute line along the POSITION's
 *     overall weights. That step moved ~4× as many attribute points as the
 *     training plan's own shares did (46 vs 12 on a measured season), and
 *     because position weight rewards whatever the player was already good at,
 *     it fed his existing identity straight back to him. Fixed by biasing the
 *     residual toward the plan (`FIT_PLAN_TILT` in config/positions.ts).
 *
 *  2. `seasonGrowthEstimate` ROUNDED the prime-phase delta. A prime season earns
 *     0.46 of a point at 75 overall and 0.16 at 88, so every player at 75+
 *     projected as growing exactly zero from the day he turned 27 — forever. The
 *     conversion walk stops at the first zero, so a whole squad reported "no
 *     growth left" on every plan. The rollover never rounded, so this was not a
 *     conservative estimate; it was a different answer than the simulation's.
 *
 * What this asserts is deliberately about SHAPE rather than exact rates — the
 * numbers move whenever the growth curve or the archetype thresholds are tuned,
 * and pinning them would make this a change-detector rather than a check. What
 * must stay true is that training steers, that youth steers most, and that the
 * two dead-end verdicts stay honest.
 */

import { mulberry32 } from "../lib/rng";
import { TUNING } from "../lib/config/tuning";
import { generatePlayer } from "../lib/worldgen";
import { archetypeConversionEta } from "../lib/development";
import { plansForPosition } from "../lib/config/training";
import { deriveArchetype, ARCHETYPE_BY_PLAN } from "../lib/config/archetype";
import type { Pos } from "../lib/types";

const POSITIONS: Pos[] = ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"];

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

interface Band {
  arriving: number;
  noGrowth: number;
  tooFar: number;
  total: number;
  seasons: number[];
}

function sweep(lo: number, hi: number, n: number, seed: number): Band {
  const rng = mulberry32(seed);
  const b: Band = { arriving: 0, noGrowth: 0, tooFar: 0, total: 0, seasons: [] };
  for (let i = 0; i < n; i++) {
    const pos = POSITIONS[Math.floor(rng() * POSITIONS.length)];
    const age = lo + Math.floor(rng() * (hi - lo + 1));
    const p = generatePlayer(rng, TUNING, { pos, overall: 55 + rng() * 25, nat: "ENG", age });
    const current = deriveArchetype(p.attrs, pos)?.id;
    for (const plan of plansForPosition(pos)) {
      const target = ARCHETYPE_BY_PLAN[plan.id];
      // Only plans pointing somewhere he ISN'T are a conversion question.
      if (!target || target.id === current) continue;
      p.trainingPlan = plan.id;
      const eta = archetypeConversionEta(p, TUNING, 1, 0, 0);
      if (!eta) continue;
      b[eta.outcome]++;
      b.total++;
      if (eta.outcome === "arriving") b.seasons.push(eta.seasons);
    }
  }
  return b;
}

const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

console.log("── Training-plan conversion (v1.85) ──────────────────────────\n");

const youth = sweep(16, 18, 250, 12345);
const early = sweep(19, 21, 250, 23456);
const mid = sweep(22, 24, 250, 34567);
const settled = sweep(29, 33, 250, 45678);

for (const [label, b] of [
  ["16–18", youth],
  ["19–21", early],
  ["22–24", mid],
  ["29–33", settled],
] as [string, Band][]) {
  console.log(
    `  ${label}  arriving ${pct(b.arriving, b.total).toFixed(1)}%` +
      `  noGrowth ${pct(b.noGrowth, b.total).toFixed(1)}%` +
      `  tooFar ${pct(b.tooFar, b.total).toFixed(1)}%` +
      `  (median ${median(b.seasons)} seasons, ${b.total} pairs)`
  );
}
console.log("");

check("the sample is large enough to mean something", youth.total > 500, `${youth.total} youth pairs`);

// The headline promise: a plan set on a teenager is a real lever. Before the
// v1.85 fixes this sat at 22%, and most of the rest was the FALSE "no growth"
// verdict rather than a genuine limit.
check(
  "a training plan converts a meaningful share of youth prospects",
  pct(youth.arriving, youth.total) >= 30,
  `${pct(youth.arriving, youth.total).toFixed(1)}%`
);

// Regression guard on bug 2. A 16–18-year-old has years of growth ahead by
// construction, so "he has no growth left" is almost never the true answer for
// him. It was 66% before the rounding fix.
check(
  "youth prospects are not reported as out of growth",
  pct(youth.noGrowth, youth.total) < 10,
  `${pct(youth.noGrowth, youth.total).toFixed(1)}% (was 66% with the rounding bug)`
);

// Age has to matter, or the plan isn't modelling development at all.
check(
  "conversion falls off with age",
  pct(youth.arriving, youth.total) > pct(early.arriving, early.total) &&
    pct(early.arriving, early.total) > pct(mid.arriving, mid.total),
  `${pct(youth.arriving, youth.total).toFixed(1)}% → ${pct(early.arriving, early.total).toFixed(1)}% → ${pct(mid.arriving, mid.total).toFixed(1)}%`
);

// The other side of it: on a settled player "no growth left" IS the honest
// answer, and the screens word it as ordinary football rather than a mistake.
check(
  "a settled squad is told it is out of growth, not that the plan is wrong",
  pct(settled.noGrowth, settled.total) > 80,
  `${pct(settled.noGrowth, settled.total).toFixed(1)}%`
);

// A conversion is a project, not a toggle — if it landed in a season or two the
// identity system would carry no weight.
check(
  "converting an identity takes multiple seasons",
  median(youth.seasons) >= 3,
  `median ${median(youth.seasons)} seasons`
);

// The ETA horizon has to be able to contain what it measures.
const worst = Math.max(0, ...youth.seasons, ...early.seasons, ...mid.seasons);
check("no conversion is reported beyond the 15-season horizon", worst <= 15, `max ${worst}`);

console.log(failures === 0 ? "\nAll conversion checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

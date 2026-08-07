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
import { archetypeConversionEta, seasonGrowthEstimate } from "../lib/development";
import { plansForPosition, resolveTrainingPlan } from "../lib/config/training";
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
// construction, so "he has no growth left" must not be the DOMINANT answer for
// him. It was 66% before the v1.85 rounding fix, and 9.7% after it.
//
// v2.0: the bar moves 10% → 40%, and the reason has to be recorded or the next
// caller will "fix" a working system. Raising `growthPerSeasonMax` 50% did not
// make the estimate wrong again — it made the same true statement arrive
// SOONER. The walk stops at the first zero-growth season, and a youth now
// spends his headroom faster: traced, a 17-year-old at 65 with an 86 ceiling
// converges on 86 by age 25 and correctly reports nothing left in season 9.
// Before, that took longer than the 15-season horizon, so he was still
// "growing" when the walk ran out and the same player was counted elsewhere.
//
// The distinction that matters — and the reason this stays a check rather than
// being deleted — is between "reported dead while still having headroom" (the
// v1.85 defect, which is a lie) and "reported dead having spent it" (football).
// The companion checks below still pin the honest half: 45% of youths convert,
// and conversion still falls off with age.
check(
  "youth prospects are not reported as out of growth",
  pct(youth.noGrowth, youth.total) < 40,
  `${pct(youth.noGrowth, youth.total).toFixed(1)}% (was 66% with the rounding bug, 9.7% before the v2.0 growth raise)`
);

// The DIRECT form of the guard above, and the one that actually separates the
// v1.85 defect from ordinary football (v2.0).
//
// The percentage check can only ever be a proxy: it moves whenever the growth
// rate moves, which is why it had to be re-baselined when `growthPerSeasonMax`
// was raised — and a proxy that gets re-baselined is a proxy that will one day
// be re-baselined over a real bug. This asks the question itself.
//
// `noGrowth` does NOT claim the player has nothing left TODAY — the walk grows
// him season by season, so the verdict means "his growth runs out before the
// archetype flips". (Measuring it as "nothing today" was the first cut of this
// check and it failed 467/467 on a perfectly healthy system, which is a good
// illustration of why the claim has to be stated precisely.)
//
// What must be true is that he actually ARRIVES somewhere: a player told his
// development ends must be one who reached, or effectively reached, his own
// declared ceiling. If the walk gives up while he is still well short of his
// potential, the projection is quitting early — the v1.85 lie — whatever the
// aggregate rate happens to be.
{
  const rng = mulberry32(99999);
  let dead = 0;
  let quitEarly = 0;
  let worstGap = 0;
  for (let i = 0; i < 400; i++) {
    const pos = POSITIONS[Math.floor(rng() * POSITIONS.length)];
    const age = 16 + Math.floor(rng() * 3);
    const p = generatePlayer(rng, TUNING, { pos, overall: 55 + rng() * 25, nat: "ENG", age });
    const current = deriveArchetype(p.attrs, pos)?.id;
    for (const plan of plansForPosition(pos)) {
      const target = ARCHETYPE_BY_PLAN[plan.id];
      if (!target || target.id === current) continue;
      p.trainingPlan = plan.id;
      const eta = archetypeConversionEta(p, TUNING, 1, 0, 0);
      if (!eta || eta.outcome !== "noGrowth") continue;
      dead++;
      // Walk the same projection and see where he actually stopped.
      const def = resolveTrainingPlan(plan.id, pos);
      let overall = p.overall;
      let simAge = p.age;
      for (let s = 1; s <= 15; s++) {
        const est = seasonGrowthEstimate({ ...p, overall, age: simAge }, TUNING, 1, def, 0);
        if (!est || est.delta <= 0) break;
        overall += est.delta;
        simAge += 1;
      }
      const gap = p.potential - overall;
      worstGap = Math.max(worstGap, gap);
      // 2 points of slack: the last season's delta is a fraction, so a player
      // converging on his ceiling stops just under it rather than exactly on it.
      if (gap > 2) quitEarly++;
    }
  }
  check(
    "a youth told 'no growth left' has actually reached his ceiling",
    quitEarly === 0,
    `${quitEarly} of ${dead} stopped early (worst gap ${worstGap.toFixed(1)} of potential)`
  );
}

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

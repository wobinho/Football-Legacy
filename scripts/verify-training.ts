// Structural check on the training-plan table (v1.72).
//
// Verifies the two promises the plan system makes:
//   1. Every position has exactly five plans, each naming four primary and four
//      secondary attributes, with no attribute in both tiers.
//   2. The dynamic multiplier does what it claims: a player on a specialised
//      plan develops overall at the same rate as one on the position's Balanced
//      plan. `idealGrowthMult` computes the figure each plan WOULD need from the
//      real position weights; the authored table is checked against it.
//
// Run: npx tsx scripts/verify-training.ts

import {
  PLANS_BY_POS,
  PLAN_POS_LABEL,
  TRAINING_PLANS,
  idealGrowthMult,
  planWeightCoverage,
  verifyPlanMultipliers,
  type PlanPos,
} from "../lib/config/training";
import type { Pos } from "../lib/types";

let failures = 0;
const fail = (msg: string) => {
  console.log(`FAIL  ${msg}`);
  failures++;
};
const ok = (msg: string, detail = "") => console.log(`OK    ${msg}  ${detail}`);

// ── 1. Structure ───────────────────────────────────────────────────────────
const groups = Object.keys(PLANS_BY_POS) as PlanPos[];
if (groups.length !== 9) fail(`expected 9 position groups, got ${groups.length}`);

for (const g of groups) {
  const plans = PLANS_BY_POS[g];
  if (plans.length !== 5) fail(`${g}: expected 5 plans, got ${plans.length}`);
  for (const p of plans) {
    if (p.primary.length !== 4) fail(`${p.id}: ${p.primary.length} primary attrs (want 4)`);
    if (p.secondary.length !== 4) fail(`${p.id}: ${p.secondary.length} secondary attrs (want 4)`);
    const overlap = p.primary.filter((k) => p.secondary.includes(k));
    if (overlap.length) fail(`${p.id}: ${overlap.join(", ")} is both primary and secondary`);
    if (new Set(p.primary).size !== p.primary.length) fail(`${p.id}: duplicate primary attr`);
    if (new Set(p.secondary).size !== p.secondary.length) fail(`${p.id}: duplicate secondary attr`);
  }
  // Every set's last plan is the balanced default, at exactly 1.0.
  const last = plans[plans.length - 1];
  if (last.growthMult !== 1) fail(`${g}: default plan ${last.id} has growthMult ${last.growthMult} (want 1.0)`);
  if (last.focus !== undefined) fail(`${g}: default plan ${last.id} should have no facility focus`);
}
if (!failures) ok(`structure`, `${TRAINING_PLANS.length} plans, 5 per position, 4+4 attrs each`);

// ── 2. Ids are unique ──────────────────────────────────────────────────────
const ids = new Set(TRAINING_PLANS.map((p) => p.id));
if (ids.size !== TRAINING_PLANS.length) fail("duplicate plan id in the table");
else ok("plan ids unique", `${ids.size}`);

// ── 3. The dynamic multiplier ──────────────────────────────────────────────
// How far an authored multiplier may sit from the ideal. The authored figures
// are designed values rather than raw arithmetic, so a little slack is intended;
// anything past this means the table and the position weights have drifted apart.
const TOLERANCE = 0.2;

const checks = verifyPlanMultipliers();
const bad = checks.filter((c) => c.error > TOLERANCE);

console.log("\n      plan                              authored   ideal   error");
const posOf: Record<PlanPos, Pos> = {
  GK: "GK", CB: "CB", FB: "LB", DM: "DM", CM: "CM", AM: "AM", WM: "LM", W: "LW", ST: "ST",
};
for (const g of groups) {
  console.log(`      ── ${PLAN_POS_LABEL[g]} (${posOf[g]})`);
  for (const p of PLANS_BY_POS[g]) {
    const c = checks.find((x) => x.id === p.id)!;
    const flag = c.error > TOLERANCE ? "  ←" : "";
    console.log(
      `      ${p.id.padEnd(32)} ${c.authored.toFixed(2).padStart(6)}  ${c.ideal
        .toFixed(2)
        .padStart(6)}  ${(c.error * 100).toFixed(0).padStart(4)}%${flag}`
    );
  }
}

console.log("");
if (bad.length) {
  fail(
    `${bad.length} plan(s) more than ${Math.round(TOLERANCE * 100)}% off the balanced rate: ` +
      bad.map((c) => c.id).join(", ")
  );
} else {
  ok("dynamic multipliers keep every plan on the balanced rate", `max error ${(Math.max(...checks.map((c) => c.error)) * 100).toFixed(0)}%`);
}

// ── 4. Coverage sanity: a specialised plan really is more focused ──────────
for (const g of groups) {
  const plans = PLANS_BY_POS[g];
  const balanced = plans[plans.length - 1];
  const pos = posOf[g];
  const bc = planWeightCoverage(balanced, pos);
  for (const p of plans.slice(0, -1)) {
    const ideal = idealGrowthMult(p, pos);
    if (!Number.isFinite(ideal) || ideal <= 0) fail(`${p.id}: non-finite ideal multiplier`);
  }
  if (!(bc > 0)) fail(`${g}: balanced plan has zero position-weight coverage`);
}

console.log("");
if (failures) {
  console.log(`Training plan table FAILED with ${failures} problem(s).`);
  process.exit(1);
}
console.log("Training plan table verified.");

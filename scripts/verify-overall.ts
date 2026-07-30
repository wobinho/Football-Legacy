// Verifies the 35-attribute overall model (lib/config/positions.ts) against the
// shipped source roster. Run: npx tsx scripts/verify-overall.ts
//
// The model is a per-position weighted sum of the 35 attributes plus an additive
// constant. There is no independent "expected overall" to compare against — the
// source CSV has no overall column, the rating is fully derived — so the checks
// here are about the model's INTERNAL consistency and its output distribution:
//
//   1. Every weight row names only real attributes (a typo would silently drop
//      a term from the model, which nothing else would catch).
//   2. Every row sums to ~1.0, so a row behaves as a weighted mean and a uniform
//      shift of +δ moves the rating by ~δ. This is what makes the model
//      invertible, and it is why keepers sit on the same scale as outfielders.
//   3. fitAttrsToOverall lands on the target it is asked for.
//   4. The full roster rates in a sane band, per position — the check that would
//      have caught a whole position group reading 15 points light.

import { readFileSync, existsSync } from "node:fs";
import { overallFromAttrs, fitAttrsToOverall, ATTR_WEIGHTS, ATTR_WEIGHT_SUM } from "../lib/config/positions";
import { ATTR_KEYS, uniformAttrs } from "../lib/config/attributes";
import type { Pos, Attributes } from "../lib/types";
import { parseCsv } from "../lib/fl26/csv";
import { FORMULA_POS_TO_POS, readAttrs } from "../lib/fl26/convert";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

// 1. Every weight row names only real attributes.
const validKeys = new Set<string>(ATTR_KEYS);
for (const [pos, w] of Object.entries(ATTR_WEIGHTS)) {
  const unknown = Object.keys(w).filter((k) => !validKeys.has(k));
  check(`weight keys ${pos}`, unknown.length === 0, unknown.length ? `unknown: ${unknown.join(", ")}` : "");
}

// 2. Every row sums to ~1.0. The published coefficients are quoted to 4dp and
// fitted independently per position, so they don't land on exactly 1 — but a row
// that drifts far from it would be a missing or duplicated term.
for (const pos of Object.keys(ATTR_WEIGHTS) as Pos[]) {
  const sum = ATTR_WEIGHT_SUM[pos];
  check(`weights sum ${pos}`, Math.abs(sum - 1) < 0.05, sum.toFixed(4));
}

// 3. A uniform attribute line rates approximately its own value (the direct
// consequence of the rows summing to 1), and fitAttrsToOverall hits its target.
for (const pos of Object.keys(ATTR_WEIGHTS) as Pos[]) {
  const flat = overallFromAttrs(uniformAttrs(70), pos);
  check(`uniform 70 → ~70 at ${pos}`, Math.abs(flat - 70) <= 3, `got ${flat}`);
}

const base: Attributes = uniformAttrs(68);
for (const pos of Object.keys(ATTR_WEIGHTS) as Pos[]) {
  const from = overallFromAttrs(base, pos);
  for (const target of [from - 12, from, from + 12]) {
    const got = overallFromAttrs(fitAttrsToOverall(base, pos, target), pos);
    check(`fit ${pos} ${from}→${target}`, Math.abs(got - target) <= 1, `got ${got}`);
  }
}

// 4. The whole source roster: distribution sanity, overall and per position.
const CSV = "fl26_players_new.csv";
if (existsSync(CSV)) {
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  const byPos = new Map<Pos, number[]>();
  const all: number[] = [];
  let skipped = 0;

  for (const r of rows) {
    const pos = FORMULA_POS_TO_POS[r.position?.trim().toUpperCase()];
    if (!pos) continue;
    const attrs = readAttrs(r);
    if (!attrs) {
      skipped++;
      continue;
    }
    const ovr = overallFromAttrs(attrs, pos);
    all.push(ovr);
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos)!.push(ovr);
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  check("roster parsed", skipped === 0, skipped ? `${skipped} rows had unreadable attributes` : `${all.length} players`);

  const overallMean = mean(all);
  check("roster mean in 58–72", overallMean >= 58 && overallMean <= 72, overallMean.toFixed(2));
  check("roster max in 85–99", Math.max(...all) >= 85 && Math.max(...all) <= 99, String(Math.max(...all)));

  console.log("\n  position   n     mean   max");
  for (const pos of [...byPos.keys()].sort()) {
    const xs = byPos.get(pos)!;
    console.log(`  ${pos.padEnd(9)} ${String(xs.length).padStart(5)}  ${mean(xs).toFixed(1).padStart(5)}  ${String(Math.max(...xs)).padStart(4)}`);
  }
  console.log();

  // No position group may sit far off the rest — this is the check that catches
  // a mis-transcribed weight row (a missing large term reads as a whole position
  // rating light, which is invisible in the global mean).
  for (const [pos, xs] of byPos) {
    const m = mean(xs);
    check(`${pos} mean within 8 of roster mean`, Math.abs(m - overallMean) <= 8, `${m.toFixed(1)} vs ${overallMean.toFixed(1)}`);
    const top = Math.max(...xs);
    check(`${pos} has a credible best player`, top >= 80, `best ${top}`);
  }
} else {
  console.log(`(skipped roster checks — ${CSV} not in the tree)`);
}

console.log(failures === 0 ? "\nAll overall-model checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

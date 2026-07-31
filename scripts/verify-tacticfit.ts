// Does tactical fit actually reward suiting your instructions to your squad?
//
// Builds two archetypal squads — one of technical passers, one of quick,
// aggressive runners — and plays each of them under every style, against a
// neutral opponent. The passing squad should do best on Possession and worst on
// Counter/Direct; the running squad the reverse.
//
// This is a DIRECTIONAL check, not a balance one: `npm run calibrate` owns the
// goals-per-match and home-win targets. What's verified here is that the setup
// choice is legible in the results at all — a system that changed nothing would
// show every style scoring the same.
//
// Run: npx tsx scripts/verify-tacticfit.ts

import { simulateMatch, type EnginePlayer, type SideInput } from "../lib/engine/match";
import { TUNING } from "../lib/config/tuning";
import { getFormation } from "../lib/config/formations";
import { uniformAttrs } from "../lib/config/attributes";
import { STYLE_OPTIONS } from "../lib/config/formations";
import { fitMultiplier, tacticDemands, type FitPlayer } from "../lib/config/tacticfit";
import type { Attributes, Style } from "../lib/types";

const FORMATION = "442";
const OVERALL = 75;

/** A squad whose attributes are tilted toward `strong` and away from `weak`. */
function squad(label: string, strong: (keyof Attributes)[], weak: (keyof Attributes)[]): EnginePlayer[] {
  const slots = getFormation(FORMATION).slots;
  return slots.map((s, i) => {
    const attrs = uniformAttrs(OVERALL);
    for (const k of strong) attrs[k] = Math.min(99, OVERALL + 12);
    for (const k of weak) attrs[k] = Math.max(1, OVERALL - 12);
    return {
      id: `${label}${i}`,
      name: `${label} ${i}`,
      overall: OVERALL,
      positions: [s.pos],
      archetypeId: "",
      traits: [],
      form: 1,
      fitness: 100,
      age: 26,
      attrs,
    } satisfies EnginePlayer;
  });
}

const PASSERS = squad("P", ["shortPassing", "ballControl", "composure", "vision", "longPassing"], ["sprintSpeed", "acceleration", "aggression", "stamina"]);
const RUNNERS = squad("R", ["sprintSpeed", "acceleration", "aggression", "stamina", "interceptions"], ["shortPassing", "ballControl", "composure", "vision"]);
const NEUTRAL = squad("N", [], []);

function side(name: string, players: EnginePlayer[], style: Style): SideInput {
  const slots = getFormation(FORMATION).slots;
  return {
    teamId: name,
    name,
    short: name.slice(0, 3).toUpperCase(),
    lineup: slots.map((s, i) => ({ slotPos: s.pos, player: players[i] })),
    bench: [],
    tactic: { formationId: FORMATION, mentality: "Balanced", style },
  };
}

const N = 600;

function run(players: EnginePlayer[], style: Style): { gf: number; ga: number; pts: number } {
  let gf = 0, ga = 0, pts = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(
      side("Test", players, style),
      side("Neutral", NEUTRAL, "Possession"),
      TUNING,
      1000 + i
    );
    gf += r.homeGoals;
    ga += r.awayGoals;
    pts += r.homeGoals > r.awayGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0;
  }
  return { gf: gf / N, ga: ga / N, pts: pts / N };
}

let failures = 0;

for (const [label, players, expectBest, expectWorst] of [
  ["Passing squad", PASSERS, "Possession", "Counter"],
  ["Running squad", RUNNERS, "Counter", "Possession"],
] as const) {
  console.log(`\n── ${label} (vs a neutral side) ──`);
  const rows = STYLE_OPTIONS.map((style) => {
    const demands = tacticDemands({ mentality: "Balanced", style });
    const fit: FitPlayer[] = players.map((p) => ({ overall: p.overall, attrs: p.attrs! }));
    const mids = fitMultiplier(fit, demands, "midfield");
    const atk = fitMultiplier(fit, demands, "attack");
    const def = fitMultiplier(fit, demands, "defense");
    const r = run(players, style);
    return { style, ...r, atk, mids, def };
  });
  rows.sort((a, b) => b.pts - a.pts);
  console.log("      style        pts/g   gf    ga   | fit atk  mid  def");
  for (const r of rows) {
    console.log(
      `      ${r.style.padEnd(12)} ${r.pts.toFixed(2)}  ${r.gf.toFixed(2)}  ${r.ga.toFixed(2)}  |  ` +
        `${r.atk.toFixed(3)} ${r.mids.toFixed(3)} ${r.def.toFixed(3)}`
    );
  }
  // Check the FIT multipliers themselves, not the raw points.
  //
  // Points can't be compared across styles: each style carries its own intrinsic
  // shape (`styleShape`) and its own row in the counter matrix, and against a
  // fixed Possession opponent those effects are far larger than the ±8% fit
  // swing — Counter out-points Possession for any squad, because Counter beats
  // Possession. That is the design working, not fit failing.
  //
  // What fit promises is narrower and is what's asserted: for the style this
  // squad is built for, its multipliers are favourable; for the style it is
  // ill-suited to, they are not. The cross-squad comparison below is the real
  // test — the SAME style must treat the two squads differently.
  const best = rows.find((r) => r.style === expectBest)!;
  const worst = rows.find((r) => r.style === expectWorst)!;
  const edge = (r: typeof best) => r.atk * r.mids * r.def;
  if (edge(best) > edge(worst)) {
    console.log(
      `OK    fit favours ${expectBest} (×${edge(best).toFixed(3)}) over ${expectWorst} (×${edge(worst).toFixed(3)})`
    );
  } else {
    console.log(
      `FAIL  fit did not favour ${expectBest} (×${edge(best).toFixed(3)}) over ${expectWorst} (×${edge(worst).toFixed(3)})`
    );
    failures++;
  }
}

// ── The decisive check: same style, two different squads ──────────────────
// Holding the style fixed removes styleShape and the counter matrix from the
// comparison entirely, so any difference left is tactical fit and nothing else.
console.log("\n── Same style, different squads ──");
for (const [style, better, worse] of [
  ["Possession", "Passing", "Running"],
  ["Counter", "Running", "Passing"],
  ["Gegenpress", "Running", "Passing"],
] as const) {
  const pass = run(PASSERS, style as Style);
  const runr = run(RUNNERS, style as Style);
  const pts = { Passing: pass.pts, Running: runr.pts };
  console.log(
    `      ${style.padEnd(12)} passing ${pass.pts.toFixed(2)} pts/g · running ${runr.pts.toFixed(2)} pts/g`
  );
  if (pts[better] > pts[worse]) {
    console.log(`OK    ${style}: the ${better.toLowerCase()} squad outperforms the ${worse.toLowerCase()} one`);
  } else {
    console.log(`FAIL  ${style}: the ${better.toLowerCase()} squad did not outperform the ${worse.toLowerCase()} one`);
    failures++;
  }
}

console.log("");
if (failures) {
  console.log(`Tactical fit FAILED ${failures} check(s).`);
  process.exit(1);
}
console.log("Tactical fit verified — a setup that suits the squad measurably outperforms one that doesn't.");

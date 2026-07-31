// Is the archetype ⇄ tactics system fair? (§5, v1.78)
//
// Two identity layers feed the match engine: a class's STYLE synergy and an
// archetype's INSTRUCTION fit. Both are hand-authored tables, and hand-authored
// tables go quietly wrong — the pre-v1.78 style row had Engine worth +45 across
// the six styles against Creator's +15, and Maverick as the best pick for no
// style at all. Nobody noticed for four versions because nothing checked.
//
// This is that check. Part A is pure table arithmetic and runs instantly; it is
// the one that would have caught every historical bug. Part B simulates, and
// proves the tables actually reach the match engine.
//
// Run: npm run verify:archetypes:tactics

import {
  ARCHETYPE_CLASS_ORDER,
  ARCHETYPE_PROFILE,
  ARCHETYPE_ROSTER,
  archetypesForPosition,
  instructionFitScore,
  profileForAttrs,
  profileOf,
  shapeAttrsToArchetype,
  deriveArchetype,
  type ArchetypeClass,
  type InstructionPrefs,
  type InstructionView,
} from "../lib/config/archetype";
import { getFormation } from "../lib/config/formations";
import { simulateMatch, type EnginePlayer, type SideInput } from "../lib/engine/match";
import { TUNING } from "../lib/config/tuning";
import type { DefLine, Focus, Pos, Press, Style, Tempo, Width } from "../lib/types";

const STYLES: Style[] = ["Possession", "Counter", "Direct", "Gegenpress", "ParkTheBus", "WingPlay"];
const TEMPOS: Tempo[] = ["Slow", "Standard", "High"];
const WIDTHS: Width[] = ["Narrow", "Standard", "Wide"];
const PRESSES: Press[] = ["Low", "Medium", "High"];
const LINES: DefLine[] = ["Deep", "Standard", "High"];
const FOCI: Focus[] = ["Left", "Central", "Right", "Wide", "Mixed"];
const ALL_POS: Pos[] = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "ST"];

/** Every reachable instruction setup — 3×3×3×3×5 = 405. Small enough to score
 * exhaustively, which is what makes the fairness claims exact rather than
 * sampled. */
const SETUPS: InstructionView[] = [];
for (const tempo of TEMPOS)
  for (const width of WIDTHS)
    for (const press of PRESSES)
      for (const line of LINES) for (const focus of FOCI) SETUPS.push({ tempo, width, press, line, focus });

let failures = 0;
function check(ok: boolean, label: string, detail?: string) {
  if (ok) {
    console.log(`  OK    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** The style row as the engine sees it, recovered from the resolved profiles so
 * this script tests what actually ships rather than a copy of the table. */
function synergyPct(cls: ArchetypeClass, style: Style): number {
  const a = ARCHETYPE_ROSTER.find((x) => x.cls === cls)!;
  return Math.round((profileOf(a).styleSynergy[style] - 1) * 100);
}
const prefsOf = (id: string): InstructionPrefs => ARCHETYPE_PROFILE[id].instructionPrefs;

console.log("── Part A: table fairness ──────────────────────────────────────\n");

// A1 ── Rows sum to zero. No class is worth more than another for existing.
console.log("A1. Style rows sum to zero");
for (const cls of ARCHETYPE_CLASS_ORDER) {
  const sum = STYLES.reduce((s, st) => s + synergyPct(cls, st), 0);
  check(Math.abs(sum) <= 1, `${cls} sums to ${sum}`);
}

// A2 ── Every class strictly wins a style, or nobody builds around it.
console.log("\nA2. Every class is the strict best at >=1 style");
for (const cls of ARCHETYPE_CLASS_ORDER) {
  const owned = STYLES.filter((st) =>
    ARCHETYPE_CLASS_ORDER.every((o) => o === cls || synergyPct(o, st) < synergyPct(cls, st))
  );
  check(owned.length >= 1, `${cls} owns [${owned.join(", ") || "NOTHING"}]`);
}

// A3 ── No class is dominated.
console.log("\nA3. No class dominated");
{
  let dom = 0;
  for (const a of ARCHETYPE_CLASS_ORDER)
    for (const b of ARCHETYPE_CLASS_ORDER) {
      if (a === b) continue;
      const ge = STYLES.every((st) => synergyPct(b, st) >= synergyPct(a, st));
      const gt = STYLES.some((st) => synergyPct(b, st) > synergyPct(a, st));
      if (ge && gt) {
        check(false, `${a} is dominated by ${b}`);
        dom++;
      }
    }
  if (!dom) check(true, "all ten class pairs incomparable");
}

// A4 ── Band inside synergyCap, or the authored value is silently clipped.
console.log("\nA4. Style band within synergyCap");
{
  const band = Math.max(
    ...ARCHETYPE_CLASS_ORDER.flatMap((c) => STYLES.map((s) => Math.abs(synergyPct(c, s))))
  );
  check(band <= TUNING.synergyCap * 100, `max |value| ${band} <= cap ${TUNING.synergyCap * 100}`);
}

// A5 ── The balance rule: every named axis needs a like AND a dislike.
console.log("\nA5. Instruction rows balanced (every named axis has like + dislike)");
{
  let bad = 0;
  for (const a of ARCHETYPE_ROSTER) {
    for (const [axis, p] of Object.entries(prefsOf(a.id)) as [string, { likes?: string[]; dislikes?: string[] }][]) {
      if (!p.likes?.length || !p.dislikes?.length) {
        check(false, `${a.name}.${axis} is one-sided`);
        bad++;
      }
    }
  }
  if (!bad) check(true, `all ${ARCHETYPE_ROSTER.length} rows balanced`);
}

// A6 ── The consequence: mean score exactly 0 over the whole space. This is the
// fairness guarantee — no archetype gains from the system merely by existing.
console.log("\nA6. Instruction fit is symmetric (mean 0, %positive == %negative)");
{
  let bad = 0;
  for (const a of ARCHETYPE_ROSTER) {
    const scores = SETUPS.map((t) => instructionFitScore(prefsOf(a.id), t));
    const mean = scores.reduce((x, y) => x + y, 0) / scores.length;
    const pos = scores.filter((v) => v > 0).length;
    const neg = scores.filter((v) => v < 0).length;
    if (Math.abs(mean) > 1e-9 || pos !== neg) {
      check(false, `${a.name} mean ${mean.toFixed(4)}, +${pos}/-${neg}`);
      bad++;
    }
  }
  if (!bad) check(true, `all ${ARCHETYPE_ROSTER.length} rows mean exactly 0 over ${SETUPS.length} setups`);
}

// A7 ── Nothing bland. An archetype with no preferences is invisible to the
// dials, which is the failure mode this whole layer exists to prevent.
console.log("\nA7. No archetype is inert or bland");
{
  let bad = 0;
  for (const a of ARCHETYPE_ROSTER) {
    const axes = Object.keys(prefsOf(a.id)).length;
    const zero = SETUPS.filter((t) => instructionFitScore(prefsOf(a.id), t) === 0).length / SETUPS.length;
    if (axes === 0) {
      check(false, `${a.name} has NO instruction preferences`);
      bad++;
    } else if (zero > 0.45) {
      check(false, `${a.name} is neutral on ${(zero * 100).toFixed(0)}% of setups`);
      bad++;
    }
  }
  if (!bad) check(true, "every archetype names >=1 axis and reacts on >55% of setups");
}

// A8 ── Equal reach. Every archetype must be able to swing the same amount, or
// the ones that can't are quietly weaker.
console.log("\nA8. Every archetype has the same reachable swing");
{
  const swings = ARCHETYPE_ROSTER.map((a) => {
    const sc = SETUPS.map((t) => instructionFitScore(prefsOf(a.id), t));
    return { a, span: Math.max(...sc) - Math.min(...sc) };
  });
  const lo = Math.min(...swings.map((s) => s.span));
  const hi = Math.max(...swings.map((s) => s.span));
  check(
    hi - lo <= 0.5,
    `reachable span ${lo.toFixed(2)}..${hi.toFixed(2)}`,
    swings.filter((s) => s.span === lo).map((s) => s.a.name).join(", ")
  );
}

// A9 ── Squad-buildability. The check no table-only inspection can make: the
// classes reachable at a position are fixed by the ROSTER, so a table can pass
// A1-A4 and still leave every striker in the game on negative synergy.
console.log("\nA9. Every (style, position) has a non-negative option");
{
  const dead: string[] = [];
  for (const st of STYLES)
    for (const pos of ALL_POS) {
      const best = Math.max(...archetypesForPosition(pos).map((a) => synergyPct(a.cls, st)));
      if (best < 0) dead.push(`${st}/${pos} (best ${best})`);
    }
  check(dead.length === 0, `all ${STYLES.length * ALL_POS.length} cells buildable`, dead.join(", "));
}

// A10 ── Two archetypes sharing a row AND a position are indistinguishable to a
// manager. Sharing a row across positions is fine — nobody picks between a
// goalkeeper and a centre back.
console.log("\nA10. No two archetypes share a row at the same position");
{
  const clash: string[] = [];
  for (const pos of ALL_POS) {
    const here = archetypesForPosition(pos);
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++) {
        if (JSON.stringify(prefsOf(here[i].id)) === JSON.stringify(prefsOf(here[j].id))) {
          clash.push(`${here[i].name}/${here[j].name} at ${pos}`);
        }
      }
  }
  check(clash.length === 0, "every same-position pair is distinguishable", clash.join(", "));
}

// A11 ── Defect D regression: Width and Focus were read by no class row at all
// before v1.78, so two of the five dials did nothing for identity.
console.log("\nA11. Every dial axis is reachable");
for (const axis of ["tempo", "width", "press", "line", "focus"] as const) {
  const users = ARCHETYPE_ROSTER.filter((a) => prefsOf(a.id)[axis]);
  const likes = new Set(users.flatMap((a) => prefsOf(a.id)[axis]?.likes ?? []));
  const dislikes = new Set(users.flatMap((a) => prefsOf(a.id)[axis]?.dislikes ?? []));
  check(
    users.length >= 3 && likes.size >= 1 && dislikes.size >= 1,
    `${axis}: ${users.length} archetypes, likes {${[...likes].join(",")}}, dislikes {${[...dislikes].join(",")}}`
  );
}

// A12 ── The guard against this table drifting into a copy of tacticfit.ts.
console.log("\nA12. No instruction row names anything but a dial setting");
{
  const legal: Record<string, string[]> = {
    tempo: TEMPOS, width: WIDTHS, press: PRESSES, line: LINES, focus: FOCI,
  };
  const bad: string[] = [];
  for (const a of ARCHETYPE_ROSTER)
    for (const [axis, p] of Object.entries(prefsOf(a.id)) as [string, { likes?: string[]; dislikes?: string[] }][]) {
      if (!legal[axis]) { bad.push(`${a.name}.${axis} is not a dial`); continue; }
      for (const v of [...(p.likes ?? []), ...(p.dislikes ?? [])])
        if (!legal[axis].includes(v)) bad.push(`${a.name}.${axis} = "${v}"`);
    }
  check(bad.length === 0, "instruction tables name only dial settings", bad.join(", "));
}

console.log("\n── Part B: it reaches the match engine ─────────────────────────\n");

const OVERALL = 75;
const N = 400;

/**
 * An XI shaped toward one archetype wherever that archetype can actually be
 * earned, and toward the position's default everywhere else.
 *
 * `shapeAttrsToArchetype` silently falls back to the position's first plan when
 * the plan named isn't valid there — a WM plan asked for at CB is not an error,
 * it just isn't that role. That fallback made an earlier version of B3 build a
 * "Provider XI" containing no Providers at all (the 4-3-3 has no LM/RM slots),
 * and the assertion then measured nothing. `targetSlots` is returned so the
 * caller can assert the squad genuinely contains the archetype under test.
 */
function squadOf(
  planId: string,
  archetypeId: string,
  formationId: string,
  label: string
): { players: EnginePlayer[]; targetSlots: number } {
  const slots = getFormation(formationId).slots;
  let targetSlots = 0;
  const players = slots.map((s, i) => {
    const attrs = shapeAttrsToArchetype(s.pos, s.pos === "GK" ? undefined : planId, OVERALL);
    if (deriveArchetype(attrs, s.pos)?.id === archetypeId) targetSlots++;
    return {
      id: `${label}${i}`,
      name: `${label} ${i}`,
      overall: OVERALL,
      positions: [s.pos],
      traits: [],
      form: 1,
      fitness: 100,
      age: 26,
      attrs,
    };
  });
  return { players, targetSlots };
}

function side(
  id: string, players: EnginePlayer[], formationId: string, style: Style, view: Partial<InstructionView>
): SideInput {
  const slots = getFormation(formationId).slots;
  return {
    teamId: id, name: id, short: id.slice(0, 3),
    lineup: slots.map((s, i) => ({ slotId: s.id, slotPos: s.pos, player: players[i] })),
    bench: [],
    tactic: { formationId, mentality: "Balanced", style, ...view },
  };
}

function play(a: SideInput, b: SideInput): { pts: number; gf: number; ga: number } {
  let pts = 0, gf = 0, ga = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(a, b, TUNING, 5000 + i);
    gf += r.homeGoals; ga += r.awayGoals;
    pts += r.homeGoals > r.awayGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0;
  }
  return { pts, gf, ga };
}

// B1 ── The headline claim: same class, same position, opposite instructions.
// If this fails the redesign has not achieved the thing it was built for.
console.log("B1. Sniper and Ram diverge (both Maverick strikers)");
{
  const sniperAttrs = shapeAttrsToArchetype("ST", "st_poacher", OVERALL);
  const ramAttrs = shapeAttrsToArchetype("ST", "st_targetman", OVERALL);
  check(
    deriveArchetype(sniperAttrs, "ST")?.id === "sniper",
    `a shaped st_poacher line reads as Sniper (got ${deriveArchetype(sniperAttrs, "ST")?.name})`
  );
  check(
    deriveArchetype(ramAttrs, "ST")?.id === "battering_ram",
    `a shaped st_targetman line reads as Ram (got ${deriveArchetype(ramAttrs, "ST")?.name})`
  );

  const sniperSetup = { tempo: "High", width: "Narrow", line: "High", focus: "Central" } as const;
  const ramSetup = { tempo: "Slow", width: "Wide", line: "Deep", focus: "Central" } as const;
  const s = instructionFitScore(prefsOf("sniper"), { press: "Medium", ...sniperSetup });
  const r = instructionFitScore(prefsOf("battering_ram"), { press: "Medium", ...sniperSetup });
  check(s > 0 && r < 0, `on the Sniper's setup: Sniper ${s.toFixed(2)}, Ram ${r.toFixed(2)}`);

  const s2 = instructionFitScore(prefsOf("sniper"), { press: "Medium", ...ramSetup });
  const r2 = instructionFitScore(prefsOf("battering_ram"), { press: "Medium", ...ramSetup });
  check(s2 < 0 && r2 > 0, `on the Ram's setup: Sniper ${s2.toFixed(2)}, Ram ${r2.toFixed(2)}`);

  let agree = 0;
  for (const t of SETUPS)
    if (Math.sign(instructionFitScore(prefsOf("sniper"), t)) === Math.sign(instructionFitScore(prefsOf("battering_ram"), t)))
      agree++;
  const pct = (agree / SETUPS.length) * 100;
  check(pct < 40, `they agree in sign on only ${pct.toFixed(0)}% of setups`);
}

// B2 ── Style synergy reaches the engine. Asserted on the MULTIPLIER, not on
// points: `styleShape` and the counter matrix dwarf a ±15% synergy band, so
// cross-style point comparisons are confounded (see verify-tacticfit.ts:105).
console.log("\nB2. Each class's best-synergy style matches its table column");
for (const cls of ARCHETYPE_CLASS_ORDER) {
  const a = ARCHETYPE_ROSTER.find((x) => x.cls === cls)!;
  const best = STYLES.reduce((x, y) =>
    profileOf(a).styleSynergy[y] > profileOf(a).styleSynergy[x] ? y : x
  );
  const owned = STYLES.filter((st) =>
    ARCHETYPE_CLASS_ORDER.every((o) => o === cls || synergyPct(o, st) < synergyPct(cls, st))
  );
  check(owned.includes(best), `${cls}: engine-best "${best}", table-owned [${owned.join(", ")}]`);
}

// B3 ── Defect D end-to-end: under the old system no class row read Width at
// all, so this assertion could not have passed.
console.log("\nB3. Width and Focus actually change a result");
{
  // A 4-4-2, because it is the shape that actually fields LM/RM — the wide
  // midfield roles are where Width and Focus live.
  const F = "442";
  const wide = squadOf("wm_winger", "provider", F, "W"); // Provider — wants Wide/Wide
  const narrow = squadOf("fb_inverted", "constructor", F, "N"); // Constructor — Narrow/Central
  const opp = squadOf("cm_balanced", "engine_room", F, "O");

  check(wide.targetSlots >= 2, `the "Provider" XI contains ${wide.targetSlots} actual Providers`);
  check(narrow.targetSlots >= 2, `the "Constructor" XI contains ${narrow.targetSlots} actual Constructors`);

  // Isolating the archetype layer here needs care, and two confounds must both
  // be held off:
  //
  //  1. Comparing ONE squad across two widths measures `widthWideMult` /
  //     `widthCentralMult` (up to 18% on every player), which dwarfs the ±6%
  //     instruction lever. Same trap verify-tacticfit.ts:105-116 documents.
  //  2. Comparing TWO squads under one setup measures their class STYLE synergy
  //     — the Provider XI is Maverick-heavy and the Constructor XI is all
  //     Creator, so any style at all separates them before identity does.
  //
  // The difference-in-differences cancels both: measure each squad's swing
  // between the two setups, and assert the swings go in OPPOSITE directions.
  // Every team-level width term is common to both squads and subtracts out;
  // style synergy is constant within each squad and subtracts out too. What is
  // left is only what the instruction rows say.
  const wideSetup = { width: "Wide", focus: "Wide" } as const;
  const narrowSetup = { width: "Narrow", focus: "Central" } as const;

  const pWide = play(side("W", wide.players, F, "Possession", wideSetup), side("O", opp.players, F, "Possession", {}));
  const pNarrow = play(side("W", wide.players, F, "Possession", narrowSetup), side("O", opp.players, F, "Possession", {}));
  const cWide = play(side("N", narrow.players, F, "Possession", wideSetup), side("O", opp.players, F, "Possession", {}));
  const cNarrow = play(side("N", narrow.players, F, "Possession", narrowSetup), side("O", opp.players, F, "Possession", {}));

  const providerSwing = pWide.pts - pNarrow.pts;
  const constructorSwing = cWide.pts - cNarrow.pts;
  check(
    providerSwing > constructorSwing,
    `wide-minus-narrow swing: Provider XI ${providerSwing >= 0 ? "+" : ""}${providerSwing}pts, ` +
      `Constructor XI ${constructorSwing >= 0 ? "+" : ""}${constructorSwing}pts`,
    "the Provider XI must gain more (or lose less) from going wide than the Constructor XI does"
  );

  // And the same claim on the raw scores, which is what the engine actually
  // multiplies — immune to match-result noise entirely.
  const fitOf = (players: EnginePlayer[], v: InstructionView) =>
    players.reduce(
      (s, p) => s + instructionFitScore(profileForAttrs(p.attrs!, p.positions[0]).instructionPrefs, v),
      0
    );
  const base = { tempo: "Standard", press: "Medium", line: "Standard" } as const;
  const pw = fitOf(wide.players, { ...base, ...wideSetup });
  const pn = fitOf(wide.players, { ...base, ...narrowSetup });
  const cw = fitOf(narrow.players, { ...base, ...wideSetup });
  const cn = fitOf(narrow.players, { ...base, ...narrowSetup });
  check(pw > pn, `Provider XI instruction fit: wide ${pw.toFixed(2)} > narrow ${pn.toFixed(2)}`);
  check(cn > cw, `Constructor XI instruction fit: narrow ${cn.toFixed(2)} > wide ${cw.toFixed(2)}`);
}

console.log(`\n${"─".repeat(64)}`);
if (failures === 0) {
  console.log("All archetype ⇄ tactics checks passed.");
} else {
  console.log(`${failures} check(s) FAILED.`);
}
process.exit(failures === 0 ? 0 : 1);

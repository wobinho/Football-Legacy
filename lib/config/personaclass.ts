// ── Persona class → tactical effect (§5, v1.73) ────────────────────────────
//
// `personas.ts` decides WHO a player is; this decides what that is worth to the
// side. Each player on the pitch contributes a flat step to his class's favoured
// styles and instructions, and against the ones his class clashes with. The
// contributions are cumulative — five Engines are worth five times one Engine —
// and the total is then capped.
//
// ── The math rule (as designed) ───────────────────────────────────────────
//   +2% to a favoured STYLE OF PLAY, per player of the class
//   +3% to a favoured ADVANCED INSTRUCTION, per player
//   −3% against a CLASHING advanced instruction, per player
//
// ── Where the effects land ────────────────────────────────────────────────
// Every effect names an existing engine quantity, so nothing new has to be
// invented in the match model:
//
//   styleEffect  → the side's style effectiveness (rides with archetype synergy)
//   midfield     → share of the ball, and so chance volume
//   defense      → defensive solidity
//   oppChance    → chances the OPPONENT generates
//   chances      → chances this side creates
//   fitnessDrain → the side's own fitness cost
//
// The design's "+5% Pass Completion" for Slow Tempo has no counterpart in this
// engine — there is no pass model, chances come from Poisson lambdas — so it
// routes to `midfield`, which is the quantity that actually represents keeping
// and using the ball. That substitution was made explicitly in design.
//
// ── Capping ───────────────────────────────────────────────────────────────
// `TUNING.personaClassCap` bounds each accumulated quantity. Eleven players of
// one class would otherwise contribute +22% style effectiveness on top of the
// archetype synergy band, which destabilises the chance model — the cap is the
// engine constraint the design asks for. Calibration is the check on all of it.
//
// Pure data plus one accumulation pass. Nothing here names a persona; the engine
// never names a class. Both read tables.

import type { DefLine, Mentality, Press, Style, Tempo } from "../types";
import type { PersonaClass } from "./personas";
import { emptyClassCount } from "./personas";

/** The engine quantities a class contribution can move. */
export type ClassEffectKey =
  | "styleEffect"
  | "midfield"
  | "defense"
  | "oppChance"
  | "chances"
  | "fitnessDrain";

/**
 * A class's contribution, as multiples of the per-player steps in tuning.
 *
 * `styleSteps` is in units of `personaStyleStep` (+2%); everything in `effects`
 * is in units of `personaBoostStep` / `personaClashStep` (±3%). Authoring in
 * STEPS rather than raw percentages means the design's math rule lives in one
 * place — retuning the steps retunes every class at once.
 */
interface ClassSpec {
  /** Styles this class makes the side better at, at +1 style step per player. */
  favoredStyles: Style[];
  /** Instruction-conditional effects. Each row fires only when the side's own
   * instructions match, and contributes `steps` × the boost/clash step. */
  effects: ClassEffectRow[];
}

interface ClassEffectRow {
  /** Which quantity moves. */
  key: ClassEffectKey;
  /** Signed multiples of the ±3% step. Positive = the quantity goes up. */
  steps: number;
  /** The instruction settings that trigger this row. A row with several axes
   * fires when ANY of its listed settings is active, matching the design's
   * "High Tempo & High Press" phrasing — either instruction engages the class. */
  when: {
    mentality?: Mentality[];
    tempo?: Tempo[];
    press?: Press[];
    line?: DefLine[];
  };
}

/**
 * The four classes, exactly as designed.
 *
 * Note the sign convention: `steps` is signed by its effect on the QUANTITY, not
 * by whether it is good for the side. A Creator under a high press adds +1 step
 * of `fitnessDrain` — the number goes up, which is bad for the side. An Engine
 * under the same press adds −1 step of `fitnessDrain` — the number goes down,
 * which is good. Keeping the convention on the quantity is what lets the engine
 * apply every row identically without knowing which classes are "good".
 */
export const CLASS_SPECS: Record<PersonaClass, ClassSpec> = {
  // Playmakers. Thrive with time on the ball; exhaust when made to chase.
  Creator: {
    favoredStyles: ["Possession", "WingPlay"],
    effects: [
      // Slow tempo: they get the time on the ball they want. (The design's
      // "pass completion" → midfield control, per the note at the top.)
      { key: "midfield", steps: +1, when: { tempo: ["Slow"] } },
      // High press: technical players forced to chase, and it costs them.
      { key: "fitnessDrain", steps: +1, when: { press: ["High"] } },
    ],
  },

  // Runners. The lungs of the side; restricted by a deep line.
  Engine: {
    favoredStyles: ["Gegenpress", "WingPlay"],
    effects: [
      // High tempo and high press are what they are built for — they carry the
      // running load, so the side drains less.
      { key: "fitnessDrain", steps: -1, when: { tempo: ["High"], press: ["High"] } },
      // Sitting deep denies them the ground they want to cover.
      { key: "midfield", steps: -1, when: { line: ["Deep"] } },
    ],
  },

  // Destroyers. Excel with the play in front of them; exposed in behind.
  Enforcer: {
    favoredStyles: ["ParkTheBus", "Direct"],
    effects: [
      // A deep line and a low press put everything in front of them.
      { key: "defense", steps: +1, when: { line: ["Deep"], press: ["Low"] } },
      // A high line asks them to defend space and turn — they get caught.
      { key: "oppChance", steps: +1, when: { line: ["High"] } },
    ],
  },

  // Attackers. Thrive in fast attacks; isolated in a slow, defensive setup.
  Spearhead: {
    favoredStyles: ["Counter", "Direct"],
    effects: [
      // Attacking mentality and high tempo — chaos and quick attacks.
      { key: "chances", steps: +1, when: { mentality: ["Attacking"], tempo: ["High"] } },
      // A defensive, slow setup leaves them static and isolated.
      { key: "chances", steps: -1, when: { mentality: ["Defensive"], tempo: ["Slow"] } },
    ],
  },
};

/** The accumulated, uncapped contribution of a side's on-pitch personas. */
export type ClassEffects = Record<ClassEffectKey, number>;

function zeroEffects(): ClassEffects {
  return { styleEffect: 0, midfield: 0, defense: 0, oppChance: 0, chances: 0, fitnessDrain: 0 };
}

/** The instruction settings a class row is tested against. */
export interface ClassTacticView {
  mentality: Mentality;
  style: Style;
  tempo: Tempo;
  press: Press;
  line: DefLine;
}

/** Does this row's trigger match the side's instructions? Any listed axis
 * matching is enough — see `when`. */
function rowFires(row: ClassEffectRow, t: ClassTacticView): boolean {
  const { mentality, tempo, press, line } = row.when;
  return (
    (!!mentality && mentality.includes(t.mentality)) ||
    (!!tempo && tempo.includes(t.tempo)) ||
    (!!press && press.includes(t.press)) ||
    (!!line && line.includes(t.line))
  );
}

/** Per-player step sizes, injected so the engine's tuning config stays the only
 * place balance numbers live. */
export interface ClassSteps {
  styleStep: number;
  boostStep: number;
  clashStep: number;
  cap: number;
}

/**
 * Accumulate every on-pitch persona's class contribution into capped deltas.
 *
 * `counts` is how many players of each class are currently on the pitch — the
 * caller counts them, because only the engine knows who is still on. The result
 * is a set of signed fractional deltas (0.06 = +6%), each already clamped to
 * ±cap, ready to be applied as `1 + delta` multipliers.
 *
 * A positive `steps` uses the boost step and a negative one the clash step, so
 * the design's asymmetric +3%/−3% rule stays authorable even if the two are
 * later tuned apart.
 */
export function accumulateClassEffects(
  counts: Record<PersonaClass, number>,
  tactic: ClassTacticView,
  steps: ClassSteps
): ClassEffects {
  const out = zeroEffects();

  for (const [cls, spec] of Object.entries(CLASS_SPECS) as [PersonaClass, ClassSpec][]) {
    const n = counts[cls] ?? 0;
    if (n <= 0) continue;

    // Favoured style: +styleStep per player, only for the style being played.
    if (spec.favoredStyles.includes(tactic.style)) {
      out.styleEffect += n * steps.styleStep;
    }

    for (const row of spec.effects) {
      if (!rowFires(row, tactic)) continue;
      const step = row.steps >= 0 ? steps.boostStep : steps.clashStep;
      out[row.key] += n * row.steps * step;
    }
  }

  for (const k of Object.keys(out) as ClassEffectKey[]) {
    out[k] = Math.max(-steps.cap, Math.min(steps.cap, out[k]));
  }
  return out;
}

/** Neutral effects — for a side with no personas resolved yet, and the value the
 * engine falls back to rather than branching. */
export const NEUTRAL_CLASS_EFFECTS: ClassEffects = zeroEffects();

// ── Reporting (for the Tactics screen) ────────────────────────────────────

/** A class's presence in the current XI, for the UI's class breakdown. */
export interface ClassTallyRow {
  cls: PersonaClass;
  count: number;
}

/** Count personas by class. Exported so the UI and the engine agree on the
 * tally without either re-implementing it. */
export function tallyClasses(classes: (PersonaClass | undefined)[]): Record<PersonaClass, number> {
  const counts = emptyClassCount();
  for (const c of classes) if (c) counts[c]++;
  return counts;
}

/** Human-readable label for an effect key, for the readout. */
export const CLASS_EFFECT_LABEL: Record<ClassEffectKey, string> = {
  styleEffect: "Style effectiveness",
  midfield: "Midfield control",
  defense: "Defence",
  oppChance: "Chances conceded",
  chances: "Chances created",
  fitnessDrain: "Fitness drain",
};

/** Whether a rise in this quantity is good for the side — the UI colours by
 * this rather than by the sign, since higher drain and higher conceded chances
 * are both bad. */
export const CLASS_EFFECT_HIGHER_IS_BETTER: Record<ClassEffectKey, boolean> = {
  styleEffect: true,
  midfield: true,
  defense: true,
  oppChance: false,
  chances: true,
  fitnessDrain: false,
};

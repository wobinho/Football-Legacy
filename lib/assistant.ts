// ── Assistant Manager's tactical report (§15.3, v1.77) ────────────────────
//
// The Tactics screen used to show three separate readouts: a "Squad fit" panel
// of centred bars, a "Squad identity" stacked bar with per-class counts, and a
// line of raw arithmetic under the style picker ("per-player fit ±20% | your XI
// avg +10.9%"). All three were true, none was advice, and together they filled
// the right-hand column with numbers the player had to synthesise themselves.
//
// This module does the synthesis. It takes the same inputs the engine reads and
// returns ONE grade plus a short list of plain-language notes — what an
// assistant manager would actually say if you asked him whether the plan suits
// the squad. The underlying numbers are still available (each note carries the
// figure that produced it, for the tooltip) but they are no longer the headline.
//
// Everything here is derived from the same functions the match engine calls —
// `tacticFitReport`, `deriveArchetype`, `instructionFitScore` — so the report
// can never claim something the simulation won't do. Pure and deterministic:
// same XI plus same instructions always gives the same report.

import type { PlayerBio, Pos, Style, Tactic } from "./types";
import {
  archetypesForPosition,
  deriveArchetype,
  describePrefs,
  emptyClassCount,
  instructionFitScore,
  profileForAttrs,
  profileOf,
  tallyClasses,
  ARCHETYPE_CLASS_ORDER,
  CLASS_FAVORED_STYLES,
  type Archetype,
  type ArchetypeClass,
  type InstructionPrefs,
  type InstructionView,
} from "./config/archetype";
import {
  FIT_PHASE_LABEL,
  tacticDemands,
  tacticFitReport,
  type FitPhase,
} from "./config/tacticfit";

/** How a note should read: a strength, a problem, or a suggestion. */
export type NoteTone = "good" | "warn" | "tip";

export interface AssistantNote {
  tone: NoteTone;
  /** Short bold lead-in — "Perfect match", "Warning". */
  title: string;
  /** The sentence itself, already in plain language. */
  body: string;
  /** The underlying figure, for a tooltip. Absent when the note is qualitative. */
  detail?: string;
}

/** A→F, the one-glance verdict. */
export type SynergyGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "E";

export interface AssistantReport {
  grade: SynergyGrade;
  /** 0..1 — what the grade was cut from; drives the dial. */
  score: number;
  notes: AssistantNote[];
  /** How many of the eleven slots are filled. Below 11 the report is partial. */
  filled: number;
  /** Per-class counts in the XI, for the pitch colouring and the mix strip. */
  counts: Record<ArchetypeClass, number>;
  /** Average archetype style synergy of the XI, as a percentage (+12 = +12%). */
  styleFitPct: number;
  /** Average instruction fit across the XI, −1..1 (v1.78). How well the ROLES
   * picked suit the five advanced dials. */
  instrFit: number;
  /** The same figure as a 0..1 mastery reading, for the "Style mastery" dial. */
  styleMastery: number;
}

/** The XI as the report needs it: the player and the slot he is filling. */
export interface ReportSlot {
  player: PlayerBio;
  slotPos: Pos;
}

/**
 * Grade thresholds.
 *
 * Cut generously at the top: a manager who has genuinely matched his squad to
 * his instructions should see an A, not be told there is always more to do.
 * The bottom is where the information is — a D means something is actively
 * fighting the plan, and the notes will say what.
 */
const GRADE_CUTS: [number, SynergyGrade][] = [
  [0.86, "A+"],
  [0.76, "A"],
  [0.66, "B+"],
  [0.56, "B"],
  [0.46, "C+"],
  [0.36, "C"],
  [0.24, "D"],
];

function gradeFor(score: number): SynergyGrade {
  for (const [cut, g] of GRADE_CUTS) if (score >= cut) return g;
  return "E";
}

/** Map a −1..1 fit score onto 0..1. */
const norm = (v: number) => Math.max(0, Math.min(1, (v + 1) / 2));

/** The five advanced dials as the engine reads them, defaults filled in.
 * Shared by the report and the blueprint so neither can score a setup the
 * simulation isn't actually playing (v2 saves may omit the expanded fields). */
export function instructionViewOf(tactic: Tactic): InstructionView {
  return {
    tempo: tactic.tempo ?? "Standard",
    width: tactic.width ?? "Standard",
    press: tactic.press ?? "Medium",
    line: tactic.line ?? "Standard",
    focus: tactic.focus ?? "Mixed",
  };
}

/**
 * Build the report.
 *
 * `synergyOf` is injected rather than imported so the caller keeps ownership of
 * the cap (the Tactics screen already clamps to `tuning.synergyCap`), and so
 * this module needs no opinion about how synergy is resolved. Since v1.78 that
 * is the only tuning-dependent input, so no `TuningConfig` is needed: the
 * instruction layer is a table lookup and its ±6% swing is applied by the
 * engine, not here.
 */
export function assistantReport(
  slots: ReportSlot[],
  tactic: Tactic,
  synergyOf: (p: PlayerBio, style: Style) => number
): AssistantReport {
  const filled = slots.length;
  const counts = filled === 0 ? emptyClassCount() : tallyClasses(
    slots.map((s) => deriveArchetype(s.player.attrs, s.slotPos)?.cls)
  );

  // ── The three inputs ────────────────────────────────────────────────────
  // 1. Can the players do what the instructions ask? (attribute fit)
  const fitRows =
    filled === 0
      ? []
      : tacticFitReport(
          slots.map((s) => ({ overall: s.player.overall, attrs: s.player.attrs })),
          tacticDemands(tactic)
        );

  // 2. Do their archetypes suit the style? (synergy)
  const styleFitPct =
    filled === 0
      ? 0
      : (slots.reduce((sum, s) => sum + synergyOf(s.player, tactic.style), 0) / filled - 1) * 100;

  // 3. Do their ROLES suit the five advanced dials? (instruction fit, v1.78)
  // Per-player and averaged, exactly like style synergy above — where the old
  // class-effects pass accumulated six separate team-level quantities.
  const view = instructionViewOf(tactic);
  const roles = slots.map((s) => {
    const archetype = deriveArchetype(s.player.attrs, s.slotPos);
    const prefs = profileForAttrs(s.player.attrs, s.slotPos).instructionPrefs;
    return {
      name: archetype?.name ?? "player",
      prefs,
      score: instructionFitScore(prefs, view),
    };
  });
  const instrFit = filled === 0 ? 0 : roles.reduce((sum, r) => sum + r.score, 0) / filled;

  // ── The composite score ─────────────────────────────────────────────────
  // Attribute fit is weighted heaviest: it is the difference between a squad
  // that can execute the plan and one that cannot, where synergy and class
  // effects are both bounded percentage nudges on top of that.
  const fitScore = fitRows.length
    ? fitRows.reduce((s, r) => s + norm(r.score), 0) / fitRows.length
    : 0.5;
  // Synergy runs roughly −10%..+20% (the authored band); centre it so 0% reads
  // as neutral rather than as a failure.
  const synScore = Math.max(0, Math.min(1, 0.5 + styleFitPct / 40));
  // Instruction fit is already −1..1, so centring it is the whole conversion.
  const instrScore = Math.max(0, Math.min(1, 0.5 + instrFit / 2));

  // Attribute fit still leads: it is the difference between a squad that CAN
  // execute the plan and one that cannot. Instruction fit is a ±6% per-player
  // lever against tacticfit's ±8% per phase, so it carries the least weight —
  // less than the class system it replaces, matching the real magnitudes.
  const score = filled === 0 ? 0 : 0.55 * fitScore + 0.3 * synScore + 0.15 * instrScore;

  return {
    grade: gradeFor(score),
    score,
    filled,
    counts,
    styleFitPct,
    // Mastery reads the same synergy figure as a 0..100 dial. The authored band
    // tops out around +20%, so that is what "full mastery" means.
    styleMastery: Math.max(0, Math.min(1, 0.5 + styleFitPct / 40)),
    instrFit,
    notes: buildNotes({ fitRows, styleFitPct, counts, roles, tactic, filled }),
  };
}

interface RoleFit {
  /** The archetype's name — the notes speak about ROLES, not classes. */
  name: string;
  prefs: InstructionPrefs;
  /** −1..1, how well the dials suit him. */
  score: number;
}

interface NoteInput {
  fitRows: { phase: FitPhase; score: number; attrs: string[] }[];
  styleFitPct: number;
  counts: Record<ArchetypeClass, number>;
  roles: RoleFit[];
  tactic: Tactic;
  filled: number;
}

/**
 * Turn the numbers into at most four sentences.
 *
 * Ordered by what a manager most needs to hear: what is actively broken first,
 * then what is working, then what could be better. Capped deliberately — a wall
 * of advice is the same problem as a wall of bars.
 */
function buildNotes(i: NoteInput): AssistantNote[] {
  const good: AssistantNote[] = [];
  const warn: AssistantNote[] = [];
  const tip: AssistantNote[] = [];

  const styleName = i.tactic.style;

  // ── Style synergy ───────────────────────────────────────────────────────
  // Thresholds are symmetric because the style band is now zero-centred
  // (v1.78): the old rows averaged about +5% before a style was even chosen, so
  // "+6 is praise, −4 is a warning" was compensating for a bias that is gone.
  if (i.styleFitPct >= 5) {
    // Name the classes actually earning it, so the praise is specific.
    const carrying = ARCHETYPE_CLASS_ORDER.filter(
      (c) => i.counts[c] > 0 && CLASS_FAVORED_STYLES[c].includes(i.tactic.style)
    );
    good.push({
      tone: "good",
      title: "Perfect match",
      body: carrying.length
        ? `Your ${carrying.map((c) => `${i.counts[c]} ${c}${i.counts[c] === 1 ? "" : "s"}`).join(" and ")} suit ${styleName} well.`
        : `This XI plays ${styleName} well.`,
      detail: `+${i.styleFitPct.toFixed(1)}% average style synergy across the XI`,
    });
  } else if (i.styleFitPct <= -5) {
    warn.push({
      tone: "warn",
      title: "Wrong style",
      body: `This squad is not built for ${styleName} — most of them play against it rather than with it.`,
      detail: `${i.styleFitPct.toFixed(1)}% average style synergy across the XI`,
    });
  }

  // ── Attribute fit, worst phase first ────────────────────────────────────
  const worst = [...i.fitRows].sort((a, b) => a.score - b.score)[0];
  const best = [...i.fitRows].sort((a, b) => b.score - a.score)[0];
  if (worst && worst.score <= -0.2) {
    warn.push({
      tone: "warn",
      title: "Struggling",
      body: `Our ${FIT_PHASE_LABEL[worst.phase].toLowerCase()} can't do what these instructions ask of it.`,
      detail: `${FIT_PHASE_LABEL[worst.phase]} fit is short on ${worst.attrs.slice(0, 3).join(", ")}`,
    });
  }
  if (best && best.score >= 0.3 && good.length < 2) {
    good.push({
      tone: "good",
      title: "Strength",
      body: `Our ${FIT_PHASE_LABEL[best.phase].toLowerCase()} is well suited to this setup.`,
      detail: `${FIT_PHASE_LABEL[best.phase]} fit is strong on ${best.attrs.slice(0, 3).join(", ")}`,
    });
  }

  // ── A missing class the style wants ─────────────────────────────────────
  // Only worth saying once the XI is nearly full: "you have no Blitzers" is
  // noise when three slots are still empty.
  if (i.filled >= 9) {
    const wanted = ARCHETYPE_CLASS_ORDER.filter((c) =>
      CLASS_FAVORED_STYLES[c].includes(i.tactic.style)
    );
    const absent = wanted.find((c) => i.counts[c] === 0);
    if (absent) {
      tip.push({
        tone: "tip",
        title: "Missing piece",
        body: `You have no ${absent}s on the pitch. ${CLASS_BODY[absent]}`,
        detail: `${absent}s favour ${CLASS_FAVORED_STYLES[absent].join(" and ")}`,
      });
    }
  }

  // ── The role most at odds with the dials (v1.78) ────────────────────────
  // Named by ARCHETYPE rather than class, which is the point of moving the
  // advanced instructions to archetype level: "your Sniper is wasted on a slow
  // build-up" is something a manager can act on in a way that "your Mavericks
  // are unhappy" never was. It replaces the old "biggest class effect" note,
  // which reported an engine quantity nobody could locate in a match.
  /** "an Interceptor", "a Sniper" — the roster has vowel-initial names. */
  const withArticle = (n: string) => `${/^[AEIOU]/i.test(n) ? "an" : "a"} ${n}`;
  const sour = i.roles.filter((r) => r.score <= -0.5).sort((a, b) => a.score - b.score)[0];
  const sweet = i.roles.filter((r) => r.score >= 0.75).sort((a, b) => b.score - a.score)[0];
  if (sour) {
    warn.push({
      tone: "warn",
      title: "Wasted",
      body: `Your ${sour.name} is fighting these instructions.`,
      detail: `${withArticle(sour.name)} wants ${describePrefs(sour.prefs)}`,
    });
  } else if (sweet && good.length < 2) {
    good.push({
      tone: "good",
      title: "Set up for him",
      body: `These instructions are exactly what ${withArticle(sweet.name)} wants.`,
      detail: `${withArticle(sweet.name)} wants ${describePrefs(sweet.prefs)}`,
    });
  }

  // Problems first, then what works, then a suggestion — and never more than
  // four, so the box stays readable at a glance.
  return [...warn, ...good, ...tip].slice(0, 4);
}

/** What a missing class would actually have given the side. */
const CLASS_BODY: Record<ArchetypeClass, string> = {
  Creator: "Nobody is going to unlock a packed defence with a pass.",
  Engine: "We'll run out of legs before they do.",
  Enforcer: "We'll struggle to win the ball back cleanly.",
  Blitzer: "We'll struggle to counter-attack or get in behind.",
  Maverick: "There's no one to invent something when the plan stalls.",
};

// ── Squad Blueprint (§9c, v1.79) ───────────────────────────────────────────
//
// The report above grades the side you HAVE. This answers the question that
// comes next and had no answer anywhere in the game: what side should I be
// building? Without it, knowing that a Possession 4-3-3 wants a Constructor at
// full back rather than a Protector means holding 45 archetypes × 6 styles ×
// five dials in your head — a wiki, not a game.
//
// Everything here is derived from the two functions the engine itself reads
// (`styleSynergy` and `instructionFitScore`), so the blueprint can only ever
// recommend what the simulation will actually reward.

/** How well an incumbent measures up to the slot's ideal. */
export type SlotGrade = "ideal" | "fine" | "poor";

export interface BlueprintSlot {
  slotId: string;
  slotPos: Pos;
  /** Slot label from the formation ("LB", "CM") — what the pitch calls it. */
  label: string;
  /** The best archetype available at this position for this exact setup. */
  ideal: Archetype;
  /** What that ideal is worth, as a percentage rating swing (+15 = +15%). */
  idealPct: number;
  /**
   * The best role at this slot for the five DIALS alone, ignoring style.
   *
   * Style runs ±15% against the instruction layer's ±6%, so wherever one class
   * wins the style column outright it also wins every dial combination — which
   * would make `ideal` above look, correctly but uselessly, like a function of
   * style only. This is the question the instruction layer actually owns, and
   * it is only worth showing when it disagrees with `ideal`.
   */
  bestForDials: Archetype;
  /** The dial-only swing `bestForDials` earns, on the same percentage scale. */
  bestForDialsPct: number;
  /** The player currently in the slot, if any. */
  incumbent?: PlayerBio;
  /** The incumbent's own archetype — undefined when the slot is empty. */
  actual?: Archetype;
  /** The incumbent's swing, same scale as `idealPct`. */
  actualPct: number;
  /** The incumbent's two terms separately, so the UI can say WHICH half is
   * costing him rather than only that something is. */
  actualStylePct: number;
  actualDialsPct: number;
  grade: SlotGrade;
}

export interface Blueprint {
  slots: BlueprintSlot[];
  /** The slot costing the most against its ideal — the one thing to fix. Only
   * set when a slot is genuinely `poor`, so it is advice and not just a rank. */
  weakest?: BlueprintSlot;
  /** Distinct archetypes worth shopping for, best gain first. Drives the
   * "Find a Constructor" buttons. */
  wants: { archetype: Archetype; pos: Pos }[];
}

/**
 * Score an archetype against a setup, as the percentage swing it earns.
 *
 * Both layers, weighted by the levers they actually pull in the engine:
 * `synergyCap`-bounded style synergy (±15% as authored) and the ±`swing`
 * instruction lever. Adding them is legitimate because the engine multiplies
 * both onto the same quantity — the player's effective rating — which is the
 * whole point of the v1.78 one-channel design.
 */
function setupScore(a: Archetype, style: Style, view: InstructionView, swing: number) {
  const prof = profileOf(a);
  const style_ = (prof.styleSynergy[style] - 1) * 100;
  const dials = instructionFitScore(prof.instructionPrefs, view) * swing * 100;
  return { style: style_, dials, total: style_ + dials };
}

/**
 * The ideal XI for a formation, style and set of dials — and how the current
 * side measures up to it.
 *
 * `instructionFitSwing` is passed in rather than imported for the same reason
 * `assistantReport` takes `synergyOf`: this module stays free of tuning, and the
 * caller keeps ownership of the numbers the engine is actually configured with.
 */
export function squadBlueprint(
  slots: { id: string; pos: Pos; label: string }[],
  lineup: Record<string, PlayerBio | undefined>,
  tactic: Tactic,
  instructionFitSwing: number
): Blueprint {
  const view = instructionViewOf(tactic);
  const score = (a: Archetype) => setupScore(a, tactic.style, view, instructionFitSwing);

  const rows: BlueprintSlot[] = slots.map((slot) => {
    // Ranked among the archetypes REACHABLE at this position — recommending a
    // Sniper at centre back would be advice no player could ever act on.
    const options = archetypesForPosition(slot.pos);
    const ideal = options.reduce((best, a) => (score(a).total > score(best).total ? a : best), options[0]);
    const idealPct = ideal ? score(ideal).total : 0;

    // Ties on the dial term are common (many roles are indifferent to a given
    // setup), so break them by style — otherwise this reports whichever
    // archetype the roster happens to list first, which is not advice.
    const bestForDials = options.reduce((best, a) => {
      const x = score(a);
      const y = score(best);
      return x.dials > y.dials || (x.dials === y.dials && x.style > y.style) ? a : best;
    }, options[0]);

    const incumbent = lineup[slot.id];
    // Read against the slot he is FILLING, exactly as the engine does, so a
    // midfielder at full back is graded as the full back he's asked to be.
    const actual = incumbent?.attrs ? deriveArchetype(incumbent.attrs, slot.pos) : undefined;
    const act = actual ? score(actual) : { style: 0, dials: 0, total: 0 };

    // A gap, not an absolute: what this slot COSTS you against the best you
    // could field there. `fine` covers the "0 is neutral, not a trap" reading —
    // a role that simply isn't what the style is built around is not a mistake.
    //
    // The cuts are set from the real distribution of this gap over all 360
    // (style × position × archetype) combinations, whose median is 6% and whose
    // tail reaches 36%. Grading `poor` at >12 put 36% of the roster in the red,
    // so an ordinary auto-picked XI rendered as a wall of ✗ — which reads as
    // "your whole team is wrong" and is therefore advice about nothing. At >20
    // only the genuinely mismatched quarter is flagged, which is what makes a ✗
    // worth reacting to.
    const gap = idealPct - act.total;
    const grade: SlotGrade = !actual ? "poor" : gap <= 4 ? "ideal" : gap <= 20 ? "fine" : "poor";

    return {
      slotId: slot.id,
      slotPos: slot.pos,
      label: slot.label,
      ideal,
      idealPct,
      bestForDials,
      bestForDialsPct: bestForDials ? score(bestForDials).dials : 0,
      incumbent,
      actual,
      actualPct: act.total,
      actualStylePct: act.style,
      actualDialsPct: act.dials,
      grade,
    };
  });

  // Only a filled slot can be "the weakest link": an empty one is a lineup
  // problem the pitch already shows, and naming it here would crowd out the
  // real advice on a half-picked side.
  const weakest = rows
    .filter((r) => r.grade === "poor" && r.actual)
    .sort((a, b) => b.idealPct - b.actualPct - (a.idealPct - a.actualPct))[0];

  // The shopping list: one entry per distinct archetype, biggest gain first.
  // Deduped because a 4-3-3 asks for the same full back twice, and two identical
  // buttons is noise.
  const seen = new Set<string>();
  const wants = rows
    .filter((r) => r.grade === "poor" && r.ideal)
    .sort((a, b) => b.idealPct - b.actualPct - (a.idealPct - a.actualPct))
    .filter((r) => !seen.has(r.ideal.id) && (seen.add(r.ideal.id), true))
    .map((r) => ({ archetype: r.ideal, pos: r.slotPos }));

  return { slots: rows, weakest, wants };
}

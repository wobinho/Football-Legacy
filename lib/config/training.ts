// ── Player development training plans (§5, v1.72) ──────────────────────────
//
// Every position has FIVE plans — four specialisations and a balanced default —
// and each plan is authored directly against the 35-attribute model rather than
// against the six card faces. A plan names four PRIMARY attributes (the core of
// the role) and four SECONDARY ones (the supporting skills), and everything else
// is the "other" tier that ticks over in the background.
//
// This replaces the v8 scheme, where eight generic plans ("Pace", "Finishing")
// were authored as six-family shapes and fanned out to 35 by a tilt table. That
// was the right design when players carried six attributes; with 35 it was a
// blunt instrument — "Finishing" pulled on the whole shooting family when what a
// poacher actually needs is finishing, positioning, reactions and acceleration.
//
// ── The growth rule ───────────────────────────────────────────────────────
// A player can't give full effort to everything at once, so training energy is
// split across three tiers, expressed as a share of the plan's XP:
//
//   Primary    100% of the plan's rate
//   Secondary   60%
//   Other       20%
//
// ── The dynamic multiplier ────────────────────────────────────────────────
// Attributes are NOT equally valuable: `overallFromAttrs` weights them by
// position, so a striker's finishing moves his rating far more than his passing
// does. Left alone, that would punish specialisation — training a striker as a
// creative False 9 would develop him more slowly in headline terms than training
// him as a poacher, purely because the attributes he's working on are worth less
// at his position.
//
// Each plan therefore carries a `growthMult` that compensates: it is the inverse
// of how much position-weight the plan's own targets carry, so every plan for a
// position reaches the same overall at the same rate. Specialising costs you
// nothing; it only changes WHERE the growth lands. The authored figures below are
// the designed values, and `verifyPlanMultipliers()` checks them against the
// actual position weights.
//
// Everything here is pure data plus one expansion pass. The development pass
// reads `weights` and `growthMult` and never special-cases a plan by name.

import type { PlayerBio, Pos } from "../types";
import { getArchetype } from "./archetypes";
import { ATTR_WEIGHTS } from "./positions";
import { ATTR_KEYS, type AttrKey } from "./attributes";

export type { AttrKey };

/** The three effort tiers a plan splits its training across. */
export const PRIMARY_SHARE = 1.0;
export const SECONDARY_SHARE = 0.6;
export const OTHER_SHARE = 0.2;

/**
 * The position groups plans are authored for. Several real positions share one
 * plan set because they are the same job on opposite flanks (LB/RB, LM/RM,
 * LW/RW) — a left back and a right back want identical training.
 */
export type PlanPos = "GK" | "CB" | "FB" | "DM" | "CM" | "AM" | "WM" | "W" | "ST";

/** Which authored plan set a real position draws from. */
const PLAN_POS_OF: Record<Pos, PlanPos> = {
  GK: "GK",
  CB: "CB",
  LB: "FB",
  RB: "FB",
  DM: "DM",
  CM: "CM",
  AM: "AM",
  LM: "WM",
  RM: "WM",
  LW: "W",
  RW: "W",
  ST: "ST",
};

/** Display label for a plan group, for UI that names the set. */
export const PLAN_POS_LABEL: Record<PlanPos, string> = {
  GK: "Goalkeeper",
  CB: "Centre Back",
  FB: "Full Back",
  DM: "Defensive Midfield",
  CM: "Central Midfield",
  AM: "Attacking Midfield",
  WM: "Wide Midfield",
  W: "Winger",
  ST: "Striker",
};

/**
 * Which training facility a plan's focus is amplified by (v1.65 facilities,
 * re-keyed v1.72).
 *
 * Authored per plan as a broad focus rather than per attribute: the facility
 * system asks "what kind of work is this", and these four answers are what it
 * knows how to boost. `undefined` means no facility applies.
 */
export type PlanFocus = "athletic" | "technical" | "finishing";

export interface TrainingPlanDef {
  id: string;
  name: string;
  blurb: string;
  /** The position set this plan belongs to. */
  planPos: PlanPos;
  /** The four core attributes of the role — trained at full rate. */
  primary: AttrKey[];
  /** The four supporting attributes — trained at SECONDARY_SHARE. */
  secondary: AttrKey[];
  /** Per-attribute training share (0..1), derived from the tiers above. The
   * development pass reads this. */
  weights: Record<AttrKey, number>;
  /** The dynamic multiplier: compensates for how much position-weight this
   * plan's targets carry, so specialising never slows a player down. */
  growthMult: number;
  /** Which facility track amplifies this plan, if any. */
  focus?: PlanFocus;
}

/** A plan as authored — the weights are derived, so they aren't written here. */
interface PlanSeed extends Omit<TrainingPlanDef, "weights"> {}

// ── The plan table ─────────────────────────────────────────────────────────
// Five per position: four specialisations and a balanced default. Ids are
// `<planPos>_<slug>`, so a plan is always identifiable with its position and no
// two positions can collide on a name.

const PLAN_SEEDS: PlanSeed[] = [
  // ── Goalkeeper ───────────────────────────────────────────────────────────
  {
    id: "gk_shotstopper",
    name: "Traditional Shot Stopper",
    blurb: "Line work and reaction saves — the keeper who wins you points by stopping what reaches him.",
    planPos: "GK",
    primary: ["diving", "reflexes", "reactions", "gkPositioning"],
    secondary: ["handling", "jumping", "acceleration", "composure"],
    growthMult: 1.05,
    focus: "athletic",
  },
  {
    id: "gk_sweeper",
    name: "Modern Sweeper Keeper",
    blurb: "Starting position, speed off the line and recovery pace — a keeper who defends the space behind a high line.",
    planPos: "GK",
    primary: ["gkPositioning", "gkSpeed", "acceleration", "diving"],
    secondary: ["kicking", "reactions", "agility", "shortPassing"],
    growthMult: 1.25,
    focus: "athletic",
  },
  {
    id: "gk_distribution",
    name: "Distribution Specialist",
    blurb: "Kicking, throwing and playing out from the back — the keeper who starts the attack.",
    planPos: "GK",
    primary: ["kicking", "handling", "shortPassing", "longPassing"],
    secondary: ["gkPositioning", "vision", "composure", "reflexes"],
    growthMult: 1.6,
    focus: "technical",
  },
  {
    id: "gk_command",
    name: "Command & Aerial Control",
    blurb: "Claiming crosses and owning the six-yard box — a keeper who dominates his area.",
    planPos: "GK",
    primary: ["handling", "gkPositioning", "jumping", "strength"],
    secondary: ["diving", "aggression", "headingAccuracy", "reactions"],
    growthMult: 1.26,
    focus: "athletic",
  },
  {
    id: "gk_balanced",
    name: "Balanced Goalkeeper",
    blurb: "The all-round keeper's programme — no specialism, no weakness.",
    planPos: "GK",
    primary: ["handling", "diving", "reflexes", "gkPositioning"],
    secondary: ["kicking", "reactions", "gkSpeed", "jumping"],
    growthMult: 1.0,
  },

  // ── Centre Back ──────────────────────────────────────────────────────────
  {
    id: "cb_stopper",
    name: "Stopper (Physical Enforcer)",
    blurb: "Front-foot defending: win the ball, win the header, win the duel.",
    planPos: "CB",
    primary: ["standingTackle", "strength", "headingAccuracy", "markingAwareness"],
    secondary: ["aggression", "jumping", "slidingTackle", "reactions"],
    growthMult: 1.06,
    focus: "athletic",
  },
  {
    id: "cb_ballplaying",
    name: "Ball-Playing Defender",
    blurb: "Defending that starts with the pass — range, control and composure under pressure.",
    planPos: "CB",
    primary: ["shortPassing", "longPassing", "ballControl", "markingAwareness"],
    secondary: ["standingTackle", "composure", "vision", "interceptions"],
    growthMult: 1.49,
    focus: "technical",
  },
  {
    id: "cb_cover",
    name: "Cover (Pacy & Intelligent)",
    blurb: "The defender who reads it early and has the legs to get there — cover for a high line.",
    planPos: "CB",
    primary: ["interceptions", "markingAwareness", "sprintSpeed", "acceleration"],
    secondary: ["standingTackle", "slidingTackle", "reactions", "agility"],
    growthMult: 1.34,
    focus: "athletic",
  },
  {
    id: "cb_aerial",
    name: "Aerial Dominance",
    blurb: "Everything in the air: set pieces at both ends, and nothing over the top.",
    planPos: "CB",
    primary: ["headingAccuracy", "jumping", "strength", "markingAwareness"],
    secondary: ["standingTackle", "aggression", "reactions", "stamina"],
    growthMult: 1.29,
    focus: "athletic",
  },
  {
    id: "cb_balanced",
    name: "Balanced Center Back",
    blurb: "The complete defender's programme — solid in every phase of defending.",
    planPos: "CB",
    primary: ["standingTackle", "markingAwareness", "interceptions", "headingAccuracy"],
    secondary: ["slidingTackle", "strength", "reactions", "shortPassing"],
    growthMult: 1.0,
  },

  // ── Full Back (LB/RB) ────────────────────────────────────────────────────
  {
    id: "fb_wingback",
    name: "Wing Back (Attacking Overlapper)",
    blurb: "Up and down the touchline all game — the overlap, the cross, and the legs to repeat it.",
    planPos: "FB",
    primary: ["crossing", "sprintSpeed", "acceleration", "stamina"],
    secondary: ["dribbling", "ballControl", "slidingTackle", "reactions"],
    growthMult: 1.34,
    focus: "athletic",
  },
  {
    id: "fb_defensive",
    name: "Defensive Fullback (Lockdown)",
    blurb: "A full back who defends first — the winger he marks does not get past him.",
    planPos: "FB",
    primary: ["slidingTackle", "standingTackle", "markingAwareness", "interceptions"],
    secondary: ["strength", "reactions", "stamina", "headingAccuracy"],
    growthMult: 1.13,
    focus: "technical",
  },
  {
    id: "fb_inverted",
    name: "Inverted Fullback (Midfield Constructor)",
    blurb: "Steps inside to make a midfield three — a defender who builds the play from the half-space.",
    planPos: "FB",
    primary: ["shortPassing", "ballControl", "interceptions", "standingTackle"],
    secondary: ["longPassing", "vision", "composure", "markingAwareness"],
    growthMult: 1.27,
    focus: "technical",
  },
  {
    id: "fb_athlete",
    name: "Complete Athlete",
    blurb: "Pure engine work — the physical profile that lets a full back cover the whole flank.",
    planPos: "FB",
    primary: ["stamina", "sprintSpeed", "acceleration", "agility"],
    secondary: ["standingTackle", "crossing", "balance", "reactions"],
    growthMult: 1.47,
    focus: "athletic",
  },
  {
    id: "fb_balanced",
    name: "Balanced Fullback",
    blurb: "The modern full back's all-round programme — defend the flank, join the attack.",
    planPos: "FB",
    primary: ["slidingTackle", "interceptions", "standingTackle", "crossing"],
    secondary: ["reactions", "markingAwareness", "stamina", "shortPassing"],
    growthMult: 1.0,
  },

  // ── Defensive Midfield ───────────────────────────────────────────────────
  {
    id: "dm_anchor",
    name: "Anchor / Destroyer",
    blurb: "Screens the back four and breaks up everything that comes through the middle.",
    planPos: "DM",
    primary: ["standingTackle", "interceptions", "markingAwareness", "strength"],
    secondary: ["aggression", "slidingTackle", "shortPassing", "stamina"],
    growthMult: 1.12,
    focus: "technical",
  },
  {
    id: "dm_regista",
    name: "Deep-Lying Playmaker (Regista)",
    blurb: "Sets the tempo from in front of the defence — the pass that starts everything.",
    planPos: "DM",
    primary: ["shortPassing", "longPassing", "vision", "ballControl"],
    secondary: ["composure", "interceptions", "curve", "reactions"],
    growthMult: 1.24,
    focus: "technical",
  },
  {
    id: "dm_boxtobox",
    name: "Box-to-Box Anchor",
    blurb: "Covers ground others can't — a holding player with the lungs to get forward too.",
    planPos: "DM",
    primary: ["stamina", "shortPassing", "interceptions", "standingTackle"],
    secondary: ["acceleration", "strength", "markingAwareness", "reactions"],
    growthMult: 1.13,
    focus: "athletic",
  },
  {
    id: "dm_pressresist",
    name: "Press Resistance Specialist",
    blurb: "Receives under pressure and gets out of it — the first pass past a press.",
    planPos: "DM",
    primary: ["ballControl", "balance", "agility", "shortPassing"],
    secondary: ["composure", "dribbling", "standingTackle", "interceptions"],
    growthMult: 1.48,
    focus: "technical",
  },
  {
    id: "dm_balanced",
    name: "Balanced Defensive Midfielder",
    blurb: "The complete holding midfielder — protect, receive, distribute.",
    planPos: "DM",
    primary: ["shortPassing", "interceptions", "standingTackle", "ballControl"],
    secondary: ["longPassing", "markingAwareness", "reactions", "stamina"],
    growthMult: 1.0,
  },

  // ── Central Midfield ─────────────────────────────────────────────────────
  {
    id: "cm_boxtobox",
    name: "Box-to-Box Engine",
    blurb: "End to end for ninety minutes — the midfielder who is in both boxes.",
    planPos: "CM",
    primary: ["stamina", "shortPassing", "ballControl", "reactions"],
    secondary: ["standingTackle", "interceptions", "longShots", "acceleration"],
    growthMult: 1.11,
    focus: "athletic",
  },
  {
    id: "cm_metronome",
    name: "Tempo Dictator (Metronome)",
    blurb: "Never gives it away and never rushes — the midfielder the game is played at the speed of.",
    planPos: "CM",
    primary: ["shortPassing", "longPassing", "ballControl", "vision"],
    secondary: ["composure", "reactions", "curve", "positioning"],
    growthMult: 1.1,
    focus: "technical",
  },
  {
    id: "cm_carrier",
    name: "Ball-Carrying Midfielder",
    blurb: "Beats the first line by running at it — carries the ball out of midfield.",
    planPos: "CM",
    primary: ["dribbling", "ballControl", "agility", "shortPassing"],
    secondary: ["acceleration", "balance", "vision", "stamina"],
    growthMult: 1.33,
    focus: "technical",
  },
  {
    id: "cm_mezzala",
    name: "Mezzala (Half-Space Threat)",
    blurb: "Drifts into the half-space and arrives late in the box — a midfielder who scores.",
    planPos: "CM",
    primary: ["positioning", "shortPassing", "vision", "longShots"],
    secondary: ["finishing", "ballControl", "dribbling", "crossing"],
    growthMult: 1.32,
    focus: "finishing",
  },
  {
    id: "cm_balanced",
    name: "Balanced Central Midfielder",
    blurb: "The complete midfielder's programme — control the middle in every phase.",
    planPos: "CM",
    primary: ["shortPassing", "ballControl", "longPassing", "vision"],
    secondary: ["reactions", "dribbling", "positioning", "stamina"],
    growthMult: 1.0,
  },

  // ── Attacking Midfield ───────────────────────────────────────────────────
  {
    id: "am_playmaker",
    name: "Classic Number 10 (Playmaker)",
    blurb: "The pass nobody else sees — a creator between the lines.",
    planPos: "AM",
    primary: ["vision", "shortPassing", "ballControl", "dribbling"],
    secondary: ["composure", "longPassing", "curve", "reactions"],
    growthMult: 1.1,
    focus: "technical",
  },
  {
    id: "am_shadowstriker",
    name: "Shadow Striker",
    blurb: "Runs beyond the striker and finishes — a second forward in an attacking midfielder's shirt.",
    planPos: "AM",
    primary: ["finishing", "positioning", "shortPassing", "ballControl"],
    secondary: ["shotPower", "longShots", "reactions", "acceleration"],
    growthMult: 1.2,
    focus: "finishing",
  },
  {
    id: "am_sniper",
    name: "Long-Range Sniper",
    blurb: "Shoots from distance and means it — plus the dead balls that come with the territory.",
    planPos: "AM",
    primary: ["longShots", "shotPower", "curve", "shortPassing"],
    secondary: ["fkAccuracy", "vision", "ballControl", "volleys"],
    growthMult: 1.63,
    focus: "finishing",
  },
  {
    id: "am_agility",
    name: "Agility & Space Creator",
    blurb: "Turns in a phone box — finds and makes space where there isn't any.",
    planPos: "AM",
    primary: ["agility", "balance", "dribbling", "acceleration"],
    secondary: ["ballControl", "positioning", "shortPassing", "reactions"],
    growthMult: 1.4,
    focus: "athletic",
  },
  {
    id: "am_balanced",
    name: "Balanced Attacking Midfielder",
    blurb: "The all-round number ten — create, carry and finish.",
    planPos: "AM",
    primary: ["shortPassing", "ballControl", "vision", "dribbling"],
    secondary: ["positioning", "reactions", "finishing", "longShots"],
    growthMult: 1.0,
  },

  // ── Wide Midfield (LM/RM) ────────────────────────────────────────────────
  {
    id: "wm_winger",
    name: "Traditional Winger (Crosser)",
    blurb: "Outside the full back and to the back post — width, pace and delivery.",
    planPos: "WM",
    primary: ["crossing", "sprintSpeed", "acceleration", "dribbling"],
    secondary: ["curve", "ballControl", "shortPassing", "stamina"],
    growthMult: 1.25,
    focus: "athletic",
  },
  {
    id: "wm_playmaker",
    name: "Wide Playmaker",
    blurb: "Comes inside to create — a number ten operating from the touchline.",
    planPos: "WM",
    primary: ["shortPassing", "vision", "ballControl", "dribbling"],
    secondary: ["longPassing", "composure", "crossing", "reactions"],
    growthMult: 1.1,
    focus: "technical",
  },
  {
    id: "wm_workhorse",
    name: "Wide Target / Workhorse",
    blurb: "Does the other job: tracks the full back, holds the width, runs all afternoon.",
    planPos: "WM",
    primary: ["stamina", "reactions", "ballControl", "shortPassing"],
    secondary: ["standingTackle", "interceptions", "strength", "crossing"],
    growthMult: 1.27,
    focus: "athletic",
  },
  {
    id: "wm_inverted",
    name: "Inverted Wide Threat",
    blurb: "Cuts in on the stronger foot and shoots — a wide player who is really a scorer.",
    planPos: "WM",
    primary: ["dribbling", "finishing", "longShots", "positioning"],
    secondary: ["curve", "acceleration", "ballControl", "shotPower"],
    growthMult: 1.37,
    focus: "finishing",
  },
  {
    id: "wm_balanced",
    name: "Balanced Wide Midfielder",
    blurb: "The complete wide midfielder — beat a man, deliver, and get back.",
    planPos: "WM",
    primary: ["dribbling", "ballControl", "shortPassing", "crossing"],
    secondary: ["positioning", "reactions", "acceleration", "stamina"],
    growthMult: 1.0,
  },

  // ── Winger (LW/RW) ───────────────────────────────────────────────────────
  {
    id: "w_cutter",
    name: "Inside Cutter / Goalscorer",
    blurb: "Starts wide, finishes central — a winger whose job is goals.",
    planPos: "W",
    primary: ["finishing", "dribbling", "positioning", "ballControl"],
    secondary: ["shotPower", "curve", "acceleration", "longShots"],
    growthMult: 1.14,
    focus: "finishing",
  },
  {
    id: "w_speed",
    name: "Speed Demon (Touchline Winger)",
    blurb: "Pure pace on the outside — knock it past him and go.",
    planPos: "W",
    primary: ["acceleration", "sprintSpeed", "dribbling", "crossing"],
    secondary: ["agility", "ballControl", "balance", "positioning"],
    growthMult: 1.25,
    focus: "athletic",
  },
  {
    id: "w_trickster",
    name: "Trickster / Dribbling Specialist",
    blurb: "One-v-one every time — the winger defenders don't want to face.",
    planPos: "W",
    primary: ["dribbling", "agility", "balance", "ballControl"],
    secondary: ["acceleration", "shortPassing", "curve", "reactions"],
    growthMult: 1.28,
    focus: "technical",
  },
  {
    id: "w_creator",
    name: "Wide Creator",
    blurb: "The assist man from wide — delivery, vision and dead balls.",
    planPos: "W",
    primary: ["crossing", "vision", "shortPassing", "ballControl"],
    secondary: ["curve", "fkAccuracy", "composure", "reactions"],
    growthMult: 1.33,
    focus: "technical",
  },
  {
    id: "w_balanced",
    name: "Balanced Winger",
    blurb: "The all-round wide forward — beat a man, create, and score.",
    planPos: "W",
    primary: ["dribbling", "ballControl", "finishing", "crossing"],
    secondary: ["positioning", "shortPassing", "acceleration", "sprintSpeed"],
    growthMult: 1.0,
  },

  // ── Striker ──────────────────────────────────────────────────────────────
  {
    id: "st_targetman",
    name: "Target Man",
    blurb: "Holds it up, wins it in the air, brings others in — the reference point up front.",
    planPos: "ST",
    primary: ["strength", "headingAccuracy", "jumping", "finishing"],
    secondary: ["ballControl", "shortPassing", "shotPower", "aggression"],
    growthMult: 1.3,
    focus: "athletic",
  },
  {
    id: "st_poacher",
    name: "Advanced Forward / Poacher",
    blurb: "Lives on the shoulder and finishes first time — a striker who does one thing perfectly.",
    planPos: "ST",
    primary: ["finishing", "positioning", "reactions", "acceleration"],
    secondary: ["shotPower", "headingAccuracy", "ballControl", "volleys"],
    growthMult: 1.06,
    focus: "finishing",
  },
  {
    id: "st_false9",
    name: "False 9 / Link-Up Striker",
    blurb: "Drops in to make the numbers up — a striker who creates as much as he scores.",
    planPos: "ST",
    primary: ["shortPassing", "ballControl", "vision", "dribbling"],
    secondary: ["composure", "positioning", "finishing", "reactions"],
    growthMult: 1.36,
    focus: "technical",
  },
  {
    id: "st_speed",
    name: "Complete Speed Striker",
    blurb: "Runs in behind and finishes at pace — a forward defences have to drop off.",
    planPos: "ST",
    primary: ["sprintSpeed", "acceleration", "finishing", "shotPower"],
    secondary: ["dribbling", "agility", "positioning", "longShots"],
    growthMult: 1.24,
    focus: "athletic",
  },
  {
    id: "st_balanced",
    name: "Balanced Striker",
    blurb: "The complete centre forward's programme — score in every way there is.",
    planPos: "ST",
    primary: ["finishing", "positioning", "ballControl", "headingAccuracy"],
    secondary: ["shotPower", "reactions", "shortPassing", "strength"],
    growthMult: 1.0,
  },
];

/** Fan a plan's authored tiers out across all 35 attributes. */
function expandPlanWeights(seed: PlanSeed): Record<AttrKey, number> {
  const primary = new Set(seed.primary);
  const secondary = new Set(seed.secondary);
  const out = {} as Record<AttrKey, number>;
  for (const k of ATTR_KEYS) {
    out[k] = primary.has(k) ? PRIMARY_SHARE : secondary.has(k) ? SECONDARY_SHARE : OTHER_SHARE;
  }
  return out;
}

export const TRAINING_PLANS: TrainingPlanDef[] = PLAN_SEEDS.map((s) => ({
  ...s,
  weights: expandPlanWeights(s),
}));

export const TRAINING_PLAN_MAP: Record<string, TrainingPlanDef> = Object.fromEntries(
  TRAINING_PLANS.map((p) => [p.id, p])
);

/** Plans grouped by the position set they belong to. */
export const PLANS_BY_POS: Record<PlanPos, TrainingPlanDef[]> = TRAINING_PLANS.reduce(
  (acc, p) => {
    (acc[p.planPos] ??= []).push(p);
    return acc;
  },
  {} as Record<PlanPos, TrainingPlanDef[]>
);

/** The plan set a real position draws from. */
export function planPosOf(pos: Pos): PlanPos {
  return PLAN_POS_OF[pos] ?? "CM";
}

/** The balanced default for a position — the last plan in every set. */
export function defaultPlanFor(pos: Pos): TrainingPlanDef {
  const options = PLANS_BY_POS[planPosOf(pos)];
  return options[options.length - 1];
}

/** Plans available to a given primary position (for the UI dropdown). */
export function plansForPosition(pos: Pos): TrainingPlanDef[] {
  return PLANS_BY_POS[planPosOf(pos)] ?? [];
}

/**
 * Resolve a (possibly undefined, stale, or pre-v1.72) plan id to a definition,
 * honoring the player's position.
 *
 * An id from another position's set — or one of the eight old generic ids, which
 * no longer exist — falls back to that position's balanced plan rather than
 * failing. That is what lets an old save load: every player simply starts again
 * on Balanced, at the position he actually plays.
 */
export function resolveTrainingPlan(planId: string | undefined, pos: Pos): TrainingPlanDef {
  const def = planId ? TRAINING_PLAN_MAP[planId] : undefined;
  if (!def || def.planPos !== planPosOf(pos)) return defaultPlanFor(pos);
  return def;
}

// ── The dynamic multiplier ────────────────────────────────────────────────

/**
 * How much of a position's total attribute weight a plan's own targets carry.
 *
 * This is the quantity `growthMult` exists to cancel. A plan whose primaries are
 * all heavily weighted at the position (a poacher's finishing) scores high; one
 * that trains lightly-weighted attributes (a False 9's passing) scores low, and
 * needs a correspondingly larger multiplier to keep pace.
 *
 * Exported for the verifier and for UI that wants to explain the multiplier.
 */
export function planWeightCoverage(plan: TrainingPlanDef, pos: Pos): number {
  const posW = ATTR_WEIGHTS[pos] ?? ATTR_WEIGHTS.CM;
  let covered = 0;
  let total = 0;
  for (const k of ATTR_KEYS) {
    const w = Math.max(0, posW[k] ?? 0);
    total += w;
    covered += w * plan.weights[k];
  }
  return total > 0 ? covered / total : 0;
}

/**
 * The multiplier a plan WOULD need for a player at `pos` to progress at exactly
 * the same overall rate as that position's balanced plan.
 *
 * The authored `growthMult` figures are the designed values (they are what the
 * game ships and what the UI shows); this is the arithmetic they were derived
 * from, so `npm run verify:training` can check the table hasn't drifted away
 * from the attribute weights it was balanced against.
 */
export function idealGrowthMult(plan: TrainingPlanDef, pos: Pos): number {
  const balanced = defaultPlanFor(pos);
  const mine = planWeightCoverage(plan, pos);
  if (mine <= 0) return 1;
  return planWeightCoverage(balanced, pos) / mine;
}

/** One plan's authored multiplier against the ideal, for the verifier. */
export interface PlanMultCheck {
  id: string;
  pos: Pos;
  authored: number;
  ideal: number;
  /** Relative error, 0 = perfect. */
  error: number;
}

/**
 * Check every plan's authored multiplier against the position weights.
 *
 * A plan is "balanced" when a player on it reaches the same overall at the same
 * time as one on the position's Balanced plan — that is the promise the dynamic
 * multiplier makes, so it is worth a test rather than trust.
 */
export function verifyPlanMultipliers(): PlanMultCheck[] {
  const out: PlanMultCheck[] = [];
  const posOf: Record<PlanPos, Pos> = {
    GK: "GK", CB: "CB", FB: "LB", DM: "DM", CM: "CM", AM: "AM", WM: "LM", W: "LW", ST: "ST",
  };
  for (const plan of TRAINING_PLANS) {
    const pos = posOf[plan.planPos];
    const ideal = idealGrowthMult(plan, pos);
    out.push({
      id: plan.id,
      pos,
      authored: plan.growthMult,
      ideal,
      error: Math.abs(plan.growthMult - ideal) / Math.max(1e-6, ideal),
    });
  }
  return out;
}

// ── Optimal-plan resolution (the auto-assign button) ──────────────────────

/**
 * Score how well a plan suits a player.
 *
 * The dynamic multiplier means every plan for a position develops overall at the
 * same RATE, so "which plan raises his rating fastest" no longer has an answer —
 * and the old scoring function, which asked exactly that, would now return near
 * ties decided by rounding noise.
 *
 * The useful question instead is which plan fits the player he already is: a plan
 * scores well when its primary attributes are the ones his archetype is built
 * around and where he still has room to grow. That keeps auto-assign meaningful
 * (a target man is pointed at Target Man, not at False 9) without pretending one
 * plan is objectively faster than another.
 *
 * Pure and deterministic — the same player always resolves to the same plan.
 */
export function planScore(p: PlayerBio, plan: TrainingPlanDef): number {
  const profile = getArchetype(p.archetypeId).attrProfile;
  const maxProfile = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;

  let score = 0;
  for (const k of ATTR_KEYS) {
    // How much this attribute defines the player's archetype, 0..1.
    const rel = profile[k] / maxProfile;
    // Headroom as a saturating factor: an attribute already at the ceiling is
    // not worth aiming a plan at, but a merely-low one isn't a target either —
    // the archetype decides direction, headroom only discounts what's finished.
    const usable = Math.min(1, Math.max(0, 99 - p.attrs[k]) / 12);
    score += plan.weights[k] * rel * usable;
  }
  return score;
}

/**
 * The training plan that best fits this player, from the five his position is
 * offered. Ties break toward the earlier plan in the table, so the result is
 * stable and the balanced plan (always last) only wins when nothing else fits.
 */
export function optimalTrainingPlan(p: PlayerBio): TrainingPlanDef {
  const options = plansForPosition(p.positions[0]);
  let best = options[0] ?? defaultPlanFor(p.positions[0]);
  let bestScore = -Infinity;
  for (const plan of options) {
    const s = planScore(p, plan);
    if (s > bestScore) {
      bestScore = s;
      best = plan;
    }
  }
  return best;
}

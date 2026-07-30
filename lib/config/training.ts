// ── Player development training plans (§5, v8) ─────────────────────────────
// EA-FC-style, but table-driven and honest: each plan is pure data describing
// (a) where a player's seasonal growth is *biased* to flow across the six
// attributes, and (b) a small growth-rate nudge (focused training develops a
// little faster than an unfocused "balanced" plan). The development pass reads
// these weights — the engine never special-cases a plan by name.
//
// A plan only shapes *positive* growth (a player still growing toward their
// potential). It never raises the ceiling or rescues a declining veteran; it
// steers where the room that already exists gets spent, and slightly how fast.

import type { PlayerBio, Pos } from "../types";
import { getArchetype } from "./archetypes";
import { ATTR_WEIGHTS } from "./positions";
import { ATTR_FAMILIES, ATTR_KEYS, GK_ATTR_KEYS, type AttrFamily, type AttrKey } from "./attributes";

export type { AttrKey };

export type TrainingPlanId =
  | "balanced"
  | "pace"
  | "finishing"
  | "playmaking"
  | "dribbling"
  | "defending"
  | "physical"
  | "goalkeeping";

export interface TrainingPlanDef {
  id: TrainingPlanId;
  name: string;
  blurb: string;
  /** Authored emphasis across the six card faces (0..1), the readable form. */
  shape: Record<AttrFamily, number>;
  /** The same emphasis fanned out over all 35 attributes (0..1). Derived at
   * module load; the development pass reads this. */
  weights: Record<AttrKey, number>;
  /** Growth-rate multiplier. Focused plans train a little faster than balanced
   * (which sits at 1.0); the spread is deliberately small so a plan is an edge,
   * not a cheat. */
  growthMult: number;
  /** Which position groups this plan is offered to (UI gating). "any" = all. */
  posGroups: ("gk" | "def" | "mid" | "att" | "any")[];
}

export { ATTR_KEYS };

/** Per-attribute emphasis inside a plan, where the family level alone is too
 * blunt. A multiplier on the family weight (1.0 = none), same idea as the
 * archetype tilt table. Only the attributes a plan genuinely targets are named.
 * Pure data. */
const PLAN_TILT: Partial<Record<TrainingPlanId, Partial<Record<AttrKey, number>>>> = {
  pace: { acceleration: 1.3, sprintSpeed: 1.3, agility: 1.15, balance: 1.1, stamina: 1.15 },
  finishing: { finishing: 1.35, shotPower: 1.2, positioning: 1.2, volleys: 1.15, longShots: 1.15, penalties: 1.1 },
  playmaking: { shortPassing: 1.25, longPassing: 1.3, vision: 1.35, crossing: 1.1, curve: 1.15, composure: 1.15 },
  dribbling: { dribbling: 1.35, ballControl: 1.3, agility: 1.2, balance: 1.15 },
  defending: {
    standingTackle: 1.3, slidingTackle: 1.25, markingAwareness: 1.3,
    interceptions: 1.3, headingAccuracy: 1.1, aggression: 1.1,
  },
  physical: { strength: 1.35, stamina: 1.3, jumping: 1.2, aggression: 1.1 },
  goalkeeping: {
    diving: 1.3, handling: 1.3, reflexes: 1.3, gkPositioning: 1.25,
    kicking: 1.2, gkSpeed: 1.1,
  },
};

/** Author a plan with six-family emphasis; `expandPlanWeights` fills in the 35. */
interface PlanSeed extends Omit<TrainingPlanDef, "weights"> {}

const PLAN_SEEDS: PlanSeed[] = [
  {
    id: "balanced",
    name: "Balanced",
    blurb: "No special focus — growth follows the player's natural profile.",
    shape: { pac: 1, sho: 1, pas: 1, dri: 1, def: 1, phy: 1 },
    growthMult: 1.0,
    posGroups: ["any"],
  },
  {
    id: "pace",
    name: "Pace & Movement",
    blurb: "Sprint work and off-the-ball movement — sharpens acceleration and speed.",
    shape: { pac: 1, sho: 0.2, pas: 0.2, dri: 0.5, def: 0.2, phy: 0.4 },
    growthMult: 1.06,
    posGroups: ["def", "mid", "att"],
  },
  {
    id: "finishing",
    name: "Finishing",
    blurb: "Shooting drills in and around the box — builds a cleaner, colder finisher.",
    shape: { pac: 0.2, sho: 1, pas: 0.2, dri: 0.5, def: 0.1, phy: 0.3 },
    growthMult: 1.06,
    posGroups: ["mid", "att"],
  },
  {
    id: "playmaking",
    name: "Playmaking",
    blurb: "Range of passing, vision and tempo — the creator's plan.",
    shape: { pac: 0.2, sho: 0.3, pas: 1, dri: 0.6, def: 0.2, phy: 0.2 },
    growthMult: 1.06,
    posGroups: ["def", "mid", "att"],
  },
  {
    id: "dribbling",
    name: "Ball Control",
    blurb: "Close control and one-v-one work — a tighter, trickier dribbler.",
    shape: { pac: 0.4, sho: 0.3, pas: 0.4, dri: 1, def: 0.1, phy: 0.2 },
    growthMult: 1.06,
    posGroups: ["mid", "att"],
  },
  {
    id: "defending",
    name: "Defending",
    blurb: "Positioning, tackling and reading the game — the defender's plan.",
    shape: { pac: 0.3, sho: 0.1, pas: 0.3, dri: 0.2, def: 1, phy: 0.6 },
    growthMult: 1.06,
    posGroups: ["def", "mid"],
  },
  {
    id: "physical",
    name: "Strength & Stamina",
    blurb: "Gym and conditioning work — a stronger, more durable athlete.",
    shape: { pac: 0.5, sho: 0.2, pas: 0.2, dri: 0.2, def: 0.4, phy: 1 },
    growthMult: 1.05,
    posGroups: ["def", "mid", "att"],
  },
  {
    id: "goalkeeping",
    name: "Goalkeeping",
    blurb: "Shot-stopping, handling and distribution — the keeper's all-round plan.",
    // A keeper plan spreads across the whole keeper profile rather than spiking
    // one skill; the goalkeeping attributes are lifted by PLAN_TILT below.
    shape: { pac: 0.5, sho: 0.8, pas: 0.7, dri: 0.6, def: 0.9, phy: 0.9 },
    growthMult: 1.05,
    posGroups: ["gk"],
  },
];

/** Fan a plan's six-family shape out across all 35 attributes. */
function expandPlanWeights(seed: PlanSeed): Record<AttrKey, number> {
  const tilt = PLAN_TILT[seed.id] ?? {};
  const isGkPlan = seed.posGroups.includes("gk");
  const out = {} as Record<AttrKey, number>;
  for (const k of ATTR_KEYS) {
    let level: number;
    if (GK_ATTR_KEYS.includes(k)) {
      // Goalkeeping attributes are only a training target on a keeper plan;
      // outfield plans leave them alone rather than wasting growth there.
      level = isGkPlan ? Math.max(...Object.values(seed.shape)) : 0.1;
    } else {
      const fam = (Object.keys(ATTR_FAMILIES) as AttrFamily[]).find((f) => ATTR_FAMILIES[f].includes(k));
      level = fam ? seed.shape[fam] : 0.5;
    }
    out[k] = Math.max(0.05, Math.min(1, level * (tilt[k] ?? 1)));
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

export const DEFAULT_TRAINING_PLAN: TrainingPlanId = "balanced";

/** The position group a plan-picker should offer plans for. */
export function posGroupOf(pos: Pos): "gk" | "def" | "mid" | "att" {
  if (pos === "GK") return "gk";
  if (pos === "CB" || pos === "LB" || pos === "RB") return "def";
  if (pos === "DM" || pos === "CM" || pos === "AM") return "mid";
  return "att";
}

/** Plans available to a given primary position (for the UI dropdown). GKs only
 * ever see Balanced + Goalkeeping; outfielders never see Goalkeeping. */
export function plansForPosition(pos: Pos): TrainingPlanDef[] {
  const g = posGroupOf(pos);
  return TRAINING_PLANS.filter((p) => p.posGroups.includes("any") || p.posGroups.includes(g));
}

/** Resolve a (possibly undefined / stale) plan id to a definition, honoring the
 * player's position — an invalid or position-mismatched id falls back to Balanced. */
export function resolveTrainingPlan(planId: string | undefined, pos: Pos): TrainingPlanDef {
  const def = planId ? TRAINING_PLAN_MAP[planId] : undefined;
  if (!def) return TRAINING_PLAN_MAP[DEFAULT_TRAINING_PLAN];
  const g = posGroupOf(pos);
  if (!(def.posGroups.includes("any") || def.posGroups.includes(g))) {
    return TRAINING_PLAN_MAP[DEFAULT_TRAINING_PLAN];
  }
  return def;
}

// ── Optimal-plan resolution (v15 auto-assign) ─────────────────────────────

/**
 * Score how much a plan would raise a player's OVERALL, and pick the best.
 *
 * The logic follows straight from how the game already works, with no new
 * rules: overall is a position-weighted blend of the six attributes
 * (ATTR_WEIGHTS), growth flows toward the archetype's signature attributes
 * nudged by the plan's weights (development.distributeAttrs), and a focused
 * plan trains slightly faster than balanced (growthMult).
 *
 * So a plan's value is: for each attribute, how much of the season's growth it
 * would steer there × how much that attribute matters at this position ×
 * how much room the attribute still has to grow — all scaled by the plan's
 * growth rate. Attributes already near the 99 ceiling are discounted, which is
 * what stops the picker from endlessly pouring growth into a maxed-out stat.
 *
 * Pure and deterministic — no RNG, no state. The same player always resolves to
 * the same recommendation, so the auto-assign button is predictable.
 */
export function planScore(p: PlayerBio, plan: TrainingPlanDef): number {
  const profile = getArchetype(p.archetypeId).attrProfile;
  const posW = ATTR_WEIGHTS[p.positions[0]] ?? ATTR_WEIGHTS.CM;
  const maxProfile = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;

  // distributeAttrs() splits a fixed overall delta across the attributes using
  // these shares. The shares are NOT normalised there — a plan that raises every
  // weight would simply hand out more total attribute points than the delta
  // justifies. To compare plans fairly we normalise: each plan distributes the
  // same unit of growth, and the question is only WHERE it lands. Without this
  // the flat "balanced" plan wins every comparison purely by having the largest
  // raw weights, which is not a real advantage.
  const shares: number[] = [];
  let totalShare = 0;
  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxProfile; // archetype signature strength, 0..1
    const share = (0.5 + 0.9 * rel) * (0.55 + 0.9 * plan.weights[k]);
    shares.push(share);
    totalShare += share;
  }
  if (totalShare <= 0) return 0;

  // Value of the growth: how much each attribute point actually moves OVERALL
  // at this position (posW is the position's attribute weighting, and overall
  // is a weighted mean of the six).
  //
  // Headroom is a CAP, not a target. Only the last few points before 99 are
  // genuinely wasted, so it enters as a saturating factor rather than a linear
  // one. Weighting by raw remaining headroom would invert the recommendation —
  // it would push a Stopper toward pace training precisely because his pace is
  // low, when the whole point of the archetype is that his growth belongs in
  // defending and physicality.
  let value = 0;
  ATTR_KEYS.forEach((k, i) => {
    const headroom = Math.max(0, 99 - p.attrs[k]);
    // ~1.0 while there's real room, falling off only as the attribute nears 99.
    const usable = Math.min(1, headroom / 12);
    // Only positively-weighted attributes are worth training toward: growth into
    // a negatively-weighted one would lower the rating.
    const w = Math.max(0, posW[k] ?? 0);
    value += (shares[i] / totalShare) * w * usable;
  });

  // A focused plan also trains slightly faster than balanced.
  return value * plan.growthMult;
}

/**
 * The training plan that would most improve this player, from the plans his
 * position is actually offered. Ties break toward the earlier plan in the
 * table, so the result is stable.
 */
export function optimalTrainingPlan(p: PlayerBio): TrainingPlanDef {
  const options = plansForPosition(p.positions[0]);
  let best = options[0] ?? TRAINING_PLAN_MAP[DEFAULT_TRAINING_PLAN];
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

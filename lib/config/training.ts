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

import type { Attributes, PlayerBio, Pos } from "../types";
import { getArchetype } from "./archetypes";
import { ATTR_WEIGHTS } from "./positions";

export type AttrKey = keyof Attributes; // pac | sho | pas | dri | def | phy

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
  /** Per-attribute emphasis (0..1). Growth is redistributed toward the higher
   * weights. `balanced` is flat, so it matches the archetype's natural spread. */
  weights: Record<AttrKey, number>;
  /** Growth-rate multiplier. Focused plans train a little faster than balanced
   * (which sits at 1.0); the spread is deliberately small so a plan is an edge,
   * not a cheat. */
  growthMult: number;
  /** Which position groups this plan is offered to (UI gating). "any" = all. */
  posGroups: ("gk" | "def" | "mid" | "att" | "any")[];
}

// Keys in a stable order for iteration.
export const ATTR_KEYS: AttrKey[] = ["pac", "sho", "pas", "dri", "def", "phy"];

export const TRAINING_PLANS: TrainingPlanDef[] = [
  {
    id: "balanced",
    name: "Balanced",
    blurb: "No special focus — growth follows the player's natural profile.",
    weights: { pac: 1, sho: 1, pas: 1, dri: 1, def: 1, phy: 1 },
    growthMult: 1.0,
    posGroups: ["any"],
  },
  {
    id: "pace",
    name: "Pace & Movement",
    blurb: "Sprint work and off-the-ball movement — sharpens acceleration and speed.",
    weights: { pac: 1, sho: 0.2, pas: 0.2, dri: 0.5, def: 0.2, phy: 0.4 },
    growthMult: 1.06,
    posGroups: ["def", "mid", "att"],
  },
  {
    id: "finishing",
    name: "Finishing",
    blurb: "Shooting drills in and around the box — builds a cleaner, colder finisher.",
    weights: { pac: 0.2, sho: 1, pas: 0.2, dri: 0.5, def: 0.1, phy: 0.3 },
    growthMult: 1.06,
    posGroups: ["mid", "att"],
  },
  {
    id: "playmaking",
    name: "Playmaking",
    blurb: "Range of passing, vision and tempo — the creator's plan.",
    weights: { pac: 0.2, sho: 0.3, pas: 1, dri: 0.6, def: 0.2, phy: 0.2 },
    growthMult: 1.06,
    posGroups: ["def", "mid", "att"],
  },
  {
    id: "dribbling",
    name: "Ball Control",
    blurb: "Close control and one-v-one work — a tighter, trickier dribbler.",
    weights: { pac: 0.4, sho: 0.3, pas: 0.4, dri: 1, def: 0.1, phy: 0.2 },
    growthMult: 1.06,
    posGroups: ["mid", "att"],
  },
  {
    id: "defending",
    name: "Defending",
    blurb: "Positioning, tackling and reading the game — the defender's plan.",
    weights: { pac: 0.3, sho: 0.1, pas: 0.3, dri: 0.2, def: 1, phy: 0.6 },
    growthMult: 1.06,
    posGroups: ["def", "mid"],
  },
  {
    id: "physical",
    name: "Strength & Stamina",
    blurb: "Gym and conditioning work — a stronger, more durable athlete.",
    weights: { pac: 0.5, sho: 0.2, pas: 0.2, dri: 0.2, def: 0.4, phy: 1 },
    growthMult: 1.05,
    posGroups: ["def", "mid", "att"],
  },
  {
    id: "goalkeeping",
    name: "Goalkeeping",
    blurb: "Shot-stopping, handling and distribution — the keeper's all-round plan.",
    // GKs read the six slots with keeper labels (DEF=diving, PHY=handling, etc.),
    // so a keeper plan spreads across their whole profile rather than a spike.
    weights: { pac: 0.5, sho: 0.8, pas: 0.7, dri: 0.6, def: 0.9, phy: 0.9 },
    growthMult: 1.05,
    posGroups: ["gk"],
  },
];

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
    value += (shares[i] / totalShare) * posW[k] * usable;
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

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

import type { Attributes, Pos } from "../types";

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

// Position → phase contribution weights (GAME_DESIGN.md §7 step 2) and
// position adjacency for out-of-position penalties. Pure data.

import type { Pos, Attributes } from "../types";

export interface PhaseWeights {
  attack: number;
  midfield: number;
  defense: number;
}

// ── Attribute → overall weighting (v2 attribute-driven model) ──────────────
// Overall is DERIVED from the six attributes, weighted by position, so the same
// attribute line yields a different overall at different positions (a 30-defending
// striker is still elite; that same line at CB is not). Standard FIFA attribute
// order: pac, sho, pas, dri, def, phy. For goalkeepers the six slots carry keeper
// skills — def = reflexes/handling, phy = aerial/diving — so a GK's overall keys
// on def+phy and all but ignores sho.
//
// Each row MUST sum to 1.0. This is pure data — the balance pass (npm run
// calibrate) tunes these numbers; never tune them in engine code.
export const ATTR_WEIGHTS: Record<Pos, Attributes> = {
  GK: { pac: 0.05, sho: 0.02, pas: 0.14, dri: 0.03, def: 0.42, phy: 0.34 },
  CB: { pac: 0.14, sho: 0.04, pas: 0.12, dri: 0.06, def: 0.40, phy: 0.24 },
  LB: { pac: 0.24, sho: 0.06, pas: 0.18, dri: 0.16, def: 0.24, phy: 0.12 },
  RB: { pac: 0.24, sho: 0.06, pas: 0.18, dri: 0.16, def: 0.24, phy: 0.12 },
  DM: { pac: 0.10, sho: 0.08, pas: 0.26, dri: 0.14, def: 0.30, phy: 0.12 },
  CM: { pac: 0.10, sho: 0.14, pas: 0.30, dri: 0.22, def: 0.14, phy: 0.10 },
  AM: { pac: 0.12, sho: 0.22, pas: 0.28, dri: 0.26, def: 0.04, phy: 0.08 },
  LW: { pac: 0.24, sho: 0.20, pas: 0.14, dri: 0.30, def: 0.04, phy: 0.08 },
  RW: { pac: 0.24, sho: 0.20, pas: 0.14, dri: 0.30, def: 0.04, phy: 0.08 },
  ST: { pac: 0.20, sho: 0.34, pas: 0.08, dri: 0.20, def: 0.02, phy: 0.16 },
};

const ATTR_KEYS = ["pac", "sho", "pas", "dri", "def", "phy"] as const;

/**
 * Derive a player's overall (1–99) from their six attributes and PRIMARY
 * position. Two parts:
 *   1. a position-weighted mean (ATTR_WEIGHTS) — so weak-but-irrelevant
 *      attributes (a striker's defending) barely register;
 *   2. a convex "specialist" bonus that lifts a lopsided elite (96 pace / 99
 *      shooting) above the flat mean, so signature quality reads on the badge.
 * The bonus is proportional to how far the player's two strongest *weighted*
 * attributes sit above the weighted mean.
 */
export function overallFromAttrs(attrs: Attributes, primaryPos: Pos): number {
  const w = ATTR_WEIGHTS[primaryPos] ?? ATTR_WEIGHTS.CM;
  let base = 0;
  for (const k of ATTR_KEYS) base += attrs[k] * w[k];
  // top-2 by weighted contribution → reward specialists
  const ranked = ATTR_KEYS.map((k) => ({ v: attrs[k], wc: attrs[k] * w[k] })).sort((a, b) => b.wc - a.wc);
  const peak = (ranked[0].v + ranked[1].v) / 2;
  const bonus = Math.max(0, peak - base) * OVERALL_PEAK_BONUS;
  return Math.max(1, Math.min(99, Math.round(base + bonus)));
}

/** How strongly an elite specialist's peak attributes lift overall above the
 * flat weighted mean (v2). Tuned in the balance pass. */
export const OVERALL_PEAK_BONUS = 0.35;

export const PHASE_WEIGHTS: Record<Pos, PhaseWeights> = {
  GK: { attack: 0, midfield: 0, defense: 1.0 },
  CB: { attack: 0.05, midfield: 0.1, defense: 1.0 },
  LB: { attack: 0.2, midfield: 0.45, defense: 0.75 },
  RB: { attack: 0.2, midfield: 0.45, defense: 0.75 },
  DM: { attack: 0.1, midfield: 0.85, defense: 0.55 },
  CM: { attack: 0.35, midfield: 1.0, defense: 0.3 },
  AM: { attack: 0.7, midfield: 0.75, defense: 0.1 },
  LW: { attack: 0.85, midfield: 0.45, defense: 0.1 },
  RW: { attack: 0.85, midfield: 0.45, defense: 0.1 },
  ST: { attack: 1.0, midfield: 0.1, defense: 0 },
};

// Adjacency groups: playing an adjacent position costs ×adjacentPositionMult,
// anything further costs ×outOfPositionFloor. GK is never adjacent to outfield.
// Left/right of the same role are adjacent to each other (a LB covers RB at a
// small penalty), but the primary/secondary multi-position handling in worldgen
// is what makes some players genuinely two-footed there.
const ADJACENT: Record<Pos, Pos[]> = {
  GK: [],
  CB: ["LB", "RB", "DM"],
  LB: ["CB", "LW", "RB", "DM"],
  RB: ["CB", "RW", "LB", "DM"],
  DM: ["CB", "CM"],
  CM: ["DM", "AM"],
  AM: ["CM", "LW", "RW", "ST"],
  LW: ["AM", "RW", "ST", "LB"],
  RW: ["AM", "LW", "ST", "RB"],
  ST: ["AM", "LW", "RW"],
};

export function positionFit(
  playerPositions: Pos[],
  slotPos: Pos,
  adjacentMult: number,
  floor: number
): number {
  if (playerPositions.includes(slotPos)) return 1.0;
  if (slotPos === "GK" || playerPositions[0] === "GK") return floor * 0.5; // outfielder in goal = disaster
  for (const p of playerPositions) {
    if (ADJACENT[p]?.includes(slotPos)) return adjacentMult;
  }
  return floor;
}

export const POS_LABELS: Record<Pos, string> = {
  GK: "Goalkeeper",
  CB: "Centre Back",
  LB: "Left Back",
  RB: "Right Back",
  DM: "Defensive Mid",
  CM: "Central Mid",
  AM: "Attacking Mid",
  LW: "Left Wing",
  RW: "Right Wing",
  ST: "Striker",
};

export const POS_ORDER: Pos[] = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];

// Broad position groups drive the legend / fallback tinting:
// GK = blue, defenders = green, midfielders = yellow, attackers = red.
export type PosGroup = "GK" | "DEF" | "MID" | "ATT";

export const POS_GROUP: Record<Pos, PosGroup> = {
  GK: "GK",
  CB: "DEF",
  LB: "DEF",
  RB: "DEF",
  DM: "MID",
  CM: "MID",
  AM: "MID",
  LW: "ATT",
  RW: "ATT",
  ST: "ATT",
};

/** Group colors: [background, text]. Used for legends and as the badge fallback. */
export const POS_GROUP_COLORS: Record<PosGroup, { bg: string; fg: string; label: string }> = {
  GK: { bg: "#2563eb", fg: "#ffffff", label: "Goalkeeper" },
  DEF: { bg: "#16a34a", fg: "#ffffff", label: "Defender" },
  MID: { bg: "#eab308", fg: "#1a1400", label: "Midfielder" },
  ATT: { bg: "#dc2626", fg: "#ffffff", label: "Attacker" },
};

/**
 * Per-position badge colors (§ visual tuning). Each position shades within its
 * group so the pitch reads at a glance: CB is a deeper green than the flanking
 * full backs; DM sits darker on the yellow scale and AM lighter; the wingers are
 * a lighter red than the striker. Positions without a bespoke color fall back to
 * their group color via posColors().
 */
const POS_COLOR_OVERRIDES: Partial<Record<Pos, { bg: string; fg: string }>> = {
  CB: { bg: "#14532d", fg: "#ffffff" }, // darker green
  DM: { bg: "#a16207", fg: "#ffffff" }, // darker yellow
  AM: { bg: "#facc15", fg: "#1a1400" }, // lighter yellow
  LW: { bg: "#f87171", fg: "#1a0505" }, // lighter red
  RW: { bg: "#f87171", fg: "#1a0505" }, // lighter red
};

export function posGroup(pos: Pos): PosGroup {
  return POS_GROUP[pos] ?? "MID";
}

/**
 * Map a badge string — a real Pos or a formation slot label like "LM", "RM",
 * "LWB", "RWB" — onto the Pos whose color it should wear. Slot labels that don't
 * name a Pos directly still need to tint correctly (the LB/RB-shows-yellow bug
 * came from labels falling through to the MID default).
 */
const LABEL_TO_POS: Record<string, Pos> = {
  LM: "LW",
  RM: "RW",
  LWB: "LB",
  RWB: "RB",
  WB: "LB",
  FB: "LB",
  W: "LW",
};

export function resolvePos(posOrLabel: Pos | string): Pos {
  if (posOrLabel in POS_GROUP) return posOrLabel as Pos;
  return LABEL_TO_POS[posOrLabel] ?? "CM";
}

/** Resolved badge color for a position: bespoke override, else group color. */
export function posColors(pos: Pos): { bg: string; fg: string; label: string } {
  const group = POS_GROUP_COLORS[posGroup(pos)];
  const override = POS_COLOR_OVERRIDES[pos];
  return override ? { ...override, label: POS_LABELS[pos] ?? group.label } : group;
}

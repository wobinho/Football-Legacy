// Position → phase contribution weights (GAME_DESIGN.md §7 step 2) and
// position adjacency for out-of-position penalties. Pure data.

import type { Pos, Attributes } from "../types";

export interface PhaseWeights {
  attack: number;
  midfield: number;
  defense: number;
}

// ── Attribute → overall weighting (v3: the FC 26 model) ────────────────────
// Overall is DERIVED from the six attributes, weighted by position, so the same
// attribute line yields a different overall at different positions (a 30-defending
// striker is still elite; that same line at CB is not). Standard FIFA attribute
// order: pac, sho, pas, dri, def, phy. For goalkeepers the six slots carry keeper
// skills — pac=diving, sho=handling, pas=kicking, dri=reflexes, def=speed,
// phy=positioning — matching the FUT card layout the model was fitted against.
//
// These are the published FC 26 weights (see OVERALL_FORMULA.md), verified
// against 18,405 real players at 93.9% exact / 100% within ±1. Each row sums to
// 1.0, which makes the formula a true weighted average plus a small positional
// constant — and therefore trivially invertible (see fitAttrsToOverall).
//
// Zero weights are REAL, not placeholders: a centre-back's shooting and a
// keeper's speed genuinely do not move the rating.
//
// This is pure data — never tune it in engine code.
export const ATTR_WEIGHTS: Record<Pos, Attributes> = {
  GK: { pac: 0.2128, sho: 0.2125, pas: 0.0484, dri: 0.3176, def: 0.0000, phy: 0.2088 },
  CB: { pac: 0.0198, sho: 0.0000, pas: 0.0503, dri: 0.0950, def: 0.6430, phy: 0.1919 },
  LB: { pac: 0.1157, sho: 0.0000, pas: 0.1603, dri: 0.1590, def: 0.4890, phy: 0.0760 },
  RB: { pac: 0.1147, sho: 0.0000, pas: 0.1645, dri: 0.1582, def: 0.4855, phy: 0.0771 },
  DM: { pac: 0.0027, sho: 0.0000, pas: 0.2834, dri: 0.1797, def: 0.3948, phy: 0.1394 },
  CM: { pac: 0.0023, sho: 0.1191, pas: 0.4196, dri: 0.3001, def: 0.1026, phy: 0.0563 },
  LM: { pac: 0.1248, sho: 0.1467, pas: 0.3187, dri: 0.3594, def: 0.0027, phy: 0.0478 },
  RM: { pac: 0.1260, sho: 0.1445, pas: 0.3264, dri: 0.3524, def: 0.0026, phy: 0.0482 },
  AM: { pac: 0.0697, sho: 0.2097, pas: 0.3364, dri: 0.3807, def: 0.0000, phy: 0.0035 },
  LW: { pac: 0.1245, sho: 0.2306, pas: 0.2506, dri: 0.3911, def: 0.0000, phy: 0.0031 },
  RW: { pac: 0.1268, sho: 0.2335, pas: 0.2453, dri: 0.3910, def: 0.0007, phy: 0.0028 },
  ST: { pac: 0.0874, sho: 0.4636, pas: 0.0498, dri: 0.2541, def: 0.0987, phy: 0.0465 },
};

/** Per-position additive constant (FC 26 model). Small everywhere except the
 * full-backs, where EA genuinely runs ~2 points hot: an LB with all six stats
 * at 70 rates 72. Reproduced verbatim rather than normalised away. */
export const OVERALL_CONSTANT: Record<Pos, number> = {
  GK: 0.97,
  CB: 0.08,
  LB: 2.09,
  RB: 2.05,
  DM: 0.96,
  CM: 0.16,
  LM: 1.04,
  RM: 1.07,
  AM: 0.12,
  LW: 0.22,
  RW: 0.20,
  ST: 0.09,
};

const ATTR_KEYS = ["pac", "sho", "pas", "dri", "def", "phy"] as const;

/**
 * Derive a player's overall (1–99) from their six attributes and PRIMARY
 * position, using the FC 26 model: a position-weighted mean of the six
 * attributes plus a small positional constant, rounded and clamped.
 *
 * Attributes are deliberately NOT rounded before multiplying — callers holding
 * fractional attributes (the imported real-world database stores them to 2dp)
 * get the more accurate rating.
 */
export function overallFromAttrs(attrs: Attributes, primaryPos: Pos): number {
  const w = ATTR_WEIGHTS[primaryPos] ?? ATTR_WEIGHTS.CM;
  let total = OVERALL_CONSTANT[primaryPos] ?? OVERALL_CONSTANT.CM;
  for (const k of ATTR_KEYS) total += attrs[k] * w[k];
  return Math.max(1, Math.min(99, Math.round(total)));
}

/**
 * Shift a set of attributes so they rate exactly `target` at `primaryPos`.
 * Because each weight row sums to 1.0, adding δ to every weight-bearing
 * attribute moves the overall by exactly δ — so this is a single pass, no
 * search. Zero-weight slots are left alone, so a centre-back's shooting is
 * never inflated by a number that does nothing for his rating.
 */
export function fitAttrsToOverall(attrs: Attributes, primaryPos: Pos, target: number): Attributes {
  const w = ATTR_WEIGHTS[primaryPos] ?? ATTR_WEIGHTS.CM;
  const d = target - overallFromAttrs(attrs, primaryPos);
  const out = { ...attrs };
  for (const k of ATTR_KEYS) {
    if (w[k] > 1e-6) out[k] = Math.max(1, Math.min(99, Math.round(attrs[k] + d)));
  }
  return out;
}

export const PHASE_WEIGHTS: Record<Pos, PhaseWeights> = {
  GK: { attack: 0, midfield: 0, defense: 1.0 },
  CB: { attack: 0.05, midfield: 0.1, defense: 1.0 },
  LB: { attack: 0.2, midfield: 0.45, defense: 0.75 },
  RB: { attack: 0.2, midfield: 0.45, defense: 0.75 },
  DM: { attack: 0.1, midfield: 0.85, defense: 0.55 },
  CM: { attack: 0.35, midfield: 1.0, defense: 0.3 },
  LM: { attack: 0.55, midfield: 0.7, defense: 0.3 },
  RM: { attack: 0.55, midfield: 0.7, defense: 0.3 },
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
  LB: ["CB", "LW", "LM", "RB", "DM"],
  RB: ["CB", "RW", "RM", "LB", "DM"],
  DM: ["CB", "CM"],
  CM: ["DM", "AM", "LM", "RM"],
  LM: ["LW", "CM", "RM", "AM", "LB"],
  RM: ["RW", "CM", "LM", "AM", "RB"],
  AM: ["CM", "LM", "RM", "LW", "RW", "ST"],
  LW: ["AM", "LM", "RW", "ST", "LB"],
  RW: ["AM", "RM", "LW", "ST", "RB"],
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
  LM: "Left Mid",
  RM: "Right Mid",
  AM: "Attacking Mid",
  LW: "Left Wing",
  RW: "Right Wing",
  ST: "Striker",
};

export const POS_ORDER: Pos[] = ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"];

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
  LM: "MID",
  RM: "MID",
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
  LM: { bg: "#eab308", fg: "#1a1400" }, // wide-mid yellow (between DM and AM)
  RM: { bg: "#eab308", fg: "#1a1400" }, // wide-mid yellow (between DM and AM)
  AM: { bg: "#facc15", fg: "#1a1400" }, // lighter yellow
  LW: { bg: "#f87171", fg: "#1a0505" }, // lighter red
  RW: { bg: "#f87171", fg: "#1a0505" }, // lighter red
};

export function posGroup(pos: Pos): PosGroup {
  return POS_GROUP[pos] ?? "MID";
}

/**
 * Map a badge string — a real Pos or a formation slot label like "LWB", "RWB",
 * "WB", "FB" — onto the Pos whose color it should wear. Slot labels that don't
 * name a Pos directly still need to tint correctly (the LB/RB-shows-yellow bug
 * came from labels falling through to the MID default). LM/RM are now real Pos
 * values, so they resolve directly and no longer route through this table.
 */
const LABEL_TO_POS: Record<string, Pos> = {
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

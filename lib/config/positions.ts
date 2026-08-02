// Position → phase contribution weights (GAME_DESIGN.md §7 step 2) and
// position adjacency for out-of-position penalties. Pure data.

import type { Pos, Attributes } from "../types";
import { ATTR_KEYS, type AttrKey } from "./attributes";

export interface PhaseWeights {
  attack: number;
  midfield: number;
  defense: number;
}

// ── Attribute → overall weighting (v41: the 35-attribute model) ────────────
// Overall is DERIVED from the 35 attributes, weighted by position, so the same
// attribute line yields a different overall at different positions (a striker
// who can't tackle is still elite; that same line at CB is not).
//
// Each row is a per-position regression: a weighted sum of the attributes plus
// an additive constant. Only the attributes a row actually names contribute —
// an omitted attribute has weight zero, which is REAL and not a placeholder. A
// centre-back's finishing and an outfielder's diving genuinely do not move the
// rating.
//
// Small NEGATIVE weights are real too and are reproduced verbatim. They are how
// the fit expresses "this attribute is evidence of the wrong kind of player at
// this position" — a centre-back whose composure is doing work his tackling
// isn't, say. Individually they are worth hundredths of a point.
//
// Row sums: every row, GK included, sums to ~0.99–1.02, so each behaves as a
// weighted mean and a uniform +δ across the row moves the rating by ~δ.
//
// Note that the GK row weights BOTH positioning attributes, and they are not
// interchangeable: `gkPositioning` (the keeper's placement and angles) is one of
// its five big terms at 0.2082, while the outfield `positioning` (attacking
// movement) is a rounding error at 0.0037.
//
// This is pure data — never tune it in engine code.

/** A position's weight row: the attributes it names, and their coefficients.
 * Partial by construction — an unnamed attribute contributes nothing. */
export type AttrWeightRow = Partial<Record<AttrKey, number>>;

export const ATTR_WEIGHTS: Record<Pos, AttrWeightRow> = {
  GK: {
    handling: 0.2129, diving: 0.2123, reflexes: 0.2088, gkPositioning: 0.2082,
    reactions: 0.1089, kicking: 0.0615, gkSpeed: -0.0209, shotPower: -0.0172,
    jumping: 0.0115, acceleration: 0.0097, sprintSpeed: 0.0076, slidingTackle: -0.0076,
    finishing: -0.0059, standingTackle: 0.0052, strength: -0.0051, longShots: -0.0041,
    positioning: 0.0037, dribbling: 0.0034, aggression: 0.0025, headingAccuracy: -0.0023,
    ballControl: -0.0022, volleys: -0.0021, crossing: 0.0017, interceptions: 0.0016,
    markingAwareness: -0.0012, agility: -0.001, fkAccuracy: 0.001, composure: -0.0009,
    curve: -0.0009, vision: 0.0007, longPassing: -0.0007, shortPassing: -0.0001,
    balance: 0.0001, stamina: 0.0001,
  },
  CB: {
    standingTackle: 0.1766, markingAwareness: 0.1444, interceptions: 0.1264,
    headingAccuracy: 0.101, slidingTackle: 0.0989, strength: 0.096, aggression: 0.0668,
    reactions: 0.0541, shortPassing: 0.0523, ballControl: 0.0428, jumping: 0.0272,
    sprintSpeed: 0.0187, kicking: -0.0036, handling: -0.0032, composure: -0.003,
    acceleration: 0.0024, penalties: -0.002, agility: -0.0017, volleys: -0.0016,
    longPassing: -0.0014, stamina: 0.0013, reflexes: -0.0013, diving: 0.0013, curve: 0.0008,
    positioning: 0.0005, vision: 0.0004, longShots: 0.0003, balance: 0.0003,
    shotPower: -0.0003, fkAccuracy: 0.0001, crossing: 0.0001,
  },
  LB: {
    slidingTackle: 0.1411, interceptions: 0.1183, standingTackle: 0.1077, crossing: 0.0926,
    reactions: 0.0885, markingAwareness: 0.0813, stamina: 0.0762, ballControl: 0.0739,
    shortPassing: 0.0716, sprintSpeed: 0.066, acceleration: 0.0526, headingAccuracy: 0.0428,
    shotPower: -0.0031, kicking: -0.0031, longPassing: -0.0023, penalties: -0.0019,
    longShots: 0.0019, fkAccuracy: 0.0017, dribbling: -0.0016, balance: -0.0016,
    handling: -0.0015, agility: -0.0013, finishing: 0.0011, composure: -0.0011,
    jumping: -0.001, diving: -0.0009, curve: -0.0007, vision: -0.0006, positioning: -0.0004,
    strength: 0.0003, volleys: 0.0002, reflexes: -0.0001, aggression: 0.0001,
  },
  RB: {
    slidingTackle: 0.1366, interceptions: 0.1177, standingTackle: 0.1177, crossing: 0.0939,
    reactions: 0.0891, stamina: 0.0781, markingAwareness: 0.0778, shortPassing: 0.0719,
    ballControl: 0.0707, sprintSpeed: 0.069, acceleration: 0.0495, headingAccuracy: 0.0431,
    jumping: -0.0053, diving: 0.0046, reflexes: 0.0044, aggression: -0.0028,
    handling: -0.0021, agility: -0.0021, finishing: 0.0014, balance: 0.0012, strength: 0.0011,
    shotPower: -0.0011, positioning: -0.001, longPassing: -0.0009, volleys: -0.0009,
    dribbling: -0.0009, vision: 0.0007, fkAccuracy: -0.0002, curve: 0.0002, kicking: 0.0002,
    composure: 0.0002, penalties: -0.0001,
  },
  DM: {
    shortPassing: 0.149, interceptions: 0.1404, standingTackle: 0.1223, ballControl: 0.1049,
    longPassing: 0.1014, markingAwareness: 0.0888, reactions: 0.0802, stamina: 0.0571,
    aggression: 0.0465, slidingTackle: 0.0448, vision: 0.0388, strength: 0.0376,
    composure: -0.0064, diving: -0.0062, reflexes: 0.0044, kicking: -0.0033,
    dribbling: -0.0032, jumping: -0.003, shotPower: 0.0026, penalties: -0.0019,
    headingAccuracy: 0.0016, acceleration: 0.0015, sprintSpeed: 0.0014, volleys: 0.0014,
    balance: -0.0011, agility: 0.001, fkAccuracy: -0.0008, curve: -0.0008, longShots: -0.0006,
    handling: -0.0006, crossing: -0.0004, positioning: -0.0003, finishing: -0.0001,
  },
  CM: {
    shortPassing: 0.165, ballControl: 0.1468, longPassing: 0.1326, vision: 0.131,
    reactions: 0.0903, dribbling: 0.0682, positioning: 0.0582, stamina: 0.0573,
    standingTackle: 0.0524, interceptions: 0.05, longShots: 0.0408, finishing: 0.0236,
    jumping: -0.0062, headingAccuracy: 0.0042, sprintSpeed: 0.0035, shotPower: -0.003,
    acceleration: 0.0029, reflexes: -0.0028, agility: -0.0022, diving: -0.0017,
    fkAccuracy: -0.0016, penalties: -0.0015, markingAwareness: -0.0015, composure: -0.0014,
    volleys: -0.0013, strength: 0.0011, handling: 0.001, slidingTackle: -0.0007,
    kicking: 0.0006, balance: -0.0006, curve: -0.0003, crossing: 0.0002, aggression: 0.0001,
  },
  AM: {
    shortPassing: 0.159, ballControl: 0.1476, vision: 0.1376, dribbling: 0.1306,
    positioning: 0.0918, reactions: 0.0805, finishing: 0.0723, longShots: 0.0506,
    longPassing: 0.0462, acceleration: 0.0439, sprintSpeed: 0.0303, agility: 0.0281,
    jumping: -0.0159, strength: 0.0104, headingAccuracy: 0.0075, handling: 0.0049,
    reflexes: -0.0026, fkAccuracy: -0.0025, composure: -0.0025, volleys: -0.0024,
    interceptions: -0.0023, shotPower: -0.0023, aggression: 0.0017, slidingTackle: -0.0016,
    diving: -0.0014, curve: -0.0012, stamina: 0.0012, penalties: -0.0012,
    markingAwareness: 0.0007, standingTackle: 0.0007, crossing: -0.0006, balance: 0.0006,
    kicking: -0.0002,
  },
  LM: {
    dribbling: 0.1538, ballControl: 0.1333, shortPassing: 0.1123, crossing: 0.1009,
    positioning: 0.086, reactions: 0.0749, acceleration: 0.0712, vision: 0.0661,
    finishing: 0.061, sprintSpeed: 0.0582, longPassing: 0.0467, stamina: 0.046,
    jumping: -0.0097, headingAccuracy: 0.0062, reflexes: -0.0061, strength: 0.0059,
    composure: -0.0045, handling: -0.0029, curve: -0.0028, diving: -0.0021,
    longShots: -0.002, aggression: 0.0019, volleys: 0.0018, shotPower: 0.0016,
    kicking: 0.0014, fkAccuracy: -0.0014, slidingTackle: 0.0012, penalties: -0.0009,
    interceptions: 0.0009, markingAwareness: -0.0007, standingTackle: -0.0003, agility: 0.0001,
  },
  RM: {
    dribbling: 0.1483, ballControl: 0.1319, shortPassing: 0.1156, crossing: 0.1005,
    positioning: 0.083, reactions: 0.0745, acceleration: 0.0704, vision: 0.0674,
    finishing: 0.0642, sprintSpeed: 0.056, stamina: 0.0481, longPassing: 0.0461,
    agility: -0.0038, penalties: -0.0031, jumping: 0.0031, kicking: -0.0027,
    balance: -0.0024, strength: -0.0023, composure: 0.0022, curve: -0.0019,
    slidingTackle: 0.0018, volleys: -0.0015, diving: -0.0014, aggression: -0.0012,
    longShots: -0.0011, markingAwareness: -0.0006, headingAccuracy: -0.0006,
    reflexes: -0.0005, fkAccuracy: -0.0005, shotPower: -0.0003, interceptions: -0.0002,
    handling: 0.0001, standingTackle: -0.0001,
  },
  LW: {
    dribbling: 0.1572, ballControl: 0.1381, finishing: 0.1048, crossing: 0.0998,
    positioning: 0.0955, shortPassing: 0.0901, reactions: 0.0732, vision: 0.0678,
    acceleration: 0.0659, sprintSpeed: 0.058, longShots: 0.0407, agility: 0.0277,
    diving: 0.0126, shotPower: -0.0097, kicking: -0.0073, handling: 0.0059,
    composure: -0.005, reflexes: -0.0045, volleys: -0.0037, fkAccuracy: -0.0031,
    jumping: 0.0026, markingAwareness: -0.0024, stamina: 0.0022, longPassing: -0.002,
    penalties: -0.0016, interceptions: 0.0015, standingTackle: -0.0014, strength: 0.0014,
    headingAccuracy: -0.0013, curve: 0.001, balance: -0.0009, slidingTackle: 0.0008,
    aggression: 0.0006,
  },
  RW: {
    dribbling: 0.1495, ballControl: 0.1453, finishing: 0.1059, crossing: 0.098,
    positioning: 0.0952, shortPassing: 0.0862, acceleration: 0.0792, reactions: 0.0731,
    vision: 0.0643, sprintSpeed: 0.0553, longShots: 0.0364, agility: 0.0264,
    jumping: -0.013, strength: 0.0111, standingTackle: -0.0062, headingAccuracy: 0.0058,
    composure: -0.0041, balance: 0.0031, slidingTackle: 0.0029, penalties: 0.0028,
    handling: 0.0026, interceptions: 0.0023, shotPower: -0.0021, stamina: -0.0018,
    longPassing: 0.0017, kicking: 0.0017, markingAwareness: 0.0013, reflexes: -0.0013,
    aggression: 0.0012, fkAccuracy: -0.001, volleys: -0.0007, curve: -0.0006, diving: 0.0003,
  },
  ST: {
    finishing: 0.19, positioning: 0.1342, ballControl: 0.1044, headingAccuracy: 0.1022,
    shotPower: 0.0951, reactions: 0.0863, dribbling: 0.0663, shortPassing: 0.0509,
    strength: 0.0493, sprintSpeed: 0.0471, acceleration: 0.0446, longShots: 0.0318,
    volleys: 0.0215, jumping: -0.0073, penalties: -0.0037, diving: -0.0032,
    standingTackle: 0.0028, markingAwareness: -0.0027, fkAccuracy: -0.0023,
    composure: -0.0019, curve: -0.0016, balance: -0.0014, reflexes: -0.0013,
    kicking: -0.0012, stamina: -0.0009, interceptions: 0.0009, agility: -0.0008,
    handling: -0.0007, aggression: 0.0004, crossing: 0.0003, vision: 0.0003,
    slidingTackle: -0.0003,
  },
};

/** Per-position additive constant. Reproduced verbatim from the fitted model
 * rather than normalised away — the full-backs genuinely run ~2 points hot. */
export const OVERALL_CONSTANT: Record<Pos, number> = {
  GK: 0.9132,
  CB: -0.0234,
  LB: 2.032,
  RB: 1.7321,
  DM: 0.7931,
  CM: -0.3578,
  AM: -0.5345,
  LM: 0.6664,
  RM: 1.4406,
  LW: 0.2026,
  RW: -0.7321,
  ST: -0.2116,
};

/** Sum of a position's weights. Precomputed once: `fitAttrsToOverall` divides by
 * it to convert a desired overall delta into a per-attribute shift, and it is
 * what makes that a single pass rather than a search. */
export const ATTR_WEIGHT_SUM: Record<Pos, number> = Object.fromEntries(
  (Object.keys(ATTR_WEIGHTS) as Pos[]).map((pos) => [
    pos,
    Object.values(ATTR_WEIGHTS[pos]).reduce((s, w) => s + (w ?? 0), 0),
  ])
) as Record<Pos, number>;

/**
 * Derive a player's overall (1–99) from their 35 attributes and PRIMARY
 * position: the position's weighted sum plus its additive constant, rounded and
 * clamped.
 *
 * Attributes are deliberately NOT rounded before multiplying — callers holding
 * fractional attributes get the more accurate rating.
 */
export function overallFromAttrs(attrs: Attributes, primaryPos: Pos): number {
  const w = ATTR_WEIGHTS[primaryPos] ?? ATTR_WEIGHTS.CM;
  let total = OVERALL_CONSTANT[primaryPos] ?? OVERALL_CONSTANT.CM;
  for (const k in w) {
    const weight = w[k as AttrKey];
    if (weight) total += (attrs[k as AttrKey] ?? 0) * weight;
  }
  return Math.max(1, Math.min(99, Math.round(total)));
}

/**
 * Shift a set of attributes so they rate (as close as possible to) `target` at
 * `primaryPos`.
 *
 * The shift is WEIGHT-PROPORTIONAL, not uniform. A uniform shift would move a
 * 0.0001-weight attribute exactly as far as a 0.2-weight one, which is both
 * unrealistic (a striker made better mostly gains free-kick accuracy) and
 * inefficient — almost all of the movement lands where it barely affects the
 * rating, so the attributes that DO matter have to be dragged much further to
 * compensate. The result was inflated junk stats on every player.
 *
 * Distributing in proportion to each attribute's weight instead means the shift
 * concentrates where the position actually rewards it: raising a centre-back
 * raises his tackling and marking, not his curve. The scaling factor is the sum
 * of SQUARED weights (rather than the plain sum) because each attribute is moved
 * by `delta × weight` and contributes `weight ×` that to the rating.
 *
 * Attributes the row doesn't name, or names negatively, are left alone —
 * lowering a real skill to game the rating would corrupt the player's profile.
 *
 * Clamping at 1/99 means an extreme target may not be reachable exactly, so a
 * few corrective passes run over whatever still has room.
 *
 * ── `bias`: whose shape the residual takes (v1.85) ────────────────────────
 * The distribution above is the right default for GENERATION — "make a striker
 * who rates 72" should produce a generic striker. It is the wrong one for
 * GROWTH, and that turned out to be why a training plan could never change who a
 * player was.
 *
 * Measured on a 17-year-old Sniper put on a Speedster plan: one season's growth
 * moved 12 attribute points through the plan and then **46 points through this
 * function** — 79% of all movement — distributed along the position's overall
 * weights. Because those weights reward whatever the position rewards, and the
 * player was already shaped that way, the fit poured its points straight back
 * into his existing identity: finishing +9 on a plan whose signature attributes
 * are acceleration and sprint speed. He grew 20 overall across 13 seasons on
 * that plan and never once read as a Speedster.
 *
 * So the residual now takes an optional shape. Passing a `bias` row (a training
 * plan's weights) distributes the gap in proportion to `positionWeight × bias`
 * instead of `positionWeight` alone: still concentrated where the position
 * actually rewards movement — a striker's rating must come from striker
 * attributes, and an unweighted attribute is still never touched — but tilted
 * toward what the plan trains. The rating the caller asked for is still hit
 * exactly; only its INTERNAL composition changes.
 *
 * Omitting `bias` keeps the old behaviour byte for byte, which is what every
 * generation path wants and what `verify:overall` checks.
 */
/**
 * How hard a biased fit leans toward the training plan (v1.85).
 *
 * The plan's signature attributes are moved `1 + this` times as hard as the ones
 * it ignores. Swept over 600 world-generated players × every plan valid at their
 * position, counting how many convert their derived archetype inside a 15-season
 * career:
 *
 *   tilt   0    1    3    6   10   16   24
 *   16-18 22%  29%  34%  40%  42%  44%  44%
 *   19-21 18%  22%  26%  30%  33%  34%  35%
 *
 * The curve is a knee, not a line: past ~10 the fit is already pulling as hard as
 * the position row allows and more tilt buys nothing. 6 takes most of the
 * available gain — it roughly doubles the old rate — while leaving the residual
 * recognisably position-shaped, which matters because this same function is what
 * keeps a striker's rating made of striker attributes. Going higher trades that
 * realism for a couple of points of conversion rate.
 */
const FIT_PLAN_TILT = 6;

export function fitAttrsToOverall(
  attrs: Attributes,
  primaryPos: Pos,
  target: number,
  bias?: Partial<Record<AttrKey, number>>
): Attributes {
  const w = ATTR_WEIGHTS[primaryPos] ?? ATTR_WEIGHTS.CM;
  const out = { ...attrs };

  // The effective weight each attribute is moved by. Without a bias this is the
  // position row itself (generation's behaviour); with one it is the position
  // row tilted toward what the plan trains. The bias never introduces an
  // attribute the position doesn't reward — multiplying by the position weight
  // keeps a goalkeeping stat off a striker no matter what the plan says.
  const eff = {} as Record<string, number>;
  let maxBias = 0;
  if (bias) for (const k of ATTR_KEYS) maxBias = Math.max(maxBias, bias[k] ?? 0);
  for (const k in w) {
    const key = k as AttrKey;
    const weight = w[key] ?? 0;
    if (weight <= 1e-6) continue;
    // A signature attribute of the plan is pulled `1 + FIT_PLAN_TILT` times as
    // hard as one the plan ignores. See that constant for how the number was
    // chosen; `npm run verify:conversion` is what holds it honest.
    const tilt = bias && maxBias > 0 ? 1 + FIT_PLAN_TILT * ((bias[key] ?? 0) / maxBias) : 1;
    eff[key] = weight * tilt;
  }

  // Σ(positionWeight × effectiveWeight): the rating change produced by shifting
  // every attribute one unit of `scale`. It pairs the two rows because the MOVE
  // is `scale × eff` while the RATING responds by `positionWeight ×` that.
  let sumSq = 0;
  for (const k in eff) sumSq += (w[k as AttrKey] ?? 0) * eff[k];
  if (sumSq <= 0) return out;

  for (let pass = 0; pass < 4; pass++) {
    const gap = target - overallFromAttrs(out, primaryPos);
    if (gap === 0) break;
    const scale = gap / sumSq;
    let moved = false;
    for (const k in eff) {
      const key = k as AttrKey;
      const next = Math.max(1, Math.min(99, Math.round(out[key] + scale * eff[key])));
      if (next !== out[key]) moved = true;
      out[key] = next;
    }
    if (!moved) break;
  }
  return out;
}

/** Every attribute a position's rating actually rewards, strongest first. Used
 * by the UI to highlight the stats that matter for a player, and by generation
 * to decide where a position's quality should be concentrated. */
export function keyAttrsFor(primaryPos: Pos, limit = 6): AttrKey[] {
  const w = ATTR_WEIGHTS[primaryPos] ?? ATTR_WEIGHTS.CM;
  return (Object.keys(w) as AttrKey[])
    .filter((k) => (w[k] ?? 0) > 0)
    .sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0))
    .slice(0, limit);
}

/** Guard: every attribute key must be spelled correctly in every weight row, or
 * a silent typo would simply drop that term from the model. Runs once at module
 * load in development. */
if (process.env.NODE_ENV !== "production") {
  const valid = new Set<string>(ATTR_KEYS);
  for (const pos of Object.keys(ATTR_WEIGHTS) as Pos[]) {
    for (const k of Object.keys(ATTR_WEIGHTS[pos])) {
      if (!valid.has(k)) throw new Error(`ATTR_WEIGHTS.${pos} names unknown attribute "${k}"`);
    }
  }
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

/**
 * Chance a player generated at this position is LEFT-footed (v42).
 *
 * Real squads are roughly three-quarters right-footed, but the split is nowhere
 * near uniform by position: left-sided roles are dominated by left-footers, and
 * a modern inverted winger on the right is more often left-footed than not.
 * Pure data — the split is read off this table and never special-cased in code.
 * Descriptive only; the match engine never reads a player's foot.
 */
export const LEFT_FOOT_CHANCE: Record<Pos, number> = {
  GK: 0.15,
  CB: 0.25,
  LB: 0.72,
  RB: 0.08,
  DM: 0.2,
  CM: 0.22,
  LM: 0.68,
  RM: 0.12,
  AM: 0.25,
  // Wingers cut inside onto the far foot as often as they go outside it, so the
  // flanks are far closer to even than the full-backs behind them.
  LW: 0.5,
  RW: 0.42,
  ST: 0.24,
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

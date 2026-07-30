// ── The 35-attribute model (v41) ───────────────────────────────────────────
//
// The player schema carries 35 individual attributes rather than the six
// aggregate ones (pace/shooting/passing/dribbling/defending/physicality) it
// used through v40. This file is the single source of truth for WHAT the
// attributes are: their keys, their display names, the groups the UI renders
// them in, and which of them only mean anything for a goalkeeper.
//
// It is pure data. The overall model that WEIGHTS these attributes lives in
// `config/positions.ts`; the archetype profiles that shape them live in
// `config/archetypes.ts`. Nothing here knows about either.
//
// Naming follows the source database's own vocabulary, camel-cased. The six
// goalkeeping stats keep a `gk`-free name where it is unambiguous (`diving`,
// `handling`, `reflexes`, `kicking`) and are disambiguated where an outfield
// stat already owns the word: `gkPositioning` vs. the outfield `positioning`,
// and `gkSpeed` vs. the outfield `sprintSpeed`/`acceleration`.

import type { Attributes } from "../types";

export type AttrKey = keyof Attributes;

/** Every attribute key, in a stable iteration order. Anything that loops over
 * attributes reads this — never an inline literal — so adding or renaming a
 * stat is a one-line change here. */
export const ATTR_KEYS: AttrKey[] = [
  // Attacking
  "crossing",
  "finishing",
  "headingAccuracy",
  "shortPassing",
  "volleys",
  // Skill
  "dribbling",
  "curve",
  "fkAccuracy",
  "longPassing",
  "ballControl",
  // Movement
  "acceleration",
  "sprintSpeed",
  "agility",
  "reactions",
  "balance",
  // Power
  "shotPower",
  "jumping",
  "stamina",
  "strength",
  "longShots",
  // Mentality
  "aggression",
  "interceptions",
  "positioning",
  "vision",
  "penalties",
  "composure",
  // Defending
  "markingAwareness",
  "standingTackle",
  "slidingTackle",
  // Goalkeeping
  "diving",
  "handling",
  "kicking",
  "gkPositioning",
  "reflexes",
  "gkSpeed",
];

/** The six goalkeeping attributes. These are only meaningful for a keeper: an
 * outfielder carries low values in them (and the source database leaves
 * `gkSpeed` blank for outfielders entirely). */
export const GK_ATTR_KEYS: AttrKey[] = [
  "diving",
  "handling",
  "kicking",
  "gkPositioning",
  "reflexes",
  "gkSpeed",
];

const GK_SET = new Set<AttrKey>(GK_ATTR_KEYS);

/** The 29 outfield attributes — every key that isn't a goalkeeping one. */
export const OUTFIELD_ATTR_KEYS: AttrKey[] = ATTR_KEYS.filter((k) => !GK_SET.has(k));

export function isGkAttr(k: AttrKey): boolean {
  return GK_SET.has(k);
}

/** UI grouping. Mirrors how the source database organises its columns, which is
 * also how players expect to read an attribute sheet. */
export type AttrGroup = "attacking" | "skill" | "movement" | "power" | "mentality" | "defending" | "goalkeeping";

export const ATTR_GROUP_LABELS: Record<AttrGroup, string> = {
  attacking: "Attacking",
  skill: "Skill",
  movement: "Movement",
  power: "Power",
  mentality: "Mentality",
  defending: "Defending",
  goalkeeping: "Goalkeeping",
};

/** Group order for rendering an attribute sheet. */
export const ATTR_GROUP_ORDER: AttrGroup[] = [
  "attacking",
  "skill",
  "movement",
  "power",
  "mentality",
  "defending",
  "goalkeeping",
];

export interface AttrMeta {
  key: AttrKey;
  /** Full display name ("Heading Accuracy"). */
  name: string;
  /** Three-letter column label for tight layouts ("HEA"). */
  short: string;
  group: AttrGroup;
}

export const ATTR_META: Record<AttrKey, AttrMeta> = {
  // Attacking
  crossing: { key: "crossing", name: "Crossing", short: "CRO", group: "attacking" },
  finishing: { key: "finishing", name: "Finishing", short: "FIN", group: "attacking" },
  headingAccuracy: { key: "headingAccuracy", name: "Heading Accuracy", short: "HEA", group: "attacking" },
  shortPassing: { key: "shortPassing", name: "Short Passing", short: "SPA", group: "attacking" },
  volleys: { key: "volleys", name: "Volleys", short: "VOL", group: "attacking" },
  // Skill
  dribbling: { key: "dribbling", name: "Dribbling", short: "DRI", group: "skill" },
  curve: { key: "curve", name: "Curve", short: "CUR", group: "skill" },
  fkAccuracy: { key: "fkAccuracy", name: "FK Accuracy", short: "FKA", group: "skill" },
  longPassing: { key: "longPassing", name: "Long Passing", short: "LPA", group: "skill" },
  ballControl: { key: "ballControl", name: "Ball Control", short: "BAL", group: "skill" },
  // Movement
  acceleration: { key: "acceleration", name: "Acceleration", short: "ACC", group: "movement" },
  sprintSpeed: { key: "sprintSpeed", name: "Sprint Speed", short: "SPR", group: "movement" },
  agility: { key: "agility", name: "Agility", short: "AGI", group: "movement" },
  reactions: { key: "reactions", name: "Reactions", short: "REA", group: "movement" },
  balance: { key: "balance", name: "Balance", short: "BLN", group: "movement" },
  // Power
  shotPower: { key: "shotPower", name: "Shot Power", short: "SHP", group: "power" },
  jumping: { key: "jumping", name: "Jumping", short: "JUM", group: "power" },
  stamina: { key: "stamina", name: "Stamina", short: "STA", group: "power" },
  strength: { key: "strength", name: "Strength", short: "STR", group: "power" },
  longShots: { key: "longShots", name: "Long Shots", short: "LSH", group: "power" },
  // Mentality
  aggression: { key: "aggression", name: "Aggression", short: "AGG", group: "mentality" },
  interceptions: { key: "interceptions", name: "Interceptions", short: "INT", group: "mentality" },
  positioning: { key: "positioning", name: "Positioning", short: "POS", group: "mentality" },
  vision: { key: "vision", name: "Vision", short: "VIS", group: "mentality" },
  penalties: { key: "penalties", name: "Penalties", short: "PEN", group: "mentality" },
  composure: { key: "composure", name: "Composure", short: "CMP", group: "mentality" },
  // Defending
  markingAwareness: { key: "markingAwareness", name: "Marking Awareness", short: "MRK", group: "defending" },
  standingTackle: { key: "standingTackle", name: "Standing Tackle", short: "STK", group: "defending" },
  slidingTackle: { key: "slidingTackle", name: "Sliding Tackle", short: "SLT", group: "defending" },
  // Goalkeeping
  diving: { key: "diving", name: "Diving", short: "DIV", group: "goalkeeping" },
  handling: { key: "handling", name: "Handling", short: "HAN", group: "goalkeeping" },
  kicking: { key: "kicking", name: "Kicking", short: "KIC", group: "goalkeeping" },
  gkPositioning: { key: "gkPositioning", name: "GK Positioning", short: "GKP", group: "goalkeeping" },
  reflexes: { key: "reflexes", name: "Reflexes", short: "REF", group: "goalkeeping" },
  gkSpeed: { key: "gkSpeed", name: "GK Speed", short: "GKS", group: "goalkeeping" },
};

/** Attribute keys in each group, in `ATTR_KEYS` order. */
export const ATTRS_BY_GROUP: Record<AttrGroup, AttrKey[]> = ATTR_GROUP_ORDER.reduce(
  (acc, g) => {
    acc[g] = ATTR_KEYS.filter((k) => ATTR_META[k].group === g);
    return acc;
  },
  {} as Record<AttrGroup, AttrKey[]>
);

/** The attribute groups worth showing for a player at this position: an
 * outfielder's goalkeeping numbers are noise, and a keeper's are the point. */
export function attrGroupsFor(isGk: boolean): AttrGroup[] {
  return isGk ? ATTR_GROUP_ORDER : ATTR_GROUP_ORDER.filter((g) => g !== "goalkeeping");
}

/** A fresh attribute set with every key at `v`. The starting point for building
 * an attribute line from scratch (generation, custom-DB defaults, the editor). */
export function uniformAttrs(v: number): Attributes {
  const out = {} as Attributes;
  for (const k of ATTR_KEYS) out[k] = v;
  return out;
}

/** Coerce an arbitrary object into a complete, in-range attribute set. Missing
 * keys take `fallback`; out-of-range and non-finite values are clamped. Used by
 * every untrusted-input path (custom databases, save migration, the editor). */
export function normalizeAttrs(raw: Partial<Record<AttrKey, unknown>> | undefined, fallback = 50): Attributes {
  const out = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const v = Number(raw?.[k]);
    out[k] = Number.isFinite(v) ? Math.max(1, Math.min(99, v)) : fallback;
  }
  return out;
}

// ── Aggregate families (the six "FIFA card" faces) ─────────────────────────
//
// The 35 attributes are the truth, but six aggregates remain genuinely useful:
// they are how archetypes describe a player's shape in one readable line, how a
// training plan says "work on pace", and how a squad list shows a player at a
// glance without 35 columns.
//
// So the six survive as a DERIVED VIEW rather than as stored state. Each family
// lists the attributes that make it up; `aggregateAttrs` averages them.

export type AttrFamily = "pac" | "sho" | "pas" | "dri" | "def" | "phy";

export const ATTR_FAMILY_ORDER: AttrFamily[] = ["pac", "sho", "pas", "dri", "def", "phy"];

export const ATTR_FAMILY_LABELS: Record<AttrFamily, string> = {
  pac: "Pace",
  sho: "Shooting",
  pas: "Passing",
  dri: "Dribbling",
  def: "Defending",
  phy: "Physical",
};

/** Keeper-flavoured names for the same six faces, as the UI has always shown
 * them on a goalkeeper's card. */
export const GK_FAMILY_LABELS: Record<AttrFamily, string> = {
  pac: "Diving",
  sho: "Handling",
  pas: "Kicking",
  dri: "Reflexes",
  def: "Speed",
  phy: "Positioning",
};

/** Which attributes roll up into each outfield family. Mirrors the standard
 * FIFA card breakdown, so the derived six read the way players expect. */
export const ATTR_FAMILIES: Record<AttrFamily, AttrKey[]> = {
  pac: ["acceleration", "sprintSpeed"],
  sho: ["finishing", "longShots", "shotPower", "positioning", "volleys", "penalties"],
  pas: ["shortPassing", "longPassing", "vision", "crossing", "curve", "fkAccuracy"],
  dri: ["dribbling", "ballControl", "agility", "balance", "reactions", "composure"],
  def: ["markingAwareness", "standingTackle", "slidingTackle", "interceptions", "headingAccuracy"],
  phy: ["strength", "stamina", "aggression", "jumping"],
};

/** The keeper reading of the same six faces — each maps onto the goalkeeping
 * attributes the card label actually names. */
export const GK_ATTR_FAMILIES: Record<AttrFamily, AttrKey[]> = {
  pac: ["diving"],
  sho: ["handling"],
  pas: ["kicking", "longPassing"],
  dri: ["reflexes"],
  def: ["gkSpeed"],
  phy: ["gkPositioning"],
};

/** Roll the 35 attributes up into the six card faces (1–99, rounded). Pass
 * `isGk` to read a keeper's card instead of an outfielder's. */
export function aggregateAttrs(attrs: Attributes, isGk = false): Record<AttrFamily, number> {
  const table = isGk ? GK_ATTR_FAMILIES : ATTR_FAMILIES;
  const out = {} as Record<AttrFamily, number>;
  for (const f of ATTR_FAMILY_ORDER) {
    const keys = table[f];
    const sum = keys.reduce((s, k) => s + (attrs[k] ?? 0), 0);
    out[f] = Math.round(keys.length ? sum / keys.length : 0);
  }
  return out;
}

/** Which family an attribute belongs to, for the outfield rollup. A keeper-only
 * attribute has no outfield family and returns undefined. */
export const FAMILY_OF: Partial<Record<AttrKey, AttrFamily>> = (() => {
  const out: Partial<Record<AttrKey, AttrFamily>> = {};
  for (const f of ATTR_FAMILY_ORDER) for (const k of ATTR_FAMILIES[f]) out[k] = f;
  return out;
})();

// ── Legacy (pre-v41) six-attribute expansion ──────────────────────────────

/** The pre-v41 attribute shape: six aggregates. Still found in old saves and in
 * country databases authored against the old schema. */
export interface LegacyAttrs {
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  phy: number;
}

export const LEGACY_ATTR_KEYS: (keyof LegacyAttrs)[] = ["pac", "sho", "pas", "dri", "def", "phy"];

/** True if `a` is a pre-v41 six-attribute object rather than a 35-attribute one. */
export function isLegacyAttrs(a: unknown): a is LegacyAttrs {
  if (typeof a !== "object" || a === null) return false;
  const o = a as Record<string, unknown>;
  // Distinguish by the OLD keys being present and the new ones absent, so a
  // 35-attribute set is never mistaken for a legacy one.
  return LEGACY_ATTR_KEYS.every((k) => typeof o[k] === "number") && typeof o.ballControl !== "number";
}

/**
 * Expand a pre-v41 six-attribute line into the 35 attributes.
 *
 * Each old aggregate seeds the attributes that roll up into it (`ATTR_FAMILIES`,
 * or `GK_ATTR_FAMILIES` for a keeper, whose six slots carried keeper skills), and
 * anything no family claims takes the mean of the six. An optional `profile`
 * (an archetype's 35-attribute emphasis) blends in the within-family detail the
 * six could never express — gently, at 75/25, because the old numbers are real
 * data and the profile is only a prior.
 *
 * Shared by the v40→v41 save migration and the country-database upgrade so both
 * produce the same player from the same input.
 */
export function expandLegacyAttrs(
  legacy: LegacyAttrs,
  isGk: boolean,
  profile?: Attributes
): Attributes {
  const families = isGk ? GK_ATTR_FAMILIES : ATTR_FAMILIES;
  const mean = LEGACY_ATTR_KEYS.reduce((s, k) => s + legacy[k], 0) / LEGACY_ATTR_KEYS.length;
  const maxW = profile ? Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1 : 1;

  const out = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const fam = ATTR_FAMILY_ORDER.find((f) => families[f].includes(k));
    const base = fam ? legacy[fam] : mean;
    const shaped = profile ? base * (0.75 + 0.25 * (profile[k] / maxW) * 1.4) : base;
    out[k] = Math.max(1, Math.min(99, Math.round(shaped)));
  }
  return out;
}

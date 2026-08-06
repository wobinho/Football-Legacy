// Club badges (v1.96) — the SPEC and its rules. Nothing in here draws; the
// renderer is components/visual/ClubBadge.tsx and it is a pure function of this
// object.
//
// **A badge is DERIVED unless it was authored.** `badgeFor` hashes the club's
// own identity into a stable spec, so all ~800 clubs in a world have a crest
// that costs the save nothing and never changes between sessions. Only a club
// somebody actually edited stores one. That is the same discipline the roll of
// honour follows (v1.89) and it is what makes this affordable: a stored spec on
// every club would be ~80 bytes × 800 × every autosave, to say what a hash of
// the name already says.
//
// The spec is flat on purpose: cheap to serialise, cheap to diff, trivial to
// migrate. Add fields; never repurpose one.

import { hashString, mulberry32, type RNG } from "../rng";
import {
  clampPatternCount,
  luminance,
  PATTERN_IDS,
  readableOn,
  safeHex,
  type PatternId,
} from "./patterns";

export const BADGE_SCHEMA_VERSION = 1;

/** Badge silhouettes, every one drawn in the same 100×100 box. A fixed box plus
 * CSS sizing means one path works at 18px and at 400px. */
export const BADGE_SHAPES = {
  shield: { label: "Shield", d: "M10 6 H90 V50 C90 72 72 88 50 96 C28 88 10 72 10 50 Z" },
  heater: { label: "Heater", d: "M50 4 C72 4 85 8 90 12 V50 C90 72 72 88 50 96 C28 88 10 72 10 50 V12 C15 8 28 4 50 4 Z" },
  circle: { label: "Roundel", d: "M50 4 A46 46 0 1 1 49.98 4 Z" },
  hex: { label: "Hex", d: "M50 3 L91 26 V74 L50 97 L9 74 V26 Z" },
  spade: { label: "Spade", d: "M50 3 L88 24 V52 C88 74 70 88 50 97 C30 88 12 74 12 52 V24 Z" },
  crest: { label: "Crest", d: "M14 5 H86 L94 14 V68 C94 83 74 92 50 96 C26 92 6 83 6 68 V14 Z" },
  arch: { label: "Arch", d: "M50 4 C74 4 92 21 92 45 V88 C92 92 89 96 84 96 H16 C11 96 8 92 8 88 V45 C8 21 26 4 50 4 Z" },
  banner: { label: "Banner", d: "M8 8 H92 V78 L74 96 L50 82 L26 96 L8 78 Z" },
  diamond: { label: "Diamond", d: "M50 3 L95 50 L50 97 L5 50 Z" },
} as const;

export type BadgeShape = keyof typeof BADGE_SHAPES;
export const BADGE_SHAPE_IDS = Object.keys(BADGE_SHAPES) as BadgeShape[];

/** The central emblem. */
export const BADGE_CHARGES = {
  none: "None",
  star: "Star",
  ball: "Ball",
  crown: "Crown",
  tower: "Tower",
  bolt: "Bolt",
  cross: "Cross",
  wreath: "Wreath",
} as const;

export type BadgeCharge = keyof typeof BADGE_CHARGES;
export const BADGE_CHARGE_IDS = Object.keys(BADGE_CHARGES) as BadgeCharge[];

/** Everything a badge is. This is what a save stores for an authored crest. */
export interface BadgeSpec {
  v: number;
  shape: BadgeShape;
  ground: string;
  pat: PatternId;
  patColor: string;
  patCount: number;
  border: string;
  borderW: number;
  innerLine: boolean;
  charge: BadgeCharge;
  chargeColor: string;
  /** The short code across the middle — the club's `short`, normally. */
  code: string;
  name: string;
  year: number;
  textColor: string;
  showName: boolean;
  showYear: boolean;
}

export const DEFAULT_BADGE: BadgeSpec = {
  v: BADGE_SCHEMA_VERSION,
  shape: "shield",
  ground: "#16325c",
  pat: "bars",
  patColor: "#e2b53f",
  patCount: 5,
  border: "#e2b53f",
  borderW: 2.5,
  innerLine: true,
  charge: "star",
  chargeColor: "#f5f5f5",
  code: "FCL",
  name: "FOOTBALL LEGACY",
  year: 1897,
  textColor: "#f5f5f5",
  showName: true,
  showYear: true,
};

/**
 * Anything missing is filled from the default — that is the migration path. A
 * v1 badge loaded by v2 code just picks up v2's defaults for new fields, so a
 * badge never needs a migration step of its own.
 *
 * Colours and enums are validated rather than trusted: the save file is the
 * modding format, and a hand-edited spec with `shape: "triangle"` must fall
 * back to a shield instead of rendering an empty crest.
 */
export function normaliseBadge(spec: Partial<BadgeSpec> | undefined | null): BadgeSpec {
  const s = { ...DEFAULT_BADGE, ...(spec || {}) };
  return {
    ...s,
    v: BADGE_SCHEMA_VERSION,
    shape: s.shape in BADGE_SHAPES ? s.shape : DEFAULT_BADGE.shape,
    charge: s.charge in BADGE_CHARGES ? s.charge : DEFAULT_BADGE.charge,
    pat: (PATTERN_IDS as string[]).includes(s.pat) ? s.pat : DEFAULT_BADGE.pat,
    patCount: clampPatternCount(s.patCount),
    borderW: Math.max(0, Math.min(6, Number(s.borderW) || DEFAULT_BADGE.borderW)),
    ground: safeHex(s.ground, DEFAULT_BADGE.ground),
    patColor: safeHex(s.patColor, DEFAULT_BADGE.patColor),
    border: safeHex(s.border, DEFAULT_BADGE.border),
    chargeColor: safeHex(s.chargeColor, DEFAULT_BADGE.chargeColor),
    textColor: safeHex(s.textColor, DEFAULT_BADGE.textColor),
    code: String(s.code ?? "").toUpperCase().slice(0, 4),
    name: String(s.name ?? "").slice(0, 22),
    year: Math.round(Number(s.year) || DEFAULT_BADGE.year),
  };
}

/* ---------------------------------------------------------------------------
   DETERMINISTIC GENERATION
   The reason the whole feature is spec-based. Feed a club's identity in, get a
   stable badge out — no storage cost, and every AI club in the world has a
   crest without anyone drawing one.
   ------------------------------------------------------------------------- */

const GROUND_POOL = ["#16325c", "#8a1220", "#0f3d2e", "#1a1a1f", "#5a1246", "#0d4a63", "#7a3a0c", "#2b2f6b", "#3d1436", "#0b5c3b"];
const TRIM_POOL = ["#e2b53f", "#f5f5f5", "#101014", "#c9d1d9", "#e0632a", "#7fd4c1"];

/** Trim and ground this close in luminance read as one flat blob at 18px. */
const MIN_TRIM_CONTRAST = 0.12;

export interface GenerateBadgeInput {
  /** Anything stable and unique to the club. `badgeFor` passes its identity. */
  seed: string | number;
  name?: string;
  code?: string;
  year?: number;
  /** The club's own two colours, when it has them. Honoured over the pools —
   * a generated crest must look like the club it belongs to, and every screen
   * already shows those two colours beside it. */
  colors?: readonly [string, string] | string[];
}

export function generateBadge({ seed, name = "Club", code = "CLB", year = 1900, colors }: GenerateBadgeInput): BadgeSpec {
  const rng: RNG = mulberry32(hashString(String(seed)));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  const ground = safeHex(colors?.[0], pick(GROUND_POOL));
  let trim = safeHex(colors?.[1], pick(TRIM_POOL));
  // Never generate a trim that vanishes into its own ground.
  if (Math.abs(luminance(trim) - luminance(ground)) < MIN_TRIM_CONTRAST) {
    trim = luminance(ground) > 0.4 ? "#101014" : "#f5f5f5";
  }

  return normaliseBadge({
    shape: pick(BADGE_SHAPE_IDS),
    ground,
    patColor: trim,
    border: trim,
    pat: pick(PATTERN_IDS),
    patCount: 3 + Math.floor(rng() * 5),
    borderW: 2 + rng() * 2,
    innerLine: rng() > 0.4,
    charge: pick(BADGE_CHARGE_IDS),
    chargeColor: readableOn(ground) === "#0b0c0f" ? "#101014" : "#f5f5f5",
    code: code.slice(0, 4).toUpperCase(),
    name: name.toUpperCase(),
    year,
    textColor: readableOn(ground),
    showName: rng() > 0.35,
    showYear: rng() > 0.5,
  });
}

/** What a club looks like: its authored badge, or the one its identity implies.
 *
 * This is the single question every consumer asks — the `Crest` component, the
 * kit's chest badge, the creator's starting point. Never reach past it to
 * `club.badge` directly, or an unedited club renders as nothing. */
export function badgeFor(
  club:
    | {
        id?: string;
        name: string;
        short: string;
        colors: readonly [string, string] | string[];
        badge?: Partial<BadgeSpec>;
      }
    | undefined
    | null
): BadgeSpec {
  if (!club) return DEFAULT_BADGE;
  if (club.badge) return normaliseBadge(club.badge);
  return generateBadge({
    // The NAME, not the id: a club keeps its crest when it is exported to a
    // squad file and materialised into another world, where its id is different.
    seed: `${club.name}|${club.short}`,
    name: club.name,
    code: club.short,
    colors: club.colors,
    // Deterministic and plausible rather than authored — a founding year is
    // real club data the game does not model, and inventing a stable one is
    // better than printing 1900 on every crest in the world.
    year: 1880 + (hashString(`year|${club.name}`) % 60),
  });
}

/** True when a badge would all but disappear against the app's near-black
 * background. Surfaced as a warning in the creator, never enforced — a manager
 * is allowed an almost-black crest if that is the one he wants. */
export const badgeIsTooDark = (s: BadgeSpec): boolean =>
  luminance(s.ground) < 0.045 && luminance(s.border) < 0.06;

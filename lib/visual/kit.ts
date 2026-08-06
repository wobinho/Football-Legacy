// Club kits (v1.96) — the SPEC, the geometry and the selection rules. Nothing
// in here draws; the renderer is components/visual/ClubKit.tsx.
//
// Four jerseys per club (home / away / third / gk). Like the badge, a kit set is
// DERIVED from the club's identity unless somebody authored one — see
// `kitsFor`. The same reasoning applies and more forcefully: four specs on
// every one of ~800 clubs is four times the storage to say what a hash already
// says.
//
// NOT in the spec: the squad number and the player's name. Those are player
// data rendered ONTO a jersey. The colour of the number is kit data; the digits
// are not.

import { hashString, mulberry32, type RNG } from "../rng";
import {
  clampPatternCount,
  colorDistance,
  luminance,
  PATTERN_IDS,
  readableOn,
  safeHex,
  type PatternId,
} from "./patterns";

export const KIT_SCHEMA_VERSION = 1;

export const COLLARS = {
  none: "None",
  crew: "Crew",
  vneck: "V-neck",
  polo: "Polo",
  wrap: "Wrap",
} as const;

export type CollarId = keyof typeof COLLARS;
export const COLLAR_IDS = Object.keys(COLLARS) as CollarId[];

export interface KitSpec {
  v: number;
  body: string;
  pat: PatternId;
  patColor: string;
  patCount: number;
  /** "" = match the body; a hex = contrast sleeves. */
  sleeves: string;
  collar: CollarId;
  collarColor: string;
  /** Cuffs only, now that the hem carries no trim. */
  trim: string;
  cuffs: boolean;
  numberColor: string;
  frontNumber: boolean;
  showBadge: boolean;
}

export type KitSlot = "home" | "away" | "third" | "gk";

export type KitSet = Record<KitSlot, KitSpec>;

export const KIT_SLOTS: { key: KitSlot; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "third", label: "Third" },
  { key: "gk", label: "Goalkeeper" },
];

export const KIT_SLOT_IDS = KIT_SLOTS.map((s) => s.key);

const BASE_KIT: KitSpec = {
  v: KIT_SCHEMA_VERSION,
  body: "#16325c",
  pat: "bars",
  patColor: "#e2b53f",
  patCount: 5,
  sleeves: "",
  collar: "crew",
  collarColor: "#e2b53f",
  trim: "#e2b53f",
  cuffs: true,
  numberColor: "#f5f5f5",
  frontNumber: false,
  showBadge: true,
};

export const DEFAULT_KITSET: KitSet = {
  home: { ...BASE_KIT },
  away: { ...BASE_KIT, body: "#f2f2f0", pat: "pinstripes", patColor: "#16325c", collarColor: "#16325c", trim: "#16325c", numberColor: "#16325c" },
  third: { ...BASE_KIT, body: "#1d1f24", pat: "sash", patColor: "#e2b53f", collar: "vneck" },
  gk: { ...BASE_KIT, body: "#2fae63", pat: "honeycomb", patColor: "#0f3d2e", patCount: 7, collar: "polo", collarColor: "#0f3d2e", trim: "#0f3d2e", numberColor: "#0f3d2e" },
};

/** Same contract as `normaliseBadge`: fill from the base, validate every enum
 * and colour, so a hand-edited save degrades rather than rendering nothing. */
export function normaliseKit(k: Partial<KitSpec> | undefined | null): KitSpec {
  const s = { ...BASE_KIT, ...(k || {}) };
  return {
    ...s,
    v: KIT_SCHEMA_VERSION,
    collar: s.collar in COLLARS ? s.collar : BASE_KIT.collar,
    pat: (PATTERN_IDS as string[]).includes(s.pat) ? s.pat : BASE_KIT.pat,
    patCount: clampPatternCount(s.patCount),
    body: safeHex(s.body, BASE_KIT.body),
    patColor: safeHex(s.patColor, BASE_KIT.patColor),
    // "" is meaningful here (match the body), so it survives validation.
    sleeves: s.sleeves ? safeHex(s.sleeves, "") : "",
    collarColor: safeHex(s.collarColor, BASE_KIT.collarColor),
    trim: safeHex(s.trim, BASE_KIT.trim),
    numberColor: safeHex(s.numberColor, BASE_KIT.numberColor),
  };
}

export function normaliseKitSet(set: Partial<Record<KitSlot, Partial<KitSpec>>> | undefined | null): KitSet {
  return {
    home: normaliseKit(set?.home ?? DEFAULT_KITSET.home),
    away: normaliseKit(set?.away ?? DEFAULT_KITSET.away),
    third: normaliseKit(set?.third ?? DEFAULT_KITSET.third),
    gk: normaliseKit(set?.gk ?? DEFAULT_KITSET.gk),
  };
}

/* ---------------------------------------------------------------------------
   GEOMETRY

   The body does not flare. It runs 24.5 at the armpit to 25.5 at the hem — a
   slight taper, with the waist pulled in a touch between. Straight would have
   been safe; tapered reads as a garment cut to fit rather than a tube. The hem
   carries no trim at all, so every pattern runs clean to the bottom edge.
   ------------------------------------------------------------------------- */

/** Runs clockwise from the left edge of the neck round to the right edge. */
const SHIRT_BODY =
  "M42 12 " +
  "C38 12 33 12 29 13.5 " + // left shoulder, sloping outward
  "C22 18 11 29 5 37 " + // sleeve cap
  "L19 46.5 " + // cuff edge
  "C21 42 23 38 24.5 35 " + // underarm seam, up to the armpit
  "C25 50 25.4 68 25.5 85 " + // body side: fitted, never flaring
  "Q50 88 74.5 85 " + // hem, gently bowed
  "C74.6 68 75 50 75.5 35 " +
  "C77 38 79 42 81 46.5 " +
  "L95 37 " +
  "C89 29 78 18 71 13.5 " +
  "C67 12 62 12 58 12";

/** The neckline closes the path back to (42,12): a V-neck is a genuine V-shaped
 * hole, not a V band painted over a round one. */
const NECKLINES: Record<CollarId, string> = {
  none: "Q50 20 42 12",
  crew: "Q50 23 42 12",
  polo: "Q50 23 42 12",
  vneck: "L50 32 L42 12",
  wrap: "L50 30 L42 12",
};

export const shirtPath = (collar: CollarId): string => `${SHIRT_BODY} ${NECKLINES[collar] || NECKLINES.crew} Z`;

/** Sleeve regions: the half-plane on the sleeve side of the true shoulder-to-
 * armpit seam — the line through (29,13.5) and (24.5,35) — extended well past
 * the shirt. Used for contrast sleeves AND as a second clip for the cuffs. */
export const SLEEVE_L = "M32.7 -4 L20.9 52 L-12 52 L-12 -4 Z";
export const SLEEVE_R = "M67.3 -4 L79.1 52 L112 52 L112 -4 Z";

/** Cuffs overhang the cuff edge on purpose. Clipping to the shirt alone is not
 * enough: below the armpit the sleeve and the torso are two separate lobes of
 * one outline, so a cuff's inner corner reaches across the gap and prints a
 * stray wedge on the body. Clipping each cuff to its own sleeve region as well
 * means the intersection can only ever land inside that sleeve. */
export const CUFF_L = "M1.7 34.8 L22.3 48.7 L25.4 44.2 L4.8 30.3 Z";
export const CUFF_R = "M98.3 34.8 L77.7 48.7 L74.6 44.2 L95.2 30.3 Z";

/** Where the pattern's 0..100 unit box maps to on the jersey. */
export const SHIRT_BOX: [number, number, number, number] = [5, 10, 90, 78];

export const COLLAR_PATHS: Record<Exclude<CollarId, "none">, string[]> = {
  crew: ["M42 12 Q50 23 58 12 L61 13.5 Q50 29 39 13.5 Z"],
  vneck: ["M42 12 L50 32 L58 12 L61.5 14 L50 38 L38.5 14 Z"],
  polo: ["M42 12 Q50 23 58 12 L61.5 14 Q50 31 38.5 14 Z", "M47.5 23 h5 v13 h-5 Z"],
  wrap: ["M41 12 L50 30 L59 12 L62.5 14 L50 36 L46.5 28 L37.5 14 Z"],
};

/* ---------------------------------------------------------------------------
   DETERMINISTIC GENERATION
   ------------------------------------------------------------------------- */

/** Patterns a generated HOME kit may take. Deliberately the legible ones: the
 * textures and the odd blocks are there for a manager who wants them, but a
 * world where a third of clubs play in argyle reads as noise. */
/** Patterns where the pattern colour covers roughly as much of the shirt as the
 * body does. On these, "what colour is that team?" has two answers and a
 * referee looks at both; on everything else the body is the shirt and the
 * pattern is detail on it. Read by both the generator and `kitsClash`, which is
 * why it sits above both. */
const EVEN_SPLIT_PATTERNS = new Set<PatternId>([
  "halves", "crossHalves", "quarters", "xQuarters", "splitDiagonal", "bars",
  "hoops", "checks", "halfStripes", "plaid", "argyle",
]);

const HOME_PATTERNS: PatternId[] = [
  "solid", "solid", "bars", "bars", "hoops", "hoops", "halves", "sash", "pinstripes",
  "pale", "chestBand", "yoke", "shoulderStripes", "thinHoops", "vPanel", "splitDiagonal",
];

const GK_BODIES = ["#2fae63", "#d8d211", "#1d1f24", "#e0632a", "#7a3aa8", "#18b3c4"];

/** Change-shirt bodies for a club whose home kit already reads as two colours.
 * Deliberately the plain ones a real change kit uses — white, black, navy, a
 * light grey — rather than a third club colour nobody chose. */
const AWAY_NEUTRALS = ["#f2f2f0", "#16181d", "#1b2333", "#c9ccd2", "#7a1f2b"];

/** A club's four jerseys, derived from its identity and its two colours. The
 * home kit wears the club's colours; away is the light/dark inverse; third is
 * the accent turned up; the keeper is deliberately none of them. */
export function generateKits(input: {
  seed: string | number;
  colors?: readonly [string, string] | string[];
}): KitSet {
  const rng: RNG = mulberry32(hashString(String(input.seed)));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  const primary = safeHex(input.colors?.[0], "#16325c");
  let secondary = safeHex(input.colors?.[1], "#f5f5f5");
  // Two colours this close produce a kit with no visible pattern at all.
  if (colorDistance(primary, secondary) < 60) {
    secondary = luminance(primary) > 0.4 ? "#101014" : "#f5f5f5";
  }

  const homePat = pick(HOME_PATTERNS);
  const patCount = 4 + Math.floor(rng() * 4);
  const collar = pick(COLLAR_IDS);

  const home: KitSpec = normaliseKit({
    body: primary,
    pat: homePat,
    patColor: secondary,
    patCount,
    collar,
    collarColor: secondary,
    trim: secondary,
    numberColor: readableOn(primary),
    cuffs: rng() > 0.3,
  });

  // The away shirt has to clear everything the home shirt READS as, and for a
  // halved or striped home kit that is BOTH colours — so inverting the pair,
  // the obvious move, produces a shirt in a colour already on the opposition.
  // Measured: inverting alone left 24 of 72 clubs unable to field their own
  // away kit, all of them clubs with an even-split home shirt. When the home
  // kit is genuinely two-coloured the away body is picked from the neutrals
  // instead, furthest first; when it isn't, inverting is right and keeps the
  // club's own colours on its change shirt.
  const homeReads = EVEN_SPLIT_PATTERNS.has(homePat) ? [primary, secondary] : [primary];
  const awayBody =
    homeReads.length === 1
      ? secondary
      : [...AWAY_NEUTRALS].sort(
          (x, y) =>
            Math.min(...homeReads.map((h) => colorDistance(y, h))) -
            Math.min(...homeReads.map((h) => colorDistance(x, h)))
        )[0];
  const awayTrim = readableOn(awayBody) === "#0b0c0f" ? primary : secondary;
  const away: KitSpec = normaliseKit({
    ...home,
    body: awayBody,
    patColor: awayTrim,
    pat: homeReads.length > 1 || rng() > 0.45 ? "solid" : homePat,
    collarColor: awayTrim,
    trim: awayTrim,
    numberColor: readableOn(awayBody),
  });

  // Third is the one that may be loud: a dark or a light neutral carrying the
  // club's accent, so it clears both of the above and most opponents.
  const thirdBody = luminance(primary) > 0.35 ? "#16181d" : "#f2f2f0";
  const third: KitSpec = normaliseKit({
    ...home,
    body: thirdBody,
    patColor: primary,
    pat: pick(["sash", "solid", "diagonals", "fadeSide", "flash", "halves"] as PatternId[]),
    collarColor: primary,
    trim: primary,
    numberColor: readableOn(thirdBody),
  });

  // A keeper wears what the outfield players don't — that is the whole job.
  let gkBody = pick(GK_BODIES);
  for (let i = 0; i < GK_BODIES.length && colorDistance(gkBody, primary) < CLASH_THRESHOLD; i++) {
    gkBody = GK_BODIES[(GK_BODIES.indexOf(gkBody) + 1) % GK_BODIES.length];
  }
  const gk: KitSpec = normaliseKit({
    body: gkBody,
    pat: pick(["solid", "honeycomb", "speckle", "grid", "shadowStripes"] as PatternId[]),
    patColor: readableOn(gkBody) === "#0b0c0f" ? "#101014" : "#f5f5f5",
    patCount: 6,
    collar: "polo",
    collarColor: readableOn(gkBody) === "#0b0c0f" ? "#101014" : "#f5f5f5",
    trim: readableOn(gkBody) === "#0b0c0f" ? "#101014" : "#f5f5f5",
    numberColor: readableOn(gkBody),
  });

  return { home, away, third, gk };
}

/** What a club wears: its authored set, or the one its identity implies. The
 * single question every consumer asks — never reach past it to `club.kits`. */
export function kitsFor(
  club:
    | {
        name: string;
        short: string;
        colors: readonly [string, string] | string[];
        kits?: Partial<Record<KitSlot, Partial<KitSpec>>>;
      }
    | undefined
    | null
): KitSet {
  if (!club) return DEFAULT_KITSET;
  if (club.kits) return normaliseKitSet(club.kits);
  // Seeded on the name for the same reason the badge is: identity travels
  // between worlds, ids don't.
  return generateKits({ seed: `kit|${club.name}|${club.short}`, colors: club.colors });
}

/* ---------------------------------------------------------------------------
   KIT SELECTION — the game layer's half. Home side wears home; the away side
   takes the first of its own three that doesn't clash.
   ------------------------------------------------------------------------- */

export const CLASH_THRESHOLD = 115;

/** The colours a player is READ as wearing, most dominant first.
 *
 * This is the whole rule, and the obvious version of it is wrong: comparing
 * every visible colour of one shirt against every visible colour of the other
 * makes a blue-and-white striped home shirt clash with a white-and-blue away
 * shirt, because blue appears somewhere on both. That is the classic real
 * change kit — Newcastle's black-and-white against a white change shirt — and
 * banning it left 67 of 72 generated clubs unable to field their own away kit.
 * What matters is what the shirt reads as at a distance, which is the BODY
 * colour, plus the pattern colour only when the pattern genuinely splits the
 * shirt in half. */
function dominantColors(k: KitSpec): string[] {
  if (k.pat === "solid") return [k.body];
  return EVEN_SPLIT_PATTERNS.has(k.pat) ? [k.body, k.patColor] : [k.body];
}

export function kitsClash(a: KitSpec, b: KitSpec): { clash: boolean; distance: number } {
  const A = dominantColors(normaliseKit(a));
  const B = dominantColors(normaliseKit(b));
  let min = Infinity;
  for (const x of A) for (const y of B) min = Math.min(min, colorDistance(x, y));
  return { clash: min < CLASH_THRESHOLD, distance: Math.round(min) };
}

/** Which jersey each side wears for one fixture. The home side always wears
 * home — that is the privilege — and the away side works down its own list.
 * `forcedClash` is honest rather than hidden: if none of the three clears, the
 * third shirt is worn anyway and the caller may say so. */
export function pickKitsForFixture(
  homeSet: KitSet,
  awaySet: KitSet
): { homeKit: KitSlot; awayKit: KitSlot; forcedClash: boolean } {
  const home = normaliseKit(homeSet.home);
  for (const slot of ["away", "third", "home"] as KitSlot[]) {
    if (!kitsClash(home, awaySet[slot]).clash) return { homeKit: "home", awayKit: slot, forcedClash: false };
  }
  return { homeKit: "home", awayKit: "third", forcedClash: true };
}

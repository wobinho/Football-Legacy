// The pattern engine and the colour maths — the half of the visual identity
// system that a badge and a jersey genuinely share (v1.96).
//
// Both creators shipped with their own copy of this (two `PatternLayer`s, two
// `hslToHex`es, two `luminance`s). That is the shape where a pattern added to a
// kit silently doesn't exist on a crest, and where the two files' colour maths
// drift apart until "the same hex" means two different things. One module, both
// consumers.
//
// A pattern draws into a 0..100 unit box and knows nothing about what it is
// filling. `boxTransform` is what maps that box onto a shield or a torso, which
// is why one pattern set serves both.

/** Every pattern, keyed to its display label. */
export const PATTERNS = {
  /* Blocks */
  solid: "Solid",
  halves: "Halves",
  crossHalves: "Split",
  quarters: "Quarters",
  xQuarters: "X-quarters",
  splitDiagonal: "Diagonal",
  yoke: "Yoke",
  vPanel: "V-yoke",
  cornerBlock: "Corner",
  shoulderStripes: "Shoulders",
  chevrons: "Chevrons",
  arrow: "Arrow",
  crossBands: "Cross",
  rays: "Rays",
  fade: "Fade",
  fadeSide: "Side fade",
  /* Vertical */
  bars: "Stripes",
  pinstripes: "Pinstripe",
  tramlines: "Tramlines",
  taperedStripes: "Tapered",
  shadowStripes: "Tonal",
  sideStripes: "Side stripes",
  halfStripes: "Half stripes",
  lowerStripes: "Low stripes",
  pale: "Pale",
  bib: "Bib",
  diagonals: "Slants",
  sash: "Sash",
  doubleSash: "Twin sash",
  flash: "Flash",
  /* Horizontal */
  hoops: "Hoops",
  thinHoops: "Thin hoops",
  halfHoops: "Half hoops",
  fadeHoops: "Graded hoops",
  centreHoops: "Chest hoops",
  fess: "Band",
  chestBand: "Chest band",
  hemBand: "Hem block",
  halo: "Halo",
  waves: "Waves",
  zigzag: "Zigzag",
  /* Texture */
  checks: "Checks",
  plaid: "Plaid",
  argyle: "Argyle",
  diamonds: "Diamonds",
  dots: "Dots",
  speckle: "Marl",
  honeycomb: "Honeycomb",
  scales: "Scales",
  grid: "Grid",
  triangles: "Triangles",
} as const;

export type PatternId = keyof typeof PATTERNS;

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

/** A flat grid of 51 is a wall. The groups are how a kit is actually thought
 * about: what is the base block, does it run vertically or horizontally, is
 * there a texture over the top. */
export const PATTERN_GROUPS: { label: string; keys: PatternId[] }[] = [
  {
    label: "Blocks",
    keys: ["solid", "halves", "crossHalves", "quarters", "xQuarters", "splitDiagonal", "yoke", "vPanel", "cornerBlock", "shoulderStripes", "chevrons", "arrow", "crossBands", "rays", "fade", "fadeSide"],
  },
  {
    label: "Vertical",
    keys: ["bars", "pinstripes", "tramlines", "taperedStripes", "shadowStripes", "sideStripes", "halfStripes", "lowerStripes", "pale", "bib", "diagonals", "sash", "doubleSash", "flash"],
  },
  {
    label: "Horizontal",
    keys: ["hoops", "thinHoops", "halfHoops", "fadeHoops", "centreHoops", "fess", "chestBand", "hemBand", "halo", "waves", "zigzag"],
  },
  {
    label: "Texture",
    keys: ["checks", "plaid", "argyle", "diamonds", "dots", "speckle", "honeycomb", "scales", "grid", "triangles"],
  },
];

/** Patterns always draw into a 0..100 unit box. Each part declares where that
 * box maps to, so one pattern set serves a shield and a jersey alike. */
export const boxTransform = (x: number, y: number, w: number, h: number): string =>
  `translate(${x} ${y}) scale(${(w / 100).toFixed(4)} ${(h / 100).toFixed(4)})`;

/** Bands are clamped rather than trusted: a spec is the modding format, and a
 * hand-edited `patCount: 400` must not emit four hundred nodes per crest. */
export const PATTERN_COUNT_MIN = 2;
export const PATTERN_COUNT_MAX = 12;

export const clampPatternCount = (n: number | undefined): number =>
  Math.max(PATTERN_COUNT_MIN, Math.min(PATTERN_COUNT_MAX, Math.round(n ?? 5)));

/* ---------------------------------------------------------------------------
   COLOUR
   ------------------------------------------------------------------------- */

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hx = (n: number) => Math.round(f(n) * 255).toString(16).padStart(2, "0");
  return `#${hx(0)}${hx(8)}${hx(4)}`;
}

export function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return [0, 0, 50];
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

export function toRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? (m.slice(1).map((v) => parseInt(v, 16)) as [number, number, number]) : [0, 0, 0];
}

/** Perceptual luminance — used to auto-pick legible text and to warn when a
 * badge would disappear against the app's near-black background (#0b0c0f). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const readableOn = (hex: string): string => (luminance(hex) > 0.42 ? "#0b0c0f" : "#ffffff");

/** Redmean colour distance, max ~765. The perceptual one — plain RGB distance
 * calls a navy and a maroon far apart and two greens identical, which is the
 * wrong answer for a kit clash. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt(
    (2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2
  );
}

/** A hex this module will actually draw. Anything else falls back rather than
 * emitting an invalid `fill` — a save is the modding format and a typo in a
 * hand-edited colour must degrade, not blank the crest. */
export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export const safeHex = (v: unknown, fallback: string): string => (isHex(v) ? v : fallback);

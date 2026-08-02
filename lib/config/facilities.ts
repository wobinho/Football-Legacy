// Facilities & staff — pure data (v1.79).
//
// This file is the whole balance surface of the facilities system. `lib/facilities.ts`
// holds the rules and reads these tables; it must never hard-code a number, and it
// must never name a facility in a conditional — a new facility is a row in
// `FACILITY_SPECS`, not a branch.
//
// The shape every facility shares, applied per CHANNEL (v1.82 — a facility may
// produce more than one quantity; see `FacilityChannel`):
//
//   effect = base + levelEffect × (level - 1)
//                 + starEffect × floor(totalStars / STAFF_STARS_PER_STEP)
//                 + badgeEffect × floor(badgeTiersHere / badgeTiersPerStep)
//
// `levelEffect` (v1.85) defaults to 0, which is the original three-term shape and
// what every facility but the Scouting Network still uses. It exists because ONE
// building's headline quantity is genuinely bought by the building rather than by
// who works in it — see that row for why the exception is deliberate and narrow.
//
// Worked example (the design brief's own, and asserted by verify:facilities):
// ETC at level 5, six 5-star staff (30 stars), every one holding a legacy ETC
// badge (tier 6):
//   base 5% + 2% × floor(30/6) + 0.5% × (6 badges × 6 tiers)
//   = 5 + 10 + 18 = 33% faster player growth.

import type { BadgeTier, FacilityId } from "../types";

/** How many badges one staff member can ever hold — i.e. how many distinct
 * facilities they can build a record at. Serving a fourth facility earns
 * nothing, which is what makes moving a veteran a real cost. */
export const STAFF_BADGE_SLOTS = 3;

/** Total assigned stars needed per step of a facility's star bonus. The step is
 * shared by every facility; what one step is WORTH is per-facility
 * (`starEffect`). */
export const STAFF_STARS_PER_STEP = 6;

/** Star ratings run 1–5. */
export const STAFF_MIN_STARS = 1;
export const STAFF_MAX_STARS = 5;

/** The badge ladder: the CUMULATIVE completed seasons at one facility needed to
 * hold each tier, and the tier's numeric weight (bronze = 1 … legacy = 6) which
 * is what `badgeEffect` is multiplied by.
 *
 * The gaps widen deliberately — 1, 1, 1, 2, 2, 3 seasons — so the early badges
 * arrive fast enough to feel like progress and `legacy` is a genuine ten-season
 * commitment to one building. */
export const BADGE_LADDER: { tier: BadgeTier; seasons: number; weight: number }[] = [
  { tier: "bronze", seasons: 1, weight: 1 },
  { tier: "silver", seasons: 2, weight: 2 },
  { tier: "gold", seasons: 3, weight: 3 },
  { tier: "diamond", seasons: 5, weight: 4 },
  { tier: "obsidian", seasons: 7, weight: 5 },
  { tier: "legacy", seasons: 10, weight: 6 },
];

/** Seasons at one facility required for the top badge — the headline number. */
export const BADGE_LEGACY_SEASONS = BADGE_LADDER[BADGE_LADDER.length - 1].seasons;

/**
 * One quantity a facility produces.
 *
 * The three-channel shape is the same for every channel of every facility —
 * `base`, plus `starEffect` per completed star step, plus `badgeEffect` per
 * `badgeTiersPerStep` badge tiers held here. What varies is only what the
 * number MEANS, which `unit` carries:
 *
 *   - `percent` — the original shape. A rate, shown as "+33%".
 *   - `count`   — a headcount or a capacity, shown as "15". Rounded down at
 *                 the end, because half a squad place is not a thing.
 *
 * A facility with one channel (the ETC, the HPC) reads exactly as it did
 * before this generalisation; a facility with three (the Youth Academy) is the
 * same arithmetic run three times.
 */
export interface FacilityChannel {
  /** Stable key the engine looks the channel up by. */
  id: string;
  /** Short label for what this channel governs, e.g. "squad size". */
  label: string;
  unit: "percent" | "count";
  /** Value at level 1 with nobody assigned. */
  base: number;
  /**
   * Added per facility LEVEL above 1 (v1.85). Optional, and 0 for almost
   * everything: the system's thesis is that a level buys staff slots and the
   * staff buy the numbers, so a channel that grows on its own is the exception.
   *
   * The Scouting Network is that exception, and only for `maxScouts`. How many
   * people the club may employ is a property of the department's size, not of
   * how good the people in it are — a 5-star scout doesn't create a job. Every
   * other quantity on every other facility stays on stars and badges alone.
   */
  levelEffect?: number;
  /** Added per completed `STAFF_STARS_PER_STEP` of assigned stars. */
  starEffect: number;
  /** Added per `badgeTiersPerStep` badge tiers held FOR THIS facility. */
  badgeEffect: number;
  /** How many badge tiers one `badgeEffect` step costs. The ETC and HPC pay out
   * per single tier (1); the youth/scouting pair pay per two, which is what
   * makes their badge track a slower burn than their star track. */
  badgeTiersPerStep: number;
}

export interface FacilitySpec {
  id: FacilityId;
  name: string;
  /** One-line pitch shown on the unlock card. */
  blurb: string;
  /** One-off cost to unlock at level 1. */
  unlockCost: number;
  /** Cost to go from level n to n+1, indexed by the level being LEFT (so
   * `upgradeCosts[0]` is level 1 → 2). Length fixes `maxLevel`. */
  upgradeCosts: number[];
  /** Staff slots available at level n, indexed from level 1. */
  slotsByLevel: number[];
  /** Everything this facility produces. The FIRST channel is the headline — the
   * one the banner shows and the one `effectLabel` names. */
  channels: FacilityChannel[];
  /** A capability the facility switches on once it reaches this level, rather
   * than a number it scales. Absent for facilities that only produce numbers. */
  unlockAtLevel?: { level: number; label: string; blurb: string };
}

/** The headline channel — the one the banner quotes. */
export function headlineChannel(spec: FacilitySpec): FacilityChannel {
  return spec.channels[0];
}

/** Short label for a facility's headline effect, e.g. "player growth". */
export function effectLabel(spec: FacilitySpec): string {
  return headlineChannel(spec).label;
}

/**
 * Elite Training Center — the first facility, and the template for the rest.
 *
 * It owns exactly one quantity: how fast players grow toward their potential.
 * Upgrading it never raises that number directly; an upgrade buys staff slots,
 * and the staff you put in them are what raise it. That is the system's whole
 * thesis — facilities hold the effects, staff conduct them.
 *
 * The ceiling is 33% (see the worked example at the top of this file), and it
 * takes a decade of continuous employment to reach, which is why it is allowed
 * to be a large number.
 */
export const FACILITY_SPECS: FacilitySpec[] = [
  {
    id: "eliteTrainingCenter",
    name: "Elite Training Center",
    blurb:
      "A world-class training complex. Players develop toward their potential faster — and the better the coaches you staff it with, the faster still.",
    unlockCost: 50_000_000,
    // Level 1→2 … 4→5. Rising cost, so the sixth slot is a genuine commitment.
    upgradeCosts: [20_000_000, 35_000_000, 55_000_000, 80_000_000],
    // Level:        1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      {
        id: "growth",
        label: "player growth",
        unit: "percent",
        base: 5,
        starEffect: 2,
        badgeEffect: 0.5,
        badgeTiersPerStep: 1,
      },
    ],
  },
  /**
   * High Performance Center — the end-game building (v1.81).
   *
   * It has exactly one job, and it is NOT the Elite Training Center's job. The
   * ETC multiplies growth; the HPC weakens `eliteResistMult`, the exponential
   * brake that makes growth decay to almost nothing once a player is genuinely
   * elite. The distinction is what stops the two from being the same purchase
   * bought twice:
   *
   *   - On a 70-rated prospect the resistance penalty is small, so the HPC
   *     barely does anything and the ETC is still strictly necessary.
   *   - On an 85+ player the ETC's multiplier is being applied to a number the
   *     brake has already crushed, so only the HPC moves the needle.
   *
   * Its effect is a PERCENTAGE REDUCTION OF THE PENALTY, not a growth
   * multiplier — see `eliteResistRelief` in lib/facilities.ts. That is why its
   * channels are so much larger than the ETC's: 61% off a penalty and +61%
   * growth are not the same quantity, and reading this row as if they were is
   * the one way to misjudge it.
   *
   * Ceiling: 10 (base) + 3 × 5 star steps (15) + 1 × 36 badge weight (36) = 61%.
   * The badge term is deliberately the majority of it — a maxed HPC is six
   * legacy badges, i.e. ten unbroken seasons with the same six people, which is
   * the longest commitment the game asks for anywhere.
   */
  {
    id: "highPerformanceCenter",
    name: "High Performance Center",
    blurb:
      "Sports science, load management and recovery at the very top end. World-class players stop plateauing — the harder the game makes the last ten points of a career, the more this is what carries them.",
    unlockCost: 50_000_000,
    upgradeCosts: [25_000_000, 45_000_000, 70_000_000, 100_000_000],
    // Level:        1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      {
        id: "eliteRelief",
        label: "elite resistance cut",
        unit: "percent",
        base: 10,
        starEffect: 3,
        badgeEffect: 1,
        badgeTiersPerStep: 1,
      },
    ],
  },
  /**
   * Youth Academy — the prospect pipeline, rebuilt as a facility (v1.82).
   *
   * This is the Academy screen's old Upgrades tab, collapsed into the one system
   * that already owned "a building you invest in". Those upgrades were three
   * independent level tracks bought from a tab nothing else touched; each was a
   * number you paid for directly, which is exactly the shape the facilities
   * rework exists to replace. Here the level buys STAFF SLOTS and the staff buy
   * the numbers — the same thesis as every other row in this table.
   *
   * Three channels, because the academy genuinely governs three things and
   * folding them into one would be a lie about what the money does:
   *
   *   - squad size  — how many prospects the academy can hold (15 → 30)
   *   - focus slots — how many can be flagged for guaranteed U21 minutes (3 → 8)
   *   - prospect value — the old Youth PR, what the market pays for your kids
   *
   * The badge channel pays per TWO tiers rather than per tier (the ETC's rate),
   * because these are integer capacities: a per-tier squad-size step would hand
   * out six extra places for one legacy badge, which dwarfs the star track.
   *
   * Ceiling at level 5 with six legacy-badged 5-stars (30 stars = 5 steps,
   * 36 badge weight = 18 double-tiers):
   *   squad  15 + 3×5 + 1×18 = 48 places
   *   focus   3 + 1×5 +   18 → capped by `u21FocusMax`, which is the real gate
   *   value   0% + 3×5 + 1×18 = +33% prospect value
   */
  {
    id: "youthAcademy",
    name: "Youth Academy",
    blurb:
      "Dormitories, age-group coaching and a proper pathway to the first team. Holds more prospects, lets you focus more of them, and makes the ones you raise worth more to everybody else.",
    unlockCost: 50_000_000,
    upgradeCosts: [20_000_000, 35_000_000, 55_000_000, 80_000_000],
    // Level:        1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      {
        id: "squadSize",
        label: "academy squad size",
        unit: "count",
        base: 15,
        starEffect: 3,
        badgeEffect: 1,
        badgeTiersPerStep: 2,
      },
      {
        id: "focusSlots",
        label: "focus slots",
        unit: "count",
        base: 3,
        starEffect: 1,
        badgeEffect: 0,
        badgeTiersPerStep: 2,
      },
      {
        id: "prospectValue",
        label: "prospect value",
        unit: "percent",
        base: 0,
        starEffect: 3,
        badgeEffect: 1,
        badgeTiersPerStep: 2,
      },
    ],
  },
  /**
   * Scouting Network — the scouting department, rebuilt as a facility (v1.82).
   *
   * Same move as the Youth Academy above, for the same reason: Max Scouts and
   * Scout Speed were bought-by-the-level numbers on a tab of their own. The
   * headcount cap is the headline because it is the one that gates the whole
   * department — a speed bonus on zero scouts is nothing.
   *
   * The Scout Network auto-filter (the old one-time `scoutFilter` purchase) is
   * NOT a channel: it is a capability, on or off, and modelling it as a number
   * that happens to cross zero would be dishonest about what buying it does. It
   * hangs off `unlockAtLevel` instead — reach level 5 and the brief's filter
   * controls come alive.
   *
   * The one facility that is bought by the BUILDING as well as staffed (v1.85).
   *
   * Both channels carry a `levelEffect`, which nothing else in this table does.
   * The reason is specific rather than a loosening of the rule: this facility is
   * a DEPARTMENT, and a department genuinely gets bigger and further-reaching by
   * being built bigger. How many people you may employ is its size; how fast
   * reports come back is partly its reach — regional offices and travel budgets,
   * which are bought, not coached.
   *
   * The split between the two is still the system's thesis, though, and it is
   * worth reading off the numbers: `maxScouts` is level ONLY (stars and badges
   * add no headcount, because a 5-star scouting director does not conjure a job
   * that didn't exist), while `scoutSpeed` takes only 25 of its 67 points from
   * levels and the other 42 from the people. You can buy a big department; you
   * cannot buy a fast one.
   *
   * A club that never builds this still employs `scoutNetworkBase` (2) scouts,
   * which is what makes level 1 read as "+1 scout" rather than as permission to
   * scout at all. The base below is 3 for exactly that reason: the facility's
   * level-1 value must be one MORE than the unbuilt fallback the accessor takes.
   *
   * The ladder, level by level (slots, then what the level itself is worth):
   *   L1 (unlock)  2 slots   3 scouts   +5% speed
   *   L2           3 slots   4 scouts  +10%
   *   L3           4 slots   5 scouts  +15%
   *   L4           5 slots   6 scouts  +20%
   *   L5           6 slots   7 scouts  +25%
   *
   * Ceiling at level 5 with six legacy-badged 5-stars:
   *   scouts  3 + 1×4 levels = 7 (badges deliberately don't add headcount)
   *   speed   5% + 5%×4 levels + 3%×5 star steps + 0.75%×36 tiers
   *         = 25 + 15 + 27 = +67% faster reports
   *
   * The speed channel pays per SINGLE badge tier, unlike the Youth Academy's.
   * The two-tier divisor exists there because those channels are integer
   * capacities that a per-tier rate would swamp; a percentage has no such
   * problem, and 0.75%/tier is already the small number the divisor was
   * protecting against.
   */
  {
    id: "scoutingNetwork",
    name: "Scouting Network",
    blurb:
      "Regional contacts, travel budgets and retainers that keep your scouts moving. Employ more of them, and get their reports back faster.",
    unlockCost: 50_000_000,
    upgradeCosts: [20_000_000, 35_000_000, 55_000_000, 80_000_000],
    // Level:        1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      {
        id: "maxScouts",
        label: "max scouts",
        unit: "count",
        // One more than the unbuilt baseline, so building the facility is worth
        // exactly the +1 scout the ladder above promises.
        base: 3,
        levelEffect: 1,
        // Headcount comes from the BUILDING alone. Neither stars nor badges add
        // a job: how good your scouts are is not how many of them you employ,
        // and a badge track on top would push the department past any sane size.
        starEffect: 0,
        badgeEffect: 0,
        badgeTiersPerStep: 1,
      },
      {
        id: "scoutSpeed",
        label: "scouting speed",
        unit: "percent",
        base: 5,
        levelEffect: 5,
        starEffect: 3,
        badgeEffect: 0.75,
        badgeTiersPerStep: 1,
      },
    ],
    unlockAtLevel: {
      level: 5,
      label: "Scout Network",
      blurb:
        "Unlocks the brief auto-filter: set the age, the ability band and the rarity tiers you'll accept, and nothing outside them ever reaches your board.",
    },
  },
];

export const FACILITY_MAP: Record<FacilityId, FacilitySpec> = Object.fromEntries(
  FACILITY_SPECS.map((f) => [f.id, f])
) as Record<FacilityId, FacilitySpec>;

// ── Art ────────────────────────────────────────────────────────────────────
//
// Paths are DERIVED from the id and the tier, never stored per row — the same
// call `archetypeIconSrc` makes, and for the same reason: a hand-written path
// column is one more chance to typo a filename that only fails at runtime, as a
// broken image. A facility's art is its `artKey` plus a suffix, so shipping the
// second facility is the row above and two files dropped in `/public/facilities`.
//
// Whether the file is actually THERE is the UI's problem: both `FacilityBanner`
// and `BadgeIcon` fall back to a drawn treatment, so a facility with no art
// degrades to something honest rather than a broken image.

/** Filename stem for a facility's art. The ids are camelCase and the files are
 * short codes, so this is the one place the two vocabularies meet. */
/** Filename stem for a facility's art, or null while a facility's art has not
 * been drawn yet.
 *
 * Null rather than a hopeful path: both `FacilityBanner` and `BadgeIcon` fall
 * back to a drawn treatment either way, but a path that 404s makes the browser
 * fetch a file that isn't there on every render — noise in the console that
 * hides real errors, and the reason the UI drive's error check exists. Fill the
 * stem in the moment the files land in `/public/facilities`. */
const FACILITY_ART_KEY: Record<FacilityId, string | null> = {
  eliteTrainingCenter: "etc",
  // No art shipped yet — these render the drawn fallback by design.
  highPerformanceCenter: null,
  youthAcademy: null,
  scoutingNetwork: null,
};

/** The wide establishing shot used as the facility card's banner. */
export function facilityHeaderSrc(id: FacilityId): string | null {
  const key = FACILITY_ART_KEY[id];
  return key ? `/facilities/facility-header/${key}_header.png` : null;
}

/** The badge crest for one tier at one facility. Each facility has its own set
 * of six — the crest carries the building's mark, the ring carries the tier. */
export function badgeIconSrc(id: FacilityId, tier: BadgeTier): string | null {
  const key = FACILITY_ART_KEY[id];
  return key ? `/facilities/facility-badges/${key}_${tier}.png` : null;
}

/** Each tier's accent, sampled from the crest art so the text that names a tier
 * and the icon beside it are never two different golds. */
export const BADGE_COLOR: Record<BadgeTier, string> = {
  bronze: "#c8813a",
  silver: "#b9c1cb",
  gold: "#ffd200",
  diamond: "#5fd0e8",
  obsidian: "#8f7bd4",
  legacy: "#d81337",
};

/** Max level a facility can reach — one more than the number of upgrade steps. */
export function facilityMaxLevel(spec: FacilitySpec): number {
  return spec.upgradeCosts.length + 1;
}

// ── Hiring market ──────────────────────────────────────────────────────────

/** Weekly wage for a staff member. Superlinear in stars so a 5-star is a real
 * budget decision rather than an obvious auto-buy, and so filling six slots
 * with 5-stars is a wage bill you have to grow into. */
export function staffWageFor(stars: number): number {
  return stars * stars * 4_000 + 10_000;
}

/** One-off signing fee. Badges the candidate already earned elsewhere are worth
 * paying for — they arrive productive on day one. */
export function staffFeeFor(stars: number, badgeWeight: number): number {
  return stars * stars * 120_000 + badgeWeight * 200_000;
}

/** How many candidates the market shows at once. */
export const STAFF_MARKET_SIZE = 8;

// The refresh cadence is NOT here: the staff shortlist cycles on the same clock
// as the scouting one, `TUNING.marketRefreshDays`, driven from gameloop's
// `state.marketRefreshDay`. A second constant here would be a number the loop
// never reads — which is exactly what the deleted STAFF_MARKET_REFRESH_DAYS was.

/**
 * Age band for staff.
 *
 * Two different numbers, and the distinction matters. `STAFF_HIRE_MIN_AGE` …
 * `STAFF_HIRE_MAX_AGE` is the band the MARKET generates in — everyone on the
 * shortlist is somewhere in a career, not at the end of one. `STAFF_MAX_AGE` is
 * when a person RETIRES, which sits far above the hiring band on purpose: a
 * 24-year-old you hire has forty seasons in them, which is what makes the ten
 * seasons a legacy badge costs a commitment you can actually plan.
 */
export const STAFF_HIRE_MIN_AGE = 21;
export const STAFF_HIRE_MAX_AGE = 35;
/** Retirement age — a staff member past this leaves at the season rollover. */
export const STAFF_MAX_AGE = 65;

/**
 * How rare a candidate arriving WITH a prior-club badge is.
 *
 * The market's job is to sell you stars; badges are what your own club grows.
 * A shortlist where a third of the names already hold a record makes the ten
 * seasons a legacy badge costs pointless — you'd just buy one. So the base
 * chance is small, experience within the (now narrow, 21–35) hiring band moves
 * it only a little, and the tier is capped hard: see `BADGE_HIRE_MAX_TIER`.
 */
export const BADGE_HIRE_BASE_CHANCE = 0.03;
/** Added across the full hiring age band (21 → 35). */
export const BADGE_HIRE_EXPERIENCE_CHANCE = 0.05;
/** Added per star above `STAFF_MIN_STARS`. */
export const BADGE_HIRE_STAR_CHANCE = 0.01;

/**
 * The best tier the market will ever offer, and the odds of clearing the bar.
 *
 * Silver is the ceiling in the ordinary case — two seasons somewhere else. A
 * gold-or-better hire exists (it should be a genuine event when one appears),
 * but it takes a second roll at `BADGE_HIRE_HIGH_TIER_CHANCE`, and even then
 * `BADGE_HIRE_ABSOLUTE_MAX_TIER` keeps `diamond` the hard ceiling — obsidian
 * and legacy have to be earned at your club, full stop.
 */
export const BADGE_HIRE_MAX_TIER: BadgeTier = "silver";
export const BADGE_HIRE_HIGH_TIER_CHANCE = 0.08;
export const BADGE_HIRE_ABSOLUTE_MAX_TIER: BadgeTier = "diamond";

/** Cumulative seasons a tier is worth — the ladder read backwards, used to turn
 * a tier cap into the season cap that produces it. */
export function seasonsForTier(tier: BadgeTier): number {
  return BADGE_LADDER.find((r) => r.tier === tier)?.seasons ?? 1;
}

/** Nationalities generated staff are drawn from (all render a flag — see
 * lib/config/flags.ts). */
export const STAFF_NATIONALITIES = [
  "ENG", "ESP", "ITA", "GER", "FRA", "NED", "POR", "BRA", "ARG", "SCO", "IRL", "BEL", "SWE", "SUI",
];

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
// what the ETC and the HPC still use. It exists because some quantities are
// genuinely bought by the BUILDING rather than by who works in it — a scouting
// department's headcount, an academy's beds. Two facilities declare it (the
// Scouting Network and, since v1.87, the Youth Academy) and `verify:facilities`
// sanctions those channels BY NAME, so a third is a decision someone argues for
// in a diff rather than a habit that creeps back one row at a time. See each of
// those rows for the argument it makes.
//
// Worked example (the design brief's own, and asserted by verify:facilities):
// ETC at level 5, six 5-star staff (30 stars), every one holding a legacy ETC
// badge (tier 6):
//   base 5% + 2% × floor(30/6) + 0.5% × (6 badges × 6 tiers)
//   = 5 + 10 + 18 = 33% faster player growth.

import type { BadgeTier, FacilityId } from "../types";
import { ARCHETYPE_CLASS_ORDER, type ArchetypeClass } from "./archetype";

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
   * Added per facility LEVEL above 1 (v1.85). Optional, and 0 by default: the
   * system's thesis is that a level buys staff slots and the staff buy the
   * numbers, so a channel that grows on its own is the exception.
   *
   * The exceptions are CAPACITIES — quantities that belong to the building
   * rather than to the people in it. How many scouts the club may employ, how
   * many teenagers the academy can house, how many of them get focused: a
   * 5-star coach doesn't create a job or conjure a bed. The Scouting Network
   * (v1.85) and the Youth Academy (v1.87) declare it; `verify:facilities` names
   * exactly which channels are allowed one, so adding a third is a deliberate
   * edit to that list and not an oversight.
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

// ── The archetype development centers (v1.93) ─────────────────────────────
//
// Five facilities that are the same facility five times over, so they are
// GENERATED from one function rather than copy-pasted. Five near-identical
// hand-written specs is five places for a number to drift, and the whole point
// of this table is that a facility is data.
//
// ── One per class, and the list is DERIVED ────────────────────────────────
// The set is `ARCHETYPE_CLASS_ORDER` itself rather than a hand-written list, so
// a class can never exist without a center or a center without a class. The
// first cut shipped only four — `Blitzer` was left out on the argument that it
// is already the class with the sharpest style edges and so least needed a
// building. That was wrong in a way the tables couldn't show: it made Blitzer
// the one class a player could never be CONVERTED to, so the direct
// counter-attacking roles were the only ones in the game that had to be bought
// or grown rather than coached. An asymmetry that big has to be a rule the
// player can read, and "every class has a center" is the readable rule.
//
// ── The two things a center does ──────────────────────────────────────────
//   1. `growth` — a percentage uplift on seasonal growth for players who
//      currently DERIVE that class. An ordinary channel, read by
//      development.ts through the usual accessor.
//   2. `convertSpeed` — how much faster the archetype conversion on the
//      Development → Archetype page runs. Only meaningful once the level-5
//      capability is unlocked, which is why it is a channel and the unlock
//      itself is an `unlockAtLevel`: "how fast" is a number, "may I at all" is
//      not, and modelling the second as a number crossing zero is the mistake
//      the Scouting Network's filter comment already argues against.
//
// The brief's headline for the speed channel: 10% per 6 stars, so 30 stars
// halves a 2-season conversion to 1. `conversionSeasons` in lib/archetypedev.ts
// is what turns this percentage into seasons; the 50% that a full staff earns is
// exactly the "2 years → 1 year" the brief asks for.
export const ARCHETYPE_DEV_CLASS: { id: FacilityId; cls: ArchetypeClass }[] =
  ARCHETYPE_CLASS_ORDER.map((cls) => ({
    // The id is the class's own name, lowercased — derived rather than mapped,
    // so a new class cannot be added without its center coming with it. The
    // `FacilityId` union still spells all five out, which is what makes a
    // mismatch a compile error rather than a runtime one.
    id: `${cls.toLowerCase()}Development` as FacilityId,
    cls,
  }));

/** Is this facility one of the four archetype development centers? Callers use
 * this rather than naming an id, so the rules file keeps its no-facility-in-a-
 * conditional guarantee. */
export function archetypeDevClassOf(id: FacilityId): ArchetypeClass | null {
  return ARCHETYPE_DEV_CLASS.find((r) => r.id === id)?.cls ?? null;
}

/** The center that develops a given class. Every class has one, but this still
 * returns null for an unrecognised string — callers pass a derived archetype's
 * class, and a player with no derivable archetype has none. */
export function archetypeDevFacilityFor(cls: string): FacilityId | null {
  return ARCHETYPE_DEV_CLASS.find((r) => r.cls === cls)?.id ?? null;
}

function archetypeDevSpec(id: FacilityId, cls: ArchetypeClass): FacilitySpec {
  return {
    id,
    name: `${cls} Archetype Development`,
    blurb: `Specialist coaching built around the ${cls} game. ${cls}s at the club develop faster — and once the department is complete, it can retrain a player into a ${cls} role outright.`,
    unlockCost: 200_000_000,
    upgradeCosts: [40_000_000, 60_000_000, 90_000_000, 130_000_000],
    // Level:      1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      {
        id: "growth",
        label: `${cls.toLowerCase()} growth`,
        unit: "percent",
        base: 5,
        levelEffect: 1,
        starEffect: 0,
        badgeEffect: 0.1,
        badgeTiersPerStep: 1,
      },
      {
        // 10% per 6-star step, so six 5-stars (30 stars) is 50% off the wait —
        // the brief's "2 seasons becomes 1". No level or badge term: the level
        // is what unlocks the capability at all, and the speed is the people.
        id: "convertSpeed",
        label: "conversion speed",
        unit: "percent",
        base: 0,
        starEffect: 10,
        badgeEffect: 0,
        badgeTiersPerStep: 1,
      },
      {
        id: "staffSlots",
        label: "staff slots",
        unit: "count",
        base: 2,
        levelEffect: 1,
        starEffect: 0,
        badgeEffect: 0,
        badgeTiersPerStep: 1,
      },
    ],
    unlockAtLevel: {
      level: 5,
      label: `${cls} retraining`,
      blurb: `Unlocks the ${cls} section of Development → Archetype: pick a player and retrain him into a ${cls} role. His attributes are reshaped toward it over the course of the programme, and his overall is preserved.`,
    },
  };
}

const ARCHETYPE_DEV_SPECS: FacilitySpec[] = ARCHETYPE_DEV_CLASS.map((r) =>
  archetypeDevSpec(r.id, r.cls)
);

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
   * Youth Academy — the prospect pipeline, rebuilt as a facility (v1.82),
   * re-laddered so that BUILDING it actually does something (v1.87).
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
   *   - squad size  — how many prospects the academy can hold (15 → 50)
   *   - focus slots — how many can be flagged for guaranteed U21 minutes (3 → 8)
   *   - prospect value — the old Youth PR, what the market pays for your kids
   *
   * ── The second sanctioned level term, and why (v1.87) ────────────────────
   *
   * The v1.82 shape had `base: 15` squad places and `base: 3` focus slots — the
   * SAME numbers `academySquadSizeBase` and `u21FocusBase` give a club that
   * never built the thing. So spending £50M on level 1 changed literally
   * nothing: the capacities only started moving once six staff stars were in
   * post, and the four upgrades after that bought nothing but slots to put them
   * in. A £50M purchase whose immediate effect is zero doesn't read as an
   * investment, it reads as a bug.
   *
   * The fix is a `levelEffect` on all three channels, which makes this the
   * second facility to carry one after the Scouting Network. That is a rule
   * being crossed deliberately, so the argument has to be on the page:
   *
   *   - Squad size and focus slots are the same KIND of quantity as the
   *     scouting department's headcount — a capacity that belongs to the
   *     BUILDING. How many teenagers you can house is dormitories and pitches;
   *     a five-star coach does not conjure a bed. That reasoning is the one
   *     `scoutingNetwork/maxScouts` already makes, and it applies here
   *     unchanged.
   *   - Prospect value takes a level term for a different reason: it is the
   *     channel that gives the unlock a visible effect on day one. At +3%/level
   *     it stays the SMALLEST of its three terms (15 of the 43-point ceiling),
   *     so the staff still buy most of it.
   *
   * What keeps this from becoming the habit v1.79 and v1.82 exist to prevent is
   * that the staff track still dominates where it matters: 28 of the 43 value
   * points come from people, and the building only ever buys ROOM — ten of the
   * 35 places above the unbuilt baseline are staffed, and no amount of building
   * makes a single prospect develop faster. You can build a big academy; you
   * cannot build a good one.
   * `verify:facilities` sanctions these three channels by name and nothing else.
   *
   * The ladder, level by level — every rung is the same rung, which is what
   * makes it legible without a table on screen:
   *
   *   L1 (unlock)  2 slots   20 places   4 focus   +3%
   *   L2           3 slots   25 places   5 focus   +6%
   *   L3           4 slots   30 places   6 focus   +9%
   *   L4           5 slots   35 places   7 focus  +12%
   *   L5           6 slots   40 places   8 focus  +15%
   *
   * The badge channel pays per TWO tiers rather than per tier (the ETC's rate),
   * because these are integer capacities: a per-tier squad-size step would hand
   * out six extra places for one legacy badge, which dwarfs the star track.
   * Focus slots take NO star or badge term at all (v1.87) — they are purely a
   * property of the building, so the ladder above is the whole story and the
   * count can't drift with who happens to be in post this season.
   *
   * Ceiling at level 5 with six legacy-badged 5-stars (30 stars = 5 steps,
   * 36 badge weight = 18 double-tiers):
   *   squad  20 + 5×4 levels + 2×5 star steps            = 50 places
   *   focus   4 + 1×4 levels                             =  8, under `u21FocusMax`
   *   value   3% + 3×4 levels + 2×5 steps + 0.5×36 tiers = +43% prospect value
   *
   * (The level term is paid for levels ABOVE the first — `base` is already the
   * level-1 value, which is why each line reads ×4 rather than ×5.)
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
        // Five above the unbuilt 15, so the unlock is worth a visible five beds.
        base: 20,
        levelEffect: 5,
        starEffect: 2,
        badgeEffect: 0,
        badgeTiersPerStep: 2,
      },
      {
        id: "focusSlots",
        label: "focus slots",
        unit: "count",
        // One above the unbuilt 3. Level alone from here — see the note above.
        base: 4,
        levelEffect: 1,
        starEffect: 0,
        badgeEffect: 0,
        badgeTiersPerStep: 2,
      },
      {
        id: "prospectValue",
        label: "prospect value",
        unit: "percent",
        base: 3,
        levelEffect: 3,
        starEffect: 2,
        badgeEffect: 0.5,
        badgeTiersPerStep: 1,
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
  /**
   * Club Income Center — the first facility that moves MONEY (v1.93).
   *
   * Everything before it changed players. This changes the books, and it does so
   * through the two levers a commercial department actually has: what the club
   * earns every week, and what a sponsor is willing to offer for its name.
   *
   * Three channels, and they are deliberately different KINDS of number:
   *
   *   - `weeklyIncome`   — a percentage uplift on the club's gross weekly
   *                        income (TV, gate, position bonus, facilities,
   *                        sponsorship). Read by `economy.ts`.
   *   - `sponsorOffers`  — a percentage uplift on what major AND minor sponsor
   *                        offers arrive at. Read by `sponsors.ts` at the moment
   *                        an offer is generated, so a deal already signed is
   *                        never retroactively repriced — the uplift is what the
   *                        department negotiated, not a rewrite of history.
   *   - `staffSlots`     — see below.
   *
   * ── Why `staffSlots` is a CHANNEL here and not a `slotsByLevel` row ───────
   * It is both, and they must agree. `slotsByLevel` is what the system has
   * always used and what `slotCount` reads; the channel exists so the card can
   * show the slot ladder as arithmetic beside the other two, which is how the
   * brief describes it ("+1 staff slot" per level, exactly like "+2% income").
   * `verify:facilities` asserts the two never disagree, so this can't drift into
   * a second source of truth for how many people the building holds.
   *
   * Ceiling at level 5 with six legacy-badged 5-stars (30 stars = 5 steps,
   * 36 badge weight):
   *   income   5% + 2×4 levels + 2×5 star steps        = +23%/wk
   *   sponsors 5% + 1×4 levels + 0.5×36 tiers          = +27% on offers
   *   slots    2 + 1×4                                 = 6
   */
  {
    id: "clubIncomeCenter",
    name: "Club Income Center",
    blurb:
      "A commercial department that works the club's revenue: better weekly receipts across the board, and sponsors who come to the table with more.",
    unlockCost: 100_000_000,
    upgradeCosts: [30_000_000, 50_000_000, 75_000_000, 110_000_000],
    // Level:        1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      {
        id: "weeklyIncome",
        label: "weekly income",
        unit: "percent",
        base: 5,
        levelEffect: 2,
        starEffect: 2,
        badgeEffect: 0,
        badgeTiersPerStep: 1,
      },
      {
        id: "sponsorOffers",
        label: "sponsorship offers",
        unit: "percent",
        base: 5,
        levelEffect: 1,
        starEffect: 0,
        badgeEffect: 0.5,
        badgeTiersPerStep: 1,
      },
      {
        id: "staffSlots",
        label: "staff slots",
        unit: "count",
        base: 2,
        levelEffect: 1,
        starEffect: 0,
        badgeEffect: 0,
        badgeTiersPerStep: 1,
      },
    ],
  },
  /**
   * Club Expense Center — the other half of the books (v1.93).
   *
   * Its channels are REDUCTIONS, and they are stored as positive percentages
   * with the consuming code subtracting them — the same convention
   * `eliteResistRelief` uses for the HPC. A negative number in a table that
   * every other row reads as "more is better" is the kind of sign error that
   * only shows up as a doubled wage bill three seasons into a save.
   *
   * Three wage bills, three separate channels, because the brief prices them
   * separately and because they are genuinely different money: the squad's wages
   * dwarf the other two put together, so a single blended "wages" channel would
   * make the academy and staff terms invisible.
   *
   * The staff term is the largest (5% base, and the only one with a badge track)
   * for the obvious reason: this facility is staffed, and a department that
   * negotiates its own contracts down is the one bit of the building that pays
   * for itself.
   *
   * Ceiling at level 5 with six legacy-badged 5-stars (30 stars = 5 steps,
   * 36 badge weight):
   *   squad   3% + 1×4 levels + 0.2×5 stars + 0.25×36 badges = −17%
   *   academy 3% + 1×4 + 1 + 9                              = −17%
   *   staff   5% + 1×4 + 1 + 1×36                           = −46%
   *   slots   2 + 1×4                                       = 6
   *
   * Note the squad line is the one that matters in money terms: a top-flight
   * wage bill dwarfs the other two put together, so −17% of it is worth far
   * more per week than −46% of the backroom. The percentages read backwards on
   * purpose — the bill they apply to is what sets their value.
   */
  {
    id: "clubExpenseCenter",
    name: "Club Expense Center",
    blurb:
      "Contract negotiators, payroll and procurement. Everything the club pays out every week costs it a little less — and the backroom bill least of all.",
    unlockCost: 100_000_000,
    upgradeCosts: [30_000_000, 50_000_000, 75_000_000, 110_000_000],
    // Level:        1  2  3  4  5
    slotsByLevel: [2, 3, 4, 5, 6],
    channels: [
      // ── The badge term on these two is not in the design brief ────────────
      // The brief gives the squad and academy cuts a level term (−1%/level) and
      // a star term (−0.2% per 6 stars) and no badge track at all. Taken
      // literally that is 4 points from the BUILDING against 1 from the PEOPLE
      // — the bought-by-the-level shape v1.79 and v1.82 exist to delete, and
      // `verify:facilities` refuses it on exactly those grounds.
      //
      // The brief's headline numbers are kept unchanged; what is added is a
      // badge track at the same 0.25%/tier, worth 9 points at a fully
      // legacy-badged department. That leaves levels 4, staff 10, so the people
      // buy most of it — and it costs a decade of continuous service, which is
      // the slowest thing in the game to buy and the right price for the
      // biggest bill on the books.
      {
        id: "squadWageCut",
        label: "squad wage cut",
        unit: "percent",
        base: 3,
        levelEffect: 1,
        starEffect: 0.2,
        badgeEffect: 0.25,
        badgeTiersPerStep: 1,
      },
      {
        id: "academyWageCut",
        label: "academy wage cut",
        unit: "percent",
        base: 3,
        levelEffect: 1,
        starEffect: 0.2,
        badgeEffect: 0.25,
        badgeTiersPerStep: 1,
      },
      {
        id: "staffWageCut",
        label: "staff wage cut",
        unit: "percent",
        base: 5,
        levelEffect: 1,
        starEffect: 0.2,
        badgeEffect: 1,
        badgeTiersPerStep: 1,
      },
      {
        id: "staffSlots",
        label: "staff slots",
        unit: "count",
        base: 2,
        levelEffect: 1,
        starEffect: 0,
        badgeEffect: 0,
        badgeTiersPerStep: 1,
      },
    ],
  },
  // The four archetype development centers (v1.93) are generated below rather
  // than written out four times — see `archetypeDevSpec`.
  ...ARCHETYPE_DEV_SPECS,
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
  clubIncomeCenter: null,
  clubExpenseCenter: null,
  engineDevelopment: null,
  creatorDevelopment: null,
  enforcerDevelopment: null,
  maverickDevelopment: null,
  blitzerDevelopment: null,
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

/**
 * Weekly wage for a staff member. Superlinear in stars so a 5-star is a real
 * budget decision rather than an obvious auto-buy, and so filling six slots
 * with 5-stars is a wage bill you have to grow into.
 *
 * `tierMult` (v1.89) is what the club's DIVISION does to that number — see
 * `TUNING.staffWageByTier` for the ladder and why it is flat. It is passed in
 * rather than looked up because this module is pure data: it must not reach into
 * a GameState. Callers resolve it through `staffWageMultiplier` in
 * lib/facilities.ts, which is the single place the tier is read.
 */
export function staffWageFor(stars: number, tierMult = 1): number {
  return Math.round((stars * stars * 4_000 + 10_000) * tierMult);
}

/** One-off signing fee. Badges the candidate already earned elsewhere are worth
 * paying for — they arrive productive on day one. Scaled by the same divisional
 * multiplier as the wage (v1.89): a fee a fourth-tier club can't raise is the
 * same barrier as a wage it can't service. */
export function staffFeeFor(stars: number, badgeWeight: number, tierMult = 1): number {
  return Math.round((stars * stars * 120_000 + badgeWeight * 200_000) * tierMult);
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
 * How rare a candidate arriving WITH a prior-club badge is (reworked v1.97).
 *
 * The market's job is to sell you stars; badges are what your own club grows.
 * A shortlist where a third of the names already hold a record makes the ten
 * seasons a legacy badge costs pointless — you'd just buy one.
 *
 * The odds are now stated DIRECTLY, one probability per tier, rather than
 * derived from a "does he have one at all" roll and then a capped season draw.
 * That predecessor could only ever express "rare, and rarer above silver" as two
 * gates plus a hard ceiling, so the actual chance of meeting a gold hire wasn't
 * readable anywhere — you had to multiply a base rate by an age term by a star
 * term by a cap roll by a uniform draw over seasons. Here it's the table:
 *
 *   bronze 3%  ·  silver 2%  ·  gold 1%  ·  diamond 0.5%  ·  obsidian 0.25%
 *   ·  legacy 0.1%      — 6.85% of candidates hold a badge at all.
 *
 * Obsidian and legacy are reachable on the market now, which reverses the old
 * `BADGE_HIRE_ABSOLUTE_MAX_TIER` rule (deleted). At 1-in-400 and 1-in-1000 a
 * top-tier hire is rarer than the old "gold is a genuine event" case ever was,
 * so the ladder is no more purchasable than before — the ceiling was doing the
 * work a small number does better.
 *
 * Nothing about the candidate moves these odds. The old experience and star
 * terms were near-inert by construction (the hiring band is only 21–35, so the
 * age term spanned a few points of a percent) and they made a badge read as a
 * property of the person rather than as luck of the shortlist.
 */
export const BADGE_HIRE_TIER_CHANCE: Record<BadgeTier, number> = {
  bronze: 0.03,
  silver: 0.02,
  gold: 0.01,
  diamond: 0.005,
  obsidian: 0.0025,
  legacy: 0.001,
};

/**
 * Having earned one badge elsewhere, the chance of a second and a third.
 *
 * Conditional on the first, so a two-badge candidate is 6.85% × 10% ≈ 0.7% of
 * the shortlist and a three-badge one 6.85% × 1% ≈ 0.07%. Someone who has served
 * whole seasons at two different buildings for a previous employer is a career,
 * not a candidate — it should be a thing you notice.
 */
export const BADGE_HIRE_SECOND_CHANCE = 0.1;
export const BADGE_HIRE_THIRD_CHANCE = 0.01;

/**
 * The tier distribution for the SECOND and THIRD badges — relative weights,
 * normalised at the point of use, so they read as the shares they are.
 *
 * Flatter and far more bottom-heavy than the first-badge table, and
 * deliberately a different shape: the first badge answers "does this candidate
 * have a record at all", where the honest answer is almost always no. Once he
 * demonstrably does, the question is only which tier the extra one is, and a
 * long second career is much likelier to have been a short spell somewhere than
 * another decade. 40/30/20/5/2.5/1 bronze → legacy.
 */
export const BADGE_HIRE_EXTRA_TIER_WEIGHT: Record<BadgeTier, number> = {
  bronze: 40,
  silver: 30,
  gold: 20,
  diamond: 5,
  obsidian: 2.5,
  legacy: 1,
};

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

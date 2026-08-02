// Facilities & staff — rules (v1.79).
//
// Everything the facilities system DOES. All the numbers live in
// `config/facilities.ts`; this file never hard-codes one, and never names a
// facility in a conditional — every function takes a `FacilityId` and looks the
// spec up, so shipping the second facility is a table row and nothing here.
//
// The model, in one line:
//   a FACILITY holds an effect; STAFF assigned to it amplify that effect via
//   their stars and the badges they have earned there.
//
// A staff member has no intrinsic effect — move them out of a facility and they
// contribute exactly nothing. That is deliberate: it keeps "what does this hire
// do for me?" answerable by pointing at one building.
//
// v1.85 adds a LEVEL term (`levelEffect`) alongside base/stars/badges. It is not
// a second channel and not a way to buy an effect by the level: it defaults to 0
// and exactly one channel in the whole table declares it — the Scouting
// Network's `maxScouts`, where "how many people may I employ" is a property of
// the department's size rather than of who works there. See that spec's comment.
//
// v1.82: a facility may produce several QUANTITIES (the Youth Academy governs
// squad size, focus slots and prospect value at once). That is not a fourth
// channel — each quantity runs the identical base/stars/badges scaling, so the
// arithmetic is one function applied N times. Engine callers read a quantity by
// name through `facilityChannelValue`, never by reaching into a spec.

import type {
  BadgeTier,
  FacilityId,
  FacilityState,
  GameState,
  StaffBadge,
  StaffCandidate,
  StaffPerson,
  Team,
} from "./types";
import {
  BADGE_HIRE_ABSOLUTE_MAX_TIER,
  BADGE_HIRE_BASE_CHANCE,
  BADGE_HIRE_EXPERIENCE_CHANCE,
  BADGE_HIRE_HIGH_TIER_CHANCE,
  BADGE_HIRE_MAX_TIER,
  BADGE_HIRE_STAR_CHANCE,
  BADGE_LADDER,
  FACILITY_MAP,
  FACILITY_SPECS,
  STAFF_BADGE_SLOTS,
  STAFF_HIRE_MAX_AGE,
  STAFF_HIRE_MIN_AGE,
  STAFF_MARKET_SIZE,
  STAFF_MAX_AGE,
  STAFF_MAX_STARS,
  STAFF_MIN_STARS,
  STAFF_NATIONALITIES,
  STAFF_STARS_PER_STEP,
  facilityMaxLevel,
  seasonsForTier,
  staffFeeFor,
  staffWageFor,
  type FacilityChannel,
  type FacilitySpec,
} from "./config/facilities";
import { NAME_POOLS } from "./config/names";
import { mulberry32, pick, randInt, uid, type RNG } from "./rng";

// ── Badges ────────────────────────────────────────────────────────────────

/** The tier a given number of completed seasons at one facility earns. Returns
 * null below the first rung — a staff member who has served less than a full
 * season holds no badge yet. */
export function badgeTierFor(seasons: number): BadgeTier | null {
  let out: BadgeTier | null = null;
  for (const rung of BADGE_LADDER) {
    if (seasons >= rung.seasons) out = rung.tier;
  }
  return out;
}

/** A tier's numeric weight (bronze = 1 … legacy = 6) — what `badgeEffect` is
 * multiplied by. */
export function badgeWeight(tier: BadgeTier): number {
  return BADGE_LADDER.find((r) => r.tier === tier)?.weight ?? 0;
}

/** Seasons still to serve before the next tier, or null once at `legacy`. */
export function seasonsToNextBadge(seasons: number): number | null {
  const next = BADGE_LADDER.find((r) => seasons < r.seasons);
  return next ? next.seasons - seasons : null;
}

/** Total badge weight a staff member holds for one specific facility. Badges
 * earned elsewhere are worth nothing here — a legacy academy coach moved into
 * the training centre starts from zero at that building. */
export function badgeWeightAt(person: StaffPerson | StaffCandidate, facility: FacilityId): number {
  const badge = person.badges.find((b) => b.facility === facility);
  return badge ? badgeWeight(badge.tier) : 0;
}

/** Every badge a person holds, weighted — used for pricing a candidate and for
 * sorting the roster by pedigree. */
export function totalBadgeWeight(person: StaffPerson | StaffCandidate): number {
  return person.badges.reduce((s, b) => s + badgeWeight(b.tier), 0);
}

// ── Facility state ────────────────────────────────────────────────────────

export function facilityStateOf(team: Team, id: FacilityId): FacilityState | undefined {
  return team.facilities?.[id];
}

export function facilityLevel(team: Team, id: FacilityId): number {
  return facilityStateOf(team, id)?.level ?? 0;
}

export function isUnlocked(team: Team, id: FacilityId): boolean {
  return facilityLevel(team, id) > 0;
}

/** Staff slots the facility offers at its current level. 0 when locked. */
export function slotCount(team: Team, id: FacilityId): number {
  const level = facilityLevel(team, id);
  if (level <= 0) return 0;
  const spec = FACILITY_MAP[id];
  return spec.slotsByLevel[Math.min(level, spec.slotsByLevel.length) - 1];
}

/** Cost to take the facility to its next level, or null if maxed/locked. */
export function upgradeCost(team: Team, id: FacilityId): number | null {
  const level = facilityLevel(team, id);
  const spec = FACILITY_MAP[id];
  if (level <= 0 || level >= facilityMaxLevel(spec)) return null;
  return spec.upgradeCosts[level - 1];
}

// ── Roster & assignment queries ───────────────────────────────────────────

export function rosterOf(team: Team): StaffPerson[] {
  return team.staffRoster ?? [];
}

/** Everyone currently assigned to one facility. */
export function assignedTo(team: Team, id: FacilityId): StaffPerson[] {
  return rosterOf(team).filter((s) => s.assignedTo === id);
}

/** Everyone employed but not working anywhere — paid, contributing nothing. */
export function unassigned(team: Team): StaffPerson[] {
  return rosterOf(team).filter((s) => !s.assignedTo);
}

/** Total stars assigned to a facility — the input to its star bonus. */
export function assignedStars(team: Team, id: FacilityId): number {
  return assignedTo(team, id).reduce((s, m) => s + m.stars, 0);
}

// ── The effect ────────────────────────────────────────────────────────────

/** A facility's effect, broken into its three channels so the UI can show the
 * arithmetic rather than a single opaque number. All values are percentages;
 * `total` is what the engine consumes. A locked facility is all zeroes. */
/** One channel's arithmetic, broken into its three terms. */
export interface ChannelEffect {
  id: string;
  label: string;
  unit: "percent" | "count";
  base: number;
  /** From the facility's own LEVEL, above level 1 (v1.85). Zero for every
   * channel that doesn't declare a `levelEffect` — i.e. almost all of them. */
  levels: number;
  /** From total assigned stars, in whole `STAFF_STARS_PER_STEP` steps. */
  stars: number;
  /** From badges held FOR THIS facility by the staff assigned to it. */
  badges: number;
  /** base + levels + stars + badges. Floored for `count` channels — half a
   * squad place is not a thing, and the engine must consume the same integer
   * the UI shows. */
  total: number;
  /** Completed badge steps behind the `badges` term, and what one costs. */
  badgeSteps: number;
  badgeTiersPerStep: number;
}

export interface FacilityEffect {
  /** Every channel this facility produces, in table order. */
  channels: ChannelEffect[];
  /** The headline channel's terms, lifted to the top level so the one-channel
   * facilities (and every caller written before v1.82) read unchanged. */
  base: number;
  levels: number;
  stars: number;
  badges: number;
  total: number;
  /** Diagnostics for the UI. */
  totalStars: number;
  /** Completed star steps (floor(totalStars / STAFF_STARS_PER_STEP)). */
  starSteps: number;
  /** Stars still needed for the next step. */
  starsToNextStep: number;
  totalBadgeWeight: number;
  slotsUsed: number;
  slots: number;
}

const EMPTY_EFFECT: FacilityEffect = {
  channels: [], base: 0, levels: 0, stars: 0, badges: 0, total: 0,
  totalStars: 0, starSteps: 0, starsToNextStep: STAFF_STARS_PER_STEP,
  totalBadgeWeight: 0, slotsUsed: 0, slots: 0,
};

/** One channel, given the facility's level and the star steps and badge weight
 * already assigned. */
function channelEffect(
  ch: FacilityChannel,
  level: number,
  starSteps: number,
  badgeWeightHere: number
): ChannelEffect {
  const badgeSteps = Math.floor(badgeWeightHere / ch.badgeTiersPerStep);
  const base = ch.base;
  // Levels ABOVE the first: `base` is already the level-1 value, so a fresh
  // build must not be paid the level term as well.
  const levels = Math.max(0, level - 1) * (ch.levelEffect ?? 0);
  const stars = starSteps * ch.starEffect;
  const badges = badgeSteps * ch.badgeEffect;
  const raw = base + levels + stars + badges;
  return {
    id: ch.id,
    label: ch.label,
    unit: ch.unit,
    base,
    levels,
    stars,
    badges,
    total: ch.unit === "count" ? Math.floor(raw) : raw,
    badgeSteps,
    badgeTiersPerStep: ch.badgeTiersPerStep,
  };
}

/**
 * The one function that answers "what is this facility worth right now?".
 *
 * Both the engine and the UI call it, so the screen can never promise something
 * the simulation won't do — the same rule that keeps `assistant.ts` honest.
 */
export function facilityEffect(team: Team, id: FacilityId): FacilityEffect {
  if (!isUnlocked(team, id)) return { ...EMPTY_EFFECT, channels: [] };
  const spec = FACILITY_MAP[id];
  const staff = assignedTo(team, id);

  const totalStars = staff.reduce((s, m) => s + m.stars, 0);
  const starSteps = Math.floor(totalStars / STAFF_STARS_PER_STEP);
  const weight = staff.reduce((s, m) => s + badgeWeightAt(m, id), 0);

  const level = facilityLevel(team, id);
  const channels = spec.channels.map((ch) => channelEffect(ch, level, starSteps, weight));
  const head = channels[0];

  return {
    channels,
    base: head.base,
    levels: head.levels,
    stars: head.stars,
    badges: head.badges,
    total: head.total,
    totalStars,
    starSteps,
    starsToNextStep: STAFF_STARS_PER_STEP - (totalStars % STAFF_STARS_PER_STEP),
    totalBadgeWeight: weight,
    slotsUsed: staff.length,
    slots: slotCount(team, id),
  };
}

/**
 * One named channel's value for the user's club — the form every engine caller
 * wants. A locked (or never-built) facility falls back to `whenLocked`, which
 * is what keeps AI clubs and fresh saves on the untouched curve.
 *
 * This is the ONLY way the rest of the lib should read a facility number: it
 * takes the channel id, so nothing outside this file ever has to know which
 * facility owns which quantity, and a channel that gets re-homed to a different
 * building is a table change.
 */
export function facilityChannelValue(
  state: GameState,
  id: FacilityId,
  channelId: string,
  whenLocked: number
): number {
  const team = state.teams[state.userTeamId];
  if (!team) return whenLocked;
  const ch = facilityEffect(team, id).channels.find((c) => c.id === channelId);
  return ch ? ch.total : whenLocked;
}

/** Whether a facility has reached the level that switches on its capability
 * (the Scouting Network's brief auto-filter). False for any facility that
 * doesn't declare one. */
export function facilityUnlockActive(state: GameState, id: FacilityId): boolean {
  const team = state.teams[state.userTeamId];
  const gate = FACILITY_MAP[id]?.unlockAtLevel;
  if (!team || !gate) return false;
  return facilityLevel(team, id) >= gate.level;
}

/** The Elite Training Center's effect as a growth MULTIPLIER (1.0 = no
 * facility), which is the form `lib/development.ts` consumes. A club without
 * the facility gets exactly 1 — no facility, no change, so the growth curve is
 * unchanged for every AI club and for a user who hasn't built it. */
export function growthMultiplier(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  if (!team) return 1;
  return 1 + facilityEffect(team, "eliteTrainingCenter").total / 100;
}

/**
 * The High Performance Center's effect as a RELIEF FRACTION (0 = no facility,
 * 0.61 = maxed), which is the form `lib/development.ts` consumes.
 *
 * This is deliberately NOT a growth multiplier, and the difference is the whole
 * point of the building. `eliteResistMult` returns a damping factor `m` in
 * [floor, 1]; the penalty a player is actually paying is `1 - m`. The HPC
 * scales that penalty down:
 *
 *   m' = 1 - (1 - m) × (1 - relief)
 *
 * So an 85 paying a 60% penalty at full relief pays 60 × 0.39 = 23.4%, and a 90
 * paying 90% pays 35.1% — the numbers in the design brief, and the reason a
 * maxed HPC lets a 90 keep climbing instead of stagnating. A player below
 * `growthEliteAbove` has no penalty to relieve, so the facility does nothing for
 * him at all: the ETC is still the only thing that develops a prospect.
 *
 * A club without the facility gets exactly 0, leaving the curve untouched for
 * every AI club and for a save that never built it.
 */
export function eliteResistRelief(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  if (!team) return 0;
  return facilityEffect(team, "highPerformanceCenter").total / 100;
}

// ── The Youth Academy and Scouting Network's channels (v1.82) ──────────────
//
// Four numbers the academy and scouting modules used to read off Team levels.
// Each names its own UNBUILT fallback, and the fallbacks are the point: a club
// that never builds the Youth Academy still runs an academy, just a small one.
// Nothing here is allowed to return 0 for "no facility" unless 0 is genuinely
// the right answer, or building the facility would become mandatory rather
// than an investment.

/** Prospect places the academy holds. Unbuilt clubs keep a modest academy — the
 * facility is what makes it a big one. */
export function academySquadSize(state: GameState, unbuilt: number): number {
  return facilityChannelValue(state, "youthAcademy", "squadSize", unbuilt);
}

/** How many prospects may be flagged for focus. */
export function academyFocusSlots(state: GameState, unbuilt: number): number {
  return facilityChannelValue(state, "youthAcademy", "focusSlots", unbuilt);
}

/** Market-value multiplier on the club's own prospects (1 = no effect). The old
 * Youth PR: it changes what the market pays, never the player. */
export function prospectValueMultiplier(state: GameState): number {
  return 1 + facilityChannelValue(state, "youthAcademy", "prospectValue", 0) / 100;
}

/** How many scouts the club may employ. */
export function maxScoutsFromFacility(state: GameState, unbuilt: number): number {
  return facilityChannelValue(state, "scoutingNetwork", "maxScouts", unbuilt);
}

/** The fraction of the normal report wait left after the facility's speed boost
 * (1 = unbuilt/no boost). Floored so the cadence can never reach zero. */
export function scoutSpeedMultiplier(state: GameState): number {
  const boost = facilityChannelValue(state, "scoutingNetwork", "scoutSpeed", 0);
  return Math.max(0.1, 1 - boost / 100);
}

/** Whether the Scouting Network has reached the level that unlocks the brief
 * auto-filter. Until then a scout files whatever they find. */
export function scoutFilterUnlocked(state: GameState): boolean {
  return facilityUnlockActive(state, "scoutingNetwork");
}

// ── Actions ───────────────────────────────────────────────────────────────
//
// Every action returns an error string or null, matching the convention the
// rest of the lib uses (see transfers.ts, staff's predecessor) so the store can
// surface failures uniformly.

export function unlockFacility(state: GameState, id: FacilityId): string | null {
  const team = state.teams[state.userTeamId];
  const spec = FACILITY_MAP[id];
  if (!spec) return "Unknown facility.";
  if (isUnlocked(team, id)) return `${spec.name} is already built.`;
  if (team.budget < spec.unlockCost) return "Not enough budget to build this facility.";
  team.budget -= spec.unlockCost;
  team.facilities = { ...(team.facilities ?? {}), [id]: { level: 1 } };
  return null;
}

export function upgradeFacility(state: GameState, id: FacilityId): string | null {
  const team = state.teams[state.userTeamId];
  const spec = FACILITY_MAP[id];
  if (!spec) return "Unknown facility.";
  const st = facilityStateOf(team, id);
  if (!st) return `${spec.name} hasn't been built yet.`;
  const cost = upgradeCost(team, id);
  if (cost === null) return `${spec.name} is already at its maximum level.`;
  if (team.budget < cost) return "Not enough budget for this upgrade.";
  team.budget -= cost;
  st.level += 1;
  return null;
}

export function hireStaff(state: GameState, candidateId: string): string | null {
  const team = state.teams[state.userTeamId];
  const cand = (state.staffMarket ?? []).find((c) => c.id === candidateId);
  if (!cand) return "That candidate is no longer available.";
  if (team.budget < cand.fee) return "Not enough budget for the signing fee.";
  team.budget -= cand.fee;
  const person: StaffPerson = {
    id: cand.id,
    name: cand.name,
    nationality: cand.nationality,
    age: cand.age,
    stars: cand.stars,
    wage: cand.wage,
    badges: cand.badges.map((b) => ({ ...b })),
  };
  team.staffRoster = [...rosterOf(team), person];
  state.staffMarket = (state.staffMarket ?? []).filter((c) => c.id !== candidateId);
  return null;
}

/** Release a staff member. Their badges leave with them — the record belongs to
 * the person, not the club. */
export function releaseStaff(state: GameState, staffId: string): string | null {
  const team = state.teams[state.userTeamId];
  const roster = rosterOf(team);
  if (!roster.some((s) => s.id === staffId)) return "That staff member isn't employed here.";
  team.staffRoster = roster.filter((s) => s.id !== staffId);
  return null;
}

/**
 * Assign a staff member to a facility, or unassign them (`facility = null`).
 *
 * A move resets nothing: badge progress is stored per facility, so sending a
 * veteran back to a building they served at before resumes their record where
 * it left off. What a move DOES cost is the badge slot — see the check below.
 */
export function assignStaff(state: GameState, staffId: string, facility: FacilityId | null): string | null {
  const team = state.teams[state.userTeamId];
  const person = rosterOf(team).find((s) => s.id === staffId);
  if (!person) return "That staff member isn't employed here.";

  if (facility === null) {
    person.assignedTo = undefined;
    return null;
  }

  const spec = FACILITY_MAP[facility];
  if (!spec) return "Unknown facility.";
  if (!isUnlocked(team, facility)) return `${spec.name} hasn't been built yet.`;
  if (person.assignedTo === facility) return null;
  const used = assignedTo(team, facility).length;
  if (used >= slotCount(team, facility)) return `${spec.name} has no free staff slots.`;

  // A staff member can only ever build a record at STAFF_BADGE_SLOTS distinct
  // facilities. Once those are spoken for, moving them somewhere new would earn
  // nothing — so the move is refused rather than silently wasting their career.
  const hasRecordHere = person.badges.some((b) => b.facility === facility);
  if (!hasRecordHere && person.badges.length >= STAFF_BADGE_SLOTS) {
    return `${person.name} already holds ${STAFF_BADGE_SLOTS} facility badges and can't earn another.`;
  }

  person.assignedTo = facility;
  return null;
}

// ── Season rollover ───────────────────────────────────────────────────────

/**
 * Credit a season of service to everyone currently assigned, promoting badges
 * that have come due. Called once per season rollover, before assignments can
 * change — a staff member gets the season only if they were in post for it.
 *
 * Returns the promotions that happened, so the caller can put them in the inbox.
 */
export interface BadgePromotion {
  staffId: string;
  staffName: string;
  facility: FacilityId;
  tier: BadgeTier;
}

export function accrueBadgeSeasons(state: GameState): BadgePromotion[] {
  const team = state.teams[state.userTeamId];
  const out: BadgePromotion[] = [];
  for (const person of rosterOf(team)) {
    const facility = person.assignedTo;
    if (!facility) continue; // unassigned staff earn nothing

    let badge = person.badges.find((b) => b.facility === facility);
    if (!badge) {
      // Guard the slot cap here too: assignment already refuses to overfill,
      // but a save that predates the check must not grow a fourth badge.
      if (person.badges.length >= STAFF_BADGE_SLOTS) continue;
      badge = { facility, seasons: 0, tier: "bronze" };
      person.badges.push(badge);
    }

    const before = badge.seasons >= 1 ? badge.tier : null;
    badge.seasons += 1;
    const tier = badgeTierFor(badge.seasons);
    if (tier) badge.tier = tier;
    if (tier && tier !== before) {
      out.push({ staffId: person.id, staffName: person.name, facility, tier });
    }
  }
  // A freshly-created badge sits at 0 seasons only transiently; drop any that
  // somehow never earned a season so the UI never renders a blank badge.
  for (const person of rosterOf(team)) {
    person.badges = person.badges.filter((b) => b.seasons >= 1);
  }
  return out;
}

/** Age every employed staff member by a year, retiring those past the band.
 * Returns the retirees so the caller can report them. */
export function ageStaff(state: GameState): StaffPerson[] {
  const team = state.teams[state.userTeamId];
  const retiring: StaffPerson[] = [];
  for (const person of rosterOf(team)) {
    person.age += 1;
    if (person.age > STAFF_MAX_AGE) retiring.push(person);
  }
  if (retiring.length) {
    const gone = new Set(retiring.map((r) => r.id));
    team.staffRoster = rosterOf(team).filter((s) => !gone.has(s.id));
  }
  return retiring;
}

// ── Wages ─────────────────────────────────────────────────────────────────

/** The backroom wage bill: every employed staff member (assigned or not) plus
 * the scouting department, which is paid the same way. */
export function staffWageBill(state: GameState): number {
  const team = state.teams[state.userTeamId];
  const staff = rosterOf(team).reduce((s, m) => s + m.wage, 0);
  const scouts = (team.scouts ?? []).reduce((s, sc) => s + sc.wage, 0);
  return staff + scouts;
}

// ── The hiring market ─────────────────────────────────────────────────────

function staffName(rng: RNG): { name: string; nationality: string } {
  const nat = pick(rng, STAFF_NATIONALITIES);
  const pool = NAME_POOLS.find((p) => p.nat === nat) ?? NAME_POOLS[0];
  return { name: `${pick(rng, pool.first)} ${pick(rng, pool.last)}`, nationality: nat };
}

/**
 * Prior-club badges for a generated candidate — deliberately rare, and rarer
 * still above silver.
 *
 * A badge on the market is a shortcut past the ten seasons the ladder asks for,
 * so it has to stay an event rather than a shopping option. Two gates do that,
 * and both live in `config/facilities.ts`:
 *
 *   1. A badge at all is roughly a 1-in-20 candidate — `BADGE_HIRE_BASE_CHANCE`
 *      plus small experience and star terms. The hiring band is now 21–35, so
 *      the experience term can't do much: nobody on the shortlist has had time
 *      for a long career elsewhere.
 *   2. The tier caps at `BADGE_HIRE_MAX_TIER` (silver) unless a second roll at
 *      `BADGE_HIRE_HIGH_TIER_CHANCE` clears, and even then
 *      `BADGE_HIRE_ABSOLUTE_MAX_TIER` (diamond) is the hard stop — obsidian and
 *      legacy are only ever earned at your own club.
 *
 * A candidate's badge is only ever for a facility that EXISTS.
 */
function generateBadges(rng: RNG, stars: number, age: number): StaffBadge[] {
  const span = Math.max(1, STAFF_HIRE_MAX_AGE - STAFF_HIRE_MIN_AGE);
  const experience = Math.min(1, Math.max(0, (age - STAFF_HIRE_MIN_AGE) / span)); // 0..1
  const chance =
    BADGE_HIRE_BASE_CHANCE +
    experience * BADGE_HIRE_EXPERIENCE_CHANCE +
    (stars - STAFF_MIN_STARS) * BADGE_HIRE_STAR_CHANCE;
  if (rng() > chance) return [];
  const spec = pick(rng, FACILITY_SPECS);
  // The tier cap, as a season cap: the ordinary ceiling, or the rare one if the
  // second roll clears. Never the top of the ladder either way.
  const capTier = rng() < BADGE_HIRE_HIGH_TIER_CHANCE
    ? BADGE_HIRE_ABSOLUTE_MAX_TIER
    : BADGE_HIRE_MAX_TIER;
  const maxSeasons = Math.max(1, seasonsForTier(capTier));
  const seasons = randInt(rng, 1, maxSeasons);
  const tier = badgeTierFor(seasons);
  if (!tier) return [];
  return [{ facility: spec.id, seasons, tier }];
}

function generateCandidate(rng: RNG): StaffCandidate {
  const stars = randInt(rng, STAFF_MIN_STARS, STAFF_MAX_STARS);
  // The MARKET's band, not the retirement age: everyone on the shortlist is
  // somewhere in a career, so a hire has decades of badge-earning ahead.
  const age = randInt(rng, STAFF_HIRE_MIN_AGE, STAFF_HIRE_MAX_AGE);
  const { name, nationality } = staffName(rng);
  const badges = generateBadges(rng, stars, age);
  return {
    id: uid("stf"),
    name,
    nationality,
    age,
    stars,
    wage: staffWageFor(stars),
    fee: staffFeeFor(stars, badges.reduce((s, b) => s + badgeWeight(b.tier), 0)),
    badges,
  };
}

export function generateStaffMarket(seed: number): StaffCandidate[] {
  const rng = mulberry32(seed);
  return Array.from({ length: STAFF_MARKET_SIZE }, () => generateCandidate(rng));
}

/** Swap the whole shortlist for a fresh one. Candidates the user hired are
 * already gone from the list, so this is a straight replacement. */
export function refreshStaffMarket(state: GameState, seed: number) {
  state.staffMarket = generateStaffMarket(seed);
}

/** Convenience for the UI: the spec list, for rendering the facility cards. */
export function allFacilitySpecs(): FacilitySpec[] {
  return FACILITY_SPECS;
}

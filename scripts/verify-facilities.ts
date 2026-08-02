// Verifies the facilities system against its design contract (v1.79).
//
// Two kinds of check, and the distinction matters:
//
//  1. STRUCTURAL invariants every facility must satisfy — the things that make
//     the system a table rather than a pile of special cases. These run over
//     FACILITY_SPECS, so a facility added later is checked automatically and
//     nobody has to remember to extend this file.
//
//  2. Each facility's WORKED EXAMPLE, taken from its design brief: the ETC at
//     level 5 with six legacy-badged 5-stars → 33%, and the same for the HPC →
//     61%. Those are the ceilings of the whole system; if a tuning change moves
//     one, that should be a deliberate decision someone sees in a diff, not a
//     silent consequence.
//
//     The HPC section carries one extra check the ETC doesn't need, because its
//     61% is a different KIND of number: it cuts the elite-resistance penalty
//     rather than multiplying growth, so the relation is asserted against the
//     real `eliteResistMult` and not just against the table.
//
// Run: npx tsx scripts/verify-facilities.ts

import {
  BADGE_HIRE_ABSOLUTE_MAX_TIER,
  BADGE_LADDER,
  FACILITY_SPECS,
  STAFF_BADGE_SLOTS,
  STAFF_HIRE_MAX_AGE,
  STAFF_HIRE_MIN_AGE,
  STAFF_MAX_AGE,
  STAFF_MAX_STARS,
  facilityMaxLevel,
  seasonsForTier,
} from "../lib/config/facilities";
import {
  academyFocusSlots,
  academySquadSize,
  accrueBadgeSeasons,
  badgeTierFor,
  badgeWeight,
  facilityEffect,
  generateStaffMarket,
  maxScoutsFromFacility,
  prospectValueMultiplier,
  scoutFilterUnlocked,
  scoutSpeedMultiplier,
  seasonsToNextBadge,
} from "../lib/facilities";
import { eliteResistMult } from "../lib/development";
import { TUNING } from "../lib/config/tuning";
import type { GameState, StaffPerson, Team } from "../lib/types";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label: string, actual: number, expected: number) {
  check(`${label} = ${expected}`, Math.abs(actual - expected) < 1e-9, `got ${actual}`);
}

// ── 1. Structural invariants ──────────────────────────────────────────────

console.log("\nFacility table invariants");
for (const spec of FACILITY_SPECS) {
  const max = facilityMaxLevel(spec);
  check(
    `${spec.name}: slotsByLevel covers every level (${spec.slotsByLevel.length} = ${max})`,
    spec.slotsByLevel.length === max,
    `${spec.slotsByLevel.length} entries for ${max} levels`
  );
  check(
    `${spec.name}: slot counts never decrease with level`,
    spec.slotsByLevel.every((n, i) => i === 0 || n >= spec.slotsByLevel[i - 1])
  );
  check(
    `${spec.name}: upgrade costs never decrease`,
    spec.upgradeCosts.every((c, i) => i === 0 || c >= spec.upgradeCosts[i - 1])
  );
  check(`${spec.name}: declares at least one channel`, spec.channels.length > 0);
  for (const ch of spec.channels) {
    // A channel has to DO something, but not every term has to be non-zero: the
    // Scouting Network's headcount deliberately has no badge track, and the
    // Youth Academy's value channel deliberately starts at 0%. What is never
    // allowed is a channel that scales by nothing at all, or one that scales
    // negatively — a facility must never make you worse.
    check(
      `${spec.name}/${ch.id}: grows with something`,
      ch.starEffect > 0 || ch.badgeEffect > 0 || (ch.levelEffect ?? 0) > 0,
      "neither levels, stars nor badges move it"
    );
    check(
      `${spec.name}/${ch.id}: no negative terms`,
      ch.base >= 0 && ch.starEffect >= 0 && ch.badgeEffect >= 0 && (ch.levelEffect ?? 0) >= 0
    );
    check(`${spec.name}/${ch.id}: badgeTiersPerStep is a positive integer`, Number.isInteger(ch.badgeTiersPerStep) && ch.badgeTiersPerStep >= 1);
  }
  check(
    `${spec.name}: channel ids are unique`,
    new Set(spec.channels.map((c) => c.id)).size === spec.channels.length
  );
  if (spec.unlockAtLevel) {
    check(
      `${spec.name}: the capability unlock sits within the level ladder`,
      spec.unlockAtLevel.level >= 1 && spec.unlockAtLevel.level <= max,
      `level ${spec.unlockAtLevel.level} of ${max}`
    );
  }
}

check(
  "facility ids are unique",
  new Set(FACILITY_SPECS.map((f) => f.id)).size === FACILITY_SPECS.length
);

// The level lever is an EXCEPTION, and this is what keeps it one (v1.85).
//
// `levelEffect` lets a channel grow with the building rather than with the
// people in it — which is the shape the whole facilities rework exists to
// replace. One facility is allowed it, because one facility is genuinely a
// DEPARTMENT you build bigger rather than an effect you staff: the Scouting
// Network's headcount and the reach that comes with it. If a channel on any
// other facility ever grows this way, that should be a decision someone argues
// for in a diff, not a habit that creeps back one row at a time.
{
  const SANCTIONED = ["scoutingNetwork/maxScouts", "scoutingNetwork/scoutSpeed"];
  const withLevels = FACILITY_SPECS.flatMap((spec) =>
    spec.channels.filter((ch) => (ch.levelEffect ?? 0) > 0).map((ch) => `${spec.id}/${ch.id}`)
  );
  check(
    `only the sanctioned channels grow by LEVEL (${SANCTIONED.join(", ")})`,
    withLevels.length === SANCTIONED.length && withLevels.every((k) => SANCTIONED.includes(k)),
    `got ${withLevels.join(", ") || "none"}`
  );
  // And no facility other than the Scouting Network gets one at all — the check
  // above would pass a re-homing that kept the count the same.
  check(
    "no facility but the Scouting Network has a level term",
    withLevels.every((k) => k.startsWith("scoutingNetwork/"))
  );
}

console.log("\nBadge ladder");
check(
  "tiers are ordered by seasons required",
  BADGE_LADDER.every((r, i) => i === 0 || r.seasons > BADGE_LADDER[i - 1].seasons)
);
check(
  "weights are 1..N in order",
  BADGE_LADDER.every((r, i) => r.weight === i + 1)
);
check("the first rung is one season", BADGE_LADDER[0].seasons === 1);
check("badgeTierFor(0) is null — no badge before a full season", badgeTierFor(0) === null);
for (const rung of BADGE_LADDER) {
  check(`${rung.seasons} seasons → ${rung.tier}`, badgeTierFor(rung.seasons) === rung.tier);
}
const top = BADGE_LADDER[BADGE_LADDER.length - 1];
check(`seasonsToNextBadge is null at the top (${top.tier})`, seasonsToNextBadge(top.seasons) === null);
check("a season past the top still reads as the top tier", badgeTierFor(top.seasons + 5) === top.tier);

// ── 2. The worked example ─────────────────────────────────────────────────
//
// Built as real state and run through the real `facilityEffect`, not a
// re-implementation of the formula — a verifier that recomputes the thing it is
// checking proves only that the author can multiply twice the same way.

function makeTeam(): Team {
  return {
    id: "t1",
    name: "Test",
    short: "TST",
    leagueId: "l1",
    colors: { primary: "#fff", secondary: "#000" },
    reputation: 80,
    budget: 0,
    playerIds: [],
    tactic: {} as Team["tactic"],
    facilities: {},
    staffRoster: [],
    stadium: "Test Park",
  } as unknown as Team;
}

function makeState(team: Team): GameState {
  return { teams: { t1: team }, userTeamId: "t1" } as unknown as GameState;
}

function staff(i: number, stars: number, badgeSeasons?: number): StaffPerson {
  return {
    id: `s${i}`,
    name: `Coach ${i}`,
    nationality: "ENG",
    age: 45,
    stars,
    wage: 0,
    assignedTo: "eliteTrainingCenter",
    badges:
      badgeSeasons === undefined
        ? []
        : [{ facility: "eliteTrainingCenter", seasons: badgeSeasons, tier: badgeTierFor(badgeSeasons)! }],
  };
}

const etc = FACILITY_SPECS.find((f) => f.id === "eliteTrainingCenter")!;

console.log("\nElite Training Center — the design brief's worked example");

// The brief, step by step.
{
  const team = makeTeam();
  team.facilities = { eliteTrainingCenter: { level: 1 } };

  // Nothing assigned: base only.
  eq("empty, level 1", facilityEffect(team, "eliteTrainingCenter").total, 5);

  // "Alex Frost", 4 stars, no badge — under the 6-star threshold, so no change.
  team.staffRoster = [staff(1, 4)];
  eq("one 4★ staff (below the 6-star step)", facilityEffect(team, "eliteTrainingCenter").total, 5);

  // A second, 3-star hire: 7 stars total → one complete step of 6 → +2%.
  team.staffRoster.push(staff(2, 3));
  eq("plus a 3★ (7 stars = one step)", facilityEffect(team, "eliteTrainingCenter").total, 7);
}

// The ceiling: level 5, six 5-star staff, all legacy ETC badges.
{
  const team = makeTeam();
  team.facilities = { eliteTrainingCenter: { level: facilityMaxLevel(etc) } };
  team.staffRoster = Array.from({ length: 6 }, (_, i) => staff(i, STAFF_MAX_STARS, top.seasons));
  const eff = facilityEffect(team, "eliteTrainingCenter");

  eq("maxed: total stars", eff.totalStars, 30);
  eq("maxed: star steps", eff.starSteps, 5);
  eq("maxed: base term", eff.base, 5);
  eq("maxed: star term", eff.stars, 10);
  eq("maxed: badge term", eff.badges, 18);
  eq("maxed: TOTAL (the brief's 33%)", eff.total, 33);
  check("maxed: every slot is filled", eff.slotsUsed === eff.slots && eff.slots === 6);
}

// A locked facility contributes exactly nothing — the invariant that keeps AI
// clubs and a fresh save on the untouched growth curve.
{
  const team = makeTeam();
  const eff = facilityEffect(team, "eliteTrainingCenter");
  eq("locked: total", eff.total, 0);
  eq("locked: slots", eff.slots, 0);
}

// Badges earned elsewhere are worth nothing here.
{
  const team = makeTeam();
  team.facilities = { eliteTrainingCenter: { level: 1 } };
  const outsider = staff(9, 5);
  // A legacy badge for a facility that isn't this one.
  outsider.badges = [{ facility: "someOtherPlace" as never, seasons: 10, tier: "legacy" }];
  team.staffRoster = [outsider];
  const eff = facilityEffect(team, "eliteTrainingCenter");
  eq("a badge from another facility adds nothing", eff.badges, 0);
}

// ── 3. Badge accrual over time ────────────────────────────────────────────

console.log("\nBadge accrual");
{
  const team = makeTeam();
  team.facilities = { eliteTrainingCenter: { level: 1 } };
  const person = staff(1, 5);
  person.badges = [];
  team.staffRoster = [person];
  const state = makeState(team);

  // Ten seasons of unbroken service should land exactly on the top rung, and
  // hit each tier on the season the ladder says.
  const seen: string[] = [];
  for (let season = 1; season <= top.seasons; season++) {
    const promos = accrueBadgeSeasons(state);
    for (const p of promos) seen.push(`${season}:${p.tier}`);
  }
  const expected = BADGE_LADDER.map((r) => `${r.seasons}:${r.tier}`);
  check(
    `${top.seasons} seasons served promotes through every tier on schedule`,
    seen.join(",") === expected.join(","),
    `got ${seen.join(",")}`
  );
  eq("badge weight after a full career", badgeWeight(person.badges[0].tier), top.weight);
}

{
  // An unassigned staff member earns nothing, however long they are employed.
  const team = makeTeam();
  team.facilities = { eliteTrainingCenter: { level: 1 } };
  const idle = staff(1, 5);
  idle.assignedTo = undefined;
  idle.badges = [];
  team.staffRoster = [idle];
  const state = makeState(team);
  for (let i = 0; i < 5; i++) accrueBadgeSeasons(state);
  check("an unassigned staff member earns no badge", idle.badges.length === 0);
}

{
  // The three-badge cap holds even under repeated reassignment.
  const team = makeTeam();
  team.facilities = { eliteTrainingCenter: { level: 1 } };
  const veteran = staff(1, 5);
  veteran.badges = [
    { facility: "a" as never, seasons: 3, tier: "gold" },
    { facility: "b" as never, seasons: 3, tier: "gold" },
    { facility: "c" as never, seasons: 3, tier: "gold" },
  ];
  team.staffRoster = [veteran];
  const state = makeState(team);
  accrueBadgeSeasons(state);
  check(
    `a staff member never exceeds ${STAFF_BADGE_SLOTS} badges`,
    veteran.badges.length === STAFF_BADGE_SLOTS,
    `has ${veteran.badges.length}`
  );
}

// ── 4. The High Performance Center (v1.81) ────────────────────────────────
//
// Two things to prove, and only the first is arithmetic:
//
//   a) the ceiling is 61% — 10 base + 3×5 star steps + 1×36 badge weight;
//   b) that 61% is a cut to the elite-resistance PENALTY, not a growth
//      multiplier. The brief's own worked cases are the check: an 85 paying a
//      60% penalty pays 23.4% at full relief, and a 90 paying 90% pays 35.1%.
//      Getting (b) wrong is the one failure that wouldn't show up in (a).

console.log("\nHigh Performance Center — the design brief's worked example");
{
  const hpc = FACILITY_SPECS.find((f) => f.id === "highPerformanceCenter")!;
  const team = makeTeam();
  team.facilities = { highPerformanceCenter: { level: 1 } };
  eq("empty, level 1 (base only)", facilityEffect(team, "highPerformanceCenter").total, 10);

  team.facilities = { highPerformanceCenter: { level: facilityMaxLevel(hpc) } };
  team.staffRoster = Array.from({ length: 6 }, (_, i) => {
    const s = staff(i, STAFF_MAX_STARS, top.seasons);
    s.assignedTo = "highPerformanceCenter";
    s.badges = [{ facility: "highPerformanceCenter", seasons: top.seasons, tier: top.tier }];
    return s;
  });
  const eff = facilityEffect(team, "highPerformanceCenter");
  eq("maxed: base term", eff.base, 10);
  eq("maxed: star term (5 steps × 3%)", eff.stars, 15);
  eq("maxed: badge term (6 legacy × 6 × 1%)", eff.badges, 36);
  eq("maxed: TOTAL (the brief's 61%)", eff.total, 61);
}

// The relief actually applied to the curve. Run through the real
// `eliteResistMult`, so a change to the resistance tuning that would silently
// alter what the HPC is worth shows up here.
{
  const relief = 0.61;
  // The brief states the penalties it is reasoning about; assert the RELATION
  // (penalty scales by 1 - relief) rather than the tuning's own penalty values,
  // which are `growthElite*`'s business and are allowed to move.
  for (const [penalty, expected] of [
    [0.6, 0.234],
    [0.9, 0.351],
  ] as const) {
    const relieved = penalty * (1 - relief);
    check(
      `a ${Math.round(penalty * 100)}% penalty becomes ${(expected * 100).toFixed(1)}% at full relief`,
      Math.abs(relieved - expected) < 1e-9,
      `got ${(relieved * 100).toFixed(1)}%`
    );
  }

  // And the same, through the function the engine actually calls.
  const noRelief = eliteResistMult(90, TUNING);
  const withRelief = eliteResistMult(90, TUNING, relief);
  check(
    "eliteResistMult scales the penalty, not the multiplier",
    Math.abs((1 - withRelief) - (1 - noRelief) * (1 - relief)) < 1e-9,
    `${noRelief} → ${withRelief}`
  );
  check(
    "a maxed HPC leaves a 90-rated player growing several times faster",
    withRelief > noRelief * 2,
    `${noRelief.toFixed(3)} → ${withRelief.toFixed(3)}`
  );
  // The invariant that keeps the ETC necessary: below the elite threshold there
  // is no penalty, so the HPC is worth exactly nothing.
  const below = TUNING.growthEliteAbove - 1;
  eq(`no relief to give below the elite band (overall ${below})`, eliteResistMult(below, TUNING, relief), 1);
  // And a club that never built it is on the untouched curve.
  eq("relief 0 is the unchanged curve", eliteResistMult(90, TUNING, 0), noRelief);
}

// ── 5. The Youth Academy and Scouting Network (v1.82) ─────────────────────
//
// Both are MULTI-CHANNEL, and both pay their badge track per TWO tiers rather
// than per tier. That divisor is the thing worth pinning: at per-tier rates a
// single legacy badge would add six squad places, which swamps the star track
// and makes the star/badge split meaningless. The brief's own numbers are the
// check — base effects at level 1 empty, and the ceiling with six legacy 5-stars.

/** One channel of one facility, by id. */
function chan(team: Team, id: Parameters<typeof facilityEffect>[1], channelId: string) {
  const ch = facilityEffect(team, id).channels.find((c) => c.id === channelId);
  if (!ch) throw new Error(`no channel ${channelId} on ${id}`);
  return ch;
}

/** Staff slots a facility's table offers at a given level — read off the spec
 * rather than through a Team, so a ladder can be asserted without building one. */
function spec_slots(id: string, level: number): number {
  const spec = FACILITY_SPECS.find((f) => f.id === id)!;
  return spec.slotsByLevel[level - 1];
}

/** A facility at max level staffed by six legacy-badged 5-stars — the ceiling
 * every facility's worked example is stated at. */
function maxedTeam(id: "youthAcademy" | "scoutingNetwork"): Team {
  const spec = FACILITY_SPECS.find((f) => f.id === id)!;
  const team = makeTeam();
  team.facilities = { [id]: { level: facilityMaxLevel(spec) } };
  team.staffRoster = Array.from({ length: 6 }, (_, i) => {
    const s = staff(i, STAFF_MAX_STARS);
    s.assignedTo = id;
    s.badges = [{ facility: id, seasons: top.seasons, tier: top.tier }];
    return s;
  });
  return team;
}

console.log("\nYouth Academy — the design brief's worked example");
{
  // Level 1, nobody assigned: the brief's base effects exactly.
  const team = makeTeam();
  team.facilities = { youthAcademy: { level: 1 } };
  eq("base: academy squad size", chan(team, "youthAcademy", "squadSize").total, 15);
  eq("base: focus slots", chan(team, "youthAcademy", "focusSlots").total, 3);
  eq("base: prospect value", chan(team, "youthAcademy", "prospectValue").total, 0);
}
{
  // Six stars = one step: +3 squad, +1 focus slot, +3% value.
  const team = makeTeam();
  team.facilities = { youthAcademy: { level: 2 } };
  team.staffRoster = [
    { ...staff(1, 3), assignedTo: "youthAcademy" as const, badges: [] },
    { ...staff(2, 3), assignedTo: "youthAcademy" as const, badges: [] },
  ];
  eq("one 6-star step: squad size", chan(team, "youthAcademy", "squadSize").total, 18);
  eq("one 6-star step: focus slots", chan(team, "youthAcademy", "focusSlots").total, 4);
  eq("one 6-star step: prospect value", chan(team, "youthAcademy", "prospectValue").total, 3);
}
{
  // The two-tier badge divisor, in isolation: one bronze badge (tier 1) is half
  // a step and must therefore be worth NOTHING yet. This is the check that
  // catches a per-tier regression, and it is invisible in the table.
  const team = makeTeam();
  team.facilities = { youthAcademy: { level: 1 } };
  team.staffRoster = [
    { ...staff(1, 1), assignedTo: "youthAcademy" as const, badges: [{ facility: "youthAcademy" as const, seasons: 1, tier: "bronze" as const }] },
  ];
  eq("one bronze badge (1 tier) is half a step — worth nothing yet", chan(team, "youthAcademy", "squadSize").total, 15);

  // A silver (tier 2) completes the first step: +1 squad, +1% value.
  team.staffRoster[0].badges = [{ facility: "youthAcademy", seasons: 2, tier: "silver" }];
  eq("a silver badge (2 tiers) completes one step", chan(team, "youthAcademy", "squadSize").total, 16);
  eq("...and one step of prospect value", chan(team, "youthAcademy", "prospectValue").total, 1);
}
{
  // The ceiling: 30 stars = 5 steps, 36 badge weight = 18 double-tier steps.
  const team = maxedTeam("youthAcademy");
  eq("maxed: squad size (15 + 3×5 + 1×18)", chan(team, "youthAcademy", "squadSize").total, 48);
  eq("maxed: focus slots (3 + 1×5, no badge track)", chan(team, "youthAcademy", "focusSlots").total, 8);
  eq("maxed: prospect value (0 + 3×5 + 1×18)", chan(team, "youthAcademy", "prospectValue").total, 33);
}

console.log("\nScouting Network — the design brief's worked example (v1.85)");
{
  // Unlocking is worth +1 scout over the unbuilt baseline and +5% speed. The
  // baseline itself is `scoutNetworkBase`, checked in the fallbacks section
  // below — this asserts the facility's own level-1 value.
  const team = makeTeam();
  team.facilities = { scoutingNetwork: { level: 1 } };
  eq("unlock: max scouts", chan(team, "scoutingNetwork", "maxScouts").total, 3);
  eq("unlock: scouting speed", chan(team, "scoutingNetwork", "scoutSpeed").total, 5);
  check(
    "unlocking is worth exactly one more scout than not building it",
    chan(team, "scoutingNetwork", "maxScouts").total === TUNING.scoutNetworkBase + 1,
    `facility says ${chan(team, "scoutingNetwork", "maxScouts").total}, baseline is ${TUNING.scoutNetworkBase}`
  );
}
{
  // The level ladder, rung by rung, with nobody assigned — the building alone.
  const expected: [number, number, number][] = [
    // level, max scouts, speed
    [1, 3, 5],
    [2, 4, 10],
    [3, 5, 15],
    [4, 6, 20],
    [5, 7, 25],
  ];
  for (const [level, scouts, speed] of expected) {
    const team = makeTeam();
    team.facilities = { scoutingNetwork: { level } };
    eq(`level ${level}, unstaffed: max scouts`, chan(team, "scoutingNetwork", "maxScouts").total, scouts);
    eq(`level ${level}, unstaffed: scouting speed`, chan(team, "scoutingNetwork", "scoutSpeed").total, speed);
    eq(`level ${level}: staff slots`, spec_slots("scoutingNetwork", level), level + 1);
  }
}
{
  // Stars move speed and NOTHING else. A star step is +3%; the headcount must
  // not budge, because a better scout is not an extra job.
  const team = makeTeam();
  team.facilities = { scoutingNetwork: { level: 2 } };
  team.staffRoster = [
    { ...staff(1, 4), assignedTo: "scoutingNetwork" as const, badges: [] },
    { ...staff(2, 2), assignedTo: "scoutingNetwork" as const, badges: [] },
  ];
  eq("one 6-star step: scouting speed (10 + 3)", chan(team, "scoutingNetwork", "scoutSpeed").total, 13);
  eq("one 6-star step: max scouts is unmoved by stars", chan(team, "scoutingNetwork", "maxScouts").total, 4);
}
{
  // The badge track pays per SINGLE tier here (0.75%/tier), unlike the Youth
  // Academy's two-tier divisor — so one bronze badge IS worth something. That
  // asymmetry is deliberate (a rate has no rounding problem a capacity does),
  // and this is the check that would catch it being "fixed" back.
  const team = makeTeam();
  team.facilities = { scoutingNetwork: { level: 1 } };
  team.staffRoster = [
    {
      ...staff(1, 1),
      assignedTo: "scoutingNetwork" as const,
      badges: [{ facility: "scoutingNetwork" as const, seasons: 1, tier: "bronze" as const }],
    },
  ];
  eq("one bronze badge (1 tier) is worth 0.75%", chan(team, "scoutingNetwork", "scoutSpeed").total, 5.75);
  eq("...and buys no extra scout", chan(team, "scoutingNetwork", "maxScouts").total, 3);
}
{
  // The ceiling the brief states: level 5, six legacy-badged 5-stars.
  //   scouts  3 + 1×4 levels = 7
  //   speed   5 + 5×4 levels + 3×5 star steps + 0.75×36 tiers = 25 + 15 + 27 = 67
  const team = maxedTeam("scoutingNetwork");
  eq("maxed: max scouts (3 + 1×4 levels)", chan(team, "scoutingNetwork", "maxScouts").total, 7);
  eq("maxed: scouting speed (25 levels + 15 stars + 27 badges)", chan(team, "scoutingNetwork", "scoutSpeed").total, 67);

  const eff = chan(team, "scoutingNetwork", "scoutSpeed");
  eq("maxed: the level term alone", eff.base + eff.levels, 25);
  eq("maxed: the star term alone", eff.stars, 15);
  eq("maxed: the badge term alone", eff.badges, 27);

  // And the ceiling has to survive the trip through the consuming function —
  // the engine reads a multiplier, not a percentage.
  eq("maxed: scout speed multiplier is 0.33", scoutSpeedMultiplier(makeState(team)), 0.33);
}
{
  // The capability gate: the brief's auto-filter arrives at level 5 and not before.
  const spec = FACILITY_SPECS.find((f) => f.id === "scoutingNetwork")!;
  check("the Scouting Network declares a capability unlock", !!spec.unlockAtLevel);
  const gate = spec.unlockAtLevel!.level;
  for (let level = 1; level <= facilityMaxLevel(spec); level++) {
    const team = makeTeam();
    team.facilities = { scoutingNetwork: { level } };
    const state = makeState(team);
    check(
      `level ${level}: auto-filter ${level >= gate ? "unlocked" : "locked"}`,
      scoutFilterUnlocked(state) === (level >= gate)
    );
  }
  // And a club that never built it never gets the filter.
  check("unbuilt: auto-filter locked", scoutFilterUnlocked(makeState(makeTeam())) === false);
}

// The unbuilt fallbacks. A club that never builds either facility must still
// run an academy and a scouting department — the accessors take the baseline as
// an argument precisely so "no facility" never means "no academy".
{
  const state = makeState(makeTeam());
  eq("unbuilt: academy squad size falls back to the baseline", academySquadSize(state, 12), 12);
  eq("unbuilt: focus slots fall back to the baseline", academyFocusSlots(state, 2), 2);
  eq("unbuilt: max scouts falls back to the baseline", maxScoutsFromFacility(state, 1), 1);
  eq("unbuilt: prospect value multiplier is exactly 1", prospectValueMultiplier(state), 1);
  eq("unbuilt: scout speed multiplier is exactly 1", scoutSpeedMultiplier(state), 1);
}

// ── The hiring market (v1.83) ─────────────────────────────────────────────
//
// Two properties the tables alone can't show, both of which quietly break the
// badge economy if they regress:
//
//   1. Everyone the market generates is inside the HIRING band (21–35), which
//      is a different and much narrower thing than the retirement age (65). A
//      hire has to have a career ahead of them, or the ten seasons a legacy
//      badge costs is a bet nobody can take.
//   2. A badge on the shortlist is rare, and a gold-or-better one is rarer
//      still. The market must never sell what the ladder exists to make you
//      earn — nothing above `BADGE_HIRE_ABSOLUTE_MAX_TIER`, ever.
{
  // A big sample across many seeds: these are probabilistic gates, so one
  // shortlist proves nothing.
  const all = Array.from({ length: 400 }, (_, i) => generateStaffMarket(1000 + i)).flat();
  check(`the sample is large enough to mean something (${all.length} candidates)`, all.length >= 2000);

  const outOfBand = all.filter((c) => c.age < STAFF_HIRE_MIN_AGE || c.age > STAFF_HIRE_MAX_AGE);
  check(
    `every candidate is ${STAFF_HIRE_MIN_AGE}–${STAFF_HIRE_MAX_AGE}`,
    outOfBand.length === 0,
    `${outOfBand.length} outside the band`
  );
  check(
    "the hiring band sits well below the retirement age",
    STAFF_HIRE_MAX_AGE < STAFF_MAX_AGE - 20,
    `hire max ${STAFF_HIRE_MAX_AGE} vs retire ${STAFF_MAX_AGE}`
  );
  // Both ends of the band are actually reachable — a band nothing generates in
  // is a band in name only.
  check("the youngest end of the band is reached", all.some((c) => c.age === STAFF_HIRE_MIN_AGE));
  check("the oldest end of the band is reached", all.some((c) => c.age === STAFF_HIRE_MAX_AGE));

  const badged = all.filter((c) => c.badges.length > 0);
  const badgedPct = (badged.length / all.length) * 100;
  check(
    `arriving with a badge is rare (${badgedPct.toFixed(1)}% of candidates)`,
    badgedPct < 12,
    `${badgedPct.toFixed(1)}% — the market is selling what the ladder should make you earn`
  );

  // Nothing above the hard ceiling, and gold-or-better is a genuine event.
  const ceiling = seasonsForTier(BADGE_HIRE_ABSOLUTE_MAX_TIER);
  const overCeiling = badged.filter((c) => c.badges.some((b) => b.seasons > ceiling));
  check(
    `no candidate ever exceeds a ${BADGE_HIRE_ABSOLUTE_MAX_TIER} badge`,
    overCeiling.length === 0,
    `${overCeiling.length} above the ceiling`
  );
  const goldPlus = seasonsForTier("gold");
  const gold = all.filter((c) => c.badges.some((b) => b.seasons >= goldPlus));
  const goldPct = (gold.length / all.length) * 100;
  check(
    `a gold-or-better hire is a rare event (${goldPct.toFixed(2)}% of candidates)`,
    goldPct < 1.5,
    `${goldPct.toFixed(2)}%`
  );
  // …but not impossible: a ceiling nothing ever reaches is dead code.
  check("a gold-or-better hire does still happen", gold.length > 0);

  // Determinism, same as everything else seeded in this codebase.
  check(
    "the same seed produces the same shortlist",
    JSON.stringify(generateStaffMarket(77).map((c) => [c.name, c.age, c.stars])) ===
      JSON.stringify(generateStaffMarket(77).map((c) => [c.name, c.age, c.stars]))
  );
}

// ── Result ────────────────────────────────────────────────────────────────

console.log();
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All facility checks passed.");

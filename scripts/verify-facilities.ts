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
  BADGE_LADDER,
  FACILITY_SPECS,
  STAFF_BADGE_SLOTS,
  STAFF_MAX_STARS,
  facilityMaxLevel,
} from "../lib/config/facilities";
import {
  academyFocusSlots,
  academySquadSize,
  accrueBadgeSeasons,
  badgeTierFor,
  badgeWeight,
  facilityEffect,
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
      `${spec.name}/${ch.id}: scales with staff`,
      ch.starEffect > 0 || ch.badgeEffect > 0,
      "neither stars nor badges move it"
    );
    check(
      `${spec.name}/${ch.id}: no negative terms`,
      ch.base >= 0 && ch.starEffect >= 0 && ch.badgeEffect >= 0
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

console.log("\nScouting Network — the design brief's worked example");
{
  const team = makeTeam();
  team.facilities = { scoutingNetwork: { level: 1 } };
  eq("base: max scouts", chan(team, "scoutingNetwork", "maxScouts").total, 2);
  eq("base: scouting speed", chan(team, "scoutingNetwork", "scoutSpeed").total, 0);
}
{
  const team = makeTeam();
  team.facilities = { scoutingNetwork: { level: 2 } };
  team.staffRoster = [
    { ...staff(1, 4), assignedTo: "scoutingNetwork" as const, badges: [] },
    { ...staff(2, 2), assignedTo: "scoutingNetwork" as const, badges: [] },
  ];
  eq("one 6-star step: max scouts", chan(team, "scoutingNetwork", "maxScouts").total, 3);
  eq("one 6-star step: scouting speed", chan(team, "scoutingNetwork", "scoutSpeed").total, 5);
}
{
  const team = maxedTeam("scoutingNetwork");
  eq("maxed: max scouts (2 + 1×5, stars only)", chan(team, "scoutingNetwork", "maxScouts").total, 7);
  eq("maxed: scouting speed (0 + 5×5 + 1×18)", chan(team, "scoutingNetwork", "scoutSpeed").total, 43);
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

// ── Result ────────────────────────────────────────────────────────────────

console.log();
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All facility checks passed.");

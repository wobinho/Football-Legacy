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
  ARCHETYPE_DEV_CLASS,
  BADGE_HIRE_EXTRA_TIER_WEIGHT,
  BADGE_HIRE_SECOND_CHANCE,
  BADGE_HIRE_THIRD_CHANCE,
  BADGE_HIRE_TIER_CHANCE,
  BADGE_LADDER,
  FACILITY_MAP,
  FACILITY_SPECS,
  STAFF_BADGE_SLOTS,
  STAFF_HIRE_MAX_AGE,
  STAFF_HIRE_MIN_AGE,
  STAFF_MAX_AGE,
  STAFF_MAX_STARS,
  archetypeDevClassOf,
  archetypeDevFacilityFor,
  facilityMaxLevel,
} from "../lib/config/facilities";
import { ARCHETYPE_CLASS_ORDER } from "../lib/config/archetype";
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

// The level lever is an EXCEPTION, and this is what keeps it one (v1.85, widened
// deliberately in v1.87).
//
// `levelEffect` lets a channel grow with the building rather than with the
// people in it — which is the shape the whole facilities rework exists to
// replace. The channels allowed it are all CAPACITIES: things a building has
// rather than things a staff member does. The Scouting Network's headcount and
// reach (v1.85), and the Youth Academy's beds, focus slots and the small
// day-one value bump that stops a £50M unlock from doing nothing (v1.87).
//
// The list is by NAME, so widening it is an edit someone makes on purpose and
// argues for in a diff — never a habit that creeps back one row at a time.
//
// ── Widened again in v1.93, and here is the argument ─────────────────────
// Six facilities landed at once and every one of them carries a level term,
// which looks exactly like the habit this check exists to stop. It is not, and
// the test that separates the two is the same one v1.87 used: does the LEVEL buy
// capacity and the STAFF buy quality?
//
//   · `staffSlots` on all six is a capacity in the purest sense — it is the
//     slot ladder itself, restated as a channel so the card can show it as
//     arithmetic. The check below asserts it never disagrees with
//     `slotsByLevel`, so it cannot become a second source of truth.
//   · The Club Income Center's two rate channels and the Club Expense Center's
//     three are the genuine widening. A commercial department is the same KIND
//     of thing as the Scouting Network — a department whose REACH is bought
//     (more staff, more offices, more of the club's commercial operation) as
//     well as staffed. The quality-dominance check below polices the line.
//   · The archetype centers' `growth` takes a level term for the reason
//     `youthAcademy/prospectValue` does: it is what gives a £200M unlock a
//     visible effect on day one. It is the SMALLEST of its terms and the
//     conversion-speed channel — the facility's real prize — takes no level
//     term at all, so the people still buy everything that matters.
{
  const SANCTIONED = [
    "scoutingNetwork/maxScouts",
    "scoutingNetwork/scoutSpeed",
    "youthAcademy/squadSize",
    "youthAcademy/focusSlots",
    "youthAcademy/prospectValue",
    // v1.93 — the commercial pair.
    "clubIncomeCenter/weeklyIncome",
    "clubIncomeCenter/sponsorOffers",
    "clubIncomeCenter/staffSlots",
    "clubExpenseCenter/squadWageCut",
    "clubExpenseCenter/academyWageCut",
    "clubExpenseCenter/staffWageCut",
    "clubExpenseCenter/staffSlots",
    // v1.93 — the archetype development centers, one per class. Listed via the
    // same table the specs are generated from: spelling five pairs out by hand
    // would mean a sixth class ships a facility this check has never seen.
    ...ARCHETYPE_DEV_CLASS.flatMap(({ id }) => [`${id}/growth`, `${id}/staffSlots`]),
  ];
  const withLevels = FACILITY_SPECS.flatMap((spec) =>
    spec.channels.filter((ch) => (ch.levelEffect ?? 0) > 0).map((ch) => `${spec.id}/${ch.id}`)
  );
  check(
    `only the sanctioned channels grow by LEVEL (${SANCTIONED.join(", ")})`,
    withLevels.length === SANCTIONED.length && withLevels.every((k) => SANCTIONED.includes(k)),
    `got ${withLevels.join(", ") || "none"}`
  );
  // The two facilities that must NEVER own one, spelled out. The check above
  // would pass a re-homing onto the ETC that happened to keep the count the
  // same, and those two are the system's thesis in its purest form: growth and
  // elite relief are bought entirely with people.
  check(
    "the Elite Training Center and High Performance Center have no level terms",
    withLevels.every(
      (k) => !k.startsWith("eliteTrainingCenter/") && !k.startsWith("highPerformanceCenter/")
    ),
    `got ${withLevels.filter((k) => k.startsWith("eliteTrainingCenter/") || k.startsWith("highPerformanceCenter/")).join(", ") || "none"}`
  );

  // A `staffSlots` channel is a RESTATEMENT of the slot ladder for the card to
  // draw, never a second source of truth for it (v1.93). If the two ever
  // disagree, the screen quotes a slot count the engine won't honour — which is
  // the one thing `facilityEffect` exists to make impossible.
  for (const spec of FACILITY_SPECS) {
    const ch = spec.channels.find((c) => c.id === "staffSlots");
    if (!ch) continue;
    const fromChannel = Array.from({ length: facilityMaxLevel(spec) }, (_, i) =>
      Math.floor(ch.base + (ch.levelEffect ?? 0) * i)
    );
    check(
      `${spec.name}: the staffSlots channel matches slotsByLevel`,
      fromChannel.every((v, i) => v === spec.slotsByLevel[i]),
      `channel ${fromChannel.join(",")} vs ladder ${spec.slotsByLevel.join(",")}`
    );
  }

  // The quality-dominance rule, applied to every v1.93 channel that is a RATE
  // rather than a capacity. This is the line between "a level buys you room"
  // and the bought-by-the-level ladder the whole system replaced: a rate whose
  // level term outgrows its staff term is exactly the shape v1.79 deleted.
  //
  // The archetype centers' `growth` is deliberately exempt and listed as such:
  // it is the day-one-visibility term (the `prospectValue` argument), it is
  // tiny in absolute terms, and the facility's real prize — `convertSpeed` — is
  // bought entirely with stars.
  {
    const RATE_CHANNELS = [
      ["clubIncomeCenter", "weeklyIncome"],
      ["clubIncomeCenter", "sponsorOffers"],
      ["clubExpenseCenter", "squadWageCut"],
      ["clubExpenseCenter", "academyWageCut"],
      ["clubExpenseCenter", "staffWageCut"],
    ] as const;
    for (const [facility, channel] of RATE_CHANNELS) {
      const ch = FACILITY_MAP[facility].channels.find((c) => c.id === channel)!;
      const fromLevels = (ch.levelEffect ?? 0) * 4;
      const fromStaff = ch.starEffect * 5 + ch.badgeEffect * (36 / ch.badgeTiersPerStep);
      check(
        `${facility}/${channel}: the people buy at least as much as the building`,
        fromStaff >= fromLevels,
        `levels ${fromLevels}, staff ${fromStaff}`
      );
    }
  }

  // EVERY archetype class has a center, and no center belongs to a class that
  // doesn't exist. The first cut of v1.93 shipped four centers for five classes,
  // which made Blitzer the one class a player could never be retrained INTO —
  // an asymmetry invisible in the facility table and only obvious on the
  // Development → Archetype page, where one class's section simply wasn't there.
  {
    const covered = ARCHETYPE_DEV_CLASS.map((r) => r.cls);
    check(
      `every archetype class has a development center (${ARCHETYPE_CLASS_ORDER.join(", ")})`,
      ARCHETYPE_CLASS_ORDER.every((cls) => covered.includes(cls)) &&
        covered.length === ARCHETYPE_CLASS_ORDER.length,
      `centers cover ${covered.join(", ") || "nothing"}`
    );
    check(
      "every development center resolves back to its class",
      ARCHETYPE_DEV_CLASS.every(
        ({ id, cls }) => archetypeDevFacilityFor(cls) === id && archetypeDevClassOf(id) === cls
      )
    );
    check(
      "every development center is a real facility in the table",
      ARCHETYPE_DEV_CLASS.every(({ id }) => !!FACILITY_MAP[id])
    );
  }

  // The conversion prize is staff-only: 30 stars must halve a programme, and no
  // amount of BUILDING may shorten it at all. That is what makes a maxed
  // archetype center a staffing achievement rather than a purchase.
  for (const { id, cls } of ARCHETYPE_DEV_CLASS) {
    const ch = FACILITY_MAP[id].channels.find((c) => c.id === "convertSpeed")!;
    check(
      `${cls}: conversion speed is bought with stars alone`,
      (ch.levelEffect ?? 0) === 0 && ch.badgeEffect === 0 && ch.starEffect > 0
    );
    check(
      `${cls}: six 5-star staff halve the programme`,
      ch.base + ch.starEffect * 5 === 50,
      `${ch.base + ch.starEffect * 5}%`
    );
  }
  // The staff track still has to DOMINATE the effects that are about quality
  // rather than capacity — that is the line between "a level buys you room" and
  // the bought-by-the-level ladder this system replaced. Prospect value is the
  // one Youth Academy channel that isn't a capacity, so it's the one to police.
  {
    const ch = FACILITY_MAP.youthAcademy.channels.find((c) => c.id === "prospectValue")!;
    const fromLevels = ch.base + (ch.levelEffect ?? 0) * 4;
    const fromStaff = ch.starEffect * 5 + ch.badgeEffect * (36 / ch.badgeTiersPerStep);
    check(
      "youthAcademy/prospectValue: the people still buy most of it",
      fromStaff > fromLevels,
      `levels ${fromLevels}%, staff ${fromStaff}%`
    );
  }
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

// ── 5. The Youth Academy and Scouting Network (v1.82, re-laddered v1.87) ──
//
// Both are MULTI-CHANNEL, and both are DEPARTMENTS: some of what they produce
// is capacity, which belongs to the building, and the rest is quality, which
// belongs to the people. Three things are pinned here that no table reading
// makes obvious:
//
//   - Every level of both facilities BUYS something on its own. The v1.82 Youth
//     Academy failed this — its bases equalled the unbuilt fallbacks, so £50M
//     bought a level-1 building identical to no building at all.
//   - The capacities (beds, focus slots, scout headcount) take level terms and
//     no badge term; the rates (prospect value, scout speed) take the badge
//     track. An integer capacity on a per-tier badge rate would hand out six
//     squad places for one legacy badge and swamp everything else.
//   - The staff still buy the majority of every quality effect, which is the
//     line between "a level buys you room" and the bought-by-the-level ladder
//     the whole facilities system replaced.
//
// Each facility's brief supplies the rest: the rung-by-rung ladder, and the
// ceiling with six legacy-badged 5-stars.

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

console.log("\nYouth Academy — the design brief's worked example (v1.87)");
{
  // The check the v1.82 ladder failed, and the reason this facility was
  // re-laddered: BUILDING it has to do something on its own. Before v1.87 every
  // channel's `base` equalled the unbuilt fallback, so a £50M unlock moved
  // nothing at all until six staff stars were in post. Each of these three is a
  // strict inequality on purpose.
  const team = makeTeam();
  team.facilities = { youthAcademy: { level: 1 } };
  const l1 = {
    squad: chan(team, "youthAcademy", "squadSize").total,
    focus: chan(team, "youthAcademy", "focusSlots").total,
    value: chan(team, "youthAcademy", "prospectValue").total,
  };
  eq("unlock: academy squad size", l1.squad, 20);
  eq("unlock: focus slots", l1.focus, 4);
  eq("unlock: prospect value", l1.value, 3);
  check(
    "unlocking beats not building it on EVERY channel",
    l1.squad > TUNING.academySquadSizeBase && l1.focus > TUNING.u21FocusBase && l1.value > 0,
    `squad ${l1.squad} vs ${TUNING.academySquadSizeBase}, focus ${l1.focus} vs ${TUNING.u21FocusBase}, value ${l1.value}%`
  );
}
{
  // The level ladder, rung by rung, with nobody assigned — the building alone.
  // Every rung is the same rung (+5 places, +1 focus, +3% value), which is what
  // makes the upgrade legible without a table on screen.
  const expected: [number, number, number, number][] = [
    // level, squad, focus, value
    [1, 20, 4, 3],
    [2, 25, 5, 6],
    [3, 30, 6, 9],
    [4, 35, 7, 12],
    [5, 40, 8, 15],
  ];
  for (const [level, squad, focus, value] of expected) {
    const team = makeTeam();
    team.facilities = { youthAcademy: { level } };
    eq(`level ${level} (unstaffed): squad size`, chan(team, "youthAcademy", "squadSize").total, squad);
    eq(`level ${level} (unstaffed): focus slots`, chan(team, "youthAcademy", "focusSlots").total, focus);
    eq(`level ${level} (unstaffed): prospect value`, chan(team, "youthAcademy", "prospectValue").total, value);
  }
}
{
  // Six stars = one step: +2 squad places and +2% value. Focus slots take NO
  // star term (v1.87) — how many prospects you may focus is a property of the
  // building, so it must not drift with who happens to be in post this season.
  const team = makeTeam();
  team.facilities = { youthAcademy: { level: 1 } };
  team.staffRoster = [
    { ...staff(1, 3), assignedTo: "youthAcademy" as const, badges: [] },
    { ...staff(2, 3), assignedTo: "youthAcademy" as const, badges: [] },
  ];
  eq("one 6-star step: squad size", chan(team, "youthAcademy", "squadSize").total, 22);
  eq("one 6-star step: prospect value", chan(team, "youthAcademy", "prospectValue").total, 5);
  eq("one 6-star step: focus slots are unmoved by staff", chan(team, "youthAcademy", "focusSlots").total, 4);
}
{
  // The badge track is prospect value ALONE, and it pays per single tier there
  // (v1.87) — a rate has none of the rounding problem an integer capacity does.
  // The capacities take no badge term at all, which is the check that catches a
  // regression to the v1.82 shape where a legacy badge bought beds.
  const team = makeTeam();
  team.facilities = { youthAcademy: { level: 1 } };
  team.staffRoster = [
    { ...staff(1, 1), assignedTo: "youthAcademy" as const, badges: [{ facility: "youthAcademy" as const, seasons: 1, tier: "bronze" as const }] },
  ];
  eq("one bronze badge: +0.5% prospect value", chan(team, "youthAcademy", "prospectValue").total, 3.5);
  eq("one bronze badge buys no squad places", chan(team, "youthAcademy", "squadSize").total, 20);
  eq("one bronze badge buys no focus slots", chan(team, "youthAcademy", "focusSlots").total, 4);
}
{
  // The ceiling: level 5, 30 stars = 5 steps, 36 badge weight = 36 single tiers.
  const team = maxedTeam("youthAcademy");
  eq("maxed: squad size (20 + 5×4 levels + 2×5 star steps)", chan(team, "youthAcademy", "squadSize").total, 50);
  eq("maxed: focus slots (4 + 1×4, level only)", chan(team, "youthAcademy", "focusSlots").total, 8);
  eq("maxed: prospect value (3 + 3×4 + 2×5 + 0.5×36)", chan(team, "youthAcademy", "prospectValue").total, 43);
  // The split that keeps the facility staffed rather than merely built: most of
  // the value premium is bought with people, not with levels.
  const v = chan(team, "youthAcademy", "prospectValue");
  check(
    "maxed: the staff terms outweigh base+levels on prospect value",
    v.stars + v.badges > v.base + v.levels,
    `staff ${v.stars + v.badges}%, building ${v.base + v.levels}%`
  );
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
//   2. A badge on the shortlist is rare, and the rarer tiers are rarer still —
//      the market must never sell what the ladder exists to make you earn. As
//      of v1.97 that is defended by the RATE rather than by a hard ceiling
//      (`BADGE_HIRE_ABSOLUTE_MAX_TIER`, deleted), so every tier is reachable
//      and each is asserted against its own stated probability. That is a
//      stronger check than the cap was: it catches a table edit that makes gold
//      common, which the ceiling never could.
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
  // The headline rate is now the SUM of the per-tier table (v1.97) rather than a
  // single base constant, so it is asserted against that sum rather than against
  // a hand-written bound: the tables and the generator can't drift apart.
  const expectedBadgedPct =
    BADGE_LADDER.reduce((s, r) => s + (BADGE_HIRE_TIER_CHANCE[r.tier] ?? 0), 0) * 100;
  check(
    `arriving with a badge is rare (${badgedPct.toFixed(1)}%, table says ~${expectedBadgedPct.toFixed(2)}%)`,
    Math.abs(badgedPct - expectedBadgedPct) < 1.5,
    `${badgedPct.toFixed(2)}% against a table of ${expectedBadgedPct.toFixed(2)}%`
  );
  check(
    "the market still can't be shopped for badges",
    badgedPct < 12,
    `${badgedPct.toFixed(1)}% — the market is selling what the ladder should make you earn`
  );

  // Every tier is REACHABLE now — obsidian and legacy included, which reverses
  // the old hard ceiling (v1.97). The defence is the rate, not a cap, so what
  // has to hold is that the rare tiers stay rare AND stay possible: a tier
  // nothing ever generates is dead code, and one that shows up often is the
  // ladder for sale.
  for (const row of BADGE_LADDER) {
    const rate = BADGE_HIRE_TIER_CHANCE[row.tier] ?? 0;
    const held = all.filter((c) => c.badges.some((b) => b.tier === row.tier)).length;
    const pct = (held / all.length) * 100;
    check(
      `${row.tier} is reached and stays rare (${pct.toFixed(2)}%, first-badge rate ${(rate * 100).toFixed(2)}%)`,
      held > 0 && pct < rate * 100 + 1.5,
      `${held} of ${all.length}`
    );
  }

  // A badge is per FACILITY, the same rule the earning side enforces — a
  // candidate holding two records at one building would resume the wrong one the
  // moment he was assigned there.
  const dupeFacility = badged.filter(
    (c) => new Set(c.badges.map((b) => b.facility)).size !== c.badges.length
  );
  check(
    "no candidate holds two badges at the same facility",
    dupeFacility.length === 0,
    `${dupeFacility.length} with a duplicate facility`
  );
  const overSlots = badged.filter((c) => c.badges.length > STAFF_BADGE_SLOTS);
  check(
    `no candidate arrives past the ${STAFF_BADGE_SLOTS}-badge cap`,
    overSlots.length === 0,
    `${overSlots.length} over the cap`
  );

  // Seasons and tier must agree: the card quotes the seasons and the effect
  // reads the tier, so a badge whose seasons don't produce its own tier would
  // display one thing and compute another.
  const mismatched = badged.filter((c) => c.badges.some((b) => badgeTierFor(b.seasons) !== b.tier));
  check(
    "every generated badge's seasons produce its own tier",
    mismatched.length === 0,
    `${mismatched.length} mismatched`
  );

  // Multi-badge candidates: conditional on having one at all, and rare.
  const multi = badged.filter((c) => c.badges.length >= 2).length;
  const triple = badged.filter((c) => c.badges.length >= 3).length;
  const multiPct = (multi / badged.length) * 100;
  const triplePct = (triple / badged.length) * 100;
  check(
    `a second badge is ~${(BADGE_HIRE_SECOND_CHANCE * 100).toFixed(0)}% of badged candidates (${multiPct.toFixed(1)}%)`,
    Math.abs(multiPct - BADGE_HIRE_SECOND_CHANCE * 100) < 5,
    `${multiPct.toFixed(1)}%`
  );
  check(
    `a third is ~${(BADGE_HIRE_THIRD_CHANCE * 100).toFixed(0)}% of them and does happen (${triplePct.toFixed(2)}%)`,
    triple > 0 && triplePct < BADGE_HIRE_THIRD_CHANCE * 100 + 3,
    `${triple} of ${badged.length} badged candidates`
  );
  // The extra badges use the FLATTER table, which is the whole reason it exists
  // — bronze must dominate them where the first-badge table barely favours it.
  const extras = badged.flatMap((c) => c.badges.slice(1));
  const extraBronze = extras.filter((b) => b.tier === "bronze").length;
  const bronzeShare =
    BADGE_HIRE_EXTRA_TIER_WEIGHT.bronze /
    BADGE_LADDER.reduce((s, r) => s + BADGE_HIRE_EXTRA_TIER_WEIGHT[r.tier], 0);
  check(
    `extra badges follow the flat table (${((extraBronze / Math.max(1, extras.length)) * 100).toFixed(0)}% bronze, table says ${(bronzeShare * 100).toFixed(0)}%)`,
    extras.length > 20 && Math.abs(extraBronze / extras.length - bronzeShare) < 0.15,
    `${extraBronze} of ${extras.length}`
  );

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

// Drives a real world through the v1.93 features and asserts the behaviour,
// not the tables. Every defect these catch was invisible in config alone:
// a facility can be perfectly specified and still be wired to nothing.
//
// Run: npx tsx scripts/verify-v193.ts

import { generateWorld } from "../lib/worldgen";
import { TUNING } from "../lib/config/tuning";
import { weeklyBreakdown } from "../lib/economy";
import {
  archetypeClassGrowthMultiplier,
  archetypeConversionUnlocked,
  assignStaff,
  hireStaff,
  incomeMultiplier,
  academyWageMultiplier,
  facilityEffect,
  sponsorOfferMultiplier,
  squadWageMultiplier,
  staffWageCutMultiplier,
  unlockFacility,
  upgradeFacility,
} from "../lib/facilities";
import { ARCHETYPE_DEV_CLASS, FACILITY_SPECS } from "../lib/config/facilities";
import {
  conversionError,
  conversionOptionsFor,
  conversionSeasonsRequired,
  reshapeToward,
  rolloverConversions,
  startConversion,
} from "../lib/archetypedev";
import { academyYouthAgeBonus } from "../lib/academy";
import { deriveArchetype } from "../lib/config/archetype";
import { overallFromAttrs } from "../lib/config/positions";
import type { FacilityId, GameState, StaffCandidate } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function makeWorld(): GameState {
  return generateWorld({
    saveName: "v193",
    managerName: "Tester",
    userTeamId: "ENG1_t9",
    playableCountry: "ENG",
    viewCountries: [],
    seed: 4242,
  });
}

/** Build a facility to `level` and fill every slot with a 5-star hire.
 *
 * Funds the club first and asserts every step: `unlockFacility` and
 * `upgradeFacility` return an error STRING rather than throwing, so a build
 * that silently failed on budget would leave the facility locked and every
 * assertion below it would be testing the unbuilt path while claiming to test
 * the maxed one. */
function buildAndStaff(state: GameState, id: FacilityId, level: number) {
  const team = state.teams[state.userTeamId];
  team.budget += 5e9;
  const unlockErr = unlockFacility(state, id);
  if (unlockErr) throw new Error(`${id}: ${unlockErr}`);
  for (let i = 1; i < level; i++) {
    const err = upgradeFacility(state, id);
    if (err) throw new Error(`${id} → level ${i + 1}: ${err}`);
  }
  const slots = FACILITY_SPECS.find((f) => f.id === id)!.slotsByLevel[level - 1];
  for (let i = 0; i < slots; i++) {
    const cand: StaffCandidate = {
      id: `stf_${id}_${i}`,
      name: `Coach ${i}`,
      nationality: "ENG",
      age: 30,
      stars: 5,
      wage: 0,
      fee: 0,
      badges: [],
    };
    state.staffMarket = [...(state.staffMarket ?? []), cand];
    team.budget += 1e9;
    hireStaff(state, cand.id);
    assignStaff(state, cand.id, id);
  }
}

console.log("\n── The academy develops the young faster (v1.93) ──────────────\n");
{
  const cfg = TUNING;
  const peak = academyYouthAgeBonus(cfg.academyYouthPeakAge, cfg);
  check("a prospect at the peak age gets the full bonus", Math.abs(peak - (1 + cfg.academyYouthGrowthBonus)) < 1e-9, `×${peak.toFixed(3)}`);
  check("younger than the peak is not MORE than the peak", academyYouthAgeBonus(13, cfg) === peak);
  check(
    "the bonus decays with age",
    academyYouthAgeBonus(17, cfg) > academyYouthAgeBonus(19, cfg) &&
      academyYouthAgeBonus(19, cfg) > academyYouthAgeBonus(20, cfg),
    `17→${academyYouthAgeBonus(17, cfg).toFixed(3)} 19→${academyYouthAgeBonus(19, cfg).toFixed(3)} 20→${academyYouthAgeBonus(20, cfg).toFixed(3)}`
  );
  // The load-bearing one: at the age-out boundary the academy is worth exactly
  // nothing, so promoting is never a punishment and the ramp joins the senior
  // curve smoothly instead of arriving as a cliff.
  check("it is exactly 1 at the age a prospect must leave", academyYouthAgeBonus(cfg.academyMaxAge, cfg) === 1);
  check("and stays 1 beyond it", academyYouthAgeBonus(cfg.academyMaxAge + 4, cfg) === 1);
}

console.log("\n── Club Income Center ────────────────────────────────────────\n");
{
  const state = makeWorld();
  const before = weeklyBreakdown(state, state.userTeamId, TUNING);
  check("unbuilt: no income uplift at all", before.incomeCenterBonus === 0 && incomeMultiplier(state, state.userTeamId) === 1);

  buildAndStaff(state, "clubIncomeCenter", 5);
  const after = weeklyBreakdown(state, state.userTeamId, TUNING);
  const eff = facilityEffect(state.teams[state.userTeamId], "clubIncomeCenter");
  const income = eff.channels.find((c) => c.id === "weeklyIncome")!.total;
  const sponsors = eff.channels.find((c) => c.id === "sponsorOffers")!.total;
  check("maxed (level 5, 30 stars): weekly income = +23%", income === 23, `${income}%`);
  check("maxed, unbadged: sponsorship offers = +9%", sponsors === 9, `${sponsors}%`);
  check("the uplift reaches the weekly books", after.incomeCenterBonus > 0, `£${Math.round(after.incomeCenterBonus)}/wk`);
  check("...and it is the right share of gross income", Math.abs(after.incomeCenterBonus / (income / 100) - (after.tvIncome + after.positionBonus + after.gateIncome + after.facilityIncome + after.sponsorIncome)) < 2);
  check("sponsor offers are lifted too", sponsorOfferMultiplier(state, state.userTeamId) > 1, `×${sponsorOfferMultiplier(state, state.userTeamId).toFixed(3)}`);
  // An AI club must never see any of it — the facility is the user's alone.
  const ai = Object.values(state.teams).find((t) => t.id !== state.userTeamId)!;
  check("an AI club is untouched", incomeMultiplier(state, ai.id) === 1 && weeklyBreakdown(state, ai.id, TUNING).incomeCenterBonus === 0);
}

console.log("\n── Club Expense Center ───────────────────────────────────────\n");
{
  const state = makeWorld();
  const before = weeklyBreakdown(state, state.userTeamId, TUNING);
  check("unbuilt: no saving", before.expenseCenterSaving === 0 && squadWageMultiplier(state, state.userTeamId) === 1);

  buildAndStaff(state, "clubExpenseCenter", 5);
  const after = weeklyBreakdown(state, state.userTeamId, TUNING);
  const eff = facilityEffect(state.teams[state.userTeamId], "clubExpenseCenter");
  const squad = eff.channels.find((c) => c.id === "squadWageCut")!.total;
  const staff = eff.channels.find((c) => c.id === "staffWageCut")!.total;
  check("maxed, unbadged: squad wage cut = 8%", squad === 8, `${squad}%`);
  check("maxed, unbadged: staff wage cut = 10%", staff === 10, `${staff}%`);
  check("the squad wage bill actually falls", after.wageBill < before.wageBill, `£${Math.round(before.wageBill)} → £${Math.round(after.wageBill)}`);
  check("the saving is reported", after.expenseCenterSaving > 0, `£${Math.round(after.expenseCenterSaving)}/wk`);
  // The invariant that stops a stack of percentages becoming a money printer.
  check("no cut can ever make a bill negative", squadWageMultiplier(state, state.userTeamId) >= 0 && academyWageMultiplier(state, state.userTeamId) >= 0 && staffWageCutMultiplier(state, state.userTeamId) >= 0);
  check("an AI club is untouched", squadWageMultiplier(state, Object.values(state.teams).find((t) => t.id !== state.userTeamId)!.id) === 1);
}

console.log("\n── Archetype development centers ─────────────────────────────\n");
{
  const state = makeWorld();
  for (const { cls } of ARCHETYPE_DEV_CLASS) {
    check(`${cls}: unbuilt, growth multiplier is exactly 1`, archetypeClassGrowthMultiplier(state, state.userTeamId, cls) === 1);
    check(`${cls}: unbuilt, retraining is locked`, !archetypeConversionUnlocked(state, cls));
  }
  // Every class has a center now, Blitzer included — the four-center cut left it
  // as the one class nobody could ever be retrained into. What must still hold is
  // that an UNRECOGNISED class resolves to no effect rather than throwing: the
  // callers pass a derived archetype's class, and a player with no derivable
  // archetype has none at all.
  check(
    "an unknown class resolves to no effect rather than throwing",
    archetypeClassGrowthMultiplier(state, state.userTeamId, "NotAClass") === 1 &&
      !archetypeConversionUnlocked(state, "NotAClass")
  );
  check(
    "...and so does a player with no derivable archetype (undefined class)",
    archetypeClassGrowthMultiplier(state, state.userTeamId, undefined) === 1
  );

  buildAndStaff(state, "blitzerDevelopment", 5);
  check("Blitzer center at level 5: growth = +9%", Math.abs(archetypeClassGrowthMultiplier(state, state.userTeamId, "Blitzer") - 1.09) < 1e-9);
  check("level 5 unlocks Blitzer retraining", archetypeConversionUnlocked(state, "Blitzer"));
  check("six 5-star staff halve a Blitzer programme", conversionSeasonsRequired(state, "Blitzer", TUNING) === Math.ceil(TUNING.archetypeConvertSeasons / 2));

  buildAndStaff(state, "creatorDevelopment", 5);
  const mult = archetypeClassGrowthMultiplier(state, state.userTeamId, "Creator");
  check("Creator center at level 5: growth = +9%", Math.abs(mult - 1.09) < 1e-9, `×${mult.toFixed(3)}`);
  check("...and it does NOT leak to another class", archetypeClassGrowthMultiplier(state, state.userTeamId, "Engine") === 1);
  check("level 5 unlocks Creator retraining", archetypeConversionUnlocked(state, "Creator"));
  check("...and only Creator retraining", !archetypeConversionUnlocked(state, "Engine"));
  // The brief's headline: 30 stars halves the programme.
  const seasons = conversionSeasonsRequired(state, "Creator", TUNING);
  check("six 5-star staff halve the programme", seasons === Math.ceil(TUNING.archetypeConvertSeasons / 2), `${seasons} season(s)`);
}

console.log("\n── Retraining preserves overall ──────────────────────────────\n");
{
  const state = makeWorld();
  buildAndStaff(state, "creatorDevelopment", 5);
  const team = state.teams[state.userTeamId];
  // A player whose position can hold a Creator role and who isn't one already.
  const subject = team.playerIds
    .map((id) => state.players[id])
    .find((p) => p && !p.retired && conversionOptionsFor(state, p.id).some((a) => a.cls === "Creator"));
  if (!subject) {
    check("found a player eligible for retraining", false);
  } else {
    const target = conversionOptionsFor(state, subject.id).find((a) => a.cls === "Creator")!;
    const wasOverall = subject.overall;
    const wasArchetype = deriveArchetype(subject.attrs, subject.positions[0])?.name;

    // The reshaping itself, in isolation: overall must survive it exactly.
    const reshaped = reshapeToward(subject.attrs, subject.positions[0], target.planId, wasOverall, 1);
    check(
      "a full reshape holds the player's overall",
      overallFromAttrs(reshaped, subject.positions[0]) === wasOverall,
      `${wasOverall} → ${overallFromAttrs(reshaped, subject.positions[0])}`
    );
    check("...and it actually moved his attributes", JSON.stringify(reshaped) !== JSON.stringify(subject.attrs));

    const err = startConversion(state, subject.id, target.planId, TUNING);
    check("a legal programme starts", err === null, err ?? "");
    check("the center refuses a second programme while busy", conversionError(state, team.playerIds.find((id) => id !== subject.id && conversionOptionsFor(state, id).some((a) => a.cls === "Creator"))!, target.planId, TUNING) !== null);

    // Drive it to completion through the real rollover function.
    let done = false;
    for (let s = 0; s < 6 && !done; s++) {
      const out = rolloverConversions(state, TUNING);
      done = out.some((o) => o.completed);
    }
    check("the programme completes", done);
    check("his overall is unchanged by the whole programme", subject.overall === wasOverall, `${wasOverall} → ${subject.overall}`);
    const now = deriveArchetype(subject.attrs, subject.positions[0]);
    check("his archetype changed", now?.name !== wasArchetype, `${wasArchetype} → ${now?.name}`);
    check("...to the target role", now?.id === target.id, `wanted ${target.name}, got ${now?.name}`);
    check("his training plan follows, so growth won't undo it", subject.trainingPlan === target.planId);
    check("the slot is freed", (state.archetypeConversions ?? []).length === 0);
  }
}

console.log(
  failures === 0 ? "\nAll v1.93 checks passed.\n" : `\n${failures} check(s) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);

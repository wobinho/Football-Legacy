// Headless end-to-end drive of the facilities system (v1.79).
//
// `verify-facilities.ts` checks the MATH in isolation. This checks the system
// as it is actually played: build the facility with real money, hire out of the
// real market, assign, then run real season rollovers and confirm badges accrue
// and the growth the development pass applies actually changes.
//
// The last check is the one that matters most — a facility whose effect the
// engine never reads would pass every unit test in the other file.
//
//   npx tsx scripts/smoke-facilities.ts [seasons]

import { generateWorld } from "../lib/worldgen";
import { runSeasonRollover } from "../lib/gameloop";
import {
  assignStaff,
  eliteResistRelief,
  facilityEffect,
  growthMultiplier,
  hireStaff,
  releaseStaff,
  rosterOf,
  slotCount,
  staffWageBill,
  unlockFacility,
  upgradeFacility,
} from "../lib/facilities";
import { eliteResistMult } from "../lib/development";
import { TUNING } from "../lib/config/tuning";
import { FACILITY_MAP, headlineChannel } from "../lib/config/facilities";

const SEASONS = Number(process.argv[2] ?? 12);
const ETC = "eliteTrainingCenter" as const;
const HPC = "highPerformanceCenter" as const;

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
  if (!cond) failures++;
}

const state = generateWorld({
  saveName: "facilities-smoke",
  managerName: "Facilities Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 4242,
});
const team = state.teams[state.userTeamId];
const spec = FACILITY_MAP[ETC];
// The ETC produces exactly one quantity, so its headline channel IS its effect.
// Everything below is stated against that channel rather than the spec, which
// since v1.82 carries a list.
const etcChannel = headlineChannel(spec);

console.log(`\nClub: ${team.name}  ·  budget ${Math.round(team.budget / 1e6)}M\n`);

// ── Building it ───────────────────────────────────────────────────────────

console.log("Unlock & upgrade");
check("starts locked", facilityEffect(team, ETC).total === 0);

// Give the club enough money to exercise the whole track, then build.
team.budget = 500_000_000;
const budgetBefore = team.budget;
check("unlock succeeds", unlockFacility(state, ETC) === null);
check(
  `unlock charged ${Math.round(spec.unlockCost / 1e6)}M`,
  budgetBefore - team.budget === spec.unlockCost,
  `charged ${budgetBefore - team.budget}`
);
check("cannot build twice", unlockFacility(state, ETC) !== null);
check(`base effect is +${etcChannel.base}%`, facilityEffect(team, ETC).total === etcChannel.base);
check(`level 1 offers ${spec.slotsByLevel[0]} slots`, slotCount(team, ETC) === spec.slotsByLevel[0]);

// Upgrade to the top; each step should buy slots and leave the base alone.
const baseBefore = facilityEffect(team, ETC).base;
while (upgradeFacility(state, ETC) === null) {
  /* climb */
}
check("upgrades reach max level", slotCount(team, ETC) === spec.slotsByLevel[spec.slotsByLevel.length - 1]);
check("upgrading never changed the base effect", facilityEffect(team, ETC).base === baseBefore);

// ── Hiring & assigning ────────────────────────────────────────────────────

console.log("\nHiring & assignment");
const slots = slotCount(team, ETC);
let hired = 0;
for (const cand of [...(state.staffMarket ?? [])]) {
  if (hired >= slots) break;
  if (hireStaff(state, cand.id) === null) hired++;
}
check(`hired ${hired} staff from the market`, hired > 0, "market produced nobody hireable");
check("roster reflects the hires", rosterOf(team).length === hired);
check("wage bill is non-zero once staffed", staffWageBill(state) > 0);
check(
  "unassigned staff contribute nothing",
  facilityEffect(team, ETC).total === etcChannel.base,
  `got ${facilityEffect(team, ETC).total}`
);

for (const person of rosterOf(team)) assignStaff(state, person.id, ETC);
const staffed = facilityEffect(team, ETC);
check(`assigning ${hired} staff filled ${staffed.slotsUsed} slots`, staffed.slotsUsed === hired);
check(
  `star bonus applied (${staffed.totalStars} stars → +${staffed.stars}%)`,
  staffed.stars === Math.floor(staffed.totalStars / 6) * etcChannel.starEffect
);

// Overfilling must be refused rather than silently dropped.
const extra = (state.staffMarket ?? [])[0];
if (extra && hired >= slots) {
  hireStaff(state, extra.id);
  check("a full facility refuses another assignment", assignStaff(state, extra.id, ETC) !== null);
  releaseStaff(state, extra.id);
}

// ── The effect actually reaches the engine ────────────────────────────────

console.log("\nEngine wiring");
const mult = growthMultiplier(state, state.userTeamId);
check(
  `growthMultiplier reflects the facility (${mult.toFixed(3)})`,
  Math.abs(mult - (1 + staffed.total / 100)) < 1e-9,
  `got ${mult}`
);
const rivalId = Object.keys(state.teams).find((id) => id !== state.userTeamId)!;
check("an AI club is unaffected (1.0)", growthMultiplier(state, rivalId) === 1);

// ── Badges over a career ──────────────────────────────────────────────────

console.log(`\n${SEASONS} seasons of service`);
const watched = rosterOf(team)[0];
const watchedId = watched?.id;
// A hire may arrive with a badge already earned at a previous club, so the
// baseline is what they walked in with — not zero.
const watchedStart = watched?.badges.find((b) => b.facility === ETC)?.seasons ?? 0;
for (let s = 0; s < SEASONS; s++) {
  runSeasonRollover(state);
  // Staff retire with age; re-assign anyone the rollover left standing (a real
  // player would do this from the screen).
  for (const person of rosterOf(team)) {
    if (!person.assignedTo) assignStaff(state, person.id, ETC);
  }
}

const survivor = rosterOf(team).find((p) => p.id === watchedId);
if (survivor) {
  const badge = survivor.badges.find((b) => b.facility === ETC);
  const earnedHere = (badge?.seasons ?? 0) - watchedStart;
  check(
    `${survivor.name} accrued service (${badge?.tier ?? "none"}, ${badge?.seasons ?? 0} seasons, ${earnedHere} earned here)`,
    !!badge && earnedHere > 0
  );
  check(
    "seasons earned here never exceed rollovers run",
    earnedHere <= SEASONS,
    `earned ${earnedHere} over ${SEASONS} rollovers`
  );
  check("never more than 3 badges", survivor.badges.length <= 3);
} else {
  console.log("  · the watched staff member retired before the run ended (expected at length)");
}

const finalEff = facilityEffect(team, ETC);
console.log(
  `\n  final: +${finalEff.total.toFixed(1)}% = ${finalEff.base} base + ${finalEff.stars} stars (${finalEff.totalStars}★) + ${finalEff.badges.toFixed(1)} badges`
);
check("final effect is within the system's ceiling", finalEff.total <= 33 + 1e-9, `got ${finalEff.total}`);

// ── The High Performance Center (v1.81) ───────────────────────────────────
//
// The ETC leg above proves the star/badge machinery. This leg proves the ONE
// thing that is different about the HPC: its effect is a cut to the
// elite-resistance penalty, and the development pass actually reads it.

console.log("\nHigh Performance Center");
{
  team.budget = 500_000_000;
  check("starts locked", eliteResistRelief(state, state.userTeamId) === 0);
  check("unlock succeeds", unlockFacility(state, HPC) === null);
  const hpcBase = headlineChannel(FACILITY_MAP[HPC]).base;
  check(
    `base relief is ${hpcBase}%`,
    Math.abs(eliteResistRelief(state, state.userTeamId) - hpcBase / 100) < 1e-9,
    `got ${eliteResistRelief(state, state.userTeamId)}`
  );
  check("an AI club gets no relief", eliteResistRelief(state, rivalId) === 0);

  // Assign whoever is free — the two facilities compete for the same roster,
  // which is the actual decision the building creates.
  let moved = 0;
  for (const person of rosterOf(team)) {
    if (assignStaff(state, person.id, HPC) === null) moved++;
  }
  const eff = facilityEffect(team, HPC);
  check(`assigned ${moved} staff to the HPC`, eff.slotsUsed === moved);
  check(
    "relief tracks the facility's total",
    Math.abs(eliteResistRelief(state, state.userTeamId) - eff.total / 100) < 1e-9
  );

  // The check that matters: the curve the engine applies actually moved, and it
  // moved in the direction that lets an elite player keep growing.
  const relief = eliteResistRelief(state, state.userTeamId);
  const plain = eliteResistMult(90, TUNING);
  const relieved = eliteResistMult(90, TUNING, relief);
  check(
    `a 90-rated player's growth damping eased (${plain.toFixed(3)} → ${relieved.toFixed(3)})`,
    relieved > plain
  );
  check(
    "a 60-rated player is untouched — the ETC is still what develops him",
    eliteResistMult(60, TUNING, relief) === eliteResistMult(60, TUNING)
  );
  check("relief never exceeds the system ceiling", eff.total <= 61 + 1e-9, `got ${eff.total}`);
}

check("save still round-trips", JSON.parse(JSON.stringify(state)).userTeamId === state.userTeamId);

console.log();
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("Facilities smoke test passed.");

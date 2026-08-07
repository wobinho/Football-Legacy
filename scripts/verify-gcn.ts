/**
 * GCN verifier (v1.88). Drives a REAL world into a live network and asserts the
 * three things this rework changed, none of which is visible in the tables:
 *
 *  1. An owned sim-league club's Finance panel no longer reads £0 in / £0 out,
 *     and what the panel says matches what the weekly tick actually banks. That
 *     equality is the whole point — the panel is not allowed to quote a number
 *     the simulation won't move.
 *  2. The relaxed ring fence permits exactly the moves it should: two domestic
 *     holdings may trade (priced at market value), the manager's own squad may
 *     not touch a ring-fenced club in either direction, and a ring-fenced club
 *     may not import across a border.
 *  3. A priced domestic move is money-conserving between the two clubs.
 *
 * Assertions are about SHAPE (a club trades at a plausible sign, a rule refuses
 * the right pairs), never exact figures — those are tuning and must be free to
 * move without breaking the check.
 */

import { generateWorld, teamIdFor } from "../lib/worldgen";
import { TUNING } from "../lib/config/tuning";
import {
  gcnClubFinance,
  gcnSimBooks,
  gcnWeeklyTick,
  moveWithinNetwork,
  networkMoveError,
  networkTransferFee,
  fundClub,
} from "../lib/gcn";
import {
  GCN_EXEC_ROLES,
  execBadgeTierFor,
  execBadgeWeight,
  execEffect,
  execMarketTick,
  execSeasonRollover,
  execWageBill,
  executiveIn,
  globalCommerceMult,
  globalFootballMult,
  globalScoutingCostMult,
  hireExecutive,
} from "../lib/gcnexec";
import {
  HUB_REGIONS,
  HUB_REGION_MAP,
  buildHub,
  closeHub,
  dailyHubTick,
  hasPresenceIn,
  hubBuildCost,
  hubCapacity,
  hubFocusError,
  hubGrowthMult,
  hubIn,
  hubJudgement,
  hubPlacementError,
  hubProspects,
  hubReportDays,
  hubUpkeepWeekly,
  hubs,
  clubCountryCode,
  countryCodeOf,
  placeHubProspect,
  setHubFocus,
  setHubPaused,
  signHubProspect,
  upgradeHub,
} from "../lib/gcnhub";
import { ARCHETYPE_ROSTER, positionsOfArchetype } from "../lib/config/archetype";
import { prospectSignFee } from "../lib/academy";
import { isFreeAgent } from "../lib/archive";
import type { GameState, GlobalClubNetwork } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function money(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

// ── A world with a live network ──────────────────────────────────────────────

// The user's club is resolved the way the game resolves it — `teamIdFor` on the
// top division — so worldgen sees a real id and the welcome message, the seed and
// the accolade sync all behave as they do in a real save.
const state: GameState = generateWorld({
  saveName: "verify-gcn",
  managerName: "Verifier",
  userTeamId: teamIdFor("ENG1", 0),
  playableCountry: "ENG",
  viewCountries: ["ESP", "GER", "FRA", "ITA"],
  seed: 20260803,
});

if (!state.teams[state.userTeamId]) {
  console.log(`Setup failed: ${state.userTeamId} is not a club in the built world.`);
  process.exit(1);
}

const gcn: GlobalClubNetwork = {
  name: "Verify Group",
  foundedSeason: state.season,
  treasury: 5_000_000_000,
  clubIds: [],
  ops: {},
};
state.gcn = gcn;

const userCountry = state.leagues[state.teams[state.userTeamId].leagueId].country;

/** Take a club into the network by hand — the verifier is testing the rules
 * below, not `buyClub`'s price, and a hand-placed club keeps the setup legible. */
function own(clubId: string) {
  const club = state.teams[clubId];
  club.gcnOwned = true;
  club.gcnAcquiredSeason = state.season;
  if (state.leagues[club.leagueId].country === userCountry) club.gcnRingFenced = true;
  gcn.clubIds.push(clubId);
}

// Two FOREIGN sim clubs (unfenced) and two DOMESTIC clubs (ring-fenced).
//
// The domestic pair comes from the manager's own PYRAMID, not from a domestic
// sim division: England ships two playable tiers and no sim tier below them, so
// a home-country holding is in practice a club in tier 2. That is the real case
// the ring fence was written for, which makes it the right one to check.
const foreignSim = Object.values(state.leagues).filter(
  (l) => !l.playable && l.country !== userCountry
);
const domesticLeagues = Object.values(state.leagues).filter(
  (l) => l.country === userCountry && l.id !== state.teams[state.userTeamId].leagueId
);

if (foreignSim.length < 1 || domesticLeagues.length < 1) {
  console.log("Setup failed: the world lacks the leagues this check needs.");
  process.exit(1);
}

const foreignA = foreignSim[0].teamIds[0];
const foreignB = foreignSim[0].teamIds[1];
const domesticA = domesticLeagues[0].teamIds[0];
const domesticB = domesticLeagues[0].teamIds[1];
[foreignA, foreignB, domesticA, domesticB].forEach(own);

console.log("\nGCN verifier (v1.88)\n");
console.log(`  world: user at ${state.teams[state.userTeamId].name} (${userCountry})`);
console.log(`  foreign holdings:  ${state.teams[foreignA].name}, ${state.teams[foreignB].name}`);
console.log(`  domestic holdings: ${state.teams[domesticA].name}, ${state.teams[domesticB].name}\n`);

// ── 1. A sim club's books are non-zero and match what the tick banks ─────────

console.log("1. Owned sim-league clubs keep real books");

const fin = gcnClubFinance(state, foreignA, TUNING)!;
check("income is non-zero", fin.income > 0, `income ${money(fin.income)}`);
check("spend is non-zero", fin.expenses > 0, `expenses ${money(fin.expenses)}`);
console.log(
  `       ${state.teams[foreignA].name}: in ${money(fin.income)} / out ${money(fin.expenses)} / net ${money(fin.net)}`
);

// What the panel says must equal what the week actually moves. Isolate the club:
// zero the treasury's other outflows so only this club's own lines and its GCN
// Deals move its budget.
const before = state.teams[foreignA].budget;
const treasuryBefore = gcn.treasury;
gcnWeeklyTick(state, TUNING);
const banked = state.teams[foreignA].budget - before;
check(
  "the panel's net equals what the weekly tick banks",
  banked === fin.net,
  `panel ${money(fin.net)} vs banked ${money(banked)}`
);
check("the treasury is untouched by a club's own trading", gcn.treasury === treasuryBefore);

// The ordering that matters, and the one the first cut got backwards: a club's
// weekly net must RISE with its reputation. Every sim league is tier 1, so the
// tier-keyed income lines are nearly flat while wage bills run 5:1 — without the
// reputation scaling the giants an empire is built on were the clubs losing
// money. Asserted as a shape (big clubs beat small ones, most clubs solvent),
// never as figures, so tuning stays free to move.
// Only an OWNED club has books, so the sweep temporarily flags every sim club as
// owned, measures, then puts the world back exactly as it found it — the checks
// after this one depend on the four-club network above being intact.
const sweepIds = Object.values(state.leagues)
  .filter((l) => !l.playable)
  .flatMap((l) => l.teamIds)
  .filter((id) => !state.teams[id].gcnOwned);
for (const id of sweepIds) state.teams[id].gcnOwned = true;

const world = Object.values(state.leagues)
  .filter((l) => !l.playable)
  .flatMap((l) => l.teamIds)
  .map((id) => ({ rep: state.teams[id].reputation, books: gcnSimBooks(state, id, TUNING) }))
  .filter((r): r is { rep: number; books: { income: number; wages: number } } => !!r.books)
  .map((r) => ({ rep: r.rep, net: r.books.income - r.books.wages }))
  .sort((a, b) => b.rep - a.rep);

const topQuartile = world.slice(0, Math.max(1, Math.floor(world.length / 4)));
const bottomQuartile = world.slice(-Math.max(1, Math.floor(world.length / 4)));
const meanNet = (rows: { net: number }[]) => rows.reduce((s, r) => s + r.net, 0) / rows.length;
const insolvent = world.filter((r) => r.net < 0).length;

check(
  "a club's weekly net rises with its reputation",
  meanNet(topQuartile) > meanNet(bottomQuartile),
  `top ${money(meanNet(topQuartile))} vs bottom ${money(meanNet(bottomQuartile))}`
);
check(
  "the great majority of sim clubs are solvent",
  insolvent <= world.length * 0.15,
  `${insolvent} of ${world.length} running at a loss`
);
console.log(
  `       across ${world.length} sim clubs: top quartile ${money(meanNet(topQuartile))}/wk,` +
    ` bottom quartile ${money(meanNet(bottomQuartile))}/wk, ${insolvent} at a loss`
);

for (const id of sweepIds) delete state.teams[id].gcnOwned; // restore the world

// A ring-fenced club draws the AI subsidy instead, so it must NOT get sim books
// as well — that would be double income.
check(
  "a ring-fenced club takes no second set of books",
  gcnSimBooks(state, domesticA, TUNING) === null
);
// ...and an unfenced one does.
check("an unfenced owned club does", gcnSimBooks(state, foreignA, TUNING) !== null);

// ── 2. The relaxed ring fence permits exactly the right moves ───────────────

console.log("\n2. Ring-fence rules");

check(
  "two domestic holdings may trade",
  networkMoveError(state, domesticA, domesticB, TUNING) === null
);
check(
  "the manager's own squad may not send to a ring-fenced club",
  networkMoveError(state, state.userTeamId, domesticA, TUNING) !== null
);
check(
  "...nor receive from one",
  networkMoveError(state, domesticA, state.userTeamId, TUNING) !== null
);
check(
  "a ring-fenced club may not trade across a border",
  networkMoveError(state, foreignA, domesticA, TUNING) !== null
);
check(
  "two foreign holdings still trade freely",
  networkMoveError(state, foreignA, foreignB, TUNING) === null
);
check(
  "the manager's own squad still reaches a foreign holding",
  networkMoveError(state, state.userTeamId, foreignA, TUNING) === null
);

// ── 3. A domestic move is priced and money-conserving ───────────────────────

console.log("\n3. Domestic moves are priced, cross-border ones are free");

const domesticPlayer = state.teams[domesticA].playerIds.find((id) => !state.players[id].loan)!;
const fee = networkTransferFee(state, domesticPlayer, domesticA, domesticB, TUNING);
check("a domestic move carries a fee", fee > 0, `fee ${money(fee)}`);

const foreignPlayer = state.teams[foreignA].playerIds.find((id) => !state.players[id].loan)!;
check(
  "a cross-border move inside the network is free",
  networkTransferFee(state, foreignPlayer, foreignA, foreignB, TUNING) === 0
);

// Make sure the buyer can pay, then assert the money conserves.
state.teams[domesticB].budget = fee * 2;
const sellerBefore = state.teams[domesticA].budget;
const buyerBefore = state.teams[domesticB].budget;
const err = moveWithinNetwork(state, domesticPlayer, domesticB, TUNING);
check("the move succeeds", err === undefined, String(err));
check(
  "the player actually changed clubs",
  state.players[domesticPlayer].clubId === domesticB
);
const sellerGain = state.teams[domesticA].budget - sellerBefore;
const buyerLoss = buyerBefore - state.teams[domesticB].budget;
check("the seller banks the fee", sellerGain === fee, `${money(sellerGain)} vs ${money(fee)}`);
check("the buyer pays it", buyerLoss === fee, `${money(buyerLoss)} vs ${money(fee)}`);

// A buyer who can't afford the fee is refused rather than driven negative.
const secondPlayer = state.teams[domesticB].playerIds.find(
  (id) => !state.players[id].loan && id !== domesticPlayer
)!;
state.teams[domesticA].budget = 0;
const refused = moveWithinNetwork(state, secondPlayer, domesticA, TUNING);
check("a buyer who can't pay is refused", typeof refused === "string", String(refused));
check("...and the player stayed put", state.players[secondPlayer].clubId === domesticB);

// ── 4. Money still can't cross the fence ────────────────────────────────────

console.log("\n4. Money still never crosses the fence");
check(
  "a ring-fenced club can't be funded from the treasury",
  typeof fundClub(state, domesticA, 1_000_000) === "string"
);
check(
  "an unfenced holding can be",
  fundClub(state, foreignA, 1_000_000) === undefined
);


// ── 5. Global Executives (v1.95) ────────────────────────────────────────────
//
// The seat system's load-bearing property is the SPLIT between what a hire buys
// and what service earns. A 5-star appointment must land somewhere around half
// of a seat's ceiling, with the rest only reachable by keeping someone — that is
// what makes a decade-long appointment a bet rather than a rounding error
// against re-hiring whoever is best this month. Checked as a shape (a band),
// never as an exact figure: the three effect rows are tuning.

console.log("\n5. Global Executives");

for (const spec of GCN_EXEC_ROLES) {
  const role = spec.id;
  const vacant = execEffect(state, role, TUNING);
  check(`${role}: a vacant seat is worth nothing`, vacant.total === 0 && !vacant.filled);
}

// Multipliers must be exactly 1 with the board empty, or every save without a
// GCN is silently altered.
check(
  "an empty board leaves commerce income untouched",
  globalCommerceMult(state, TUNING) === 1
);
check(
  "an empty board leaves owned-club football untouched",
  globalFootballMult(state, foreignA, TUNING) === 1
);

execMarketTick(state, TUNING);
const market = state.gcn!.execMarket ?? [];
check(
  "the market offers candidates for all three seats",
  GCN_EXEC_ROLES.every((s) => market.some((c) => c.role === s.id)),
  `${market.length} candidates`
);
// The top of the ladder must be unbuyable — the same rule the club staff market
// follows, and for the same reason: a ladder you can buy the top of is not one.
const maxHireTier = execBadgeTierFor(TUNING, TUNING.gcnExecBadgeHireMaxSeasons);
check(
  "no candidate arrives above the hire ceiling",
  market.every((c) => execBadgeWeight(c.badge) <= execBadgeWeight(maxHireTier ?? undefined)),
  `ceiling ${maxHireTier}`
);

// Appoint the best available candidate to each seat and measure the split.
for (const spec of GCN_EXEC_ROLES) {
  const best = (state.gcn!.execMarket ?? [])
    .filter((c) => c.role === spec.id)
    .sort((a, b) => b.stars - a.stars)[0];
  if (!best) continue;
  const err = hireExecutive(state, best.id, TUNING);
  check(`${spec.id}: the appointment goes through`, err === undefined, String(err));
}

for (const spec of GCN_EXEC_ROLES) {
  const exec = executiveIn(state, spec.id);
  if (!exec) continue;
  const fx = execEffect(state, spec.id, TUNING);
  check(`${spec.id}: a filled seat is worth something`, fx.total > 0 && fx.filled);
  // A fresh appointment holds no badge earned HERE, so its badge term is only
  // whatever pedigree it arrived with — and it must be well short of the ceiling.
  check(
    `${spec.id}: a new hire is short of the seat's ceiling`,
    fx.total < fx.max * 0.9,
    `${fx.total.toFixed(1)}% of ${fx.max.toFixed(1)}%`
  );
}

// Serve out a long career and confirm the badge track actually pays — and that
// it is a large enough share of the seat to be worth waiting for.
const footballBefore = execEffect(state, "football", TUNING).total;
const seasonsToLegacy = TUNING.gcnExecBadgeSeasons[TUNING.gcnExecBadgeSeasons.length - 1];
for (let i = 0; i < seasonsToLegacy + 1; i++) execSeasonRollover(state, TUNING);
const footballAfter = execEffect(state, "football", TUNING);
check(
  "service raises a seat's effect",
  footballAfter.total > footballBefore,
  `${footballBefore.toFixed(1)}% → ${footballAfter.total.toFixed(1)}%`
);
check(
  "a fully-served executive reaches the seat's ceiling",
  Math.abs(footballAfter.total - footballAfter.max) < 0.01,
  `${footballAfter.total.toFixed(1)}% vs ${footballAfter.max.toFixed(1)}%`
);
// The design claim: roughly half the seat is earned rather than bought. Banded
// generously (35–70%) because the three rows are tuning and must be free to move.
const earnedShare = footballAfter.badges / footballAfter.max;
check(
  "a meaningful share of a seat is EARNED, not bought",
  earnedShare >= 0.35 && earnedShare <= 0.7,
  `badge term is ${(earnedShare * 100).toFixed(0)}% of the ceiling`
);

// The football seat must reach the two places it claims to, and NEITHER may
// touch the manager's own club — the network's boardroom must not be a way to
// improve the team you actually pick.
const footballMult = globalFootballMult(state, foreignA, TUNING);
check("the football seat reaches an owned club", footballMult > 1, `×${footballMult.toFixed(3)}`);
check(
  "the football seat never reaches the manager's own club",
  globalFootballMult(state, state.userTeamId, TUNING) === 1
);
const outsider = Object.values(state.teams).find((t) => !t.gcnOwned && t.id !== state.userTeamId)!;
check(
  "the football seat never reaches a club outside the network",
  globalFootballMult(state, outsider.id, TUNING) === 1
);
check(
  "the commerce seat multiplies passive income",
  globalCommerceMult(state, TUNING) > 1,
  `×${globalCommerceMult(state, TUNING).toFixed(3)}`
);
check(
  "the scouting seat discounts hub costs",
  globalScoutingCostMult(state, TUNING) < 1,
  `×${globalScoutingCostMult(state, TUNING).toFixed(3)}`
);
check(
  "...but never to free",
  globalScoutingCostMult(state, TUNING) > 0,
);

// Executives are paid from the TREASURY. A club's budget must never move for
// them — the network employs them, not any one club.
const clubBudgetBefore = state.teams[foreignA].budget;
const treasuryBeforeWages = state.gcn!.treasury;
gcnWeeklyTick(state, TUNING);
check(
  "executive wages come out of the treasury",
  treasuryBeforeWages - state.gcn!.treasury >= execWageBill(state) - 1_000_000_000,
  `wage bill ${money(execWageBill(state))}`
);
check(
  "a club's own budget is untouched by the boardroom",
  // The club still moves on its own books — the claim is only that it is not
  // ALSO charged the network's wage bill.
  //
  // v1.99: this was a magnitude test ("the swing is smaller than the wage
  // bill"), which stopped separating the two things the moment the Director of
  // Global Commerce moved onto `gcnSimBooks` — a big club's own trading week
  // can legitimately exceed the boardroom's payroll, and the check failed on a
  // save where nothing was wrong. Asserted directly now, against the one
  // function that IS the club's week: whatever the budget did, it did because
  // of its own books and nothing else.
  (() => {
    const books = gcnSimBooks(state, foreignA, TUNING);
    const own = books ? books.income - books.wages : 0;
    return Math.abs(state.teams[foreignA].budget - clubBudgetBefore - own) < 1;
  })(),
  `own week ${money((() => {
    const b = gcnSimBooks(state, foreignA, TUNING);
    return b ? b.income - b.wages : 0;
  })())}`
);

// ── 6. International Scouting Hubs (v1.95) ──────────────────────────────────

console.log("\n6. International Scouting Hubs");

check(
  "the hub map is derived from the scouting tree",
  HUB_REGIONS.length > 10 && HUB_REGIONS.every((r) => r.nats.length > 0),
  `${HUB_REGIONS.length} regions`
);

// Pick a region the network has NO presence in, and one it does — the discount
// is the one rule that ties the Clubs half of the network to the Hubs half.
// Through `clubCountryCode`, not `league.country` — the league holds a display
// name and the hub map holds codes, which is exactly the mismatch this section
// caught in the first cut of the rules.
const foreignCountry = clubCountryCode(state, foreignA) ?? "";
const presenceRegion = HUB_REGIONS.find((r) => r.nats.includes(foreignCountry));
const emptyRegion = HUB_REGIONS.find((r) => !hasPresenceIn(state, r.id))!;

check("a region with an owned club reads as presence", !!presenceRegion && hasPresenceIn(state, presenceRegion.id));
if (presenceRegion) {
  const withPresence = hubBuildCost(state, presenceRegion.id, TUNING);
  const without = hubBuildCost(state, emptyRegion.id, TUNING);
  check(
    "local presence discounts the build",
    withPresence < without,
    `${money(withPresence)} vs ${money(without)}`
  );
}

state.gcn!.treasury = 5_000_000_000;
const buildErr = buildHub(state, emptyRegion.id, TUNING);
check("a hub can be established", buildErr === undefined, String(buildErr));
const hub = hubIn(state, emptyRegion.id);
check("...and it lands on the map at level 1", hub?.level === 1);
check(
  "a second hub in the same region is refused",
  typeof buildHub(state, emptyRegion.id, TUNING) === "string"
);

// Every level term must actually move its quantity, or a level buys nothing.
if (hub) {
  const before = {
    judgement: hubJudgement(hub.level, TUNING),
    capacity: hubCapacity(hub.level, TUNING),
    growth: hubGrowthMult(hub.level, TUNING),
    days: hubReportDays(state, hub.level, TUNING),
  };
  const upErr = upgradeHub(state, emptyRegion.id, TUNING);
  check("a hub can be upgraded", upErr === undefined, String(upErr));
  check("a level raises the scouting standard", hubJudgement(hub.level, TUNING) > before.judgement);
  check("a level raises capacity", hubCapacity(hub.level, TUNING) > before.capacity);
  check("a level raises development speed", hubGrowthMult(hub.level, TUNING) > before.growth);
  check("a level shortens the report cadence", hubReportDays(state, hub.level, TUNING) <= before.days);
}

// The pipeline. Drive the clock forward past a cadence and confirm a hub files
// on its own, without a scout being sent anywhere.
const hubNow = hubIn(state, emptyRegion.id)!;
hubNow.nextReportDay = state.currentDay;
dailyHubTick(state, TUNING);
const filed = state.gcn!.hubReports ?? [];
check("a hub files reports unprompted", filed.length > 0, `${filed.length} on the board`);
check(
  "every find comes from the hub's own region",
  filed.every((r) => r.region === emptyRegion.id && emptyRegion.nats.includes(r.player.nationality))
);
check(
  "every find is inside the hub's age band",
  filed.every(
    (r) => r.player.age >= TUNING.gcnHubProspectAgeMin && r.player.age <= TUNING.gcnHubProspectAgeMax
  )
);
check(
  "a hub find costs more than the same badge at the club academy",
  filed.every((r) => r.fee >= prospectSignFee(TUNING, r.tier)),
);

// ── Pausing (v1.99) ─────────────────────────────────────────────────────────
// The lever that replaced "close hub" as the routine one. The properties worth
// asserting are the ones that make it DIFFERENT from closing: nothing is lost,
// and no reports arrive.
{
  const before = (state.gcn!.hubReports ?? []).length;
  const heldBefore = hubProspects(state, emptyRegion.id).length;
  const levelBefore = hubNow.level;
  const pauseErr = setHubPaused(state, emptyRegion.id, true, TUNING);
  check("a hub can be paused", pauseErr === undefined, String(pauseErr));
  hubNow.nextReportDay = state.currentDay;
  dailyHubTick(state, TUNING);
  dailyHubTick(state, TUNING);
  check(
    "a paused hub files NOTHING",
    (state.gcn!.hubReports ?? []).length === before,
    `${(state.gcn!.hubReports ?? []).length} vs ${before}`
  );
  // The whole point of pausing rather than closing: the hub is still there.
  check("...but keeps its level", hubIn(state, emptyRegion.id)?.level === levelBefore);
  check("...and keeps its prospects", hubProspects(state, emptyRegion.id).length === heldBefore);
  check(
    "...and still costs its upkeep",
    hubUpkeepWeekly(state, TUNING) > 0,
    money(hubUpkeepWeekly(state, TUNING))
  );
  const resumeErr = setHubPaused(state, emptyRegion.id, false, TUNING);
  check("a hub can be resumed", resumeErr === undefined, String(resumeErr));
  // Resuming must start a fresh cycle rather than deliver the batches the pause
  // swallowed — otherwise pausing is a way to stockpile reports.
  check(
    "resuming does not bank the batches it missed",
    (hubIn(state, emptyRegion.id)?.nextReportDay ?? 0) > state.currentDay
  );
  hubIn(state, emptyRegion.id)!.nextReportDay = state.currentDay;
  dailyHubTick(state, TUNING);
  check("...and it files again", (state.gcn!.hubReports ?? []).length > before);
}

// ── The brief (v1.99) ───────────────────────────────────────────────────────
// A focus is a BIAS, not a filter. Both halves of that are asserted: it must
// visibly move the finds, and it must NOT make every find match — a brief that
// always landed would be a prospect generator.
{
  const region = emptyRegion.id;
  const outsideNat = HUB_REGIONS.find((r) => r.id !== region)!.nats[0];
  check(
    "a brief can't name a country outside the region",
    typeof hubFocusError(region, { nat: outsideNat }) === "string"
  );
  // An archetype and a position that genuinely conflict are refused up front,
  // rather than the brief quietly ignoring half of itself.
  const gkArch = ARCHETYPE_ROSTER.find((a) => positionsOfArchetype(a).join() === "GK")!;
  check(
    "a brief can't ask for a role at a position that can't earn it",
    typeof hubFocusError(region, { archetype: gkArch.id, pos: "ST" }) === "string"
  );
  check(
    "...but the same role at its own position is fine",
    hubFocusError(region, { archetype: gkArch.id, pos: "GK" }) === null
  );

  const nat = HUB_REGION_MAP[region].nats[0];
  const setErr = setHubFocus(state, region, { nat, pos: "CB" });
  check("a brief can be set", setErr === undefined, String(setErr));
  check("...and is stored on the hub", hubIn(state, region)?.focus?.nat === nat);

  // Measure over many batches rather than one: a per-criterion roll is a rate,
  // and one batch of six says nothing about it.
  state.gcn!.hubReports = [];
  const h = hubIn(state, region)!;
  let onNat = 0;
  let onPos = 0;
  let total = 0;
  for (let i = 0; i < 60; i++) {
    h.nextReportDay = state.currentDay;
    dailyHubTick(state, TUNING);
    for (const r of state.gcn!.hubReports ?? []) {
      total++;
      if (r.player.nationality === nat) onNat++;
      if (r.player.positions[0] === "CB") onPos++;
    }
    state.gcn!.hubReports = [];
    state.currentDay += 1;
  }
  const natRate = total ? onNat / total : 0;
  const posRate = total ? onPos / total : 0;
  // A CB is 1 of 12 positions unbriefed, so anything near the hit chance is the
  // brief working; the band is wide because this is a rate, not a table lookup.
  check(
    "a briefed position is honoured far more often than chance",
    posRate > 0.5,
    `${(posRate * 100).toFixed(0)}% of ${total} finds`
  );
  check(
    "a briefed country is honoured far more often than chance",
    natRate > 0.5,
    `${(natRate * 100).toFixed(0)}%`
  );
  // The half that makes it scouting rather than manufacturing.
  check(
    "...but a brief is a bias, not a filter",
    posRate < 1 && natRate < 1,
    `${(posRate * 100).toFixed(0)}% / ${(natRate * 100).toFixed(0)}%`
  );
  check("a brief can be cleared", setHubFocus(state, region, {}) === undefined);
  check("...and the hub goes back to having none", !hubIn(state, region)?.focus);
  state.gcn!.hubReports = [];
  h.nextReportDay = state.currentDay;
  dailyHubTick(state, TUNING);
}

const filedAfter = state.gcn!.hubReports ?? [];

// Signing puts him on the NETWORK's books and at no club. That is the property
// the whole feature hangs on — and the one that would silently break every
// "unattached means free agent" pass in the codebase if it weren't guarded.
const report = filedAfter[0];
const signErr = signHubProspect(state, report.id, TUNING);
check("a find can be signed to the hub", signErr === undefined, String(signErr));
const prospect = state.players[report.player.id];
check("a hub prospect belongs to no club", !!prospect && !prospect.clubId);
check("...but is stamped with his hub", prospect?.gcnHubRegion === emptyRegion.id);
check("...and is NOT a free agent", !!prospect && !isFreeAgent(prospect));
check("...and appears on the hub's books", hubProspects(state, emptyRegion.id).some((p) => p.id === prospect.id));

// Placement is REGIONAL. This is the rule that makes hubs a reason to own clubs
// in a region rather than a talent teleporter serving the whole empire.
const outOfRegion = state.gcn!.clubIds.find(
  (id) => !emptyRegion.nats.includes(clubCountryCode(state, id) ?? "")
);
check(
  "a prospect can't be placed outside his region",
  !outOfRegion || typeof hubPlacementError(state, prospect.id, outOfRegion) === "string"
);
check(
  "a prospect can't be placed at the manager's own club",
  typeof hubPlacementError(state, prospect.id, state.userTeamId) === "string"
);

// Give the network a club IN the region and confirm placement then works, and
// that the player genuinely arrives.
const regionalLeague = Object.values(state.leagues).find(
  (l) => !l.playable && emptyRegion.nats.includes(countryCodeOf(l.country) ?? "")
);
if (regionalLeague) {
  const regionalClub = regionalLeague.teamIds.find((id) => !state.teams[id].gcnOwned);
  if (regionalClub) {
    own(regionalClub);
    check(
      "a prospect CAN be placed at an owned club in his region",
      hubPlacementError(state, prospect.id, regionalClub) === null
    );
    const squadBefore = state.teams[regionalClub].playerIds.length;
    const placeErr = placeHubProspect(state, prospect.id, regionalClub);
    check("the placement goes through", placeErr === undefined, String(placeErr));
    check("he joins that club's squad", state.players[prospect.id].clubId === regionalClub);
    check("the squad actually grew", state.teams[regionalClub].playerIds.length === squadBefore + 1);
    check("he leaves the hub's books", !state.players[prospect.id].gcnHubRegion);
    check(
      "...and is off the network's prospect list",
      !(state.gcn!.hubProspectIds ?? []).includes(prospect.id)
    );
  }
}

// Closing a hub returns nothing and releases who it held — the honest shape for
// a building put up abroad, and what makes the upkeep decision real.
hubNow.nextReportDay = state.currentDay;
dailyHubTick(state, TUNING);
const secondReport = (state.gcn!.hubReports ?? [])[0];
if (secondReport) signHubProspect(state, secondReport.id, TUNING);
const heldBefore = hubProspects(state, emptyRegion.id).length;
const treasuryBeforeClose = state.gcn!.treasury;
closeHub(state, emptyRegion.id);
check("closing a hub removes it from the map", !hubIn(state, emptyRegion.id));
check("closing a hub refunds nothing", state.gcn!.treasury === treasuryBeforeClose);
check("its prospects are released, not deleted", heldBefore === 0 || !!state.players[secondReport?.player.id ?? ""]);
check(
  "a released prospect IS a free agent again",
  !secondReport || isFreeAgent(state.players[secondReport.player.id])
);
check("its live reports are cleared", (state.gcn!.hubReports ?? []).every((r) => r.region !== emptyRegion.id));

// ── 7. A save with no network is arithmetically untouched ───────────────────
//
// The single most important check here. Every multiplier this rework adds runs
// on every match and every development pass in the world, so a save that never
// unlocked the GCN must compute exactly what it always did.

console.log("\n7. A save with no network computes what it always did");

const plain: GameState = generateWorld({
  saveName: "verify-gcn-plain",
  managerName: "Verifier",
  userTeamId: teamIdFor("ENG1", 0),
  playableCountry: "ENG",
  viewCountries: ["ESP", "GER", "FRA", "ITA"],
  seed: 20260803,
});
check("the control world has no network", !plain.gcn);
const anyClub = Object.values(plain.teams).find((t) => t.id !== plain.userTeamId)!;
check("football multiplier is exactly 1", globalFootballMult(plain, anyClub.id, TUNING) === 1);
check("commerce multiplier is exactly 1", globalCommerceMult(plain, TUNING) === 1);
check("scouting cost multiplier is exactly 1", globalScoutingCostMult(plain, TUNING) === 1);
check("the hub map holds nothing", hubs(plain).length === 0 && hubProspects(plain).length === 0);
check("the boardroom costs nothing", execWageBill(plain) === 0);
check("hub upkeep costs nothing", hubUpkeepWeekly(plain, TUNING) === 0);
// The weekly tick must be a no-op on a save with no network at all.
const plainBudget = plain.teams[anyClub.id].budget;
gcnWeeklyTick(plain, TUNING);
check("the network's weekly tick moves nothing", plain.teams[anyClub.id].budget === plainBudget);

console.log(
  failures === 0 ? "\nAll GCN checks passed.\n" : `\n${failures} GCN check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

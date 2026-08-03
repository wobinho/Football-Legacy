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

console.log(
  failures === 0 ? "\nAll GCN checks passed.\n" : `\n${failures} GCN check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

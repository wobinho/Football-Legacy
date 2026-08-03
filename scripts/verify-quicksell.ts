// Verifies the academy quick sell (v1.87) against the one property that makes it
// worth having as a separate route: the prospect LEAVES THE WORLD.
//
// The ordinary sale is well covered by scripts/smoke.ts. What that can't check is
// the thing quick-sell exists for — that no rival club is handed a player they
// never chose, and that erasing a live player doesn't leave the save full of
// dangling ids that render as blank rows a season later. Both are invisible in
// the code and only show up when a real world is driven into the state.
//
// Run: npx tsx scripts/verify-quicksell.ts

import { generateWorld } from "../lib/worldgen";
import { advanceUntilEvent } from "../lib/gameloop";
import { TUNING } from "../lib/config/tuning";
import { academyPlayers, quickSellQuote, quickSellFromAcademy } from "../lib/academy";
import { saleSuitors } from "../lib/transfers";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const state = generateWorld({
  saveName: "quicksell",
  managerName: "Quick Sell Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 4242,
});

// Roll forward until a window is open and some club would genuinely bid for one
// of our prospects. A quote of zero is a legitimate state (nobody wants him), so
// the test has to wait for a real one rather than assert on the first prospect.
console.log("\nFinding a quick-sellable prospect");
let targetId: string | null = null;
let quote = { fee: 0, bestFee: 0, from: null as string | null };
for (let i = 0; i < 500 && !targetId; i++) {
  advanceUntilEvent(state);
  for (const p of academyPlayers(state)) {
    const q = quickSellQuote(state, p.id, TUNING);
    if (q.fee > 0) {
      targetId = p.id;
      quote = q;
      break;
    }
  }
}
if (!targetId) {
  console.log("  ✗ no prospect drew an offer in 500 advances — cannot run the checks");
  process.exit(1);
}

const target = targetId;
const player = state.players[target];
const team = state.teams[state.userTeamId];
console.log(`  ✓ ${player.name} (${player.age}y, ${player.overall} OVR)`);
console.log(`    best offer £${quote.bestFee.toLocaleString()} from ${quote.from} → quote £${quote.fee.toLocaleString()}`);

console.log("\nThe price");
check(
  `the quote is ${TUNING.quickSellShareOfBestOffer * 100}% of the best offer`,
  quote.fee === Math.round(quote.bestFee * TUNING.quickSellShareOfBestOffer),
  `${quote.fee} vs ${Math.round(quote.bestFee * TUNING.quickSellShareOfBestOffer)}`
);
check(
  "a quick sell always pays less than placing him properly",
  quote.fee < quote.bestFee,
  `${quote.fee} vs ${quote.bestFee}`
);
check(
  "the quote reads off the same suitor model the Sell chooser shows",
  quote.bestFee === saleSuitors(state, target, TUNING)[0]?.fee
);

// Snapshot everything the sale has to move or leave alone.
const budgetBefore = team.budget;
const worldBefore = Object.keys(state.players).length;
const buyer = Object.values(state.teams).find((t) => t.name === quote.from)!;
const buyerSquadBefore = [...buyer.playerIds];

const err = quickSellFromAcademy(state, target, TUNING);

console.log("\nThe sale");
check("the quick sell succeeded", err === null, err ?? "");
check("budget credited by exactly the quote", team.budget === budgetBefore + quote.fee, `+${team.budget - budgetBefore}`);

console.log("\nThe player is gone from the world");
check("the player record is deleted", state.players[target] === undefined);
check("his career record is deleted", state.careers[target] === undefined);
check("the world holds exactly one fewer player", Object.keys(state.players).length === worldBefore - 1);
check("off the academy list", !(team.academyPlayerIds ?? []).includes(target));
check("off the senior list", !team.playerIds.includes(target));
check("off the focus list", !state.academy.focusIds.includes(target));
check("off the U21 squad", !(state.academy.u21Squad ?? []).includes(target));
check("off the U21 registration", !(state.academy.u21.registered ?? []).includes(target));
check("off the loan list", !state.academy.loanList.includes(target));
check("out of the lineup", !Object.values(state.lineup ?? {}).includes(target));

// THE point of the feature. A release or an ordinary sale puts him somewhere;
// this must put him nowhere, so the buyer's squad is byte-identical.
console.log("\nNo club was handed a player they never chose");
check("the interested club did not receive him", !buyer.playerIds.includes(target));
check(
  "the interested club's squad is completely unchanged",
  buyer.playerIds.length === buyerSquadBefore.length && buyer.playerIds.every((id, i) => id === buyerSquadBefore[i])
);
check(
  "no club anywhere in the world holds his id",
  Object.values(state.teams).every(
    (t) => !t.playerIds.includes(target) && !(t.academyPlayerIds ?? []).includes(target)
  )
);

// A dangling id renders as a blank row months later, which is exactly the class
// of bug a full-state scan catches and a targeted check doesn't.
console.log("\nNothing dangling in the save");
const json = JSON.stringify(state);
check("the id appears nowhere in the serialised state", !json.includes(target), "id still present");

console.log("\nThe loop survives it");
let ok = true;
try {
  for (let i = 0; i < 120; i++) advanceUntilEvent(state);
} catch (e) {
  ok = false;
  console.log(`    ${e}`);
}
check("120 further advances, including a rollover, run clean", ok);

console.log(
  failures === 0 ? "\nAll quick-sell checks passed.\n" : `\n${failures} check(s) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);

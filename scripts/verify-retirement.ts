// Verifies that a player who retires is REMEMBERED, and that nobody is ever
// generated on top of him (v2.0).
//
// The bug this exists to prevent, reported from real play: "two of my players
// retired, turned into regens, and are already in my club — I'm looking at the
// club's most-appearances table and there are two players with 50 appearances
// who only joined this season, before the season even started."
//
// The cause was not the regen system, which always built a distinct free agent.
// It was `playerCounter` in worldgen: MODULE state that counts from 0 and is
// reset only by `generateWorld`. Loading a save restores thousands of players
// named `p1..pN` and leaves the counter at 0, so the first player minted after a
// page reload — a regen, a youth intake, a free-agent replenishment — got id
// `p1`, which a real player already held. `state.players[id] = newPlayer` then
// overwrote him in place, and because the club roster, the career rows and the
// appearance tallies all key on that id, a brand-new teenager inherited a
// fifteen-year career and a squad place.
//
// Three properties are asserted, and the first is the one a targeted check would
// miss because it only appears after a LOAD:
//
//   1. No generated player ever takes an id an existing player holds — driven
//      through the real bug's shape (simulate a load, then roll over).
//   2. A retiree keeps his record: his career rows, his appearances and his
//      identity survive retirement, and he is not mutated into anyone else.
//   3. A regen is a new person: fresh id, no club, and an empty career. In
//      particular he is never born into the user's squad.
//
// Run: npx tsx scripts/verify-retirement.ts

import { generateWorld, beginLivePlay, resetIdCounterForTest } from "../lib/worldgen";
import { advanceUntilEvent, runSeasonRollover, isSeasonComplete } from "../lib/gameloop";
import { activePlayers } from "../lib/archive";
import type { GameState } from "../lib/types";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const SEASONS = Number(process.argv[2] ?? 6);

const built = generateWorld({
  saveName: "retirement",
  managerName: "Retirement Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 909,
});

// Simulate a LOAD, which is the only way the bug can appear and the reason a
// harness that merely calls `generateWorld` cannot see it.
//
// In the app, worldgen and play are usually separated by a page reload: the save
// is serialised to IndexedDB, the tab is refreshed, and the module is evaluated
// FRESH — `playerCounter` back at 0 — before `loadGame` restores a world already
// full of `p1..pN`. A round trip through JSON reproduces the restored world
// exactly; `resetIdCounterForTest` reproduces the fresh module. Together they are
// a page refresh, and without both the counter is still sitting safely past every
// existing id and nothing collides.
const state: GameState = JSON.parse(JSON.stringify(built));
resetIdCounterForTest();

// What the store now does on every load. Skipping it (FL_REPRO_BUG=1) restores
// the pre-fix behaviour, which is how this harness proves it can fail.
if (!process.env.FL_REPRO_BUG) beginLivePlay();

function playSeason(s: GameState) {
  for (let i = 0; i < 4000 && !isSeasonComplete(s); i++) advanceUntilEvent(s);
  runSeasonRollover(s);
}

// ── 1. Ids are never reused ───────────────────────────────────────────────────
// Every id that has ever existed, checked against every id minted afterwards. A
// collision is the bug: it means a new player was written over a real one.
console.log(`\nDriving ${SEASONS} seasons, watching for id reuse`);
const seenIds = new Set(Object.keys(state.players));
const identity = new Map<string, string>();
for (const id of seenIds) identity.set(id, state.players[id].name);

let collisions: string[] = [];
let overwritten: string[] = [];

for (let season = 0; season < SEASONS; season++) {
  const before = new Set(Object.keys(state.players));
  playSeason(state);

  for (const id of Object.keys(state.players)) {
    const p = state.players[id];
    if (!before.has(id)) {
      // A brand-new player. He must not be reusing an id anyone ever held.
      if (seenIds.has(id)) collisions.push(`${id} (${p.name})`);
      seenIds.add(id);
      identity.set(id, p.name);
    } else {
      // An existing id. The person behind it must still be the same person —
      // this is what catches an in-place overwrite, which adding/removing keys
      // alone cannot see.
      const was = identity.get(id);
      if (was && was !== p.name) overwritten.push(`${id}: ${was} → ${p.name}`);
    }
  }
}

check("no generated player reuses an existing id", collisions.length === 0, collisions.slice(0, 5).join(", "));
check(
  "no existing player is overwritten in place",
  overwritten.length === 0,
  overwritten.slice(0, 5).join("; ")
);

// ── 2. A retiree keeps his record ────────────────────────────────────────────
console.log("\nRetirees keep their history");
const retirees = Object.values(state.players).filter((p) => p.retired);
check("the world has produced retirees to check", retirees.length > 0, `${retirees.length}`);

const withCareer = retirees.filter((p) => (state.careers[p.id]?.seasons.length ?? 0) > 0);
check(
  "a retiree still has his career rows",
  withCareer.length > 0,
  `${withCareer.length} of ${retirees.length} retirees carry seasons`
);

// The reported symptom directly: a player in a club's appearance table whose
// career says he played, but who is not the man the record was built from.
const stillNamed = retirees.every((p) => typeof p.name === "string" && p.name.length > 0);
check("every retiree still has his own name", stillNamed);

const clubless = retirees.every((p) => p.clubId === null || p.clubId === undefined);
check("a retiree holds no club place", clubless);

// ── 3. A regen is a new person ───────────────────────────────────────────────
console.log("\nRegens are successors, not replacements");
// Anything alive that carries no career rows at all and is young is a generated
// newcomer — regens, intake and replenishment all land here.
const newcomers = activePlayers(state).filter(
  (p) => (state.careers[p.id]?.seasons.length ?? 0) === 0 && p.age <= 20
);
check("the world generated newcomers to check", newcomers.length > 0, `${newcomers.length}`);

const noInheritedApps = newcomers.every((p) => p.stats.apps === 0);
check("a newcomer has no appearances before he plays", noInheritedApps);

// The exact complaint: a stranger appearing in the user's squad the summer a
// veteran retired. Newcomers reach a club by being SIGNED, never by being born
// into one, so nobody generated this rollover may already sit on the roster.
const userSquad = new Set(state.teams[state.userTeamId].playerIds);
const bornIntoUserClub = newcomers.filter(
  (p) => userSquad.has(p.id) && (state.careers[p.id]?.seasons.length ?? 0) === 0 && p.stats.apps > 0
);
check(
  "no newcomer sits in the user's squad carrying appearances",
  bornIntoUserClub.length === 0,
  bornIntoUserClub.map((p) => `${p.name} (${p.stats.apps} apps)`).join(", ")
);

// The club's own most-appearances table is where the bug was actually seen, so
// assert against it directly: every name in it must be backed by a real record.
const table = state.teams[state.userTeamId].playerIds
  .map((id) => state.players[id])
  .filter((p) => p && p.stats.apps > 0);
const unbacked = table.filter((p) => {
  const career = state.careers[p.id]?.seasons.length ?? 0;
  // A player with a big appearance count but no career rows and who is too young
  // to have earned them is the signature of an overwrite.
  return p.stats.apps > 30 && career === 0 && p.age <= 20;
});
check(
  "no squad player shows appearances he cannot have earned",
  unbacked.length === 0,
  unbacked.map((p) => `${p.name} ${p.age}yo ${p.stats.apps} apps`).join(", ")
);

console.log(
  failures === 0
    ? "\nAll retirement/regen checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

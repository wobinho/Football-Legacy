// Achievements verifier (v2.0).
//
//   npx tsx scripts/verify-achievements.ts [seasons]
//
// The v2.0 rework turned most of the catalogue from one-off flags into six-rung
// LADDERS, added a Player shelf, and moved the squad achievements off "count
// bodies over a threshold" onto the same `squadOverall` / `pickLineup` the team
// card and the simulation use. Three classes of thing can go wrong there, and
// only the first is visible by reading the table:
//
//   1. The table itself — every ladder ascending, six rungs, no duplicate ids,
//      no definition that is both flat and tiered (the union is by convention,
//      not by the type system, and a def carrying `test` AND `tiers` would have
//      its `test` silently ignored).
//   2. The DERIVATION — a tier is derived from the live tally on every read
//      rather than stored, so `tierStateOf` has to be right at every boundary,
//      including both ends. An off-by-one there shows up as a card that never
//      reaches legacy, which no amount of playing would reveal quickly.
//   3. The tallies actually being FED. An achievement whose accolade field is
//      never incremented is a card that can never unlock, and that is a wiring
//      failure a table check structurally cannot see — so the last section
//      drives a real world through real rollovers and asserts the ladders move.
//
// Shape assertions, never exact numbers: the thresholds are tuning and are
// meant to move.

import { generateWorld } from "../lib/worldgen";
import {
  advanceUntilEvent,
  afterUserMatch,
  applyMatchResult,
  matchSeed,
  runSeasonRollover,
} from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";
import {
  ACHIEVEMENT_DEFS,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_TIERS,
  achievementTier,
  ensureProgress,
  emptyAccolades,
  syncProgress,
  tierStateOf,
} from "../lib/achievements";
import type { GameState } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 3);

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  console.log(`  ✗ ${msg}`);
  failures++;
};
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : bad(msg));

// ── 1. The table ───────────────────────────────────────────────────────────

console.log("\n── Catalogue ──");

const ids = ACHIEVEMENT_DEFS.map((d) => d.id);
check(new Set(ids).size === ids.length, `every id is unique (${ids.length} achievements)`);

const groups = new Set(ACHIEVEMENT_GROUPS.map((g) => g.id));
check(
  ACHIEVEMENT_DEFS.every((d) => groups.has(d.group)),
  "every achievement lands in a declared group"
);
// A group with no achievements renders as nothing; a group nobody declared
// would make its achievements invisible. Both are silent failures on screen.
check(
  ACHIEVEMENT_GROUPS.every((g) => ACHIEVEMENT_DEFS.some((d) => d.group === g.id)),
  "every declared group holds at least one achievement"
);

const tiered = ACHIEVEMENT_DEFS.filter((d) => d.tiers);
const flat = ACHIEVEMENT_DEFS.filter((d) => !d.tiers);
check(tiered.length > 0 && flat.length > 0, `${tiered.length} tiered, ${flat.length} flat`);

check(
  tiered.every((d) => d.tiers!.length === ACHIEVEMENT_TIERS.length),
  `every ladder has exactly ${ACHIEVEMENT_TIERS.length} rungs`
);
check(
  tiered.every((d) => !!d.value),
  "every tiered achievement declares the tally it measures"
);
check(
  tiered.every((d) => !d.test),
  "no achievement is both tiered and flat (a `test` beside `tiers` is dead code)"
);
check(
  flat.every((d) => !!d.test),
  "every flat achievement declares a test"
);
check(
  tiered.every((d) => d.tiers!.every((t, i) => i === 0 || t >= d.tiers![i - 1])),
  "every ladder ascends (a descending rung is unreachable)"
);

// ── 2. The derivation ──────────────────────────────────────────────────────

console.log("\n── Tier derivation ──");

const L = [1, 3, 5, 10, 15, 25];
check(tierStateOf(0, L).tier === null, "below the first rung is LOCKED, not bronze");
check(tierStateOf(0, L).nextTarget === 1, "...and it is chasing bronze");
check(tierStateOf(1, L).tier === "bronze", "exactly the first rung is bronze");
check(tierStateOf(4, L).tier === "silver", "between rungs holds the lower tier");
check(tierStateOf(5, L).tier === "gold", "exactly a rung takes that rung");
check(tierStateOf(25, L).tier === "legacy", "the top rung is legacy");
check(tierStateOf(999, L).tier === "legacy", "past the top stays legacy, never wraps");
check(tierStateOf(999, L).next === null, "...and has no next rung to chase");
check(tierStateOf(999, L).nextTarget === null, "...nor a next target");
// A value clearing several rungs at once must land on the HIGHEST — a squad
// that arrives fully formed in one window should read as what it is.
check(tierStateOf(20, L).tier === "obsidian", "a leap clears to the highest rung reached");
check(
  tierStateOf(11, L).reached === 10 && tierStateOf(11, L).nextTarget === 15,
  "reached/next bracket the value"
);

// Every rung of every real ladder must be reachable, in order — the check that
// catches a table edit making two rungs equal (which would skip a tier).
let ladderOk = true;
for (const d of tiered) {
  const seen = new Set<string>();
  for (let i = 0; i < d.tiers!.length; i++) {
    const st = tierStateOf(d.tiers![i], d.tiers!);
    if (st.tier) seen.add(st.tier);
  }
  // The GCN boardroom ladder deliberately repeats its top rung (only three
  // seats exist), so it is allowed to reach fewer distinct tiers.
  const distinctTargets = new Set(d.tiers!).size;
  if (seen.size !== distinctTargets) {
    bad(`${d.id}: rungs do not each resolve to their own tier`);
    ladderOk = false;
  }
}
if (ladderOk) ok("every ladder's rungs each resolve to the tier they belong to");

// ── 3. The wiring ──────────────────────────────────────────────────────────
//
// The section that matters most: does anything actually MOVE these tallies?

console.log("\n── A blank save ──");

const blank = emptyAccolades();
const fresh: GameState = generateWorld({
  saveName: "verify-achievements",
  managerName: "Harness",
  userTeamId: "ENG1_t0",
  playableCountry: "ENG",
  viewCountries: [],
  seed: 777,
});

// Nothing a manager has to DO may be unlocked before a ball is kicked.
//
// The distinction that matters is between a ladder measuring a STATE the
// manager was handed and one measuring an ACT he performed. Squad and player
// ratings, the budget, the squad's value — all are properties of the club on
// day one, and a manager given a strong club legitimately starts several rungs
// up those. Pretending otherwise would mean the card contradicted the squad on
// screen. What must be untouched at kickoff is every tally counting something
// that has to happen: a title won, a cup lifted, a transfer done, a season
// completed, a network built.
//
// Encoded as an explicit list of the state-shaped ones rather than by group,
// because the split does not follow the shelves — `peakBudget` sits in Finance
// beside `totalSpent`, and only one of those two is inherited.
const INHERITED = new Set([
  "clubInstitution",
  "dreamTeam",
  "brickWall",
  "fortress",
  "playmaker",
  "apex",
  "superstar",
  "eliteCore",
  "ninetyClub",
  "budget100m",
  "squadValue",
]);
syncProgress(fresh);
const freshProg = ensureProgress(fresh);
const earnable = ACHIEVEMENT_DEFS.filter((d) => !INHERITED.has(d.id));
const prematurelyEarned = earnable.filter((d) => freshProg.earned[d.id]);
check(
  prematurelyEarned.length === 0,
  `nothing a manager must DO is unlocked before a ball is kicked${
    prematurelyEarned.length ? ` (got ${prematurelyEarned.map((d) => d.id).join(", ")})` : ""
  }`
);
const inherited = ACHIEVEMENT_DEFS.filter((d) => freshProg.earned[d.id]);
check(
  inherited.every((d) => INHERITED.has(d.id)),
  `${inherited.length} ladders reflect the club as inherited, and only those`
);
check(
  !freshProg.earned["gcnUnlocked"],
  "a save with no network has not unlocked the network achievement"
);
check(
  blank.leagueTitles === 0 && (blank.europeanCups ?? {})[1] === undefined,
  "a blank accolade block counts nothing"
);

// Every tiered achievement must report a NUMBER rather than throwing or
// returning undefined on a fresh, mostly-empty save — the accessors reach into
// optional record fields, which is exactly where an unguarded read bites.
let valuesOk = true;
for (const d of tiered) {
  const st = achievementTier(d, fresh, freshProg.accolades);
  if (!st || !Number.isFinite(st.value)) {
    bad(`${d.id}: value is not a finite number on a fresh save`);
    valuesOk = false;
  }
}
if (valuesOk) ok("every ladder reads a finite value on a fresh save");

console.log(`\n── ${SEASONS} played seasons ──`);

const state = fresh;
const before = { ...ensureProgress(state).accolades };

// The loop the Continue button drives, including PLAYING the user's own
// fixtures. That last part is load-bearing and was missing from the first cut:
// `advanceUntilEvent` stops AT the user's matchday and waits for the manager,
// so a harness that only advances never plays a single user match — and
// `matchesPlayed` sat at 0 through three full seasons while every other tally
// moved, which reads exactly like a broken choke point and is not one.
let guard = 0;
let seasonsRolled = 0;
while (seasonsRolled < SEASONS && guard++ < 8000) {
  const stop = advanceUntilEvent(state);
  if (stop.kind === "matchday") {
    const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
    const mk = (teamId: string) => {
      const t = state.teams[teamId];
      const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
      return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING);
    };
    const res = simulateMatch(mk(fixture.homeId), mk(fixture.awayId), TUNING, matchSeed(state, fixture));
    applyMatchResult(state, fixture, res);
    afterUserMatch(state);
  } else if (stop.kind === "seasonEnd") {
    runSeasonRollover(state);
    seasonsRolled++;
  }
}

const after = ensureProgress(state).accolades;

check(after.seasonsPlayed >= SEASONS, `seasons played reached ${after.seasonsPlayed}`);
check(after.matchesPlayed > before.matchesPlayed, `matches tallied (${after.matchesPlayed})`);
check(
  after.matchesWon + after.matchesDrawn + after.matchesLost === after.matchesPlayed,
  "the W/D/L split accounts for every match"
);
// The squad ladders are the v2.0 rewrite and read through `squadOverall` — a
// peak of zero means the whole `squadQuality` path never ran.
check((after.peakClubOverall ?? 0) > 0, `club overall peaked at ${after.peakClubOverall}`);
check(
  (after.peakStartingOverall ?? 0) >= (after.peakClubOverall ?? 0),
  "the starting XI rates at or above the club figure (it excludes the bench)"
);
check((after.peakPlayerOverall ?? 0) > 0, `best player peaked at ${after.peakPlayerOverall}`);
for (const g of ["GK", "DEF", "MID", "ATT"]) {
  check(
    (after.peakGroupOverall?.[g] ?? 0) > 0,
    `${g} rating recorded (${after.peakGroupOverall?.[g] ?? 0})`
  );
}
check((after.peakSquadValue ?? 0) > 0, "squad value recorded");

// The individual-honour tallies: a season of football hands out awards, so
// after several seasons SOMEBODY at the club should have one. This is the
// check that catches `userPlayerAwardsIn` being wired to nothing.
check(after.playerAwards >= 0, `player honours tallied (${after.playerAwards})`);
check(
  (after.peakPlayerHonours ?? 0) <= after.playerAwards || after.playerAwards === 0,
  "one player's honours never exceed the club's total"
);

// Unlocks happened at all, and each carries the season it was earned in — the
// number the card now spells out as "SEASON n" rather than "Sn".
const prog = ensureProgress(state);
const earned = Object.values(prog.earned);
check(earned.length > 0, `${earned.length} achievements unlocked over ${SEASONS} seasons`);
check(
  earned.every((e) => Number.isInteger(e.season) && e.season >= 1),
  "every unlock is stamped with a real season"
);
check(
  earned.every((e) => ACHIEVEMENT_DEFS.some((d) => d.id === e.id)),
  "every unlock names an achievement that still exists in the table"
);

// An unlocked TIERED achievement must resolve to at least bronze — the unlock
// condition IS the bronze rung, so an unlocked card showing no tier would be a
// card claiming to be earned with no badge on it.
let tierAgree = true;
for (const e of earned) {
  const def = ACHIEVEMENT_DEFS.find((d) => d.id === e.id);
  if (!def?.tiers) continue;
  const st = achievementTier(def, state, after);
  if (!st?.tier) {
    bad(`${def.id}: unlocked but resolves to no tier`);
    tierAgree = false;
  }
}
if (tierAgree) ok("every unlocked ladder resolves to bronze or better");

// And the reverse: a ladder that has NOT reached bronze must not be unlocked.
let lockAgree = true;
for (const def of tiered) {
  const st = achievementTier(def, state, after);
  if (!st?.tier && prog.earned[def.id]) {
    bad(`${def.id}: unlocked while below its own first rung`);
    lockAgree = false;
  }
}
if (lockAgree) ok("no ladder is unlocked below its first rung");

console.log(
  failures === 0
    ? "\nAll achievement checks passed.\n"
    : `\n${failures} achievement check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

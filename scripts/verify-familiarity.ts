// Squad familiarity (v2.1).
//   npm run verify:familiarity
//
// The feature's legitimacy rests on claims a table cannot show and clicking
// around cannot reveal, so each is measured here against a real generated world:
//
//   1. A save with NO familiarity record computes exactly what it always did.
//      The multiplier sits in `effectiveRating`, which runs for every player in
//      every match in the world, so "inert when absent" is the property that
//      lets it exist at all — and it is what makes a pre-v2.1 save need no
//      migration.
//   2. It is CENTRED, not a bonus. A club at `FAMILIARITY_CENTER` reads exactly
//      1, so the world's mean does not drift and `calibrate` is unmoved. The
//      obvious version — 0 is ×1 and it climbs — is a world-wide rating rise.
//   3. A change of system COSTS, proportional to how much changed, and the cost
//      is taken when the change is made rather than at the next kick-off.
//   4. Familiarity does not travel with a player. It is a relationship with a
//      squad and a system, and a signing must arrive knowing nothing.
//   5. Accrual is real: playing matches actually moves both tracks, through the
//      same `applyMatchResult` the game calls.

import { generateWorld } from "../lib/worldgen";
import {
  advanceUntilEvent,
  applyMatchResult,
  afterUserMatch,
  matchSeed,
  ensureUserLineup,
} from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { getFormation } from "../lib/config/formations";
import { completeTransfer } from "../lib/transfers";
import { TUNING } from "../lib/config/tuning";
import {
  FAMILIARITY_CENTER,
  FAMILIARITY_SWING,
  NEWCOMER_FAMILIARITY,
  applyTacticChange,
  bankMatchFamiliarity,
  combinedFamiliarity,
  familiarityMult,
  playerFamiliarity,
  pruneFamiliarity,
  retentionBetween,
  tacticFamiliarity,
  tacticSignature,
} from "../lib/familiarity";
import type { GameState, Tactic } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const state: GameState = generateWorld({
  saveName: "familiarity",
  managerName: "Fam",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP"],
  seed: 90210,
});

const userTeam = state.teams[state.userTeamId];
const baseTactic: Tactic = { ...userTeam.tactic };

// ── 1. Inert when absent ───────────────────────────────────────────────────
console.log("\n── 1. A club with no record is untouched ──────────────────────\n");

check(
  "a fresh world stores NO familiarity at all",
  Object.values(state.teams).every((t) => t.familiarity === undefined),
  `${Object.values(state.teams).filter((t) => t.familiarity).length} of ${Object.keys(state.teams).length} carry one`
);
check("familiarityMult() is exactly 1 with no record", familiarityMult(undefined, "p1", "slot1") === 1);
check(
  "…and exactly 1 for every player in every slot of a real XI",
  (() => {
    const shape = getFormation(userTeam.tactic.formationId);
    return userTeam.playerIds.every((pid) =>
      shape.slots.every((s) => familiarityMult(undefined, pid, s.id) === 1)
    );
  })()
);
check(
  "an unrecorded player reads as the CENTRE, not as a newcomer",
  playerFamiliarity(undefined, "p1", "slot1") === FAMILIARITY_CENTER
);

// ── 2. Centred, not a bonus ────────────────────────────────────────────────
console.log("\n── 2. It is centred, so the world's mean cannot drift ─────────\n");

const centred = { tactic: FAMILIARITY_CENTER, player: {}, signature: tacticSignature(baseTactic) };
check(
  "a club sitting exactly at the centre multiplies by exactly 1",
  near(familiarityMult(centred, "pX", "slot1"), 1),
  `${familiarityMult(centred, "pX", "slot1")}`
);

const fullySettled = {
  tactic: 1,
  player: { pX: { slot1: 1 } },
  signature: tacticSignature(baseTactic),
};
const fullyLost = {
  tactic: 0,
  player: { pX: { slot1: 0 } },
  signature: tacticSignature(baseTactic),
};
const hi = familiarityMult(fullySettled, "pX", "slot1");
const lo = familiarityMult(fullyLost, "pX", "slot1");
check(
  "a fully settled side reaches +FAMILIARITY_SWING",
  near(hi, 1 + FAMILIARITY_SWING),
  `${((hi - 1) * 100).toFixed(1)}%`
);
check(
  "a fully unsettled side reaches −FAMILIARITY_SWING",
  near(lo, 1 - FAMILIARITY_SWING),
  `${((lo - 1) * 100).toFixed(1)}%`
);
check(
  "the two are symmetric about 1 — the zero-sum claim",
  near((hi - 1) + (lo - 1), 0),
  `${(hi - 1).toFixed(4)} vs ${(lo - 1).toFixed(4)}`
);

// ── 3. A change of system costs, in proportion ─────────────────────────────
console.log("\n── 3. Changing the system costs what it should ────────────────\n");

const t = (over: Partial<Tactic>): Tactic => ({ ...baseTactic, ...over });
const shapes = ["442", "433", "4231"].filter((id) => id !== baseTactic.formationId);
const otherShape = shapes[0] ?? "442";

const rSame = retentionBetween(baseTactic, { ...baseTactic });
const rDial = retentionBetween(baseTactic, t({ press: baseTactic.press === "High" ? "Low" : "High" }));
const rStyle = retentionBetween(
  baseTactic,
  t({ style: baseTactic.style === "Possession" ? "Counter" : "Possession" })
);
const rShape = retentionBetween(baseTactic, t({ formationId: otherShape }));

check("an identical tactic costs nothing", rSame === 1, `retention ${rSame}`);
check("changing a dial is the cheapest real change", rDial < 1 && rDial > rStyle, `retention ${rDial.toFixed(2)}`);
check("changing the style costs more than a dial", rStyle < rDial, `retention ${rStyle.toFixed(2)}`);
check("changing the FORMATION costs most", rShape < rStyle, `retention ${rShape.toFixed(2)}`);
check("even a total rewrite never zeroes the squad", rShape > 0, `retention ${rShape.toFixed(2)}`);

// The cost must be taken WHEN THE CHANGE IS MADE — a change that is free until
// the club next plays is a change a manager could make for nothing.
{
  const probe = { ...userTeam, familiarity: { tactic: 1, player: {}, signature: tacticSignature(baseTactic) } };
  applyTacticChange(probe as never, baseTactic, t({ formationId: otherShape }));
  check(
    "applyTacticChange charges immediately, not at kick-off",
    probe.familiarity!.tactic < 1,
    `1 → ${probe.familiarity!.tactic.toFixed(2)}`
  );
}
{
  const probe = { ...userTeam, familiarity: { tactic: 1, player: {}, signature: tacticSignature(baseTactic) } };
  applyTacticChange(probe as never, baseTactic, { ...baseTactic });
  check("…and charges nothing when nothing rehearsable changed", probe.familiarity!.tactic === 1);
}
{
  // A brief is not something the squad rehearses — opening the Creator must not
  // cost rating, or the feature taxes the screen it is meant to make worth using.
  const probe = { ...userTeam, familiarity: { tactic: 1, player: {}, signature: tacticSignature(baseTactic) } };
  applyTacticChange(probe as never, baseTactic, t({ roles: { slot1: "sniper" } }));
  check("setting a ROLE BRIEF costs nothing — it is not rehearsal", probe.familiarity!.tactic === 1);
}

// ── 4. Accrual, through the real match path ────────────────────────────────
console.log("\n── 4. Playing matches actually banks it ───────────────────────\n");

function playOne(): boolean {
  for (let guard = 0; guard < 400; guard++) {
    const stop = advanceUntilEvent(state);
    if (stop.kind === "seasonEnd") return false;
    if (stop.kind === "matchday") {
      const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
      const userLineup = ensureUserLineup(state);
      const mk = (teamId: string, fixed?: typeof userLineup) => {
        const tm = state.teams[teamId];
        const players = tm.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
        return buildSideInput(
          teamId, tm.name, tm.short, players, tm.tactic, TUNING, fixed,
          1, undefined, undefined, undefined, tm.familiarity
        );
      };
      const home = mk(fixture.homeId, fixture.homeId === state.userTeamId ? userLineup : undefined);
      const away = mk(fixture.awayId, fixture.awayId === state.userTeamId ? userLineup : undefined);
      applyMatchResult(state, fixture, simulateMatch(home, away, TUNING, matchSeed(state, fixture)), { home, away });
      afterUserMatch(state);
      return true;
    }
  }
  return false;
}

const beforeTactic = tacticFamiliarity(userTeam.familiarity);
let played = 0;
for (let i = 0; i < 12 && playOne(); i++) played++;
const afterTactic = tacticFamiliarity(userTeam.familiarity);

check(`played ${played} of the user's matches`, played > 0);
check(
  "the team track RISES with matches played",
  afterTactic > beforeTactic,
  `${beforeTactic.toFixed(3)} → ${afterTactic.toFixed(3)}`
);
check(
  "AI clubs accrue too — this is not a user-only buff",
  Object.values(state.teams).filter((tm) => tm.id !== state.userTeamId && tm.familiarity).length > 0,
  `${Object.values(state.teams).filter((tm) => tm.id !== state.userTeamId && tm.familiarity).length} AI clubs have a record`
);
{
  const rec = userTeam.familiarity!;
  const anyPlayer = Object.keys(rec.player ?? {})[0];
  const slots = anyPlayer ? Object.values(rec.player![anyPlayer]) : [];
  check(
    "a player who started banks slot-level familiarity above the centre",
    slots.some((v) => v > FAMILIARITY_CENTER),
    `best slot ${Math.max(0, ...slots).toFixed(3)}`
  );
}
check("nothing ever exceeds 1", tacticFamiliarity(userTeam.familiarity) <= 1);

// ── 5. Familiarity does not travel ─────────────────────────────────────────
console.log("\n── 5. It belongs to the squad, never to the player ────────────\n");

{
  // Take a settled starter and move him to another club.
  const rec = userTeam.familiarity!;
  const settledId = Object.keys(rec.player ?? {}).find((pid) =>
    Object.values(rec.player![pid]).some((v) => v > FAMILIARITY_CENTER)
  );
  const destination = Object.values(state.teams).find(
    (tm) => tm.id !== state.userTeamId && tm.leagueId === userTeam.leagueId
  )!;
  // Give the destination a record, so "arrives unfamiliar" is distinguishable
  // from "club has no record at all".
  bankMatchFamiliarity(destination, destination.tactic, []);

  if (settledId) {
    const slotId = Object.keys(rec.player![settledId])[0];
    const before = playerFamiliarity(userTeam.familiarity, settledId, slotId);
    completeTransfer(state, settledId, destination.id, 1_000_000, { wage: 50_000, years: 3 });

    check(
      "the selling club forgets him entirely",
      userTeam.familiarity!.player?.[settledId] === undefined,
      `was ${before.toFixed(3)}`
    );
    check(
      "he arrives at the new club knowing nothing of its system",
      playerFamiliarity(destination.familiarity, settledId, slotId) === NEWCOMER_FAMILIARITY,
      `${playerFamiliarity(destination.familiarity, settledId, slotId)}`
    );
    check(
      "a newcomer is a real downgrade on an equally-rated incumbent",
      familiarityMult(destination.familiarity, settledId, slotId) < 1
    );
  } else {
    check("found a settled starter to transfer", false, "no player banked above the centre");
  }
}

// ── 6. Pruning ─────────────────────────────────────────────────────────────
console.log("\n── 6. Stale records are dropped, not leaked ───────────────────\n");

{
  const probe = {
    id: "probe",
    playerIds: ["keep"],
    familiarity: {
      tactic: 0.8,
      player: { keep: { s1: 0.9, gone: 0.9 }, left: { s1: 0.9 } },
      signature: "x",
    },
  };
  pruneFamiliarity(probe as never, new Set(["s1"]));
  check("a slot the formation no longer has is dropped", probe.familiarity.player.keep.gone === undefined);
  check("a slot it still has survives", probe.familiarity.player.keep.s1 === 0.9);
  check("a player who has left the squad is dropped", probe.familiarity.player.left === undefined);
}

// ── 7. The combined figure ─────────────────────────────────────────────────
console.log("\n── 7. Both tracks contribute ──────────────────────────────────\n");

{
  const teamOnly = { tactic: 1, player: { p: { s: 0 } }, signature: "x" };
  const playerOnly = { tactic: 0, player: { p: { s: 1 } }, signature: "x" };
  const both = { tactic: 1, player: { p: { s: 1 } }, signature: "x" };
  const neither = { tactic: 0, player: { p: { s: 0 } }, signature: "x" };
  const c = (f: typeof teamOnly) => combinedFamiliarity(f, "p", "s");
  check("a settled system alone is worth something", c(teamOnly) > c(neither));
  check("a settled player alone is worth something", c(playerOnly) > c(neither));
  check("both together reach the top of the scale", near(c(both), 1));
  check("neither sits at the bottom", near(c(neither), 0));

  // The system is the larger WEIGHT (0.6 vs 0.4) but not the larger effect in
  // this probe, because the player-ceiling binds precisely here: a squad that
  // knows its system perfectly while THIS player knows nothing is the case the
  // cap exists for. Asserting the weights directly would be asserting the
  // implementation; what matters is the behaviour either side of the cap.
  check(
    "with the player at zero, a settled system cannot carry him past the cap",
    c(teamOnly) < FAMILIARITY_CENTER,
    `${c(teamOnly)} — capped at player + headroom`
  );
  check(
    "once he knows the slot, the system IS the larger share",
    (() => {
      // Both players equally settled personally; one club knows its system.
      const settledClub = { tactic: 1, player: { p: { s: 0.8 } }, signature: "x" };
      const rawClub = { tactic: 0, player: { p: { s: 0.8 } }, signature: "x" };
      return c(settledClub) - c(rawClub) > 0.3;
    })(),
    "a known player gains more from his club's system than from his own extra reps"
  );
}

console.log(
  failures === 0
    ? "\nAll squad-familiarity checks passed.\n"
    : `\n${failures} squad-familiarity check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

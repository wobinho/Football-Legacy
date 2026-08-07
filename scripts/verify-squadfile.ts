// Squad file verifier (v1.92): drive a real squad export → library import.
//
//   npm run verify:squadfile
//
// The failure modes are the same KIND as the player file's — things that render
// wrong three screens later rather than failing a type check. The specific ones
// this guards:
//
//   • A roster that doesn't survive the round trip, so a squad of 27 imports as
//     a club of 27 empty names.
//   • `squadAvgOverall` leaking into the seed, which would make worldgen bolt a
//     second, procedural squad on top of the authored one.
//   • An absolute `expirySeason` travelling as-is, which means nothing in a
//     world that starts at season 1.
//   • Two imports of one file sharing a library id and overwriting each other.
//   • A player file being accepted as a squad file (or vice versa).
//   • (v2.0) The two roster scopes overlapping, so a "senior squad" file quietly
//     carries a 14-year-old or an academy file carries the first team.
//   • (v2.0) A mid-save import that collides with the destination's ids, lands a
//     contract that has already expired, or drops half a squad without saying so.
//   • (v2.0) A LOAN surviving the crossing. It can't today — a PlayerSeed has no
//     `loan` field — which is precisely why it is asserted rather than assumed:
//     the rule is a promise the feature makes, not a line of code anyone would
//     notice deleting.
//
// It also materialises the imported club through the REAL worldgen path, since
// "the JSON round-trips" and "the club can actually be built" are different
// claims and only the second one matters.

import { generateWorld, materializePlayer } from "../lib/worldgen";
import { exportSquad, importSquadFile, parseSquadFile, squadFileToLibraryClub, SQUAD_FILE_VERSION } from "../lib/squadfile";
import { exportPlayer } from "../lib/playerfile";
import { libraryClubToSeed } from "../lib/customdb";
import { TUNING } from "../lib/config/tuning";
import { mulberry32 } from "../lib/rng";
import type { GameState } from "../lib/types";

const fail: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fail.push(msg);
};

function world(seed: number, save: string): GameState {
  return generateWorld({
    saveName: save,
    managerName: "Harness",
    userTeamId: "ENG1_t0",
    playableCountry: "ENG",
    viewCountries: [],
    seed,
  });
}

const src = world(4242, "source-legacy");
src.season = 7; // so contract terms have a non-trivial remaining span to re-express
const team = src.teams[src.userTeamId];
const squadIds = team.playerIds.filter((id) => src.players[id] && !src.players[id].retired);

console.log(`\nExporting ${team.name}: ${squadIds.length} senior players, season ${src.season}`);

// ── Export ────────────────────────────────────────────────────────────────
const file = exportSquad(src, src.userTeamId)!;
check(!!file, "exportSquad returns a file for a real club");
check(file.kind === "football-legacy-squad", "file carries the squad-file marker");
check(file.fileVersion === SQUAD_FILE_VERSION, "file is stamped with the current version");
check(file.club.players?.length === squadIds.length, `every senior player travels (${file.club.players?.length}/${squadIds.length})`);
check(file.origin.season === 7 && file.origin.saveName === "source-legacy", "provenance records the source save and season");

// The export must not carry a generated-squad target, or worldgen will build a
// SECOND squad to hit that average on top of the roster being imported.
check(
  file.club.squadAvgOverall === undefined && file.club.squadQuality === undefined,
  "no generated-squad dial is set (the roster is the squad)"
);

// Attributes travel verbatim and overall is left derived, so the editor's
// sliders and the game's overall model can't disagree.
const first = file.club.players![0];
check(!!first.attrs && Object.keys(first.attrs).length > 30, "every player carries his full 35-attribute line");
check(first.overall === undefined, "overall is NOT restated (it derives from attrs)");
check(typeof first.potential === "number", "potential travels (a squad mid-rebuild keeps its prospects)");

// A contract must be re-expressed as a REMAINING term: season 7 + 3 years left
// has to import as 3, not as "expires in season 10" in a world starting at 1.
const withContract = squadIds.map((id) => src.players[id]).find((p) => p.contract);
if (withContract) {
  const seed = file.club.players!.find((p) => p.name === withContract.name)!;
  const expected = Math.max(1, withContract.contract!.expirySeason - src.season);
  check(seed.contractYears === expected, `contract travels as a remaining term (${seed.contractYears} = ${expected})`);
  check(
    seed.contractYears! < 50,
    "contract term is a span, not an absolute expiry season"
  );
}

// ── The roster scope (v2.0) ───────────────────────────────────────────────
// The two exports are DISJOINT — that is the whole point of replacing the old
// "include the academy too" flag with a choice. A senior file that quietly
// carried a 14-year-old, or an academy file that carried the first team, would
// be exactly the mixed roster the split exists to prevent.
const academyIds = (team.academyPlayerIds ?? []).filter((id) => src.players[id] && !src.players[id].retired);
const youth = exportSquad(src, src.userTeamId, { roster: "academy" })!;
check(file.roster === "senior", "a default export is stamped as the senior squad");
check(youth.roster === "academy", "an academy export is stamped as such");
check(
  (youth.club.players?.length ?? 0) === academyIds.length,
  `every prospect travels (${youth.club.players?.length}/${academyIds.length})`
);
const seniorNames = new Set((file.club.players ?? []).map((p) => p.name));
check(
  (youth.club.players ?? []).every((p) => !seniorNames.has(p.name)),
  "the two rosters are disjoint — neither export leaks into the other"
);

// ── Round trip through JSON ───────────────────────────────────────────────
const parsed = parseSquadFile(JSON.stringify(file));
check(parsed.club.players?.length === file.club.players?.length, "roster survives a JSON round trip");

// ── Import into the library ───────────────────────────────────────────────
const clubA = squadFileToLibraryClub(parsed);
const clubB = squadFileToLibraryClub(parsed);
check(clubA.id !== clubB.id, "two imports of one file get distinct library ids");
check(clubA.players?.length === squadIds.length, "the library club keeps the whole roster");
check(clubA.name === team.name && clubA.rep === Math.round(team.reputation), "identity and reputation carry over");

// Editing one import must not touch the other — they are independent copies.
clubA.players![0].name = "MUTATED";
check(clubB.players![0].name !== "MUTATED", "imported rosters are deep copies, not shared references");

// ── Materialize through the REAL worldgen path ────────────────────────────
// The JSON round-tripping is not the claim that matters; the claim that matters
// is that worldgen can build this club. `materializePlayer` is what actually
// consumes a PlayerSeed when a world is created.
const seedClub = libraryClubToSeed(clubB);
const rng = mulberry32(1);
let built = 0;
let overallDrift = 0;
for (const seed of seedClub.players ?? []) {
  const p = materializePlayer(rng, TUNING, seed, "ENG");
  built++;
  // Overall is derived from the attribute line on both sides, so a player must
  // rate the same in the new world as he did in the old one.
  const original = squadIds.map((id) => src.players[id]).find((x) => x.name === seed.name);
  if (original) overallDrift = Math.max(overallDrift, Math.abs(p.overall - original.overall));
}
check(built === squadIds.length, `every seed materializes into a real player (${built}/${squadIds.length})`);
check(overallDrift <= 1, `overall survives the trip (max drift ${overallDrift})`);

// ── Mid-save import (v2.0) ────────────────────────────────────────────────
// The third destination, and the one the round-trip checks above say nothing
// about: signing the file into a world that is already being played.
const dst = world(99, "destination-legacy");
dst.season = 4;
const dstTeam = dst.teams[dst.userTeamId];
const beforeSquad = dstTeam.playerIds.length;
const beforeWorld = Object.keys(dst.players).length;

const landed = importSquadFile(dst, parsed, dst.userTeamId, TUNING, 99);
check(landed.roster === "senior", "a senior file lands in the senior squad");
check(landed.playerIds.length === squadIds.length, `every player is signed (${landed.playerIds.length}/${squadIds.length})`);
check(!landed.skipped.length, "nothing is skipped when there is room");
check(dstTeam.playerIds.length === beforeSquad + landed.playerIds.length, "the destination squad grows by exactly what arrived");
check(
  Object.keys(dst.players).length === beforeWorld + landed.playerIds.length,
  "every arrival is a real player in the world"
);

const arrivals = landed.playerIds.map((id) => dst.players[id]);
check(arrivals.every((p) => p.clubId === dst.userTeamId), "every arrival is at the destination club");
check(arrivals.every((p) => !src.players[p.id]), "arrivals are re-keyed — no id collides with the source world");
// A contract term must be re-expressed against the DESTINATION's season, or a
// deal exported in season 7 expires before it starts in a save at season 4.
check(
  arrivals.every((p) => !p.contract || p.contract.expirySeason >= dst.season),
  "no arrival lands on a contract that has already expired"
);
check(arrivals.every((p) => p.acquiredSeason === dst.season), "arrivals carry the same-season resale lock");
check(arrivals.every((p) => p.fitness === 100 && p.form === 1), "arrivals are fit and neutral");

// THE LOAN RULE. A player out on loan when the file was written must arrive at
// his parent club, available. It falls out of the format (a PlayerSeed has no
// `loan` field) rather than being enforced — which is exactly why it is checked
// here: a field added to the seed later could reintroduce it silently.
const loanee = squadIds.map((id) => src.players[id])[0];
loanee.loan = { toClubId: "ENG1_t1", startDay: src.currentDay, minutesWeight: 0.8, role: "starter" };
const withLoan = parseSquadFile(JSON.stringify(exportSquad(src, src.userTeamId)!));
check(
  (withLoan.club.players ?? []).every((p) => !("loan" in p)),
  "a loan does not survive the export"
);
const loanDst = world(1234, "loan-destination");
const loanLanded = importSquadFile(loanDst, withLoan, loanDst.userTeamId, TUNING, 99);
const loanArrival = loanLanded.playerIds.map((id) => loanDst.players[id]).find((p) => p.name === loanee.name);
check(!!loanArrival, "the loaned-out player travels with the squad");
check(!loanArrival?.loan, "he arrives at the club, NOT on loan");
check(loanArrival?.clubId === loanDst.userTeamId, "and he is available to his new club");
delete loanee.loan;

// An academy file lands in the ACADEMY, never the senior squad — the file
// decides, so a 14-year-old can't be dropped into a first-team roster.
const youthParsed = parseSquadFile(JSON.stringify(youth));
const yDst = world(777, "youth-destination");
const yTeam = yDst.teams[yDst.userTeamId];
const yBeforeSenior = yTeam.playerIds.length;
const yBeforeAcademy = (yTeam.academyPlayerIds ?? []).length;
const yLanded = importSquadFile(yDst, youthParsed, yDst.userTeamId, TUNING, 99);
check(yLanded.roster === "academy", "an academy file lands in the academy");
check(yTeam.playerIds.length === yBeforeSenior, "the senior squad is untouched by an academy import");
check(
  (yTeam.academyPlayerIds ?? []).length === yBeforeAcademy + yLanded.playerIds.length,
  "the academy grows by exactly what arrived"
);
const prospects = yLanded.playerIds.map((id) => yDst.players[id]);
check(prospects.every((p) => p.academyClubId === yDst.userTeamId), "every prospect is registered to the academy");
check(prospects.every((p) => !!p.u21Tier), "every prospect wears an academy badge");

// The cap is honoured and a partial import is REPORTED — silently dropping half
// a squad is the worst outcome this path has.
const capped = world(555, "capped-destination");
const cappedLanded = importSquadFile(capped, parsed, capped.userTeamId, TUNING, 3);
check(cappedLanded.playerIds.length === 3, "the limit is respected");
check(
  cappedLanded.skipped.length === squadIds.length - 3,
  `everything over the limit is reported as skipped (${cappedLanded.skipped.length})`
);

// ── Rejections ────────────────────────────────────────────────────────────
const rejects = (text: string, why: string) => {
  try {
    parseSquadFile(text);
    check(false, `rejects ${why}`);
  } catch {
    check(true, `rejects ${why}`);
  }
};
rejects("not json at all", "a non-JSON file");
rejects(JSON.stringify({ kind: "football-legacy-save" }), "a save file");
rejects(JSON.stringify(exportPlayer(src, squadIds[0])), "a single-player file");
rejects(JSON.stringify({ ...file, fileVersion: SQUAD_FILE_VERSION + 1 }), "a file from a newer version");
rejects(JSON.stringify({ ...file, club: { ...file.club, players: [] } }), "a squad with no players");

// ── Report ────────────────────────────────────────────────────────────────
if (fail.length) {
  console.error(`\n${fail.length} check(s) failed:`);
  for (const f of fail) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\nAll squad-file checks passed.");

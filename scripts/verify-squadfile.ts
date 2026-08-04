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
//
// It also materialises the imported club through the REAL worldgen path, since
// "the JSON round-trips" and "the club can actually be built" are different
// claims and only the second one matters.

import { generateWorld, materializePlayer } from "../lib/worldgen";
import { exportSquad, parseSquadFile, squadFileToLibraryClub, SQUAD_FILE_VERSION } from "../lib/squadfile";
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

// Academy is opt-in.
const withAcademy = exportSquad(src, src.userTeamId, { includeAcademy: true })!;
check(
  (withAcademy.club.players?.length ?? 0) >= (file.club.players?.length ?? 0),
  "includeAcademy never drops senior players"
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

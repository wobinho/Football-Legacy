// Player file verifier (v1.91): drive a real export → import round trip.
//
//   npx tsx scripts/verify-playerfile.ts
//
// The failure modes here are all of the "renders as a blank row three screens
// later" kind — an id that collides, a career row pointing at a club in another
// universe, an import that silently overwrites the player it came from. None of
// those show up in a type check, so this drives real worlds and asserts on the
// serialised result.

import { generateWorld } from "../lib/worldgen";
import { exportPlayer, importPlayer, parsePlayerFile } from "../lib/playerfile";
import type { GameState } from "../lib/types";

const fail: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fail.push(msg); };

function world(seed: number, save: string): GameState {
  return generateWorld({
    saveName: save, managerName: "Harness", userTeamId: "ENG1_t0",
    playableCountry: "ENG", viewCountries: [], seed,
  });
}

const src = world(12345, "source-universe");
const dst = world(999, "destination-universe");

// Pick a player with something worth carrying across.
const userTeam = src.teams[src.userTeamId];
const subject = userTeam.playerIds
  .map((id) => src.players[id])
  .sort((a, b) => b.overall - a.overall)[0];

// Give him a career row and an honour so the history path is actually exercised.
src.careers[subject.id] = {
  playerId: subject.id,
  seasons: [{
    season: 1, clubName: userTeam.name, clubId: userTeam.id, competition: "Premier League",
    apps: 34, goals: 21, assists: 7, avgRating: 7.4, awards: [],
  }],
  transfers: [{ season: 1, day: 10, from: "Youth", to: userTeam.name, fee: 0, toId: userTeam.id }],
};
subject.accolades = [{ type: "goldenBoot", season: 1, leagueId: "ENG1", leagueName: "Premier League" }];

console.log(`subject: ${subject.name} (${subject.overall} ovr, ${subject.positions[0]}) at ${userTeam.name}`);

// ── Export ────────────────────────────────────────────────────────────────
const file = exportPlayer(src, subject.id)!;
check(!!file, "exportPlayer returned null for a real player");

// Round-trip through JSON — the file really is text on disk, and a value that
// doesn't survive stringify (undefined, a Map) would be lost silently.
const parsed = parsePlayerFile(JSON.stringify(file));

check(parsed.player.name === subject.name, "name did not survive export");
check(parsed.player.overall === subject.overall, "overall did not survive export");
check(parsed.player.potential === subject.potential, "potential did not survive export");
check(parsed.career?.seasons.length === 1, "career season did not survive export");
check(parsed.player.accolades?.length === 1, "accolade did not survive export");
check(parsed.origin.clubName === userTeam.name, "origin club name missing");

// Rule 1: nothing world-bound travels.
check(parsed.player.clubId === undefined, "clubId leaked into the player file");
check(parsed.player.kitNumber === undefined, "kitNumber leaked into the player file");
check(parsed.player.contract === undefined, "contract leaked into the player file");
check(parsed.player.acquiredSeason === undefined, "acquiredSeason leaked into the player file");
check(parsed.player.stats.apps === 0, "current-season stats leaked into the player file");

// Rule 3: club NAMES travel, club IDS do not.
const row = parsed.career!.seasons[0];
check(row.clubName === userTeam.name, "career row lost its club name");
check(row.clubId === undefined, "career row kept a club id from the source world");
check(parsed.career!.transfers[0].toId === undefined, "transfer row kept a club id");
check(parsed.career!.transfers[0].to === userTeam.name, "transfer row lost its club name");

// Export must not disturb the source save.
check(src.players[subject.id]?.clubId === userTeam.id, "export moved the player out of his club");
check(userTeam.playerIds.includes(subject.id), "export removed the player from his squad");

// ── Import into a different world ─────────────────────────────────────────
const dstTeam = dst.teams[dst.userTeamId];
const beforeSize = dstTeam.playerIds.length;
const { playerId: newId } = importPlayer(dst, parsed, dst.userTeamId);
const imported = dst.players[newId];

check(!!imported, "imported player is not in the destination world");
check(imported.name === subject.name, "imported player lost his name");
check(imported.overall === subject.overall, "imported player lost his rating");
check(imported.clubId === dst.userTeamId, "imported player was not attached to the club");
check(dstTeam.playerIds.includes(newId), "imported player is not in the squad list");
check(dstTeam.playerIds.length === beforeSize + 1, "squad size did not grow by exactly one");
check(!!imported.contract, "imported player has no contract");
check(imported.acquiredSeason === dst.season, "imported player is not transfer-locked this season");
check(typeof imported.kitNumber === "number", "imported player got no shirt number");
check(imported.fitness === 100, "imported player did not arrive fit");
check(dst.careers[newId]?.seasons.length === 1, "career history did not import");
check(dst.careers[newId]?.playerId === newId, "career history kept the old player id");
check(dst.careers[newId]?.seasons[0].clubName === userTeam.name, "imported history lost the club name");
check(imported.accolades?.length === 1, "honours did not import");

// Rule 2: a new id every time. Import the SAME file again and into its own
// source world — both are the collisions that would overwrite a real player.
const second = importPlayer(dst, parsed, dst.userTeamId);
check(second.playerId !== newId, "importing the same file twice reused an id");
check(dst.players[newId]?.name === subject.name, "the second import overwrote the first");

const selfImport = importPlayer(src, parsed, src.userTeamId);
check(selfImport.playerId !== subject.id, "importing into the source world reused the original id");
check(src.players[subject.id]?.overall === subject.overall, "self-import overwrote the original player");

// A free-agent import belongs to nobody.
const free = importPlayer(dst, parsed, null);
check(dst.players[free.playerId].clubId === null, "free-agent import was attached to a club");
check(
  !Object.values(dst.teams).some((t) => t.playerIds.includes(free.playerId)),
  "free-agent import appears in a squad list"
);

// ── Rejections ────────────────────────────────────────────────────────────
const rejects: [string, string][] = [
  ["not json at all", "{{{"],
  ["a save file", JSON.stringify({ schemaVersion: 47, players: {}, teams: {} })],
  ["a truncated player", JSON.stringify({ ...file, player: { name: "X" } })],
];
for (const [what, text] of rejects) {
  let threw = false;
  try { parsePlayerFile(text); } catch { threw = true; }
  check(threw, `parsePlayerFile accepted ${what}`);
}

// ── Report ────────────────────────────────────────────────────────────────
if (fail.length) {
  console.error("\nFAIL");
  for (const f of fail) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nPASS — ${subject.name} moved between universes with his history intact.`);

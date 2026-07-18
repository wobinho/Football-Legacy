// Headless smoke test: play 3 full seasons as the user club (instant results),
// exercising the whole loop — continue, matchdays, cup, windows, rollover.
//   npx tsx scripts/smoke.ts [seasons]

import { generateWorld } from "../lib/worldgen";
import { advanceUntilEvent, applyMatchResult, afterUserMatch, matchSeed, ensureUserLineup } from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";
import { formatDay } from "../lib/calendar";

const SEASONS = Number(process.argv[2] ?? 3);

const state = generateWorld({
  saveName: "smoke",
  managerName: "Smoke Test",
  userTeamId: "ENG1_t9", // mid-table club: Nottingham Foresters
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

let matches = 0;
let offers = 0;
let guard = 0;

while (state.season <= SEASONS && guard++ < 3000) {
  const stop = advanceUntilEvent(state);
  if (stop.kind === "matchday") {
    const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
    const userLineup = ensureUserLineup(state);
    const mk = (teamId: string, fixed?: typeof userLineup) => {
      const t = state.teams[teamId];
      const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
      return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, fixed);
    };
    const res = simulateMatch(
      mk(fixture.homeId, fixture.homeId === state.userTeamId ? userLineup : undefined),
      mk(fixture.awayId, fixture.awayId === state.userTeamId ? userLineup : undefined),
      TUNING,
      matchSeed(state, fixture)
    );
    applyMatchResult(state, fixture, res);
    afterUserMatch(state);
    matches++;
  } else if (stop.kind === "offer") {
    offers++;
  } else if (stop.kind === "idle") {
    console.error("!! idle stop — loop stuck at", formatDay(state.currentDay), "season", state.season);
    break;
  }
}

console.log(`\n── Smoke: ${SEASONS} seasons ──`);
console.log(`user matches played: ${matches} (expect ~${SEASONS * 39}+ incl. cup)`);
console.log(`incoming offers:     ${offers}`);
console.log(`record book seasons: ${state.recordBook.seasons.length}`);
for (const s of state.recordBook.seasons) {
  console.log(
    `  ${s.yearLabel}: champs ${s.championsByLeague["ENG1"]?.teamName} | cup ${s.cupWinner?.teamName} | user ${s.userFinish} | POTY ${s.playerOfSeason?.name ?? "—"} | topsc ${s.topScorers["ENG1"]?.name} (${s.topScorers["ENG1"]?.goals})`
  );
}
const user = state.teams[state.userTeamId];
const alive = Object.values(state.players).filter((p) => !p.retired);
console.log(`user squad: ${user.playerIds.length}, budget £${(user.budget / 1e6).toFixed(1)}M`);
console.log(`players alive: ${alive.length}, retired: ${Object.values(state.players).length - alive.length}`);
const squadSizes = Object.values(state.teams).map((t) => t.playerIds.length);
console.log(`squad sizes: min ${Math.min(...squadSizes)}, max ${Math.max(...squadSizes)}`);
const sim = state.simResults.find((r) => r.leagueId === "ESP1");
console.log(`ESP1 sim table rows: ${sim?.table.length ?? 0}, champion: ${sim ? state.teams[sim.table[0].teamId].name : "—"}`);

// Youth Academy (§18) sanity
const academy = state.academy;
const academyKids = (user.academyPlayerIds ?? []).map((id) => state.players[id]).filter(Boolean);
console.log(`\n── Academy ──`);
console.log(`academy squad: ${academyKids.length} (ages ${academyKids.length ? academyKids.map((p) => p.age).join(",") : "—"})`);
console.log(`last intake: season ${academy.lastIntake?.season ?? "—"}, class of ${academy.lastIntake?.playerIds.length ?? 0}${academy.lastIntake?.golden ? " (GOLDEN)" : ""}`);
console.log(`U21 rounds played: ${academy.u21.roundsPlayed}/22, user U21 position: ${academy.u21.table.findIndex((r) => r.isUser) + 1} of ${academy.u21.table.length}`);
const overAge = academyKids.filter((p) => p.age > TUNING.academyMaxAge);
if (overAge.length) console.error(`!! age-out failed: ${overAge.map((p) => `${p.name} (${p.age})`).join(", ")}`);
const graduates = Object.values(state.players).filter((p) => p.academyClubId === state.userTeamId);
console.log(`user academy graduates ever: ${graduates.length}`);
const aiTagged = Object.values(state.players).filter((p) => p.academyClubId && p.academyClubId !== state.userTeamId);
console.log(`AI intake players tagged: ${aiTagged.length}`);
const idCollisions = Object.entries(state.players).filter(([k, p]) => k !== p.id);
if (idCollisions.length) console.error(`!! player id mismatches: ${idCollisions.length}`);

// serialization sanity: the save format must round-trip
const json = JSON.stringify(state);
const back = JSON.parse(json);
console.log(`save JSON: ${(json.length / 1024 / 1024).toFixed(2)} MB, round-trips: ${back.season === state.season}`);
console.log(`inbox items: ${state.inbox.length}, careers tracked: ${Object.keys(state.careers).length}`);

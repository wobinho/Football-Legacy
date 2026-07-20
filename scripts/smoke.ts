// Headless smoke test: play 3 full seasons as the user club (instant results),
// exercising the whole loop — continue, matchdays, cup, windows, rollover.
//   npx tsx scripts/smoke.ts [seasons]

import { generateWorld } from "../lib/worldgen";
import {
  advanceUntilEvent,
  applyMatchResult,
  afterUserMatch,
  matchSeed,
  ensureUserLineup,
  runSeasonRollover,
} from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";
import { formatDay } from "../lib/calendar";
import { SCOUT_WORLD, SCOUT_REGIONS } from "../lib/config/scouting";
import { NAME_POOLS } from "../lib/config/names";
import { flagForNat } from "../lib/config/flags";
import { ARCHETYPES } from "../lib/config/archetypes";
import { TRAITS, RETIRED_TRAIT_IDS } from "../lib/config/traits";
import { SPONSOR_SLOTS } from "../lib/sponsors";

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
// In-season progression sample (v19). Taken while a season is actually running:
// the rollover re-stamps every baseline, so a snapshot at the end of the run
// would always read zero and prove nothing.
let midSeasonMoved = 0;
let midSeasonDay = 0;

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
  } else if (stop.kind === "seasonEnd") {
    // Season end is the last moment the season's growth is still readable — the
    // rollover immediately re-stamps every baseline (v19).
    if (!midSeasonDay) {
      midSeasonDay = state.currentDay;
      midSeasonMoved = Object.values(state.players).filter(
        (p) => !p.retired && typeof p.seasonStartOverall === "number" && p.overall !== p.seasonStartOverall
      ).length;
    }
    // The loop now parks at season end instead of rolling over inline; the UI
    // exposes this as the END SEASON button. Take it here to keep simming.
    runSeasonRollover(state);
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
// The U21 pair is rebuilt at rollover, so at season end `u21` is next season's
// opening competition — report the shape rather than a meaningless 0/22.
console.log(
  `U21: ${TUNING.u21CompetitionsPerSeason} competitions/season x ${academy.u21.matchDays.length} rounds, ` +
    `next kicks off day ${academy.u21.matchDays[0]} (register by ${academy.u21.registrationDay})`
);
const u21Registered = (academy.u21.registered ?? []).length;
console.log(`U21 registration: ${u21Registered}/${TUNING.u21RegistrationSize} submitted for the coming competition`);
const rivalProspects = academy.u21.opponents.reduce((n, o) => n + (o.prospectIds?.length ?? 0), 0);
console.log(`rival U21 prospects on file: ${rivalProspects} across ${academy.u21.opponents.length} sides`);
const overAge = academyKids.filter((p) => p.age > TUNING.academyMaxAge);
if (overAge.length) console.error(`!! age-out failed: ${overAge.map((p) => `${p.name} (${p.age})`).join(", ")}`);
const graduates = Object.values(state.players).filter((p) => p.academyClubId === state.userTeamId);
console.log(`user academy graduates ever: ${graduates.length}`);
const aiTagged = Object.values(state.players).filter((p) => p.academyClubId && p.academyClubId !== state.userTeamId);
console.log(`AI intake players tagged: ${aiTagged.length}`);
const idCollisions = Object.entries(state.players).filter(([k, p]) => k !== p.id);
if (idCollisions.length) console.error(`!! player id mismatches: ${idCollisions.length}`);

// ── Config coverage (v19) ─────────────────────────────────────────────────
// Scouting is open to every country in SCOUT_WORLD, and each of those needs
// BOTH a flag and a name pool — a country missing a pool silently generates
// English-named players, which is the kind of bug that hides for months. These
// three files are edited independently, so the invariant is checked here.
console.log(`\n── Config coverage ──`);
{
  const scoutable = SCOUT_WORLD.flatMap((c) => c.regions.flatMap((r) => r.countries.map((x) => x.id)));
  const pools = new Set(NAME_POOLS.map((p) => p.nat));
  const noPool = scoutable.filter((c) => !pools.has(c));
  const noFlag = scoutable.filter((c) => !flagForNat(c));
  const dupes = scoutable.filter((c, i) => scoutable.indexOf(c) !== i);
  console.log(`scoutable countries: ${scoutable.length}, targets: ${SCOUT_REGIONS.length}`);
  if (noPool.length) console.error(`!! scoutable countries with no name pool: ${noPool.join(", ")}`);
  if (noFlag.length) console.error(`!! scoutable countries with no flag: ${noFlag.join(", ")}`);
  if (dupes.length) console.error(`!! duplicate countries in SCOUT_WORLD: ${dupes.join(", ")}`);

  // Every style must carry a full counter row and a shape, or the engine falls
  // back to neutral and a style silently does nothing.
  const styles = Object.keys(TUNING.styleShape);
  for (const s of styles) {
    const row = TUNING.styleCounter[s as keyof typeof TUNING.styleCounter];
    const missing = styles.filter((o) => row?.[o as keyof typeof row] === undefined);
    if (missing.length) console.error(`!! styleCounter[${s}] missing: ${missing.join(", ")}`);
  }
  console.log(`styles: ${styles.length} (all have shape + counter rows)`);

  // Archetypes must declare synergy for every style, for the same reason.
  const badArch = ARCHETYPES.filter((a) => styles.some((s) => a.styleSynergy[s as keyof typeof a.styleSynergy] === undefined));
  if (badArch.length) console.error(`!! archetypes missing style synergy: ${badArch.map((a) => a.id).join(", ")}`);
  console.log(`archetypes: ${ARCHETYPES.length}, traits: ${TRAITS.length}`);

  // A retired trait must not also be a live one, or migration strips it.
  const resurrected = RETIRED_TRAIT_IDS.filter((id) => TRAITS.some((t) => t.id === id));
  if (resurrected.length) console.error(`!! trait ids both live and retired: ${resurrected.join(", ")}`);

  // Sponsor slots need a brand pool, a share and a capacity.
  const badSlots = SPONSOR_SLOTS.filter(
    (s) => TUNING.sponsorSlotShare[s.slot] === undefined || TUNING.sponsorSlotCapacity[s.slot] === undefined
  );
  if (badSlots.length) console.error(`!! sponsor slots missing tuning: ${badSlots.map((s) => s.slot).join(", ")}`);
  const totalCap = SPONSOR_SLOTS.reduce((n, s) => n + (TUNING.sponsorSlotCapacity[s.slot] ?? 1), 0);
  console.log(`sponsor slots: ${SPONSOR_SLOTS.length} (${totalCap} concurrent deals possible)`);
}

// ── In-season progression + AI finances (v19) ─────────────────────────────
console.log(`\n── Progression & AI finances ──`);
{
  // NOTE: the run ends just after a rollover, which re-stamps every baseline —
  // so this snapshot is necessarily ~0. The meaningful figure is the mid-season
  // sample captured during play (see `midSeasonMoved` above).
  console.log(`season-1 end (day ${midSeasonDay}): ${midSeasonMoved} players had moved in-season`);
  if (!midSeasonMoved) console.error(`!! nobody's rating moved in-season — the growth badge would always read 0`);
  const moved = Object.values(state.players).filter(
    (p) => !p.retired && typeof p.seasonStartOverall === "number" && p.overall !== p.seasonStartOverall
  );
  const gained = moved.filter((p) => p.overall > p.seasonStartOverall!).length;
  const lost = moved.length - gained;
  console.log(`post-rollover (baselines just reset): ${moved.length} (+${gained} / -${lost})`);

  const aiClubs = Object.values(state.teams).filter(
    (t) => t.id !== state.userTeamId && state.leagues[t.leagueId]?.playable
  );
  const withCommercial = aiClubs.filter((t) => (t.commercialIncome ?? 0) > 0).length;
  console.log(`AI clubs with commercial income: ${withCommercial}/${aiClubs.length}`);
  const broke = aiClubs.filter((t) => t.budget < 0);
  if (broke.length) console.error(`!! AI clubs with negative budgets: ${broke.length} (worst ${Math.min(...broke.map((t) => t.budget))})`);
  const budgets = aiClubs.map((t) => t.budget).sort((a, b) => a - b);
  const fmt = (n: number) => `£${(n / 1_000_000).toFixed(1)}M`;
  console.log(`AI budgets: min ${fmt(budgets[0])}, median ${fmt(budgets[Math.floor(budgets.length / 2)])}, max ${fmt(budgets[budgets.length - 1])}`);
}

// serialization sanity: the save format must round-trip
const json = JSON.stringify(state);
const back = JSON.parse(json);
console.log(`save JSON: ${(json.length / 1024 / 1024).toFixed(2)} MB, round-trips: ${back.season === state.season}`);
console.log(`inbox items: ${state.inbox.length}, careers tracked: ${Object.keys(state.careers).length}`);

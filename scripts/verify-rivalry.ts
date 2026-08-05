// Drives a real world through the dynamic rivalry feature (v1.94) and asserts
// the BEHAVIOUR, not the tuning table.
//
// The failure modes this exists to catch are all of the "perfectly specified
// and wired to nothing" kind that verify-v193 was written for:
//
//   · a rivalry that forms but never pays (the multiplier not reaching
//     `matchUpgradeIncome`, or reaching it for the wrong fixture);
//   · a rivalry that pays a club which never bought the upgrade tracks, which
//     would make the whole "return on an investment" framing a lie;
//   · a rivalry that pays every AI club too, or pays on non-derby fixtures —
//     both of which look like "the feature works" from one match;
//   · a rivalry that never goes dormant, so a club relegated out of sight keeps
//     paying derby money forever.
//
// Run: npx tsx scripts/verify-rivalry.ts

import { generateWorld } from "../lib/worldgen";
import { TUNING } from "../lib/config/tuning";
import { matchUpgradeIncome } from "../lib/economy";
import {
  RIVALRY_OFFER_TIER,
  activeRivalries,
  formRivalries,
  isRival,
  isRivalryFixture,
  recordRivalryMeeting,
  rivalryMatchMultiplier,
  rivalryRecordLine,
  tableRivalryOffers,
  upcomingRivalryFixture,
} from "../lib/rivalry";
import type { Fixture, GameState, SeasonSummary, TableRow } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function makeWorld(): GameState {
  const state = generateWorld({
    saveName: "rivalry",
    managerName: "Tester",
    userTeamId: "ENG1_t9",
    playableCountry: "ENG",
    viewCountries: [],
    seed: 909,
  });
  state.rivalries = [];
  return state;
}

/** The user's own division, as the id and the club list. */
function userLeague(state: GameState) {
  const team = state.teams[state.userTeamId];
  return { id: team.leagueId, teamIds: state.leagues[team.leagueId].teamIds };
}

/** A minimal but STRUCTURALLY REAL season summary: the rivalry code reads
 * `finalTables`, `userPosition`, `cupWinner` and `cupRunnerUp`, so those are the
 * fields that have to be right. Building it by hand rather than playing a season
 * is what lets a test place two specific clubs in the top three three years
 * running, which a simulated world would only do by luck. */
function pushSummary(
  state: GameState,
  opts: {
    season: number;
    /** Final table order, by team id, best first. */
    order: string[];
    cupWinner?: string;
    cupRunnerUp?: string;
  }
) {
  const { id } = userLeague(state);
  const rows: TableRow[] = opts.order.map((teamId, i) => ({
    teamId,
    played: 38,
    won: 30 - i,
    drawn: 4,
    lost: 4 + i,
    gf: 90 - i,
    ga: 30 + i,
    points: 94 - i * 3,
  }));
  const summary = {
    season: opts.season,
    yearLabel: `${2024 + opts.season}/${25 + opts.season}`,
    championsByLeague: {},
    cupWinner: opts.cupWinner
      ? { teamId: opts.cupWinner, teamName: state.teams[opts.cupWinner].name }
      : null,
    cupRunnerUp: opts.cupRunnerUp
      ? { teamId: opts.cupRunnerUp, teamName: state.teams[opts.cupRunnerUp].name }
      : null,
    finalTables: { [id]: rows },
    topScorers: {},
    playerOfSeason: null,
    youngPlayerOfSeason: null,
    userTeamId: state.userTeamId,
    userFinish: "",
    userPosition: opts.order.indexOf(state.userTeamId) + 1,
    notableTransfers: [],
  } as unknown as SeasonSummary;
  state.recordBook.seasons.push(summary);
  state.season = opts.season;
}

console.log("\n── Formation: the cup final ──────────────────────────────────\n");
{
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const other = teamIds.find((t) => t !== state.userTeamId)!;

  // A season the user did not reach the final of forms nothing.
  const bystanderA = teamIds.filter((t) => t !== state.userTeamId)[1];
  const bystanderB = teamIds.filter((t) => t !== state.userTeamId)[2];
  pushSummary(state, {
    season: 1,
    order: teamIds,
    cupWinner: bystanderA,
    cupRunnerUp: bystanderB,
  });
  check("a final the user wasn't in forms no rivalry", formRivalries(state, TUNING).length === 0);

  // Losing a final to a club forms one, and the story names them.
  pushSummary(state, { season: 2, order: teamIds, cupWinner: other, cupRunnerUp: state.userTeamId });
  const formed = formRivalries(state, TUNING);
  check("losing a cup final forms a rivalry", formed.length === 1, `${formed.length} formed`);
  check("...against the club that beat you", formed[0]?.rivalry.rivalId === other);
  check("...recorded with the cause", formed[0]?.rivalry.cause === "cupFinal");
  check("...and a story naming the rival", !!formed[0]?.rivalry.story.includes(state.teams[other].name));
  check("...which the world now holds", isRival(state, other, TUNING));

  // Idempotent: the same summary must not form it twice.
  check("re-running the same rollover forms nothing new", formRivalries(state, TUNING).length === 0);
  check("...and the club is still a single rivalry", (state.rivalries ?? []).length === 1);
}

console.log("\n── Formation: the title race ─────────────────────────────────\n");
{
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const others = teamIds.filter((t) => t !== state.userTeamId);
  const persistent = others[0];
  const drifter = others[1];
  const rest = others.slice(2);

  // Two seasons of sharing the podium is a coincidence, not a rivalry — the
  // three-season rule is the whole point of the trigger.
  pushSummary(state, { season: 1, order: [state.userTeamId, persistent, drifter, ...rest] });
  check("one shared podium forms nothing", formRivalries(state, TUNING).length === 0);
  pushSummary(state, { season: 2, order: [persistent, state.userTeamId, drifter, ...rest] });
  check("two shared podiums still form nothing", formRivalries(state, TUNING).length === 0);

  // The third season completes the pattern — but only for the club that was
  // there all three times. `drifter` drops out in season 3.
  pushSummary(state, { season: 3, order: [state.userTeamId, persistent, ...rest, drifter] });
  const formed = formRivalries(state, TUNING);
  check(
    `${TUNING.rivalryTitleRaceSeasons} shared podiums form a rivalry`,
    formed.length === 1,
    `${formed.length} formed`
  );
  check("...against the club that was there every season", formed[0]?.rivalry.rivalId === persistent);
  check("...and NOT against the one that dropped out", !isRival(state, drifter, TUNING));
  check("...recorded with the cause", formed[0]?.rivalry.cause === "titleRace");
}

{
  // A club that finishes mid-table for three seasons has no title-race rivals,
  // however consistent the clubs above it are. A rivalry is mutual.
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const others = teamIds.filter((t) => t !== state.userTeamId);
  for (let s = 1; s <= 4; s++) {
    pushSummary(state, { season: s, order: [...others.slice(0, 8), state.userTeamId, ...others.slice(8)] });
    formRivalries(state, TUNING);
  }
  check(
    "a mid-table club forms no title-race rivalry",
    (state.rivalries ?? []).length === 0,
    `${(state.rivalries ?? []).length} formed`
  );
}

{
  // Three shared podiums spread across a PROMOTION are three finishes in two
  // different races. A club you shared a second-tier podium with two summers ago
  // is not your rival in the division you play now — and the derby it would
  // create can't even be scheduled, so it would pay nothing and read as a bug.
  const state = makeWorld();
  const { id: topId, teamIds } = userLeague(state);
  const others = teamIds.filter((t) => t !== state.userTeamId);
  const companion = others[0];

  // Two seasons in a DIFFERENT division, sharing the podium with `companion`...
  for (const season of [1, 2]) {
    const rows: TableRow[] = [state.userTeamId, companion, ...others.slice(1)].map((teamId, i) => ({
      teamId, played: 38, won: 30 - i, drawn: 4, lost: 4 + i, gf: 90 - i, ga: 30 + i, points: 94 - i * 3,
    }));
    state.recordBook.seasons.push({
      season,
      yearLabel: `${2024 + season}/${25 + season}`,
      championsByLeague: {},
      cupWinner: null,
      cupRunnerUp: null,
      // A second-tier table — deliberately NOT the league the third season uses.
      finalTables: { ENG2: rows },
      topScorers: {},
      playerOfSeason: null,
      youngPlayerOfSeason: null,
      userTeamId: state.userTeamId,
      userFinish: "",
      userPosition: 1,
      notableTransfers: [],
    } as unknown as SeasonSummary);
    state.season = season;
  }
  check("two podiums in the lower division form nothing", formRivalries(state, TUNING).length === 0);

  // ...then a third in the TOP division. The count reaches three, but not in one
  // race, so nothing may form.
  pushSummary(state, { season: 3, order: [state.userTeamId, companion, others[3], ...others.slice(1)] });
  const acrossPromotion = formRivalries(state, TUNING);
  check(
    "a third podium after promotion does NOT form a rivalry",
    acrossPromotion.length === 0,
    `a promotion handed out ${acrossPromotion.length} rivalr${acrossPromotion.length === 1 ? "y" : "ies"} as a side effect`
  );
  // But two more seasons in the SAME top division completes a real pattern.
  // The third podium place is rotated each season so `companion` is the only
  // club that shares all three — otherwise a second club qualifies too and the
  // count below would be measuring the fixture list, not the rule.
  pushSummary(state, { season: 4, order: [companion, state.userTeamId, others[1], ...others.slice(2)] });
  formRivalries(state, TUNING);
  pushSummary(state, { season: 5, order: [state.userTeamId, companion, others[2], others[1], ...others.slice(3)] });
  const formed = formRivalries(state, TUNING);
  check(
    "...but three podiums in ONE division does",
    formed.length === 1 && formed[0].rivalry.rivalId === companion,
    `${formed.length} formed`
  );
  check("...in the division actually being played", !!state.leagues[topId]);
}

{
  // The cap. A save may not accumulate rivals without limit — the payouts are
  // large, and the word has to keep meaning something.
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const others = teamIds.filter((t) => t !== state.userTeamId);
  // Every season, lose a cup final to a different club.
  for (let s = 1; s <= TUNING.rivalryMaxActive + 3; s++) {
    pushSummary(state, {
      season: s,
      order: teamIds,
      cupWinner: others[s - 1],
      cupRunnerUp: state.userTeamId,
    });
    formRivalries(state, TUNING);
  }
  check(
    `never more than rivalryMaxActive (${TUNING.rivalryMaxActive}) active rivalries`,
    activeRivalries(state, TUNING).length <= TUNING.rivalryMaxActive,
    `${activeRivalries(state, TUNING).length} active`
  );
}

console.log("\n── The money: derby fixtures pay, ordinary ones don't ────────\n");
{
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const rival = teamIds.find((t) => t !== state.userTeamId)!;
  const neutral = teamIds.filter((t) => t !== state.userTeamId)[1];
  pushSummary(state, { season: 1, order: teamIds, cupWinner: rival, cupRunnerUp: state.userTeamId });
  formRivalries(state, TUNING);

  const team = state.teams[state.userTeamId];
  const fixtureAgainst = (oppId: string): Fixture =>
    ({
      id: `fx_${oppId}`,
      day: state.currentDay + 3,
      competition: team.leagueId,
      round: 1,
      homeId: state.userTeamId,
      awayId: oppId,
      played: false,
    }) as unknown as Fixture;

  const derby = fixtureAgainst(rival);
  const ordinary = fixtureAgainst(neutral);

  check("a fixture against the rival reads as a derby", isRivalryFixture(state, derby, TUNING));
  check("...and one against anybody else does not", !isRivalryFixture(state, ordinary, TUNING));
  check(
    `the derby multiplier is rivalryMatchBonusMult (${TUNING.rivalryMatchBonusMult})`,
    rivalryMatchMultiplier(state, derby, TUNING) === TUNING.rivalryMatchBonusMult
  );
  check("an ordinary fixture multiplies by exactly 1", rivalryMatchMultiplier(state, ordinary, TUNING) === 1);
  check("no fixture at all multiplies by exactly 1", rivalryMatchMultiplier(state, undefined, TUNING) === 1);

  // THE check the whole feature turns on: a club that never bought the upgrade
  // tracks earns nothing extra from a derby. The rivalry multiplies an
  // investment; it does not hand out cash.
  const unbought = matchUpgradeIncome(state, state.userTeamId, true, 2, 1, TUNING, derby);
  check(
    "a club with no bonus upgrades earns nothing extra from a derby",
    unbought === 0,
    `£${unbought}`
  );

  // Buy both tracks and the derby is worth exactly the multiplier.
  team.stadiumBonusLevel = 1;
  team.performanceBonusLevel = 1;
  const plain = matchUpgradeIncome(state, state.userTeamId, true, 2, 1, TUNING, ordinary);
  const boosted = matchUpgradeIncome(state, state.userTeamId, true, 2, 1, TUNING, derby);
  check("the upgrades pay on an ordinary fixture", plain > 0, `£${plain}`);
  check(
    `a derby pays ${TUNING.rivalryMatchBonusMult}× that`,
    Math.abs(boosted - plain * TUNING.rivalryMatchBonusMult) <= 1,
    `£${plain} → £${boosted}`
  );

  // The rivalry belongs to the manager, not to the world: an AI club playing the
  // same fixture must see nothing.
  const aiPlain = matchUpgradeIncome(state, rival, true, 2, 1, TUNING, derby);
  check("an AI club earns no derby money", aiPlain === 0, `£${aiPlain}`);

  // Backwards compatibility of the call itself: every existing caller that
  // passes no fixture must compute exactly what it always did.
  check(
    "omitting the fixture is the untouched, pre-rivalry answer",
    matchUpgradeIncome(state, state.userTeamId, true, 2, 1, TUNING) === plain
  );
}

console.log("\n── The one-off sponsorships ──────────────────────────────────\n");
{
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const rival = teamIds.find((t) => t !== state.userTeamId)!;
  pushSummary(state, { season: 1, order: teamIds, cupWinner: rival, cupRunnerUp: state.userTeamId });
  formRivalries(state, TUNING);

  const team = state.teams[state.userTeamId];
  team.sponsorOffers = [];
  team.sponsors = [];

  const derby: Fixture = {
    id: "fx_derby",
    day: state.currentDay + 3,
    competition: team.leagueId,
    round: 1,
    homeId: state.userTeamId,
    awayId: rival,
    played: false,
  } as unknown as Fixture;
  state.fixtures.push(derby);

  check("the derby is spotted inside the lead time", upcomingRivalryFixture(state, TUNING)?.id === derby.id);

  const base = 40_000;
  const offers = tableRivalryOffers(state, derby, base, TUNING);
  check(`a derby tables ${TUNING.rivalryOfferCount} one-off offers`, offers.length === TUNING.rivalryOfferCount, `${offers.length}`);
  check("they are one-season minors", offers.every((o) => o.kind === "minor" && o.seasons === 1));
  check(
    "...paying a premium over the ordinary rate",
    offers.every((o) => o.weeklyAmount > base),
    offers.map((o) => o.weeklyAmount).join(", ")
  );
  check(
    "...expiring with the fixture, not outliving it",
    offers.every((o) => o.expiresDay === derby.day)
  );
  check("...in distinct slots", new Set(offers.map((o) => o.slot)).size === offers.length);
  check("...and labelled as derby deals", offers.every((o) => o.tier === RIVALRY_OFFER_TIER));

  // Determinism: the same derby must attract the same suitors across a reload.
  const again = tableRivalryOffers(state, derby, base, TUNING);
  check(
    "the same fixture always attracts the same suitors",
    JSON.stringify(again.map((o) => [o.slot, o.brand, o.weeklyAmount])) ===
      JSON.stringify(offers.map((o) => [o.slot, o.brand, o.weeklyAmount]))
  );

  // A fixture far away must not bring them out early — the money is that week's.
  const distant: Fixture = { ...derby, id: "fx_far", day: state.currentDay + TUNING.rivalryOfferLeadDays + 5 };
  state.fixtures = state.fixtures.filter((f) => f.id !== derby.id);
  state.fixtures.push(distant);
  check(
    "a derby beyond the lead time brings nobody to the table yet",
    upcomingRivalryFixture(state, TUNING) === undefined
  );
}

console.log("\n── The ledger, and going dormant ─────────────────────────────\n");
{
  const state = makeWorld();
  const { teamIds } = userLeague(state);
  const rival = teamIds.find((t) => t !== state.userTeamId)!;
  pushSummary(state, { season: 1, order: teamIds, cupWinner: rival, cupRunnerUp: state.userTeamId });
  formRivalries(state, TUNING);

  recordRivalryMeeting(state, rival, 3, 1);
  recordRivalryMeeting(state, rival, 0, 0);
  recordRivalryMeeting(state, rival, 1, 2);
  const r = (state.rivalries ?? [])[0];
  check("meetings are tallied", r.played === 3 && r.won === 1 && r.drawn === 1 && r.lost === 1, rivalryRecordLine(r));

  // A meeting against a club that isn't a rival must not invent a record.
  const other = teamIds.filter((t) => t !== state.userTeamId)[1];
  recordRivalryMeeting(state, other, 5, 0);
  check("a non-rival meeting records nothing", (state.rivalries ?? []).length === 1);

  // Dormancy: stop meeting and the rivalry stops paying — but is NOT deleted,
  // so a promoted club resumes the rivalry it already had.
  state.season = r.lastMetSeason + TUNING.rivalryDormantSeasons;
  check("still a rival at the dormancy boundary", isRival(state, rival, TUNING));
  state.season = r.lastMetSeason + TUNING.rivalryDormantSeasons + 1;
  check("goes dormant once the clubs stop meeting", !isRival(state, rival, TUNING));
  check("...but the history is kept, not deleted", (state.rivalries ?? []).length === 1);
  check("...and a dormant rivalry pays nothing", activeRivalries(state, TUNING).length === 0);

  // Meeting again revives it, with its record intact.
  recordRivalryMeeting(state, rival, 2, 0);
  check("meeting again revives the rivalry", isRival(state, rival, TUNING));
  check("...with the old record still on it", (state.rivalries ?? [])[0].played === 4);
}

console.log("\n── A save with no rivalries is untouched ─────────────────────\n");
{
  const state = makeWorld();
  const team = state.teams[state.userTeamId];
  team.stadiumBonusLevel = 2;
  team.performanceBonusLevel = 2;
  const fixture = state.fixtures.find(
    (f) => f.homeId === state.userTeamId || f.awayId === state.userTeamId
  )!;
  const withFixture = matchUpgradeIncome(state, state.userTeamId, true, 2, 0, TUNING, fixture);
  const without = matchUpgradeIncome(state, state.userTeamId, true, 2, 0, TUNING);
  check("no rivalries: passing the fixture changes nothing", withFixture === without, `£${withFixture} vs £${without}`);
  check("no rivalries: nothing is a derby", !isRivalryFixture(state, fixture, TUNING));
  check("no rivalries: no derby sponsors are tabled", upcomingRivalryFixture(state, TUNING) === undefined);
  // And an undefined rivalry list (every pre-v1.94 save) behaves as empty.
  state.rivalries = undefined;
  check("a pre-v1.94 save (no rivalry field) loads as having none", activeRivalries(state, TUNING).length === 0);
  check("...and nothing throws when it's asked", !isRival(state, fixture.awayId, TUNING));
}

console.log(failures === 0 ? "\nAll rivalry checks passed.\n" : `\n${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

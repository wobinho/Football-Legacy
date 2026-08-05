// ── Game Loop (§3) ────────────────────────────────────────────────────────
// Day-by-day simulation behind a single Continue button. A day may only stop
// the player if something needs them: their matchday, an incoming transfer
// offer, or the season review. Everything else streams past as inbox/news.

import type { Fixture, GameState, MatchResult } from "./types";
import { TUNING } from "./config/tuning";
import { hashString, mulberry32, deriveSeed, uid } from "./rng";
import { isMonday, formatDayShort, buildSeasonSchedule, leagueRoundCount, seasonYearLabel } from "./calendar";
import { buildSideInput, pickLineup } from "./selection";
import { simulateMatch } from "./engine/match";
import { generateLeagueFixtures, drawCupRound, applyPromotionRelegation, initCup } from "./season";
import { regenFromRetiree, replenishFreeAgents, replenishYouth } from "./worldgen";
import { collectSeasonFinishes, driftClubReputations } from "./reputation";
import { formRivalries, recordRivalryMeeting } from "./rivalry";
import {
  EURO_KO_ROUND_NAMES,
  applyEuropeanPrizes,
  drawKnockoutRound,
  euroCompetitionId,
  recordGroupExits,
  refreshGroupTables,
  settleKnockoutRound,
  startEuropeanSeason,
} from "./european";
import {
  dailyRecovery,
  applyMatchFatigue,
  nudgeForm,
  applySeasonDevelopment,
  mentorGrowthBonus,
  weeklyProgressTick,
} from "./development";
import {
  weeklyEconomyTick,
  applySeasonPrizes,
  applyAiSeasonSubsidy,
  applyAiSurplusReinvestment,
  matchUpgradeIncome,
} from "./economy";
import { gcnWeeklyTick } from "./gcn";
import {
  aiWeeklyTransferTick,
  refreshValues,
  simLeagueTransferWindow,
  playableLeagueTransferWindow,
  ensureFieldableSquad,
  ensureAiSquads,
  aiRecruitYouth,
  releaseAgedOutWorldwide,
} from "./transfers";
import { activePlayers, pruneRetired } from "./archive";
import { tickInactivity } from "./consent";
import { rotationContextFor, rotationMultiplier } from "./rotation";
import { refreshClubStances, reviewClubTactics } from "./ai/strategy";
import { rolloverContracts, ensureContracts, openContractResolution, repriceSquadForLeague } from "./contracts";
import { resolveSimLeagues } from "./simresolver";
import { buildSeasonSummary, trackBiggestWin } from "./recordbook";
import { ACCOLADE_META, runSeasonAwardsCeremony } from "./accolades";
import { trackUserMatch, trackRollover, syncProgress, userPlayerAwardsIn, achievementTitles } from "./achievements";
import {
  generateStaffMarket,
  refreshStaffMarket,
  accrueBadgeSeasons,
  ageStaff,
  growthMultiplier,
  eliteResistRelief,
  staffWageMultiplier,
  archetypeClassGrowthMultiplier,
} from "./facilities";
import { deriveArchetype } from "./config/archetype";
import { rolloverConversions } from "./archetypedev";
import { FACILITY_MAP } from "./config/facilities";
import { scoutMarketTick, refreshScoutMarketFull } from "./scouts";
import {
  refreshAiCommercial,
  refreshSponsorOffers,
  rolloverSponsors,
  settleSponsorBonuses,
} from "./sponsors";
import { getFormation } from "./config/formations";
import {
  runU21MatchDay,
  dailyScoutTick,
  weeklyLoanTick,
  loanMidseasonReports,
  academyPreDevRollover,
  academyPostDevRollover,
  graduateAwardNews,
  pruneGraduateQueue,
  pendingGraduates,
} from "./academy";

const cfg = TUNING;

export type StopReason =
  | { kind: "matchday"; fixtureId: string }
  | { kind: "offer" }
  | { kind: "seasonEnd" }
  /** The dead-week contract round opened (v1.51): `count` deals need resolving
   * before the season closes. The loop stops here so the prompt can't be
   * fast-forwarded past — losing a squad to admin is exactly what it prevents. */
  | { kind: "contracts"; count: number }
  | { kind: "gate"; gate: CalendarGate } // a calendar "simulate ahead" hit an important day
  | { kind: "idle" }; // safety valve

/**
 * An important calendar day a "simulate ahead" should not silently skip over
 * (§3). When the user fast-forwards several days at once, the loop pauses the day
 * BEFORE one of these so they can act on it — register a youth side, shop a
 * window that's about to open, or get a deal done before one closes — rather than
 * blowing past it. Each gate is a one-off per calendar day, deduped by `id`.
 */
export interface CalendarGate {
  /** The day the important thing happens; the sim pauses the day before it. */
  day: number;
  /** Stable id so the same gate isn't offered twice on the same day. */
  id: string;
  title: string;
  body: string;
  /** Where to send the user to act on it, if anywhere. */
  screen?: import("./types").ScreenId;
}

/**
 * The first important day strictly after `fromDay` and on/before `targetDay`
 * that a fast-forward should pause at — or null if the stretch is clear. Only
 * gates the user can still do something about are returned:
 *  - a U21 registration deadline they haven't met yet,
 *  - a transfer window about to open (a chance to shop),
 *  - a transfer window about to close (last chance to act),
 *  - the youth intake day (a class is about to arrive).
 *
 * Pure over the state it reads; the loop calls it, never mutates through it.
 */
export function nextCalendarGate(state: GameState, fromDay: number, targetDay: number): CalendarGate | null {
  const sched = state.schedule;
  const gates: CalendarGate[] = [];
  const push = (day: number, id: string, title: string, body: string, screen?: import("./types").ScreenId) => {
    if (day > fromDay && day <= targetDay) gates.push({ day, id, title, body, screen });
  };

  // U21 registration deadline — only if the user still needs to act (window open,
  // not yet registered, not already forfeited). Pausing exactly on the deadline
  // still leaves the day to register.
  const u21 = state.academy?.u21;
  if (u21 && !u21.forfeited && u21.registrationDay !== undefined && (u21.registered?.length ?? 0) === 0) {
    push(
      u21.registrationDay,
      `u21reg:${state.season}:${u21.half ?? 0}`,
      "U21 registration closing",
      "The registration deadline for the U21 competition is here. Submit your seven prospects on the Academy screen before it closes, or a drawn side takes your entry.",
      "academy"
    );
  }

  // Winter window opens — a fresh chance to shop, with updated sim tables.
  push(
    sched.winterOpenDay,
    `winOpen:${state.season}`,
    "Winter transfer window opens",
    "The winter window is about to open. Sim leagues have refreshed tables and form to shop against — a chance to strengthen for the run-in.",
    "transfers"
  );

  // Windows about to close — last chance to get a deal over the line.
  push(
    sched.summerCloseDay,
    `sumClose:${state.season}`,
    "Summer window closing",
    "The summer transfer window is about to close. Get any remaining business done — deals won't resume until the winter window.",
    "transfers"
  );
  push(
    sched.winterCloseDay,
    `winClose:${state.season}`,
    "Winter window closing",
    "The winter transfer window is about to close. This is your last chance to buy or sell until the summer.",
    "transfers"
  );

  if (!gates.length) return null;
  // Earliest gate first; the sim pauses the day before it.
  gates.sort((a, b) => a.day - b.day);
  return gates[0];
}

export function matchSeed(state: GameState, fixture: Fixture): number {
  return deriveSeed(state.seed, `match:${state.season}:${fixture.id}:${hashString(fixture.homeId + fixture.awayId)}`);
}

function sideInputFor(
  state: GameState,
  teamId: string,
  fixedLineup?: { slotId: string; player: import("./types").PlayerBio }[],
  /** The fixture being played (v1.66) — drives pre-match rotation: fitness,
   * fixture congestion and whether this is a low-priority cup tie. Omitted, the
   * side is picked on pure merit exactly as before. */
  fixture?: Fixture
) {
  const t = state.teams[teamId];
  // players out on loan (§18) are away and can't be fielded by their owner
  const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
  // v1.79: the Head/Assistant Coach match-day edge went with the old staff
  // system. Match-day rating has no facility yet, so every side plays on its
  // merits until one is designed to own it.
  const coachMult = 1;
  // Only the user sets assignments (captain + set-piece takers); AI sides field none.
  const assignments = teamId === state.userTeamId ? t.assignments : undefined;
  // Only the user picks a bench (v25); AI sides auto-derive theirs.
  const fixedBench = teamId === state.userTeamId ? state.userBench : undefined;
  // Pre-match rotation (v1.66). Applies to any auto-picked side — every AI club,
  // and the user's when they haven't named an XI themselves. `buildSideInput`
  // ignores the weight entirely when a fixed lineup is supplied, so a manager who
  // picked his own team always gets it.
  const weight = fixture
    ? (() => {
        const ctx = rotationContextFor(state, teamId, fixture, cfg);
        return (p: import("./types").PlayerBio) => rotationMultiplier(state, p, ctx, cfg);
      })()
    : undefined;
  return buildSideInput(
    teamId,
    t.name,
    t.short,
    players,
    t.tactic,
    cfg,
    fixedLineup,
    coachMult,
    assignments,
    fixedBench,
    weight
  );
}

/** Apply a finished match to the world: stats, fatigue, form, table data. */
export function applyMatchResult(state: GameState, fixture: Fixture, result: MatchResult) {
  fixture.played = true;
  fixture.homeGoals = result.homeGoals;
  fixture.awayGoals = result.awayGoals;
  fixture.scorers = result.scorers.map(({ playerId, teamId, minute, assistId }) => ({ playerId, teamId, minute, assistId }));
  // Keep the team stat line for the Match History tab (v11). The event log and
  // per-player ratings are intentionally dropped — see MatchDetail.
  fixture.detail = {
    possession: result.stats.possession,
    shots: result.stats.shots,
    onTarget: result.stats.onTarget,
  };

  // cup ties can't end level — settle on penalties
  if (fixture.competition === "CUP" && result.homeGoals === result.awayGoals) {
    const rng = mulberry32(matchSeed(state, fixture) ^ 0x5f5f);
    fixture.shootoutWinnerId = rng() < 0.55 ? fixture.homeId : fixture.awayId;
  }

  for (const [pid, mins] of Object.entries(result.minutes)) {
    const p = state.players[pid];
    if (!p || mins <= 0) continue;
    p.stats.apps += 1;
    p.stats.minutes += mins;
    applyMatchFatigue(p, mins, cfg);
    const rating = result.ratings[pid] ?? 6.5;
    p.stats.ratingSum += rating;
    nudgeForm(p, rating, cfg);
  }
  for (const s of result.scorers) {
    const scorer = state.players[s.playerId];
    if (scorer) scorer.stats.goals += 1;
    if (s.assistId && state.players[s.assistId]) state.players[s.assistId].stats.assists += 1;
  }
  // Clean sheets (v1.54): a keeper who appeared in a match his side kept clean
  // banks one. Credited from the fixture's scoreline against the player's club,
  // so a keeper subbed on into a shut-out earns it just as a full-match one does.
  const concededBy = (clubId: string | null) =>
    clubId === fixture.homeId ? result.awayGoals : clubId === fixture.awayId ? result.homeGoals : null;
  for (const pid of Object.keys(result.minutes)) {
    const p = state.players[pid];
    if (!p || (result.minutes[pid] ?? 0) <= 0 || p.positions[0] !== "GK") continue;
    if (concededBy(p.clubId) === 0) p.stats.cleanSheets = (p.stats.cleanSheets ?? 0) + 1;
  }
  trackBiggestWin(state, fixture, result.homeGoals, result.awayGoals);

  // Manager accolades (v1.45): record the user club's own matches from their
  // perspective, then refresh the live high-water marks and unlock any newly-met
  // achievement. AI-vs-AI fixtures never touch the manager's ledger.
  const userIsHome = fixture.homeId === state.userTeamId;
  if (userIsHome || fixture.awayId === state.userTeamId) {
    const own = userIsHome ? result.homeGoals : result.awayGoals;
    const opp = userIsHome ? result.awayGoals : result.homeGoals;
    trackUserMatch(state, own, opp);
    // Match-day income upgrades (v43): the Stadium Bonus for playing at home and
    // the Performance Bonus for the result. Banked here, when the fixture is
    // played, rather than on the weekly tick — they're per-match lump sums, and
    // a club plays a varying number of matches in a week.
    // The fixture is passed so a derby can pay (v1.94): a rivalry multiplies
    // these two upgrade tracks and nothing else. `rivalryMatchMultiplier` is 1
    // for every ordinary match, so this is unchanged for a save with no rivals.
    state.teams[state.userTeamId].budget += matchUpgradeIncome(state, state.userTeamId, userIsHome, own, opp, cfg, fixture);
    // Keep the head-to-head ledger. Stored rather than counted off fixtures,
    // because the fixtures of a season five years ago are long gone — and it is
    // what stamps `lastMetSeason`, which keeps a live rivalry out of dormancy.
    recordRivalryMeeting(state, userIsHome ? fixture.awayId : fixture.homeId, own, opp);
    syncProgress(state);
  }
}

function simAiFixture(state: GameState, fixture: Fixture) {
  const home = sideInputFor(state, fixture.homeId, undefined, fixture);
  const away = sideInputFor(state, fixture.awayId, undefined, fixture);
  const result = simulateMatch(home, away, cfg, matchSeed(state, fixture));
  applyMatchResult(state, fixture, result);
}

function pushInbox(state: GameState, type: import("./types").InboxItem["type"], title: string, body: string) {
  state.inbox.unshift({ id: uid("inb"), day: state.currentDay, season: state.season, type, title, body, read: false });
  state.inbox = state.inbox.slice(0, 120);
}

/**
 * Draw the next cup round as soon as the bracket is known (v1.92).
 *
 * This used to fire only on the round's own matchday — `cupRoundDays.indexOf(currentDay)`
 * — so the quarter-final could finish in the afternoon and the semi-final draw
 * would not exist until the morning of the semi-final itself, weeks later. The
 * manager could not see who he had drawn, and nor could anything else: the tie
 * simply wasn't in `state.fixtures` yet.
 *
 * Nothing required that delay. `drawCupRound` takes the round's day from the
 * SCHEDULE rather than from today, and draws from `state.cup.aliveTeamIds`,
 * which `maybeSettleCup` finalises the moment the previous round's last tie is
 * played. So the only real precondition is that the bracket has advanced —
 * which is exactly `state.cup.currentRound`. Drawing the moment that becomes
 * true is both earlier and simpler than waiting for a date.
 *
 * The draw stays deterministic: `drawCupRound` seeds off the season and round
 * index, never off the day it happens to be called on, so drawing early
 * produces the identical bracket.
 */
function ensureCupRound(state: GameState) {
  const idx = state.cup.currentRound;
  // Bracket finished, or a save whose schedule doesn't reach this round.
  if (idx < 0 || idx >= state.schedule.cupRoundDays.length) return;
  if (state.cup.winnerId) return;
  // Never draw a round before the season has actually started running — the
  // first round waits for its own day so a fresh save doesn't open with a cup
  // tie already on the fixture list before the league has kicked off.
  if (idx === 0 && state.currentDay < state.schedule.cupRoundDays[0]) return;
  if (state.fixtures.some((f) => f.competition === "CUP" && f.round === idx + 1)) return;

  const fixtures = drawCupRound(state, idx, state.seed);
  if (!fixtures.length) return;
  state.fixtures.push(...fixtures);
  const userTie = fixtures.find((f) => f.homeId === state.userTeamId || f.awayId === state.userTeamId);
  if (userTie) {
    const opp = userTie.homeId === state.userTeamId ? state.teams[userTie.awayId] : state.teams[userTie.homeId];
    const when = formatDayShort(state.schedule.cupRoundDays[idx]);
    state.news.unshift(`Cup ${state.cup.roundNames[idx]}: drawn against ${opp.name} — ${when}.`);
    pushInbox(
      state,
      "news",
      `Cup ${state.cup.roundNames[idx]} draw`,
      `${state.teams[state.userTeamId].name} have been drawn against ${opp.name} in the ${state.cup.roundNames[idx]}, ` +
        `to be played on ${when}.`
    );
  }
}

/** Settle a cup round once every one of its fixtures has been played. */
export function maybeSettleCup(state: GameState) {
  const idx = state.cup.currentRound;
  if (idx >= state.schedule.cupRoundDays.length) return;
  const roundFixtures = state.fixtures.filter((f) => f.competition === "CUP" && f.round === idx + 1);
  // A round with no ties at all (a field already down to one club) must still
  // advance, or `currentRound` never moves and the cup stalls short of a winner.
  const drawn = state.currentDay >= state.schedule.cupRoundDays[idx];
  if (!roundFixtures.length && !drawn) return;
  if (roundFixtures.length && !roundFixtures.every((f) => f.played)) return;

  // shootout winners replace "losers" logic: eliminate the non-winner of level ties
  const losers = new Set<string>();
  for (const f of roundFixtures) {
    let winner: string;
    if (f.homeGoals! > f.awayGoals!) winner = f.homeId;
    else if (f.homeGoals! < f.awayGoals!) winner = f.awayId;
    else winner = f.shootoutWinnerId ?? f.homeId;
    losers.add(winner === f.homeId ? f.awayId : f.homeId);
  }
  state.cup.aliveTeamIds = state.cup.aliveTeamIds.filter((id) => !losers.has(id));
  state.cup.currentRound = idx + 1;

  // Crown the winner as soon as one club is left standing, or when the last
  // scheduled round has been played. Keying only on "last round AND exactly one
  // alive" left the cup with no winner whenever the bracket didn't reduce to one
  // — which is exactly what happened on a pyramid the six rounds couldn't play
  // down (see cupPrelimTies). The bracket is trimmed properly now, so the first
  // clause is the normal path; the second is the belt-and-braces one, and it
  // takes the surviving club with the best run rather than leaving the trophy
  // unawarded.
  const alive = state.cup.aliveTeamIds;
  const lastRound = idx === state.schedule.cupRoundDays.length - 1;
  if (alive.length === 1 || (lastRound && alive.length > 0)) {
    state.cup.winnerId =
      alive.length === 1
        ? alive[0]
        : alive.slice().sort((a, b) => (state.teams[b]?.reputation ?? 0) - (state.teams[a]?.reputation ?? 0))[0];
    const winner = state.teams[state.cup.winnerId];
    state.news.unshift(`${winner.name} win the Cup!`);
    if (state.cup.winnerId === state.userTeamId) {
      pushInbox(state, "board", "CUP WINNERS!", `${winner.name} have won the Cup. The board is delighted — a ${fmtM(cfg.cupWinBonus)} bonus lands in the budget at season's end.`);
    }
  }
}

function fmtM(n: number): string {
  return `£${(n / 1_000_000).toFixed(0)}M`;
}

// ── European cups (v1.51) ────────────────────────────────────────────────
// The three continental competitions advance on the same day-tick the domestic
// cup does. The group stage's fixtures are all created up front (at the
// rollover), so the only thing to drive here is the knockout bracket.
//
// v1.92: a round is drawn as soon as the one before it has produced all its
// winners, rather than on the morning of its own first leg. Same change, and the
// same reasoning, as the domestic cup above — `drawKnockoutRound` takes its days
// from `euroRoundDays` and seeds off season/tier/round, never off the day it is
// called, so an early draw yields the identical bracket and simply lets the
// manager see who he faces when the previous tie ends.

/** Draw every European knockout round whose bracket is now known. */
function ensureEuropeanRounds(state: GameState) {
  const euro = state.european;
  const days = state.schedule.euroRoundDays;
  if (!euro?.cups.length || !days) return;

  for (const cup of euro.cups) {
    // Walk forward from the R16: each round is drawable once its predecessor has
    // settled, so several may become available at once on a save loaded mid-run.
    for (let round = 0; round <= 3; round++) {
      // Already drawn — don't duplicate the bracket.
      if (cup.ties.some((t) => t.round === round)) continue;
      if (round === 0) {
        // The group stage must be complete before the R16 can be drawn from it.
        // `groupQualifiers` reads the tables, so they have to be current first.
        const groupDays = days.slice(0, 6);
        const groupsDone = state.fixtures
          .filter((f) => f.competition === euroCompetitionId(cup.tier) && groupDays.includes(f.day))
          .every((f) => f.played);
        if (!groupsDone) break;
        refreshGroupTables(state, cup);
        recordGroupExits(cup);
      } else if (!cup.ties.filter((t) => t.round === round - 1).every((t) => t.winnerId)) {
        // Every previous round must have produced its winners first.
        break;
      }
      const fixtures = drawKnockoutRound(state, cup, round);
      if (!fixtures.length) break;
      state.fixtures.push(...fixtures);
      cup.currentRound = 6 + round;

      const userTie = fixtures.find((f) => f.homeId === state.userTeamId || f.awayId === state.userTeamId);
      if (userTie) {
        const oppId = userTie.homeId === state.userTeamId ? userTie.awayId : userTie.homeId;
        state.news.unshift(
          `${cup.name} ${EURO_KO_ROUND_NAMES[round]}: ${state.teams[state.userTeamId].name} drawn against ${state.teams[oppId]?.name ?? "—"}.`
        );
        pushInbox(
          state,
          "news",
          `${cup.name} ${EURO_KO_ROUND_NAMES[round]} draw`,
          `${state.teams[state.userTeamId].name} face ${state.teams[oppId]?.name ?? "—"} in the ` +
            `${cup.name} ${EURO_KO_ROUND_NAMES[round]}, first leg ${formatDayShort(userTie.day)}.`
        );
      }
    }
  }
}

/** Settle any European ties whose legs are all played, and crown a champion. */
export function maybeSettleEuropean(state: GameState) {
  const euro = state.european;
  if (!euro?.cups.length) return;
  for (const cup of euro.cups) {
    // Group tables stay live all the way through the group stage.
    refreshGroupTables(state, cup);
    for (let round = 0; round <= 3; round++) {
      if (!cup.ties.some((t) => t.round === round)) continue;
      settleKnockoutRound(state, cup, round);
    }
    if (cup.winnerId && !cup.announced) {
      cup.announced = true;
      const winner = state.teams[cup.winnerId];
      state.news.unshift(`${winner?.name ?? "—"} win the ${cup.name}!`);
      if (cup.winnerId === state.userTeamId) {
        const prize = cfg.europeanCupPrizeByTier[cup.tier - 1]?.champion ?? 0;
        pushInbox(
          state,
          "board",
          `${cup.name.toUpperCase()} WINNERS!`,
          `${winner.name} are champions of Europe. The board is ecstatic — a ${fmtM(prize)} prize lands in the budget at season's end.`
        );
      }
    }
  }
}

/** Advance exactly one day. Returns a stop reason if the player is needed. */
function advanceDay(state: GameState): StopReason | null {
  state.currentDay += 1;
  const day = state.currentDay;
  const sched = state.schedule;

  dailyRecovery(state, cfg);

  if (isMonday(day)) {
    const beforeBudget = state.teams[state.userTeamId].budget;
    weeklyEconomyTick(state, cfg);
    // The network's own week: commercial income, then standing funding orders.
    // Owned clubs sit in sim leagues, which weeklyEconomyTick skips.
    gcnWeeklyTick(state, cfg);
    if (beforeBudget >= 0 && state.teams[state.userTeamId].budget < 0) {
      pushInbox(
        state,
        "board",
        "The accounts are in the red",
        "Weekly expenses now exceed income and the budget has gone negative. The board expects you to balance the books — sell players, trim the wage bill, or climb the table to raise income."
      );
    }
    // In-season progression (v19): ratings drift week to week off minutes and
    // performance, so a breakout campaign is visible while it happens rather
    // than only at the summer rollover.
    weeklyProgressTick(
      state,
      cfg,
      mulberry32(deriveSeed(state.seed, `progress:${state.season}:${day}`)),
      () => growthMultiplier(state, state.userTeamId),
      () => eliteResistRelief(state, state.userTeamId)
    );
    // Expectation decay (v1.66): players who aren't getting minutes, and free
    // agents, accrue inactivity — which gradually widens how far down the pyramid
    // they'll drop and how much of their wage floor they'll give up. Run before
    // the market tick so this week's transfers see this week's desperation.
    tickInactivity(state, activePlayers(state), 7, cfg);
    const offerLanded = aiWeeklyTransferTick(state, cfg);
    if (offerLanded) return { kind: "offer" };
  }

  // window boundary news + sim league resolution before each window (§4)
  if (day === sched.simResolveDay1) resolveSimLeagues(state, 1, cfg);
  if (day === sched.simResolveDay2) resolveSimLeagues(state, 2, cfg);
  // Dead-week awards ceremony (v1.44): the day after the last game, with the
  // tables final and no fixtures left, the season's honours are handed out — a
  // week before END SEASON closes the campaign.
  if (sched.accoladesDay !== undefined && day === sched.accoladesDay) runSeasonAwardsCeremony(state);
  // Contract round (v1.51): the day after the honours, every expiring deal on
  // the user's books is put to them. Stopping the loop here is the whole point —
  // the previous behaviour let a squad walk away for nothing while the manager
  // held Continue. Handled below (after fixtures) so it can't pre-empt a match.
  let contractsOpened = 0;
  if (sched.contractResolveDay !== undefined && day === sched.contractResolveDay) {
    contractsOpened = openContractResolution(state);
  }
  if (day === sched.winterOpenDay) {
    refreshValues(state, cfg);
    // Clubs reassess their season and set a market stance for the window (§10).
    refreshClubStances(state, cfg);
    // Sim (non-playable) leagues do their own window's business now (v1.44), so
    // foreign squads visibly turn over between windows rather than staying frozen.
    simLeagueTransferWindow(state, cfg);
    // The user's own division rivals do theirs too (v1.51) — otherwise the only
    // frozen market in the world would be the one the user can actually see.
    playableLeagueTransferWindow(state, cfg);
    pushInbox(state, "window", "Winter transfer window open", "The winter window is open until 1 February. Sim leagues have updated tables and form to browse.");
    loanMidseasonReports(state);
  }

  // Scouting department shortlist tops itself back up the same way (v14).
  scoutMarketTick(state, cfg);
  // Periodic full turnover of both for-hire pools (v20): every marketRefreshDays
  // the shortlists cycle so they never go stale between hires.
  if (state.marketRefreshDay !== undefined && day >= state.marketRefreshDay) {
    refreshStaffMarket(state, deriveSeed(state.seed, `staffmkt:${day}`), cfg);
    refreshScoutMarketFull(state, cfg);
    state.marketRefreshDay = day + cfg.marketRefreshDays;
  }
  // Sponsorship offers land in any empty slot (v6, Club → Income).
  refreshSponsorOffers(state, cfg);

  // Youth Academy (§18): all background — none of this stops the loop
  runU21MatchDay(state, cfg);
  dailyScoutTick(state, cfg);
  if (isMonday(day)) weeklyLoanTick(state, cfg);
  // No annual intake class (v1.89): the academy is filled only by moves the
  // manager makes — a scout's find or a U21 opponent's prospect, both paid for.
  // A yearly crop that arrived on its own put players on the books nobody chose,
  // which is the same complaint the graduate queue answers at the other end.
  if (day === sched.summerCloseDay || day === sched.winterCloseDay) {
    pushInbox(state, "window", "Transfer window closed", "The window has closed. Deals resume when the next window opens.");
  }

  ensureCupRound(state);
  // European knockout draws happen the morning of their matchday, so the ties
  // exist before the day's fixtures are collected below.
  ensureEuropeanRounds(state);

  // today's fixtures
  const todays = state.fixtures.filter((f) => f.day === day && !f.played);
  const userFixture = todays.find((f) => f.homeId === state.userTeamId || f.awayId === state.userTeamId);

  // sim all AI fixtures first so tables are current when the user plays
  for (const f of todays) {
    if (f === userFixture) continue;
    simAiFixture(state, f);
  }
  if (userFixture) {
    state.pendingMatchFixtureId = userFixture.id;
    return { kind: "matchday", fixtureId: userFixture.id };
  }
  maybeSettleCup(state);
  // Draw the next round the instant the bracket advances (v1.92), rather than
  // waiting for tomorrow's tick to notice. Settling the quarter-finals and then
  // drawing the semi-final is one continuous act as far as the manager is
  // concerned, so today's result should put today's draw on the fixture list.
  ensureCupRound(state);
  maybeSettleEuropean(state);
  ensureEuropeanRounds(state);

  // The contract round opened today and has decisions in it — hand the day back
  // so the UI can prompt. Nothing else happens on this day (the dead week has no
  // fixtures), so this can't swallow a matchday.
  if (contractsOpened > 0) return { kind: "contracts", count: contractsOpened };

  // The season ends *at* this day — park here and let the player press END
  // SEASON. Rolling over inline would silently rebuild the world (new fixtures,
  // currentDay back to Jul 1) under a player who only asked to advance a day.
  if (day >= sched.seasonEndDay) return { kind: "seasonEnd" };
  return null;
}

/** True once the calendar has reached season end — the Continue button becomes
 * END SEASON and the day can no longer advance until the rollover is taken. */
export function isSeasonComplete(state: GameState): boolean {
  return state.currentDay >= state.schedule.seasonEndDay;
}

/** The Continue button: fast-forward to the next meaningful day. */
export function advanceUntilEvent(state: GameState): StopReason {
  if (isSeasonComplete(state)) return { kind: "seasonEnd" };
  for (let i = 0; i < 420; i++) {
    const stop = advanceDay(state);
    if (stop) return stop;
  }
  return { kind: "idle" };
}

/** Advance exactly one calendar day (the "Advance 1 Day" control). Returns the
 * day's stop reason if it needs the player (matchday / offer / season end), else
 * `idle` — the day was quiet but time still moved. Reuses all the per-day
 * machinery so nothing important (a transfer window, an intake) can be skipped. */
export function advanceOneDay(state: GameState): StopReason {
  if (isSeasonComplete(state)) return { kind: "seasonEnd" };
  return advanceDay(state) ?? { kind: "idle" };
}

/**
 * Calendar "simulate to this day" (EA-FC style, forced): fast-forward straight
 * to `targetDay`, auto-playing the user's own matches with their saved lineup
 * and swallowing transfer-offer interrupts along the way. Stops early only at a
 * season rollover (the world is a different shape after) or if we somehow blow
 * past a safety bound. `targetDay` is inclusive of that day's fixtures.
 *
 * Progress gate (§3): a multi-day jump won't silently skip an important calendar
 * day (a U21 registration deadline, a window opening or closing, the youth
 * intake). When one falls inside the span, the sim pauses the day BEFORE it and
 * returns a `gate` stop so the UI can surface it — the user then acts and
 * continues past it. Pass `ignoreGate` (the same target the gate stopped at) to
 * carry on THROUGH a gate the user has acknowledged, so "keep going" doesn't get
 * caught on the same day forever.
 */
export function advanceToDay(state: GameState, targetDay: number, ignoreGate?: string): StopReason {
  if (isSeasonComplete(state)) return { kind: "seasonEnd" };
  // Never sim across the season boundary: the rollover rebuilds fixtures and
  // resets currentDay, so anything past this day belongs to a different world.
  // The player takes that step deliberately via END SEASON.
  const hardLimit = Math.min(targetDay, state.schedule.seasonEndDay);

  // Find the first important day in the span and pause the day before it, unless
  // it's the one the user just acknowledged (then it no longer gates this jump).
  let gate = nextCalendarGate(state, state.currentDay, hardLimit);
  if (gate && gate.id === ignoreGate) {
    // Look past the acknowledged gate for the NEXT one, so a jump spanning two
    // deadlines still pauses at the second.
    gate = nextCalendarGate(state, gate.day, hardLimit);
  }
  // Pause the day before the gate (but never before where we already are).
  const limit = gate ? Math.max(state.currentDay, Math.min(hardLimit, gate.day - 1)) : hardLimit;

  let guard = 0;
  while (state.currentDay < limit && guard++ < 420) {
    const stop = advanceDay(state);
    if (!stop) continue;
    if (stop.kind === "matchday") {
      // auto-play the user's match with their current lineup, then continue
      const fixture = state.fixtures.find((f) => f.id === stop.fixtureId);
      if (fixture) autoPlayUserFixture(state, fixture);
      state.pendingMatchFixtureId = null;
      maybeSettleCup(state);
      maybeSettleEuropean(state);
    } else if (stop.kind === "offer") {
      // ignore offers when force-simming; they remain in the inbox to handle later
      continue;
    } else {
      // seasonEnd / contracts / idle — hard stop, the calendar can't span it.
      // The contract round in particular must never be force-simmed past: the
      // whole point is that expiring deals get a decision.
      return stop;
    }
  }
  if (isSeasonComplete(state)) return { kind: "seasonEnd" };
  // Reached the day before a gate without hitting a harder stop — surface it.
  if (gate && state.currentDay >= limit && state.currentDay < hardLimit) {
    return { kind: "gate", gate };
  }
  return { kind: "idle" };
}

/** Simulate the user's fixture headlessly using their saved (or auto-filled) lineup. */
function autoPlayUserFixture(state: GameState, fixture: Fixture) {
  const userIsHome = fixture.homeId === state.userTeamId;
  const userLineup = ensureUserLineup(state);
  const userSide = sideInputFor(state, state.userTeamId, userLineup, fixture);
  const oppId = userIsHome ? fixture.awayId : fixture.homeId;
  const oppSide = sideInputFor(state, oppId, undefined, fixture);
  const home = userIsHome ? userSide : oppSide;
  const away = userIsHome ? oppSide : userSide;
  const result = simulateMatch(home, away, cfg, matchSeed(state, fixture));
  applyMatchResult(state, fixture, result);
}

/** Called by the UI after the user's match result has been applied. Never rolls
 * the season over on its own — if this was the final day, the loop parks and the
 * player takes the rollover explicitly with END SEASON. */
export function afterUserMatch(state: GameState) {
  state.pendingMatchFixtureId = null;
  maybeSettleCup(state);
  // The user's own cup tie is usually the last one of the round to be settled,
  // so this is the call that actually produces the next draw (v1.92) — without
  // it the manager would finish a quarter-final and still not know his opponent
  // until the loop ticked past midnight.
  ensureCupRound(state);
  maybeSettleEuropean(state);
  ensureEuropeanRounds(state);
}

// ── Season rollover (§3 off-season, §13 compression) ─────────────────────

/** The titles of every honour a player won THIS season (v24), for the career
 * row. Team-of-the-Season slots collapse into one line so a row reads "Team of
 * the Season" once rather than four times. Derived from the accolades already
 * stamped by buildSeasonSummary earlier in the rollover. */
function seasonAwardTitles(p: import("./types").PlayerBio, season: number): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const a of p.accolades ?? []) {
    if (a.season !== season) continue;
    if (seen.has(a.type)) continue;
    seen.add(a.type);
    titles.push(ACCOLADE_META[a.type].title);
  }
  return titles;
}

function appendCareerRows(state: GameState) {
  for (const p of activePlayers(state)) {
    if (p.stats.apps === 0 && !p.clubId) {
      p.stats = { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 };
      continue;
    }
    if (!state.careers[p.id]) state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
    const clubName = p.clubId ? state.teams[p.clubId].name : "Free agent";
    const compName = p.clubId ? state.leagues[state.teams[p.clubId].leagueId]?.name ?? "—" : "—";
    state.careers[p.id].seasons.push({
      season: state.season,
      clubName,
      clubId: p.clubId ?? undefined,
      competition: compName,
      // Where his rating STARTED this season (v1.63). This runs before the
      // summer development pass re-stamps the baseline, so the field still
      // holds the season that just finished.
      startOverall: p.seasonStartOverall,
      apps: p.stats.apps,
      goals: p.stats.goals,
      assists: p.stats.assists,
      avgRating: p.stats.apps ? Math.round((p.stats.ratingSum / p.stats.apps) * 100) / 100 : 0,
      awards: seasonAwardTitles(p, state.season),
      cleanSheets: p.stats.cleanSheets || undefined,
    });
    // youth football gets its own history line (§18): U21 league or loan spell
    const ys = p.youthStats;
    if (ys && ys.apps > 0) {
      const loanClubId = p.loan?.toClubId;
      const loanClub = loanClubId ? state.teams[loanClubId]?.name : null;
      state.careers[p.id].seasons.push({
        season: state.season,
        clubName: loanClub ?? clubName,
        // The club actually played for — the loan destination on a loan row.
        clubId: (loanClub ? loanClubId : p.clubId) ?? undefined,
        competition: loanClub ? `Loan from ${clubName}` : "U21 League",
        startOverall: p.seasonStartOverall,
        apps: ys.apps,
        goals: ys.goals,
        assists: ys.assists,
        avgRating: Math.round((ys.ratingSum / ys.apps) * 100) / 100,
        awards: [],
      });
    }
  }
}

export function runSeasonRollover(state: GameState) {
  const summary = buildSeasonSummary(state);

  // Settle sponsor performance bonuses (v44) against the finish just recorded —
  // here, while the summary still describes the season being closed out and
  // before promotion/relegation moves the club. A deal signed on bonus terms
  // pays out in each season of its term the club hits the target.
  settleSponsorBonuses(state, summary.userPosition ?? 0);

  // prizes before promotion shuffle (based on final tables)
  applySeasonPrizes(state, cfg);
  // Continental prize money (v1.51), paid on how far each club went. Must run
  // before the European state is rebuilt for the new season below, since that
  // clears the exit stages this reads.
  const euroPrizes = applyEuropeanPrizes(state, cfg);
  // With the season's income all banked, write off the surplus every AI club is
  // sitting on as reinvestment in the club (v1.67). Runs here — after the prizes,
  // before the new season's grant — so it measures the cash pile a full season
  // actually left behind, and stops AI budgets compounding without limit.
  applyAiSurplusReinvestment(state, cfg);

  // history first, while stats are intact
  appendCareerRows(state);

  // Where every club finished, captured while the tables are still readable
  // (v1.92). The promotion shuffle below rewrites league membership, after which
  // this season's fixtures no longer describe the divisions they belong to — so
  // the standings have to be taken now and the drift applied afterwards.
  const finishes = collectSeasonFinishes(state);

  const move = applyPromotionRelegation(state);
  const { promoted, relegated } = move;
  summary.promoted = promoted;
  summary.relegated = relegated;
  summary.promotedIds = move.promotedIds;
  summary.relegatedIds = move.relegatedIds;
  summary.promotedFrom = move.promotedFrom;
  summary.promotedTo = move.promotedTo;
  summary.relegatedFrom = move.relegatedFrom;
  summary.relegatedTo = move.relegatedTo;

  // Wages follow the division (v1.65). A club that just went down would
  // otherwise carry top-flight contracts into a tier whose income can't cover
  // them, and a promoted club would field a squad paid at the level it left.
  move.promotedIds.forEach((id, i) => {
    repriceSquadForLeague(state, id, move.promotedFrom[i], move.promotedTo[i], cfg);
  });
  move.relegatedIds.forEach((id, i) => {
    repriceSquadForLeague(state, id, move.relegatedFrom[i], move.relegatedTo[i], cfg);
  });
  state.recordBook.seasons.push(summary);
  graduateAwardNews(state);

  // Modern rivalries (v1.94). Runs immediately after the summary is filed and
  // never before: `formRivalries` reads the record book's LAST season, so
  // running it any earlier would judge the rivalry on the season before this
  // one. Nothing else in the rollover depends on it, which is why it can sit
  // here rather than being threaded through the market passes below — a rivalry
  // formed this summer starts paying on the fixtures of the season about to
  // begin, which is exactly when the manager will be looking for it.
  for (const formed of formRivalries(state, cfg)) {
    pushInbox(state, "news", formed.title, formed.rivalry.story);
  }

  // Manager accolades (v1.45): fold this season's honours into the manager's
  // ledger while the summary is fresh and the club is still in the division it
  // just played. `syncProgress` (run below, after values settle) then unlocks any
  // newly-met achievement. `promoted` is club NAMES; match on the user's name.
  const userName = state.teams[state.userTeamId].name;
  const userLeague = state.teams[state.userTeamId].leagueId;
  trackRollover(state, {
    wonLeague: summary.championsByLeague[userLeague]?.teamId === state.userTeamId,
    wonCup: summary.cupWinner?.teamId === state.userTeamId,
    promoted: promoted.includes(userName),
    playerAwards: userPlayerAwardsIn(state, summary.accolades),
  });

  if (promoted.includes(state.teams[state.userTeamId].name)) {
    state.teams[state.userTeamId].budget += cfg.promotionBonus;
    // Read the destination off the club's post-shuffle league, not divisionIds[0]
    // — on a 3-tier ladder promotion may only be a step up to the second tier.
    const upName = state.leagues[state.teams[state.userTeamId].leagueId]?.name ?? "the division above";
    pushInbox(state, "board", "PROMOTED!", `Promotion to ${upName}! The board adds ${fmtM(cfg.promotionBonus)} to your budget.`);
  }

  // Loan reviews + fold youth/loan minutes into development inputs (§18).
  // Must run after career rows are written, before the development pass. Returns
  // the academy growth boosts (loan/U21/focus), which the pass below applies.
  const academyBonuses = academyPreDevRollover(state, cfg);

  // aging + retirement for every player in the world (bulk, same function).
  // v1.79: the user's club develops its players faster by exactly one thing —
  // the Elite Training Center, staff and badges included. It covers the senior
  // squad and the academy roster alike, since it is the club's training ground.
  const devRng = mulberry32(deriveSeed(state.seed, `dev:${state.season}`));
  const userTeam = state.teams[state.userTeamId];
  const userFacilityMult = growthMultiplier(state, state.userTeamId);
  // v1.81: the second facility lever, and a different kind of one — the High
  // Performance Center doesn't multiply growth, it cuts the elite-resistance
  // penalty, which is the only thing that moves a player who is already at 88.
  const userEliteRelief = eliteResistRelief(state, state.userTeamId);
  const academySet = new Set(userTeam.academyPlayerIds ?? []);
  // Tagging a prospect into the U21 matchday squad earns them a small extra
  // growth bump on top of their minutes (§18) when he didn't actually feature —
  // a prospect who played gets the far bigger U21-participation boost instead
  // (folded into `academyBonuses`), so this only tops up the untagged-but-selected.
  const u21SquadSet = new Set(state.academy.u21Squad ?? []);
  // Mentor trait (v6): experienced pros in the user's dressing room speed up
  // every young teammate's growth. Summed across the senior squad + academy.
  const userMentorBonus = mentorGrowthBonus(state, state.userTeamId);
  const retiredNotable: string[] = [];
  // Regens (v1.55): teenagers born to succeed a genuinely good retiring player.
  // Collected here and inserted after the loop so the world isn't mutated mid
  // iteration; `activePlayers` returns a snapshot, but a fresh regen must not be
  // developed the same summer he is created.
  const regens: import("./types").PlayerBio[] = [];
  const regenRng = mulberry32(deriveSeed(state.seed, `regen:${state.season}`));
  for (const p of activePlayers(state)) {
    const isUser = p.clubId === state.userTeamId;
    const inAcademy = academySet.has(p.id);
    // The archetype development centers (v1.93) multiply into the SAME facility
    // term the Elite Training Center uses, rather than opening a channel of
    // their own. That is the point of the shape: the ETC is what the club does
    // for everybody, a class center is what it does for one kind of player, and
    // both are answers to "how fast does he grow" — so they belong on one lever.
    //
    // Read off the player's DERIVED archetype, not his training plan. This is
    // the same distinction the growth-emphasis rule makes in reverse: emphasis
    // reads the plan (deriving it would entrench an identity training can never
    // move), but a coaching department coaches the player it actually has, and a
    // Creator being retrained as an Engine is still a Creator until he isn't.
    const cls = deriveArchetype(p.attrs, p.positions[0])?.cls;
    const classMult =
      isUser || inAcademy ? archetypeClassGrowthMultiplier(state, state.userTeamId, cls) : 1;
    const facilityMult = (isUser || inAcademy ? userFacilityMult : 1) * classMult;
    const eliteRelief = isUser || inAcademy ? userEliteRelief : 0;
    // Academy development boosts (v1.55): loan (base + per-appearance), U21-league
    // participation (with team + individual performance), and focus, all computed
    // in academyPreDevRollover while loans/youth stats were still present. Focus
    // is folded into that map, so the old inline focus/U21-squad bumps are gone.
    let extraGrowth = academyBonuses[p.id] ?? 1;
    // A U21-squad prospect who never actually FEATURED still gets the small
    // squad-attention nudge he always did.
    //
    // The test is "did he play", read off `youthStats`, not "does he have a
    // bonus entry" (v1.93). Those were the same question until the academy's
    // own age-ramped bonus landed, which gives essentially every prospect an
    // entry — so the old `!academyBonuses[p.id]` guard would have quietly
    // stopped paying this nudge to anyone. `youthStats` is cleared later in the
    // rollover, but this loop runs before that, so it is still readable here.
    const featured = (p.youthStats?.apps ?? 0) > 0;
    if (inAcademy && !featured && u21SquadSet.has(p.id)) extraGrowth *= 1 + cfg.u21SquadGrowthBonus;
    if ((isUser || inAcademy) && p.age <= cfg.growthEndAge) extraGrowth *= 1 + userMentorBonus;
    const wasOverall = p.overall;
    // training plans steer only the user's own senior + academy players
    const applyPlan = isUser || inAcademy;
    const out = applySeasonDevelopment(state, p, cfg, devRng, facilityMult, extraGrowth, applyPlan, eliteRelief);
    if (out.retired && wasOverall >= 78) retiredNotable.push(`${p.name} (${wasOverall})`);
    // A good enough player leaves a regen behind: a raw teenager carrying his
    // profile and peak ceiling, born a free agent for the market to place.
    if (out.retired && wasOverall >= cfg.regenMinPeakOverall) {
      regens.push(regenFromRetiree(regenRng, cfg, p));
    }
    p.stats = { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 };
    p.youthStats = undefined;
    p.fitness = 100;
    p.form = 1.0;
    // Baseline for the season's running +X/-X growth badge (v19). Stamped after
    // this summer's development has been applied, so the delta the UI shows is
    // strictly what the player gains or loses during the season now beginning.
    p.seasonStartOverall = p.overall;
  }
  for (const r of regens) state.players[r.id] = r;
  if (retiredNotable.length) {
    pushInbox(state, "news", "End of an era", `Retiring this summer: ${retiredNotable.slice(0, 6).join(", ")}.`);
  }

  // Archetype retraining (v1.93). Deliberately AFTER the development pass: the
  // reshaping settles onto the overall the player finished the season with, and
  // the summer's growth has already redistributed his attributes. Run before,
  // the growth pass would be the last writer and would silently undo part of
  // the conversion every year.
  //
  // It is safe against the `seasonStartOverall` baseline stamped in the loop
  // above because a conversion PRESERVES overall by construction — it moves
  // attribute points between attributes, never the rating they sum to.
  for (const done of rolloverConversions(state, cfg)) {
    if (done.completed) {
      const became = done.derived?.id === done.target.id;
      pushInbox(
        state,
        "academy",
        `Retraining complete: ${done.playerName}`,
        became
          ? `${done.playerName} has finished his ${done.target.name} programme and now plays the role. His training plan has been set to match.`
          : `${done.playerName} has finished his ${done.target.name} programme. His attributes have been reshaped toward the role, though he still reads as ${done.derived?.name ?? "his old role"} — a player pinned near his limits can only be moved so far.`
      );
    } else {
      pushInbox(
        state,
        "academy",
        `Retraining: ${done.playerName}`,
        `Season ${done.seasonsServed} of ${done.seasonsRequired} of ${done.playerName}'s ${done.target.name} programme is complete.`
      );
    }
  }

  // Top the free-agent market back up where the world is genuinely short of
  // bodies (v1.89). Runs immediately after retirement and the regen pass, which
  // is what has just changed the population — see `replenishFreeAgents` for why
  // the world otherwise only ever shrinks, and why that is the shortage behind a
  // club being unable to field a centre-back.
  replenishFreeAgents(state, cfg);

  // ...and put a GENERATION behind the one that just aged a year (v1.92). The
  // pass above holds the world's headcount flat but restocks at 23–32, so it
  // fills the middle of the age curve while the bottom empties — measured, the
  // 22–25 cohort fell from 712 players to 27 over ten seasons while the total
  // population barely moved. That is the shortage behind squads decaying in a
  // long save: no market rule can sign a player the world never generated.
  // Runs immediately after retirement, on the same population that has just
  // changed, and before the AI's squad passes below get to shop.
  replenishYouth(state, cfg);

  // ── Backroom: a season of service (v1.79) ───────────────────────────────
  // Credit the season to every assigned staff member and promote the badges
  // that have come due. This runs AFTER the development pass on purpose: the
  // season just played was worked at the badge level the staff held going into
  // it, so a badge earned this summer pays from next season on, not
  // retroactively.
  const promotions = accrueBadgeSeasons(state);
  for (const promo of promotions) {
    const facilityName = FACILITY_MAP[promo.facility]?.name ?? promo.facility;
    pushInbox(
      state,
      "board",
      `${promo.staffName} earns a ${promo.tier} badge`,
      `After another season at the ${facilityName}, ${promo.staffName} has been awarded a ${promo.tier} ${facilityName} badge. Their experience now counts for more wherever they work in that building.`
    );
  }
  const retiredStaff = ageStaff(state);
  if (retiredStaff.length) {
    pushInbox(
      state,
      "board",
      "Backroom retirements",
      `${retiredStaff.map((s) => s.name).join(", ")} ${retiredStaff.length === 1 ? "has" : "have"} retired from the game. Their facility slots are now free.`
    );
  }

  // Long-save housekeeping (§13, v21). Runs after the season summary, this
  // season's career rows and the development pass — so everything it compacts
  // has already been read by everything that still needed it.
  pruneRetired(state);

  // Club reputation drift (v1.92). Runs here, and the position is load-bearing
  // at both ends: AFTER promotion/relegation and the development pass, so a club
  // is measured against the division it will actually play and the squad it will
  // actually field; and BEFORE `refreshValues`, the stance pass and every summer
  // market pass below, all of which read reputation to decide who may sign whom.
  // That ordering is what turns a title into signings in the very next window
  // rather than a season later — which is the whole complaint this answers.
  const repChanges = driftClubReputations(state, cfg, finishes);
  const userRep = repChanges.find((c) => c.teamId === state.userTeamId);
  if (userRep) {
    const up = userRep.after > userRep.before;
    pushInbox(
      state,
      "board",
      up ? "The club's standing is rising" : "The club's standing has slipped",
      `${state.teams[state.userTeamId].name}'s reputation ${up ? "rises" : "falls"} to ` +
        `${Math.round(userRep.after)} (from ${Math.round(userRep.before)}). ` +
        (up
          ? "Players who saw a move here as a step down are starting to think again."
          : "Bigger names will be harder to persuade until results improve.")
    );
  }

  refreshValues(state, cfg);
  // Resolve every AI club's sponsorship book for the season about to start and
  // bank what its majors pay (v19, real deals since v1.5) — BEFORE stances are
  // set, since a club's war chest is part of the evidence it judges its own
  // ambitions against. `state.season` is still the season just played here, so
  // the pass is told which season it is signing for.
  refreshAiCommercial(state, cfg, state.season + 1);
  // Set each club's stance for the summer window while the season just played is
  // still readable in the fixtures — it's the evidence they judge themselves on
  // (§10). The winter window re-evaluates against the live table.
  refreshClubStances(state, cfg);

  // new season scaffolding — old fixtures compress into the record book
  state.season += 1;
  // Start-of-season grant for every AI club (v1.64), paid the moment the new
  // season begins so the world enters the summer window able to trade.
  applyAiSeasonSubsidy(state, cfg);
  const playableDivs = Array.from(new Set(state.divisionIds));
  // The calendar is sized to the LONGEST division the world will play (v1.91):
  // every league draws its own 2×(n−1) matchdays from the front of this pool, so
  // one shared set of Saturdays seats a 20-club tier and a 24-club one at once.
  // Sized after promotion/relegation has settled, since that is what fixes each
  // division's club count for the season about to start.
  state.schedule = buildSeasonSchedule(
    state.season,
    Math.max(...playableDivs.map((id) => leagueRoundCount(state.leagues[id].teamIds.length)), 1)
  );
  state.fixtures = playableDivs.flatMap((id, idx) =>
    generateLeagueFixtures(id, state.leagues[id].teamIds, state.schedule.leagueRoundDays, state.seed + state.season * (17 + idx * 14))
  );
  state.cup = initCup(playableDivs.flatMap((id) => state.leagues[id].teamIds), state.teams);
  // European cups (v1.51): qualification reads the season just played, which has
  // only now been fully settled (final tables + cup winner) — so this is the
  // earliest point the new continental season can be drawn. In season 1 there is
  // no prior season to qualify from, which is why the first campaign is season 2.
  if (state.european) {
    const euroFixtures = startEuropeanSeason(state);
    state.fixtures.push(...euroFixtures);
    if (euroFixtures.length) {
      const userCup = state.european.cups.find((c) => c.teamIds.includes(state.userTeamId));
      if (userCup) {
        pushInbox(
          state,
          "board",
          `${userCup.name} qualification`,
          `${state.teams[state.userTeamId].name} have qualified for the ${userCup.name}. The group stage begins in September — six matchdays, with the top two of each group going through to the knockout rounds.`
        );
      }
    }
  }
  state.currentDay = state.schedule.seasonStartDay;
  // Priced at the division the club will play in NEXT season — promotion and
  // relegation have already been applied above, so a promoted club's shortlist
  // arrives at its new, dearer rate (v1.89).
  state.staffMarket = generateStaffMarket(
    deriveSeed(state.seed, `staff:${state.season}`),
    staffWageMultiplier(state, cfg)
  );
  state.marketRefreshDay = state.schedule.seasonStartDay + cfg.marketRefreshDays;
  // Resolve the non-playable leagues for the new season so the open summer window
  // shows the fresh, not-yet-started tables (teams loaded, 0 games) — matching the
  // fresh save (worldgen). They fill in at the winter window (~halfway) and again
  // after their final round (full), so sim tables track the player's own progress
  // rather than jumping straight to a half-played season on day one.
  resolveSimLeagues(state, 0, cfg);
  // Summer window for the sim leagues (v1.44): with fresh values and stances set
  // above, each non-playable league does its intra-league business now, so a new
  // season's foreign squads have already turned over when the player first looks.
  simLeagueTransferWindow(state, cfg);
  rolloverSponsors(state); // expire deals that have run their course (v6)
  state.offers = [];
  state.lineup = {};
  state.pendingMatchFixtureId = null;

  // Clear last summer's undecided graduates who have since retired or left, so
  // the queue can't accumulate ghosts across a long save (v1.51). Runs before
  // this year's age-outs are added to it.
  pruneGraduateQueue(state);

  // Academy new-season pass (§18): age-outs (ages are +1 now), AI intake to
  // keep the world stocked, and a fresh U21 season on the new schedule.
  academyPostDevRollover(state, cfg);

  // Every AI club in the world lets its aged-out players go (v1.92). Runs BEFORE
  // the contract passes below, because both of those hand a deal to anyone
  // without one — released here and renewed there, the pass would undo itself.
  // It is also before the squad and youth passes further down, so the places it
  // frees are ones this summer's signings can actually fill.
  releaseAgedOutWorldwide(state, cfg);

  // Contracts (§10 v5): settle the user's expiries from the dead-week contract
  // round (v1.51), auto-renew for AI clubs, then backfill contract-less newcomers.
  const released = rolloverContracts(state, cfg);
  ensureContracts(state, cfg);

  // Summer window for the user's own division rivals (v1.51). Runs LAST of the
  // rollover's market passes, after contracts settle, so everyone released this
  // summer — by the user, by an AI club, or by a deal allowed to lapse — is
  // already a free agent the AI can sign. Before this, the playable divisions
  // did their entire summer business through the weekly tick alone.
  playableLeagueTransferWindow(state, cfg);
  if (released.length) {
    pushInbox(
      state,
      "board",
      "Contracts expired",
      `${released.join(", ")} left the club on a free transfer when their contract ran out. ` +
        `Keep an eye on your squad's contract lengths on the Squad screen.`
    );
  }

  // Last line of defence (v1.51): expiries and retirements both land at the
  // rollover, so a squad the manager hasn't topped up can fall below a legal
  // side.
  //
  // Graduates are deliberately NOT drawn on here (v1.63). Signing a prospect is
  // the manager's call and only the manager's — a kid who appeared in the senior
  // squad without being asked for is exactly the "the game signed players behind
  // my back" problem the graduate queue exists to prevent. A thin squad is
  // topped up from the free-agent market instead, and the waiting graduates stay
  // waiting until they're signed or released on the Academy screen.
  const waitingGraduates = pendingGraduates(state).length;
  if (waitingGraduates > 0) {
    pushInbox(
      state,
      "academy",
      waitingGraduates === 1 ? "A graduate is still waiting on you" : `${waitingGraduates} graduates are still waiting on you`,
      `${waitingGraduates === 1 ? "One prospect has" : `${waitingGraduates} prospects have`} outgrown the academy and ` +
        `${waitingGraduates === 1 ? "is" : "are"} waiting on a senior contract. Nobody joins the senior squad unless you ` +
        `sign ${waitingGraduates === 1 ? "him" : "them"} — resolve the queue on the Academy screen.`
    );
  }
  // The user's club is served FIRST (v1.89). Both passes draw on the same
  // free-agent pool, and forty AI clubs topping themselves up to `aiSquadFloor`
  // will strip it: run the other way round, the manager's own side was left with
  // four players and no goalkeeper while every AI club had a full squad. The
  // manager's ability to fulfil fixtures outranks the world's cosmetic depth.
  const emergencySignings = ensureFieldableSquad(state, cfg);
  // Then hold every AI club to a workable squad and a fieldable shape. This runs
  // after `replenishFreeAgents` above has restocked the pool — there is no point
  // obliging a club to sign a centre-back on a day the world contains none.
  ensureAiSquads(state, cfg);
  // With every squad finally settled for the new season, let each AI club review
  // whether the football it plays still suits the players it has (v1.90). Runs
  // after the summer's arrivals and departures on purpose: reviewing before them
  // would judge a squad the club no longer owns. The `aiTacticSwitchGain`
  // threshold means most clubs keep their shape and go on building towards it.
  reviewClubTactics(state, cfg);
  // ...and then check the shape AGAIN (v1.91). A formation change rewrites what
  // the club needs — a side moving to a 4-2-3-1 suddenly requires two DMs where
  // its old shape asked for none — so the coverage pass above was answering a
  // question about a formation the club has just stopped playing. Measured, this
  // is what left one club in forty starting a season with nobody who could play
  // a slot it had a full free-agent market for: 0 DMs against 2 slots, 10 DMs
  // unsigned in the pool, and no signing pass left to run.
  //
  // `ensureAiSquads` is idempotent — it signs only for positions that are still
  // uncovered — so for the clubs that kept their shape (most of them, by
  // `aiTacticSwitchGain`) this is a cheap no-op rather than a second spree.
  ensureAiSquads(state, cfg);
  // Restock once more (v1.89). Forty clubs topping up to `aiSquadFloor` empties
  // the pool between them, which would leave the user's Free Agents tab bare all
  // season — the exact thing `freeAgentPoolFloor` exists to prevent. The second
  // pass costs nothing when the first left enough: it generates only what the
  // world is still short of. Runs after BOTH coverage passes so it restocks what
  // the world is actually short of once every squad has finished shopping.
  replenishFreeAgents(state, cfg, 1);
  // Finally, every AI club takes its pick of the young players in the world
  // (v1.92). Runs LAST of the market passes on purpose: it draws on the pool
  // `replenishYouth` and both restocks have filled, and it must not compete with
  // the passes above for the squad places a club needs to field a legal side —
  // a prospect is what a club does with its SPARE capacity, never instead of a
  // centre-back. Without this the intake is never signed, never plays, and so
  // never develops: measured, 970 under-22s sat unattached while the world's
  // supply of high-potential young players fell by 86%.
  aiRecruitYouth(state, cfg);
  if (emergencySignings.length) {
    pushInbox(
      state,
      "board",
      "Emergency signings",
      `Your squad was too thin to field a matchday side, so the club signed ${emergencySignings.join(", ")} ` +
        `on free transfers to make up the numbers. These are stopgaps — strengthen properly while the window is open.`
    );
  }

  const champ = summary.championsByLeague[state.divisionIds[0]]?.teamName ?? "—";
  pushInbox(
    state,
    "award",
    `Season ${summary.yearLabel} review`,
    [
      `Champions: ${champ}. Cup winners: ${summary.cupWinner?.teamName ?? "—"}.`,
      euroPrizes.length
        ? euroPrizes.map((e) => `${e.cupName}: ${e.winnerName}.`).join(" ") +
          (euroPrizes.some((e) => e.userPrize > 0)
            ? ` Your European run earned ${fmtM(euroPrizes.reduce((n, e) => n + e.userPrize, 0))}.`
            : "")
        : "",
      `You finished ${summary.userFinish}.`,
      summary.playerOfSeason ? `Player of the Season: ${summary.playerOfSeason.name} (${summary.playerOfSeason.teamName}).` : "",
      summary.youngPlayerOfSeason ? `Young Player of the Season: ${summary.youngPlayerOfSeason.name}.` : "",
      `The ${seasonYearLabel(state.season)} season begins — the summer window is open.`,
      state.season - state.lastExportSeason >= 3 ? "⚠ You haven't exported a backup in 3+ seasons. Club → Export save." : "",
    ]
      .filter(Boolean)
      .join(" ")
  );

  // fresh season league summary for the ticker
  state.news.unshift(`${seasonYearLabel(state.season)} season: fixtures released. First matchday ${formatDayShort(state.schedule.leagueRoundDays[0])}.`);

  // Manager accolades (v1.45): with the new season's budget, values and squad in
  // place, refresh the peaks and unlock any achievement the season just earned
  // (a title, a promotion, a 90-rated youngster who grew over the summer).
  const unlocked = syncProgress(state);
  const titles = achievementTitles(unlocked);
  if (titles.length) {
    pushInbox(
      state,
      "award",
      titles.length === 1 ? "Achievement unlocked" : "Achievements unlocked",
      `You've earned: ${titles.join(", ")}. See them all on the Achievements screen.`
    );
  }
}

/** Auto-fill the user's lineup for the current formation if slots are empty/invalid. */
export function ensureUserLineup(state: GameState): { slotId: string; player: import("./types").PlayerBio }[] {
  const team = state.teams[state.userTeamId];
  const formation = getFormation(team.tactic.formationId);
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
  const byId = new Map(squad.map((p) => [p.id, p]));

  const chosen: { slotId: string; player: import("./types").PlayerBio }[] = [];
  const used = new Set<string>();
  for (const slot of formation.slots) {
    const pid = state.lineup[slot.id];
    const p = pid ? byId.get(pid) : undefined;
    if (p && !used.has(p.id)) {
      chosen.push({ slotId: slot.id, player: p });
      used.add(p.id);
    }
  }
  if (chosen.length < formation.slots.length) {
    // fill gaps by auto-pick over the remaining pool
    const remainingSlots = formation.slots.filter((s) => !chosen.some((c) => c.slotId === s.id));
    const pool = squad.filter((p) => !used.has(p.id));
    const partial = pickLineup(pool, { ...formation, slots: remainingSlots }, cfg);
    for (const e of partial.lineup) chosen.push(e);
  }
  // persist back
  state.lineup = Object.fromEntries(chosen.map((c) => [c.slotId, c.player.id]));
  return chosen;
}

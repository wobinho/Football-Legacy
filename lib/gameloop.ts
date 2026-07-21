// ── Game Loop (§3) ────────────────────────────────────────────────────────
// Day-by-day simulation behind a single Continue button. A day may only stop
// the player if something needs them: their matchday, an incoming transfer
// offer, or the season review. Everything else streams past as inbox/news.

import type { Fixture, GameState, MatchResult } from "./types";
import { TUNING } from "./config/tuning";
import { hashString, mulberry32, deriveSeed, uid } from "./rng";
import { isMonday, formatDayShort, buildSeasonSchedule, seasonYearLabel } from "./calendar";
import { buildSideInput, pickLineup, headCoachMult } from "./selection";
import { simulateMatch } from "./engine/match";
import { generateLeagueFixtures, drawCupRound, applyPromotionRelegation, initCup } from "./season";
import {
  dailyRecovery,
  applyMatchFatigue,
  nudgeForm,
  applySeasonDevelopment,
  mentorGrowthBonus,
  weeklyProgressTick,
} from "./development";
import { weeklyEconomyTick, applySeasonPrizes, facilityGrowthMult } from "./economy";
import { aiWeeklyTransferTick, refreshValues, simLeagueTransferWindow } from "./transfers";
import { activePlayers, pruneRetired } from "./archive";
import { refreshClubStances } from "./ai/strategy";
import { rolloverContracts, ensureContracts } from "./contracts";
import { resolveSimLeagues } from "./simresolver";
import { buildSeasonSummary, trackBiggestWin } from "./recordbook";
import { ACCOLADE_META, runSeasonAwardsCeremony } from "./accolades";
import { generateStaffMarket, staffMarketTick, refreshStaffMarket } from "./staff";
import { scoutMarketTick, refreshScoutMarketFull } from "./scouts";
import { refreshAiCommercial, refreshSponsorOffers, rolloverSponsors } from "./sponsors";
import { getFormation } from "./config/formations";
import {
  runIntakeDay,
  runU21MatchDay,
  dailyScoutTick,
  weeklyLoanTick,
  loanMidseasonReports,
  academyPreDevRollover,
  academyPostDevRollover,
  graduateAwardNews,
} from "./academy";

const cfg = TUNING;

export type StopReason =
  | { kind: "matchday"; fixtureId: string }
  | { kind: "offer" }
  | { kind: "seasonEnd" }
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

  // Youth intake — a new class of prospects arrives.
  if (sched.intakeDay !== undefined) {
    push(
      sched.intakeDay,
      `intake:${state.season}`,
      "Youth intake day",
      "This year's academy intake is about to arrive. Head to the Academy screen to see who's come through.",
      "academy"
    );
  }

  if (!gates.length) return null;
  // Earliest gate first; the sim pauses the day before it.
  gates.sort((a, b) => a.day - b.day);
  return gates[0];
}

export function matchSeed(state: GameState, fixture: Fixture): number {
  return deriveSeed(state.seed, `match:${state.season}:${fixture.id}:${hashString(fixture.homeId + fixture.awayId)}`);
}

function sideInputFor(state: GameState, teamId: string, fixedLineup?: { slotId: string; player: import("./types").PlayerBio }[]) {
  const t = state.teams[teamId];
  // players out on loan (§18) are away and can't be fielded by their owner
  const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
  // Only the user hires staff, so only the user gets the coaching match-day edge.
  // The Assistant Coach's stars stack at half weight with the Head Coach's.
  const coachStars = (t.staff.headCoach?.stars ?? 0) + (t.staff.assistantCoach?.stars ?? 0) * 0.5;
  const coachMult = teamId === state.userTeamId ? headCoachMult(coachStars, cfg) : 1;
  // Only the user sets assignments (captain + set-piece takers); AI sides field none.
  const assignments = teamId === state.userTeamId ? t.assignments : undefined;
  return buildSideInput(teamId, t.name, t.short, players, t.tactic, cfg, fixedLineup, coachMult, assignments);
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
    const medicalLevel = p.clubId === state.userTeamId ? state.teams[state.userTeamId].medicalLevel ?? 0 : 0;
    applyMatchFatigue(p, mins, cfg, medicalLevel);
    const rating = result.ratings[pid] ?? 6.5;
    p.stats.ratingSum += rating;
    nudgeForm(p, rating, cfg);
  }
  for (const s of result.scorers) {
    const scorer = state.players[s.playerId];
    if (scorer) scorer.stats.goals += 1;
    if (s.assistId && state.players[s.assistId]) state.players[s.assistId].stats.assists += 1;
  }
  trackBiggestWin(state, fixture, result.homeGoals, result.awayGoals);
}

function simAiFixture(state: GameState, fixture: Fixture) {
  const home = sideInputFor(state, fixture.homeId);
  const away = sideInputFor(state, fixture.awayId);
  const result = simulateMatch(home, away, cfg, matchSeed(state, fixture));
  applyMatchResult(state, fixture, result);
}

function pushInbox(state: GameState, type: import("./types").InboxItem["type"], title: string, body: string) {
  state.inbox.unshift({ id: uid("inb"), day: state.currentDay, season: state.season, type, title, body, read: false });
  state.inbox = state.inbox.slice(0, 120);
}

/** Draw a cup round the day its fixtures are scheduled, if not yet drawn. */
function ensureCupRound(state: GameState) {
  const idx = state.schedule.cupRoundDays.indexOf(state.currentDay);
  if (idx === -1 || state.cup.currentRound !== idx) return;
  const exists = state.fixtures.some((f) => f.competition === "CUP" && f.round === idx + 1);
  if (!exists) {
    const fixtures = drawCupRound(state, idx, state.seed);
    state.fixtures.push(...fixtures);
    const userTie = fixtures.find((f) => f.homeId === state.userTeamId || f.awayId === state.userTeamId);
    if (userTie) {
      const opp = userTie.homeId === state.userTeamId ? state.teams[userTie.awayId] : state.teams[userTie.homeId];
      state.news.unshift(`Cup ${state.cup.roundNames[idx]}: drawn against ${opp.name} today.`);
    }
  }
}

/** Settle a cup round once every one of its fixtures has been played. */
export function maybeSettleCup(state: GameState) {
  const idx = state.cup.currentRound;
  if (idx >= state.schedule.cupRoundDays.length) return;
  const roundFixtures = state.fixtures.filter((f) => f.competition === "CUP" && f.round === idx + 1);
  if (!roundFixtures.length || !roundFixtures.every((f) => f.played)) return;

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

  if (idx === state.schedule.cupRoundDays.length - 1 && state.cup.aliveTeamIds.length === 1) {
    state.cup.winnerId = state.cup.aliveTeamIds[0];
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

/** Advance exactly one day. Returns a stop reason if the player is needed. */
function advanceDay(state: GameState): StopReason | null {
  state.currentDay += 1;
  const day = state.currentDay;
  const sched = state.schedule;

  dailyRecovery(state, cfg);

  if (isMonday(day)) {
    const beforeBudget = state.teams[state.userTeamId].budget;
    weeklyEconomyTick(state, cfg);
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
      (p) => facilityGrowthMult(state, state.userTeamId, p, cfg)
    );
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
  if (day === sched.winterOpenDay) {
    refreshValues(state, cfg);
    // Clubs reassess their season and set a market stance for the window (§10).
    refreshClubStances(state, cfg);
    // Sim (non-playable) leagues do their own window's business now (v1.44), so
    // foreign squads visibly turn over between windows rather than staying frozen.
    simLeagueTransferWindow(state, cfg);
    pushInbox(state, "window", "Winter transfer window open", "The winter window is open until 1 February. Sim leagues have updated tables and form to browse.");
    loanMidseasonReports(state);
  }

  // Staff market: dismissed slots refill after a couple of days (v6).
  staffMarketTick(state);
  // Scouting department shortlist tops itself back up the same way (v14).
  scoutMarketTick(state, cfg);
  // Periodic full turnover of both for-hire pools (v20): every marketRefreshDays
  // the shortlists cycle so they never go stale between hires.
  if (state.marketRefreshDay !== undefined && day >= state.marketRefreshDay) {
    refreshStaffMarket(state);
    refreshScoutMarketFull(state, cfg);
    state.marketRefreshDay = day + cfg.marketRefreshDays;
  }
  // Sponsorship offers land in any empty slot (v6, Club → Income).
  refreshSponsorOffers(state, cfg);

  // Youth Academy (§18): all background — none of this stops the loop
  runU21MatchDay(state, cfg);
  dailyScoutTick(state, cfg);
  if (isMonday(day)) weeklyLoanTick(state, cfg);
  if (day === sched.intakeDay) runIntakeDay(state, cfg);
  if (day === sched.summerCloseDay || day === sched.winterCloseDay) {
    pushInbox(state, "window", "Transfer window closed", "The window has closed. Deals resume when the next window opens.");
  }

  ensureCupRound(state);

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
    } else if (stop.kind === "offer") {
      // ignore offers when force-simming; they remain in the inbox to handle later
      continue;
    } else {
      // seasonEnd / idle — hard stop, the calendar can't span it
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
  const userSide = sideInputFor(state, state.userTeamId, userLineup);
  const oppId = userIsHome ? fixture.awayId : fixture.homeId;
  const oppSide = sideInputFor(state, oppId);
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
      competition: compName,
      apps: p.stats.apps,
      goals: p.stats.goals,
      assists: p.stats.assists,
      avgRating: p.stats.apps ? Math.round((p.stats.ratingSum / p.stats.apps) * 100) / 100 : 0,
      awards: seasonAwardTitles(p, state.season),
    });
    // youth football gets its own history line (§18): U21 league or loan spell
    const ys = p.youthStats;
    if (ys && ys.apps > 0) {
      const loanClub = p.loan ? state.teams[p.loan.toClubId]?.name : null;
      state.careers[p.id].seasons.push({
        season: state.season,
        clubName: loanClub ?? clubName,
        competition: loanClub ? `Loan from ${clubName}` : "U21 League",
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

  // prizes before promotion shuffle (based on final tables)
  applySeasonPrizes(state, cfg);

  // history first, while stats are intact
  appendCareerRows(state);

  const { promoted, relegated } = applyPromotionRelegation(state);
  summary.promoted = promoted;
  summary.relegated = relegated;
  state.recordBook.seasons.push(summary);
  graduateAwardNews(state);

  if (promoted.includes(state.teams[state.userTeamId].name)) {
    state.teams[state.userTeamId].budget += cfg.promotionBonus;
    // Read the destination off the club's post-shuffle league, not divisionIds[0]
    // — on a 3-tier ladder promotion may only be a step up to the second tier.
    const upName = state.leagues[state.teams[state.userTeamId].leagueId]?.name ?? "the division above";
    pushInbox(state, "board", "PROMOTED!", `Promotion to ${upName}! The board adds ${fmtM(cfg.promotionBonus)} to your budget.`);
  }

  // Loan reviews + fold youth/loan minutes into development inputs (§18).
  // Must run after career rows are written, before the development pass.
  academyPreDevRollover(state, cfg);

  // aging + retirement for every player in the world (bulk, same function).
  // The user's development coach + training facility accelerate their own youth;
  // academy players train under the youth coach + academy facility instead (§18).
  const devRng = mulberry32(deriveSeed(state.seed, `dev:${state.season}`));
  const userTeam = state.teams[state.userTeamId];
  const userDevCoachStars = userTeam.staff.devCoach?.stars ?? 0;
  const userGkCoachStars = userTeam.staff.gkCoach?.stars ?? 0;
  const userTrainingLevel = userTeam.trainingLevel ?? 0;
  const userYouthCoachStars = userTeam.staff.youthCoach?.stars ?? 0;
  const userAcademyLevel = userTeam.academyLevel ?? 0;
  const academySet = new Set(userTeam.academyPlayerIds ?? []);
  const focusSet = new Set(state.academy.focusIds);
  // Tagging a prospect into the U21 matchday squad earns them a small extra
  // growth bump on top of their minutes (§18). Focus prospects already carry the
  // bigger focus bonus, so the squad bump only tops up the untagged-but-selected.
  const u21SquadSet = new Set(state.academy.u21Squad ?? []);
  // Mentor trait (v6): experienced pros in the user's dressing room speed up
  // every young teammate's growth. Summed across the senior squad + academy.
  const userMentorBonus = mentorGrowthBonus(state, state.userTeamId);
  const retiredNotable: string[] = [];
  for (const p of activePlayers(state)) {
    const isUser = p.clubId === state.userTeamId;
    const inAcademy = academySet.has(p.id);
    // Keepers get the Goalkeeping Coach's attention on top of the base coach.
    const gkBonus = (isUser || inAcademy) && p.positions[0] === "GK" ? userGkCoachStars : 0;
    const devCoachStars = (inAcademy ? userYouthCoachStars : isUser ? userDevCoachStars : 0) + gkBonus;
    const trainingLevel = inAcademy ? userAcademyLevel : isUser ? userTrainingLevel : 0;
    let extraGrowth = focusSet.has(p.id) ? 1 + cfg.u21FocusGrowthBonus : 1;
    if (inAcademy && !focusSet.has(p.id) && u21SquadSet.has(p.id)) extraGrowth *= 1 + cfg.u21SquadGrowthBonus;
    if ((isUser || inAcademy) && p.age <= cfg.growthEndAge) extraGrowth *= 1 + userMentorBonus;
    // Specialist training facilities (v15): position centres, plan centres and
    // the youth development centre each help a subset of the squad, on top of
    // the general Training Centre already folded into `trainingLevel`.
    if (isUser || inAcademy) extraGrowth *= facilityGrowthMult(state, state.userTeamId, p, cfg);
    const wasOverall = p.overall;
    // training plans steer only the user's own senior + academy players
    const applyPlan = isUser || inAcademy;
    const out = applySeasonDevelopment(state, p, cfg, devRng, devCoachStars, trainingLevel, extraGrowth, applyPlan);
    if (out.retired && wasOverall >= 78) retiredNotable.push(`${p.name} (${wasOverall})`);
    p.stats = { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 };
    p.youthStats = undefined;
    p.fitness = 100;
    p.form = 1.0;
    // Baseline for the season's running +X/-X growth badge (v19). Stamped after
    // this summer's development has been applied, so the delta the UI shows is
    // strictly what the player gains or loses during the season now beginning.
    p.seasonStartOverall = p.overall;
  }
  if (retiredNotable.length) {
    pushInbox(state, "news", "End of an era", `Retiring this summer: ${retiredNotable.slice(0, 6).join(", ")}.`);
  }

  // Long-save housekeeping (§13, v21). Runs after the season summary, this
  // season's career rows and the development pass — so everything it compacts
  // has already been read by everything that still needed it.
  pruneRetired(state);

  refreshValues(state, cfg);
  // Re-price every AI club's commercial portfolio for the new season and pay
  // out its investment windfall (v19), BEFORE stances are set — a club's war
  // chest is part of the evidence it judges its own ambitions against.
  refreshAiCommercial(state, cfg);
  // Set each club's stance for the summer window while the season just played is
  // still readable in the fixtures — it's the evidence they judge themselves on
  // (§10). The winter window re-evaluates against the live table.
  refreshClubStances(state, cfg);

  // new season scaffolding — old fixtures compress into the record book
  state.season += 1;
  state.schedule = buildSeasonSchedule(state.season);
  const playableDivs = Array.from(new Set(state.divisionIds));
  state.fixtures = playableDivs.flatMap((id, idx) =>
    generateLeagueFixtures(id, state.leagues[id].teamIds, state.schedule.leagueRoundDays, state.seed + state.season * (17 + idx * 14))
  );
  state.cup = initCup(playableDivs.flatMap((id) => state.leagues[id].teamIds));
  state.currentDay = state.schedule.seasonStartDay;
  state.staffMarket = generateStaffMarket(deriveSeed(state.seed, `staff:${state.season}`));
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

  // Academy new-season pass (§18): age-outs (ages are +1 now), AI intake to
  // keep the world stocked, and a fresh U21 season on the new schedule.
  academyPostDevRollover(state, cfg);

  // Contracts (§10 v5): expire deals — user players go to free agency, AI clubs
  // silently renew — then backfill any contract-less newcomers.
  const released = rolloverContracts(state, cfg);
  ensureContracts(state, cfg);
  if (released.length) {
    pushInbox(
      state,
      "board",
      "Contracts expired",
      `${released.join(", ")} left the club on a free transfer when their contract ran out. ` +
        `Keep an eye on your squad's contract lengths on the Squad screen.`
    );
  }

  const champ = summary.championsByLeague[state.divisionIds[0]]?.teamName ?? "—";
  pushInbox(
    state,
    "award",
    `Season ${summary.yearLabel} review`,
    [
      `Champions: ${champ}. Cup winners: ${summary.cupWinner?.teamName ?? "—"}.`,
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

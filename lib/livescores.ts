// ── Final-day live scores (§15.4) ───────────────────────────────────────────
//
// On the last league round the manager can watch the rest of the division play
// out alongside his own match: the other scorelines tick over, and the table
// re-sorts under them, so a title decided on goal difference is decided ON
// SCREEN rather than in a summary afterwards.
//
// The one thing to understand about this module: **it invents no football.**
// `advanceDay` in gameloop plays every AI fixture BEFORE handing the user's
// matchday back to the UI (so the tables are current when the user kicks off),
// which means every other score on the final day is already settled the moment
// this panel opens. Simulating them again here would produce a different set of
// results from the ones the save will record — two answers to one question, the
// exact failure the design rules exist to prevent.
//
// So what is invented is only the CLOCK: each already-scored goal is assigned a
// minute, and a goal is shown once the user's own match clock has passed it. The
// scoreline at minute 90 is byte-identical to the fixture the engine produced;
// only the order the manager learns it in is new. That also makes the panel
// free — no second engine pass, no per-tick simulation — which matters on a
// screen that already runs a match.
//
// Determinism: the minutes come from the fixture's own `matchSeed`, so a save
// reloaded mid-match shows the same goals at the same times.

import type { Fixture, GameState, TableRow } from "./types";
import { computeTable } from "./season";
import { leagueRoundCount } from "./calendar";
import { mulberry32 } from "./rng";
import { matchSeed } from "./gameloop";

/** A goal in one of the other matches, at the minute it is revealed. */
export interface LiveGoal {
  minute: number;
  /** Which side scored — the panel only needs the running score, not a scorer. */
  side: "home" | "away";
}

/** One other fixture in the division, as the scoreboard shows it. */
export interface LiveScore {
  fixtureId: string;
  homeId: string;
  awayId: string;
  /** Final goals, from the fixture the engine already played. */
  finalHome: number;
  finalAway: number;
  /** Every goal with the minute it lands on, ascending. */
  goals: LiveGoal[];
}

/**
 * Is this fixture the manager's LAST league round of the season?
 *
 * `leagueRoundCount` is the single rule for how long a division's season is
 * (v1.91), so an 18- or 24-club league answers this correctly without a
 * hardcoded 38 anywhere near it. Cup and European ties are never a league
 * decider, so they answer false.
 */
export function isFinalLeagueRound(state: GameState, fixture: Fixture): boolean {
  const league = state.leagues[fixture.competition];
  if (!league) return false; // CUP / a European tie
  return fixture.round === leagueRoundCount(league.teamIds.length);
}

/**
 * The other fixtures in the manager's division on this day, with a minute
 * assigned to each already-scored goal.
 *
 * Minutes are drawn uniformly across the 90 and sorted, then the home and away
 * goals are interleaved by minute — so a 3–2 reads as a genuine back-and-forth
 * rather than three home goals followed by two away ones. `matchSeed` is the
 * same seed the engine used for the fixture itself, which is what makes the
 * reveal stable across a reload.
 *
 * A fixture that somehow hasn't been played is skipped rather than shown at
 * 0–0: an unplayed match on the final day would be a bug, and quoting it as a
 * goalless draw would hide it.
 */
export function liveScoresFor(state: GameState, userFixture: Fixture): LiveScore[] {
  const out: LiveScore[] = [];
  for (const f of state.fixtures) {
    if (f.id === userFixture.id) continue;
    if (f.competition !== userFixture.competition) continue;
    if (f.round !== userFixture.round) continue;
    if (!f.played || f.homeGoals == null || f.awayGoals == null) continue;

    const rng = mulberry32(matchSeed(state, f) ^ 0x11e5c0);
    const minutesFor = (n: number) =>
      Array.from({ length: n }, () => 1 + Math.floor(rng() * 90)).sort((a, b) => a - b);
    const homeMins = minutesFor(f.homeGoals);
    const awayMins = minutesFor(f.awayGoals);

    const goals: LiveGoal[] = [
      ...homeMins.map((minute) => ({ minute, side: "home" as const })),
      ...awayMins.map((minute) => ({ minute, side: "away" as const })),
    ].sort((a, b) => a.minute - b.minute);

    out.push({
      fixtureId: f.id,
      homeId: f.homeId,
      awayId: f.awayId,
      finalHome: f.homeGoals,
      finalAway: f.awayGoals,
      goals,
    });
  }
  return out;
}

/** The running score of one other match at `minute` (90+ = final). */
export function scoreAt(s: LiveScore, minute: number): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const g of s.goals) {
    if (g.minute > minute) break;
    if (g.side === "home") home++;
    else away++;
  }
  return { home, away };
}

/**
 * The division's table as it stands at `minute`, counting the user's own match
 * at its current score and every other match at whatever it has reached.
 *
 * Built by handing `computeTable` a doctored fixture list rather than by
 * patching a finished table: the sort (points, then goal difference, then goals
 * scored) is one rule and it lives in `season.ts`. A live table that broke ties
 * differently from the real one would be the cruellest possible bug on the day a
 * title is decided by goal difference.
 *
 * `userHome`/`userAway` are the goals the user's match is standing at right now,
 * which the Match Day screen already tracks for its own scoreboard.
 */
export function liveTable(
  state: GameState,
  userFixture: Fixture,
  scores: LiveScore[],
  minute: number,
  userHome: number,
  userAway: number
): TableRow[] {
  const league = state.leagues[userFixture.competition];
  if (!league) return [];
  const byId = new Map(scores.map((s) => [s.fixtureId, s]));

  const fixtures = state.fixtures.map((f) => {
    if (f.id === userFixture.id) {
      // The user's own match is in progress and therefore not yet `played` — it
      // has to be counted anyway, or the manager's own club sits a game behind
      // the rest of the table he is being shown.
      return { ...f, played: true, homeGoals: userHome, awayGoals: userAway };
    }
    const s = byId.get(f.id);
    if (!s) return f;
    const { home, away } = scoreAt(s, minute);
    return { ...f, played: true, homeGoals: home, awayGoals: away };
  });

  return computeTable(fixtures, userFixture.competition, league.teamIds);
}

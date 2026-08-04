// ── Club reputation drift (v1.92) ─────────────────────────────────────────
//
// `Team.reputation` (1–100) is what the world thinks a club IS, and until now it
// was stamped once by worldgen and never moved again. That is the bug behind
// "I won the league and world-class players still see us as a step down": every
// gate that decides whether a star will sign — `willJoin`'s reputation test,
// `isPeerClub`, `consentPeerReputation` — reads a number frozen at kickoff, so a
// club could win three titles in a row and remain, to the market, whatever it
// was on day one. Winning the league had no effect on who would join.
//
// Reputation now drifts once a season, at the rollover, toward what the club has
// actually become. Three pieces of evidence, and they are deliberately different
// KINDS of thing:
//
//   1. **Squad** — `squadOverall` (XI + bench, the same number the team card
//      shows). How good the players are is the largest single term, because it
//      is the one a signing target can see for himself: he is being asked to
//      join THESE teammates.
//   2. **League** — the division's own 0–10 `leagueReputation`. A mid-table club
//      in a major top flight is a bigger name than a champion three tiers down,
//      and this is the term that makes promotion worth something to the market
//      the summer it happens.
//   3. **Standing** — where the club finished in that division last season. This
//      is what makes a title mean something: winning it is the top of this term.
//
// Two rules keep it from being a runaway:
//
//   - It is a DRIFT, not an assignment. The club moves at most
//     `repDriftMaxPerSeason` points toward its target, so a single good season
//     nudges and a decade of them relocates you. Reputation is meant to be the
//     slowest-moving number in the game — a club's standing is built over
//     careers, and a market gate that snapped to last May's table would let a
//     manager buy world-class players the summer after one lucky campaign.
//   - The target is absolute, not relative. Nothing here is normalised against
//     the rest of the world, so every club can improve (or decay) at once and
//     the ladder doesn't turn into a zero-sum shuffle.
//
// The user's club is treated exactly like every other. Reputation must be
// symmetric or the gates it feeds become a difficulty setting rather than a
// simulation: an AI club that wins the league has to become harder to sign FROM,
// for the same reason the user's becomes easier to sign TO.

import type { GameState, Team } from "./types";
import type { TuningConfig } from "./config/tuning";
import { getFormation } from "./config/formations";
import { leagueReputation, LEAGUE_REP_MAX } from "./config/leaguerep";
import { squadOverall } from "./selection";
import { computeTable } from "./season";

/** The evidence behind one club's target reputation, kept separate so the
 * arithmetic can be shown (and asserted) rather than only its result. */
export interface ReputationTarget {
  /** 0–100 from the club's XI+bench overall. */
  squad: number;
  /** 0–100 from the division's standing in the world game. */
  league: number;
  /** 0–100 from where the club finished that division last season. */
  standing: number;
  /** The weighted blend — where reputation is heading. */
  target: number;
}

/**
 * Map a squad overall onto the 0–100 reputation scale.
 *
 * Squad overalls occupy a narrow band in practice (a bad top-flight side is ~68,
 * an elite one ~85), so the raw number is stretched across the reputation range
 * by `repSquadFloor`/`repSquadCeil` rather than used directly — otherwise every
 * club in the world would score 70-something and the term would say nothing.
 */
function squadScore(overall: number, cfg: TuningConfig): number {
  const span = Math.max(1, cfg.repSquadCeil - cfg.repSquadFloor);
  return clamp01((overall - cfg.repSquadFloor) / span) * 100;
}

/** Where finishing `position` of `size` sits on 0–100. Winning the division is
 * 100, propping it up is 0, and the curve is linear in between — a league table
 * is already a ranking, so nothing further is needed to read it. */
function standingScore(position: number, size: number): number {
  if (!Number.isFinite(position) || position < 1 || size < 2) return 50;
  const clamped = Math.min(Math.max(1, position), size);
  return ((size - clamped) / (size - 1)) * 100;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * What this club's reputation SHOULD be, on the evidence of the season just
 * played. `position`/`divisionSize` describe that finish; omitted (a club whose
 * league can't be read), the standing term falls back to mid-table so a missing
 * table never reads as relegation form.
 */
export function reputationTarget(
  state: GameState,
  team: Team,
  cfg: TuningConfig,
  position?: number,
  divisionSize?: number
): ReputationTarget {
  const players = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
  const formation = getFormation(team.tactic?.formationId ?? "433");
  const squad = squadScore(squadOverall(players, formation, cfg).overall, cfg);

  const league = state.leagues[team.leagueId];
  const leagueScore = league ? (leagueReputation(league) / LEAGUE_REP_MAX) * 100 : 50;

  const standing =
    position !== undefined && divisionSize !== undefined ? standingScore(position, divisionSize) : 50;

  const w = cfg.repWeights;
  const total = w.squad + w.league + w.standing;
  const target = (squad * w.squad + leagueScore * w.league + standing * w.standing) / Math.max(1e-6, total);

  return { squad, league: leagueScore, standing, target };
}

/** One club's post-drift reputation, without applying it. Exposed so the UI and
 * the verifier can both read the same arithmetic the rollover uses. */
export function driftedReputation(
  current: number,
  target: number,
  cfg: TuningConfig
): number {
  const gap = target - current;
  const step = Math.max(-cfg.repDriftMaxPerSeason, Math.min(cfg.repDriftMaxPerSeason, gap * cfg.repDriftRate));
  return Math.max(1, Math.min(100, current + step));
}

/** Where every club in the world finished the season just played.
 *
 * Playable divisions are read from the fixtures they actually played; sim
 * leagues from the resolver's final table. Both must be collected BEFORE the
 * rollover's promotion shuffle, which rewrites league membership and makes the
 * fixture-derived table unreadable against the new one.
 *
 * A club whose league produced no table simply isn't in the map, and
 * `reputationTarget` falls back to a mid-table standing — an unplayed season is
 * not evidence of anything, and must not read as relegation form.
 */
export function collectSeasonFinishes(
  state: GameState
): Record<string, { position: number; size: number }> {
  const out: Record<string, { position: number; size: number }> = {};
  for (const league of Object.values(state.leagues)) {
    if (!league) continue;
    const size = league.teamIds.length;
    if (size < 2) continue;
    const order = league.playable
      ? computeTable(state.fixtures, league.id, league.teamIds).map((r) => r.teamId)
      : state.simResults.find((r) => r.leagueId === league.id)?.table.map((r) => r.teamId);
    if (!order?.length) continue;
    order.forEach((teamId, i) => {
      out[teamId] = { position: i + 1, size };
    });
  }
  return out;
}

export interface ReputationChange {
  teamId: string;
  name: string;
  before: number;
  after: number;
}

/**
 * Drift every club in the world toward its target reputation. Called once per
 * season rollover.
 *
 * Runs AFTER promotion and relegation (so a promoted club is already measured
 * against its new division's standing — which is most of the point) and after
 * the development pass has settled squads, but before the summer's market passes
 * read reputation to decide who may sign whom. That ordering is what makes a
 * title convert into signings the very next window rather than a season later.
 *
 * `finishes` maps team id → { position, size } for the season just played, built
 * by the caller from the final tables. Sim-league clubs are included: their
 * reputation feeds the same consent gates, and freezing them would make the
 * foreign game a static backdrop that the user's club silently outgrows.
 *
 * Returns only the clubs whose rounded reputation actually moved, so the caller
 * can report the user's own change without diffing 500 clubs.
 */
export function driftClubReputations(
  state: GameState,
  cfg: TuningConfig,
  finishes: Record<string, { position: number; size: number }>
): ReputationChange[] {
  const changes: ReputationChange[] = [];
  for (const team of Object.values(state.teams)) {
    if (!team) continue;
    const finish = finishes[team.id];
    const { target } = reputationTarget(state, team, cfg, finish?.position, finish?.size);
    const before = team.reputation;
    const after = driftedReputation(before, target, cfg);
    team.reputation = after;
    if (Math.round(before) !== Math.round(after)) {
      changes.push({ teamId: team.id, name: team.name, before, after });
    }
  }
  return changes;
}

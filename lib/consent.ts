// ── Player transfer consent (§10, v1.66) ──────────────────────────────────
// Until now a transfer was decided entirely by the buying club: if it could
// afford the fee and the wage, the player moved. That produced the immersion
// break this module exists to fix — a Premier League player with an 80 overall
// signing for a League One club, because the v1.65 market scaling quotes him a
// League One wage and so makes him look affordable to exactly the clubs that
// should never be able to reach him.
//
// A move now has to clear the PLAYER as well as the buyer, on two axes:
//
//   1. Standard of football (`willJoin`). A top-tier player refuses to drop more
//      than `consentMaxTierDrop` divisions, or to a club far below his own in
//      reputation, however much he's being offered. This is a hard gate — no
//      amount of money buys past it.
//   2. Money (`wageFloor`). What he demands is anchored to his ability and
//      current standing, NOT to the buyer's league. A lower-league club is meant
//      to fail the affordability test rather than be handed a discount.
//
// Both loosen along the desperation curve: a player who isn't playing, or who
// has no club at all, gradually accepts a lower division and less money. That
// decay is gradual (`desperationGraceDays` → `desperationFullDays`) rather than
// instant, so a benched star doesn't drop two leagues inside one window, but a
// genuinely finished player does eventually find his level.
//
// Nothing here special-cases a club, league or player by name — everything is a
// tuning number read against league tier and club reputation.

import type { GameState, PlayerBio, Team } from "./types";
import type { TuningConfig } from "./config/tuning";
import { baseWage, leagueWageMult } from "./contracts";

/** The tier of the division a club plays in. An unplaced club (or one whose
 * league is missing from a partial save) reads as the bottom of the pyramid, so
 * a player is never gated INTO a move by missing data. */
export function tierOf(state: GameState, team: Team | undefined): number {
  if (!team) return 99;
  return state.leagues[team.leagueId]?.tier ?? 99;
}

/** The tier a player currently plays at. A free agent has none — his standing is
 * judged from ability alone, so callers get `null` and skip the tier test. */
export function playerTier(state: GameState, p: PlayerBio): number | null {
  if (!p.clubId) return null;
  return tierOf(state, state.teams[p.clubId]);
}

/**
 * How far along the desperation curve this player is: 0 = freshly out of the
 * side and still holding out for his level, 1 = fully resigned to dropping.
 *
 * Driven by `inactiveDays`, which the weekly tick accrues for anyone unattached
 * or playing under `desperationMinutesShare` of the available minutes. A free
 * agent decays faster (`desperationFreeAgentMult`) — no club at all is a worse
 * position to hold out from than a bad one.
 */
export function desperation(p: PlayerBio, cfg: TuningConfig): number {
  const raw = p.inactiveDays ?? 0;
  if (raw <= 0) return 0;
  const days = raw * (p.clubId ? 1 : cfg.desperationFreeAgentMult);
  const past = days - cfg.desperationGraceDays;
  if (past <= 0) return 0;
  const span = Math.max(1, cfg.desperationFullDays - cfg.desperationGraceDays);
  return Math.max(0, Math.min(1, past / span));
}

// ── 1. Division & reputation gating ───────────────────────────────────────

export type ConsentVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Will this player agree to join `buyer`? The hard gate that runs before any
 * negotiation.
 *
 * Below `consentEliteOverall` a player goes wherever the football is — a squad
 * player dropping a division for a starting place is a completely normal move
 * and must stay possible. At or above it, two tests apply:
 *
 *  - Tier: he drops at most `consentMaxTierDrop` divisions, widened by up to
 *    `desperationMaxExtraTierDrop` as the curve runs.
 *  - Reputation: even inside the tier limit, the club can't be more than
 *    `consentMaxRepDrop` below his own — this is what stops a star joining a
 *    newly-promoted minnow in his own division.
 *
 * A club over `consentPeerReputation` is treated as a peer whatever tier it
 * plays in, so a famous club in a lesser league is always a plausible landing
 * spot. A move UP the pyramid is never blocked.
 */
export function willJoin(
  state: GameState,
  p: PlayerBio,
  buyer: Team,
  cfg: TuningConfig
): ConsentVerdict {
  if (p.overall < cfg.consentEliteOverall) return { ok: true };

  const buyerTier = tierOf(state, buyer);
  const buyerRep = buyer.reputation;
  // A big club is a peer wherever it plays — reputation carries the whole test.
  if (buyerRep >= cfg.consentPeerReputation) return { ok: true };

  const decay = desperation(p, cfg);
  const allowedDrop = cfg.consentMaxTierDrop + decay * cfg.desperationMaxExtraTierDrop;

  const ownTier = playerTier(state, p);
  if (ownTier !== null) {
    const drop = buyerTier - ownTier;
    if (drop > allowedDrop) {
      return {
        ok: false,
        reason: `${p.name} won't drop ${drop} division${drop === 1 ? "" : "s"} at this stage of his career.`,
      };
    }
  }

  // Reputation gap. Measured against his own club where he has one; a free agent
  // is measured against the standing his ability implies, so a released star
  // still can't be signed by anyone at all on day one.
  const ownRep = p.clubId
    ? state.teams[p.clubId]?.reputation ?? impliedReputation(p, cfg)
    : impliedReputation(p, cfg);
  // The tolerance widens with desperation on the same curve as the tier gate.
  const tolerance = cfg.consentMaxRepDrop * (1 + decay);
  if (ownRep - buyerRep > tolerance) {
    return {
      ok: false,
      reason: `${p.name} sees ${buyer.name} as a step down and isn't interested.`,
    };
  }
  return { ok: true };
}

/** The club reputation a player's own ability implies — the standing he behaves
 * as though he has when he isn't attached to a club to read it from. Mapped off
 * the same elite threshold the gate uses so the two stay in step. */
function impliedReputation(p: PlayerBio, cfg: TuningConfig): number {
  // A player at the elite line reads as a peer-level club; every point above
  // adds standing, every point below sheds it, clamped to the 1-100 rep scale.
  const gap = p.overall - cfg.consentEliteOverall;
  return Math.max(1, Math.min(100, cfg.consentPeerReputation + gap * 1.5));
}

// ── 2. Wage demand floors ─────────────────────────────────────────────────

/**
 * The lowest weekly wage this player will sign for, wherever the offer comes
 * from. This is the fix for the real cause of lower-league star signings: the
 * v1.65 market scaling quotes a player his BUYER's going rate, so a fourth-tier
 * club was offered an 80-overall player at fourth-tier wages and cleared
 * `canAfford` comfortably. The floor is anchored to the player instead:
 *
 *  - `wageFloorShareOfCurrent` of what he's on now (a move may cost him a little,
 *    never most of his salary), and
 *  - `wageFloorShareOfAbility` of what his ability commands in a TOP-tier market,
 *    stepped up further for elite players by `wageFloorEliteStep`.
 *
 * The higher of the two binds. Desperation erodes it toward
 * `desperationMinWageFloorShare`, which is what eventually lets a long-idle
 * player take a lower-league deal.
 *
 * A lower-league club is expected to fail `canAfford` against this number. That
 * is the intended outcome — the club fails the financial test rather than the
 * player being handed a discount he'd never accept in reality.
 */
export function wageFloor(state: GameState, p: PlayerBio, cfg: TuningConfig): number {
  // What his ability is worth in the strongest market — the anchor that does not
  // move with whoever happens to be bidding.
  const topMarket = leagueWageMult(state, undefined, cfg);
  const eliteStep = Math.max(0, p.overall - cfg.consentEliteOverall) * cfg.wageFloorEliteStep;
  const abilityFloor =
    baseWage(p.overall, cfg) * cfg.contractDemandMult * topMarket * (cfg.wageFloorShareOfAbility + eliteStep);

  const currentFloor = (p.contract?.wage ?? 0) * cfg.wageFloorShareOfCurrent;

  const floor = Math.max(abilityFloor, currentFloor);
  // Desperation shaves the floor, never below `desperationMinWageFloorShare`.
  const decay = desperation(p, cfg);
  const share = 1 - decay * (1 - cfg.desperationMinWageFloorShare);
  return Math.max(500, Math.round((floor * share) / 100) * 100);
}

/**
 * What the buying club must actually budget for this player: his market-rate
 * demand in their league, floored by what he'll personally accept.
 *
 * Every market path (`canAfford` checks, sale suitors, AI shopping) prices a
 * target through here rather than through `wageDemand` directly, so no path can
 * quote a player below his floor and let an unaffordable club through.
 */
export function effectiveWageDemand(
  state: GameState,
  p: PlayerBio,
  cfg: TuningConfig,
  marketDemand: number
): number {
  return Math.max(marketDemand, wageFloor(state, p, cfg));
}

// ── 3. Expectation decay tracking ─────────────────────────────────────────

/**
 * Accrue or clear inactivity for every living player. Called from the weekly
 * tick with the number of days elapsed since it last ran.
 *
 * "Inactive" is deliberately measured in MINUTES rather than appearances — a
 * player brought on for the last five minutes every week is not getting a
 * career, and the squad-rotation work in lib/rotation.ts is what's meant to keep
 * him above the line. A player over `desperationMinutesShare` of the minutes
 * available to him resets to zero, so the curve only ever runs for players who
 * genuinely aren't playing.
 */
export function tickInactivity(state: GameState, players: PlayerBio[], days: number, cfg: TuningConfig) {
  for (const p of players) {
    if (p.retired) continue;
    // Out on loan he's someone else's problem and is (by design) playing.
    if (p.loan) {
      p.inactiveDays = 0;
      continue;
    }
    if (!p.clubId) {
      p.inactiveDays = (p.inactiveDays ?? 0) + days;
      continue;
    }
    const share = minutesShare(state, p);
    // Before a side has played enough for the share to mean anything, nobody is
    // judged — otherwise every squad in the world reads as inactive in August.
    if (share === null) continue;
    if (share >= cfg.desperationMinutesShare) p.inactiveDays = 0;
    else p.inactiveDays = (p.inactiveDays ?? 0) + days;
  }
}

/** Minimum matches a club must have played before a minutes share is meaningful. */
const MINUTES_SHARE_MIN_MATCHES = 5;

/**
 * What share of his club's available league minutes this player has taken this
 * season. `null` until the club has played `MINUTES_SHARE_MIN_MATCHES`, so the
 * early season never brands a squad inactive.
 */
export function minutesShare(state: GameState, p: PlayerBio): number | null {
  if (!p.clubId) return null;
  const played = state.fixtures.filter(
    (f) => f.played && (f.homeId === p.clubId || f.awayId === p.clubId)
  ).length;
  if (played < MINUTES_SHARE_MIN_MATCHES) return null;
  return (p.stats.minutes ?? 0) / (played * 90);
}

/** Mark a player as newly on the market (v1.66) — listed, released, or running
 * his deal down. Starts the peer-priority window in lib/ai/market.ts. */
export function markAvailable(state: GameState, p: PlayerBio) {
  p.availableSince = state.currentDay;
}

/** Clear the market mark — he's signed somewhere, or been taken off the list. */
export function clearAvailable(p: PlayerBio) {
  p.availableSince = undefined;
}

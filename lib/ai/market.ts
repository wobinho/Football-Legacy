// ── Market access rules (§10, v1.66) ──────────────────────────────────────
// Who is even ALLOWED to approach a given player, before any question of money.
// Two rules live here, and every market path in lib/transfers.ts runs its
// candidate buyers through `canApproach` so neither can be bypassed:
//
//   1. Consent (lib/consent.ts) — the player has to be willing to join at all.
//   2. Peer priority — when a high-reputation player first becomes available,
//      clubs at his own level get an exclusive window to bid. Previously every
//      club in the world saw a listed player simultaneously, so whichever club
//      the weighted draw happened to pick could sign him — including a third
//      division side that got lucky on the roll.
//
// A "peer" is a club within `peerPriorityTierBand` tiers of the player's own
// division, or any club over `consentPeerReputation` (a big foreign club in a
// lesser league is always a peer). Everyone else must wait out
// `peerPriorityDays` from `availableSince`. If the peers pass, the window simply
// expires and the rest of the pyramid can move — the rule delays lower-tier
// interest, it never forbids it forever.

import type { GameState, PlayerBio, Team } from "../types";
import type { TuningConfig } from "../config/tuning";
import { willJoin, tierOf, playerTier } from "../consent";

/** Is this club a peer of the player — at his level, or big enough that level
 * doesn't matter? */
export function isPeerClub(state: GameState, p: PlayerBio, club: Team, cfg: TuningConfig): boolean {
  if (club.reputation >= cfg.consentPeerReputation) return true;
  const own = playerTier(state, p);
  // A free agent has no tier of his own; his ability sets the bar instead, so
  // only genuinely well-regarded clubs count as peers for a big name.
  if (own === null) return club.reputation >= cfg.consentPeerReputation;
  return tierOf(state, club) - own <= cfg.peerPriorityTierBand;
}

/** Is the player still inside his peer-only window? */
export function inPeerWindow(state: GameState, p: PlayerBio, cfg: TuningConfig): boolean {
  if (p.overall < cfg.peerPriorityOverall) return false;
  if (p.availableSince === undefined) return false;
  return state.currentDay - p.availableSince < cfg.peerPriorityDays;
}

/**
 * May this club approach this player right now? The single gate every market
 * path calls — AI squad building, sim-league deals, sale suitors and incoming
 * offers on the user's players all route through it, so a rule added here binds
 * everywhere rather than in whichever path was remembered.
 */
export function canApproach(
  state: GameState,
  buyer: Team,
  p: PlayerBio,
  cfg: TuningConfig
): boolean {
  // Peer priority first — it's the cheaper test and rejects the common case.
  if (inPeerWindow(state, p, cfg) && !isPeerClub(state, p, buyer, cfg)) return false;
  return willJoin(state, p, buyer, cfg).ok;
}

/**
 * Order a set of interested clubs so peers are served first (v1.66).
 *
 * `canApproach` already excludes non-peers inside the window; this handles the
 * softer ordering AFTER it expires, where a lower-division club may bid but
 * shouldn't beat an equally-keen club at the player's own level to the signature.
 * Peers sort ahead of non-peers, and keenness orders within each group.
 */
export function byPeerPriority<T extends { team: Team; score: number }>(
  state: GameState,
  p: PlayerBio,
  rows: T[],
  cfg: TuningConfig
): T[] {
  return rows.slice().sort((a, b) => {
    const pa = isPeerClub(state, p, a.team, cfg) ? 1 : 0;
    const pb = isPeerClub(state, p, b.team, cfg) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.score - a.score;
  });
}

// ── Player contracts (§10, v5) ────────────────────────────────────────────
// Overrides the old aggregate wage bill: every squad player carries an
// individual Contract (wage + length + expiry season). The squad wage bill is
// now the sum of real contract wages; expiring deals must be renewed or the
// player leaves on a free at the season rollover. Kept isolated in one module
// like the rest of the transfer/economy systems (§2 modularity).

import type { Contract, GameState, PlayerBio } from "./types";
import type { TuningConfig } from "./config/tuning";
import { deriveSeed, mulberry32 } from "./rng";
import { pushInboxItem } from "./inbox";
import { activePlayers } from "./archive";

/** The base weekly wage the wage curve implies for an ability level. */
export function baseWage(overall: number, cfg: TuningConfig): number {
  return Math.round((cfg.contractWageCurve.base * Math.exp(cfg.contractWageCurve.exponent * overall)) / 100) * 100;
}

/** Age nudge on wage demands: kids come cheaper, primed stars a touch dearer. */
function ageDemandFactor(age: number): number {
  if (age <= 20) return 0.75;
  if (age <= 23) return 0.9;
  if (age <= 30) return 1.0;
  if (age <= 33) return 0.92;
  return 0.8;
}

/** What a player would demand per week to sign a fresh deal. Deterministic-ish
 * (seeded per player) so the number is stable across a negotiation session. */
export function wageDemand(state: GameState, p: PlayerBio, cfg: TuningConfig): number {
  const rng = mulberry32(deriveSeed(state.seed, `wage:${p.id}:${p.overall}`));
  const jitter = 0.9 + rng() * 0.2;
  const raw = baseWage(p.overall, cfg) * cfg.contractDemandMult * ageDemandFactor(p.age) * jitter;
  return Math.max(500, Math.round(raw / 100) * 100);
}

/** How many seasons the player is willing to commit to (veterans go short). */
export function maxLengthFor(p: PlayerBio, cfg: TuningConfig): number {
  if (p.age >= cfg.contractVeteranAge + 3) return 1;
  if (p.age >= cfg.contractVeteranAge) return 2;
  return cfg.contractLengthMax;
}

/** Build a contract running `years` seasons from the current season. */
export function makeContract(state: GameState, wage: number, years: number, releaseClause?: number): Contract {
  return {
    wage,
    expirySeason: state.season + Math.max(1, years) - 1,
    signedSeason: state.season,
    ...(releaseClause ? { releaseClause } : {}),
  };
}

/** Seasons remaining on a contract, given the current season. */
export function yearsLeft(state: GameState, p: PlayerBio): number {
  if (!p.contract) return 0;
  return Math.max(0, p.contract.expirySeason - state.season + 1);
}

// ── Release clauses (§10, v21) ────────────────────────────────────────────
// A clause is a fixed fee that lets any club buy the player outright, ignoring
// what his own club thinks he's worth. The player likes having one — it's an
// exit route — so he'll shave his wage demand to get it. How much he shaves
// depends on how reachable the number is: a clause near his market value is a
// genuine escape hatch and is worth real money to him, one at four times value
// is decoration and buys nothing.

/** The lowest clause figure this player would accept, or the point above which
 * a clause stops being worth anything to him. Both are multiples of value. */
export function releaseClauseBounds(p: PlayerBio, cfg: TuningConfig): { min: number; max: number; suggested: number } {
  const round = (n: number) => Math.max(100_000, Math.round(n / 100_000) * 100_000);
  return {
    min: round(p.value * cfg.releaseClauseMinMult),
    max: round(p.value * cfg.releaseClauseMaxMult),
    suggested: round(p.value * cfg.releaseClauseSuggestedMult),
  };
}

/** The fraction a player knocks off his wage demand in exchange for a clause at
 * `clause`. Full discount at the minimum acceptable figure, tapering linearly to
 * nothing at the point the clause is too remote to matter. */
export function releaseClauseWageDiscount(p: PlayerBio, clause: number | undefined, cfg: TuningConfig): number {
  if (!clause) return 0;
  const { min, max } = releaseClauseBounds(p, cfg);
  if (clause < min || max <= min) return 0;
  const reach = Math.min(1, (clause - min) / (max - min)); // 0 = right at the floor
  return cfg.releaseClauseMaxWageDiscount * (1 - reach);
}

/** What this player demands per week given the clause on the table (if any). */
export function wageDemandWithClause(
  state: GameState,
  p: PlayerBio,
  clause: number | undefined,
  cfg: TuningConfig
): number {
  const base = wageDemand(state, p, cfg);
  const discounted = base * (1 - releaseClauseWageDiscount(p, clause, cfg));
  return Math.max(500, Math.round(discounted / 100) * 100);
}

export interface OfferVerdict {
  kind: "accepted" | "countered" | "rejected";
  wage: number; // agreed (accepted) or demanded (countered/rejected)
  message: string;
}

/** A player weighs a contract offer of `wage`/wk over `years`. Accepts at/above
 * their demand, counters with the demand if the offer is close, rejects if it's
 * miserly. Length beyond what a veteran will sign is trimmed on acceptance. */
export function evaluateOffer(
  state: GameState,
  p: PlayerBio,
  wage: number,
  years: number,
  cfg: TuningConfig,
  releaseClause?: number
): OfferVerdict {
  // A clause below what he'd ever accept is worse than none — he won't be tied
  // to a number that lets anyone take him for a fraction of his worth.
  if (releaseClause !== undefined) {
    const { min } = releaseClauseBounds(p, cfg);
    if (releaseClause < min) {
      return {
        kind: "rejected",
        wage: wageDemand(state, p, cfg),
        message: `${p.name} won't be bought out that cheaply — any release clause has to start around ${fmt(min)}.`,
      };
    }
  }
  const demand = wageDemandWithClause(state, p, releaseClause, cfg);
  const cappedYears = Math.min(years, maxLengthFor(p, cfg));
  if (wage >= demand * cfg.contractAcceptRatio) {
    const clauseNote = releaseClause ? ` with a ${fmt(releaseClause)} release clause` : "";
    return { kind: "accepted", wage, message: `${p.name} accepts ${cappedYears}-year terms at ${fmt(wage)}/wk${clauseNote}.` };
  }
  if (wage >= demand * cfg.contractRejectRatio) {
    return { kind: "countered", wage: demand, message: `${p.name} wants ${fmt(demand)}/wk to sign.` };
  }
  return { kind: "rejected", wage: demand, message: `${p.name} laughed off the offer — he's looking for around ${fmt(demand)}/wk.` };
}

/** Apply an accepted deal to a player already at the club (renewal) or joining. */
export function applyContract(
  state: GameState,
  p: PlayerBio,
  wage: number,
  years: number,
  cfg: TuningConfig,
  releaseClause?: number
) {
  p.contract = makeContract(state, wage, Math.min(years, maxLengthFor(p, cfg)), releaseClause);
}

/** Give a newly-signed player a default contract at their demand (used when a
 * transfer/free signing completes without an explicit negotiation, keeping the
 * AI world simple). */
export function grantDefaultContract(state: GameState, p: PlayerBio, cfg: TuningConfig, years?: number) {
  const wage = wageDemand(state, p, cfg);
  const len = years ?? Math.min(cfg.contractRenewYearsDefault, maxLengthFor(p, cfg));
  p.contract = makeContract(state, wage, len);
}

/** Ensure every club-attached player has a contract (backfill for AI signings /
 * migrated saves). Free agents and retirees keep none. Lengths are staggered
 * (seeded per player) so a fresh world's deals don't all expire the same summer
 * — real squads have a spread of contract situations. */
export function ensureContracts(state: GameState, cfg: TuningConfig) {
  const userAcademy = new Set(state.teams[state.userTeamId].academyPlayerIds ?? []);
  // Retirees are handled by the rollover's prune pass, which clears their
  // contracts as part of compacting them — so this only walks the living world.
  for (const p of activePlayers(state)) {
    if (!p.clubId) {
      p.contract = undefined;
      continue;
    }
    // The user's academy players are wage-free (§18) — no contract until promoted.
    if (userAcademy.has(p.id)) continue;
    if (!p.contract) {
      const rng = mulberry32(deriveSeed(state.seed, `clen:${p.id}`));
      const span = maxLengthFor(p, cfg);
      const years = 1 + Math.floor(rng() * span); // 1..span, evenly spread
      grantDefaultContract(state, p, cfg, years);
    }
  }
}

/**
 * Season-rollover contract pass. Runs after ages tick and before the new season
 * scaffolding. Expiring deals:
 *  - user players: released to free agency (they were warned the season before).
 *  - AI players: auto-renewed silently so the AI world never bleeds squads.
 * A final-year warning goes out for the user's own players still under contract.
 * Returns the list of released user player names for the review inbox.
 */
export function rolloverContracts(state: GameState, cfg: TuningConfig): string[] {
  const released: string[] = [];
  const userId = state.userTeamId;

  const userAcademy = new Set(state.teams[userId].academyPlayerIds ?? []);
  for (const p of activePlayers(state)) {
    if (!p.clubId || !p.contract) continue;
    // Academy players carry no wages and are governed by the §18 age-out rule,
    // not contract expiry — never release them here.
    if (userAcademy.has(p.id)) continue;
    const expired = p.contract.expirySeason < state.season;
    if (!expired) continue;

    if (p.clubId === userId) {
      // free agent — detach from the squad/academy and clear the contract
      const team = state.teams[userId];
      team.playerIds = team.playerIds.filter((id) => id !== p.id);
      team.academyPlayerIds = (team.academyPlayerIds ?? []).filter((id) => id !== p.id);
      state.academy.focusIds = state.academy.focusIds.filter((id) => id !== p.id);
      state.academy.loanList = state.academy.loanList.filter((id) => id !== p.id);
      p.clubId = null;
      p.contract = undefined;
      p.loan = undefined;
      released.push(p.name);
      if (!state.careers[p.id]) state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
      state.careers[p.id].transfers.push({ season: state.season, day: state.currentDay, from: team.name, to: "Contract expired", fee: 0 });
    } else {
      // AI: renew at demand so no AI club loses a player to admin
      grantDefaultContract(state, p, cfg);
    }
  }

  // warn the user about their own players entering the final year of a deal
  const team = state.teams[userId];
  const finalYear = [...team.playerIds, ...(team.academyPlayerIds ?? [])]
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired && p.contract && p.contract.expirySeason === state.season);
  if (finalYear.length) {
    pushInboxItem(
      state,
      "board",
      "Contracts entering their final year",
      `${finalYear.map((p) => p.name).join(", ")} ${finalYear.length === 1 ? "is" : "are"} in the last year of their contract. ` +
        `Renew them on the Squad screen or risk losing them for nothing next summer.`
    );
  }

  return released;
}

function fmt(n: number): string {
  return n >= 1_000 ? `£${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `£${n}`;
}

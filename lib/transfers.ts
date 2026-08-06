// ── Transfer Market ───────────────────────────────────────────────────────
// [OPEN §10] The design doc reserves the final market rules for a design
// session. This is a deliberately simple interim implementation of the
// settled parts: single fee vs single budget, two windows, stored market
// values. Valuation formula details and richer AI behavior are the knobs
// the future session should revisit — all logic is isolated in this module.

import type { GameState, PlayerBio, Pos, Team, TransferNewsItem, TransferOffer } from "./types";
import type { TuningConfig } from "./config/tuning";
import { positionFit } from "./config/positions";
import { TUNING } from "./config/tuning";
import { transferWindowState } from "./calendar";
import { mulberry32, deriveSeed, pickWeighted, uid } from "./rng";
import { valueWithYouthPr } from "./economy";
import { aiLetsExpire, grantDefaultContract, makeContract } from "./contracts";
import { assignKitNumber, clearKitNumber } from "./kitnumbers";
import { activePlayers, isFreeAgent } from "./archive";
import { trackUserTransfer, syncProgress } from "./achievements";
import { purgePlayerFromTactics } from "./tactics";
import type { RNG } from "./rng";
import {
  STANCE_PROFILE,
  stanceOf,
  squadNeeds,
  targetScore,
  saleCandidates,
  buyBudgetFor,
  canAfford,
  isDistressed,
  spendableBudget,
  isUncovered,
  type PositionNeed,
} from "./ai/strategy";
import { wageDemand } from "./contracts";
import { effectiveWageDemand, willJoin, markAvailable, clearAvailable } from "./consent";
import { canApproach, byPeerPriority } from "./ai/market";

/**
 * The wage a buying club must budget for a target (v1.66). His going rate in
 * THEIR market, floored by what he'll personally accept — see lib/consent.ts.
 * Every affordability test in this module prices through here, so no path can
 * quote a player a lower-league wage he'd never sign for and thereby let an
 * unaffordable club sneak past `canAfford`.
 */
function askWage(state: GameState, p: PlayerBio, cfg: TuningConfig, atLeagueId?: string): number {
  return effectiveWageDemand(state, p, cfg, wageDemand(state, p, cfg, atLeagueId));
}

export function windowOpen(state: GameState): boolean {
  return transferWindowState(state.currentDay, state.schedule).open;
}

/** Is this player one of the club's best XI (they'll demand a premium)? */
function isKeyPlayer(state: GameState, p: PlayerBio): boolean {
  if (!p.clubId) return false;
  const squad = state.teams[p.clubId].playerIds
    .map((id) => state.players[id])
    .sort((a, b) => b.overall - a.overall);
  return squad.indexOf(p) < 11;
}

export function askPrice(state: GameState, p: PlayerBio, cfg: TuningConfig): number {
  // A release clause overrides the selling club entirely (v21) — that's the
  // whole point of one. Whatever the club would have asked, this is the number.
  if (p.contract?.releaseClause) return p.contract.releaseClause;

  let mult = cfg.aiAcceptThreshold;
  const key = isKeyPlayer(state, p);
  if (key) mult *= cfg.aiKeyPlayerPremium;
  if (p.age <= 22 && p.potential - p.overall >= 6) mult *= 1.15;
  // The selling club's stance sets how badly it wants to keep him: a side going
  // for the title prices its players out of the market, one rebuilding is happy
  // to cash in (§10). v1.43: the key-player premium is applied ONCE (above); a
  // club unwilling to sell starters names a firmer price through a single small
  // bump here rather than stacking the full premium a second time.
  if (p.clubId && p.clubId !== state.userTeamId) {
    const seller = state.teams[p.clubId];
    if (seller) {
      const profile = STANCE_PROFILE[stanceOf(state, seller, cfg)];
      mult *= profile.sellAsk;
      if (key && !profile.sellsStarters) mult *= 1.15;
    }
  }
  // v1.43+: the ask must sit RIGHT ON the player's market value — a 137M player
  // should cost ~120M–150M, not several multiples of it. The signals above still
  // decide the *ordering* (a title club's star asks a touch more than a fringe
  // squad player), but the whole spread is compressed hard toward 1.0× value and
  // then clamped to a tight band, so buying at value is always realistic.
  const compressed = 1 + (mult - 1) * cfg.askValueCompression;
  const clamped = Math.max(cfg.askValueMinMult, Math.min(cfg.askValueMaxMult, compressed));
  return Math.round((p.value * clamped) / 100_000) * 100_000;
}

function ensureCareer(state: GameState, playerId: string) {
  if (!state.careers[playerId]) state.careers[playerId] = { playerId, seasons: [], transfers: [] };
}

/** Cap on the structured transfer feed (v22). Deep enough to read as a live wire
 * across a whole season's windows, bounded so a long save can't grow it forever. */
const TRANSFER_NEWS_CAP = 200;

/**
 * Append one completed deal to the world's transfer feed (v22, Transfers →
 * News). Called from completeTransfer for every senior move between clubs. The
 * kind is derived here from the from/to shape unless the caller pins it (a
 * release-clause trigger and a plain sale both go club→club, so the caller
 * disambiguates those). Free-agent signings and releases are inferred.
 */
function logTransferNews(
  state: GameState,
  p: PlayerBio,
  fromClubId: string | null,
  toClubId: string | null,
  fee: number,
  kind?: TransferNewsItem["kind"]
) {
  const feed = (state.transferNews ??= []);
  const resolved: TransferNewsItem["kind"] =
    kind ?? (!fromClubId ? "free" : !toClubId ? "release" : "transfer");
  feed.unshift({
    id: uid("tn"),
    season: state.season,
    day: state.currentDay,
    playerId: p.id,
    playerName: p.name,
    playerNat: p.nationality,
    fromClubId,
    fromName: fromClubId ? state.teams[fromClubId]?.name ?? "—" : "Free agent",
    toClubId,
    toName: toClubId ? state.teams[toClubId]?.name ?? "—" : "Released",
    fee,
    kind: resolved,
    involvesUser: fromClubId === state.userTeamId || toClubId === state.userTeamId,
  });
  if (feed.length > TRANSFER_NEWS_CAP) feed.length = TRANSFER_NEWS_CAP;
}

/** Move a player between clubs (or from/to free agency) and settle money. When a
 * destination is given, the player picks up a contract there — explicit terms if
 * supplied (a user-negotiated signing), otherwise a default deal at their
 * demand. Releasing clears the contract. */
export function completeTransfer(
  state: GameState,
  playerId: string,
  toClubId: string | null,
  fee: number,
  terms?: { wage: number; years: number; releaseClause?: number },
  /** How the deal came about (v22 transfer feed). Defaults are inferred from the
   * from/to shape; pass "clause" or "loan" where they can't be. */
  kind?: TransferNewsItem["kind"]
) {
  const p = state.players[playerId];
  const fromClubId = p.clubId;
  if (fromClubId) {
    const from = state.teams[fromClubId];
    from.playerIds = from.playerIds.filter((id) => id !== playerId);
    if (from.academyPlayerIds?.includes(playerId)) {
      from.academyPlayerIds = from.academyPlayerIds.filter((id) => id !== playerId);
    }
    from.budget += fee;
  }
  // leaving the club ends any academy involvement (§18)
  p.loan = undefined;
  state.academy.focusIds = state.academy.focusIds.filter((id) => id !== playerId);
  state.academy.u21Squad = (state.academy.u21Squad ?? []).filter((id) => id !== playerId);
  state.academy.loanList = state.academy.loanList.filter((id) => id !== playerId);
  if (toClubId) {
    const to = state.teams[toClubId];
    to.playerIds.push(playerId);
    to.budget -= fee;
    if (terms) p.contract = makeContract(state, terms.wage, terms.years, terms.releaseClause);
    // Priced in the league he's joining, not the one he's leaving — clubId
    // still points at the old club at this point in the move (v1.65).
    else grantDefaultContract(state, p, TUNING, undefined, to.leagueId);
  } else {
    p.contract = undefined; // released to free agency
  }
  // Same-season resale lock (v1.54, world-wide since v1.89): a player who joins a
  // club can't move on again until the next season. Stamped for a move into ANY
  // club, not just the user's — a rule that only bound the manager let AI squads
  // churn the same player through three clubs in one window while the user was
  // held to one move, and made the transfer feed read as noise rather than
  // business. A release clears it: a free agent has no club to be locked to, and
  // he should be signable the moment he's available.
  if (toClubId) p.acquiredSeason = state.season;
  else p.acquiredSeason = undefined;
  p.clubId = toClubId;
  p.form = 1.0;
  // Market status (v1.66): joining a club takes him off the market and resets the
  // desperation curve — he's somewhere, and presumed to be playing until the
  // weekly inactivity tick says otherwise. Being released does the opposite: it
  // puts him on the market and starts his peer-priority window.
  if (toClubId) {
    clearAvailable(p);
    p.inactiveDays = 0;
  } else {
    markAvailable(state, p);
  }
  // Shirt number (v15): the old club's number is given up on the way out and a
  // free one at the new club is taken on the way in.
  clearKitNumber(p);
  if (toClubId) assignKitNumber(state, p);
  ensureCareer(state, playerId);
  state.careers[playerId].transfers.push({
    season: state.season,
    day: state.currentDay,
    from: fromClubId ? state.teams[fromClubId].name : "Free agent",
    to: toClubId ? state.teams[toClubId].name : "Released",
    fee,
    fromId: fromClubId ?? undefined,
    toId: toClubId ?? undefined,
  });
  // Structured world feed (v22, Transfers → News). Logged for every move a club
  // is party to — a plain release with no club on either side (shouldn't happen)
  // is skipped so the feed stays about clubs doing business.
  if (fromClubId || toClubId) logTransferNews(state, p, fromClubId, toClubId, fee, kind);
  // Manager accolades (v1.45): a deal the user's club is party to feeds the
  // transfer-market milestones (biggest signing/sale, career spend/receive). A
  // buy and a sell are tracked from the user's own side; AI↔AI deals are ignored.
  if (toClubId === state.userTeamId) {
    trackUserTransfer(state, "buy", fee, p);
    syncProgress(state);
  } else if (fromClubId === state.userTeamId) {
    trackUserTransfer(state, "sell", fee, p);
    syncProgress(state);
  }
  // clean up any other pending offers for this player
  state.offers = state.offers.filter((o) => o.playerId !== playerId || o.status !== "pending");
  state.transferList = state.transferList.filter((id) => id !== playerId);
  // Scrub him from the live XI, the bench and every saved tactic in one place —
  // a moved-on player must not linger in any stored lineup (see purge notes).
  purgePlayerFromTactics(state, playerId);
}

/** Release a senior player from the user's squad (v14). He leaves as a free
 * agent immediately — no fee either way, and the club eats the remaining wage
 * commitment as the price of a clean break. Academy prospects release through
 * releaseFromAcademy instead (they have no contract to tear up). */
export function releasePlayer(state: GameState, playerId: string): string | null {
  const team = state.teams[state.userTeamId];
  const p = state.players[playerId];
  if (!p) return "No such player.";
  if (!team.playerIds.includes(playerId)) return "Not in your senior squad.";
  if (p.loan) return "Recall him from his loan spell first.";
  completeTransfer(state, playerId, null, 0);
  state.academy.loanList = state.academy.loanList.filter((id) => id !== playerId);
  state.news.unshift(`${team.name} release ${p.name}. He is a free agent.`);
  return null;
}

export type BidOutcome =
  | { kind: "accepted" }
  | { kind: "countered"; counterFee: number }
  | { kind: "rejected"; reason: string }
  | { kind: "error"; reason: string };

/** User bids on an AI club's player (or a free agent). Instant AI verdict. When
 * a fee is agreed, `terms` (the negotiated contract) are applied to the signing;
 * omitted (e.g. legacy callers) falls back to a default deal. */
export function userBid(
  state: GameState,
  playerId: string,
  fee: number,
  cfg: TuningConfig,
  terms?: { wage: number; years: number; releaseClause?: number }
): BidOutcome {
  const p = state.players[playerId];
  const user = state.teams[state.userTeamId];
  if (!windowOpen(state)) return { kind: "error", reason: "The transfer window is closed." };
  if (p.clubId === state.userTeamId) return { kind: "error", reason: "Already your player." };

  // The player's own verdict on the move (v1.66). The user manages a club like
  // any other, so the same standard-of-football gate applies to them: a manager
  // in the third tier can't sign a top-flight star simply because the wage their
  // league quotes happens to fit the budget. The refusal is explicit rather than
  // silent, so the user learns the rule rather than wondering why bids vanish.
  // Same-season resale lock (v1.89). A player who joined his club this season is
  // not for sale to anyone, the user included — the rule binds every club, so the
  // manager can't buy a player out of the very window that took him elsewhere.
  // Free agents are exempt: `acquiredSeason` is cleared on release.
  if (p.clubId && signedThisSeason(state, p)) {
    return {
      kind: "rejected",
      reason: `${p.name} only joined ${state.teams[p.clubId].name} this season — he can't move again until next season.`,
    };
  }

  const verdict = willJoin(state, p, user, cfg);
  if (!verdict.ok) return { kind: "rejected", reason: verdict.reason };
  // Wages are floored by what he'll accept, not by what the user's division pays.
  const wage = askWage(state, p, cfg, user.leagueId);
  if (terms && terms.wage < wage) {
    return { kind: "rejected", reason: `${p.name} won't sign for less than ${fmtWage(wage)}/wk.` };
  }

  // Free agent (v21): there is no selling club and so no fee to negotiate — the
  // deal is the contract. The fee argument is ignored rather than validated, so
  // a free signing can never be blocked by a budget check on money nobody is
  // being paid.
  if (!p.clubId) {
    completeTransfer(state, playerId, state.userTeamId, cfg.freeAgentSigningFee, terms);
    return { kind: "accepted" };
  }

  // No senior squad cap for the user (v14) — the wage bill is the constraint on
  // hoarding, not an arbitrary slot count. AI clubs still respect cfg.squadCap.
  if (fee > user.budget) return { kind: "error", reason: "That bid exceeds your budget." };

  const ask = askPrice(state, p, cfg);
  if (fee >= ask) {
    completeTransfer(state, playerId, state.userTeamId, fee, terms);
    return { kind: "accepted" };
  }
  if (fee >= ask * 0.8) {
    return { kind: "countered", counterFee: ask };
  }
  return { kind: "rejected", reason: `${state.teams[p.clubId].name} rejected the bid outright. They value ${p.name} far higher.` };
}

/** The most a buyer will pay for this player — their hidden ceiling. Seeded so a
 * negotiation is deterministic (no reload scumming). */
function buyerCeilingFor(state: GameState, offer: TransferOffer, p: PlayerBio, cfg: TuningConfig): number {
  const buyer = state.teams[offer.fromClubId];
  const rng = mulberry32(deriveSeed(state.seed, `ceiling:${offer.id}`));
  // Ceiling scales with value and a per-offer appetite roll, never below the
  // opening bid, and never above what the buyer can actually afford.
  const base = p.value * cfg.negotiationBuyerCeilingMult * (0.9 + rng() * 0.3);
  const ceiling = Math.max(offer.fee, Math.round(base / 100_000) * 100_000);
  return Math.min(ceiling, buyer.budget);
}

/**
 * How much patience a buyer brings to THIS negotiation (v19).
 *
 * Rolled per offer rather than read from a global constant, so every deal has
 * its own temperament: a club that badly needs the player, or one with money to
 * spare, will haggle for far longer than a lukewarm suitor. The value is seeded
 * off the offer id so it's deterministic (no reload scumming) and stable across
 * a save/load in the middle of talks.
 */
function rollPatience(state: GameState, offer: TransferOffer, p: PlayerBio, cfg: TuningConfig): number {
  const rng = mulberry32(deriveSeed(state.seed, `patience:${offer.id}`));
  const span = cfg.negotiationPatienceMax - cfg.negotiationPatienceMin;
  let patience = cfg.negotiationPatienceMin + rng() * span;
  // A buyer who bid well over market value has already shown its hand — it wants
  // this player and will put up with more haggling to get him.
  const keenness = p.value > 0 ? offer.fee / p.value : 1;
  if (keenness > 1.2) patience *= 1.15;
  else if (keenness < 0.9) patience *= 0.85;
  return Math.round(patience);
}

/** Ensure an offer carries its negotiation state (ceiling + patience). Offers
 * created before v19, or by paths that don't seed it, are filled in lazily. */
function ensureNegotiationState(state: GameState, offer: TransferOffer, p: PlayerBio, cfg: TuningConfig) {
  offer.buyerCeiling ??= buyerCeilingFor(state, offer, p, cfg);
  offer.patienceMax ??= rollPatience(state, offer, p, cfg);
  offer.patience ??= offer.patienceMax;
}

/** Live negotiation state for the UI (v19): the patience bar and the round
 * counter, without exposing the buyer's hidden ceiling. */
export interface NegotiationState {
  patience: number;
  patienceMax: number;
  /** 0..1 — what the bar fills to. */
  ratio: number;
  round: number;
}

/** Read (and lazily seed) an offer's negotiation state for display. */
export function negotiationStateOf(
  state: GameState,
  offerId: string,
  cfg: TuningConfig
): NegotiationState | null {
  const offer = state.offers.find((o) => o.id === offerId);
  if (!offer) return null;
  const p = state.players[offer.playerId];
  if (!p) return null;
  ensureNegotiationState(state, offer, p, cfg);
  const max = offer.patienceMax ?? 1;
  const patience = Math.max(0, offer.patience ?? 0);
  return { patience, patienceMax: max, ratio: Math.max(0, Math.min(1, patience / max)), round: offer.negotiationRound ?? 0 };
}

export type OfferResponse =
  | { kind: "accepted"; fee: number; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "countered"; counterFee: number; message: string } // AI countered back
  | { kind: "withdrawn"; message: string };

/**
 * User responds to an incoming AI offer for one of their players — EA-FC-style.
 *  - "accept": sell at the fee on the table.
 *  - "reject": end it.
 *  - "counter" with an explicit `amount`: the built-in AI decides.
 *      • at/under its (hidden, seeded) ceiling → it accepts.
 *      • a bit over, and patience remains → it counters back toward the midpoint
 *        (raising the offer on the table); the user can accept or counter again.
 *      • wildly over, or patience spent → it walks away.
 */
export function respondToOffer(
  state: GameState,
  offerId: string,
  response: "accept" | "reject" | "counter",
  cfg: TuningConfig,
  amount?: number
): OfferResponse {
  const offer = state.offers.find((o) => o.id === offerId);
  if (!offer || offer.status !== "pending") return { kind: "withdrawn", message: "Offer no longer active." };
  const p = state.players[offer.playerId];
  const buyer = state.teams[offer.fromClubId];

  if (response === "reject") {
    offer.status = "rejected";
    return { kind: "rejected", message: `Rejected ${buyer.name}'s offer for ${p.name}.` };
  }
  // Same-season resale lock (v1.54): a player signed this season can't be sold
  // on, so any offer for one can only be turned down.
  if (signedThisSeason(state, p)) {
    return { kind: "rejected", message: `${p.name} was signed this season — he can't be sold until next season.` };
  }
  if (response === "accept") {
    offer.status = "completed";
    completeTransfer(state, offer.playerId, offer.fromClubId, offer.fee);
    state.news.unshift(`${p.name} leaves for ${buyer.name} — ${fmtFee(offer.fee)}.`);
    return { kind: "accepted", fee: offer.fee, message: `${p.name} sold to ${buyer.name} for ${fmtFee(offer.fee)}.` };
  }

  // ── counter ───────────────────────────────────────────────────────────────
  const want = Math.max(0, Math.round((amount ?? offer.fee) / 100_000) * 100_000);
  ensureNegotiationState(state, offer, p, cfg);
  const ceiling = offer.buyerCeiling!;
  const round = (offer.negotiationRound = (offer.negotiationRound ?? 0) + 1);
  const rng = mulberry32(deriveSeed(state.seed, `counter:${offer.id}:${round}`));

  // Ask for less than the current offer? Just take the money.
  if (want <= offer.fee) {
    offer.status = "completed";
    completeTransfer(state, offer.playerId, offer.fromClubId, offer.fee);
    state.news.unshift(`${p.name} leaves for ${buyer.name} — ${fmtFee(offer.fee)}.`);
    return { kind: "accepted", fee: offer.fee, message: `${p.name} sold to ${buyer.name} for ${fmtFee(offer.fee)}.` };
  }

  // Within the ceiling → they meet it.
  if (want <= ceiling) {
    offer.status = "completed";
    completeTransfer(state, offer.playerId, offer.fromClubId, want);
    state.news.unshift(`${p.name} leaves for ${buyer.name} — ${fmtFee(want)} after negotiation.`);
    return { kind: "accepted", fee: want, message: `${buyer.name} met your valuation — ${p.name} sold for ${fmtFee(want)}.` };
  }

  // ── Over the ceiling: spend patience proportional to how greedy the ask is ──
  // A modest overreach costs the base amount; asking double the ceiling burns a
  // whole negotiation's worth at once. This is what makes the bar meaningful —
  // it's not a round counter, it's a measure of how hard you've pushed.
  const overshoot = ceiling > 0 ? (want - ceiling) / ceiling : 1;
  const cost = cfg.negotiationPatienceCostBase + overshoot * cfg.negotiationPatienceCostPerOvershoot;
  offer.patience = Math.max(0, (offer.patience ?? 0) - cost);

  const walksOnPrice = want > ceiling * cfg.negotiationWalkAwayOver;
  const outOfPatience = offer.patience <= 0 || round >= cfg.negotiationMaxRounds;
  if (walksOnPrice || outOfPatience) {
    offer.status = "withdrawn";
    const why = walksOnPrice
      ? `${buyer.name} baulked at ${fmtFee(want)} and walked away.`
      : `${buyer.name} won't be pushed any further and have pulled out.`;
    return { kind: "withdrawn", message: why };
  }

  // They still want him, but can't do your number — so they come back with what
  // they CAN do (v19). Rather than a token nudge toward the midpoint, the reply
  // is a genuine proposal near their real limit, which is the thing that makes
  // countering feel like a conversation: you learn where the money actually is.
  const bestAndFinal = ceiling * cfg.negotiationBestAndFinalShare;
  const stepped = offer.fee + (bestAndFinal - offer.fee) * (cfg.negotiationCounterStep + rng() * 0.2);
  const counterBack = Math.min(
    ceiling,
    Math.max(offer.fee, Math.round(Math.max(stepped, bestAndFinal * 0.9) / 100_000) * 100_000)
  );
  offer.fee = counterBack; // the offer on the table rises

  // Tell the user how the room feels, so the bar isn't the only signal.
  const ratio = (offer.patience ?? 0) / (offer.patienceMax || 1);
  const mood =
    ratio > 0.6
      ? "They're still keen to do business."
      : ratio > 0.3
        ? "They're getting frustrated."
        : "This is as far as they'll go — push again and they walk.";
  return {
    kind: "countered",
    counterFee: counterBack,
    message: `${buyer.name} can't reach ${fmtFee(want)}, but came back with ${fmtFee(counterBack)} for ${p.name}. ${mood}`,
  };
}

function fmtFee(fee: number): string {
  return fee >= 1_000_000 ? `£${(fee / 1_000_000).toFixed(1)}M` : `£${Math.round(fee / 1000)}k`;
}

/** Weekly wages are a much smaller number than fees — rendered in k, matching
 * the contract screens rather than the fee formatter. */
function fmtWage(wage: number): string {
  return wage >= 1_000 ? `£${(wage / 1000).toFixed(wage >= 10_000 ? 0 : 1)}k` : `£${wage}`;
}

/**
 * Weekly AI activity while a window is open:
 *  - occasional AI bid on a user player (interrupt-worthy, §3)
 *  - a little AI↔AI business for ticker/news immersion
 * Returns true if a new incoming offer needs the user's attention.
 */
export function aiWeeklyTransferTick(state: GameState, cfg: TuningConfig): boolean {
  if (!windowOpen(state)) return false;
  const rng = mulberry32(deriveSeed(state.seed, `aitick:${state.currentDay}`));
  let interrupt = false;

  // AI bid on a user player. Academy prospects (§18) only attract bids once
  // transfer-listed — their draw is potential, not current ability.
  const user = state.teams[state.userTeamId];
  const listedAcademy = (user.academyPlayerIds ?? [])
    .map((id) => state.players[id])
    .filter((p) => p && !p.loan && state.transferList.includes(p.id));
  // A player draws interest even when he isn't listed (v21) — a good footballer
  // is a target whether or not his club is shopping him. Listing still matters a
  // great deal (it triples the chance below), but the market no longer goes quiet
  // simply because the user hasn't put anyone up for sale. The senior floor is
  // low enough that squad players get the odd approach, not just the stars.
  const userPlayers = [
    ...user.playerIds.map((id) => state.players[id]).filter((p) => p.overall >= 58 && !p.loan),
    ...listedAcademy,
    // A player signed this season can't be sold on (v1.54), so no AI bids for one —
    // an offer that could only be rejected is just noise on the user's screen.
  ].filter((p) => !signedThisSeason(state, p));
  // How many separate offers landed this week (v1.51). The market used to stop
  // dead at the first one (`break`), so the user saw at most one approach a week
  // no matter how many clubs wanted their players — and none at all if that one
  // roll failed. Several clubs can now come calling in the same week, including
  // more than one for the SAME player.
  let offersThisWeek = 0;
  // "Do not disturb" (v1.91) — the manager has switched incoming bids off, so no
  // club opens one this week. Gated here rather than at the top of the tick so
  // AI↔AI business, loans and the rest of the market carry on as normal: the
  // toggle silences the user's inbox, it does not freeze the transfer window.
  if (!state.offersPaused && userPlayers.length && user.playerIds.length > 14) {
    const listedBoost = (p: PlayerBio) => (state.transferList.includes(p.id) ? 3 : 1);
    const quality = (p: PlayerBio) => Math.max(p.overall, p.age <= 21 ? p.potential - 12 : 0);
    for (const p of userPlayers) {
      if (offersThisWeek >= cfg.aiMaxOffersPerWeek) break;
      const chance = cfg.aiBidChancePerWeek * listedBoost(p) * (quality(p) - 54) * 0.015;
      if (rng() < chance) {
        // Only clubs with a real hole in this player's position come calling,
        // and only if he'd actually improve them (§10) — an offer should always
        // be legible to the user, not arbitrary.
        const interested = Object.values(state.teams)
          .filter(
            (t) =>
              t.id !== state.userTeamId &&
              state.leagues[t.leagueId]?.playable &&
              // Only clubs that can genuinely fund the deal bid (v19) — fee out
              // of spendable cash and the wages out of income. An offer the
              // buyer could never honour is noise on the user's screen.
              canAfford(state, t, p.value, askWage(state, p, cfg, t.leagueId), cfg) &&
              // The player has to be willing, and a lower-tier club has to wait
              // out his peer-priority window (v1.66).
              canApproach(state, t, p, cfg) &&
              t.reputation >= state.teams[state.userTeamId].reputation - 35
          )
          .map((t) => {
            const need = squadNeeds(state, t, cfg).find((n) => p.positions.includes(n.pos));
            return need ? { team: t, score: targetScore(state, t, need, p, cfg) } : null;
          })
          .filter((x): x is { team: (typeof state.teams)[string]; score: number } => !!x && x.score > 0);
        if (interested.length) {
          // Release clause (v21): if the keenest suitor can cover the clause, it
          // simply pays it — there is nothing for the user to negotiate, which is
          // the risk they accepted when they agreed the term. It lands as news and
          // an inbox note rather than an offer, because it isn't a decision.
          const front = pickWeighted(rng, interested, (x) => x.score).team;
          const clause = p.contract?.releaseClause;
          if (clause && spendableBudget(state, front, cfg) >= clause) {
            completeTransfer(state, p.id, front.id, clause, undefined, "clause");
            state.news.unshift(`${front.name} trigger ${p.name}'s ${fmtFee(clause)} release clause.`);
            state.inbox.unshift({
              id: uid("inb"),
              day: state.currentDay,
              season: state.season,
              type: "offer",
              title: `${p.name} leaves — release clause triggered`,
              body:
                `${front.name} have paid the ${fmtFee(clause)} release clause in ${p.name}'s contract. ` +
                `The clause is binding, so the transfer is already done — the fee has been credited to your budget.`,
              read: false,
            });
            interrupt = true;
            continue; // he's gone; move on to the next player
          }

          // ── Competing bidders (v1.51) ─────────────────────────────────────
          // More than one club can now bid for the SAME player in the same week.
          // Previously a single buyer was drawn and the loop broke, so a coveted
          // player never attracted a bidding war and the user never got to play
          // suitors off against each other. The keenest clubs bid, in order of how
          // badly they want him, each with its own independent negotiation state —
          // so the user picks between real, simultaneous offers.
          // Peers first, then keenness (v1.66) — a club at the player's own level
          // gets to the table before a lower-division side that wants him just as
          // badly, which is what stops the bidding on a good player being led by
          // whoever the weighted draw happened to favour.
          const suitors = byPeerPriority(state, p, interested, cfg)
            .filter((x) => !state.offers.some((o) => o.status === "pending" && o.playerId === p.id && o.fromClubId === x.team.id));
          if (!suitors.length) continue;
          // A hotly-wanted player draws more of them; how many actually move is
          // still a roll, so it varies week to week.
          const maxRivals = Math.min(suitors.length, cfg.aiMaxBiddersPerPlayer);
          let bids = 1;
          while (bids < maxRivals && rng() < cfg.aiRivalBidChance) bids++;

          for (let b = 0; b < bids && offersThisWeek < cfg.aiMaxOffersPerWeek; b++) {
            const buyer = suitors[b].team;
            const raw = p.value * (state.transferList.includes(p.id) ? 0.95 + rng() * 0.2 : 1.0 + rng() * 0.35);
            // Never open above what the club can actually fund — the roll can land
            // well over market value, and a bid it couldn't honour is a bad-faith
            // offer the negotiation would then have to walk back.
            const fee = Math.min(
              Math.round(raw / 100_000) * 100_000,
              Math.round(spendableBudget(state, buyer, cfg) / 100_000) * 100_000
            );
            if (fee <= 0) continue;
            const offer: TransferOffer = {
              id: uid("off"),
              day: state.currentDay,
              playerId: p.id,
              fromClubId: buyer.id,
              toClubId: state.userTeamId,
              fee,
              direction: "incoming",
              status: "pending",
              deadlineDay: state.currentDay + 7,
              negotiationRound: 0,
            };
            ensureNegotiationState(state, offer, p, cfg);
            state.offers.push(offer);
            const rivals = bids > 1 ? ` ${bids} clubs are chasing him.` : "";
            state.inbox.unshift({
              id: uid("inb"),
              day: state.currentDay,
              season: state.season,
              type: "offer",
              title: `${buyer.name} bid ${fmtFee(fee)} for ${p.name}`,
              body:
                `${buyer.name} have made a formal offer of ${fmtFee(fee)} for ${p.name} (valued at ${fmtFee(p.value)}).` +
                `${rivals} The offer expires in a week. Respond from the Transfers screen.`,
              read: false,
              offerId: offer.id,
            });
            offersThisWeek++;
            interrupt = true;
          }
        }
      }
    }
  }

  aiSquadBuilding(state, rng, cfg);
  state.news = state.news.slice(0, 24);

  // expire stale offers
  for (const o of state.offers) {
    if (o.status === "pending" && state.currentDay > o.deadlineDay) o.status = "withdrawn";
  }
  return interrupt;
}

/**
 * Which hole the club goes shopping for (v1.89).
 *
 * A position it cannot field a natural body in is addressed FIRST and without a
 * roll — a club with no centre-back should buy a centre-back, not whichever of
 * its two most urgent needs the dice picked. `squadNeeds` already sorts these to
 * the front via `aiMissingCoverUrgency`, so this only has to notice they exist.
 * Absent a genuine gap the old behaviour stands: one of the two most pressing
 * needs, chosen at random so clubs don't all converge on the same position.
 */
function pickNeed(needs: PositionNeed[], rng: RNG): PositionNeed {
  const gaps = needs.filter(isUncovered);
  if (gaps.length) return gaps[0];
  return needs[Math.min(needs.length - 1, Math.floor(rng() * 2))];
}

/**
 * AI ↔ AI squad building (§10). Each week a window is open, a few clubs act on
 * their stance: they work out their weakest position, look for a player who
 * actually improves it, and pay what their stance says that's worth. Clubs that
 * are short of money sell before they buy.
 *
 * Deliberately moderate in volume — the world should visibly evolve without the
 * user's league reshaping itself underneath them.
 */
function aiSquadBuilding(state: GameState, rng: RNG, cfg: TuningConfig) {
  const clubs = Object.values(state.teams).filter(
    (t) => t.id !== state.userTeamId && state.leagues[t.leagueId]?.playable
  );
  if (clubs.length < 2) return;

  // Pick the acting clubs by stance appetite — a rebuilding or title-chasing
  // side is likelier to do business than one just balancing the books.
  const attempts = Math.max(1, Math.round(cfg.aiDealsPerWeek * (0.5 + rng())));
  for (let i = 0; i < attempts; i++) {
    const buyer = pickWeighted(rng, clubs, (t) => STANCE_PROFILE[stanceOf(state, t, cfg)].activity);
    if (buyer.playerIds.length >= cfg.squadCap) continue;
    // A club that can't cover its own wages doesn't go shopping (v19). It will
    // still appear below as a willing seller — that's how it digs itself out.
    if (isDistressed(state, buyer, cfg)) continue;
    if (spendableBudget(state, buyer, cfg) <= 0) continue;

    const needs = squadNeeds(state, buyer, cfg);
    if (!needs.length) continue;
    const need = pickNeed(needs, rng);

    // Shop the rest of the world (never the user's squad — those go through the
    // formal offer path so the user always gets to decide).
    let best: { player: PlayerBio; score: number; price: number } | null = null;
    for (const seller of clubs) {
      if (seller.id === buyer.id) continue;
      const sellerProfile = STANCE_PROFILE[stanceOf(state, seller, cfg)];
      // A club that can't pay its wages sells at a discount to raise cash fast.
      const distressDiscount = isDistressed(state, seller, cfg) ? cfg.aiDistressSellDiscount : 1;
      for (const p of saleCandidates(state, seller, cfg)) {
        if (p.loan) continue;
        const score = targetScore(state, buyer, need, p, cfg);
        if (score <= 0) continue;
        // Would he even go there (v1.66)? Cheapest way to keep a top-flight name
        // out of a third-division squad is to never consider the move at all.
        if (!canApproach(state, buyer, p, cfg)) continue;
        // Can the buyer actually afford the seller's price — fee AND wages (v19)?
        const price =
          Math.round((p.value * cfg.aiAcceptThreshold * sellerProfile.sellAsk * distressDiscount) / 100_000) * 100_000;
        if (price > buyBudgetFor(state, buyer, p, cfg)) continue;
        if (!canAfford(state, buyer, price, askWage(state, p, cfg, buyer.leagueId), cfg)) continue;
        if (!best || score > best.score) best = { player: p, score, price };
      }
    }
    if (!best) {
      // No club-to-club deal to be had — try the free-agent market instead. A
      // free signing costs only wages, so a club that can't (or won't) pay a fee
      // can still address a hole here, which keeps the window from going quiet.
      //
      // A club that cannot field the position AT ALL always looks (v1.89) rather
      // than rolling for it: the roll is there to keep ordinary window business
      // at a sane volume, and a missing centre-back is not ordinary business.
      // This is the safety net behind every other rule here — whatever the state
      // of a club's books, there is always a path to a body in an empty slot.
      if (isUncovered(need) || rng() < cfg.aiFreeAgentSignChance) {
        aiSignFreeAgent(state, buyer, need, cfg);
      }
      continue;
    }

    const target = best.player;
    const seller = state.teams[target.clubId!];
    if (!seller) continue;
    // A club won't strip itself below a workable squad.
    if (seller.playerIds.length <= cfg.matchdaySquad) continue;

    // The price the affordability check was made against — recomputing it here
    // could drift from what was validated and let a club overspend.
    const fee = best.price;
    completeTransfer(state, target.id, buyer.id, fee);
    const why = STANCE_PROFILE[stanceOf(state, buyer, cfg)].label;
    state.news.unshift(
      `${target.name} joins ${buyer.name} from ${seller.name} for ${fmtFee(fee)} — ${why.toLowerCase()}.`
    );
  }

  aiRenewContracts(state, rng, cfg);
}

/**
 * Playable-league AI window burst (v1.51). The weekly `aiSquadBuilding` tick is
 * the only thing that ever moved players between the user's own division rivals,
 * and it only fires on Mondays a window happens to be open — so across a whole
 * summer the clubs the user actually competes with did a handful of deals while
 * every foreign league visibly turned its squads over.
 *
 * This runs ONCE when a window opens, alongside `simLeagueTransferWindow`, and
 * gives the playable divisions the same three kinds of business the sim world
 * gets: club-to-club deals, free-agent signings, and contract renewals. The
 * user's own club is never party to any of it — buying from the user still goes
 * through the formal offer path, which is the only way the user gets to decide.
 */
export function playableLeagueTransferWindow(state: GameState, cfg: TuningConfig) {
  const clubs = Object.values(state.teams).filter(
    (t) => t.id !== state.userTeamId && state.leagues[t.leagueId]?.playable
  );
  if (clubs.length < 2) return;
  const rng = mulberry32(deriveSeed(state.seed, `aixfer:window:${state.season}:${state.currentDay}`));

  for (let i = 0; i < cfg.aiWindowDealsPerLeague * Math.max(1, state.divisionIds.length); i++) {
    // Same helper the sim world uses — one market model, not two. Buyers and
    // sellers are both drawn from the playable pool, so players move up and down
    // the user's own pyramid rather than only sideways within one division.
    if (!trySimDeal(state, clubs, clubs, rng, cfg)) {
      // Nothing to buy — a club with a hole still has the free-agent market, and
      // this is what gives released players somewhere to land.
      const buyer = pickWeighted(rng, clubs, (t) => STANCE_PROFILE[stanceOf(state, t, cfg)].activity);
      if (isDistressed(state, buyer, cfg)) continue;
      const needs = squadNeeds(state, buyer, cfg);
      if (needs.length && rng() < cfg.aiFreeAgentSignChance) {
        aiSignFreeAgent(state, buyer, needs[0], cfg);
      }
    }
  }

  // Clubs tie down their own out-of-contract first-teamers as the window opens,
  // rather than only on the Monday ticks.
  aiRenewContracts(state, rng, cfg);
  state.news = state.news.slice(0, 24);
}

/**
 * Sim-league transfer window (v1.44). The weekly `aiSquadBuilding` pass only
 * ever touched playable-league clubs, so every non-playable league in the world
 * — often a dozen of them — had a permanently frozen transfer market: a player
 * browsing a foreign division saw the exact same squads season after season.
 *
 * This runs ONCE per window (called when the summer/winter window opens) in two
 * passes:
 *   1. Intra-league — for each sim league, a bounded number of deals where a
 *      buyer signs the best improver another club in the SAME league will sell.
 *   2. Cross-league (v1.44) — a bounded number of deals across the whole sim
 *      world, where a sim buyer signs an improver from ANY other sim league, so
 *      players move between divisions and the market isn't sealed per league.
 *
 * Both passes never touch the player's own playable division (neither as buyer
 * nor seller), so a sim club can never raid the user's world — the user's market
 * stays the formal-offer path. Everything reuses the exact same stance, needs,
 * valuation and affordability model as the playable market — no separate rules —
 * so the markets stay coherent.
 */
export function simLeagueTransferWindow(state: GameState, cfg: TuningConfig) {
  const simLeagues = Object.values(state.leagues).filter((l) => !l.playable);

  // ── Pass 1: intra-league business ──────────────────────────────────────────
  for (const league of simLeagues) {
    const clubs = league.teamIds.map((id) => state.teams[id]).filter(Boolean);
    if (clubs.length < 2) continue;
    const rng = mulberry32(deriveSeed(state.seed, `simxfer:${league.id}:${state.season}:${state.currentDay}`));

    const attempts = cfg.aiSimDealsPerLeaguePerWindow;
    for (let i = 0; i < attempts; i++) {
      // Shop only the other clubs in this same sim league.
      trySimDeal(state, clubs, clubs, rng, cfg);
    }
  }

  // ── Pass 2: cross-league business (v1.44) ───────────────────────────────────
  // A pool of every sim club in the world. A buyer drawn from it can sign from
  // any other sim league, so players move between divisions rather than being
  // sealed inside one. The playable division is excluded from the pool entirely,
  // so the user's clubs are never party to a sim-world deal.
  const allSimClubs = simLeagues.flatMap((l) => l.teamIds.map((id) => state.teams[id]).filter(Boolean));
  if (allSimClubs.length >= 2) {
    const rng = mulberry32(deriveSeed(state.seed, `simxfer:cross:${state.season}:${state.currentDay}`));
    for (let i = 0; i < cfg.aiSimCrossLeagueDealsPerWindow; i++) {
      trySimDeal(state, allSimClubs, allSimClubs, rng, cfg);
    }
  }

  state.news = state.news.slice(0, 24);
}

/**
 * One AI↔AI market deal attempt (v1.44). A buyer is drawn from `buyerPool` by
 * stance appetite; it acts on one of its most pressing holes and signs the best
 * improver any club in `sellerPool` is willing to sell. Shared by the sim
 * intra-league and cross-league passes and, since v1.51, by the playable-league
 * window burst — the only difference between them is the pool of clubs in scope,
 * which is what keeps every market running on one model. Callers must pass pools
 * that exclude the user's club. Returns true if a deal completed.
 */
function trySimDeal(
  state: GameState,
  buyerPool: Team[],
  sellerPool: Team[],
  rng: RNG,
  cfg: TuningConfig
): boolean {
  const buyer = pickWeighted(rng, buyerPool, (t) => STANCE_PROFILE[stanceOf(state, t, cfg)].activity);
  if (buyer.playerIds.length >= cfg.squadCap) return false;
  if (isDistressed(state, buyer, cfg)) return false;
  if (spendableBudget(state, buyer, cfg) <= 0) return false;

  const needs = squadNeeds(state, buyer, cfg);
  if (!needs.length) return false;
  const need = pickNeed(needs, rng);

  let best: { player: PlayerBio; score: number; price: number } | null = null;
  for (const seller of sellerPool) {
    if (seller.id === buyer.id) continue;
    if (seller.playerIds.length <= cfg.matchdaySquad) continue;
    const sellerProfile = STANCE_PROFILE[stanceOf(state, seller, cfg)];
    const distressDiscount = isDistressed(state, seller, cfg) ? cfg.aiDistressSellDiscount : 1;
    for (const p of saleCandidates(state, seller, cfg)) {
      if (p.loan) continue;
      const score = targetScore(state, buyer, need, p, cfg);
      if (score <= 0) continue;
      if (!canApproach(state, buyer, p, cfg)) continue;
      const price =
        Math.round((p.value * cfg.aiAcceptThreshold * sellerProfile.sellAsk * distressDiscount) / 100_000) * 100_000;
      if (price > buyBudgetFor(state, buyer, p, cfg)) continue;
      if (!canAfford(state, buyer, price, askWage(state, p, cfg, buyer.leagueId), cfg)) continue;
      if (!best || score > best.score) best = { player: p, score, price };
    }
  }
  if (!best) return false;

  const target = best.player;
  const seller = state.teams[target.clubId!];
  if (!seller || seller.playerIds.length <= cfg.matchdaySquad) return false;
  completeTransfer(state, target.id, buyer.id, best.price);
  const why = STANCE_PROFILE[stanceOf(state, buyer, cfg)].label;
  state.news.unshift(
    `${target.name} joins ${buyer.name} from ${seller.name} for ${fmtFee(best.price)} — ${why.toLowerCase()}.`
  );
  return true;
}

/**
 * An AI club signs the best free agent for a needy position (v1.43+). Free
 * agents cost no fee, only wages, so the only test is whether the club can
 * service the wage — which keeps even cash-poor clubs active in the window and
 * gives released players somewhere to land. The player must actually improve the
 * position (targetScore > 0), same bar as any other signing.
 *
 * v1.51: a floor is left on the pool. With the AI now shopping the free-agent
 * market at every window open as well as weekly, it could clear the pool
 * entirely — which would leave the user's Free Agents tab permanently empty and
 * remove the market's one source of players that costs no fee. The AI stops
 * signing once the pool is down to `freeAgentPoolFloor`, so there is always
 * something on that screen. The user's own emergency backfill
 * (`ensureFieldableSquad`) deliberately ignores this floor — it only runs when
 * the club genuinely cannot field a side.
 */
function aiSignFreeAgent(state: GameState, buyer: Team, need: PositionNeed, cfg: TuningConfig) {
  if (buyer.playerIds.length >= cfg.squadCap) return;
  // `isFreeAgent`, not `!clubId` (v1.95): a prospect on an International
  // Scouting Hub's books has no club either, and he is not for sale.
  const pool = activePlayers(state).filter((p) => isFreeAgent(p) && !p.loan);
  // A club that cannot field this position naturally is filling a hole, not
  // shopping (v1.89), and the two rules below are both about keeping ordinary
  // business tidy rather than about squad legality — so neither applies to it.
  // The pool floor exists to keep the user's Free Agents tab from being emptied
  // by routine AI signings; one club taking one body out of it to be able to
  // field a back four is not what it guards against.
  const fillingAGap = isUncovered(need);
  if (!fillingAGap && pool.length <= cfg.freeAgentPoolFloor) return;
  let best: { player: PlayerBio; score: number } | null = null;
  // The best natural body for the position, kept as a last resort for a club
  // with a genuine gap: nobody may "improve" an empty slot by the stance's
  // shopping criteria (an old free agent scores poorly for a rebuilding club),
  // and a side with no centre-back still has to sign one.
  let fallback: PlayerBio | null = null;
  for (const p of pool) {
    if (!p.positions.includes(need.pos) && !p.positions.some((pos) => positionAdjacent(pos, need.pos))) continue;
    // A free agent still has to want the move (v1.66) — being unattached widens
    // what he'll accept through the desperation curve, but on day one a released
    // star is not yet ready to drop three divisions.
    if (!canApproach(state, buyer, p, cfg)) continue;
    // The gap-filling fallback is chosen BEFORE the affordability test on
    // purpose (v1.89). A club with no centre-back must end up with one whatever
    // state its books are in — it is obliged to field eleven players, and a
    // wage it can't service is a problem the economy settles afterwards, not a
    // reason to play with three defenders. Every discretionary signing below
    // still clears `canAfford`; only this last resort doesn't.
    if (fillingAGap && p.positions.includes(need.pos) && (!fallback || p.overall > fallback.overall)) {
      fallback = p;
    }
    // Free transfer: no fee, so the wage is the whole affordability question —
    // and his personal floor, not the buyer's league rate, is what must clear.
    if (!canAfford(state, buyer, 0, askWage(state, p, cfg, buyer.leagueId), cfg)) continue;
    const score = targetScore(state, buyer, need, p, cfg);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { player: p, score };
  }
  const target = best?.player ?? fallback;
  if (!target) return;
  completeTransfer(state, target.id, buyer.id, 0);
  state.news.unshift(`${buyer.name} sign free agent ${target.name} to bolster their ${need.pos}.`);
}

/**
 * Keep a club able to fulfil its fixtures (v1.51; any club since v1.89).
 *
 * Squad size is the manager's business — except at the point the club can no
 * longer field a legal side. Contract expiries and retirements both bite at the
 * rollover, so a manager who stops managing (or an automated run that never
 * answers a prompt) would otherwise ratchet the squad down to nothing over a
 * long save. This tops the senior squad back up to `floor` from the free agent
 * pool, cheapest useful body first, and reports what it did.
 *
 * Deliberately NOT a quality pass: it signs the best free agent available for
 * the thinnest position, which is what a real club does in an emergency, and it
 * only ever runs when the squad is genuinely short. A manager who keeps a full
 * squad never sees it. Returns the names signed.
 *
 * Note it ignores `canAfford` on purpose. This is the path of last resort — a
 * club that cannot pay is still obliged to put eleven players on the pitch, and
 * the money is settled by the wage bill afterwards. Every discretionary signing
 * path still respects affordability; this one is not discretionary.
 */
export function ensureFieldableSquad(
  state: GameState,
  cfg: TuningConfig,
  teamId: string = state.userTeamId,
  floor: number = cfg.matchdaySquad
): string[] {
  const team = state.teams[teamId];
  if (!team) return [];
  const signed: string[] = [];
  let guard = 0;
  while (team.playerIds.filter((id) => !state.players[id]?.retired).length < floor && guard++ < 40) {
    const needs = squadNeeds(state, team, cfg);
    const need = needs[0];
    // A squad this thin always has needs; if it somehow doesn't, stop rather
    // than loop.
    if (!need) break;

    let best: { player: PlayerBio; score: number } | null = null;
    let fallback: PlayerBio | null = null;
    for (const p of activePlayers(state)) {
      if (p.clubId || p.loan) continue; // free agents only
      const covers = p.positions.includes(need.pos) || p.positions.some((pos) => positionAdjacent(pos, need.pos));
      // The cheapest body who can stand in the position, kept as a last resort
      // for the case where nobody genuinely improves the side.
      if (covers && (!fallback || p.overall > fallback.overall)) fallback = p;
      if (!covers) continue;
      const score = targetScore(state, team, need, p, cfg);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { player: p, score };
    }
    const target = best?.player ?? fallback;
    if (!target) break; // the free-agent pool has nobody for this position

    completeTransfer(state, target.id, team.id, 0);
    signed.push(target.name);
  }
  return signed;
}

/**
 * Hold every AI club to a workable squad at the rollover (v1.89).
 *
 * `ensureFieldableSquad` has kept the USER's club fieldable since v1.51; AI
 * clubs had no equivalent, and it turns out they needed one badly. Retirement
 * and contract expiry take players out every season while the buy paths are all
 * discretionary — each gated on stance, affordability and a genuine upgrade — so
 * an AI squad only ever ratcheted down. Measured over 20 seasons the median
 * playable squad fell from 28 to 19, effectively the matchday minimum, and
 * clubs were fielding a single centre-back while 220 free-agent centre-backs sat
 * unsigned: the bodies existed, but no discretionary rule would sign one.
 *
 * Two floors, both necessary and doing different jobs:
 *  - `aiSquadFloor` is the squad-SIZE floor — enough bodies to be a football
 *    club rather than a legal minimum, so ordinary attrition has slack to eat
 *    into before the next rollover.
 *  - the positional pass below is about SHAPE: a squad can hit its size floor
 *    and still have no centre-back, which is the bug this whole change is
 *    about. It signs into the uncovered positions specifically.
 *
 * The user's club is excluded — squad size is the manager's business, and their
 * own (stricter, emergency-only) backfill runs separately.
 */
export function ensureAiSquads(state: GameState, cfg: TuningConfig) {
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    // Shape first: a position nobody can play is worse than a thin bench, and
    // filling it may also take the squad toward its size floor.
    let guard = 0;
    while (guard++ < 8) {
      const gap = squadNeeds(state, team, cfg).find(isUncovered);
      if (!gap) break;
      const before = team.playerIds.length;
      aiSignFreeAgent(state, team, gap, cfg);
      // Nothing in the pool plays there — stop rather than spin on the same gap.
      if (team.playerIds.length === before) break;
    }
    // Then size.
    ensureFieldableSquad(state, cfg, team.id, cfg.aiSquadFloor);
  }
}

/**
 * Every AI club recruits young players on POTENTIAL (v1.92).
 *
 * This is the second half of the long-save decay fix, and without it the first
 * half makes things worse rather than better. `replenishYouth` puts a generation
 * of teenagers into the world each season; measured, not one of them got signed.
 * The free-agent pool grew to 2,400 unattached players — 970 of them under 22 —
 * while squads stayed full at ~27 and the world's supply of high-potential YOUNG
 * players collapsed anyway (416 → 56 over twelve seasons).
 *
 * The cause is that a prospect is invisible to every existing buying path:
 *
 *  - `targetScore` scores a signing as an UPGRADE, and must — a 16-year-old
 *    rated 48 is not an upgrade on anybody, so he fails `aiMinUpgradeGain`
 *    however high his ceiling. Loosening that bar is not the answer; it would
 *    make clubs sign bad players for their own first teams.
 *  - Every stance's `targetAge` band starts at 17 or above, so the intake sits
 *    below the youngest age any club shops in.
 *  - And development is driven by MINUTES, so an unsigned prospect never
 *    develops. He ages out of the young cohort without ever becoming anything,
 *    which is precisely "the new players are youth players that never replace
 *    the world-class ones".
 *
 * So this is deliberately NOT scored through `targetScore`. Recruiting a
 * prospect is a different act from strengthening the XI: the club is buying a
 * ceiling, not a starter, and the only questions are whether he has a genuinely
 * high one and whether the club has room. Clubs with more room and more ambition
 * take more of them, but every club takes some — a world where only rebuilding
 * sides develop players has the same shortage a few seasons later.
 *
 * Free transfers only: intake players arrive unattached, and a prospect's fee is
 * the academy's business (`prospectSignFeeByTier`), not the market's. The squad
 * cap and `canApproach` still bind, so this can neither overfill a squad nor put
 * a player somewhere he wouldn't go.
 */
export function aiRecruitYouth(state: GameState, cfg: TuningConfig) {
  const rng = mulberry32(deriveSeed(state.seed, `youthrecruit:${state.season}`));
  // One shared pool, drawn down as clubs sign from it — so two clubs can't both
  // sign the same prospect, and the strongest recruiters get first pick.
  const pool = activePlayers(state).filter(
    (p) =>
      isFreeAgent(p) &&
      !p.loan &&
      p.age <= cfg.aiYouthRecruitMaxAge &&
      p.potential - p.overall >= cfg.aiYouthRecruitMinHeadroom
  );
  if (!pool.length) return;
  // Ranked once, best prospect first, rather than re-scanned per slot: the score
  // depends only on the player, so re-deriving it for every club × slot is the
  // same answer computed thousands of times over. A prospect is worth what he
  // might BECOME, discounted by how far off it is — a 16-year-old who might
  // reach 88 beats a 21-year-old who might reach 84, but not infinitely.
  pool.sort(
    (a, b) =>
      b.potential -
      (b.age - cfg.youthIntakeAge[0]) * cfg.aiYouthRecruitAgeDiscount -
      (a.potential - (a.age - cfg.youthIntakeAge[0]) * cfg.aiYouthRecruitAgeDiscount)
  );
  const available = new Set(pool.map((p) => p.id));

  // Better clubs recruit first: a high-reputation side gets the pick of a
  // generation, which is both realistic and what keeps the top of the game
  // stocked. Sorting by reputation rather than by squad quality means the
  // ordering is stable across a window rather than shifting as squads change.
  const clubs = Object.values(state.teams)
    .filter((t) => t.id !== state.userTeamId)
    .sort((a, b) => b.reputation - a.reputation);

  for (const club of clubs) {
    // Room to develop somebody is the hard limit — and the limit is a WORKING
    // squad size, not `squadCap`. The cap is 50, which almost never binds, so
    // gating on it let clubs hoard prospects until the median squad hit 44
    // players. `aiYouthSquadCeiling` is the size beyond which a club stops
    // taking on more youth however promising: a club that already has 34 players
    // on its books does not need another sixteen-year-old, it needs to give the
    // ones it has a game.
    const room = Math.min(cfg.squadCap, cfg.aiYouthSquadCeiling) - club.playerIds.length;
    if (room <= 0) continue;
    // How many prospects this club is prepared to carry. Reputation buys the
    // pick of the crop above; this is about capacity, so it is keyed on how many
    // the club is already developing — a club whose books are full of teenagers
    // stops, whatever its standing.
    //
    // The count MUST use the same test as the pool (young AND with real
    // headroom), not simply "young". Counting every under-23 looks equivalent
    // and is not: a healthy squad already carries a dozen young players who are
    // finished articles or ordinary squad men, so the cap was met before a
    // single prospect had been signed and this pass never ran at all. Measured,
    // that left 744 prospects unsigned with no club anywhere near its squad cap
    // — the symptom looked identical to having no recruitment pass.
    const prospectsOnBooks = club.playerIds.filter((id) => {
      const p = state.players[id];
      return (
        p &&
        !p.retired &&
        p.age <= cfg.aiYouthRecruitMaxAge &&
        p.potential - p.overall >= cfg.aiYouthRecruitMinHeadroom
      );
    }).length;
    let slots = Math.min(room, cfg.aiYouthProspectsHeld - prospectsOnBooks);
    if (slots <= 0) continue;

    while (slots-- > 0) {
      // The pool is already ranked, so the first still-available prospect this
      // club may approach IS its best one.
      let best: PlayerBio | null = null;
      for (const p of pool) {
        if (!available.has(p.id)) continue;
        if (!canApproach(state, club, p, cfg)) continue;
        best = p;
        break;
      }
      if (!best) break;
      // Wages still have to clear — a prospect is cheap, but a club in genuine
      // financial trouble is not obliged to take on more of them.
      if (!canAfford(state, club, 0, askWage(state, best, cfg, club.leagueId), cfg)) break;
      available.delete(best.id);
      completeTransfer(state, best.id, club.id, 0);
      // Deliberately silent: forty clubs signing prospects every summer would
      // bury every transfer the manager actually cares about in the news ticker.
      if (rng() < cfg.aiYouthRecruitNewsChance) {
        state.news.unshift(`${club.name} sign ${best.age}-year-old ${best.name} for the future.`);
      }
    }
  }
}

/** A player covers a slot if it's a listed position or a direct adjacent one —
 * a cheap check reusing the same adjacency the fit model uses, without importing
 * the full positionFit machinery here. */
function positionAdjacent(from: Pos, to: Pos): boolean {
  return positionFit([from], to, 1, 0) >= 0.5;
}

/**
 * AI contract renewals (v1.43+). Each window a share of clubs proactively tie
 * down a first-team player whose deal is running out, rather than letting the
 * rollover's auto-renew be the only thing keeping squads together — this makes
 * the AI world visibly manage its contracts the way the user must, and stops a
 * key player drifting toward a free exit. Purely a bookkeeping renewal (no fee,
 * wage at demand); it just resets the expiry so the player stays put.
 */
/**
 * Let the players who have aged out of an AI club's plans go (v1.92).
 *
 * The last cause of long-save squad decay. Nothing in the world ever declined to
 * re-sign an ageing player: `rolloverContracts` renewed every expiring AI deal
 * unconditionally, and `ensureContracts` backfilled anyone still missing one, so
 * a 37-year-old squad filler was under contract every summer until the day he
 * retired at 39. Measured with the youth pyramid otherwise fixed, the 34+
 * population grew 23 → 594 over nine seasons with **561 of them on club books**
 * — those are the squad places a new generation needs, and the wage bill that
 * stops a club buying anyone better.
 *
 * `aiLetsExpire` holds the conditions (past `aiExpireAge`, not among the club's
 * best `aiExpireProtectBest`, squad stays at or above `aiSquadFloor`, and a
 * roll). Every one of them is about being SURPLUS rather than about being old,
 * so a veteran who is still one of his club's better players is never touched.
 *
 * A released veteran becomes a free agent rather than vanishing: he is then
 * usually passed over, accrues inactivity, and retires the following summer via
 * `retireUnattachedDays` — a realistic wind-down, and one that gives a club
 * short of bodies a last chance to sign him.
 */
export function releaseAgedOut(state: GameState, club: Team, cfg: TuningConfig) {
  // Snapshot: `completeTransfer` mutates `playerIds` as it goes.
  for (const id of [...club.playerIds]) {
    const p = state.players[id];
    if (!p || p.retired || p.loan) continue;
    if (!aiLetsExpire(state, p, cfg)) continue;
    completeTransfer(state, p.id, null, 0);
  }
}

/**
 * Run the ageing-out pass over EVERY AI club in the world (v1.92), sim leagues
 * included. Called once at the rollover.
 *
 * The sim world is where most of the world's clubs live — a dozen foreign
 * leagues against one playable pyramid — so a rule applied only to the playable
 * divisions leaves the great majority of the accumulation untouched. Squad
 * quality is a property of the whole world: the user shops in it, and every
 * league feeds the same player population.
 */
export function releaseAgedOutWorldwide(state: GameState, cfg: TuningConfig) {
  for (const club of Object.values(state.teams)) {
    if (!club || club.id === state.userTeamId) continue;
    releaseAgedOut(state, club, cfg);
  }
}

function aiRenewContracts(state: GameState, rng: RNG, cfg: TuningConfig) {
  const clubs = Object.values(state.teams).filter(
    (t) => t.id !== state.userTeamId && state.leagues[t.leagueId]?.playable
  );
  for (const club of clubs) {
    // Before renewing anybody, let the players who have aged out of the club's
    // plans go (v1.92). This has to happen HERE rather than only at the
    // rollover's expiry sweep: measured, no AI contract ever reached that sweep
    // in an expired state — every one had already been renewed upstream — so a
    // rule that only ran there fired zero times and the 33+ population went on
    // growing. See `aiLetsExpire` for the conditions, all of which are about
    // being surplus rather than being old.
    releaseAgedOut(state, club, cfg);
    if (rng() >= cfg.aiRenewChance) continue;
    // The most valuable player entering the final year of his deal is the one
    // worth locking down first.
    const finalYear = club.playerIds
      .map((id) => state.players[id])
      .filter(
        (p) => p && !p.retired && !p.loan && p.contract && p.contract.expirySeason <= state.season
      )
      .sort((a, b) => b.overall - a.overall);
    if (!finalYear.length) continue;
    const p = finalYear[0];
    // Only renew if the club can carry the wage — a club that can't afford to
    // keep him lets him run down instead, and he may leave on a free.
    const wage = wageDemand(state, p, cfg);
    if (!canAfford(state, club, 0, wage, cfg)) continue;
    grantDefaultContract(state, p, cfg);
    state.news.unshift(`${club.name} hand ${p.name} a new contract.`);
  }
}

// ── Direct sales (v1.52) ──────────────────────────────────────────────────
// Transfer-listing used to be a visibility flag: the user ticked a box and waited
// for the weekly AI tick to maybe produce an offer. That reads as nothing
// happening. Selling now resolves on the spot, exactly the way the academy loan
// chooser does (§18 v1.44): the game works out which clubs would actually buy
// this player, what each of them would pay, and the user picks one.
//
// The interest model is the same one every other market path uses — squadNeeds
// for the hole, targetScore for whether he improves it, canAfford/buyBudgetFor
// for the money — so a suitor here is a club that would genuinely have bid.

export interface SaleSuitor {
  clubId: string;
  name: string;
  short: string;
  colors: [string, string];
  reputation: number;
  leagueName: string;
  country: string;
  /** What this club will actually pay — its own valuation, already affordable. */
  fee: number;
  /** The hole he'd fill there, for the pitch to the user. */
  needPos: Pos;
  /** Projected standing at the new club, from his level against their side. */
  role: "Key signing" | "Starter" | "Squad player";
}

/**
 * How much this buyer offers for him.
 *
 * The whole point of the chooser is that the clubs differ, so the fee has to
 * carry real spread — a club desperate for this exact player pays over the odds,
 * a lukewarm one lowballs. Three signals move it off market value:
 *  - the club's stance premium (a title chaser pays more than a club trimming),
 *  - how badly it wants him (`want`, the normalised targetScore), and
 *  - a per-club appetite roll, seeded so the number is stable while the chooser
 *    is open and can't be re-rolled by closing and reopening it.
 *
 * A release clause overrides all of it — that is the number, if they can find it.
 */
function offerFeeFrom(
  state: GameState,
  buyer: Team,
  p: PlayerBio,
  want: number,
  cfg: TuningConfig
): number {
  // The CASH ceiling — what the club could actually hand over for one player.
  // Deliberately not `buyBudgetFor`, which already folds the stance premium in:
  // capping a premium-priced offer with a premium-priced budget pins every club
  // to the identical number and flattens the whole chooser to one price.
  const ceiling = spendableBudget(state, buyer, cfg) * cfg.aiMaxBudgetSharePerDeal;

  const clause = p.contract?.releaseClause;
  if (clause) {
    if (clause > ceiling) return 0;
    return Math.max(100_000, Math.round(clause / 100_000) * 100_000);
  }
  const profile = STANCE_PROFILE[stanceOf(state, buyer, cfg)];
  const rng = mulberry32(deriveSeed(state.seed, `saleoffer:${p.id}:${buyer.id}:${state.currentDay}`));
  const keenness = 1 + Math.max(0, Math.min(1, want)) * cfg.saleKeennessPremium;
  const appetite = cfg.saleAppetiteMin + rng() * (cfg.saleAppetiteMax - cfg.saleAppetiteMin);
  const willing = p.value * profile.buyPremium * keenness * appetite;
  // A club stretched by the price bids what it can actually raise rather than
  // dropping out — that's what makes a big sale a choice between one club's
  // top dollar and another's better football. It only walks away when even a
  // full stretch would land embarrassingly short of the player's worth.
  const offer = Math.min(willing, ceiling);
  if (offer < p.value * cfg.saleMinOfferShare) return 0;
  return Math.max(100_000, Math.round(offer / 100_000) * 100_000);
}

/**
 * Up to five clubs that would buy this player right now, best offer first.
 *
 * Only clubs with a genuine hole he improves come calling (targetScore > 0) and
 * only those who can fund the fee AND the wage — the same bar the AI applies to
 * itself, so nothing on this list is an offer the buyer couldn't honour.
 * Deterministic per player/day, so reopening the chooser shows the same clubs.
 */
export function saleSuitors(state: GameState, playerId: string, cfg: TuningConfig): SaleSuitor[] {
  const p = state.players[playerId];
  if (!p || p.clubId !== state.userTeamId) return [];
  const rng = mulberry32(deriveSeed(state.seed, `salepick:${playerId}:${state.currentDay}`));

  // Pass 1: who is interested at all, and how badly. `targetScore` is unbounded,
  // so the keenness that prices the offer is this player's score normalised
  // across the interested clubs — "keenest of the suitors", not an absolute.
  const interested: { team: Team; need: PositionNeed; score: number }[] = [];
  for (const t of Object.values(state.teams)) {
    if (t.id === state.userTeamId) continue;
    if (t.playerIds.length >= cfg.squadCap) continue;
    if (isDistressed(state, t, cfg)) continue;
    // He has to be willing to go there, and a lower-tier club has to have waited
    // out his peer window (v1.66) — the chooser must never show the user a suitor
    // the player would refuse, because the sale completes the moment it's picked.
    if (!canApproach(state, t, p, cfg)) continue;
    // The hole he'd fill. No need for his position → no interest, same as the AI.
    const need = squadNeeds(state, t, cfg).find((n) => p.positions.includes(n.pos));
    if (!need) continue;
    const score = targetScore(state, t, need, p, cfg);
    if (score <= 0) continue;
    interested.push({ team: t, need, score });
  }
  const topScore = interested.reduce((n, x) => Math.max(n, x.score), 0);

  // Pass 2: price it, and drop anyone who can't actually fund their own offer.
  const rows: { team: Team; fee: number; need: PositionNeed; score: number }[] = [];
  for (const { team: t, need, score } of interested) {
    const fee = offerFeeFrom(state, t, p, topScore > 0 ? score / topScore : 0, cfg);
    if (fee <= 0) continue;
    // Priced in the buyer's own market (v1.65) — a lower-division suitor is
    // quoted a lower-division wage, which is what makes it a plausible suitor
    // at all rather than one filtered out by a top-flight wage it never pays —
    // but floored by what the player will personally accept (v1.66), so the
    // discount can't reach the point where a small club can afford a star.
    if (!canAfford(state, t, fee, askWage(state, p, cfg, t.leagueId), cfg)) continue;
    rows.push({ team: t, fee, need, score });
  }

  // Best money first; the deterministic jitter only breaks ties between clubs
  // offering the same figure, so the order still reads as "who pays most".
  return rows
    .sort((a, b) => b.fee - a.fee || b.score - a.score || rng() - 0.5)
    .slice(0, 5)
    .map(({ team, fee, need }): SaleSuitor => {
      const league = state.leagues[team.leagueId];
      const squad = team.playerIds.map((id) => state.players[id]).filter(Boolean);
      const best = [...squad].sort((a, b) => b.overall - a.overall);
      // Where he'd rank in their squad is the honest way to describe the move.
      const rank = best.findIndex((x) => x.overall <= p.overall);
      const role: SaleSuitor["role"] =
        rank === 0 ? "Key signing" : rank > 0 && rank < 11 ? "Starter" : "Squad player";
      return {
        clubId: team.id,
        name: team.name,
        short: team.short,
        colors: team.colors,
        reputation: team.reputation,
        leagueName: league?.name ?? "—",
        country: league?.country ?? "",
        fee,
        needPos: need.pos,
        role,
      };
    });
}

/** Sell a player to one of the clubs `saleSuitors` returned, immediately. The
 * fee is the buyer's own number — there is no haggling here, because the point
 * of this path is that the decision is "who, and for how much", made once. */
/**
 * Whether a player is locked to his club for the rest of the season because he
 * joined it this season (v1.54; every club since v1.89).
 *
 * A fresh signing can't be moved on inside the same season he was signed. This
 * gates every user sell path (direct sale, transfer-listing, accepting an
 * incoming offer) and — since v1.89 — every AI path too, through
 * `saleCandidates` in lib/ai/strategy.ts, which is the one list all of them shop
 * from. Keeping the rule at that chokepoint is what stops it being a rule some
 * market paths remembered and others didn't.
 */
export function signedThisSeason(state: GameState, p: PlayerBio): boolean {
  return p.acquiredSeason === state.season;
}

export function sellToClub(
  state: GameState,
  playerId: string,
  clubId: string,
  cfg: TuningConfig
): string | null {
  const p = state.players[playerId];
  if (!p || p.clubId !== state.userTeamId) return "Not your player.";
  if (signedThisSeason(state, p)) return "Signed this season — he can't be sold until next season.";
  if (p.loan) return "Recall him from his loan spell first.";
  // An academy prospect can be sold like anyone else (v1.71), with one exception:
  // a prospect registered for the U21 competition is locked to that squad for its
  // duration, exactly as he is for promotion and loans. Same rule, same reason —
  // he can no longer be replaced in a submitted squad.
  if ((state.academy?.u21?.registered ?? []).includes(playerId)) {
    return "Registered for the U21 competition — he can't be sold until the next registration window.";
  }
  if (!windowOpen(state)) return "The transfer window is closed.";
  const buyer = state.teams[clubId];
  if (!buyer) return "That club no longer exists.";
  // Re-resolve rather than trust the id: the world may have moved on since the
  // chooser was opened (another deal, a wage change), and a stale offer must not
  // be honourable.
  const suitor = saleSuitors(state, playerId, cfg).find((s) => s.clubId === clubId);
  if (!suitor) return `${buyer.name} are no longer interested.`;

  completeTransfer(state, playerId, clubId, suitor.fee);
  state.news.unshift(`${p.name} joins ${buyer.name} — ${fmtFee(suitor.fee)}.`);
  state.inbox.unshift({
    id: uid("inb"),
    day: state.currentDay,
    season: state.season,
    type: "offer",
    title: `${p.name} sold to ${buyer.name}`,
    body: `${p.name} completes his move to ${buyer.name} for ${fmtFee(suitor.fee)}. The fee has been credited to your budget.`,
    read: false,
  });
  return null;
}

/** Refresh values after aging or window openings. Academy prospects carry the
 * club's Youth PR premium (v1.65), so this pass must not flatten it back out. */
export function refreshValues(state: GameState, cfg: TuningConfig) {
  for (const p of activePlayers(state)) {
    p.value = valueWithYouthPr(state, p, cfg);
  }
}

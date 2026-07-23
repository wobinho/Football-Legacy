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
import { playerValue } from "./value";
import { grantDefaultContract, makeContract } from "./contracts";
import { assignKitNumber, clearKitNumber } from "./kitnumbers";
import { activePlayers } from "./archive";
import { trackUserTransfer, syncProgress } from "./achievements";
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
  type PositionNeed,
} from "./ai/strategy";
import { wageDemand } from "./contracts";

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
    else grantDefaultContract(state, p, TUNING);
  } else {
    p.contract = undefined; // released to free agency
  }
  p.clubId = toClubId;
  p.form = 1.0;
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
    trackUserTransfer(state, "buy", fee);
    syncProgress(state);
  } else if (fromClubId === state.userTeamId) {
    trackUserTransfer(state, "sell", fee);
    syncProgress(state);
  }
  // clean up any other pending offers for this player
  state.offers = state.offers.filter((o) => o.playerId !== playerId || o.status !== "pending");
  state.transferList = state.transferList.filter((id) => id !== playerId);
  if (state.lineup) {
    for (const [slot, id] of Object.entries(state.lineup)) {
      if (id === playerId) delete state.lineup[slot];
    }
  }
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
  ];
  // How many separate offers landed this week (v1.51). The market used to stop
  // dead at the first one (`break`), so the user saw at most one approach a week
  // no matter how many clubs wanted their players — and none at all if that one
  // roll failed. Several clubs can now come calling in the same week, including
  // more than one for the SAME player.
  let offersThisWeek = 0;
  if (userPlayers.length && user.playerIds.length > 14) {
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
              canAfford(state, t, p.value, wageDemand(state, p, cfg), cfg) &&
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
          const suitors = interested
            .slice()
            .sort((a, b) => b.score - a.score)
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
    // Act on one of the two most pressing holes.
    const need = needs[Math.min(needs.length - 1, Math.floor(rng() * 2))];

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
        // Can the buyer actually afford the seller's price — fee AND wages (v19)?
        const price =
          Math.round((p.value * cfg.aiAcceptThreshold * sellerProfile.sellAsk * distressDiscount) / 100_000) * 100_000;
        if (price > buyBudgetFor(state, buyer, p, cfg)) continue;
        if (!canAfford(state, buyer, price, wageDemand(state, p, cfg), cfg)) continue;
        if (!best || score > best.score) best = { player: p, score, price };
      }
    }
    if (!best) {
      // No club-to-club deal to be had — try the free-agent market instead. A
      // free signing costs only wages, so a club that can't (or won't) pay a fee
      // can still address a hole here, which keeps the window from going quiet.
      if (rng() < cfg.aiFreeAgentSignChance) aiSignFreeAgent(state, buyer, need, cfg);
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
  const need = needs[Math.min(needs.length - 1, Math.floor(rng() * 2))];

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
      const price =
        Math.round((p.value * cfg.aiAcceptThreshold * sellerProfile.sellAsk * distressDiscount) / 100_000) * 100_000;
      if (price > buyBudgetFor(state, buyer, p, cfg)) continue;
      if (!canAfford(state, buyer, price, wageDemand(state, p, cfg), cfg)) continue;
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
  const pool = activePlayers(state).filter((p) => !p.clubId && !p.loan);
  if (pool.length <= cfg.freeAgentPoolFloor) return;
  let best: { player: PlayerBio; score: number } | null = null;
  for (const p of pool) {
    if (!p.positions.includes(need.pos) && !p.positions.some((pos) => positionAdjacent(pos, need.pos))) continue;
    const score = targetScore(state, buyer, need, p, cfg);
    if (score <= 0) continue;
    // Free transfer: no fee, so the wage is the whole affordability question.
    if (!canAfford(state, buyer, 0, wageDemand(state, p, cfg), cfg)) continue;
    if (!best || score > best.score) best = { player: p, score };
  }
  if (!best) return;
  completeTransfer(state, best.player.id, buyer.id, 0);
  state.news.unshift(`${buyer.name} sign free agent ${best.player.name} to bolster their ${need.pos}.`);
}

/**
 * Keep the user's club able to fulfil its fixtures (v1.51).
 *
 * Squad size is the manager's business — except at the point the club can no
 * longer field a legal side. Contract expiries and retirements both bite at the
 * rollover, so a manager who stops managing (or an automated run that never
 * answers a prompt) would otherwise ratchet the squad down to nothing over a
 * long save. This tops the senior squad back up to `matchdaySquad` from the free
 * agent pool, cheapest useful body first, and reports what it did.
 *
 * Deliberately NOT a quality pass: it signs the best free agent available for
 * the thinnest position, which is what a real club does in an emergency, and it
 * only ever runs when the squad is genuinely short. A manager who keeps a full
 * squad never sees it. Returns the names signed.
 */
export function ensureFieldableSquad(state: GameState, cfg: TuningConfig): string[] {
  const team = state.teams[state.userTeamId];
  const signed: string[] = [];
  let guard = 0;
  while (team.playerIds.filter((id) => !state.players[id]?.retired).length < cfg.matchdaySquad && guard++ < 40) {
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
function aiRenewContracts(state: GameState, rng: RNG, cfg: TuningConfig) {
  const clubs = Object.values(state.teams).filter(
    (t) => t.id !== state.userTeamId && state.leagues[t.leagueId]?.playable
  );
  for (const club of clubs) {
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

/** Refresh values after aging or window openings. */
export function refreshValues(state: GameState, cfg: TuningConfig) {
  for (const p of activePlayers(state)) {
    p.value = playerValue(p, cfg);
  }
}

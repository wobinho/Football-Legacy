// ── Transfer Market ───────────────────────────────────────────────────────
// [OPEN §10] The design doc reserves the final market rules for a design
// session. This is a deliberately simple interim implementation of the
// settled parts: single fee vs single budget, two windows, stored market
// values. Valuation formula details and richer AI behavior are the knobs
// the future session should revisit — all logic is isolated in this module.

import type { GameState, PlayerBio, TransferOffer } from "./types";
import type { TuningConfig } from "./config/tuning";
import { TUNING } from "./config/tuning";
import { transferWindowState } from "./calendar";
import { mulberry32, deriveSeed, pick, uid } from "./rng";
import { playerValue } from "./value";
import { grantDefaultContract, makeContract } from "./contracts";

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
  let mult = cfg.aiAcceptThreshold;
  if (isKeyPlayer(state, p)) mult *= cfg.aiKeyPlayerPremium;
  if (p.age <= 22 && p.potential - p.overall >= 6) mult *= 1.2;
  return Math.round((p.value * mult) / 100_000) * 100_000;
}

function ensureCareer(state: GameState, playerId: string) {
  if (!state.careers[playerId]) state.careers[playerId] = { playerId, seasons: [], transfers: [] };
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
  terms?: { wage: number; years: number }
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
    if (terms) p.contract = makeContract(state, terms.wage, terms.years);
    else grantDefaultContract(state, p, TUNING);
  } else {
    p.contract = undefined; // released to free agency
  }
  p.clubId = toClubId;
  p.form = 1.0;
  ensureCareer(state, playerId);
  state.careers[playerId].transfers.push({
    season: state.season,
    day: state.currentDay,
    from: fromClubId ? state.teams[fromClubId].name : "Free agent",
    to: toClubId ? state.teams[toClubId].name : "Released",
    fee,
  });
  // clean up any other pending offers for this player
  state.offers = state.offers.filter((o) => o.playerId !== playerId || o.status !== "pending");
  state.transferList = state.transferList.filter((id) => id !== playerId);
  if (state.lineup) {
    for (const [slot, id] of Object.entries(state.lineup)) {
      if (id === playerId) delete state.lineup[slot];
    }
  }
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
  terms?: { wage: number; years: number }
): BidOutcome {
  const p = state.players[playerId];
  const user = state.teams[state.userTeamId];
  if (!windowOpen(state)) return { kind: "error", reason: "The transfer window is closed." };
  if (p.clubId === state.userTeamId) return { kind: "error", reason: "Already your player." };
  if (user.playerIds.length >= cfg.squadCap) return { kind: "error", reason: `Squad cap reached (${cfg.squadCap} senior players).` };
  if (fee > user.budget) return { kind: "error", reason: "That bid exceeds your budget." };

  // free agent: signs for the (zero) signing fee
  if (!p.clubId) {
    completeTransfer(state, playerId, state.userTeamId, cfg.freeAgentSigningFee, terms);
    return { kind: "accepted" };
  }

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
  const ceiling = (offer.buyerCeiling ??= buyerCeilingFor(state, offer, p, cfg));
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

  // Over the ceiling. Walk if it's absurd, or patience has run out.
  const walksOnPrice = want > ceiling * cfg.negotiationWalkAwayOver;
  const outOfPatience = round >= cfg.negotiationMaxRounds;
  if (walksOnPrice || outOfPatience) {
    offer.status = "withdrawn";
    const why = walksOnPrice
      ? `${buyer.name} baulked at ${fmtFee(want)} and walked away.`
      : `${buyer.name} won't be pushed any further and have pulled out.`;
    return { kind: "withdrawn", message: why };
  }

  // Otherwise counter back: split the gap between their current offer and the
  // player's ask, edging toward the ceiling, with a little noise.
  const midpoint = offer.fee + (Math.min(want, ceiling) - offer.fee) * (0.55 + rng() * 0.25);
  const counterBack = Math.min(ceiling, Math.max(offer.fee, Math.round(midpoint / 100_000) * 100_000));
  offer.fee = counterBack; // the offer on the table rises
  return {
    kind: "countered",
    counterFee: counterBack,
    message: `${buyer.name} came back with ${fmtFee(counterBack)} for ${p.name}.`,
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
  const userPlayers = [
    ...user.playerIds.map((id) => state.players[id]).filter((p) => p.overall >= 62),
    ...listedAcademy,
  ];
  if (userPlayers.length && user.playerIds.length > 14) {
    const listedBoost = (p: PlayerBio) => (state.transferList.includes(p.id) ? 3 : 1);
    const quality = (p: PlayerBio) => Math.max(p.overall, p.age <= 21 ? p.potential - 12 : 0);
    for (const p of userPlayers) {
      const chance = cfg.aiBidChancePerWeek * listedBoost(p) * (quality(p) - 58) * 0.015;
      if (rng() < chance) {
        const buyers = Object.values(state.teams).filter(
          (t) =>
            t.id !== state.userTeamId &&
            state.leagues[t.leagueId]?.playable &&
            t.budget > p.value &&
            t.reputation >= state.teams[state.userTeamId].reputation - 25
        );
        if (buyers.length) {
          const buyer = pick(rng, buyers);
          const fee = Math.round((p.value * (state.transferList.includes(p.id) ? 0.95 + rng() * 0.2 : 1.0 + rng() * 0.35)) / 100_000) * 100_000;
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
          offer.buyerCeiling = buyerCeilingFor(state, offer, p, cfg);
          state.offers.push(offer);
          state.inbox.unshift({
            id: uid("inb"),
            day: state.currentDay,
            season: state.season,
            type: "offer",
            title: `${buyer.name} bid ${fmtFee(fee)} for ${p.name}`,
            body: `${buyer.name} have made a formal offer of ${fmtFee(fee)} for ${p.name} (valued at ${fmtFee(p.value)}). The offer expires in a week. Respond from the Transfers screen.`,
            read: false,
            offerId: offer.id,
          });
          interrupt = true;
          break; // one offer per week max
        }
      }
    }
  }

  // AI ↔ AI business (kept light; news only)
  const playableTeams = Object.values(state.teams).filter((t) => state.leagues[t.leagueId]?.playable);
  const deals = 1 + Math.floor(rng() * 3);
  for (let d = 0; d < deals; d++) {
    const buyer = pick(rng, playableTeams);
    if (buyer.id === state.userTeamId || buyer.budget < 3_000_000) continue;
    if (buyer.playerIds.length >= cfg.squadCap) continue;
    const sellers = Object.values(state.teams).filter((t) => t.id !== buyer.id && t.id !== state.userTeamId);
    const seller = pick(rng, sellers);
    const targets = seller.playerIds
      .map((id) => state.players[id])
      .filter((p) => !p.retired && p.value <= buyer.budget * 0.6 && p.overall >= 58 && !isKeyPlayer(state, p));
    if (!targets.length) continue;
    const target = pick(rng, targets);
    const fee = Math.round((target.value * (1.05 + rng() * 0.2)) / 100_000) * 100_000;
    if (fee > buyer.budget || state.teams[target.clubId!] !== seller) continue;
    completeTransfer(state, target.id, buyer.id, fee);
    state.news.unshift(`${target.name} joins ${buyer.name} from ${seller.name} for ${fmtFee(fee)}.`);
  }
  state.news = state.news.slice(0, 24);

  // expire stale offers
  for (const o of state.offers) {
    if (o.status === "pending" && state.currentDay > o.deadlineDay) o.status = "withdrawn";
  }
  return interrupt;
}

/** Refresh values after aging or window openings. */
export function refreshValues(state: GameState, cfg: TuningConfig) {
  for (const p of Object.values(state.players)) {
    if (!p.retired) p.value = playerValue(p, cfg);
  }
}

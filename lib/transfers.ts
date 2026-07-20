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
import { mulberry32, deriveSeed, pickWeighted, uid } from "./rng";
import { playerValue } from "./value";
import { grantDefaultContract, makeContract } from "./contracts";
import { assignKitNumber, clearKitNumber } from "./kitnumbers";
import type { RNG } from "./rng";
import {
  STANCE_PROFILE,
  stanceOf,
  squadNeeds,
  targetScore,
  saleCandidates,
  buyBudgetFor,
} from "./ai/strategy";

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
  // The selling club's stance sets how badly it wants to keep him: a side going
  // for the title prices its players out of the market, one rebuilding is happy
  // to cash in (§10).
  if (p.clubId && p.clubId !== state.userTeamId) {
    const seller = state.teams[p.clubId];
    if (seller) {
      const profile = STANCE_PROFILE[stanceOf(state, seller, cfg)];
      mult *= profile.sellAsk;
      // A club that won't sell starters at all names a prohibitive price.
      if (isKeyPlayer(state, p) && !profile.sellsStarters) mult *= cfg.aiKeyPlayerPremium;
    }
  }
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
  terms?: { wage: number; years: number }
): BidOutcome {
  const p = state.players[playerId];
  const user = state.teams[state.userTeamId];
  if (!windowOpen(state)) return { kind: "error", reason: "The transfer window is closed." };
  if (p.clubId === state.userTeamId) return { kind: "error", reason: "Already your player." };
  // No senior squad cap for the user (v14) — the wage bill is the constraint on
  // hoarding, not an arbitrary slot count. AI clubs still respect cfg.squadCap.
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
        // Only clubs with a real hole in this player's position come calling,
        // and only if he'd actually improve them (§10) — an offer should always
        // be legible to the user, not arbitrary.
        const interested = Object.values(state.teams)
          .filter(
            (t) =>
              t.id !== state.userTeamId &&
              state.leagues[t.leagueId]?.playable &&
              t.budget > p.value &&
              t.reputation >= state.teams[state.userTeamId].reputation - 25
          )
          .map((t) => {
            const need = squadNeeds(state, t, cfg).find((n) => p.positions.includes(n.pos));
            return need ? { team: t, score: targetScore(state, t, need, p, cfg) } : null;
          })
          .filter((x): x is { team: (typeof state.teams)[string]; score: number } => !!x && x.score > 0);
        if (interested.length) {
          const buyer = pickWeighted(rng, interested, (x) => x.score).team;
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

    const needs = squadNeeds(state, buyer, cfg);
    if (!needs.length) continue;
    // Act on one of the two most pressing holes.
    const need = needs[Math.min(needs.length - 1, Math.floor(rng() * 2))];

    // Shop the rest of the world (never the user's squad — those go through the
    // formal offer path so the user always gets to decide).
    let best: { player: PlayerBio; score: number } | null = null;
    for (const seller of clubs) {
      if (seller.id === buyer.id) continue;
      const sellerProfile = STANCE_PROFILE[stanceOf(state, seller, cfg)];
      for (const p of saleCandidates(state, seller, cfg)) {
        if (p.loan) continue;
        const score = targetScore(state, buyer, need, p, cfg);
        if (score <= 0) continue;
        // Can the buyer actually afford the seller's price?
        const price = Math.round((p.value * cfg.aiAcceptThreshold * sellerProfile.sellAsk) / 100_000) * 100_000;
        if (price > buyBudgetFor(state, buyer, p, cfg) || price > buyer.budget) continue;
        if (!best || score > best.score) best = { player: p, score };
      }
    }
    if (!best) continue;

    const target = best.player;
    const seller = state.teams[target.clubId!];
    if (!seller) continue;
    const sellerProfile = STANCE_PROFILE[stanceOf(state, seller, cfg)];
    // A club won't strip itself below a workable squad.
    if (seller.playerIds.length <= cfg.matchdaySquad) continue;

    const fee = Math.round((target.value * cfg.aiAcceptThreshold * sellerProfile.sellAsk) / 100_000) * 100_000;
    completeTransfer(state, target.id, buyer.id, fee);
    const why = STANCE_PROFILE[stanceOf(state, buyer, cfg)].label;
    state.news.unshift(
      `${target.name} joins ${buyer.name} from ${seller.name} for ${fmtFee(fee)} — ${why.toLowerCase()}.`
    );
  }
}

/** Refresh values after aging or window openings. */
export function refreshValues(state: GameState, cfg: TuningConfig) {
  for (const p of Object.values(state.players)) {
    if (!p.retired) p.value = playerValue(p, cfg);
  }
}

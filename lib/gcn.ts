// Global Club Network (§ end-game, v34). The manager, having funded the unlock
// threshold, becomes head of a network of AI-run clubs across leagues and
// countries. This module owns every GCN rule; the store calls in, React never
// implements rules (GAME_DESIGN.md §2).
//
// Design (locked with the owner):
//  - GCN clubs are AI-run; the manager oversees. They keep running on the sim
//    machinery. The network gets ownership, oversight, and the power to move
//    players between owned clubs (feeder clubs).
//  - The unlock threshold is *spent*; afterwards GCN runs its own treasury,
//    topped up from the main club, that pays for everything GCN.
//  - Founding/buying targets SIM (non-playable) leagues only. Sim leagues carry
//    no stored fixtures — they're resolved from `league.teamIds` and squad
//    strength (see simresolver.ts) — so inserting or swapping a club is a clean
//    membership edit with no mid-season fixture corruption. The manager's own
//    playable pyramid is left untouched.

import type { GameState, GlobalClubNetwork, GcnFacility, Team } from "./types";
import { TUNING, type TuningConfig } from "./config/tuning";
import { getFormation } from "./config/formations";
import { squadOverall } from "./selection";
import { completeTransfer } from "./transfers";
import { drawsAiSubsidy, weeklyBreakdown } from "./economy";
import { playerValue } from "./value";
import { clubBudget, defaultTactic, generateClubSquad, teamIdFor } from "./worldgen";
import { grantDefaultContract } from "./contracts";
import { assignKitNumber } from "./kitnumbers";
import { ensureProgress } from "./achievements";
import { execMarketTick, execWageBill, globalCommerceMult } from "./gcnexec";
import { hubUpkeepWeekly, hubWageBill } from "./gcnhub";

// ── Funds & unlock ─────────────────────────────────────────────────────────

/** How much the manager has committed toward the unlock threshold so far. */
export function gcnFundsOf(state: GameState): number {
  return state.gcnFunds ?? 0;
}

/** True once the funds pool has reached the unlock threshold. */
export function canUnlockGcn(state: GameState, cfg: TuningConfig): boolean {
  return !state.gcn && gcnFundsOf(state) >= cfg.gcnUnlockFundsTarget;
}

/** Deposit `amount` from the main club's budget into the GCN Funds pool. Returns
 * an error string on failure, or void on success. */
export function depositToFunds(state: GameState, amount: number, cfg: TuningConfig): string | void {
  if (state.gcn) return "The network is already unlocked.";
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount to deposit.";
  const club = state.teams[state.userTeamId];
  if (n > club.budget) return "Your club can't afford that deposit.";
  // Don't over-fund: cap the deposit at what's still needed to reach the target.
  const remaining = cfg.gcnUnlockFundsTarget - gcnFundsOf(state);
  const applied = Math.min(n, remaining);
  club.budget -= applied;
  state.gcnFunds = gcnFundsOf(state) + applied;
}

/** Unlock the network. Spends the funds pool (it's the entry cost) and stands up
 * an empty GCN with a fresh treasury. Returns an error string on failure. */
export function unlockGcn(state: GameState, name: string, cfg: TuningConfig): string | void {
  if (state.gcn) return "The network is already unlocked.";
  if (!canUnlockGcn(state, cfg)) return "GCN Funds haven't reached the threshold yet.";
  const trimmed = name.trim();
  if (!trimmed) return "Name your Global Club Network.";
  state.gcnFunds = 0; // the pool is spent to unlock
  const gcn: GlobalClubNetwork = {
    name: trimmed.slice(0, 48),
    foundedSeason: state.season,
    treasury: 0,
    clubIds: [],
    ops: {},
    executives: {},
    hubs: {},
    hubProspectIds: [],
    hubReports: [],
  };
  state.gcn = gcn;
  // Seed the executive shortlist AT UNLOCK (v1.95), not on the next daily tick.
  // `execMarketTick` runs inside `advanceDay`, so a network founded mid-week
  // would open its Operations tab on an empty boardroom market and stay that way
  // until the manager happened to advance the clock — which reads as a broken
  // feature rather than as a market that hasn't opened yet.
  execMarketTick(state, cfg);
}

// ── Treasury ───────────────────────────────────────────────────────────────

/** Move money from the main club's budget into the GCN treasury. */
export function depositToTreasury(state: GameState, amount: number): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount to deposit.";
  const club = state.teams[state.userTeamId];
  if (n > club.budget) return "Your club can't afford that deposit.";
  club.budget -= n;
  gcn.treasury += n;
}

/** Move money from the GCN treasury back into the main club's budget. */
export function withdrawFromTreasury(state: GameState, amount: number): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount to withdraw.";
  if (n > gcn.treasury) return "The treasury doesn't hold that much.";
  gcn.treasury -= n;
  state.teams[state.userTeamId].budget += n;
}

// ── Ring-fencing (v1.64, relaxed v1.88) ──────────────────────────────────────
// A club the network owns in the manager's OWN country is held at arm's length.
// The manager gets the ownership — the standing, the balance sheet, the
// achievement — but not the levers that would let him decide a domestic title
// from two dugouts at once.
//
// v1.64 drew that line at "no lever whatsoever": no treasury funding, no
// standing orders, no GCN Deals, no player movement in any direction, no feeder
// loans. That was too blunt in one specific way — it also banned two ring-fenced
// clubs from dealing with EACH OTHER, and a move between two clubs neither of
// which is the manager's own confers no advantage on the team he actually picks.
// The real invariant is narrower, and it is what the rules below now enforce:
//
//   MONEY may never cross the fence. The manager's club and the network's cash
//   are the same pocket, so funding a domestic club is funding a rival's rival.
//
//   PLAYERS may not move between the manager's OWN squad and a ring-fenced club,
//   in either direction. Everything else — one ring-fenced holding trading with
//   another in the same country, priced at market value — is ordinary business.
//
// A cross-border move inside the network stays free: no domestic rival is
// affected by it. A domestic one is PRICED (`gcnDomesticTransferPriceFactor`),
// buying club paying selling club, so the two balance sheets stay honest and a
// domestic squad can't be stripped for nothing.

const RING_FENCED_MONEY_ERROR =
  "That club is in your own country — it's ring-fenced, so network money can't reach it.";
const RING_FENCED_PLAYER_ERROR =
  "A ring-fenced club can't trade players with your own squad — only with other network clubs in its country.";
const RING_FENCED_CROSS_BORDER_ERROR =
  "A ring-fenced club can only trade with network clubs in its own country.";

/** Fund an owned club: move money out of the treasury and into that club's own
 * transfer/wage budget (v1.62). The counterpart to a withdrawal — the network's
 * way of propping up a club it owns rather than the main squad. Returns an error
 * string on failure. */
export function fundClub(state: GameState, clubId: string, amount: number): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!gcn.clubIds.includes(clubId)) return "That club isn't in the network.";
  const club = state.teams[clubId];
  if (!club) return "Unknown club.";
  if (club.gcnRingFenced) return RING_FENCED_MONEY_ERROR;
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount to send.";
  if (n > gcn.treasury) return "The treasury doesn't hold that much.";
  gcn.treasury -= n;
  club.budget += n;
}

// ── Selling players out of an owned club ─────────────────────────────────────

/** What an owned club would bank for selling a player (v1.63). The network isn't
 * negotiating with a buyer here — it's cashing a player in at his market value,
 * so the fee is `playerValue` with a small sell-on haircut. */
export function gcnPlayerSalePrice(state: GameState, playerId: string, cfg: TuningConfig): number {
  const p = state.players[playerId];
  if (!p) return 0;
  return Math.round(playerValue(p, cfg) * cfg.gcnSellPlayerPriceFactor);
}

/** Sell a player out of an owned club to the wider market. He leaves as a free
 * agent (the same shape a release takes) and the fee lands in *that club's* own
 * budget, not the treasury — the network's clubs keep their own books. Returns
 * an error string on failure. */
export function sellPlayer(state: GameState, playerId: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const p = state.players[playerId];
  if (!p) return "Unknown player.";
  if (!p.clubId || !gcn.clubIds.includes(p.clubId)) return "That player isn't at an owned club.";
  if (p.loan) return "A player out on loan can't be sold.";
  // Ring-fenced clubs may sell (v1.88). The v1.64 ban treated this as a fixing
  // lever, but a sale sends the player OUT of the network to free agency and
  // banks the fee in that club's own budget — it strengthens nobody the manager
  // picks, and the squad floor below already stops a domestic side being gutted.
  const club = state.teams[p.clubId];
  if (club && club.playerIds.length <= cfg.gcnSellMinSquadSize) {
    return `An owned club must keep at least ${cfg.gcnSellMinSquadSize} players.`;
  }
  // completeTransfer credits the selling club's budget with the fee and handles
  // the tactics/academy scrubbing.
  completeTransfer(state, playerId, null, gcnPlayerSalePrice(state, playerId, cfg), undefined, "transfer");
}

// ── Editing an owned club ────────────────────────────────────────────────────

/** Identity edits the network may make to a club it owns (v1.62): its name,
 * crest abbreviation, colours and stadium. Ownership is the licence — the
 * manager's own club is edited elsewhere and AI clubs aren't editable at all. */
export interface GcnClubEdit {
  name: string;
  short: string;
  colors: [string, string];
  stadium: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Rename / re-brand an owned club. Returns an error string on failure. */
export function editClub(state: GameState, clubId: string, edit: GcnClubEdit): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!gcn.clubIds.includes(clubId)) return "You can only edit clubs the network owns.";
  const club = state.teams[clubId];
  if (!club) return "Unknown club.";
  const name = edit.name.trim();
  if (!name) return "The club needs a name.";
  // The crest carries 2–4 letters; anything else renders as a smear.
  const short = edit.short.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (short.length < 2) return "The abbreviation needs 2–4 letters.";
  if (!HEX.test(edit.colors[0]) || !HEX.test(edit.colors[1])) return "Colours must be hex values.";
  const stadium = edit.stadium.trim();
  if (!stadium) return "The club needs a stadium name.";
  club.name = name.slice(0, 48);
  club.short = short;
  club.colors = [edit.colors[0], edit.colors[1]];
  club.stadium = stadium.slice(0, 64);
}

// ── Buying clubs ─────────────────────────────────────────────────────────────

/** A league's reputation score (0–100): its tier ranking blended with the mean
 * reputation of its clubs. `League` carries no explicit reputation, so derive
 * one — a top-flight full of storied clubs reads high, a lower sim division low. */
function leagueRepScore(state: GameState, leagueId: string): number {
  const league = state.leagues[leagueId];
  if (!league) return 0;
  const reps = league.teamIds.map((id) => state.teams[id]?.reputation ?? 0).filter((r) => r > 0);
  const meanRep = reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : 0;
  // Tier 1 = full weight, deeper tiers taper off.
  const tierFactor = 1 / Math.max(1, league.tier);
  return meanRep * tierFactor;
}

/** The price to buy an existing club into the network (v34, owner's formula):
 * sum of the squad's player values × a multiplier, plus premiums for the
 * league's reputation and the club's own reputation. */
export function clubBuyPrice(state: GameState, clubId: string, cfg: TuningConfig): number {
  const club = state.teams[clubId];
  if (!club) return 0;
  const squadValue = club.playerIds.reduce((sum, id) => {
    const p = state.players[id];
    return p ? sum + playerValue(p, cfg) : sum;
  }, 0);
  const leaguePremium = leagueRepScore(state, club.leagueId) * cfg.gcnBuyLeagueRepPremium;
  const clubPremium = club.reputation * cfg.gcnBuyClubRepPremium;
  return Math.round(squadValue * cfg.gcnBuyValueMultiplier + leaguePremium + clubPremium);
}

/** The country the manager's own club plays in. Home-country clubs are the ones
 * the network may own only on ring-fenced terms (v1.64). */
export function userCountry(state: GameState): string {
  const own = state.teams[state.userTeamId];
  return state.leagues[own?.leagueId ?? ""]?.country ?? "";
}

/** True if a club sits in the manager's own country — playable pyramid or the
 * sim divisions beneath it. Such a club can be bought (v1.64), but only as a
 * ring-fenced holding: see `gcnRingFenced`. */
export function isHomeCountryClub(state: GameState, clubId: string): boolean {
  const club = state.teams[clubId];
  if (!club) return false;
  const country = state.leagues[club.leagueId]?.country;
  return !!country && country === userCountry(state);
}

/** True when a club the network owns is ring-fenced — a home-country holding
 * that must stay at arm's length from the rest of the empire. */
export function isRingFenced(state: GameState, clubId: string): boolean {
  return !!state.teams[clubId]?.gcnRingFenced;
}

/** True if a club can be brought into the network.
 *
 * Sim (non-playable) leagues anywhere are fair game. Home-country clubs are
 * buyable too (v1.64) — including ones in the manager's own playable pyramid —
 * but only as ring-fenced holdings, and never a club in the SAME division the
 * manager currently plays in: co-owning a direct league rival is the one case
 * that can't be made honest, since the two meet for points. */
export function isBuyableClub(state: GameState, clubId: string, cfg?: TuningConfig): boolean {
  const club = state.teams[clubId];
  if (!club || clubId === state.userTeamId || club.gcnOwned) return false;
  const league = state.leagues[club.leagueId];
  if (!league) return false;
  if (!league.playable) {
    // A sim league in the manager's own country is still a home-country club.
    if (isHomeCountryClub(state, clubId)) return cfg ? cfg.gcnAllowHomeCountryClubs : true;
    return true;
  }
  // Playable league: only the manager's own country's pyramid exists here, and
  // only outside his own division.
  if (cfg && !cfg.gcnAllowHomeCountryClubs) return false;
  return club.leagueId !== state.teams[state.userTeamId]?.leagueId;
}

/** Buy an existing club into the network, paid from the treasury. Returns an
 * error string on failure. */
export function buyClub(state: GameState, clubId: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!isBuyableClub(state, clubId, cfg)) return "That club can't be brought into the network.";
  if (atGroupClubsCap(state, cfg))
    return `The network is at its ${groupClubsCap(state, cfg)}-club limit — upgrade Group Clubs in Operations.`;
  const price = clubBuyPrice(state, clubId, cfg);
  if (price > gcn.treasury) return "The GCN treasury can't afford that club.";
  gcn.treasury -= price;
  const club = state.teams[clubId];
  club.gcnOwned = true;
  club.gcnAcquiredSeason = state.season;
  // A club in the manager's own country is held at arm's length — no money, no
  // players, no feeder loans move between it and the rest of the network.
  if (isHomeCountryClub(state, clubId)) club.gcnRingFenced = true;
  gcn.clubIds.push(clubId);

  const a = ensureProgress(state).accolades;
  a.gcnClubsBought += 1;
  a.gcnBiggestClubPurchase = Math.max(a.gcnBiggestClubPurchase, price);
}

// ── Selling clubs ────────────────────────────────────────────────────────────

/** What the network is offered for an owned club (v1.63): what it would cost to
 * buy that club today, less the resale haircut. Valuing it live means a club the
 * network built up sells for more than it was bought for. */
export function clubSalePrice(state: GameState, clubId: string, cfg: TuningConfig): number {
  return Math.round(clubBuyPrice(state, clubId, cfg) * cfg.gcnSellClubPriceFactor);
}

/** The first season an owned club may be sold in (v1.64): the season it was
 * acquired plus the minimum hold. A pre-v1.64 club carries no acquisition
 * stamp — it's treated as long-held, so it stays sellable. */
export function clubSellableSeason(state: GameState, clubId: string, cfg: TuningConfig): number | null {
  const acquired = state.teams[clubId]?.gcnAcquiredSeason;
  if (acquired === undefined) return null;
  return acquired + cfg.gcnMinHoldSeasons;
}

/** Seasons still to run on an owned club's minimum hold, 0 once it's free to
 * sell. Drives both the guard in `sellClub` and the UI's lock message. */
export function seasonsUntilSellable(state: GameState, clubId: string, cfg: TuningConfig): number {
  const from = clubSellableSeason(state, clubId, cfg);
  if (from === null) return 0;
  return Math.max(0, from - state.season);
}

/** Sell an owned club out of the network. The club itself survives — it simply
 * reverts to being an ordinary AI side in its league, keeping its squad, budget
 * and identity — and the sale price lands in the treasury. Returns an error
 * string on failure. */
export function sellClub(state: GameState, clubId: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!gcn.clubIds.includes(clubId)) return "That club isn't in the network.";
  const club = state.teams[clubId];
  if (!club) return "Unknown club.";
  // Minimum hold (v1.64): a club joins the network for the long term — it can't
  // be flipped back out for a quick treasury profit.
  const wait = seasonsUntilSellable(state, clubId, cfg);
  if (wait > 0) {
    return `${club.name} is under the ${cfg.gcnMinHoldSeasons}-season minimum hold — sellable from S${clubSellableSeason(state, clubId, cfg)} (${wait} more ${wait === 1 ? "season" : "seasons"}).`;
  }
  const price = clubSalePrice(state, clubId, cfg);
  gcn.treasury += price;
  gcn.clubIds = gcn.clubIds.filter((id) => id !== clubId);
  delete club.gcnOwned;
  delete club.gcnAcquiredSeason;
  delete club.gcnRingFenced;
  // A club that's left the network can't keep drawing its standing order.
  if (gcn.autoFunding) delete gcn.autoFunding[clubId];
  // Any player the network had out on a feeder loan there loses his guaranteed
  // destination — recall him rather than leave him at a club we no longer own.
  for (const p of Object.values(state.players)) {
    if (p.loan?.toClubId === clubId) p.loan = undefined;
  }
}

// ── Automated funding (v1.63) ────────────────────────────────────────────────

/** Owned clubs the treasury may send money to — everything except the
 * ring-fenced home-country holdings (v1.64). The two funding dialogs list this,
 * so a club that can't take network money never appears as an option. */
export function fundableClubIds(state: GameState): string[] {
  return (state.gcn?.clubIds ?? []).filter((id) => !state.teams[id]?.gcnRingFenced);
}

/** The standing weekly order for an owned club, 0 when none is set. */
export function autoFundingOf(state: GameState, clubId: string): number {
  return state.gcn?.autoFunding?.[clubId] ?? 0;
}

/** Set (or clear, with 0) the weekly amount the treasury sends an owned club.
 * Returns an error string on failure. */
export function setAutoFunding(state: GameState, clubId: string, amount: number): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!gcn.clubIds.includes(clubId)) return "That club isn't in the network.";
  if (state.teams[clubId]?.gcnRingFenced) return RING_FENCED_MONEY_ERROR;
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n < 0) return "Enter a weekly amount.";
  const map = (gcn.autoFunding ??= {});
  if (n === 0) delete map[clubId];
  else map[clubId] = n;
}

/** Everything the network pays out automatically each week, for the UI's
 * "committed per week" line. */
export function totalAutoFunding(state: GameState): number {
  const gcn = state.gcn;
  if (!gcn) return 0;
  return fundableClubIds(state).reduce((sum, id) => sum + autoFundingOf(state, id), 0);
}

// ── An owned club's own books (v1.88) ────────────────────────────────────────
// A GCN club in a SIM league banked nothing week to week: weeklyEconomyTick
// skips sim leagues entirely, and gcnWeeklyTick paid it only GCN Deals plus any
// standing order. The Finance panel therefore read £0 income and £0 spend on a
// club fielding a real squad on real wages — and "fund this club" had no
// shortfall to fund against, which made the whole funding system decorative.
//
// The fix is not to run the full playable-league economy on a sim club (there
// are no fixtures to compute a position bonus from, and no facilities or staff
// to bill). It is to give the club ABSTRACTED books of its own: the ordinary
// income lines its tier and reputation already imply, scaled by
// `gcnSimIncomeFactor`, less the share of its squad wage bill set by
// `gcnSimWageFactor`. Both are pure tuning, and this one function is what the
// weekly tick banks AND what the panel prints, so the two can never disagree.

/** The abstracted weekly income and wages of an owned club in a SIM league.
 *
 * Returns null for a club whose money is already accounted for elsewhere, so
 * nothing is ever banked twice:
 *  - a playable-league holding keeps real books in `weeklyEconomyTick`;
 *  - a RING-FENCED club still draws the central AI subsidy there (it takes no
 *    network money, so it stays on the same footing as its domestic rivals),
 *    and that subsidy is its abstracted week. */
export function gcnSimBooks(
  state: GameState,
  clubId: string,
  cfg: TuningConfig
): { income: number; wages: number } | null {
  const club = state.teams[clubId];
  if (!club) return null;
  if (state.leagues[club.leagueId]?.playable) return null;
  if (drawsAiSubsidy(state, clubId)) return null;
  const w = weeklyBreakdown(state, clubId, cfg);
  // The position bonus is deliberately absent: a sim league has no stored
  // fixtures to rank against mid-season, so it would be a number invented here.
  const gross = w.tvIncome + w.gateIncome + w.sponsorIncome;
  // Scale by reputation (v1.88). Every sim league is tier 1, so the tier-keyed
  // income lines above are nearly flat across the whole sim world while wage
  // bills run 5:1 — without this the biggest clubs in the network are the ones
  // that lose money. See `gcnSimIncomeRepPivot` for the measurement.
  const repMult = Math.pow(
    Math.max(1, club.reputation) / cfg.gcnSimIncomeRepPivot,
    cfg.gcnSimIncomeRepPower
  );
  // The Director of Global Commerce lands HERE (v1.99), and only here. He used
  // to multiply the two Operations income tracks; with those deleted, an owned
  // club's own commercial week is what a commercial director is for, and it is
  // the better home for the same reason the tracks were the worse one — it is a
  // return on running clubs rather than on having pressed Upgrade. He returns
  // exactly 1 when the seat is vacant, so a network with no boardroom banks what
  // it always did.
  return {
    income: Math.round(gross * cfg.gcnSimIncomeFactor * repMult * globalCommerceMult(state, cfg)),
    wages: Math.round(w.wageBill * cfg.gcnSimWageFactor),
  };
}

// ── Weekly network tick ──────────────────────────────────────────────────────

/** The Monday pass over the network (v1.63), run alongside weeklyEconomyTick:
 *  1. The network's own payroll leaves the treasury.
 *  2. Every owned sim-league club banks its own abstracted books (v1.88).
 *  3. Standing auto-funding orders move treasury → club budgets, in club order,
 *     each paid in full or skipped when the treasury can't cover it.
 * A sim-league club is invisible to weeklyEconomyTick, so this is where its
 * income and wages are banked; a playable-league holding keeps real books there
 * and is skipped here, so nothing is ever counted twice.
 *
 * v1.99 deleted steps that paid the treasury and every owned club a weekly sum
 * bought by an Operations level (Brand Deals, GCN Deals). The treasury's income
 * is now what the manager puts in and what his clubs earn — see `GcnFacility`. */
export function gcnWeeklyTick(state: GameState, cfg: TuningConfig) {
  const gcn = state.gcn;
  if (!gcn) return;

  // The network's own payroll (v1.95): the boardroom's wages, the hubs' upkeep
  // and the wages of every prospect on a hub's books. All three are paid from
  // the TREASURY rather than any club's budget, because the network employs
  // them — a club that happens to sit near a hub must not be billed for it.
  //
  // Unlike a standing order these are NOT skipped when the treasury is short:
  // a wage bill is owed whether or not it can be covered, and letting the
  // treasury go negative is the honest signal that the empire has overreached.
  // The manager's remedy is to dismiss, downsize or fund — all of which are one
  // click away on the same screen.
  gcn.treasury -= execWageBill(state);
  gcn.treasury -= hubUpkeepWeekly(state, cfg);
  gcn.treasury -= hubWageBill(state, cfg);

  // An owned club's own trading week (v1.88). This runs for RING-FENCED clubs
  // too: a home-country holding is cut off from network money, not from its own
  // gate receipts. It is the network money below that the ring fence stops.
  for (const id of gcn.clubIds) {
    const books = gcnSimBooks(state, id, cfg);
    if (books) state.teams[id].budget += books.income - books.wages;
  }

  // Ring-fenced (home-country) clubs draw no network money at all — they live on
  // their own books plus the same AI subsidy every other club gets. That rule is
  // what the standing orders below still enforce.
  for (const id of gcn.clubIds) {
    const amount = autoFundingOf(state, id);
    const club = state.teams[id];
    if (!amount || !club || club.gcnRingFenced || amount > gcn.treasury) continue;
    gcn.treasury -= amount;
    club.budget += amount;
  }
}

// ── Founding clubs ───────────────────────────────────────────────────────────

/** Sim (non-playable) leagues the network can found or buy into, one entry per
 * country's lowest division. "Lowest" is the highest tier number for that
 * country. */
export function foundableLeagues(state: GameState): { leagueId: string; name: string; country: string }[] {
  const byCountry = new Map<string, { leagueId: string; name: string; country: string; tier: number }>();
  for (const league of Object.values(state.leagues)) {
    if (league.playable) continue;
    const cur = byCountry.get(league.country);
    if (!cur || league.tier > cur.tier) {
      byCountry.set(league.country, { leagueId: league.id, name: league.name, country: league.country, tier: league.tier });
    }
  }
  return [...byCountry.values()]
    .sort((a, b) => a.country.localeCompare(b.country))
    .map(({ leagueId, name, country }) => ({ leagueId, name, country }));
}

/** Found a brand-new network club in the given sim league's lowest division,
 * replacing one existing club there. The replaced club's players scatter to
 * free agency; the new club fields a freshly-generated low-quality squad. Paid
 * from the treasury. Returns an error string on failure. */
export function foundClub(state: GameState, leagueId: string, name: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const league = state.leagues[leagueId];
  if (!league || league.playable) return "You can only found a club in a sim league.";
  if (atGroupClubsCap(state, cfg))
    return `The network is at its ${groupClubsCap(state, cfg)}-club limit — upgrade Group Clubs in Operations.`;
  const trimmed = name.trim();
  if (!trimmed) return "Name the new club.";
  if (cfg.gcnFoundClubCost > gcn.treasury) return "The GCN treasury can't afford to found a club.";
  if (league.teamIds.length === 0) return "That league has no slot to take over.";

  // Take over the weakest existing club's slot (least disruptive to the league).
  const victimId = [...league.teamIds].sort((a, b) => {
    const sa = state.teams[a]?.reputation ?? 0;
    const sb = state.teams[b]?.reputation ?? 0;
    return sa - sb;
  })[0];
  const victim = state.teams[victimId];

  gcn.treasury -= cfg.gcnFoundClubCost;

  // Scatter the replaced club's players to free agency (fee 0 = a free release).
  for (const pid of [...victim.playerIds]) completeTransfer(state, pid, null, 0);

  // Remove the old club from the league and the world.
  league.teamIds = league.teamIds.filter((id) => id !== victimId);
  delete state.teams[victimId];

  // Stand up the new club in the vacated slot.
  const newId = teamIdFor(leagueId, league.teamIds.length + 1) + `_gcn${gcn.clubIds.length}`;
  const rep = Math.max(1, victim.reputation - 5); // start a notch below what it replaces
  const homeNat = league.country;
  const playerIds = generateClubSquad(
    state.seed + state.currentDay,
    cfg,
    newId,
    trimmed,
    rep,
    cfg.gcnFoundSquadAvgOverall,
    homeNat,
    state.players
  );
  const team: Team = {
    id: newId,
    name: trimmed.slice(0, 48),
    short: trimmed.slice(0, 3).toUpperCase(),
    leagueId,
    colors: ["#12131a", "#c8a24a"],
    reputation: rep,
    budget: clubBudget(rep),
    playerIds,
    tactic: defaultTactic(),
    facilities: {},
    staffRoster: [],
    stadium: `${trimmed} Stadium`,
    academyPlayerIds: [],
    assignments: {},
    sponsors: [],
    sponsorOffers: [],
    gcnOwned: true,
    gcnAcquiredSeason: state.season,
    // Founding only ever targets a sim league, but that league can sit in the
    // manager's own country — ring-fence it on the same terms as a purchase.
    ...(league.country === userCountry(state) ? { gcnRingFenced: true } : {}),
  };
  state.teams[newId] = team;
  league.teamIds.push(newId);
  gcn.clubIds.push(newId);
  ensureProgress(state).accolades.gcnClubsFounded += 1;

  // Contracts + kit numbers for the fresh squad (worldgen does this at build
  // time; a mid-save club needs it done explicitly).
  for (const pid of playerIds) {
    const p = state.players[pid];
    if (!p.contract) grantDefaultContract(state, p, cfg);
    assignKitNumber(state, p);
  }
}

// ── Moving players within the network ────────────────────────────────────────

/** Every club in the network, the manager's own included (v1.88). Ring-fenced
 * holdings ARE listed now: they can trade with each other domestically. Which
 * specific pairs are legal is `networkMoveError`'s question, not this list's —
 * the picker shows the whole empire and the rules explain any refusal. */
export function networkClubIds(state: GameState): string[] {
  const gcn = state.gcn;
  if (!gcn) return [state.userTeamId];
  return [state.userTeamId, ...gcn.clubIds];
}

/** The country a network club plays in, "" when unknown. */
function countryOf(state: GameState, clubId: string): string {
  return state.leagues[state.teams[clubId]?.leagueId ?? ""]?.country ?? "";
}

/** Why a player may not move from `fromId` to `toId` inside the network, or null
 * when the move is legal (v1.88). Split out from `moveWithinNetwork` so the UI
 * can grey out an illegal destination and quote the same reason the rule gives —
 * React never re-derives this itself. */
export function networkMoveError(
  state: GameState,
  fromId: string,
  toId: string,
  cfg: TuningConfig
): string | null {
  if (fromId === toId) return "The player is already there.";
  if (!isRingFenced(state, fromId) && !isRingFenced(state, toId)) return null;
  // The manager's own squad never mixes with a club inside his own pyramid.
  if (fromId === state.userTeamId || toId === state.userTeamId) return RING_FENCED_PLAYER_ERROR;
  if (!cfg.gcnAllowDomesticNetworkTransfers) return RING_FENCED_PLAYER_ERROR;
  // Two owned clubs may deal, provided they share a country: a ring-fenced club
  // must not become a pipeline importing talent from the wider empire.
  if (countryOf(state, fromId) !== countryOf(state, toId)) return RING_FENCED_CROSS_BORDER_ERROR;
  return null;
}

/** What one network club pays another for a player (v1.88). A cross-border move
 * inside the empire is free — no domestic rival is affected by it, and both
 * books are the manager's anyway. A DOMESTIC move is priced at market value, so
 * one owned club can't be stripped for nothing to prop up another in the same
 * pyramid. */
export function networkTransferFee(
  state: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  cfg: TuningConfig
): number {
  const p = state.players[playerId];
  if (!p) return 0;
  const domestic = countryOf(state, fromId) === countryOf(state, toId);
  if (!domestic) return 0;
  // Only a move touching a ring-fenced club is priced; two sim-league clubs in
  // one foreign country are ordinary feeder business and stay free.
  if (!isRingFenced(state, fromId) && !isRingFenced(state, toId)) return 0;
  return Math.round(playerValue(p, cfg) * cfg.gcnDomesticTransferPriceFactor);
}

/** Permanently transfer a player between two network clubs. Ordinarily free —
 * both clubs are the manager's, so no money leaves the empire — but a move
 * involving a ring-fenced domestic club is paid at market value between the two
 * clubs' own budgets (v1.88). Either end may be the manager's own club, except
 * where the ring fence forbids it. Returns an error string on failure. */
export function moveWithinNetwork(
  state: GameState,
  playerId: string,
  toClubId: string,
  cfg: TuningConfig
): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const p = state.players[playerId];
  if (!p) return "Unknown player.";
  const network = new Set(networkClubIds(state));
  if (!p.clubId || !network.has(p.clubId)) return "That player isn't at a network club.";
  if (!network.has(toClubId)) return "The destination isn't a network club.";
  if (p.loan) return "A player out on loan can't be transferred.";
  const blocked = networkMoveError(state, p.clubId, toClubId, cfg);
  if (blocked) return blocked;
  const fee = networkTransferFee(state, playerId, p.clubId, toClubId, cfg);
  const buyer = state.teams[toClubId];
  if (fee > 0 && buyer.budget < fee) {
    return `${buyer.name} can't afford the ${formatFee(fee)} fee — a domestic move inside the network is paid at market value.`;
  }
  // completeTransfer moves the fee BOTH ways — it credits the seller and debits
  // the buyer — so passing it a non-zero fee is the whole payment. Debiting the
  // buyer here as well charged him twice, which `verify:gcn` caught.
  completeTransfer(state, playerId, toClubId, fee);
}

/** A bare money string for the one error message that needs one. The UI's
 * `formatMoney` lives in the value module; importing it here for a single
 * sentence would drag a formatting concern into the rules, so this is the
 * minimum that reads correctly. */
function formatFee(n: number): string {
  return n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}M` : `£${Math.round(n / 1000)}k`;
}

/** Send a player out on a feeder loan to an owned club with a guaranteed role.
 * Unlike an ordinary loan (statistical uptake decided by the AI), a feeder loan
 * to a GCN-owned club guarantees the flagged role's minutes — the whole point of
 * a feeder club. The guaranteed-minutes credit rides weeklyLoanTick, which
 * recognises a GCN-owned destination. Returns an error string on failure. */
export function sendToFeeder(
  state: GameState,
  playerId: string,
  toClubId: string,
  role: "starter" | "rotation",
  cfg: TuningConfig
): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const p = state.players[playerId];
  if (!p) return "Unknown player.";
  if (p.clubId !== state.userTeamId) return "Only your own players can be sent to a feeder club.";
  if (!gcn.clubIds.includes(toClubId)) return "The destination isn't an owned club.";
  if (!state.teams[toClubId]?.gcnOwned) return "The destination isn't an owned club.";
  if (isRingFenced(state, toClubId)) return RING_FENCED_PLAYER_ERROR;
  p.loan = {
    toClubId,
    startDay: state.currentDay,
    // A feeder loan to an owned sim club uses the sim-destination weight; the
    // guaranteed-minutes uplift is applied in weeklyLoanTick, not here.
    minutesWeight: cfg.loanMinutesWeightSim,
    role,
  };
  ensureProgress(state).accolades.gcnFeederLoans += 1;
}

// ── Operations upgrades (table-driven, mirrors economy.ts) ───────────────────

interface GcnFacilitySpec {
  costKey: keyof TuningConfig; // number[] of per-level costs
  maxKey: keyof TuningConfig; // number cap
  label: string;
  blurb: string;
}

export const GCN_FACILITY_SPEC: Record<GcnFacility, GcnFacilitySpec> = {
  groupClubs: {
    costKey: "gcnGroupClubsUpgradeCost",
    maxKey: "gcnGroupClubsMaxLevel",
    label: "Group Clubs",
    blurb: "How many clubs the network may own. Every level buys more slots to found or buy into.",
  },
};

export function gcnLevelOf(state: GameState, facility: GcnFacility): number {
  return state.gcn?.ops[facility] ?? 0;
}

/** How many clubs the network may own right now: the base cap plus whatever the
 * Group Clubs track has bought. This is the one Operations effect (v1.62) — the
 * network's size is the thing upgrades gate. */
export function groupClubsCap(state: GameState, cfg: TuningConfig): number {
  return cfg.gcnGroupClubsBase + gcnLevelOf(state, "groupClubs") * cfg.gcnGroupClubsPerLevel;
}

// The two weekly-income tracks (Brand Deals, GCN Deals) were deleted in v1.99 —
// see `GcnFacility` in types.ts. The Director of Global Commerce's multiplier
// still exists and still has work: it scales an owned sim club's own income
// (`gcnSimBooks`), which is a return on running clubs rather than on pressing
// Upgrade, and is the shape the seat was always described as having.

/** True when the network is at its owned-club cap and can't take on another. */
export function atGroupClubsCap(state: GameState, cfg: TuningConfig): boolean {
  return (state.gcn?.clubIds.length ?? 0) >= groupClubsCap(state, cfg);
}

/** The cost of the next level of a facility, or null if maxed / not unlocked. */
export function gcnNextCost(state: GameState, facility: GcnFacility, cfg: TuningConfig): number | null {
  const gcn = state.gcn;
  if (!gcn) return null;
  const spec = GCN_FACILITY_SPEC[facility];
  const max = cfg[spec.maxKey] as number;
  const level = gcnLevelOf(state, facility);
  if (level >= max) return null;
  const costs = cfg[spec.costKey] as number[];
  return costs[level] ?? null;
}

/** Buy the next level of a GCN Operations facility, paid from the treasury.
 * Returns an error string on failure. */
export function upgradeGcnFacility(state: GameState, facility: GcnFacility, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const cost = gcnNextCost(state, facility, cfg);
  if (cost === null) return "That's already at its maximum level.";
  if (cost > gcn.treasury) return "The GCN treasury can't afford that upgrade.";
  gcn.treasury -= cost;
  gcn.ops[facility] = gcnLevelOf(state, facility) + 1;
}

// ── Headquarters overview ────────────────────────────────────────────────────

export interface GcnClubSummary {
  clubId: string;
  name: string;
  leagueId: string;
  leagueName: string;
  country: string;
  reputation: number;
  budget: number;
  squadSize: number;
  /** Home-country holding, held at arm's length (v1.64). */
  ringFenced: boolean;
  /** Seasons left on the minimum hold before the club may be sold, 0 when free. */
  seasonsHeld: number;
}

export interface GcnOverview {
  clubCount: number;
  treasury: number;
  totalClubBudgets: number;
  totalPlayers: number;
  /** Owned-club slots the Group Clubs track currently allows (v1.62). */
  clubCap: number;
  clubs: GcnClubSummary[];
}

/** Aggregate the network's state for the Headquarters tab. */
export function gcnOverview(state: GameState, cfg: TuningConfig): GcnOverview {
  const gcn = state.gcn;
  const clubs: GcnClubSummary[] = (gcn?.clubIds ?? [])
    .map((id) => state.teams[id])
    .filter(Boolean)
    .map((t) => ({
      clubId: t.id,
      name: t.name,
      leagueId: t.leagueId,
      leagueName: state.leagues[t.leagueId]?.name ?? t.leagueId,
      country: state.leagues[t.leagueId]?.country ?? "",
      reputation: t.reputation,
      budget: t.budget,
      squadSize: t.playerIds.length,
      ringFenced: !!t.gcnRingFenced,
      seasonsHeld: seasonsUntilSellable(state, t.id, cfg),
    }));
  return {
    clubCount: clubs.length,
    treasury: gcn?.treasury ?? 0,
    totalClubBudgets: clubs.reduce((s, c) => s + c.budget, 0),
    totalPlayers: clubs.reduce((s, c) => s + c.squadSize, 0),
    clubCap: groupClubsCap(state, cfg),
    clubs,
  };
}

// ── State of the empire (v1.88) ──────────────────────────────────────────────
// The Headquarters tab counted clubs, players and cash — four totals that say
// how BIG the network is and nothing about how it is DOING. An empire is a thing
// you run, so the page needs the numbers you'd actually run it on: is it solvent
// week to week, which clubs are in trouble, how many countries does it span, and
// is it winning anything. All derived here, from the same functions the engine
// uses, so the screen stays a renderer.

/** One club flagged as needing the manager's attention, with the reason. */
export interface GcnAlert {
  clubId: string;
  name: string;
  /** "insolvent" — losing money with under a season of cover left.
   *  "thin" — squad at or near the floor below which nothing can be sold.
   *  "sliding" — bottom quarter of its league table. */
  kind: "insolvent" | "thin" | "sliding";
  detail: string;
}

export interface GcnEmpire {
  /** Countries the network has a club in — the empire's reach. */
  countries: string[];
  /** Every owned club's weekly net, summed. The single number that says whether
   * the empire pays for itself. */
  clubsNet: number;
  /** Brand Deals in, standing orders out — the treasury's own weekly balance. */
  treasuryNet: number;
  /** Combined weekly net of the whole operation: clubs plus treasury. */
  totalNet: number;
  /** Squad value across every owned club — what the empire owns in players. */
  squadValue: number;
  /** Mean overall across every owned squad, 0 when the network holds nobody. */
  avgOverall: number;
  /** Owned clubs currently top of their league. */
  leadingLeagues: number;
  /** Clubs that need attention, worst first. */
  alerts: GcnAlert[];
}

export function gcnEmpire(state: GameState, cfg: TuningConfig): GcnEmpire {
  const ids = state.gcn?.clubIds ?? [];
  const countries = new Set<string>();
  let clubsNet = 0;
  let squadValue = 0;
  let overallSum = 0;
  let playerCount = 0;
  let leadingLeagues = 0;
  const alerts: GcnAlert[] = [];

  for (const id of ids) {
    const club = state.teams[id];
    if (!club) continue;
    const country = state.leagues[club.leagueId]?.country;
    if (country) countries.add(country);

    const fin = gcnClubFinance(state, id, cfg);
    if (fin) {
      clubsNet += fin.net;
      // Under a season of cover on a losing club is the point at which the
      // manager can still do something about it — which is what an alert is for.
      if (fin.weeksOfCover !== null && fin.weeksOfCover < 38) {
        alerts.push({
          clubId: id,
          name: club.name,
          kind: "insolvent",
          detail: `losing money — about ${fin.weeksOfCover} ${fin.weeksOfCover === 1 ? "week" : "weeks"} of cover left`,
        });
      }
    }

    for (const pid of club.playerIds) {
      const p = state.players[pid];
      if (!p) continue;
      squadValue += playerValue(p, cfg);
      overallSum += p.overall;
      playerCount++;
    }

    // A squad at the sale floor can't be traded out of trouble at all.
    if (club.playerIds.length <= cfg.gcnSellMinSquadSize + 2) {
      alerts.push({
        clubId: id,
        name: club.name,
        kind: "thin",
        detail: `${club.playerIds.length} players — at or near the ${cfg.gcnSellMinSquadSize}-player floor`,
      });
    }

    const standing = clubStanding(state, id);
    if (standing) {
      if (standing.pos === 1) leadingLeagues++;
      else if (standing.pos > standing.of * 0.75) {
        alerts.push({
          clubId: id,
          name: club.name,
          kind: "sliding",
          detail: `${standing.pos} of ${standing.of} in its league`,
        });
      }
    }
  }

  // The treasury's own week (v1.95): everything the network is committed to,
  // out. It must name the SAME four outflows `gcnWeeklyTick` debits or the
  // Headquarters dashboard reports a solvency the simulation doesn't honour —
  // which was the whole point of `gcnSimBooks` in v1.88, one function behind
  // both the banking and the panel. Since v1.99 there is no inflow term: the
  // treasury is filled by deposits and by selling clubs, not by a weekly track.
  const treasuryNet =
    -totalAutoFunding(state) -
    execWageBill(state) -
    hubUpkeepWeekly(state, cfg) -
    hubWageBill(state, cfg);
  // Insolvency first: it's the only one of the three that ends with a club the
  // network can no longer run.
  const order: Record<GcnAlert["kind"], number> = { insolvent: 0, thin: 1, sliding: 2 };
  alerts.sort((a, b) => order[a.kind] - order[b.kind]);

  return {
    countries: [...countries].sort(),
    clubsNet,
    treasuryNet,
    totalNet: clubsNet + treasuryNet,
    squadValue,
    avgOverall: playerCount ? Math.round(overallSum / playerCount) : 0,
    leadingLeagues,
    alerts,
  };
}

/** A GCN club's current standing in its (sim) league: 1-based position and the
 * league size, read from the latest sim-league result table. Null if the league
 * hasn't been resolved yet this save. */
export function clubStanding(state: GameState, clubId: string): { pos: number; of: number } | null {
  const club = state.teams[clubId];
  if (!club) return null;
  const result = state.simResults.find((r) => r.leagueId === club.leagueId);
  if (!result) return null;
  const idx = result.table.findIndex((row) => row.teamId === clubId);
  if (idx < 0) return null;
  return { pos: idx + 1, of: result.table.length };
}

/** An owned club's weekly finances (v1.62), for the Clubs → Finance panel. The
 * arithmetic is the economy module's — this only names the parts the network
 * cares about, so the panel never does sums of its own. */
export interface GcnClubFinance {
  budget: number;
  income: number;
  expenses: number;
  net: number;
  wageBill: number;
  staffWages: number;
  tvIncome: number;
  positionBonus: number;
  gateIncome: number;
  facilityIncome: number;
  sponsorIncome: number;
  /** The central solidarity payment (v1.64), non-zero only for a ring-fenced
   * club — the rest of the network is funded by the treasury instead. */
  solidarityIncome: number;
  /** What the network sends this club each week — the GCN Deals track plus any
   * standing order. Always 0 for a ring-fenced club. */
  networkIncome: number;
  /** False when the club sits in a sim league, whose weekly books are
   * ABSTRACTED rather than itemised (v1.64; they are banked as of v1.88). The
   * panel says so, because the club's income arrives as one figure rather than
   * the five lines a playable-league club can show its working for. */
  banksOwnBooks: boolean;
  /** The abstracted trading income of a sim-league club (v1.88), 0 elsewhere.
   * Stands in for the tv/gate/commercial lines it can't itemise. */
  simTradingIncome: number;
  /** Weeks of the current shortfall the budget covers, or null when the club is
   * running at a profit (nothing to survive). */
  weeksOfCover: number | null;
}

export function gcnClubFinance(state: GameState, clubId: string, cfg: TuningConfig): GcnClubFinance | null {
  const club = state.teams[clubId];
  if (!club) return null;
  const w = weeklyBreakdown(state, clubId, cfg);
  // What the network itself sends this club each week: since v1.99, a standing
  // order and nothing else — the GCN Deals track that used to top every owned
  // club up automatically is gone. A ring-fenced club draws neither; it takes
  // the central solidarity payment instead, the same one every AI club gets.
  const fenced = !!club.gcnRingFenced;
  const networkIncome = fenced ? 0 : autoFundingOf(state, clubId);
  // A club in a PLAYABLE league itemises the ordinary weekly lines. A sim-league
  // club can't — it has no fixture table to rank for a position bonus and no
  // facilities to bill — so since v1.88 it books ONE abstracted trading figure
  // and a share of its wage bill instead. Both come from `gcnSimBooks`, the same
  // function the weekly tick banks, so this panel can never quote a number the
  // simulation won't move.
  const banksOwnBooks = state.leagues[club.leagueId]?.playable ?? false;
  const sim = gcnSimBooks(state, clubId, cfg);
  const ownIncome = banksOwnBooks
    ? w.tvIncome + w.positionBonus + w.gateIncome + w.facilityIncome + w.sponsorIncome
    : sim?.income ?? 0;
  const income = ownIncome + w.solidarityIncome + networkIncome;
  const expenses = banksOwnBooks
    ? w.wageBill + w.staffWages + w.academyUpkeep + w.academyWages
    : sim?.wages ?? 0;
  return {
    simTradingIncome: banksOwnBooks ? 0 : sim?.income ?? 0,
    budget: club.budget,
    income,
    expenses,
    net: income - expenses,
    // What the club is actually charged. A sim club pays the tuned share of its
    // squad bill (v1.88); a playable-league one pays all of it. Reporting the
    // gross figure where only a share is debited would break `weeksOfCover`,
    // which is the one number this panel exists to give.
    wageBill: banksOwnBooks ? w.wageBill : sim?.wages ?? 0,
    staffWages: banksOwnBooks ? w.staffWages : 0,
    tvIncome: banksOwnBooks ? w.tvIncome : 0,
    positionBonus: banksOwnBooks ? w.positionBonus : 0,
    gateIncome: banksOwnBooks ? w.gateIncome : 0,
    facilityIncome: banksOwnBooks ? w.facilityIncome : 0,
    sponsorIncome: banksOwnBooks ? w.sponsorIncome : 0,
    solidarityIncome: w.solidarityIncome,
    networkIncome,
    banksOwnBooks,
    weeksOfCover: income - expenses < 0 ? Math.floor(club.budget / (expenses - income)) : null,
  };
}

/** An owned club's sporting standing (v1.62), for the Clubs → Status panel:
 * where it sits in its league and the record behind that position. Null until
 * the sim league has been resolved at least once this save. */
export interface GcnClubStatus {
  pos: number;
  of: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  /** Points per game, 0 when nothing has been played yet. */
  ppg: number;
  leagueName: string;
  country: string;
  tier: number;
  reputation: number;
  squadSize: number;
  /** Mean overall across the senior squad, 0 for an empty squad. */
  avgOverall: number;
}

export function gcnClubStatus(state: GameState, clubId: string): GcnClubStatus | null {
  const club = state.teams[clubId];
  if (!club) return null;
  const league = state.leagues[club.leagueId];
  const squad = club.playerIds.map((id) => state.players[id]).filter(Boolean);
  // v1.90: the club's overall is its XI-and-bench rating, the same rule the team
  // card and the AI read (`squadOverall`). A flat squad mean made a club look
  // worse for carrying cover, which on this screen is advice to run a thin
  // roster — exactly backwards for a network club feeding players elsewhere.
  const avgOverall = squad.length
    ? squadOverall(squad, getFormation(club.tactic?.formationId ?? "433"), TUNING).overall
    : 0;
  const base = {
    leagueName: league?.name ?? club.leagueId,
    country: league?.country ?? "",
    tier: league?.tier ?? 0,
    reputation: club.reputation,
    squadSize: squad.length,
    avgOverall,
  };
  const result = state.simResults.find((r) => r.leagueId === club.leagueId);
  const idx = result ? result.table.findIndex((row) => row.teamId === clubId) : -1;
  if (!result || idx < 0) {
    // No table yet — the club's identity is still worth showing, with a blank record.
    return { ...base, pos: 0, of: league?.teamIds.length ?? 0, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, ppg: 0 };
  }
  const row = result.table[idx];
  return {
    ...base,
    pos: idx + 1,
    of: result.table.length,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    gf: row.gf,
    ga: row.ga,
    points: row.points,
    ppg: row.played > 0 ? row.points / row.played : 0,
  };
}


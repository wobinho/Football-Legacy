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
import type { TuningConfig } from "./config/tuning";
import { completeTransfer } from "./transfers";
import { weeklyBreakdown } from "./economy";
import { playerValue } from "./value";
import { clubBudget, defaultTactic, generateClubSquad, teamIdFor } from "./worldgen";
import { grantDefaultContract } from "./contracts";
import { assignKitNumber } from "./kitnumbers";

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
  };
  state.gcn = gcn;
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

/** True if a club can be brought into the network — an AI club in a sim league,
 * not the manager's own club, not already owned. */
export function isBuyableClub(state: GameState, clubId: string): boolean {
  const club = state.teams[clubId];
  if (!club || clubId === state.userTeamId || club.gcnOwned) return false;
  const league = state.leagues[club.leagueId];
  return !!league && !league.playable;
}

/** Buy an existing club into the network, paid from the treasury. Returns an
 * error string on failure. */
export function buyClub(state: GameState, clubId: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!isBuyableClub(state, clubId)) return "That club can't be brought into the network.";
  if (atGroupClubsCap(state, cfg))
    return `The network is at its ${groupClubsCap(state, cfg)}-club limit — upgrade Group Clubs in Operations.`;
  const price = clubBuyPrice(state, clubId, cfg);
  if (price > gcn.treasury) return "The GCN treasury can't afford that club.";
  gcn.treasury -= price;
  state.teams[clubId].gcnOwned = true;
  gcn.clubIds.push(clubId);
}

// ── Selling clubs ────────────────────────────────────────────────────────────

/** What the network is offered for an owned club (v1.63): what it would cost to
 * buy that club today, less the resale haircut. Valuing it live means a club the
 * network built up sells for more than it was bought for. */
export function clubSalePrice(state: GameState, clubId: string, cfg: TuningConfig): number {
  return Math.round(clubBuyPrice(state, clubId, cfg) * cfg.gcnSellClubPriceFactor);
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
  const price = clubSalePrice(state, clubId, cfg);
  gcn.treasury += price;
  gcn.clubIds = gcn.clubIds.filter((id) => id !== clubId);
  delete club.gcnOwned;
  // A club that's left the network can't keep drawing its standing order.
  if (gcn.autoFunding) delete gcn.autoFunding[clubId];
  // Any player the network had out on a feeder loan there loses his guaranteed
  // destination — recall him rather than leave him at a club we no longer own.
  for (const p of Object.values(state.players)) {
    if (p.loan?.toClubId === clubId) p.loan = undefined;
  }
}

// ── Automated funding (v1.63) ────────────────────────────────────────────────

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
  return gcn.clubIds.reduce((sum, id) => sum + autoFundingOf(state, id), 0);
}

// ── Weekly network tick ──────────────────────────────────────────────────────

/** The Monday pass over the network (v1.63), run alongside weeklyEconomyTick:
 *  1. Brand Deals pay the treasury.
 *  2. GCN Deals pay every owned club's own budget.
 *  3. Standing auto-funding orders move treasury → club budgets, in club order,
 *     each paid in full or skipped when the treasury can't cover it.
 * Owned clubs sit in sim leagues, which weeklyEconomyTick doesn't touch, so this
 * is the only weekly money they see. */
export function gcnWeeklyTick(state: GameState, cfg: TuningConfig) {
  const gcn = state.gcn;
  if (!gcn) return;

  gcn.treasury += brandDealsWeekly(state, cfg);

  const perClub = gcnDealsWeekly(state, cfg);
  for (const id of gcn.clubIds) {
    const club = state.teams[id];
    if (club) club.budget += perClub;
  }

  for (const id of gcn.clubIds) {
    const amount = autoFundingOf(state, id);
    const club = state.teams[id];
    if (!amount || !club || amount > gcn.treasury) continue;
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
    staff: {},
    stadium: `${trimmed} Stadium`,
    academyPlayerIds: [],
    assignments: {},
    sponsors: [],
    sponsorOffers: [],
    gcnOwned: true,
  };
  state.teams[newId] = team;
  league.teamIds.push(newId);
  gcn.clubIds.push(newId);

  // Contracts + kit numbers for the fresh squad (worldgen does this at build
  // time; a mid-save club needs it done explicitly).
  for (const pid of playerIds) {
    const p = state.players[pid];
    if (!p.contract) grantDefaultContract(state, p, cfg);
    assignKitNumber(state, p);
  }
}

// ── Moving players within the network ────────────────────────────────────────

/** Clubs the network can move a player between: the manager's own club plus
 * every owned club. */
export function networkClubIds(state: GameState): string[] {
  const gcn = state.gcn;
  if (!gcn) return [state.userTeamId];
  return [state.userTeamId, ...gcn.clubIds];
}

/** Permanently transfer a player between two network clubs, free of charge (both
 * clubs are the manager's, so no money leaves the empire). Either end may be the
 * manager's own club — pulling a player up from an owned club into the main
 * squad is as valid as pushing one down (v1.62). Returns an error string on
 * failure. */
export function moveWithinNetwork(state: GameState, playerId: string, toClubId: string): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const p = state.players[playerId];
  if (!p) return "Unknown player.";
  const network = new Set(networkClubIds(state));
  if (!p.clubId || !network.has(p.clubId)) return "That player isn't at a network club.";
  if (!network.has(toClubId)) return "The destination isn't a network club.";
  if (p.clubId === toClubId) return "The player is already there.";
  completeTransfer(state, playerId, toClubId, 0);
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
  p.loan = {
    toClubId,
    startDay: state.currentDay,
    // A feeder loan to an owned sim club uses the sim-destination weight; the
    // guaranteed-minutes uplift is applied in weeklyLoanTick, not here.
    minutesWeight: cfg.loanMinutesWeightSim,
    role,
  };
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
  brandDeals: {
    costKey: "gcnBrandDealsUpgradeCost",
    maxKey: "gcnBrandDealsMaxLevel",
    label: "Brand Deals",
    blurb: "Global sponsorship sold in the network's name. Pays the GCN treasury every week.",
  },
  gcnDeals: {
    costKey: "gcnDealsUpgradeCost",
    maxKey: "gcnDealsMaxLevel",
    label: "GCN Deals",
    blurb: "Commercial deals struck for the group's clubs. Pays every owned club's own budget every week.",
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

/** A weekly-income track's payout at a given level (v1.63): nothing at level 0,
 * the base at level 1, then the step for each level above. Shared by Brand Deals
 * and GCN Deals so the two read the same and neither hard-codes its curve. */
function weeklyTrackAt(level: number, base: number, perLevel: number): number {
  return level <= 0 ? 0 : base + (level - 1) * perLevel;
}

/** What Brand Deals pays the treasury each week at the current level. */
export function brandDealsWeekly(state: GameState, cfg: TuningConfig, level?: number): number {
  return weeklyTrackAt(
    level ?? gcnLevelOf(state, "brandDeals"),
    cfg.gcnBrandDealsBase,
    cfg.gcnBrandDealsPerLevel
  );
}

/** What GCN Deals pays *each* owned club each week at the current level. */
export function gcnDealsWeekly(state: GameState, cfg: TuningConfig, level?: number): number {
  return weeklyTrackAt(
    level ?? gcnLevelOf(state, "gcnDeals"),
    cfg.gcnDealsBase,
    cfg.gcnDealsPerLevel
  );
}

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
  /** Weeks of the current shortfall the budget covers, or null when the club is
   * running at a profit (nothing to survive). */
  weeksOfCover: number | null;
}

export function gcnClubFinance(state: GameState, clubId: string, cfg: TuningConfig): GcnClubFinance | null {
  const club = state.teams[clubId];
  if (!club) return null;
  const w = weeklyBreakdown(state, clubId, cfg);
  const income = w.tvIncome + w.positionBonus + w.gateIncome + w.facilityIncome + w.sponsorIncome;
  const expenses = w.wageBill + w.staffWages + w.academyUpkeep + w.academyWages;
  return {
    budget: club.budget,
    income,
    expenses,
    net: w.net,
    wageBill: w.wageBill,
    staffWages: w.staffWages,
    tvIncome: w.tvIncome,
    positionBonus: w.positionBonus,
    gateIncome: w.gateIncome,
    facilityIncome: w.facilityIncome,
    sponsorIncome: w.sponsorIncome,
    weeksOfCover: w.net < 0 ? Math.floor(club.budget / -w.net) : null,
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
  const avgOverall = squad.length
    ? Math.round(squad.reduce((s, p) => s + p.overall, 0) / squad.length)
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


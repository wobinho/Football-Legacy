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
  const price = clubBuyPrice(state, clubId, cfg);
  if (price > gcn.treasury) return "The GCN treasury can't afford that club.";
  gcn.treasury -= price;
  state.teams[clubId].gcnOwned = true;
  gcn.clubIds.push(clubId);
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
 * clubs are the manager's, so no money leaves the empire). Returns an error
 * string on failure. */
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
  financing: {
    costKey: "gcnFinancingUpgradeCost",
    maxKey: "gcnFinancingMaxLevel",
    label: "Financing",
    blurb: "Weekly income paid straight into the GCN treasury.",
  },
  development: {
    costKey: "gcnDevelopmentUpgradeCost",
    maxKey: "gcnDevelopmentMaxLevel",
    label: "Player Development",
    blurb: "Network-wide boost to how fast owned clubs' players grow.",
  },
  scouting: {
    costKey: "gcnScoutingUpgradeCost",
    maxKey: "gcnScoutingMaxLevel",
    label: "Scouting",
    blurb: "Widens the network's scouting reach across its clubs.",
  },
  logistics: {
    costKey: "gcnLogisticsUpgradeCost",
    maxKey: "gcnLogisticsMaxLevel",
    label: "Logistics",
    blurb: "Smooths player movement and admin between owned clubs.",
  },
};

export function gcnLevelOf(state: GameState, facility: GcnFacility): number {
  return state.gcn?.ops[facility] ?? 0;
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
  weeklyFinancingIncome: number;
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
    weeklyFinancingIncome: gcnLevelOf(state, "financing") * cfg.gcnFinancingPerLevel,
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

/** Weekly treasury income from the Financing track. Called from the economy
 * tick so an unlocked network's Financing upgrades actually pay out. */
export function gcnWeeklyTreasuryTick(state: GameState, cfg: TuningConfig): void {
  const gcn = state.gcn;
  if (!gcn) return;
  gcn.treasury += gcnLevelOf(state, "financing") * cfg.gcnFinancingPerLevel;
}

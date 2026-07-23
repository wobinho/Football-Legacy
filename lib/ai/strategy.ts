// ── Club AI strategy (§10) ────────────────────────────────────────────────
// Each AI club carries a *stance* — a season-scale intent recomputed when a
// transfer window opens, from how the club is actually doing against what its
// reputation implies it should be doing. The stance then drives every market
// decision that module makes: who it hunts, what it will pay, who it will let
// go and at what discount.
//
// Nothing here special-cases a club, archetype or trait by name — stances are a
// table (STANCE_PROFILE) and every number lives in tuning.

import type { GameState, PlayerBio, Pos, Team, ClubStance } from "../types";
import type { TuningConfig } from "../config/tuning";
import { computeTable } from "../season";
import { FORMATIONS } from "../config/formations";
import { positionFit } from "../config/positions";

/** Per-stance behaviour table. The engine only ever reads these fields — adding
 * a stance means adding a row here, never a branch in the market code. */
export interface StanceProfile {
  /** Age band this stance shops in (inclusive). */
  targetAge: [number, number];
  /** Weight on a target's current ability vs. its potential headroom. */
  abilityWeight: number;
  potentialWeight: number;
  /** Multiplier on what the club will pay over a player's market value. */
  buyPremium: number;
  /** Multiplier on the price it asks for its own players (>1 = reluctant). */
  sellAsk: number;
  /** Age from which its own players become sale candidates. */
  sellFromAge: number;
  /** Will it sell a player who is currently in its best XI? */
  sellsStarters: boolean;
  /** Relative appetite for doing deals at all this window. */
  activity: number;
  /** Player-facing label (news, and any future UI). */
  label: string;
}

export const STANCE_PROFILE: Record<ClubStance, StanceProfile> = {
  // Met or beat a big expectation: buy finished players, pay over the odds,
  // keep everyone who matters.
  // v1.43: sellAsk values pulled down across the board so a fair bid lands near
  // a player's market value instead of several times over it.
  // v1.43+: activity raised across every stance and the target age bands widened
  // so the world does more business each window without losing each stance's
  // distinct character.
  title: {
    targetAge: [23, 31], abilityWeight: 1.0, potentialWeight: 0.2,
    buyPremium: 1.35, sellAsk: 1.3, sellFromAge: 32, sellsStarters: false,
    activity: 1.5, label: "Going for the title",
  },
  // Roughly where it should be: targeted upgrades, sensible money.
  compete: {
    targetAge: [21, 30], abilityWeight: 0.8, potentialWeight: 0.5,
    buyPremium: 1.12, sellAsk: 1.12, sellFromAge: 31, sellsStarters: false,
    activity: 1.35, label: "Strengthening the squad",
  },
  // Under where it should be, and the books are tight: trim, don't build — but
  // still willing to sell a fringe starter to fund the right upgrade.
  stabilise: {
    targetAge: [20, 29], abilityWeight: 0.6, potentialWeight: 0.55,
    buyPremium: 0.95, sellAsk: 1.0, sellFromAge: 29, sellsStarters: true,
    activity: 1.05, label: "Balancing the books",
  },
  // Badly under, ageing squad: cash in on anyone with resale value and buy
  // young. The most aggressive seller.
  rebuild: {
    targetAge: [17, 24], abilityWeight: 0.35, potentialWeight: 1.0,
    buyPremium: 1.0, sellAsk: 0.9, sellFromAge: 26, sellsStarters: true,
    activity: 1.4, label: "Rebuilding",
  },
};

/** A club's best XI by overall — used for "is this a starter" questions. */
function bestXIIds(state: GameState, team: Team): Set<string> {
  const squad = team.playerIds
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired)
    .sort((a, b) => b.overall - a.overall);
  return new Set(squad.slice(0, 11).map((p) => p.id));
}

/** Where the club sits in its league right now, 0 = top, 1 = bottom. Falls back
 * to the reputation ordering before enough matches have been played. */
function leaguePositionRatio(state: GameState, team: Team): number {
  const league = state.leagues[team.leagueId];
  if (!league || league.teamIds.length < 2) return 0.5;
  const table = computeTable(state.fixtures, league.id, league.teamIds);
  const played = table.reduce((n, r) => n + r.played, 0);
  const order =
    played >= league.teamIds.length // a round or so in — the table means something
      ? table.map((r) => r.teamId)
      : league.teamIds
          .map((id) => state.teams[id])
          .filter(Boolean)
          .sort((a, b) => b.reputation - a.reputation)
          .map((t) => t.id);
  const idx = order.indexOf(team.id);
  if (idx < 0) return 0.5;
  return idx / Math.max(1, order.length - 1);
}

/** Where the club's *reputation* says it should sit, 0 = top, 1 = bottom. */
function expectedPositionRatio(state: GameState, team: Team): number {
  const league = state.leagues[team.leagueId];
  if (!league || league.teamIds.length < 2) return 0.5;
  const byRep = league.teamIds
    .map((id) => state.teams[id])
    .filter(Boolean)
    .sort((a, b) => b.reputation - a.reputation)
    .map((t) => t.id);
  const idx = byRep.indexOf(team.id);
  if (idx < 0) return 0.5;
  return idx / Math.max(1, byRep.length - 1);
}

/**
 * Decide a club's stance for the window that is opening. Reads three signals:
 *  - performance: league position against the reputation-implied expectation
 *  - finances: budget measured against the squad's own wage bill
 *  - age: how much of the squad is past its peak
 */
export function evaluateStance(state: GameState, team: Team, cfg: TuningConfig): ClubStance {
  const actual = leaguePositionRatio(state, team);
  const expected = expectedPositionRatio(state, team);
  // Positive = doing better than reputation implies.
  const overperformance = expected - actual;

  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  const avgAge = squad.length ? squad.reduce((n, p) => n + p.age, 0) / squad.length : 26;
  const ageing = avgAge >= cfg.aiAgeingSquadAge;

  // Financial health is measured against what the squad itself is worth, not the
  // wage bill — wages are a small number next to fees in this economy, so a
  // wage-based test would never fire. A club with less than a fraction of its
  // own squad value in the bank has no room to buy.
  const squadValue = squad.reduce((n, p) => n + p.value, 0);
  const skint = team.budget < squadValue * cfg.aiHealthyBudgetRatio;

  // A club already expected to finish last can't "underperform" against its
  // reputation, so weakness is also judged absolutely: propping up the table
  // counts as failing regardless of what was expected.
  const struggling = actual >= cfg.aiStrugglingRatio;

  // Top of its league and meeting the billing → go and win it.
  if (actual <= cfg.aiTitleContenderRatio && overperformance >= -cfg.aiStanceTolerance && !skint) {
    return "title";
  }
  // Well below where it should be, or simply bottom of the table. An ageing
  // squad or empty coffers means tearing it up; otherwise steady the ship.
  if (overperformance <= -cfg.aiUnderperformBand || struggling) {
    return ageing || skint ? "rebuild" : "stabilise";
  }
  // Roughly on target, but the squad is old and the money is gone anyway.
  if (ageing && skint) return "rebuild";
  if (skint) return "stabilise";
  return "compete";
}

/** Recompute every AI club's stance. Called when a transfer window opens, so a
 * stance is fixed for the duration of that window's business. Covers sim
 * (non-playable) clubs too (v1.44) — they now do their own window business, so
 * they need a stance to drive it just like their playable peers. */
export function refreshClubStances(state: GameState, cfg: TuningConfig) {
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    team.stance = evaluateStance(state, team, cfg);
    team.stanceSeason = state.season;
  }
}

/** Stance for any club, deriving one on demand for saves/clubs that predate the
 * field so callers never have to null-check. */
export function stanceOf(state: GameState, team: Team, cfg: TuningConfig): ClubStance {
  return (team.stance ??= evaluateStance(state, team, cfg));
}

// ── Squad needs ───────────────────────────────────────────────────────────

export interface PositionNeed {
  pos: Pos;
  /** Best ability the club can field there right now. */
  incumbent: number;
  /** How many bodies can cover it. */
  depth: number;
  /** Higher = more urgent. */
  urgency: number;
}

/** Every slot the club's chosen formation asks it to fill. */
function requiredSlots(team: Team): Pos[] {
  const formation = FORMATIONS.find((f) => f.id === team.tactic?.formationId) ?? FORMATIONS[0];
  return formation.slots.map((s) => s.pos);
}

/** How well a player covers a slot, ability scaled by positional fit. */
export function effectiveAt(p: PlayerBio, pos: Pos, cfg: TuningConfig): number {
  return p.overall * positionFit(p.positions, pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
}

/**
 * Rank the club's positions by how badly it needs a player there. A position is
 * needy when the best available body is weak relative to the rest of the squad,
 * or when nobody real can cover it at all.
 */
export function squadNeeds(state: GameState, team: Team, cfg: TuningConfig): PositionNeed[] {
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  if (!squad.length) return [];
  // The club's own standard — what a typical starter for them looks like.
  const benchmark =
    [...squad].sort((a, b) => b.overall - a.overall).slice(0, 11).reduce((n, p) => n + p.overall, 0) /
    Math.min(11, squad.length);

  const needs: PositionNeed[] = [];
  const counted = new Map<Pos, number>();
  for (const pos of requiredSlots(team)) counted.set(pos, (counted.get(pos) ?? 0) + 1);

  for (const [pos, slotsNeeded] of counted) {
    const ranked = squad
      .map((p) => effectiveAt(p, pos, cfg))
      .sort((a, b) => b - a);
    // Genuine cover = someone who plays there or adjacent, not a filler.
    const depth = squad.filter(
      (p) => positionFit(p.positions, pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor) >= cfg.adjacentPositionMult
    ).length;
    // Compare the weakest player this formation would be forced to start there
    // against the club's own standard.
    const incumbent = ranked[slotsNeeded - 1] ?? 0;
    const shortfall = benchmark - incumbent;
    const thin = Math.max(0, slotsNeeded + 1 - depth); // want one spare per slot
    needs.push({
      pos,
      incumbent: ranked[0] ?? 0,
      depth,
      urgency: shortfall + thin * cfg.aiDepthUrgencyWeight,
    });
  }
  return needs.sort((a, b) => b.urgency - a.urgency);
}

/**
 * Score a potential signing for a club: does this player actually improve them,
 * in a way that fits the stance? Returns 0 for "no reason to sign him".
 */
export function targetScore(
  state: GameState,
  team: Team,
  need: PositionNeed,
  p: PlayerBio,
  cfg: TuningConfig
): number {
  const profile = STANCE_PROFILE[stanceOf(state, team, cfg)];
  const [minAge, maxAge] = profile.targetAge;
  // Outside the stance's age band, interest falls away sharply.
  const ageMiss = p.age < minAge ? minAge - p.age : p.age > maxAge ? p.age - maxAge : 0;
  const ageFit = Math.pow(cfg.aiAgeBandFalloff, ageMiss);

  const ability = effectiveAt(p, need.pos, cfg);
  const headroom = Math.max(0, p.potential - p.overall);

  // The whole point: he has to be better than what's already there — either now
  // (ability) or later (potential), weighted by stance.
  const nowGain = ability - need.incumbent;
  const laterGain = p.potential * positionFit(p.positions, need.pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor) - need.incumbent;
  const gain = profile.abilityWeight * nowGain + profile.potentialWeight * Math.max(0, laterGain) * (headroom > 0 ? 1 : 0);
  if (gain <= cfg.aiMinUpgradeGain) return 0;

  return gain * ageFit * (1 + need.urgency * cfg.aiNeedScoreWeight);
}

/**
 * Players this club is willing to move on, worst-fit first. Driven entirely by
 * stance: a rebuilding club cashes in on its thirty-somethings and will even
 * sell a star, a title-chasing one only clears deadwood.
 */
export function saleCandidates(state: GameState, team: Team, cfg: TuningConfig): PlayerBio[] {
  const profile = STANCE_PROFILE[stanceOf(state, team, cfg)];
  const starters = bestXIIds(state, team);
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  const needs = squadNeeds(state, team, cfg);
  const needyPositions = new Set(needs.slice(0, 2).map((n) => n.pos));

  return squad
    .filter((p) => {
      if (starters.has(p.id) && !profile.sellsStarters) return false;
      // Never strip a position the club is already short in.
      if (p.positions.some((pos) => needyPositions.has(pos)) && !profile.sellsStarters) return false;
      // Old enough to be moved on, or simply surplus to requirements.
      const old = p.age >= profile.sellFromAge;
      const surplus = !starters.has(p.id);
      return old || surplus;
    })
    // Sell the oldest and least useful first.
    .sort((a, b) => b.age - a.age || a.overall - b.overall);
}

/** What this club will pay for a given player, given its stance and means. */
export function buyBudgetFor(state: GameState, team: Team, p: PlayerBio, cfg: TuningConfig): number {
  const profile = STANCE_PROFILE[stanceOf(state, team, cfg)];
  const willing = p.value * profile.buyPremium;
  // Never commit more than a share of the war chest to one player, and never
  // spend down to nothing — a reserve is always held back (v19).
  const spendable = spendableBudget(state, team, cfg);
  return Math.min(willing, spendable * cfg.aiMaxBudgetSharePerDeal);
}

// ── Club finances (v19) ───────────────────────────────────────────────────
// AI clubs used to buy against their raw budget number, which let a club spend
// itself to zero and left the market untethered from the economy. These helpers
// make a club's means the real constraint: it keeps a cash reserve, it must be
// able to cover its wage bill, and it banks what it earns from selling.

/** This club's weekly wage bill. */
export function wageBill(state: GameState, team: Team): number {
  return team.playerIds
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired)
    .reduce((n, p) => n + (p.contract?.wage ?? 0), 0);
}

/**
 * The part of a club's budget it is actually willing to spend. A club always
 * holds back a reserve (`aiBudgetReserveRatio`) plus enough cash to cover the
 * wage bill for `aiWageReserveWeeks` — so a signing can never leave it unable
 * to pay the players it already has.
 */
export function spendableBudget(state: GameState, team: Team, cfg: TuningConfig): number {
  const reserve = team.budget * cfg.aiBudgetReserveRatio;
  const wageCushion = wageBill(state, team) * cfg.aiWageReserveWeeks;
  return Math.max(0, team.budget - reserve - wageCushion);
}

/** A club below its wage cushion is in trouble and must raise cash: it sells at
 * a discount and won't buy at all until the books are back in order. */
export function isDistressed(state: GameState, team: Team, cfg: TuningConfig): boolean {
  return team.budget < wageBill(state, team) * cfg.aiWageReserveWeeks;
}

/**
 * Can this club afford to add a player at `fee` on `wage` a week? Both halves
 * matter — a free transfer on wages the club can't service is just as ruinous
 * as an unaffordable fee, and this is what stops AI squads inflating without
 * limit (v19).
 */
export function canAfford(
  state: GameState,
  team: Team,
  fee: number,
  weeklyWage: number,
  cfg: TuningConfig
): boolean {
  if (isDistressed(state, team, cfg)) return false;
  if (fee > spendableBudget(state, team, cfg)) return false;
  // Wage discipline: the bill after signing must stay within a share of income.
  const income = weeklyIncomeEstimate(state, team, cfg);
  const billAfter = wageBill(state, team) + weeklyWage;
  return billAfter <= income * cfg.aiMaxWageToIncomeRatio;
}

/**
 * A club's weekly income, for wage-affordability tests. Deliberately a light
 * estimate rather than a call into the economy module: it needs only the stable
 *, recurring lines (broadcast, gate, commercial), and keeping it here avoids a
 * circular import between the AI and economy layers.
 */
export function weeklyIncomeEstimate(state: GameState, team: Team, cfg: TuningConfig): number {
  const league = state.leagues[team.leagueId];
  const tv = cfg.weeklyIncomeByTier[(league?.tier ?? 2) - 1] ?? cfg.weeklyIncomeByTier[cfg.weeklyIncomeByTier.length - 1] ?? 0;
  const gate = team.reputation * cfg.gateIncomePerReputation;
  const commercial = team.commercialIncome ?? 0;
  const base = tv + gate + commercial;

  // Squad-quality scaling (v1.51). The wage curve is EXPONENTIAL in overall while
  // the tier income above is a flat constant, so a database with better players
  // than the built-in one inflates every wage bill without moving income at all.
  // Whole divisions then sat permanently over `aiMaxWageToIncomeRatio`, which made
  // `canAfford` reject every signing and froze the transfer market — the "I changed
  // the database and the AI stopped doing transfers" bug.
  //
  // Income therefore scales with the standard of football the club actually plays,
  // using the SAME exponent as the wage curve so the two move together and the
  // ratio is database-independent. Clamped so a modded outlier can't run away.
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  if (!squad.length) return base;
  const avgOverall = squad.reduce((n, p) => n + p.overall, 0) / squad.length;
  const gap = avgOverall - cfg.wageIncomeBaselineOverall;
  const mult = Math.max(
    cfg.wageIncomeQualityMultMin,
    Math.min(cfg.wageIncomeQualityMultMax, Math.exp(gap * cfg.wagePerOverallCurve.exponent))
  );
  return base * mult;
}

// Economy (§8): one budget number per club, updated weekly.
// income (division + league position + gate) − expenses (wages + staff).

import type { GameState, PlayerBio, Team } from "./types";
import type { TuningConfig } from "./config/tuning";
import { computeTable } from "./season";
import { squadWageBill, playerValue, playerWage } from "./value";
import { leagueWageMult } from "./contracts";
import {
  academySquadSize,
  facilityLevel,
  growthMultiplier,
  prospectValueMultiplier,
  staffWageBill,
  rosterOf,
  badgeWeightAt,
} from "./facilities";
import { FACILITY_MAP } from "./config/facilities";
import { sponsorWeeklyIncome } from "./sponsors";

export interface WeeklyBreakdown {
  tvIncome: number;
  positionBonus: number;
  gateIncome: number;
  /** Weekly income from the club's income upgrades (v43): the three flat tiers
   * plus the squad-driven player bonus. The match-day bonuses are banked per
   * fixture instead, so they never appear on the weekly line. */
  facilityIncome: number;
  sponsorIncome: number; // season-long sponsorship deals (v6, user club only)
  /** Everything a club pays for that isn't a wage (v1.67) — the ground, the staff
   * below the first team, travel, insurance. AI clubs only: the user's equivalent
   * costs are the facility upkeep and staff wages they choose to take on. */
  operatingCost: number;
  /** Central solidarity payment (v1.64) — the flat weekly top-up every club
   * outside the manager's control receives. Always 0 for the user's own club. */
  solidarityIncome: number;
  /** Wages actually paid — the squad bill after the Contract Accounting
   * discount (v43). `wageDiscount` is what that upgrade saved this week. */
  wageBill: number;
  wageDiscount: number;
  staffWages: number;
  academyUpkeep: number; // §18 — facility running cost
  academyWages: number; // §18 (v25) — the youth scholarship wage bill
  net: number;
}

/** A single academy prospect's weekly scholarship wage (v25). Scaled linearly
 * from `academyWageMin` at `academyWageOverallLo` to `academyWageMax` at
 * `academyWageOverallHi`, clamped to the band so it always sits in ~£1–5k. */
export function academyWageFor(overall: number, cfg: TuningConfig): number {
  const { academyWageMin: lo, academyWageMax: hi, academyWageOverallLo: oLo, academyWageOverallHi: oHi } = cfg;
  const t = Math.max(0, Math.min(1, (overall - oLo) / Math.max(1, oHi - oLo)));
  return Math.round((lo + (hi - lo) * t) / 100) * 100;
}

/** The user club's total weekly academy wage bill (v25) — the sum of every
 * prospect's youth scholarship. Only the user runs a visible academy, so AI
 * clubs return 0. */
export function academyWageBill(state: GameState, teamId: string, cfg: TuningConfig): number {
  const team = state.teams[teamId];
  return (team.academyPlayerIds ?? [])
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired)
    .reduce((n, p) => n + academyWageFor(p.overall, cfg), 0);
}

/** Weekly income from a club's income upgrades (v43) — the three flat tiers plus
 * the squad-driven player bonus. The wage discount is an expense reduction, not
 * income, so it lands on the wage line instead; the stadium and performance
 * bonuses are lump sums paid per fixture, not weekly. */
export function facilityIncome(state: GameState, teamId: string, cfg: TuningConfig): number {
  return (
    upgradePayout(state, teamId, "lowTier", cfg) +
    upgradePayout(state, teamId, "midTier", cfg) +
    upgradePayout(state, teamId, "highTier", cfg) +
    playerBonusIncome(state, teamId, cfg)
  );
}

/** Weekly income from the Player Bonus upgrade: a flat sum for every senior
 * squad member at or above the level's rating threshold (v43). */
export function playerBonusIncome(state: GameState, teamId: string, cfg: TuningConfig): number {
  const level = incomeUpgradeLevel(state, teamId, "playerBonus");
  if (level <= 0) return 0;
  const per = cfg.playerBonusPayout[level - 1] ?? 0;
  const threshold = cfg.playerBonusThreshold[level - 1] ?? Infinity;
  return per * qualifyingPlayerCount(state, teamId, threshold);
}

/** Senior squad members at or above `threshold` overall — what the Player Bonus
 * pays on. The academy roster is deliberately excluded: it sits outside the
 * senior squad everywhere else in the economy too. */
export function qualifyingPlayerCount(state: GameState, teamId: string, threshold: number): number {
  return state.teams[teamId].playerIds
    .map((id) => state.players[id])
    .filter((p) => p && p.overall >= threshold).length;
}

/** The fraction of the weekly wage bill the Contract Accounting upgrade writes
 * off (v43). 0 when unbought. */
export function wageDiscountRate(state: GameState, teamId: string, cfg: TuningConfig): number {
  const level = incomeUpgradeLevel(state, teamId, "contractAccounting");
  return level > 0 ? cfg.contractAccountingDiscount[level - 1] ?? 0 : 0;
}

/** True for every club the manager doesn't run himself and doesn't own through
 * the network (v1.64) — i.e. the ordinary AI world. These clubs carry wage bills
 * their tier income was never going to cover, so they draw two central subsidies
 * (a weekly solidarity payment and a start-of-season grant) that keep the world's
 * balance sheets solvent without handing the manager free money.
 *
 * A ring-fenced home-country GCN club counts as AI here: it takes no network
 * money, so it keeps the subsidy every other club in its league gets. */
export function drawsAiSubsidy(state: GameState, teamId: string): boolean {
  if (teamId === state.userTeamId) return false;
  const team = state.teams[teamId];
  if (!team) return false;
  return !team.gcnOwned || !!team.gcnRingFenced;
}

/**
 * Read a per-tier tuning array at a club's tier, CLAMPED to the array's range.
 *
 * Clamping (rather than a fixed fallback index) is the whole point: a pyramid
 * deeper than the array must pay its lowest division at the array's lowest rate.
 * The old code fell back to index 1 — the second tier's figure — so tiers 3 and 4
 * drew second-tier money while paying a fifth of second-tier wages.
 */
export function byTier(table: number[], tier: number): number {
  if (!table.length) return 0;
  return table[Math.max(0, Math.min(table.length - 1, Math.round(tier) - 1))];
}

export function weeklyBreakdown(state: GameState, teamId: string, cfg: TuningConfig): WeeklyBreakdown {
  const team = state.teams[teamId];
  const league = state.leagues[team.leagueId];
  const playable = league?.playable ?? false;

  // Every income line is read at the club's own tier (v1.67). `byTier` clamps to
  // the last entry rather than falling through to a fixed index, so a pyramid
  // deeper than the arrays pays its bottom division at the bottom rate — never at
  // a higher division's, which is the bug that made lower-league clubs rich.
  const tier = league?.tier ?? 2;
  const tvIncome = byTier(cfg.weeklyIncomeByTier, tier);
  let positionBonus = 0;
  if (playable) {
    const table = computeTable(state.fixtures, league.id, league.teamIds);
    const pos = table.findIndex((r) => r.teamId === teamId);
    if (pos >= 0) {
      positionBonus = Math.round(byTier(cfg.positionBonusMaxByTier, tier) * (1 - pos / Math.max(1, table.length - 1)));
    }
  }
  const gateIncome = Math.round(team.reputation * byTier(cfg.gateIncomePerReputationByTier, tier));
  const facilities = facilityIncome(state, teamId, cfg);
  // v19: AI clubs earn commercial money too — sponsorWeeklyIncome resolves to
  // their abstract portfolio figure. Their budgets have to be funded by
  // something legible if the market is to make sense.
  const sponsorIncome = sponsorWeeklyIncome(state, teamId);
  const players = team.playerIds.map((id) => state.players[id]).filter(Boolean);
  // Contract Accounting (v43) writes a percentage off the squad wage bill. It is
  // applied here rather than in `squadWageBill` so per-player wages — what a
  // contract says, what the market quotes — are untouched: the discount is the
  // club's accounting, not a pay cut.
  const grossWageBill = squadWageBill(players, cfg, leagueWageMult(state, team.leagueId, cfg));
  const wageDiscount = Math.round(grossWageBill * wageDiscountRate(state, teamId, cfg));
  const wageBill = grossWageBill - wageDiscount;
  const staffWages = teamId === state.userTeamId ? staffWageBill(state) : 0;
  // The Youth Academy building's running cost (v1.82 — was the old standalone
  // `academyLevel`). A club that hasn't built it pays nothing, which is right:
  // there is no building to run.
  const academyUpkeep = facilityLevel(team, "youthAcademy") * cfg.academyUpkeepPerLevel;
  // Youth scholarship wages (v25). Only the user runs a visible academy roster,
  // so AI clubs' academy wage bill is zero — their youth costs are abstracted.
  const academyWages = teamId === state.userTeamId ? academyWageBill(state, teamId, cfg) : 0;
  const solidarityIncome = drawsAiSubsidy(state, teamId) ? cfg.aiWeeklySubsidy : 0;
  // Non-wage running costs (v1.67). Charged to AI clubs only: the user pays their
  // own version of this explicitly through facility upkeep and the staff they
  // hire, and charging both would be double-counting.
  const operatingCost =
    teamId === state.userTeamId
      ? 0
      : Math.round(team.reputation * byTier(cfg.aiOperatingCostPerReputationByTier, tier));

  return {
    tvIncome,
    positionBonus,
    gateIncome,
    facilityIncome: facilities,
    sponsorIncome,
    solidarityIncome,
    operatingCost,
    wageBill,
    wageDiscount,
    staffWages,
    academyUpkeep,
    academyWages,
    net:
      tvIncome + positionBonus + gateIncome + facilities + sponsorIncome + solidarityIncome
      - wageBill - staffWages - academyUpkeep - academyWages - operatingCost,
  };
}

// ── Line-item detail (v21) ────────────────────────────────────────────────
// Every figure on the Finances page can show its working. The arithmetic lives
// here rather than in the React tree so the page only ever renders numbers the
// economy module already agrees with — the same rule the rest of lib/ follows.

/** One contributing row behind a headline figure. */
export interface BreakdownItem {
  label: string;
  /** Signed the same way as the parent line (income positive, cost negative). */
  amount: number;
  /** The sum's shape, where that's the clearer explanation ("12 × £4k"). */
  detail?: string;
}

/** The players behind the wage bill, dearest first. */
export function wageBillItems(state: GameState, teamId: string, cfg: TuningConfig): BreakdownItem[] {
  const team = state.teams[teamId];
  return team.playerIds
    .map((id) => state.players[id])
    .filter(Boolean)
    .map((p) => ({
      label: p.name,
      amount: -(p.contract?.wage ?? playerWage(p.overall, cfg, leagueWageMult(state, team.leagueId, cfg))),
      detail: p.contract
        ? `${p.positions[0]} · ${p.overall} ovr · through S${p.contract.expirySeason}`
        : `${p.positions[0]} · ${p.overall} ovr · no contract`,
    }))
    .sort((a, b) => a.amount - b.amount);
}

/** The prospects behind the academy wage bill, dearest first (v25). */
export function academyWageItems(state: GameState, teamId: string, cfg: TuningConfig): BreakdownItem[] {
  const team = state.teams[teamId];
  return (team.academyPlayerIds ?? [])
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired)
    .map((p) => ({
      label: p.name,
      amount: -academyWageFor(p.overall, cfg),
      detail: `${p.positions[0]} · ${p.overall} ovr · age ${p.age}`,
    }))
    .sort((a, b) => a.amount - b.amount);
}

/** Every wage `staffWageBill` sums: the backroom roster and the scout roster.
 * An unassigned staff member still appears — they are still being paid, and the
 * line should say so plainly rather than hide an avoidable cost. */
export function staffWageItems(state: GameState): BreakdownItem[] {
  const team = state.teams[state.userTeamId];
  const appointments: BreakdownItem[] = rosterOf(team).map((m) => {
    const where = m.assignedTo ? FACILITY_MAP[m.assignedTo]?.name ?? m.assignedTo : "Unassigned";
    const badge = m.assignedTo && badgeWeightAt(m, m.assignedTo) > 0
      ? ` · ${m.badges.find((b) => b.facility === m.assignedTo)?.tier} badge`
      : "";
    return { label: m.name, amount: -m.wage, detail: `${where} · ${m.stars}★${badge}` };
  });
  const scouts: BreakdownItem[] = (team.scouts ?? []).map((sc) => ({
    label: sc.name,
    amount: -sc.wage,
    detail: `Scout · ${sc.experience}★ exp · ${sc.judgement}★ judgement`,
  }));
  return [...appointments, ...scouts].sort((a, b) => a.amount - b.amount);
}

/** The upgrades behind the weekly upgrade-income line (v43). Only the tracks
 * that pay weekly money appear: the wage discount shows on the wage line, and
 * the two match bonuses aren't weekly income at all. */
export function facilityIncomeItems(state: GameState, teamId: string, cfg: TuningConfig): BreakdownItem[] {
  const weekly = ["lowTier", "midTier", "highTier", "playerBonus"] as const;
  const items: BreakdownItem[] = [];
  for (const key of weekly) {
    const level = incomeUpgradeLevel(state, teamId, key);
    if (level <= 0) continue;
    const amount =
      key === "playerBonus" ? playerBonusIncome(state, teamId, cfg) : upgradePayout(state, teamId, key, cfg);
    if (amount <= 0) continue;
    const detail =
      key === "playerBonus"
        ? `level ${level} · ${qualifyingPlayerCount(state, teamId, cfg.playerBonusThreshold[level - 1] ?? Infinity)} × ${describeIncomeLevel(key, level, cfg)}`
        : `level ${level} · ${describeIncomeLevel(key, level, cfg)}`;
    items.push({ label: FACILITY_TITLE[key], amount, detail });
  }
  return items.sort((a, b) => b.amount - a.amount);
}

/** The signed minor deals behind the sponsor income line. */
export function sponsorIncomeItems(state: GameState, teamId: string): BreakdownItem[] {
  const deals = state.teams[teamId].sponsors ?? [];
  return deals
    .filter((d) => d.kind === "minor" && d.weeklyAmount > 0)
    .map((d) => ({
      label: d.brand,
      amount: d.weeklyAmount,
      detail: `runs through S${d.expirySeason}`,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ── Club income upgrades (v43) ─────────────────────────────────────────────
// Seven tracks, replacing the ten flat revenue facilities. Everything about a
// track — where its level lives, which tuning arrays hold its costs and payouts,
// how a level reads on the page — comes from one table, so adding or repricing a
// track is a data change and never a new branch in the purchase path.

export type Facility =
  | "lowTier"
  | "midTier"
  | "highTier"
  | "playerBonus"
  | "contractAccounting"
  | "stadiumBonus"
  | "performanceBonus";

/** Every income-upgrade track, in the order the Income page lists them. */
export const FACILITY_KEYS: Facility[] = [
  "lowTier",
  "midTier",
  "highTier",
  "playerBonus",
  "contractAccounting",
  "stadiumBonus",
  "performanceBonus",
];

/**
 * How the Income page groups the seven tracks (v1.72).
 *
 * The page used to sort by "what can I afford next", which answered a shopping
 * question but hid the structure: the three tier tracks are one ladder, the three
 * bonuses pay on events, and Contract Accounting isn't income at all — it's a
 * deduction off the wage bill. Grouping is display-only data; nothing in the
 * purchase path reads it.
 */
export type IncomeUpgradeGroupId = "tiered" | "bonus" | "deduction";

export interface IncomeUpgradeGroup {
  id: IncomeUpgradeGroupId;
  title: string;
  /** One line under the heading explaining what the group pays. */
  blurb: string;
  keys: Facility[];
}

export const INCOME_UPGRADE_GROUPS: IncomeUpgradeGroup[] = [
  {
    id: "tiered",
    title: "Tiered Income",
    blurb: "The core weekly ladder — each tier pays a flat sum into the finances every week.",
    keys: ["lowTier", "midTier", "highTier"],
  },
  {
    id: "bonus",
    title: "Bonus Income",
    blurb: "Paid on events rather than on the clock: the squad you field, the results you get, the gates you draw.",
    keys: ["playerBonus", "performanceBonus", "stadiumBonus"],
  },
  {
    id: "deduction",
    title: "Cost Deduction",
    blurb: "Not income — a standing cut off what the club already spends.",
    keys: ["contractAccounting"],
  },
];

interface IncomeUpgradeSpec {
  levelKey: keyof Team;
  costKey: keyof TuningConfig;
  title: string;
  /** The one-line "what is this" the page shows next to the title. */
  tagline: string;
  blurb: string;
  /** How one level reads on its own, e.g. "+£30k/wk". Level is 1-based; the
   * caller never formats a payout itself, because only the spec knows whether a
   * track pays weekly, per match, or as a percentage. */
  describeLevel: (level: number, cfg: TuningConfig) => string;
}

const INCOME_UPGRADE_SPEC: Record<Facility, IncomeUpgradeSpec> = {
  lowTier: {
    levelKey: "lowTierIncomeLevel",
    costKey: "lowTierIncomeUpgradeCost",
    title: "Low Tier Income",
    tagline: "Low tier weekly income",
    blurb:
      "The everyday commercial base — local partners, the club shop, matchday concessions. Cheap to start and the first ladder a smaller club can climb.",
    describeLevel: (level, cfg) => `+${money(cfg.lowTierIncomePayout[level - 1] ?? 0)}/wk`,
  },
  midTier: {
    levelKey: "midTierIncomeLevel",
    costKey: "midTierIncomeUpgradeCost",
    title: "Mid Tier Income",
    tagline: "Mid tier weekly income",
    blurb:
      "National partnerships, hospitality and media work. Costs more per level than the low tier and pays more for it — the middle of the commercial ladder.",
    describeLevel: (level, cfg) => `+${money(cfg.midTierIncomePayout[level - 1] ?? 0)}/wk`,
  },
  highTier: {
    levelKey: "highTierIncomeLevel",
    costKey: "highTierIncomeUpgradeCost",
    title: "High Tier Income",
    tagline: "High tier weekly income",
    blurb:
      "Global brand deals and the commercial machine of an elite club. The most expensive track in the game, and the only one that reaches £1M a week.",
    describeLevel: (level, cfg) => `+${money(cfg.highTierIncomePayout[level - 1] ?? 0)}/wk`,
  },
  playerBonus: {
    levelKey: "playerBonusLevel",
    costKey: "playerBonusUpgradeCost",
    title: "Player Bonus",
    tagline: "Player-driven weekly income",
    blurb:
      "Image rights and shirt sales driven by the squad itself — the better your players, the more it pays. Each level pays more but demands a higher rating to qualify.",
    describeLevel: (level, cfg) =>
      `+${money(cfg.playerBonusPayout[level - 1] ?? 0)}/wk per ${cfg.playerBonusThreshold[level - 1] ?? 0}+ rated player`,
  },
  contractAccounting: {
    levelKey: "contractAccountingLevel",
    costKey: "contractAccountingUpgradeCost",
    title: "Contract Accounting",
    tagline: "Wage discount",
    blurb:
      "A sharper contracts department — structured deals and image-rights offsets shave a percentage off everything the squad is paid, every week.",
    describeLevel: (level, cfg) => `−${Math.round((cfg.contractAccountingDiscount[level - 1] ?? 0) * 100)}% wage bill`,
  },
  stadiumBonus: {
    levelKey: "stadiumBonusLevel",
    costKey: "stadiumBonusUpgradeCost",
    title: "Stadium Bonus",
    tagline: "Home game income",
    blurb:
      "Expand the ground and work the matchday. Pays a lump sum every time you play at home — league, cup and Europe alike.",
    describeLevel: (level, cfg) => `+${money(cfg.stadiumBonusPayout[level - 1] ?? 0)} per home game`,
  },
  performanceBonus: {
    levelKey: "performanceBonusLevel",
    costKey: "performanceBonusUpgradeCost",
    title: "Performance Bonus",
    tagline: "Performance-based income",
    blurb:
      "Results-linked commercial bonuses. Every match pays something, but a win pays five times what a defeat does — the reward for a squad that keeps winning.",
    describeLevel: (level, cfg) =>
      `+${money(cfg.performanceBonusWin[level - 1] ?? 0)}/win · +${money(
        cfg.performanceBonusDraw[level - 1] ?? 0
      )}/draw · +${money(cfg.performanceBonusLoss[level - 1] ?? 0)}/loss`,
  },
};

/** Compact money for the spec's own level descriptions ("£30k", "£1M"). Kept
 * local so lib/ stays free of the UI's formatter. */
function money(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${n}`;
}

/** Display name per income upgrade — so callers (the upgrade toast) can name the
 * thing that was bought without branching on the facility id. */
export const FACILITY_TITLE: Record<Facility, string> = Object.fromEntries(
  FACILITY_KEYS.map((k) => [k, INCOME_UPGRADE_SPEC[k].title])
) as Record<Facility, string>;

/** The page copy for one track: title, tagline and blurb. */
export function incomeUpgradeInfo(facility: Facility): { title: string; tagline: string; blurb: string } {
  const s = INCOME_UPGRADE_SPEC[facility];
  return { title: s.title, tagline: s.tagline, blurb: s.blurb };
}

/** How many levels a track has. Read from the cost array, so the table is the
 * only place a track's length is stated. */
export function incomeUpgradeMaxLevel(facility: Facility, cfg: TuningConfig): number {
  return (cfg[INCOME_UPGRADE_SPEC[facility].costKey] as number[]).length;
}

export function incomeUpgradeLevel(state: GameState, teamId: string, facility: Facility): number {
  return (state.teams[teamId][INCOME_UPGRADE_SPEC[facility].levelKey] as number | undefined) ?? 0;
}

/** The price of a given 1-based level of a track, whether or not it's been
 * bought — so the page can show the whole ladder, not just the next rung. */
export function incomeUpgradeCost(facility: Facility, level: number, cfg: TuningConfig): number {
  return (cfg[INCOME_UPGRADE_SPEC[facility].costKey] as number[])[level - 1] ?? 0;
}

/** What a given 1-based level of a track reads as ("+£60k/wk"). Level 0 — the
 * unbought state — has nothing to describe, so callers get an empty string. */
export function describeIncomeLevel(facility: Facility, level: number, cfg: TuningConfig): string {
  if (level <= 0) return "";
  return INCOME_UPGRADE_SPEC[facility].describeLevel(level, cfg);
}

/** Weekly payout of one of the three flat income tracks at its current level. */
function upgradePayout(
  state: GameState,
  teamId: string,
  facility: "lowTier" | "midTier" | "highTier",
  cfg: TuningConfig
): number {
  const level = incomeUpgradeLevel(state, teamId, facility);
  if (level <= 0) return 0;
  const payouts: Record<typeof facility, number[]> = {
    lowTier: cfg.lowTierIncomePayout,
    midTier: cfg.midTierIncomePayout,
    highTier: cfg.highTierIncomePayout,
  };
  return payouts[facility][level - 1] ?? 0;
}

/** Cost to buy the next level of an upgrade, or null if already maxed. */
export function facilityNextCost(state: GameState, teamId: string, facility: Facility, cfg: TuningConfig): number | null {
  const level = incomeUpgradeLevel(state, teamId, facility);
  const costs = cfg[INCOME_UPGRADE_SPEC[facility].costKey] as number[];
  if (level >= costs.length) return null;
  return costs[level] ?? null;
}

/** Purchase the next upgrade level. Returns an error string, or null on success. */
export function upgradeFacility(state: GameState, facility: Facility, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const cost = facilityNextCost(state, state.userTeamId, facility, cfg);
  if (cost === null) return "Already at maximum level.";
  if (team.budget < cost) return "Not enough budget for this upgrade.";
  team.budget -= cost;
  const key = INCOME_UPGRADE_SPEC[facility].levelKey;
  (team[key] as number) = incomeUpgradeLevel(state, state.userTeamId, facility) + 1;
  return null;
}

// ── Match-driven income (v43) ──────────────────────────────────────────────

/** One match's worth of upgrade income for the user's club: the Stadium Bonus if
 * they were at home, plus the Performance Bonus for the result. Both are lump
 * sums tied to a fixture rather than weekly money, so they are banked when the
 * match is played — see `applyMatchResult` in lib/gameloop.ts.
 *
 * `own`/`opp` are goals from the club's own perspective; `isHome` decides the
 * stadium half. Returns 0 for a club with neither upgrade, so the caller can
 * apply it unconditionally. */
export function matchUpgradeIncome(
  state: GameState,
  teamId: string,
  isHome: boolean,
  own: number,
  opp: number,
  cfg: TuningConfig
): number {
  let total = 0;
  const stadiumLevel = incomeUpgradeLevel(state, teamId, "stadiumBonus");
  if (isHome && stadiumLevel > 0) total += cfg.stadiumBonusPayout[stadiumLevel - 1] ?? 0;
  const perfLevel = incomeUpgradeLevel(state, teamId, "performanceBonus");
  if (perfLevel > 0) {
    const table = own > opp ? cfg.performanceBonusWin : own === opp ? cfg.performanceBonusDraw : cfg.performanceBonusLoss;
    total += table[perfLevel - 1] ?? 0;
  }
  return total;
}

// ── Academy & scouting upgrades — REMOVED (v1.82) ───────────────────────────
//
// The seven-row `TRAINING_FACILITY_SPEC` table (academy, scoutNetwork,
// academySquad, focusSlot, youthPr, scoutSpeed, scoutFilter) and its
// buy-a-level purchase path are gone, along with the Academy screen's Upgrades
// tab that drove them. Everything they governed is now produced by the
// `youthAcademy` and `scoutingNetwork` facilities — read it through the named
// accessors in lib/facilities.ts, never off a Team field.
//
// This was the last surviving "pay money, a number goes up" track outside the
// income upgrades. It is deliberately NOT converted or refunded, on the same
// reasoning migrateV45toV46 gives: the two systems measure different things.

/**
 * The growth multiplier a club's facilities give a player (1 = no effect).
 *
 * v1.79: this used to compose a gymnasium level, a position centre, a
 * training-plan centre and a youth centre — four independent multipliers, each
 * with its own tuning key, none of which the player could see the arithmetic
 * of. All four are gone. The Elite Training Center is now the single facility
 * that governs growth, and its value is the base/star/badge sum computed by
 * `facilityEffect` — one number, derived from one building, whose every term
 * the Facilities screen shows.
 *
 * It stays a per-player function because facilities that scale by position or
 * age are a natural future row in `FACILITY_SPECS`, and callers shouldn't have
 * to change shape when one lands.
 */
export function facilityGrowthMult(state: GameState, teamId: string): number {
  return growthMultiplier(state, teamId);
}

/**
 * The multiplier on an academy prospect's market value (v1.65; the Youth
 * Academy facility's `prospectValue` channel since v1.82).
 *
 * Media days, showcase friendlies and a club that talks its kids up: the effect
 * is on what the market thinks a prospect is worth, not on the player himself,
 * so it multiplies value and touches nothing else. Returns 1 for a club that
 * hasn't built the facility, and for any club that isn't the user's — only the
 * user runs a visible academy.
 */
export function youthPrValueMult(state: GameState, teamId: string, _cfg: TuningConfig): number {
  if (teamId !== state.userTeamId) return 1;
  return prospectValueMultiplier(state);
}

/**
 * A player's market value with the club's Youth PR applied, when he is one of
 * that club's academy prospects. Every path that writes `player.value` for a
 * user prospect goes through this, so the boost shows up everywhere a value is
 * read — the profile, squad value, and what an AI club offers for him.
 */
export function valueWithYouthPr(
  state: GameState,
  p: Pick<PlayerBio, "id" | "overall" | "age" | "potential">,
  cfg: TuningConfig
): number {
  const team = state.teams[state.userTeamId];
  const base = playerValue(p, cfg);
  if (!team || !(team.academyPlayerIds ?? []).includes(p.id)) return base;
  return Math.round((base * youthPrValueMult(state, team.id, cfg)) / 1000) * 1000;
}

/** The academy's current prospect-slot cap — the Youth Academy facility's
 * `squadSize` channel (v1.82). A club that hasn't built it still runs an
 * academy at `academySquadSizeBase`; the facility is what makes it a big one. */
export function academySquadCap(state: GameState, teamId: string, cfg: TuningConfig): number {
  if (teamId !== state.userTeamId) return cfg.academySquadSizeBase;
  return academySquadSize(state, cfg.academySquadSizeBase);
}

/** Runs every Monday for all playable clubs (AI clubs need budgets to trade).
 *
 * Sim-league clubs keep no weekly books — their finances are abstracted — but
 * they do draw the flat solidarity payment (v1.64), so the world outside the
 * playable pyramid stays able to trade too. */
export function weeklyEconomyTick(state: GameState, cfg: TuningConfig) {
  for (const league of Object.values(state.leagues)) {
    if (league.playable) {
      for (const teamId of league.teamIds) {
        const b = weeklyBreakdown(state, teamId, cfg);
        state.teams[teamId].budget += b.net;
      }
    } else {
      // Sim-league clubs keep no full weekly books — their finances are abstracted
      // — but they do take the solidarity payment and, since v1.67, carry their
      // running costs, so the world outside the playable pyramid neither starves
      // nor compounds cash it can't spend.
      for (const teamId of league.teamIds) {
        if (!drawsAiSubsidy(state, teamId)) continue;
        const team = state.teams[teamId];
        const cost = Math.round(team.reputation * byTier(cfg.aiOperatingCostPerReputationByTier, league.tier));
        team.budget += cfg.aiWeeklySubsidy - cost;
      }
    }
  }
}

/**
 * Write off the surplus an AI club is sitting on as reinvestment in the club
 * (v1.67). Run once per season at the rollover, for every club the manager
 * doesn't control.
 *
 * Why this exists: an AI club's only outgoings were wages and transfer fees, so
 * every club banked its whole surplus season after season and budgets compounded
 * without limit — the third-division side holding £400M+ that nothing in the sim
 * could ever spend down. Real clubs put money back into the ground, the training
 * base and the youth setup, and this is that, modelled as a proportional
 * write-off rather than a hundred individual line items.
 *
 * It is deliberately mean-reverting, not punitive: only the excess over a floor
 * of `aiSurplusFloorWageYears` years of the club's OWN wage bill is touched, and
 * only a fraction of that. A big club stays rich, a small one stays solvent, and
 * neither can compound forever. The user's club is never touched — their balance
 * is the consequence of their own decisions.
 */
export function applyAiSurplusReinvestment(state: GameState, cfg: TuningConfig) {
  if (cfg.aiSurplusReinvestRate <= 0) return;
  for (const team of Object.values(state.teams)) {
    if (!drawsAiSubsidy(state, team.id)) continue; // user club + network clubs excluded
    const players = team.playerIds.map((id) => state.players[id]).filter(Boolean);
    const annualWages = squadWageBill(players, cfg, leagueWageMult(state, team.leagueId, cfg)) * 52;
    const floor = annualWages * cfg.aiSurplusFloorWageYears;
    const excess = team.budget - floor;
    if (excess <= 0) continue;
    team.budget -= Math.round(excess * cfg.aiSurplusReinvestRate);
  }
}

/**
 * The start-of-season grant every AI club banks (v1.64). Paid alongside the
 * season prizes at the rollover, to every club the manager neither runs nor owns
 * through the network — sim leagues included, since those clubs trade too.
 */
export function applyAiSeasonSubsidy(state: GameState, cfg: TuningConfig) {
  if (cfg.aiSeasonSubsidy <= 0) return;
  for (const team of Object.values(state.teams)) {
    if (drawsAiSubsidy(state, team.id)) team.budget += cfg.aiSeasonSubsidy;
  }
}

/**
 * End-of-season prize money, scaled by final position. The champion banks the
 * tier's top prize; every place below takes a fixed percentage less than the one
 * above (compounding), so 1st → last is a geometric decay. Resolved before the
 * promotion/relegation shuffle, so relegated clubs are paid at their old tier.
 */
export function applySeasonPrizes(state: GameState, cfg: TuningConfig) {
  for (const league of Object.values(state.leagues)) {
    if (!league.playable) continue;
    const table = computeTable(state.fixtures, league.id, league.teamIds);
    // Clamped, so a division deeper than the table is paid the bottom prize
    // rather than nothing at all (v1.67).
    const top = byTier(cfg.seasonPrizeByTier, league.tier);
    const step = 1 - cfg.seasonPrizeDecayPerPosition;
    table.forEach((row, i) => {
      state.teams[row.teamId].budget += Math.round(top * Math.pow(step, i));
    });
  }
  if (state.cup.winnerId) state.teams[state.cup.winnerId].budget += cfg.cupWinBonus;
}

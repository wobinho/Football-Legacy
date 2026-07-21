// Economy (§8): one budget number per club, updated weekly.
// income (division + league position + gate) − expenses (wages + staff).

import type { GameState, Pos, Team } from "./types";
import type { TuningConfig } from "./config/tuning";
import { computeTable } from "./season";
import { squadWageBill, playerWage } from "./value";
import { userStaffWages, STAFF_SLOT_MAP } from "./staff";
import { sponsorWeeklyIncome } from "./sponsors";

export interface WeeklyBreakdown {
  tvIncome: number;
  positionBonus: number;
  gateIncome: number;
  facilityIncome: number; // stadium + commercial + media + hospitality + retail
  sponsorIncome: number; // season-long sponsorship deals (v6, user club only)
  wageBill: number;
  staffWages: number;
  academyUpkeep: number; // §18 — the only thing academy players cost
  net: number;
}

/** Weekly income from a club's revenue-facility levels (v21: eight facilities). */
export function facilityIncome(state: GameState, teamId: string, cfg: TuningConfig): number {
  const team = state.teams[teamId];
  const stadium = (team.stadiumLevel ?? 0) * cfg.stadiumIncomePerLevel;
  const commercial = (team.commercialLevel ?? 0) * cfg.commercialIncomePerLevel;
  const media = (team.mediaLevel ?? 0) * cfg.mediaIncomePerLevel;
  const hospitality = (team.hospitalityLevel ?? 0) * cfg.hospitalityIncomePerLevel;
  const retail = (team.retailLevel ?? 0) * cfg.retailIncomePerLevel;
  const membership = (team.membershipLevel ?? 0) * cfg.membershipIncomePerLevel;
  const events = (team.eventsLevel ?? 0) * cfg.eventsIncomePerLevel;
  const academyPartner = (team.academyPartnerLevel ?? 0) * cfg.academyPartnerIncomePerLevel;
  return stadium + commercial + media + hospitality + retail + membership + events + academyPartner;
}

export function weeklyBreakdown(state: GameState, teamId: string, cfg: TuningConfig): WeeklyBreakdown {
  const team = state.teams[teamId];
  const league = state.leagues[team.leagueId];
  const playable = league?.playable ?? false;

  const tvIncome = cfg.weeklyIncomeByTier[(league?.tier ?? 2) - 1] ?? cfg.weeklyIncomeByTier[1];
  let positionBonus = 0;
  if (playable) {
    const table = computeTable(state.fixtures, league.id, league.teamIds);
    const pos = table.findIndex((r) => r.teamId === teamId);
    if (pos >= 0) positionBonus = Math.round(cfg.positionBonusMax * (1 - pos / (table.length - 1)));
  }
  const gateIncome = Math.round(team.reputation * cfg.gateIncomePerReputation);
  const facilities = facilityIncome(state, teamId, cfg);
  // v19: AI clubs earn commercial money too — sponsorWeeklyIncome resolves to
  // their abstract portfolio figure. Their budgets have to be funded by
  // something legible if the market is to make sense.
  const sponsorIncome = sponsorWeeklyIncome(state, teamId);
  const players = team.playerIds.map((id) => state.players[id]).filter(Boolean);
  const wageBill = squadWageBill(players, cfg);
  const staffWages = teamId === state.userTeamId ? userStaffWages(state) : 0;
  const academyUpkeep = (team.academyLevel ?? 0) * cfg.academyUpkeepPerLevel;

  return {
    tvIncome,
    positionBonus,
    gateIncome,
    facilityIncome: facilities,
    sponsorIncome,
    wageBill,
    staffWages,
    academyUpkeep,
    net: tvIncome + positionBonus + gateIncome + facilities + sponsorIncome - wageBill - staffWages - academyUpkeep,
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
      amount: -(p.contract?.wage ?? playerWage(p.overall, cfg)),
      detail: p.contract
        ? `${p.positions[0]} · ${p.overall} ovr · through S${p.contract.expirySeason}`
        : `${p.positions[0]} · ${p.overall} ovr · no contract`,
    }))
    .sort((a, b) => a.amount - b.amount);
}

/** Every wage `userStaffWages` sums: the appointed staff and the scout roster. */
export function staffWageItems(state: GameState): BreakdownItem[] {
  const team = state.teams[state.userTeamId];
  const appointments: BreakdownItem[] = Object.values(team.staff ?? {})
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({
      label: m.name,
      amount: -m.wage,
      detail: `${STAFF_SLOT_MAP[m.slot]?.title ?? m.slot} · ${m.stars}★`,
    }));
  const scouts: BreakdownItem[] = (team.scouts ?? []).map((sc) => ({
    label: sc.name,
    amount: -sc.wage,
    detail: `Scout · ${sc.experience}★ exp · ${sc.judgement}★ judgement`,
  }));
  return [...appointments, ...scouts].sort((a, b) => a.amount - b.amount);
}

/** The facilities behind the facility income line, level by level. */
export function facilityIncomeItems(state: GameState, teamId: string, cfg: TuningConfig): BreakdownItem[] {
  const team = state.teams[teamId];
  const rows: { label: string; level: number; perLevel: number }[] = [
    { label: "Stadium", level: team.stadiumLevel ?? 0, perLevel: cfg.stadiumIncomePerLevel },
    { label: "Commercial", level: team.commercialLevel ?? 0, perLevel: cfg.commercialIncomePerLevel },
    { label: "Media & Streaming", level: team.mediaLevel ?? 0, perLevel: cfg.mediaIncomePerLevel },
    { label: "Hospitality", level: team.hospitalityLevel ?? 0, perLevel: cfg.hospitalityIncomePerLevel },
    { label: "Retail", level: team.retailLevel ?? 0, perLevel: cfg.retailIncomePerLevel },
    { label: "Membership", level: team.membershipLevel ?? 0, perLevel: cfg.membershipIncomePerLevel },
    { label: "Events & Conferences", level: team.eventsLevel ?? 0, perLevel: cfg.eventsIncomePerLevel },
    { label: "Academy Partnerships", level: team.academyPartnerLevel ?? 0, perLevel: cfg.academyPartnerIncomePerLevel },
  ];
  return rows
    .filter((r) => r.level > 0)
    .map((r) => ({
      label: r.label,
      amount: r.level * r.perLevel,
      detail: `level ${r.level} × ${r.perLevel.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })}/level`,
    }))
    .sort((a, b) => b.amount - a.amount);
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

export type Facility =
  | "stadium"
  | "commercial"
  | "media"
  | "hospitality"
  | "retail"
  // v21
  | "membership"
  | "events"
  | "academyPartner";

const FACILITY_LEVEL: Record<Facility, keyof GameState["teams"][string]> = {
  stadium: "stadiumLevel",
  commercial: "commercialLevel",
  media: "mediaLevel",
  hospitality: "hospitalityLevel",
  retail: "retailLevel",
  membership: "membershipLevel",
  events: "eventsLevel",
  academyPartner: "academyPartnerLevel",
};

const FACILITY_COST_KEY: Record<Facility, keyof TuningConfig> = {
  stadium: "stadiumUpgradeCost",
  commercial: "commercialUpgradeCost",
  media: "mediaUpgradeCost",
  hospitality: "hospitalityUpgradeCost",
  retail: "retailUpgradeCost",
  membership: "membershipUpgradeCost",
  events: "eventsUpgradeCost",
  academyPartner: "academyPartnerUpgradeCost",
};

function facilityLevelOf(state: GameState, teamId: string, facility: Facility): number {
  return (state.teams[teamId][FACILITY_LEVEL[facility]] as number | undefined) ?? 0;
}

/** Cost to buy the next level of a facility, or null if already maxed. */
export function facilityNextCost(state: GameState, teamId: string, facility: Facility, cfg: TuningConfig): number | null {
  const level = facilityLevelOf(state, teamId, facility);
  if (level >= cfg.facilityMaxLevel) return null;
  const costs = cfg[FACILITY_COST_KEY[facility]] as number[];
  return costs[level] ?? null;
}

/** Purchase the next facility level. Returns an error string, or null on success. */
export function upgradeFacility(state: GameState, facility: Facility, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const cost = facilityNextCost(state, state.userTeamId, facility, cfg);
  if (cost === null) return "Already at maximum level.";
  if (team.budget < cost) return "Not enough budget for this upgrade.";
  team.budget -= cost;
  const key = FACILITY_LEVEL[facility];
  (team[key] as number) = facilityLevelOf(state, state.userTeamId, facility) + 1;
  return null;
}

// ── Training facilities (Player Development, §5) ────────────────────────────
// These carry no weekly income; they speed development / recovery. Kept next to
// the income facilities so all facility upgrades share one purchase pattern.

export type TrainingFacility =
  | "training"
  | "medical"
  | "academy"
  | "gymnasium"
  | "scoutNetwork"
  | "academySquad"
  | "focusSlot"
  // specialist facilities (v15)
  | "gkCentre"
  | "defenceCentre"
  | "midfieldCentre"
  | "attackCentre"
  | "sportsScience"
  | "techCentre"
  | "finishingCentre"
  | "youthDevCentre";

/** One row per facility: where its level lives on the Team, which tuning array
 * holds its per-level costs, and which tuning key caps it. Table-driven so
 * adding a facility is a data change, never a new branch in the purchase path. */
const TRAINING_FACILITY_SPEC: Record<
  TrainingFacility,
  { levelKey: keyof Team; costKey: keyof TuningConfig; maxKey: keyof TuningConfig }
> = {
  training: { levelKey: "trainingLevel", costKey: "trainingUpgradeCost", maxKey: "trainingFacilityMaxLevel" },
  medical: { levelKey: "medicalLevel", costKey: "medicalUpgradeCost", maxKey: "trainingFacilityMaxLevel" },
  gymnasium: { levelKey: "gymnasiumLevel", costKey: "gymnasiumUpgradeCost", maxKey: "trainingFacilityMaxLevel" },
  academy: { levelKey: "academyLevel", costKey: "academyUpgradeCost", maxKey: "academyMaxLevel" },
  scoutNetwork: { levelKey: "scoutNetworkLevel", costKey: "scoutNetworkUpgradeCost", maxKey: "scoutNetworkMaxLevel" },
  academySquad: { levelKey: "academySquadLevel", costKey: "academySquadUpgradeCost", maxKey: "academySquadMaxLevel" },
  focusSlot: { levelKey: "focusSlotLevel", costKey: "focusSlotUpgradeCost", maxKey: "focusSlotMaxLevel" },
  gkCentre: { levelKey: "gkCentreLevel", costKey: "gkCentreUpgradeCost", maxKey: "positionFacilityMaxLevel" },
  defenceCentre: { levelKey: "defenceCentreLevel", costKey: "defenceCentreUpgradeCost", maxKey: "positionFacilityMaxLevel" },
  midfieldCentre: { levelKey: "midfieldCentreLevel", costKey: "midfieldCentreUpgradeCost", maxKey: "positionFacilityMaxLevel" },
  attackCentre: { levelKey: "attackCentreLevel", costKey: "attackCentreUpgradeCost", maxKey: "positionFacilityMaxLevel" },
  sportsScience: { levelKey: "sportsScienceLevel", costKey: "sportsScienceUpgradeCost", maxKey: "planFacilityMaxLevel" },
  techCentre: { levelKey: "techCentreLevel", costKey: "techCentreUpgradeCost", maxKey: "planFacilityMaxLevel" },
  finishingCentre: { levelKey: "finishingCentreLevel", costKey: "finishingCentreUpgradeCost", maxKey: "planFacilityMaxLevel" },
  youthDevCentre: { levelKey: "youthDevCentreLevel", costKey: "youthDevCentreUpgradeCost", maxKey: "planFacilityMaxLevel" },
};

export function trainingLevelOf(state: GameState, teamId: string, facility: TrainingFacility): number {
  const team = state.teams[teamId];
  return (team[TRAINING_FACILITY_SPEC[facility].levelKey] as number | undefined) ?? 0;
}

function trainingMaxLevel(facility: TrainingFacility, cfg: TuningConfig): number {
  return cfg[TRAINING_FACILITY_SPEC[facility].maxKey] as number;
}

/** Cost to buy the next level of a training facility, or null if already maxed. */
export function trainingNextCost(state: GameState, teamId: string, facility: TrainingFacility, cfg: TuningConfig): number | null {
  const level = trainingLevelOf(state, teamId, facility);
  if (level >= trainingMaxLevel(facility, cfg)) return null;
  const costs = cfg[TRAINING_FACILITY_SPEC[facility].costKey] as number[];
  return costs[level] ?? null;
}

/** Purchase the next training-facility level. Returns an error string, or null on success. */
export function upgradeTrainingFacility(state: GameState, facility: TrainingFacility, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const cost = trainingNextCost(state, state.userTeamId, facility, cfg);
  if (cost === null) return "Already at maximum level.";
  if (team.budget < cost) return "Not enough budget for this upgrade.";
  team.budget -= cost;
  const key = TRAINING_FACILITY_SPEC[facility].levelKey;
  (team[key] as number) = trainingLevelOf(state, state.userTeamId, facility) + 1;
  return null;
}

// ── Specialist facility effects (v15) ─────────────────────────────────────
// The general Training Centre raises everyone's growth. The specialist centres
// each help a *subset*: a position group, a training-plan family, or the
// academy age range. All are table lookups keyed off the player's position and
// plan id — the development pass never special-cases a facility by name.

/** Which position-centre facility serves a given primary position. */
const POSITION_CENTRE: Record<Pos, TrainingFacility> = {
  GK: "gkCentre",
  CB: "defenceCentre", LB: "defenceCentre", RB: "defenceCentre",
  DM: "midfieldCentre", CM: "midfieldCentre", AM: "midfieldCentre",
  LW: "attackCentre", RW: "attackCentre", ST: "attackCentre",
};

/** Which plan-centre facility amplifies a given training plan. Plans with no
 * entry (balanced, goalkeeping) get no plan-facility boost. */
const PLAN_CENTRE: Record<string, TrainingFacility> = {
  pace: "sportsScience",
  physical: "sportsScience",
  playmaking: "techCentre",
  dribbling: "techCentre",
  defending: "techCentre",
  finishing: "finishingCentre",
};

/**
 * The combined growth multiplier a club's facilities give one player, over and
 * above the general Training Centre (which the development pass already applies
 * via `trainingLevel`). Returns 1 when the club has bought nothing relevant.
 */
export function facilityGrowthMult(
  state: GameState,
  teamId: string,
  player: { positions: Pos[]; age: number; trainingPlan?: string },
  cfg: TuningConfig
): number {
  const team = state.teams[teamId];
  if (!team) return 1;
  let mult = 1;

  // Gymnasium lifts every player's growth regardless of age or position.
  mult *= 1 + trainingLevelOf(state, teamId, "gymnasium") * cfg.gymnasiumGrowthPerLevel;

  const posCentre = POSITION_CENTRE[player.positions[0]];
  if (posCentre) {
    mult *= 1 + trainingLevelOf(state, teamId, posCentre) * cfg.positionFacilityGrowthPerLevel;
  }

  const planCentre = player.trainingPlan ? PLAN_CENTRE[player.trainingPlan] : undefined;
  if (planCentre) {
    mult *= 1 + trainingLevelOf(state, teamId, planCentre) * cfg.planFacilityBoostPerLevel;
  }

  if (player.age <= cfg.academyMaxAge) {
    mult *= 1 + trainingLevelOf(state, teamId, "youthDevCentre") * cfg.youthDevCentreGrowthPerLevel;
  }

  return mult;
}

/** The academy's current prospect-slot cap (facility-driven, v7). */
export function academySquadCap(state: GameState, teamId: string, cfg: TuningConfig): number {
  const level = state.teams[teamId].academySquadLevel ?? 0;
  return cfg.academySquadSizeBase + level * cfg.academySquadSizePerLevel;
}

/** Runs every Monday for all playable clubs (AI clubs need budgets to trade). */
export function weeklyEconomyTick(state: GameState, cfg: TuningConfig) {
  for (const league of Object.values(state.leagues)) {
    if (!league.playable) continue;
    for (const teamId of league.teamIds) {
      const b = weeklyBreakdown(state, teamId, cfg);
      state.teams[teamId].budget += b.net;
    }
  }
}

/** End-of-season prize money, scaled by final position. */
export function applySeasonPrizes(state: GameState, cfg: TuningConfig) {
  for (const league of Object.values(state.leagues)) {
    if (!league.playable) continue;
    const table = computeTable(state.fixtures, league.id, league.teamIds);
    const top = cfg.seasonPrizeByTier[league.tier - 1] ?? 0;
    table.forEach((row, i) => {
      const share = 1 - (i / (table.length - 1)) * 0.75;
      state.teams[row.teamId].budget += Math.round(top * share);
    });
  }
  if (state.cup.winnerId) state.teams[state.cup.winnerId].budget += cfg.cupWinBonus;
}

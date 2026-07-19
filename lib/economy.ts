// Economy (§8): one budget number per club, updated weekly.
// income (division + league position + gate) − expenses (wages + staff).

import type { GameState } from "./types";
import type { TuningConfig } from "./config/tuning";
import { computeTable } from "./season";
import { squadWageBill } from "./value";
import { userStaffWages } from "./staff";
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

/** Weekly income from a club's revenue-facility levels (v6: five facilities). */
export function facilityIncome(state: GameState, teamId: string, cfg: TuningConfig): number {
  const team = state.teams[teamId];
  const stadium = (team.stadiumLevel ?? 0) * cfg.stadiumIncomePerLevel;
  const commercial = (team.commercialLevel ?? 0) * cfg.commercialIncomePerLevel;
  const media = (team.mediaLevel ?? 0) * cfg.mediaIncomePerLevel;
  const hospitality = (team.hospitalityLevel ?? 0) * cfg.hospitalityIncomePerLevel;
  const retail = (team.retailLevel ?? 0) * cfg.retailIncomePerLevel;
  return stadium + commercial + media + hospitality + retail;
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
  const sponsorIncome = teamId === state.userTeamId ? sponsorWeeklyIncome(state, teamId) : 0;
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

export type Facility = "stadium" | "commercial" | "media" | "hospitality" | "retail";

const FACILITY_LEVEL: Record<Facility, keyof GameState["teams"][string]> = {
  stadium: "stadiumLevel",
  commercial: "commercialLevel",
  media: "mediaLevel",
  hospitality: "hospitalityLevel",
  retail: "retailLevel",
};

const FACILITY_COST_KEY: Record<Facility, keyof TuningConfig> = {
  stadium: "stadiumUpgradeCost",
  commercial: "commercialUpgradeCost",
  media: "mediaUpgradeCost",
  hospitality: "hospitalityUpgradeCost",
  retail: "retailUpgradeCost",
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

export type TrainingFacility = "training" | "medical" | "academy" | "scoutNetwork" | "academySquad" | "focusSlot";

function trainingLevelOf(state: GameState, teamId: string, facility: TrainingFacility): number {
  const team = state.teams[teamId];
  return (
    (facility === "training"
      ? team.trainingLevel
      : facility === "medical"
        ? team.medicalLevel
        : facility === "academy"
          ? team.academyLevel
          : facility === "scoutNetwork"
            ? team.scoutNetworkLevel
            : facility === "academySquad"
              ? team.academySquadLevel
              : team.focusSlotLevel) ?? 0
  );
}

function trainingMaxLevel(facility: TrainingFacility, cfg: TuningConfig): number {
  return facility === "academy"
    ? cfg.academyMaxLevel
    : facility === "scoutNetwork"
      ? cfg.scoutNetworkMaxLevel
      : facility === "academySquad"
        ? cfg.academySquadMaxLevel
        : facility === "focusSlot"
          ? cfg.focusSlotMaxLevel
          : cfg.trainingFacilityMaxLevel;
}

/** Cost to buy the next level of a training facility, or null if already maxed. */
export function trainingNextCost(state: GameState, teamId: string, facility: TrainingFacility, cfg: TuningConfig): number | null {
  const level = trainingLevelOf(state, teamId, facility);
  if (level >= trainingMaxLevel(facility, cfg)) return null;
  const costs =
    facility === "training"
      ? cfg.trainingUpgradeCost
      : facility === "medical"
        ? cfg.medicalUpgradeCost
        : facility === "academy"
          ? cfg.academyUpgradeCost
          : facility === "scoutNetwork"
            ? cfg.scoutNetworkUpgradeCost
            : facility === "academySquad"
              ? cfg.academySquadUpgradeCost
              : cfg.focusSlotUpgradeCost;
  return costs[level] ?? null;
}

/** Purchase the next training-facility level. Returns an error string, or null on success. */
export function upgradeTrainingFacility(state: GameState, facility: TrainingFacility, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const cost = trainingNextCost(state, state.userTeamId, facility, cfg);
  if (cost === null) return "Already at maximum level.";
  if (team.budget < cost) return "Not enough budget for this upgrade.";
  team.budget -= cost;
  if (facility === "training") team.trainingLevel = (team.trainingLevel ?? 0) + 1;
  else if (facility === "medical") team.medicalLevel = (team.medicalLevel ?? 0) + 1;
  else if (facility === "academy") team.academyLevel = (team.academyLevel ?? 0) + 1;
  else if (facility === "scoutNetwork") team.scoutNetworkLevel = (team.scoutNetworkLevel ?? 0) + 1;
  else if (facility === "academySquad") team.academySquadLevel = (team.academySquadLevel ?? 0) + 1;
  else team.focusSlotLevel = (team.focusSlotLevel ?? 0) + 1;
  return null;
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

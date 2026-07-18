// Scouting regions (v5) — pure data. Each scoutable target maps to a set of
// nationality codes the report generator draws from, EA-FC style: point a scout
// at a country (or a broad region) and reports of players from there arrive.
// The engine never special-cases a region by name — it reads this table.

import type { ScoutRegion } from "../types";

export interface ScoutRegionDef {
  id: ScoutRegion;
  label: string;
  /** Nationality pools this target draws prospects from. */
  nats: string[];
  /** Short flag/emoji-free tag for compact UI. */
  short: string;
}

export const SCOUT_REGIONS: ScoutRegionDef[] = [
  { id: "England", label: "England", nats: ["ENG"], short: "ENG" },
  { id: "Spain", label: "Spain", nats: ["ESP"], short: "ESP" },
  { id: "Italy", label: "Italy", nats: ["ITA"], short: "ITA" },
  { id: "Germany", label: "Germany", nats: ["GER"], short: "GER" },
  { id: "France", label: "France", nats: ["FRA"], short: "FRA" },
  { id: "Netherlands", label: "Netherlands", nats: ["NED"], short: "NED" },
  { id: "Sweden", label: "Sweden", nats: ["SWE"], short: "SWE" },
  { id: "Brazil", label: "Brazil", nats: ["BRA"], short: "BRA" },
  { id: "Argentina", label: "Argentina", nats: ["ARG"], short: "ARG" },
  { id: "Nigeria", label: "Nigeria", nats: ["NGA"], short: "NGA" },
  { id: "Europe", label: "Europe (broad)", nats: ["ENG", "ESP", "ITA", "GER", "FRA", "NED", "SWE"], short: "EUR" },
  { id: "World", label: "Worldwide", nats: ["ENG", "ESP", "ITA", "GER", "FRA", "NED", "SWE", "BRA", "ARG", "NGA"], short: "WLD" },
];

const REGION_MAP: Record<string, ScoutRegionDef> = Object.fromEntries(
  SCOUT_REGIONS.map((r) => [r.id, r])
);

export function scoutRegion(id: ScoutRegion): ScoutRegionDef {
  return REGION_MAP[id] ?? SCOUT_REGIONS[SCOUT_REGIONS.length - 1];
}

export function regionNats(id: ScoutRegion): string[] {
  return scoutRegion(id).nats;
}

/** Migration helper: the old three-value ScoutRegion ("Britain"/"Europe"/
 * "World") maps onto the new set so v4 saves keep a sensible focus. */
export function migrateOldRegion(old: string): ScoutRegion {
  if (old === "Britain") return "England";
  if (old === "Europe") return "Europe";
  return "World";
}

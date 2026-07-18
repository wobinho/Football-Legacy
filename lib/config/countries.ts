// ── Country registry (v7 database architecture) ───────────────────────────
// Each country is a self-contained "database" of divisions + clubs. A new game
// consolidates the chosen countries (default here, or a user-uploaded custom
// database — see lib/database.ts) into one GameState. Pure data: the club pools
// still live in lib/config/names.ts; this file arranges them into the
// per-country / per-division shape worldgen consumes.

import type { ClubDef } from "./names";
import { ENGLAND_D1, ENGLAND_D2, SIM_LEAGUES } from "./names";

/** One division within a country (a real football league level). */
export interface DivisionDef {
  /** Stable league id, e.g. "ENG1". Also the fixtures' competition key. */
  id: string;
  name: string;
  tier: number; // 1 = top division
  clubs: ClubDef[];
}

/** A country's full default database: its dominant nationality + its divisions. */
export interface CountryDef {
  code: string; // 3-letter, matches player nationality codes (ENG, ESP, …)
  name: string; // "England"
  nat: string; // dominant nationality pool for generated players
  /** How much of a generated squad is home-nation (0..1). */
  homeShare: number;
  divisions: DivisionDef[];
}

// England ships two playable divisions; the sim leagues are single-division
// countries. Swapping to a real second division later is just another entry.
export const COUNTRIES: CountryDef[] = [
  {
    code: "ENG",
    name: "England",
    nat: "ENG",
    homeShare: 0.55,
    divisions: [
      { id: "ENG1", name: "Premier Division", tier: 1, clubs: ENGLAND_D1 },
      { id: "ENG2", name: "Championship", tier: 2, clubs: ENGLAND_D2 },
    ],
  },
  ...SIM_LEAGUES.map(
    (l): CountryDef => ({
      code: l.nat,
      name: l.country,
      nat: l.nat,
      homeShare: 0.7,
      divisions: [{ id: l.id, name: l.name, tier: 1, clubs: l.clubs }],
    })
  ),
];

export const COUNTRY_MAP: Record<string, CountryDef> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c])
);

export function getCountry(code: string): CountryDef | undefined {
  return COUNTRY_MAP[code];
}

/** The country's top division (tier 1). */
export function topDivision(country: CountryDef): DivisionDef {
  return country.divisions.find((d) => d.tier === 1) ?? country.divisions[0];
}

// Scouting targets (v17) — pure data. A scoutable target maps to the set of
// nationality codes the report generator draws from: point a scout at a country
// (or a broader region) and prospects from there arrive.
//
// v17 replaces the flat ten-country list with a CONTINENT → REGION → COUNTRY
// hierarchy, so the whole world is reachable instead of the handful of leagues
// the engine happens to simulate. The UI walks the tree in that order; the
// engine still only ever asks "which nationality codes does this target draw
// from?" and never special-cases a region by name.
//
// Every country listed here has a name pool in lib/config/names.ts (so players
// generate with plausible names) and a flag in lib/config/flags.ts.

import type { ScoutRegion } from "../types";

export interface ScoutCountryDef {
  /** Target id — also the 3-letter nationality code prospects are drawn from. */
  id: string;
  label: string;
}

export interface ScoutSubRegionDef {
  id: string;
  label: string;
  countries: ScoutCountryDef[];
}

export interface ScoutContinentDef {
  id: string;
  label: string;
  regions: ScoutSubRegionDef[];
}

/**
 * The scouting world, three levels deep.
 *
 * v19 opens scouting to EVERY country the game has a flag for — 135 of them —
 * rather than the two dozen the engine happens to simulate. Every country listed
 * here has both a flag (lib/config/flags.ts) and a name pool
 * (lib/config/names.ts); a target without a pool would generate players with the
 * wrong names, so those two files and this one must stay in step. There is a
 * coverage check in `scripts/smoke.ts` that fails the build if they drift.
 *
 * Sub-regions are drawn along footballing/cultural lines rather than strict
 * geography, because that is how a scouting brief is actually written: "the
 * Maghreb" and "the Balkans" are meaningful searches in a way that "North
 * Africa, excluding Egypt" is not.
 */
export const SCOUT_WORLD: ScoutContinentDef[] = [
  {
    id: "Europe",
    label: "Europe",
    regions: [
      {
        id: "BritishIsles",
        label: "British Isles",
        countries: [
          { id: "ENG", label: "England" },
          { id: "SCO", label: "Scotland" },
          { id: "WAL", label: "Wales" },
          { id: "NIR", label: "Northern Ireland" },
          { id: "IRL", label: "Republic of Ireland" },
        ],
      },
      {
        id: "WesternEurope",
        label: "Western Europe",
        countries: [
          { id: "FRA", label: "France" },
          { id: "NED", label: "Netherlands" },
          { id: "BEL", label: "Belgium" },
          { id: "LUX", label: "Luxembourg" },
        ],
      },
      {
        id: "SouthernEurope",
        label: "Southern Europe",
        countries: [
          { id: "ESP", label: "Spain" },
          { id: "ITA", label: "Italy" },
          { id: "POR", label: "Portugal" },
          { id: "GRE", label: "Greece" },
          { id: "CYP", label: "Cyprus" },
        ],
      },
      {
        id: "CentralEurope",
        label: "Central Europe",
        countries: [
          { id: "GER", label: "Germany" },
          { id: "AUT", label: "Austria" },
          { id: "SUI", label: "Switzerland" },
          { id: "CZE", label: "Czechia" },
          { id: "SVK", label: "Slovakia" },
          { id: "POL", label: "Poland" },
          { id: "HUN", label: "Hungary" },
          { id: "SVN", label: "Slovenia" },
        ],
      },
      {
        id: "Nordics",
        label: "Nordics",
        countries: [
          { id: "SWE", label: "Sweden" },
          { id: "DEN", label: "Denmark" },
          { id: "NOR", label: "Norway" },
          { id: "FIN", label: "Finland" },
          { id: "ISL", label: "Iceland" },
        ],
      },
      {
        id: "Baltics",
        label: "Baltics",
        countries: [
          { id: "EST", label: "Estonia" },
          { id: "LVA", label: "Latvia" },
          { id: "LTU", label: "Lithuania" },
        ],
      },
      {
        id: "Balkans",
        label: "Balkans",
        countries: [
          { id: "CRO", label: "Croatia" },
          { id: "SRB", label: "Serbia" },
          { id: "BIH", label: "Bosnia & Herzegovina" },
          { id: "MNE", label: "Montenegro" },
          { id: "MKD", label: "North Macedonia" },
          { id: "ALB", label: "Albania" },
          { id: "KVX", label: "Kosovo" },
          { id: "BUL", label: "Bulgaria" },
        ],
      },
      {
        id: "EasternEurope",
        label: "Eastern Europe",
        countries: [
          { id: "ROU", label: "Romania" },
          { id: "RUS", label: "Russia" },
          { id: "UKR", label: "Ukraine" },
          { id: "BLR", label: "Belarus" },
          { id: "MDA", label: "Moldova" },
        ],
      },
      {
        id: "Caucasus",
        label: "Caucasus",
        countries: [
          { id: "GEO", label: "Georgia" },
          { id: "ARM", label: "Armenia" },
          { id: "AZE", label: "Azerbaijan" },
          { id: "TUR", label: "Türkiye" },
        ],
      },
    ],
  },
  {
    id: "SouthAmerica",
    label: "South America",
    regions: [
      {
        id: "Brazil",
        label: "Brazil",
        countries: [{ id: "BRA", label: "Brazil" }],
      },
      {
        id: "SouthernCone",
        label: "Southern Cone",
        countries: [
          { id: "ARG", label: "Argentina" },
          { id: "URU", label: "Uruguay" },
          { id: "CHI", label: "Chile" },
          { id: "PAR", label: "Paraguay" },
        ],
      },
      {
        id: "AndeanSA",
        label: "Andean",
        countries: [
          { id: "COL", label: "Colombia" },
          { id: "PER", label: "Peru" },
          { id: "ECU", label: "Ecuador" },
          { id: "BOL", label: "Bolivia" },
          { id: "VEN", label: "Venezuela" },
        ],
      },
      {
        id: "Guianas",
        label: "The Guianas",
        countries: [
          { id: "GUY", label: "Guyana" },
          { id: "SUR", label: "Suriname" },
          { id: "GUF", label: "French Guiana" },
        ],
      },
    ],
  },
  {
    id: "NorthAmerica",
    label: "North & Central America",
    regions: [
      {
        id: "NorthAmericaMain",
        label: "North America",
        countries: [
          { id: "USA", label: "United States" },
          { id: "MEX", label: "Mexico" },
          { id: "CAN", label: "Canada" },
        ],
      },
      {
        id: "CentralAmerica",
        label: "Central America",
        countries: [
          { id: "CRC", label: "Costa Rica" },
          { id: "HON", label: "Honduras" },
          { id: "PAN", label: "Panama" },
          { id: "GUA", label: "Guatemala" },
          { id: "SLV", label: "El Salvador" },
        ],
      },
      {
        id: "Caribbean",
        label: "Caribbean",
        countries: [
          { id: "JAM", label: "Jamaica" },
          { id: "TRI", label: "Trinidad & Tobago" },
          { id: "HAI", label: "Haiti" },
          { id: "DOM", label: "Dominican Republic" },
          { id: "PUR", label: "Puerto Rico" },
          { id: "CUW", label: "Curaçao" },
          { id: "GRN", label: "Grenada" },
          { id: "ATG", label: "Antigua & Barbuda" },
          { id: "LCA", label: "Saint Lucia" },
          { id: "STV", label: "St Vincent & Grenadines" },
          { id: "GLP", label: "Guadeloupe" },
          { id: "MTQ", label: "Martinique" },
        ],
      },
    ],
  },
  {
    id: "Africa",
    label: "Africa",
    regions: [
      {
        id: "Maghreb",
        label: "North Africa",
        countries: [
          { id: "MAR", label: "Morocco" },
          { id: "ALG", label: "Algeria" },
          { id: "TUN", label: "Tunisia" },
          { id: "EGY", label: "Egypt" },
          { id: "LBY", label: "Libya" },
          { id: "MTN", label: "Mauritania" },
        ],
      },
      {
        id: "WestAfrica",
        label: "West Africa",
        countries: [
          { id: "NGA", label: "Nigeria" },
          { id: "SEN", label: "Senegal" },
          { id: "GHA", label: "Ghana" },
          { id: "CIV", label: "Ivory Coast" },
          { id: "MLI", label: "Mali" },
          { id: "GUI", label: "Guinea" },
          { id: "BFA", label: "Burkina Faso" },
          { id: "BEN", label: "Benin" },
          { id: "TOG", label: "Togo" },
          { id: "NIG", label: "Niger" },
          { id: "SLE", label: "Sierra Leone" },
          { id: "GAM", label: "Gambia" },
          { id: "GNB", label: "Guinea-Bissau" },
          { id: "CPV", label: "Cape Verde" },
        ],
      },
      {
        id: "CentralAfrica",
        label: "Central Africa",
        countries: [
          { id: "CMR", label: "Cameroon" },
          { id: "COD", label: "DR Congo" },
          { id: "CGO", label: "Congo" },
          { id: "GAB", label: "Gabon" },
          { id: "EQG", label: "Equatorial Guinea" },
          { id: "CTA", label: "Central African Republic" },
          { id: "CHA", label: "Chad" },
        ],
      },
      {
        id: "EastAfrica",
        label: "East Africa",
        countries: [
          { id: "KEN", label: "Kenya" },
          { id: "TAN", label: "Tanzania" },
          { id: "UGA", label: "Uganda" },
          { id: "ETH", label: "Ethiopia" },
          { id: "SOM", label: "Somalia" },
          { id: "BDI", label: "Burundi" },
          { id: "COM", label: "Comoros" },
          { id: "MAD", label: "Madagascar" },
        ],
      },
      {
        id: "SouthernAfrica",
        label: "Southern Africa",
        countries: [
          { id: "RSA", label: "South Africa" },
          { id: "ANG", label: "Angola" },
          { id: "MOZ", label: "Mozambique" },
          { id: "ZAM", label: "Zambia" },
          { id: "ZIM", label: "Zimbabwe" },
        ],
      },
    ],
  },
  {
    id: "Asia",
    label: "Asia",
    regions: [
      {
        id: "EastAsia",
        label: "East Asia",
        countries: [
          { id: "JPN", label: "Japan" },
          { id: "KOR", label: "South Korea" },
          { id: "CHN", label: "China" },
        ],
      },
      {
        id: "WestAsia",
        label: "West Asia",
        countries: [
          { id: "KSA", label: "Saudi Arabia" },
          { id: "IRN", label: "Iran" },
          { id: "IRQ", label: "Iraq" },
          { id: "ISR", label: "Israel" },
          { id: "JOR", label: "Jordan" },
          { id: "SYR", label: "Syria" },
          { id: "PLE", label: "Palestine" },
        ],
      },
      {
        id: "CentralAsia",
        label: "Central Asia",
        countries: [{ id: "UZB", label: "Uzbekistan" }],
      },
      {
        id: "SoutheastAsia",
        label: "Southeast Asia",
        countries: [
          { id: "IDN", label: "Indonesia" },
          { id: "PHI", label: "Philippines" },
        ],
      },
    ],
  },
  {
    id: "Oceania",
    label: "Oceania",
    regions: [
      {
        id: "Australasia",
        label: "Australasia",
        countries: [
          { id: "AUS", label: "Australia" },
          { id: "NZL", label: "New Zealand" },
        ],
      },
    ],
  },
];

export interface ScoutRegionDef {
  id: ScoutRegion;
  label: string;
  /** Nationality pools this target draws prospects from. */
  nats: string[];
  /** Short flag/emoji-free tag for compact UI. */
  short: string;
}

/** Every scoutable target, flattened: each country, each sub-region, each
 * continent, plus Worldwide. Built from SCOUT_WORLD so the tree stays the single
 * source of truth — adding a country there makes it scoutable everywhere. */
export const SCOUT_REGIONS: ScoutRegionDef[] = (() => {
  const out: ScoutRegionDef[] = [];
  const all: string[] = [];
  for (const continent of SCOUT_WORLD) {
    const continentNats: string[] = [];
    for (const region of continent.regions) {
      const nats = region.countries.map((c) => c.id);
      continentNats.push(...nats);
      for (const c of region.countries) {
        out.push({ id: c.id, label: c.label, nats: [c.id], short: c.id });
      }
      // A sub-region is only worth offering when it spans several countries —
      // a one-country region would just duplicate that country's own target.
      if (region.countries.length > 1) {
        out.push({ id: region.id, label: region.label, nats, short: region.id.slice(0, 3).toUpperCase() });
      }
    }
    all.push(...continentNats);
    out.push({
      id: continent.id,
      label: `${continent.label} (broad)`,
      nats: continentNats,
      short: continent.id.slice(0, 3).toUpperCase(),
    });
  }
  out.push({ id: "World", label: "Worldwide", nats: all, short: "WLD" });
  return out;
})();

const REGION_MAP: Record<string, ScoutRegionDef> = Object.fromEntries(
  SCOUT_REGIONS.map((r) => [r.id, r])
);

export function scoutRegion(id: ScoutRegion): ScoutRegionDef {
  return REGION_MAP[id] ?? SCOUT_REGIONS[SCOUT_REGIONS.length - 1];
}

export function regionNats(id: ScoutRegion): string[] {
  return scoutRegion(id).nats;
}

/** Where a target sits in the tree, so the UI can open the picker already
 * pointed at a saved assignment's country. Returns null for the broad targets
 * (a continent or Worldwide isn't inside a single region). */
export function locateTarget(id: ScoutRegion): { continent: string; region: string } | null {
  for (const continent of SCOUT_WORLD) {
    for (const region of continent.regions) {
      if (region.countries.some((c) => c.id === id)) {
        return { continent: continent.id, region: region.id };
      }
    }
  }
  return null;
}

/** Migration helper. Covers both the original three-value ScoutRegion
 * ("Britain"/"Europe"/"World") and the v5–v16 country-name targets, which used
 * full names ("England", "Spain") where the tree now keys on nationality codes. */
const LEGACY_NAMES: Record<string, ScoutRegion> = {
  Britain: "ENG",
  England: "ENG",
  Spain: "ESP",
  Italy: "ITA",
  Germany: "GER",
  France: "FRA",
  Netherlands: "NED",
  Sweden: "SWE",
  Brazil: "BRA",
  Argentina: "ARG",
  Nigeria: "NGA",
};

export function migrateOldRegion(old: string): ScoutRegion {
  if (LEGACY_NAMES[old]) return LEGACY_NAMES[old];
  if (old === "Europe") return "Europe";
  if (REGION_MAP[old]) return old;
  return "World";
}

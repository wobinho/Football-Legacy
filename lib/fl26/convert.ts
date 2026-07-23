// ── FC 26 source data → country-database conversion (v1.47) ────────────────
//
// Turns the three authoring CSVs (fl26-players / fl26-clubs / fl26-leagues) into
// the CountryDatabase JSON the engine already consumes. Run at build time by
// scripts/build-fl26.ts; the output lands in /public/database_presets and is
// loaded exactly like the presets that came before it, so no engine code knows
// the world came from a spreadsheet.
//
// Two mappings do the real work:
//   • position — the source uses the FUT vocabulary (CDM/CAM/CF/LWB/RWB); the
//     engine's Pos uses DM/AM and has no CF/wing-back. Both directions are table
//     lookups, never name special-cases in engine code.
//   • nationality — the source stores full country names; players store 3-letter
//     codes. Unmapped nations fall back to the club's country so a player never
//     ends up with a code the flag/name layer can't resolve.

import type { Pos } from "../types";
import type { ClubSeed, CountryDatabase, DivisionSeed, PlayerSeed } from "../database";
import { COUNTRY_DB_SCHEMA } from "../database";
import type { CsvRow } from "./csv";

// ── Position mapping ───────────────────────────────────────────────────────

/** Source (FC 26 / FUT) position token → the engine's Pos. Wing-backs collapse
 * onto the full-backs and CF onto AM, matching OVERALL_FORMULA.md's own alias
 * table so a converted player rates the same either side of the import. */
export const FORMULA_POS_TO_POS: Record<string, Pos> = {
  GK: "GK",
  CB: "CB",
  LB: "LB",
  RB: "RB",
  LWB: "LB",
  RWB: "RB",
  CDM: "DM",
  CM: "CM",
  LM: "LM",
  RM: "RM",
  CAM: "AM",
  CF: "AM",
  LW: "LW",
  RW: "RW",
  ST: "ST",
};

/** Parse "LW, LM" into engine positions, dropping unknown tokens and dupes. */
export function parsePositions(primary: string, secondary: string): Pos[] {
  const out: Pos[] = [];
  const push = (token: string) => {
    const pos = FORMULA_POS_TO_POS[token.trim().toUpperCase()];
    if (pos && !out.includes(pos)) out.push(pos);
  };
  push(primary);
  for (const token of secondary.split(",")) if (token.trim()) push(token);
  return out.length ? out : ["CM"];
}

// ── Nationality mapping ────────────────────────────────────────────────────

/** Full country name (as the source CSVs spell it) → 3-letter code. Codes follow
 * the FIFA convention already used across lib/config/flags.ts, so every entry
 * here resolves to a flag the UI can draw. */
export const COUNTRY_TO_NAT: Record<string, string> = {
  Afghanistan: "AFG", Albania: "ALB", Algeria: "ALG", Andorra: "AND", Angola: "ANG",
  "Antigua and Barbuda": "ATG", Argentina: "ARG", Armenia: "ARM", Australia: "AUS",
  Austria: "AUT", Azerbaijan: "AZE", Bangladesh: "BAN", Barbados: "BRB", Belarus: "BLR",
  Belgium: "BEL", Benin: "BEN", Bermuda: "BER", Bolivia: "BOL",
  "Bosnia and Herzegovina": "BIH", Brazil: "BRA", Bulgaria: "BUL", "Burkina Faso": "BFA",
  Burundi: "BDI", "Cabo Verde": "CPV", Cameroon: "CMR", Canada: "CAN",
  "Central African Republic": "CTA", Chad: "CHA", Chile: "CHI", "China PR": "CHN",
  "Chinese Taipei": "TPE", Colombia: "COL", Comoros: "COM", Congo: "CGO",
  "Congo DR": "COD", "Costa Rica": "CRC", Croatia: "CRO", Cuba: "CUB", Curacao: "CUW",
  Cyprus: "CYP", Czechia: "CZE", "Côte d'Ivoire": "CIV", Denmark: "DEN",
  "Dominican Republic": "DOM", Ecuador: "ECU", Egypt: "EGY", "El Salvador": "SLV",
  England: "ENG", "Equatorial Guinea": "EQG", Estonia: "EST", "Faroe Islands": "FRO",
  Finland: "FIN", France: "FRA", Gabon: "GAB", Gambia: "GAM", Georgia: "GEO",
  Germany: "GER", Ghana: "GHA", Gibraltar: "GIB", Greece: "GRE", Grenada: "GRN",
  Guatemala: "GUA", Guinea: "GUI", "Guinea-Bissau": "GNB", Guyana: "GUY", Haiti: "HAI",
  Honduras: "HON", "Hong Kong": "HKG", Hungary: "HUN", Iceland: "ISL", India: "IND",
  Indonesia: "IDN", Iran: "IRN", Iraq: "IRQ", Israel: "ISR", Italy: "ITA",
  Jamaica: "JAM", Japan: "JPN", Jordan: "JOR", Kenya: "KEN", "Korea Republic": "KOR",
  Kosovo: "KVX", Latvia: "LVA", Lebanon: "LBN", Liberia: "LBR", Libya: "LBY",
  Liechtenstein: "LIE", Lithuania: "LTU", Luxembourg: "LUX", Madagascar: "MAD",
  Malawi: "MWI", Malaysia: "MAS", Mali: "MLI", Malta: "MLT", Mauritania: "MTN",
  Mexico: "MEX", Moldova: "MDA", Montenegro: "MNE", Montserrat: "MSR", Morocco: "MAR",
  Mozambique: "MOZ", Namibia: "NAM", Netherlands: "NED", "New Caledonia": "NCL",
  "New Zealand": "NZL", Niger: "NIG", Nigeria: "NGA", "North Macedonia": "MKD",
  "Northern Ireland": "NIR", Norway: "NOR", Pakistan: "PAK", Palestine: "PLE",
  Panama: "PAN", Paraguay: "PAR", Peru: "PER", Philippines: "PHI", Poland: "POL",
  Portugal: "POR", "Puerto Rico": "PUR", Qatar: "QAT", "Republic of Ireland": "IRL",
  Romania: "ROU", Russia: "RUS", Rwanda: "RWA", "Saint Kitts and Nevis": "SKN",
  "Saint Lucia": "LCA", "Saudi Arabia": "KSA", Scotland: "SCO", Senegal: "SEN",
  Serbia: "SRB", "Sierra Leone": "SLE", Slovakia: "SVK", Slovenia: "SVN",
  Somalia: "SOM", "South Africa": "RSA", Spain: "ESP", "Sri Lanka": "SRI",
  Suriname: "SUR", Sweden: "SWE", Switzerland: "SUI", Syria: "SYR",
  Tajikistan: "TJK", Tanzania: "TAN", Thailand: "THA", Togo: "TOG",
  "Trinidad and Tobago": "TRI", Tunisia: "TUN", "Türkiye": "TUR", Uganda: "UGA",
  Ukraine: "UKR", "United Arab Emirates": "UAE", "United States": "USA",
  Uruguay: "URU", Uzbekistan: "UZB", Vanuatu: "VAN", Venezuela: "VEN", Wales: "WAL",
  Yemen: "YEM", Zambia: "ZAM", Zimbabwe: "ZIM",
};

export function natFor(countryName: string, fallback: string): string {
  return COUNTRY_TO_NAT[countryName.trim()] ?? fallback;
}

// ── Source row shapes ──────────────────────────────────────────────────────

export interface Fl26League {
  leagueId: string;
  name: string;
  level: number;
  country: string;
}

export interface Fl26Club {
  clubId: string;
  name: string;
  short: string;
  country: string;
  leagueId: string;
  level: number;
  stadium: string;
  capacity: number;
  colors: [string, string];
}

export function readLeagues(rows: CsvRow[]): Fl26League[] {
  return rows
    .filter((r) => r.league_id)
    .map((r) => ({
      leagueId: r.league_id,
      name: r.league_name,
      level: Number(r.league_level) || 1,
      country: r.country,
    }));
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const colorOr = (v: string, fallback: string) => (HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback);

export function readClubs(rows: CsvRow[]): Fl26Club[] {
  return rows
    .filter((r) => r.club_id && r.club_name)
    .map((r) => ({
      clubId: r.club_id,
      name: r.club_name,
      short: (r.short_code || r.club_name.slice(0, 3)).toUpperCase().slice(0, 4),
      country: r.country,
      leagueId: r.league_id,
      level: Number(r.league_level) || 1,
      stadium: r.stadium || `${r.club_name} Stadium`,
      capacity: Number(r.stadium_capacity) || 20000,
      colors: [colorOr(r.primary_color, "#cccccc"), colorOr(r.secondary_color, "#ffffff")] as [string, string],
    }));
}

// ── Reputation ─────────────────────────────────────────────────────────────

/** A club's reputation (1–100) from its squad strength and stadium size.
 *
 * Squad strength dominates — reputation drives transfer pull, finances and the
 * AI's ambition, and the honest signal for those is how good the team actually
 * is. Stadium capacity is a light secondary term so a big-crowd club with a thin
 * squad still reads as a bigger institution than an equally-rated small-town side.
 * Tier shifts the band down so a third-division club is never mistaken for elite. */
export function clubReputation(squadOverall: number, capacity: number, level: number): number {
  // Squad 45→99 maps onto roughly 30→96 before adjustments.
  const fromSquad = (squadOverall - 45) * (66 / 54) + 30;
  // Capacity 5k→80k contributes up to ~8 points, with sharply diminishing returns.
  const fromCapacity = Math.min(8, Math.max(0, Math.log10(Math.max(capacity, 1000) / 5000) * 7));
  const tierPenalty = (level - 1) * 6;
  return Math.round(Math.max(1, Math.min(100, fromSquad + fromCapacity - tierPenalty)));
}

/** Mean overall of the strongest `n` players — a squad's real strength lives in
 * its first team, not in the tail of academy filler. */
export function squadStrength(overalls: number[], n = 16): number {
  if (!overalls.length) return 55;
  const top = [...overalls].sort((a, b) => b - a).slice(0, n);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

// ── Assembly ───────────────────────────────────────────────────────────────

export interface BuildInput {
  leagues: Fl26League[];
  clubs: Fl26Club[];
  /** Player seeds already converted, grouped by source club id. */
  rostersByClub: Map<string, PlayerSeed[]>;
  /** Overalls per club id, used for reputation. */
  overallsByClub: Map<string, number[]>;
  /** Pad a division that the source under-fills up to a legal size (≥4 clubs,
   * even count) with procedurally-named clubs. Injected rather than imported so
   * this module stays free of the RNG/name pools. Returns `count` club seeds
   * that must not collide with `exclude`. */
  padDivision: (nat: string, tier: number, count: number, exclude: Set<string>) => ClubSeed[];
}

/** The fixture generator needs at least this many clubs, in an even number. */
export const MIN_DIVISION_CLUBS = 4;

/** Stable division id for a country/level pair, e.g. "ENG1". Matches the id
 * shape the engine already uses for authored divisions. */
export function divisionId(nat: string, level: number): string {
  return `${nat}${level}`;
}

/**
 * Group the flat club/league lists into one CountryDatabase per country.
 *
 * Only levels that the source actually ships are authored here. A country's
 * missing lower tiers are NOT invented — worldgen's procedural division
 * generator (lib/config/divisions.ts) fills those when the player asks for a
 * deeper ladder, which is exactly the "lower divisions use the generated
 * database" behaviour the design calls for.
 */
export function buildCountryDatabases(input: BuildInput): CountryDatabase[] {
  const { leagues, clubs, rostersByClub, overallsByClub, padDivision } = input;
  const leagueById = new Map(leagues.map((l) => [l.leagueId, l]));

  // country → level → clubs
  const byCountry = new Map<string, Map<number, Fl26Club[]>>();
  for (const club of clubs) {
    const league = leagueById.get(club.leagueId);
    const level = league?.level ?? club.level;
    const country = league?.country ?? club.country;
    if (!byCountry.has(country)) byCountry.set(country, new Map());
    const levels = byCountry.get(country)!;
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level)!.push(club);
  }

  const out: CountryDatabase[] = [];
  for (const [country, levels] of byCountry) {
    const nat = natFor(country, "XXX");
    const divisions: DivisionSeed[] = [];

    for (const level of [...levels.keys()].sort((a, b) => a - b)) {
      const clubsAtLevel = levels.get(level)!;

      const seeds: ClubSeed[] = clubsAtLevel
        .map((club) => {
          const players = rostersByClub.get(club.clubId) ?? [];
          const strength = squadStrength(overallsByClub.get(club.clubId) ?? []);
          const seed: ClubSeed = {
            name: club.name,
            short: club.short,
            colors: club.colors,
            rep: clubReputation(strength, club.capacity, level),
            stadium: club.stadium,
          };
          if (players.length) seed.players = players;
          return seed;
        })
        // Strongest first so the league table reads as a real pyramid and any
        // trimming below drops the weakest club, not an arbitrary one.
        .sort((a, b) => b.rep - a.rep);

      // The source covers some nations only partially (Croatia ships 2 clubs,
      // Cyprus 1). Rather than drop those countries entirely — they'd become
      // unselectable — top the division up to a legal size with generated clubs.
      // The real clubs are always kept; only the filler is invented.
      const want = Math.max(MIN_DIVISION_CLUBS, seeds.length + (seeds.length % 2));
      if (seeds.length < want) {
        const exclude = new Set(seeds.map((c) => c.name));
        seeds.push(...padDivision(nat, level, want - seeds.length, exclude));
      }

      const league = leagueById.get(clubsAtLevel[0].leagueId);
      divisions.push({
        id: divisionId(nat, level),
        name: league?.name ?? `${country} Division ${level}`,
        tier: level,
        clubs: seeds,
      });
    }

    // The engine requires a tier-1 division. A country whose only usable
    // division sits lower (or which has none) is skipped entirely — its clubs
    // simply aren't part of the default database.
    if (!divisions.some((d) => d.tier === 1)) continue;

    // Tiers must be contiguous from 1 for promotion/relegation to chain, so keep
    // the authored ladder only as deep as it runs unbroken.
    const contiguous: DivisionSeed[] = [];
    for (let tier = 1; ; tier++) {
      const div = divisions.find((d) => d.tier === tier);
      if (!div) break;
      contiguous.push(div);
    }

    out.push({
      schema: COUNTRY_DB_SCHEMA,
      code: nat,
      name: country,
      nat,
      homeShare: 0.6,
      divisions: contiguous,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Built-in database presets ──────────────────────────────────────────────
// Hand-authored, real-world-flavored country databases that ship with the game
// as static JSON under /public/database_presets. They are offered at new-game
// setup as a third database option (alongside the procedural default and a
// user-uploaded custom file) — a curated, ready-made world for that country.
//
// This is just a registry: the loader fetches the static asset on demand and
// runs it through the same validateCountryDB() that guards user uploads, so a
// preset can never introduce a shape the engine doesn't already accept.

import type { CountryDatabase } from "@/lib/database";
import { validateCountryDB } from "@/lib/database";

export interface PresetDef {
  /** 3-letter country code — matches CountryDatabase.code and player nat codes. */
  code: string;
  /** Display name shown in the picker. */
  name: string;
  /** Static asset filename under /public/database_presets. */
  file: string;
  /** One-line flavor for the picker (e.g. league + rough season). */
  blurb: string;
}

/** The presets bundled with the build. `code` must equal the JSON's own `code`,
 * and `file` follows the `<CODE>-country-db.json` naming in the assets folder.
 * The big five (matching the engine's procedural countries) lead; the rest are
 * alphabetical by display name. */
export const PRESETS: PresetDef[] = [
  { code: "ENG", name: "England", file: "ENG-country-db.json", blurb: "Premier League — real clubs & squads" },
  { code: "ESP", name: "Spain", file: "ESP-country-db.json", blurb: "La Liga — real clubs & squads" },
  { code: "ITA", name: "Italy", file: "ITA-country-db.json", blurb: "Serie A — real clubs & squads" },
  { code: "GER", name: "Germany", file: "GER-country-db.json", blurb: "Bundesliga — real clubs & squads" },
  { code: "FRA", name: "France", file: "FRA-country-db.json", blurb: "Ligue 1 — real clubs & squads" },
  { code: "ARG", name: "Argentina", file: "ARG-country-db.json", blurb: "Liga Profesional — real clubs & squads" },
  { code: "AUS", name: "Australia", file: "AUS-country-db.json", blurb: "A-League — real clubs & squads" },
  { code: "AUT", name: "Austria", file: "AUT-country-db.json", blurb: "Bundesliga — real clubs & squads" },
  { code: "BEL", name: "Belgium", file: "BEL-country-db.json", blurb: "Pro League — real clubs & squads" },
  { code: "BRA", name: "Brazil", file: "BRA-country-db.json", blurb: "Série A — real clubs & squads" },
  { code: "COL", name: "Colombia", file: "COL-country-db.json", blurb: "Categoría Primera A — real clubs & squads" },
  { code: "CRO", name: "Croatia", file: "CRO-country-db.json", blurb: "HNL — real clubs & squads" },
  { code: "CZE", name: "Czech Republic", file: "CZE-country-db.json", blurb: "Chance Liga — real clubs & squads" },
  { code: "DEN", name: "Denmark", file: "DEN-country-db.json", blurb: "Superliga — real clubs & squads" },
  { code: "GRE", name: "Greece", file: "GRE-country-db.json", blurb: "Super League — real clubs & squads" },
  { code: "JPN", name: "Japan", file: "JPN-country-db.json", blurb: "J1 League — real clubs & squads" },
  { code: "MEX", name: "Mexico", file: "MEX-country-db.json", blurb: "Liga MX — real clubs & squads" },
  { code: "NED", name: "Netherlands", file: "NED-country-db.json", blurb: "Eredivisie — real clubs & squads" },
  { code: "NOR", name: "Norway", file: "NOR-country-db.json", blurb: "Eliteserien — real clubs & squads" },
  { code: "POL", name: "Poland", file: "POL-country-db.json", blurb: "Ekstraklasa — real clubs & squads" },
  { code: "POR", name: "Portugal", file: "POR-country-db.json", blurb: "Liga Portugal — real clubs & squads" },
  { code: "ROU", name: "Romania", file: "ROU-country-db.json", blurb: "SuperLiga — real clubs & squads" },
  { code: "RUS", name: "Russia", file: "RUS-country-db.json", blurb: "Premier Liga — real clubs & squads" },
  { code: "KSA", name: "Saudi Arabia", file: "KSA-country-db.json", blurb: "Saudi Pro League — real clubs & squads" },
  { code: "SCO", name: "Scotland", file: "SCO-country-db.json", blurb: "Scottish Premiership — real clubs & squads" },
  { code: "SRB", name: "Serbia", file: "SRB-country-db.json", blurb: "SuperLiga — real clubs & squads" },
  { code: "KOR", name: "South Korea", file: "KOR-country-db.json", blurb: "K League 1 — real clubs & squads" },
  { code: "SWE", name: "Sweden", file: "SWE-country-db.json", blurb: "Allsvenskan — real clubs & squads" },
  { code: "SUI", name: "Switzerland", file: "SUI-country-db.json", blurb: "Super League — real clubs & squads" },
  { code: "TUR", name: "Türkiye", file: "TUR-country-db.json", blurb: "Süper Lig — real clubs & squads" },
  { code: "UKR", name: "Ukraine", file: "UKR-country-db.json", blurb: "Premier Liha — real clubs & squads" },
  { code: "USA", name: "United States", file: "USA-country-db.json", blurb: "Major League Soccer — real clubs & squads" },
];

export const PRESET_MAP: Record<string, PresetDef> = Object.fromEntries(
  PRESETS.map((p) => [p.code, p])
);

export function getPreset(code: string): PresetDef | undefined {
  return PRESET_MAP[code];
}

// Presets are immutable static assets; cache the validated result so re-picking
// or toggling a country in the setup form doesn't re-fetch/re-parse each time.
const cache = new Map<string, Promise<CountryDatabase>>();

/** Fetch + validate a preset's database. Throws with a friendly message if the
 * asset is missing or (unexpectedly) fails the same validation as an upload. */
export function loadPreset(code: string): Promise<CountryDatabase> {
  const cached = cache.get(code);
  if (cached) return cached;

  const preset = PRESET_MAP[code];
  if (!preset) return Promise.reject(new Error(`No built-in preset for "${code}".`));

  const p = (async () => {
    const res = await fetch(`/database_presets/${preset.file}`);
    if (!res.ok) throw new Error(`Couldn't load the ${preset.name} preset (${res.status}).`);
    const json = await res.json();
    const result = validateCountryDB(json);
    if (!result.ok || !result.db) {
      throw new Error(`The ${preset.name} preset is invalid: ${result.errors[0] ?? "unknown error"}`);
    }
    return result.db;
  })();

  // Don't cache a rejected fetch — allow a retry on the next pick.
  p.catch(() => cache.delete(code));
  cache.set(code, p);
  return p;
}

/** The "default database" for a preset-only country: the preset's real league
 * and clubs, but with every hand-authored roster stripped so worldgen generates
 * the squads procedurally (exactly what "default" means for engine countries —
 * there just isn't a fictional club pool for these nations). */
export function proceduralFromPreset(db: CountryDatabase): CountryDatabase {
  return {
    ...db,
    divisions: db.divisions.map((d) => ({
      ...d,
      clubs: d.clubs.map((club) => {
        const { players: _players, ...rest } = club;
        return { ...rest };
      }),
    })),
  };
}

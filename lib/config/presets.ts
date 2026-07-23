// ── The default database (v1.47) ──────────────────────────────────────────
// The real-world database that ships with the game: 35 countries built from the
// FC 26 source data by `npm run build:db`, emitted as static country-db JSON
// under /public/database_presets and described by a manifest written alongside.
//
// This is now the DEFAULT world a new save is built from. The procedural
// generator is still there and still fully supported — it's the "Generated"
// choice at setup, and it remains the only source for lower divisions a country
// doesn't author (see lib/config/divisions.ts).
//
// This module is just a registry + loader: it fetches a static asset on demand
// and runs it through the same validateCountryDB() that guards user uploads, so
// the shipped data can never introduce a shape the engine doesn't accept.

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
  /** How many divisions this country's real database authors. */
  tiers?: number;
  /** Club / player counts, shown in the picker so the size of a country's real
   * database is visible before it's chosen. */
  clubs?: number;
  players?: number;
}

/** The generated manifest, imported at build time so the country picker can be
 * rendered synchronously — only the per-country JSON is fetched lazily. */
import manifest from "@/public/database_presets/manifest.json";

export const PRESETS: PresetDef[] = manifest as PresetDef[];

export const PRESET_MAP: Record<string, PresetDef> = Object.fromEntries(
  PRESETS.map((p) => [p.code, p])
);

export function getPreset(code: string): PresetDef | undefined {
  return PRESET_MAP[code];
}

/** Does this country ship a real (non-generated) database? */
export function hasPreset(code: string): boolean {
  return code in PRESET_MAP;
}

// Presets are immutable static assets; cache the validated result so re-picking
// or toggling a country in the setup form doesn't re-fetch/re-parse each time.
const cache = new Map<string, Promise<CountryDatabase>>();

/** Fetch + validate a country's real database. Throws with a friendly message if
 * the asset is missing or (unexpectedly) fails the same validation as an upload. */
export function loadPreset(code: string): Promise<CountryDatabase> {
  const cached = cache.get(code);
  if (cached) return cached;

  const preset = PRESET_MAP[code];
  if (!preset) return Promise.reject(new Error(`No built-in database for "${code}".`));

  const p = (async () => {
    const res = await fetch(`/database_presets/${preset.file}`);
    if (!res.ok) throw new Error(`Couldn't load the ${preset.name} database (${res.status}).`);
    const json = await res.json();
    const result = validateCountryDB(json);
    if (!result.ok || !result.db) {
      throw new Error(`The ${preset.name} database is invalid: ${result.errors[0] ?? "unknown error"}`);
    }
    return result.db;
  })();

  // Don't cache a rejected fetch — allow a retry on the next pick.
  p.catch(() => cache.delete(code));
  cache.set(code, p);
  return p;
}

/** The real clubs and leagues, but with every hand-authored roster stripped so
 * worldgen generates the squads procedurally. Used for the "Generated" choice in
 * countries that have no fictional club pool of their own, and for any tier the
 * source data doesn't author. */
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

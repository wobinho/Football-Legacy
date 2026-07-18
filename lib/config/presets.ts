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

/** The presets bundled with the build. `code` must equal the JSON's own `code`. */
export const PRESETS: PresetDef[] = [
  { code: "ENG", name: "England", file: "ENGLAND.json", blurb: "Premier League — real clubs & squads" },
  { code: "ESP", name: "Spain", file: "SPAIN.json", blurb: "La Liga — real clubs & squads" },
  { code: "ITA", name: "Italy", file: "ITALY.json", blurb: "Serie A — real clubs & squads" },
  { code: "GER", name: "Germany", file: "GERMANY.json", blurb: "Bundesliga — real clubs & squads" },
  { code: "FRA", name: "France", file: "FRANCE.json", blurb: "Ligue 1 — real clubs & squads" },
  { code: "POR", name: "Portugal", file: "PORTUGAL.json", blurb: "Primeira Liga — real clubs & squads" },
  { code: "TUR", name: "Türkiye", file: "TURKEY.json", blurb: "Süper Lig — real clubs & squads" },
  { code: "USA", name: "United States", file: "USA.json", blurb: "Major League Soccer — real clubs & squads" },
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

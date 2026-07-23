// ── Country database format (v7) ──────────────────────────────────────────
// The moddable unit of the world. A save is built by consolidating one
// CountryDatabase per selected country — either the built-in default (from
// lib/config/countries.ts) or a JSON file the user uploads at new-game setup.
//
// The format is intentionally small and forgiving: a country has divisions,
// each division has clubs, and each club MAY carry an explicit roster. If a
// club has no roster, worldgen fills it procedurally (the default behavior).
// This lets a modder hand-author a few marquee teams while leaving the rest of
// the world generated.

import type { Pos, Attributes } from "./types";
import type { ClubDef } from "./config/names";
import type { CountryDef } from "./config/countries";
import { getCountry } from "./config/countries";
import { POS_ORDER } from "./config/positions";

// v2 (attribute-driven): a player may be authored via the six raw attributes
// (Pace/Shooting/Passing/Dribbling/Defending/Physical), and `overall` is derived
// from them by position. v1 files (author `overall`, attrs generated) still load.
export const COUNTRY_DB_SCHEMA = "fl-country-db@2";
// Accepted on import for backward compatibility — v1 authored `overall` per player.
export const SUPPORTED_DB_SCHEMAS = ["fl-country-db@2", "fl-country-db@1"] as const;

/** One hand-authored player in a custom database. `name` + `positions` are always
 * required. Provide EITHER `attrs` (the six FIFA-style attributes — recommended;
 * overall is derived from them) OR `overall` (legacy; attrs generated from it).
 * If both are present, `attrs` wins and `overall` is ignored. Everything else is
 * optional and defaulted by worldgen. */
export interface PlayerSeed {
  name: string;
  positions: Pos[]; // first entry = primary
  /** The six attributes 1..99: { pac, sho, pas, dri, def, phy } (standard FIFA
   * order). For goalkeepers the same six slots carry keeper skills — def =
   * reflexes/handling, phy = aerial/diving. When present, overall is derived. */
  attrs?: Attributes;
  overall?: number; // 40..99 — legacy/optional. Ignored when `attrs` is present.
  age?: number; // default random 17..35
  nationality?: string; // 3-letter; defaults to the country's nat
  potential?: number; // default = overall + age headroom
  archetypeId?: string; // default: random archetype valid for the primary pos
  traits?: string[]; // default: rolled by position eligibility
  /** Weekly wage for the initial contract, honored verbatim when the player is
   * placed on a club (a roster member). Omit to let the wage curve set it. */
  wage?: number;
  /** Seasons remaining on the initial contract when the world is built (1..N).
   * Only meaningful for a rostered player; omit for the default staggered term. */
  contractYears?: number;
}

/** A club, optionally with an explicit roster. */
export interface ClubSeed extends ClubDef {
  players?: PlayerSeed[];
  /** Optional generated-squad strength (1–100). When set, worldgen sizes the
   * procedural squad off this instead of `rep` — so a created/modded club can be
   * a big-reputation club with a weak squad or vice versa. Roster players
   * authored in `players` are unaffected. */
  squadQuality?: number;
}

export interface DivisionSeed {
  id: string;
  name: string;
  tier: number;
  clubs: ClubSeed[];
}

/** A complete country database — the upload unit. */
export interface CountryDatabase {
  schema: string; // must equal COUNTRY_DB_SCHEMA
  code: string; // 3-letter country/nationality code
  name: string; // country display name
  nat: string; // dominant nationality pool
  homeShare?: number; // 0..1, default 0.6
  divisions: DivisionSeed[];
}

/** Build the built-in default database for a country code. */
export function defaultCountryDB(code: string): CountryDatabase | null {
  const c = getCountry(code);
  if (!c) return null;
  return countryDefToDatabase(c);
}

export function countryDefToDatabase(c: CountryDef): CountryDatabase {
  return {
    schema: COUNTRY_DB_SCHEMA,
    code: c.code,
    name: c.name,
    nat: c.nat,
    homeShare: c.homeShare,
    divisions: c.divisions.map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      clubs: d.clubs.map((club) => ({ ...club })),
    })),
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  db?: CountryDatabase;
}

// Derived from the canonical position list rather than hand-written, so a Pos
// added to the schema can never go missing here (LM/RM once did, which silently
// rejected any authored database using the wide-midfield positions).
const VALID_POS = new Set<string>(POS_ORDER);

/** Validate a parsed JSON object as a CountryDatabase, with friendly messages.
 * Returns the typed database on success so the caller can use it directly. */
export function validateCountryDB(json: unknown): ValidationResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (typeof json !== "object" || json === null) {
    return { ok: false, errors: ["File is not a JSON object."] };
  }
  const db = json as Record<string, unknown>;

  if (typeof db.schema !== "string" || !(SUPPORTED_DB_SCHEMAS as readonly string[]).includes(db.schema)) {
    push(`"schema" must be "${COUNTRY_DB_SCHEMA}" (got ${JSON.stringify(db.schema)}).`);
  }
  if (typeof db.code !== "string" || db.code.length < 2 || db.code.length > 4) {
    push(`"code" must be a 2–4 letter country code (e.g. "ENG").`);
  }
  if (typeof db.name !== "string" || !db.name.trim()) push(`"name" must be a non-empty country name.`);
  if (typeof db.nat !== "string" || !db.nat.trim()) push(`"nat" must be a 3-letter nationality code.`);
  if (db.homeShare !== undefined && (typeof db.homeShare !== "number" || db.homeShare < 0 || db.homeShare > 1)) {
    push(`"homeShare" must be a number between 0 and 1.`);
  }

  const divisions = db.divisions;
  if (!Array.isArray(divisions) || divisions.length === 0) {
    push(`"divisions" must be a non-empty array.`);
  } else {
    const seenIds = new Set<string>();
    divisions.forEach((d, di) => {
      const where = `divisions[${di}]`;
      if (typeof d !== "object" || d === null) return push(`${where} must be an object.`);
      const div = d as Record<string, unknown>;
      if (typeof div.id !== "string" || !div.id.trim()) push(`${where}.id must be a non-empty string.`);
      else if (seenIds.has(div.id)) push(`${where}.id "${div.id}" is duplicated — each division id must be unique.`);
      else seenIds.add(div.id);
      if (typeof div.name !== "string" || !div.name.trim()) push(`${where}.name must be a non-empty string.`);
      if (typeof div.tier !== "number" || div.tier < 1) push(`${where}.tier must be a number ≥ 1.`);
      const clubs = div.clubs;
      if (!Array.isArray(clubs) || clubs.length < 4) {
        push(`${where}.clubs must be an array of at least 4 clubs.`);
      } else if (clubs.length % 2 !== 0) {
        push(`${where}.clubs must have an even number of clubs (got ${clubs.length}).`);
      } else {
        clubs.forEach((c, ci) => validateClub(c, `${where}.clubs[${ci}]`, push));
      }
    });
    if (divisions.length > 0 && !divisions.some((d) => (d as Record<string, unknown>).tier === 1)) {
      push(`At least one division must be tier 1 (the top flight).`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], db: json as CountryDatabase };
}

function validateClub(c: unknown, where: string, push: (m: string) => void) {
  if (typeof c !== "object" || c === null) return push(`${where} must be an object.`);
  const club = c as Record<string, unknown>;
  if (typeof club.name !== "string" || !club.name.trim()) push(`${where}.name must be a non-empty string.`);
  if (typeof club.short !== "string" || club.short.length < 2 || club.short.length > 4)
    push(`${where}.short must be a 2–4 letter code.`);
  if (
    !Array.isArray(club.colors) ||
    club.colors.length !== 2 ||
    !club.colors.every((x) => typeof x === "string")
  )
    push(`${where}.colors must be [primaryHex, secondaryHex].`);
  if (typeof club.rep !== "number" || club.rep < 1 || club.rep > 100)
    push(`${where}.rep must be a reputation number 1–100.`);
  if (typeof club.stadium !== "string" || !club.stadium.trim()) push(`${where}.stadium must be a non-empty string.`);
  if (club.squadQuality !== undefined && (typeof club.squadQuality !== "number" || club.squadQuality < 1 || club.squadQuality > 100))
    push(`${where}.squadQuality must be a number 1–100 (or omitted to use rep).`);
  if (club.players !== undefined) {
    if (!Array.isArray(club.players)) push(`${where}.players must be an array (or omitted for a generated squad).`);
    else club.players.forEach((p, pi) => validatePlayerSeed(p, `${where}.players[${pi}]`, push));
  }
}

const ATTR_KEYS = ["pac", "sho", "pas", "dri", "def", "phy"] as const;

function validatePlayerSeed(p: unknown, where: string, push: (m: string) => void) {
  if (typeof p !== "object" || p === null) return push(`${where} must be an object.`);
  const seed = p as Record<string, unknown>;
  if (typeof seed.name !== "string" || !seed.name.trim()) push(`${where}.name must be a non-empty string.`);
  if (
    !Array.isArray(seed.positions) ||
    seed.positions.length === 0 ||
    !seed.positions.every((x) => typeof x === "string" && VALID_POS.has(x))
  )
    push(`${where}.positions must be a non-empty array of valid positions (GK, CB, …, ST).`);

  // A player is authored EITHER by the six attributes (preferred) OR by overall.
  const hasAttrs = seed.attrs !== undefined;
  const hasOverall = seed.overall !== undefined;
  if (!hasAttrs && !hasOverall) {
    push(`${where} must have either "attrs" (the six attributes) or "overall".`);
  }
  if (hasAttrs) {
    const a = seed.attrs;
    if (typeof a !== "object" || a === null || Array.isArray(a)) {
      push(`${where}.attrs must be an object with pac, sho, pas, dri, def, phy.`);
    } else {
      const attrs = a as Record<string, unknown>;
      for (const k of ATTR_KEYS) {
        const v = attrs[k];
        if (typeof v !== "number" || v < 1 || v > 99)
          push(`${where}.attrs.${k} must be a number 1–99.`);
      }
    }
  }
  if (hasOverall && (typeof seed.overall !== "number" || seed.overall < 40 || seed.overall > 99))
    push(`${where}.overall must be a number 40–99.`);
  if (seed.age !== undefined && (typeof seed.age !== "number" || seed.age < 15 || seed.age > 40))
    push(`${where}.age must be a number 15–40.`);
  if (seed.wage !== undefined && (typeof seed.wage !== "number" || seed.wage < 0))
    push(`${where}.wage must be a non-negative number (weekly wage).`);
  if (
    seed.contractYears !== undefined &&
    (typeof seed.contractYears !== "number" || seed.contractYears < 1 || seed.contractYears > 6)
  )
    push(`${where}.contractYears must be a number 1–6 (seasons remaining).`);
}

/** A downloadable JSON template for the custom-database guide. Small but
 * complete: one 4-club division, one club with an explicit roster showing the
 * attribute-driven authoring (attrs: pac, sho, pas, dri, def, phy — overall is
 * derived), plus a goalkeeper and a legacy overall-only player for reference. */
export function countryDBTemplate(code = "XXX"): string {
  const template: CountryDatabase = {
    schema: COUNTRY_DB_SCHEMA,
    code,
    name: "My Country",
    nat: code,
    homeShare: 0.6,
    divisions: [
      {
        id: `${code}1`,
        name: "My Top Division",
        tier: 1,
        clubs: [
          {
            name: "First Club FC",
            short: "FCF",
            colors: ["#c8102e", "#ffffff"],
            rep: 82,
            stadium: "First Ground",
            players: [
              // Attribute-driven (recommended): the six FIFA-order attrs; overall
              // is derived from them by position. A lopsided elite still rates high.
              { name: "Alex Star", positions: ["ST"], attrs: { pac: 96, sho: 99, pas: 60, dri: 88, def: 30, phy: 88 }, age: 25, potential: 91 },
              { name: "Sam Anchor", positions: ["CB"], attrs: { pac: 72, sho: 40, pas: 68, dri: 55, def: 88, phy: 86 }, age: 28 },
              // Goalkeeper: same six slots — def = reflexes/handling, phy = aerial/diving.
              { name: "Gary Gloves", positions: ["GK"], attrs: { pac: 55, sho: 44, pas: 62, dri: 55, def: 86, phy: 91 }, age: 27 },
              // Legacy (still valid): author overall, attrs are generated from it.
              { name: "Old School", positions: ["CM"], overall: 78, age: 24 },
            ],
          },
          { name: "Second Club", short: "SEC", colors: ["#034694", "#dba111"], rep: 74, stadium: "Second Park" },
          { name: "Third Club", short: "THI", colors: ["#000000", "#ffffff"], rep: 66, stadium: "Third Field" },
          { name: "Fourth Club", short: "FOU", colors: ["#0057b8", "#ffffff"], rep: 60, stadium: "Fourth Arena" },
        ],
      },
    ],
  };
  return JSON.stringify(template, null, 2);
}

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
import { ATTR_KEYS, expandLegacyAttrs, isLegacyAttrs } from "./config/attributes";
import { getArchetype } from "./config/archetypes";

// v2 (attribute-driven): a player may be authored via the six raw attributes
// (Pace/Shooting/Passing/Dribbling/Defending/Physical), and `overall` is derived
// from them by position. v1 files (author `overall`, attrs generated) still load.
export const COUNTRY_DB_SCHEMA = "fl-country-db@2";
// Accepted on import for backward compatibility — v1 authored `overall` per player.
export const SUPPORTED_DB_SCHEMAS = ["fl-country-db@2", "fl-country-db@1"] as const;

/** One hand-authored player in a custom database. `name` + `positions` are always
 * required. Provide EITHER `attrs` (the 35 attributes — recommended; overall is
 * derived from them) OR `overall` (legacy; attrs generated from it). If both are
 * present, `attrs` wins and `overall` is ignored. Everything else is optional and
 * defaulted by worldgen. */
export interface PlayerSeed {
  /** Short display name, as it reads in a list ("G. Donnarumma"). */
  name: string;
  /** Full name for the profile header ("Gianluigi Donnarumma"). Optional — omit
   * it (or repeat `name`) and the UI simply shows the short form everywhere. */
  fullName?: string;
  positions: Pos[]; // first entry = primary
  /** The 35 attributes, each 1..99 — see lib/config/attributes.ts for the keys.
   * PARTIAL sets are allowed: whatever is authored wins, and anything omitted
   * keeps the procedurally-generated value for that player, so a seed can
   * specify three attributes without flattening the other 32. When present at
   * all, overall is derived from the finished set. */
  attrs?: Partial<Attributes>;
  overall?: number; // 40..99 — legacy/optional. Ignored when `attrs` is present.
  age?: number; // default random 17..35
  nationality?: string; // 3-letter; defaults to the country's nat
  potential?: number; // default = overall + age headroom
  /** Height in centimetres (150..215). Optional — omitted, it is rolled from the
   * archetype's height band as before. */
  heightCm?: number;
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
  /** Optional target AVERAGE OVERALL (40–94) for the club's generated squad
   * (v1.51). Unlike `squadQuality` — an abstract 1–100 strength dial — this is
   * the number the squad actually averages: worldgen solves for the per-slot
   * level that lands the generated players on this mean. Takes precedence over
   * `squadQuality`/`rep` when set.
   *
   * Authored roster players (`players`) are deliberately EXCLUDED from the
   * average: the target describes the players the game generates, so adding a
   * hand-made superstar never drags the rest of the squad down to compensate. */
  squadAvgOverall?: number;
  /** Optional starting transfer budget in pounds (v1.51). When set, the club
   * opens the save with exactly this much rather than the reputation-derived
   * `clubBudget(rep)`. */
  budget?: number;
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
/**
 * Upgrade any pre-v41 six-attribute rosters in a database to the 35-attribute
 * model, in place (v41).
 *
 * Databases authored against the old schema — the hand-authored countries the
 * FC 26 source doesn't cover, and any custom database a user already has — carry
 * `attrs: {pac, sho, pas, dri, def, phy}`. Left alone those players would fail
 * validation and the whole country would become unselectable, which the format's
 * back-compatibility promise forbids. So the legacy shape is simply expanded on
 * load, using the same conversion the v40→v41 save migration applies.
 *
 * A database already on the new model is untouched, so this is idempotent.
 */
export function upgradeLegacyAttrsInDB(json: unknown): void {
  if (typeof json !== "object" || json === null) return;
  const db = json as Record<string, unknown>;
  const divisions = Array.isArray(db.divisions) ? db.divisions : [];
  for (const d of divisions) {
    const clubs = (d as Record<string, unknown>)?.clubs;
    if (!Array.isArray(clubs)) continue;
    for (const c of clubs) {
      const players = (c as Record<string, unknown>)?.players;
      if (!Array.isArray(players)) continue;
      for (const p of players) {
        if (typeof p !== "object" || p === null) continue;
        const seed = p as Record<string, unknown>;
        if (!isLegacyAttrs(seed.attrs)) continue;
        const positions = Array.isArray(seed.positions) ? seed.positions : [];
        const isGk = positions[0] === "GK";
        // The archetype (if authored) supplies the within-family detail; without
        // one the six aggregates fan out evenly, which is still a valid player.
        const profile =
          typeof seed.archetypeId === "string" ? getArchetype(seed.archetypeId).attrProfile : undefined;
        seed.attrs = expandLegacyAttrs(seed.attrs, isGk, profile);
      }
    }
  }
}

export function validateCountryDB(json: unknown): ValidationResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (typeof json !== "object" || json === null) {
    return { ok: false, errors: ["File is not a JSON object."] };
  }
  // Bring a legacy-authored roster onto the current attribute model before
  // validating it, so an old database stays loadable.
  upgradeLegacyAttrsInDB(json);
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
  if (
    club.squadAvgOverall !== undefined &&
    (typeof club.squadAvgOverall !== "number" || club.squadAvgOverall < 40 || club.squadAvgOverall > 94)
  )
    push(`${where}.squadAvgOverall must be an average overall 40–94 (or omitted).`);
  if (club.budget !== undefined && (typeof club.budget !== "number" || !Number.isFinite(club.budget) || club.budget < 0))
    push(`${where}.budget must be a starting budget of 0 or more (or omitted to derive it from rep).`);
  if (club.players !== undefined) {
    if (!Array.isArray(club.players)) push(`${where}.players must be an array (or omitted for a generated squad).`);
    else club.players.forEach((p, pi) => validatePlayerSeed(p, `${where}.players[${pi}]`, push));
  }
}

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

  // A player is authored EITHER by the attributes (preferred) OR by overall.
  const hasAttrs = seed.attrs !== undefined;
  const hasOverall = seed.overall !== undefined;
  if (!hasAttrs && !hasOverall) {
    push(`${where} must have either "attrs" (the player's attributes) or "overall".`);
  }
  if (hasAttrs) {
    const a = seed.attrs;
    if (typeof a !== "object" || a === null || Array.isArray(a)) {
      push(`${where}.attrs must be an object of attribute names to numbers 1–99.`);
    } else {
      const attrs = a as Record<string, unknown>;
      const valid = new Set<string>(ATTR_KEYS);
      const authored = Object.keys(attrs);
      if (authored.length === 0) push(`${where}.attrs must name at least one attribute.`);
      for (const k of authored) {
        // A partial set is legal — anything omitted is generated — but a key
        // that isn't an attribute at all is almost always a typo, and silently
        // ignoring it would ship a player who isn't the one that was authored.
        if (!valid.has(k)) {
          push(`${where}.attrs.${k} is not a known attribute (see the template for the full list).`);
          continue;
        }
        const v = attrs[k];
        if (typeof v !== "number" || v < 1 || v > 99) push(`${where}.attrs.${k} must be a number 1–99.`);
      }
    }
  }
  if (hasOverall && (typeof seed.overall !== "number" || seed.overall < 40 || seed.overall > 99))
    push(`${where}.overall must be a number 40–99.`);
  if (seed.age !== undefined && (typeof seed.age !== "number" || seed.age < 15 || seed.age > 40))
    push(`${where}.age must be a number 15–40.`);
  if (seed.heightCm !== undefined && (typeof seed.heightCm !== "number" || seed.heightCm < 150 || seed.heightCm > 215))
    push(`${where}.heightCm must be a number 150–215 (centimetres).`);
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
 * attribute-driven authoring (overall is derived from the attributes), a
 * partial-attribute player, a goalkeeper, and a legacy overall-only player. */
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
              // Attribute-driven (recommended). Overall is DERIVED from these by
              // position, so a lopsided elite still rates high. Any attribute you
              // leave out is generated for you — see "Half Authored" below.
              {
                name: "Alex Star",
                positions: ["ST"],
                age: 25,
                potential: 91,
                heightCm: 186,
                attrs: {
                  finishing: 94, positioning: 92, ballControl: 88, headingAccuracy: 85,
                  shotPower: 91, reactions: 90, dribbling: 87, shortPassing: 78,
                  strength: 84, sprintSpeed: 93, acceleration: 94, longShots: 82,
                  volleys: 83, jumping: 80, penalties: 84, composure: 88,
                  vision: 74, longPassing: 70, crossing: 68, curve: 72,
                  fkAccuracy: 66, agility: 88, balance: 82, stamina: 80,
                  aggression: 62, interceptions: 30, markingAwareness: 26,
                  standingTackle: 28, slidingTackle: 24,
                  diving: 10, handling: 11, kicking: 12, gkPositioning: 9,
                  reflexes: 13, gkSpeed: 40,
                },
              },
              // Partial authoring: name only what matters to you. Everything else
              // is rolled from the archetype, so this is a real centre-back.
              {
                name: "Half Authored",
                positions: ["CB"],
                age: 28,
                attrs: { standingTackle: 88, markingAwareness: 87, interceptions: 85, strength: 86 },
              },
              // Goalkeeper: the six goalkeeping attributes are what rate him.
              {
                name: "Gary Gloves",
                positions: ["GK"],
                age: 27,
                attrs: {
                  diving: 86, handling: 84, reflexes: 88, gkPositioning: 85,
                  kicking: 72, gkSpeed: 48, reactions: 87, composure: 80,
                },
              },
              // Legacy (still valid): author overall, attributes generated from it.
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

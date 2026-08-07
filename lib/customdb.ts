// ── Custom content library (v25) ──────────────────────────────────────────
// A persistent, reusable library of hand-made clubs and players. The existing
// create-a-club / create-a-player flow (MainMenu) was ephemeral: whatever you
// designed was spliced into worldgen once and then lost. This layer lets the
// user build a stock of custom clubs and players ONCE, save them, and pull any
// of them into any new legacy.
//
// Storage mirrors lib/save.ts: local IndexedDB, namespaced by the active
// game-key owner so two keys on one device keep separate libraries. It is a
// small, self-contained store — no cloud sync (the library is a setup-time
// convenience, not part of a running save's state).
//
// The stored shapes are deliberately the SAME seeds worldgen already consumes
// (ClubSeed / PlayerSeed via lib/database.ts), so a saved club or player is
// spliced in exactly like a freshly-authored one — no engine code knows the
// content came from the library.

import type { Attributes, Foot, Pos } from "./types";
import type { BadgeSpec } from "./visual/badge";
import type { KitSet } from "./visual/kit";
import type { ClubSeed, PlayerSeed } from "./database";
import { normalizeAttrs, uniformAttrs } from "./config/attributes";
import { overallFromAttrs } from "./config/positions";
import { cloudOwner } from "./cloud";

export const LIBRARY_SCHEMA = "fl-library@1";

/** A saved custom club. Carries the full ClubSeed (identity, reputation,
 * starting budget, generated-squad level, and an optional hand-authored roster)
 * plus library metadata. Everything but the identity fields is optional exactly
 * as in ClubSeed. */
export interface LibraryClub {
  id: string;
  name: string;
  short: string;
  colors: [string, string];
  rep: number;
  stadium: string;
  /** Legacy 1–100 strength dial. Clubs authored from v1.51 on set
   * `squadAvgOverall` instead; this is still honored for older saved clubs. */
  squadQuality?: number;
  /** Target average overall of the GENERATED squad (v1.51). Authored roster
   * players are excluded from the average — see ClubSeed.squadAvgOverall. */
  squadAvgOverall?: number;
  /** Starting transfer budget in pounds (v1.51). */
  budget?: number;
  /** An authored crest and kit set (v1.96). Absent for a club nobody has
   * designed — it still has both, derived from its name and colours. */
  badge?: BadgeSpec;
  kits?: KitSet;
  players?: PlayerSeed[];
  updatedAt: number;
}

/** A saved custom player. Stores the attribute-driven PlayerSeed fields (name,
 * positions, the six attrs, age, nationality, potential, archetype, traits) —
 * everything needed to splice the player into any club roster at new-game. */
export interface LibraryPlayer {
  id: string;
  name: string;
  /** Full name for the profile header (v27). Optional — an entry authored in
   * the editor normally carries one name, and the UI falls back to `name`. */
  fullName?: string;
  positions: Pos[]; // [primary, ...secondaries]
  attrs: Attributes;
  age: number;
  nationality: string;
  potential: number;
  /** Preferred foot (v42). Optional — omitted, worldgen rolls one from the
   * primary position's split when the player is materialized. */
  foot?: Foot;
  /** The training plan the player starts on — and so the archetype he reads as
   * (v1.77). */
  trainingPlan?: string;
  traits: string[];
  updatedAt: number;
}

/**
 * A saved WORLD preset (v1.93): which other countries a new legacy includes,
 * how deep each of their pyramids runs, and the European qualification design.
 *
 * These are the two most laborious parts of setting up a legacy and the two
 * least likely to change between saves — a manager who has decided that his
 * world is England, Spain, Italy, Germany and France with a particular set of
 * Champions League slots has to rebuild that by hand on every new legacy,
 * clicking through twenty countries and then a position grid per country. It is
 * setup, not gameplay, and re-doing it is pure friction.
 *
 * Deliberately does NOT store the playable country, the club, the start tier or
 * the takeover. Those are the CHOICES a new legacy is about; a preset that also
 * picked your club would be a saved game rather than a saved world, and the
 * whole point is to vary the career against a settled backdrop.
 *
 * It also does not store per-country database choices (real vs generated).
 * Those are keyed to countries a preset may or may not include, and silently
 * switching a country to a generated world because a preset said so is the kind
 * of surprise that makes a convenience feature untrustworthy.
 */
export interface WorldPreset {
  id: string;
  name: string;
  /** Sim-only countries to include, as country codes. */
  viewCountries: string[];
  /** How many tiers each country runs, keyed by code. Sparse: a country absent
   * from the map falls back to however many its database authors. */
  divisionDepths: Record<string, number>;
  /** How many continental competitions run (0 = none). */
  europeanTiers: number;
  /** The qualification design: which cup each finishing position feeds, keyed
   * by country code. Sparse — worldgen falls back to the engine defaults for
   * any country left unauthored, which is what lets a preset stay valid when
   * it is applied to a save that includes a country it never named. */
  europeanSlots: Record<string, number[]>;
  cupWinnerQualifies: boolean;
  updatedAt: number;
}

/**
 * A permanent edit to a club that SHIPS with the game (v2.0).
 *
 * The library's custom clubs answer "I want a club that doesn't exist"; this
 * answers the different question "Real Madrid's crest is wrong and I want it
 * fixed in every legacy I ever start". Before this the only route was to import
 * Real Madrid as a custom club, edit the copy, and then remember to place it
 * over the original at every new game — which leaves two Real Madrids in the
 * setup screen and silently reverts the moment you forget.
 *
 * Three rules, and each is the reason this is an OVERRIDE rather than a copy:
 *
 * **It is a PATCH, not a club.** Every field is optional and only the ones
 * present are applied, so an override that sets a badge changes the badge and
 * nothing else. That is what lets a rebuilt default database (`npm run build:db`
 * regenerates the shipped JSON from the CSVs, and squads change when it does)
 * keep reaching a club the user has re-crested — the alternative, storing a
 * whole edited copy, would freeze that club's squad at whatever it was on the
 * day it was edited and quietly opt it out of every future database update.
 *
 * **It is keyed by country + club NAME**, not by an id. Shipped clubs have no
 * stable id — `defaultCountryDB` builds them fresh from the country definition
 * every call — and the name is what the visual system already keys a derived
 * badge on (v1.96), so identity travels the same way in both places.
 *
 * **It applies at `dbForChoice`**, the one funnel every database choice passes
 * through at new-game setup, so an override reaches the real database, a
 * preset-derived generated world and an uploaded one alike. Nothing in a
 * RUNNING save reads it: a world is built once, and a save already carries its
 * own clubs. Editing an override changes the next legacy, never the current one.
 */
export interface ClubOverride {
  /** Country code the club is authored in, e.g. "ESP". */
  country: string;
  /** The shipped club's name, exactly as the database spells it. The match key. */
  clubName: string;
  // ── The patch. Every field optional; absent means "leave the shipped value".
  name?: string;
  short?: string;
  colors?: [string, string];
  rep?: number;
  stadium?: string;
  badge?: BadgeSpec;
  kits?: KitSet;
  updatedAt: number;
}

/** The key an override is stored and looked up under. */
export function overrideKey(country: string, clubName: string): string {
  return `${country.toUpperCase()}|${clubName.trim().toLowerCase()}`;
}

/**
 * Apply the user's permanent club edits to a country database, in place.
 *
 * A no-op when nothing has been overridden, which is the case that has to stay
 * free — this runs on every database resolution at setup, for every included
 * country.
 *
 * `name` is deliberately patchable: renaming Real Madrid is a legitimate edit,
 * and the override keeps matching afterwards because it is keyed on the
 * ORIGINAL shipped name rather than on whatever the club is called now.
 */
export function applyClubOverrides<
  T extends { divisions: { clubs: ClubSeed[] }[] },
>(db: T, country: string, overrides: ClubOverride[]): T {
  if (!overrides.length) return db;
  const byKey = new Map(overrides.map((o) => [overrideKey(o.country, o.clubName), o]));
  for (const d of db.divisions) {
    for (let i = 0; i < d.clubs.length; i++) {
      const c = d.clubs[i];
      const o = byKey.get(overrideKey(country, c.name));
      if (!o) continue;
      d.clubs[i] = {
        ...c,
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.short !== undefined ? { short: o.short } : {}),
        ...(o.colors !== undefined ? { colors: [...o.colors] as [string, string] } : {}),
        ...(o.rep !== undefined ? { rep: o.rep } : {}),
        ...(o.stadium !== undefined ? { stadium: o.stadium } : {}),
        // A cleared crest deletes the field rather than storing a copy of the
        // generated one — the v1.96 rule, so improving the generator still
        // reaches a club whose override no longer names a badge.
        ...(o.badge !== undefined ? { badge: o.badge } : {}),
        ...(o.kits !== undefined ? { kits: o.kits } : {}),
      };
    }
  }
  return db;
}

/** Everything a saved library holds, as it lives in one IndexedDB record. */
export interface CustomLibrary {
  schema: string;
  clubs: LibraryClub[];
  players: LibraryPlayer[];
  /** Saved new-game world setups (v1.93). Optional in the stored record so a
   * library written before they existed loads without migration. */
  worldPresets?: WorldPreset[];
  /** Permanent edits to SHIPPED clubs (v2.0). Optional for the same reason
   * `worldPresets` is, and the schema was NOT bumped for it — see `loadLibrary`. */
  clubOverrides?: ClubOverride[];
}

export function emptyLibrary(): CustomLibrary {
  return { schema: LIBRARY_SCHEMA, clubs: [], players: [], worldPresets: [], clubOverrides: [] };
}

/** Strip a LibraryClub down to the ClubSeed worldgen consumes. */
export function libraryClubToSeed(c: LibraryClub): ClubSeed {
  return {
    name: c.name,
    short: c.short,
    colors: c.colors,
    rep: c.rep,
    stadium: c.stadium,
    ...(c.squadQuality !== undefined ? { squadQuality: c.squadQuality } : {}),
    ...(c.squadAvgOverall !== undefined ? { squadAvgOverall: c.squadAvgOverall } : {}),
    ...(c.budget !== undefined ? { budget: c.budget } : {}),
    ...(c.badge ? { badge: c.badge } : {}),
    ...(c.kits ? { kits: c.kits } : {}),
    ...(c.players && c.players.length ? { players: c.players.map((p) => ({ ...p })) } : {}),
  };
}

/** Strip a LibraryPlayer down to the PlayerSeed worldgen consumes. */
export function libraryPlayerToSeed(p: LibraryPlayer): PlayerSeed {
  return {
    name: p.name,
    ...(p.fullName ? { fullName: p.fullName } : {}),
    positions: [...p.positions],
    attrs: { ...p.attrs },
    age: p.age,
    nationality: p.nationality,
    potential: p.potential,
    ...(p.foot ? { foot: p.foot } : {}),
    ...(p.trainingPlan ? { trainingPlan: p.trainingPlan } : {}),
    ...(p.traits.length ? { traits: [...p.traits] } : {}),
  };
}

/** A short, collision-resistant id for a new library entry. */
export function libraryId(prefix: "club" | "player" | "world"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ── Importing from the shipped default database (v1.47) ────────────────────
// The editor can pull any real club or player in as an editable library entry.
// Both directions already speak the same seed shapes, so importing is just
// filling in the fields a seed leaves optional (worldgen would otherwise roll
// them) and stamping a fresh library id. The import is a COPY — editing it
// never touches the shipped asset on disk.

/** Default attributes for a seed authored the legacy way (overall, no attrs),
 * or for the attributes a partial seed left out.
 *
 * Flat across every attribute so the derived overall lands on the authored
 * number: each position's weight row sums to ~1.0, so a uniform line of `v`
 * rates ~v wherever the player is played. The editor is then free to shape it. */
function attrsFromOverall(overall: number): Attributes {
  return uniformAttrs(Math.max(1, Math.min(99, Math.round(overall))));
}

/** Convert a database PlayerSeed into an editable library player. A seed may
 * author only some of the 35 attributes (or none at all); the library entry is
 * always complete, so the editor has every slider to work with. */
export function seedToLibraryPlayer(seed: PlayerSeed, fallbackNat: string): LibraryPlayer {
  const base = attrsFromOverall(
    seed.overall ?? (seed.attrs ? overallFromAttrs(normalizeAttrs(seed.attrs), seed.positions[0]) : 60)
  );
  const attrs = { ...base, ...(seed.attrs ?? {}) } as Attributes;
  const age = seed.age ?? 24;
  return {
    id: libraryId("player"),
    name: seed.name,
    ...(seed.fullName ? { fullName: seed.fullName } : {}),
    positions: [...seed.positions],
    attrs,
    age,
    nationality: seed.nationality ?? fallbackNat,
    // A seed may omit potential; give a still-growing player a little headroom.
    potential: seed.potential ?? Math.min(96, Math.round(overallFromAttrs(attrs, seed.positions[0]) + 4)),
    ...(seed.foot ? { foot: seed.foot } : {}),
    ...(seed.trainingPlan ? { trainingPlan: seed.trainingPlan } : {}),
    traits: seed.traits ? [...seed.traits] : [],
    updatedAt: Date.now(),
  };
}

/** Convert a database ClubSeed into an editable library club. Its authored
 * roster (if any) comes along verbatim as PlayerSeeds. */
export function seedToLibraryClub(seed: ClubSeed): LibraryClub {
  return {
    id: libraryId("club"),
    name: seed.name,
    short: seed.short,
    colors: [...seed.colors] as [string, string],
    rep: seed.rep,
    stadium: seed.stadium,
    ...(seed.squadQuality !== undefined ? { squadQuality: seed.squadQuality } : {}),
    ...(seed.squadAvgOverall !== undefined ? { squadAvgOverall: seed.squadAvgOverall } : {}),
    ...(seed.budget !== undefined ? { budget: seed.budget } : {}),
    ...(seed.badge ? { badge: seed.badge } : {}),
    ...(seed.kits ? { kits: seed.kits } : {}),
    ...(seed.players?.length ? { players: seed.players.map((p) => ({ ...p })) } : {}),
    updatedAt: Date.now(),
  };
}

// ── IndexedDB (its own DB, one record per owner) ────────────────────────────

const DB_NAME = "football-legacy-library";
const STORE = "library";

function owner(): string {
  return cloudOwner() ?? "local";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Load this owner's library, or an empty one if none has been saved yet. */
export async function loadLibrary(): Promise<CustomLibrary> {
  try {
    const db = await openDB();
    const raw = (await tx(db, "readonly", (s) => s.get(owner()))) as CustomLibrary | undefined;
    db.close();
    if (!raw || raw.schema !== LIBRARY_SCHEMA) return emptyLibrary();
    // Defensive: never hand back a partial shape. `worldPresets` (v1.93) is
    // read the same way and defaults to empty, which is why the schema string
    // did NOT need bumping — a library written before world presets existed is
    // a valid one that simply has none, and bumping would have discarded every
    // saved club and player on the device to add an optional field.
    return {
      schema: LIBRARY_SCHEMA,
      clubs: Array.isArray(raw.clubs) ? raw.clubs : [],
      players: Array.isArray(raw.players) ? raw.players : [],
      worldPresets: Array.isArray(raw.worldPresets) ? raw.worldPresets : [],
      // v2.0, and the schema was not bumped for the same reason: an override
      // list is optional and defaults to empty, so a library written before
      // they existed is a valid one that simply has none. Bumping would have
      // discarded every saved club, player and world preset on the device.
      clubOverrides: Array.isArray(raw.clubOverrides) ? raw.clubOverrides : [],
    };
  } catch {
    return emptyLibrary();
  }
}

/** Persist this owner's entire library (the store holds one record per owner). */
export async function persistLibrary(lib: CustomLibrary): Promise<void> {
  const db = await openDB();
  await tx(db, "readwrite", (s) => s.put({ ...lib, schema: LIBRARY_SCHEMA }, owner()));
  db.close();
}

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

import type { Attributes, Pos } from "./types";
import type { ClubSeed, PlayerSeed } from "./database";
import { cloudOwner } from "./cloud";

export const LIBRARY_SCHEMA = "fl-library@1";

/** A saved custom club. Carries the full ClubSeed (identity, reputation,
 * squad-quality, and an optional hand-authored roster) plus library metadata.
 * `squadQuality` and `players` are optional exactly as in ClubSeed. */
export interface LibraryClub {
  id: string;
  name: string;
  short: string;
  colors: [string, string];
  rep: number;
  stadium: string;
  squadQuality?: number;
  players?: PlayerSeed[];
  updatedAt: number;
}

/** A saved custom player. Stores the attribute-driven PlayerSeed fields (name,
 * positions, the six attrs, age, nationality, potential, archetype, traits) —
 * everything needed to splice the player into any club roster at new-game. */
export interface LibraryPlayer {
  id: string;
  name: string;
  positions: Pos[]; // [primary, ...secondaries]
  attrs: Attributes;
  age: number;
  nationality: string;
  potential: number;
  archetypeId?: string;
  traits: string[];
  updatedAt: number;
}

/** Everything a saved library holds, as it lives in one IndexedDB record. */
export interface CustomLibrary {
  schema: string;
  clubs: LibraryClub[];
  players: LibraryPlayer[];
}

export function emptyLibrary(): CustomLibrary {
  return { schema: LIBRARY_SCHEMA, clubs: [], players: [] };
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
    ...(c.players && c.players.length ? { players: c.players.map((p) => ({ ...p })) } : {}),
  };
}

/** Strip a LibraryPlayer down to the PlayerSeed worldgen consumes. */
export function libraryPlayerToSeed(p: LibraryPlayer): PlayerSeed {
  return {
    name: p.name,
    positions: [...p.positions],
    attrs: { ...p.attrs },
    age: p.age,
    nationality: p.nationality,
    potential: p.potential,
    ...(p.archetypeId ? { archetypeId: p.archetypeId } : {}),
    ...(p.traits.length ? { traits: [...p.traits] } : {}),
  };
}

/** A short, collision-resistant id for a new library entry. */
export function libraryId(prefix: "club" | "player"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ── Importing from the shipped default database (v1.47) ────────────────────
// The editor can pull any real club or player in as an editable library entry.
// Both directions already speak the same seed shapes, so importing is just
// filling in the fields a seed leaves optional (worldgen would otherwise roll
// them) and stamping a fresh library id. The import is a COPY — editing it
// never touches the shipped asset on disk.

/** Default attributes for a seed authored the legacy way (overall, no attrs).
 * Flat across all six slots so the derived overall lands on the authored number. */
function attrsFromOverall(overall: number): Attributes {
  const v = Math.max(1, Math.min(99, Math.round(overall)));
  return { pac: v, sho: v, pas: v, dri: v, def: v, phy: v };
}

/** Convert a database PlayerSeed into an editable library player. */
export function seedToLibraryPlayer(seed: PlayerSeed, fallbackNat: string): LibraryPlayer {
  const attrs = seed.attrs ? { ...seed.attrs } : attrsFromOverall(seed.overall ?? 60);
  const age = seed.age ?? 24;
  return {
    id: libraryId("player"),
    name: seed.name,
    positions: [...seed.positions],
    attrs,
    age,
    nationality: seed.nationality ?? fallbackNat,
    // A seed may omit potential; give a still-growing player a little headroom.
    potential: seed.potential ?? Math.min(96, Math.round(Math.max(...Object.values(attrs)))),
    ...(seed.archetypeId ? { archetypeId: seed.archetypeId } : {}),
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
    // Defensive: never hand back a partial shape.
    return {
      schema: LIBRARY_SCHEMA,
      clubs: Array.isArray(raw.clubs) ? raw.clubs : [],
      players: Array.isArray(raw.players) ? raw.players : [],
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

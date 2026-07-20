// Save System (§13): local-first persistence with optional cloud sync.
//
// Two layers behind one interface:
//   • Local IndexedDB — always present, offline-friendly, namespaced by the
//     active game-key owner so keys act as separate accounts on one device.
//   • Cloud (Vercel KV, lib/cloud.ts) — when the deployment has it configured,
//     saves also live server-side so the same game key resumes across devices.
//
// Cloud is treated as the source of truth when available: list/load prefer it
// and fall back to local; every write goes to both so local stays a warm cache
// and things still work offline. JSON export/import (the modding format) is
// unchanged and owner-independent.

import type { GameState } from "./types";
import { SCHEMA_VERSION } from "./types";
import { isMigratable, migrateSave } from "./migrate";
import { cloudEnabled, cloudList, cloudLoad, cloudSave, cloudDelete, cloudOwner } from "./cloud";

const DB_NAME = "football-legacy";
const STORE = "saves";

export interface SaveMeta {
  saveName: string;
  managerName: string;
  teamName: string;
  season: number;
  savedAt: number;
}

// ── Owner namespacing ───────────────────────────────────────────────────────
// The active game-key owner id. All local keys are prefixed with it so two
// players sharing a browser don't see each other's saves. `cloudOwner()` is the
// same id the cloud layer uses.

function owner(): string {
  return cloudOwner() ?? "local";
}
const saveKey = (name: string) => `${owner()}::${name}`;
const metaKey = (name: string) => `meta:${owner()}::${name}`;

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

// ── Local (IndexedDB) primitives ────────────────────────────────────────────

async function localPut(state: GameState): Promise<void> {
  const db = await openDB();
  await tx(db, "readwrite", (s) => s.put(state, saveKey(state.saveName)));
  const meta: SaveMeta = {
    saveName: state.saveName,
    managerName: state.managerName,
    teamName: state.teams[state.userTeamId]?.name ?? "?",
    season: state.season,
    savedAt: Date.now(),
  };
  await tx(db, "readwrite", (s) => s.put(meta, metaKey(state.saveName)));
  db.close();
}

async function localGet(saveName: string): Promise<GameState | null> {
  const db = await openDB();
  const state = (await tx(db, "readonly", (s) => s.get(saveKey(saveName)))) as GameState | undefined;
  db.close();
  return state ?? null;
}

async function localList(): Promise<SaveMeta[]> {
  const db = await openDB();
  const keys = (await tx(db, "readonly", (s) => s.getAllKeys())) as string[];
  const prefix = `meta:${owner()}::`;
  const metas: SaveMeta[] = [];
  for (const k of keys) {
    if (typeof k === "string" && k.startsWith(prefix)) {
      const m = (await tx(db, "readonly", (s) => s.get(k))) as SaveMeta;
      if (m) metas.push(m);
    }
  }
  db.close();
  return metas;
}

async function localDelete(saveName: string): Promise<void> {
  const db = await openDB();
  await tx(db, "readwrite", (s) => s.delete(saveKey(saveName)));
  await tx(db, "readwrite", (s) => s.delete(metaKey(saveName)));
  db.close();
}

function upgradeIfNeeded(state: GameState): GameState {
  if (state.schemaVersion !== SCHEMA_VERSION) {
    if (!isMigratable(state.schemaVersion)) {
      throw new Error(`Save schema v${state.schemaVersion} can't be opened by game v${SCHEMA_VERSION}.`);
    }
    migrateSave(state);
  }
  return state;
}

// ── Public API (local + cloud) ──────────────────────────────────────────────

// Cloud writes are the expensive half of a save: IndexedDB takes the object by
// structured clone, but the cloud body has to be JSON-serialised, which on a
// season-100 save is tens of megabytes of string building on the UI thread.
//
// Local is the source of truth for *this* device and is always written, so the
// cloud copy only has to be recent enough to move devices on — not identical
// after every autosave. Syncing it on an interval (and on any explicit save)
// keeps cross-device resume working while taking the serialisation cost off the
// per-action path entirely.
const CLOUD_SYNC_INTERVAL_MS = 60_000;
let lastCloudSyncAt = 0;
let cloudSyncInFlight = false;

async function syncCloud(state: GameState, force: boolean): Promise<void> {
  if (cloudSyncInFlight) return;
  if (!force && Date.now() - lastCloudSyncAt < CLOUD_SYNC_INTERVAL_MS) return;
  if (!(await cloudEnabled())) return;
  cloudSyncInFlight = true;
  try {
    // best-effort: a cloud hiccup must never lose the just-written local save
    await cloudSave(state).catch(() => {});
    lastCloudSyncAt = Date.now();
  } finally {
    cloudSyncInFlight = false;
  }
}

/**
 * Autosave. Always writes local; syncs to the cloud at most once a minute.
 * Pass `flushCloud` for the moments where the copy must be current no matter
 * what — quitting to the menu, or the tab going away.
 */
export async function saveGame(state: GameState, flushCloud = false): Promise<void> {
  await localPut(state); // local cache is always written first (fast + offline)
  void syncCloud(state, flushCloud);
}

export async function loadGame(saveName: string): Promise<GameState | null> {
  let state: GameState | null = null;
  if (await cloudEnabled()) {
    state = await cloudLoad(saveName);
  }
  if (!state) state = await localGet(saveName);
  if (!state) return null;
  upgradeIfNeeded(state);
  await localPut(state); // refresh the local cache with the (possibly migrated) copy
  return state;
}

export async function listSaves(): Promise<SaveMeta[]> {
  const local = await localList();
  let merged = local;
  if (await cloudEnabled()) {
    const cloud = await cloudList();
    // Cloud wins on conflicts (cross-device source of truth); union by name.
    const byName = new Map<string, SaveMeta>();
    for (const m of local) byName.set(m.saveName, m);
    for (const m of cloud) byName.set(m.saveName, m);
    merged = [...byName.values()];
  }
  return merged.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(saveName: string): Promise<void> {
  await localDelete(saveName);
  if (await cloudEnabled()) {
    cloudDelete(saveName).catch(() => {});
  }
}

/** JSON export — doubles as the modding format (same schema). Owner-independent. */
export function exportSave(state: GameState) {
  const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.saveName.replace(/[^a-z0-9-_]/gi, "_")}_S${state.season}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSave(file: File): Promise<GameState> {
  const text = await file.text();
  const state = JSON.parse(text) as GameState;
  if (!state.schemaVersion || !state.players || !state.teams) {
    throw new Error("Not a valid Football Legacy save file.");
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    if (!isMigratable(state.schemaVersion)) {
      throw new Error(`Save schema v${state.schemaVersion} can't be opened by game v${SCHEMA_VERSION}.`);
    }
    migrateSave(state);
  }
  return state;
}

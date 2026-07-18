// ── Game-key access (simple hardcoded keys) ────────────────────────────────
// This is deliberately NOT real authentication. The game is a personal project
// shared with a handful of friends; a game key is just an access code that also
// gives each player their own namespaced save space, so two people on the same
// device (or the same person on different devices, via cloud saves) never clash.
//
// Keys are hardcoded below. To add/rotate a player, edit GAME_KEYS. Because this
// is not a security boundary, there is no signing, no expiry, no server check
// for the key itself — anyone with a key string is "that user". That's fine for
// the intended audience.
//
// The active key doubles as the *save owner id*: saves (local IndexedDB and the
// optional Vercel cloud store) are namespaced under it, so each key gets its own
// persistent set of saves. See lib/save.ts.

const STORAGE_KEY = "fl.gamekey";

/**
 * The valid game keys. Each entry is one player. `id` is used to namespace that
 * player's saves — keep it short, stable and unique (changing an id orphans that
 * player's existing saves). `label` is a friendly name shown in the UI.
 *
 * To hand a friend access: give them one of the `key` strings below.
 */
export interface GameKey {
  key: string; // what the player types in
  id: string; // save-namespace id (stable!)
  label: string; // friendly display name
}

export const GAME_KEYS: GameKey[] = [
  { key: "SANTI-001", id: "santi", label: "Santi" },
  { key: "KIDO-002", id: "kido", label: "Kido" },
  { key: "FLKEY-003", id: "flkey3", label: "Player 3" },
  { key: "FLKEY-004", id: "flkey4", label: "Player 4" },
  { key: "FLKEY-005", id: "flkey5", label: "Player 5" },
];

/** Case-insensitive, trims whitespace — friends paste keys with stray spaces. */
function normalize(raw: string): string {
  return raw.trim().toUpperCase();
}

/** The key definition for a raw input, or null if it isn't a valid key. */
export function matchKey(raw: string): GameKey | null {
  const norm = normalize(raw);
  return GAME_KEYS.find((k) => k.key.toUpperCase() === norm) ?? null;
}

export type KeyCheck = { ok: true; gameKey: GameKey } | { ok: false; reason: string };

/** Validate a typed key. Synchronous — no network, no crypto. */
export function verifyKey(raw: string): KeyCheck {
  const key = raw.trim();
  if (!key) return { ok: false, reason: "Enter your game key." };
  const gk = matchKey(key);
  if (!gk) return { ok: false, reason: "That key isn't recognised. Check for typos." };
  return { ok: true, gameKey: gk };
}

// ── local persistence (ask once) ────────────────────────────────────────────

/** The raw key remembered from a previous unlock, if any and still valid. */
export function storedKey(): GameKey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return matchKey(raw);
  } catch {
    return null;
  }
}

export function rememberKey(gk: GameKey): void {
  try {
    localStorage.setItem(STORAGE_KEY, gk.key);
  } catch {
    /* private mode / storage disabled — the user just re-enters next time */
  }
}

export function forgetKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Last-open save (auto-resume on refresh) ─────────────────────────────────
// Remember which save the player had open, per game-key owner, so a page
// refresh drops them straight back into their game instead of the save picker.

const LAST_SAVE_KEY = "fl.lastSave";

export function rememberLastSave(ownerId: string, saveName: string): void {
  try {
    localStorage.setItem(`${LAST_SAVE_KEY}:${ownerId}`, saveName);
  } catch {
    /* ignore */
  }
}

export function lastSave(ownerId: string): string | null {
  try {
    return localStorage.getItem(`${LAST_SAVE_KEY}:${ownerId}`);
  } catch {
    return null;
  }
}

export function clearLastSave(ownerId: string): void {
  try {
    localStorage.removeItem(`${LAST_SAVE_KEY}:${ownerId}`);
  } catch {
    /* ignore */
  }
}

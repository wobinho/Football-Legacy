// ── Cloud save client (Vercel-hosted) ──────────────────────────────────────
// Talks to the /api/saves routes, which persist to a Vercel KV (Upstash Redis)
// store keyed by the player's game-key id. This is what makes saves follow a
// player across devices: the same game key on a phone and a laptop reaches the
// same server-side save space.
//
// Everything here degrades gracefully. If the deployment has no KV configured
// (local dev, or you haven't added the integration yet), the API returns 501
// and `cloudEnabled()` resolves false — the app then relies on local IndexedDB
// alone (lib/save.ts). No call here ever throws to its caller; failures resolve
// to null / false so the game keeps working offline.

import type { GameState } from "./types";
import type { SaveMeta } from "./save";

/** The owner id (game-key id) whose cloud space we read/write. Set at unlock. */
let ownerId: string | null = null;

export function setCloudOwner(id: string | null) {
  ownerId = id;
}

export function cloudOwner(): string | null {
  return ownerId;
}

// Cache the enabled probe so we don't re-hit the server on every save.
let enabledProbe: Promise<boolean> | null = null;

/** Whether a cloud store is actually configured on this deployment. */
export function cloudEnabled(): Promise<boolean> {
  if (enabledProbe) return enabledProbe;
  enabledProbe = (async () => {
    try {
      const res = await fetch("/api/saves/health", { method: "GET" });
      if (!res.ok) return false;
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  })();
  return enabledProbe;
}

function headers(): HeadersInit {
  return { "Content-Type": "application/json", "x-fl-owner": ownerId ?? "" };
}

/** List a player's cloud saves (metadata only). Empty on any failure. */
export async function cloudList(): Promise<SaveMeta[]> {
  if (!ownerId) return [];
  try {
    const res = await fetch("/api/saves", { method: "GET", headers: headers() });
    if (!res.ok) return [];
    const body = (await res.json()) as { saves?: SaveMeta[] };
    return body.saves ?? [];
  } catch {
    return [];
  }
}

/** Fetch one full cloud save, or null if absent/unreachable. */
export async function cloudLoad(saveName: string): Promise<GameState | null> {
  if (!ownerId) return null;
  try {
    const res = await fetch(`/api/saves/${encodeURIComponent(saveName)}`, {
      method: "GET",
      headers: headers(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: GameState };
    return body.state ?? null;
  } catch {
    return null;
  }
}

/** Upsert one save to the cloud. Returns whether it was accepted. */
export async function cloudSave(state: GameState): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const res = await fetch(`/api/saves/${encodeURIComponent(state.saveName)}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ state }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete one cloud save. */
export async function cloudDelete(saveName: string): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const res = await fetch(`/api/saves/${encodeURIComponent(saveName)}`, {
      method: "DELETE",
      headers: headers(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

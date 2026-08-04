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

/** Fetch one full cloud save, or null if absent/unreachable.
 *
 * The route serves whatever it has stored: a save written by a compressing
 * client comes back gzipped (flagged with `x-fl-encoding`), one written before
 * v1.92 comes back as plain JSON. Both are read here so a save never becomes
 * unloadable because of how it happened to be uploaded. */
export async function cloudLoad(saveName: string): Promise<GameState | null> {
  if (!ownerId) return null;
  try {
    const res = await fetch(`/api/saves/${encodeURIComponent(saveName)}`, {
      method: "GET",
      headers: headers(),
    });
    if (!res.ok) return null;
    let text: string;
    if (res.headers.get("x-fl-encoding") === "gzip" && typeof DecompressionStream !== "undefined") {
      const stream = res.body!.pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(stream).text();
    } else {
      text = await res.text();
    }
    const body = JSON.parse(text) as { state?: GameState };
    return body.state ?? null;
  } catch {
    return null;
  }
}

// ── Compression (v1.92) ─────────────────────────────────────────────────────
// A save is the single biggest thing this game moves over the network, and it
// only grows: ~8 MB by season 9, ~60 MB extrapolated to season 100. Uploading
// that raw was costing ~15 MB of metered Vercel transfer per sync (the browser →
// function hop AND the function → KV hop are both billed), which is what put a
// 9-season save at 14 GB of Fast Data Transfer.
//
// Save JSON is extremely repetitive — the same attribute keys on every one of
// thousands of players — so it gzips roughly an order of magnitude. Compressing
// in the browser is what makes that saving real on BOTH hops: the function
// receives bytes that are already small and stores them without re-expanding.
//
// `CompressionStream` is standard in every browser that ships the rest of what
// this game needs. Where it is somehow missing the client simply posts raw JSON
// and the server handles either — a save must never fail to upload because a
// compression API was unavailable.

function canCompress(): boolean {
  return typeof CompressionStream !== "undefined";
}

/** Gzip a string to bytes. Only called when `canCompress()`. */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The save-list row for `state`, base64'd for safe carriage in a header. */
function metaHeader(state: GameState): string {
  const meta = {
    saveName: state.saveName,
    managerName: state.managerName,
    teamName: state.teams[state.userTeamId]?.name ?? "?",
    season: state.season,
    savedAt: Date.now(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Upsert one save to the cloud. Returns whether it was accepted. */
export async function cloudSave(state: GameState): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const json = JSON.stringify({ state });
    const url = `/api/saves/${encodeURIComponent(state.saveName)}`;
    if (canCompress()) {
      const body = await gzip(json);
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          ...headers(),
          "Content-Type": "application/octet-stream",
          // `x-fl-encoding` rather than `Content-Encoding`: the platform may
          // transparently decode the standard header before our handler sees the
          // body, which would leave the route unable to tell what it received.
          "x-fl-encoding": "gzip",
          // The save list's row, sent separately so the server never has to
          // inflate the save to find out whose it is. Base64 because a club or
          // manager name can hold characters a raw header may not.
          "x-fl-meta": metaHeader(state),
        },
        body: body as unknown as BodyInit,
      });
      return res.ok;
    }
    const res = await fetch(url, { method: "PUT", headers: headers(), body: json });
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

// Shared server helper: resolve + validate the save owner from a request.
// The client sends its game-key id in the `x-fl-owner` header. We check it
// against the same hardcoded key list the client uses, so a request can only
// touch a real player's namespace (not an arbitrary invented one).

import { GAME_KEYS } from "@/lib/auth";

const VALID_IDS = new Set(GAME_KEYS.map((k) => k.id));

/** The validated owner id from the request, or null if missing/unknown. */
export function ownerFrom(req: Request): string | null {
  const id = req.headers.get("x-fl-owner")?.trim();
  if (!id || !VALID_IDS.has(id)) return null;
  return id;
}

export const kSave = (owner: string, name: string) => `fl:save:${owner}:${name}`;
export const kMeta = (owner: string, name: string) => `fl:meta:${owner}:${name}`;
export const kIndex = (owner: string) => `fl:index:${owner}`;

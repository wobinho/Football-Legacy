// ── Server-side KV wrapper (Vercel KV / Upstash Redis REST) ─────────────────
// Used only by the /api/saves routes. Talks to the Upstash Redis REST API that
// the Vercel KV / Upstash marketplace integration provisions, via the standard
// env vars it injects: KV_REST_API_URL + KV_REST_API_TOKEN (Upstash's own
// UPSTASH_REDIS_REST_URL/_TOKEN are accepted as a fallback).
//
// We hit the REST API with fetch rather than depending on @vercel/kv so there's
// no package to install — the integration just needs to set the env vars. If no
// store is configured, `kvConfigured()` is false and the routes report the cloud
// as disabled (the client then falls back to local IndexedDB).

const URL_ENV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_ENV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function kvConfigured(): boolean {
  return Boolean(URL_ENV && TOKEN_ENV);
}

async function command<T = unknown>(args: (string | number)[]): Promise<T> {
  if (!URL_ENV || !TOKEN_ENV) throw new Error("KV not configured");
  const res = await fetch(URL_ENV, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN_ENV}`,
      "Content-Type": "application/json",
    },
    // Upstash accepts a command as a JSON array of arguments.
    body: JSON.stringify(args.map(String)),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV command failed: ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

/** Get a string value (or null). */
export async function kvGet(key: string): Promise<string | null> {
  return command<string | null>(["GET", key]);
}

/** Set a string value. */
export async function kvSet(key: string, value: string): Promise<void> {
  await command(["SET", key, value]);
}

/** Delete a key. */
export async function kvDel(key: string): Promise<void> {
  await command(["DEL", key]);
}

/** Add a member to a set. */
export async function kvSAdd(key: string, member: string): Promise<void> {
  await command(["SADD", key, member]);
}

/** Remove a member from a set. */
export async function kvSRem(key: string, member: string): Promise<void> {
  await command(["SREM", key, member]);
}

/** Read all members of a set. */
export async function kvSMembers(key: string): Promise<string[]> {
  const r = await command<string[] | null>(["SMEMBERS", key]);
  return r ?? [];
}

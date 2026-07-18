# Deploying Football Legacy to Vercel

This app is a Next.js project, so Vercel hosts it end-to-end — the game UI **and**
the per-player cloud saves — on one platform. Below is everything you need.

## What you get

- **The game**, served from Vercel's global CDN.
- **Game-key access**: 5 hardcoded keys gate the app (see below). Each key is a
  "player" with their own save space.
- **Per-key cloud saves**: when you add a KV store (one click), every player's
  saves live on the server, so the same game key resumes on any device or browser.
  Without a KV store the game still works, but saves stay in that browser only.

## The game keys

Edit these in [`lib/auth.ts`](lib/auth.ts) (`GAME_KEYS`). The current 5 are:

| Key         | Player   |
|-------------|----------|
| `SANTI-001` | Santi    |
| `KIDO-002`  | Kido     |
| `FLKEY-003` | Player 3 |
| `FLKEY-004` | Player 4 |
| `FLKEY-005` | Player 5 |

Hand a friend one of the key strings — that's their login. Keys are **not**
secure auth; they're access codes that also namespace saves. To rename a player,
change their `label`. **Don't change a key's `id`** once someone has saves under
it — the `id` is the save-namespace, so changing it orphans their games.

## Step-by-step deploy

1. **Push the project to a Git repo** (GitHub/GitLab/Bitbucket).
2. **Import it into Vercel** → New Project → pick the repo. Framework auto-detects
   as Next.js. Click **Deploy**. (Free "Hobby" plan is fine for personal use.)
3. The game is now live. It already works — saves are local-per-browser until you
   do step 4.

### Step 4 — turn on cloud saves (cross-device)

Cloud saves need a Redis-style KV store. On Vercel:

1. In your project, go to the **Storage** tab → **Create Database** →
   choose a **Redis** store (the Upstash-backed "KV"/"Redis" marketplace
   integration). Give it a name, create it, and **connect it to this project**.
2. Vercel injects the connection env vars automatically. This app looks for:
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   - (or the Upstash equivalents `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)

   The standard integration sets one of these pairs for you — you usually don't
   have to touch anything.
3. **Redeploy** (Vercel does this automatically when you connect storage, or hit
   Redeploy). Done — saves now persist server-side per game key.

You can confirm it's live by opening `/api/saves/health` on your deployment: it
returns `{"enabled":true}` when the KV store is connected.

### Does the free plan cover it?

- **Hosting**: yes, the Hobby plan hosts the game and the API routes for free
  (personal, non-commercial use).
- **KV storage**: the marketplace Redis integrations have a free tier that is
  plenty for a handful of friends (saves are a couple of MB each, read/written
  occasionally). If you ever outgrow the free tier you can upgrade that store —
  nothing else changes. You do **not** need a paid Vercel Pro plan just for this.

## How saves flow (for reference)

- The browser writes each save to **local IndexedDB first** (fast, offline), then
  syncs it to the **cloud** in the background.
- On load/list, the **cloud is the source of truth** when available; local is the
  fallback. So a friend can start on their laptop and resume on their phone.
- If the cloud is ever unreachable (offline, or no KV configured), the game keeps
  working entirely from local storage and syncs again when it can.
- Full-save **JSON export/import** (Main Menu) still works regardless — a manual
  backup you can move between machines by hand.

## Local development

`npm run dev` runs the game with **no KV** configured, so it uses local IndexedDB
only — exactly the graceful-fallback path. To test cloud saves locally, put the
KV env vars in a `.env.local` file and restart the dev server.

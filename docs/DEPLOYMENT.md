# Deployment plan — Football Legacy

> Goal: ship this game to real players **cheaply** (ideally $0 / month), while
> keeping the door open to grow. This doc is the recommended path and the
> reasoning behind it, plus the exact steps.

## TL;DR

- The game is a **fully client-side app** (all logic in `lib/`, all state in the
  browser via IndexedDB). It has **no backend, no database, no server calls**.
- That makes it a **static export** — the cheapest possible thing to host.
- **Deploy to Vercel's Hobby (free) tier**, or Cloudflare Pages / Netlify. All
  three serve this for **$0** at hobby scale.
- Access control is handled **client-side** with signed game keys (see
  `AUTH.md` / `lib/auth.ts`) — so gating players does **not** force a paid backend.

---

## 1. Why this is cheap to run

Everything that would normally cost money on a game backend — player data,
saves, match simulation — happens **in the player's browser**:

| Concern | Where it lives | Cost |
| --- | --- | --- |
| Game rules / match engine | `lib/` (runs in-browser) | $0 |
| World data / rosters | generated in-browser from seeds | $0 |
| Saves | IndexedDB (the player's device) | $0 |
| Auth / access keys | signed keys verified in-browser | $0 |
| Hosting | static files on a CDN | $0 at hobby scale |

There is **no per-user server cost** because there is no server doing per-user
work. Your only costs appear if you *add* server features later (see §6).

---

## 2. Recommended host: Vercel (Hobby)

Vercel is the natural fit (this is a Next.js app) and the Hobby tier is free.

### One-time setup
1. Push the repo to GitHub (private is fine).
2. On [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
3. Framework preset auto-detects **Next.js**. Build command `next build`,
   output handled automatically. No env vars required.
4. Deploy. You get a `*.vercel.app` URL immediately; add a custom domain in
   **Settings → Domains** (a domain costs ~$10–15/yr from any registrar; the
   hosting itself stays free).

Every `git push` to the main branch redeploys automatically; PRs get preview
URLs.

### Keeping it on the free tier
- **Don't add API routes / server actions** that run per request. This app
  doesn't need them. As long as the app stays static + client-rendered, you stay
  in free-tier limits comfortably (Hobby includes generous bandwidth for an
  indie game).
- The one build-time script that touches keys (`scripts/genkey.mjs`) runs on
  **your** machine, never on Vercel.

### Optional: make it a true static export
Because there's no server code, you can export pure static HTML/JS and host it
literally anywhere (including a $0 bucket or GitHub Pages):

```js
// next.config.ts
const nextConfig = { output: "export" };
```

Then `next build` emits an `out/` folder of static files. Trade-off: `output:
"export"` disables any future server features, so only flip it if you're sure
you want the static-only path. **On Vercel you don't need it** — Vercel serves
the app fine without it and leaves server features available if you ever want
them.

---

## 3. Alternative hosts (all free at hobby scale)

| Host | Notes |
| --- | --- |
| **Cloudflare Pages** | Excellent free tier, global CDN. Use with `output: "export"` (static) for the simplest path, or the Next-on-Pages adapter. |
| **Netlify** | Free tier, first-class Next.js support, drag-and-drop or Git deploy. |
| **GitHub Pages** | Free, but static-only — requires `output: "export"` and a `basePath` if not hosted at the domain root. |

Recommendation: **start on Vercel** (least friction for Next.js), keep
Cloudflare Pages as the fallback if you ever outgrow Vercel's free bandwidth.

---

## 4. Pre-launch checklist

- [ ] `npm run build` passes clean (typecheck + build). ✔ currently green.
- [ ] Decide on auth: leave the gate **off** (open beta) or embed a public key
      to **switch it on** (see `AUTH.md`). This is a code change, redeploys free.
- [ ] Set a custom domain (optional but recommended).
- [ ] Confirm the app loads and a save round-trips on a **real phone** (mobile
      support shipped — drawer nav, responsive header, `100dvh`, safe-area).
- [ ] Add a short "Export your save regularly" nudge — already in-game on the
      Club → Save tab (saves are device-local; see `STORAGE.md`).

---

## 5. Costs, honestly

| Item | Cost |
| --- | --- |
| Vercel Hobby hosting | **$0 / month** |
| Custom domain (optional) | ~$10–15 / year |
| Signing keys (your machine) | $0 |
| **Total to launch** | **~$0–15 / year** |

You only start paying if you add server-side features (below) or blow past
free-tier bandwidth — unlikely for an indie launch.

---

## 6. If you grow (optional, later)

None of this is needed now; it's the upgrade path when/if you want it.

- **Cloud saves / cross-device**: add a tiny API + a KV/Postgres store (Vercel
  KV/Postgres, Upstash, Supabase, Turso). Cost scales with users; free tiers
  exist. See `STORAGE.md` §"Future: cloud saves".
- **Server-validated keys** (revocation, per-device limits, usage analytics):
  swap the offline verify for a `/api/redeem` route backed by a KV store. This
  is the one thing that turns the app from "$0 forever" into "small monthly
  cost", so only do it if you actually need revocation.
- **Leaderboards / shared worlds**: needs a backend + database. Design later.

The current architecture makes all of these *additive* — you never have to
rewrite the game to add them, because the game already runs standalone.

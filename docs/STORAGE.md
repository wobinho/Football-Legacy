# Database & storage plan — Football Legacy

> Two questions this answers:
> 1. How is the game's **data / storage** structured, especially once deployed?
> 2. Why did **the same team give me different players each new save** — and how
>    is that now fixed?

---

## 1. There is no server database — and that's on purpose

Football Legacy is **local-first**. Nothing about a player's game lives on a
server:

- **The world is generated, not stored.** When you start a save, `lib/worldgen.ts`
  builds every league, club and player procedurally from a **seed** (a single
  number) plus the chosen **country databases** (`lib/database.ts` /
  `lib/config/countries.ts`). The "database" of players isn't a table you query —
  it's a deterministic function of `(seed, country DBs)`.
- **Saves live in the browser.** `lib/save.ts` persists the whole `GameState`
  object to **IndexedDB** on the player's own device (`football-legacy` DB,
  `saves` store). Autosave is debounced and flushes on tab hide/close
  (`store/gameStore.ts`).
- **Backups are JSON files.** Export from **Club → Save** writes the entire
  `GameState` as JSON. The same file is the **modding format** and the
  **import** format — one schema, `SCHEMA_VERSION`-stamped, migrated forward by
  `lib/migrate.ts`.

So the storage story after deployment is simply: **static app on a CDN + each
player's saves on their own device.** No hosting bill for data, no accounts.

### Data flow at a glance
```
country DBs (default or uploaded)  ─┐
                                    ├─► generateWorld(seed, DBs) ─► GameState ─► IndexedDB (device)
new-game config → deterministic seed┘                                    │
                                                                          └─► Export → JSON backup (modding format)
```

---

## 2. The "same team, different players" bug — fixed

### What was happening
`generateWorld` picked its seed like this:

```ts
const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31); // ← random!
```

The new-game screen never passed a seed, so **every new save rolled a fresh
random seed**. Since the whole world (your squad, rivals, free agents) is a
function of the seed, picking the same club twice produced **different players
each time**. For a game that ships a *default database*, that's wrong — the
default dataset should be **fixed and reproducible**, like a real database.

### The fix
The seed is now **derived deterministically from the new-game configuration**
when you don't explicitly ask for a random one (`resolveSeed()` in
`lib/worldgen.ts`):

```
seed = hash( playableCountry | userTeamId | sorted(viewCountries) | fingerprint(customDBs) )
```

Consequences:
- **Same country + same club + default database ⇒ identical world, every time.**
  Your academy, your rivals' squads, the free-agent pool — all reproducible.
- **Different club (or different included countries) ⇒ a different world**, so
  there's still variety across playthroughs — it's tied to *your choices*, not
  to chance.
- **A custom uploaded database ⇒ its own stable world** (the DB is fingerprinted
  into the seed), so modded datasets are reproducible too.
- Want a deliberate reroll? Pass an explicit `opts.seed` (a future "Surprise me"
  button is a one-line addition).

Verified: building the default England world twice with the same club now yields
byte-identical squads and the same seed.

> Note on **existing saves**: a save already stores its own `seed`, so it keeps
> its exact world forever — this change only affects how *new* saves choose their
> seed. Old saves are untouched.

---

## 3. Per-country database architecture (recap)

The world is assembled from **per-country databases** consolidated at new-game
time (shipped earlier; storage-relevant here):

- `lib/config/countries.ts` — the built-in default countries/divisions/clubs.
- `lib/database.ts` — the `fl-country-db@1` JSON format for **custom** uploads
  (custom players / clubs / leagues), with friendly validation and a downloadable
  template. A country can use the **default** DB or a **user-uploaded** one.
- `generateWorld` merges the playable country (real engine) + view-only
  countries (sim) into one `GameState`.

This is why "database" here means **the seed dataset the world is built from**,
not a running server DB.

---

## 4. Schema versioning & migrations

- Every save carries `schemaVersion` (currently **8**).
- On load/import, `lib/migrate.ts` upgrades older saves step-by-step
  (v1→v2→…→v8). Each step is small and pure; the upgraded save is re-persisted.
- The JSON export **is** the schema, so mods and backups migrate the same way.
- This means you can ship new versions without breaking anyone's existing save.

---

## 5. Durability & the one caveat of local-first

Because saves live in the browser's IndexedDB, they are **per-device and
per-browser**, and can be lost if the user clears site data or uses private
mode. Mitigations already in place:

- Autosave flushes on tab hide/close (no lost progress on refresh).
- The Club → Save tab nudges players to **export a JSON backup** periodically
  (and warns if it's been several seasons).

If you want saves that survive device loss / sync across devices, that's the
**cloud-saves** upgrade below — optional, not required to launch.

---

## 6. Future: cloud saves (optional, only if you want cross-device)

The save layer is deliberately behind a small interface (`saveGame` / `loadGame`
/ `listSaves` / `exportSave` / `importSave` in `lib/save.ts`), so a cloud
backend can slot in **without touching game logic**:

1. Add auth for identity (the signed game key already identifies a player via its
   `id` payload; or add a light email/OAuth).
2. Store the exported `GameState` JSON blob in a managed store:
   - **Supabase / Turso / Neon** (Postgres, generous free tiers), or
   - **Vercel KV / Upstash Redis** (key-value; save = one JSON blob per slot).
3. Make `saveGame`/`loadGame` write/read the blob remotely (keep IndexedDB as an
   offline cache + fallback).

Cost scales with active users and stays within free tiers at indie scale. Until
then, **local-first + JSON export is the zero-cost, zero-server answer** — see
`DEPLOYMENT.md`.

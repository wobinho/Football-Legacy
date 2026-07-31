# Football Legacy

Web-based football management game (Football Manager Lite). **GAME_DESIGN.md is the
single source of truth** — decisions there are locked; items marked `[OPEN]` need a
design session before changing, `[FUTURE]` must not be built but must not be blocked.

## Commands

- `npm run dev` — dev server (localhost:3000)
- `npm run build` — production build + typecheck
- `npm run build:db` — rebuild the default database from `fl26-*.csv` into `/public/database_presets` (+ `manifest.json`)
- `npm run build:names` — rebuild `lib/config/namepool.generated.ts` (generated-player name pool) from `fl_namepool.csv`
- `npm run verify:overall` — check the FC 26 overall model against OVERALL_FORMULA.md's worked examples
- `npm run verify:archetypes` — check the 45 archetypes against the plan table, the icon folder and the class split
- `npm run verify:formations` — structural check on `config/formations.ts` (11 slots, one GK, label==pos, picker coverage) + the AI formation mix
- `npx tsx scripts/verify-db.ts` — validate every shipped country DB and build a real world from it
- `node scripts/ui-test-db.mjs` — end-to-end drive of the default-database + editor-import flow (dev server must be running)
- `npm run calibrate [n]` — match-engine calibration harness (targets: ~2.7 goals/match, ~45% home wins)
- `npx tsx scripts/smoke.ts [seasons]` — headless multi-season simulation (loop/rollover/cup/transfer sanity)
- `npx tsx scripts/perf.ts [seasons] [sampleEvery]` — long-save scaling harness: player/career growth, save size, serialisation and rollover cost, extrapolated to S100
- `node scripts/ui-test.mjs` — end-to-end UI drive via headless Edge (dev server must be running)
- `node scripts/ui-test-mobile.mjs` — same at a 390×844 phone viewport (Academy/Scouting focus)
- `node scripts/ui-test-season.mjs` — plays a full season, then exercises the finances breakdowns and the season-review modal

## Architecture (mirrors GAME_DESIGN.md §2 module map)

All game logic lives in `lib/` as framework-free TypeScript modules; React never
implements rules. State flows: lib modules mutate the single `GameState` object,
`store/gameStore.ts` (zustand) bumps `rev` to re-render and debounce-autosaves.

- `lib/types.ts` — schema (SCHEMA_VERSION-stamped; save JSON = modding format)
- `lib/config/` — **all pure data**: `tuning.ts` (every balance number — never tune in engine code), `archetype.ts`, `training.ts`, `traits.ts`, `formations.ts`, `positions.ts` (phase weights + the FC 26 overall model), `names.ts` (club defs, name pools), `presets.ts` (default-database registry, manifest-driven)
- `lib/fl26/` — build-time only: CSV reader + the conversion that turns `fl26-*.csv` into country-database JSON. Never imported by the client bundle.
- `lib/engine/match.ts` — pure seeded match engine, 6×15-min segments; `simulateMatch()` one-shot, or `createMatch/playFirstHalf/applyHalftimeTactic/playSecondHalf/finalizeResult` for the live view
- `lib/gameloop.ts` — Continue-button orchestrator (`advanceUntilEvent`), season rollover
- `lib/worldgen.ts`, `lib/season.ts`, `lib/simresolver.ts`, `lib/development.ts`, `lib/economy.ts`, `lib/transfers.ts`, `lib/staff.ts`, `lib/recordbook.ts`, `lib/save.ts` (IndexedDB), `lib/selection.ts` (XI picking), `lib/value.ts`, `lib/calendar.ts`, `lib/rng.ts` (mulberry32, derived seeds)
- `lib/archive.ts` — long-save maintenance: `activePlayers()` (living-world iteration for the hot passes) and the rollover's `pruneRetired()` compaction. Full-world passes should use `activePlayers()`, never `Object.values(state.players)`, unless they genuinely need retirees.
- `lib/gcn.ts` — Global Club Network (§19, v34, end-game): funds/unlock, treasury, found/buy clubs (sim leagues only), inter-club moves & feeder loans, Operations upgrades. Rules only — the store calls in.
- `lib/assistant.ts` — everything the Tactics screen *says*: `assistantReport()` (the grade
  and its notes) and `squadBlueprint()` (the ideal role per slot, the ✓/~/✗ against the
  incumbent, and the shopping list). Both derive from the same functions the engine calls, so
  the UI can never claim something the simulation won't do. New advice goes here, not in the
  component — React must never implement rules.
- `components/screens/` — the screens (§14); `Gcn.tsx` is the GCN page (below Achievements, unlocked only); `components/ui.tsx` — design primitives

## Rules that matter

- The engine must never special-case an archetype/trait by name — table lookups only.
- Determinism: anything random takes a seed derived via `deriveSeed(state.seed, label)`.
- Balance changes go through `lib/config/tuning.ts` + `npm run calibrate`, never engine edits.
- Players carry **35 attributes** (v41), not six. `lib/config/attributes.ts` is the single
  source of truth for the keys/labels/groups — iterate its `ATTR_KEYS`, never an inline list.
  The six card faces (PAC/SHO/…) still exist but are a *derived view* (`aggregateAttrs`),
  never stored. Beware two distinct pairs: `positioning` vs `gkPositioning`, and
  `sprintSpeed` vs `gkSpeed`.
- Overall is a position-weighted sum of the 35 attrs plus a positional constant
  (`overallFromAttrs` in `config/positions.ts`). Rows are sparse and every row sums to ≈1.0;
  `fitAttrsToOverall` shifts weight-proportionally, not uniformly. Don't round attrs before
  weighting. See OVERALL_FORMULA.md, and `npm run verify:overall` after any change.
- **One archetype system (v1.77).** An archetype is DERIVED from a player's 35 attributes,
  never stored — the loop is `Training Plan → Attributes → Archetype → Tactical effect`.
  The 45 archetypes map 1:1 onto the 45 training plans (`config/archetype.ts`), and the
  plan's own weights are what worldgen shapes an attribute line from, so generation and
  identity agree by construction. The old 38-entry generation-seed roster
  (`config/archetypes.ts`) and the `archetypeId` player field are **deleted**; a save's
  only stored identity is `trainingPlan`. Style synergy, scorer/assist weights, pace
  reliance, height and goal flavour hang off the archetype's **class** (five of them),
  with per-archetype overrides for roles that genuinely differ.
- **Identity → tactics is two tables and ONE lever (v1.78).** The class's `CLASS_STYLE_ROW`
  answers "does this KIND of player suit the STYLE"; the archetype's
  `ARCHETYPE_INSTRUCTIONS` answers "does this ROLE suit the five advanced dials". Both land
  on the player's own effective rating (`synergyMult` × `instructionMult` in `engine/match.ts`)
  — rating already feeds attack/midfield/defense/scoring, so one lever moves everything. The
  v1.73 system that moved six separate engine quantities (`archetypeclass.ts`, deleted) was
  both illegible and quietly broken. **Do not add a second channel.**
  Two invariants keep it fair, both asserted at module load and by
  `npm run verify:archetypes:tactics`: every **style row sums to zero** with every class the
  strict best at ≥1 style, and every **named instruction axis carries both a `likes` and a
  `dislikes`** — which makes each archetype's mean score over all 405 setups exactly 0. Also
  checked there and impossible to see in the tables alone: every (style, position) pair must
  have a **≥0** option, since the classes reachable at a position are fixed by the roster.
  The instruction table must never name an attribute — that question is `tacticfit.ts`'s.
- Growth/decline emphasis reads the player's **training plan**, not his derived archetype —
  deriving it would be a feedback loop that entrenches an identity training can never move.
  `planScore` (auto-assign) is the opposite case and must read the attribute shape.
- **The default database is generated, not hand-edited.** `/public/database_presets/*.json`
  are build artifacts of `npm run build:db` — edit `fl26-*.csv` and rebuild, never the JSON.
  A country the CSVs don't cover keeps its previously-shipped JSON (the build preserves it),
  so rebuilding never makes a country unselectable.
- Tiers a country's database doesn't author are generated (`config/divisions.ts`) — that is the
  "Generated" choice and the lower-division fallback both. Divisions need ≥4 clubs, even count.
- Formations (`config/formations.ts`): every slot's `label` MUST equal its `pos`, and a shape
  needs exactly 11 slots with one GK — `npm run verify:formations` enforces both. In shapes with
  only three at the back the wide slots are **LM/RM**, not LB/RB: with no fourth defender the
  flank belongs to a midfielder. Variants of one shape (the 4-3-3's midfield options) share a
  `family` and are folded behind one picker button; `aiWeight` (default 1, `0` = never) governs
  only which shapes worldgen randomly seeds AI clubs into — every formation stays available to
  the manager. Adding attacking shapes at weight 1 pushes goals/match off target, so re-run
  `npm run calibrate` after touching the table.
- Interim implementations pending owner design sessions (marked in-file): transfer market
  AI (§10), trait pool. `emergencyIntake()` in gameloop is a stopgap until the Youth
  Academy ships. **Parked UIs** (kept whole and unreferenced, not deleted — the underlying
  systems still run): `FacilitiesPanel.tsx` and `StaffPanel.tsx`, both awaiting a joint
  redesign; the Facilities/Staff page shows placeholders for both.

## Design language

Dark theme (#0b0c0f), subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; signature element is the 1px `.gold-thread`.
Display face Saira Condensed (uppercase, scoreboard feel), body Instrument Sans,
`tnum` class for all data columns.

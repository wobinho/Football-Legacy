# Football Legacy

Web-based football management game (Football Manager Lite). **GAME_DESIGN.md is the
single source of truth** — decisions there are locked; items marked `[OPEN]` need a
design session before changing, `[FUTURE]` must not be built but must not be blocked.

## Commands

- `npm run dev` — dev server (localhost:3000)
- `npm run build` — production build + typecheck
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
- `lib/config/` — **all pure data**: `tuning.ts` (every balance number — never tune in engine code), `archetypes.ts`, `traits.ts`, `formations.ts`, `positions.ts` (phase weights), `names.ts` (club defs, name pools)
- `lib/engine/match.ts` — pure seeded match engine, 6×15-min segments; `simulateMatch()` one-shot, or `createMatch/playFirstHalf/applyHalftimeTactic/playSecondHalf/finalizeResult` for the live view
- `lib/gameloop.ts` — Continue-button orchestrator (`advanceUntilEvent`), season rollover
- `lib/worldgen.ts`, `lib/season.ts`, `lib/simresolver.ts`, `lib/development.ts`, `lib/economy.ts`, `lib/transfers.ts`, `lib/staff.ts`, `lib/recordbook.ts`, `lib/save.ts` (IndexedDB), `lib/selection.ts` (XI picking), `lib/value.ts`, `lib/calendar.ts`, `lib/rng.ts` (mulberry32, derived seeds)
- `lib/archive.ts` — long-save maintenance: `activePlayers()` (living-world iteration for the hot passes) and the rollover's `pruneRetired()` compaction. Full-world passes should use `activePlayers()`, never `Object.values(state.players)`, unless they genuinely need retirees.
- `components/screens/` — the 8 screens (§15); `components/ui.tsx` — design primitives

## Rules that matter

- The engine must never special-case an archetype/trait by name — table lookups only.
- Determinism: anything random takes a seed derived via `deriveSeed(state.seed, label)`.
- Balance changes go through `lib/config/tuning.ts` + `npm run calibrate`, never engine edits.
- Interim implementations pending owner design sessions (marked in-file): transfer market
  AI (§10), archetype roster, trait pool. `emergencyIntake()` in gameloop is a stopgap
  until the Youth Academy ships.

## Design language

Dark theme (#0b0c0f), subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; signature element is the 1px `.gold-thread`.
Display face Saira Condensed (uppercase, scoreboard feel), body Instrument Sans,
`tnum` class for all data columns.

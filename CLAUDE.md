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
- `npm run verify:facilities` — facility-table invariants, the badge ladder, and the ETC's worked example (the 33% ceiling)
- `npm run smoke:facilities [seasons]` — end-to-end drive of build → hire → assign → badge accrual through real rollovers
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
- `lib/worldgen.ts`, `lib/season.ts`, `lib/simresolver.ts`, `lib/development.ts`, `lib/economy.ts`, `lib/transfers.ts`, `lib/recordbook.ts`, `lib/save.ts` (IndexedDB), `lib/selection.ts` (XI picking), `lib/value.ts`, `lib/calendar.ts`, `lib/rng.ts` (mulberry32, derived seeds)
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
- **Facilities & staff are ONE system (v1.79).** A facility holds an effect; the staff
  assigned to it amplify that effect. Nothing else does. Every facility scales the same
  three ways — `base`, `+starEffect` per `STAFF_STARS_PER_STEP` (6) assigned stars, and
  `+badgeEffect` per `badgeTiersPerStep` badge tiers held *for that facility* — so a new
  facility is a row in `FACILITY_SPECS` (`config/facilities.ts`), never new engine code.
  `lib/facilities.ts` holds the rules and must never name a facility in a conditional.
  A facility may produce SEVERAL quantities (v1.82): a spec carries `channels`, each
  running that identical three-way scaling, with `unit: "percent" | "count"` so a
  headcount is never printed as a rate. That is not a fourth channel — it is the same
  arithmetic applied N times. Engine code reads a quantity by name via
  `facilityChannelValue`, never by reaching into a spec, and every named accessor takes
  its UNBUILT fallback as an argument so "no facility" never means "no academy".
  A facility may also gate a CAPABILITY rather than a number (`unlockAtLevel`) — used for
  the Scouting Network's brief auto-filter, because on/off is not a number that crosses zero. A staff member has no
  intrinsic effect: unassigned, they contribute exactly nothing but their wage.
  **Two age numbers, deliberately far apart (v1.83).** `STAFF_HIRE_MIN_AGE`/`STAFF_HIRE_MAX_AGE`
  (21–35) is the band the MARKET generates in; `STAFF_MAX_AGE` (65) is when a person retires.
  A hire has decades ahead, which is what makes the ten seasons a legacy badge costs a bet
  someone can actually take. Don't collapse them back into one constant.
  **The market barely ever sells a badge.** ~8% of candidates arrive with one, capped at
  `BADGE_HIRE_MAX_TIER` (silver) unless a `BADGE_HIRE_HIGH_TIER_CHANCE` roll clears, and
  `BADGE_HIRE_ABSOLUTE_MAX_TIER` (diamond) is the hard stop — obsidian and legacy are only
  ever earned at your own club. A shortlist you can buy pedigree off makes the ladder
  pointless; `verify:facilities` asserts the rate, the ceiling, and that gold+ is still
  reachable at all.
  Four facilities ship, and they are deliberately different KINDS of lever — what a
  channel's number *does* is the consuming function's business, not the table's:
  **Elite Training Center** (ceiling 33%) → `growthMultiplier()`, a plain multiplier on
  how fast players approach their potential.
  **High Performance Center** (v1.81, ceiling 61%) → `eliteResistRelief()`, a cut to the
  elite-resistance *penalty*: `m' = 1 - (1 - m) × (1 - relief)` inside `eliteResistMult`.
  It is the only thing in the game that weakens that brake, which is what makes 90→95 a
  reachable arc. Because it scales a penalty that is *zero* below `growthEliteAbove`, it
  does nothing for a prospect — the ETC stays strictly necessary and the two never
  collapse into "buy the growth building twice". Don't re-express it as a growth
  multiplier; 61% off a penalty and +61% growth are not the same quantity.
  **Youth Academy** (v1.82) → three channels: `squadSize` (15→48 places),
  `focusSlots` (3→8, still clipped by `u21FocusMax`) and `prospectValue` (0→+33%, the old
  Youth PR). Its facility LEVEL is also what `academyUpkeepPerLevel` bills and what biases
  intake quality.
  **Scouting Network** (v1.82) → `maxScouts` (2→7, stars only — headcount deliberately has
  no badge track) and `scoutSpeed` (0→+43% faster reports), plus the level-5 capability
  unlock for the brief auto-filter.
  Both pay their badge track per TWO tiers (`badgeTiersPerStep: 2`) because their channels
  are integer capacities — at the ETC's per-tier rate one legacy badge would hand out six
  squad places and swamp the star track. `verify:facilities` asserts a single bronze badge
  is worth nothing there; that check is what catches a per-tier regression.
  These two replaced the Academy screen's Upgrades tab, deleted outright (schema v47 drops
  `academyLevel`, `scoutNetworkLevel`, `academySquadLevel`, `focusSlotLevel`,
  `scoutSpeedLevel`, `scoutFilterLevel`, `youthPrLevel` and their tuning ladders; no refund,
  no conversion). **Don't reintroduce a bought-by-the-level track** — that shape is what
  both this rework and v1.79's exist to remove. Badges are
  earned by serving whole seasons at one facility (1/2/3/5/7/10 cumulative → bronze…legacy)
  and cap at `STAFF_BADGE_SLOTS` (3) distinct facilities per person. `facilityEffect()`
  returns every channel's base/stars/badges terms separately so the screen can show the
  arithmetic, and it is the same function the engine consumes — the UI can never quote a
  number the simulation won't use. Run `npm run verify:facilities` after touching the tables.
  The predecessor — twelve independent facility LEVELS plus eight named staff SLOTS — was
  deleted outright in this rework (schema v46 drops the fields; no refund, no conversion).
  Three of its effects have no facility yet and deliberately run at BASELINE until one is
  designed to own them: **match-day rating** (`sideInputFor` in gameloop), **fitness
  recovery** (`dailyRecovery` in development), and **youth coaching** (`youthCoachStars` in
  academy). Each is a named seam with a comment — put the new lever there, don't reintroduce
  a second channel.
  The **slot grid is the assignment control** (v1.80): an empty slot opens the picker in
  place, so filling a facility never sends the manager to another tab. It is fixed at three
  columns and always renders the level-5 slot count rounded up to a multiple of three —
  slots a future level unlocks show as padlocks, which is what makes an upgrade legible
  before it is bought. The staff shortlist cycles on the loop's own clock,
  `TUNING.marketRefreshDays` (10), via `state.marketRefreshDay`; there is deliberately **no
  second refresh constant** in `config/facilities.ts` — the one that used to sit there said
  14 and nothing read it.
- **A training plan DOES change who a player is — if he has growth left (v1.84).**
  `archetypeConversionEta` in `lib/development.ts` walks the growth projection forward
  season by season and reports when the derived archetype flips to the plan's own. Measured
  over every world-generated U21 with ≥8 headroom (470 players, 1600 convertible
  player×plan pairs): **17% convert, median 7 seasons, p75 11, max 15**, some in a single
  season. The horizon is 15 for that reason.
  The binding constraint is **growth headroom, not the archetype scoring**. Beware the
  measurement trap this feature was first built on: sweeping one SENIOR squad shows almost
  no conversions, but the median headroom at the moment of stalling there is **zero** —
  that sample measures the growth curve running out, not the plan's steering. Always
  restrict a conversion sweep to players who can still develop.
  Hence three outcomes, not two: `arriving`, `noGrowth` (the player is out of development —
  the common dead end, and ordinary football rather than a mistake) and `tooFar` (he grows
  a whole career and still never earns it — genuinely rare, and the only one worded as a
  problem). Collapsing the last two into one "never" made a squad of settled 28-year-olds
  read as a broken training system.
- Interim implementations pending owner design sessions (marked in-file): transfer market
  AI (§10), trait pool. `emergencyIntake()` in gameloop is a stopgap until the Youth
  Academy ships.

## Design language

Dark theme (#0b0c0f), subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; signature element is the 1px `.gold-thread`.
Display face Saira Condensed (uppercase, scoreboard feel), body Instrument Sans,
`tnum` class for all data columns.

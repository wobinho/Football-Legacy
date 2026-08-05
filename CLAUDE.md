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
- `npm run verify:conversion` — measure that a training plan actually converts a player's derived archetype (youth steers, settled squads don't)
- `npm run verify:formations` — structural check on `config/formations.ts` (11 slots, one GK, label==pos, picker coverage) + the AI formation mix
- `npm run verify:facilities` — facility-table invariants, the badge ladder, and the ETC's worked example (the 33% ceiling)
- `npm run verify:quicksell` — drive a real world into an academy quick sell; asserts the prospect leaves the world and no club receives him
- `npm run verify:gcn` — drive a real world into a live network; asserts owned clubs keep non-zero books that match what the tick banks, that net rises with reputation, and that the relaxed ring fence permits exactly the right moves
- `npm run verify:squads [seasons]` — drive a real world N seasons (default 12) and assert every club can still field its formation naturally, that squads haven't decayed toward the matchday minimum, and that the free-agent market survives the AI's own rollover top-up. A measured sweep, not a table check — the v1.89 defects were all invisible in the tables
- `npm run verify:standings [seasons]` — play N full 38-game seasons with the real engine and assert that squad quality actually decides the table (rank correlation, who wins it, champion points, draw rate). The companion to `calibrate`: that one asks whether a MATCH looks like football, this one asks whether a SEASON does. The v1.91 defect passed calibration cleanly
- `npm run verify:reputation [seasons]` — assert that club reputation drifts with squad,
  division and league finish, and — the actual point — that a club which wins repeatedly
  becomes one more world-class players will sign for, measured through `willJoin` itself
- `npm run verify:squadfile` — export a live squad to a club seed and materialise it back
  through real worldgen; asserts the roster, the derived overall and the contract terms
  survive, and that a player file can't be imported as a squad
- `npm run measure:quality [seasons]` — the long-save QUALITY sweep. Prints the world's
  top-end population by band, top-flight squad means and mean age per season. Not an
  assertion — a measurement to run before and after a change. `verify:squads` asks whether
  clubs can field a SHAPE and `calibrate` asks whether a MATCH looks like football; a
  pyramid passes both with a full complement of 68-rated journeymen, which is exactly how
  the v1.92 age-inversion defect hid
- `npm run verify:playerfile` — export a player out of one world and import him into another; asserts the history survives, nothing world-bound travels, and a repeat import can't collide with an existing player
- `npm run verify:livescores` — drives a real world to its final league round and asserts the
  final-day panel shows the season the save actually records: at 90' every other scoreline
  equals the fixture the engine played, and the live table is identical to `computeTable` over
  the real fixtures (order, points, GD, played). Also checks the reveal is monotonic and
  deterministic, and that the toggle is offered on the last round and no other
- `npm run verify:cloud [seasons]` — plays a real world N seasons and asserts the compressed
  cloud round trip (gzip → base64 → gunzip, exactly as the route stores and serves it) is
  byte-identical, then measures the metered transfer per hour of play against the old raw-save
  behaviour. The bandwidth fix is only real if the payload survives it losslessly
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
- `lib/livescores.ts` — the final-day scoreboard (§15.4): which other fixtures are in play,
  what minute each already-scored goal is revealed on, and the division's table as it stands
  at that minute. A read over fixtures the engine has already played — it never simulates.
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
- The world's growth budget is `growthPerSeasonMax` + `primeGrowthPerSeasonMax`, the two
  headline numbers every other growth term multiplies into. v1.92 raised both 20% (4.5→5.4,
  3.0→3.6) together: lifting only the youth one pushes growth further into the age band that
  takes longest to pay off, which is the opposite of what a shortage of finished players
  needs. Changing either moves squad quality world-wide — re-run `calibrate`,
  `verify:standings` and `measure:quality`.
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
  A fourth term, `levelEffect` (v1.85), adds per facility level above 1. It defaults to 0
  and **only the Scouting Network declares it** — see that facility below for why, and
  don't reach for it: a channel that grows by the level is the shape this system replaced.
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
  **Youth Academy** (v1.82, re-laddered v1.87) → three channels: `squadSize`
  (unbuilt 15 → 20 at unlock, +5/level, +2 per 6 stars → 50), `focusSlots` (unbuilt 3 → 4
  at unlock, +1/level → 8, still clipped by `u21FocusMax`) and `prospectValue` (+3% at
  unlock, +3%/level, +2% per 6 stars, +0.5% per badge tier → +43%; the old Youth PR, and a
  VALUATION effect that applies only while a prospect is IN the academy — promotion drops
  it, and `repriceAcademy` in the store is what makes a facility change show up at once).
  Its facility LEVEL is also what `academyUpkeepPerLevel` bills and what biases intake
  quality. The v1.82 shape had every `base` equal to its unbuilt fallback, so a £50M unlock
  changed *nothing* until six staff stars were in post — hence the level terms below.
  The capacities take no badge track (a legacy badge must not buy beds); prospect value
  takes the badge track and pays per single tier, since a rate has no rounding problem.
  **Scouting Network** (v1.85) → `maxScouts` (unbuilt 2, then 3 at unlock rising +1 per
  level to 7) and `scoutSpeed` (+5% at unlock, +5%/level, +3% per 6 stars, +0.75% per badge
  tier → +67% at the ceiling), plus the level-5 capability unlock for the brief auto-filter.
  It and the Youth Academy are the **only** facilities whose channels carry a `levelEffect`
  — the term that lets a channel grow with the BUILDING rather than with the staff in it.
  That is deliberate and narrow, and the sanctioned channels are listed BY NAME in
  `verify:facilities`, so a third is an edit someone makes on purpose. Both are
  DEPARTMENTS, and every level term is a CAPACITY: how many scouts you may employ, how many
  teenagers you can house, how many you may focus. A 5-star director doesn't conjure a job
  and a 5-star coach doesn't conjure a bed. The quality effects still come from people —
  scout speed takes 42 of its 67 points from staff, prospect value 28 of its 43 — so you
  can buy a big department but not a good one, and `verify:facilities` asserts that split.
  A bought-by-the-level track for anything that isn't a capacity is exactly what v1.79 and
  v1.82 exist to remove.
  Badge tracks are per SINGLE tier everywhere (v1.87): a rate has no rounding problem, and
  the integer capacities now carry no badge term at all rather than a two-tier divisor —
  which is the cleaner answer to "one legacy badge must not buy six squad places".
  `verify:facilities` asserts a bronze badge buys no beds and no focus slots.
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
- **A training plan DOES change who a player is (v1.84; actually made true in v1.85).**
  `archetypeConversionEta` in `lib/development.ts` walks the growth projection forward
  season by season and reports when the derived archetype flips to the plan's own.
  Current measured behaviour (`npm run verify:conversion`, 1000 player×plan pairs per band):
  **16–18 converts 41%, 19–21 27%, 22–24 17%, 29–33 2%**, median 6–8 seasons, max 15. The
  horizon is 15 for that reason.
  **The binding constraint was never growth headroom** — v1.84 said it was, and that was
  wrong twice over. Both causes were invisible in the tables and only showed up in a
  measured sweep; if conversion ever looks broken again, measure before theorising:
  1. `fitAttrsToOverall` settled the line along the **position's** overall weights, and that
     step moved ~4× as many attribute points as the training plan's own shares (46 vs 12 in
     a traced season). Position weight rewards what the player is already good at, so the
     settle fed his existing identity straight back to him — a 17-year-old Sniper on a
     Speedster plan gained *finishing +9* and grew 20 overall across 13 seasons without ever
     reading as a Speedster. The residual is now tilted toward the plan (`FIT_PLAN_TILT`,
     `config/positions.ts`, swept: the curve knees at ~10, 6 keeps the fit recognisably
     position-shaped). **`bias` is opt-in — every generation path must keep omitting it**,
     or "make a striker who rates 72" stops producing a generic striker.
  2. `seasonGrowthEstimate` **rounded** its delta. A prime season earns 0.46 of a point at 75
     overall and 0.16 at 88, so every player at 75+ projected as growing exactly zero from
     the day he turned 27, forever — and the conversion walk stops at the first zero. That
     single `Math.round` is why a whole squad reported "no growth left" on every plan (66%
     of *teenagers* did, at 27 points of median headroom). The rollover never rounded, so
     this was not a conservative estimate, it was a different answer than the simulation's.
     `delta` is now exact and `shown` is the rounded display value; **anything that
     accumulates seasons must use `delta`.**
  Three outcomes, not two: `arriving`, `noGrowth` (out of development — ordinary football
  rather than a mistake) and `tooFar` (grows a whole career and still never earns it).
  Collapsing the last two into one "never" made a squad of settled 28-year-olds read as a
  broken training system. Run `npm run verify:conversion` after touching growth, the fit, or
  the archetype thresholds — it asserts the shape (training steers, youth steers most, a
  settled squad is told the honest thing), never exact rates.
- **The academy costs money (v1.85).** Three prices, all keyed on the prospect-tier ladder or
  the scouting tree, all pure tuning:
  **Sending a scout** — `scoutTripCost` by `ScoutTravelBand` (home/region/continent/overseas,
  resolved against `state.playableCountry` by `scoutTravelBandFor`, which walks `SCOUT_WORLD`
  so a new country prices itself). A fixed-duration brief pays its whole retainer at send
  time; an open-ended one pays the upfront and then bills `weeklyCost` every week until
  recalled — that stored field, not a re-derivation, is the record of which deal was taken.
  A broad target (a continent, Worldwide) is priced at the **dearest** band it can reach, so
  "Worldwide" can't be both the widest net and the cheapest.
  **Signing a find** — `prospectSignFeeByTier`, £1M bronze → £10M legacy. Youth signings were
  free from v11, which made a shortlist something to empty rather than choose from.
  **Youth wages** — `academyWageByTier`, £500/wk bronze → £5k/wk legacy. Priced on the badge,
  not on overall: two 15-year-olds rate the same however far apart their ceilings are, so the
  old overall-scaled band made the rarest prospects the cheapest thing in the game to hoard.
- **Season awards score `rating × (1 + teamSuccess)`, and league STANDING is one of the
  four terms (v1.87).** `lib/accolades.ts`. The other three (league finish, domestic cup,
  Europe) are about the candidate's club; `awardLeagueRepWeight` × `leagueReputation()` is
  about his DIVISION, and it exists solely for the two save-wide legacy honours — their
  pool is every top flight in the world, and `tier === 1` says which leagues are first
  divisions but nothing about which first division is stronger. It cancels out of every
  in-league award by construction (one league, one reputation, same constant on every
  candidate), which is why it can be the largest weight (0.20, ~1.4 rating points across
  the 0–10 span) without distorting the awards it isn't meant to decide. Measured: at a
  realistic 1-point rep gap a 0.5-point rating edge still wins; a rep-10 division beats a
  rep-1 one at a 0.5-point deficit. Don't add a league term anywhere it wouldn't cancel.
- **Quick sell DELETES the prospect (v1.87).** `quickSellQuote` / `quickSellFromAcademy` in
  `lib/academy.ts`. It banks `quickSellShareOfBestOffer` (80%) of the best `saleSuitors`
  offer and then erases the player — record, career, and every list that could name him —
  rather than transferring him. **The deletion is the feature, not an optimisation**: an
  academy turns over dozens of prospects a season, and releasing or selling them all would
  push the user's castoffs into rivals' squads, letting one manager decide who everybody
  else signs. Nobody receives the player; only the money is real. The 20% haircut is what
  the convenience costs, so picking a suitor always pays more. `npm run verify:quicksell`
  drives a real world into the state and asserts the buyer's squad is byte-identical
  afterwards and the id survives nowhere in the serialised save — a dangling id renders as
  a blank row a season later, which is the failure mode a targeted check would miss.
- **A GCN club in a sim league keeps its OWN books (v1.88).** `gcnSimBooks` in `lib/gcn.ts`.
  `weeklyEconomyTick` skips sim leagues, so before this an owned club banked only GCN
  Deals plus any standing order — the Finance panel read **£0 in / £0 out** on a club with
  a real squad on real wages, and "fund this club" had no shortfall to fund against. One
  function is both what `gcnWeeklyTick` banks and what `gcnClubFinance` prints, so the
  panel can never quote a number the simulation won't move. Two rules are load-bearing and
  both were wrong in the first cut — **measure, don't theorise**:
  **Income scales with REPUTATION** (`gcnSimIncomeRepPivot` 70, `gcnSimIncomeRepPower` 2.4).
  Every sim league is tier 1, so the tier-keyed income lines are near-flat (1.26× across
  rep 50→91) while wage bills run **5:1**. Unscaled, 38% of sim clubs ran at a loss and it
  was the *giants* losing £1.5M/wk while minnows profited — backwards for an empire. Now
  2 of 64 lose money and net RISES with reputation (+£297k/wk at rep 91 → +£57k at rep 50).
  **A ring-fenced club gets NO books** — it still draws the AI subsidy in `weeklyEconomyTick`,
  and that subsidy is its abstracted week; paying both is double income.
  Note `completeTransfer` moves a fee BOTH ways (credits seller, debits buyer), so pass it
  the fee once and never also debit the buyer yourself. Run `npm run verify:gcn`.
- **The ring fence is about the MANAGER's squad, not about the border (v1.88).**
  `networkMoveError` in `lib/gcn.ts` is the single ruling; the UI calls it to grey out
  destinations and never re-derives it. v1.64 banned every lever on a home-country holding,
  which also stopped two domestic holdings dealing with *each other* — a move that confers
  nothing on the team the manager actually picks. The narrow invariants now: **money never
  crosses the fence** (no funding, no standing orders, no GCN Deals); **players never move
  between the manager's own squad and a ring-fenced club**, either direction; a ring-fenced
  club may not import across a border; two ring-fenced clubs in one country MAY trade, priced
  at `gcnDomesticTransferPriceFactor` × value so a free intra-pyramid transfer stays
  impossible. Selling to the open market is allowed (the player leaves the network, so it
  strengthens nobody); feeder loans to a ring-fenced club stay banned (they move YOUR players).
- **Marketability is six 0–1 scores × six weights (v1.86).** `lib/marketability.ts`.
  A factor answers only "how well is this club doing at this thing, 0 to 1";
  `marketabilityWeights` alone says what that is worth, so re-balancing is one line and
  never a re-cut of the band tables. Three rules are load-bearing and each exists because
  the obvious version is wrong in a way only play reveals:
  **Europe renormalises away** when the club has no continental football — its 20 is
  shared across the other five, because scoring an unavailable factor zero caps season 1
  and every non-European nation at 80/100 and puts the top money band out of reach by
  construction. **A European campaign is floored** at the club's domestic-only score, or
  qualifying for a weak cup reads as *worse* than not qualifying (a real trap: winning the
  Conference League scored 89 against 100 for staying home). **Facilities are counted, not
  averaged** — total levels held / total available across `FACILITY_SPECS`, one point per
  upgrade, so a fifth facility moves the denominator by itself. It reads the STAFF
  facilities, never `economy.ts`'s income upgrades: scoring sponsor appeal off sponsor
  income is a loop.
- **A major sponsorship's annual value is one band, not a multiplier stack (v1.86).**
  `marketabilityOfferAnnual`: £16M at score 0, £80M at 100 (v1.91 cut both ends 20%),
  curve 1.6 — so a maxed club's 3-season shirt deal is ≈£235M. Everything else scales
  that by slot share and suitor tier. A blanket cut scales BOTH ends: moving only the max
  would flatten the curve, squeezing the gap between an ordinary club and an elite one,
  which is the thing the marketability score exists to express.
  The predecessor multiplied reputation × slot share × division ladder × tier ×
  marketability band × noise, which **double-counted the division** (32% of the
  marketability score it then multiplied by, and applied again as `aiCommercialTierMult`)
  and whose product couldn't be read off the tuning file at all. Don't reintroduce
  reputation here — every question it answered is a marketability factor now. Minors keep
  the old weekly model deliberately; they're measured in £k/week and don't divide down
  from an annual band sensibly.
- **A squad is a SHAPE, not a headcount (v1.89).** The AI could field one centre-back by
  season 5, and four separate defects had to be fixed before it stopped. Each was invisible
  in the tables and only showed up in a measured sweep — **measure before theorising**, and
  re-run the coverage sweep after touching any of them:
  1. `PositionNeed.incumbent` reported `ranked[0]` (the club's BEST player at the position)
     while the urgency arithmetic three lines above correctly used the marginal starter. A
     club with one 81-rated CB and a back four therefore scored every CB in the world as
     "not an upgrade". It is now the **marginal starter** — `ranked[slotsNeeded - 1]`, zero
     when the slot can't be filled — and `best` is the separate field for callers that want
     to describe the club. Nothing may compare a signing against `best`.
  2. `saleCandidates` protected only the top TWO needs and skipped that guard entirely when
     the stance `sellsStarters` — so a rebuilding club sold its last centre-back. Minimum
     natural cover (`aiMinSpareCover`) is now a hard floor that **outranks every stance**.
  3. `depth` counts adjacent cover, which a back four of full-backs passes. `naturalDepth`
     (players who actually LIST the position) is what the cover rules read. `isUncovered`
     in `ai/strategy.ts` is the single definition of "a genuine hole" — it compares against
     the FORMATION's requirement, since one CB is a hole in a back four and a full
     complement in a back three. Every path that treats a hole differently calls it; don't
     re-derive `naturalDepth < 1` inline.
  4. The world only ever LOST players: a regen is born only from a retiree peaking at
     `regenMinPeakOverall`, so the whole tail below it was a net loss every season. Over 20
     seasons the median squad fell 28 → 19 and CB cover fell to x1.32 per slot while 220
     free-agent CBs sat unsigned — the bodies existed but every buy path is discretionary.
     `replenishFreeAgents` (worldgen) restocks where the world is short, and `ensureAiSquads`
     (transfers) obliges every AI club to a squad size and a fieldable shape at the rollover.
     Both count demand and supply over the **same** population — mixing playable demand with
     world-wide supply makes a starved pyramid look healthy, which is how the first cut
     silently did nothing. The user's club is topped up FIRST (both draw on one pool; the
     other order left the manager with four players and no keeper).
     `freeAgentPoolFloor` (where routine AI signings stop) and `freeAgentPoolTarget` (what
     the restock aims at) are deliberately two numbers — equal, the pool pins at the point
     business ceases.
  Measured after: 0 uncovered positions at season 5, 1 across 40 clubs at season 20, squad
  sizes flat at ~24, calibration unmoved (2.63 goals/match), +29 players/season.
- **The same-season transfer lock binds EVERY club (v1.89), not just the manager's.**
  `p.acquiredSeason` is stamped by `completeTransfer` on a move into any club and cleared
  only by a release. The AI chokepoint is `saleCandidates` — every AI buy path shops from
  that one list, so the rule can't be bypassed by whichever path someone forgets; `userBid`
  carries it for the user's buy side. It began as a user-only rule, which let AI squads
  churn a player through three clubs in a window while the manager was held to one move.
- **Backroom wages scale with the manager's division (v1.89).** `staffWageMultiplier` in
  `lib/facilities.ts` is the single place the tier is read for staffing costs;
  `config/facilities.ts` stays pure data and takes the multiplier as an argument. Scouts
  price through the same function so the two departments can't drift onto different
  ladders. The ladder (`staffWageByTier`) is far flatter than the income one (2.6:1 vs
  38:1) on purpose — a good coach is a good coach anywhere. Resolved at HIRE time and
  stored on the person: a wage is a contract, so promotion doesn't hand out rises.
- **The roll of honour is DERIVED, never stored (v1.89).** `competitionHistories` /
  `clubHonours` in `lib/recordbook.ts` group `state.recordBook.seasons` by competition
  instead of by year. No new schema, no migration — a ten-season save already contains its
  honours list and simply had no reader, and because both views render the same rows the
  roll of honour and the season review can never disagree. Ordering puts the manager's own
  divisions first: every top flight is `tier: 1`, so sorting on tier alone buries the
  user's league behind whichever foreign one sorts first alphabetically.
- **A club's overall is its XI and bench, never a squad mean (v1.90).** `squadOverall` in
  `lib/selection.ts` is the single rule, read by the team card and by `gcnClubStatus`. A flat
  mean over the roster answers a different question badly: it is driven by how many fringe
  players a club carries, so two clubs with identical first teams read 8 points apart and
  SIGNING a squad player made a club look worse. The headline is
  `squadOverallXIWeight` (0.8) of the XI plus the rest from the matchday bench — the bench
  only, not every reserve, or the squad-size distortion comes straight back. It picks through
  the same `pickLineup` the matchday uses against the club's OWN formation, so the card can
  never quote an XI the simulation wouldn't name, and it ignores fitness deliberately: this
  describes a squad, not who is available on Saturday.
- **Selection is tactic-aware, through the engine's own lever (v1.90).** `selectionScore`
  takes an optional `tactic` and multiplies by `tacticalFitMult` (exported from
  `engine/match.ts`), which is exactly `synergyMult × instructionMult` — the two things
  `effectiveRating` already applies. This is **not** a third channel (see v1.78): it is a READ
  of the existing two, so the tables move selection and simulation together and cannot drift.
  Picked on raw overall alone, an AI club fielded the better player rather than the better
  player *for its tactic*, and could play possession with a squad of counter-attackers
  forever. The bench is ranked on the same terms — the in-match sub pass can only choose from
  who is on it. `bestXIIds` in `ai/strategy.ts` now goes through `pickLineup` too; it used to
  be the top eleven by raw overall, a list with no positions in it, so a club whose best
  players were six strikers protected an XI it could never field.
- **An AI club builds toward a tactic, and the hysteresis is the feature (v1.90).** Two halves
  pull opposite ways on purpose: `bestTacticFor` finds the shape suiting the players the club
  HAS, while `effectiveAt`/`targetScore` shop for players the CURRENT tactic wants (both take
  the tactic, so `need.incumbent` and the candidate are measured on the same terms — compare
  them any other way and the arithmetic is apples to oranges). `reviewClubTactics` runs once a
  season at the rollover, last, after squads have settled. `aiTacticSwitchGain` (4%) is what
  makes this an identity rather than a flip-flop: the search wins by a fraction of a percent
  on noise most seasons, and without a threshold every club re-picks its shape every year and
  none is ever *building* toward anything.
- **A club keeps its key players (v1.90).** `saleCandidates` protects the top
  `aiKeyPlayerCount` (6) by tactical value who ALSO clear `aiKeyPlayerApps` (60, ~two
  seasons). Both tests are needed: ability alone protects a summer signing nobody has seen,
  appearances alone protect a loyal squad player the club would happily sell. It is a
  reluctance, not a ban — an `aiKeyPlayerSellChance` (12%) roll still opens the door, derived
  from the world seed plus club/player/season so a rejected bidder **cannot re-roll it by
  bidding again**. Measured: without it the user could hollow out a rival by buying its best
  XI one player a window, since the players a club should least want to lose are precisely
  the ones that clear a buyer's upgrade bar. One wrinkle found by measuring, not theorising:
  worldgen seeds NO career rows, so at kickoff nobody cleared the apps gate (0 of 240 top-six
  players; 228 by season 5) and season 1 was an open raiding window. A club that has not
  played yet falls back to standing alone — a floor on the test, not a second rule.
- **A prospect's ceiling is his TIER; his current ability is his tier AND his age (v1.90).**
  `prospectTierBands[tier].potential` is one clean non-overlapping rung per tier (bronze
  65–70 → legacy 90+) because the ceiling is what the badge promises. Ability is the
  two-dimensional `prospectOverallByAge` (13→17), since a 13-year-old Gold and a 17-year-old
  Gold share a ceiling but not a rating. `prospectBandSlack` (±2) is what stops every Gold
  15-year-old being the same player, and it is why the bands themselves needn't overlap.
  `prospectOverallBand` is the lookup and falls back to the flat band for any age the table
  doesn't author (U21 rivals are 16–21), so no path can fail to roll a prospect.
  Two `generatePlayer` flags exist ONLY for this and must not spread: `overallIsAgeAdjusted`
  skips the maturity curve (the age table already states ability-at-age — running both
  discounts youth twice) and `allowBelowFloor` waives `minOverall`, a SENIOR-world rule that
  predates 13-year-olds. Both were found by measuring the finished player rather than the
  band: without them Bronze-at-13 came back 50–50 on every roll, collapsing the bottom rungs
  into one number. Academy intake and scouting share the 13–17 band, and `academyMaxAge` (21)
  is still when a prospect must be promoted, sold or released.
- **A match's calibration is not a season's (v1.91).** The engine hit every
  `calibrate` target — 2.7 goals, 45% home — while a 67-rated promoted side could win a
  division of 70+ clubs and a top-flight club could fall to the third tier. Those targets
  describe a MATCH and say nothing about WHO wins, so the whole dynamic range had
  collapsed unnoticed: measured, the best side in a division (85) beat the worst (70) only
  1.51-0.77, and finish-vs-squad-overall correlated 0.54. The cause was one constant.
  `chanceQualityCenter` is defined as "the ATTACK/(ATTACK+DEFENSE) of two equal teams" but
  was set to **0.385 when two equal sides produce 0.5** — the attack and defense columns of
  `PHASE_WEIGHTS` sum to ~5.4 and ~5.15, so an even match sits at a half. Centred below the
  match it centres on, an even game already sat 78% up the squash with 0.07 of headroom to
  `goalProbCeil`, and superiority had nowhere to go. It is 0.5 now, with `goalProbCeil`,
  `baseChancesPerSegment` and `chanceQualitySlope` raised to pay back the scoring that
  recentring costs and `homeAdvantage` cut to 1.04 (a sharper engine amplifies it too).
  `midfieldSharpness` moved only 2.2 → 3.0: it compounds a strength edge into chance
  VOLUME and its knee is early — 9.0 doubled discrimination but blew champion points to 106
  and collapsed the draw rate, which is a different wrong season. Measured after, 30 full
  seasons: correlation 0.65, champion points 89, the champion is the 2.3rd-best squad, 3.3%
  of titles go to a bottom-half squad. **Run both `calibrate` and `verify:standings` after
  touching any of the six** — a change that holds goals/match can still wreck a table.
- **A formation change rewrites what a club NEEDS, so coverage is checked after it
  (v1.91).** The rollover ran `ensureAiSquads` and then `reviewClubTactics`, so the coverage
  pass was answering a question about a shape the club was about to stop playing: a side
  switching to a 4-2-3-1 suddenly requires two DMs where its old formation asked for none,
  and no signing pass ran afterwards. Measured, that left a club starting a season with **0
  DMs against 2 slots while 10 unsigned DMs sat in a 90-strong free-agent pool** — the
  market, consent and the squad cap were all fine, which is why the market-side theories
  (scarcity, `canApproach` refusing everyone) were both wrong. Measure before theorising.
  `ensureAiSquads` now runs again after the tactic review, and `replenishFreeAgents`'s
  second pass moves after both so it restocks what the world is short of once every club
  has finished shopping. Cheap: `ensureAiSquads` is idempotent — it breaks immediately when
  nothing is uncovered — so the clubs that kept their shape (most, by `aiTacticSwitchGain`)
  pay a no-op.
- **`teamStrength` is the XI weighted against its bench (v1.91)**, the same quantity
  `squadOverall` reports, so a club's card and the table it finishes in come from one
  number. It was a flat mean of an XI picked in a hardcoded 4-3-3 with the bench ignored,
  which rated a club with no cover exactly as strong as one with a full squad.
- **A player file is not a save fragment (v1.91).** `lib/playerfile.ts` — export one player
  to JSON and sign him into another save ("alternate universes"). Three rules, each because
  the obvious version is wrong: **nothing world-bound travels** (`clubId`, `kitNumber`,
  `contract`, `loan`, `acquiredSeason` are stripped — they point at teams and seasons the
  destination never had); **an import always gets a NEW id**, since ids are unique only
  within a save and re-importing a file, or importing it into its own source world, would
  otherwise overwrite a real player; and **history travels by NAME, not by id** — the schema
  already stores `clubName` beside `CareerRow.clubId` and `from`/`to` beside
  `TransferRow.fromId`/`toId`, so the ids are dropped and the UI's existing name-only
  fallback renders the record. Importing is deliberately NOT a transfer: no fee, no wage
  negotiation, no consent roll, because a continuity tool that can fail for reasons the user
  can't act on defeats its purpose. It does respect `squadCap` and stamps `acquiredSeason`,
  so it can't be used to dodge the squad limit or the same-season resale lock.
  Distinct from `LibraryPlayer` (`lib/customdb.ts`), which is a blank-slate DESIGN template
  for worldgen and carries no career, honours or current ability.
- **Incoming bids have an off switch (v1.91).** `state.offersPaused`, gated at the
  `userPlayers` loop in `aiWeeklyTransferTick` — so AI↔AI business, loans and the rest of
  the market carry on; it silences the user's inbox, it does not freeze the window. Offers
  already on the table keep their deadlines (switching it on must never void a live
  negotiation), and a release clause is deliberately not gated: the clause is a term the
  manager agreed to, and honouring the toggle there would rewrite a contract from a UI switch.
- **A season is as long as the division is big (v1.91).** `leagueRoundCount(n)` in
  `lib/calendar.ts` is the single rule: `2 × (n − 1)` — 38 for 20 clubs, 46 for 24, 34 for
  18. `buildSeasonSchedule(season, rounds)` books that many Saturdays as ONE shared pool
  sized to the longest playable division, and `generateLeagueFixtures` takes the first
  `2×(n−1)` of them, so divisions of different sizes coexist on one calendar. Everything
  downstream (cup final, `simResolveDay2`, the dead week, season end) hangs off the LAST
  league round, never off index 37. Before this the calendar was a hardcoded 38 whatever
  the division held: a 24-club league scheduled its last rounds on `undefined` days and an
  18-club one padded the season with empty weekends. Both callers (`worldgen`, the
  rollover) must size the schedule AFTER promotion/relegation settles club counts.
- **A cup's beaten finalist is captured at the summary, or it's gone (v1.91).**
  `cupRunnerUpOf` in `recordbook.ts` reads the last round's played tie; the European ones
  come off each cup's own round-3 tie. Same reason `europeanWinners` is stored (v1.67): the
  rollover rebuilds the brackets a few steps later. Null when the final was a bye rather
  than a tie — an honest "nobody was beaten" rather than a guess.
- **The history views are DERIVED, like the roll of honour (v1.89's rule, extended v1.91).**
  `leagueHistories` / `cupHistories` / `userPlayerHonours` in `recordbook.ts` regroup
  `state.recordBook.seasons`; no new schema, no migration. `userPlayerHonours` reads each
  summary's stored accolade block and filters to the user's club exactly as
  `userPlayerAwardsIn` COUNTS it, so the Achievements tally and the modal listing it can
  never disagree. Anything new that shows history goes here, not in a component.
- **One overlay stack, one BACK (v1.91).** `overlayStack` in `store/gameStore.ts`. The team
  card moved out of the Competition screen's local state into the store, so player and club
  overlays share one chain: opening either pushes what it replaced, ← pops, ✕ clears the
  lot. A record book is a graph — season → player → club → player — and every hop used to
  be a dead end. An `owner` entry is for an overlay a SCREEN owns (the season review): the
  store can't reopen it, so it holds the id and `activeOwnedOverlay()` tells the screen to
  render it again. `pushCurrent` no-ops when the target is already on screen, or back would
  mean "the page you're reading".
- **The final-day scoreboard INVENTS NO FOOTBALL (v1.92).** `lib/livescores.ts`.
  `advanceDay` plays every AI fixture *before* handing the matchday back to the UI (so
  tables are current at kick-off), which means every other result on the last league round
  is already settled the moment the panel opens. Re-simulating them would produce a
  different set of results from the ones the save records — two answers to one question.
  What is invented is only the **clock**: each already-scored goal gets a minute from the
  fixture's own `matchSeed` and is revealed as the user's own clock passes it, so at 90'
  the panel *is* the real final table and a reload shows the same goals at the same times.
  It is therefore free — no second engine pass, on a screen already running a match.
  The live table is built by handing `computeTable` a **doctored fixture list**, never by
  patching a finished table: the tie-break (points → GD → goals scored) must stay one rule
  in `season.ts`, or a title decided on goal difference could be shown wrong on the very
  day it is decided. `isFinalLeagueRound` asks `leagueRoundCount`, never a hardcoded 38.
- **A cloud save goes up COMPRESSED, and only when it changed (v1.92).** `lib/cloud.ts` +
  `app/api/saves/[name]`. A save is ~8 MB by season 9 and grows +0.57 MB a season
  (measured, `scripts/perf.ts`), and Vercel meters **both** hops — browser → function and
  function → KV — so the old "raw save every 60s" cost ~15 MB a sync and put a 9-season
  save at 14 GB of Fast Data Transfer. Three compounding fixes, none of them game logic:
  the browser gzips the payload (save JSON is hugely repetitive — the same 35 attribute
  keys on thousands of players); the route **stores the compressed bytes as-is and serves
  them back that way**, so the function never inflates a multi-megabyte save on either hop;
  and the interval is 5 min with unchanged saves skipped entirely. **Don't decompress
  server-side** — that throws away half the saving and adds the CPU of inflating tens of
  megabytes per autosave. Because the route can't read the payload, save-list metadata
  rides in the `x-fl-meta` header. Durability is unchanged and must stay so: IndexedDB is
  written on every autosave and the pagehide/visibilitychange/quit flushes force the cloud
  copy current, which is why five minutes of drift costs nothing observable. Plain-JSON
  uploads still work (pre-v1.92 saves, a browser without `CompressionStream`) and both
  forms must keep coexisting — no cloud save may ever be stranded. `npm run verify:cloud`.
- **Club reputation MOVES (v1.92).** `lib/reputation.ts`. `Team.reputation` was stamped by
  worldgen and frozen forever, so winning the league changed nothing about who would sign:
  every gate that decides it — `willJoin`'s reputation test, `isPeerClub`,
  `consentPeerReputation` — read a day-one number. It now drifts once a season at the
  rollover toward a target blended from three DIFFERENT KINDS of evidence: the club's
  `squadOverall` (the largest weight — it is what a target can see for himself), its
  division's `leagueReputation`, and where it finished. Two rules keep it sane: it is a
  **drift, not an assignment** (`repDriftRate` × gap, hard-capped at `repDriftMaxPerSeason`),
  because a market gate that snapped to last May's table would let one lucky season buy
  world-class players; and the target is **absolute, never normalised**, so every club can
  improve at once rather than the ladder being zero-sum. Placement in the rollover is
  load-bearing at both ends — after promotion and the development pass, before
  `refreshValues`/stances/every summer market pass — which is what turns a title into
  signings in the *next* window rather than a season later. The user's club is treated
  exactly like every other, or the gates become a difficulty setting. `collectSeasonFinishes`
  must run BEFORE the promotion shuffle, which makes the fixture-derived tables unreadable.
  Measured (`npm run verify:reputation`): a dominant club going 72 → 84.6 doubled the
  number of 82+ players who would sign for it, 124 → 243.
- **A world must be able to GROW its own stars (v1.92).** The deepest cause of long-save
  squad decay, and the one that survived fixes to intake, recruitment, ageing, contracts and
  selection — because none of them touched it. `eliteResistMult` was keyed on current
  overall ALONE, so it could not tell a 70-rated future superstar from a 70-rated journeyman
  standing at his ceiling and damped both identically. Worked through the whole arc, that
  made an elite successor **arithmetically impossible**: a regen born with 91 potential,
  signed, and playing every minute of every season under ideal conditions, topped out at
  **76.9** by `growthEndAge`. Measured in a real world at season 11: 170 new players with a
  mean potential of 90.7, 164 of them at clubs, sitting at 60.5 overall aged 24+ with a
  30-point gap they would never close. The original world's 89-rated players exist only
  because worldgen creates them directly (superstar seeding runs at club creation and
  nowhere else), so as they retired the top of the game emptied and nothing could refill it
  — the world's best NEW player after 14 seasons rated 78 against an original top-50 mean of
  89. **Diagnose this class of bug by tracking the original cohort against the new one**
  (`ORIG top50` vs `NEW top50`), which separates dilution from decay; every aggregate looked
  like decay and it was dilution. Two changes, and both are needed: resistance now eases in
  proportion to REMAINING headroom (`growthHeadroomFullRelief`/`growthHeadroomReliefMax`),
  and the growth window widened (`growthEndAge` 26→27, `growthOldFalloffPerYear` 0.09→0.06)
  — the falloff, not the resistance curve, was the binding constraint, since by 22 the age
  multiplier had collapsed and no amount of relief had anything left to work on. The curve's
  real purpose is untouched: a player AT his ceiling has zero headroom and gets zero relief,
  so there is still no 19-year-old 90. Measured after: 85+ population 58 → 137 and sustained,
  best-10 mean 90 → 93.5, top-flight mean flat instead of falling to 72.8. Re-run
  `calibrate`, `verify:standings` and `measure:quality` after touching any of the four.
- **A world is an AGE PYRAMID, not a headcount (v1.92).** The fix for "squads degrade after
  ten seasons and nothing replaces the retirees". `replenishFreeAgents` (v1.89) held the
  population perfectly flat the whole time — the defect was invisible to it because it
  counts BODIES and mints them at 23–32, topping up the middle of the age curve while the
  bottom emptied. Measured over 15 seasons: 18–21 fell 545 → 119, **22–25 fell 712 → 27**,
  34+ climbed 23 → 871, mean age 23.7 → 31.5. The world was one cohort ageing together;
  when it retired it took the top of the game with it (top-flight squad mean 78.9 → 72.8).
  Two halves, and **neither works alone**:
  1. `replenishYouth` (worldgen) holds the under-`youthIntakeCohortMaxAge` cohort at
     `youthIntakeCohortShare` of the world — roughly the shape worldgen BUILDS, so it is
     the absence of decay rather than a boost. The two sides of that shortfall are counted
     over DIFFERENT populations, and both halves were wrong in a first cut:
     **demand** is `attached players only` (a world's youth requirement is set by the squads
     that will play them, not by how many mill about unsigned), while **supply** must credit
     the prospects already waiting in the market — omit that and the pass re-mints a whole
     generation every season on top of the one nobody signed, which measured as +230
     players a season against almost no retirement outflow and a world inflating 2,152 →
     4,087. But the credit is `youthIntakeMarketCredit` (0.75), deliberately **not** 1.0:
     crediting them all lets a saturated market switch intake off completely, and once that
     backlog ages out the world has no generation behind it — the same 23.7 → 27.8 age
     climb and quality decay, arriving a few seasons later. A partial credit throttles
     without ever switching off.
  2. `aiRecruitYouth` (transfers) has every AI club sign prospects on POTENTIAL. Without it
     the intake is never signed, and since development is driven by MINUTES an unsigned
     prospect never develops at all — he ages out having become nothing, which is exactly
     "the new players are youth players that never replace the world-class ones".
     Deliberately NOT scored through `targetScore`: that scores an UPGRADE, and a 16-year-old
     rated 48 is not one however high his ceiling (and loosening `aiMinUpgradeGain` would
     make clubs sign bad players for their first teams). Every stance's `targetAge` also
     starts at 17+, so the intake is below the youngest age any club shops in. It runs LAST
     of the rollover's market passes — a prospect is what a club does with SPARE capacity,
     never instead of a centre-back.
     The per-club cap must count **prospects** (young AND `aiYouthRecruitMinHeadroom` of
     headroom), not merely young players: a healthy squad already carries a dozen under-23s,
     so counting those met the cap before a single prospect was signed and the pass silently
     never ran — 744 prospects unsigned with no club near its squad cap, a symptom identical
     to having no recruitment at all. And the size gate is `aiYouthSquadCeiling` (32), **not**
     `squadCap` (50): the cap almost never binds, so gating on it let clubs hoard until the
     median squad hit 44 players. A club with a full book needs to play the prospects it has.
  3. **An AI club lets an ageing player's deal run out** (`aiLetsExpire`, contracts.ts).
     `rolloverContracts` renewed EVERY expiring AI contract unconditionally — "so no AI
     club loses a player to admin", the right instinct and the wrong rule: no club in the
     world ever declined to re-sign anybody, so a 37-year-old squad filler was re-signed
     every summer until he retired at 39. With the first two halves in place the 34+
     population still grew 23 → 594 over nine seasons, and **561 of those were ON CLUB
     BOOKS** — not veterans the market had passed over (33 of those), but players clubs
     were contractually obliged to keep. Those are the squad places the new generation
     needs. Three conditions, all required: past `aiExpireAge`, NOT among the club's best
     `aiExpireProtectBest` by overall (a club re-signs its captain at 35), and the squad
     stays at or above `aiSquadFloor` — a thin squad renews everybody exactly as before,
     so this can never be why a club cannot field a side. A roll, not a rule, or every
     club in a division sheds its over-33s in the same summer. It pairs with
     `retireUnattachedDays`/`retireUnattachedChance` in development.ts: a released veteran
     goes unsigned, accrues inactivity and retires the next summer, which is a realistic
     wind-down rather than a player vanishing off a roster.
  These two hold the world's SHAPE; the star-growth fix above is what holds its
  QUALITY, and neither substitutes for the other — with the pyramid healthy but growth
  still capped, the top flight's average starter aged 25.3 → 33.4 while its bench fell
  75.3 → 69.7, because the young players existed and were signed but could never become
  good enough to displace anybody. Use `npm run measure:quality` — it asks
  whether the world still contains world-class FOOTBALLERS, which `verify:squads` (shape)
  and `calibrate` (one match) both pass while it fails.
- **A cup draw happens when the bracket is known, not on the day (v1.92).** `ensureCupRound`
  keyed on `cupRoundDays.indexOf(currentDay)`, so the quarter-final could finish and the
  semi-final draw would not exist until the morning of the semi-final. Nothing required
  that: `drawCupRound` takes the round's day from the SCHEDULE and seeds off
  season+round, never off the day it is called, so an early draw yields the identical
  bracket. It now keys on `state.cup.currentRound` and is called immediately after
  `maybeSettleCup` in both `advanceDay` and `afterUserMatch` — the latter is the one that
  usually fires, since the user's own tie is typically the last of the round to settle.
  `ensureEuropeanRounds` does the same, walking forward through the rounds so several can
  become drawable at once.
- **A squad file is a DESIGN; a player file is a CHARACTER (v1.92).** `lib/squadfile.ts`
  exports the user's whole squad as a `ClubSeed` with an authored roster, which the Database
  Editor imports as an ordinary `LibraryClub` and any new legacy can be started with. It
  deliberately throws career history away — that belongs to a world, and this club is going
  to exist in a different one from its first fixture — where `lib/playerfile.ts` preserves
  history precisely because a character IS his record. Three things the obvious version gets
  wrong: `squadAvgOverall` must be **omitted** or worldgen bolts a second procedural squad on
  top of the authored one; `contract.expirySeason` must be re-expressed as a REMAINING term,
  since an absolute season means nothing in a world starting at 1; and the imported roster
  must be saved into the PLAYERS library too, because `LibraryClubModal` re-maps a roster by
  (name, position) on save and would otherwise drop the entire squad the first time the user
  opened and re-saved the club. `npm run verify:squadfile` drives the round trip through the
  real `materializePlayer` — that the JSON round-trips and that worldgen can BUILD the club
  are different claims.
- Interim implementations pending owner design sessions (marked in-file): transfer market
  AI (§10), trait pool. `emergencyIntake()` in gameloop is a stopgap until the Youth
  Academy ships.

## Design language

Dark theme (#0b0c0f), subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; signature element is the 1px `.gold-thread`.
Display face Saira Condensed (uppercase, scoreboard feel), body Instrument Sans,
`tnum` class for all data columns.

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
  `marketabilityOfferAnnual`: £20M at score 0, £100M at 100, curve 1.6 — so a maxed club's
  3-season shirt deal is ≈£293M. Everything else scales that by slot share and suitor tier.
  The predecessor multiplied reputation × slot share × division ladder × tier ×
  marketability band × noise, which **double-counted the division** (32% of the
  marketability score it then multiplied by, and applied again as `aiCommercialTierMult`)
  and whose product couldn't be read off the tuning file at all. Don't reintroduce
  reputation here — every question it answered is a marketability factor now. Minors keep
  the old weekly model deliberately; they're measured in £k/week and don't divide down
  from an annual band sensibly.
- Interim implementations pending owner design sessions (marked in-file): transfer market
  AI (§10), trait pool. `emergencyIntake()` in gameloop is a stopgap until the Youth
  Academy ships.

## Design language

Dark theme (#0b0c0f), subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; signature element is the 1px `.gold-thread`.
Display face Saira Condensed (uppercase, scoreboard feel), body Instrument Sans,
`tnum` class for all data columns.

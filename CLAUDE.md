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
- `npm run verify:v193` — drives a real world through the v1.93 features: the academy's
  age-ramped youth bonus, both commercial facilities reaching the actual books, the four
  archetype centers (including that a class's growth doesn't leak to another and that
  Blitzer having no center is harmless), and a full retraining programme run through the
  real rollover asserting the overall-preserving invariant
- `npm run verify:inbox` — the inbox grouping contract: that the folders are a true
  partition of every message type (unfiled mail would never render at all), that every
  folder is returned empty rather than vanishing, and that the per-folder actions touch only
  their own folder
- `npm run verify:rivalry` — drives the dynamic rivalry feature: both formation triggers and
  the near-misses that must NOT fire, that a derby multiplies only the two bonus tracks and
  only for the user, that the one-off sponsors expire with the fixture and are deterministic,
  dormancy and revival, and that a save with no rivalries computes exactly what it always did
- `npm run verify:quicksell` — drive a real world into an academy quick sell; asserts the prospect leaves the world and no club receives him
- `npm run verify:retirement [seasons]` — that a retiree is REMEMBERED and nobody is
  generated on top of him (v2.0). Simulates the page refresh the id-collision bug needed
  (serialise → reset the module counter → play), then asserts no generated player reuses an
  existing id, **no existing player is overwritten in place** (the check that catches it —
  it compares the person behind each id across seasons, which adding/removing keys cannot
  see), that retirees keep their career rows and their names, and that no newcomer sits in
  the user's squad carrying appearances he cannot have earned. `FL_REPRO_BUG=1` skips the
  fix and the harness fails loudly, which is how it is known to be able to
- `npm run verify:visual` — club badges and kits (v1.96): that derivation is stable and
  distinct, that a hand-edited spec degrades instead of blanking a crest, that a fresh
  world stores NO specs at all (the claim the whole design rests on — it also prints the
  KB avoided), that clearing an authored crest goes back to derived rather than freezing
  a copy, and that no generated away kit clashes with its own home shirt
- `npm run verify:overrides` — permanent edits to SHIPPED clubs (v2.0), driven against a
  real country database: that a patch reaches its club and touches ONLY the fields it
  names (its squad, reputation and colours must keep following the shipped database),
  that an override keyed on the shipped name still matches after it RENAMES that club,
  that clearing one goes back to a derived crest rather than a frozen copy, that an
  override never leaks across countries, and — the one that matters most — that a
  library with no overrides computes byte-identically to what it always did
- `npm run measure:growth [seasons]` — the career-GROWTH sweep, a measurement not an
  assertion. `measure:quality` asks whether the WORLD still holds world-class players;
  this asks what a manager asks about one of his own: "he has started 40 games a season
  for eight years — how much better is he?" It tracks a fixed cohort and reports the gain
  by starting age and by minutes played. A world can pass the first while failing this
  one, because population is held up by intake and recruitment while every individual
  career is flat — which is exactly the shape the v2.0 growth complaint had, and it is
  invisible in every aggregate `measure:quality` prints
- `npm run measure:veteran [seasons]` — season gain by the age it was PLAYED at (v2.1).
  `measure:growth` buckets by the age a player STARTED at, which is the right question
  for "did his career pay off" and the wrong one for "should a 34-year-old still be
  improving" — a player who starts at 25 and runs ten seasons is counted once, in the
  25–27 band, however much of that gain landed after he turned 33. This tracks every
  player-season and buckets the delta by his age that year. It is what showed the
  v2.1 defect: the whole 24–33 band was a PLATEAU at +0.2/season with a 33-year-old as
  likely to improve as a 26-year-old, and nothing turning negative until 35
- `npm run verify:familiarity` — squad familiarity (v2.1): that a club with NO record
  computes exactly what it always did (the property that lets it sit in the hot path
  and needs no migration), that it is CENTRED so the world's mean cannot drift, that a
  change of system costs in proportion to how much changed and is charged when the
  change is MADE, that a role brief costs nothing (it is not rehearsal), that
  familiarity does not travel with a transferred player, and — the one that caught a
  real design bug — that a settled SYSTEM cannot carry a stranger past the cap
- `node scripts/ui-test-identity.mjs` — drives the badge and kit creators through the
  real UI: both mount, all 51 patterns draw (including the tiled textures), an edit
  survives a save and a reload, and the crest reaches every other screen. Extended
  v1.97: re-branding a club the manager does NOT run, a whole division through the
  bulk editor (and that a row commits with no Save button), the club card's three
  kits and its inline editor, and the home shirt on a player's profile. Asserts only
  that things render and nothing throws — `verify:visual` owns the rules
- `npm run verify:gcn` — drive a real world into a live network; asserts owned clubs
  keep non-zero books that match what the tick banks, that net rises with reputation, and
  that the relaxed ring fence permits exactly the right moves. Extended v1.95: the three
  executive seats (a vacant seat is worth zero, service is a large share of a seat's
  ceiling, the football seat reaches owned clubs and NOT the manager's own), the hub
  pipeline end to end (build → file → sign → place → close), and — the section that
  matters most — that a save with **no network computes exactly what it always did**.
  Extended v1.99: pausing (a paused hub files nothing, keeps its level/prospects/upkeep,
  and resuming does NOT bank the batches the pause swallowed) and the hub brief, whose
  two halves are both measured over 60 batches — a named criterion is honoured far more
  often than chance, **and never 100% of the time**
- `node scripts/ui-test-gcn.mjs` — drives the GCN screen itself: unlocks the network
  through the real UI, then clicks every tab, builds a hub and appoints an executive.
  Asserts only that things render and nothing throws (the numbers are `verify:gcn`'s
  job) — which is the failure a rules verifier structurally cannot see. v1.99 adds the
  hub's brief and its pause toggle, and re-anchors the seat-card check on the term
  LABELS: it matched the literal string `"seat +"` off the old one-line sum, so rewriting
  that line into labelled rows made the harness report an empty seat while the card drew
  perfectly. Match labels, not arithmetic — the numbers are the verifier's job
- `npm run verify:brief` — the Tactic Creator's role brief (v1.99): that an unbriefed
  tactic is arithmetically inert, that a RANDOM brief is worth ~nothing across an XI (the
  zero-sum claim, measured over 4000 random briefs — the check that caught the first cut
  costing −16.7%), that briefing your own side gains and briefing roles you lack loses, and
  that a brief can't outlive the slots it names
- `npm run verify:achievements [seasons]` — the achievement catalogue (v2.0): the table
  (six rungs per ladder, ascending, no id both flat and tiered), the tier DERIVATION at
  every boundary including both ends, and — the section that matters — that the tallies
  are actually FED, by driving a real world through real rollovers and playing the user's
  own fixtures. Also that nothing a manager must DO is unlocked at kickoff, while the
  ladders describing the club he INHERITED legitimately are
- `node scripts/ui-test-achievements.mjs` — drives the Achievements screen: all seven
  shelves render, the tier pills and the six-pip ladders draw, a card names the rung it is
  chasing, the unlock stamp reads "SEASON n", and the deleted cards are gone. Asserts only
  that things render — the numbers are `verify:achievements`'s job
- `npm run measure:ratings [seasons]` — the match-rating SPREAD sweep. Prints the
  distribution, the season-average spread, the correlation with overall and the per-position
  breakdown. Not an assertion — a measurement to run before and after touching any `rating*`
  constant. It is what proved the v1.x formula gave every non-scorer 6.5 every week, and it
  is what caught the first v2.0 cut correlating NEGATIVELY (−0.20) with ability
- `npm run verify:sim-parity [n] [--save|--check]` — plays N seasons with the real loop and
  hashes the finished world (every division's table, the honours, and every club's roster
  with overalls/fitness/form). `--save` writes the baseline, `--check` asserts against it.
  This is how a SPEED change is proved to have changed nothing: run `--save` before, `--check`
  after. It is also the harness that found the fixture-id nondeterminism — before v1.99 two
  runs of one seed never agreed, so nothing about the simulation was assertable at all
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
- `node scripts/ui-test-tactics.mjs` — the Tactics board (v1.99): that the three-column
  grid holds identical widths across five viewport widths as the XI and then the bench
  fill (the layout shift a single viewport structurally cannot see), that the bench sits
  in the pitch's column with `benchSize` seats and that filled AND empty seats both open
  the sub picker, and that every roster row names an archetype. Also drives the **Tactic
  Creator**: that it opens, that every slot in the shape gets a role row, that both fill
  routes populate the brief and the live balance responds, and that a saved plan lands in
  Saved Tactics reading as a PLAN rather than as a snapshot naming nobody — the numbers are
  `verify:brief`'s job
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
- `lib/archetypedev.ts` — archetype RETRAINING (v1.93): the Development → Archetype tab's
  rules. Reshapes a player's 35 attributes toward a target archetype over a couple of
  seasons while HOLDING his overall — the redistribute-what-he-has route, as against a
  training plan's grow-into-it route. `conversionError` is the single ruling the UI greys
  options out with; `rolloverConversions` is what the season rollover calls.
- `lib/rivalry.ts` — dynamic rivalries (v1.94): which clubs this save's own history has
  turned into enemies, and what a derby is worth. Formation reads the record book;
  `isRival` is the single question every consumer asks (it answers "currently", so a
  dormant rivalry confers nothing while keeping its record). New rivalry rules go here,
  not in a screen.
- `lib/gcn.ts` — Global Club Network (§19, v34, end-game): funds/unlock, treasury, found/buy clubs (sim leagues only), inter-club moves & feeder loans, Operations upgrades. Rules only — the store calls in.
- `lib/gcnexec.ts` — the GCN boardroom (v1.95): three Global Executive seats, their
  elite market, and the three multipliers they produce. `globalFootballMult`,
  `globalCommerceMult` and `globalScoutingCostMult`/`globalScoutingSpeedMult` are the
  only exports the engine consumes, and every one returns exactly 1 (or full price)
  when its seat is vacant.
- `lib/gcnhub.ts` — International Scouting Hubs (v1.95): the region map (derived from
  `SCOUT_WORLD`), build/upgrade/close, the report pipeline, and the three routes a hub
  prospect can leave by. `hubPlacementError` is the single ruling the UI greys
  destinations out with; `hubFocusError` (v1.99) is the other one, for the brief.
  `setHubPaused`/`setHubFocus` are the two v1.99 levers.
- `lib/tacticbrief.ts` — the Tactic Creator's per-slot role brief (v1.99). The whole of
  what "I want a Sniper here" means to the simulation: `roleBriefMult` is the lever,
  `briefBalance` is what the screen prints, `pruneBrief` drops briefs a formation change
  orphaned. Rules only — `components/screens/Tactics.tsx` draws it.
- `lib/familiarity.ts` — squad familiarity (v2.1): what a side EARNS by playing
  together in one system, where the three channels above are what it LOOKS UP.
  `familiarityMult` is the lever (multiplied into `effectiveRating` and folded into
  `tacticalFitMult`, so it is the same one channel, not a fourth);
  `bankMatchFamiliarity` is the accrual, called from `applyMatchResult`;
  `applyTacticChange` is the cost of changing system; `familiaritySummary` is what the
  Tactics screen prints. Rules only.
- `lib/visual/` — club badges and kits (v1.96). `patterns.ts` is the shared
  pattern engine and all the colour maths (both consumers import it — the two
  creators shipped with a copy each, which is how a pattern added to a kit ends
  up silently not existing on a crest); `badge.ts` and `kit.ts` are the two
  specs, their generators and their rules; `identity.ts` is who may re-brand
  what. Rules only — `components/visual/` draws.
- `lib/assistant.ts` — everything the Tactics screen *says*: `assistantReport()` (the grade
  and its notes) and `squadBlueprint()` (the ideal role per slot, the ✓/~/✗ against the
  incumbent, and the shopping list). Both derive from the same functions the engine calls, so
  the UI can never claim something the simulation won't do. New advice goes here, not in the
  component — React must never implement rules.
- `components/screens/` — the screens (§14); `Gcn.tsx` is the GCN page (below Achievements, unlocked only); `components/ui.tsx` — design primitives
  **The GCN screen is SIX tabs, and each answers one question (v1.95):** Headquarters
  (how is the network doing — read-only, no actions), Clubs (the holdings, and
  founding/buying/selling them), Players (every player the network owns, filterable),
  Intl Scouting Hub, Treasury (all money), Operations (the boardroom and the upgrade
  tracks). The old four-tab shape had Headquarters be both a dashboard AND the launcher
  for all seven network actions, so "how is my empire doing" and "buy a club" shared one
  page and neither had room. **An action belongs on the tab that owns its subject** — put
  a new one there, not back on Headquarters.
  Note `.gold-thread` is a 1px DIVIDER element (it sets its own `height`), never a
  modifier on a container: applied to a card it collapses the whole card to a hairline.

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
  v2.0 raised both a further 50% (5.4→8.1, 3.6→5.4), and the accompanying change is the
  one to understand: **`primeGrowthPerfPivot` had to move with them (6.55→6.35), because
  the prime branch is a CLIFF and multiplying zero by 1.5 is still zero.** `primePerf > 0`
  is a hard gate, so a regular rating 6.56 grows and one rating 6.54 gains nothing ever.
  Measured (`measure:growth`, 8 seasons), that is where the reported "he played 40 games a
  season for eight years and gained 2 overall" lived: the 25–27 band gained +3.66 while
  carrying 10.3 points of headroom, and the youth bands were healthy throughout (+17.7 for
  the 16–18s) — so the defect was never the headline budget, which is all a raise to those
  two alone would have addressed. After: the "ever-present, room to grow, gained ≤2" case
  fell 8%→1% and career gain rose 8.88→12.89. **The cost is real and should be known
  before these move again**: 85+ population roughly doubles over a long save (507 vs a 256
  baseline peak) and the top flight's squad mean goes 81.5→84.8. `calibrate` and
  `verify:standings` are unmoved. Also expect `verify:conversion`'s "youth out of growth"
  rate to rise — faster growth spends headroom sooner, so a youth reaches his ceiling
  inside the 15-season walk where he used to still be climbing when it ran out. That is
  honest, and the check that proves it (rather than the re-baselined percentage) is
  "a youth told 'no growth left' has actually reached his ceiling" — 0 of 467 stop early.
- **A career is a CURVE, and the prime branch had no age term at all (v2.1).** The
  earned path — `primeGrowthPerSeasonMax × perf × minutes × facilities × elite-resist` —
  read identically for a 33-year-old and a 27-year-old, so v2.0's +50% landed at full
  strength on players a decade apart. Measured (`npm run measure:veteran`, 10 seasons),
  that made the whole **24–33 band a plateau**: +0.2 overall a season flat throughout, a
  33-year-old as likely to improve as a 26-year-old (12.7% vs 13.3%), and nothing
  turning negative until 35. `primeGrowthAgeMult` is the fix — full at `growthEndAge`,
  squared taper to zero at `primeGrowthTaperEndAge` (34), so it joins smoothly onto
  decline rather than arriving as a cliff. **Two companion changes are load-bearing:**
  the same taper is applied in the in-season tick AND in `seasonGrowthEstimate`, or the
  projection quotes a number the rollover won't honour (the v1.85 rounding lesson); and
  the late-prime drift now applies to the EARNED branch too, since a good season
  previously dodged ageing entirely — the same "nobody ever gets worse" hole v1.92
  closed for the ordinary case, still open for the good one. Measured after: the mean
  crosses zero at 34 and the 33+ "+3 or more" rate is 0.0%. Expect
  `verify:conversion`'s youth "out of growth" rate to rise (9.7% → 30.9%) — faster
  taper spends the projection sooner; the check that still matters is "a youth told no
  growth left has actually reached his ceiling", 0 of 455.
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
- **Identity is LOOKED UP and EARNED, and v2.1 rebalanced the two.** The three lookup
  channels — `synergyCap` (style×class), `instructionFitSwing` (role×dials) and
  `ROLE_BRIEF_SWING` (the Creator's brief) — compounded to a ~±30% band on effective
  rating, every point of it readable off a table. That is a RECIPE: derive it once and
  the answer never changes again. They are cut ~20% (0.16 / 0.05 / 0.06) and
  `lib/familiarity.ts` is the counterpart, paying for CONTINUITY instead. It rides the
  SAME lever — multiplied into `effectiveRating` beside the other three and folded into
  `tacticalFitMult` — so this is still one channel, not a fourth.
  **How far the lookup channels can be cut is measured, and two harnesses disagree
  about it.** Halving them (0.1/0.04/0.04) failed `verify:standings` (champion the
  4.7th-best squad) even though correlation IMPROVED to 0.695 — compressing the largest
  channel narrows the spread between clubs and lets noise decide more seasons. 0.12
  then passed standings and failed `verify:reputation`, which states it far more
  starkly: a deliberately stacked squad finished 2nd, 2nd, then 7th/13th/**18th**.
  `verify:standings` asks whether a table tracks quality across a division;
  `verify:reputation` asks whether a genuinely superior squad can WIN. **Run both.**
  `calibrate` is unmoved by all of it and structurally cannot see either failure.
  **Do not expect familiarity to buy back a lookup cut one-for-one** — it only ever
  separates clubs that DIFFER in how settled they are, and across a division where
  everyone keeps their system it contributes nearly nothing. Zeroing
  `FAMILIARITY_SWING` reproduced both failures byte-identically, which is how that was
  established rather than assumed.
- **A settled SYSTEM cannot make a stranger familiar with it (v2.1).** The player track
  is a CEILING as well as a term in the blend (`PLAYER_CEILING_HEADROOM` in
  `familiarity.ts`), because a plain weighted mean let the team track carry a newcomer:
  measured, a brand-new signing at a fully settled club came out at **×1.04 — better
  than average** — since 60% of his score was his club's grasp of a system he had never
  played in. That inverts the feature's central claim, which is that a big signing is
  worth less on debut than the settled incumbent he replaces. Note the three states
  `playerFamiliarity` distinguishes and why none may be collapsed: an ABSENT record is
  the CENTRE (untracked — a pre-v2.1 save), a record with no entry for the slot is
  `NEWCOMER_FAMILIARITY` (tracked, and he knows nothing yet), and a value is itself.
  `markNewcomer` writes an empty object rather than deleting for exactly that reason.
- **`paceReliance` reaches the MATCH now, not just ageing (v2.1).** It had two readers
  and both were in `development.ts` — nothing in a match ever asked the question the
  attribute is named for. `paceExploit` in `engine/match.ts` moves chance VOLUME when
  the opponent holds a high line: a Speedster punishes the space in behind, a Battering
  Ram does not. It is deliberately not a rating term — the point of pushing identity
  here is that two sides of equal strength should produce visibly different matches.
  `paceExploitPivot` is MEASURED (0.524, the attack-weighted mean across the archetype
  table), so an ordinary attack multiplies by exactly 1 and the world's scoring cannot
  drift; and it is gated on the line actually being exposed, so a deep block is never
  affected. Re-run `calibrate` if either constant moves — chance volume is precisely
  what that harness measures.
- Growth/decline emphasis reads the player's **training plan**, not his derived archetype —
  deriving it would be a feedback loop that entrenches an identity training can never move.
  `planScore` (auto-assign) is the opposite case and must read the attribute shape.
- **The default database is generated, not hand-edited.** `/public/database_presets/*.json`
  are build artifacts of `npm run build:db` — edit `fl26-*.csv` and rebuild, never the JSON.
  A country the CSVs don't cover keeps its previously-shipped JSON (the build preserves it),
  so rebuilding never makes a country unselectable.
- **A permanent edit to a shipped club is a PATCH, not a copy (v2.0).** `ClubOverride` in
  `lib/customdb.ts`, applied by `applyClubOverrides`, edited from the Database Editor's
  third tab (`components/DefaultClubEditor.tsx`). It answers a third question the two
  existing tabs don't: a custom club is "I want a club that doesn't exist", import-from-
  default is "I want a club LIKE Real Madrid" (an editable copy you must remember to place
  over the original at every new game, leaving two Real Madrids in the setup screen), and
  this is "Real Madrid's crest is wrong and I want it fixed in every legacy I start".
  Four rules, each because the obvious version is worse:
  **Every field is optional and only what's present is applied.** Storing a whole edited
  club would freeze its SQUAD at whatever the shipped database said the day it was edited,
  quietly opting that club out of every future `npm run build:db`. A patch that names only
  a badge changes only the badge, and the rest keeps following the shipped data. The store
  refuses to save a patch that patches nothing, so "reset to default" is the ABSENCE of a
  row rather than an empty one that would still read as "edited".
  **The key is country + the SHIPPED club name**, never an id — shipped clubs have no
  stable id (`defaultCountryDB` rebuilds them every call) and the name is what the visual
  system already keys a derived badge on (v1.96). So a rename patches `name` while still
  matching on the original, which `verify:overrides` asserts directly.
  **It applies at `dbForChoice`** in MainMenu, the one funnel every database choice passes
  through, so an edit reaches the shipped database, an upload and a generated world alike.
  The companion change is easy to miss and loses the user's edit silently if forgotten:
  `resolveCountryDBs` must count an overridden country as `modified`, or worldgen
  reconstructs a plain engine world from the SHIPPED definition and the edit exists only in
  the preview. Test that on the override's own `country`, not by finding the club in
  `base` — `base` already carries the patch, so a renamed club would no longer match itself.
  **Nothing in a running save reads it.** A world is built once; editing an override
  changes the next legacy, never the current one.
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
  **The market barely ever sells a badge, and as of v1.97 the RATE is what defends that,
  not a ceiling.** `BADGE_HIRE_TIER_CHANCE` states one probability per tier directly —
  bronze 3%, silver 2%, gold 1%, diamond 0.5%, obsidian 0.25%, legacy 0.1%, so 6.85% of
  candidates hold one at all — rolled highest-first, since the tiers are a ladder rather
  than six alternatives. Every tier is now reachable on the shortlist, which deletes
  `BADGE_HIRE_MAX_TIER`/`BADGE_HIRE_HIGH_TIER_CHANCE`/`BADGE_HIRE_ABSOLUTE_MAX_TIER`: at
  1-in-1000 a legacy hire is rarer than the old "gold is a genuine event" case ever was, so
  nothing became more purchasable. A small number does the cap's job better and is readable
  off the table, where the predecessor's real odds could only be recovered by multiplying a
  base rate by an age term by a star term by a cap roll by a uniform draw over seasons.
  Nothing about the candidate moves the odds — the old experience and star terms were
  near-inert (the hiring band is only 21–35) and made a badge read as a property of the
  person rather than luck of the shortlist. A further badge is conditional on the first
  (`BADGE_HIRE_SECOND_CHANCE` 10%, `BADGE_HIRE_THIRD_CHANCE` 1% — siblings off the same
  base, so the third is the rarer case *inside* the 10%, never a chain), and its tier comes
  off the flatter `BADGE_HIRE_EXTRA_TIER_WEIGHT` (40/30/20/5/2.5/1): once he demonstrably
  has a record, the question is only which tier the extra one is. Extra badges go at
  facilities he doesn't already hold one at — a badge is per facility, the same rule the
  earning side enforces. A shortlist you can buy pedigree off makes the ladder pointless;
  `verify:facilities` asserts every tier against its own stated probability (which catches
  a table edit that makes gold common — something a ceiling never could), that each is
  still reached at all, the multi-badge rates, and that seasons and tier always agree.
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
- **A scouting brief says WHERE and WHAT (v2.1).** v2.1 had cut `SendScoutModal` back to
  scout + region on the argument that the brief had become a form. That went one step too
  far: region alone means the manager pays a travel band and an open-ended weekly retainer
  to be sent whatever the generator rolls, which is precisely the decision he opened the
  screen to make. The position group and the archetype focus are back; the trip length and
  the level-5 acceptance filter are not, since neither moves the price and the point about
  the quote being legible still holds. **The engine side never changed** — `briefTarget`
  has always honoured both, generating a focused find from the archetype's own `planId`
  (the only way a scouted prospect genuinely READS as the role asked for, since an
  archetype is derived from attributes, v1.77). `archetypesForPosGroup` is the
  intersection the picker filters on and `scoutFocusError` is the single ruling it greys
  options out with — the same `hubFocusError` discipline: refuse an impossible pairing up
  front rather than letting the brief quietly ignore half of itself. Changing the position
  group prunes a focus it no longer reaches. `ui-test-mobile.mjs` asserts the filtering in
  both directions (a GK brief offers Vanguard and not Sniper, 5 roles against 45).
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
- **A Global Executive is a SEAT, not a hire (v1.95).** `lib/gcnexec.ts`. Three of them —
  Football, Commerce, Scouting — each driving exactly ONE network-wide channel. The shape
  is deliberately not the club's backroom: a club's staff system is a staffing PUZZLE
  (many people, ten buildings, an assignment grid, three badge slots each), and repeating
  it at network scale would be the same game played twice with bigger numbers. One hire,
  one salary, one blanket effect, and the only question is what pedigree the treasury can
  carry.
  What it DOES share is the scaling — `base` + per-STAR + per-BADGE-TIER — because that is
  the same idea at a different altitude, and one vocabulary beats a bespoke curve. **The
  split between the last two terms is the design**, and `verify:gcn` asserts it as a band
  (35–70% of a seat's ceiling must come from the badge): a brand-new 5-star appointment
  reaches about half a seat, and the rest is only ever earned by KEEPING someone. Without
  that split, re-hiring whoever tops the shortlist each month strictly dominates loyalty,
  and a decade-long appointment is a rounding error.
  Three rules are load-bearing. Every multiplier returns **exactly 1 when the seat is
  vacant** (the empty-board section of `verify:gcn` exists because these run on every
  match and every development pass in the world — a save that never unlocked the GCN must
  compute what it always did). The football seat **never reaches the manager's own club**:
  he runs that one himself with its own facilities and staff, and letting the boardroom
  multiply it too would make the GCN the best way to improve the team you actually pick.
  And the effect rides levers that ALREADY EXIST — `coachMult` in gameloop's
  `sideInputFor` (the named seam v1.79 left for exactly this), the sim resolver's strength
  read, and the development pass's facility multiplier — never a new channel. The football
  seat must move BOTH match sites or its worth would depend on which kind of league a
  holding happens to sit in, which is nothing the manager chose.
  The badge ladder is `gcnExecBadgeSeasons` (1/2/4/6/9/13), separate from the club staff
  ladder because an executive holds ONE seat rather than competing for three badge slots —
  the tiers have to be reachable inside a single career. Diamond and above are only ever
  earned at your own network, the same rule the club staff market follows.
- **A hub prospect belongs to the NETWORK, and no club (v1.95).** `lib/gcnhub.ts`. The
  International Scouting Hub is the end-game counterpart to club scouting: where a scout
  is a TRIP (hire, send, pay the travel, get him back), a hub is a permanent presence that
  files forever at a standard no hireable scout reaches. Its region grid IS `SCOUT_WORLD`'s
  26 sub-regions, derived and never hand-listed, so a region added to the scouting tree
  becomes a hub site by construction and a brief and a hub can't disagree about where a
  place is.
  Four rules, each because the obvious version collapses the feature back into a bigger
  academy:
  **A signed prospect has no `clubId`.** That is what makes the placement decision — keep
  him developing at the hub, promote him into your academy, or place him at an owned club
  in his region — the thing the feature is about. It is also a **trap**, and the one that
  had to be found by measuring: until v1.95, "no club" and "free agent" were the same
  statement, encoded in ~5 passes (`aiSignFreeAgent`, `aiRecruitYouth`, both worldgen
  replenishment counts, the inactivity retirement). Left alone, an AI club signs the
  prospect the treasury just paid for, and one nobody moved retires himself for inactivity
  inside a building you are paying upkeep on. `isFreeAgent(p)` in `lib/archive.ts` is now
  the single predicate — **use it, never `!p.clubId`** — so a future "held but not at a
  club" state is one clause there rather than another six-site sweep.
  **Placement is REGIONAL.** An owned club in one of the hub's own countries, and nothing
  else. A hub that could feed the whole empire is a talent teleporter that makes owning
  clubs anywhere else pointless; a hub that feeds its own region is a reason to own clubs
  THERE, which is the one rule tying the two halves of the network together. Same reason
  local presence discounts a build (`gcnHubPresenceDiscount`). Promotion into the
  manager's own academy is always allowed — it costs the region its player, and it is the
  reward for having built the thing. Loans out of a hub don't exist.
  **The tier roll goes through `rollProspectTier`**, with the hub's LEVEL expressed as an
  effective judgement (`gcnHubJudgementBase` 3.0 → 5.4 at level 5, past anything
  hireable). A second tier-rolling routine here would be a second answer to one question
  and the elite rates would drift apart.
  **Closing a hub refunds nothing** and releases who it held — the honest shape for a
  building put up abroad, and what makes the upkeep decision real. Its prospects are
  RELEASED, not deleted: the academy's quick-sell deletion exists so a manager's castoffs
  can't stock his domestic rivals, and a 15-year-old let go in Ghana is not that.
  Note `League.country` holds a DISPLAY NAME ("Spain") while every hub region holds a CODE
  ("ESP") — `countryCodeOf` is the bridge, and comparing the two directly (as the first
  cut did) makes every presence and placement check silently fail on a world where both
  are true.
- **A hub brief is a BIAS, and pausing is not closing (v1.99).** Two additions to
  `lib/gcnhub.ts`, and each exists because the obvious version is a different feature.
  **The brief** (country / position / archetype, any subset) rolls
  `gcnHubFocusHitChance` (0.7) **per named criterion**. At 1.0 it stops being an
  instruction to a scouting network and becomes a prospect generator — pick the nation,
  the position and the role and the hub mints exactly that, every batch, forever. At 0.7
  a briefed hub is obviously working (~4 of 6 on brief, measured) while still turning up
  the winger nobody asked for. The archetype steers the **training plan**, never a stored
  label: an archetype is DERIVED from attributes (v1.77) and a plan's weights are what
  worldgen shapes a line from, so `planId` is the only way to make a focused find
  genuinely READ as that role. Where the archetype and the position disagree the
  archetype wins (it is the more specific), and `hubFocusError` refuses a genuinely
  impossible pairing up front rather than letting the brief quietly ignore half of
  itself — it is the single ruling, and the picker greys options out with it.
  **Pausing** stops the reports and nothing else: the hub keeps its level, its prospects
  and its **full upkeep**. Closing was previously the only way to stop the tap, so a
  manager whose board was simply full had to demolish the building and release everyone
  in it. Resuming starts a FRESH cycle rather than delivering the batches the pause
  swallowed — otherwise pausing is a way to stockpile reports. Closing still exists,
  demoted to the dialog's footer behind its own confirmation, where it reads as the last
  resort it is.
- **The GCN's two weekly-income tracks are DELETED (v1.99).** `GcnFacility` is now
  `"groupClubs"` alone. Brand Deals and GCN Deals were passive weekly income bought by
  the level — precisely the shape v1.79 and v1.82 exist to delete on the club side — and
  between them the network's money problem was solved by pressing Upgrade rather than by
  running clubs and hubs well. `ops` is a partial record, so a pre-v1.99 save's two dead
  keys are ignored exactly as v1.62's four were: no refund, no conversion, no migration.
  **The Director of Global Commerce had to move, not just lose his multiplicand.** He now
  scales an owned club's own weekly income in `gcnSimBooks`, which is the better home for
  the same reason the tracks were the worse one — a return on running clubs rather than
  on having pressed Upgrade. He still returns exactly 1 when the seat is vacant.
  One consequence worth knowing: **the treasury now has no weekly inflow at all**. It is
  filled by depositing from your club and by selling a holding, and every line in
  `TreasuryBooks` is an outflow. That also broke a check in `verify:gcn` that asserted
  "a club's own budget is untouched by the boardroom" by MAGNITUDE (the swing is smaller
  than the exec wage bill) — a proxy that stopped separating the two things the moment a
  club's own trading could legitimately exceed the payroll. It asserts the claim directly
  against `gcnSimBooks` now.
- **An executive seat's arithmetic states its UNITS (v1.99).** The card printed the three
  terms `execEffect` returns as a bare sum — `5.0 seat + 15.0 stars + 10.5 badge` — which
  named them but not what produced any of them or what the headline was a percentage OF.
  They are labelled rows now (`EffectTerm` in `Gcn.tsx`): **The seat** *just for filling
  it*, **Pedigree** *5★ × 1.4%*, **Service** *the badge, and how long he has served*. The
  `detail` is the load-bearing half — the three terms are worth wildly different amounts
  and never for the same reason, so a bare "+15.0" says nothing about which lever the
  manager could actually pull to move it.
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
  **A squad file names ONE roster, and has a third destination (v2.0).** `SquadRoster`
  (`"senior" | "academy"`) replaced an `includeAcademy` flag, because the two are different
  exports rather than one with an extra: a senior squad is a TEAM, an academy is a PIPELINE
  of teenagers rated 48 who are only interesting for what they might become, and bolting the
  second onto the first produced a club seed nothing downstream could separate again. The
  field is optional, so a pre-v2.0 file reads as `"senior"` and needs no migration.
  `importSquadFile` is the third destination — signing a file into a world already being
  played, which is what the format was NOT built for and why a manager who wanted his old
  academy in his current legacy previously had no route at all. It borrows the player file's
  three rules wholesale (nothing world-bound travels, every arrival is re-keyed, no history
  comes with it) and adds two:
  **A loan does not survive the crossing** — a player out on loan arrives at his parent club,
  available. That falls out of the format (a `PlayerSeed` has no `loan` field) rather than
  being enforced, which is exactly why `verify:squadfile` asserts it: the rule is a promise
  the feature makes, not a line anyone would notice deleting.
  **The file's own roster decides where it lands**, and the caller may not override it — a
  14-year-old rated 44 dropped into a first-team squad is not a signing anyone meant to make,
  and a 31-year-old in the youth roster breaks every age gate the academy owns. The
  destination's cap is passed IN (the two caps live in different modules), and whatever
  doesn't fit comes back in `skipped` for the caller to report: silently landing half a squad
  is the worst outcome this path has. Like a player import it is deliberately not a transfer
  — no fee, no negotiation, no consent roll, no window.
- **Ten facilities now, and the level term is no longer the exception (v1.93).** Six
  landed at once: the commercial pair (**Club Income Center**, **Club Expense Center**) and
  four **archetype development centers**, one per class. The `verify:facilities` sanctioned-
  level-channel list therefore had to be widened a long way, which is exactly the creep the
  list exists to prevent — so the guard was **strengthened as it was widened**, and the new
  checks are the ones to keep:
  the ETC and HPC are asserted to have **no** level term (they are the thesis in its purest
  form — growth and elite relief are bought entirely with people); every `staffSlots`
  channel must **equal `slotsByLevel`** (it is a restatement for the card to draw, never a
  second source of truth); and every v1.93 channel that is a RATE rather than a capacity
  must take **at least as much from staff as from levels**. That last check found a real
  defect in the design brief's own numbers — the squad and academy wage cuts were specified
  4-from-levels against 1-from-staff, the bought-by-the-level shape v1.79 exists to delete
  — and a badge track was added to both to fix it. Conversion speed is **stars only**, so a
  maxed archetype center is a staffing achievement, not a purchase.
  There are **four** archetype centers, not five: `Blitzer` has none, so a player can never
  be retrained INTO a Blitzer. Deliberate (it is already the class with the sharpest style
  edges, winning two of six styles outright) and handled by resolving the class through
  `archetypeDevFacilityFor`, which returns null — no path special-cases it.
- **Every archetype class has a development center (v1.94).** The v1.93 cut shipped
  FOUR for five classes, leaving `Blitzer` the one class a player could never be retrained
  INTO — so the direct counter-attacking roles were the only ones in the game that had to
  be bought or grown rather than coached. An asymmetry that big has to be a rule the player
  can read, and "every class has a center" is the readable one. `ARCHETYPE_DEV_CLASS` is now
  DERIVED from `ARCHETYPE_CLASS_ORDER` rather than hand-listed (the id is the class name
  lowercased + `Development`), so a class can never exist without its center; the
  `FacilityId` union still spells all five out, which makes a mismatch a compile error.
  `verify:facilities` asserts the coverage both ways and that every center round-trips
  through `archetypeDevFacilityFor`/`archetypeDevClassOf`. What must still hold — and is
  checked — is that an UNRECOGNISED class resolves to no effect rather than throwing:
  callers pass a *derived* archetype's class, and a player with no derivable archetype has
  none at all.
- **The inbox is FOLDERS, pre-declared and collapsed (v1.94).** `lib/inbox.ts` owns the
  grouping; the Home screen renders it and never decides what "Transfers" means. Two
  properties make it an organised mailbox rather than a list with headings, and both are
  asserted by `verify:inbox`: the folders are a true PARTITION of `InboxItem["type"]` (a
  type nobody filed would be mail that never appears on screen — the worst failure here and
  one clicking around would not reliably reveal), and **every folder is returned whether or
  not it holds mail**, so the shape of the screen doesn't move under the cursor as post
  arrives. Grouping is by TYPE, not by week: the type is already what `INBOX_TAG_META`
  colours and already what the manager is scanning for, and a date grouping just reproduces
  the flat list with extra steps. The cap is now PER FOLDER (40) rather than 30 across the
  whole inbox — the old shape let a busy transfer window push every academy report out of
  view entirely. The per-folder mark-read/clear actions exist because the whole-inbox ones
  are too blunt once mail is filed: clearing fifty read scout reports must not also delete a
  live bid.
- **A rivalry is EARNED, and it multiplies an investment rather than paying out (v1.94).**
  `lib/rivalry.ts`. Nothing is seeded by worldgen or authored in a database — two clubs
  become enemies because of football that happened in this save. Two triggers: a shared cup
  final (one match, settled on the spot), or both clubs inside `rivalryTitleRaceTop` for
  `rivalryTitleRaceSeasons` **consecutive** seasons. Three seasons is doing real work — in a
  division where the same six clubs share the top places, two is a coincidence and three is
  a pattern — and the user has to have been up there every one of those seasons too, since a
  rivalry is mutual. Both read `state.recordBook.seasons`, the same derived-not-stored
  discipline the roll of honour follows; what IS stored is the rivalry, for the reason
  `cupRunnerUp` is stored (the record book gets compacted and the fixtures behind it are
  gone). Three rules are load-bearing:
  **The payout multiplies the Performance and Stadium Bonus TRACKS** (`rivalryMatchBonusMult`,
  3×) and nothing else in the books — so it pays a manager who invested in them, and a club
  that bought neither earns nothing extra from hating anybody. Flat derby cash would be a
  windfall; this is a return on a decision. `rivalryMatchMultiplier` returns exactly 1 for
  every ordinary match and for `undefined`, so a save with no rivalries is arithmetically
  untouched and every existing `matchUpgradeIncome` caller is unchanged.
  **The one-off sponsors are OFFERS, not payments** — priced off the club's own minor rate
  (so a derby is worth proportionally the same to a fourth-tier club as to a giant), tabled
  before the ordinary market pass so they take the open slots first, exempt from the
  live-offer cap (that cap exists to stop the ROUTINE market becoming an inbox), and
  expiring with the fixture. A derby offer that outlived the derby is just an ordinary minor
  at a better rate.
  **A rivalry goes dormant but is never deleted** (`rivalryDormantSeasons`). A club relegated
  three divisions is not your rival, and without this a rivalry pays forever on a fixture
  that can never happen. Keeping the record means a promoted club resumes the rivalry it
  already had, head-to-head intact, rather than starting a fresh three-season count.
  A title race must also be ONE division: three top-three finishes spread across a promotion
  are three finishes in two different races, and the derby they'd create can't even be
  scheduled. `verify:rivalry` drives all of it, including that an AI club never earns derby
  money and that a pre-v1.94 save (no `rivalries` field) loads as having none.
  **Measured, and the number to know:** across four played worlds (14/14/14/10 seasons) a
  save carried 1–3 rivalries and 0–61 derbies — but **every one formed on the cup final and
  none on the title race**, because no world produced three CONSECUTIVE top-three finishes
  (best run 1,4,3). The trigger is correct; the pattern is rarer than it sounds. If the
  title-race route should actually fire, the lever is `rivalryTitleRaceTop` or counting N of
  the last M seasons — NOT lowering `rivalryTitleRaceSeasons`, which is the thing that makes
  it a pattern rather than a coincidence. See the measurement note in `lib/rivalry.ts`.
- **Retraining redistributes; a training plan grows (v1.93).** `lib/archetypedev.ts`. The
  two routes to a new identity answer different questions and must not be collapsed.
  `verify:conversion` measures what a PLAN costs: 41% of 16–18s convert, 17% of 22–24s, 2%
  of 29–33s — correct, because a plan is a bet on growth and a finished player has nothing
  to bet with. Retraining is the route the money buys: it moves attribute points from what
  the target role doesn't use into what it does, so it works on a settled 30-year-old.
  The invariant is **structural, not checked**: the reshape ends in
  `fitAttrsToOverall(..., his current overall)`, so whatever the interpolation did to his
  rating the settle puts back. Two things that look optional and are not — completing a
  programme **sets his training plan** to the target's (otherwise the next summer's growth
  steers him back and the feature quietly reverses itself), and `rolloverConversions` runs
  **after** the development pass (growth redistributes attributes too, and the last writer
  wins). Cancelling **keeps** the reshaping already done: it is real training, and undoing
  it would let a manager probe the system for free.
- **The squad blueprint gives a LINE variety, and the grade doesn't punish you for it
  (v1.93).** The blueprint used to pick each slot's best archetype independently, and since
  the style term (±15) dwarfs the dial term (±6 × swing) the answer was very nearly a
  function of the STYLE alone — so every slot sharing a position got the identical role.
  Measured: a 4-3-3 returned **7 distinct roles of 11** and a 4-4-2 only 6 (two Architect
  centre backs, two Constructor full backs, two Maestro centre mids, every time). A
  position GROUP is now solved together, greedily taking the best role not already used in
  that line; measured after, **9–10 of 11** across five formations × six styles.
  The load-bearing companion change: the ✓/~/✗ is graded against the **best role available
  at the position**, not against the slot's differentiated `ideal`. Grading against the
  latter would mark down a side fielding two Architects — a role the blueprint explicitly
  wants in that line — and swapping the two players between slots would flip which one was
  flagged. `BlueprintSlot.gap` is that figure; `weakest` and `wants` sort on it, and
  nothing may recompute `idealPct - actualPct` inline again.
  Note LB/RB and LW/RW still share a role, correctly: they are different `Pos` values, so
  they are separate groups of one. Mirrored flanks share a job; paired central slots don't.
- **"I followed the blueprint and I'm still a C" was a real gap, not a misunderstanding
  (v1.93).** The grade is 55% attribute fit, 30% style synergy, 15% instruction fit, while
  the blueprint ranks roles on style and dials ALONE — so a manager who matched every slot
  had addressed 45% of his grade and been told nothing about the largest term. Both halves
  are right to be what they are (a blueprint must talk about ROLES, which are things you
  can go and buy; attribute fit is a property of the eleven specific players). What was
  missing was anyone saying so, which is the "Right roles, wrong players" note in
  `assistant.ts`. It fires only when the roles ARE good, or it becomes noise on the side
  that needs the simpler message.
- **The academy is a better place to be YOUNG (v1.93).** `academyYouthAgeBonus` in
  `lib/academy.ts`, folded into the same `extraGrowth` term every other academy lever uses.
  An AGE ramp, not a flat bonus: full value at `academyYouthPeakAge` (16), decaying to
  exactly 1 at `academyMaxAge` (21). Flat, it would say "the academy is simply better",
  making promotion always a mistake and the age-out a punishment; ramped, the real decision
  — hold him for the coaching or promote him for the senior minutes that drive everything
  else — is live and its answer changes with his age. It is also the only academy bonus a
  prospect who never featured gets at all, which is the point: a 15-year-old is there to be
  coached, and a season of that used to be worth nothing.
  One trap this sprang: the gameloop's U21-squad nudge was gated on `!academyBonuses[p.id]`,
  which was "did he play" only because almost nobody had an entry. Now nearly everyone does,
  so it reads `youthStats.apps` directly.
- **World presets save the BACKDROP, never the career (v1.93).** `WorldPreset` in
  `lib/customdb.ts`, stored in the existing owner-scoped library record. It holds the
  included countries, their pyramid depths and the European qualification design — the two
  most laborious parts of setup and the two least likely to change between saves. It
  deliberately omits the playable country, club, start tier and takeover: those are the
  choices a new legacy exists to make, and a preset that picked your club would be a saved
  game. `LIBRARY_SCHEMA` was **not** bumped — the field is optional and defaults to empty,
  and bumping would have discarded every saved club and player on the device to add it.
  Applying a preset filters to countries this build still offers, so a removed country
  can't resurrect a code worldgen cannot resolve.
- **A badge is DERIVED unless somebody drew one (v1.96).** `badgeFor` / `kitsFor` in
  `lib/visual/` are the single question every consumer asks — **never read `club.badge`
  or `club.kits` directly**, or an unedited club renders as nothing. A club with no
  stored spec still has a crest and four jerseys, hashed from its name, short code and
  colours. That is what makes the feature affordable: storing a spec on all ~800 clubs
  would add ~85KB to every autosave (measured, `verify:visual`) to record what a hash
  computes for free, and it would FREEZE the generated look, so improving the generator
  could never reach a club that already existed. For the same reason, clearing an
  authored crest **deletes the field** rather than storing a copy of the generated one.
  The seed is the club's NAME, not its id: identity travels between worlds (a squad
  file materialised into a new save), ids don't. Schema v49 adds both fields as
  optional and the migration converts NOTHING — a v48 save is already a valid v49 one.
  **The clash rule compares what a shirt READS as, not every colour on it.** A blue-and-
  white striped home shirt against a white-and-blue away shirt is the classic real change
  kit; comparing all visible colours makes them clash because blue appears on both, and
  that left **67 of 72 generated clubs unable to field their own away kit**. `kitsClash`
  reads the BODY colour, plus the pattern colour only for `EVEN_SPLIT_PATTERNS` (halves,
  stripes, hoops…) where the shirt genuinely is two colours. The companion rule is in the
  generator: when the home kit is even-split the away shirt takes a NEUTRAL body rather
  than inverting the pair, since inverting produces a colour already on the opposition —
  that was the residual 24 clubs. Both numbers came from measuring a real world, neither
  was visible in the tables. Run `npm run verify:visual` after touching either.
  `ClubBadge`'s `inline` prop exists solely for the kit's chest badge: the component
  otherwise sizes itself in CSS pixels, which a parent SVG's viewBox does not scale, so
  a `size` prop or a `<g transform>` puts the crest at screen size somewhere off the
  shirt. `node scripts/ui-test-identity.mjs` is the render check a rules verifier
  structurally cannot make.
- **Re-branding a rival is a COSMETIC authority, and it is asked for (v1.97).**
  `setClubIdentity` still refuses any club the manager doesn't run; the Identity
  screen's "edit other clubs" and "bulk by division" modes, and the club card's
  editor, pass `{ allowAny: true }`. The split is kept rather than collapsed because
  nothing in the simulation reads a badge or a kit — so this can't be an exploit —
  but a future consequence of a re-brand would be, and `runsClub` is the predicate it
  must gate on. `verify:visual` asserts BOTH directions (the default path is still
  closed, `allowAny` opens it, and an unknown club is refused either way): if the flag
  ever became the default, only the first of those would fail.
- **The bulk editor trades depth for width, and it commits per row (v1.97).**
  `components/visual/BulkIdentityEditor.tsx`. The creators are the right tool for one
  crest and the wrong one for twenty, where the job is "make this league look right"
  rather than "perfect this badge" — so a division is a TABLE of dropdowns, one row
  per club, drawing through the same two components and normalising through the same
  two functions, so it can express nothing the creators can't. There is deliberately
  no page-wide Save: twenty unsaved clubs behind one button either writes all of them
  or loses all of them, where a row is small enough that "changed it, it's changed" is
  honest, and `Reset` puts it back to derived.
  Both this and every other identity surface must take `rev` in their `badgeFor`/
  `kitsFor` memo deps. The store mutates a club IN PLACE, so the object identity is
  the same before and after a commit and a memo keyed on the club alone never
  invalidates — measured, that made a committed bulk row go on drawing (and its
  dropdowns go on REPORTING) the identity it had before the edit.
- **The calendar and the fixture rail ask different questions, through ONE gate
  (v1.98).** `components/Calendar.tsx` is a 70/30 split: the month grid answers "what
  does this month look like", the Upcoming rail answers "what is coming", which is the
  question a manager actually has and which a month grid can only answer by paging. The
  rail lists the next ten of the user's UNPLAYED fixtures in abbreviation (competition
  mark, H/A, crest, short code, date) and clicking one simulates up to **and including**
  that match — the fixture's own `day` IS the target, so the rail needs to know nothing
  about how the engine plays a matchday. Both surfaces set the SAME `confirm` state and
  run the SAME `simulateToDay`, and both apply the same gate (a future day, inside the
  season, not while a match of yours is pending), so the rail can never fast-forward on
  terms the grid wouldn't. Adding a third way to skip ahead goes through that state too,
  not through a second dialog.
  **Results is Upcoming's mirror image (v1.99)** — the last five PLAYED fixtures, most
  recent first, under the same rail in the same abbreviation. "What is coming" and "how
  has it been going" are the two halves of the question a manager opens this screen with,
  and the column had the room. It is deliberately NOT clickable: every other surface here
  is a way to fast-forward, and there is no such thing as fast-forwarding to the past.
  `ScoreLine` gained a `size` (`cell` | `rail`) rather than a second copy — it is drawn
  in a month-grid square that shares its space with a crest and a date, and in a rail row
  where the score IS the payload.
  The day cell's short code went 9px→11px and `text-dim`→`text-ink`, and both rails' codes
  11px→13px: at the old sizes the abbreviation was set smaller than the crest beside it,
  so the label was losing to its own icon — which is the whole thing v1.97 widened this
  column to buy.
  **v2.0 puts the club's FULL NAME in both rails** — the short code stays in the month
  grid's day cell, and the distinction is the room each has. A day cell is one of seven
  columns and shares its square with a crest and a date; a rail row is a list in a column
  of its own, and "Nottingham Forest" is what a manager reads a fixture list for.
  `truncate` still holds the longest ones.
- **The Home page is CALENDAR then inbox (v1.99).** Both belong in the wide column —
  v1.97 moved the calendar out of the narrow sidebar because seven columns of month left
  each day barely wide enough for a crest — but the ORDER was backwards. The calendar is
  what the manager ACTS on (the only place he can fast-forward from); the inbox is what
  he reads. The thing you press was below the thing you scroll, so a full mailbox pushed
  it off the fold.
- **The treasury's quick amounts are ABSOLUTE and they ADD (v1.99).** `TRANSFER_STEPS` in
  `Gcn.tsx` — +£1M / £5M / £10M / £50M / £100M / £1B, plus All. The predecessor was
  10/25/50%/All, and a share of the source is the wrong unit at end-game scale: 10% and
  25% of a treasury are both "some enormous number", while the manager's actual question
  is "move fifty million", which took typing. They add to what is already in the box
  rather than replacing it (hence "+£10M", not "£10M") — that is what lets a six-rung
  ladder cover the whole range — and each is clipped to what the source holds, so a step
  can never propose an illegal transfer.
- **The wire is THIS SEASON; Big Money is ALL TIME (v1.98).** `TransferNewsTab` in
  `Transfers.tsx` reads two slices of one feed and the split is the point. The Market
  Wire filters to `n.season === game.season`: a long save accumulates thousands of
  completed deals and the wire re-rendered every one of them, grouped into season
  chapters nobody scrolls to — a market wire is NEWS, and last decade's window is not
  news. Big Money reads the unfiltered feed and ranks the **top 10 fees ever paid** in
  the world. The window scopes (SUMMER/WINTER/THIS SEASON/ALL TIME) are deleted along
  with `WindowScope`/`windowOf`: a "top 10 of this summer" is a leaderboard of whatever
  happened to be signed in twelve weeks, not a record, and once the two views answer
  genuinely different questions there is nothing left for a scope to pick between.
- **A cup is TWO different things at two different times, and one layout can't serve both
  (v2.0).** `CupView` in `Competition.tsx`. This is the page's third shape: v1.91 deleted a
  full bracket for one stacked card per round (a six-round tree of 32 first-round ties
  rendered as a scrolling grid of three-letter codes with the scores off the right edge),
  which fixed legibility and lost the shape — six full-width cards down the page, the
  first 32 ties long, the final several screens below the fold. Now the EARLY rounds
  (a mass of ties nobody follows individually) are parallel COLUMNS, one per round, so a
  manager sees his own run through them without scrolling past everyone else's; and from
  the QUARTER-FINALS it becomes a real bracket, which is both few enough ties to draw as a
  tree and the point at which "who could I meet in the final" starts being a question.
  `bracketFrom` is DERIVED from the round names (the round matching `/quarter/i`, else the
  last three) rather than hardcoded to 3, so a country authoring a different number of
  early rounds still puts its bracket at its own quarter-final. The bracket appears once
  that round is DRAWN — which since v1.92 is as soon as the previous round settles, not on
  the morning of the tie. Measured against a real season: the split lands QF/SF/Final, the
  bracket goes live on day 151, and the columns' reserved shape (4/2/1 `Not drawn`
  plinths) matches the real tie counts exactly.
- **A European cup leads with its BRACKET once the knockout starts, and never re-prints
  its own results (v2.0).** `EuropeanView.tsx`. The group tables stay all season (they are
  how the survivors got there) but drop below the knockout under a heading saying they are
  final — a manager opening the page after the Round of 16 is asking who he plays next,
  not what the table looked like in November. The per-matchday **Fixtures list is deleted**:
  it re-printed every result the groups and the bracket had already reported, at three
  times the length and in short codes. Both brackets (this and the cup's) centre each
  column against its neighbour — `justify-center` on a column of two sits it level with the
  middle of the column of four beside it, which is what lets the eye follow a club through
  the tree with no connector drawn — and both use full club NAMES, since a 200px column has
  the room and a bracket read in three-letter codes is a puzzle rather than a picture.
- **The player-honours board groups by AWARD, then by PLAYER (v2.0).** `PlayerHonoursModal`
  in `Achievements.tsx`, and it is the one tally on that screen that needed its own modal
  rather than the shared chronological `HonourDetailModal`. "Player Honours" is not one
  honour counted many times: it is nine different awards sharing a single number on the
  card, so interleaved by season the actual question ("who of mine has ever made the Team
  of the Year?") could only be answered by reading every row and sorting it mentally. One
  section per award, in `ACCOLADE_ORDER` (fixed by prestige, so the board reads the same in
  every save), each with its emblem, its `blurb` — which says what winning it MEANS and had
  nowhere to appear before — and its count; an award never won is still drawn as an empty
  plinth, the same way `HonourCard` draws an unwon honour. Within a section winners are
  grouped by player, so three Golden Boots are one line reading "×3" with the years beside
  it rather than three rows that never sat together. `Modal` gained an `xl` size for this
  and the Tactic Creator — reach for it only when the content is genuinely a COLUMN PAIR,
  not merely long; a long single column is what scrolling is for.
- **A kit shows where the question it answers is being asked (v1.97).** The club card
  carries the outfield shirts — a club card is about the team you'd face, and those are
  the three a referee chooses between. **v1.99 added the keeper shirt beside them**, which
  was one shirt too few: this is the only screen in the game that shows a club's kits at
  all, so leaving it out meant the one jersey a manager could never see anywhere was the
  one the game already draws on a keeper's own profile (v1.98). It keeps a divider and
  its own label because it reads as the odd one out — it IS one. The player profile
  carries ONE, his
  club's home shirt, turned to the BACK with his own `kitNumber` on it: that is the
  only place in the game the two facts meet, and it is why the number is worth drawing
  at all. Pass `title` to `ClubKit` itself and not just to a wrapping button — the
  `aria-label` is the kit's own, and a title on the parent leaves every jersey in the
  app labelled "Club jersey".
  **A keeper wears the KEEPER shirt there (v1.98)** — he is the one player in the side
  who never wears the home kit, so drawing him in it made the profile state something
  the pitch contradicts. Keyed on `p.positions[0]`, the same primary-position field
  every other line of that header reads; `kitsFor(club)` already returns all four, so
  this is a slot choice and not a second source of kits.
- **The pitch token is a CIRCLE, and `TOKEN_CLIP` is the one place that says so
  (v1.99).** v1.98 clipped it to a hexagon to echo the archetype artwork's frame; at
  44px on a dark pitch the flats read as a badge rather than as a player, so it is a
  circle again. Everything the hex carried is unchanged — border is position fit,
  opacity repeats it, the wash behind the rating is the class. Still a `clip-path`
  rather than `border-radius`, because the same constant clips the drag GUIDE, and the
  guide is a plain box the drag hit-testing measures by bounding box. The v1.98 legend
  had shipped as **two copies** (desktop board and phone diagram), which is exactly how
  a shape change gets made in one place and missed in the other — it is `FitLegend` now,
  one definition beside `PitchToken` and `PitchMarkings`.
- **The Tactics grid tracks are `minmax(0, Nfr)`, never a bare `Nfr` (v1.99).** An `fr`
  track's automatic minimum is its content's MIN-CONTENT width, so the three columns
  were only 30/30/40 while nothing in them was wider than that. Populating the XI put
  player surnames into the tokens' name plates, pushed the Lineup column's minimum past
  its share, and re-proportioned the whole row — **measured, Lineup collapsed 359 → 239px
  and Setup blew out to 802px** the moment four defenders were named. Same class of bug
  as the formation description's `w-0 min-w-full` (v1.87), fixed at the GRID so it holds
  for every item at once rather than one `truncate` at a time. It only binds when a
  column has no slack, so a single wide viewport cannot see it: `ui-test-tactics.mjs`
  sweeps five widths and asserts the three widths are identical before the XI, after it,
  and after the bench.
- **The bench is the pitch's other half, and it lives in the pitch's column (v1.99).**
  It used to hang below the Roster one column over, which put the two halves of ONE
  decision — who starts and who is behind them — in different places. Every seat is
  rendered whether or not anyone is in it, so the panel is a constant `benchCap()` rows
  and naming a sub never moves the page; an empty seat is a real seat, which is what
  lets it be BOTH a drop target and a tap target. Tapping any seat opens the same kind of
  picker a pitch slot opens — the board's bench half was drag-only, so a keyboard user
  or anyone who simply prefers a list could not name a bench at all. The picker commits
  through `moveBench`, the same store action a drop calls, so it can never put a player
  somewhere a drag couldn't.
  **v2.0 draws each seat as a `PitchToken`** rather than a row, so the matchday squad is
  ONE visual language: a filled seat carries the rating, the class wash and the name plate
  exactly as a fielded player does, and an empty one is the same dashed circle an unfilled
  position is. The filled and empty states are now one component (they were two, and had
  already drifted — only one was draggable, only one had a remove button). A seat is handed
  the player's OWN primary position and a fit of 1: a sub is not out of position on the
  bench, and grading him against a pitch slot he isn't standing in would be a reading the
  match will not honour. `ui-test-tactics.mjs` counts seats by their ACCESSIBLE NAME
  ("Substitute N" / "Pick substitute N") — it used to count `div.space-y-1 > div` and
  reported zero seats on a bench that drew perfectly, which is the v1.99 GCN lesson again:
  match labels, not layout classes.
- **`benchSize` is stated, not derived from `matchdaySquad` (v1.99).** The bench cap was
  `cfg.matchdaySquad - 11` spelled out at six sites — but `matchdaySquad` is ALSO read as
  a squad-size FLOOR (`playerIds.length <= matchdaySquad` in contracts.ts and
  transfers.ts, i.e. "this club may not sell"). Widening the bench by moving that number
  would therefore also have told every AI club in the world to hoard two more players:
  two answers hanging off one constant. They are separate now and `benchCap(cfg)` in
  `lib/selection.ts` is the single accessor, so a seventh derivation is impossible.
  Calibration and `verify:standings` are unmoved by the 7 → 9 change.
- **The Tactics roster panel is +50% tall (v2.0), and its height is a design number.**
  26→39rem, 34→51rem at `xl`. It is fixed-height and scrolled internally on purpose — the
  pitch must never move out from under a drag — which makes it the one list in the game
  whose length isn't set by its content, and at 26rem a 25-man squad was read eight rows
  at a time. Anything that changes it has to keep the internal scroll.
- **The league-reputation chip is gone from the Competition screen (v2.0).**
  `leagueReputation` is untouched and still decides the two save-wide legacy awards and
  every market gate that reads it (v1.87) — only the display was removed. Don't reintroduce
  it as a table header: it is structural data about the DIVISION, and it cancels out of
  everything the table itself is about.
- **The Tactics roster names each player's ARCHETYPE (v1.99).** It is the list you pick a
  side FROM, and it said what a player is RATED without ever saying what he IS — so the
  identity the whole tactical system runs on was the one fact you had to leave the screen
  to read. Through `ArchetypeLabel` (ui.tsx), the canonical surface, so the colour matches
  every other list in the game rather than being a fourth palette.
- **A training plan steers ATTRIBUTES, and no longer promises an identity (v1.99).** The
  conversion ETA is gone from the Development screen: the row's trailing "→ Sniper ≈ 14
  weeks", the "no growth left" / "too far a shape" dead ends, the grid card's subtitle
  and the drawer's "Becoming" slot, plus the class word that shared that slot — the
  archetype column is the archetype NAME and nothing after it. `archetypeConversionEta`
  in `lib/development.ts` is untouched and still verified by `verify:conversion`; only
  the UI that quoted it is deleted. Retraining (`lib/archetypedev.ts`) remains the route
  that CHANGES an identity, which is the distinction the two things always encoded.
- **The pitch token was a HEXAGON, and every reading lives inside it (v1.98; the shape
  itself superseded above).**
  `PitchToken` / `PitchMarkings` in `Tactics.tsx` are ONE definition each, used by both
  the desktop board and the phone's read-only diagram — the two had drifted into
  separate copies of the same token, which is how a change to one silently missed the
  other. Four facts, four channels, none of them floating off the glyph: the border is
  position fit, the whole node's OPACITY repeats it (`fitOpacity`), a radial wash of
  `ARCHETYPE_CLASS_COLOR` behind the rating is his archetype class, and the rating is
  the display face. The v1.77 corner dot is gone — parked at the top-right with its own
  glow it read as an unread-message badge, i.e. as a transient alert rather than as
  what the player permanently IS. So is the red "ADAPTED"/"OUT OF POS" caption: the
  ring above it already said so, and three of them under a back four was the loudest
  thing on a screen whose whole job is to be scanned. The fade is what replaces the
  words, which is a reading a manager already has for "less effective here".
  Two mechanical traps, both found by rendering rather than by reading the diff:
  a hexagon is a `clip-path`, and **`ring-*` is a box-shadow, which is NOT clipped with
  the box** — the drag guide had to become a filled hex behind the token rather than a
  ring on it. And the name plate must carry `max-w-full` + `overflow-hidden` against
  the slot's own `w-16`, or a long surname widens its pill into the pill of whoever is
  standing beside him (the midfield of a 5-3-2 is close enough for that to overlap).
  The phone board also needed the desktop's compressed `6 + slot.y * 0.88` band: the
  token is taller than the circle it replaced and the pitch clips its overflow, so a
  keeper at `y=4%` loses his plate off the bottom edge.
- **`scripts/ui-test.mjs` and `ui-test-mobile.mjs` drive the app end to end again
  (v1.98).** Both had been failing early for long enough that everything behind the
  failure point went unmeasured — the v1.96 note in `ui-test.mjs` said as much and
  asked the next caller to re-derive its selectors, which is now done. The rot was all
  the same kind: labels and tabs that moved and a harness nobody could run to notice.
  The squad actions are behind the profile's **MANAGE** tab and are **SELL PLAYER /
  SEND ON LOAN**; Transfers' listings tab is **Sell / Loan**; the Academy's Staff and
  Upgrades tabs **do not exist** (staff became a facility concern in v1.79 and the
  upgrade ladders were deleted outright in v1.87) — the scout roster is behind
  Scouting's own **PERSONNEL** sub-tab; and the send-scout submit is **`SEND · £…`**,
  since the trip became billable in v1.85. `ui-test-mobile.mjs` also picked its club by
  the hardcoded name "Nottingham Foresters" — the exact trap `ui-test.mjs` documents —
  and now takes it by POSITION, and honours `UI_TEST_BASE` like every other harness so
  a busy port 3000 doesn't fail the run.
  v1.99 added two states to `ui-test.mjs` that nothing rendered before: **Home after a
  match has been played** (the calendar's Results rail correctly does not exist on day 1,
  so the existing shot proved nothing about it) and **the team card**, opened off a
  Competition table row — the only screen that draws a `gk` kit outside the creator.
  Note the table ROW is not a button; the club name inside it is the click target, which
  is what a `tr button` selector silently finds nothing for.
  **`npm run build` deletes `.next` out from under a running `npm run dev`**, so every
  browser harness starts failing at whatever step it happened to reach, with errors
  (`Cannot find module './331.js'`, a `text=NEW LEGACY` timeout) that look like selector
  rot and are not. If a UI harness starts failing mid-run, `curl` the dev server for a
  500 before touching a single selector — and restart it after any build.
- **A ROLE BRIEF redistributes; it never adds (v1.99).** `lib/tacticbrief.ts`. The Tactic
  Creator lets the manager name, per formation slot, the archetype he wants standing there
  — EA FC's player roles in this game's vocabulary. The obvious implementation breaks two
  rules at once, and both matter: granting a bonus for a met brief is a **third channel**
  (v1.78 says identity reaches the engine through `synergyMult × instructionMult` and
  nothing else), and it is **not zero-sum** — every manager would collect a free rating rise
  by briefing the roles his squad already holds, which is a world-wide buff needing
  re-calibration. So a brief is a BET: met is worth `+ROLE_BRIEF_SWING`, missed costs the
  same, and the expected value of a brief chosen at random is zero. It rides the existing
  lever (multiplied into `effectiveRating` beside the other two, and folded into
  `tacticalFitMult` so selection asks what the match answers — the v1.90 rule), and returns
  **exactly 1** when a tactic carries no brief, which is what lets it sit in the hot path.
  **The miss penalty is DERIVED per position, not authored**, and this is the part that had
  to be measured rather than reasoned about. A flat −1 made a random brief worth **−16.7%**
  across an XI — the Creator was a tax nobody would rationally open. The cause is that the
  five roles at a position are not evenly spread across the classes and the spread differs
  wildly by position: at CB four of five are Enforcers (a same-class near-miss is 48%
  likely), at GK all five are different classes (a near-miss is impossible), so no constant
  can centre both. The penalty now solves `pExact·1 + pSame·0.5 + pOther·x = 0` from the
  position's own roster, so adding a role re-centres itself. `verify:brief` asserts the
  mean, both directions of the bet, and the inert case.
  `SWING` is 0.08 — deliberately between style (±15%) and the dials (±6%), so the brief is a
  real decision that never outranks who you actually signed. A saved Creator preset names
  **no players** (`saveDesignedTactic`): it is a plan you build before you own the squad for
  it, and freezing today's XI into it would make it a snapshot instead.
- **The Tactic Creator is a SHAPE beside a list, and the roles carry their art (v2.0).**
  It was a single column of eleven dropdowns, which made a shape — the thing it exists to
  design — the one thing it never showed: "two Snipers and an Architect" says nothing about
  whether they are standing anywhere sensible. `CreatorPitch` draws the same
  `PitchMarkings` the Tactics board does, so the plan is read on the same field the side is
  picked on, and what stands in a slot is the **ROLE, not a player** — the archetype's own
  icon, with an unbriefed slot drawn as the dashed circle an unfilled position is. One
  piece of `selected` state drives both halves (clicking a token highlights its row and
  scrolls it into view, and the row's position badge highlights the token), so the pitch
  and the list can never disagree about which slot is being briefed.
  `SelectOption` gained an **`icon`** slot for the brief's dropdowns, and it renders in the
  open menu AND on the CLOSED trigger — which is what separates it from the existing
  `badge`. An icon that only appeared while the menu was open would identify the options
  you are choosing between and then vanish the moment one became the answer, so the one row
  you most need to read would be the only one without it. `fid` in `season.ts`,
  `eufId` in `european.ts`. Both used to mix in `Math.random()`/`Date.now()`, and because
  `matchSeed` seeds every match from `deriveSeed(state.seed, …fixture.id…)` that made
  **every result in the game nondeterministic** — two runs of one save seed produced
  different scores, tables and champions, in flat contradiction of the determinism rule.
  It was invisible for as long as it existed because nothing compared two runs; it surfaced
  the moment `verify:sim-parity` did, and it invalidates any before/after measurement taken
  before this was fixed. Ids are now a pure function of competition, round and the two clubs
  in leg order. **Anything that reaches a seed must be derived, never generated** — if a new
  entity needs an id the engine will read, build it from what the entity IS.
- **A player id minted during PLAY must not continue worldgen's sequence (v2.0).**
  `playerCounter` in `worldgen.ts` is MODULE state: it counts from 0 and is reset only by
  `generateWorld`. That is right for worldgen, which mints every id in one deterministic
  pass that `verify:sim-parity` hashes. It is wrong for everything after, and the failure
  is silent and destructive: **loading a save restores thousands of `p1..pN` but leaves the
  counter at 0**, so the first player generated after a page refresh — a regen, a youth
  intake, a free-agent replenishment — took `p1`, an id a real player already held.
  `state.players[id] = newPlayer` then OVERWROTE him in place, and since the club roster,
  `state.careers`, the honours and the appearance tallies all key on that id, a brand-new
  teenager inherited a fifteen-year career and a squad place. Reported from play as "two of
  my players retired, turned into regens, and are already in my club with 50 appearances
  before the season started" — the retiring player's id was being handed to his successor.
  `beginLivePlay()` is the switch, called by the store at **every** point a world starts
  being played (`newGame`, `loadSave`, the `bootstrap` auto-resume, `importFile`); after it,
  `pid()` returns `uid("p")` instead. `generateWorld` clears it so a new game started after
  a load still builds byte-identically. The academy and the GCN hub had each already
  defended themselves with a private `freshId` — the fix generalises that to the source
  rather than to one caller at a time, which is why the regen and both replenishment passes
  were still exposed.
  **Reproducing it needs a JSON round trip AND a counter reset**, which is why no existing
  harness saw it: a script that calls `generateWorld` in-process leaves the counter sitting
  safely past every id it just minted, so the collision cannot occur. `verify:retirement`
  simulates the page refresh (serialise → `resetIdCounterForTest()` → play) and fails
  loudly without the fix, naming the players being overwritten.
- **A regen SUCCEEDS a player; he never REPLACES one (v2.0).** `regenFromRetiree` always
  built a distinct free agent — it was only the id collision above that made the successor
  and the retiree read as one man. The properties are now structural rather than assumed:
  a regen is explicitly clubless (`clubId`, `academyClubId`, `contract`, `loan`,
  `kitNumber` all cleared, so he can never be born into a squad — least of all the user's,
  where a stranger appearing the week a veteran retired is indistinguishable from that
  veteran having been transformed) and explicitly historyless (`stats`, `youthStats`,
  `devLog`, `acquiredSeason` cleared, so nothing of the retiree's record travels). He
  inherits a PROFILE — position, nationality, frame, training plan, peak ceiling — which is
  heritage, not identity. The retiree keeps his own career, honours and appearances forever.
- **A retirement at the user's club is club news, whatever he was rated (v2.0).** The
  rollover's world-wide "End of an era" line only ever named players rated 78+, so a squad
  player hanging up his boots left the roster in complete silence and the manager found out
  by noticing a name missing. `retiredUser` in `gameloop.ts` pushes one inbox item per
  player — one each rather than a combined list, because each is a squad place that now has
  to be filled and a shared line buries the second name — quoting the career it is ending
  via `careerSummary`. Two placement rules: it is captured INSIDE the development loop
  (retirement nulls `clubId`, so `isUser` is unreadable a few lines later, and the running
  `p.stats` reset would take the final season's numbers with it), and it passes
  `includeCurrent: false` because `appendCareerRows` has already banked that season.
  Retirement also now purges the player from saved tactics, alongside the existing roster
  filter in `academy.ts` — selling and releasing always did, retirement did not, so a preset
  went on naming a man who had retired.
- **Optimise the hot path by caching INPUTS, never by re-associating the arithmetic
  (v1.99).** The calendar advance was ~3.3× slower than it needed to be, and a CPU profile
  put the cost in one place: `deriveArchetype` (five plans × 35 attributes) called from
  `pickLineup`, `tacticalFitMult`, `tacticScore` and `selectionScore` on unchanged
  attribute lines. Three fixes, all result-preserving and all verified by
  `verify:sim-parity`: `deriveArchetype` is memoised on (attrs object, a checksum of its
  values, position, incumbent) — the checksum is load-bearing because the development pass
  MUTATES an attribute line in place before reassigning it, so an identity-keyed cache
  would serve a pre-growth archetype; `archetypesForPosition` is memoised per position; and
  `pickLineup` computes each player's slot-INVARIANT terms once instead of once per slot.
  The trap worth remembering: the first cut of that last one pre-multiplied the invariant
  factors into a single constant, which is the same arithmetic in a different order — and
  floating-point multiplication is not associative, so scores that should tie stopped tying
  and real league tables changed. Cache the inputs, keep the product in its original order.
  Measured: 76.4s → 22.9s for two seasons, byte-identical world.
- **A keeper recovers faster (v1.99).** `gkFitnessRecoveryMult` (1.5) in tuning, applied in
  `dailyRecovery`. He covers a fraction of the ground, takes almost none of the contact, and
  is the one player expected to start every match of a congested week. Deliberately a
  RECOVERY term and not a drain one — ninety minutes should still cost him what it always
  did; the two are different quantities and collapsing them would quietly change match
  fatigue. Note `dailyRecovery` is still the named seam a future facility's multiplier lands
  on (§19.5) — this is a position rule, not that lever.
- **A match rating is a REASON, not a base plus noise (v2.0).** `finalizeResult` in
  `engine/match.ts`. The predecessor was `6.5 + goals + assists/2 + gd×0.15 + ±0.4`, so a
  player who neither scored nor assisted rated **6.5 every single week** — and because the
  noise cancelled, his season average converged on 6.5 the MORE he played. That is exactly
  backwards for the end-of-season awards, which score `avgRating × (1 + teamSuccess)`
  (v1.87): with the rating term flat, every award fell out of which club finished highest,
  and a defensive midfielder could not win one at all. Every term is now something that
  happened — goals, assists, the margin, a clean sheet weighted by how much of the slot's
  job IS defending (`PHASE_WEIGHTS`, never a named-position conditional), and above all
  `ratingFormWeight` on how far the player ran above his OWN baseline.
  That last term reads `perfSum / perfSegments` off `OnPitch`, banked in `phaseStrengths`
  from the very `effectiveRating` the simulation used to decide the match — so a rating can
  never disagree with the result. Three things are divided back out because none of them is
  anything the PLAYER did: home advantage (a side-wide constant), the fitness curve (it
  falls through the match for everybody), and **position fit**.
  **That third one had to be MEASURED, and leaving it in inverted the whole system** —
  season averages correlated **−0.20** with overall, i.e. the worse player reliably rated
  higher. The cause is selection, not performance: a squad player only makes the XI when he
  is a natural fit for the slot, where a star is routinely shifted into an imperfect one to
  get him on the pitch, so the term was quietly measuring "was he picked in his best
  position" and marking down exactly the players good enough to be accommodated. The engine
  already charges the TEAM for that through the phase strengths.
  Because `performanceRatio` divides by the player's own overall it is quality-NEUTRAL by
  construction, so a second term is required or the awards go back to being a lottery:
  `ratingPerOverallEdge` scores him against the **match's** own mean (not the league's — a
  good player in a bad side is carrying it, which is the season an award exists to find).
  Measured (`npm run measure:ratings`): match sd **0.77** on a proper hump, season-average
  sd **0.46** spanning 5.4–7.9, correlation **+0.27**, every position group with real
  spread, and a clear 0.28 gap between the best season in a division and the second. Ratings
  feed nothing back into the simulation, so `calibrate` and `verify:standings` are unmoved —
  run `measure:ratings` after touching any `rating*` constant, since neither of those can
  see this.
  `simresolver.ts` carries the same three ideas per SEASON (`simRating*`), and its goals and
  assists now **ADD** to the season rating rather than replacing it: replacing threw away
  how good the player is for his level and what his side achieved, so the top scorer in a
  relegated side rated identically to the champions'. The two halves of the world have to
  agree here — the legacy awards pool every top flight, so a flatter sim league would win or
  lose them on nothing the manager chose.
- **An achievement is a LADDER, and its tier is derived (v2.0).** `lib/achievements.ts`.
  Most of the catalogue is now six rungs sharing one id, on the game's own `BadgeTier`
  vocabulary (bronze → legacy) so bronze means the same thing here as on a staff badge.
  "Win one title" and "win fifty" were never two achievements — they are one pursuit at two
  depths, which is why v1.x's `Champions` and `Dynasty` are now a single card, and why
  `The Climb` (3 promotions) and `Kings of the Land` are deleted rather than re-tiered: the
  first is a season's outcome rather than a cabinet entry, the second a special case of the
  league ladder firing on a technicality of which division you were in.
  **A tier is DERIVED from the live tally on every read, never stored** — the same
  discipline as the roll of honour (v1.89). `earned[id]` records only the season the BRONZE
  rung was first reached, so the badge on the card and the number behind it cannot drift.
  It also means a tiered card keeps being worth looking at after it unlocks: its bar chases
  the NEXT rung, measured ACROSS that rung (`value - reached`), not as a fraction of an
  absolute total that would start near-full.
  A def is `test` (flat) XOR `value` + `tiers` (tiered); `meets` is the one call
  `checkAchievements` makes, so the engine still never branches on an id.
  The **squad** shelf reads the XI through `squadOverall` / `pickLineup` against the club's
  own formation — the v1.90 rule — never a count of bodies over a threshold. That is
  load-bearing: a flat squad mean is driven by how many fringe players a club carries, so
  the old "hold five 85s" shape measured squad SIZE and signing a squad player would make a
  rating ladder go backwards. Positional figures group by the **slot's** position, so a
  back three is judged as a back three. The new **player** shelf is separate because a club
  can be excellent without ever holding a superstar, and the two shouldn't compete for a row.
  Every peak is a high-water mark, so selling the striker who got you there never un-earns
  a tier. Note the split between "inherited" and "earned" does NOT follow the shelves —
  `peakBudget` sits in Finance beside `totalSpent` and only one of those is handed to you at
  kickoff; `verify:achievements` encodes that as an explicit list for exactly that reason.
- **The facility list is what you HAVE and what you could BUILD (v2.0).** Ten-plus
  facilities is too many for one grid, and the two halves answer different questions.
  "Your Facilities" is an operations screen — which building needs a coach, which is a level
  off a badge tier — and every card on it is live arithmetic. "Available" is a shopping
  list: site plans, a photograph and a price, nothing actionable but spending. Mixed, the
  tab a manager opens weekly to assign staff was padded with up to ten sales pitches for
  buildings he had already decided against. The counts ride in the tab labels because
  building something MOVES a card between the two pages, and without them it just vanishes.
- Interim implementations pending owner design sessions (marked in-file): transfer market
  AI (§10), trait pool. `emergencyIntake()` in gameloop is a stopgap until the Youth
  Academy ships.

## Design language

Dark theme (#0b0c0f), subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; signature element is the 1px `.gold-thread`.
Display face Saira Condensed (uppercase, scoreboard feel), body Instrument Sans,
`tnum` class for all data columns.

# Update Log

The history of changes to Football Legacy. Newest first. Feature detail lives in
[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md); this file records *what changed and when*.

Save-schema version is noted where it moved. The game auto-migrates older saves on load.

---

## 2026-07-21 — League form guide, in-season sim tables, richer team card

Save schema: **v22 → v23** (sim leagues gain an optional `topAssists` line and their
final resolution moves earlier in the season; both default at read time, so old saves
open unchanged and pick up the new behaviour from their next rollover).

- **Last-5 form guide in the league table.** Every playable division's **Competition → Table**
  gains a **Form** column: the club's last five league results as compact W/D/L pills, oldest→newest,
  tinted win/draw/loss. Derived by a new `computeForm` in `lib/season.ts` off the same played
  fixtures as the table. Hidden below the `sm` breakpoint so the phone layout keeps its compact stat
  grid; the table scrolls to reveal it.
- **Sim leagues resolve in-season.** The final resolution of the non-playable (sim-only) leagues
  moves from just before season end to **three days after their last league round** (`simResolveDay2`
  in `lib/calendar.ts`), so the completed final table is browsable *during* the season it belongs to
  rather than only at the very end. The summer (start-of-season) and winter resolutions are unchanged.
- **Top assists for sim leagues.** The sim resolver now credits assists off the same weighted draw as
  goals (weighted by passing), writes them onto sim players' season stats, and returns a `topAssists`
  board rendered beside the top scorers on the sim-league view.
- **Expanded team card.** Clicking a club now also shows its **season top scorer and top assister**
  (tap through to the profile) and a concise **Recent Results** list — last eight matches with W/D/L
  badge, opponent, scoreline, date and competition. Results are shown for playable-league clubs (sim
  clubs carry no per-fixture data); leaders work for both.

---

## 2026-07-21 — Grid / list view toggle for player tables

No save-schema change — this is a UI-only preference (stored in the browser).

- **List / grid toggle on every player table.** The **Squad**, **Transfers** (Search, My Listings,
  Shortlist, Free Agents), **Academy → Academy Squad**, and **Development → Training Plans** screens
  each gain a segmented **list / grid** control. List view (the dense, established layout) stays the
  default; grid view lays the same players out as cards, carrying the same identity, badges, stats
  and actions the row does. The choice is per-screen and remembered across sessions via
  `localStorage` (`fl.view.<screen>`).
- **Shared primitives.** New `ViewToggle`, `usePlayerView`, `PlayerGrid` and `PlayerCard` in
  `components/ui.tsx` so all four screens draw from one card shell, and the academy squad's action
  cluster was factored into a shared `SquadActions` used by both layouts.

---

## 2026-07-21 — Transfer News wire, all-time assists, calendar progress gate

Save schema: **v21 → v22** (adds the world-wide `transferNews` feed; old saves open with an
empty one and begin logging from their next completed deal).

- **Transfer News (new tab).** A new **Transfers → Transfer News** tab renders the world's
  market wire: every senior deal between clubs as it completes, newest first, grouped by
  season. Rows read left-to-right as the move itself — selling club → player → buying club — with
  the fee as the scoreboard hero and a badge for anything that isn't a straight cash transfer
  (free, release clause). The user's own business is tinted gold, and an **ALL CLUBS / MY CLUB**
  filter narrows the feed. Backed by a structured `TransferNewsItem` ledger written from
  `completeTransfer` (`lib/transfers.ts`), distinct from the flavour ticker (capped so a long save
  can't grow it unbounded).
- **All-time top assists.** The club **History & Records** tab gains an *All-Time Top Assists
  (club)* board beside the existing top scorers, and each playable division's **Competition** page
  now shows *Top Assists* directly beneath *Top Scorers*. Both read from real per-player assist
  totals (`clubAllTimeRecords` in `lib/recordbook.ts`).
- **Calendar progress gate.** Simulating several days ahead from the calendar no longer silently
  skips important days. A jump pauses the day *before* a U21 registration deadline, a transfer
  window opening or closing, or the youth intake, and prompts the user to act, keep going, or stay
  put (`nextCalendarGate` in `lib/gameloop.ts`, surfaced by the new `GateModal`).

---

## 2026-07-21 — Livelier market, scouting shortlist, cleaner squad list

Save schema: **v20 → v21** (adds the user's scouting `shortlist`; old saves open with an empty one).

- **A quieter league was too quiet.** The v19 financial-discipline work stopped AI clubs
  overspending but throttled the whole market to a trickle. The clubs stay wary of their books —
  they still hold a cash reserve and keep weeks of wages in hand — but the settings are relaxed so
  more deals clear: AI↔AI deals attempted per week `2 → 3`, budget reserve `20% → 16%`, wage cushion
  `8 → 6` weeks, wage-to-income cap `70% → 75%` (`lib/config/tuning.ts`).
- **Offers now come in for players who aren't listed.** A good footballer draws interest whether or
  not his club is shopping him (`aiWeeklyTransferTick`). Transfer-listing still triples the chance
  and keeps the ask keener, but the market no longer goes silent just because the user hasn't put
  anyone up for sale. Bid chance `0.10 → 0.14`; the interested-clubs reputation gate widened.
- **Scouting shortlist (new).** Any player at another club (or a free agent) can be added to a
  personal shortlist from their player card. Targets collect under **Transfers → Shortlist**, where
  you can open a bid straight from the list or drop them with the ✕. Purely a watchlist — it has no
  effect on the world.
- **No growth badge on the squad list.** At the start of a season nobody has moved yet, so the
  +/- column read as a flat row of nothing. The running season delta stays on the Player Profile
  and Development screens, where it has context.

---

## 2026-07-19 — 32 country presets & preset-derived defaults

Save schema: unchanged. New-game setup only; existing saves unaffected.

- **Preset registry rebuilt** — `lib/config/presets.ts` now registers all 32 country databases in
  `public/database_presets/` under their real filenames (`<CODE>-country-db.json`). The old registry
  pointed at 8 stale filenames (`ENGLAND.json`, …), so most presets 404'd at new-game setup.
- **Every country now offers Default *and* Preset** — countries without an engine club pool derive
  their "Default" from the preset: same real league and clubs, hand-authored rosters stripped so
  squads are procedurally generated (`proceduralFromPreset`). Setup fetches the preset asset for
  such a country even when Default is selected, and always passes the derived DB to worldgen.
- **Flags** — `COUNTRY_TO_FLAG` covers all new country names (Japan, Mexico, Poland, "Korea,
  South" / South Korea, Saudi Arabia, …), so league flags render for every preset country.
- **Name pools** — 23 new nationality pools in `lib/config/names.ts` (POR, TUR, USA, BEL, SUI, AUT,
  CRO, CZE, DEN, NOR, SCO, GRE, POL, ROU, SRB, RUS, UKR, JPN, KOR, KSA, MEX, COL, AUS) so generated
  squads and youth intakes for the new countries stop falling back to English names.

---

## 2026-07-19 — Mobile layout fixes (Academy & Scouting)

Save schema: unchanged. Layout-only; desktop rendering is untouched.

- **Academy → Squad on phones was unusable** — the fixed-track grid (22rem actions column) crushed
  the player column to nothing, names overlapped ages and actions stacked in a sliver. Below `md`
  each row now stacks: an identity line (pos · flag · name · archetype · age · OVR · potential,
  with a `y` suffix on age since the column header is hidden) and a wrapping actions line beneath.
  From `md` up the original aligned grid is unchanged (the row wrapper dissolves via
  `display: contents`).
- **Scouting tab** — the "scouts available / + SEND A SCOUT" footer and each prospect report's
  fee/actions footer now wrap instead of cramming on one line; the recall ✕ on an assignment is a
  36px touch target on phones (28px from `md` up).
- **New `scripts/ui-test-mobile.mjs`** — drives the game at a 390×844 viewport through every Academy
  tab, hires a scout and sends them out (exercising the two-step confirm, the send-a-scout modal and
  the active-assignment layout), screenshots each step and checks for horizontal overflow.
  Same contract as `ui-test.mjs`: dev server running, `UI_TEST_OUT` optional.

---

## 2026-07-19 — Codebase cleanup & UI polish

Save schema: unchanged. No balance changes (engine cleanup is signature-only; calibration untouched).

**Cleanup**

- Enabled `noUnusedLocals` / `noUnusedParameters` in tsconfig and removed every hit: dead state in
  KeyGate, dead imports (Transfers, gameloop, gameStore, season), unused params on `initCup`,
  `loanMidseasonReports`, `acceptSponsor`, `rollSetPiece`, and leftover locals in MatchDay,
  PlayerProfile and season's cup draw.
- `scripts/ui-test.mjs` no longer hardcodes a machine-specific screenshot folder — set `UI_TEST_OUT`
  or it defaults to a temp dir (printed at the end of a run).
- Competition's tab strip drops its `as never` casts; Calendar's H/A badge drops an inline-style
  positioning hack.

**UI / UX**

- **Home** — "Mark all read (n)" action on the Inbox header; unread items carry a gold dot; friendlier
  empty-inbox card; the league panel shows a last-5 **form guide** (W/D/L chips with score tooltips).
- **Academy** — the squad tab's floating text block is now a proper stat-chip row (places, focus
  slots, senior space, next/last intake) with tooltips; **Release** uses the standard two-step
  confirm button instead of a native `window.confirm`.
- **Club → History** — all-time top scorers / most appearances rows are now clickable and open the
  player profile (the list previously took an `onView` handler it never used; record rows now carry
  the player id).
- **Transfers → My Listings** — rows show flag, age and archetype, and the player name opens the
  full profile; the List toggle gained a tooltip.

---

## 2026-07-19 — Youth & scouting overhaul

Save schema: **v10** (unchanged — all new fields are optional and default safely on old saves).

**Scouting UX**

- **Base scouts raised 1 → 2.** A club with a Scout on the staff can send two out at once before
  any upgrade.
- **New Scouting Department "Upgrades" panel** (Academy → Scouting), with two upgrades this iteration:
  - **Max Scouts** — concurrent assignments, **base 2, +1 per level, max 5**.
  - **Academy Squad Size** — prospect places in the academy, **base 12, +3 per level, max 24**.
  - The old Scouting Network card was removed from the Development → Facilities tab (it now lives,
    renamed "Max Scouts", in the Scouting Department). Both upgrades route through the shared
    training-facility purchase machinery.
- **Send-a-scout is now a lock-in decision.** A "Send a Scout" modal sets **country/region**,
  **position focus**, and — new — an optional **player-type (archetype) brief**, then confirms. The
  brief is fixed once the scout is out; recall and re-send to change it. Active assignments show
  their locked brief read-only.
- **Archetype brief.** Reports from a briefed scout surface players of the chosen archetype(s)
  (e.g. "look for a Poacher"). `ScoutAssignment.archetypes` carries the brief; `generatePlayer` gained
  an optional `archetypeId` override so the report player matches.
- **Clickable prospect reports.** A prospect can be opened (name or a new "View" button) to inspect
  full attributes / archetype / traits **before signing** — a read-only profile preview via the new
  `viewProspect` store action + `previewPlayer` state (the player isn't added to the world until
  signed).

**Youth Academy UX**

- **Minimum generated age is now 12** (intake min age 15 → 12). Academy classes can include 12–13yos.
- **Promotion to the senior team is gated to age 16+** (`academyPromoteMinAge`). The Promote button is
  disabled with an explanatory tooltip for younger prospects.
- **Academy squad is now capped** (see Academy Squad Size above). Intake classes are trimmed to fit
  remaining places; scouted signings are blocked when full, with a clear inbox/UI message.

**Game UX — player quality**

- **No generated player below 50 overall.** New `minOverall` tuning value floors all *procedural*
  generation (worldgen intake, scouting, AI intake). Fixes the "scouted a 15yo at 38 overall" case.
  Custom-DB modded rosters are exempt so mods can still author sub-floor players.
- **Faster growth for the 50–60 band.** A new catch-up multiplier (`growthCatchupBelow`/
  `growthCatchupMult`) speeds development up to ~1.8× at the quality floor, fading to 1× by 60, so
  raw prospects climb briskly. Reflected in the Development one-season growth estimate too.
- **Better generated players overall.** Youth soft-cap centres raised and re-anchored to age 12
  (12yo ~52, 15yo ~63, 17yo ~72), intake/scout ability bases lifted, prodigy chance nudged up.

---

## 2026-07-18 — Pre-deployment polish

Save schema: **v10** (unchanged).

- **Removed the game-key input placeholder.** The unlock field no longer shows an example key.
- **Removed flavor / intro text across screens.** The descriptive intro paragraphs at the top of
  tabs and pages are gone — Development → Training Facilities, Development → Training Plans,
  Club → Income, Club → Sponsors, the budget blurb, Academy → Prospects / Scouting / U21 squad,
  and the tactics flavor tail. Functional inline help (e.g. the `▲▼` fit legend, item descriptions,
  empty-state hints) was kept.
- **Removed the "Available plans" legend** from Development → Training Plans; the per-player focus
  dropdowns already carry the plan names.
- **Better money inputs in transfer bidding.** Transfer fee and counter-offer fields now render
  large amounts as readable grouped digits (`54,000,000` instead of `54000000`), show a formatted
  `£54M` preview beside the label, and accept shorthand while typing (`54m`, `500k`, or grouped
  digits). New shared `MoneyInput` primitive plus `groupDigits` / `parseMoney` helpers.
- **Squad cap raised from 25 to 50** senior players. All UI that references the cap reads it from
  tuning, so it displays the new value automatically.

_First public deployment of the game follows these changes._

---

## Feature history (build milestones)

The following milestones describe how the game reached its current shape. Exact dates predate this
log; they are ordered by when each system landed.

### Contracts, multi-scout & staff expansion — schema v6 → v10

- **Individual player contracts.** Replaced the aggregate wage bill with real per-player contracts
  (weekly wage + expiry season). Expiring deals must be renewed or the player leaves on a free at
  rollover. Wage demands scale with ability and age; contract length is capped for veterans.
  Transfer signings now agree contract terms as part of the bid.
- **Multi-scout scouting.** Multiple scouts can be out on assignment at once, expanded by the
  Scouting Network facility. Scout stars tighten potential ranges market-wide.
- **Staff department expansion.** Head Coach, Assistant, Fitness Coach, GK Coach, Development Coach,
  Physio, Youth Coach and Scout slots, each a star-rated buff to exactly one system, hired from a
  simple candidate market split across the Club / Development / Academy screens.

### Youth Academy — the second pillar

- A full academy pipeline: an uncapped ages-15–21 academy squad outside the senior cap; a
  mid-March **intake class** (3–6 prospects, with a golden-generation lottery); a statistically
  resolved **U21 league** with up to 3 focus prospects; **youth scouting** with inbox prospect
  reports; and **out-loans** for ≤21 players.
- **Potential fog-of-war:** exact potential is hidden for players under 24, shown instead as a
  seeded 1–5 star scout estimate that can be wrong — the source of gems and busts.
- **Academy DNA:** every player carries the academy that produced them, and clubs keep a graduates
  ledger. This replaced the earlier `emergencyIntake()` stopgap for keeping AI squads alive.
- Added the **Development** screen (Training Plans + Facilities + Development Staff) and the
  **Academy** screen.

### v1 — the playable core

- **Pure, seeded match engine:** 6×15-minute segments, effective-rating → phase-strength →
  chance-volume → contested-conversion, with archetype-flavored text commentary and a halftime
  tactical tweak. Calibrated to ~2.7 goals/match and ~45% home wins.
- **Player architecture:** PlayerBio / PlayerCareer split, six attributes + overall, archetypes
  and traits as pure data, and a single aging/development function (growth → prime → decline →
  retirement) modulated by archetype, a hidden longevity factor, and usage.
- **Season manager:** England with two divisions, promotion/relegation, and a knockout cup, plus
  view-only **sim-only leagues** resolved statistically twice a season around the transfer windows.
- **Economy:** one weekly budget; **tactics:** preset formation / mentality / style / line / focus;
  **fitness** as the single condition stat driving rotation.
- **Transfers:** search, bid, negotiate/counter, listings, free agents, two windows.
- **Saves & history:** IndexedDB persistence with JSON export/import (also the modding format),
  optional cloud sync, and a Record Book of tables, cup winners, awards, and all-time club records.
- The eight core screens, the dark + gold-thread design system, and the calibration / smoke /
  UI-test tooling.

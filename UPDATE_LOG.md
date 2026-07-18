# Update Log

The history of changes to Football Legacy. Newest first. Feature detail lives in
[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md); this file records *what changed and when*.

Save-schema version is noted where it moved. The game auto-migrates older saves on load.

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

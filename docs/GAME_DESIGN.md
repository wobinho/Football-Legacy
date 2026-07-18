# Football Legacy — Game Design & Feature Guide

**Version:** 2.0 (shipped game)
**Save schema:** v10
**Status:** This document describes the game **as it actually ships and plays today**. It is
the single source of truth for how each feature works. Items still marked `[OPEN]` need a
design session before they change; items marked `[FUTURE]` are intentionally not built yet
but have a designed seam and must not be blocked.

> Reading order: §1 tells you what the game *is*, §3 how a session flows, and §5–§18 how each
> system works. If you want the change history instead, see **UPDATE_LOG.md**.

---

## 1. What the game is

Football Legacy is a web-based football management game — a "Football Manager Lite." You take
charge of a club, build a squad, set tactics, and steer a dynasty across seasons: winning
leagues and cups, developing academy prospects into stars, trading in the transfer market, and
watching your club's own history accumulate into a museum you built.

It keeps the addictive parts of a football-management sim — squad building, player development,
long-term legacy — and deletes the tedious parts (press conferences, per-player training
schedules, contract-negotiation drama). There is no fail state: it is a sandbox you can play for
five minutes or three hours.

**Design pillars**

1. **Easy to pick up, playable forever.** No pressure, no dead ends. A session is as long as you want.
2. **Player architecture is the soul.** Archetypes, overalls, traits, and development curves carry the strategic depth — not menu depth.
3. **Team macro-management only.** Tactics are a handful of meaningful choices, not 300 sliders.
4. **RNG decides matches; decisions decide seasons.** Upsets happen and feel like football, but the better-built squad wins over a 38-game league.
5. **History is content.** The game records champions, legends, and records so long saves become a museum.

---

## 2. How it's built (architecture)

All game logic lives in `lib/` as framework-free TypeScript modules. React never implements
rules — it only renders state and calls into the modules. State flows one way: `lib` modules
mutate a single `GameState` object; the zustand store (`store/gameStore.ts`) bumps a revision
counter to re-render and debounce-autosaves to IndexedDB.

| Area | Module(s) | Responsibility |
|---|---|---|
| Schema | `lib/types.ts` | `SCHEMA_VERSION`-stamped types; the save JSON is also the modding format |
| Pure data | `lib/config/*` | Every balance number and content table — see below |
| Match engine | `lib/engine/match.ts` | Pure, seeded, 6×15-min segments |
| Season | `lib/season.ts`, `lib/calendar.ts`, `lib/simresolver.ts` | Fixtures, tables, promotion/relegation, cup, sim-league resolution |
| Game loop | `lib/gameloop.ts` | The Continue-button orchestrator and season rollover |
| Development | `lib/development.ts`, `lib/academy.ts` | Aging, growth, decline; youth pipeline |
| Squad building | `lib/transfers.ts`, `lib/contracts.ts`, `lib/staff.ts`, `lib/economy.ts`, `lib/value.ts`, `lib/selection.ts` | Market, wages, staff, budget, valuation, XI picking |
| World | `lib/worldgen.ts` | Generates the starting world (leagues, clubs, players) |
| Persistence | `lib/save.ts`, `lib/cloud.ts` | IndexedDB + JSON export/import; optional cloud sync |
| History | `lib/recordbook.ts` | Season summaries, all-time records, career histories |
| UI | `components/screens/*`, `components/ui.tsx` | The screens and the design primitives |

**`lib/config/` is all pure data** and holds no logic: `tuning.ts` (every balance number),
`archetypes.ts`, `traits.ts`, `formations.ts`, `positions.ts` (phase weights), `names.ts` (club
definitions and name pools), `training.ts` (training-plan definitions).

**Non-negotiable engineering rules**

- The engine must **never special-case an archetype or trait by name** — only table lookups.
- **Determinism:** anything random takes a seed derived via `deriveSeed(state.seed, label)`. The same save replays identically, which is what makes matches debuggable and calibratable.
- **Balance changes go through `lib/config/tuning.ts`** plus the calibration harness — never by editing engine code.

---

## 3. The core loop & calendar

The calendar advances **one day at a time**, but you never click through empty days. A single
**Continue** button fast-forwards automatically to the next day that actually needs you.

- **Interrupt rule:** a day only stops for you if something genuinely needs a decision —
  a matchday, an incoming transfer offer, a prospect report, an expiring contract. Everything
  else streams past as inbox/news items. Day-by-day exists to make the game *accessible*, never
  to add daily chores.
- Typically one league match per week; cup weeks can add a midweek fixture.
- **Off-season / rollover** is a condensed phase: promotions and relegations apply, every player
  ages one year, the record book is written, contracts tick down, and the summer window opens.

**A turn in practice:** set your lineup → set your tactic → simulate the match (watch the text
sim or take the instant result) → handle zero to a couple of quick decisions → Continue.

---

## 4. The world

- **Playable country: England.** Two divisions with promotion and relegation (a Premier-League /
  Championship model), plus one knockout **cup**.
- **Sim-only leagues** (Spain, Italy, Germany, France and more) exist for scale and immersion —
  champions to read about, players to discover and sign, more history generated. They **never run
  the match engine**. A statistical **sim resolver** turns each club's aggregate strength into
  plausible tables, cup winners, top-scorer lists, and standout stat lines.
- **Resolution schedule:** sim leagues resolve **twice per season, timed to the transfer windows**
  — the first half just before the winter window, the remainder just before summer. So whenever
  you go shopping, every league has a current table and half-season form to judge by. Between
  windows sim leagues cost nothing. Players in sim leagues still age and develop via the same
  aging function, run in bulk.

---

## 5. Players

### Data split

Each player is stored in two parts for performance and clarity:

- **PlayerBio** — hot data touched constantly: id, name, age, nationality, position(s),
  archetype, the six attributes, overall, potential, fitness, form, club, market value, traits,
  contract, and a hidden longevity factor.
- **PlayerCareer** — cold, append-only history loaded on demand: season-by-season appearances /
  goals / assists / awards, and full transfer history.

### Attributes & overall

Six outfield attributes, readable at a glance: **Pace, Shooting, Passing, Dribbling, Defending,
Physical**, plus goalkeeper-specific handling. **Overall (1–99)** is the headline number and
drives most of the simulation. Attributes are derived from archetype + overall at generation
time — you never read a spreadsheet. **Quality floor:** no *generated* player is ever below
**50 overall** — the world holds no hopeless bodies; every player is at least a rough professional
and every young prospect is genuinely developable. (Modded custom-DB rosters may author sub-floor
players deliberately; only procedural generation is clamped.)

### Archetypes

Every player has **one archetype** that defines *how* their overall applies — a 78 Poacher and a
78 Target Man are equally good but in different systems. Archetypes are **pure data**: a lookup
table of position weights, tactic-synergy multipliers, and event weightings (who scores, who
assists, which flavor text fires). The engine reads the table and never knows an archetype's name.
*(The full archetype roster is an interim set pending an owner design session — the engine treats
it as data either way.)*

### Traits

0–2 per player. Flavor perks that create memorable players — e.g. *Clutch* (better in the final
15 minutes), *Engine* (reduced fitness drain), *Leader* (small teammate buff). Like archetypes,
traits are pure data and never special-cased.

### Aging & development

One function governs it: `newOverall = f(age, potential, minutes, archetype, longevity, form)`.

- **Growth ~12–24**, accelerated by minutes played and by coaching/facilities. Raw players still
  under **60 overall** develop on a **fast-track** (up to ~1.8× growth at the quality floor, fading
  to 1× by 60), so a low-50s prospect climbs briskly out of the "hard to develop" zone.
- **Prime ~25–31.**
- **Decline from ~32–33**, modulated by **archetype** (pace-reliant types fall harder/earlier),
  a **hidden longevity factor** (per-player variance, so some stars stay elite at 36 without any
  hand-coded exception), and **recent usage** (well-used veterans decline slower).
- **Retirement ~34–37**, longevity-modulated.

**Training Plans** let you steer *where* a still-growing player's seasonal growth flows (toward
pace, finishing, defending, and so on) and nudge the rate a touch. It shapes *how* a player
develops each summer — it won't revive a player past their prime, and younger players gain the
most. Potential is hidden: the Development screen shows only a **one-season-ahead estimate**, never
a ceiling.

### Fitness

The single condition stat in the game. It **drains with match minutes and recovers with rest**;
a tired player carries a meaningful effective-rating penalty, which is exactly what forces squad
rotation and makes depth matter. There are no injuries, morale, or sharpness — fitness is the
whole system, and the Medical Centre facility improves recovery.

---

## 6. Tactics

Tactics are a small set of preset choices — no sliders:

1. **Formation** — 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2.
2. **Mentality** — Defensive / Balanced / Attacking. Attacking raises the number of chances for
   **both** teams; Defensive lowers both and tightens your shape.
3. **Style** — Possession / Counter / Direct.
4. **Defensive Line** — Deep / Standard / High.
5. **Attacking Focus** — Left / Central / Right / Mixed.

Strategic depth comes from **archetype ↔ style synergy** (a Target Man thrives in Direct, a
Playmaker in Possession), defined entirely in the synergy data table and bounded by a synergy
cap so a coherent build wins you several league places a season but never swamps raw quality.
The `▲▼` markers next to each player show their fit with the current style. You get one in-match
interaction point: at **halftime** you may change your setup.

---

## 7. The match engine

A **pure, deterministic function**: squads + tactics + seed in → events + result out. The same
inputs always produce the same match, which is what makes it debuggable and calibratable. It can
run one-shot (`simulateMatch()`) or step-by-step for the live view
(`createMatch → playFirstHalf → applyHalftimeTactic → playSecondHalf → finalizeResult`).

**Structure:** 90 minutes = **6 segments of 15 minutes**, with halftime between segments 3 and 4.
Per segment:

1. **Effective rating per player** = `overall × archetypeFit × tacticSynergy × form × fitness`,
   with a home-advantage bump. Out-of-position players are penalized; tired players drop toward a
   floor; synergy is bounded by the tuning cap.
2. **Aggregate three phase strengths** per team — ATTACK, MIDFIELD, DEFENSE — using each
   position's contribution weights from a data table.
3. **Midfield decides chance volume:** `yourShare = yourMID / (yourMID + theirMID)`, scaled by a
   base chance rate and mentality. Most segments yield 0–2 chances per side.
4. **Each chance is a contested roll:** chance quality = ATTACK vs DEFENSE, squashed into a goal
   probability with sane bounds. On a goal, scorer and assister are chosen with
   archetype-weighted probabilities (Poachers get tap-ins, Target Men headers, Playmakers assists),
   which drives the archetype-flavored match commentary.

**RNG philosophy:** randomness lives in exactly two places — how many chances occur and whether
each converts. Everything upstream is deterministic and player-controlled. Upsets are possible in
any single match; quality tells over a season.

**Presentation:** no 2D/3D — an **event-based text sim** with archetype-flavored narration you can
watch in ~30–60 seconds, or take instantly with a stat summary. The live view exposes the
halftime tweak.

**Calibration:** the engine targets real football's distributions — **~2.7 goals per match** and
**~45% home wins**. `npm run calibrate` simulates thousands of matches and prints the distributions;
all tuning happens by turning config knobs and re-running, never by editing the engine.

---

## 8. Economy & contracts

- **One budget number**, updated **weekly**: income (driven by league position and division —
  TV/prize/gate abstracted) minus expenses (the real wage bill plus staff and fixed costs). The
  budget pays for transfers, staff, and upgrades alike.
- **Individual contracts (shipped).** Every player at a club has a real contract — a weekly wage
  and an expiry season — and the wage bill is the sum of those wages. Expiring deals must be
  **renewed** or the player leaves on a free at rollover. Wage demands scale with ability and age;
  a player accepts, rejects, or the deal simply isn't good enough. Contract length is capped for
  older players.
- **Facility & commercial upgrades** on the Club screen are one-time purchases that permanently
  raise weekly income (stadium/hospitality/retail) — a long-term investment in the club's finances.

---

## 9. Staff

Staff are hired into **slots**, each a **star rating** that buffs exactly one system:

- **Head Coach, Assistant, Fitness Coach, GK Coach** (matchday / recovery / coaching),
- **Development Coach** (speeds growth), **Physio** (recovery),
- **Youth Coach** (academy intake quality + own-prospect scouting accuracy),
- **Scout** — and you can run **multiple scouts** on assignment at once, expanded by the Scouting
  Network facility.

Hiring is a simple market: better stars cost more, paid from the budget, with a fresh shortlist of
candidates each slot. No staff personalities or drama.

---

## 10. Transfers

- **Search / browse** the market, make **bids in** and field **offers out**, with a visible
  **window countdown**. Two windows a year (summer + winter) anchor the sim-league resolution
  schedule (§4).
- **Bidding** is a single fee against your single budget, with the **contract terms agreed as part
  of the signing** (wage + length). Money inputs accept readable, editable figures — grouped
  digits and shorthand like `54m` or `500k` — so a big fee is never an unreadable wall of zeros.
- **Negotiation:** an AI club can accept, reject, or **counter** your bid; incoming offers on your
  players can likewise be countered over a few rounds. Free agents can be signed outside windows.
- **Squad-cap interaction:** a signing must fit under the senior cap (§11).

*(The transfer-AI valuation and accept/reject logic is an interim implementation pending a deeper
design session; it lives behind the module interface so it can be swapped without touching the rest
of the game.)*

---

## 11. Squad & match rules

- **Senior squad cap: 50 players.** The academy squad has its own size cap (base 12, up to 24 via
  the Academy Squad Size upgrade) and lives outside the senior cap (§12).
- **Matchday squad: 18** (XI + 7 subs); up to **5 substitutions**.
- **Formations:** presets only (§6).

---

## 12. Youth Academy

The academy is a pillar of the game, equal in weight to the transfer market: **grow your own stars
instead of buying them**. It stays one-screen simple — it only asks for a decision at intake day,
when a prospect report lands, and when a player ages out.

**Academy squad.** A separate roster of ages **12–21** alongside the senior squad, **capped** by the
Academy Squad Size upgrade (**base 12 places, +3 per level to a max of 24**). Academy players cost no
wages (only the academy's weekly upkeep) and don't count against the senior cap. **Promote** to the
seniors any time there's room, **but only once the prospect turns 16** — the youngest kids develop in
the academy/U21s first. **Demote** seniors aged ≤21 back any time — window-free and instant. At
rollover a player turning **22 must leave the academy** (auto-promoted if there's room, else
released), and is warned the whole preceding season. When the academy is at its size cap, intake and
scouted signings are blocked until a place frees up (release, promote, sell) or the cap is upgraded.

**Intake day.** Once per season in **mid-March**, a class of **3–6 prospects aged 12–17** joins,
with an inbox report card. Class size and quality scale with Academy facility level, Youth Coach
stars, and club reputation; the class is trimmed to fit whatever academy places remain. A small
seeded chance produces a **golden generation** — a bigger class with one or two genuinely elite
potentials and hype news. This is the anti-stagnation lottery that keeps forever-saves alive: every
March carries a ticket.

**Potential fog-of-war.** True potential stays in the schema and the engine keeps using it, but the
UI never shows an exact potential for a player under 24 — it shows a **1–5 star range** centred on a
deterministic, seeded **scout estimate** (true potential ± error). A range can be *wrong*, not just
wide — that's what makes gems and busts. Error and width shrink with age, career minutes, Youth
Coach stars (your own prospects) and Scout stars (everyone else's). No re-roll scumming.

**U21 league.** The academy squad plays a statistically resolved **U21 league** for minutes; U21
minutes count toward development at reduced weight. You may flag up to **3 focus prospects** who are
guaranteed full minutes and a small extra growth bonus; everyone else rotates automatically.

**Youth scouting.** Send scouts on assignment from the **Scouting Department** (Academy → Scouting).
Sending a scout is a **lock-in decision**: you set the **country/region**, the **position focus**,
and — new — an optional **player-type (archetype) brief** (e.g. "look for a Poacher"), then confirm.
The brief is fixed once the scout is out; recall and re-send to change it. Every few weeks a
**prospect report** lands in the inbox — a young player matching the brief, with a star range, an
asking fee, and a scout note. Before signing you can **click the prospect open** to inspect their
full attributes, archetype and traits (a read-only preview — they aren't in the world until signed).
**Sign** (fee from budget, joins the academy immediately — youth deals don't wait for windows) or
**pass**; reports expire. **Base 2 scouts** can be out at once; the **Max Scouts** upgrade raises the
ceiling **+1 per level to a max of 5**. More/better scouts mean more frequent reports and tighter
ranges market-wide.

**Scouting Department upgrades.** Bought in-place on the Scouting tab (not the Development screen):
**Max Scouts** (concurrent assignments, base 2 → max 5) and **Academy Squad Size** (prospect places,
base 12 → max 24). One-time purchases, no weekly cost.

**Loans (out).** Any player aged ≤21 can be loan-listed; while a window is open an AI club may take
them for the season. On loan they gain minutes that count toward development but can't be selected
for your XI, and they send progress reports. They return at rollover.

**Academy DNA.** Every player permanently carries the club whose academy they came through, and the
Club records view keeps an **academy graduates ledger** — every graduate, their peak, where they
are now — so a dynasty save can answer *who is the greatest player our academy ever produced?*

---

## 13. Saves & history

- Saves live in **IndexedDB** — roomy, fast, offline. **JSON export/import** of the full save is a
  first-class feature and doubles as the modding format (same schema). The game reminds you to
  export if you haven't in a while. An optional **cloud sync** backend sits behind the same
  `save/load/export/import` interface.
- **History & Record Book.** Full match-by-match detail is kept for the current season and
  compressed into summaries at rollover, which bounds forever-save growth. The record book stores
  final tables, cup winners, award winners, all-time club records, and notable transfers.
  PlayerCareer + RecordBook together are the museum of the save.

---

## 14. The screens

1. **Home** — inbox/news, calendar, the **Continue** button. The spine of the loop.
2. **Squad** — roster, fitness/form at a glance, sortable.
3. **Tactics** — formation, mentality, style, defensive line, focus; lineup; synergy hints.
4. **Match Day** — live text sim or instant result; halftime tweak.
5. **Competition** — league tables, fixtures/results, top scorers; playable and sim-only tabs.
6. **Transfers** — search/browse, bids in/out, offers, listings, window countdown.
7. **Club** — finances, income upgrades, staff, club history & records.
8. **Development** — Training Plans (per-player focus + growth projection), Training Facilities,
   Development Staff.
9. **Academy** — academy squad, U21s, scouting focus & reports, loans, intake review.
10. **Player Profile** — Bio tab (attributes, archetype, traits, value, contract) + Career tab.

---

## 15. Tuning

Every balance number lives in the single tuning config, `lib/config/tuning.ts`, and is adjusted
only via the calibration harness. Selected current values:

| Knob | Value |
|---|---|
| Segments per match | 6 × 15 min |
| Base chance rate | calibrated to ~2.7 goals/match |
| Home advantage | ~+5% effective rating |
| Fitness penalty floor | ~×0.85 |
| Out-of-position floor | ~×0.6 |
| Growth window | ages ~12–24 |
| Prime window | ages ~25–31 |
| Decline onset | ~32–33, modulated |
| Retirement window | ~34–37 |
| Minimum overall (generated) | 50 |
| Fast-track band | grow faster under 60 overall (~1.8× at floor) |
| **Squad cap** | **50 senior** |
| Academy squad size | base 12, up to 24 |
| Academy promote age | 16+ |
| Scouts out at once | base 2, up to 5 |
| Matchday squad | 18 |
| Substitutions | up to 5 |

---

## 16. Design language

Dark theme (`#0b0c0f`) with a subtle gold gradient accent (`--color-gold-hi → --color-gold-lo`)
reserved for the active/important thing; the signature element is the 1px `.gold-thread`. Display
face is Saira Condensed (uppercase, scoreboard feel), body is Instrument Sans, and every data column
uses `tnum` for aligned figures.

---

## 17. Tooling

- `npm run dev` — dev server (localhost:3000).
- `npm run build` — production build + typecheck.
- `npm run calibrate [n]` — match-engine calibration harness (targets ~2.7 goals/match, ~45% home wins).
- `npx tsx scripts/smoke.ts [seasons]` — headless multi-season simulation (loop / rollover / cup / transfer sanity).
- `node scripts/ui-test.mjs` — end-to-end UI drive via headless Edge (dev server must be running).

---

## 18. Open & future items

- `[OPEN]` Deeper archetype roster + trait pool (owner-designed; engine treats as data).
- `[OPEN]` Transfer-AI valuation & accept/reject design session (interim implementation shipped).
- `[FUTURE]` Living AI world with long-term squad-building, injuries plugged into the fitness
  system, further anti-stagnation (era shifts, generational wonderkids), managing other clubs
  mid-save at season boundaries, a fully fictional/procedural world generator for public release,
  archetype auto-classifier tooling, loans-in and loan fees.

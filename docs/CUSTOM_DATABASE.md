# Custom Country Database — Authoring Reference

This is the reference for hand-authoring a **per-country override** you upload at
new-game setup. Each file describes **one country**: its leagues (divisions), the
clubs in them, and — optionally — hand-authored players on any club.

You upload one override per country you want to customize. Countries you leave alone
use the built-in default. Because setup lets the user pick *which countries* are in the
save, a per-country file is the natural unit: author the ones you care about, generate
the rest.

- **Format tag:** `fl-country-db@2` (the current format). `fl-country-db@1` files still
  import — see [§9 Legacy](#9-legacy-fl-country-db1).
- **Validator:** the file is checked at upload; you get a line-by-line error list if
  anything is off. Nothing is silently dropped.
- **Fill-in philosophy:** specify as much or as little as you like. Anything you omit
  on a club or player is generated procedurally. A club with no `players` gets a full
  generated squad; a player with only `name` + `positions` + `attrs` gets a derived
  overall, plus procedural age, potential, archetype, traits, and value.

> **What changed in @2 — attributes drive the game.** A player is now authored by the
> **six attributes** (Pace, Shooting, Passing, Dribbling, Defending, Physical). The
> player's **overall is derived from those attributes, weighted by position** — and the
> derived overall is what the match engine, transfer value, and wages all run on. So your
> real data (e.g. *Haaland: 96 pace, 99 shooting*) genuinely determines how the player
> performs, and the same attribute line rates differently by position (a striker's weak
> defending barely counts; a centre-back's doesn't get away with it).

---

## 1. Top-level shape

```jsonc
{
  "schema": "fl-country-db@2",    // REQUIRED — the format tag
  "code":   "ENG",                // REQUIRED — 2–4 letter country code (unique id for this country)
  "name":   "England",            // REQUIRED — display name
  "nat":    "ENG",                // REQUIRED — dominant nationality pool (3-letter) for generated players
  "homeShare": 0.6,               // optional — 0..1, share of generated players from `nat`. Default 0.6
  "divisions": [ /* … */ ]        // REQUIRED — one or more leagues, see §2
}
```

| Field | Required | Rules |
|---|---|---|
| `schema` | ✅ | `"fl-country-db@2"` (or `@1` for legacy files). |
| `code` | ✅ | 2–4 letters. Identifies the country. |
| `name` | ✅ | Non-empty country name. |
| `nat` | ✅ | Non-empty nationality code. Generated (non-authored) players default to this. |
| `homeShare` | — | Number `0`–`1`. Higher = more home-nationality players in generated squads. Default `0.6`. |
| `divisions` | ✅ | Non-empty array. **At least one division must be `tier: 1`.** |

---

## 2. Divisions (leagues)

```jsonc
{
  "id":   "ENG1",              // REQUIRED — unique within this file
  "name": "Premier Division",  // REQUIRED — display name
  "tier": 1,                   // REQUIRED — 1 = top flight, 2 = below it, …
  "clubs": [ /* … */ ]         // REQUIRED — see §3
}
```

| Field | Required | Rules |
|---|---|---|
| `id` | ✅ | Non-empty, **unique** across all divisions in the file. |
| `name` | ✅ | Non-empty. |
| `tier` | ✅ | Integer `≥ 1`. Exactly one country needs a `tier: 1`. Lower number = higher league. |
| `clubs` | ✅ | Array of **at least 4** clubs, and an **even** count (fixtures need pairs). |

> Promotion/relegation slots, prize money, and fixture scheduling are derived globally
> from the tier structure — you don't set them per division. The knobs you control are
> which leagues exist, their tier order, and their clubs.

---

## 3. Clubs

A club can be as minimal as name + short + colors + rep + stadium. Add `players` only
for teams you want to hand-author.

```jsonc
{
  "name":    "London Imperial",     // REQUIRED
  "short":   "LIM",                 // REQUIRED — 2–4 letter badge/table abbreviation
  "colors":  ["#1b458f", "#ffffff"],// REQUIRED — [primaryHex, secondaryHex]
  "rep":     88,                    // REQUIRED — reputation 1..100 (drives budget, generated squad quality, draw pull)
  "stadium": "The Crown Ground",    // REQUIRED
  "players": [ /* … */ ]            // optional — see §4. Omit for a fully generated squad
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | ✅ | Non-empty. |
| `short` | ✅ | 2–4 letters. |
| `colors` | ✅ | Exactly two hex strings: `[primary, secondary]`. |
| `rep` | ✅ | `1`–`100`. Reputation. Sets the **generated** squad's baseline quality and the club's transfer budget. (Authored players use their own attrs, not `rep`.) |
| `stadium` | ✅ | Non-empty. |
| `players` | — | Array of player seeds (§4). A **partial** roster is topped up to a full squad procedurally — author your marquee XI and let the depth fill in. Omit entirely for a fully generated squad. |

### Squad top-up template

When you author fewer players than a full squad, the game fills the remaining slots to
reach this shape (per position: first slot ≈ starter level, extras are depth):

```
GK×3  CB×4  LB×2  RB×2  DM×2  CM×3  AM×2  LW×2  RW×2  ST×3   (25)
```

Authored players count toward their primary position's quota.

---

## 4. Players — the attribute-driven format

**Required:** `name`, `positions`, and `attrs` (the six attributes).
Everything else is optional and generated when omitted. **Overall is not authored — it
is computed from `attrs` by position.**

```jsonc
{
  "name":      "Alex Star",          // REQUIRED
  "positions": ["ST", "AM"],         // REQUIRED — first entry = primary; rest = secondaries

  "attrs": {                         // REQUIRED — the six attributes, each 1..99
    "pac": 96,                       //   Pace
    "sho": 99,                       //   Shooting
    "pas": 60,                       //   Passing
    "dri": 88,                       //   Dribbling
    "def": 30,                       //   Defending
    "phy": 88                        //   Physical
  },

  "age":         25,                 // optional — 15..40. Default: random 17..35
  "nationality": "NOR",              // optional — 3-letter. Default: the country's `nat`
  "potential":   93,                 // optional — hidden ceiling. Default: derived from overall + age
  "archetypeId": "poacher",          // optional — must be valid for the primary position (§6). Default: rolled
  "traits":      ["clinical"]        // optional — 0–2 trait ids, eligibility-gated (§7). Default: rolled
}
```

### The six attributes (`attrs`)

Standard FIFA order and meaning. Each is `1`–`99`.

| Key | Attribute |
|---|---|
| `pac` | Pace |
| `sho` | Shooting |
| `pas` | Passing |
| `dri` | Dribbling |
| `def` | Defending |
| `phy` | Physical |

**Goalkeepers use the same six keys**, carrying keeper skills:

| Key | GK meaning |
|---|---|
| `def` | Reflexes / handling *(dominant — this is shot-stopping)* |
| `phy` | Aerial / diving reach *(dominant)* |
| `pas` | Distribution |
| `pac` | Rushing out speed |
| `dri` / `sho` | Minor (composure / rare long-range) — near-zero weight |

So a keeper like **Verbruggen — `pac 55, sho 44, pas 62, dri 55, def 86, phy 91`** derives
an overall in the mid-80s: the weighting keys on his `def`/`phy` (handling + reach) and
all but ignores his `sho`.

### How overall is derived (so you can predict it)

`overall = position-weighted mean of the six attrs, plus a specialist bonus.`

1. **Position weighting.** Each position weights the six attributes differently (a
   striker weights `sho`/`pac`/`dri` heavily and `def` almost nothing; a centre-back
   weights `def`/`phy`). So *the same attrs rate differently by position.*
2. **Specialist bonus.** A lopsided elite gets lifted above the flat mean — a striker
   with **96 pace / 99 shooting / 30 defending still lands in the low 90s**, because his
   weak defending barely counts and his signature attributes are rewarded.

You don't need to compute this yourself — just author realistic attrs and the overall
falls out sensibly. Roughly: elite specialists ~88–93, strong starters ~78–85, squad
players ~68–77, fringe ~58–66.

| Field | Required | Rules |
|---|---|---|
| `name` | ✅ | Non-empty. |
| `positions` | ✅ | Non-empty array of valid positions (see §6). **First = primary** — the position the overall is weighted for. |
| `attrs` | ✅ | Object with all six keys (`pac sho pas dri def phy`), each `1`–`99`. |
| `age` | — | `15`–`40`. Default random `17`–`35`. |
| `nationality` | — | 3-letter code. Default = country `nat`. |
| `potential` | — | Clamped to `overall … 96`. Default derived from overall + age. |
| `archetypeId` | — | Must be valid for the primary position (§6), else a valid one is rolled. Affects goal/assist flavor and tactical synergy, **not** the derived overall (attrs already carry the profile). |
| `traits` | — | 0–2 ids from §7, gated by the player's position group; ineligible ones are ignored. |

> **What you still don't set:** `fitness`, `form`, market `value`, contract, and hidden
> longevity are computed. `value` and wages follow from the derived overall, so an elite
> attribute line automatically produces an expensive, well-paid player.

---

## 5. A complete example club

```json
{
  "name": "First Club FC",
  "short": "FCF",
  "colors": ["#c8102e", "#ffffff"],
  "rep": 82,
  "stadium": "First Ground",
  "players": [
    { "name": "Alex Star",  "positions": ["ST"], "attrs": { "pac": 96, "sho": 99, "pas": 60, "dri": 88, "def": 30, "phy": 88 }, "age": 25, "potential": 93, "archetypeId": "poacher", "traits": ["clinical"] },
    { "name": "Wide Blur",  "positions": ["LW", "RW"], "attrs": { "pac": 94, "sho": 82, "pas": 78, "dri": 93, "def": 32, "phy": 70 }, "age": 23 },
    { "name": "The Maestro","positions": ["CM"], "attrs": { "pac": 70, "sho": 78, "pas": 93, "dri": 89, "def": 62, "phy": 70 }, "age": 27, "traits": ["maestro"] },
    { "name": "Sam Anchor", "positions": ["CB"], "attrs": { "pac": 74, "sho": 40, "pas": 68, "dri": 55, "def": 90, "phy": 88 }, "age": 28, "traits": ["marshal"] },
    { "name": "Gary Gloves","positions": ["GK"], "attrs": { "pac": 55, "sho": 44, "pas": 62, "dri": 55, "def": 86, "phy": 91 }, "age": 27 }
  ]
}
```

The rest of this club's squad (the positions not listed) fills in procedurally.

---

## 6. Valid positions & archetypes

**Positions (10):** `GK CB LB RB DM CM AM LW RW ST`

`archetypeId` is optional; if set it must be valid for the player's **primary** position:

| Position | Valid `archetypeId` values |
|---|---|
| GK | `shot_stopper`, `sweeper_keeper` |
| CB | `stopper`, `ball_playing_def` |
| LB / RB | `wing_back`, `def_fullback` |
| DM | `anchor`, `deep_playmaker` |
| CM | `deep_playmaker`, `box_to_box`, `playmaker` |
| AM | `playmaker`, `adv_playmaker`, `shadow_striker` |
| LW / RW | `speed_winger`, `inverted_winger` |
| ST | `shadow_striker`, `poacher`, `target_man`, `complete_forward` |

---

## 7. Valid traits

A player may carry **0–2** traits. Each has an eligibility group; assigning one outside
the player's group is ignored.

| `eligible` group | Applies to | Trait ids |
|---|---|---|
| `any` | every position | `clutch`, `dead_ball`, `leader`, `talisman`, `consistent`, `composed`, `engine`, `workhorse`, `evergreen`, `marketable`, `mentor` |
| `att` | attackers (AM, LW, RW, ST) | `clinical` |
| `mid` | midfielders (DM, CM, AM) | `maestro` |
| `def` | defenders (CB, LB, RB) | `marshal` |

---

## 8. Minimal valid file

The smallest thing that passes validation — one top-flight league, four clubs, one club
with a partial hand-authored roster (the rest fill in automatically):

```json
{
  "schema": "fl-country-db@2",
  "code": "XXX",
  "name": "My Country",
  "nat": "XXX",
  "homeShare": 0.6,
  "divisions": [
    {
      "id": "XXX1",
      "name": "My Top Division",
      "tier": 1,
      "clubs": [
        {
          "name": "First Club FC",
          "short": "FCF",
          "colors": ["#c8102e", "#ffffff"],
          "rep": 82,
          "stadium": "First Ground",
          "players": [
            { "name": "Alex Star",  "positions": ["ST"], "attrs": { "pac": 96, "sho": 99, "pas": 60, "dri": 88, "def": 30, "phy": 88 }, "age": 25 },
            { "name": "Sam Anchor", "positions": ["CB"], "attrs": { "pac": 74, "sho": 40, "pas": 68, "dri": 55, "def": 90, "phy": 88 }, "age": 28 }
          ]
        },
        { "name": "Second Club", "short": "SEC", "colors": ["#034694", "#dba111"], "rep": 74, "stadium": "Second Park" },
        { "name": "Third Club",  "short": "THI", "colors": ["#000000", "#ffffff"], "rep": 66, "stadium": "Third Field" },
        { "name": "Fourth Club", "short": "FOU", "colors": ["#0057b8", "#ffffff"], "rep": 60, "stadium": "Fourth Arena" }
      ]
    }
  ]
}
```

---

## 9. Legacy (`fl-country-db@1`)

Older files that author `overall` per player instead of `attrs` still import. In an `@1`
file (or any player object that gives `overall` but no `attrs`), the player's six
attributes are **generated** from that overall and their archetype — the pre-attribute
behavior. You can also mix: within a `@2` file, a player object may give `overall`
instead of `attrs` and it works the same legacy way.

- A player must have **either** `attrs` **or** `overall`. If both are present, `attrs`
  wins and `overall` is ignored.
- `overall`, when used, is `40`–`99`.

To move a legacy file to the full attribute-driven model, replace each player's
`"overall": N` with an `"attrs": { … }` block.

---

## 10. Validation checklist

- [ ] `schema` is `"fl-country-db@2"` (or `@1` for legacy).
- [ ] `code` and `nat` are set; `code` is 2–4 letters.
- [ ] `divisions` is non-empty and **at least one** division is `tier: 1`.
- [ ] Every division `id` is unique.
- [ ] Every division has an **even** number of clubs, **≥ 4**.
- [ ] Every club has `name`, `short` (2–4 letters), `colors` (two hex strings), `rep` (1–100), `stadium`.
- [ ] Every authored player has `name`, `positions` (valid, non-empty), and **`attrs` (all six, 1–99)** — or a legacy `overall` (40–99).
- [ ] Any `archetypeId` is valid **for the player's primary position** (§6).
- [ ] Any `traits` are eligible for the player's position group (§7), max 2.

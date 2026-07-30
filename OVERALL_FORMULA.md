# Overall Rating Formula

How a player's overall rating is computed from his 35 attributes.

Implemented in `lib/config/positions.ts` (`ATTR_WEIGHTS`, `OVERALL_CONSTANT`,
`overallFromAttrs`). Verified by `npm run verify:overall` against all 18,405 players in
`fl26_players_new.csv`.

> **v41 — this replaces the six-attribute model.** Through v40 a player carried six
> aggregate stats (PAC/SHO/PAS/DRI/DEF/PHY) and the rating was a weighted mean of those.
> He now carries **35 individual attributes**, and the rating is a weighted sum over them.
> The six survive only as a *derived summary* for display (see
> [The six card faces](#the-six-card-faces)). Old saves and old custom databases are
> converted automatically, preserving each player's rating.

---

## The formula

```
overall = clamp( round( constant[pos] + Σ (weight[pos][attr] × attr) ), 1, 99 )
```

A per-position weight row plus a per-position additive constant. No reputation, no age,
no height, no hidden inputs.

Three properties worth knowing:

- **Rows are sparse.** A position only names the attributes it rewards; an unnamed
  attribute has weight zero. That zero is real — a centre-back's finishing and an
  outfielder's diving genuinely do not move the rating.
- **Small negative weights exist** and are reproduced verbatim. They express "this
  attribute is evidence of the wrong kind of player here". Individually they are worth
  hundredths of a point.
- **Every row sums to ≈1.0** (0.99–1.02 across all twelve positions). So a player with
  every attribute at *n* rates about `n + constant`, and this is what puts every
  position — goalkeepers included — on the same scale.

## The twelve positions

`GK CB LB RB DM CM AM LM RM LW RW ST`

The source database's vocabulary maps onto these via `FORMULA_POS_TO_POS`
(`lib/fl26/convert.ts`): `CDM→DM`, `CAM→AM`, `CF→AM`, `LWB→LB`, `RWB→RB`.

## The 35 attributes

| Group | Attributes |
|---|---|
| **Attacking** | crossing, finishing, headingAccuracy, shortPassing, volleys |
| **Skill** | dribbling, curve, fkAccuracy, longPassing, ballControl |
| **Movement** | acceleration, sprintSpeed, agility, reactions, balance |
| **Power** | shotPower, jumping, stamina, strength, longShots |
| **Mentality** | aggression, interceptions, positioning, vision, penalties, composure |
| **Defending** | markingAwareness, standingTackle, slidingTackle |
| **Goalkeeping** | diving, handling, kicking, gkPositioning, reflexes, gkSpeed |

Keys, display names and grouping live in `lib/config/attributes.ts` — that file is the
single source of truth, and anything iterating attributes reads its `ATTR_KEYS`.

### Two pairs that are NOT interchangeable

- **`positioning` vs `gkPositioning`** — attacking movement vs. a keeper's placement and
  angles. The GK row weights both: `gkPositioning` at **0.2082** (one of its four big
  terms) and `positioning` at **0.0037** (a rounding error).
- **`sprintSpeed`/`acceleration` vs `gkSpeed`** — outfield pace vs. a keeper's
  rushing-out speed, which carries a small *negative* weight for a keeper.

Conflating either pair is the easiest way to break the model. Getting `gkPositioning`
wrong costs a keeper roughly 18 rating points and makes every goalkeeper in the game
unplayably bad — while leaving the global mean looking fine, which is why
`verify:overall` checks the distribution **per position**.

## What drives each position

The largest terms per position — all you need to author a believable player:

| Position | Dominant attributes (weight ×1000) |
|---|---|
| **GK** | handling 213, diving 212, reflexes 209, gkPositioning 208, reactions 109, kicking 62 |
| **CB** | standingTackle 177, markingAwareness 144, interceptions 126, headingAccuracy 101, slidingTackle 99, strength 96 |
| **LB / RB** | slidingTackle ~140, interceptions ~118, standingTackle ~113, crossing ~93, reactions ~89, stamina ~77 |
| **DM** | shortPassing 149, interceptions 140, standingTackle 122, ballControl 105, longPassing 101, markingAwareness 89 |
| **CM** | shortPassing 165, ballControl 147, longPassing 133, vision 131, reactions 90, dribbling 68 |
| **AM** | shortPassing 159, ballControl 148, vision 138, dribbling 131, positioning 92, reactions 81 |
| **LM / RM** | dribbling ~151, ballControl ~133, shortPassing ~114, crossing ~101, positioning ~85, reactions ~75 |
| **LW / RW** | dribbling ~153, ballControl ~142, finishing ~105, crossing ~99, positioning ~95, shortPassing ~88 |
| **ST** | finishing 190, positioning 134, ballControl 104, headingAccuracy 102, shotPower 95, reactions 86 |

Full rows are in `ATTR_WEIGHTS`; this table is a reading aid, not the source of truth.

## Generating players to a target rating

`fitAttrsToOverall(attrs, pos, target)` shifts an attribute line so it rates `target`.

The shift is **weight-proportional**, not uniform: each attribute moves by
`(gap / Σweight²) × weight`. A uniform shift would move a 0.0001-weight attribute exactly
as far as a 0.2-weight one — unrealistic (a striker made better would mostly gain
free-kick accuracy) and inefficient, since nearly all the movement lands where it barely
affects the rating, forcing the attributes that matter much further to compensate.

Only positively-weighted attributes move. Lowering a real skill to game the rating would
corrupt the player's profile.

Because the 1–99 clamp can swallow part of a shift, the fit runs a few corrective passes
over whatever still has room. An extreme target may still land a point short — that is the
clamp, not model error.

**A caveat for callers.** A position whose row has several near-equal dominant attributes
(a keeper's four 0.21s) will otherwise let those absorb almost the whole correction and
pin at 99. Both generation paths — `worldgen.deriveAttrs` and
`archetypes.shapeAttrsToRole` — pre-compensate the top four weighted attributes downward
so the fit has room to work. That is why a good keeper reads as strong across his skills
rather than maxed in one.

## The six card faces

The six aggregates remain useful for display — a squad list can't show 35 columns — so
they are computed on demand from the 35 by `aggregateAttrs` (`lib/config/attributes.ts`),
never stored:

| Face | Rolls up (outfield) | Rolls up (goalkeeper) |
|---|---|---|
| PAC | acceleration, sprintSpeed | diving |
| SHO | finishing, longShots, shotPower, positioning, volleys, penalties | handling |
| PAS | shortPassing, longPassing, vision, crossing, curve, fkAccuracy | kicking, longPassing |
| DRI | dribbling, ballControl, agility, balance, reactions, composure | reflexes |
| DEF | markingAwareness, standingTackle, slidingTackle, interceptions, headingAccuracy | gkSpeed |
| PHY | strength, stamina, aggression, jumping | gkPositioning |

These are a **view**, not an input: nothing in the engine reads them, and the rating never
passes through them.

## Migrating a pre-v41 player

`expandLegacyAttrs` (`lib/config/attributes.ts`) converts a six-attribute line to 35. Each
old aggregate seeds the attributes that roll up into it (per the table above), anything no
family claims takes the mean of the six, and the archetype's profile blends in the
within-family detail the six could never express — gently, at 75/25, because the old
numbers are real data and the profile is only a prior. `fitAttrsToOverall` then lands the
player back on his stored overall.

Used by both the v40→v41 save migration (`lib/migrate.ts`) and the country-database
upgrade (`upgradeLegacyAttrsInDB` in `lib/database.ts`), so a save and a database produce
the same player from the same input. Verified to preserve every player's rating exactly.

## Verifying

```
npm run verify:overall
```

Checks that every weight row names only real attributes (a typo would silently drop a
term), that every row sums to ≈1.0, that `fitAttrsToOverall` hits its target, and that the
full roster rates in a sane band **per position**.

Current output against the shipped roster: overall mean **65.8**, max **90**, every
position within 8 of the mean (GK 64.2, CB 66.2, CM 65.4, ST 65.7, …), and a credible best
player at every position (Courtois/Donnarumma/Alisson 88 in goal; Salah, Mbappé and
Bellingham 90 outfield).

---

*Attribute source: `fl26_players_new.csv`, 18,405 players. Per-position coefficients are
a fitted regression, reproduced verbatim rather than normalised.*

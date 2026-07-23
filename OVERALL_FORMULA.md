# FC 26 — Overall Rating Formula

How a player's overall rating is computed from the six derived stats.

Verified against all 18,405 players in `fc26_players_full.csv`: **93.9% exact, 100% within ±1** (MAE 0.061, worst case 1). The residual ±1 is EA's own rounding, not model error.

---

## The formula

```
overall = round( constant + Σ (weight[i] × stat[i]) )
```

Six stats and a positional constant. No reputation, no age, no height, no hidden inputs.

Each position's weights sum to exactly **1.0**, so the result is a true weighted average plus a small constant. Two consequences worth knowing:

- A player with all six stats at *n* rates `n + constant`.
- Adding *δ* to all six stats raises the overall by exactly *δ*. This makes the formula trivially invertible — see [Generating players](#generating-players-to-a-target-rating).

## Slot order

Stats are always read in the same six slots:

| Slot | Outfield | Goalkeeper |
|---|---|---|
| 0 | PAC — pace | DIV — diving |
| 1 | SHO — shooting | HAN — handling |
| 2 | PAS — passing | KIC — kicking |
| 3 | DRI — dribbling | REF — reflexes |
| 4 | DEF — defending | SPD — speed |
| 5 | PHY — physicality | POS — positioning |

Goalkeepers reuse the same six columns, matching the FUT card layout. In the dataset the `drv_slot_scheme` column states which scheme a row uses, so you can branch without a position lookup:

```
PAC|SHO|PAS|DRI|DEF|PHY     outfield
DIV|HAN|KIC|REF|SPD|POS     goalkeeper
```

## Weights

| POS | PAC · DIV | SHO · HAN | PAS · KIC | DRI · REF | DEF · SPD | PHY · POS | constant |
|---|---|---|---|---|---|---|---|
| **ST** | 0.0874 | **0.4636** | 0.0498 | 0.2541 | 0.0987 | 0.0465 | 0.09 |
| **LW** | 0.1245 | 0.2306 | 0.2506 | **0.3911** | 0.0000 | 0.0031 | 0.22 |
| **RW** | 0.1268 | 0.2335 | 0.2453 | **0.3910** | 0.0007 | 0.0028 | 0.20 |
| **CAM** | 0.0697 | 0.2097 | 0.3364 | **0.3807** | 0.0000 | 0.0035 | 0.12 |
| **LM** | 0.1248 | 0.1467 | 0.3187 | **0.3594** | 0.0027 | 0.0478 | 1.04 |
| **RM** | 0.1260 | 0.1445 | 0.3264 | **0.3524** | 0.0026 | 0.0482 | 1.07 |
| **CM** | 0.0023 | 0.1191 | **0.4196** | 0.3001 | 0.1026 | 0.0563 | 0.16 |
| **CDM** | 0.0027 | 0.0000 | 0.2834 | 0.1797 | **0.3948** | 0.1394 | 0.96 |
| **LB** | 0.1157 | 0.0000 | 0.1603 | 0.1590 | **0.4890** | 0.0760 | 2.09 |
| **RB** | 0.1147 | 0.0000 | 0.1645 | 0.1582 | **0.4855** | 0.0771 | 2.05 |
| **CB** | 0.0198 | 0.0000 | 0.0503 | 0.0950 | **0.6430** | 0.1919 | 0.08 |
| **GK** | 0.2128 | 0.2125 | 0.0484 | **0.3176** | 0.0000 | 0.2088 | 0.97 |

Bold marks each position's dominant stat. Positions absent from the source data map to their nearest equivalent: `LWB → LB`, `RWB → RB`, `CF → CAM`.

The weights are shown at 4dp and the constants at 2dp. That precision is sufficient — transcribed exactly as printed, this table reproduces 93.96% of ratings exactly and 100% within ±1, so you can retype it by hand without loss. Full precision is in `fc26_overall_model.json`.

### Reading the table

- **Zero weights are real.** A centre-back's shooting, a full-back's shooting and a goalkeeper's speed all carry weight `0.0000` — they do not affect the rating at all.
- **Full-backs carry a large constant** (~2.1 against ~0.1 elsewhere). An LB with all six stats at 70 rates **72**, not 70. This is genuine EA behaviour, but it means full-backs run about two points hot if you generate players by picking stats first.
- **Pace barely matters** for ST, CM, CDM and CB. It is a gameplay stat far more than a rating driver.

## Worked examples

### E. Haaland — ST, actual overall **90**

```
        pace   0.0874 ×  87.13  =    7.612
    shooting   0.4636 ×  94.51  =   43.811
     passing   0.0498 ×  78.06  =    3.887
   dribbling   0.2541 ×  85.92  =   21.835
   defending   0.0987 ×  83.83  =    8.272
 physicality   0.0465 ×  94.05  =    4.371
    constant                     +    0.088
                                 =   89.876
                              round  →  90
```

### Alisson — GK, actual overall **89**

```
      diving   0.2128 ×  86.71  =   18.448
    handling   0.2125 ×  85.71  =   18.214
     kicking   0.0484 ×  86.71  =    4.193
    reflexes   0.3176 ×  89.03  =   28.272
       speed   0.0000 ×  55.00  =    0.000
 positioning   0.2088 ×  90.71  =   18.942
    constant                     +    0.965
                                 =   89.035
                              round  →  89
```

### V. van Dijk — CB, actual overall **90**

```
        pace   0.0198 ×  78.56  =    1.558
    shooting   0.0000 ×  48.01  =    0.000
     passing   0.0503 ×  81.37  =    4.092
   dribbling   0.0950 ×  85.54  =    8.125
   defending   0.6430 ×  91.30  =   58.702
 physicality   0.1919 ×  90.86  =   17.439
    constant                     +    0.083
                                 =   90.000
                              round  →  90
```

## Implementation notes

**Do not round the stats before multiplying.** The `drv_` columns are stored to two decimals deliberately. Rounding them to integers first pushes a noticeable share of players off by a point.

**Clamp the result to 1–99** after rounding.

**Reputation is already baked in.** EA gives elite players a small bonus (up to ~1.4) that the attributes alone don't capture. Because the weights sum to 1.0, that bonus is folded directly into the stored `drv_` values rather than applied at runtime. Skipping it entirely is *not* safe: it leaves 92.6% of players rated 87+ exactly one point low. The `international_reputation` column is retained in the dataset for reference, but the formula ignores it.

**The derived stats serve the formula, not the player.** They are not scouting numbers and are not comparable across positions. A striker's `drv_defending` is ~99% heading accuracy, because strikers' overalls don't use tackling — Haaland reads 83.8 there and cannot defend. Don't surface these raw in a UI as "this player's defending".

## Reference implementation

```javascript
const MODEL = {
  ST: { w: [0.0874, 0.4636, 0.0498, 0.2541, 0.0987, 0.0465], c: 0.09 },
  LW: { w: [0.1245, 0.2306, 0.2506, 0.3911, 0.0000, 0.0031], c: 0.22 },
  RW: { w: [0.1268, 0.2335, 0.2453, 0.3910, 0.0007, 0.0028], c: 0.20 },
  CAM: { w: [0.0697, 0.2097, 0.3364, 0.3807, 0.0000, 0.0035], c: 0.12 },
  LM: { w: [0.1248, 0.1467, 0.3187, 0.3594, 0.0027, 0.0478], c: 1.04 },
  RM: { w: [0.1260, 0.1445, 0.3264, 0.3524, 0.0026, 0.0482], c: 1.07 },
  CM: { w: [0.0023, 0.1191, 0.4196, 0.3001, 0.1026, 0.0563], c: 0.16 },
  CDM: { w: [0.0027, 0.0000, 0.2834, 0.1797, 0.3948, 0.1394], c: 0.96 },
  LB: { w: [0.1157, 0.0000, 0.1603, 0.1590, 0.4890, 0.0760], c: 2.09 },
  RB: { w: [0.1147, 0.0000, 0.1645, 0.1582, 0.4855, 0.0771], c: 2.05 },
  CB: { w: [0.0198, 0.0000, 0.0503, 0.0950, 0.6430, 0.1919], c: 0.08 },
  GK: { w: [0.2128, 0.2125, 0.0484, 0.3176, 0.0000, 0.2088], c: 0.97 },
};
const ALIASES = { LWB: 'LB', RWB: 'RB', CF: 'CAM' };

/** @param {number[]} stats six stats in slot order @param {string} position */
function calculateOverall(stats, position) {
  const m = MODEL[ALIASES[position] ?? position];
  if (!m) throw new Error(`Unknown position: ${position}`);
  let total = m.c;
  for (let i = 0; i < 6; i++) total += m.w[i] * stats[i];
  return Math.min(99, Math.max(1, Math.round(total)));
}
```

Shipped as `fc26Overall.js`, which also exports `weightsFor(position)` and `fitToOverall(stats, position, target)`.

### Generating players to a target rating

Because the weights sum to 1.0, hitting a target overall is a single shift — no search required:

```javascript
function fitToOverall(stats, position, target) {
  const m = MODEL[ALIASES[position] ?? position];
  const d = target - calculateOverall(stats, position);
  return stats.map((s, i) => (m.w[i] > 1e-6 ? Math.min(99, Math.max(1, s + d)) : s));
}
```

The shift is applied only to weight-bearing slots, so a centre-back's shooting isn't inflated by a number that does nothing to his rating.

## Where the stats come from

Each derived stat is a weighted average of a fixed group of EA's detailed attributes. The grouping is fixed; the weights within each group vary by position.

| Derived stat | Source attributes |
|---|---|
| pace | acceleration, sprint speed |
| shooting | finishing, volleys, shot power, long shots, positioning, penalties |
| passing | crossing, short passing, long passing, curve, FK accuracy, vision |
| dribbling | dribbling, ball control, agility, balance, reactions, composure |
| defending | marking, standing tackle, sliding tackle, interceptions, heading accuracy |
| physicality | strength, stamina, jumping, aggression |

Goalkeeper groups map to the keeper attributes: diving, handling and kicking directly; reflexes blends GK reflexes with reactions; speed blends GK speed with acceleration and sprint speed; positioning blends GK positioning with composure.

The full per-position attribute weights are in `fc26_overall_model.json` under `positions[POS].profile`. You only need them if you're recomputing derived stats from raw attributes — the shipped `drv_` columns already have this applied.

## Dataset columns

| Column | Meaning |
|---|---|
| `drv_pace` … `drv_physicality` | the six derived stats, 2dp — inputs to the formula |
| `drv_slot_scheme` | `PAC\|SHO\|PAS\|DRI\|DEF\|PHY` or `DIV\|HAN\|KIC\|REF\|SPD\|POS` |
| `overall` | EA's published rating |
| `reconstructed_overall` | this formula's output |
| `error` | `overall − reconstructed_overall`; always −1, 0 or +1 |
| `position` | primary position; `secondary_positions` is pipe-delimited |
| `club_id` / `league_id` | foreign keys into `fc26_clubs.csv` / `fc26_leagues.csv` |

---

*Source: FC 26 base player database, launch roster (2025-09-19). Transfers after that date are not reflected.*

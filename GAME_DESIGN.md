# Football Legacy — Game Design

A web-based football management game. You take a club, pick a country and a
pyramid depth, and manage a career: the squad, the tactics, the money, the youth
setup, the transfer market, and — if you get far enough — a global network of
clubs you own outright.

This document describes **what the game is**, feature by feature. It is the
design record, not an implementation guide: no code, no file paths, no APIs.
Where a number is quoted it is the designed value, because the number *is* the
design.

> **Not covered here:** Facilities and Staff. Both systems run underneath the
> game (training facilities affect development, coaches affect matches and
> growth) but their front-ends are being redesigned and are deliberately left
> out of this document.

---

## Table of contents

1. [Design pillars](#1-design-pillars)
2. [The world](#2-the-world)
3. [Player architecture](#3-player-architecture)
4. [Archetypes and classes](#4-archetypes-and-classes)
5. [Traits](#5-traits)
6. [Player development](#6-player-development)
7. [Tactics](#7-tactics)
8. [Match simulation](#8-match-simulation)
9. [The season and the game loop](#9-the-season-and-the-game-loop)
10. [Competitions](#10-competitions)
11. [The economy](#11-the-economy)
12. [Club upgrades](#12-club-upgrades)
13. [Sponsorship and marketability](#13-sponsorship-and-marketability)
14. [Contracts](#14-contracts)
15. [The transfer market](#15-the-transfer-market)
16. [AI club behaviour](#16-ai-club-behaviour)
17. [The Youth Academy](#17-the-youth-academy)
18. [Scouting](#18-scouting)
19. [The Global Club Network](#19-the-global-club-network)
20. [Awards, records and legacy](#20-awards-records-and-legacy)
21. [Achievements](#21-achievements)
22. [The screens](#22-the-screens)
23. [Presentation](#23-presentation)

---

## 1. Design pillars

**One button drives the game.** The core verb is *Continue*. Days stream past —
training, transfers, news, youth reports — and the game only stops you when
something genuinely needs you: your matchday, a bid on your player, the end of
the season, a contract round you cannot afford to sleep through. Everything else
arrives as inbox mail you can read or ignore.

**Everything is legible.** A player's identity is readable off his attributes. A
tactic's verdict is readable off the squad you picked. A sponsor's money is
readable off a four-factor breakdown you can inspect. If the game rewards or
punishes you, you can find out why.

**No hidden second systems.** Where two mechanisms could deliver the same effect,
there is one. Tactical identity moves exactly one number (a player's effective
rating). Commercial income comes from one marketability score. This is a
deliberate constraint — it keeps the game explicable and keeps balance tractable.

**Long saves are the point.** The game is built to be played for decades of
in-game time: careers accumulate, records persist, retired legends stay in the
Hall of Fame, and the end-game (the Global Club Network) only opens after you
have built something enormous.

**Determinism.** The same save, the same actions, the same results. Every random
event derives from the save's seed, so a match replayed is a match repeated.

---

## 2. The world

### 2.1 Setting up a save

A new save asks four things:

- **Your country.** The country you manage in. Its divisions run the real match
  engine.
- **Pyramid depth.** How many divisions deep your country's ladder goes, 1 to 3.
  Promotion and relegation run between every adjacent pair, so over a long save
  a club can climb — or fall — the entire ladder.
- **Which other countries exist,** and how deep each of their own ladders runs.
  A save can pair a three-division English pyramid with a single-division France.
- **The database.** Either a shipped real-world database of clubs and players,
  or a generated world.

Your country's divisions are **playable**: real fixtures, real match engine,
real everything. Every other country runs as a **sim league** — a cheap
statistical resolution that produces plausible tables and scorer lists without
ever playing a match. That is what makes a world of dozens of leagues affordable
while the league you actually live in is fully simulated.

### 2.2 Leagues and divisions

Every league carries a **reputation, 0–10** — a property of the division itself,
not of who happens to be winning it. A country's top flight in a strong footballing
nation is a 10; a fourth division anywhere is a 1. League reputation drives wage
scales, who a player will sign for, European qualification and the price of buying
a club.

A division needs at least 4 clubs and an even number of them. Tiers a database
does not author are generated to fill the ladder.

### 2.3 Sim leagues

A sim league is resolved three times a season: at the season's start (so the
summer window has data from day one), at the winter window, and after the final
round. Each resolution produces a full table, a top-scorer list and a
top-assister list, built from squad strength plus noise — so a foreign league you
are shopping in has current form you can judge, and its players accumulate
minutes and age like anybody else.

Sim leagues carry no stored fixtures. That is also what makes them the only place
the Global Club Network can buy or found a club: membership is a clean edit.

### 2.4 Clubs

Every club carries a name, a three-letter short code, colours, a stadium, a
league, a **reputation (1–100)**, a budget, a squad, a tactic, staff, and a set of
upgrade levels. Reputation drives gate income, what the club can attract, and how
the AI values its own players.

### 2.5 Time

Days are integers. Day 0 is 1 July 2025. A season runs July to June: 38 league
rounds on Saturdays, six domestic cup rounds, thirteen European midweek dates,
two transfer windows, a youth intake day in March, and a dead week at the end for
awards, contracts and the season review.

---

## 3. Player architecture

### 3.1 The 35 attributes

Every player carries **35 attributes**, each 1–99, grouped seven ways:

| Group | Attributes |
|---|---|
| **Attacking** | Crossing, Finishing, Heading Accuracy, Short Passing, Volleys |
| **Skill** | Dribbling, Curve, FK Accuracy, Long Passing, Ball Control |
| **Movement** | Acceleration, Sprint Speed, Agility, Reactions, Balance |
| **Power** | Shot Power, Jumping, Stamina, Strength, Long Shots |
| **Mentality** | Aggression, Interceptions, Positioning, Vision, Penalties, Composure |
| **Defending** | Marking Awareness, Standing Tackle, Sliding Tackle |
| **Goalkeeping** | Diving, Handling, Kicking, GK Positioning, Reflexes, GK Speed |

The six goalkeeping attributes only mean anything for a keeper. An outfielder
carries low values in them and they contribute essentially nothing to his rating;
conversely a keeper's outfield stats are real (he can pass, he has stamina) but
barely move his.

The attributes are the **source of truth**. Everything else about a player's
ability — his overall, his card faces, his archetype — is derived from them.

### 3.2 The six card faces

The familiar six — Pace, Shooting, Passing, Dribbling, Defending, Physical — still
exist, but purely as a **derived view**: each is the mean of the attributes that
roll into it. They are how a squad list shows a player at a glance without 35
columns, and how a training plan says "work on pace". They are never stored, so
they can never disagree with the attributes beneath them.

A goalkeeper's card reads the same six slots with keeper labels — Diving,
Handling, Kicking, Reflexes, Speed, Positioning — mapped onto his goalkeeping
attributes.

### 3.3 Overall

**Overall is a position-weighted sum of the 35 attributes plus a positional
constant.** Each position has its own sparse weight row summing to about 1.0 — a
striker's finishing weighs heavily, his tackling not at all; a centre-back's
marking is the point, his crossing is noise.

Two consequences matter for play:

- **The same attribute line reads differently at different positions.** A
  technical midfielder converted to a full-back does not carry his rating across
  intact.
- **Training a specialist costs nothing in headline terms.** Because plans
  compensate for how much position-weight their targets carry, a striker trained
  as a creative False 9 climbs in overall at the same rate as one trained as a
  poacher. Specialising changes *where* the growth lands, never *how much*.

### 3.4 Potential

Every player carries a hidden ceiling. Growth chases it and never exceeds it.
Potential itself can drift slightly over a career — a player who plays and
develops well may nudge his ceiling up; one who stagnates may see it settle down.

For prospects, potential is **fogged**: you see a band, not a number, and the
band tightens the better the scout who filed the report.

### 3.5 The rest of the player

- **Positions.** A primary position, plus — for some players — one realistic
  secondary. A left-back may cover right-back or push on to left wing; a central
  midfielder may drop to DM or push to AM. Versatility is genuinely uncommon,
  which is what makes it worth having.
- **Age, nationality, height, preferred foot.** Height and foot are descriptive
  colour: the engine never reads them, but a Target Man towers over a Poacher
  because his archetype's height profile says he should.
- **Kit number,** 1–99, unique within the senior squad, assignable and swappable.
- **Fitness (0–100),** drained by matches, recovered daily, and modulated by age
  and medical facilities.
- **Form,** a multiplier that swings with recent performance. Some traits damp
  the swing.
- **Longevity,** a hidden 0–1 value governing how gracefully a player ages. It is
  the reason two identical 33-year-olds decline at different rates.
- **Market value,** stored and recomputed as ability and age move.
- **Traits,** 0–3 of them.
- **A training plan** — the only stored piece of a player's tactical identity.
- **Accolades,** the honours he has won, kept permanently, including after
  retirement.

### 3.6 Career history

Two ledgers follow a player forever:

- **Season rows** — one per season per competition: the club, the overall he
  *started* that season on, appearances, goals, assists, average rating, clean
  sheets, awards.
- **Transfer rows** — every move, with fee, both clubs and the date.

Both are append-only and survive the player being sold, retiring, or being pruned
from a very long save.

---

## 4. Archetypes and classes

### 4.1 The loop

```
Training Plan  →  Attributes  →  Archetype  →  Tactical effect
```

An **archetype** is the identity a player has *earned*, read off the attributes he
actually has. It is derived, never stored, and it re-reads itself the moment his
attributes move. Train a rugged centre-back toward passing range and he stops
being a Stopper and becomes an Architect — not because a field was changed, but
because he genuinely became a different player.

There are **45 archetypes**, one for each of the 45 training plans (nine position
groups × five plans each). That 1:1 mapping is what makes the loop legible: *the
plan you train is the archetype you are aiming at, by name.*

Worldgen generates a player's attribute line from a plan's own weights, so a
generated player reads as the archetype his plan targets. Generation and identity
agree by construction.

### 4.2 The five classes

Every archetype belongs to one of five **classes**. The class is what the tactical
system reads; the archetype is the identity you see.

| Class | Colour | What they are |
|---|---|---|
| **Creator** | Blue | Playmakers. Passing, vision, control. Want time on the ball; tire quickly when made to chase. |
| **Engine** | Red | Runners. Stamina, pressing, box-to-box coverage. Restricted by a deep defensive line. |
| **Enforcer** | Green | Destroyers. Tackling, strength, aerial duels. Excel with the play in front of them; exposed by a high line. |
| **Blitzer** | Violet | Attackers. Direct running and lethal finishing. Thrive in fast attacks; isolated by a slow, defensive setup. |
| **Maverick** | Yellow | Improvisers. Technical flair and unpredictable movement. Break open a packed defence; wasted on a rigid, direct plan. |

Class colour is consistent everywhere — squad lists, transfer rows, the tactics
readout — so a squad's shape is scannable at a glance without reading a word.

### 4.3 The roster

Each position group has five archetypes: four specialisations and a balanced
default.

| Group | Archetypes |
|---|---|
| **Goalkeeper** | Wall · Vanguard · Initiator · General · Guardian |
| **Centre-back** | Stopper · Architect · Interceptor · Tower · Sentinel |
| **Full-back** | Motor · Anchor · Constructor · Dynamo · Protector |
| **Defensive mid** | Destroyer · Metronome · Lung · Acrobat · Shield |
| **Central mid** | Workhorse · Maestro · Dribbler · Infiltrator · Turbine |
| **Attacking mid** | Visionary · Phantom · Marksman · Illusionist · Catalyst |
| **Wide mid** | Provider · Conductor · Marathoner · Invader · Specialist |
| **Winger** | Razor · Speedster · Virtuoso · Planner · Stylist |
| **Striker** | Ram · Sniper · Decoy · Bullet · Predator |

Each has its own artwork, drawn on a hex frame in its class colour.

### 4.4 What identity actually does

Identity feeds tactics through **two tables and exactly one lever**:

1. **Class × style.** Does this *kind* of player suit the style you are playing?
2. **Archetype × instructions.** Does this *role* suit the five advanced dials?

Both land on the same place: the player's own effective rating in the match. Since
rating already drives attack, midfield, defence and scoring, one lever moves
everything — and nothing can move behind your back through a second channel.

Two fairness invariants hold by construction:

- **Every style row sums to zero,** and every class is the strict best at at least
  one style. No class is universally better; there is always a setup that suits
  you and a setup that does not.
- **Every named instruction axis carries both a like and a dislike,** which makes
  each archetype's average score across all 405 possible setups exactly zero.

And a third, less visible one: every (style, position) pairing has at least one
non-negative option, so no combination of shape and style can leave you with no
good answer at a position.

---

## 5. Traits

A player carries 0–3 traits. Traits are curated to make football sense, and each
is restricted to a position group — a striker never rolls a defender's trait.

Each trait exposes concrete, numeric effects that the game reads directly, and the
UI shows you exactly what they are. Examples:

- **Clutch** — +8% match rating from the 75th minute.
- **Clinical** — +22% chance to be the scorer.
- **Maestro** — +35% chance to grab the assist.
- **Dead-Ball Specialist** — +10% scorer weight, and sharper as your designated
  penalty and free-kick taker.

Trait effects fall into these categories:

| Effect | What it does |
|---|---|
| Clutch multiplier | Rating boost late in matches |
| Fitness drain | Tires slower or faster |
| Team buff | Small passive rating lift for teammates on the pitch |
| Captain buff | Extra team buff, only while wearing the armband |
| Scorer / assist weight | Bias in who finishes and who creates |
| Concede multiplier | Opponents convert less while he is on the pitch |
| Longevity bonus | Ages more gracefully |
| Form stability | Damped form swings — the consistent player |
| Marketability | Lifts his weight inside the club's Squad Star Power |
| Mentor bonus | Speeds up the development of the club's youngsters |

Traits never gate anything. They are edges.

---

## 6. Player development

Development runs on one curve: **age, potential, minutes played, training plan,
longevity and recent performance** in, a change in overall out. It resolves at the
season rollover, with a smaller weekly tick during the season.

### 6.1 The three phases

- **Growth.** The young player climbs toward his ceiling.
- **Prime.** Ability plateaus.
- **Decline.** From the mid-thirties, ability erodes — and eventually retirement.

Every player's development is logged per season — from/to overall, from/to
potential, age, phase — and the log is what the Development page's growth history
renders. A career is visible as a shape, not just a current number.

### 6.2 What speeds growth up

- **Minutes.** The single biggest lever. A full season is roughly 3,000 minutes;
  a player who doesn't play doesn't develop. Loan minutes count at a reduced
  weight; U21 minutes count too.
- **Headroom.** The gap between overall and potential.
- **The catch-up band.** Genuinely raw players — below the catch-up threshold —
  grow faster, most strongly at the very bottom, fading to normal as they climb
  out. A low-50s prospect climbs briskly rather than languishing.
- **Training facilities, coaches and mentors.** A dressing room with Mentor-trait
  players lifts the whole youth intake's growth, capped so a squad of mentors
  can't warp the curve.
- **Academy attention.** Focus prospects and U21 regulars grow faster.

### 6.3 What slows it down — elite resistance

Growth slows the better a player already is. The curve is flat up to a threshold,
then decays exponentially toward a floor at the very top of the scale.

This exists because every other lever — minutes, coaching, facilities, plans,
academy bonuses — is a plain multiplier that never asks how good the player
already is. Stacked, they moved an 88-rated youngster as fast as a 60-rated one.
Elite resistance is the brake that makes the last ten points of a career the
hardest ten to get.

### 6.4 Where growth lands: training plans

Each of the 45 plans names **four primary attributes** (the core of the role) and
**four secondary** ones. Training energy splits three ways:

| Tier | Share of the plan's rate |
|---|---|
| Primary | 100% |
| Secondary | 60% |
| Everything else | 20% |

You can set a plan by hand, or auto-assign — which reads the player's actual
attribute shape and picks the plan he is closest to already being.

**Growth emphasis reads the plan, not the derived archetype.** Reading the
archetype would be a feedback loop: a player's current identity would entrench
itself and training could never move him. The plan is your instruction; the
archetype is the result.

### 6.5 Decline is not uniform

Attributes erode at different rates, which is what makes an ageing player a
different footballer rather than just a worse one:

- **Athleticism goes first** — acceleration and sprint speed decline half again as
  fast as the base rate, agility and stamina close behind.
- **Strength holds up** far better than speed.
- **Technique barely erodes** — passing, ball control, curve, free kicks.
- **Reading of the game genuinely improves relative to the rest.** Composure,
  vision and positioning decline slowest of all: experience offsets physical
  decline.
- **Goalkeepers age far more gently** than outfielders across the board.

A 35-year-old loses a yard of pace long before he loses his first touch. That is
the design, and it is why a declining creator stays useful long after a declining
runner does not.

### 6.6 Fitness

Fitness drains with match minutes — modulated by tactical demands (a side pressing
hard with no stamina tires faster) and by traits — and recovers daily, faster with
better medical facilities and more slowly with age.

Fitness feeds directly into effective rating in the match engine and into
selection, so a tired squad is a worse squad.

### 6.7 Retirement and the living world

Players retire out of the decline phase. Retired players stay in the save — their
career rows, their accolades and their Hall of Fame place are permanent — but they
stop being iterated by the hot passes, and very long saves compact them at the
rollover. Retirees are replaced by newly generated players, so the world's
population stays stable across decades.

---

## 7. Tactics

A tactic has seven parts. All are presets — there are no sliders.

### 7.1 Formation

Twenty-plus shapes, each exactly 11 slots with one goalkeeper: 4-4-2, four
variants of 4-3-3, 4-2-3-1, 4-1-4-1, 4-4-1-1, 3-5-2, 3-4-2-1, 3-4-3, 5-3-2,
4-2-2-2, 4-1-2-1-2, 4-3-2-1, 4-1-3-2, 4-2-4, 3-2-4-1, 3-1-4-2, 3-3-3-1, 5-4-1,
5-2-3 and more.

Two rules shape the table:

- In a back three, the wide slots are **LM/RM, not LB/RB**. With no fourth
  defender the flank belongs to a midfielder.
- Variants of one shape (the 4-3-3's midfield options) share a family and fold
  behind a single picker button.

Every formation is available to you. A separate weight governs only which shapes
the world seeds AI clubs into — the most extreme attacking shapes are never seeded
because a league full of 4-2-4 pushes goals-per-match off its balance target.

Changing formation clears the XI (the slots genuinely changed), which is why
**saved tactics** exist: a named preset captures the instructions, the XI and the
bench together, and restores whatever part of it is still legal — a preset saved
three seasons ago still works around the players who have since left.

### 7.2 Mentality

**Defensive · Balanced · Attacking.** How far up the pitch the side plays.

### 7.3 Style

Six styles. The first three are the pure ones and form a rock-paper-scissors
counter core; the other three are hybrids leaning on a specific instruction
package.

| Style | Character |
|---|---|
| **Possession** | Control the ball, work openings patiently |
| **Counter** | Absorb and break at speed |
| **Direct** | Get it forward fast, through the middle |
| **Gegenpress** | Counter's aggression turned into sustained high pressing |
| **Park the Bus** | An extreme shell that concedes the ball by design |
| **Wing Play** | Direct football routed through the flanks |

A hidden counter matrix means style matchups matter, and your opponent's style is
something you can scout but not read off a menu.

### 7.4 The five advanced dials

| Dial | Options |
|---|---|
| **Tempo** | Slow · Standard · High |
| **Width** | Narrow · Standard · Wide |
| **Press** | Low · Medium · High |
| **Defensive line** | Deep · Standard · High |
| **Attacking focus** | Left · Central · Right · Wide · Mixed |

*Wide* emphasises both flanks equally rather than picking a side.

### 7.5 Tactical fit — does your squad suit the plan?

Every tactical choice names the **attributes** it leans on, and the game compares
what the setup demands against what the players on the pitch actually have. A side
told to press with no stamina presses worse than a side built for it.

Fit bites in four places: attacking output, midfield share, defensive solidity,
and how well the side holds its instructions over 90 minutes.

**Fit is an edge, not a gate.** The whole system is capped at roughly ±8% on the
affected phase — smaller than the gap between a good and a bad player. A squad
that suits its instructions feels sharper; it does not win by default.

### 7.6 The Assistant Manager's report

Rather than showing you three panels of arithmetic to synthesise yourself, the
Tactics screen shows **one grade (A+ to E) and a short list of plain-language
notes** — what an assistant would actually say if you asked whether the plan suits
the squad. Each note carries the figure that produced it, for the tooltip.

Alongside it, a **squad blueprint**: the ideal role for each slot in your
formation, a ✓/~/✗ against whoever currently occupies it, and a shopping list of
what you are missing.

Both are computed from the same functions the match engine calls, so the advice
can never claim something the simulation won't do.

### 7.7 On-pitch responsibilities

Four assignments, drawn from the XI: **captain** (whose Leader trait lifts the
side), **penalty taker**, **free-kick taker**, **corner taker** (each biasing
scorer and assist selection on the relevant chances).

### 7.8 Selection and rotation

You pick your XI and an ordered bench. Auto-pick scores each player by ability ×
positional fit × fitness × form.

But **the same eleven should not start every match**, so selection layers two more
considerations on top:

- **Freshness.** A starter below the fitness threshold is rested if a credible
  deputy exists — and the bar rises during a congested week.
- **Squad roles.** Every player's standing in the squad implies a role — Starter,
  Rotation, Impact Sub, Fringe — each with a target share of available minutes.
  Whoever is furthest below his target gets nudged up the order.

A low-priority cup tie loosens the quality floor further, which is where a deep
squad actually plays.

---

## 8. Match simulation

The match engine is a pure, deterministic function: squads + tactics + seed →
events and a result. The same inputs always give the same match.

### 8.1 Structure

90 minutes as **six 15-minute segments**. Per segment:

1. **Effective rating per player** — overall × positional fit × tactical synergy ×
   form × fitness, with trait and coach modifiers layered on.
2. **Aggregate phase strengths** — ATTACK, MIDFIELD, DEFENCE for each side, built
   from the players on the pitch weighted by their slots.
3. **Midfield share → chance volume.** The side winning the middle creates more.
   Volume is drawn around its expectation rather than fixed.
4. **Each chance resolves** — that side's ATTACK against the other's DEFENCE,
   squashed into a goal probability.

Randomness lives in exactly two places: **how many chances occur**, and **whether
each converts**. Everything else is deterministic arithmetic over the squads and
the instructions. That is what keeps the engine explicable — a side that loses,
lost on chances created or chances taken, and both are visible in the match stats.

### 8.2 Effective rating

Everything that could matter about a player funnels into this one number:

- His **overall** at the slot he is playing (positional fit penalises out-of-position
  selection; adjacent positions cost less than alien ones).
- **Class × style synergy** — does this kind of player suit this style?
- **Archetype × instruction fit** — does this role suit these five dials?
- **Squad-level tactical fit** — does the side as a whole have the attributes the
  instructions demand?
- **Form and fitness.**
- **Traits** — clutch in the closing stages, team buffs, the captain's lift.
- **The head coach's matchday edge.**

### 8.3 Who scores

A goal picks its scorer and its assister by weighted draw. Weights come from the
player's class and archetype (a Blitzer is far likelier to finish than an
Enforcer), his position, his effective rating, his traits (Clinical, Maestro,
Dead-Ball) and his set-piece assignments. Goal flavour text is drawn from the
archetype's character, so a Tower's goals read differently from a Sniper's.

### 8.4 Substitutions

Subs come off the bench in your chosen order, driven by fitness, the scoreline and
the segment. A game already won biases toward giving a prospect the minutes —
which is a real development lever, not just flavour.

### 8.5 Live matches

Your own matches can be played live: kick off, watch the first half, **change the
tactic at half-time** — the single in-match interaction point — then play the
second half and see the result finalised. Or simulate it in one shot.

Every match produces: a minute-by-minute event log, the scorers with assists,
possession, shots, shots on target, per-player ratings and per-player minutes.
A compact summary is kept on the fixture so match history stays browsable all
season without storing every event log.

### 8.6 Balance targets

The engine is calibrated to roughly **2.7 goals per match** and **45% home wins**.
Every balance number lives in one tuning table, and any change is re-verified
against those targets before it ships. This is why adding attacking formations to
the AI's pool requires re-calibration — the world's shape moves the numbers.

---

## 9. The season and the game loop

### 9.1 The Continue button

One button advances time. A day only stops you for:

- **Your matchday.**
- **An incoming transfer offer** on one of your players.
- **The end-of-season contract round.**
- **The season review.**

Everything else — AI transfers, youth reports, sponsor offers, awards, other
clubs' results — streams past as inbox mail and a news ticker.

### 9.2 Simulating ahead

You can jump forward several days at once. When you do, the game **pauses the day
before anything important** so you can act on it rather than blowing past it:

- a U21 registration deadline you haven't met,
- a transfer window about to open (a chance to shop),
- a transfer window about to close (last chance to act),
- youth intake day (a class is about to arrive).

Each gate fires once and can be dismissed.

### 9.3 The season calendar

| When | What |
|---|---|
| 1 July | Season starts; summer window already open |
| Saturdays | 38 league rounds |
| Six dates | Domestic cup rounds |
| 13 midweek dates | European group and knockout matchdays |
| 1 September | Summer window closes |
| Mid-season | Sim leagues resolved (winter table) |
| 1 January | Winter window opens |
| 1 February | Winter window closes |
| Mid-March | Youth intake day |
| Twice yearly | U21 competitions run, each with its own registration window |
| After final round | Sim leagues resolved (final tables) |
| Dead week, day 1 | **Awards ceremony** — every individual honour and Team of the Season |
| Dead week, day 2 | **Contract round** — every expiring deal on your books |
| Season end | Review and rollover |

### 9.4 The weekly tick

Every Monday: economy (income in, wages out), development progress, form nudges,
AI transfer activity, scout reports, loan minutes, sponsor offers, staff market
movement and the Global Club Network's own weekly business.

### 9.5 The rollover

At season end, in order:

1. Season summary built — champions, cup winners, European winners, final tables,
   top scorers, promotions and relegations, notable transfers.
2. Promotion and relegation applied across the whole ladder.
3. Contract decisions from the dead-week round applied; anything left undecided is
   treated as a release.
4. Development resolved for the entire world — growth, decline, retirements.
5. Academy prospects age; those who age out become pending graduates awaiting your
   decision.
6. Career rows written, current-season stats folded away.
7. Sponsorship deals expire, performance bonuses settled, new books resolved.
8. Fixtures, cup and European competitions rebuilt for the new season.
9. Achievements and manager accolades synced.
10. Retired players compacted out of the hot path.

---

## 10. Competitions

### 10.1 League

Double round-robin, 38 rounds. Three points for a win. Promotion and relegation
run between every adjacent pair of divisions in your country's ladder.

### 10.2 Domestic cup

Six rounds, single-leg knockout across every club in the country. Ties level at
full time go to penalties. The cup is where a deep squad earns its keep — and the
cup winner takes a European slot.

### 10.3 European cups

Three continental competitions run alongside the domestic season, in the classic
pre-2024 shape:

| Cup | Tier |
|---|---|
| **Champions League** | 1 |
| **Europa League** | 2 |
| **Conference League** | 3 |

Each: **32 clubs → 8 groups of 4 → double round-robin over 6 matchdays → top two
advance → Round of 16, Quarter-Final, Semi-Final as two-legged aggregate ties → a
single-match final.**

Design rules:

- A save needs at least **8 European countries** for the cups to run.
- **Qualification reads the previous season's final league positions,** plus the
  domestic cup winner taking a Europa slot. So the first European campaign is
  **season 2** — season 1 has no prior table to read.
- All three cups share the same matchdays, so a club is only ever in one and you
  only ever have one European fixture on a given date.
- **A level aggregate goes to penalties. There is no away-goals rule.**
- European matchdays are kept clear of the domestic cup.

Slots per nation are data, driven by league reputation. European football pays
substantial prize money and is a major driver of both budget and marketability.

### 10.4 The U21 league

See [The Youth Academy](#17-the-youth-academy).

---

## 11. The economy

One budget number per club, updated weekly.

### 11.1 Income

| Line | Source |
|---|---|
| **TV / central income** | Flat weekly figure, by division tier |
| **Position bonus** | Scales with where you sit in your league table |
| **Gate income** | Club reputation × a per-tier rate |
| **Upgrade income** | The three flat income tiers plus the squad-driven Player Bonus |
| **Sponsorship** | Weekly minor deals (majors pay lump sums on signing) |
| **Matchday bonuses** | Stadium Bonus per home game; Performance Bonus per result |
| **Prize money** | League finish, cup progress, European progress |
| **Solidarity** | A flat weekly payment to every club you don't control |

Every income line is read **at the club's own tier**, clamped so a pyramid deeper
than the table pays its bottom division at the bottom rate. A fourth-division club
earns fourth-division money.

### 11.2 Expenses

| Line | Detail |
|---|---|
| **Squad wages** | The sum of real individual contracts, reduced by the Contract Accounting discount |
| **Staff wages** | Coaches, scouts and backroom |
| **Academy upkeep** | The youth setup's running cost |
| **Academy wages** | Youth scholarships, roughly £1k–£5k weekly per prospect, scaled by ability |
| **Operating costs** | (AI clubs) the ground, travel, insurance, everything below the first team |

The weekly breakdown is fully itemised on the Club page: every line, in and out,
with the net.

### 11.3 Keeping the world solvent

AI clubs carry wage bills their tier income was never going to cover on its own.
They draw two central subsidies — a weekly solidarity payment and a start-of-season
grant — that keep the world's balance sheets plausible without handing you free
money. A club with a surplus reinvests it in the market rather than hoarding.

### 11.4 Player value

Market value is driven by an exponential curve on overall, multiplied by:

- **An age curve** — peaking at 22–24, holding flat through the prime to 29,
  easing to 32, then falling away steeply: 0.6× to 34, 0.3× to 36, 0.12× beyond.
- **A potential premium** for young players with real headroom, strongest at 23
  and under and heavily damped after.

Values round to readable figures and never fall below £50,000.

### 11.5 Wages

Wages come off an exponential ability curve, scaled by the **market** the player
plays in: his division's tier multiplied by his country's league band. The same
footballer is worth different money in a strong top flight and a weak second
division.

This scaling is what makes the lower leagues survivable — but it is also why a
player's *own* wage demand is anchored to his ability and standing rather than to
the buyer's league. See [consent](#154-will-he-actually-come).

---

## 12. Club upgrades

Seven independent one-time-purchase upgrade tracks, each with multiple levels at
escalating prices. There is no weekly cost — you buy a level and keep it.

| Track | What it does |
|---|---|
| **Low Tier Income** | Flat weekly income. The everyday commercial base — local partners, the club shop, matchday concessions. Cheap to start, the first ladder a small club can climb. |
| **Mid Tier Income** | Flat weekly income. National partnerships, hospitality and media. Costs more per level and pays more for it. |
| **High Tier Income** | Flat weekly income. Global brand deals and the commercial machine of an elite club. The most expensive track in the game and the only one that reaches **£1M a week**. |
| **Player Bonus** | Weekly income *per squad player at or above a rating threshold* — image rights and shirt sales driven by the squad itself. Each level pays more but demands a higher rating to qualify. |
| **Contract Accounting** | A percentage discount off the entire weekly wage bill, every week. |
| **Stadium Bonus** | A lump sum banked on **every home fixture** — league, cup and Europe alike. |
| **Performance Bonus** | A lump sum on every result. A win pays roughly five times what a defeat does. |

The design intent is a genuine choice of financial strategy. Player Bonus rewards a
squad-quality strategy; Performance Bonus rewards a winning one; Contract
Accounting rewards a big wage bill; the three flat tiers are the safe compounding
base. Upgrade levels also feed **Club Marketability**, so infrastructure indirectly
raises sponsorship income too.

*(Training, medical, gymnasium, specialist coaching centres, scouting network,
academy squad size, focus slots, scout speed and Youth PR are also upgrade tracks.
Academy and scouting upgrades are covered in their own sections; the training and
medical tracks are part of the Facilities redesign and are out of scope here.)*

---

## 13. Sponsorship and marketability

### 13.1 The commercial portfolio

Eleven sponsorship slots, mirroring how a real club's commercial book is actually
shaped — not a flat list with an artificial "one big deal at a time" cap.

**Majors** — landmark, exclusive, paid as a **lump sum on signing**:

- Front of shirt (the single biggest commercial asset)
- Kit manufacturer
- Stadium naming rights
- Back of shirt

**Minors** — steady **weekly income**, several may run at once:

- Sleeve · Shorts · Training kit · Boot · Regional partners · Beverage · Automotive

Each slot declares how many concurrent deals it supports. Deals run for a set
number of seasons and expire; a slot you pass on goes quiet for a while rather than
re-offering the next day.

### 13.2 Guaranteed or bonus terms

Some major offers arrive with a **second option**: less money up front, plus a
bonus paid at the season rollover if the club finishes at or above a target league
position. A multi-year deal gets one chance at the bonus per season.

The guaranteed terms are always available alongside it, so the bonus widens the
decision rather than replacing it.

### 13.3 Club Marketability

A **0–100 score** built from four things you actually control:

| Factor | Weight | What it reads |
|---|---|---|
| **League & Division Status** | 35 | What division you're in, plus European participation |
| **Squad Star Power** | 25 | The mean of your three best players |
| **Recent Team Form** | 25 | The last ten results, plus unbeaten runs |
| **Club Facilities** | 15 | Mean level across your income upgrade tracks |

The score is derived on read, so it moves the moment a result lands or an upgrade
is bought. The Investments page shows the full working — every factor, its points,
its cap, and a plain-English reason ("Tier 1 League", "Unbeaten in 6") — so what
you read is by construction the same arithmetic the money uses.

Marketability drives three things: **how many suitors** will talk at once, **how
good the brands are**, and **how much they pay**. It renders as a 1–5 star rating.

This model deliberately replaced an earlier one keyed to a squad trait, under which
a club could win the league, fill the ground and rebuild the squad without the
number moving — while a fourth-division club that happened to roll one marketable
striker out-earned one that didn't. Commercial success is now earned through
division, squad, results and infrastructure.

AI clubs run the same deal shapes on the same terms, resolved automatically at the
rollover. They don't work the offer/slot machinery interactively; they simply take
what the market quotes them. That keeps their budgets legible and the transfer
market sensible.

---

## 14. Contracts

Every player at a club carries an individual contract: **weekly wage, expiry
season, the season it was signed**, and optionally a **release clause**.

### 14.1 Release clauses

A fixed fee any club may pay to trigger an automatic sale, bypassing the selling
club's ask price entirely. The player **discounts his wage demand** for accepting
one — a cheaper deal in exchange for a guaranteed exit route.

That is a real trade: clauses are how you afford a player you otherwise couldn't,
and how you lose him.

### 14.2 The end-of-season contract round

On the dead-week contract day, every expiring deal on your books is put to you at
once: **renew or release**, one by one. Academy prospects appear here too — keeping
one in the youth setup costs no wage.

The Continue loop **stops here and will not let you fast-forward past it.** Losing
a squad to admin is exactly what this step prevents. Anything left undecided at the
rollover is treated as a release.

### 14.3 Renewal terms

Renewing means agreeing a wage, a length and optionally a clause. What a player
will accept depends on his ability, his standing, his age and his current market —
and, if he isn't playing, on how long that has been true.

### 14.4 Running a contract down

A player can be left to run out and leave on a free. That is a legitimate strategy
in both directions: you can lose a star for nothing, and you can sign one.

---

## 15. The transfer market

### 15.1 Windows

Two windows: **1 July – 1 September** (summer) and **1 January – 1 February**
(winter). Nothing moves outside them.

### 15.2 Buying

You search the world — every club in every league, playable or sim — filtered by
position, age, ability, value, nationality, class and archetype. Anyone can be
approached; whether he comes is another matter.

A bid is a **fee plus terms** (wage, length, optional release clause). The selling
club responds: accept, reject, or counter.

**The ask price** starts from the player's market value and moves on:

- Whether he's one of the club's best XI (a premium).
- Whether he's young with real headroom (a further premium).
- The selling club's **stance** — a club going for the title prices its players
  out of the market; one rebuilding is happy to cash in.

But the whole spread is deliberately **compressed hard toward 1.0× value and then
clamped to a tight band**. A £137M player should cost £120M–£150M, not several
multiples of it. The signals above decide the *ordering*, not the magnitude:
buying at value is always realistic.

A **release clause overrides the selling club entirely** — whatever they would have
asked, the clause is the number.

### 15.3 Selling

You list players for sale, and AI clubs bid. An incoming offer stops the Continue
loop. You may accept, reject, or counter — and countering is a real negotiation:

- Every buyer carries a **hidden ceiling** — the most they will ever pay. Seeded
  when the offer is made, so a negotiation is deterministic.
- Every buyer brings **patience**, rolled per deal rather than fixed. A club
  desperate for the player, or one with money to burn, haggles longer than a
  lukewarm suitor — so the bar is genuinely different every time.
- **Each counter costs patience, and an unreasonable ask costs far more than a
  modest one.** How hard you push matters as much as how often. At zero patience
  the buyer walks.

You can also sell directly to a specific club. A player signed **this season
cannot be sold or listed** — a signing can't be flipped for profit inside the
window it was made in.

### 15.4 Will he actually come?

A transfer has to clear the **player**, not just the buying club's chequebook.
Two gates:

**1. Standard of football.** A player refuses to drop more than a set number of
divisions, or to join a club far below his own in reputation, *however much he is
being offered*. This is a hard gate. No amount of money buys past it.

**2. Money.** What he demands is anchored to his **ability and current standing**,
not to the buyer's league. A lower-league club fails the affordability test rather
than being handed a discount on a player it should never reach.

Together these fix the immersion break where wage-market scaling quoted a
top-flight player a fourth-division wage and thereby made him look affordable to
exactly the clubs that should never be able to sign him.

**The desperation curve.** Both gates loosen for a player who isn't playing.
Consecutive days without meaningful football — either unattached, or attached and
playing below a minimum share of his side's minutes — push him down a curve: the
longer it runs, the further down the pyramid he'll drop and the more of his wage
floor he'll give up. The decay is gradual, so a benched star doesn't fall two
leagues inside one window, but a genuinely finished player eventually finds his
level. Playing enough, or signing somewhere, resets it to zero.

**Peer priority.** When a player becomes available — listed, released, or running
his contract down — clubs at his own level hold **exclusive rights to bid for a
period** before anyone else may approach. A big name isn't hoovered up by a lower
division before his own level has had a look.

### 15.5 Free agents

Players out of contract sign for free — for whoever can pay the wage and clear the
consent gates. AI clubs work the free-agent market too, and renew their own
expiring deals, so a squad you're watching doesn't simply dissolve.

### 15.6 Loans

Season-long loans, out only. A loaned player stays on the owning club's books; the
destination never fields him in the real engine — his loan minutes are credited
statistically and count toward development at a reduced weight (higher for a
top-tier destination than a sim league).

When a loan is agreed you see the **role** he'll get — starter or rotation — based
on the reputation gap. The role promised at the point of decision is the role he
actually gets.

### 15.7 The transfer wire

Every completed senior deal in the world is appended to a filterable feed: player,
both clubs, fee, date, and how the move came about — **transfer, free, release,
release-clause trigger, or loan**. Your own club's deals are badged. It reads as a
live wire across a whole season's windows.

### 15.8 The shortlist

A personal watchlist of players at other clubs (or free agents) you're tracking.
Adding someone changes nothing in the world — it just collects your targets in one
place. Distinct from your transfer list, which is your own players put up for sale.

---

## 16. AI club behaviour

### 16.1 Stances

Every AI club carries a **stance** — a season-scale intent recomputed each time a
window opens, derived from how the club is actually doing against what its
reputation says it should be doing, plus its finances and squad age.

| Stance | Shops for | Pays | Sells |
|---|---|---|---|
| **Going for the title** | Finished players, 23–31 | Well over the odds (1.35×) | Reluctantly, and never a starter |
| **Strengthening the squad** | 21–30, balanced ability and potential | Slightly over value | Reluctantly, never a starter |
| **Balancing the books** | 20–29, leaning young | Under value | Willingly, including a fringe starter |
| **Rebuilding** | 17–24, potential above all | At value | Aggressively — the most willing seller in the game |

The stance drives everything: who the club hunts, what it will pay, who it lets go
and at what discount. It is the single lever behind AI market character, and it is
a table — no club is ever special-cased.

### 16.2 Squad needs

An AI club reads its own squad against its formation, finds the positions it is
thinnest at, and scores targets on ability and potential weighted by its stance.
It won't buy a fourth centre-back while it has one goalkeeper.

### 16.3 What keeps the market alive

- **Weekly activity during windows** rather than one bulk pass, so deals land
  across the whole window.
- **AI-to-AI transfers** happen constantly and appear on the wire.
- **AI clubs sign free agents and renew their own contracts,** so squads don't
  quietly rot.
- **Sim leagues run their own windows** — a foreign league you're watching moves
  between visits.
- **Distressed clubs** sell to survive.
- **Surplus is reinvested** rather than hoarded.

### 16.4 Matchday AI

Every AI club picks its own XI and bench each matchday, using the same
rotation-aware selection you get, against its own formation and tactic. AI clubs
are seeded into a weighted mix of formations at worldgen — deliberately excluding
the most extreme attacking shapes, which would push the world's goals-per-match
off target.

---

## 17. The Youth Academy

Prospects are ordinary players developed by the ordinary development curve. The
academy exists to supply what that curve responds to: **minutes, coaching, and a
pipeline.**

The academy squad sits **outside** the senior squad — its own roster, its own cap,
its own (much cheaper) wage bill, ages roughly 15–21.

Nothing in the academy ever stops the Continue loop. Everything streams through the
inbox.

### 17.1 Intake day

Once a season, in mid-March, a class arrives. Class size and quality scale with
your academy level, your youth coach's rating and your club's reputation. Some
intakes are **golden** — a standout class, and the inbox tells you so.

Intake classes lean toward spine positions, with keepers rare.

### 17.2 Prospect tiers

Every academy prospect wears a rarity badge:

**Bronze → Silver → Gold → Diamond → Obsidian → Legacy**

Tiers describe both **current ability** and **potential ceiling**, in overlapping
bands — so a tier is a strong signal, not a rigid bracket. Diamond reaches the
absolute potential cap: that's the wonderkid. Obsidian sits above it, and
**Legacy** pins the ceiling at the cap — the once-a-career find.

The bands align to the star scale, so a tier reads as a star range without
arithmetic: Bronze tops out at 3★, Silver spans 3–3.5★, Gold 3.5–4★, Diamond
4.5–5★, and the top two are the full five.

Crucially, **a prospect is raw.** Even a Legacy find arrives in his 60s and has to
be developed. He is not a ready-made star you sign and play; he is a ceiling you
have to reach.

Two badges are kept: the **live tier** while he's a prospect, and a **permanent
academy tier** recording the rarity he graduated as — a history tag on his profile
for the rest of his career.

### 17.3 Focus prospects

A limited number of prospects can be flagged as **focus**: guaranteed U21 starts
plus concentrated youth-coach attention, worth a real growth multiplier. Focus
slots are a purchasable upgrade, capped absolutely.

This is the core academy decision — you cannot develop everyone at once, so you
choose who your club is actually building around.

### 17.4 The U21 league

Twelve teams, double round-robin over 22 rounds, played midweek and resolved
statistically with zero interaction. **Two competitions run per season**, each with
its own registration window.

You **register seven academy players** for each competition. Miss the registration
deadline and your entry is forfeited — the league plays on with a randomly drawn
side in your place, and you sit it out. (This is one of the calendar gates the
fast-forward pauses on.)

You may tag a matchday squad from among the registered seven, or let it
auto-select — focus prospects first, then best available.

The eleven opponents are your rivals' U21 sides, each carrying its **seven
registered prospects as real players** in the world. That is a deliberate,
bounded exception to the rule that sim competitions carry no rosters: youth
scouting needs something real to look at. Those prospects have profiles, values
and prices, and **you can buy them.**

Each rival club rolls a stance on selling its own prospects — **willing, premium,
or unwilling** — which sets the asking price youth scouting has to beat. The elite
tiers are what make a kid genuinely hard to prise away.

U21 minutes count toward development. Final tables from the first competition are
kept when the second swaps in.

### 17.5 Loans out

Prospects can be listed for loan, and AI clubs take them during windows. A loan is
about minutes: the destination's tier sets how much each loan minute is worth
developmentally, and the role you're promised — starter or rotation — is what he
gets. Mid-season loan reports arrive in the inbox.

### 17.6 Graduation

A prospect who ages out doesn't simply walk into the senior squad. He lands in a
**pending graduates** queue at the rollover and you decide: sign him to a senior
contract, or let him go. Graduating a prospect is news, and a genuinely good
graduate is celebrated.

Every player who came through your academy is permanently tagged with it — which is
what the **Academy DNA** ledger is built from. A squad full of your own graduates
is a legacy you can point at.

### 17.7 Academy upgrades

| Upgrade | Effect |
|---|---|
| **Academy squad size** | How many prospects the academy can hold at once |
| **Focus slots** | How many prospects can be flagged focus |
| **Scouting network** | How many scouts you may employ |
| **Scout speed** | Shortens the gap between a scout's reports |
| **Scout filter** | Unlocks the scouting brief's auto-filter |
| **Youth PR** | Commercial and media work around the academy that lifts the market value of every prospect on the roster |

---

## 18. Scouting

### 18.1 Scouts as a department

Scouts are not a single staff slot — the club employs a **roster** of them, and
each carries **two independent 1–5★ ratings** answering two different questions:

- **Experience** → *how many* prospects come back in one report (1–6).
- **Judgement** → *how good* they are: which tier they can find, and how tightly
  they read a ceiling.

A sharp judge of a player also reads potential more tightly, so his reports carry
less fog. Scouts are priced on both ratings together — a 5★/5★ talent-finder is the
expensive one; a lopsided scout costs somewhere in between.

How many scouts you may **employ** is the Scouting Network upgrade cap. Headcount
is in turn the ceiling on **concurrent assignments** — buying the upgrade without
hiring anyone changes nothing.

### 18.2 Assignments

You send a scout on an assignment with a brief:

- **Where.** A three-level hierarchy — continent → region → country — covering
  **135 countries**, every one with its own name pool and flag, so a prospect from
  Senegal is named like one. Regions are drawn along footballing and cultural lines
  rather than strict geography, because that is how a brief is actually written:
  "the Maghreb" and "the Balkans" are meaningful searches in a way that "North
  Africa, excluding Egypt" is not.
- **What.** Broad groups (GK / DEF / MID / ATT / ANY) or **a specific position** —
  which is what makes "find me a right-back" a brief you can actually give.
- **How long.** An assignment runs for a duration you set.

Reports arrive in batches on the scout's own cadence — faster with experience and
with the Scout Speed upgrade — and accumulate on the board, grouped by batch, so
you can see which trip turned up whom.

### 18.3 The auto-filter

Once unlocked, a brief can carry filter clauses: age bounds, ability bounds, and
which rarity tiers you'll accept. Anything failing a set clause is **discarded
rather than reported**, so the board only holds prospects worth your attention.

The trade is explicit: a narrow filter costs **report volume, not scout time.** The
scout keeps his normal cadence and batch size, but a batch only contains what
matched — so a Legacy-only brief may file nothing for weeks. The UI shows the
expected yield, and warns you when a filter is choking the pipeline.

### 18.4 Reports

Each report is a prospect with a fee, the region he was found in, which scout filed
him, which batch he came in, and his rarity tier. The player only enters the world
if you sign him — passing on a report leaves no residue.

Reports expire.

### 18.5 Senior scouting

Separately from youth scouting, the transfer search covers the entire world's
senior players, and the shortlist is where you collect targets.

---

## 19. The Global Club Network

The end-game. Having built something enormous, you stop being a manager with a club
and become the head of a **network of clubs you own**.

### 19.1 Unlocking

You deposit money from your club's budget into a **GCN Funds** pool over time. When
it reaches the threshold — **£5 billion** — you may name your network and unlock
it. **The pool is spent** to unlock: it is the entry cost, not seed capital.

Until then, the GCN screen doesn't exist.

### 19.2 The treasury

Once unlocked, GCN runs its own purse, entirely separate from any club's budget.
It is funded by explicit deposits from your main club (and withdrawals back), plus
its own commercial income. It pays for everything the network does.

### 19.3 Owning clubs

**Buying.** Any club in a **sim (non-playable) league** may be bought. Price is
driven by the squad's total value plus premiums for the league's reputation and the
club's own. The most valuable clubs in the world cost accordingly.

**Founding.** For a flat cost of **£250M**, you can found a brand-new club from
scratch in a sim league — name it, and it is generated with a squad around a
baseline standard and inserted into the division.

Both are restricted to sim leagues, and deliberately so: your own playable pyramid
is left untouched, and the club you actually manage is never part of the network.

**Capacity** starts at 4 clubs and rises by 2 per level of the Group Clubs
upgrade — up to 8 levels, so a fully-invested network can hold 20 clubs.

**Selling.** A club can be sold out of the network at a discount to what it's
worth, but not until a **minimum hold of 5 seasons** after acquisition. No
flipping.

### 19.4 Ring-fencing

A club the network owns **in your own country** is held at arm's length. You get
the ownership — the standing, the balance sheet, the achievement — and **none of
the levers**:

- No treasury funding and no standing orders.
- No network commercial income.
- No player movement in either direction.
- No feeder loans.

That is what stops owning a domestic club from becoming a way to fix your own
league — you can't prop up a rival, and you can't asset-strip one. A ring-fenced
club keeps the ordinary central subsidies every other AI club gets.

### 19.5 What the network does

**Player movement.** Players can be moved between owned clubs at a discount to
market value — the whole point of a multi-club structure. A club must retain a
minimum squad of 16, so you can't hollow one out.

**Feeder loans.** A prospect loaned to a network club gets **guaranteed minutes**.
This is the network's real sporting value: a development pipeline you control end
to end.

**Funding.** Send money from the treasury to any owned club's budget, one-off or as
a **weekly standing order**.

**Selling players out.** Owned clubs can sell into the wider market, and the money
comes to the treasury.

Owned clubs remain **AI-run.** You oversee; you don't manage. They keep playing on
the sim machinery, with their own stances and their own markets.

### 19.6 Operations upgrades

Three tracks, bought from the treasury:

| Track | Effect | Scale |
|---|---|---|
| **Group Clubs** | Raises how many clubs the network may hold | +2 per level, 8 levels |
| **Brand Deals** | Weekly income paid **to the treasury** | £100k base, +£50k per level, 9 levels |
| **GCN Deals** | Weekly income paid **to every owned club's own budget** | £50k base, +£25k per level, 9 levels |

Brand Deals grow the network's own war chest; GCN Deals strengthen the clubs
themselves. Ring-fenced clubs receive neither.

An earlier design had four cosmetic tracks of which only one was ever wired to an
effect. These three each gate something the network is actually about: how big it
can get, and how it pays for itself.

---

## 20. Awards, records and legacy

### 20.1 The awards ceremony

On the dead-week awards day — after the last match, before the rollover — every
honour is handed out at once.

**Per league:**

| Award | Won by |
|---|---|
| Player of the Season | Highest average rating |
| Young Player of the Season | Highest-rated U21 |
| Golden Boot | Most goals |
| Golden Playmaker | Most assists |
| Golden Glove | Highest-rated goalkeeper |
| Golden Wall | Highest-rated centre-back |
| Team of the Season | The best XI of the division |

**Save-wide:**

- **Legacy Player of the Season** — the highest-rated player across every league in
  the world.
- **Legacy Team of the Season** — the best XI on Earth.

Awards are stamped permanently onto the players who win them and **survive
retirement**, so a legend's trophy cabinet is forever.

### 20.2 The record book

A per-season museum. Each season stores champions of every league, the cup winner,
all three European winners, every final table, top scorers, the full accolade set,
your own finish, the season's notable transfers, and every promotion and relegation
grouped by division.

It also tracks **your club's biggest ever win** — never an AI-vs-AI scoreline —
with goals-for breaking ties between equal margins.

The season review modal at the rollover presents all of it.

### 20.3 The Hall of Fame

A hand-curated honour roll. From any player's profile you can enshrine him:
living, retired, sold, or still at the club. It changes nothing in the world — it
just collects the legends you want remembered.

### 20.4 Manager accolades

A permanent, passively-recorded ledger of your own career:

- Seasons played; league titles; cups; promotions.
- Career matches played, won, drawn, lost; goals for and against.
- Peak squad quality: the most 90-rated and 85-rated players you've held at once.
- Peak club budget.
- Biggest signing and biggest sale — **with the player behind each**, snapshotted
  so the record survives him being sold on, re-rated or pruned decades later.
- Total spent and total received across the save.
- Player awards won by players at your club.
- Network: clubs bought, clubs founded, biggest club purchase, peak treasury,
  feeder loans sent.

---

## 21. Achievements

One-off milestones, evaluated against live state, unlocked permanently the first
time they're met and stamped with the season they were earned. Unlocked
achievements never revert. Locked ones with a countable target show a progress bar.

### Silverware
| | |
|---|---|
| 🏆 **Champions** | Win a league title with your club |
| 👑 **Kings of the Land** | Win a country's top division |
| 🥇 **Cup Glory** | Win the domestic cup |
| ⭐ **Dynasty** | Win 5 league titles |
| 📈 **The Climb** | Earn 3 promotions |

### Squad
| | |
|---|---|
| **World Class** | Hold a 90-rated player |
| **Galácticos** | Hold three 90-rated players at once |
| **Loaded** | Hold five 85-rated players at once |
| **Trophy Cabinet** | Win 10 individual player awards |

### Finance
| | |
|---|---|
| **Money in the Bank** | Reach a £100M budget |
| **Billionaire's Club** | Reach a £1bn budget |

### Transfer Market
| | |
|---|---|
| **Marquee Signing** | Spend £100M on a single signing |
| **Cash In** | Sell a player for £100M |
| **Big Spender** | Spend £500M across the save |

### Global Club Network
| | |
|---|---|
| **The Network** | Unlock the GCN |
| **Portfolio** | Own 3 network clubs |
| **Multi-Club Empire** | Own 8 network clubs |
| **Founder** | Found a club from scratch |
| **Club Builder** | Found 5 clubs |
| **Crown Jewel** | Buy a club for £10bn |
| **War Chest** | Reach a £10bn treasury |
| **Feeder System** | Send 10 feeder loans |
| **Pipeline** | Send 25 feeder loans |

### Legacy
| | |
|---|---|
| **The Long Game** | Play 10 full seasons |
| **Centurion** | Win 100 matches |

Achievements are scoped to the save and export with it.

---

## 22. The screens

### Home
The dashboard. Next fixture, league position, the Continue button, recent results,
the inbox and the news ticker. The screen you spend the most time on because it's
where Continue lives.

### Squad
The senior roster. Sortable by everything, with class colours, archetype badges,
ratings, contracts, fitness and form. Where you list players, set kit numbers and
open profiles.

### Tactics
Formation picker, mentality, style, the five advanced dials, the pitch view with
your XI and bench, on-pitch assignments, saved tactic presets — and the Assistant
Manager's report with the squad blueprint alongside.

### Match Day
The live match: kick off, first half, the half-time tactic change, second half,
result. Event feed, scorers, possession, shots, player ratings. Or simulate it
outright.

### Competition
Everything competitive, in tabs: league tables for every division in the world,
fixtures and results, match history, the domestic cup bracket, and European
competitions — group tables, knockout brackets and aggregate ties.

### Transfers
Six tabs:
- **Search** — the whole world's players, deeply filterable.
- **Offers** — incoming and outgoing negotiations.
- **Listed** — your players up for sale.
- **Shortlist** — your watchlist.
- **Free agents** — who's available for nothing.
- **News** — the world transfer wire.

### Club
Six tabs:
- **Finances** — the itemised weekly breakdown, every line in and out.
- **Income** — the seven upgrade tracks, each with its full ladder priced.
- **Investments** — sponsorship offers, signed deals, and the Marketability
  breakdown with its four factors shown.
- **History** — the record book, season by season.
- **Players** — squad-level club views.
- **Save** — export, import, backups.

### Development
Two tabs:
- **Plans** — training plan per player, with auto-assign and the plan's primary
  and secondary attributes laid out.
- **Growth** — the season-by-season development history of every player, and where
  their attributes have actually moved.

### Academy
Seven tabs:
- **Squad** — the prospect roster, tiers, focus flags.
- **Development** — youth growth.
- **Growth** — prospect progression history.
- **Loaned** — who's out, where, and how they're doing.
- **U21** — registration, the matchday squad, the table, results, and rival sides
  (whose prospects you can buy).
- **Scouting** — your scouts, their assignments, briefs and filters, and the report
  board.
- **Upgrades** — the academy and scouting upgrade tracks.

### Player Profile
The full picture: all 35 attributes grouped, the six card faces, derived archetype
with its artwork and class, traits with their concrete effects, contract, value,
full career history with per-season rows, every transfer, accolades, academy
history, and the Hall of Fame toggle.

### Achievements
Every achievement grouped by category — earned ones with their season, locked ones
with progress — alongside the full manager accolades ledger and the Hall of Fame.

### Global Club Network
Four tabs, and only visible once unlocked:
- **HQ** — treasury, deposits and withdrawals, network overview.
- **Clubs** — owned clubs, buying, founding, selling, funding and standing orders.
- **Operations** — the three upgrade tracks.
- **Staff** — network personnel.

---

## 23. Presentation

**Dark theme** built on near-black (#0b0c0f), with a subtle **gold gradient**
reserved strictly for the active or important thing — never decoration. The
signature element is a 1px gold thread.

**Typography.** Saira Condensed for display — uppercase, with a scoreboard feel.
Instrument Sans for body copy. Tabular figures on every data column, so numbers
line up down a table.

**Class colour** is the one other colour system that carries meaning: blue Creator,
red Engine, green Enforcer, violet Blitzer, yellow Maverick, consistent everywhere
a player appears. Archetype artwork uses the same palette on its hex frames, so
badge and label never teach contradictory associations.

The game is fully playable at a phone viewport as well as on desktop.

---

*Facilities and Staff are excluded from this document pending their redesign.*

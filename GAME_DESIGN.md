# Football Legacy — Game Design

A web-based football management game. You take a club, pick a country and a
pyramid depth, and manage a career: the squad, the tactics, the money, the youth
setup, the transfer market, and — if you get far enough — a global network of
clubs you own outright.

This document describes **what the game is**, feature by feature. It is the
design record, not an implementation guide: no code, no file paths, no APIs.
Where a number is quoted it is the designed value, because the number *is* the
design.

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
19. [Facilities and staff](#19-facilities-and-staff)
20. [Archetype retraining](#20-archetype-retraining)
21. [Rivalries](#21-rivalries)
22. [The Global Club Network](#22-the-global-club-network)
23. [Awards, records and legacy](#23-awards-records-and-legacy)
24. [Achievements](#24-achievements)
25. [Portability: saves, files and presets](#25-portability-saves-files-and-presets)
26. [The screens](#26-the-screens)
27. [Presentation](#27-presentation)

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
league, a **reputation (1–100)**, a budget, a squad, a tactic, staff, facilities
and a set of upgrade levels. Reputation drives gate income, what the club can
attract, and how the AI values its own players.

**Reputation moves.** It was once stamped at worldgen and frozen forever, which
meant winning the league changed nothing about who would sign for you — every gate
that decides a transfer read a day-one number. It now drifts once a season toward
a target blended from three different kinds of evidence: the club's **squad
quality** (the largest weight, because it is what a target can see for himself),
its **division's reputation**, and **where it finished**.

Two rules keep it sane. It is a **drift, not an assignment**, hard-capped per
season — a market gate that snapped to last May's table would let one lucky season
buy world-class players. And the target is **absolute, never normalised**, so
every club can improve at once rather than the ladder being zero-sum. Your own
club is treated exactly like every other one, or the gates become a difficulty
setting.

It resolves at the rollover *before* the summer market, which is what turns a
title into signings in the **next** window rather than a season later. Measured: a
dominant club climbing 72 → 84.6 doubled the number of 82+ players who would sign
for it, 124 → 243.

### 2.5 Time

Days are integers. Day 0 is 1 July 2025. A season runs July to June: a run of
league rounds on Saturdays (as many as the division needs — see §10.1), six
domestic cup rounds, thirteen European midweek dates, two transfer windows, two
U21 competitions, and a dead week at the end for awards, contracts and the
season review.

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
rollover.

### 6.8 A world has to sustain itself

Long saves are a design pillar, and the hardest thing about them is that a world
degrades in **two independent ways** — its shape and its quality — and fixing
either one alone does nothing.

**A world is an age pyramid, not a headcount.** Holding the population flat is not
enough, because a population count is blind to *who* is in it. Measured over
fifteen seasons, the 22–25 cohort fell from 712 players to **27** while the 34+
cohort climbed from 23 to 871 and the world's mean age went 23.7 → 31.5. The world
was one cohort ageing together, and when it retired it took the top of the game
with it. Three obligations hold the shape:

- **The youth cohort is held at a fixed share of the world**, roughly the shape
  worldgen builds — so this is the absence of decay rather than a boost.
- **AI clubs sign prospects on potential.** Without this the intake is never
  signed, and since development is driven by minutes, an unsigned prospect never
  develops at all — he ages out having become nothing.
- **AI clubs let an ageing player's deal expire.** Every expiring AI contract used
  to be renewed unconditionally, so no club in the world ever declined to re-sign
  anybody and a 37-year-old squad filler was re-signed every summer until he
  retired. Those are the squad places the new generation needs. It is a roll, not
  a rule, and it never applies to a club's best players or to a club whose squad
  is already thin.

**A world must be able to grow its own stars.** This is the deeper problem, and it
survived fixes to intake, recruitment, ageing, contracts and selection because
none of them touched it. Elite resistance (§6.3) was keyed on current overall
*alone*, so it could not tell a 70-rated future superstar from a 70-rated
journeyman standing at his ceiling and damped both identically. Worked through a
whole career, that made an elite successor **arithmetically impossible**: a player
born with 91 potential, signed, and playing every minute under ideal conditions
topped out at 76.9. The original world's stars existed only because worldgen
creates them directly, so as they retired the top of the game emptied and nothing
could refill it.

The fix is that **resistance eases in proportion to remaining headroom**. A player
*at* his ceiling has zero headroom and gets zero relief, so there is still no
19-year-old 90 — but a genuine prospect is no longer braked as though he were
finished. Measured after: the 85+ population went 58 → 137 and stayed there, and
the top flight's mean stopped falling.

The two halves are not substitutes. With the pyramid healthy but growth still
capped, the young players existed and were signed and simply never became good
enough to displace anybody — the top flight's average starter aged from 25 to 33
while its bench got worse.

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

**The blueprint gives a line variety.** Each slot used to be solved
independently, and because the style term dwarfs the instruction term, the answer
was very nearly a function of your style alone — so every slot sharing a position
got the identical role. A 4-4-2 returned six distinct roles out of eleven, always
including two identical centre-backs and two identical central midfielders. A
position *group* is now solved together, taking the best role not already used in
that line, which returns 9–10 distinct roles of 11. (Mirrored flanks still
correctly share a job: left and right back are different positions, so they are
separate groups of one.)

The companion rule: the ✓/~/✗ grades a player against the **best role available
at his position**, not against the differentiated ideal for his particular slot.
Otherwise a side fielding the two centre-backs the blueprint explicitly asked for
would see one of them marked down, and swapping the two players between slots
would flip which one was flagged.

**"I followed the blueprint and I'm still a C" is a real gap, not a
misunderstanding.** The grade is 55% attribute fit, 30% style synergy, 15%
instruction fit — while the blueprint ranks roles on style and dials *alone*. So a
manager who matched every slot has addressed 45% of his grade and been told
nothing about the largest term. Both halves are right to be what they are: a
blueprint must talk about **roles**, which are things you can go and buy, whereas
attribute fit is a property of the eleven specific players you own. What was
missing was anybody saying so — hence a distinct **"right roles, wrong players"**
note, which fires only when the roles genuinely are good.

Both are computed from the same functions the match engine calls, so the advice
can never claim something the simulation won't do.

### 7.7 On-pitch responsibilities

Four assignments, drawn from the XI: **captain** (whose Leader trait lifts the
side), **penalty taker**, **free-kick taker**, **corner taker** (each biasing
scorer and assist selection on the relevant chances).

### 7.8 Selection and rotation

You pick your XI and an ordered bench. Auto-pick scores each player by ability ×
positional fit × fitness × form — **and by tactical fit**, through the very same
lever the match engine applies to his rating. It is not a third channel; it is a
*read* of the existing two, so the tables move selection and simulation together
and can never drift apart. Picked on raw ability alone, a club fields the better
player rather than the better player *for its tactic*, and could play possession
with a squad of counter-attackers forever. The bench is ranked on the same terms,
since the in-match substitution pass can only choose from who is on it.

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

### 8.6 The final day

On the **last league round of the season** — and on no other matchday — a toggle
opens the rest of the division alongside your own match: every other scoreline,
and the table re-sorting underneath as goals land.

**It invents no football.** Every other fixture on the final day is already
settled the moment the panel opens, because the loop plays them before handing
the matchday back to you (which is what keeps the table current at kick-off).
Re-simulating them would produce a different set of results from the ones the save
actually records — two answers to one question.

What *is* invented is only the **clock**: each already-scored goal is assigned a
minute from its own fixture's seed and revealed as your clock passes it. So at 90'
the panel *is* the real final table, and reloading shows the same goals at the
same minutes. It is also free — no second engine pass, on a screen already
running a match.

The live table is built by handing the ordinary table function a doctored fixture
list rather than by patching a finished table, so the tie-break stays one rule.
A live table that broke ties differently from the real one would be the cruellest
possible bug on the day a title is decided on goal difference.

### 8.7 What a match records

Every match produces: a minute-by-minute event log, the scorers with assists,
possession, shots, shots on target, per-player ratings and per-player minutes.
A compact summary is kept on the fixture so match history stays browsable all
season without storing every event log.

### 8.8 Balance targets

The engine is calibrated to roughly **2.7 goals per match** and **45% home wins**.
Every balance number lives in one tuning table, and any change is re-verified
against those targets before it ships. This is why adding attacking formations to
the AI's pool requires re-calibration — the world's shape moves the numbers.

**But a match's calibration is not a season's**, and that distinction is the
hardest-won lesson in the engine's history. The engine once hit every one of those
targets while producing nonsense league tables: a 67-rated promoted side could win
a division of 70+ clubs, and a top-flight club could fall to the third tier.
Goals-per-match and home-win rate describe **a match** and say nothing about **who
wins**, so the whole dynamic range had collapsed unnoticed — measured, the best
side in a division beat the worst only 1.51–0.77, and league finish correlated
just 0.54 with squad quality.

The cause was a single constant defined as "the balance of two equal teams" and
set to a value two equal teams never produce. An even match therefore already sat
78% of the way up the scoring curve with almost no headroom left, so superiority
had nowhere to go.

There are now **two** balance harnesses, and a change has to clear both: one asks
whether a *match* looks like football, the other plays full seasons and asks
whether a *table* does — rank correlation, who wins the title, champion points,
draw rate. Measured over 30 full seasons after the fix: correlation 0.65, champion
on 89 points, the champion is on average the 2.3rd-best squad, and 3.3% of titles
go to a bottom-half squad.

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
- a transfer window about to close (last chance to act).

Each gate fires once and can be dismissed.

### 9.3 The season calendar

| When | What |
|---|---|
| 1 July | Season starts; summer window already open |
| Saturdays | The league rounds — 2 × (n − 1) for a division of n clubs |
| Six dates | Domestic cup rounds |
| 13 midweek dates | European group and knockout matchdays |
| 1 September | Summer window closes |
| Mid-season | Sim leagues resolved (winter table) |
| 1 January | Winter window opens |
| 1 February | Winter window closes |
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

Double round-robin: every club plays every other twice, home and away, so a
division of n clubs plays **2 x (n - 1)** rounds - 38 for a 20-club league, 46
for 24, 34 for 18 (v1.91). Three points for a win. Promotion and relegation run
between every adjacent pair of divisions in your country's ladder.

The season calendar is one shared pool of Saturdays, sized to the LONGEST
division the world runs; each league takes the first 2 x (n - 1) of them. That
is what lets divisions of different sizes coexist in one pyramid.

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
| **Staff wages** | Coaches, scouts and backroom — **scaled by the division you manage in** (see below) |
| **Academy upkeep** | The youth setup's running cost |
| **Academy wages** | Youth scholarships, roughly £1k–£5k weekly per prospect, scaled by ability |
| **Operating costs** | (AI clubs) the ground, travel, insurance, everything below the first team |

The weekly breakdown is fully itemised on the Club page: every line, in and out,
with the net.

**Backroom wages scale with your division** (v1.89). Staff and scout wages were a
flat number keyed on star rating alone, while club income runs roughly **38:1**
from the top flight to the fourth tier — so a 5-star coach cost the same whether
he worked for a club earning £950k a week or one earning £25k, which put the whole
backroom out of reach below the top division and priced a promoted side out of the
facilities it had just unlocked.

The ladder is deliberately far **shallower** than the income one — about 2.6:1,
against income's 38:1. A good coach is a good coach anywhere and the market for him
is global, so a fourth-tier club should find him a stretch rather than a rounding
error. It applies to signing fees as well as wages, since a fee you cannot raise is
the same barrier as a wage you cannot service.

A wage is a **contract**: the rate is fixed when you hire, not re-derived every
week. A coach who signed for a fourth-tier club doesn't get an automatic rise the
week you go up, and one signed in the top flight doesn't take a pay cut on
relegation.

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
base. These income upgrades deliberately do **not** feed Club Marketability — that
factor reads the staff facilities instead (§13.3), because scoring how much sponsor
money a club attracts off how much it already collects was a feedback loop.

These seven are the **only** bought-by-the-level tracks in the game. Everything
that used to sit beside them — training, medical, gymnasium, coaching centres,
scouting network, academy squad size, focus slots, scout speed, Youth PR — is now
a **facility** (§19), where the level buys capacity and the *people* buy quality.
See §19 for why that distinction is load-bearing.

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

A **0–100 score** built from six things you actually control:

| Factor | Weight | What it reads |
|---|---|---|
| **League Division** | 32 | The division's own 0–10 reputation, not its tier number |
| **European Cups** | 20 | How far you got, scaled by which cup it is |
| **Squad Star Power** | 15 | The mean of your three best players |
| **Club Facilities** | 14 | Levels held across the staff facilities, one point per upgrade |
| **League Position** | 12 | Where you sit, as a fraction of your division |
| **Recent Form** | 7 | The last ten results, plus unbeaten runs |

Each factor produces a normalised **0–1 score** which is then multiplied by its
weight. Scores and weights are deliberately separate: a factor answers only "how
well is this club doing at this thing", and the weights table alone decides what
that is worth, so re-balancing is a one-line change rather than a re-cut of every
band table.

Three rules matter more than the numbers:

- **Europe renormalises away when unavailable.** A club with no continental
  football isn't scored 0/20 — the factor is removed and its weight shared across
  the other five. Otherwise season one (which has no European football at all) and
  every non-European nation would be capped at 80/100 by construction, putting the
  top money band permanently out of reach.
- **A European campaign can never lower the score.** The factor is floored at what
  the club's domestic form alone would have scored, so winning the Conference
  League cannot read as worse than not qualifying. Europe is upside only.
- **Facilities are counted, not averaged** — total levels held over total
  available across the staff facilities. A fifth facility shipping moves the
  denominator by itself. It reads the *staff* facilities, not the income
  upgrades: scoring "how much sponsor money you attract" off "how much sponsor
  money you already collect" was a loop.

The score is derived on read, so it moves the moment a result lands or an upgrade
is bought. The Investments page shows the full working — every factor, its points,
its cap, and a plain-English reason ("Premier Division · reputation 10/10",
"Unbeaten in 6") — sorted by what is *missing*, so the top of the list is always
the biggest available gain.

Marketability drives **how many suitors** will talk at once, **how good the brands
are**, and **how much they pay**. It renders as a 1–5 star rating.

### 13.4 What a major deal is worth

A front-of-shirt deal's **annual** value is read straight off the marketability
score: **£16M at 0, £80M at 100**, on a back-loaded curve (exponent 1.6). Every
other major figure is that number scaled by the slot's share and the suitor tier.
So a maxed club offered a three-season shirt deal is quoted **≈£235M**.

Both ends of that band were cut 20% together in v1.91. A blanket cut has to scale
*both*: moving only the maximum would flatten the curve and squeeze the gap
between an ordinary club and an elite one, which is precisely the gap the
marketability score exists to express.

The curve is back-loaded rather than linear because a straight line makes the
middle of the ladder far too rich — a mid-table top-flight club with nothing built
would be quoted two-thirds of elite money for a fraction of the work.

This replaced a stack of five multipliers (reputation × slot share × division
ladder × suitor tier × marketability band × noise) with two problems: it
**double-counted the division**, which is 32% of the marketability score it then
multiplied by *and* was applied again separately; and its product couldn't be
predicted from the tuning file at all. Reputation is deliberately gone from this
path — every question it answered is now a marketability factor.

Minor (weekly) partnerships keep the reputation-based model: they are measured in
tens of thousands per week, and the majors' £20M–£100M annual band would be a
nonsense scale to divide down from.

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

You can also sell directly to a specific club. A player who joined a club **this
season cannot be moved on again until the next one** — a signing can't be flipped
inside the window it was made in.

**Incoming bids have an off switch.** You can silence offers on your own players
entirely. It silences your inbox; it does not freeze the window — AI-to-AI
business, loans and the rest of the market carry on exactly as before. Offers
already on the table keep their deadlines, since switching it on must never void
a live negotiation, and a **release clause is deliberately not gated**: the clause
is a term you agreed to, and honouring the toggle there would rewrite a contract
from a UI switch.

Since v1.89 the same-season lock binds **every club in the world, not just
yours.** It began as a
rule about the manager, which meant AI squads could churn the same player through
three clubs in a single window while you were held to one move — and the transfer
wire read as noise rather than business. It applies to selling, listing, accepting
an offer, and buying: you cannot sign a player out of the very window that took
him somewhere else. Being released clears it, since a free agent has no club to be
locked to.

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

**A position it cannot field at all is a different problem from a weak one**
(v1.89), and the two are kept apart deliberately:

- A need is measured against the **marginal starter** — the weakest player the
  formation would be forced to field there, which is nothing when the slot can't
  be filled. Measured against the club's *best* player in the position instead, a
  side with one good centre-back and a back four judged every centre-back in the
  world "not an upgrade" and never signed one.
- An **uncovered** position (fewer natural bodies than the formation asks for)
  outranks every ordinary shortfall, is shopped for first without a roll, and is
  filled from the free-agent market at any age if no transfer is available.
- **No stance may sell a club below minimum cover.** Rebuilding is allowed;
  fielding ten men is not.

### 16.3 Squads are held to a floor

Every AI buy path is discretionary — gated on stance, affordability and a genuine
upgrade — while retirement and expiry take players out every season regardless. Left
alone, AI squads only ever shrink: measured over twenty seasons the median squad
fell from 28 to 19, and clubs fielded a single centre-back while hundreds of free
ones went unsigned.

Two obligations fix it, both at the rollover and both non-discretionary:

- **The world is restocked.** Only a retiree who peaked high enough leaves a regen
  behind, so the population had no floor. Free agents are now generated wherever
  the world is genuinely short of a position, and the market is kept stocked so
  the Free Agents screen is never bare.
- **Every AI club is topped back up** to a workable squad size, and into any
  position it cannot field. The manager's own club is served first — both draw on
  the same pool, and a manager who cannot name a side is a worse failure than a
  thin AI bench.

### 16.4 What keeps the market alive

- **Weekly activity during windows** rather than one bulk pass, so deals land
  across the whole window.
- **AI-to-AI transfers** happen constantly and appear on the wire.
- **AI clubs sign free agents and renew their own contracts,** so squads don't
  quietly rot.
- **Sim leagues run their own windows** — a foreign league you're watching moves
  between visits.
- **Distressed clubs** sell to survive.
- **Surplus is reinvested** rather than hoarded.

### 16.5 A club keeps its key players

An AI club protects its **six most tactically valuable players who have also
played enough to have become key** — roughly two seasons' worth of appearances.
Both tests are needed: ability alone protects a summer signing nobody has seen,
appearances alone protect a loyal squad player the club would happily sell.

It is a reluctance, not a ban — a roll can still open the door — but that roll is
derived from the world seed, so **a rejected bidder cannot re-roll it by bidding
again.**

Without this, you could hollow out a rival by buying his best XI one player per
window, since the players a club should least want to lose are precisely the ones
that clear a buyer's upgrade bar. One wrinkle came out of measuring rather than
theorising: worldgen seeds no appearance history, so at kickoff nobody cleared the
appearances gate and season one was an open raiding window. A club that has not
played yet falls back to judging on ability alone.

### 16.6 An AI club builds toward a tactic

Two halves pull deliberately opposite ways. Once a season, at the rollover and
after squads have settled, a club looks for the shape that suits **the players it
has**. But all season long it shops for players **its current tactic wants**.

The hysteresis is the feature. A club only switches when the alternative wins by a
clear margin, because the search wins by a fraction of a percent on noise most
seasons — and without a threshold every club re-picks its shape every year and
none is ever *building* toward anything.

**A formation change rewrites what a club needs**, so coverage is re-checked after
it. The rollover once ran the squad top-up and *then* the tactic review, which
meant the coverage pass was answering a question about a shape the club was about
to abandon: a side switching to a 4-2-3-1 suddenly requires two defensive
midfielders where its old shape asked for none, with no signing pass left to run.
Measured, that left a club starting a season with **zero DMs against two slots
while ten unsigned DMs sat in the free-agent pool.**

### 16.7 Matchday AI

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

### 17.1 How prospects arrive (v1.89)

**There is no annual intake day.** Every prospect in your academy got there
because you chose him and paid for him — a scout's find (§18) or a U21
opponent's prospect you bought out. The mid-March intake class that used to
arrive on its own was removed: a roster that grows players the manager never
picked is the same complaint the graduate queue answers at the other end of the
pipeline, and it made the academy something to prune rather than to build.

The one exception is the **starting crop**: a new save seeds enough prospects to
register a legal U21 seven, keeper included, so the opening competition isn't
forfeited before the manager can do anything about it. Nothing tops it up
afterwards.

The golden-generation lottery went with the intake. The anti-stagnation role it
played now belongs to scouting, where the tier ladder already runs Bronze →
Legacy and a Legacy find is the once-a-career ticket.

### 17.2 Prospect tiers

Every academy prospect wears a rarity badge:

**Bronze → Silver → Gold → Diamond → Obsidian → Legacy**

A tier answers two different questions, and since v1.90 it answers them in two
different ways.

**The ceiling is the tier, full stop.** One clean rung each, no overlap, because
the ceiling is what the badge *promises*:

| Tier | Potential |
|---|---|
| Bronze | 65–70 |
| Silver | 70–75 |
| Gold | 75–80 |
| Diamond | 80–85 |
| Obsidian | 85–90 |
| Legacy | 90+ |

**Current ability is the tier *and* his age.** A 13-year-old Gold and a
17-year-old Gold share a ceiling but not a rating — four years of development
separate them — so ability is a table over both (13 → 17):

| Tier | 13 | 14 | 15 | 16 | 17 |
|---|---|---|---|---|---|
| Bronze | 45–48 | 48–51 | 51–54 | 54–57 | 57–60 |
| Silver | 48–51 | 51–54 | 54–57 | 57–60 | 60–63 |
| Gold | 48–51 | 52–55 | 55–58 | 58–61 | 61–64 |
| Diamond | 52–55 | 55–58 | 58–61 | 61–64 | 64–67 |
| Obsidian | 55–58 | 58–61 | 61–64 | 64–67 | 67–70 |
| Legacy | 60–65 | 65–70 | 68–72 | 72–77 | 75–80 |

Every rolled band carries **±2 points of slack**, which is what keeps two Golds
of the same age from being the same player — the bands themselves no longer need
to overlap to make a tier "a strong signal rather than a rigid bracket".

Crucially, **a prospect is raw.** Even a Legacy find is a long way short of his
ceiling — at 13 he is a 60-odd rated child, and only the oldest, rarest finds
arrive anywhere near senior quality. He is not a ready-made star you sign and
play; he is a ceiling you have to reach.

**Ages.** The academy takes prospects from **13 to 17** — both the intake and the
scouting network work that band, so a find and a home-grown kid are priced on the
same ladder. A prospect may then stay until **21**; at the end of that season he
must be promoted, sold or released, and nobody joins the senior squad unless the
manager says so.

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

### 17.7 What the academy costs

The academy is not free, and every price is keyed to the prospect tier ladder, so
a rarer prospect is dearer at every stage of his life at the club:

| Cost | Scale |
|---|---|
| **Sending a scout** | £100k–£250k upfront by travel band, plus £50k–£100k weekly on an open-ended brief (§18.2) |
| **Signing a find** | £1M Bronze → £10M Legacy |
| **Youth wages** | £500/wk Bronze → £5k/wk Legacy |
| **Upkeep** | A weekly running cost per level of the Youth Academy facility |

Youth signings were free until v1.85, which made a scouting board something to
empty rather than to choose from. Wages are priced on the **badge, not the
overall**: two 15-year-olds rate about the same however far apart their ceilings
are, so pricing on current ability made the rarest prospects the cheapest thing
in the game to hoard.

### 17.8 Quick sell

A prospect can be cashed in immediately for **80% of the best offer on the
table** rather than negotiated with a specific suitor. The 20% haircut is what
the convenience costs, so picking a buyer properly always pays more.

**Quick sell deletes the prospect** — he is erased from the world rather than
transferred, and nobody receives him. That is the feature, not an optimisation:
an academy turns over dozens of prospects a season, and releasing or selling them
all would push your castoffs into rivals' squads, letting one manager quietly
decide who everybody else signs. Only the money is real.

### 17.9 The academy is a better place to be *young*

A prospect gets a growth bonus simply for being in the academy — **+25% at 16 and
below, decaying linearly to nothing at 21.**

It is an age ramp rather than a flat bonus for a specific reason. Flat, it would
say "the academy is simply better", which makes promotion always a mistake and
the age-out a punishment. Ramped, the real decision stays live and its answer
changes as he grows: **coaching wins for a teenager who would sit on a senior
bench; senior minutes win for one ready to start.** It is also the only academy
bonus a prospect who never plays a match gets at all — a 15-year-old is there to
be coached, and a season of that used to be worth nothing.

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

How many scouts you may **employ** is set by the Scouting Network facility (§19)
— 2 with no facility, 3 on unlocking it, rising to 7. Headcount is in turn the
ceiling on **concurrent assignments**, so building the department without hiring
anyone into it changes nothing.

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
- **How long.** An assignment runs for a duration you set — or open-ended.

**A trip costs money, and the shape of the deal is a choice.** A fixed-duration
brief pays its whole retainer up front; an open-ended one pays a smaller upfront
and then bills weekly until you recall him. The price is set by how far he
travels — home, region, continent or overseas — measured from your own country,
so a new country prices itself with no table to maintain. A deliberately broad
target (a whole continent, or Worldwide) is priced at the **dearest band it could
reach**, so "Worldwide" can't be both the widest net and the cheapest.

Reports arrive in batches on the scout's own cadence — faster with experience and
with the Scouting Network's scouting-speed channel — and accumulate on the board,
grouped by batch, so you can see which trip turned up whom.

### 18.3 The auto-filter

Once unlocked (Scouting Network level 5), a brief can carry filter clauses: age bounds, ability bounds, and
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

## 19. Facilities and staff

Facilities and staff are **one system, not two.** A facility holds an effect; the
staff assigned to it amplify that effect. Nothing else in the game does either
job. That single rule replaced a predecessor of twelve independent building
levels plus eight named staff slots, in which the two halves could be bought
separately and neither explained the other.

### 19.1 How a facility works

A facility is **unlocked** for a one-off cost, then **upgraded** through five
levels. Every facility produces its numbers the same four ways:

| Term | What buys it |
|---|---|
| **Base** | Unlocking the facility at all |
| **Level** | Each level above the first |
| **Stars** | Each complete step of 6 assigned staff stars |
| **Badges** | Each badge tier held *at that facility* by the staff in it |

Because every facility scales identically, a new one is a row in a table rather
than new machinery. And the screen shows the arithmetic — base, stars and badges
listed separately — from the same function the engine reads, so the UI can never
quote you a number the simulation won't use.

**A staff member has no intrinsic effect.** Unassigned, they contribute exactly
nothing but their wage. Hiring is not the achievement; posting them somewhere is.

Some facilities produce **several quantities at once** — a headcount and a rate,
say — each running that same four-way scaling, and each labelled with its unit so
a number of beds is never printed as a percentage. A facility may also gate a
**capability** rather than a number, for the cases where the answer is on/off
rather than a quantity that crosses zero.

### 19.2 The slot grid

Each facility shows its staff slots as a grid, and **an empty slot opens the
picker in place** — filling a facility never sends you to another screen. The
grid always draws the slot count the facility would have at level 5, with the
ones a future level unlocks shown as padlocks. That is what makes an upgrade
legible *before* you buy it.

The staff shortlist refreshes on the game loop's own clock, every 10 days.

### 19.3 Badges — the loyalty ladder

A staff member earns a **badge** by serving whole seasons at one facility:

**Bronze (1) → Silver (2) → Gold (3) → Diamond (5) → Obsidian (7) → Legacy (10)**

Badges are **per facility** and a person can hold at most **three** of them, so a
long-serving coach is a specialist rather than a universal bonus. A badge is
worth real effect at the facility it was earned at, which makes keeping someone a
strategy in its own right.

**The market barely ever sells a badge.** Only about 8% of candidates arrive with
one at all, capped at silver unless a further roll clears, and diamond is the
absolute ceiling — **obsidian and legacy are only ever earned at your own club.**
A shortlist you can simply buy pedigree from would make the whole ladder
pointless.

Two age numbers sit deliberately far apart: the market generates candidates aged
**21–35**, while a person retires at **65**. A new hire has decades ahead of him,
which is what makes the ten seasons a legacy badge costs a bet somebody can
actually take.

### 19.4 The ten facilities

They are deliberately different *kinds* of lever. What a number does is the
consuming system's business, not the table's.

| Facility | What it produces |
|---|---|
| **Elite Training Center** | A plain multiplier on how fast players approach their potential (ceiling ~33%) |
| **High Performance Center** | A cut to the *elite-resistance penalty* (§6.3), ceiling ~61% |
| **Youth Academy** | Academy squad size (15 → 50), focus slots (3 → 8), and prospect value (up to +43%) |
| **Scouting Network** | Max scouts (2 → 7), scouting speed (up to +67%), and the level-5 auto-filter unlock |
| **Club Income Center** | Weekly income, and how good the sponsorship offers you see are |
| **Club Expense Center** | A cut to the squad wage bill and to academy wages |
| **Creator / Engine / Enforcer / Blitzer / Maverick Archetype Development** | Growth for players of that class, and the retraining programmes of §20 |

**The two growth facilities do not collapse into each other,** and that is the
point of having both. The Elite Training Center is a straight growth multiplier.
The High Performance Center is the only thing in the game that weakens elite
resistance — and since that penalty is *zero* below the elite threshold, it does
nothing at all for a prospect. The ETC stays strictly necessary; the HPC is what
makes 90 → 95 a reachable arc rather than an asymptote.

**The level term is for capacity; the people are for quality.** Where a facility
grows with its building, what grows is a *capacity* — how many scouts you may
employ, how many teenagers you can house, how many you may focus. A five-star
director doesn't conjure a job and a five-star coach doesn't conjure a bed. The
quality numbers still come overwhelmingly from people: scouting speed takes 42 of
its 67 points from staff, prospect value 28 of its 43, and archetype conversion
speed is **stars only**, so a maxed development center is a staffing achievement
rather than a purchase. A bought-by-the-level track for anything that isn't a
capacity is exactly the shape this system exists to remove.

**Every archetype class has a development center.** The first cut shipped four
for five classes, which left Blitzer the one class a player could never be
retrained *into* — an asymmetry too large to be anything but a rule the player
can read. "Every class has a center" is the readable rule.

### 19.5 Three effects with no facility yet

Match-day rating, fitness recovery and youth coaching all deliberately run at
**baseline** until a facility is designed to own them. Each is a named seam
waiting for a lever, rather than an effect quietly wired to something else.

---

## 20. Archetype retraining

A player's identity is normally earned through training plans, over years, on the
back of growth (§4.1). Retraining is the second route, and the two answer
genuinely different questions:

|  | Training plan | Retraining programme |
|---|---|---|
| **What it does** | Grows him *into* the role | Redistributes what he already has |
| **Who it works on** | The young — 41% of 16–18s convert, 2% of 29–33s | Anyone, including a settled 30-year-old |
| **What it costs** | Seasons of growth headroom | An Archetype Development center, and a slot in it |

A plan is a bet on growth, so a finished player has nothing to bet with. That is
correct, not a defect — and retraining is the route the money buys instead.

### 20.1 How a programme runs

You pick a target archetype and the class's development center runs the
programme. It reshapes his 35 attributes toward the target's shape over about
**two seasons**, closing roughly 60% of the remaining gap each summer so the
first season already moves him most of the way and the completion is still worth
waiting for. Each center runs **one programme at a time**, so a club with all
five built can retrain five players — one per class — not five in one class.

**His overall is held throughout.** The reshape ends by re-settling the attribute
line at the overall he already had, so whatever the redistribution did to his
rating is put back. Retraining changes *what kind* of footballer he is, never how
good he is.

### 20.2 The rules

A target must be a role he could actually hold — retraining a centre-back into a
Sniper is advice nobody could act on — and the relevant class's center must be
complete. The screen greys out what you can't do and tells you why, from the same
single ruling the engine enforces.

Two consequences are deliberate:

- **Completing a programme sets his training plan** to the target's. Otherwise
  the next summer's growth steers him straight back and the whole feature quietly
  reverses itself.
- **Cancelling keeps the reshaping already done.** It is real training the player
  did, and undoing it would let a manager probe the system for free.

---

## 21. Rivalries

Rivalries are **earned in the save**, never authored. Nothing in worldgen or in
any database seeds one: two clubs become enemies because of football that
actually happened between them.

### 21.1 How one forms

Two triggers, both read off the record book:

- **A shared cup final.** One match, settled on the spot.
- **A sustained title race** — both clubs inside the division's **top three for
  three consecutive seasons**, in the *same* division.

Three seasons is doing real work. In a division where the same six clubs share
the top places, two seasons is a coincidence and three is a pattern. You have to
have been up there for every one of them too, because a rivalry is mutual.

*Measured across four played worlds: a save carries 1–3 rivalries and up to 61
derbies, and in practice every one formed on the cup final — no world produced
three consecutive top-three finishes. The trigger is right; the pattern is rarer
than it sounds.*

### 21.2 What a derby is worth

**A rivalry multiplies an investment; it does not pay out.** A derby triples what
your **Performance Bonus** and **Stadium Bonus** tracks (§12) pay for that
fixture, and touches nothing else in the books. So it rewards a manager who
bought those tracks, and a club that bought neither earns nothing extra from
hating anybody. Flat derby cash would be a windfall; this is a return on a
decision you made.

Derbies also bring **one-off sponsorship offers** — priced off the club's own
minor-deal rate, so a derby is worth proportionally the same to a fourth-tier
club as to a giant. They are tabled a week ahead, take the open slots before the
routine market does, are exempt from the ordinary live-offer cap, and **expire
with the fixture**. A derby offer that outlived the derby would just be an
ordinary deal at a better rate.

AI clubs never earn derby money. This is a manager's mechanic.

### 21.3 Dormancy

A rivalry whose fixture stops happening — a club relegated three divisions — goes
**dormant** after three seasons and confers nothing. But it is never deleted: a
promoted club **resumes the rivalry it already had**, head-to-head record intact,
rather than starting a fresh three-season count from zero.

---

## 22. The Global Club Network

The end-game. Having built something enormous, you stop being a manager with a club
and become the head of a **network of clubs you own**.

### 22.1 Unlocking

You deposit money from your club's budget into a **GCN Funds** pool over time. When
it reaches the threshold — **£5 billion** — you may name your network and unlock
it. **The pool is spent** to unlock: it is the entry cost, not seed capital.

Until then, the GCN screen doesn't exist.

### 22.2 The treasury

Once unlocked, GCN runs its own purse, entirely separate from any club's budget.
It is funded by explicit deposits from your main club (and withdrawals back), plus
its own commercial income. It pays for everything the network does.

### 22.3 Owning clubs

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

### 22.4 An owned club keeps its own books

A club in a sim league still has a real squad on real wages, so it keeps a real
balance sheet: income by tier and position, wages out, the lot. Before v1.88 the
Finance panel on an owned club read **£0 in / £0 out**, which left "fund this
club" with no shortfall to fund against.

Two rules turned out to be load-bearing, and both were wrong in the first cut:

- **Income scales with club reputation.** Every sim league is a top flight, so
  the tier-keyed income lines are nearly flat across them (1.26× from the weakest
  to the strongest) while wage bills run **5:1**. Unscaled, 38% of owned clubs
  ran at a loss — and it was the *giants* losing money while the minnows
  profited, which is backwards for an empire.
- **A ring-fenced club gets no books at all.** It still draws the ordinary
  central AI subsidy, and that subsidy *is* its abstracted week. Paying both
  would be double income.

### 22.5 Ring-fencing

A club the network owns **in your own country** is held at arm's length. You get
the ownership — the standing, the balance sheet, the achievement — without the
levers that would let you use it on your own league.

**The rule is about the manager's squad, not about the border.** The original cut
banned every lever on a domestic holding, which also stopped two domestic
holdings from dealing with *each other* — a move that confers nothing on the team
you actually pick. The invariants are narrower now:

- **Money never crosses the fence** — no funding, no standing orders, no network
  commercial income.
- **Players never move between your own squad and a ring-fenced club**, in either
  direction, and a ring-fenced club may not import across a border.
- **Two ring-fenced clubs in one country may trade with each other**, priced at
  full market value so a free intra-pyramid transfer stays impossible.
- **Selling to the open market is allowed** — the player leaves the network
  entirely, so it strengthens nobody.
- **Feeder loans stay banned**, because they move *your* players.

That is what stops owning a domestic club from becoming a way to fix your own
league: you can't prop up a rival, and you can't asset-strip one.

### 22.6 What the network does

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

### 22.7 The boardroom — Global Executives

Three seats, each driving exactly **one** network-wide effect:

| Seat | What it does |
|---|---|
| **Football** | Lifts match performance and development at every owned club |
| **Commerce** | Lifts the network's commercial income |
| **Scouting** | Cuts scouting costs and speeds scouting up |

**An executive is a seat, not a hire.** This is deliberately *not* the club's
backroom repeated at network scale. A club's staff system is a staffing puzzle —
many people, ten buildings, an assignment grid, three badge slots each — and
playing that same game again with bigger numbers would add work rather than
depth. Here it is one appointment, one salary, one blanket effect, and the only
question is what pedigree the treasury can carry.

What it *does* share is the scaling — a base, plus per star, plus per badge tier
— because that is the same idea at a different altitude, and one vocabulary beats
a bespoke curve.

**The split between stars and badges is the design.** A brand-new five-star
appointment reaches only about half of what a seat can be worth; the rest is
earned solely by **keeping someone**. Without that split, re-hiring whoever tops
the shortlist each month would strictly dominate loyalty and a decade-long
appointment would be a rounding error. The badge ladder here is its own —
1/2/4/6/9/13 seasons — because an executive holds one seat rather than competing
for three badge slots, so the tiers have to be reachable inside a single career.
As with club staff, the top tiers are only ever earned at your own network.

Three rules matter:

- **A vacant seat is worth exactly nothing** — every multiplier returns 1. These
  run on every match and every development pass in the world, so a save that
  never unlocked the network computes precisely what it always did.
- **The Football seat never reaches your own club.** You manage that one yourself,
  with its own facilities and its own staff. Letting the boardroom multiply it too
  would make the network the best available way to improve the team you actually
  pick.
- **It moves both kinds of match** — real fixtures and sim resolution alike — or a
  seat's worth would depend on which kind of league a holding happened to sit in,
  which is nothing you chose.

### 22.8 International Scouting Hubs

The end-game counterpart to club scouting. Where a scout is a **trip** — hire,
send, pay the travel, get him back — a hub is a **permanent presence** that files
reports forever, at a standard no hireable scout reaches.

Hubs are built in the same **26 sub-regions** the scouting brief already uses, so
a region added to the scouting tree becomes a hub site by construction and a brief
and a hub can never disagree about where a place is. A hub costs £180M to build,
upgrades through five levels, carries weekly upkeep, and is **cheaper to build in
a region where the network already owns a club**.

Its level buys judgement (well past anything hireable), report cadence, batch
size, how many prospects it can hold, and how fast they grow while there.

Four rules, each because the obvious version collapses the feature back into a
bigger academy:

- **A signed hub prospect belongs to the network and to no club.** That is what
  makes the placement decision the thing the feature is *about*: keep him
  developing at the hub, promote him into your own academy, or place him at an
  owned club in his region.
- **Placement is regional.** An owned club in one of the hub's own countries, and
  nothing else. A hub that could feed the whole empire would be a talent
  teleporter that makes owning clubs anywhere else pointless; a hub that feeds its
  own region is a reason to own clubs *there* — the one rule tying the two halves
  of the network together. Promotion into your own academy is always allowed: it
  costs the region its player, and it is the reward for having built the thing.
- **Loans out of a hub don't exist.**
- **Closing a hub refunds nothing** and releases everyone it held. That is the
  honest shape for a building you put up abroad, and it is what makes the upkeep
  decision real. Its prospects are *released*, not deleted — the academy's
  quick-sell deletion exists so your castoffs can't stock your domestic rivals,
  and a 15-year-old let go in Ghana is not that.

### 22.9 Operations upgrades

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

## 23. Awards, records and legacy

### 23.1 The awards ceremony

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

### 23.2 The record book

A per-season museum. Each season stores champions of every league, the cup winner,
all three European winners, every final table, top scorers, the full accolade set,
your own finish, the season's notable transfers, and every promotion and relegation
grouped by division.

It also tracks **your club's biggest ever win** — never an AI-vs-AI scoreline —
with goals-for breaking ties between equal margins.

The season review modal at the rollover presents all of it.

### 23.3 The roll of honour

The record book is stored one season at a time, which answers "what happened in
2029/30" and not "who has won this league, and how often" — a question that meant
opening twenty season reviews and counting.

Club → History & Records therefore reads the same stored seasons a second way,
grouped by **competition** instead of by year:

- **Trophy Cabinet** — every trophy your own club has lifted, counted per
  competition and listed most recent first.
- **Roll of Honour** — one competition at a time: its **all-time title table**
  (who has won it most, ties broken by the most recent win) alongside its
  **season-by-season champions**. Your own divisions come first, then your cup,
  then the European cups, then the rest of the world.

Nothing new is stored and no migration is needed — a save that has already played
ten seasons contains its own honours list, it simply had no reader. Because both
views render the same rows, the roll of honour and the season review can never
disagree.

### 23.4 The Hall of Fame

A hand-curated honour roll. From any player's profile you can enshrine him:
living, retired, sold, or still at the club. It changes nothing in the world — it
just collects the legends you want remembered.

### 23.5 Manager accolades

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

## 24. Achievements

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

## 25. Portability: saves, files and presets

Four different things can leave a save, and they are deliberately four different
things rather than one export button.

### 25.1 A player file — a character

Export one player to a file and sign him into another save. "Alternate
universes": the striker you developed in one legacy turns up in the next.

Three rules, each because the obvious version is wrong:

- **Nothing world-bound travels.** Club, kit number, contract, loan — these point
  at teams and seasons the destination has never heard of.
- **An import always gets a new identity**, so re-importing a file, or importing
  it into the world it came from, can never overwrite a real player.
- **His history travels by name, not by reference.** The record already stores
  club *names* beside the ids, so his career renders correctly in a world where
  those clubs don't exist.

Importing is deliberately **not a transfer**: no fee, no wage negotiation, no
consent roll. A continuity tool that can fail for reasons you cannot act on
defeats its own purpose. It does respect the squad cap and the same-season resale
lock, so it can't be used to dodge either.

### 25.2 A squad file — a design

Export your whole squad as a club: an authored roster the Database Editor imports
like any other custom club, which any new legacy can then be started with.

It deliberately **throws career history away**, which is the exact opposite of the
player file — and correctly so. A career belongs to a world, and this club is
going to exist in a different one from its very first fixture. A player file
preserves history precisely because a character *is* his record; a squad file is
a design.

### 25.3 A world preset — a backdrop

A preset saves the **setup** of a world: which countries are in it, how deep each
pyramid runs, and the European qualification design. Those are the two most
laborious parts of starting a save and the two least likely to change between
them.

It deliberately omits the playable country, the club, the starting tier and the
takeover. Those are the choices a new legacy exists to make — a preset that
picked your club for you would just be a saved game.

### 25.4 Cloud saves

Saves sync to the cloud automatically, compressed, and only when something has
actually changed. Local storage is written on every autosave regardless, and the
cloud copy is forced current whenever you leave the page — so the copy is up to
date at every moment you could realistically pick up another device.

*(A 9-season save is ~9 MB raw and compresses about 10×, which took metered
transfer from roughly 1.09 GB/hr of play to 0.027 GB/hr — a 41× cut, round trip
byte-identical.)*

---

## 26. The screens

### Home
The dashboard. Next fixture, league position, the Continue button, recent results,
the inbox and the news ticker. The screen you spend the most time on because it's
where Continue lives.

**The inbox is folders, not a list with headings** — Transfers, Matches & Awards,
Academy & Scouting, Club & News, each collapsed by default. Two properties make it
an organised mailbox: every kind of mail is filed in exactly one folder (mail
nobody filed would never appear on screen at all), and **every folder is shown
whether or not it has anything in it**, so the shape of the screen doesn't shift
under the cursor as post arrives. Grouping is by type rather than by date, because
the type is already what you are scanning for. The cap is per folder rather than
across the whole inbox — otherwise a busy transfer window pushes every academy
report out of view. Mark-read and clear are per folder too: clearing fifty read
scout reports must not also delete a live bid.

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
Five tabs:
- **Finances** — the itemised weekly breakdown, every line in and out.
- **Income** — the seven upgrade tracks, each with its full ladder priced.
- **Investments** — sponsorship offers, signed deals, and the Marketability
  breakdown with all six factors shown.
- **History** — the record book season by season, plus the Trophy Cabinet and the
  Roll of Honour.
- **Save** — export, import, backups, and the player/squad/world-preset files of
  §25.

### Facilities
Two tabs:
- **Facilities** — the ten facilities, their levels, their channels with the
  arithmetic shown, and the slot grid where staff are assigned in place.
- **Staff** — everyone you employ, their stars, their badges and where they are
  posted, alongside the shortlist you hire from.

### Development
Three tabs:
- **Plans** — training plan per player, with auto-assign and the plan's primary
  and secondary attributes laid out.
- **Growth** — the season-by-season development history of every player, and where
  their attributes have actually moved.
- **Archetype** — the retraining programmes of §20: pick a target role, see what
  your centers can run, and track a programme to completion.

### Academy
Six tabs:
- **Squad** — the prospect roster, tiers, focus flags.
- **Development** — youth growth.
- **Growth** — prospect progression history.
- **Loaned** — who's out, where, and how they're doing.
- **U21** — registration, the matchday squad, the table, results, and rival sides
  (whose prospects you can buy).
- **Scouting** — your scouts, their assignments, briefs and filters, and the report
  board.

*(The old Upgrades tab is gone. Academy squad size, focus slots and everything
scouting are facilities now — §19.)*

### Player Profile
The full picture: all 35 attributes grouped, the six card faces, derived archetype
with its artwork and class, traits with their concrete effects, contract, value,
full career history with per-season rows, every transfer, accolades, academy
history, and the Hall of Fame toggle.

### Achievements
Every achievement grouped by category — earned ones with their season, locked ones
with progress — alongside the full manager accolades ledger and the Hall of Fame.

### Global Club Network
Six tabs, and only visible once unlocked. **Each tab answers exactly one
question**, and an action lives on the tab that owns its subject:
- **Headquarters** — how is the network doing? Read-only; no actions at all.
- **Clubs** — the holdings, and founding, buying and selling them.
- **Players** — every player the network owns, filterable.
- **Intl Scouting Hub** — the region map, building and upgrading hubs, the report
  pipeline and where a signed prospect goes.
- **Treasury** — all money: deposits, withdrawals, funding, standing orders.
- **Operations** — the boardroom seats and the three upgrade tracks.

The predecessor had four tabs, with Headquarters serving as both the dashboard
*and* the launcher for all seven network actions — so "how is my empire doing"
and "buy a club" shared one page and neither had room.

---

## 27. Presentation

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

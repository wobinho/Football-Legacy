// Player Development (§5): aging, growth, decline, retirement, fitness.
// One clean function rules the curve:
//   newOverall = f(age, potential, minutesPlayed, archetype, longevity, recentPerformance)

import type { DevLogEntry, GameState, PlayerBio } from "./types";
import type { TuningConfig } from "./config/tuning";
import { ARCHETYPE_BY_PLAN, deriveArchetype, profileForAttrs } from "./config/archetype";
import {
  ATTR_FAMILIES,
  ATTR_FAMILY_ORDER,
  ATTR_KEYS,
  GK_ATTR_FAMILIES,
  type AttrFamily,
  type AttrKey,
} from "./config/attributes";
import { ATTR_WEIGHTS, fitAttrsToOverall } from "./config/positions";
import { TRAIT_MAP } from "./config/traits";
import { resolveTrainingPlan, type TrainingPlanDef } from "./config/training";
import { randRange, type RNG } from "./rng";
import { valueWithYouthPr } from "./economy";
import { activePlayers, isFreeAgent } from "./archive";

const FULL_SEASON_MINUTES = 3000; // ~33 full matches

/** How much harder decline bites each attribute (v41). Athleticism goes first
 * and technique lasts: a 35-year-old loses a yard of pace long before he loses
 * his first touch, and his reading of the game may still be improving. A
 * multiplier on the decline share — >1 bleeds faster, <1 is more durable.
 * Attributes not listed decline at the base rate. Pure data. */
const DECLINE_BIAS: Partial<Record<AttrKey, number>> = {
  // Athletic — the first to go.
  acceleration: 1.5,
  sprintSpeed: 1.5,
  agility: 1.35,
  stamina: 1.3,
  jumping: 1.25,
  balance: 1.15,
  // Physical strength holds up far better than speed.
  strength: 0.8,
  // Technique barely erodes.
  shortPassing: 0.55,
  longPassing: 0.55,
  ballControl: 0.6,
  curve: 0.5,
  fkAccuracy: 0.5,
  penalties: 0.5,
  crossing: 0.7,
  finishing: 0.7,
  // Reading of the game: experience genuinely offsets physical decline.
  vision: 0.4,
  composure: 0.35,
  positioning: 0.45,
  markingAwareness: 0.5,
  interceptions: 0.5,
  reactions: 0.9,
  // Goalkeepers age far more gently than outfielders.
  handling: 0.5,
  diving: 0.7,
  reflexes: 0.7,
  gkPositioning: 0.4,
  kicking: 0.55,
  gkSpeed: 1.2,
};

/** Squad-wide youth-growth bonus from Mentor-trait players (v6). Summed over the
 * club's senior + academy players, capped so a dressing room of mentors can't
 * warp the curve. Returns a fraction to add to youngsters' growth (0 = none). */
export function mentorGrowthBonus(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  const ids = [...team.playerIds, ...(team.academyPlayerIds ?? [])];
  let sum = 0;
  for (const id of ids) {
    const p = state.players[id];
    if (!p || p.retired) continue;
    for (const t of p.traits) sum += TRAIT_MAP[t]?.effects.mentorBonus ?? 0;
  }
  return Math.min(0.4, sum);
}

export interface DevelopmentOutcome {
  delta: number;
  potentialDelta: number;
  retired: boolean;
  phase: "growth" | "prime" | "decline";
}

/** Fast-track band (balance): raw players still under cfg.growthCatchupBelow grow
 * faster — the boost is largest at the quality floor (cfg.minOverall) and fades
 * linearly to 1× as overall reaches the band top. So a low-50s prospect climbs
 * briskly out of the "hard to develop" zone instead of languishing. */
export function catchupMult(overall: number, cfg: TuningConfig): number {
  if (overall >= cfg.growthCatchupBelow) return 1;
  const span = Math.max(1, cfg.growthCatchupBelow - cfg.minOverall);
  const t = Math.max(0, Math.min(1, (cfg.growthCatchupBelow - overall) / span));
  return 1 + (cfg.growthCatchupMult - 1) * t;
}

/**
 * Elite-resistance multiplier (v1.66): growth slows the better a player already
 * is. The mirror of `catchupMult` at the top of the scale.
 *
 * Every other lever in the growth formula — minutes, dev coach, training
 * facility, training plan, the academy loan/U21/focus bonuses — is a plain
 * multiplier that never asks how good the player already is. Stacked, they
 * moved an 88-rated youngster as fast as a 60-rated one, and the only brake
 * (headroom) was neutralised by a `youthPotentialFloor` that handed nearly every
 * young player a near-cap ceiling. That is how a 75 became a 93 in two seasons.
 *
 * The curve is flat (1×) up to `growthEliteAbove`, then decays exponentially to
 * `growthEliteMultFloor` at `growthEliteCeiling`. `growthEliteCurve` > 1 pushes
 * the damping toward the very top, so an ordinary pro improving through the 70s
 * is barely affected while the last few points before 90 have to be earned over
 * several seasons.
 *
 * Applied to the youth AND prime branches, and to both in-season ticks, so there
 * is no path around it.
 *
 * @param relief (v1.81) The High Performance Center's relief fraction, 0..1 —
 * the ONE thing in the game that weakens this brake. It scales the PENALTY, not
 * the multiplier: `m' = 1 - (1 - m) × (1 - relief)`. Two consequences that make
 * it the end-game building rather than a second training centre: a player below
 * `growthEliteAbove` has no penalty, so relief does nothing for him; and the
 * relief is worth more the deeper into the curve he is, which is exactly where
 * every other lever has stopped mattering. See `eliteResistRelief` in
 * lib/facilities.ts.
 */
export function eliteResistMult(
  overall: number,
  cfg: TuningConfig,
  relief = 0,
  /** The player's ceiling (v1.92). Supplied, resistance is measured against how
   * far he still has to GO rather than against his rating alone — see below.
   * Omitted, the curve behaves exactly as it always did, which is what callers
   * describing a rating rather than a player (the projection UI) still want. */
  potential?: number
): number {
  if (overall <= cfg.growthEliteAbove) return 1;
  const span = Math.max(1, cfg.growthEliteCeiling - cfg.growthEliteAbove);
  const t = Math.min(1, (overall - cfg.growthEliteAbove) / span);
  const decay = Math.pow(t, cfg.growthEliteCurve);
  let m = Math.max(cfg.growthEliteMultFloor, 1 - (1 - cfg.growthEliteMultFloor) * decay);

  // Headroom relief (v1.92) — the fix for "the world's stars are never replaced".
  //
  // The curve above is keyed on current overall ALONE, so it cannot tell a
  // 70-rated future superstar from a 70-rated journeyman standing at his
  // ceiling, and damps both identically. Worked through, that made an elite
  // successor arithmetically impossible: a regen born with 91 potential, playing
  // every minute of every season under ideal conditions, tops out at **76.9** by
  // `growthEndAge` — he cannot reach the level of the 90-rated player he was
  // created to replace. Measured in a real world at season 11: 170 new players
  // with a mean potential of 90.7, 164 of them signed to clubs, sitting at 60.5
  // overall at age 24+ with a 30-point gap they would never close. The original
  // world's stars exist only because worldgen creates them directly, so as they
  // retired the top of the game emptied and nothing could refill it — which is
  // the real "squads degrade over a long save", and it survived every fix to
  // intake, recruitment, ageing and selection because none of them touched it.
  //
  // Resistance now eases in proportion to REMAINING headroom: a player still far
  // from his ceiling keeps most of his growth rate, and the brake tightens as he
  // closes on it. The curve's purpose is preserved exactly — it exists to stop a
  // 19-year-old reaching 90, and it still does, because a player who has arrived
  // at his potential has no headroom left and gets no relief at all.
  if (potential !== undefined) {
    const headroom = Math.max(0, potential - overall);
    const share = Math.min(1, headroom / Math.max(1, cfg.growthHeadroomFullRelief));
    m = m + (1 - m) * share * cfg.growthHeadroomReliefMax;
  }

  // The floor is a floor on the UNRELIEVED curve; relief is allowed to lift a
  // player back off it, which is the whole purchase.
  return 1 - (1 - m) * (1 - Math.max(0, Math.min(1, relief)));
}

/**
 * Age → growth-rate multiplier (v17). Peaks at cfg.growthPeakAge and falls away
 * on both sides, so the late teens are the breakout window.
 *
 * This replaces a linear `1 + (growthEndAge - age) * 0.12`, which handed the
 * biggest multiplier to the YOUNGEST player and let a 12-year-old project +19
 * overall in a single season. Growth below the peak is now steeply damped: a
 * child improves, but slowly, and the explosive years arrive at 16–19.
 *
 * Note this shapes the RATE only — a genuine wonderkid still develops fast,
 * because their high potential leaves the headroom the rate is applied against.
 */
export function ageGrowthMult(age: number, cfg: TuningConfig): number {
  const gap = age - cfg.growthPeakAge;
  const falloff = gap < 0 ? -gap * cfg.growthYoungFalloffPerYear : gap * cfg.growthOldFalloffPerYear;
  return Math.max(cfg.growthAgeMultFloor, cfg.growthPeakMult - falloff);
}

/**
 * Room a PRIME (post-growth, pre-decline) player has left to improve (v1.51).
 *
 * `recalcPotential` floors a player's ceiling at his own current overall, and it
 * stops moving at all past `potentialRecalcAgeMax`. The practical effect was
 * that by the mid-twenties a player's potential had converged onto his rating,
 * leaving `newPotential - p.overall === 0` — and since the prime branch requires
 * headroom, nobody over `growthEndAge` could ever gain a point. That is the
 * "only 24-and-unders develop" bug.
 *
 * A prime player is therefore granted a small floor of headroom on top of his
 * declared potential, tapering to nothing as he approaches
 * `primeHeadroomCapOverall`. A 70-rated pro can still become a 78-rated one by
 * playing well for a few seasons; a 90-rated one is essentially finished. The
 * player's own potential still wins whenever it is the more generous of the two,
 * so genuine wonderkids are unaffected.
 */
export function primeHeadroom(overall: number, potential: number, cfg: TuningConfig): number {
  const declared = potential - overall;
  // The floor holds at full value up to `primeHeadroomFullBelow` and then tapers
  // linearly to nothing at the cap. Anchoring the taper to that narrow top band
  // (rather than the whole 50→92 range) is what keeps it meaningful: an ordinary
  // 75-rated pro carries the full floor and can improve for several seasons,
  // while the last stretch toward 92 tightens quickly.
  const full = cfg.primeHeadroomFullBelow;
  const cap = cfg.primeHeadroomCapOverall;
  const t = overall <= full ? 1 : Math.max(0, (cap - overall) / Math.max(1, cap - full));
  const floor = cfg.primeHeadroomFloor * t;
  return Math.max(0, Math.max(declared, floor));
}

/**
 * How much of a prime season's EARNED growth an age still gets (v2.1).
 *
 * The prime branch used to have no age term whatsoever — `primeGrowthPerSeasonMax
 * × perf × minutes × facilities × elite-resist` reads identically for a
 * 33-year-old and a 27-year-old — so a strong campaign was worth the same at
 * both ends of a decade. Measured (`npx tsx scripts/measure-veteran.ts`, ten
 * seasons), that left 24–33 as a flat plateau: +0.2 overall a season throughout,
 * a 33-year-old as likely to improve as a 26-year-old, and nothing turning
 * negative until 35. A career should be a curve.
 *
 * Full value at `growthEndAge`, tapering to zero at `primeGrowthTaperEndAge`.
 * The curve is squared so the early thirties keep a little more than a straight
 * line would give them — a 30-year-old having a great season should still edge
 * forward; a 33-year-old should be holding on, not improving.
 *
 * Returns 1 for any age at or below `growthEndAge` (the youth branch never calls
 * this) and for a config whose taper end sits at or below `growthEndAge`, which
 * is how the whole term is switched off.
 */
export function primeGrowthAgeMult(age: number, cfg: TuningConfig): number {
  const span = cfg.primeGrowthTaperEndAge - cfg.growthEndAge;
  if (span <= 0) return 1;
  const t = (age - cfg.growthEndAge) / span;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const remaining = 1 - t;
  return remaining * remaining;
}

/**
 * The age at which THIS player's automatic decline begins (v1.52).
 *
 * `cfg.declineOnsetAge` is the base (35); a durable player holds on a little
 * longer and a pace-reliant archetype turns a little earlier, but the swings are
 * deliberately small so nobody falls off in their early thirties. Before this
 * age a player is in his prime and moves on performance alone.
 *
 * Extracted because three call sites — the rollover, the weekly in-season tick
 * and the UI's phase chip — each recomputed it inline, and any drift between
 * them would show a player "Prime" on his profile while the engine declined him.
 */
export function declineOnsetFor(p: PlayerBio, cfg: TuningConfig): number {
  const arch = profileForAttrs(p.attrs, p.positions[0]);
  let longevityBonus = 0;
  for (const t of p.traits) longevityBonus += TRAIT_MAP[t]?.effects.longevityBonus ?? 0;
  const longevity = Math.min(1, p.longevity + longevityBonus);
  return (
    cfg.declineOnsetAge +
    (longevity - 0.5) * 2 * cfg.declineOnsetLongevitySwing -
    arch.paceReliance * cfg.declineOnsetPaceReliancePenalty
  );
}

/** Season performance normalised to -1..1 around the neutral pivot rating. */
function seasonPerf(p: PlayerBio, cfg: TuningConfig): number {
  const avgRating = p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : 6.5;
  return Math.max(-1, Math.min(1, (avgRating - cfg.potentialPerfPivot) / 1.2));
}

/**
 * Dynamic potential (§5): a young/rising player's hidden ceiling is recalculated
 * from how they actually performed. Skewed upward — a strong campaign with real
 * minutes unlocks headroom (the late bloomer); potential only slips on a poor
 * season, and never below the player's current overall. Frozen once a player is
 * past the recalc age so veterans don't sprout new ceilings.
 */
function recalcPotential(p: PlayerBio, cfg: TuningConfig, rng: RNG): number {
  if (p.age > cfg.potentialRecalcAgeMax) return p.potential;
  const perf = seasonPerf(p, cfg);
  const minutesFactor = Math.min(1, p.stats.minutes / FULL_SEASON_MINUTES);
  // performance barely counts if a player hardly featured
  const weight = Math.max(0, (minutesFactor - cfg.potentialMinutesFloor) / (1 - cfg.potentialMinutesFloor));
  let move: number;
  if (perf >= 0) {
    move = perf * weight * cfg.potentialUpMax * randRange(rng, 0.6, 1.0);
  } else {
    // downward is rarer and gentler: needs a genuinely poor season with minutes
    move = perf * weight * cfg.potentialDownMax * randRange(rng, 0.4, 0.8);
  }
  const next = p.potential + move;
  return Math.round(Math.max(p.overall, Math.min(cfg.potentialAbsoluteCap, next)));
}

/**
 * @param facilityMult The club's facilities multiplier (1 = none). v1.79: this
 * replaces the old `devCoachStars` + `trainingLevel` pair. Growth used to be
 * accelerated by two separate levers — a coach's stars at 8% each and a
 * training-facility level — which meant the same question ("how fast does my
 * squad improve?") had two answers in two systems. There is now one: the Elite
 * Training Center's effect, staff included, computed by `facilityEffect`.
 *
 * @param eliteRelief The High Performance Center's relief fraction (0 = none).
 * The second facility lever, and deliberately a different KIND of one: it does
 * not multiply growth, it weakens `eliteResistMult`. See that function.
 */
export function developPlayer(
  p: PlayerBio,
  cfg: TuningConfig,
  rng: RNG,
  facilityMult = 1,
  extraGrowthMult = 1, // e.g. focus-prospect attention (§18)
  planGrowthMult = 1, // training-plan growth-rate nudge (§5 v8)
  eliteRelief = 0 // High Performance Center (v1.81)
): DevelopmentOutcome {
  const arch = profileForAttrs(p.attrs, p.positions[0]);
  const minutesFactor = Math.min(1, p.stats.minutes / FULL_SEASON_MINUTES);
  const avgRating = p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : 6.5;
  const perf = Math.max(-1, Math.min(1, (avgRating - 6.7) / 1.2)); // -1..1

  let longevityBonus = 0;
  for (const t of p.traits) longevityBonus += TRAIT_MAP[t]?.effects.longevityBonus ?? 0;
  const longevity = Math.min(1, p.longevity + longevityBonus);

  const declineOnset = declineOnsetFor(p, cfg);

  // Recalculate the hidden ceiling BEFORE this season's growth is applied so a
  // breakout season can immediately widen the room to grow into.
  const newPotential = recalcPotential(p, cfg, rng);
  const potentialDelta = newPotential - p.potential;

  let delta = 0;
  let phase: DevelopmentOutcome["phase"];

  if (p.age <= cfg.growthEndAge) {
    phase = "growth";
    // Growth: accelerated by minutes and the club's facilities; capped by headroom
    const headroom = newPotential - p.overall;
    const ageBoost = ageGrowthMult(p.age, cfg);
    const facility = facilityMult;
    const catchup = catchupMult(p.overall, cfg);
    // v1.66: the whole multiplier stack is damped by how good he already is.
    // v1.81: unless the club has built the HPC, which cuts that damping.
    const elite = eliteResistMult(p.overall, cfg, eliteRelief, newPotential);
    const base =
      cfg.growthPerSeasonMax *
      (0.35 + 0.65 * minutesFactor) *
      facility *
      extraGrowthMult *
      planGrowthMult *
      catchup *
      elite;
    // `perf` is damped too — it used to be a flat +1 added OUTSIDE the stack,
    // which handed a well-rated 90 a free point a season no matter what.
    delta = Math.min(headroom, base * ageBoost * randRange(rng, 0.6, 1.1) * 0.55 + perf * elite);
    delta = Math.max(0, delta);
  } else if (p.age < declineOnset) {
    phase = "prime";
    // Prime (v1.44, reworked v1.52): a player past the youth window and short of
    // decline onset moves on MERIT. He is not ageing yet, so nothing here is
    // automatic — a strong campaign climbs, an ordinary one holds, and only a
    // genuinely poor season with real minutes costs him anything.
    //
    // This branch now covers the whole 27–34 window (decline having moved to 35),
    // which is why the losing side of it had to change: the old formula applied
    // `primePerf * 0.8 + randRange(-0.5, 0.5)` to every below-pivot season, so a
    // squad player who rated 6.4 shed overall every summer from his mid-twenties
    // on. That read as "players start declining at 30" even though the decline
    // phase hadn't been reached — an ordinary prime season now costs nothing.
    const primePerf = (avgRating - cfg.primeGrowthPerfPivot) / 1.2; // >0 when he outperformed
    // v1.51: headroom comes from primeHeadroom, not the raw potential gap — a
    // prime player's declared potential has usually collapsed onto his overall,
    // which used to make this whole branch a no-op.
    const headroom = primeHeadroom(p.overall, newPotential, cfg);
    // v2.1: how much of a prime season's growth this AGE still earns, and what an
    // ordinary late-prime season costs. Both are computed here because the earned
    // branch below needs both — a good season used to dodge ageing entirely, so a
    // 33-year-old who rated well was untouched by the drift that was supposed to
    // be renewing the squad around him.
    const ageMult = primeGrowthAgeMult(p.age, cfg);
    const late = p.age - cfg.latePrimeAge;
    const drift =
      late > 0
        ? cfg.latePrimeDriftMax * Math.min(1, late / Math.max(1, declineOnset - cfg.latePrimeAge))
        : 0;
    if (primePerf > 0 && headroom > 0) {
      const earned =
        cfg.primeGrowthPerSeasonMax *
        Math.min(1, primePerf) *
        (0.4 + 0.6 * minutesFactor) *
        randRange(rng, 0.7, 1.1) *
        // v2.1: the age term the branch never had. Full at growthEndAge, gone by
        // `primeGrowthTaperEndAge`, so improvement fades out as decline nears
        // instead of stopping at a cliff.
        ageMult *
        // A well-equipped club develops its established pros too — the same
        // lever that accelerates youth applies here at its full weight.
        facilityMult *
        extraGrowthMult *
        planGrowthMult *
        // v1.66: same top-end damping the youth branch gets, so a 27-year-old
        // 88 can't sidestep the curve by having aged out of the growth phase.
        // This is the branch the HPC exists for — an elite player is usually
        // past growthEndAge, so the prime branch is where his last points live.
        eliteResistMult(p.overall, cfg, eliteRelief, newPotential);
      // v2.1: ageing is charged even on a good season. Previously the drift lived
      // only in the ordinary-season branch below, so a 33-year-old who rated well
      // was exempt from it entirely — which is the same "nobody ever gets worse"
      // hole v1.92 closed for the ordinary case, still open for the good one. He
      // can still finish net positive; a strong campaign now has to outrun his
      // age rather than sidestep it.
      delta = Math.min(headroom, earned) - drift * randRange(rng, 0.6, 1.1);
    } else if (primePerf < -cfg.primeDeclineTolerance) {
      // A genuinely poor season — well below the pivot, not merely average — and
      // only if he actually played enough for it to mean anything. Bounded by
      // `primeBadSeasonMaxLoss` so a bad year is a setback, never a collapse.
      const severity = Math.min(1, (-primePerf - cfg.primeDeclineTolerance) / 1.0);
      delta = -cfg.primeBadSeasonMaxLoss * severity * minutesFactor * randRange(rng, 0.6, 1.0);
    } else {
      // An ordinary season: he holds his level — until the late prime (v1.92).
      //
      // v1.52 made an ordinary prime season cost exactly nothing, to fix
      // "players start declining at 30". That was right for a 28-year-old and
      // wrong for a 33-year-old: it meant a player held his PEAK rating from 27
      // until decline onset at 35, then retired at 36–39. A top player was
      // therefore at full strength for a decade, and no prospect could ever
      // displace him.
      //
      // That is the deepest cause of long-save squad decay, and it hid behind
      // every other: with intake and youth recruitment both fixed, the top
      // flight's XI still aged 25.3 → 33.4 over thirteen seasons while its bench
      // fell 75.3 → 69.7. The young players existed, were signed, and were good
      // — they simply had nobody to replace, because nobody ever got worse.
      //
      // The drift starts at `lateP­rimeAge` and ramps to `latePrimeDriftMax` by
      // decline onset, so it joins smoothly onto the decline branch below rather
      // than arriving as a cliff. A 28-year-old is still untouched, which is the
      // whole of what v1.52 was protecting.
      // v2.1: `drift` is computed once above and shared with the earned branch,
      // so the two can never disagree about what a year of age costs.
      delta = drift > 0 ? -drift * randRange(rng, 0.6, 1.1) : 0;
    }
  } else {
    phase = "decline";
    // Decline: harder for pace-reliant archetypes, softened by performance/usage
    const yearsIn = p.age - declineOnset + 1;
    const paceMult = 1 + arch.paceReliance * 0.6;
    const perfSoften = 1 - Math.max(0, perf) * 0.35 - minutesFactor * 0.15;
    delta = -cfg.declinePerSeasonBase * yearsIn * 0.6 * paceMult * Math.max(0.3, perfSoften) * randRange(rng, 0.7, 1.2);
  }

  // Retirement (~36-39, longevity-modulated)
  let retired = false;
  const retirementAge = cfg.retirementAgeMin + longevity * (cfg.retirementAgeMax - cfg.retirementAgeMin);
  if (p.age >= retirementAge || p.age >= cfg.retirementAgeMax + 1) retired = true;
  if (p.age >= cfg.retirementAgeMin && p.overall + delta < 55) retired = rng() < 0.6 || retired;

  // A player nobody wants stops playing (v1.92).
  //
  // Age retirement alone is not enough to keep a world's veteran population
  // honest, because it only bites at 36+. Measured over 11 seasons with the
  // youth pyramid otherwise fixed, the 34+ population still grew 23 → 784: a
  // fading pro who had already been released simply sat in the free-agent list
  // for years, ageing, never playing, and never leaving. Real footballers in
  // that position retire — and the ones the market has passed over are exactly
  // the players a world should be shedding.
  //
  // Deliberately narrow, so it can never touch a player anyone is using:
  // he must be in DECLINE, have no club, and have gone a full
  // `retireUnattachedDays` without one. A rebuilding veteran between contracts
  // is unaffected, and no player on a club's books can ever be retired by it.
  // `isFreeAgent`, not `!clubId` (v1.95). A hub prospect has no club either, and
  // retiring him for inactivity while the network pays his wages and his upkeep
  // would be the system deleting a player the manager is actively investing in.
  // (He is 13–21 and so never in decline, but the guard belongs on the rule
  // rather than on an age coincidence.)
  if (
    !retired &&
    phase === "decline" &&
    isFreeAgent(p) &&
    (p.inactiveDays ?? 0) >= cfg.retireUnattachedDays
  ) {
    retired = rng() < cfg.retireUnattachedChance;
  }

  return { delta: Math.round(delta * 10) / 10, potentialDelta, retired, phase };
}

/**
 * Distribute an overall change across the 35 attributes, weighted by the
 * archetype's profile so signature attributes rise fastest and — on decline —
 * athleticism bleeds before technique (DECLINE_BIAS).
 *
 * The shares are shaped for realism, not arithmetic: they say where a season's
 * movement *goes*, and the totals need not add up to the overall delta on their
 * own. `fitAttrsToOverall` then settles the line onto the intended rating, so
 * the attributes stay the source of truth and the headline number stays exactly
 * what the development curve decided.
 */
function distributeAttrs(p: PlayerBio, attrDelta: number, targetOverall: number, plan?: TrainingPlanDef) {
  if (attrDelta === 0) return;
  // The emphasis a player's growth and decline follow is his own TRAINING PLAN's
  // (v1.77), not the archetype his current attributes read as. Deriving it from
  // the attributes would be a feedback loop: whatever he is strongest at would
  // grow fastest, entrenching an identity he can never train out of. The plan is
  // the stable seed — the one worldgen generated him from, or the one his
  // manager has since chosen — so identity remains something training moves.
  const profile = resolveTrainingPlan(p.trainingPlan, p.positions[0]).weights;
  const pos = p.positions[0];
  const target = Math.max(1, Math.min(99, Math.round(targetOverall)));
  const maxW = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;

  // How much each attribute matters at this position, 0..1 relative to the
  // position's most important one. Growth follows the role as well as the
  // archetype: a midfielder who improves gets better at midfield things, not at
  // whichever stat happens to be his archetype's signature in the abstract.
  const posW = ATTR_WEIGHTS[pos] ?? ATTR_WEIGHTS.CM;
  const maxPosW = Math.max(...ATTR_KEYS.map((k) => posW[k] ?? 0)) || 1;

  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxW; // 0..1, 1 = signature attribute
    let share: number;
    if (attrDelta > 0) {
      // Growth flows to attributes that are the archetype's signature and
      // relevant at the position — and, when the manager has chosen a training
      // plan, primarily to what that plan trains.
      //
      // v1.72: the plan is now the LEADING term rather than a nudge. Its three
      // tiers (100% / 60% / 20%) are applied as the share directly, so a
      // Ball-Playing Defender's growth genuinely lands on his passing instead of
      // being dragged back to tackling by his archetype. The archetype and
      // position factors are still present, but compressed to a modest tilt: they
      // decide the spread WITHIN a tier, not which tier wins.
      //
      // With no plan (every AI player, and the in-season tick) nothing changes —
      // planW is flat 1 and the old archetype-led spread is what remains.
      const planW = plan ? plan.weights[k] : 1;
      const relevance = 0.25 + 0.75 * Math.max(0, posW[k] ?? 0) / maxPosW;
      const natural = (0.5 + 0.9 * rel) * relevance;
      share = plan
        ? attrDelta * planW * (0.65 + 0.35 * natural)
        : attrDelta * (0.5 + 0.9 * rel) * (0.55 + 0.9 * planW) * relevance;
    } else {
      // Decline: athleticism first, technique and game-reading last, and
      // non-signature attributes ahead of signature ones.
      share = attrDelta * (0.7 + 0.6 * (1 - rel)) * (DECLINE_BIAS[k] ?? 1);
    }
    p.attrs[k] = Math.max(10, Math.min(99, Math.round(p.attrs[k] + share)));
  }

  // Settle onto the rating the curve intended.
  //
  // v1.85: the settle is biased by the training plan when there IS one. This is
  // the step that used to undo the plan's work — it moved roughly four times as
  // many attribute points as the shares above, distributed along the position's
  // overall weights, which meant it reliably fed the identity the player already
  // had. Growth was never the constraint on converting a player; this was. On
  // GROWTH the plan steers; on DECLINE it deliberately does not, because a
  // player losing points should lose them the way his position says, not have
  // his training plan quietly reshape him on the way down.
  p.attrs = fitAttrsToOverall(p.attrs, pos, target, plan && attrDelta > 0 ? profile : undefined);
}

/** Applied at season rollover to every player in the world (bulk, §4). */
export function applySeasonDevelopment(
  state: GameState,
  p: PlayerBio,
  cfg: TuningConfig,
  rng: RNG,
  facilityMult = 1,
  extraGrowthMult = 1,
  applyPlan = false, // training plans only steer the user's own squad (§5 v8)
  eliteRelief = 0 // High Performance Center (v1.81)
): DevelopmentOutcome {
  const fromOverall = p.overall;
  const fromPotential = p.potential;
  // A training plan biases where growth flows and nudges its rate — only for the
  // user's players (applyPlan). AI squads develop on the neutral curve.
  const plan = applyPlan ? resolveTrainingPlan(p.trainingPlan, p.positions[0]) : undefined;
  const out = developPlayer(p, cfg, rng, facilityMult, extraGrowthMult, plan?.growthMult ?? 1, eliteRelief);
  p.potential = fromPotential + out.potentialDelta;
  p.age += 1;
  const newOverall = Math.round(Math.max(35, Math.min(p.age <= cfg.growthEndAge ? p.potential : 99, p.overall + out.delta)));
  distributeAttrs(p, newOverall - p.overall, newOverall, plan);
  p.overall = newOverall;
  // A prime player who grows past his declared ceiling drags it up with him
  // (v1.51) — potential is a floor-of-expectation here, and leaving it below the
  // player's actual rating would render as a finished player who is still
  // improving. Never lowers a potential, and never applies during the youth
  // phase, where the ceiling is the whole point of the fog-of-war.
  if (p.age > cfg.growthEndAge && p.potential < p.overall) p.potential = p.overall;
  if (out.retired) {
    p.retired = true;
    p.clubId = null;
  }
  p.value = p.retired ? 0 : valueWithYouthPr(state, p, cfg);

  // Record the summer's outcome for the Development page (keep last ~10).
  if (!p.retired) {
    const entry: DevLogEntry = {
      season: state.season,
      age: p.age,
      fromOverall,
      toOverall: p.overall,
      fromPotential,
      toPotential: p.potential,
      phase: out.phase,
    };
    (p.devLog ??= []).push(entry);
    if (p.devLog.length > 10) p.devLog = p.devLog.slice(-10);
  }
  return out;
}

/**
 * How much overall a player has gained or lost SO FAR THIS SEASON (v19).
 *
 * The baseline is stamped at each rollover once that summer's development has
 * been applied, so this is strictly the current season's movement — a player who
 * was 90 at the start and is 91 now reads +1. Returns 0 when there's no baseline
 * (a player created mid-season, or a save from before the field existed), which
 * renders as no badge at all rather than a misleading number.
 */
export function seasonGrowth(p: PlayerBio): number {
  if (typeof p.seasonStartOverall !== "number") return 0;
  return p.overall - p.seasonStartOverall;
}

// ── In-season progression (v19) ───────────────────────────────────────────
// Development used to happen entirely at the summer rollover, so a player's
// rating was frozen for a whole season no matter how he played. That made a
// running "+1 this season" badge impossible — and, more importantly, meant a
// breakout campaign was invisible until it was over.
//
// Ratings now drift DURING the season as well, in small weekly increments. The
// summer rollover remains the main event (and is where potential is recalculated
// and attributes redistributed); this is the slow visible movement in between,
// deliberately gentle so a season's in-play drift is a point or three rather
// than a transformation.

/** How much of a full season's growth can be earned before the rollover. */
const IN_SEASON_GROWTH_SHARE = 0.45;

/**
 * One week's worth of in-season rating movement for a single player.
 *
 * Driven by minutes and match ratings: a young player playing well climbs, a
 * declining veteran playing badly slips. Bounded by the same headroom the
 * rollover respects, and by `IN_SEASON_GROWTH_SHARE` of the season's total, so
 * the summer still has room to do its work.
 *
 * Returns the (possibly zero) change applied.
 */
export function applyWeeklyProgress(
  p: PlayerBio,
  cfg: TuningConfig,
  rng: RNG,
  facilityMult = 1,
  eliteRelief = 0 // High Performance Center (v1.81)
): number {
  if (p.retired) return 0;
  // Needs match evidence — a player who hasn't featured doesn't move.
  if (p.stats.apps < 1) return 0;

  const baseline = p.seasonStartOverall ?? p.overall;
  const movedThisSeason = p.overall - baseline;
  const avgRating = p.stats.ratingSum / p.stats.apps;
  const perf = Math.max(-1, Math.min(1, (avgRating - cfg.potentialPerfPivot) / 1.2));

  if (p.age <= cfg.growthEndAge) {
    const headroom = p.potential - p.overall;
    if (headroom <= 0) return 0;
    // Cap in-season gains so the rollover remains the bigger moment.
    const seasonCap = Math.min(headroom, Math.max(1, cfg.growthPerSeasonMax * IN_SEASON_GROWTH_SHARE));
    if (movedThisSeason >= seasonCap) return 0;
    // Weekly rate: a season's worth of growth spread over ~38 weeks, scaled by
    // the same facility/age factors the rollover uses. Performance gates it —
    // playing badly stalls a prospect rather than advancing him.
    const facility = facilityMult;
    const rate =
      (cfg.growthPerSeasonMax * IN_SEASON_GROWTH_SHARE / 38) *
      ageGrowthMult(p.age, cfg) *
      catchupMult(p.overall, cfg) *
      eliteResistMult(p.overall, cfg, eliteRelief, p.potential) *
      facility *
      Math.max(0, 0.35 + perf);
    // Fractional rate accumulated as a probability of a whole point, so a rating
    // is always an integer and the badge never shows a fraction.
    if (rng() < rate) return 1;
    return 0;
  }

  const declineOnset = declineOnsetFor(p, cfg);

  // ── Prime, in-season (v1.51) ─────────────────────────────────────────────
  // This branch used to `return 0` for every player between growthEndAge and
  // decline onset, so a 25–31-year-old's rating was frozen for the whole season
  // no matter how well he played. Prime players now climb on the same weekly
  // tick youngsters use, against the prime headroom and their own (lower)
  // seasonal allowance — so a well-drilled squad visibly improves rather than
  // reading as a wall of players who stopped developing on their 25th birthday.
  //
  // The band runs to ~35 as of v1.52, so this now covers the whole of a career's
  // middle. It only ever moves a prime player UP: an ordinary season holds, and
  // the penalty for a genuinely poor one is settled once, at the rollover, so a
  // player isn't visibly bleeding overall week by week for a mid-table campaign.
  if (p.age < declineOnset) {
    const headroom = primeHeadroom(p.overall, p.potential, cfg);
    if (headroom <= 0) return 0;
    const seasonCap = Math.min(headroom, Math.max(1, cfg.primeGrowthPerSeasonMax * cfg.primeInSeasonShare));
    if (movedThisSeason >= seasonCap) return 0;
    // Prime growth is earned, not given: it only accrues while the player is
    // rating above the prime pivot, scaled by how far he has cleared it.
    const primePerf = (avgRating - cfg.primeGrowthPerfPivot) / 1.2;
    if (primePerf <= 0) return 0;
    const rate =
      ((cfg.primeGrowthPerSeasonMax * cfg.primeInSeasonShare) / 38) *
      Math.min(1, primePerf) *
      // v2.1: the same age taper the rollover applies. Without it the weekly tick
      // would go on handing a 33-year-old points the summer then had to take back
      // — two answers to one question, which is the v1.85 rounding lesson.
      primeGrowthAgeMult(p.age, cfg) *
      eliteResistMult(p.overall, cfg, eliteRelief, p.potential) *
      facilityMult;
    if (rng() < rate) return 1;
    return 0;
  }

  // Past decline onset: only genuine decline shows in-season, and only for
  // players who are performing poorly.
  const seasonFloor = -Math.max(1, cfg.declinePerSeasonBase * IN_SEASON_GROWTH_SHARE);
  if (movedThisSeason <= seasonFloor) return 0;
  const declineRate = (cfg.declinePerSeasonBase * IN_SEASON_GROWTH_SHARE / 38) * Math.max(0, 0.5 - perf);
  if (rng() < declineRate) return -1;
  return 0;
}

/**
 * Weekly in-season progression for the whole world. Applied on the same Monday
 * tick as the economy, so ratings visibly move across a season.
 *
 * The user's club gets its facilities multiplier; AI squads develop on the
 * neutral curve, exactly as they do at the rollover.
 */
export function weeklyProgressTick(
  state: GameState,
  cfg: TuningConfig,
  rng: RNG,
  facilityMultFor: (p: PlayerBio) => number = () => 1,
  eliteReliefFor: (p: PlayerBio) => number = () => 0
) {
  for (const p of activePlayers(state)) {
    const isUser = p.clubId === state.userTeamId;
    const delta = applyWeeklyProgress(
      p,
      cfg,
      rng,
      isUser ? facilityMultFor(p) : 1,
      isUser ? eliteReliefFor(p) : 0
    );
    if (!delta) continue;
    const next = Math.max(35, Math.min(p.age <= cfg.growthEndAge ? p.potential : 99, p.overall + delta));
    // Keep the attribute spread coherent with the headline number.
    distributeAttrs(p, delta, next);
    p.overall = next;
    p.value = valueWithYouthPr(state, p, cfg);
  }
}

// ── Development projections (Player Development page) ──────────────────────
// Read-only estimates for the UI. Deterministic (no RNG) — they answer "where is
// this player heading?" using the same growth shape the rollover applies.

export type DevPhase = "growth" | "prime" | "decline";

export function devPhase(p: PlayerBio, cfg: TuningConfig): DevPhase {
  if (p.age <= cfg.growthEndAge) return "growth";
  return p.age < declineOnsetFor(p, cfg) ? "prime" : "decline";
}

/**
 * One season's projected growth, in two forms (v1.85).
 *
 * `delta` is EXACT and usually fractional — a prime season at 88 overall earns
 * about 0.16 of a point. Anything that accumulates seasons (the conversion walk)
 * must use it, because rounding each step to a whole number is what previously
 * turned a slow-but-real climb into a permanent stall at age 27.
 *
 * `shown` is that same number rounded for DISPLAY, so a card can print "+1"
 * without every caller re-deciding how to round. It is deliberately not the
 * value any projection does arithmetic on.
 */
export interface SeasonGrowthEstimate {
  delta: number;
  shown: number;
}

/**
 * Estimated overall growth for the COMING SEASON only, at a given development
 * environment (the club's facilities multiplier) and training plan. Mirrors
 * developPlayer's growth branch at expected values (full-ish minutes). Bounded by
 * the player's hidden headroom, but never exposes the ceiling itself — the UI
 * only ever shows the one-season delta. Returns null once the player has aged out
 * of the growth phase.
 */
export function seasonGrowthEstimate(
  p: PlayerBio,
  cfg: TuningConfig,
  facilityMult = 1,
  plan?: TrainingPlanDef,
  eliteRelief = 0 // High Performance Center (v1.81)
): SeasonGrowthEstimate | null {
  // Prime players (v1.51): they develop now, so they get a projection too. Same
  // shape as developPlayer's prime branch at a good-but-not-exceptional season.
  if (p.age > cfg.growthEndAge) {
    if (devPhase(p, cfg) !== "prime") return null;
    const headroom = primeHeadroom(p.overall, p.potential, cfg);
    if (headroom <= 0) return { delta: 0, shown: 0 };
    // Assumes a solid campaign: rating ~0.3 over the pivot, near-full minutes.
    const earned =
      cfg.primeGrowthPerSeasonMax *
      Math.min(1, 0.3 / 1.2) *
      0.91 *
      // v2.1: the age taper, so the projection and the rollover agree.
      primeGrowthAgeMult(p.age, cfg) *
      facilityMult *
      (plan?.growthMult ?? 1) *
      eliteResistMult(p.overall, cfg, eliteRelief, p.potential);
    // NOT rounded (v1.85). A prime season earns well under a point at any decent
    // rating — 0.46 at 75 overall, 0.16 at 88 — so rounding here reported every
    // player at 75+ as growing exactly ZERO from the day he turned 27, forever.
    // The rollover has never rounded (it accumulates the fraction and settles the
    // attribute line on the running total), so this wasn't a conservative
    // estimate, it was a different answer than the simulation's. It is also what
    // made a settled squad read as "no growth left" on every training plan: the
    // conversion walk stalls the first time it sees a zero, and past 27 it always
    // saw one. Callers that want whole points round at the point of DISPLAY.
    const delta = Math.max(0, Math.min(headroom, earned));
    return { delta, shown: Math.round(delta) };
  }
  const headroom = p.potential - p.overall; // hidden — used to bound, never shown
  if (headroom <= 0) return { delta: 0, shown: 0 };
  const minutesFactor = 0.85;
  const ageBoost = ageGrowthMult(p.age, cfg);
  const planMult = plan?.growthMult ?? 1;
  const catchup = catchupMult(p.overall, cfg);
  const elite = eliteResistMult(p.overall, cfg, eliteRelief, p.potential);
  const base = cfg.growthPerSeasonMax * (0.35 + 0.65 * minutesFactor) * facilityMult * planMult * catchup * elite;
  // same 0.85 mid-point and 0.55 shape factor developPlayer applies
  const raw = base * ageBoost * 0.85 * 0.55;
  // Unrounded, for the same reason as the prime branch above: an elite youngster's
  // season is a fraction of a point, and rounding it to zero told the conversion
  // walk he had stopped developing when the rollover would have moved him.
  const delta = Math.max(0, Math.min(headroom, raw));
  return { delta, shown: Math.round(delta) };
}

/**
 * Distribute one season's expected overall growth across the 35 attributes,
 * mirroring the rollover's distributeAttrs logic (archetype signature attributes
 * first, nudged by the training plan). This-season only — never a lifetime
 * ceiling. Returns the per-attribute gain to add to the current value.
 */
export function seasonAttrFocus(
  p: PlayerBio,
  overallDelta: number,
  plan?: TrainingPlanDef
): Record<AttrKey, number> {
  const out = {} as Record<AttrKey, number>;
  for (const k of ATTR_KEYS) out[k] = 0;
  if (overallDelta <= 0) return out;
  const profile = resolveTrainingPlan(p.trainingPlan, p.positions[0]).weights;
  const maxW = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;
  // Same position-relevance factor distributeAttrs applies, so the projection
  // the UI shows matches the growth the rollover will actually deliver.
  const posW = ATTR_WEIGHTS[p.positions[0]] ?? ATTR_WEIGHTS.CM;
  const maxPosW = Math.max(...ATTR_KEYS.map((k) => posW[k] ?? 0)) || 1;
  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxW;
    const planW = plan ? plan.weights[k] : 1;
    const relevance = 0.25 + 0.75 * Math.max(0, posW[k] ?? 0) / maxPosW;
    // Mirrors distributeAttrs exactly (v1.72) — a projection that used a
    // different blend would promise growth the rollover then doesn't deliver.
    const natural = (0.5 + 0.9 * rel) * relevance;
    const share = plan
      ? overallDelta * planW * (0.65 + 0.35 * natural)
      : overallDelta * (0.5 + 0.9 * rel) * (0.55 + 0.9 * planW) * relevance;
    out[k] = Math.max(0, Math.round(share));
  }
  return out;
}

// ── When will the training plan actually change who he is? (v1.84) ─────────
//
// The loop this game runs is `Training Plan → Attributes → Archetype → Tactical
// effect`, and the third arrow is the slow one. A manager sets a Sniper plan on
// a Poacher and then has no way at all to know whether the identity is one
// season away or six — the plan simply sits there, doing something invisible.
// This answers that question, and it is a rules question rather than a
// presentation one, so it lives here beside the growth it reads.
//
// The method is the honest one: run the projection FORWARD. Each step applies
// one season's `seasonAttrFocus` to a copy of the attribute line, ages the
// player, re-derives the archetype the same way the UI does, and stops when it
// flips. No closed form, because there isn't one — `deriveArchetype` is a
// ranking with a specialism threshold, so "how far is he from crossing it" is
// only answerable by walking there.
//
// Two things this deliberately does NOT do:
//   · model potential rising or the plan changing. It answers "if nothing else
//     changes", which is the only question a projection can answer honestly.
//   · promise. Every consumer must present the result as an estimate, because
//     the real path runs through match ratings and minutes this can't know.

/**
 * How many seasons ahead the projection walks.
 *
 * Measured over every world-generated U21 carrying at least 8 points of
 * headroom — 470 players, 1600 convertible player×plan pairs: 17% convert, at
 * a median of 7 seasons, p75 11, max 15. Some flip in a single season.
 *
 * So the horizon has to be long. At 5 it would have called a dead end on three
 * quarters of the conversions that genuinely happen. Beyond 15 the player is
 * out of growth regardless, which the stall check below catches first and
 * reports far more usefully than a horizon cutoff can.
 */
const ARCHETYPE_ETA_MAX_SEASONS = 15;

/** Days in a game season — the calendar runs Jul 1 to Jun 30. Used only to turn
 * a season count into the days/weeks a manager actually plans in. */
const DAYS_PER_SEASON = 365;

export interface ArchetypeEta {
  /** The archetype the current plan is training toward. */
  targetId: string;
  /**
   * `arriving` — the identity flips, in `seasons`.
   * `noGrowth` — he runs out of growth first. The plan is steering him the
   *   right way; there simply isn't enough development left in him to finish
   *   the journey. A fact about the PLAYER, and the overwhelmingly common
   *   dead end: across a senior squad the median headroom at the moment of
   *   stalling is zero — those players are already at their potential.
   * `tooFar` — he keeps growing for the full horizon and still never gets
   *   there. A fact about the PLAN: this shape is too far from the player he
   *   is for training alone to close it. Genuinely rare.
   *
   * The split matters because the two demand opposite responses. `noGrowth`
   * says "this was never going to work on a 29-year-old, try it on a
   * prospect"; `tooFar` says "pick a plan closer to who he already is". A
   * single "never" collapsed the club's most common situation into the game's
   * rarest one and read as if the training system didn't work.
   */
  outcome: "arriving" | "noGrowth" | "tooFar";
  /** Whole seasons of growth before the identity flips, 1-based. Meaningless
   * when `outcome` is `never`. */
  seasons: number;
  /** Approximate days from now — the seasons above, less the part of the
   * current season already served. Never negative. */
  days: number;
  /** `days` in whole weeks, for the shorter phrasings. */
  weeks: number;
}

/**
 * How long until this player's derived archetype becomes the one his training
 * plan aims at.
 *
 * Returns null only when the question doesn't apply:
 *   · he is ALREADY that archetype — the caller's main case, and a screen must
 *     not print a countdown to where the player already stands;
 *   · his plan has no archetype, or his position yields none.
 *
 * A player who cannot get there is NOT null — he gets `noGrowth` or `tooFar`.
 * See the note on the field: those are the answers a manager most needs, and
 * they are different answers. The alternative is leaving a striker on a plan
 * that will never reshape him and never being told why.
 *
 * `seasonDay` is how far into the current season the save is (0 = opening day);
 * it only refines the day count, and omitting it simply quotes whole seasons.
 */
export function archetypeConversionEta(
  p: PlayerBio,
  cfg: TuningConfig,
  facilityMult = 1,
  eliteRelief = 0,
  seasonDay = 0
): ArchetypeEta | null {
  const pos = p.positions[0];
  const plan = resolveTrainingPlan(p.trainingPlan, pos);
  const target = ARCHETYPE_BY_PLAN[plan.id];
  if (!target) return null;
  if (deriveArchetype(p.attrs, pos)?.id === target.id) return null;

  const dead = (outcome: "noGrowth" | "tooFar"): ArchetypeEta => ({
    targetId: target.id,
    outcome,
    seasons: 0,
    days: 0,
    weeks: 0,
  });

  // Walk the projection forward on a copy. `sim` is a throwaway view of the
  // player — only the fields the growth path reads are updated, which is why it
  // is built by spread rather than by a deep clone: nothing here is written
  // back, and a partial copy that the type system still accepts is cheaper and
  // makes the read-only intent obvious.
  let attrs = { ...p.attrs };
  let overall = p.overall;
  let age = p.age;

  for (let season = 1; season <= ARCHETYPE_ETA_MAX_SEASONS; season++) {
    const sim: PlayerBio = { ...p, attrs, overall, age };
    const est = seasonGrowthEstimate(sim, cfg, facilityMult, plan, eliteRelief);
    // Growth has run out. It cannot come back — age only moves the estimate
    // down and the ceiling never rises — so this is a settled "no", not a
    // "not yet".
    if (!est || est.delta <= 0) return dead("noGrowth");

    const gains = seasonAttrFocus(sim, est.delta, plan);
    const next = { ...attrs };
    for (const k of ATTR_KEYS) next[k] = Math.min(99, next[k] + gains[k]);
    overall += est.delta;
    age += 1;
    // Mirror the rollover's settle, plan bias included (v1.85). Without this the
    // projection walked a line the simulation never actually produces — it
    // applied the focus gains raw and skipped the step that decides most of the
    // movement, so the ETA was answering a different question than the one the
    // manager's save would go on to resolve.
    attrs = fitAttrsToOverall(next, pos, Math.round(overall), plan.weights);

    if (deriveArchetype(attrs, pos)?.id === target.id) {
      // The flip lands at that season's rollover, so the wait is the remainder
      // of the current season plus a full one for each season after it.
      const days = Math.max(0, season * DAYS_PER_SEASON - seasonDay);
      return {
        targetId: target.id,
        outcome: "arriving",
        seasons: season,
        days,
        weeks: Math.round(days / 7),
      };
    }
  }

  // Still growing after the full horizon without ever flipping — so it isn't
  // growth that's missing, it's distance. The measured maximum for a real
  // conversion is 15 seasons, so anything past that is a shape training won't
  // reach rather than a countdown worth printing.
  return dead("tooFar");
}

/**
 * The same projection rolled up to the six card faces (v41), for the Development
 * and Academy summary views.
 *
 * Thirty-five progress bars is not a readable projection — those screens are
 * asking "where is this player's season going?", which the six faces answer at
 * the right altitude. The full per-attribute detail is on the player's profile.
 *
 * Both the current value and the gain are aggregated the same way (mean over the
 * family), so `now + gain` stays consistent with the face the UI shows.
 */
export function seasonFamilyFocus(
  p: PlayerBio,
  overallDelta: number,
  plan?: TrainingPlanDef
): Record<AttrFamily, { now: number; gain: number }> {
  const isGk = p.positions[0] === "GK";
  const gains = seasonAttrFocus(p, overallDelta, plan);
  const table = isGk ? GK_ATTR_FAMILIES : ATTR_FAMILIES;
  const out = {} as Record<AttrFamily, { now: number; gain: number }>;
  for (const f of ATTR_FAMILY_ORDER) {
    const keys = table[f];
    if (!keys.length) {
      out[f] = { now: 0, gain: 0 };
      continue;
    }
    const now = keys.reduce((s, k) => s + p.attrs[k], 0) / keys.length;
    const gain = keys.reduce((s, k) => s + gains[k], 0) / keys.length;
    out[f] = { now: Math.round(now), gain: Math.round(gain) };
  }
  return out;
}

// ── Fitness (§5: the one condition stat) ──────────────────────────────────

/** v1.79: the Medical Centre level that used to soften a veteran's extra drain
 * went with the old facilities system, so age tells the same on every club. */
export function applyMatchFatigue(p: PlayerBio, minutes: number, cfg: TuningConfig) {
  let drainMult = 1;
  for (const t of p.traits) drainMult *= TRAIT_MAP[t]?.effects.fitnessDrainMult ?? 1;
  if (p.age > 30) {
    drainMult *= 1 + (p.age - 30) * (cfg.fitnessDrainAgeFactor / 10);
  }
  const drain = (minutes / 90) * cfg.fitnessDrainPerMatch * drainMult;
  p.fitness = Math.max(5, Math.round(p.fitness - drain));
}

/**
 * Daily fitness recovery for the whole world.
 *
 * v1.79: the user's club used to recover faster via a Fitness Coach, a Physio
 * and a Medical Centre level — three levers from two systems, all removed in
 * the facilities rework. Recovery now runs at the same baseline for every club
 * until a facility is designed to own it, at which point this is where its
 * multiplier lands.
 *
 * v1.99: a KEEPER recovers `gkFitnessRecoveryMult` faster. He covers a fraction
 * of the ground an outfielder does, takes almost none of the contact, and is
 * the one player in the side expected to start every match of a congested week.
 * The rate is a tuning number and the position test reads `positions[0]`, the
 * same primary-position field every other position-dependent rule reads — the
 * drain side is deliberately untouched, so ninety minutes still costs him what
 * it always did.
 */
export function dailyRecovery(state: GameState, cfg: TuningConfig) {
  const outfield = cfg.fitnessRecoveryPerDay;
  const keeper = outfield * cfg.gkFitnessRecoveryMult;
  for (const p of activePlayers(state)) {
    if (p.fitness >= 100) continue;
    p.fitness = Math.min(100, p.fitness + (p.positions[0] === "GK" ? keeper : outfield));
  }
}

/** Post-match form drift (hot/cold streaks, ×0.94–1.06). */
export function nudgeForm(p: PlayerBio, rating: number, cfg: TuningConfig) {
  let stability = 1;
  for (const t of p.traits) {
    const s = TRAIT_MAP[t]?.effects.formStability;
    if (s !== undefined) stability *= s;
  }
  const nudge = (rating - 6.5) * cfg.formNudgePerRatingPoint * stability;
  p.form = Math.max(cfg.formMin, Math.min(cfg.formMax, p.form + nudge));
}

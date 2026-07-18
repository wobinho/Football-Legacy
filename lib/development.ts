// Player Development (§5): aging, growth, decline, retirement, fitness.
// One clean function rules the curve:
//   newOverall = f(age, potential, minutesPlayed, archetype, longevity, recentPerformance)

import type { DevLogEntry, GameState, PlayerBio } from "./types";
import type { TuningConfig } from "./config/tuning";
import { getArchetype } from "./config/archetypes";
import { TRAIT_MAP } from "./config/traits";
import { resolveTrainingPlan, type TrainingPlanDef } from "./config/training";
import { randRange, type RNG } from "./rng";
import { playerValue } from "./value";

const FULL_SEASON_MINUTES = 3000; // ~33 full matches
const ATTR_KEYS = ["pac", "sho", "pas", "dri", "def", "phy"] as const;

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

export function developPlayer(
  p: PlayerBio,
  cfg: TuningConfig,
  rng: RNG,
  devCoachStars = 0,
  trainingLevel = 0,
  extraGrowthMult = 1, // e.g. focus-prospect attention (§18)
  planGrowthMult = 1 // training-plan growth-rate nudge (§5 v8)
): DevelopmentOutcome {
  const arch = getArchetype(p.archetypeId);
  const minutesFactor = Math.min(1, p.stats.minutes / FULL_SEASON_MINUTES);
  const avgRating = p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : 6.5;
  const perf = Math.max(-1, Math.min(1, (avgRating - 6.7) / 1.2)); // -1..1

  let longevityBonus = 0;
  for (const t of p.traits) longevityBonus += TRAIT_MAP[t]?.effects.longevityBonus ?? 0;
  const longevity = Math.min(1, p.longevity + longevityBonus);

  const declineOnset =
    cfg.declineOnsetAge +
    (longevity - 0.5) * 2 * cfg.declineOnsetLongevitySwing -
    arch.paceReliance * cfg.declineOnsetPaceReliancePenalty;

  // Recalculate the hidden ceiling BEFORE this season's growth is applied so a
  // breakout season can immediately widen the room to grow into.
  const newPotential = recalcPotential(p, cfg, rng);
  const potentialDelta = newPotential - p.potential;

  let delta = 0;
  let phase: DevelopmentOutcome["phase"];

  if (p.age <= cfg.growthEndAge) {
    phase = "growth";
    // Growth: accelerated by minutes, coach and training facility; capped by headroom
    const headroom = newPotential - p.overall;
    const ageBoost = 1 + (cfg.growthEndAge - p.age) * 0.12;
    const coach = 1 + devCoachStars * 0.08;
    const facility = 1 + trainingLevel * cfg.trainingFacilityGrowthPerLevel;
    const catchup = catchupMult(p.overall, cfg);
    const base =
      cfg.growthPerSeasonMax * (0.35 + 0.65 * minutesFactor) * coach * facility * extraGrowthMult * planGrowthMult * catchup;
    delta = Math.min(headroom, base * ageBoost * randRange(rng, 0.6, 1.1) * 0.55 + perf);
    delta = Math.max(0, delta);
  } else if (p.age < declineOnset) {
    phase = "prime";
    // Prime: small performance-driven drift, still bounded by the (dynamic) ceiling
    delta = perf * 0.8 + randRange(rng, -0.5, 0.5);
    delta = Math.min(delta, Math.max(0, newPotential - p.overall));
  } else {
    phase = "decline";
    // Decline: harder for pace-reliant archetypes, softened by performance/usage
    const yearsIn = p.age - declineOnset + 1;
    const paceMult = 1 + arch.paceReliance * 0.6;
    const perfSoften = 1 - Math.max(0, perf) * 0.35 - minutesFactor * 0.15;
    delta = -cfg.declinePerSeasonBase * yearsIn * 0.6 * paceMult * Math.max(0.3, perfSoften) * randRange(rng, 0.7, 1.2);
  }

  // Retirement (~34-37, longevity-modulated)
  let retired = false;
  const retirementAge = cfg.retirementAgeMin + longevity * (cfg.retirementAgeMax - cfg.retirementAgeMin);
  if (p.age >= retirementAge || p.age >= cfg.retirementAgeMax + 1) retired = true;
  if (p.age >= cfg.retirementAgeMin && p.overall + delta < 55) retired = rng() < 0.6 || retired;

  return { delta: Math.round(delta * 10) / 10, potentialDelta, retired, phase };
}

/**
 * Distribute an overall change across the six attributes, weighted by the
 * archetype's profile so signature attributes rise fastest and — on decline —
 * pace bleeds first. Keeps attrs coherent with the headline number without a
 * per-attribute schema (design: overall potential + per-attr weighting).
 */
function distributeAttrs(p: PlayerBio, attrDelta: number, plan?: TrainingPlanDef) {
  if (attrDelta === 0) return;
  const profile = getArchetype(p.archetypeId).attrProfile;
  const maxW = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;
  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxW; // 0..1, 1 = signature attribute
    let share: number;
    if (attrDelta > 0) {
      // growth flows to signature attributes, then is nudged toward the training
      // plan's emphasis (a plan weight of 1 pulls growth here; ~0.2 pushes it
      // elsewhere). Balanced plans are flat, so they leave the archetype spread
      // untouched. Decline is never re-steered by a plan.
      const planW = plan ? plan.weights[k] : 1;
      share = attrDelta * (0.5 + 0.9 * rel) * (0.55 + 0.9 * planW);
    } else {
      // decline hits pace hardest, then non-signature attributes
      const paceBias = k === "pac" ? 1.4 : 1.0;
      share = attrDelta * (0.7 + 0.6 * (1 - rel)) * paceBias;
    }
    p.attrs[k] = Math.max(20, Math.min(99, Math.round(p.attrs[k] + share)));
  }
}

/** Applied at season rollover to every player in the world (bulk, §4). */
export function applySeasonDevelopment(
  state: GameState,
  p: PlayerBio,
  cfg: TuningConfig,
  rng: RNG,
  devCoachStars = 0,
  trainingLevel = 0,
  extraGrowthMult = 1,
  applyPlan = false // training plans only steer the user's own squad (§5 v8)
): DevelopmentOutcome {
  const fromOverall = p.overall;
  const fromPotential = p.potential;
  // A training plan biases where growth flows and nudges its rate — only for the
  // user's players (applyPlan). AI squads develop on the neutral curve.
  const plan = applyPlan ? resolveTrainingPlan(p.trainingPlan, p.positions[0]) : undefined;
  const out = developPlayer(p, cfg, rng, devCoachStars, trainingLevel, extraGrowthMult, plan?.growthMult ?? 1);
  p.potential = fromPotential + out.potentialDelta;
  p.age += 1;
  const newOverall = Math.round(Math.max(35, Math.min(p.age <= cfg.growthEndAge ? p.potential : 99, p.overall + out.delta)));
  distributeAttrs(p, newOverall - p.overall, plan);
  p.overall = newOverall;
  if (out.retired) {
    p.retired = true;
    p.clubId = null;
  }
  p.value = p.retired ? 0 : playerValue(p, cfg);

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

// ── Development projections (Player Development page) ──────────────────────
// Read-only estimates for the UI. Deterministic (no RNG) — they answer "where is
// this player heading?" using the same growth shape the rollover applies.

export type DevPhase = "growth" | "prime" | "decline";

export function devPhase(p: PlayerBio, cfg: TuningConfig): DevPhase {
  if (p.age <= cfg.growthEndAge) return "growth";
  const arch = getArchetype(p.archetypeId);
  const declineOnset = cfg.declineOnsetAge + (p.longevity - 0.5) * 2 * cfg.declineOnsetLongevitySwing - arch.paceReliance * cfg.declineOnsetPaceReliancePenalty;
  return p.age < declineOnset ? "prime" : "decline";
}

/**
 * Estimated overall growth for the COMING SEASON only, at a given development
 * environment (coach stars + training level) and training plan. Mirrors
 * developPlayer's growth branch at expected values (full-ish minutes). Bounded by
 * the player's hidden headroom, but never exposes the ceiling itself — the UI
 * only ever shows the one-season delta. Returns null once the player has aged out
 * of the growth phase.
 */
export function seasonGrowthEstimate(
  p: PlayerBio,
  cfg: TuningConfig,
  devCoachStars = 0,
  trainingLevel = 0,
  plan?: TrainingPlanDef
): { delta: number } | null {
  if (p.age > cfg.growthEndAge) return null;
  const headroom = p.potential - p.overall; // hidden — used to bound, never shown
  if (headroom <= 0) return { delta: 0 };
  const minutesFactor = 0.85;
  const ageBoost = 1 + (cfg.growthEndAge - p.age) * 0.12;
  const coach = 1 + devCoachStars * 0.08;
  const facility = 1 + trainingLevel * cfg.trainingFacilityGrowthPerLevel;
  const planMult = plan?.growthMult ?? 1;
  const catchup = catchupMult(p.overall, cfg);
  const base = cfg.growthPerSeasonMax * (0.35 + 0.65 * minutesFactor) * coach * facility * planMult * catchup;
  // same 0.85 mid-point and 0.55 shape factor developPlayer applies
  const raw = base * ageBoost * 0.85 * 0.55;
  const delta = Math.max(0, Math.min(headroom, Math.round(raw)));
  return { delta };
}

/**
 * Distribute one season's expected overall growth across the six attributes,
 * mirroring the rollover's distributeAttrs logic (archetype signature attributes
 * first, nudged by the training plan). This-season only — never a lifetime
 * ceiling. Returns the per-attribute gain to add to the current value.
 */
export function seasonAttrFocus(
  p: PlayerBio,
  overallDelta: number,
  plan?: TrainingPlanDef
): Record<keyof PlayerBio["attrs"], number> {
  const out = {} as Record<keyof PlayerBio["attrs"], number>;
  for (const k of ATTR_KEYS) out[k] = 0;
  if (overallDelta <= 0) return out;
  const profile = getArchetype(p.archetypeId).attrProfile;
  const maxW = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;
  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxW;
    const planW = plan ? plan.weights[k] : 1;
    const share = overallDelta * (0.5 + 0.9 * rel) * (0.55 + 0.9 * planW);
    out[k] = Math.max(0, Math.round(share));
  }
  return out;
}

// ── Fitness (§5: the one condition stat) ──────────────────────────────────

export function applyMatchFatigue(p: PlayerBio, minutes: number, cfg: TuningConfig, medicalLevel = 0) {
  let drainMult = 1;
  for (const t of p.traits) drainMult *= TRAIT_MAP[t]?.effects.fitnessDrainMult ?? 1;
  if (p.age > 30) {
    // a good medical department softens the extra drain veterans take
    const ageDrain = (p.age - 30) * (cfg.fitnessDrainAgeFactor / 10);
    const relief = Math.min(1, medicalLevel * cfg.medicalFacilityAgeDrainReductionPerLevel);
    drainMult *= 1 + ageDrain * (1 - relief);
  }
  const drain = (minutes / 90) * cfg.fitnessDrainPerMatch * drainMult;
  p.fitness = Math.max(5, Math.round(p.fitness - drain));
}

export function dailyRecovery(state: GameState, cfg: TuningConfig) {
  const userTeam = state.teams[state.userTeamId];
  const coachBonus = (userTeam.staff.fitnessCoach?.stars ?? 0) * cfg.fitnessCoachRecoveryPerStar;
  const physioBonus = (userTeam.staff.physio?.stars ?? 0) * cfg.physioRecoveryPerStar;
  const medicalBonus = (userTeam.medicalLevel ?? 0) * cfg.medicalFacilityRecoveryPerLevel;
  const userBonus = coachBonus + physioBonus + medicalBonus;
  for (const p of Object.values(state.players)) {
    if (p.retired || p.fitness >= 100) continue;
    const bonus = p.clubId === state.userTeamId ? userBonus : 0;
    p.fitness = Math.min(100, p.fitness + cfg.fitnessRecoveryPerDay + bonus);
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

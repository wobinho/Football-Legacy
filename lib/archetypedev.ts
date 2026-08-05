// ── Archetype retraining (v1.93) ──────────────────────────────────────────
//
// The four archetype development centers unlock, at level 5, the ability to put
// a player through a programme that changes WHO HE IS: over a couple of seasons
// his 35 attributes are reshaped toward a target archetype's training-plan
// weights, and his derived archetype follows once the shape genuinely earns it.
//
// ── Why this is not just "set his training plan" ──────────────────────────
// Training plans already steer growth toward an archetype, and v1.85 made that
// actually work. But `verify:conversion` measures what it costs: a 16–18 year
// old converts 41% of the time, a 22–24 year old 17%, and a settled 29–33 year
// old 2%. That is correct and deliberate — a training plan is a bet on growth,
// and a player with no growth left has nothing to bet with.
//
// This is the other route, and it is the one the money buys: it does not wait
// for growth, it REDISTRIBUTES the ability he already has. That is why it costs
// a £200M building at level 5 plus two seasons of a programme slot, and why it
// is the only thing in the game that can turn a finished 30-year-old into
// something else.
//
// ── The invariant that makes it fair ──────────────────────────────────────
// A conversion PRESERVES OVERALL. It moves points from what the target
// archetype doesn't care about into what it does; it never creates any. That is
// enforced structurally rather than by a check: the reshaping ends in
// `fitAttrsToOverall(..., target)` with `target` being the overall he already
// had, which is the same function every other attribute redistribution in the
// game settles through.
//
// Growth is a separate matter and still happens — the rollover develops him as
// usual — which is why `ArchetypeConversion.startOverall` is stored: without it
// the UI could not tell the manager which of the two moved him.

import type {
  ArchetypeConversion,
  Attributes,
  FacilityId,
  GameState,
  PlayerBio,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import {
  ARCHETYPE_BY_PLAN,
  deriveArchetype,
  getArchetype,
  positionsOfArchetype,
  type Archetype,
} from "./config/archetype";
import { TRAINING_PLAN_MAP } from "./config/training";
import { ATTR_KEYS } from "./config/attributes";
import { fitAttrsToOverall } from "./config/positions";
import { archetypeConversionSpeedup, archetypeConversionUnlocked } from "./facilities";
import { archetypeDevFacilityFor } from "./config/facilities";

/** Everything currently running. Empty for a save that never started one. */
export function conversionsOf(state: GameState): ArchetypeConversion[] {
  return state.archetypeConversions ?? [];
}

/** The programme running for a player, if any. */
export function conversionFor(state: GameState, playerId: string): ArchetypeConversion | undefined {
  return conversionsOf(state).find((c) => c.playerId === playerId);
}

/** Everything running at one center. */
export function conversionsAt(state: GameState, facility: FacilityId): ArchetypeConversion[] {
  return conversionsOf(state).filter((c) => c.facility === facility);
}

/**
 * How many whole seasons a programme at this center takes, as it is staffed
 * RIGHT NOW.
 *
 * `archetypeConversionSpeedup` is the center's `convertSpeed` channel as a
 * fraction, which is 10% per six assigned stars — so six 5-star coaches (30
 * stars) return 0.5 and halve the wait, which is the brief's "2 years becomes
 * 1". Rounded UP and floored at one season: a programme that completes in zero
 * seasons would be an instant button, and the commitment is the point.
 *
 * Re-read every summer rather than stored, which is what makes staffing the
 * center mid-programme actually shorten it.
 */
export function conversionSeasonsRequired(
  state: GameState,
  cls: string,
  cfg: TuningConfig
): number {
  const speedup = archetypeConversionSpeedup(state, cls);
  return Math.max(1, Math.ceil(cfg.archetypeConvertSeasons * (1 - speedup)));
}

/** The class a target archetype belongs to — the class whose center runs it. */
function classOfPlan(planId: string): string | undefined {
  return ARCHETYPE_BY_PLAN[planId]?.cls;
}

/**
 * Why this player can't be put on this programme, or null if he can.
 *
 * The single ruling, called by both the store and the UI — the UI greys options
 * out with it and never re-derives the rules, the same contract
 * `networkMoveError` holds for the GCN.
 */
export function conversionError(
  state: GameState,
  playerId: string,
  targetPlanId: string,
  cfg: TuningConfig
): string | null {
  const p = state.players[playerId];
  if (!p || p.retired) return "That player isn't available.";
  const team = state.teams[state.userTeamId];
  const onBooks =
    p.clubId === state.userTeamId || (team.academyPlayerIds ?? []).includes(playerId);
  if (!onBooks) return "You can only retrain your own players.";

  const target = ARCHETYPE_BY_PLAN[targetPlanId];
  if (!target) return "Unknown archetype.";
  const cls = target.cls;
  if (!archetypeConversionUnlocked(state, cls)) {
    return `Your ${cls} Archetype Development center isn't complete.`;
  }

  // The target has to be a role he could actually hold. An archetype's positions
  // are its training plan's position set, so this asks the plan table rather
  // than hard-coding anything: retraining a centre back into a Sniper is advice
  // no player could ever act on, and the same is true of a programme.
  const canPlay = positionsOfArchetype(target).includes(p.positions[0]);
  if (!canPlay) return `A ${target.name} is not a ${p.positions[0]} role.`;

  const current = deriveArchetype(p.attrs, p.positions[0]);
  if (current?.id === target.id) return `${p.name} is already a ${target.name}.`;

  if (conversionFor(state, playerId)) return `${p.name} is already in a retraining programme.`;

  const facility = archetypeDevFacilityFor(cls);
  if (!facility) return `There is no ${cls} development center.`;
  if (conversionsAt(state, facility).length >= cfg.archetypeConvertSlots) {
    return `Your ${cls} center is already retraining someone. It runs ${cfg.archetypeConvertSlots} programme${cfg.archetypeConvertSlots === 1 ? "" : "s"} at a time.`;
  }
  return null;
}

/** Start a programme. Returns an error string or null, matching the convention
 * the rest of the lib uses. */
export function startConversion(
  state: GameState,
  playerId: string,
  targetPlanId: string,
  cfg: TuningConfig
): string | null {
  const err = conversionError(state, playerId, targetPlanId, cfg);
  if (err) return err;
  const cls = classOfPlan(targetPlanId)!;
  const facility = archetypeDevFacilityFor(cls)!;
  const p = state.players[playerId];
  (state.archetypeConversions ??= []).push({
    playerId,
    targetPlanId,
    facility,
    startSeason: state.season,
    startOverall: p.overall,
    seasonsServed: 0,
  });
  return null;
}

/**
 * Abandon a programme.
 *
 * Whatever reshaping has already happened STAYS. It is not undone, and that is
 * deliberate: the attribute moves are real training the player did, and quietly
 * reverting them would mean a manager could probe the system for free. Cancelling
 * frees the slot and stops the remaining progress, nothing more.
 */
export function cancelConversion(state: GameState, playerId: string): string | null {
  const list = conversionsOf(state);
  if (!list.some((c) => c.playerId === playerId)) return "No programme is running for that player.";
  state.archetypeConversions = list.filter((c) => c.playerId !== playerId);
  return null;
}

/**
 * Move a player's attributes a share of the way toward a target plan's shape,
 * holding his overall.
 *
 * The two steps, and why both are needed:
 *
 *  1. Build the target SHAPE from the plan's own weights, on the same
 *     `0.55 + 0.48 × relative weight` spread `shapeAttrsToArchetype` uses — so a
 *     converted player and a generated one of the same archetype and rating read
 *     alike, rather than the conversion inventing a third kind of attribute line.
 *  2. Interpolate `share` of the way from where he is to that shape, then settle
 *     the result back onto his ORIGINAL overall with `fitAttrsToOverall`.
 *
 * Step 2 is what makes the invariant structural: whatever the interpolation did
 * to his rating, the settle puts it back. `bias` is passed so the settle's
 * residual is tilted toward the plan rather than toward the position's own
 * weights — the v1.85 lesson that the settle moves ~4× as many points as the
 * intent does, and unbiased it feeds the player's existing identity straight
 * back to him.
 */
export function reshapeToward(
  attrs: Attributes,
  pos: PlayerBio["positions"][number],
  targetPlanId: string,
  overall: number,
  share: number
): Attributes {
  const plan = TRAINING_PLAN_MAP[targetPlanId];
  if (!plan) return attrs;
  const weights = plan.weights;
  const maxW = Math.max(...ATTR_KEYS.map((k) => weights[k])) || 1;

  const out = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const rel = weights[k] / maxW; // 1.0 = signature attribute of the target
    const ideal = overall * (0.55 + 0.48 * rel);
    out[k] = Math.max(1, Math.min(99, Math.round(attrs[k] + (ideal - attrs[k]) * share)));
  }
  // Settle back onto the overall he had, tilted toward what the plan trains.
  return fitAttrsToOverall(out, pos, overall, weights);
}

/** What one summer of every running programme does. */
export interface ConversionOutcome {
  playerId: string;
  playerName: string;
  target: Archetype;
  /** True when this was the final season and he now holds the role. */
  completed: boolean;
  /** The archetype he actually reads as now — which on completion SHOULD be the
   * target, but is reported rather than assumed. See `rolloverConversions`. */
  derived?: Archetype;
  seasonsServed: number;
  seasonsRequired: number;
}

/**
 * Advance every programme by a season. Called once at the rollover.
 *
 * Placement matters and is asserted by the caller's comment: this runs AFTER the
 * development pass, so the reshaping settles onto the overall he finished the
 * season with rather than the one he started it with. Running it before would
 * make the summer's growth silently undo part of the conversion — growth
 * redistributes attributes too (`distributeAttrs`), and the last writer wins.
 *
 * Returns what happened, so the caller can put it in the inbox.
 */
export function rolloverConversions(state: GameState, cfg: TuningConfig): ConversionOutcome[] {
  const running = conversionsOf(state);
  if (!running.length) return [];
  const out: ConversionOutcome[] = [];
  const kept: ArchetypeConversion[] = [];

  for (const c of running) {
    const p = state.players[c.playerId];
    const target = ARCHETYPE_BY_PLAN[c.targetPlanId];
    // A player who retired, was sold or was released mid-programme drops out.
    // Checked against the books rather than assumed, because both are ordinary
    // things to happen to a player in a summer.
    const team = state.teams[state.userTeamId];
    const onBooks =
      p && !p.retired &&
      (p.clubId === state.userTeamId || (team.academyPlayerIds ?? []).includes(c.playerId));
    if (!onBooks || !target) continue;

    const required = conversionSeasonsRequired(state, target.cls, cfg);
    const served = c.seasonsServed + 1;
    const final = served >= required;
    // The last season snaps the rest of the way; earlier ones close a share of
    // the remaining gap, so the programme is visible while it runs.
    const share = final ? 1 : cfg.archetypeConvertProgressShare;
    p.attrs = reshapeToward(p.attrs, p.positions[0], c.targetPlanId, p.overall, share);

    if (final) {
      // Completing the programme also sets his TRAINING PLAN to the target's.
      // Without this the very next summer's growth would steer him back toward
      // whatever he was training for, and the conversion would decay — the plan
      // is what `distributeAttrs` reads, so leaving it pointing elsewhere would
      // be shipping a feature that quietly reverses itself.
      p.trainingPlan = c.targetPlanId;
    } else {
      kept.push({ ...c, seasonsServed: served });
    }

    out.push({
      playerId: p.id,
      playerName: p.name,
      target,
      completed: final,
      // Reported, never assumed. A full-share reshape onto the plan's own weights
      // should read as the target, but `deriveArchetype` also applies the
      // specialism threshold and the incumbent's switch margin, and a player
      // whose attributes are pinned near 99 can't be shaped freely. Saying what
      // he IS beats claiming what he ought to be.
      derived: deriveArchetype(p.attrs, p.positions[0]),
      seasonsServed: served,
      seasonsRequired: required,
    });
  }

  state.archetypeConversions = kept;
  return out;
}

/** The archetypes a player could be retrained into right now: every role at his
 * position whose class center is complete, minus the one he already is.
 * The UI's option list — derived here so the screen can't offer a programme
 * `conversionError` would refuse. */
export function conversionOptionsFor(state: GameState, playerId: string): Archetype[] {
  const p = state.players[playerId];
  if (!p) return [];
  const current = deriveArchetype(p.attrs, p.positions[0]);
  return Object.values(TRAINING_PLAN_MAP)
    .map((plan) => ARCHETYPE_BY_PLAN[plan.id])
    .filter((a): a is Archetype => !!a)
    .filter((a) => a.id !== current?.id)
    .filter((a) => positionsOfArchetype(a).includes(p.positions[0]))
    .filter((a) => archetypeConversionUnlocked(state, a.cls));
}

/** Resolve a stored plan id to its archetype, for the UI. */
export function archetypeOfPlan(planId: string): Archetype | undefined {
  return ARCHETYPE_BY_PLAN[planId];
}

export { getArchetype };

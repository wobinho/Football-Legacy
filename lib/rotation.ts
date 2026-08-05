// ── Squad rotation (§7, v1.66) ────────────────────────────────────────────
// Selection used to be a pure "best available XI" pass: `pickLineup` scored
// every player by ability × fit × fitness × form and took the top man for each
// slot. Because ability dominates that product, the same eleven started every
// match all season — the fitness term only ever bit when a player was close to
// exhausted, and the `minFitnessToStart` gate at 55 almost never fired. Squad
// players got minutes only from the late-match sub pass, which is why rotation
// players and impact subs never accumulated a season worth having.
//
// This module supplies the two things a real manager weighs before naming a
// side, as a score ADJUSTMENT layered on top of the existing selection score:
//
//   1. Freshness — a starter below `rotationFitnessThreshold` is rested if a
//      credible deputy exists, and the bar rises in a congested week
//      (`congestedFixtureDays`).
//   2. Squad roles — every player has a role implied by his standing in the
//      squad (Starter / Rotation / Impact Sub), each with a target share of
//      available minutes. Whoever is furthest below his target gets a nudge up
//      the selection order, so the manager actively works toward the roles
//      rather than leaving them to chance.
//
// A low-priority cup tie loosens the quality floor further, which is where the
// deep squad actually plays. Everything is a tuning number; nothing reads a
// player, club or competition by name beyond the "is this the cup" flag the
// caller passes in.

import type { Fixture, GameState, PlayerBio } from "./types";
import type { TuningConfig } from "./config/tuning";

/** The squad role a player occupies at his club — derived from where his ability
 * ranks in the squad rather than stored, so it stays correct as the squad turns
 * over and needs no migration. */
export type SquadRole = "starter" | "rotation" | "impactSub" | "fringe";

/** Rank thresholds for the role bands. The XI are starters, the next seven are
 * the rotation/impact-sub group that a matchday squad is built from, and
 * everyone beyond the matchday squad is fringe. */
export function roleOf(state: GameState, p: PlayerBio, cfg: TuningConfig): SquadRole {
  if (!p.clubId) return "fringe";
  const squad = state.teams[p.clubId]?.playerIds
    .map((id) => state.players[id])
    .filter((x) => x && !x.retired && !x.loan)
    .sort((a, b) => b.overall - a.overall);
  if (!squad?.length) return "fringe";
  const rank = squad.findIndex((x) => x.id === p.id);
  if (rank < 0) return "fringe";
  if (rank < 11) return "starter";
  // The bench half of the matchday squad splits into the players who rotate into
  // the XI and the ones who come on to change a game.
  const benchCap = cfg.matchdaySquad - 11;
  if (rank < 11 + Math.ceil(benchCap / 2)) return "rotation";
  if (rank < cfg.matchdaySquad) return "impactSub";
  return "fringe";
}

/** The share of available minutes this role is aiming at. */
export function roleMinutesTarget(role: SquadRole, cfg: TuningConfig): number {
  switch (role) {
    case "starter":
      return cfg.roleMinutesTargetStarter;
    case "rotation":
      return cfg.roleMinutesTargetRotation;
    case "impactSub":
      return cfg.roleMinutesTargetImpactSub;
    default:
      return 0;
  }
}

/**
 * How far below his role's minutes target this player is running, 0..1.
 *
 * This is the signal that makes the manager *actively* satisfy squad roles
 * rather than merely permit rotation: a rotation player who has played nothing
 * carries a full deficit and jumps the selection order, while one already at his
 * target carries none and selection reverts to pure merit.
 */
export function minutesDeficit(state: GameState, p: PlayerBio, cfg: TuningConfig): number {
  if (!p.clubId) return 0;
  const played = state.fixtures.filter(
    (f) => f.played && (f.homeId === p.clubId || f.awayId === p.clubId)
  ).length;
  // Too early in the season for a share to mean anything.
  if (played < 3) return 0;
  const target = roleMinutesTarget(roleOf(state, p, cfg), cfg);
  if (target <= 0) return 0;
  const share = (p.stats.minutes ?? 0) / (played * 90);
  return Math.max(0, Math.min(1, (target - share) / target));
}

// ── Fixture density ───────────────────────────────────────────────────────

/**
 * Is this club playing again soon enough that the manager should hold something
 * back? Looks both ways from `day`: a match within `congestedFixtureDays` on
 * either side makes the week congested, because a Wednesday game tires the side
 * for Saturday just as a Saturday game leaves it short on Wednesday.
 */
export function isCongested(state: GameState, clubId: string, day: number, cfg: TuningConfig): boolean {
  const window = cfg.congestedFixtureDays;
  return state.fixtures.some(
    (f) =>
      (f.homeId === clubId || f.awayId === clubId) &&
      f.day !== day &&
      Math.abs(f.day - day) <= window
  );
}

/** Is this a fixture a manager would rotate for — a cup tie rather than league
 * football? The competition field is a league id or "CUP"; European ties carry
 * their own competition ids and are never low priority. */
export function isLowPriority(fixture: Fixture): boolean {
  return fixture.competition === "CUP";
}

// ── The selection adjustment ──────────────────────────────────────────────

export interface RotationContext {
  /** Fitness below which a starter is a rest candidate, already adjusted for
   * fixture congestion. */
  restBelow: number;
  /** How far below a starter's score a deputy may fall and still be picked. */
  qualityFloor: number;
  /** Whether role-target deficits are being chased in this match. */
  chaseRoles: boolean;
}

/**
 * Work out the rotation posture for one club's next fixture. Called by the
 * selection path; the result is passed to `rotationMultiplier` for each player.
 */
export function rotationContextFor(
  state: GameState,
  clubId: string,
  fixture: Fixture,
  cfg: TuningConfig
): RotationContext {
  const congested = isCongested(state, clubId, fixture.day, cfg);
  const lowPriority = isLowPriority(fixture);
  return {
    restBelow: cfg.rotationFitnessThreshold + (congested ? cfg.congestedRotationBonus : 0),
    qualityFloor: lowPriority ? cfg.cupRotationQualityFloor : cfg.rotationQualityFloor,
    // Roles are chased hardest where it costs least: a cup tie or a congested
    // week is exactly when a manager hands a rotation player his start.
    chaseRoles: congested || lowPriority,
  };
}

/**
 * The multiplier applied to a player's raw selection score for this fixture.
 *
 * Above the rest threshold with no minutes owing, this is 1.0 and selection is
 * unchanged — the best XI still starts the big league games. It moves only when
 * the manager has a reason: a tired starter is marked down toward the quality
 * floor, and a player short of his role's minutes is marked up.
 */
export function rotationMultiplier(
  state: GameState,
  p: PlayerBio,
  ctx: RotationContext,
  cfg: TuningConfig
): number {
  let mult = 1;

  // Rest a tired man. Scaled by how far below the line he is, and never past the
  // quality floor — a rested starter is still ahead of a much worse deputy, so
  // the side never collapses to reserves.
  if (p.fitness < ctx.restBelow) {
    const shortfall = (ctx.restBelow - p.fitness) / Math.max(1, ctx.restBelow);
    mult *= Math.max(ctx.qualityFloor, 1 - shortfall);
  }

  // Chase the role target. Only in the matches where rotation is cheap, so a
  // title run-in isn't compromised to satisfy a squad player's minutes.
  if (ctx.chaseRoles) {
    mult *= 1 + minutesDeficit(state, p, cfg) * cfg.roleMinutesSelectionWeight;
  }

  // Blood a prospect (v1.92).
  //
  // The last cause of long-save squad decay, and the one that hid behind every
  // other. With intake and recruitment both fixed, the top flight's XI stayed
  // strong (76.4 → 79.0 over 13 seasons) but its average STARTER aged 25.3 →
  // 33.4 and its bench fell 75.3 → 69.7. The young players existed and were
  // signed; they simply never played, because selection ranks on current ability
  // and a 33-year-old always out-rates a 19-year-old.
  //
  // That is a trap, not a preference: development is driven by MINUTES, so a
  // prospect who never plays never improves, never overtakes the veteran ahead
  // of him, and never plays. The squad ages in place until the whole generation
  // retires at once — the original complaint, arriving by a different route.
  //
  // Same discipline as the role-minutes term above: only in the matches where
  // rotation is already cheap (a cup tie, a congested week), and capped so a
  // prospect is given a chance rather than handed the shirt. A club's best
  // league XI is untouched.
  if (ctx.chaseRoles && p.age <= cfg.youthBloodingMaxAge) {
    const headroom = Math.max(0, p.potential - p.overall);
    if (headroom >= cfg.youthBloodingMinHeadroom) {
      const share = Math.min(1, headroom / cfg.youthBloodingFullHeadroom);
      mult *= 1 + share * cfg.youthBloodingSelectionWeight;
    }
  }

  return mult;
}

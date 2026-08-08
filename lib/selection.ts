// Squad selection: pick the best XI + bench for a formation. Used by AI
// clubs every matchday, by the harness, and as the user's auto-pick.

import type { ClubFamiliarity, PlayerBio, Pos, Tactic, TeamAssignments } from "./types";
import type { TuningConfig } from "./config/tuning";
import { getFormation, type Formation } from "./config/formations";
import { positionFit } from "./config/positions";
import { tacticalFitMult, type EnginePlayer, type LineupEntry, type SideInput } from "./engine/match";
import { hasBrief, roleBriefMult } from "./tacticbrief";
import { familiarityMult } from "./familiarity";

/**
 * How many substitutes a side names — the single accessor (v1.99).
 *
 * It was `cfg.matchdaySquad - 11`, spelled out at six call sites across
 * selection, rotation, tactics and the store. That made the bench a derivation
 * of a number that is ALSO read as a squad-size floor, so widening the bench
 * meant telling every AI club to keep two more players — two answers hanging
 * off one constant. `benchSize` states it directly; this is what reads it, so
 * a bench cap can never be computed a seventh way.
 */
export function benchCap(cfg: TuningConfig): number {
  return cfg.benchSize;
}

export function toEnginePlayer(p: PlayerBio): EnginePlayer {
  return {
    id: p.id,
    name: p.name,
    overall: p.overall,
    positions: p.positions,
    traits: p.traits,
    form: p.form,
    fitness: p.fitness,
    age: p.age,
    // The 35 attributes (v1.72) — read by the engine's tactical-fit pass. Passed
    // by reference: the engine never mutates a player it is handed.
    attrs: p.attrs,
  };
}

/**
 * How good this player is for this slot.
 *
 * `tactic` (v1.90) folds in the same identity levers the match applies —
 * `tacticalFitMult`, i.e. class-vs-style synergy times role-vs-instructions fit.
 * Passed, the pick is "the best player FOR THIS TACTIC"; omitted, it is the pure
 * ability ranking it has always been, which is what a caller with no tactic in
 * hand (the calibration harness) still wants.
 *
 * This is the whole of "best in slot": one score, read by both the AI's matchday
 * pick and the user's auto-pick, so the two can't rank the same squad
 * differently.
 */
export function selectionScore(p: PlayerBio, slotPos: Pos, cfg: TuningConfig, tactic?: Tactic): number {
  const fit = positionFit(p.positions, slotPos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
  const fitness = cfg.fitnessFloorMult + (1 - cfg.fitnessFloorMult) * (p.fitness / 100);
  const tactical = tactic ? tacticalFitMult(toEnginePlayer(p), tactic, cfg) : 1;
  return p.overall * fit * fitness * p.form * tactical;
}

/**
 * Per-player selection weight for a rotation-aware pick (v1.66). Supplied by the
 * caller (the matchday path builds one from lib/rotation.ts); omitted, every
 * player weighs 1 and selection is the pure best-XI it always was — which is
 * what the harness, `teamStrength` and the user's auto-pick still want.
 */
export type SelectionWeight = (p: PlayerBio) => number;

/**
 * Greedy assignment: fill the scarcest slots first (GK, then by candidate
 * count) so a lone striker isn't stolen by a wing slot.
 */
export function pickLineup(
  players: PlayerBio[],
  formation: Formation,
  cfg: TuningConfig,
  respectFitness = true,
  /** Rotation weighting (v1.66) — rests tired starters and pulls players short
   * of their role's minutes up the order. See lib/rotation.ts. */
  weight?: SelectionWeight,
  /** The tactic the side will actually play (v1.90). Supplied, both the XI and
   * the bench are chosen for it — see `selectionScore`. */
  tactic?: Tactic,
  /** The club's squad-familiarity record (v2.1). Supplied, the pick prefers the
   * settled incumbent over the marginally better newcomer exactly as the match
   * will rate them — the v1.90 "selection asks what the match answers" rule.
   * Omitted (worldgen, the harnesses, a pre-v2.1 save), it changes nothing. */
  familiarity?: ClubFamiliarity
): { lineup: { slotId: string; player: PlayerBio }[]; bench: PlayerBio[] } {
  const available = players.filter((p) => !p.retired);
  const pool = new Set(available.map((p) => p.id));
  const byId = new Map(available.map((p) => [p.id, p]));
  const lineup: { slotId: string; player: PlayerBio }[] = [];

  const supply = new Map<Pos, number>();
  for (const p of available) {
    for (const pos of p.positions) supply.set(pos, (supply.get(pos) ?? 0) + 1);
  }
  const slots = formation.slots
    .slice()
    .sort((a, b) => (supply.get(a.pos) ?? 0) - (supply.get(b.pos) ?? 0));

  // v1.99: the slot-INDEPENDENT inputs are computed once per player instead of
  // once per (player × slot). `tacticalFitMult` derives an archetype and was
  // being asked for it eleven times per player, once per slot in the formation.
  //
  // The multiplication is deliberately left in `selectionScore`'s original
  // order — overall × fit × fitness × form × tactical, then the weight — rather
  // than pre-multiplying the invariant factors. Floating-point multiplication is
  // not associative, and re-associating it changed real league tables in
  // `verify:sim-parity`: scores that should tie stopped tying, so a different
  // player took the slot. Caching the INPUTS is free; reordering the product is
  // not.
  interface SlotConst { fitness: number; tactical: number; weight: number }
  const constFor = new Map<string, SlotConst>();
  for (const p of available) {
    constFor.set(p.id, {
      fitness: cfg.fitnessFloorMult + (1 - cfg.fitnessFloorMult) * (p.fitness / 100),
      tactical: tactic ? tacticalFitMult(toEnginePlayer(p), tactic, cfg) : 1,
      weight: weight ? weight(p) : 1,
    });
  }
  // The role brief (v1.99) is the one term that genuinely varies BY SLOT rather
  // than by position, so it cannot join the cache above — two centre backs are
  // two different jobs. It is only consulted when the tactic actually carries a
  // brief, so an ordinary tactic pays a single boolean for the whole pick.
  //
  // v2.1: squad familiarity is the other per-SLOT term, and for the same reason
  // — how settled a player is at right back says nothing about how settled he is
  // in midfield. Like the brief it is guarded, so a club with no record pays a
  // single null check for the whole pick.
  const briefed = !!tactic && hasBrief(tactic);
  const scoreFor = (p: PlayerBio, pos: Pos, slotId: string) => {
    const c = constFor.get(p.id)!;
    const fit = positionFit(p.positions, pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
    const base = p.overall * fit * c.fitness * p.form * c.tactical * c.weight;
    const withBrief = briefed ? base * roleBriefMult(p.attrs, pos, slotId, tactic!) : base;
    return familiarity ? withBrief * familiarityMult(familiarity, p.id, slotId) : withBrief;
  };

  for (const slot of slots) {
    let best: PlayerBio | null = null;
    let bestScore = -1;
    for (const id of pool) {
      const p = byId.get(id)!;
      if (respectFitness && p.fitness < cfg.minFitnessToStart && p.positions[0] !== "GK") continue;
      const score = scoreFor(p, slot.pos, slot.id);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    // fallback: ignore the fitness gate rather than field 10 men
    if (!best) {
      for (const id of pool) {
        const p = byId.get(id)!;
        const score = scoreFor(p, slot.pos, slot.id);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    if (best) {
      lineup.push({ slotId: slot.id, player: best });
      pool.delete(best.id);
    }
  }

  // The bench is ordered by the same weighting as the XI (v1.66), so a player
  // owed minutes is not just eligible but actually named among the subs — the
  // in-match sub pass can only pick from who is on it.
  // Ranked on the same tactical terms as the XI (v1.90): a bench ordered on raw
  // overall names the best players left rather than the best options for the
  // game being played, and the in-match sub pass can only choose from who is on
  // it. Scored at the player's own primary position — a bench slot has no
  // position of its own, so this asks "how useful is he to this tactic at all".
  const benchScore = (p: PlayerBio) =>
    (tactic ? p.overall * tacticalFitMult(toEnginePlayer(p), tactic, cfg) : p.overall) *
    (weight ? weight(p) : 1);
  const rest = [...pool]
    .map((id) => {
      const p = byId.get(id)!;
      return { p, score: benchScore(p) };
    })
    .sort((a, b) => b.score - a.score)
    .map((e) => e.p);
  const bench: PlayerBio[] = [];
  const gk = rest.find((p) => p.positions[0] === "GK");
  if (gk) bench.push(gk);
  for (const p of rest) {
    if (bench.length >= benchCap(cfg)) break;
    if (!bench.includes(p)) bench.push(p);
  }
  return { lineup, bench };
}

export function buildSideInput(
  teamId: string,
  name: string,
  short: string,
  players: PlayerBio[],
  tactic: Tactic,
  cfg: TuningConfig,
  fixedLineup?: { slotId: string; player: PlayerBio }[],
  coachMult = 1,
  assignments?: TeamAssignments,
  /** Explicit, ordered bench (v25, user team). Ids are honoured in order, then
   * topped up to the matchday cap with the best of whoever remains — so a
   * partial bench still fields a full squad. Ignored for AI sides. */
  fixedBench?: string[],
  /** Rotation weighting for this fixture (v1.66). Applied only when the side is
   * auto-picked — a user who named his own XI gets exactly the XI he named. */
  weight?: SelectionWeight,
  /** The club's squad-familiarity record (v2.1), carried onto the `SideInput` so
   * the engine can read it — it holds no `GameState`. Also steers the auto-pick,
   * so the XI chosen and the XI rated agree. */
  familiarity?: ClubFamiliarity
): SideInput {
  const formation = getFormation(tactic.formationId);
  const picked = fixedLineup ?? pickLineup(players, formation, cfg, true, weight, tactic, familiarity).lineup;
  const usedIds = new Set(picked.map((e) => e.player.id));
  const cap = benchCap(cfg);
  let bench: PlayerBio[];
  if (fixedBench) {
    const byId = new Map(players.map((p) => [p.id, p]));
    // The user's chosen subs, in their order, filtering anyone unavailable or
    // already starting.
    bench = fixedBench
      .map((id) => byId.get(id))
      .filter((p): p is PlayerBio => !!p && !p.retired && !usedIds.has(p.id));
    // Top up to the cap with the best of the rest so a short bench is never a
    // penalty — the auto-fill mirrors the old behaviour.
    const chosen = new Set(bench.map((p) => p.id));
    const fill = players
      .filter((p) => !p.retired && !usedIds.has(p.id) && !chosen.has(p.id))
      .sort((a, b) => b.overall - a.overall);
    for (const p of fill) {
      if (bench.length >= cap) break;
      bench.push(p);
    }
    bench = bench.slice(0, cap);
  } else {
    bench = fixedLineup
      ? players.filter((p) => !usedIds.has(p.id) && !p.retired).sort((a, b) => b.overall - a.overall).slice(0, cap)
      : pickLineup(players, formation, cfg, true, weight, tactic, familiarity).bench;
  }

  const slotById = new Map(formation.slots.map((s) => [s.id, s]));
  const lineup: LineupEntry[] = picked.map((e) => ({
    slotPos: slotById.get(e.slotId)?.pos ?? "CM",
    player: toEnginePlayer(e.player),
    // Carried into the match so the Tactic Creator's per-slot brief can be read
    // (v1.99) — two slots can share a position and hold different briefs.
    slotId: e.slotId,
  }));
  // Only honour an assignment if that player is actually in the XI.
  const inXI = new Set(lineup.map((e) => e.player.id));
  const ifStarting = (id?: string) => (id && inXI.has(id) ? id : undefined);
  return {
    teamId,
    name,
    short,
    lineup,
    bench: bench.map(toEnginePlayer),
    tactic,
    coachMult,
    familiarity,
    captainId: ifStarting(assignments?.captainId),
    penaltyTakerId: ifStarting(assignments?.penaltyTakerId),
    freeKickTakerId: ifStarting(assignments?.freeKickTakerId),
    cornerTakerId: ifStarting(assignments?.cornerTakerId),
  };
}

/**
 * Aggregate strength used by the sim resolver and AI decisions.
 *
 * The XI weighted against the bench behind it (v1.91) — the same quantity
 * `squadOverall` reports, so a club's card and the table it finishes in are
 * built from one number. It used to be a flat mean of an XI picked in a
 * hardcoded 4-3-3 with the bench ignored, which said a club with no cover was
 * exactly as strong as one with a full squad; over a sim season that is how a
 * top-flight side with a thin bench slid two divisions.
 *
 * `formationId` lets a caller pass the club's OWN shape. It defaults to a 4-3-3
 * for callers that genuinely have no tactic in hand (the calibration harness).
 */
export function teamStrength(players: PlayerBio[], cfg: TuningConfig, formationId = "433"): number {
  const formation = getFormation(formationId);
  const { lineup, bench } = pickLineup(players, formation, cfg, false);
  if (!lineup.length) return 40;
  const mean = (ns: number[]) => ns.reduce((s, n) => s + n, 0) / ns.length;
  const starting = mean(lineup.map((e) => e.player.overall));
  if (!bench.length) return starting;
  return starting * cfg.squadOverallXIWeight + mean(bench.map((p) => p.overall)) * (1 - cfg.squadOverallXIWeight);
}

/**
 * A club's overall, split into the XI it would field and the bench behind it
 * (v1.90).
 *
 * How good a side IS is what its best eleven can do — a flat mean over the whole
 * squad answers a different question and answers it badly, because it is driven
 * by how many fringe players a club happens to carry. Two clubs with identical
 * first teams read 8 points apart if one keeps a 34-man roster and the other a
 * 22-man one, and signing a squad player made a club look WORSE. Registering
 * that as one number also hides the thing a manager actually wants to know
 * before a cup run: how far the quality falls when the XI is rested.
 *
 * Uses the club's OWN formation, so the number reflects the shape it plays
 * rather than a notional 4-3-3, and it is the same `pickLineup` the matchday
 * path calls — the card can't quote an XI the simulation wouldn't name. Fitness
 * is ignored (`respectFitness = false`): this is a description of the squad, not
 * of who is available on Saturday, and a card that dropped a rating because a
 * striker is carrying a knock would read as a permanent judgement on the club.
 *
 * `bench` is the matchday bench only — `benchCap(cfg)` players, ordered by the
 * same weighting the XI used — not "everyone else". The reserves beyond the
 * bench never take the field, so folding them in would put the squad-size
 * distortion straight back.
 */
export function squadOverall(
  players: PlayerBio[],
  formation: Formation,
  cfg: TuningConfig
): { starting: number; bench: number; overall: number; xiCount: number; benchCount: number } {
  const { lineup, bench } = pickLineup(players, formation, cfg, false);
  const mean = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : 0);
  const starting = mean(lineup.map((e) => e.player.overall));
  const benchAvg = mean(bench.map((p) => p.overall));
  // The headline weights the XI heavily: the bench matters, but it does not
  // matter equally — most minutes in a season are played by the eleven. A club
  // with no bench at all is judged on its XI rather than punished twice for the
  // shortage the bench figure already shows.
  const overall = bench.length
    ? starting * cfg.squadOverallXIWeight + benchAvg * (1 - cfg.squadOverallXIWeight)
    : starting;
  return {
    starting: Math.round(starting),
    bench: Math.round(benchAvg),
    overall: Math.round(overall),
    xiCount: lineup.length,
    benchCount: bench.length,
  };
}

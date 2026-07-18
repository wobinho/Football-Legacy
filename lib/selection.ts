// Squad selection: pick the best XI + bench for a formation. Used by AI
// clubs every matchday, by the harness, and as the user's auto-pick.

import type { PlayerBio, Pos, Tactic, TeamAssignments } from "./types";
import type { TuningConfig } from "./config/tuning";
import { getFormation, type Formation } from "./config/formations";
import { positionFit } from "./config/positions";
import type { EnginePlayer, LineupEntry, SideInput } from "./engine/match";

export function toEnginePlayer(p: PlayerBio): EnginePlayer {
  return {
    id: p.id,
    name: p.name,
    overall: p.overall,
    positions: p.positions,
    archetypeId: p.archetypeId,
    traits: p.traits,
    form: p.form,
    fitness: p.fitness,
  };
}

export function selectionScore(p: PlayerBio, slotPos: Pos, cfg: TuningConfig): number {
  const fit = positionFit(p.positions, slotPos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
  const fitness = cfg.fitnessFloorMult + (1 - cfg.fitnessFloorMult) * (p.fitness / 100);
  return p.overall * fit * fitness * p.form;
}

/**
 * Greedy assignment: fill the scarcest slots first (GK, then by candidate
 * count) so a lone striker isn't stolen by a wing slot.
 */
export function pickLineup(
  players: PlayerBio[],
  formation: Formation,
  cfg: TuningConfig,
  respectFitness = true
): { lineup: { slotId: string; player: PlayerBio }[]; bench: PlayerBio[] } {
  const available = players.filter((p) => !p.retired);
  const pool = new Set(available.map((p) => p.id));
  const byId = new Map(available.map((p) => [p.id, p]));
  const lineup: { slotId: string; player: PlayerBio }[] = [];

  const slots = formation.slots.slice().sort((a, b) => {
    const na = available.filter((p) => p.positions.includes(a.pos)).length;
    const nb = available.filter((p) => p.positions.includes(b.pos)).length;
    return na - nb;
  });

  for (const slot of slots) {
    let best: PlayerBio | null = null;
    let bestScore = -1;
    for (const id of pool) {
      const p = byId.get(id)!;
      if (respectFitness && p.fitness < cfg.minFitnessToStart && p.positions[0] !== "GK") continue;
      const score = selectionScore(p, slot.pos, cfg);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    // fallback: ignore the fitness gate rather than field 10 men
    if (!best) {
      for (const id of pool) {
        const p = byId.get(id)!;
        const score = selectionScore(p, slot.pos, cfg);
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

  const rest = [...pool].map((id) => byId.get(id)!).sort((a, b) => b.overall - a.overall);
  const bench: PlayerBio[] = [];
  const gk = rest.find((p) => p.positions[0] === "GK");
  if (gk) bench.push(gk);
  for (const p of rest) {
    if (bench.length >= cfg.matchdaySquad - 11) break;
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
  assignments?: TeamAssignments
): SideInput {
  const formation = getFormation(tactic.formationId);
  const picked = fixedLineup ?? pickLineup(players, formation, cfg).lineup;
  const usedIds = new Set(picked.map((e) => e.player.id));
  const bench = fixedLineup
    ? players.filter((p) => !usedIds.has(p.id) && !p.retired).sort((a, b) => b.overall - a.overall).slice(0, cfg.matchdaySquad - 11)
    : pickLineup(players, formation, cfg).bench;

  const slotById = new Map(formation.slots.map((s) => [s.id, s]));
  const lineup: LineupEntry[] = picked.map((e) => ({
    slotPos: slotById.get(e.slotId)?.pos ?? "CM",
    player: toEnginePlayer(e.player),
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
    captainId: ifStarting(assignments?.captainId),
    penaltyTakerId: ifStarting(assignments?.penaltyTakerId),
    freeKickTakerId: ifStarting(assignments?.freeKickTakerId),
    cornerTakerId: ifStarting(assignments?.cornerTakerId),
  };
}

/** Head-coach match-day edge: effective-rating multiplier. Data-driven from tuning. */
export function headCoachMult(stars: number, cfg: TuningConfig): number {
  return 1 + stars * cfg.headCoachMatchdayPerStar;
}

/** Aggregate strength used by the sim resolver and AI decisions. */
export function teamStrength(players: PlayerBio[], cfg: TuningConfig): number {
  const formation = getFormation("433");
  const { lineup } = pickLineup(players, formation, cfg, false);
  if (!lineup.length) return 40;
  return lineup.reduce((s, e) => s + e.player.overall, 0) / lineup.length;
}

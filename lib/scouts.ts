// ── The scouting department (§18, v14) ────────────────────────────────────
// Scouts used to be a single staff slot carrying one star rating. They are now
// a ROSTER: the club employs several, and each carries two independent 1–5★
// ratings that answer two different questions.
//
//   experience → HOW MANY prospects come back in one report (1–7)
//   judgement  → HOW GOOD they are (which ProspectTier, and how tight the read)
//
// How many scouts may be employed is the Max Scouts facility cap; the number
// employed is in turn the ceiling on concurrent assignments. Every roll here
// samples a tuning table indexed by star rating — the engine never branches on
// a rating's value (§ engine rule: table lookups only).

import type { GameState, ProspectTier, Scout, ScoutCandidate, Team } from "./types";
import type { TuningConfig } from "./config/tuning";
import { mulberry32, pick, pickWeighted, randInt, randRange, uid, type RNG } from "./rng";
import { NAME_POOLS } from "./config/names";

const SCOUT_NATS = ["ENG", "ESP", "ITA", "GER", "FRA", "NED", "POR", "BRA", "ARG", "SCO", "IRL", "BEL", "SWE", "SUI"];

function scoutName(rng: RNG): { name: string; nationality: string } {
  const nat = pick(rng, SCOUT_NATS);
  const pool = NAME_POOLS.find((p) => p.nat === nat) ?? NAME_POOLS[0];
  return { name: `${pick(rng, pool.first)} ${pick(rng, pool.last)}`, nationality: nat };
}

/** A scout is priced on both ratings together — a 5★/5★ talent-finder is the
 * expensive one, and a lopsided scout costs somewhere in between. */
export function scoutWage(cfg: TuningConfig, experience: number, judgement: number): number {
  return Math.round(cfg.scoutWageBase + (experience + judgement) * cfg.scoutWagePerStar);
}

export function scoutFee(cfg: TuningConfig, experience: number, judgement: number): number {
  return Math.round((experience + judgement) * (experience + judgement) * cfg.scoutFeePerStar);
}

export function userScouts(state: GameState): Scout[] {
  return state.teams[state.userTeamId]?.scouts ?? [];
}

export function scoutById(state: GameState, scoutId: string | undefined): Scout | undefined {
  if (!scoutId) return undefined;
  return userScouts(state).find((s) => s.id === scoutId);
}

/** Weekly wage bill for the scouting department — folded into staff wages. */
export function scoutWageBill(state: GameState): number {
  return userScouts(state).reduce((sum, s) => sum + s.wage, 0);
}

// ── Employment cap ────────────────────────────────────────────────────────
// The Max Scouts facility is now what it says on the tin: how many scouts the
// club may EMPLOY. Assignments are then capped by headcount, so buying the
// upgrade without hiring anyone changes nothing.

export function maxScouts(state: GameState, cfg: TuningConfig): number {
  const level = state.teams[state.userTeamId]?.scoutNetworkLevel ?? 0;
  return Math.min(cfg.scoutMaxHireable, cfg.scoutNetworkBase + level);
}

// ── Hiring market ─────────────────────────────────────────────────────────

export function generateScoutCandidates(rng: RNG, cfg: TuningConfig, count: number, availableDay?: number): ScoutCandidate[] {
  const out: ScoutCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const experience = randInt(rng, 1, 5);
    const judgement = randInt(rng, 1, 5);
    const { name, nationality } = scoutName(rng);
    out.push({
      id: uid("sct"),
      name,
      nationality,
      experience,
      judgement,
      wage: scoutWage(cfg, experience, judgement),
      fee: scoutFee(cfg, experience, judgement),
      availableDay,
    });
  }
  return out;
}

export function generateScoutMarket(seed: number, cfg: TuningConfig): ScoutCandidate[] {
  return generateScoutCandidates(mulberry32(seed), cfg, 6);
}

/** Top the shortlist back up to six, with new faces arriving in a couple of
 * days (same dismiss-to-refresh cadence as the staff market). */
export function refreshScoutMarket(state: GameState, cfg: TuningConfig) {
  const market = (state.scoutMarket ??= []);
  const missing = 6 - market.length;
  if (missing <= 0) return;
  const rng = mulberry32(state.seed ^ (state.currentDay * 2654435761));
  market.push(...generateScoutCandidates(rng, cfg, missing, state.currentDay + cfg.staffRefreshDays));
}

export function hireScout(state: GameState, candidateId: string, cfg: TuningConfig): string | null {
  const market = (state.scoutMarket ??= []);
  const cand = market.find((c) => c.id === candidateId);
  const team = state.teams[state.userTeamId];
  if (!cand) return "That scout is no longer available.";
  if (cand.availableDay !== undefined && cand.availableDay > state.currentDay) return "This scout hasn't arrived yet.";
  const roster = (team.scouts ??= []);
  if (roster.length >= maxScouts(state, cfg)) {
    return `You can only employ ${maxScouts(state, cfg)} scouts — upgrade Max Scouts to expand the department.`;
  }
  if (team.budget < cand.fee) return "Not enough budget for the signing fee.";
  team.budget -= cand.fee;
  roster.push({
    id: cand.id,
    name: cand.name,
    nationality: cand.nationality,
    experience: cand.experience,
    judgement: cand.judgement,
    wage: cand.wage,
  });
  state.scoutMarket = market.filter((c) => c.id !== candidateId);
  refreshScoutMarket(state, cfg);
  return null;
}

/** Let a scout go. Any assignment they were out on is recalled with them — the
 * brief belonged to that scout, so it can't outlive the employment. */
export function fireScout(state: GameState, scoutId: string, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const roster = team.scouts ?? [];
  if (!roster.some((s) => s.id === scoutId)) return "Not one of your scouts.";
  team.scouts = roster.filter((s) => s.id !== scoutId);
  state.academy.assignments = state.academy.assignments.filter((a) => a.scoutId !== scoutId);
  refreshScoutMarket(state, cfg);
  return null;
}

export function dismissScoutCandidate(state: GameState, candidateId: string, cfg: TuningConfig) {
  state.scoutMarket = (state.scoutMarket ?? []).filter((c) => c.id !== candidateId);
  refreshScoutMarket(state, cfg);
}

/** Daily tick: pending candidates whose arrival day has come become hireable. */
export function scoutMarketTick(state: GameState, cfg: TuningConfig) {
  state.scoutMarket ??= [];
  for (const c of state.scoutMarket) {
    if (c.availableDay !== undefined && c.availableDay <= state.currentDay) c.availableDay = undefined;
  }
  refreshScoutMarket(state, cfg);
}

// ── The two ratings, sampled ──────────────────────────────────────────────

function starRow(table: number[][], stars: number): number[] {
  const i = Math.min(Math.max(Math.round(stars), 1), table.length - 1);
  return table[i] ?? table[table.length - 1];
}

/** How many prospects this scout's next report brings back (1–7), sampled from
 * the experience row. A 1★ scout files a single name almost every time; a 5★
 * returns the full seven about half the time. */
export function rollReportSize(rng: RNG, cfg: TuningConfig, experience: number): number {
  const weights = starRow(cfg.scoutReportSizeByExperience, experience);
  const sizes = weights.map((_, i) => i + 1);
  return pickWeighted(rng, sizes, (n) => weights[n - 1]);
}

/** Which quality tier this find lands in, sampled from the judgement row. */
export function rollProspectTier(rng: RNG, cfg: TuningConfig, judgement: number): ProspectTier {
  const weights = starRow(cfg.scoutTierByJudgement, judgement);
  return pickWeighted(rng, cfg.prospectTierOrder, (t) => weights[cfg.prospectTierOrder.indexOf(t)] ?? 0);
}

/** The ability/ceiling band a tier grants. Sampled, not fixed, so two Gold
 * finds still differ from each other. */
export function rollTierQuality(
  rng: RNG,
  cfg: TuningConfig,
  tier: ProspectTier
): { overall: number; potential: number } {
  const band = cfg.prospectTierBands[tier] ?? cfg.prospectTierBands.bronze;
  const overall = randRange(rng, band.overall[0], band.overall[1]);
  const potential = Math.min(cfg.potentialAbsoluteCap, randRange(rng, band.potential[0], band.potential[1]));
  // A ceiling below current ability would read as a dead-end prospect; keep a
  // little headroom so every tier is worth developing.
  return { overall, potential: Math.max(potential, overall + 3) };
}

/** Expected prospects per report, for UI display (the mean of the row). */
export function expectedReportSize(cfg: TuningConfig, experience: number): number {
  const weights = starRow(cfg.scoutReportSizeByExperience, experience);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.reduce((sum, w, i) => sum + w * (i + 1), 0) / total;
}

/** Chance (0–1) this judgement turns up a given tier — for UI display. */
export function tierChance(cfg: TuningConfig, judgement: number, tier: ProspectTier): number {
  const weights = starRow(cfg.scoutTierByJudgement, judgement);
  const idx = cfg.prospectTierOrder.indexOf(tier);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return (weights[idx] ?? 0) / total;
}

/** Best judgement on the books — drives the fog-of-war read on other clubs'
 * players, where no single scout "owns" the report. */
export function bestJudgement(state: GameState): number {
  return userScouts(state).reduce((best, s) => Math.max(best, s.judgement), 0);
}

export function bestExperience(state: GameState): number {
  return userScouts(state).reduce((best, s) => Math.max(best, s.experience), 0);
}

/** A club with nobody on the books can't scout at all. */
export function hasScout(state: GameState): boolean {
  return userScouts(state).length > 0;
}

export const TIER_LABEL: Record<ProspectTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

/** Tier accent colours, used by the report cards and the scout roster. Diamond
 * gets a bright violet-white so a generational find is unmistakable next to
 * platinum's cyan. */
export const TIER_COLOR: Record<ProspectTier, string> = {
  bronze: "#b07a4a",
  silver: "#b9c0c8",
  gold: "#d9a441",
  platinum: "#7fe3e3",
  diamond: "#c9a6ff",
};

/** Seed the department for a brand-new save: an empty roster and a shortlist. */
export function initScoutMarket(state: GameState, cfg: TuningConfig) {
  state.teams[state.userTeamId].scouts ??= [];
  state.scoutMarket = generateScoutMarket(state.seed ^ 0x5c007, cfg);
}

export type { Scout, ScoutCandidate };

/** Total employed / cap, for headers. */
export function scoutHeadcount(state: GameState, cfg: TuningConfig): { hired: number; max: number } {
  return { hired: userScouts(state).length, max: maxScouts(state, cfg) };
}

/** Assignments are capped by headcount: a scout can only be in one place. */
export function assignmentCapacity(state: GameState): number {
  return userScouts(state).length;
}

/** Scouts not currently out on a brief — the pool "send a scout" draws from. */
export function idleScouts(state: GameState): Scout[] {
  const out = new Set(state.academy.assignments.map((a) => a.scoutId).filter(Boolean) as string[]);
  return userScouts(state).filter((s) => !out.has(s.id));
}

export function scoutTeam(state: GameState): Team {
  return state.teams[state.userTeamId];
}

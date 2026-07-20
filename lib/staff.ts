// Staff (§9): slot hires with star-rated buffs. No personalities, no drama.
// v6: staff carry a nationality (flag), are grouped into departments (Club /
// Development / Academy), and each slot offers 3 candidates you can dismiss to
// refresh — a dismissed slot goes vacant, then a new crop arrives ~2 days later.

import type { GameState, StaffCandidate, StaffSlot, StaffDept } from "./types";
import { TUNING } from "./config/tuning";
import { mulberry32, pick, randInt, uid, type RNG } from "./rng";
import { NAME_POOLS } from "./config/names";

export interface StaffSlotDef {
  slot: StaffSlot;
  /** Which page manages this hire (pure UI grouping). */
  dept: StaffDept;
  title: string;
  buff: string; // short one-liner
  /** Concrete, star-scaled effect (e.g. "+24% youth development"). null for dormant. */
  effectAt: ((stars: number) => string) | null;
  dormant?: string;
}

export const STAFF_SLOTS: StaffSlotDef[] = [
  // ── Development (coaching: match-day + fitness + growth) ──
  // v7: the match-day/fitness coaches moved here from the old Club → Staff tab,
  // alongside the development coaches. Club no longer manages staff.
  {
    slot: "headCoach",
    dept: "development",
    title: "Head Coach",
    buff: "Match-day edge",
    effectAt: (s) => (s > 0 ? `+${(s * 1).toFixed(0)}% match-day rating` : "No match-day bonus"),
  },
  {
    slot: "assistantCoach",
    dept: "development",
    title: "Assistant Coach",
    buff: "Backs the head coach",
    effectAt: (s) => (s > 0 ? `+${(s * 0.5).toFixed(1)}% match-day rating` : "No match-day bonus"),
  },
  {
    slot: "fitnessCoach",
    dept: "development",
    title: "Fitness Coach",
    buff: "Faster recovery",
    effectAt: (s) => (s > 0 ? `+${(s * 0.35).toFixed(1)} fitness/day` : "No recovery bonus"),
  },
  {
    slot: "physio",
    dept: "development",
    title: "Physio",
    buff: "Fresher legs",
    effectAt: (s) => (s > 0 ? `+${(s * 0.25).toFixed(2)} fitness/day` : "No recovery bonus"),
  },

  // ── Development (coaching that grows players) ──cont.
  {
    slot: "devCoach",
    dept: "development",
    title: "Development Coach",
    buff: "Faster growth",
    effectAt: (s) => (s > 0 ? `+${s * 8}% training speed` : "No development bonus"),
  },
  {
    slot: "gkCoach",
    dept: "development",
    title: "Goalkeeping Coach",
    buff: "Develops keepers",
    effectAt: (s) => (s > 0 ? `+${s * 8}% GK development` : "No goalkeeper bonus"),
  },

  // ── Academy (youth pipeline + scouting) ──
  {
    slot: "youthCoach",
    dept: "academy",
    title: "Youth Coach",
    buff: "Runs the academy",
    effectAt: (s) => (s > 0 ? `+${s * 8}% academy growth` : "No academy bonus"),
  },
  // The Scout slot was retired in v14 — scouting is now its own department (a
  // roster of scouts with experience/judgement ratings, see lib/scouts.ts),
  // managed from Academy → Staff rather than as a single staff appointment.
];

export const STAFF_SLOT_MAP: Record<StaffSlot, StaffSlotDef> = Object.fromEntries(
  STAFF_SLOTS.map((d) => [d.slot, d])
) as Record<StaffSlot, StaffSlotDef>;

export function staffSlotsForDept(dept: StaffDept): StaffSlotDef[] {
  return STAFF_SLOTS.filter((d) => d.dept === dept);
}

// Staff are drawn from a broad, football-y nationality mix (flags render for
// all of these — see lib/config/flags.ts).
const STAFF_NATS = ["ENG", "ESP", "ITA", "GER", "FRA", "NED", "POR", "BRA", "ARG", "SCO", "IRL", "BEL", "SWE", "SUI"];

function staffName(rng: RNG): { name: string; nationality: string } {
  const nat = pick(rng, STAFF_NATS);
  const pool = NAME_POOLS.find((p) => p.nat === nat) ?? NAME_POOLS[0];
  return { name: `${pick(rng, pool.first)} ${pick(rng, pool.last)}`, nationality: nat };
}

export function staffFee(stars: number): number {
  return stars * stars * 150_000;
}

export function staffWage(stars: number): number {
  return stars * stars * 4_000 + 6_000;
}

/** Generate the three candidates for one slot. `availableDay` marks a delayed
 * arrival (dismiss-to-refresh); omit for immediate availability. */
function generateSlotCandidates(rng: RNG, slot: StaffSlot, availableDay?: number): StaffCandidate[] {
  const out: StaffCandidate[] = [];
  for (let i = 0; i < 3; i++) {
    const stars = randInt(rng, 1, 5);
    const { name, nationality } = staffName(rng);
    out.push({
      id: uid("stf"),
      name,
      nationality,
      slot,
      stars,
      fee: staffFee(stars),
      wage: staffWage(stars),
      availableDay,
    });
  }
  return out;
}

export function generateStaffMarket(seed: number): StaffCandidate[] {
  const rng = mulberry32(seed);
  const out: StaffCandidate[] = [];
  for (const def of STAFF_SLOTS) {
    if (def.dormant) continue;
    out.push(...generateSlotCandidates(rng, def.slot));
  }
  return out;
}

export function hireStaff(state: GameState, candidateId: string): string | null {
  const cand = state.staffMarket.find((c) => c.id === candidateId);
  const team = state.teams[state.userTeamId];
  if (!cand) return "Candidate no longer available.";
  if (cand.availableDay !== undefined && cand.availableDay > state.currentDay) return "This candidate hasn't arrived yet.";
  if (team.budget < cand.fee) return "Not enough budget for the signing fee.";
  team.budget -= cand.fee;
  team.staff[cand.slot] = {
    id: cand.id,
    name: cand.name,
    nationality: cand.nationality,
    slot: cand.slot,
    stars: cand.stars,
    wage: cand.wage,
  };
  // clear every candidate for this slot — the market moves on once you hire
  state.staffMarket = state.staffMarket.filter((c) => c.slot !== cand.slot);
  return null;
}

/** Fire the currently appointed member of a slot. The position goes vacant and a
 * fresh shortlist is scheduled to arrive in ~2 days, exactly like a cleared
 * dismiss-to-refresh. No severance/fee — v1 uses an aggregate wage bill, so the
 * only cost is losing the buff until you appoint someone new. */
export function fireStaff(state: GameState, slot: StaffSlot): string | null {
  const team = state.teams[state.userTeamId];
  if (!team.staff[slot]) return "That position is already vacant.";
  team.staff[slot] = undefined;
  // give the player a fresh crop to choose a replacement from, if none is pending
  const hasReady = state.staffMarket.some((c) => c.slot === slot && (c.availableDay === undefined || c.availableDay <= state.currentDay));
  if (!hasReady) scheduleSlotRefresh(state, slot);
  return null;
}

/** Dismiss a single candidate from the shortlist. If it empties the slot, a new
 * crop is scheduled to arrive in ~2 days (§ dismiss-to-refresh). */
export function dismissCandidate(state: GameState, candidateId: string): string | null {
  const cand = state.staffMarket.find((c) => c.id === candidateId);
  if (!cand) return "Candidate no longer available.";
  const slot = cand.slot;
  state.staffMarket = state.staffMarket.filter((c) => c.id !== candidateId);
  const remaining = state.staffMarket.filter((c) => c.slot === slot);
  // only regenerate once the whole shortlist is cleared, and only if a refresh
  // isn't already pending for this slot
  if (remaining.length === 0) {
    scheduleSlotRefresh(state, slot);
  }
  return null;
}

/** Queue a fresh set of candidates for a slot, arriving ~2 days from now. */
export function scheduleSlotRefresh(state: GameState, slot: StaffSlot) {
  const arrival = state.currentDay + TUNING.staffRefreshDays;
  const rng = mulberry32(state.seed ^ (slot.length * 2654435761) ^ (state.currentDay * 40503));
  const fresh = generateSlotCandidates(rng, slot, arrival);
  // strip any stale entries for this slot, then queue the delayed batch
  state.staffMarket = state.staffMarket.filter((c) => c.slot !== slot);
  state.staffMarket.push(...fresh);
}

/** Daily tick: any pending refreshed candidates whose arrival day has come
 * become immediately available (drop the availableDay flag). */
export function staffMarketTick(state: GameState) {
  for (const c of state.staffMarket) {
    if (c.availableDay !== undefined && c.availableDay <= state.currentDay) {
      c.availableDay = undefined;
    }
  }
}

export function staffStars(state: GameState, teamId: string, slot: StaffSlot): number {
  return state.teams[teamId]?.staff[slot]?.stars ?? 0;
}

/** The whole backroom wage bill: appointed staff plus the scouting department
 * (v14 — scouts are a roster, not a staff slot, but they're paid the same way). */
export function userStaffWages(state: GameState): number {
  const team = state.teams[state.userTeamId];
  const staff = Object.values(team.staff).reduce((s, m) => s + (m?.wage ?? 0), 0);
  const scouts = (team.scouts ?? []).reduce((s, sc) => s + sc.wage, 0);
  return staff + scouts;
}

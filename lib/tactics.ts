// ── Saved tactics (v1.53) ─────────────────────────────────────────────────
// Picking a formation clears the starting XI, because the slots themselves
// change — a 4-3-3's RW has no counterpart in a 3-5-2. That is right, but it
// makes a mis-click expensive: the whole side has to be rebuilt by hand.
//
// A saved tactic is the answer. It captures the three things that are lost
// together — the instructions, the XI, and the bench order — under a name the
// manager chose, and restores them in one action. Presets are a plain list on
// the save; there is no "active" preset and nothing here runs on a tick, so a
// manager who never opens the feature is unaffected by it.
//
// Loading is deliberately forgiving. Player IDs go stale: a preset saved three
// seasons ago names players since sold, retired or sent out on loan, and a
// formation could in principle be removed from the game. Rather than refuse,
// `loadSavedTactic` restores whatever part of the preset is still legal and
// reports what it had to drop, so an old preset is always worth loading.

import type { AttrKey } from "./config/attributes";
import type { GameState, PlayerBio, SavedTactic, Tactic, TeamAssignments } from "./types";
import { getFormation, styleLabel } from "./config/formations";
import { TUNING } from "./config/tuning";
import { uid } from "./rng";

/** How many presets a manager may keep. Generous enough for home/away/European
 * variants and a couple of experiments, bounded so the save can't grow without
 * limit from a button that is cheap to press. */
export const MAX_SAVED_TACTICS = 8;

export function savedTactics(state: GameState): SavedTactic[] {
  return state.savedTactics ?? [];
}

/**
 * Scrub a player out of every tactical slot he can no longer legally fill: the
 * live starting XI, the named bench, and every saved-tactic preset.
 *
 * Called the instant a player leaves the user's control — sold, released, or
 * gone out on loan. The match engine already refuses to field a departed player
 * (`ensureUserLineup` filters the XI at kickoff), so this is not what keeps a
 * sold player off the pitch. What it fixes is the *stale reference*: without it
 * a saved tactic keeps naming a player who's no longer at the club, so loading
 * that preset — or reading its "11 starters" summary — silently reintroduces a
 * ghost that the pre-match filter then has to strip again. Purging at the source
 * keeps every stored lineup honest, which is what closes the door on loading a
 * player back into the XI after he's been moved on.
 */
export function purgePlayerFromTactics(state: GameState, playerId: string) {
  if (state.lineup) {
    for (const [slot, id] of Object.entries(state.lineup)) {
      if (id === playerId) delete state.lineup[slot];
    }
  }
  if (state.userBench) {
    state.userBench = state.userBench.filter((id) => id !== playerId);
  }
  for (const preset of state.savedTactics ?? []) {
    for (const [slot, id] of Object.entries(preset.lineup)) {
      if (id === playerId) delete preset.lineup[slot];
    }
    preset.bench = preset.bench.filter((id) => id !== playerId);
  }
}

/**
 * Capture the current setup under `name`.
 *
 * Saving over an existing name overwrites that preset in place rather than
 * adding a second one — "Home 4-3-3" should mean one thing, and re-saving after
 * a tweak is the common case. Names are compared case-insensitively and trimmed,
 * so "home" and "Home " are the same preset.
 *
 * Returns an error string on failure (empty name, list full), null on success.
 */
export function saveTactic(state: GameState, rawName: string): string | null {
  const name = rawName.trim();
  if (!name) return "Give the tactic a name.";
  if (name.length > 32) return "That name is too long — 32 characters at most.";

  const list = (state.savedTactics ??= []);
  const existing = list.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing === -1 && list.length >= MAX_SAVED_TACTICS) {
    return `You can keep ${MAX_SAVED_TACTICS} saved tactics — delete one to make room.`;
  }

  const team = state.teams[state.userTeamId];
  const preset: SavedTactic = {
    id: existing === -1 ? uid("tac") : list[existing].id,
    name,
    // Deep-copied, or a later instruction change would silently rewrite the
    // preset that was supposed to be a snapshot.
    tactic: { ...team.tactic },
    lineup: { ...state.lineup },
    bench: [...(state.userBench ?? [])],
    season: state.season,
    day: state.currentDay,
  };

  if (existing === -1) list.unshift(preset);
  else list[existing] = preset;
  return null;
}

export function deleteSavedTactic(state: GameState, id: string) {
  state.savedTactics = savedTactics(state).filter((t) => t.id !== id);
}

export function renameSavedTactic(state: GameState, id: string, rawName: string): string | null {
  const name = rawName.trim();
  if (!name) return "Give the tactic a name.";
  if (name.length > 32) return "That name is too long — 32 characters at most.";
  const list = savedTactics(state);
  if (list.some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
    return "You already have a tactic with that name.";
  }
  const preset = list.find((t) => t.id === id);
  if (!preset) return "That tactic is no longer saved.";
  preset.name = name;
  return null;
}

/** What a load actually managed to restore, so the UI can be honest about it. */
export interface LoadTacticResult {
  /** Slots the preset named that couldn't be filled — the player is gone, on
   * loan, or no longer in the senior squad. */
  missingSlots: number;
  /** Named substitutes that couldn't be restored, for the same reasons. */
  missingSubs: number;
}

/**
 * Restore a preset over the current setup.
 *
 * The instructions always apply in full. The XI and bench are filtered to
 * players who can actually be fielded today: on the senior roster, alive, and
 * not away on loan. A slot the formation no longer has is dropped too, which is
 * what makes a preset survive a formation being retired from the game.
 *
 * Returns null if the preset is gone, otherwise a report of what was dropped.
 */
export function loadSavedTactic(state: GameState, id: string): LoadTacticResult | null {
  const preset = savedTactics(state).find((t) => t.id === id);
  if (!preset) return null;

  const team = state.teams[state.userTeamId];
  team.tactic = { ...preset.tactic };

  const fieldable = new Set(
    team.playerIds.filter((pid) => {
      const p = state.players[pid];
      return !!p && !p.retired && !p.loan;
    })
  );
  const slots = new Set(getFormation(preset.tactic.formationId).slots.map((s) => s.id));

  const lineup: Record<string, string> = {};
  const taken = new Set<string>();
  let missingSlots = 0;
  for (const [slotId, pid] of Object.entries(preset.lineup)) {
    if (!slots.has(slotId)) continue; // slot no longer exists in this formation
    if (!fieldable.has(pid) || taken.has(pid)) {
      missingSlots++;
      continue;
    }
    lineup[slotId] = pid;
    taken.add(pid);
  }
  state.lineup = lineup;

  const cap = TUNING.matchdaySquad - 11;
  const bench: string[] = [];
  let missingSubs = 0;
  for (const pid of preset.bench) {
    if (bench.length >= cap) break;
    // A player can never be both a starter and a substitute, so anyone the XI
    // above claimed is skipped rather than double-counted as missing.
    if (taken.has(pid)) continue;
    if (!fieldable.has(pid)) {
      missingSubs++;
      continue;
    }
    bench.push(pid);
    taken.add(pid);
  }
  state.userBench = bench;

  return { missingSlots, missingSubs };
}

/** One-line summary of a preset's instructions, for the preset list. */
export function tacticSummary(t: Tactic): string {
  const formation = getFormation(t.formationId);
  return `${formation.name} · ${t.mentality} · ${styleLabel(t.style)}`;
}

// ── Auto-assign (v1.69) ───────────────────────────────────────────────────
// Captain and the three set-piece takers are four dropdowns over the same XI,
// and the right answer to each is legible from the attributes — a manager
// scrolling four pickers to find who has the best Penalties is doing arithmetic
// the game can do for him. Auto-assign fills all four with the best man in slot.
//
// Scoring is a TABLE, in the same spirit as the rest of the config: each role
// names the attributes that decide it and the trait that is ideal for it. Adding
// a role means adding a row, never a branch. Nothing here reads an archetype by
// name (§ the engine rule) — the trait bonus is a flat multiplier looked up by id.

interface RoleSpec {
  role: keyof TeamAssignments;
  /** Attributes that decide the role, with their relative weights. */
  attrs: Partial<Record<AttrKey, number>>;
  /** Trait id that makes a player ideal here, and how much it is worth. */
  trait?: { id: string; mult: number };
  /** Weight on raw overall, so a far better footballer wins a near-tie. */
  overallWeight: number;
  /** A keeper is a legal captain but never a set-piece taker. */
  allowGk?: boolean;
}

/**
 * What each on-pitch role actually wants.
 *
 * The trait multipliers are deliberately decisive but not absolute (a
 * Dead-Ball Specialist is worth roughly a 25-point attribute edge): the engine
 * gives the designated taker a real bonus for the trait, so it should dominate a
 * marginal attribute gap — but a Dead-Ball Specialist who cannot pass should
 * still lose the corners to a genuine crosser.
 */
const ROLE_SPECS: RoleSpec[] = [
  {
    // No "leadership" attribute exists, so the armband goes to the composed,
    // aggressive, positionally-aware professional — plus a strong pull toward
    // experience, since a 19-year-old is rarely the right captain.
    role: "captainId",
    attrs: { composure: 1, aggression: 0.5, reactions: 0.4, positioning: 0.3 },
    trait: { id: "leader", mult: 1.3 },
    overallWeight: 0.6,
    allowGk: true,
  },
  {
    role: "penaltyTakerId",
    attrs: { penalties: 1, composure: 0.6, finishing: 0.5, shotPower: 0.3 },
    trait: { id: "dead_ball", mult: 1.25 },
    overallWeight: 0.15,
  },
  {
    role: "freeKickTakerId",
    attrs: { fkAccuracy: 1, curve: 0.5, shotPower: 0.4, longShots: 0.3 },
    trait: { id: "dead_ball", mult: 1.25 },
    overallWeight: 0.15,
  },
  {
    role: "cornerTakerId",
    attrs: { crossing: 1, curve: 0.6, vision: 0.4, longPassing: 0.3 },
    trait: { id: "maestro", mult: 1.2 },
    overallWeight: 0.15,
  },
];

/** Extra weight on age for the armband: peaks in the late twenties. Captaincy is
 * the one role where being a senior figure in the dressing room matters more than
 * being the best footballer on the pitch. */
function captaincyAgeMult(age: number): number {
  if (age >= 27 && age <= 34) return 1.15;
  if (age >= 24) return 1.05;
  if (age >= 21) return 0.95;
  return 0.85;
}

/** How well `p` suits `spec`. Higher is better; never negative. */
function roleScore(p: PlayerBio, spec: RoleSpec): number {
  let sum = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(spec.attrs) as [AttrKey, number][]) {
    sum += (p.attrs[key] ?? 0) * w;
    weight += w;
  }
  let score = (weight > 0 ? sum / weight : 0) + p.overall * spec.overallWeight;
  if (spec.trait && p.traits.includes(spec.trait.id)) score *= spec.trait.mult;
  if (spec.role === "captainId") score *= captaincyAgeMult(p.age);
  return Math.max(0, score);
}

/** What an auto-assign actually changed, so the UI can say something specific. */
export interface AutoAssignResult {
  /** How many of the four roles now name a different player than before. */
  changed: number;
  /** The XI was empty, so nothing could be assigned. */
  noXi: boolean;
}

/**
 * Fill every on-pitch assignment with the best man in the current starting XI.
 *
 * Roles are independent by design — the captain may well also be the penalty
 * taker, exactly as at a real club — so this makes four separate best-in-slot
 * picks rather than distributing the four roles across four different players.
 *
 * Only the fielded XI is considered: an assignment held by someone on the bench
 * is ignored by the engine (`buildSideInput` drops it), so offering it here would
 * be a setting that silently does nothing.
 */
export function autoAssignRoles(state: GameState): AutoAssignResult {
  const team = state.teams[state.userTeamId];
  const xi = Object.values(state.lineup ?? {})
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired);

  if (xi.length === 0) return { changed: 0, noXi: true };

  const assignments = (team.assignments ??= {});
  let changed = 0;
  for (const spec of ROLE_SPECS) {
    const pool = spec.allowGk ? xi : xi.filter((p) => p.positions[0] !== "GK");
    // A side of eleven keepers is not a real case, but a one-man XI mid-pick is:
    // fall back to the whole XI rather than leaving the role empty.
    const candidates = pool.length > 0 ? pool : xi;
    let best: PlayerBio | null = null;
    let bestScore = -1;
    for (const p of candidates) {
      const score = roleScore(p, spec);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) continue;
    if (assignments[spec.role] !== best.id) changed++;
    assignments[spec.role] = best.id;
  }
  return { changed, noXi: false };
}

/** The best man in the XI for one role — what the per-row "best fit" hint reads.
 * Returns null when the XI is empty. */
export function bestForRole(state: GameState, role: keyof TeamAssignments): PlayerBio | null {
  const spec = ROLE_SPECS.find((r) => r.role === role);
  if (!spec) return null;
  const xi = Object.values(state.lineup ?? {})
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired);
  const pool = spec.allowGk ? xi : xi.filter((p) => p.positions[0] !== "GK");
  const candidates = pool.length > 0 ? pool : xi;
  let best: PlayerBio | null = null;
  let bestScore = -1;
  for (const p of candidates) {
    const score = roleScore(p, spec);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

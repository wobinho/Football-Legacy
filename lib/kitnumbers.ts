// ── Shirt numbers (v15) ───────────────────────────────────────────────────
// Every player attached to a club wears a number, unique within that club's
// senior squad. The academy numbers separately (a club's #9 and its academy #9
// are different shirts), so the uniqueness scope is always "the roster this
// player sits on".
//
// Assignment is table-driven: each position has a preference order drawn from
// the classic numbering (1 keeper, 2–6 defenders, 4/6/8 midfield, 7/9/10/11
// forwards). A joining player takes the lowest-numbered shirt he'd prefer that
// is still free, and falls back to the first free number in 1..99 if his whole
// preference list is taken. Nothing here is random, so a squad's numbering is
// stable across a save and reproducible from the same roster.

import type { GameState, PlayerBio, Pos, Team } from "./types";

export const MIN_KIT_NUMBER = 1;
export const MAX_KIT_NUMBER = 99;

/** Preferred shirt numbers per primary position, best first. Pure data — the
 * assigner never special-cases a position beyond this lookup. */
const PREFERRED: Record<Pos, number[]> = {
  GK: [1, 13, 25, 31, 12],
  CB: [4, 5, 6, 3, 2, 15, 22, 24],
  LB: [3, 5, 12, 15, 23, 33],
  RB: [2, 12, 20, 22, 24, 32],
  DM: [6, 4, 16, 18, 8, 14],
  CM: [8, 6, 14, 16, 18, 20],
  LM: [11, 7, 14, 16, 20, 26],
  RM: [7, 11, 14, 16, 20, 26],
  AM: [10, 8, 20, 21, 14, 18],
  LW: [11, 7, 17, 19, 27, 30],
  RW: [7, 11, 17, 19, 26, 30],
  ST: [9, 10, 19, 21, 29, 39],
};

/** Which roster a player sits on for numbering purposes. Senior and academy
 * squads number independently. */
function rosterIdsFor(team: Team, playerId: string): string[] {
  const academy = team.academyPlayerIds ?? [];
  return academy.includes(playerId) ? academy : team.playerIds;
}

/** Numbers already worn on a roster, optionally ignoring one player (so a
 * re-assignment doesn't collide with the player's own current shirt). */
function takenOn(state: GameState, ids: string[], exceptId?: string): Set<number> {
  const taken = new Set<number>();
  for (const id of ids) {
    if (id === exceptId) continue;
    const n = state.players[id]?.kitNumber;
    if (typeof n === "number") taken.add(n);
  }
  return taken;
}

/** The shirt a player would be given on a roster: his position's first free
 * preference, else the lowest free number overall. Returns null only if all 99
 * shirts are somehow taken. */
function pickNumber(taken: Set<number>, pos: Pos): number | null {
  for (const n of PREFERRED[pos] ?? []) {
    if (!taken.has(n)) return n;
  }
  for (let n = MIN_KIT_NUMBER; n <= MAX_KIT_NUMBER; n++) {
    if (!taken.has(n)) return n;
  }
  return null;
}

/** Give one player a shirt on his current club roster, if he has none. Used
 * when a player joins a club (transfer, promotion, intake, free signing). */
export function assignKitNumber(state: GameState, player: PlayerBio): void {
  if (typeof player.kitNumber === "number") return;
  const team = player.clubId ? state.teams[player.clubId] : null;
  if (!team) return;
  const ids = rosterIdsFor(team, player.id);
  const n = pickNumber(takenOn(state, ids, player.id), player.positions[0]);
  if (n !== null) player.kitNumber = n;
}

/** Clear a player's shirt — called when he leaves a club, so the number frees
 * up for the squad he left and he re-numbers at his new one. */
export function clearKitNumber(player: PlayerBio): void {
  player.kitNumber = undefined;
}

/**
 * Number every unnumbered player on a roster in a stable order: best players
 * first, so the squad's stars get the low, classic shirts. Players who already
 * hold a number keep it. Used at world generation and on save migration.
 */
export function assignSquadNumbers(state: GameState, ids: string[]): void {
  const players = ids.map((id) => state.players[id]).filter((p): p is PlayerBio => !!p);
  const taken = new Set<number>();
  for (const p of players) {
    if (typeof p.kitNumber === "number") taken.add(p.kitNumber);
  }
  // Deliberate order: keepers first (so #1 goes to the best keeper), then
  // outfielders by ability. Numbering is a squad hierarchy statement.
  const unnumbered = players
    .filter((p) => typeof p.kitNumber !== "number")
    .sort((a, b) => {
      const ga = a.positions[0] === "GK" ? 0 : 1;
      const gb = b.positions[0] === "GK" ? 0 : 1;
      return ga - gb || b.overall - a.overall;
    });
  for (const p of unnumbered) {
    const n = pickNumber(taken, p.positions[0]);
    if (n === null) break;
    p.kitNumber = n;
    taken.add(n);
  }
}

/** Number every club in the world that has unnumbered players (senior + academy
 * rosters separately). Idempotent — existing numbers are never disturbed. */
export function assignAllKitNumbers(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    assignSquadNumbers(state, team.playerIds);
    if (team.academyPlayerIds?.length) assignSquadNumbers(state, team.academyPlayerIds);
  }
}

/**
 * Set a player's shirt number. If another player on the same roster already
 * wears it, the two SWAP — the incumbent takes the number being vacated, which
 * is what a real squad does and what the user expects when they type a taken
 * number. Returns an error string, or null on success.
 */
export function setKitNumber(state: GameState, playerId: string, next: number): string | null {
  const p = state.players[playerId];
  if (!p) return "Unknown player.";
  if (!Number.isInteger(next) || next < MIN_KIT_NUMBER || next > MAX_KIT_NUMBER) {
    return `Shirt numbers run from ${MIN_KIT_NUMBER} to ${MAX_KIT_NUMBER}.`;
  }
  const team = p.clubId ? state.teams[p.clubId] : null;
  if (!team) return "That player isn't at a club.";
  if (p.kitNumber === next) return null;

  const ids = rosterIdsFor(team, playerId);
  const incumbent = ids
    .map((id) => state.players[id])
    .find((x) => x && x.id !== playerId && x.kitNumber === next);

  const previous = p.kitNumber;
  p.kitNumber = next;
  if (incumbent) {
    // Swap: the displaced player takes the vacated shirt. If the mover had no
    // number yet there's nothing to hand over, so the incumbent re-numbers from
    // whatever is free rather than being left wearing a duplicate.
    if (typeof previous === "number") {
      incumbent.kitNumber = previous;
    } else {
      incumbent.kitNumber = undefined;
      assignKitNumber(state, incumbent);
    }
  }
  return null;
}

/** Everyone on the player's roster who currently wears a number, for the UI's
 * "taken" hints. */
export function squadNumbersFor(state: GameState, playerId: string): Map<number, string> {
  const p = state.players[playerId];
  const team = p?.clubId ? state.teams[p.clubId] : null;
  const out = new Map<number, string>();
  if (!p || !team) return out;
  for (const id of rosterIdsFor(team, playerId)) {
    const other = state.players[id];
    if (other && typeof other.kitNumber === "number") out.set(other.kitNumber, other.name);
  }
  return out;
}

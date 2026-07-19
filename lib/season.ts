// Season Manager (§ module map): fixture generation (double round-robin),
// league tables, promotion/relegation, and the knockout cup.

import type { CupState, Fixture, GameState, TableRow } from "./types";
import { mulberry32, deriveSeed, shuffle } from "./rng";

let fixtureCounter = 0;
function fid(): string {
  return `f${(++fixtureCounter).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Double round-robin via the circle method; second half mirrors venues. */
export function generateLeagueFixtures(
  leagueId: string,
  teamIds: string[],
  roundDays: number[],
  seed: number
): Fixture[] {
  const rng = mulberry32(deriveSeed(seed, `fixtures:${leagueId}`));
  const order = shuffle(rng, teamIds);
  const n = order.length; // must be even
  const rounds = n - 1;
  const fixtures: Fixture[] = [];

  const rotating = order.slice(1);
  for (let r = 0; r < rounds; r++) {
    const pairing: [string, string][] = [];
    const left = [order[0], ...rotating.slice(0, (n - 2) / 2)];
    const right = rotating.slice((n - 2) / 2).reverse();
    for (let i = 0; i < n / 2; i++) {
      // alternate home/away for the fixed team to avoid streaks
      const [a, b] = i === 0 && r % 2 === 1 ? [right[i], left[i]] : [left[i], right[i]];
      pairing.push([a, b]);
    }
    pairing.forEach(([homeId, awayId]) => {
      fixtures.push({
        id: fid(),
        day: roundDays[r],
        competition: leagueId,
        round: r + 1,
        homeId,
        awayId,
        played: false,
      });
      fixtures.push({
        id: fid(),
        day: roundDays[r + rounds],
        competition: leagueId,
        round: r + rounds + 1,
        homeId: awayId,
        awayId: homeId,
        played: false,
      });
    });
    rotating.push(rotating.shift()!);
  }
  return fixtures;
}

export function computeTable(fixtures: Fixture[], leagueId: string, teamIds: string[]): TableRow[] {
  const rows = new Map<string, TableRow>(
    teamIds.map((id) => [id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }])
  );
  for (const f of fixtures) {
    if (f.competition !== leagueId || !f.played) continue;
    const h = rows.get(f.homeId);
    const a = rows.get(f.awayId);
    if (!h || !a) continue;
    const hg = f.homeGoals!;
    const ag = f.awayGoals!;
    h.played++; a.played++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.won++; a.lost++; h.points += 3; }
    else if (hg < ag) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  return [...rows.values()].sort(
    (x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf
  );
}

// ── Cup (§4: one simple knockout cup) ────────────────────────────────────
// 40 entrants: Round 1 trims 16 low-reputation clubs to 8, giving a clean
// 32-team bracket from Round 2. Draws are random each round.

export const CUP_ROUND_NAMES = ["First Round", "Second Round", "Third Round", "Quarter-Final", "Semi-Final", "Final"];

export function initCup(teamIds: string[]): CupState {
  return {
    aliveTeamIds: teamIds.slice(),
    currentRound: 0,
    winnerId: null,
    roundNames: CUP_ROUND_NAMES,
  };
}

/** Create fixtures for the cup round about to be played. */
export function drawCupRound(
  state: GameState,
  roundIndex: number,
  seed: number
): Fixture[] {
  const rng = mulberry32(deriveSeed(seed, `cupdraw:${state.season}:${roundIndex}`));
  const day = state.schedule.cupRoundDays[roundIndex];
  let entrants: string[];

  if (roundIndex === 0) {
    // 16 lowest-reputation clubs contest round one; the rest get a bye
    const sorted = state.cup.aliveTeamIds
      .slice()
      .sort((a, b) => state.teams[a].reputation - state.teams[b].reputation);
    entrants = shuffle(rng, sorted.slice(0, 16));
  } else {
    entrants = shuffle(rng, state.cup.aliveTeamIds);
  }

  const fixtures: Fixture[] = [];
  for (let i = 0; i + 1 < entrants.length; i += 2) {
    fixtures.push({
      id: fid(),
      day,
      competition: "CUP",
      round: roundIndex + 1,
      homeId: entrants[i],
      awayId: entrants[i + 1],
      played: false,
    });
  }
  // byes stay alive implicitly (they're still in aliveTeamIds)
  return fixtures;
}

/** After a cup round's fixtures are played, advance the bracket. */
export function settleCupRound(state: GameState, roundIndex: number) {
  const roundFixtures = state.fixtures.filter(
    (f) => f.competition === "CUP" && f.round === roundIndex + 1 && f.played
  );
  const losers = new Set<string>();
  for (const f of roundFixtures) {
    const winner = f.homeGoals! > f.awayGoals! ? f.homeId : f.awayId; // engine guarantees no cup draws via shootout resolution
    losers.add(winner === f.homeId ? f.awayId : f.homeId);
  }
  state.cup.aliveTeamIds = state.cup.aliveTeamIds.filter((id) => !losers.has(id));
  state.cup.currentRound = roundIndex + 1;
  if (roundIndex === state.schedule.cupRoundDays.length - 1 && state.cup.aliveTeamIds.length === 1) {
    state.cup.winnerId = state.cup.aliveTeamIds[0];
  }
}

/** Promotion/relegation between the playable country's two divisions (3 up, 3
 * down). Reads state.divisionIds [top, second] so it works for any country
 * (v7) — no hardcoded league ids. A single-division country is a no-op. */
export function applyPromotionRelegation(state: GameState): { promoted: string[]; relegated: string[] } {
  const [topId, secondId] = state.divisionIds;
  if (topId === secondId) return { promoted: [], relegated: [] };
  const d1 = state.leagues[topId];
  const d2 = state.leagues[secondId];
  if (!d1 || !d2) return { promoted: [], relegated: [] };
  const t1 = computeTable(state.fixtures, topId, d1.teamIds);
  const t2 = computeTable(state.fixtures, secondId, d2.teamIds);
  const relegated = t1.slice(-3).map((r) => r.teamId);
  const promoted = t2.slice(0, 3).map((r) => r.teamId);

  d1.teamIds = [...t1.slice(0, -3).map((r) => r.teamId), ...promoted];
  d2.teamIds = [...relegated, ...t2.slice(3).map((r) => r.teamId)];
  for (const id of promoted) state.teams[id].leagueId = topId;
  for (const id of relegated) state.teams[id].leagueId = secondId;
  return { promoted: promoted.map((id) => state.teams[id].name), relegated: relegated.map((id) => state.teams[id].name) };
}

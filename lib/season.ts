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

/** A single recent-result token from a team's perspective. */
export type FormResult = "W" | "D" | "L";

/** Last-N league form per team (default 5), oldest→newest so the row reads
 * left-to-right like a real form guide. Derived from the same played fixtures as
 * the table, so it stays in lockstep with it. Only meaningful for playable
 * leagues (sim leagues carry no per-fixture data — they return empty). */
export function computeForm(
  fixtures: Fixture[],
  leagueId: string,
  teamIds: string[],
  n = 5
): Record<string, FormResult[]> {
  // Chronological, tie-broken by round then id so replays are stable.
  const played = fixtures
    .filter((f) => f.competition === leagueId && f.played)
    .sort((a, b) => a.day - b.day || a.round - b.round || a.id.localeCompare(b.id));

  const form: Record<string, FormResult[]> = Object.fromEntries(teamIds.map((id) => [id, []]));
  for (const f of played) {
    const hg = f.homeGoals!;
    const ag = f.awayGoals!;
    const home = form[f.homeId];
    const away = form[f.awayId];
    if (home) home.push(hg > ag ? "W" : hg < ag ? "L" : "D");
    if (away) away.push(ag > hg ? "W" : ag < hg ? "L" : "D");
  }
  // Keep only the last n, preserving oldest→newest order within that window.
  for (const id of teamIds) form[id] = form[id].slice(-n);
  return form;
}

// ── Cup (§4: one simple knockout cup) ────────────────────────────────────
// Every club in the playable country's pyramid enters, so the field is however
// many clubs that pyramid holds: 20 for a single division, 40 for two tiers, 60
// for three, 80 for the shipped four-tier English pyramid. The bracket is a
// fixed six rounds, and the schedule can't grow one, so each round is sized to
// hit the target that leaves the final as a one-match decider: after round N,
// 2^(5−N) clubs remain (32 → 16 → 8 → 4 → 2 → 1). A round therefore stages
// exactly as many ties as it needs to reach its target and BYES everyone else,
// with the byes going to the highest-reputation clubs — a minnow plays its way
// through, a giant enters later, which is how a real cup is seeded.
//
// This replaces a fixed "the 16 lowest-reputation clubs contest round one". That
// arithmetic was written for a 40-club field (40 − 8 = 32) and silently broke
// the cup on every other pyramid: a 60-club three-tier save arrived at the final
// with two clubs still alive and an 80-club four-tier save with three, so
// `winnerId` was never set and the season review showed no cup winner at all —
// for every season of the save.

/** How many clubs should still be standing after round `roundIndex` (0-based) of
 * a six-round cup: 32, 16, 8, 4, 2, then 1. */
export function cupTargetAfterRound(roundIndex: number, totalRounds: number): number {
  return Math.pow(2, Math.max(0, totalRounds - 1 - roundIndex));
}

/**
 * How many ties round `roundIndex` stages, given how many clubs are still alive.
 *
 * One tie eliminates exactly one club, so the count is the excess over this
 * round's target — clamped to what the field can actually pair off (a round can
 * never play more than ⌊alive/2⌋ ties). When the field is already at or below
 * target the round still halves it rather than standing idle, which is what
 * keeps a small pyramid moving toward a single winner.
 */
export function cupTiesForRound(alive: number, roundIndex: number, totalRounds: number): number {
  const target = cupTargetAfterRound(roundIndex, totalRounds);
  const maxTies = Math.floor(alive / 2);
  if (alive <= target) return maxTies; // already lean — just halve
  return Math.min(alive - target, maxTies);
}

export const CUP_ROUND_NAMES = ["First Round", "Second Round", "Third Round", "Quarter-Final", "Semi-Final", "Final"];

/** The largest field six knockout rounds can reduce to a single winner: each
 * round can at best halve the field, so six rounds resolve 2^6 = 64. */
export const CUP_MAX_ENTRANTS = 2 ** CUP_ROUND_NAMES.length; // 64

/**
 * The clubs that actually enter the cup, from every club in the playable pyramid.
 *
 * Six rounds can play down a field of at most 64 (each round halves at best), so
 * a pyramid larger than that — the shipped four-tier English ladder is 80 clubs —
 * enters its 64 highest-reputation clubs and the rest sit the competition out.
 * That is a legible rule (the bottom of the pyramid doesn't reach the national
 * cup) and it's what keeps the bracket resolvable: before this cap, an 80-club
 * save reached the final with three clubs still alive and crowned nobody.
 *
 * `reputation` is the entry criterion, read once at season start, so the field is
 * stable for the whole campaign.
 */
export function cupEntrants(teams: Record<string, { id: string; reputation: number }>, teamIds: string[]): string[] {
  if (teamIds.length <= CUP_MAX_ENTRANTS) return teamIds.slice();
  return teamIds
    .slice()
    .sort((a, b) => (teams[b]?.reputation ?? 0) - (teams[a]?.reputation ?? 0))
    .slice(0, CUP_MAX_ENTRANTS);
}

export function initCup(teamIds: string[], teams?: Record<string, { id: string; reputation: number }>): CupState {
  return {
    // `teams` is optional only so a caller with no world to read (tests, and the
    // pre-cap call sites) still works; without it the field is taken as given.
    aliveTeamIds: teams ? cupEntrants(teams, teamIds) : teamIds.slice(),
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

  // Size this round to its bracket target: stage only as many ties as are needed
  // to get there, and bye the rest. The clubs that play are the weakest ones, so
  // the byes fall to the strongest — the giants enter the later rounds.
  const alive = state.cup.aliveTeamIds;
  const ties = cupTiesForRound(alive.length, roundIndex, state.schedule.cupRoundDays.length);
  const weakestFirst = alive
    .slice()
    .sort((a, b) => (state.teams[a]?.reputation ?? 0) - (state.teams[b]?.reputation ?? 0));
  const entrants = shuffle(rng, weakestFirst.slice(0, ties * 2));

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
  // Same crowning rule as maybeSettleCup in lib/gameloop.ts: one club left, or
  // the last round has been played. The two must never disagree about when the
  // cup has a winner.
  const lastRound = roundIndex === state.schedule.cupRoundDays.length - 1;
  if (state.cup.aliveTeamIds.length === 1 || (lastRound && state.cup.aliveTeamIds.length > 0)) {
    state.cup.winnerId =
      state.cup.aliveTeamIds.length === 1
        ? state.cup.aliveTeamIds[0]
        : state.cup.aliveTeamIds
            .slice()
            .sort((a, b) => (state.teams[b]?.reputation ?? 0) - (state.teams[a]?.reputation ?? 0))[0];
  }
}

/** How many clubs go up/down between each adjacent pair of divisions. */
const PRO_REL_COUNT = 3;

/** Promotion/relegation across the playable country's whole division ladder
 * (3 up, 3 down between every adjacent pair). Reads `state.divisionIds`
 * top-first, so it works for any country and any depth 1–3 (v12) — no hardcoded
 * league ids. A single-division ladder is a no-op.
 *
 * Every pair is settled from the SAME pre-shuffle snapshot of final tables, so a
 * club relegated from tier 1 lands in tier 2 without being able to be promoted
 * back out of it in the same pass. */
export function applyPromotionRelegation(state: GameState): {
  promoted: string[];
  relegated: string[];
  promotedIds: string[];
  relegatedIds: string[];
  /** Parallel to the arrays above: the division each club left, and the one it
   * landed in. Lets the season review group the moves per league. */
  promotedFrom: string[];
  promotedTo: string[];
  relegatedFrom: string[];
  relegatedTo: string[];
} {
  // De-duplicate defensively: a v11 save could carry [top, top] for a
  // single-division country, which must stay a no-op rather than shuffling a
  // division against itself.
  const ladder = Array.from(new Set(state.divisionIds)).filter((id) => state.leagues[id]);
  if (ladder.length < 2) {
    return {
      promoted: [],
      relegated: [],
      promotedIds: [],
      relegatedIds: [],
      promotedFrom: [],
      promotedTo: [],
      relegatedFrom: [],
      relegatedTo: [],
    };
  }

  // Snapshot every division's final table before anything moves.
  const tables = new Map(
    ladder.map((id) => [id, computeTable(state.fixtures, id, state.leagues[id].teamIds)] as const)
  );

  // Per division, the ids that leave upward and downward this rollover.
  const goingUp = new Map<string, string[]>();
  const goingDown = new Map<string, string[]>();
  for (let i = 0; i < ladder.length - 1; i++) {
    const upperId = ladder[i];
    const lowerId = ladder[i + 1];
    const upper = tables.get(upperId)!;
    const lower = tables.get(lowerId)!;
    // Guard tiny/odd divisions: never move more clubs than a table can spare.
    const n = Math.min(PRO_REL_COUNT, Math.floor(upper.length / 2), Math.floor(lower.length / 2));
    if (n <= 0) continue;
    goingDown.set(upperId, upper.slice(-n).map((r) => r.teamId));
    goingUp.set(lowerId, lower.slice(0, n).map((r) => r.teamId));
  }

  // Rebuild each division: whoever stayed, plus arrivals from either side.
  const promotedNames: string[] = [];
  const relegatedNames: string[] = [];
  for (let i = 0; i < ladder.length; i++) {
    const id = ladder[i];
    const table = tables.get(id)!;
    const left = new Set([...(goingUp.get(id) ?? []), ...(goingDown.get(id) ?? [])]);
    const stayed = table.map((r) => r.teamId).filter((tid) => !left.has(tid));
    // arrivals: relegated from the tier above, promoted from the tier below
    const fromAbove = goingDown.get(ladder[i - 1]) ?? [];
    const fromBelow = goingUp.get(ladder[i + 1]) ?? [];
    state.leagues[id].teamIds = [...fromAbove, ...stayed, ...fromBelow];
    for (const tid of [...fromAbove, ...fromBelow]) state.teams[tid].leagueId = id;
  }

  // The record book lists every move on the ladder, top pair first. Names, ids
  // and the two league endpoints are all kept parallel so the season review can
  // badge each moving club AND group the moves by division (v1.5) — with a deep
  // pyramid, one flat "Promoted" list can't say which division a club climbed
  // out of, which is the whole story of a lower-tier season.
  const promotedIds: string[] = [];
  const relegatedIds: string[] = [];
  const promotedFrom: string[] = [];
  const promotedTo: string[] = [];
  const relegatedFrom: string[] = [];
  const relegatedTo: string[] = [];
  for (let i = 0; i < ladder.length; i++) {
    const id = ladder[i];
    for (const tid of goingUp.get(id) ?? []) {
      promotedNames.push(state.teams[tid].name);
      promotedIds.push(tid);
      promotedFrom.push(id);
      promotedTo.push(ladder[i - 1]);
    }
    for (const tid of goingDown.get(id) ?? []) {
      relegatedNames.push(state.teams[tid].name);
      relegatedIds.push(tid);
      relegatedFrom.push(id);
      relegatedTo.push(ladder[i + 1]);
    }
  }
  return {
    promoted: promotedNames,
    relegated: relegatedNames,
    promotedIds,
    relegatedIds,
    promotedFrom,
    promotedTo,
    relegatedFrom,
    relegatedTo,
  };
}

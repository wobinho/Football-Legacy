// ── European Cups (v1.51) ─────────────────────────────────────────────────
//
// Three continental competitions — Champions League, Europa League, Conference
// League — running alongside the domestic season in the classic pre-2024 shape:
//
//   32 clubs → 8 groups of 4 → double round-robin (6 matchdays) → top 2 advance
//   → R16 / QF / SF as two-legged ties on aggregate → a single-match final.
//
// Locked design decisions this module implements:
//  - A save needs at least `EURO_MIN_COUNTRIES` European countries to run them.
//  - Qualification is from the PREVIOUS season's final league positions (plus
//    the domestic cup winner taking a Europa slot), so the first European
//    campaign is season 2 — season 1 has no prior table to read.
//  - All three cups share the same matchday dates, so a club is only ever in one
//    and the user only ever has one European fixture on a given date.
//  - A level aggregate is settled by penalties only. There is no away-goals rule.
//
// Nothing here special-cases a club or country by name: the tier table below and
// the per-nation slot counts in `EuropeanState.slots` are pure data, and every
// number lives in tuning.

import type {
  EuroCupState,
  EuroCupTier,
  EuroGroupRow,
  EuroStage,
  EuroTie,
  EuropeanState,
  Fixture,
  GameState,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import { computeTable } from "./season";
import { mulberry32, deriveSeed, shuffle, uid } from "./rng";
import { SCOUT_WORLD } from "./config/scouting";

/** How many European countries a save needs before the cups can run. */
export const EURO_MIN_COUNTRIES = 8;

/** Clubs per competition. 8 groups of 4. */
export const EURO_TEAMS_PER_CUP = 32;
export const EURO_GROUP_COUNT = 8;
export const EURO_GROUP_SIZE = 4;

/** Per-tier presentation, per the locked spec. Pure data — the engine reads the
 * tier number, never a name. */
export const EURO_CUP_DEFS: { tier: EuroCupTier; name: string; short: string; color: string }[] = [
  { tier: 1, name: "Champions League", short: "UCL", color: "#071961" },
  { tier: 2, name: "Europa League", short: "UEL", color: "#F26A24" },
  { tier: 3, name: "Conference League", short: "UECL", color: "#00FF9D" },
];

/** Knockout round names, indexed by `EuroTie.round`. */
export const EURO_KO_ROUND_NAMES = ["Round of 16", "Quarter-Final", "Semi-Final", "Final"];

/** The competition key a European fixture carries, e.g. "EURO1". Parsed back out
 * by `euroTierOf` so the loop can route a fixture to its cup. */
export function euroCompetitionId(tier: EuroCupTier): string {
  return `EURO${tier}`;
}

/** The cup tier a fixture belongs to, or null if it isn't a European fixture. */
export function euroTierOf(competition: string): EuroCupTier | null {
  const m = /^EURO([123])$/.exec(competition);
  return m ? (Number(m[1]) as EuroCupTier) : null;
}

/** Every 3-letter country code the scouting tree files under Europe. This is the
 * single source of truth for "is this a European country" — the same tree the
 * scouting screen uses, so the two can't drift. */
export function europeanCountryCodes(): Set<string> {
  const out = new Set<string>();
  for (const continent of SCOUT_WORLD) {
    if (continent.id !== "Europe") continue;
    for (const region of continent.regions) {
      for (const c of region.countries) out.add(c.id);
    }
  }
  return out;
}

/** The European countries a given save actually contains, by country code.
 * Derived from the leagues in the world, so it reflects exactly what the user
 * chose at setup. */
export function europeanCountriesInSave(state: GameState): string[] {
  const european = europeanCountryCodes();
  const byName = new Map<string, string>(); // country display name → code
  for (const continent of SCOUT_WORLD) {
    if (continent.id !== "Europe") continue;
    for (const region of continent.regions) {
      for (const c of region.countries) byName.set(c.label.toLowerCase(), c.id);
    }
  }
  const found = new Set<string>();
  for (const league of Object.values(state.leagues)) {
    // A league's id is prefixed with its country code ("ENG1"), which is the most
    // reliable signal; fall back to matching the display name.
    const code = /^([A-Z]{3})\d*$/.exec(league.id)?.[1];
    if (code && european.has(code)) {
      found.add(code);
      continue;
    }
    const byLabel = byName.get(league.country.trim().toLowerCase());
    if (byLabel) found.add(byLabel);
  }
  return [...found].sort();
}

/** Can this save run European competitions at all? */
export function canRunEuropeanCups(state: GameState): boolean {
  return europeanCountriesInSave(state).length >= EURO_MIN_COUNTRIES;
}

/**
 * Default per-nation qualification slots. The strongest nations (by the average
 * reputation of their top division) get the most Champions League places, in the
 * familiar 4/3/2/1 shape. Returns a map of country code → [tier1, tier2, tier3]
 * counts, sized so the three cups fill to 32 each.
 *
 * The user can override any of this at setup; this is only the sensible default.
 */
export function defaultEuroSlots(state: GameState, tiers: number): Record<string, [number, number, number]> {
  const countries = europeanCountriesInSave(state);
  // Rank nations by the strength of their top flight.
  const strength = countries.map((code) => {
    const top = Object.values(state.leagues).find(
      (l) => l.tier === 1 && (l.id.startsWith(code) || l.country.toLowerCase().includes(code.toLowerCase()))
    );
    const rep = top
      ? top.teamIds.reduce((n, id) => n + (state.teams[id]?.reputation ?? 0), 0) / Math.max(1, top.teamIds.length)
      : 0;
    return { code, rep, size: top?.teamIds.length ?? 0 };
  });
  strength.sort((a, b) => b.rep - a.rep);

  const slots: Record<string, [number, number, number]> = {};
  strength.forEach((s, i) => {
    // Top 4 nations get 4 CL places, next 4 get 3, then 2, then 1 — bounded by
    // how many clubs the nation actually has to send.
    const cl = i < 4 ? 4 : i < 8 ? 3 : i < 12 ? 2 : 1;
    const el = tiers >= 2 ? (i < 4 ? 3 : i < 12 ? 2 : 1) : 0;
    const ecl = tiers >= 3 ? (i < 8 ? 2 : 1) : 0;
    const cap = Math.max(0, s.size);
    const t1 = Math.min(cl, cap);
    const t2 = Math.min(el, Math.max(0, cap - t1));
    const t3 = Math.min(ecl, Math.max(0, cap - t1 - t2));
    slots[s.code] = [t1, t2, t3];
  });
  return slots;
}

/** A fresh, empty European layer for a new save. */
export function initEuropeanState(state: GameState, tiers: number): EuropeanState {
  return {
    tiers: Math.max(1, Math.min(3, tiers)),
    cups: [], // filled at the first rollover — qualification needs a finished season
    slots: defaultEuroSlots(state, tiers),
  };
}

// ── Qualification ─────────────────────────────────────────────────────────

/**
 * The final league ordering for a country's top division in the season just
 * played. Playable divisions read the real table; sim leagues read the resolver's
 * last full table (`half === 2`). Returns team ids, best first.
 */
function finalOrderFor(state: GameState, code: string): string[] {
  const top = Object.values(state.leagues).find(
    (l) => l.tier === 1 && l.id.startsWith(code)
  );
  if (!top) return [];
  if (top.playable) {
    return computeTable(state.fixtures, top.id, top.teamIds).map((r) => r.teamId);
  }
  // Sim league: prefer the completed (half 2) table for the season just played.
  const result =
    state.simResults.find((r) => r.leagueId === top.id && r.half === 2) ??
    state.simResults.find((r) => r.leagueId === top.id);
  if (result) return result.table.map((r) => r.teamId);
  // No resolver data at all — fall back to reputation order so qualification
  // still produces a sensible field rather than nothing.
  return top.teamIds
    .slice()
    .sort((a, b) => (state.teams[b]?.reputation ?? 0) - (state.teams[a]?.reputation ?? 0));
}

/**
 * Work out who qualifies for each cup, from the season just played.
 *
 * Per nation, the top `slots[0]` clubs enter the Champions League, the next
 * `slots[1]` the Europa League, and the next `slots[2]` the Conference League.
 * The domestic cup winner takes a Europa place if they haven't already qualified
 * for something better (the playable nation only — sim nations run no cup).
 *
 * Each cup is then trimmed or topped up to exactly 32: short fields are filled
 * from the best-reputation clubs not already in a European competition, so the
 * bracket is always complete regardless of how the user configured the slots.
 */
export function qualifyForEuropeanCups(state: GameState, euro: EuropeanState): string[][] {
  const perCup: string[][] = [[], [], []];
  const taken = new Set<string>();

  for (const code of europeanCountriesInSave(state)) {
    const order = finalOrderFor(state, code);
    if (!order.length) continue;
    const slots = euro.slots[code] ?? [1, 0, 0];
    let cursor = 0;
    for (let tier = 0; tier < euro.tiers; tier++) {
      for (let n = 0; n < (slots[tier] ?? 0) && cursor < order.length; n++) {
        const id = order[cursor++];
        if (taken.has(id)) continue;
        taken.add(id);
        perCup[tier].push(id);
      }
    }
  }

  // Domestic cup winner → a Europa League place (playable nation only; sim
  // nations have no knockout cup to win). If they already qualified higher, the
  // slot simply isn't used — they can't play in two competitions.
  const cupWinner = state.cup.winnerId;
  if (euro.tiers >= 2 && cupWinner && !taken.has(cupWinner)) {
    taken.add(cupWinner);
    perCup[1].push(cupWinner);
  }

  // Top each cup up to 32 (or trim an over-filled one), best clubs first. A cup
  // that can't be filled at all is dropped by the caller.
  const spare = Object.values(state.teams)
    .filter((t) => !taken.has(t.id))
    .sort((a, b) => b.reputation - a.reputation);
  let spareIdx = 0;
  for (let tier = 0; tier < euro.tiers; tier++) {
    const cup = perCup[tier];
    if (cup.length > EURO_TEAMS_PER_CUP) {
      for (const id of cup.splice(EURO_TEAMS_PER_CUP)) taken.delete(id);
    }
    while (cup.length < EURO_TEAMS_PER_CUP && spareIdx < spare.length) {
      const t = spare[spareIdx++];
      if (taken.has(t.id)) continue;
      taken.add(t.id);
      cup.push(t.id);
    }
  }
  return perCup;
}

// ── Draw ──────────────────────────────────────────────────────────────────

/**
 * Seed 32 clubs into 8 groups of 4. Clubs are ranked by reputation and split
 * into four pots; each group takes one club from each pot, so a group can't be
 * four giants or four minnows. Deterministic from the save seed.
 */
export function drawGroups(state: GameState, teamIds: string[], seed: number, tier: number): string[][] {
  const rng = mulberry32(deriveSeed(seed, `eurogroups:${state.season}:${tier}`));
  const ranked = teamIds
    .slice()
    .sort((a, b) => (state.teams[b]?.reputation ?? 0) - (state.teams[a]?.reputation ?? 0));

  const pots: string[][] = [];
  for (let p = 0; p < EURO_GROUP_SIZE; p++) {
    pots.push(shuffle(rng, ranked.slice(p * EURO_GROUP_COUNT, (p + 1) * EURO_GROUP_COUNT)));
  }
  const groups: string[][] = Array.from({ length: EURO_GROUP_COUNT }, () => []);
  for (let p = 0; p < EURO_GROUP_SIZE; p++) {
    for (let g = 0; g < EURO_GROUP_COUNT; g++) {
      const id = pots[p][g];
      if (id) groups[g].push(id);
    }
  }
  return groups;
}

/**
 * All 6 group matchdays for one group of 4, as a double round-robin. The circle
 * method gives 3 rounds; the second half mirrors the venues, exactly as the
 * league fixture generator does.
 */
function groupFixtures(
  group: string[],
  competition: string,
  groupIndex: number,
  dayFor: (round: number) => number
): Fixture[] {
  const fixtures: Fixture[] = [];
  const n = group.length;
  if (n < 2) return fixtures;
  const order = group.slice();
  const rounds = n - 1;
  const rotating = order.slice(1);
  for (let r = 0; r < rounds; r++) {
    const left = [order[0], ...rotating.slice(0, (n - 2) / 2)];
    const right = rotating.slice((n - 2) / 2).reverse();
    for (let i = 0; i < n / 2; i++) {
      const [a, b] = i === 0 && r % 2 === 1 ? [right[i], left[i]] : [left[i], right[i]];
      if (!a || !b) continue;
      fixtures.push({
        id: uid("euf"),
        day: dayFor(r),
        competition,
        round: r + 1,
        homeId: a,
        awayId: b,
        played: false,
        euroGroup: groupIndex,
      });
      fixtures.push({
        id: uid("euf"),
        day: dayFor(r + rounds),
        competition,
        round: r + rounds + 1,
        homeId: b,
        awayId: a,
        played: false,
        euroGroup: groupIndex,
      });
    }
    rotating.push(rotating.shift()!);
  }
  return fixtures;
}

/**
 * Build every cup for the season about to start, and return the group-stage
 * fixtures to add to the world. Called at the rollover, once the season just
 * played has produced the tables qualification reads.
 */
export function startEuropeanSeason(state: GameState): Fixture[] {
  const euro = state.european;
  if (!euro) return [];
  euro.cups = [];
  if (!canRunEuropeanCups(state)) return [];
  const days = state.schedule.euroRoundDays;
  if (!days || days.length < 6) return [];

  const perCup = qualifyForEuropeanCups(state, euro);
  const fixtures: Fixture[] = [];

  for (let i = 0; i < euro.tiers; i++) {
    const teamIds = perCup[i];
    // A cup that couldn't be filled (a very small world) is simply not run,
    // rather than played out as a broken bracket.
    if (teamIds.length < EURO_TEAMS_PER_CUP) continue;
    const def = EURO_CUP_DEFS[i];
    const groups = drawGroups(state, teamIds, state.seed, def.tier);
    const competition = euroCompetitionId(def.tier);
    const cup: EuroCupState = {
      tier: def.tier,
      name: def.name,
      color: def.color,
      teamIds,
      groups,
      groupRows: [],
      ties: [],
      currentRound: 0,
      winnerId: null,
      exitStage: {},
    };
    groups.forEach((group, gi) => {
      fixtures.push(...groupFixtures(group, competition, gi, (r) => days[r]));
    });
    euro.cups.push(cup);
  }
  return fixtures;
}

// ── Group tables ──────────────────────────────────────────────────────────

/** Recompute a cup's group tables from its played fixtures. */
export function refreshGroupTables(state: GameState, cup: EuroCupState) {
  const competition = euroCompetitionId(cup.tier);
  const rows: EuroGroupRow[] = [];
  cup.groups.forEach((group, gi) => {
    const table = computeTable(
      state.fixtures.filter((f) => f.competition === competition && f.euroGroup === gi),
      competition,
      group
    );
    for (const r of table) rows.push({ ...r, groupIndex: gi });
  });
  cup.groupRows = rows;
}

/** The clubs through to the knockout stage: the top 2 of each group, in seeded
 * order (group winners first, then runners-up). */
export function groupQualifiers(cup: EuroCupState): { winners: string[]; runnersUp: string[] } {
  const winners: string[] = [];
  const runnersUp: string[] = [];
  for (let g = 0; g < cup.groups.length; g++) {
    const rows = cup.groupRows
      .filter((r) => r.groupIndex === g)
      .sort((a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf);
    if (rows[0]) winners.push(rows[0].teamId);
    if (rows[1]) runnersUp.push(rows[1].teamId);
  }
  return { winners, runnersUp };
}

// ── Knockouts ─────────────────────────────────────────────────────────────

/**
 * Draw the next knockout round and return its fixtures.
 *
 * Round 0 (R16) pairs group winners against runners-up, as the real competition
 * does. Later rounds pair the previous round's winners at random. Every round
 * but the final is two legs; `teamA` hosts the first leg and `teamB` the second.
 */
export function drawKnockoutRound(state: GameState, cup: EuroCupState, round: number): Fixture[] {
  const days = state.schedule.euroRoundDays;
  if (!days) return [];
  const competition = euroCompetitionId(cup.tier);
  const rng = mulberry32(deriveSeed(state.seed, `euroko:${state.season}:${cup.tier}:${round}`));

  let pairs: [string, string][] = [];
  if (round === 0) {
    const { winners, runnersUp } = groupQualifiers(cup);
    // Winners are seeded (they host the second leg); runners-up are drawn against
    // them. A winner can't meet the runner-up from their own group.
    const pool = shuffle(rng, runnersUp);
    const seeded = shuffle(rng, winners);
    const groupOf = (id: string) => cup.groups.findIndex((g) => g.includes(id));
    const used = new Set<number>();
    for (const w of seeded) {
      let pick = -1;
      for (let i = 0; i < pool.length; i++) {
        if (used.has(i)) continue;
        if (groupOf(pool[i]) === groupOf(w)) continue;
        pick = i;
        break;
      }
      // Fall back to any remaining club if the same-group rule can't be honoured.
      if (pick === -1) pick = pool.findIndex((_, i) => !used.has(i));
      if (pick === -1) continue;
      used.add(pick);
      // The runner-up hosts the first leg; the group winner hosts the decider.
      pairs.push([pool[pick], w]);
    }
  } else {
    const prev = cup.ties.filter((t) => t.round === round - 1 && t.winnerId);
    const advancing = shuffle(rng, prev.map((t) => t.winnerId!));
    for (let i = 0; i + 1 < advancing.length; i += 2) {
      pairs.push([advancing[i], advancing[i + 1]]);
    }
  }

  const isFinal = round === 3;
  // Knockout days follow the 6 group days: R16 legs on days 6-7, QF on 8-9,
  // SF on 10-11, and the final on day 12.
  const firstLegDay = days[6 + round * 2];
  const secondLegDay = days[7 + round * 2];
  const fixtures: Fixture[] = [];

  for (const [aId, bId] of pairs) {
    const tie: EuroTie = {
      id: uid("eut"),
      round,
      teamAId: aId,
      teamBId: bId,
      legFixtureIds: [],
      winnerId: null,
    };
    if (isFinal) {
      // A single match at a neutral venue — modelled as teamA at home, with the
      // engine's home advantage still applied to keep one code path.
      const f: Fixture = {
        id: uid("euf"),
        day: days[12] ?? firstLegDay,
        competition,
        round: 100 + round, // knockout rounds are offset past the 6 group rounds
        homeId: aId,
        awayId: bId,
        played: false,
        euroTieId: tie.id,
      };
      tie.legFixtureIds.push(f.id);
      fixtures.push(f);
    } else {
      const leg1: Fixture = {
        id: uid("euf"),
        day: firstLegDay,
        competition,
        round: 100 + round,
        homeId: aId,
        awayId: bId,
        played: false,
        euroTieId: tie.id,
      };
      const leg2: Fixture = {
        id: uid("euf"),
        day: secondLegDay,
        competition,
        round: 100 + round,
        homeId: bId,
        awayId: aId,
        played: false,
        euroTieId: tie.id,
      };
      tie.legFixtureIds.push(leg1.id, leg2.id);
      fixtures.push(leg1, leg2);
    }
    cup.ties.push(tie);
  }
  return fixtures;
}

/** The stage a club that loses in `round` bowed out at. */
function exitStageFor(round: number): EuroStage {
  return round === 0 ? "roundOf16" : round === 1 ? "quarterFinal" : round === 2 ? "semiFinal" : "runnerUp";
}

/**
 * Settle every completed tie in a knockout round. A tie is decided on aggregate;
 * a level aggregate goes to penalties (seeded, so it's deterministic), with no
 * away-goals rule. Returns true when the whole round is finished.
 */
export function settleKnockoutRound(state: GameState, cup: EuroCupState, round: number): boolean {
  const ties = cup.ties.filter((t) => t.round === round);
  if (!ties.length) return false;
  let allDone = true;

  for (const tie of ties) {
    if (tie.winnerId) continue;
    const legs = tie.legFixtureIds
      .map((id) => state.fixtures.find((f) => f.id === id))
      .filter((f): f is Fixture => !!f);
    if (!legs.length || !legs.every((f) => f.played)) {
      allDone = false;
      continue;
    }
    let aggA = 0;
    let aggB = 0;
    for (const f of legs) {
      // Goals are recorded from the fixture's own perspective, so map them back
      // onto the tie's A/B sides.
      if (f.homeId === tie.teamAId) {
        aggA += f.homeGoals ?? 0;
        aggB += f.awayGoals ?? 0;
      } else {
        aggB += f.homeGoals ?? 0;
        aggA += f.awayGoals ?? 0;
      }
    }
    tie.aggA = aggA;
    tie.aggB = aggB;
    if (aggA > aggB) tie.winnerId = tie.teamAId;
    else if (aggB > aggA) tie.winnerId = tie.teamBId;
    else {
      // Level on aggregate → penalties. No away-goals rule, by design.
      const rng = mulberry32(deriveSeed(state.seed, `europens:${state.season}:${cup.tier}:${tie.id}`));
      tie.shootoutWinnerId = rng() < 0.5 ? tie.teamAId : tie.teamBId;
      tie.winnerId = tie.shootoutWinnerId;
    }
    const loser = tie.winnerId === tie.teamAId ? tie.teamBId : tie.teamAId;
    cup.exitStage[loser] = exitStageFor(round);
    if (round === 3) {
      cup.winnerId = tie.winnerId;
      cup.exitStage[tie.winnerId] = "champion";
    }
  }
  return allDone;
}

/** Mark every club eliminated in the group stage, once the groups are done. */
export function recordGroupExits(cup: EuroCupState) {
  const { winners, runnersUp } = groupQualifiers(cup);
  const through = new Set([...winners, ...runnersUp]);
  for (const id of cup.teamIds) {
    if (!through.has(id) && !cup.exitStage[id]) cup.exitStage[id] = "groupStage";
  }
}

// ── Prizes ────────────────────────────────────────────────────────────────

/**
 * Pay every club that took part in a European competition, by how far it got.
 * Called at the rollover, before promotion/relegation shuffles the leagues.
 * Returns a short summary for the season review.
 */
export function applyEuropeanPrizes(
  state: GameState,
  cfg: TuningConfig
): { cupName: string; winnerName: string; userPrize: number }[] {
  const euro = state.european;
  if (!euro?.cups.length) return [];
  const out: { cupName: string; winnerName: string; userPrize: number }[] = [];

  for (const cup of euro.cups) {
    const table = cfg.europeanCupPrizeByTier[cup.tier - 1];
    if (!table) continue;
    let userPrize = 0;
    for (const [teamId, stage] of Object.entries(cup.exitStage)) {
      const prize = table[stage] ?? 0;
      const team = state.teams[teamId];
      if (!team || !prize) continue;
      team.budget += prize;
      if (teamId === state.userTeamId) userPrize = prize;
    }
    out.push({
      cupName: cup.name,
      winnerName: cup.winnerId ? state.teams[cup.winnerId]?.name ?? "—" : "—",
      userPrize,
    });
  }
  return out;
}

/** The cup (if any) the user's club is in this season. */
export function userEuroCup(state: GameState): EuroCupState | null {
  const euro = state.european;
  if (!euro?.cups.length) return null;
  return euro.cups.find((c) => c.teamIds.includes(state.userTeamId)) ?? null;
}

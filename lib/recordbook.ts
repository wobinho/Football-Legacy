// Record Book (§13): the museum of the save. Season summaries stored forever;
// match detail compresses into these at rollover.

import type { GameState, SeasonSummary, PlayerBio } from "./types";
import { computeTable } from "./season";
import { seasonYearLabel } from "./calendar";
import { activePlayers } from "./archive";
import { computeSeasonAccolades } from "./accolades";

function topScorerOf(state: GameState, leagueId: string): { playerId: string; name: string; teamName: string; goals: number } | null {
  let best: PlayerBio | null = null;
  for (const p of activePlayers(state)) {
    if (!p.clubId) continue;
    if (state.teams[p.clubId]?.leagueId !== leagueId) continue;
    if (!best || p.stats.goals > best.stats.goals) best = p;
  }
  if (!best || best.stats.goals === 0) return null;
  return {
    playerId: best.id,
    name: best.name,
    teamName: best.clubId ? state.teams[best.clubId].name : "—",
    goals: best.stats.goals,
  };
}

export function buildSeasonSummary(state: GameState): SeasonSummary {
  const championsByLeague: SeasonSummary["championsByLeague"] = {};
  const finalTables: SeasonSummary["finalTables"] = {};
  const topScorers: SeasonSummary["topScorers"] = {};

  for (const league of Object.values(state.leagues)) {
    let table;
    if (league.playable) {
      table = computeTable(state.fixtures, league.id, league.teamIds);
    } else {
      table = state.simResults.find((r) => r.leagueId === league.id && r.half === 2)?.table ?? [];
    }
    if (table.length) {
      finalTables[league.id] = table;
      const champId = table[0].teamId;
      championsByLeague[league.id] = { teamId: champId, teamName: state.teams[champId].name };
    }
    const ts = league.playable
      ? topScorerOf(state, league.id)
      : (() => {
          const sim = state.simResults.find((r) => r.leagueId === league.id && r.half === 2);
          if (!sim?.topScorers.length) return null;
          const p = state.players[sim.topScorers[0].playerId];
          return p
            ? { playerId: p.id, name: p.name, teamName: p.clubId ? state.teams[p.clubId].name : "—", goals: sim.topScorers[0].goals }
            : null;
        })();
    if (ts) topScorers[league.id] = ts;
  }

  // Season honours (v24): every league's individual awards + Team of the Season,
  // plus the two save-wide legacy awards. Stamping a winner's permanent cabinet
  // must happen exactly once per season. Since v1.44 the dead-week awards
  // ceremony (accoladesDay) computes and stamps these a week early and parks the
  // result on `state.pendingAccolades`; reuse it here so the rollover never
  // re-stamps. Only if that never ran (a pre-v1.44 schedule, or an old save) do
  // we compute — and stamp — here at the rollover as before.
  const accolades = state.pendingAccolades ?? computeSeasonAccolades(state);
  state.pendingAccolades = undefined;

  // The summary's headline Player / Young Player fields (kept for old readers and
  // the inbox line) come from the playable top division's accolade block.
  const topDivId = state.divisionIds?.[0] ?? "ENG1";
  const topBlock = accolades.byLeague[topDivId];
  const poty = topBlock?.playerOfSeason ?? null;
  const ypoty = topBlock?.youngPlayerOfSeason ?? null;

  const userLeagueId = state.teams[state.userTeamId].leagueId;
  const userTable = finalTables[userLeagueId] ?? [];
  const pos = userTable.findIndex((r) => r.teamId === state.userTeamId) + 1;
  const suffix = pos === 1 ? "st" : pos === 2 ? "nd" : pos === 3 ? "rd" : "th";

  // notable transfers: biggest fees recorded this season across all careers
  const notable: SeasonSummary["notableTransfers"] = [];
  for (const c of Object.values(state.careers)) {
    for (const t of c.transfers) {
      if (t.season === state.season && t.fee > 0) {
        notable.push({ playerName: state.players[c.playerId]?.name ?? "?", from: t.from, to: t.to, fee: t.fee });
      }
    }
  }
  notable.sort((a, b) => b.fee - a.fee);

  return {
    season: state.season,
    yearLabel: seasonYearLabel(state.season),
    championsByLeague,
    cupWinner: state.cup.winnerId
      ? { teamId: state.cup.winnerId, teamName: state.teams[state.cup.winnerId].name }
      : null,
    finalTables,
    topScorers,
    playerOfSeason: poty
      ? { playerId: poty.playerId, name: poty.name, teamName: poty.teamName }
      : null,
    youngPlayerOfSeason: ypoty
      ? { playerId: ypoty.playerId, name: ypoty.name, teamName: ypoty.teamName }
      : null,
    accolades,
    userTeamId: state.userTeamId,
    userFinish: pos > 0 ? `${pos}${suffix} in ${state.leagues[userLeagueId].name}` : "—",
    notableTransfers: notable.slice(0, 5),
    promoted: [],
    relegated: [],
  };
}

/**
 * Track the biggest win record as results come in (playable comps only).
 * This is the USER CLUB's record book, so only wins by the club the player
 * controls count — a 6–0 between two AI sides is not the user's record.
 */
export function trackBiggestWin(state: GameState, fixture: { homeId: string; awayId: string }, hg: number, ag: number) {
  const userId = state.userTeamId;
  const isHome = fixture.homeId === userId;
  const isAway = fixture.awayId === userId;
  if (!isHome && !isAway) return;

  const own = isHome ? hg : ag;
  const opp = isHome ? ag : hg;
  if (own <= opp) return; // must be a win, not just a big scoreline

  const margin = own - opp;
  if (margin < 4) return;
  const current = state.recordBook.biggestWin;
  // Tie-break on goals scored so 7–1 beats a previously-recorded 5–0 of equal margin.
  if (current && (margin < current.margin || (margin === current.margin && own <= (current.goalsFor ?? 0)))) return;

  const oppName = state.teams[isHome ? fixture.awayId : fixture.homeId]?.name ?? "—";
  const text = isHome ? `${state.teams[userId].name} ${hg}–${ag} ${oppName}` : `${oppName} ${hg}–${ag} ${state.teams[userId].name} (away)`;
  state.recordBook.biggestWin = { season: state.season, text, margin, goalsFor: own };
}

/** All-time club records computed from careers on demand (no extra store). */
export function clubAllTimeRecords(state: GameState, teamId: string) {
  const teamName = state.teams[teamId].name;
  const totals = new Map<string, { id: string; name: string; apps: number; goals: number; assists: number }>();
  const add = (playerId: string, name: string, apps: number, goals: number, assists: number) => {
    const t = totals.get(playerId) ?? { id: playerId, name, apps: 0, goals: 0, assists: 0 };
    t.apps += apps;
    t.goals += goals;
    t.assists += assists;
    totals.set(playerId, t);
  };
  for (const c of Object.values(state.careers)) {
    for (const row of c.seasons) {
      if (row.clubName === teamName) add(c.playerId, state.players[c.playerId]?.name ?? "?", row.apps, row.goals, row.assists);
    }
  }
  // include current season running stats
  for (const pid of state.teams[teamId].playerIds) {
    const p = state.players[pid];
    if (p) add(p.id, p.name, p.stats.apps, p.stats.goals, p.stats.assists);
  }
  const rows = [...totals.values()];
  return {
    topScorers: rows.slice().sort((a, b) => b.goals - a.goals).slice(0, 10),
    topAssists: rows.slice().sort((a, b) => b.assists - a.assists).slice(0, 10),
    mostAppearances: rows.slice().sort((a, b) => b.apps - a.apps).slice(0, 10),
  };
}

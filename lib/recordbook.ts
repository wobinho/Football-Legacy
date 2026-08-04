// Record Book (§13): the museum of the save. Season summaries stored forever;
// match detail compresses into these at rollover.

import type { AccoladeType, AwardWinner, GameState, SeasonSummary, PlayerBio } from "./types";
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

/**
 * Who lost the domestic cup final (v1.91).
 *
 * The cup keeps no record of its beaten finalist — only `winnerId` — so this
 * reads the final round's played tie and takes the club that isn't the winner.
 * Null when the last round staged no tie at all (a bracket that ran out of
 * clubs and crowned a survivor by reputation), which is an honest "nobody was
 * beaten in a final" rather than a guess.
 */
function cupRunnerUpOf(state: GameState): { teamId: string; teamName: string } | null {
  const winnerId = state.cup.winnerId;
  if (!winnerId) return null;
  const lastRound = state.schedule.cupRoundDays.length;
  const final = state.fixtures.find(
    (f) =>
      f.competition === "CUP" &&
      f.round === lastRound &&
      f.played &&
      (f.homeId === winnerId || f.awayId === winnerId)
  );
  if (!final) return null;
  const loserId = final.homeId === winnerId ? final.awayId : final.homeId;
  const team = state.teams[loserId];
  return team ? { teamId: loserId, teamName: team.name } : null;
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
        const player = state.players[c.playerId];
        notable.push({
          playerName: player?.name ?? "?",
          from: t.from,
          to: t.to,
          fee: t.fee,
          nationality: player?.nationality,
          fromId: t.fromId,
          toId: t.toId,
        });
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
    cupRunnerUp: cupRunnerUpOf(state),
    // Continental champions (v1.67). Captured here because the rollover rebuilds
    // `state.european` for the next campaign a few steps later — read it now or
    // the season's European winners are gone for good, which is why the review
    // showed nothing for them season after season.
    europeanWinners: (state.european?.cups ?? [])
      .filter((c) => c.winnerId && state.teams[c.winnerId])
      .sort((a, b) => a.tier - b.tier)
      .map((c) => {
        // The beaten finalist is the other club in the cup's own final tie
        // (round 3). Read here for the same reason the winner is: the rollover
        // rebuilds `state.european` a few steps later and the tie is gone.
        const final = c.ties.find((t) => t.round === 3 && t.winnerId);
        const loserId = final
          ? final.winnerId === final.teamAId
            ? final.teamBId
            : final.teamAId
          : undefined;
        return {
          tier: c.tier,
          cupName: c.name,
          teamId: c.winnerId!,
          teamName: state.teams[c.winnerId!].name,
          runnerUpId: loserId && state.teams[loserId] ? loserId : undefined,
          runnerUpName: loserId ? state.teams[loserId]?.name : undefined,
        };
      }),
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
    userPosition: pos,
    notableTransfers: notable.slice(0, 5),
    promoted: [],
    relegated: [],
  };
}

// ── The roll of honour (v1.89) ────────────────────────────────────────────
//
// The save has stored every season's champions since v1 — per league, the
// domestic cup, and (since v1.67) each European cup. What it never had was a way
// to READ that history as a competition's own story: the Club screen listed
// seasons, so answering "who has won this league, and how often?" meant opening
// twenty season reviews and counting.
//
// Everything below is DERIVED from `state.recordBook.seasons` on demand. Nothing
// new is stored and no migration is needed — a save that has played ten seasons
// already contains its own honours list, it simply had no reader. That also
// means the two views can never disagree: the roll of honour and the season
// review are the same rows, grouped differently.

/** One competition's winner in one season. */
export interface HonourRow {
  season: number;
  yearLabel: string;
  teamId: string;
  teamName: string;
}

/** A competition and everyone who has ever won it. */
export interface CompetitionHistory {
  /** League id, "CUP", or the European cup's competition key. */
  id: string;
  name: string;
  kind: "league" | "cup" | "european";
  /** Tier, for ordering leagues top-flight first. European cups use their own
   * tier (1 = the premier competition). */
  tier: number;
  /** Every season's winner, most recent first. */
  winners: HonourRow[];
  /** Clubs by titles won, most first — the competition's all-time table. */
  titles: { teamId: string; teamName: string; count: number; seasons: number[] }[];
}

/** Roll `winners` into an all-time title count, most titles first. Ties break on
 * the most recent win, so the club that won it last season edges one that won
 * the same number a decade ago. */
function tallyTitles(winners: HonourRow[]): CompetitionHistory["titles"] {
  const byTeam = new Map<string, { teamId: string; teamName: string; count: number; seasons: number[] }>();
  for (const w of winners) {
    // Keyed by id, but the NAME is refreshed from the most recent win — a club
    // renamed by a custom database should read under the name it carries now.
    const row = byTeam.get(w.teamId) ?? { teamId: w.teamId, teamName: w.teamName, count: 0, seasons: [] };
    row.count += 1;
    row.seasons.push(w.season);
    byTeam.set(w.teamId, row);
  }
  return [...byTeam.values()]
    .map((r) => ({ ...r, seasons: r.seasons.sort((a, b) => b - a) }))
    .sort((a, b) => b.count - a.count || (b.seasons[0] ?? 0) - (a.seasons[0] ?? 0));
}

/**
 * Every competition in the save with a winners list, ready to render.
 *
 * Ordered the way a trophy cabinet reads: the domestic pyramid top-first, then
 * the cup, then the continental competitions. A competition nobody has won yet
 * is omitted rather than shown empty — in season one that is all of them, and a
 * page of blank cards says less than an honest "no history yet".
 *
 * League NAMES come from live state where the league still exists, so a division
 * renamed mid-save reads consistently; the stored summary's name is the fallback
 * for a league that has since gone (a database change between saves).
 */
export function competitionHistories(state: GameState): CompetitionHistory[] {
  const seasons = state.recordBook.seasons;
  const out: CompetitionHistory[] = [];

  // ── Leagues ──────────────────────────────────────────────────────────────
  // Driven off what the summaries actually recorded rather than off the current
  // league list, so a division the save no longer runs keeps its history.
  const leagueIds = new Set<string>();
  for (const s of seasons) for (const id of Object.keys(s.championsByLeague)) leagueIds.add(id);
  for (const id of leagueIds) {
    const winners: HonourRow[] = [];
    for (const s of seasons) {
      const champ = s.championsByLeague[id];
      if (champ) winners.push({ season: s.season, yearLabel: s.yearLabel, ...champ });
    }
    if (!winners.length) continue;
    winners.reverse(); // most recent first
    out.push({
      id,
      name: state.leagues[id]?.name ?? id,
      kind: "league",
      tier: state.leagues[id]?.tier ?? 99,
      winners,
      titles: tallyTitles(winners),
    });
  }

  // ── Domestic cup ─────────────────────────────────────────────────────────
  const cupWinners: HonourRow[] = [];
  for (const s of seasons) {
    if (s.cupWinner) cupWinners.push({ season: s.season, yearLabel: s.yearLabel, ...s.cupWinner });
  }
  if (cupWinners.length) {
    cupWinners.reverse();
    out.push({
      id: "CUP",
      // The cup carries no name of its own in the schema; "Cup" is what every
      // other surface labels it (see Competition.tsx), so it is what this uses.
      name: "Cup",
      kind: "cup",
      tier: 0,
      winners: cupWinners,
      titles: tallyTitles(cupWinners),
    });
  }

  // ── European cups ────────────────────────────────────────────────────────
  // `europeanWinners` is absent on pre-v1.67 summaries and empty in a season with
  // no continental football, so both simply contribute nothing.
  const euro = new Map<string, { name: string; tier: number; winners: HonourRow[] }>();
  for (const s of seasons) {
    for (const w of s.europeanWinners ?? []) {
      const key = `EURO${w.tier}`;
      const row = euro.get(key) ?? { name: w.cupName, tier: w.tier, winners: [] };
      row.winners.push({ season: s.season, yearLabel: s.yearLabel, teamId: w.teamId, teamName: w.teamName });
      euro.set(key, row);
    }
  }
  for (const [id, row] of euro) {
    row.winners.reverse();
    out.push({ id, name: row.name, kind: "european", tier: row.tier, winners: row.winners, titles: tallyTitles(row.winners) });
  }

  // The manager's OWN pyramid first, top division down; then their cup; then
  // everything else. Every top flight in the world is `tier: 1`, so sorting on
  // tier alone buried the user's league behind whichever foreign division sorted
  // first alphabetically — on a page about their club's history, their own
  // competitions are what they came to read.
  const ownDivision = new Map(state.divisionIds.map((id, i) => [id, i]));
  const rank = (c: CompetitionHistory): number => {
    if (c.kind === "league" && ownDivision.has(c.id)) return ownDivision.get(c.id)!; // 0,1,2…
    if (c.kind === "cup") return 100;
    if (c.kind === "european") return 200 + c.tier;
    return 300 + c.tier; // foreign leagues, top flights first
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ── The world's history, season by season (v1.91) ─────────────────────────
//
// `competitionHistories` above answers "who has won this, and how often" — a
// per-competition all-time table. This answers the other question: "what
// happened everywhere, that season?" — the champion AND the podium behind them,
// for every league in the world, plus the two finalists of every cup.
//
// Same source, same rule as everything else in this file: DERIVED from
// `state.recordBook.seasons` on demand, nothing stored, no migration. The top
// four come from the season's own `finalTables`, which have been recorded since
// v1 for every league the save runs, playable or simulated — so a save deep
// enough to have a history already contains all of this.

/** One club's finishing place in a league season. */
export interface LeaguePlace {
  position: number;
  teamId: string;
  teamName: string;
  points: number;
  goalDifference: number;
}

/** One league's season: who won it and who else made the podium. */
export interface LeagueSeasonResult {
  season: number;
  yearLabel: string;
  /** Champions first, down to 4th — fewer if the division is smaller than that. */
  top: LeaguePlace[];
}

/** A division and every season of it the save has recorded. */
export interface LeagueHistory {
  id: string;
  name: string;
  country: string;
  tier: number;
  /** True for a division in the manager's own pyramid — the UI leads with these. */
  own: boolean;
  /** Most recent season first. */
  seasons: LeagueSeasonResult[];
}

/** A cup final: the two clubs that contested it. `runnerUp` is absent on
 * pre-v1.91 summaries, which recorded only the winner. */
export interface CupSeasonResult {
  season: number;
  yearLabel: string;
  winner: { teamId: string; teamName: string };
  runnerUp?: { teamId: string; teamName: string };
}

export interface CupHistory {
  id: string;
  name: string;
  kind: "cup" | "european";
  /** Ordering only: the domestic cup leads, then the European cups by tier. */
  tier: number;
  /** Most recent season first. */
  seasons: CupSeasonResult[];
}

/** How many places below the champion the history view shows. Four is the
 * podium a league season is actually remembered by — the title race plus who
 * else got into Europe. */
const LEAGUE_PLACES = 4;

/**
 * Every league in the save with a recorded season, grouped-ready for the UI.
 *
 * Ordered nation-first with the manager's own country leading, and within a
 * nation by tier, so the list reads as pyramids rather than as an alphabet. A
 * league the world no longer runs (a database change between saves) keeps its
 * history and falls back to its stored id for a name, exactly as
 * `competitionHistories` does.
 */
export function leagueHistories(state: GameState): LeagueHistory[] {
  const seasons = state.recordBook.seasons;
  const own = new Set(state.divisionIds ?? []);
  const homeCountry = state.leagues[state.divisionIds?.[0] ?? ""]?.country;

  // Driven off what the summaries recorded, not off the live league list.
  const ids = new Set<string>();
  for (const s of seasons) for (const id of Object.keys(s.finalTables)) ids.add(id);

  const out: LeagueHistory[] = [];
  for (const id of ids) {
    const league = state.leagues[id];
    const rows: LeagueSeasonResult[] = [];
    for (const s of seasons) {
      const table = s.finalTables[id];
      if (!table?.length) continue;
      rows.push({
        season: s.season,
        yearLabel: s.yearLabel,
        top: table.slice(0, LEAGUE_PLACES).map((r, i) => ({
          position: i + 1,
          teamId: r.teamId,
          // The table stores ids only, so the name is looked up live and falls
          // back to the id for a club the save has since dropped.
          teamName: state.teams[r.teamId]?.name ?? r.teamId,
          points: r.points,
          goalDifference: r.gf - r.ga,
        })),
      });
    }
    if (!rows.length) continue;
    rows.reverse(); // most recent first
    out.push({
      id,
      name: league?.name ?? id,
      country: league?.country ?? "—",
      tier: league?.tier ?? 99,
      own: own.has(id),
      seasons: rows,
    });
  }

  return out.sort(
    (a, b) =>
      // The manager's own pyramid first, then their nation, then everyone else
      // alphabetically; within a country, top flight down.
      Number(b.own) - Number(a.own) ||
      Number(b.country === homeCountry) - Number(a.country === homeCountry) ||
      a.country.localeCompare(b.country) ||
      a.tier - b.tier ||
      a.name.localeCompare(b.name)
  );
}

/**
 * Every cup in the save — the domestic one and each European competition —
 * with both finalists per season.
 *
 * Separate from `leagueHistories` because a cup has no table: its season is two
 * clubs, not a podium, and folding them into one shape would mean rendering an
 * empty "2nd/3rd/4th" for every cup ever played.
 */
export function cupHistories(state: GameState): CupHistory[] {
  const seasons = state.recordBook.seasons;
  const out: CupHistory[] = [];

  const domestic: CupSeasonResult[] = [];
  for (const s of seasons) {
    if (!s.cupWinner) continue;
    domestic.push({
      season: s.season,
      yearLabel: s.yearLabel,
      winner: s.cupWinner,
      runnerUp: s.cupRunnerUp ?? undefined,
    });
  }
  if (domestic.length) {
    domestic.reverse();
    out.push({ id: "CUP", name: "Cup", kind: "cup", tier: 0, seasons: domestic });
  }

  const euro = new Map<string, CupHistory>();
  for (const s of seasons) {
    for (const w of s.europeanWinners ?? []) {
      const key = `EURO${w.tier}`;
      const row =
        euro.get(key) ?? { id: key, name: w.cupName, kind: "european" as const, tier: w.tier, seasons: [] };
      row.seasons.push({
        season: s.season,
        yearLabel: s.yearLabel,
        winner: { teamId: w.teamId, teamName: w.teamName },
        runnerUp:
          w.runnerUpId && w.runnerUpName
            ? { teamId: w.runnerUpId, teamName: w.runnerUpName }
            : undefined,
      });
      euro.set(key, row);
    }
  }
  for (const row of euro.values()) {
    row.seasons.reverse();
    out.push(row);
  }

  return out.sort((a, b) => a.tier - b.tier);
}

// ── What's BEHIND a tally on the accolades screen (v1.91) ─────────────────
//
// `state.progress.accolades` holds counts — 3 league titles, 11 player honours.
// A count is a claim with nothing to inspect: it says the manager won three
// leagues but not which, or when. Everything below re-derives the ROWS those
// counts were accumulated from, so clicking a number opens the seasons it is
// made of.
//
// Derived, never stored, from the same two sources the counters read at the
// rollover: `clubHonours` for team silverware and each season summary's own
// accolade block for the individual honours. That is what keeps the modal and
// the headline number from drifting — they are the same rows, counted once and
// listed once.

/** One individual honour won by one of the manager's players. */
export interface PlayerHonourRow {
  season: number;
  yearLabel: string;
  /** `ACCOLADE_META` key — the UI reads the title and emoji from there. */
  type: AccoladeType;
  playerId: string;
  playerName: string;
  /** The division it was won in; absent for the two save-wide legacy awards. */
  leagueName?: string;
}

/**
 * Every individual honour won by a player of the manager's club, most recent
 * first.
 *
 * Read off each season summary's stored accolade block and filtered to the
 * user's club exactly as `userPlayerAwardsIn` counts them, so the list length
 * matches the "Player Honours" tally by construction. A team-of-the-season pick
 * counts as one honour each, which is what the counter does too.
 */
export function userPlayerHonours(state: GameState): PlayerHonourRow[] {
  const out: PlayerHonourRow[] = [];
  const userTeamId = state.userTeamId;

  for (const s of state.recordBook.seasons) {
    const acc = s.accolades;
    if (!acc) continue; // pre-v24 summary: no honours recorded at all
    const add = (type: AccoladeType, w: AwardWinner | undefined, leagueName?: string) => {
      if (!w || w.teamId !== userTeamId) return;
      out.push({
        season: s.season,
        yearLabel: s.yearLabel,
        type,
        playerId: w.playerId,
        playerName: w.name,
        leagueName,
      });
    };

    for (const [leagueId, block] of Object.entries(acc.byLeague)) {
      // The league NAME is looked up live and falls back to the id, the same
      // way every other view in this file handles a division the save dropped.
      const leagueName = state.leagues[leagueId]?.name ?? leagueId;
      add("playerOfSeason", block.playerOfSeason, leagueName);
      add("youngPlayerOfSeason", block.youngPlayerOfSeason, leagueName);
      add("goldenBoot", block.goldenBoot, leagueName);
      add("goldenPlaymaker", block.goldenPlaymaker, leagueName);
      add("goldenGlove", block.goldenGlove, leagueName);
      add("goldenWall", block.goldenWall, leagueName);
      for (const w of block.teamOfSeason ?? []) add("teamOfSeason", w, leagueName);
    }
    add("legacyPlayerOfSeason", acc.legacyPlayerOfSeason);
    for (const w of acc.legacyTeamOfSeason ?? []) add("legacyTeamOfSeason", w);
  }

  return out.sort((a, b) => b.season - a.season || a.type.localeCompare(b.type));
}

/**
 * Every trophy the user's club has ever lifted, most recent first (v1.89).
 *
 * The same rows as `competitionHistories`, filtered to one club and flattened
 * back into season order — which is the question "what have WE won?" rather than
 * "who has won this?". Kept here rather than derived in the component so the
 * cabinet and the roll of honour can never disagree about what counts as a
 * trophy.
 */
export function clubHonours(
  state: GameState,
  teamId: string
): { season: number; yearLabel: string; competition: string; kind: CompetitionHistory["kind"] }[] {
  const out: { season: number; yearLabel: string; competition: string; kind: CompetitionHistory["kind"] }[] = [];
  for (const comp of competitionHistories(state)) {
    for (const w of comp.winners) {
      if (w.teamId !== teamId) continue;
      out.push({ season: w.season, yearLabel: w.yearLabel, competition: comp.name, kind: comp.kind });
    }
  }
  return out.sort((a, b) => b.season - a.season || a.competition.localeCompare(b.competition));
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
  const totals = new Map<string, { id: string; name: string; nationality?: string; pos?: import("./types").Pos; apps: number; goals: number; assists: number; cleanSheets: number }>();
  const add = (
    playerId: string,
    name: string,
    nationality: string | undefined,
    pos: import("./types").Pos | undefined,
    apps: number,
    goals: number,
    assists: number,
    cleanSheets: number
  ) => {
    const t = totals.get(playerId) ?? { id: playerId, name, nationality, pos, apps: 0, goals: 0, assists: 0, cleanSheets: 0 };
    t.apps += apps;
    t.goals += goals;
    t.assists += assists;
    t.cleanSheets += cleanSheets;
    totals.set(playerId, t);
  };
  for (const c of Object.values(state.careers)) {
    for (const row of c.seasons) {
      if (row.clubName === teamName) {
        const p = state.players[c.playerId];
        add(c.playerId, p?.name ?? "?", p?.nationality, p?.positions[0], row.apps, row.goals, row.assists, row.cleanSheets ?? 0);
      }
    }
  }
  // include current season running stats
  for (const pid of state.teams[teamId].playerIds) {
    const p = state.players[pid];
    if (p) add(p.id, p.name, p.nationality, p.positions[0], p.stats.apps, p.stats.goals, p.stats.assists, p.stats.cleanSheets ?? 0);
  }
  const rows = [...totals.values()];
  return {
    topScorers: rows.slice().sort((a, b) => b.goals - a.goals).slice(0, 10),
    topAssists: rows.slice().sort((a, b) => b.assists - a.assists).slice(0, 10),
    mostAppearances: rows.slice().sort((a, b) => b.apps - a.apps).slice(0, 10),
    cleanSheets: rows.filter((r) => r.cleanSheets > 0).sort((a, b) => b.cleanSheets - a.cleanSheets).slice(0, 10),
  };
}

// ── One player's whole career, in one line (v1.86) ────────────────────────

/** A player's career rolled up across every season row he has. */
export interface CareerSummary {
  /** Seasons with at least one appearance recorded. */
  seasons: number;
  apps: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  /** Appearance-weighted mean of the per-season averages — a mean of means
   * would over-weight a two-game cameo against a full campaign. Zero when he
   * has never played. */
  avgRating: number;
  /** Every award won, most recent first, de-duplicated with a count. */
  awards: { name: string; count: number }[];
  /** Distinct clubs he played for, in the order he played for them. */
  clubs: { id?: string; name: string }[];
  /** First and last season he appears in, or null if he has no rows yet. */
  span: { from: number; to: number } | null;
  /** His best recorded overall — the peak of the career, not today's rating.
   * Read from the stored per-season start overalls and his live rating, so a
   * declining veteran is still remembered at his height. */
  peakOverall: number;
}

/**
 * Roll one player's stored career rows into totals.
 *
 * Lives here rather than in a component because it is a fact about the save's
 * cold data, and more than one surface wants it — the Hall of Fame's summary
 * and, eventually, the profile's own header. `includeCurrent` folds in the
 * running season stats that haven't been compressed into a row yet, which is
 * what a living player's card should show; a retiree simply has none.
 */
export function careerSummary(
  state: GameState,
  playerId: string,
  includeCurrent = true
): CareerSummary {
  const rows = state.careers[playerId]?.seasons ?? [];
  const p = state.players[playerId];

  let apps = 0;
  let goals = 0;
  let assists = 0;
  let cleanSheets = 0;
  let ratingWeight = 0;
  let ratingSum = 0;
  let peakOverall = p?.overall ?? 0;
  const awardCounts = new Map<string, number>();
  const clubs: { id?: string; name: string }[] = [];
  const seenSeasons = new Set<number>();

  for (const row of rows) {
    apps += row.apps;
    goals += row.goals;
    assists += row.assists;
    cleanSheets += row.cleanSheets ?? 0;
    if (row.avgRating > 0 && row.apps > 0) {
      ratingSum += row.avgRating * row.apps;
      ratingWeight += row.apps;
    }
    if (typeof row.startOverall === "number" && row.startOverall > peakOverall) {
      peakOverall = row.startOverall;
    }
    for (const award of row.awards ?? []) {
      awardCounts.set(award, (awardCounts.get(award) ?? 0) + 1);
    }
    // A season can hold several competition rows; only the club spell and the
    // season count should collapse across them.
    if (row.apps > 0) seenSeasons.add(row.season);
    if (clubs[clubs.length - 1]?.name !== row.clubName) {
      clubs.push({ id: row.clubId, name: row.clubName });
    }
  }

  if (includeCurrent && p && !p.retired) {
    apps += p.stats.apps;
    goals += p.stats.goals;
    assists += p.stats.assists;
    cleanSheets += p.stats.cleanSheets ?? 0;
    if (p.stats.apps > 0) {
      seenSeasons.add(state.season);
      const rating = p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : 0;
      if (rating > 0) {
        ratingSum += rating * p.stats.apps;
        ratingWeight += p.stats.apps;
      }
    }
    const club = p.clubId ? state.teams[p.clubId] : undefined;
    if (club && clubs[clubs.length - 1]?.name !== club.name) {
      clubs.push({ id: club.id, name: club.name });
    }
  }

  const seasonNumbers = rows.map((r) => r.season);
  return {
    seasons: seenSeasons.size,
    apps,
    goals,
    assists,
    cleanSheets,
    avgRating: ratingWeight > 0 ? ratingSum / ratingWeight : 0,
    awards: [...awardCounts.entries()].map(([name, count]) => ({ name, count })),
    clubs,
    span: seasonNumbers.length
      ? { from: Math.min(...seasonNumbers), to: Math.max(...seasonNumbers) }
      : null,
    peakOverall,
  };
}

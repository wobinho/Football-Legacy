// Sim-League Resolver (§4): cheap statistical resolution of non-playable
// leagues. Never runs the match engine. Produces plausible tables + top scorer
// lists so the player has current form to judge when shopping abroad.
//
// Timing (v23): resolved at the start of every season (worldgen for a fresh
// save, the rollover thereafter) so the open summer window has data from day
// one, again when the winter window opens, and a final pass (half 2) the day
// after the last league round — early enough that the completed final table is
// browsable while the season it belongs to is still on screen. That final pass
// also writes realistic minutes so sim players age like their playable peers.

import type { GameState, SimLeagueResult, SimTopAssister, TableRow } from "./types";
import type { TuningConfig } from "./config/tuning";
import { teamStrength } from "./selection";
import { mulberry32, deriveSeed, randNormal, pickWeighted } from "./rng";

export function resolveSimLeagues(state: GameState, half: 1 | 2, cfg: TuningConfig) {
  for (const league of Object.values(state.leagues)) {
    if (league.playable) continue;
    const rng = mulberry32(deriveSeed(state.seed, `sim:${league.id}:${state.season}:${half}`));
    const n = league.teamIds.length;
    const gamesTotal = (n - 1) * 2;
    const games = half === 1 ? Math.floor(gamesTotal / 2) : gamesTotal;

    // strength + noise → finishing order
    const rated = league.teamIds.map((id) => {
      const players = state.teams[id].playerIds.map((pid) => state.players[pid]).filter(Boolean);
      return { id, score: teamStrength(players, cfg) + randNormal(rng) * cfg.simTableNoise };
    });
    rated.sort((a, b) => b.score - a.score);

    // synthesize plausible records from finishing position
    const table: TableRow[] = rated.map((r, i) => {
      const posFactor = 1 - i / (n - 1); // 1 top → 0 bottom
      const winRate = 0.2 + posFactor * 0.55 + randNormal(rng) * 0.03;
      const drawRate = 0.24 + randNormal(rng) * 0.04;
      const won = Math.round(games * Math.min(0.9, Math.max(0.08, winRate)));
      const drawn = Math.min(games - won, Math.max(0, Math.round(games * drawRate)));
      const lost = games - won - drawn;
      const gf = Math.round(won * 2.0 + drawn * 1.1 + lost * 0.7 + randNormal(rng) * 3);
      const ga = Math.round(won * 0.7 + drawn * 1.1 + lost * 2.0 + randNormal(rng) * 3);
      return { teamId: r.id, played: games, won, drawn, lost, gf: Math.max(0, gf), ga: Math.max(0, ga), points: won * 3 + drawn };
    });
    table.sort((a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga));

    // baseline minutes for every sim player so the shared aging function sees
    // realistic usage (starters grow/decline like their playable peers)
    if (half === 2) {
      for (const tid of league.teamIds) {
        const squad = state.teams[tid].playerIds
          .map((pid) => state.players[pid])
          .filter((p) => p && !p.retired)
          .sort((a, b) => b.overall - a.overall);
        squad.forEach((p, i) => {
          const apps = i < 15 ? Math.round(22 + rng() * 10) : Math.round(4 + rng() * 10);
          p.stats.apps = Math.min(games, apps);
          p.stats.minutes = p.stats.apps * Math.round(60 + rng() * 25);
          p.stats.ratingSum = p.stats.apps * (6.3 + rng() * 0.5);
        });
      }
    }

    // standout stat lines: attackers weighted by overall, goals scale with team finish
    const attackers = league.teamIds.flatMap((tid) =>
      state.teams[tid].playerIds
        .map((pid) => state.players[pid])
        .filter((p) => p && !p.retired && (p.positions[0] === "ST" || p.positions[0] === "LW" || p.positions[0] === "RW" || p.positions[0] === "AM"))
    );
    const scorers = new Map<string, number>();
    const assisters = new Map<string, number>();
    const totalGoals = Math.round(games * n * 1.35);
    for (let g = 0; g < totalGoals; g++) {
      const p = pickWeighted(rng, attackers, (a) => Math.pow(Math.max(1, a.overall - 55), 2.2));
      scorers.set(p.id, (scorers.get(p.id) ?? 0) + 1);
      // Not every goal is assisted; the rest are solo efforts / rebounds. When it
      // is, the creator is another attacker weighted by passing rather than
      // finishing, so playmakers rise to the top of the assist chart.
      if (rng() < 0.72 && attackers.length > 1) {
        let a = p;
        for (let tries = 0; tries < 4 && a === p; tries++) {
          a = pickWeighted(rng, attackers, (x) => Math.pow(Math.max(1, x.attrs.pas - 55), 2.0));
        }
        if (a !== p) assisters.set(a.id, (assisters.get(a.id) ?? 0) + 1);
      }
    }
    const topScorers = [...scorers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([playerId, goals]) => ({ playerId, goals }));
    const topAssists: SimTopAssister[] = [...assisters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([playerId, assists]) => ({ playerId, assists }));

    // write season stats onto sim players so profiles look alive
    for (const [playerId, goals] of scorers) {
      const p = state.players[playerId];
      if (!p) continue;
      p.stats.goals = goals;
      p.stats.apps = Math.min(games, Math.round(games * (0.6 + rng() * 0.35)));
      p.stats.minutes = p.stats.apps * 78;
      p.stats.ratingSum = p.stats.apps * (6.4 + Math.min(1.4, goals / 12));
    }
    for (const [playerId, assists] of assisters) {
      const p = state.players[playerId];
      if (!p) continue;
      p.stats.assists = assists;
      // Assist-only creators still need a plausible appearance count.
      if (p.stats.apps === 0) {
        p.stats.apps = Math.min(games, Math.round(games * (0.6 + rng() * 0.35)));
        p.stats.minutes = p.stats.apps * 78;
        p.stats.ratingSum = p.stats.apps * (6.4 + Math.min(1.0, assists / 12));
      }
    }

    const result: SimLeagueResult = { leagueId: league.id, season: state.season, half, table, topScorers, topAssists };
    state.simResults = state.simResults.filter((r) => r.leagueId !== league.id);
    state.simResults.push(result);
  }
}

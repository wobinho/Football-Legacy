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

import type { Attributes, GameState, SimLeagueResult, SimTopAssister, TableRow } from "./types";
import type { TuningConfig } from "./config/tuning";
import { teamStrength } from "./selection";
import { globalFootballMult } from "./gcnexec";
import { mulberry32, deriveSeed, randNormal, pickWeighted } from "./rng";

/** How likely a player is to be the one who MAKES a goal (v41). The 35-attribute
 * model can say this properly: chance creation is vision and passing range, not
 * a single blended "passing" number. Weighted toward vision because seeing the
 * pass is what separates a creator from a merely tidy passer. */
function creativity(a: Attributes): number {
  return a.vision * 0.4 + a.shortPassing * 0.25 + a.longPassing * 0.2 + a.crossing * 0.15;
}

export function resolveSimLeagues(state: GameState, half: 0 | 1 | 2, cfg: TuningConfig) {
  for (const league of Object.values(state.leagues)) {
    if (league.playable) continue;
    const rng = mulberry32(deriveSeed(state.seed, `sim:${league.id}:${state.season}:${half}`));
    const n = league.teamIds.length;
    const gamesTotal = (n - 1) * 2;
    // 0 = season not yet started (fresh table, 0 games), 1 = ~halfway, 2 = full
    const games = half === 0 ? 0 : half === 1 ? Math.floor(gamesTotal / 2) : gamesTotal;

    // strength + noise → finishing order
    //
    // v1.95: a club the network owns has its strength multiplied by the Director
    // of Global Football, exactly as a playable-league side has its match-day
    // rating multiplied in `sideInputFor`. Both are the same claim — "this club
    // is better coached" — and they have to be made in both places or the seat's
    // effect would depend on which kind of league a holding happens to sit in,
    // which is nothing the manager chose. `globalFootballMult` returns 1 for
    // every other club, so the sim world is otherwise untouched.
    const rated = league.teamIds.map((id) => {
      const players = state.teams[id].playerIds.map((pid) => state.players[pid]).filter(Boolean);
      const score =
        teamStrength(players, cfg) * globalFootballMult(state, id, cfg) +
        randNormal(rng) * cfg.simTableNoise;
      return { id, score };
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
      // A sim league's mean quality, so a player's season rating can be scored
      // against the standard he actually played at. Without it a 78-rated
      // player rates the same in a weak division as in a strong one, which is
      // the thing `leagueReputation` exists to say he shouldn't.
      const all = league.teamIds.flatMap((tid) =>
        state.teams[tid].playerIds.map((pid) => state.players[pid]).filter((p) => p && !p.retired)
      );
      const leagueMean =
        all.length > 0 ? all.reduce((s, p) => s + p.overall, 0) / all.length : 65;

      // Finishing position per club, so a good player in a winning side rates
      // above the same player in a relegated one — the sim's counterpart to the
      // playable engine's goal-difference and clean-sheet terms.
      const finishShare = new Map<string, number>();
      table.forEach((row, i) => finishShare.set(row.teamId, n > 1 ? 1 - i / (n - 1) : 0.5));

      for (const tid of league.teamIds) {
        const squad = state.teams[tid].playerIds
          .map((pid) => state.players[pid])
          .filter((p) => p && !p.retired)
          .sort((a, b) => b.overall - a.overall);
        const finish = finishShare.get(tid) ?? 0.5;
        squad.forEach((p, i) => {
          const apps = i < 15 ? Math.round(22 + rng() * 10) : Math.round(4 + rng() * 10);
          p.stats.apps = Math.min(games, apps);
          p.stats.minutes = p.stats.apps * Math.round(60 + rng() * 25);
          // v2.0: the same three ideas the playable engine's ratings are built
          // from — how good he is for this level, what his side achieved, and
          // luck — rather than a flat 6.3–6.8 band that made every sim player
          // interchangeable and left the two save-wide legacy awards (whose
          // pool is every top flight in the world) decided by noise.
          const quality = (p.overall - leagueMean) * cfg.simRatingPerOverall;
          const success = (finish - 0.5) * cfg.simRatingFinishSwing;
          const season = cfg.ratingBase + quality + success + randNormal(rng) * cfg.simRatingNoiseSd;
          p.stats.ratingSum =
            p.stats.apps *
            Math.max(cfg.ratingMin, Math.min(cfg.ratingMax, season));
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
          a = pickWeighted(rng, attackers, (x) => Math.pow(Math.max(1, creativity(x.attrs) - 55), 2.0));
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
    //
    // v2.0: goals and assists now ADD to the rating the pass above already
    // gave the player, rather than replacing it with a bare function of his
    // goal tally. Replacing it threw away everything the season rating knew —
    // how good he is for the level, what his side achieved — so the top scorer
    // in a relegated side rated identically to the top scorer in the champions,
    // and a 20-goal striker and a 20-goal one in a division 15 points weaker
    // were the same candidate. Clamped exactly as the per-match ratings are.
    const bump = (p: (typeof state.players)[string], add: number) => {
      const cur = p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : cfg.ratingBase;
      p.stats.ratingSum =
        p.stats.apps * Math.max(cfg.ratingMin, Math.min(cfg.ratingMax, cur + add));
    };
    for (const [playerId, goals] of scorers) {
      const p = state.players[playerId];
      if (!p) continue;
      p.stats.goals = goals;
      if (p.stats.apps === 0) {
        p.stats.apps = Math.min(games, Math.round(games * (0.6 + rng() * 0.35)));
        p.stats.minutes = p.stats.apps * 78;
      }
      bump(p, Math.min(cfg.simRatingScorerMax, (goals / Math.max(1, p.stats.apps)) * cfg.ratingPerGoal));
    }
    for (const [playerId, assists] of assisters) {
      const p = state.players[playerId];
      if (!p) continue;
      p.stats.assists = assists;
      // Assist-only creators still need a plausible appearance count.
      if (p.stats.apps === 0) {
        p.stats.apps = Math.min(games, Math.round(games * (0.6 + rng() * 0.35)));
        p.stats.minutes = p.stats.apps * 78;
      }
      bump(
        p,
        Math.min(cfg.simRatingScorerMax, (assists / Math.max(1, p.stats.apps)) * cfg.ratingPerAssist)
      );
    }

    const result: SimLeagueResult = { leagueId: league.id, season: state.season, half, table, topScorers, topAssists };
    state.simResults = state.simResults.filter((r) => r.leagueId !== league.id);
    state.simResults.push(result);
  }
}

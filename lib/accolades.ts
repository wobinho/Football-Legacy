// Player Accolades (§ end-of-season honours).
//
// Every season, once the tables are final and before the development pass ages
// the world, each league hands out its individual honours and picks a Team of
// the Season; the save as a whole crowns a Legacy Player and a Legacy Team of
// the Year across every league. The winners are stamped onto the players
// themselves (PlayerBio.accolades) so a cabinet is permanent — it survives
// retirement and shows on the profile card forever — and captured on the season
// summary (SeasonAccolades) so the record book's season review can render the
// full slate without re-deriving from a world that has since moved on.
//
// Stats source is uniform: every player carries this season's running
// `stats` (apps / goals / assists / ratingSum). Playable leagues fill them from
// real matches; sim leagues fill the same fields in resolveSimLeagues(half 2).
// So the same rating/goals/assists reads work for the whole world, and accolades
// MUST be computed after the final sim resolution and before stats are cleared.

import type {
  AccoladeType,
  AwardWinner,
  GameState,
  PlayerBio,
  SeasonAccolades,
} from "./types";
import { posGroup } from "./config/positions";
import { activePlayers } from "./archive";

/** Display metadata for each accolade — title, emblem, and a one-line blurb.
 * Pure data (no engine branches on it); the UI reads it to render a cabinet. */
export const ACCOLADE_META: Record<AccoladeType, { title: string; emoji: string; blurb: string }> = {
  playerOfSeason: { title: "Player of the Season", emoji: "🏆", blurb: "Highest average rating in the league" },
  youngPlayerOfSeason: { title: "Young Player of the Season", emoji: "⭐", blurb: "Highest-rated player under 21" },
  goldenBoot: { title: "Golden Boot", emoji: "👟", blurb: "Most goals in the league" },
  goldenPlaymaker: { title: "Golden Playmaker", emoji: "🎯", blurb: "Most assists in the league" },
  goldenGlove: { title: "Golden Glove", emoji: "🧤", blurb: "Highest-rated goalkeeper in the league" },
  teamOfSeason: { title: "Team of the Season", emoji: "✨", blurb: "Named in the league's XI of the season" },
  legacyPlayerOfSeason: { title: "Legacy Player of the Year", emoji: "👑", blurb: "Highest-rated player across all leagues" },
  legacyTeamOfSeason: { title: "Legacy Team of the Year", emoji: "💎", blurb: "Named in the save's XI of the year" },
};

/** Minimum appearances before a player is eligible for a rating-based honour.
 * Goals/assists honours have no minimum — a tally is a tally. Matches the
 * record book's Player-of-the-Season threshold so the two never disagree. */
const MIN_APPS_FOR_RATING = 15;

/** Age ceiling (inclusive) for the Young Player award. */
const YOUNG_MAX_AGE = 21;

/** The XI shape a Team of the Season must respect: at most this many of each
 * position group, eleven in total. Filled best-first with graceful fallback
 * when a group runs short (a league light on keepers still fields eleven). */
const TEAM_SHAPE: { group: ReturnType<typeof posGroup>; max: number }[] = [
  { group: "GK", max: 1 },
  { group: "DEF", max: 4 },
  { group: "MID", max: 3 },
  { group: "ATT", max: 4 },
];
const TEAM_SIZE = 11;

/** A player's average match rating this season, or 0 if he never played. */
function avgRating(p: PlayerBio): number {
  return p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : 0;
}

function toWinner(state: GameState, p: PlayerBio, stat?: number): AwardWinner {
  return {
    playerId: p.id,
    name: p.name,
    teamName: p.clubId ? state.teams[p.clubId]?.name ?? "—" : "—",
    pos: p.positions[0],
    stat,
  };
}

/** Every player who played in a given league this season (apps > 0). */
function leaguePlayers(state: GameState, leagueId: string): PlayerBio[] {
  const out: PlayerBio[] = [];
  for (const p of activePlayers(state)) {
    if (!p.clubId) continue;
    if (state.teams[p.clubId]?.leagueId !== leagueId) continue;
    if (p.stats.apps <= 0) continue;
    out.push(p);
  }
  return out;
}

/** Highest single value in `pool` under `score`, requiring the value be > 0. */
function best(pool: PlayerBio[], score: (p: PlayerBio) => number): PlayerBio | null {
  let winner: PlayerBio | null = null;
  let bestScore = 0;
  for (const p of pool) {
    const s = score(p);
    if (s > bestScore) {
      bestScore = s;
      winner = p;
    }
  }
  return winner;
}

/**
 * Build the XI of the season from a candidate pool: the highest-rated players
 * respecting the position caps (max 1 GK / 4 DEF / 3 MID / 4 ATT). Filled in two
 * passes — first honouring the caps, then topping up to eleven with the best
 * players left regardless of group, so a pool short in one area still fields a
 * full team. Returns the picks in shape order (GK → DEF → MID → ATT).
 */
function pickTeamOfSeason(pool: PlayerBio[]): PlayerBio[] {
  const eligible = pool
    .filter((p) => p.stats.apps >= MIN_APPS_FOR_RATING)
    .sort((a, b) => avgRating(b) - avgRating(a));

  const chosen: PlayerBio[] = [];
  const used = new Set<string>();
  const groupCount: Record<string, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  const capOf = (g: string) => TEAM_SHAPE.find((s) => s.group === g)?.max ?? 0;

  // Pass 1: best-first, respecting each group's cap.
  for (const p of eligible) {
    if (chosen.length >= TEAM_SIZE) break;
    const g = posGroup(p.positions[0]);
    if (groupCount[g] >= capOf(g)) continue;
    chosen.push(p);
    used.add(p.id);
    groupCount[g]++;
  }
  // Pass 2: top up to eleven with whoever's left (caps relaxed) so the XI is
  // always full even if a group ran dry — a real Team of the Season never fields
  // ten men because there weren't enough centre backs.
  for (const p of eligible) {
    if (chosen.length >= TEAM_SIZE) break;
    if (used.has(p.id)) continue;
    chosen.push(p);
    used.add(p.id);
  }

  // Re-order into shape order (GK first, then DEF, MID, ATT) for display.
  const order: Record<string, number> = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
  return chosen.sort((a, b) => order[posGroup(a.positions[0])] - order[posGroup(b.positions[0])]);
}

/** Record an accolade on a player's permanent cabinet. */
function award(p: PlayerBio, type: AccoladeType, season: number, league?: { id: string; name: string }, slot?: Accolade["slot"]) {
  (p.accolades ??= []).push({
    type,
    season,
    leagueId: league?.id,
    leagueName: league?.name,
    slot,
  });
}
type Accolade = NonNullable<PlayerBio["accolades"]>[number];

/**
 * Compute and assign every season honour. Stamps the winning players'
 * `accolades` and returns the structured `SeasonAccolades` for the summary.
 * Call at the season rollover AFTER the final sim resolution (stats populated)
 * and BEFORE the development pass clears them.
 */
export function computeSeasonAccolades(state: GameState): SeasonAccolades {
  const season = state.season;
  const result: SeasonAccolades = { byLeague: {} };

  // Track the whole world's eligible players for the two save-wide legacy awards.
  const worldPool: PlayerBio[] = [];

  for (const league of Object.values(state.leagues)) {
    const pool = leaguePlayers(state, league.id);
    if (!pool.length) continue;
    worldPool.push(...pool);

    const leagueRef = { id: league.id, name: league.name };
    const rated = pool.filter((p) => p.stats.apps >= MIN_APPS_FOR_RATING);

    const block: SeasonAccolades["byLeague"][string] = {};

    // Player of the Season — highest average rating (min apps).
    const poty = best(rated, avgRating);
    if (poty) {
      award(poty, "playerOfSeason", season, leagueRef);
      block.playerOfSeason = toWinner(state, poty, Math.round(avgRating(poty) * 100) / 100);
    }

    // Young Player of the Season — highest-rated U21 (min apps).
    const yPool = rated.filter((p) => p.age <= YOUNG_MAX_AGE);
    const ypoty = best(yPool, avgRating);
    if (ypoty) {
      award(ypoty, "youngPlayerOfSeason", season, leagueRef);
      block.youngPlayerOfSeason = toWinner(state, ypoty, Math.round(avgRating(ypoty) * 100) / 100);
    }

    // Golden Boot — most goals (no apps minimum; a tally is a tally).
    const boot = best(pool, (p) => p.stats.goals);
    if (boot) {
      award(boot, "goldenBoot", season, leagueRef);
      block.goldenBoot = toWinner(state, boot, boot.stats.goals);
    }

    // Golden Playmaker — most assists.
    const playmaker = best(pool, (p) => p.stats.assists);
    if (playmaker) {
      award(playmaker, "goldenPlaymaker", season, leagueRef);
      block.goldenPlaymaker = toWinner(state, playmaker, playmaker.stats.assists);
    }

    // Golden Glove — highest-rated goalkeeper (min apps).
    const glove = best(rated.filter((p) => p.positions[0] === "GK"), avgRating);
    if (glove) {
      award(glove, "goldenGlove", season, leagueRef);
      block.goldenGlove = toWinner(state, glove, Math.round(avgRating(glove) * 100) / 100);
    }

    // Team of the Season — the XI, position-capped.
    const xi = pickTeamOfSeason(pool);
    if (xi.length) {
      block.teamOfSeason = xi.map((p) => {
        const slot = posGroup(p.positions[0]);
        award(p, "teamOfSeason", season, leagueRef, slot);
        return toWinner(state, p, Math.round(avgRating(p) * 100) / 100);
      });
    }

    result.byLeague[league.id] = block;
  }

  // ── Save-wide legacy honours ──────────────────────────────────────────────
  const legacyRated = worldPool.filter((p) => p.stats.apps >= MIN_APPS_FOR_RATING);

  const legacyPoty = best(legacyRated, avgRating);
  if (legacyPoty) {
    award(legacyPoty, "legacyPlayerOfSeason", season);
    result.legacyPlayerOfSeason = toWinner(state, legacyPoty, Math.round(avgRating(legacyPoty) * 100) / 100);
  }

  const legacyXi = pickTeamOfSeason(worldPool);
  if (legacyXi.length) {
    result.legacyTeamOfSeason = legacyXi.map((p) => {
      const slot = posGroup(p.positions[0]);
      award(p, "legacyTeamOfSeason", season, undefined, slot);
      return toWinner(state, p, Math.round(avgRating(p) * 100) / 100);
    });
  }

  return result;
}

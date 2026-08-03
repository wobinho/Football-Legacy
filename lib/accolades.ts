// Player Accolades (§ end-of-season honours).
//
// Every season, once the tables are final and before the development pass ages
// the world, each league hands out its individual honours and picks a Team of
// the Season; the save as a whole crowns a Legacy Player and a Legacy Team of
// the Year from the world's TOP DIVISIONS ONLY (v1.5) — every league gives out
// its own honours, but the two legacy awards are the best in the world, and a
// dominant second-tier campaign must not outrank a first-division one. The
// winners are stamped onto the players
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
import type { TuningConfig } from "./config/tuning";
import { TUNING } from "./config/tuning";
import { posGroup } from "./config/positions";
import { LEAGUE_REP_MAX, LEAGUE_REP_MIN, leagueReputation } from "./config/leaguerep";
import { activePlayers } from "./archive";
import { computeTable } from "./season";

/** Display metadata for each accolade — title, emblem, and a one-line blurb.
 * Pure data (no engine branches on it); the UI reads it to render a cabinet. */
export const ACCOLADE_META: Record<AccoladeType, { title: string; emoji: string; blurb: string }> = {
  playerOfSeason: { title: "Player of the Season", emoji: "🏆", blurb: "Best season in the league — rating, weighted by what his side won" },
  youngPlayerOfSeason: { title: "Young Player of the Season", emoji: "⭐", blurb: "Best season in the league by a player under 21" },
  goldenBoot: { title: "Golden Boot", emoji: "👟", blurb: "Most goals in the league" },
  goldenPlaymaker: { title: "Golden Playmaker", emoji: "🎯", blurb: "Most assists in the league" },
  goldenGlove: { title: "Golden Glove", emoji: "🧤", blurb: "Best season in the league by a goalkeeper" },
  goldenWall: { title: "Golden Wall", emoji: "🧱", blurb: "Best season in the league by a centre-back" },
  teamOfSeason: { title: "Team of the Season", emoji: "✨", blurb: "Named in the league's XI of the season" },
  legacyPlayerOfSeason: { title: "Legacy Player of the Year", emoji: "👑", blurb: "Best season in the world's top divisions" },
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

// ── Team success weighting (v1.67) ────────────────────────────────────────
// An individual award used to be decided on average match rating alone, which
// gave the trophy to whoever farmed the best numbers regardless of whether his
// side won anything. Real awards don't work that way: a title-winning season, a
// cup run and a European campaign all carry a player's case. So a candidate's
// score is now his rating LIFTED by what his club achieved:
//
//   score = avgRating × (1 + teamSuccess)
//
// where teamSuccess is the sum of four bounded components (league finish, the
// domestic cup, Europe, and — since v1.87 — the STANDING of the division he
// played in). The weights live in tuning, and the lift is deliberately
// modest — the honour still belongs to the best player, not to the best team's
// most ordinary starter. A 0.10 total lift is worth roughly 0.7 of a rating
// point, which decides a close call and leaves a clear one alone.
//
// Every component is a table//ratio read off state, never a branch on a club or
// competition name, so a save with a different pyramid or no European layer
// simply contributes zero from that component.

/** How far a club went in the domestic cup, as 0–1: 0 never entered or fell at
 * the first hurdle, 1 won it. Derived from the round they were eliminated in
 * against the number of rounds the schedule runs, so it needs no per-round table. */
function cupProgress(state: GameState, teamId: string): number {
  const rounds = state.schedule.cupRoundDays.length;
  if (!rounds) return 0;
  if (state.cup.winnerId === teamId) return 1;
  // Still alive at the end without winning = beaten finalist territory. Otherwise
  // count the cup fixtures they actually played: one more round survived is one
  // more step up the ladder.
  const played = state.fixtures.filter(
    (f) => f.competition === "CUP" && f.played && (f.homeId === teamId || f.awayId === teamId)
  ).length;
  return Math.min(1, played / rounds);
}

/** How far a club went in Europe, as 0–1, weighted by which competition it was
 * in — winning the third-tier cup is not winning the Champions League. Returns 0
 * for a club that played no European football, and for a save with no European
 * layer at all. */
function euroProgress(state: GameState, cfg: AccoladeTuning, teamId: string): number {
  const cups = state.european?.cups ?? [];
  for (const cup of cups) {
    if (!cup.teamIds.includes(teamId)) continue;
    const stage = cup.winnerId === teamId ? "champion" : cup.exitStage[teamId];
    const stageScore = stage ? cfg.awardEuroStageScore[stage] ?? 0 : 0;
    // A lower-tier competition counts for less, per the tuning ladder.
    const tierScale = cfg.awardEuroTierScale[cup.tier - 1] ?? 0;
    return Math.max(0, Math.min(1, stageScore * tierScale));
  }
  return 0;
}

/** The tuning fields this module reads. Declared as a slice of TuningConfig so
 * the signature says exactly what the weighting depends on. */
type AccoladeTuning = Pick<
  TuningConfig,
  | "awardLeagueWeight"
  | "awardCupWeight"
  | "awardEuroWeight"
  | "awardEuroStageScore"
  | "awardEuroTierScale"
  | "awardLeagueRepWeight"
>;

// ── League standing (v1.87) ───────────────────────────────────────────────
// The fourth component, and the only one that compares one DIVISION against
// another: how strong the league a candidate played in actually is.
//
// It exists for the two save-wide legacy honours. Their pool is every top
// division in the world, and until now they were decided on rating alone — so a
// 7.6 season in a weak first tier beat a 7.4 in the strongest league on earth,
// even though the second was played against far better opposition. The tier-1
// filter answers "is this a first division"; it says nothing about which first
// division, and `leagueReputation()` is exactly the table that does.
//
// It cancels out of a league's OWN honours by construction: every candidate in
// a league shares its reputation, so the same constant multiplies every score
// there and the ordering is untouched. That is why this can be the largest of
// the four weights without distorting the awards it isn't meant to decide.

/** The standing lift for a division, as a 0–1 share of `awardLeagueRepWeight`:
 * 1 at LEAGUE_REP_MAX, 0 at LEAGUE_REP_MIN. Reads the same stamped-or-derived
 * figure the rest of the game does, so a pre-v1.72 save scores identically. */
function leagueRepPart(league: { id: string; tier: number; reputation?: number }): number {
  const span = LEAGUE_REP_MAX - LEAGUE_REP_MIN;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (leagueReputation(league) - LEAGUE_REP_MIN) / span));
}

/**
 * The success multiplier applied to a candidate's rating: `1 + teamSuccess`,
 * where teamSuccess sums the four weighted components. 1.0 for a club that
 * finished last, won nothing, played no European football and did all of it in
 * a division of zero standing.
 *
 * `leagueRank` is 0-based (0 = champions) within a table of `leagueSize`; pass
 * -1 when the club's finishing position isn't known, which contributes nothing
 * rather than guessing. `league` is the division the club played in, and its
 * standing is the one component that isn't about this club at all — see the
 * league-standing note above for why it's here and why it can be the largest.
 */
function teamSuccessMult(
  state: GameState,
  cfg: AccoladeTuning,
  teamId: string | null | undefined,
  leagueRank: number,
  leagueSize: number,
  league: { id: string; tier: number; reputation?: number }
): number {
  if (!teamId || !state.teams[teamId]) return 1;
  // League finish, 1 for the champions decaying linearly to 0 for last.
  const leaguePart =
    leagueRank >= 0 && leagueSize > 1 ? 1 - leagueRank / (leagueSize - 1) : 0;
  const success =
    leaguePart * cfg.awardLeagueWeight +
    cupProgress(state, teamId) * cfg.awardCupWeight +
    euroProgress(state, cfg, teamId) * cfg.awardEuroWeight +
    leagueRepPart(league) * cfg.awardLeagueRepWeight;
  return 1 + Math.max(0, success);
}

function toWinner(state: GameState, p: PlayerBio, stat?: number): AwardWinner {
  return {
    playerId: p.id,
    name: p.name,
    teamName: p.clubId ? state.teams[p.clubId]?.name ?? "—" : "—",
    teamId: p.clubId ?? undefined,
    nationality: p.nationality,
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
 * players left, so a pool short in one area still fields a full team.
 *
 * The XI ALWAYS contains exactly one goalkeeper (v25): the GK cap is a hard cap
 * the top-up pass respects too, so a keeper-rich pool never sneaks a second
 * goalkeeper into an outfield slot; and if no keeper cleared the ratings
 * minimum, the best available keeper is drafted in regardless, so a Team of the
 * Season is never played without one between the posts. Returns the picks in
 * shape order (GK → DEF → MID → ATT).
 */
function pickTeamOfSeason(pool: PlayerBio[], score: (p: PlayerBio) => number = avgRating): PlayerBio[] {
  const eligible = pool
    .filter((p) => p.stats.apps >= MIN_APPS_FOR_RATING)
    .sort((a, b) => score(b) - score(a));

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
  // Pass 2: top up to eleven with whoever's left — but the GK cap of one is a
  // HARD cap here, not just in pass 1. Without that, a pool light on outfielders
  // could fill an outfield slot with a second goalkeeper. A real XI carries one
  // keeper and ten outfielders.
  for (const p of eligible) {
    if (chosen.length >= TEAM_SIZE) break;
    if (used.has(p.id)) continue;
    if (posGroup(p.positions[0]) === "GK" && groupCount.GK >= capOf("GK")) continue;
    chosen.push(p);
    used.add(p.id);
    groupCount[posGroup(p.positions[0])]++;
  }

  // Guarantee the one goalkeeper. If none cleared the ratings minimum, draft the
  // best keeper who played at all (or the best in the pool as a last resort),
  // dropping the weakest outfielder to make room so the XI stays eleven strong.
  if (groupCount.GK === 0) {
    const keeper =
      best(pool.filter((p) => p.positions[0] === "GK"), score) ??
      pool.filter((p) => p.positions[0] === "GK").sort((a, b) => b.overall - a.overall)[0];
    if (keeper && !used.has(keeper.id)) {
      if (chosen.length >= TEAM_SIZE) {
        // Drop the lowest-rated outfielder (never another keeper) to free a slot.
        for (let i = chosen.length - 1; i >= 0; i--) {
          if (posGroup(chosen[i].positions[0]) !== "GK") {
            used.delete(chosen[i].id);
            chosen.splice(i, 1);
            break;
          }
        }
      }
      chosen.push(keeper);
      used.add(keeper.id);
      groupCount.GK++;
    }
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
export function computeSeasonAccolades(state: GameState, cfg: AccoladeTuning = TUNING): SeasonAccolades {
  const season = state.season;
  const result: SeasonAccolades = { byLeague: {} };

  // ── Team success, resolved once per club (v1.67) ─────────────────────────
  // Every rating-based honour scores a candidate as `avgRating × (1 +
  // teamSuccess)`, so what his side achieved counts alongside what he did. The
  // multiplier is memoised per club: it's the same for every player at a club and
  // the cup/European lookups walk the fixture list, which is far too expensive to
  // repeat per player in a world of tens of thousands.
  const multByTeam = new Map<string, number>();
  for (const league of Object.values(state.leagues)) {
    // Final ordering for this league — the real table where it's playable, the
    // resolver's completed table where it isn't. Same sources the record book
    // reads, so the awards and the season summary agree on who finished where.
    const table = league.playable
      ? computeTable(state.fixtures, league.id, league.teamIds)
      : state.simResults.find((r) => r.leagueId === league.id && r.half === 2)?.table ?? [];
    const size = table.length || league.teamIds.length;
    table.forEach((row, rank) => {
      multByTeam.set(row.teamId, teamSuccessMult(state, cfg, row.teamId, rank, size, league));
    });
    // A club with no table row (a league the resolver never filled) still gets its
    // cup, European and league-standing lift — it just contributes nothing from
    // its league finish.
    for (const id of league.teamIds) {
      if (!multByTeam.has(id)) multByTeam.set(id, teamSuccessMult(state, cfg, id, -1, size, league));
    }
  }

  /** A candidate's award score: his rating, lifted by his club's season. */
  const score = (p: PlayerBio): number =>
    avgRating(p) * (p.clubId ? multByTeam.get(p.clubId) ?? 1 : 1);

  // Candidates for the two save-wide legacy awards (v1.5): TOP-FLIGHT PLAYERS
  // ONLY. Every league still hands out its own honours, but the Legacy Player /
  // Team of the Year are the world's best, and a second- or third-tier season —
  // where a top-flight-quality player racks up ratings against weaker
  // opposition — should never outrank a first-division campaign. `tier === 1`
  // is the test, so it holds for every country in the save, playable or not.
  const legacyPool: PlayerBio[] = [];

  for (const league of Object.values(state.leagues)) {
    const pool = leaguePlayers(state, league.id);
    if (!pool.length) continue;
    if (league.tier === 1) legacyPool.push(...pool);

    const leagueRef = { id: league.id, name: league.name };
    const rated = pool.filter((p) => p.stats.apps >= MIN_APPS_FOR_RATING);

    const block: SeasonAccolades["byLeague"][string] = {};

    // Player of the Season — best award score (rating × team success), min apps.
    // The displayed stat stays the raw average rating: that is the number the
    // player recognises, and the weighting is a tie-breaker on WHO wins, not a
    // figure to put on a card.
    const poty = best(rated, score);
    if (poty) {
      award(poty, "playerOfSeason", season, leagueRef);
      block.playerOfSeason = toWinner(state, poty, Math.round(avgRating(poty) * 100) / 100);
    }

    // Young Player of the Season — highest-rated U21 (min apps).
    const yPool = rated.filter((p) => p.age <= YOUNG_MAX_AGE);
    const ypoty = best(yPool, score);
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
    const glove = best(rated.filter((p) => p.positions[0] === "GK"), score);
    if (glove) {
      award(glove, "goldenGlove", season, leagueRef);
      block.goldenGlove = toWinner(state, glove, Math.round(avgRating(glove) * 100) / 100);
    }

    // Golden Wall — highest-rated centre-back (min apps). The keeper's award has
    // a defensive counterpart: the season's best CB by average rating.
    const wall = best(rated.filter((p) => p.positions[0] === "CB"), score);
    if (wall) {
      award(wall, "goldenWall", season, leagueRef);
      block.goldenWall = toWinner(state, wall, Math.round(avgRating(wall) * 100) / 100);
    }

    // Team of the Season — the XI, position-capped.
    const xi = pickTeamOfSeason(pool, score);
    if (xi.length) {
      block.teamOfSeason = xi.map((p) => {
        const slot = posGroup(p.positions[0]);
        award(p, "teamOfSeason", season, leagueRef, slot);
        return toWinner(state, p, Math.round(avgRating(p) * 100) / 100);
      });
    }

    result.byLeague[league.id] = block;
  }

  // ── Save-wide legacy honours (top divisions only) ─────────────────────────
  const legacyRated = legacyPool.filter((p) => p.stats.apps >= MIN_APPS_FOR_RATING);

  const legacyPoty = best(legacyRated, score);
  if (legacyPoty) {
    award(legacyPoty, "legacyPlayerOfSeason", season);
    result.legacyPlayerOfSeason = toWinner(state, legacyPoty, Math.round(avgRating(legacyPoty) * 100) / 100);
  }

  const legacyXi = pickTeamOfSeason(legacyPool, score);
  if (legacyXi.length) {
    result.legacyTeamOfSeason = legacyXi.map((p) => {
      const slot = posGroup(p.positions[0]);
      award(p, "legacyTeamOfSeason", season, undefined, slot);
      return toWinner(state, p, Math.round(avgRating(p) * 100) / 100);
    });
  }

  return result;
}

/**
 * Did anyone from the user's club win an honour this season? Scans every
 * individual award and every Team-of-the-Season / Legacy XI slot for a winner
 * whose `teamId` is the user's club. Used to gate the awards inbox email so the
 * user only hears about it when it concerns them.
 */
function userWonAnAward(state: GameState, accolades: SeasonAccolades): boolean {
  const userTeamId = state.userTeamId;
  const isUsers = (w?: AwardWinner) => w?.teamId === userTeamId;
  for (const block of Object.values(accolades.byLeague)) {
    if (
      isUsers(block.playerOfSeason) ||
      isUsers(block.youngPlayerOfSeason) ||
      isUsers(block.goldenBoot) ||
      isUsers(block.goldenPlaymaker) ||
      isUsers(block.goldenGlove) ||
      isUsers(block.goldenWall) ||
      block.teamOfSeason?.some(isUsers)
    ) {
      return true;
    }
  }
  return isUsers(accolades.legacyPlayerOfSeason) || (accolades.legacyTeamOfSeason?.some(isUsers) ?? false);
}

/**
 * Dead-week awards ceremony (v1.44). Fires once, on `accoladesDay` — the day
 * after the last game of the season, while the tables are final and this
 * season's stats are still intact, but a full week before the rollover. It
 * computes and STAMPS every honour (so the permanent cabinets are already
 * filled when the player browses profiles in the dead week), parks the result on
 * `state.pendingAccolades` for the rollover's summary to fold in without
 * recomputing, and posts an inbox announcement of the headline winners.
 *
 * Idempotent: if it has already run this season (pendingAccolades present, or a
 * summary for this season already exists) it does nothing, so it can't
 * double-stamp on a save/reload landing on the same day.
 */
export function runSeasonAwardsCeremony(state: GameState): void {
  if (state.pendingAccolades) return; // already awarded this season
  if (state.recordBook.seasons.some((s) => s.season === state.season)) return;

  const accolades = computeSeasonAccolades(state);
  state.pendingAccolades = accolades;

  // The awards email only lands if it's actually about the user's club — a
  // player of theirs took home an individual honour, or made a Team of the
  // Season / Legacy Team of the Year (v1.44). Awards for other clubs are still
  // recorded on the season review; they just don't clutter the inbox.
  if (!userWonAnAward(state, accolades)) return;

  // Headline the user's own division plus the two save-wide legacy honours.
  const userLeagueId = state.teams[state.userTeamId]?.leagueId;
  const block = userLeagueId ? accolades.byLeague[userLeagueId] : undefined;
  const leagueName = userLeagueId ? state.leagues[userLeagueId]?.name ?? "your league" : "your league";
  const line = (label: string, w?: AwardWinner) => (w ? `${label}: ${w.name} (${w.teamName}).` : "");
  const body = [
    `The season's individual honours have been decided with the final ball kicked.`,
    ``,
    `— ${leagueName} —`,
    line("Player of the Season", block?.playerOfSeason),
    line("Young Player of the Season", block?.youngPlayerOfSeason),
    line("Golden Boot", block?.goldenBoot),
    line("Golden Playmaker", block?.goldenPlaymaker),
    line("Golden Glove", block?.goldenGlove),
    line("Golden Wall", block?.goldenWall),
    ``,
    line("Legacy Player of the Year", accolades.legacyPlayerOfSeason),
    `The full slate — every league's Team of the Season — is in the season review when you close the campaign.`,
  ].join("\n");

  (state.inbox ??= []).unshift({
    id: `inb_accolades_${state.season}`,
    day: state.currentDay,
    season: state.season,
    type: "award",
    title: `Season ${state.season} awards`,
    body,
    read: false,
  });
  state.inbox = state.inbox.slice(0, 120);
}

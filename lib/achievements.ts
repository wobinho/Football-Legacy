// Manager progress: user accolades & achievements (§ Achievements, v1.45).
//
// Two related but distinct ledgers, both scoped to the current save (they live
// on GameState and export with it):
//
//   • User Accolades — passively-recorded career numbers (seasons played, career
//     matches, peak 90-overalls held, highest budget, biggest signing…). These
//     are running tallies and high-water marks maintained as the save plays out.
//
//   • Achievements — one-off milestones ("win the third division", "reach a £1bn
//     budget", "spend £100m on a signing"). Each has a condition evaluated
//     against the live state; the first time it's met it unlocks permanently,
//     stamped with the season it was earned. Unlocked achievements never revert.
//
// Both are updated from a handful of choke points in the game loop:
//   trackUserMatch    ← applyMatchResult (user matches only)
//   trackUserTransfer ← completeTransfer (user club a party)
//   trackRollover     ← runSeasonRollover (season-scale honours)
//   syncProgress      ← after any of the above (peaks + achievement checks)
//
// The engine never branches on an achievement by id — conditions are data
// (ACHIEVEMENT_DEFS), each a pure predicate over the accolades + live state.

import type { GameState, PlayerBio, UserAccolades, UserProgress } from "./types";

/** A fresh, zeroed accolade block. */
export function emptyAccolades(): UserAccolades {
  return {
    seasonsPlayed: 0,
    leagueTitles: 0,
    cupsWon: 0,
    promotions: 0,
    matchesPlayed: 0,
    matchesWon: 0,
    matchesDrawn: 0,
    matchesLost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    peak90Overalls: 0,
    peak85Overalls: 0,
    peakBudget: 0,
    biggestSigningFee: 0,
    biggestSaleFee: 0,
    totalSpent: 0,
    totalReceived: 0,
    playerAwards: 0,
    gcnClubsBought: 0,
    gcnClubsFounded: 0,
    gcnBiggestClubPurchase: 0,
    gcnPeakTreasury: 0,
    gcnFeederLoans: 0,
  };
}

/** A fresh progress block. */
export function emptyProgress(): UserProgress {
  return { accolades: emptyAccolades(), earned: {} };
}

/** Ensure the save carries a progress block (older saves migrate in blank), and
 * return it. Also backfills any accolade field added after the block was first
 * written, so a save can gain new tallies without another schema bump. */
export function ensureProgress(state: GameState): UserProgress {
  if (!state.progress) state.progress = emptyProgress();
  else {
    state.progress.accolades = { ...emptyAccolades(), ...state.progress.accolades };
    state.progress.earned ??= {};
  }
  return state.progress;
}

// ── Live high-water marks + achievement evaluation ─────────────────────────

/** How many of the user's senior + academy players sit at/above `min` overall. */
function countOverallsAtLeast(state: GameState, min: number): number {
  const team = state.teams[state.userTeamId];
  if (!team) return 0;
  const ids = new Set([...team.playerIds, ...(team.academyPlayerIds ?? [])]);
  let n = 0;
  for (const id of ids) {
    const p = state.players[id];
    if (p && !p.retired && p.overall >= min) n++;
  }
  return n;
}

/** Refresh the accolades that are high-water marks over live state (budget and
 * squad-quality peaks), then evaluate every achievement. Cheap — a single squad
 * scan — so it's safe to call after each match, transfer and rollover. Returns
 * the ids of any achievements newly unlocked on this call. */
export function syncProgress(state: GameState): string[] {
  const prog = ensureProgress(state);
  const a = prog.accolades;
  const team = state.teams[state.userTeamId];
  if (team) {
    a.peakBudget = Math.max(a.peakBudget, team.budget);
    a.peak90Overalls = Math.max(a.peak90Overalls, countOverallsAtLeast(state, 90));
    a.peak85Overalls = Math.max(a.peak85Overalls, countOverallsAtLeast(state, 85));
  }
  // GCN treasury peak (v1.64) — a high-water mark like the club budget, so a
  // treasury spent down on clubs still counts toward the milestone it passed.
  if (state.gcn) a.gcnPeakTreasury = Math.max(a.gcnPeakTreasury, state.gcn.treasury);
  return checkAchievements(state);
}

/** Titles for a list of achievement ids, for an inbox / toast summary. */
export function achievementTitles(ids: string[]): string[] {
  return ids
    .map((id) => ACHIEVEMENT_DEFS.find((d) => d.id === id)?.title)
    .filter((t): t is string => Boolean(t));
}

// ── Choke-point trackers ───────────────────────────────────────────────────

/** Record one of the user club's completed matches (all competitions). Called
 * from applyMatchResult with the scoreline already from the club's perspective:
 * `own` goals scored, `opp` conceded. AI-vs-AI matches don't call this. */
export function trackUserMatch(state: GameState, own: number, opp: number): void {
  const a = ensureProgress(state).accolades;
  a.matchesPlayed += 1;
  a.goalsFor += own;
  a.goalsAgainst += opp;
  if (own > opp) a.matchesWon += 1;
  else if (own === opp) a.matchesDrawn += 1;
  else a.matchesLost += 1;
}

/** Record a transfer the user's club was party to. `fee` is the cash paid (buy)
 * or received (sale). Called from completeTransfer. Peaks + spend/receive totals
 * are the user's own money only — AI↔AI deals never reach here.
 *
 * When the fee sets a new record, the player behind it is SNAPSHOTTED onto
 * `recordSigning` / `recordSale` (v1.7) so the cabinet can name him. A snapshot,
 * not a reference: he may be sold on, re-rated, or pruned from a long save, and
 * the record has to outlive all three. */
export function trackUserTransfer(
  state: GameState,
  kind: "buy" | "sell",
  fee: number,
  player?: PlayerBio
): void {
  const a = ensureProgress(state).accolades;
  if (fee <= 0) return; // frees / releases carry no money milestone
  const snapshot = () =>
    player && {
      playerId: player.id,
      name: player.name,
      overall: player.overall,
      pos: player.positions[0],
      nationality: player.nationality,
      fee,
      season: state.season,
    };
  if (kind === "buy") {
    a.totalSpent += fee;
    if (fee > a.biggestSigningFee) {
      a.biggestSigningFee = fee;
      a.recordSigning = snapshot() ?? a.recordSigning;
    }
  } else {
    a.totalReceived += fee;
    if (fee > a.biggestSaleFee) {
      a.biggestSaleFee = fee;
      a.recordSale = snapshot() ?? a.recordSale;
    }
  }
}

/** Season-scale honours, folded in at the rollover from the season summary the
 * rollover has just built (champions, cup winner, promotions) and the season's
 * accolades block (which players at the user's club took individual honours).
 * Called once per rollover, before syncProgress runs the achievement checks. */
export function trackRollover(
  state: GameState,
  opts: {
    /** True if the user's club won its own division this season. */
    wonLeague: boolean;
    /** True if the user's club won the domestic cup. */
    wonCup: boolean;
    /** True if the user's club was promoted this season. */
    promoted: boolean;
    /** Individual player honours won by players at the user's club this season. */
    playerAwards: number;
  }
): void {
  const a = ensureProgress(state).accolades;
  a.seasonsPlayed += 1;
  if (opts.wonLeague) a.leagueTitles += 1;
  if (opts.wonCup) a.cupsWon += 1;
  if (opts.promoted) a.promotions += 1;
  a.playerAwards += opts.playerAwards;
}

// ── Achievement catalogue ──────────────────────────────────────────────────

/** One achievement definition. `test` is a pure predicate over the live state +
 * the accolades block; `progress` (optional) reports how close a still-locked
 * achievement is, for a progress bar. Grouped for display, ordered by `sort`. */
export interface AchievementDef {
  id: string;
  title: string;
  blurb: string;
  emoji: string;
  group: "silverware" | "squad" | "finance" | "market" | "network" | "legacy";
  /** Met? Evaluated whenever progress is synced; unlock is one-way. */
  test: (state: GameState, a: UserAccolades) => boolean;
  /** Optional progress readout for a locked achievement: [current, target]. */
  progress?: (state: GameState, a: UserAccolades) => [number, number];
}

/** The league the user's club WON in its most recent completed season, or null.
 * Read from the last record-book summary (which is keyed by the league id the
 * club played in that season), not the live league — by the time achievements
 * are evaluated at the rollover the club may already have been promoted out of
 * the division it just won, so the live `leagueId` would be the wrong tier. The
 * league OBJECT persists under a stable id, so its tier/country are still right. */
function leagueWonLastSeason(state: GameState): { country: string; tier: number } | null {
  const last = state.recordBook.seasons[state.recordBook.seasons.length - 1];
  if (!last) return null;
  const userTeamId = state.userTeamId;
  for (const [leagueId, champ] of Object.entries(last.championsByLeague)) {
    if (champ.teamId !== userTeamId) continue;
    const league = state.leagues[leagueId];
    if (league) return { country: league.country, tier: league.tier };
  }
  return null;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // ── Silverware ──
  {
    id: "firstLeagueTitle",
    title: "Champions",
    blurb: "Win a league title with your club.",
    emoji: "🏆",
    group: "silverware",
    test: (_s, a) => a.leagueTitles >= 1,
  },
  {
    id: "winTopFlight",
    title: "Kings of the Land",
    blurb: "Win a country's top division.",
    emoji: "👑",
    group: "silverware",
    test: (s) => leagueWonLastSeason(s)?.tier === 1,
  },
  {
    id: "firstCup",
    title: "Cup Glory",
    blurb: "Win the domestic cup.",
    emoji: "🥇",
    group: "silverware",
    test: (_s, a) => a.cupsWon >= 1,
  },
  {
    id: "fiveTitles",
    title: "Dynasty",
    blurb: "Win 5 league titles.",
    emoji: "⭐",
    group: "silverware",
    test: (_s, a) => a.leagueTitles >= 5,
    progress: (_s, a) => [a.leagueTitles, 5],
  },
  {
    id: "climbTheLadder",
    title: "The Climb",
    blurb: "Earn 3 promotions.",
    emoji: "📈",
    group: "silverware",
    test: (_s, a) => a.promotions >= 3,
    progress: (_s, a) => [a.promotions, 3],
  },
  // ── Squad ──
  {
    id: "one90",
    title: "World Class",
    blurb: "Have a player rated 90 or higher.",
    emoji: "💫",
    group: "squad",
    test: (_s, a) => a.peak90Overalls >= 1,
  },
  {
    id: "three90s",
    title: "Galácticos",
    blurb: "Field three 90-rated players at once.",
    emoji: "✨",
    group: "squad",
    test: (_s, a) => a.peak90Overalls >= 3,
    progress: (_s, a) => [a.peak90Overalls, 3],
  },
  {
    id: "five85s",
    title: "Loaded",
    blurb: "Hold five 85-rated players at once.",
    emoji: "🧨",
    group: "squad",
    test: (_s, a) => a.peak85Overalls >= 5,
    progress: (_s, a) => [a.peak85Overalls, 5],
  },
  {
    id: "tenPlayerAwards",
    title: "Trophy Cabinet",
    blurb: "Have your players win 10 individual honours.",
    emoji: "🎖️",
    group: "squad",
    test: (_s, a) => a.playerAwards >= 10,
    progress: (_s, a) => [a.playerAwards, 10],
  },
  // ── Finance ──
  {
    id: "budget100m",
    title: "Money in the Bank",
    blurb: "Reach a £100M club budget.",
    emoji: "💷",
    group: "finance",
    test: (_s, a) => a.peakBudget >= 100_000_000,
    progress: (_s, a) => [a.peakBudget, 100_000_000],
  },
  {
    id: "budget1bn",
    title: "Billionaire's Club",
    blurb: "Reach a £1 billion club budget.",
    emoji: "🏦",
    group: "finance",
    test: (_s, a) => a.peakBudget >= 1_000_000_000,
    progress: (_s, a) => [a.peakBudget, 1_000_000_000],
  },
  // ── Market ──
  {
    id: "spend100m",
    title: "Marquee Signing",
    blurb: "Spend £100M on a single transfer.",
    emoji: "✍️",
    group: "market",
    test: (_s, a) => a.biggestSigningFee >= 100_000_000,
    progress: (_s, a) => [a.biggestSigningFee, 100_000_000],
  },
  {
    id: "sell100m",
    title: "Cash In",
    blurb: "Sell a player for £100M.",
    emoji: "💰",
    group: "market",
    test: (_s, a) => a.biggestSaleFee >= 100_000_000,
    progress: (_s, a) => [a.biggestSaleFee, 100_000_000],
  },
  {
    id: "spend500mTotal",
    title: "Big Spender",
    blurb: "Spend £500M on transfers across your career.",
    emoji: "🛒",
    group: "market",
    test: (_s, a) => a.totalSpent >= 500_000_000,
    progress: (_s, a) => [a.totalSpent, 500_000_000],
  },
  // ── Global Club Network (v1.64) ──
  // The end-game layer earns its own shelf: unlocking it, growing it, and the
  // two ways it can be grown (bought clubs and founded ones) are different
  // achievements because they're different games.
  {
    id: "gcnUnlocked",
    title: "The Network",
    blurb: "Unlock your Global Club Network.",
    emoji: "🌐",
    group: "network",
    test: (s) => !!s.gcn,
  },
  {
    id: "gcnBuy3",
    title: "Portfolio",
    blurb: "Buy 3 clubs into the network.",
    emoji: "🤝",
    group: "network",
    test: (_s, a) => a.gcnClubsBought >= 3,
    progress: (_s, a) => [a.gcnClubsBought, 3],
  },
  {
    id: "gcnBuy8",
    title: "Multi-Club Empire",
    blurb: "Buy 8 clubs into the network.",
    emoji: "🏙️",
    group: "network",
    test: (_s, a) => a.gcnClubsBought >= 8,
    progress: (_s, a) => [a.gcnClubsBought, 8],
  },
  {
    id: "gcnFound1",
    title: "Founder",
    blurb: "Found a brand-new club for the network.",
    emoji: "🧱",
    group: "network",
    test: (_s, a) => a.gcnClubsFounded >= 1,
  },
  {
    id: "gcnFound5",
    title: "Club Builder",
    blurb: "Found 5 clubs for the network.",
    emoji: "🏗️",
    group: "network",
    test: (_s, a) => a.gcnClubsFounded >= 5,
    progress: (_s, a) => [a.gcnClubsFounded, 5],
  },
  {
    id: "gcnBuy10bnClub",
    title: "Crown Jewel",
    blurb: "Buy a club worth £10 billion for the network.",
    emoji: "💎",
    group: "network",
    test: (_s, a) => a.gcnBiggestClubPurchase >= 10_000_000_000,
    progress: (_s, a) => [a.gcnBiggestClubPurchase, 10_000_000_000],
  },
  {
    id: "gcnTreasury10bn",
    title: "War Chest",
    blurb: "Hold £10 billion in the GCN treasury.",
    emoji: "🏛️",
    group: "network",
    test: (_s, a) => a.gcnPeakTreasury >= 10_000_000_000,
    progress: (_s, a) => [a.gcnPeakTreasury, 10_000_000_000],
  },
  {
    id: "gcnFeeder10",
    title: "Feeder System",
    blurb: "Send 10 players out on loan to your network clubs.",
    emoji: "🔁",
    group: "network",
    test: (_s, a) => a.gcnFeederLoans >= 10,
    progress: (_s, a) => [a.gcnFeederLoans, 10],
  },
  {
    id: "gcnFeeder25",
    title: "Pipeline",
    blurb: "Send 25 players out on loan to your network clubs.",
    emoji: "🚚",
    group: "network",
    test: (_s, a) => a.gcnFeederLoans >= 25,
    progress: (_s, a) => [a.gcnFeederLoans, 25],
  },
  // ── Legacy ──
  {
    id: "tenSeasons",
    title: "The Long Game",
    blurb: "Complete 10 seasons at the helm.",
    emoji: "📅",
    group: "legacy",
    test: (_s, a) => a.seasonsPlayed >= 10,
    progress: (_s, a) => [a.seasonsPlayed, 10],
  },
  {
    id: "hundredWins",
    title: "Centurion",
    blurb: "Win 100 matches.",
    emoji: "💯",
    group: "legacy",
    test: (_s, a) => a.matchesWon >= 100,
    progress: (_s, a) => [a.matchesWon, 100],
  },
];

/** Display metadata for the accolade groups (order + labels). */
export const ACHIEVEMENT_GROUPS: { id: AchievementDef["group"]; label: string }[] = [
  { id: "silverware", label: "Silverware" },
  { id: "squad", label: "Squad" },
  { id: "finance", label: "Finance" },
  { id: "market", label: "Transfer Market" },
  { id: "network", label: "Global Club Network" },
  { id: "legacy", label: "Legacy" },
];

/** Evaluate every achievement against the live state; unlock (permanently) any
 * newly-met one, stamping the current season. Idempotent: an already-earned
 * achievement is skipped, so a condition that later goes false (a sold 90-rated
 * player) never un-earns it. Returns the ids unlocked on this call, so the
 * caller can surface an inbox note. */
export function checkAchievements(state: GameState): string[] {
  const prog = ensureProgress(state);
  const a = prog.accolades;
  const newly: string[] = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if (prog.earned[def.id]) continue;
    let met = false;
    try {
      met = def.test(state, a);
    } catch {
      met = false; // a malformed condition never crashes the loop
    }
    if (met) {
      prog.earned[def.id] = { id: def.id, season: state.season };
      newly.push(def.id);
    }
  }
  return newly;
}

/** Count the individual honours won by players AT the user's club in a season's
 * accolades block. Team-of-the-Season slots count too — a place in the XI is an
 * honour. Used by the rollover to bump `playerAwards`. */
export function userPlayerAwardsIn(state: GameState, accolades: import("./types").SeasonAccolades | undefined): number {
  if (!accolades) return 0;
  const userTeamId = state.userTeamId;
  let n = 0;
  const isUsers = (w?: { teamId?: string }) => w?.teamId === userTeamId;
  for (const block of Object.values(accolades.byLeague)) {
    if (isUsers(block.playerOfSeason)) n++;
    if (isUsers(block.youngPlayerOfSeason)) n++;
    if (isUsers(block.goldenBoot)) n++;
    if (isUsers(block.goldenPlaymaker)) n++;
    if (isUsers(block.goldenGlove)) n++;
    if (isUsers(block.goldenWall)) n++;
    n += (block.teamOfSeason ?? []).filter(isUsers).length;
  }
  if (isUsers(accolades.legacyPlayerOfSeason)) n++;
  n += (accolades.legacyTeamOfSeason ?? []).filter(isUsers).length;
  return n;
}

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

import type { BadgeTier, GameState, PlayerBio, UserAccolades, UserProgress } from "./types";
import { TUNING } from "./config/tuning";
import { getFormation } from "./config/formations";
import { posGroup } from "./config/positions";
import { pickLineup, squadOverall } from "./selection";

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
    europeanCups: {},
    peakClubOverall: 0,
    peakStartingOverall: 0,
    peakGroupOverall: {},
    peakPlayerOverall: 0,
    peakPlayerHonours: 0,
    legacyPlayerAwards: 0,
    playersBought: 0,
    playersSold: 0,
    peakSquadValue: 0,
    gcnPeakClubsOwned: 0,
    gcnPeakExecsSeated: 0,
  };
}

/** A fresh progress block. */
export function emptyProgress(): UserProgress {
  return { accolades: emptyAccolades(), earned: {} };
}

/** Ensure the save carries a progress block (older saves migrate in blank), and
 * return it. Also backfills any accolade field added after the block was first
 * written, so a save can gain new tallies without another schema bump.
 *
 * The two RECORD-valued tallies (`europeanCups`, `peakGroupOverall`) are spread
 * a level deeper: a top-level spread would replace a save's existing map with
 * the blank one only when the field is absent, which is right, but leaves a
 * partially-filled map (one cup tier won, the other two never) unable to gain a
 * key without a `?? 0` at every read. Merging here means every read is a plain
 * lookup. */
export function ensureProgress(state: GameState): UserProgress {
  if (!state.progress) state.progress = emptyProgress();
  else {
    const prev = state.progress.accolades;
    state.progress.accolades = {
      ...emptyAccolades(),
      ...prev,
      europeanCups: { ...prev?.europeanCups },
      peakGroupOverall: { ...prev?.peakGroupOverall },
    };
    state.progress.earned ??= {};
  }
  return state.progress;
}

// ── Tiers ──────────────────────────────────────────────────────────────────
//
// An achievement is either a one-off (unlocked or not) or a LADDER of six
// tiers sharing the same id — "win 1 title" and "win 50" are the same pursuit
// at two depths, not two entries in a list. The tier names are the game's own
// `BadgeTier` ladder, the same vocabulary the staff badges use, so bronze means
// the same thing on every screen it appears on.
//
// A tiered achievement is stored exactly like a flat one: `earned[id]` records
// the season the FIRST tier was reached. The tier itself is DERIVED from the
// live accolade block on every render, never stored, for the reason the roll of
// honour is derived (v1.89) — the tally it is a function of is already in the
// save, and storing the tier would let the two disagree.
//
// One consequence is deliberate: a tiered achievement's card shows progress
// toward the NEXT tier rather than toward a single fixed target, so a card
// keeps being worth looking at after it first unlocks.

/** The six tiers, weakest first. Re-exported from the badge ladder's own type so
 * a tier added there is a compile error here rather than a silent mismatch. */
export const ACHIEVEMENT_TIERS: BadgeTier[] = [
  "bronze",
  "silver",
  "gold",
  "diamond",
  "obsidian",
  "legacy",
];

/** Where a tiered achievement currently stands.
 *
 * `tier` is null before the first threshold — the achievement is locked, and
 * `next` is what unlocks it. Past the top rung `next` is null and `value` keeps
 * climbing, which is what makes the ladder's end read as finished rather than
 * as stalled at 100%. */
export interface TierState {
  tier: BadgeTier | null;
  tierIndex: number;
  /** The current value of the tally the ladder is measured on. */
  value: number;
  /** The threshold already cleared (0 before the first). */
  reached: number;
  /** The next threshold, or null at the top of the ladder. */
  next: BadgeTier | null;
  nextTarget: number | null;
}

/** Resolve a value against a six-rung ladder. Thresholds must be ascending; the
 * ladder is read from the top down so a value clearing several rungs at once
 * lands on the highest, which is what a 90-overall squad arriving in one window
 * should do. */
export function tierStateOf(value: number, thresholds: number[]): TierState {
  let idx = -1;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) {
      idx = i;
      break;
    }
  }
  const hasNext = idx + 1 < thresholds.length;
  return {
    tier: idx >= 0 ? ACHIEVEMENT_TIERS[idx] : null,
    tierIndex: idx,
    value,
    reached: idx >= 0 ? thresholds[idx] : 0,
    next: hasNext ? ACHIEVEMENT_TIERS[idx + 1] : null,
    nextTarget: hasNext ? thresholds[idx + 1] : null,
  };
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

/**
 * The user club's quality, measured the way the rest of the game measures it
 * (v2.0) — through `squadOverall` and the same `pickLineup` the matchday calls,
 * against the club's OWN formation.
 *
 * That is load-bearing rather than convenient. A flat mean over the roster
 * answers a different question badly (v1.90): it is driven by how many fringe
 * players a club carries, so signing a squad player would make the "World Class
 * Institution" ladder go BACKWARDS. Reading the XI means the achievement can
 * never disagree with the rating the team card prints.
 *
 * The per-group figures are the mean of the players the XI actually NAMES in
 * each group, so a back three is judged as a back three. A group the shape does
 * not field at all (a 4-3-3 has no natural DM in some variants) simply returns
 * no entry rather than a zero, which would read as a collapse in quality.
 */
function squadQuality(state: GameState): {
  overall: number;
  starting: number;
  byGroup: Record<string, number>;
  bestPlayer: number;
  squadValue: number;
} | null {
  const team = state.teams[state.userTeamId];
  if (!team) return null;
  const squad = team.playerIds
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired);
  if (!squad.length) return null;

  const formation = getFormation(team.tactic?.formationId ?? "433");
  const so = squadOverall(squad, formation, TUNING);
  const { lineup } = pickLineup(squad, formation, TUNING, false);

  // The SLOT's group, not the player's own primary position: a full-back played
  // at centre-back is a defender in this shape, and the point of the figure is
  // what the club puts on the pitch. `pickLineup` returns the slot ID, so the
  // formation is what turns it back into a position.
  const slotPos = new Map(formation.slots.map((s) => [s.id, s.pos]));
  const sums: Record<string, { total: number; n: number }> = {};
  for (const e of lineup) {
    const pos = slotPos.get(e.slotId);
    if (!pos) continue;
    const g = posGroup(pos);
    (sums[g] ??= { total: 0, n: 0 });
    sums[g].total += e.player.overall;
    sums[g].n += 1;
  }
  const byGroup: Record<string, number> = {};
  for (const [g, s] of Object.entries(sums)) byGroup[g] = Math.round(s.total / s.n);

  let bestPlayer = 0;
  let squadValue = 0;
  for (const p of squad) {
    if (p.overall > bestPlayer) bestPlayer = p.overall;
    squadValue += p.value ?? 0;
  }

  return { overall: so.overall, starting: so.starting, byGroup, bestPlayer, squadValue };
}

/** The most individual honours held by any one player who is at the user's club
 * right now. A high-water mark over PLAYERS — the achievement is "produce a
 * decorated great", which a club total (already `playerAwards`) doesn't say. */
function bestPlayerHonours(state: GameState): number {
  const team = state.teams[state.userTeamId];
  if (!team) return 0;
  let best = 0;
  for (const id of team.playerIds) {
    const n = state.players[id]?.accolades?.length ?? 0;
    if (n > best) best = n;
  }
  return best;
}

/** Refresh the accolades that are high-water marks over live state (budget and
 * squad-quality peaks), then evaluate every achievement. Cheap — a single squad
 * scan plus one `pickLineup` — so it's safe to call after each match, transfer
 * and rollover. Returns the ids of any achievements newly unlocked on this
 * call. */
export function syncProgress(state: GameState): string[] {
  const prog = ensureProgress(state);
  const a = prog.accolades;
  const team = state.teams[state.userTeamId];
  const peak = (cur: number | undefined, v: number) => Math.max(cur ?? 0, v);
  if (team) {
    a.peakBudget = Math.max(a.peakBudget, team.budget);
    a.peak90Overalls = Math.max(a.peak90Overalls, countOverallsAtLeast(state, 90));
    a.peak85Overalls = Math.max(a.peak85Overalls, countOverallsAtLeast(state, 85));

    // Squad-quality ladders (v2.0). Peaks rather than live readings, exactly
    // like the two above: an achievement is a thing you DID, so selling the
    // striker who got you there must not un-earn a tier.
    const q = squadQuality(state);
    if (q) {
      a.peakClubOverall = peak(a.peakClubOverall, q.overall);
      a.peakStartingOverall = peak(a.peakStartingOverall, q.starting);
      a.peakPlayerOverall = peak(a.peakPlayerOverall, q.bestPlayer);
      a.peakSquadValue = peak(a.peakSquadValue, q.squadValue);
      a.peakGroupOverall ??= {};
      for (const [g, v] of Object.entries(q.byGroup)) {
        a.peakGroupOverall[g] = peak(a.peakGroupOverall[g], v);
      }
    }
    a.peakPlayerHonours = peak(a.peakPlayerHonours, bestPlayerHonours(state));
  }
  // GCN treasury peak (v1.64) — a high-water mark like the club budget, so a
  // treasury spent down on clubs still counts toward the milestone it passed.
  if (state.gcn) {
    a.gcnPeakTreasury = Math.max(a.gcnPeakTreasury, state.gcn.treasury);
    a.gcnPeakClubsOwned = peak(a.gcnPeakClubsOwned, state.gcn.clubIds.length);
    a.gcnPeakExecsSeated = peak(
      a.gcnPeakExecsSeated,
      Object.values(state.gcn.executives ?? {}).filter(Boolean).length
    );
  }
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
    a.playersBought = (a.playersBought ?? 0) + 1;
    if (fee > a.biggestSigningFee) {
      a.biggestSigningFee = fee;
      a.recordSigning = snapshot() ?? a.recordSigning;
    }
  } else {
    a.totalReceived += fee;
    a.playersSold = (a.playersSold ?? 0) + 1;
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
    /** The European cup TIERS the user's club won this season (v2.0) — 1 for
     * the Champions League, 2 Europa, 3 Conference. Read off the summary's
     * `europeanWinners`, which is stored for the same reason `cupRunnerUp` is:
     * the rollover rebuilds `state.european` a few steps later and the result
     * is gone. Normally empty, at most one entry, but taken as a list so a
     * future format that hands a club two can't silently drop one. */
    europeanTiers?: number[];
    /** Legacy Player of the Year awards won by the user's players this season
     * (the save's single best campaign — a rarer thing than the per-league
     * honours `playerAwards` counts, and worth its own ladder). */
    legacyPlayerAwards?: number;
  }
): void {
  const a = ensureProgress(state).accolades;
  a.seasonsPlayed += 1;
  if (opts.wonLeague) a.leagueTitles += 1;
  if (opts.wonCup) a.cupsWon += 1;
  if (opts.promoted) a.promotions += 1;
  a.playerAwards += opts.playerAwards;
  a.europeanCups ??= {};
  for (const tier of opts.europeanTiers ?? []) {
    a.europeanCups[tier] = (a.europeanCups[tier] ?? 0) + 1;
  }
  a.legacyPlayerAwards = (a.legacyPlayerAwards ?? 0) + (opts.legacyPlayerAwards ?? 0);
}

// ── Achievement catalogue ──────────────────────────────────────────────────

/**
 * One achievement definition.
 *
 * Two shapes, and the difference is `tiers` (v2.0):
 *
 *   • A FLAT achievement carries `test` — a pure predicate — and optionally
 *     `progress` for the bar on a locked card. Unlocked once, permanently.
 *
 *   • A TIERED achievement carries `value` (the tally it is measured on) and
 *     `tiers` (six ascending thresholds, bronze → legacy). It unlocks the
 *     moment the bronze threshold is met, and its TIER is derived from the
 *     live tally on every read — never stored, so the badge on the card and
 *     the number behind it can't drift apart.
 *
 * The engine never branches on an achievement by id; both shapes are data, and
 * `checkAchievements` handles them through the one `meets` call below.
 */
export interface AchievementDef {
  id: string;
  title: string;
  blurb: string;
  emoji: string;
  group: "silverware" | "squad" | "player" | "finance" | "market" | "network" | "legacy";
  /** Met? Flat achievements only — mutually exclusive with `tiers`. */
  test?: (state: GameState, a: UserAccolades) => boolean;
  /** Optional progress readout for a locked flat achievement: [current, target]. */
  progress?: (state: GameState, a: UserAccolades) => [number, number];
  /** The tally a tiered achievement is measured on. */
  value?: (state: GameState, a: UserAccolades) => number;
  /** Six ascending thresholds, bronze → legacy. */
  tiers?: number[];
  /** How the tally should be rendered — money gets `formatMoney`, a rating is a
   * bare number, a count is a count. Presentation only; the engine ignores it. */
  unit?: "count" | "money" | "rating";
}

/** Is this achievement's condition met at all? For a tiered one that is the
 * BRONZE threshold — the first rung is what unlocks the card, and every rung
 * above it is derived rather than separately earned. */
function meets(def: AchievementDef, state: GameState, a: UserAccolades): boolean {
  if (def.tiers && def.value) return def.value(state, a) >= def.tiers[0];
  return def.test ? def.test(state, a) : false;
}

/** Where a tiered achievement stands right now, or null for a flat one. */
export function achievementTier(
  def: AchievementDef,
  state: GameState,
  a: UserAccolades
): TierState | null {
  if (!def.tiers || !def.value) return null;
  let v = 0;
  try {
    v = def.value(state, a);
  } catch {
    v = 0; // a malformed accessor never breaks the screen
  }
  return tierStateOf(v, def.tiers);
}

/** The rating ladder every squad-quality achievement shares (v2.0), except the
 * institution one — a CLUB overall is the XI weighted against its bench, so it
 * sits a notch below an XI-only figure by construction and starts five points
 * lower. Stated once rather than copied per row: six roles all reaching 90 is
 * one design decision, not six. */
const RATING_TIERS = [70, 75, 80, 85, 90, 95];

/** The knockout-silverware ladder, shared by the domestic cup and all three
 * European ones. Shallower than the league ladder because a cup is a shorter
 * competition with more variance — 25 is a career of them, where 50 league
 * titles is the Dynasty ladder's top rung.
 *
 * Declared above the factory that reads it: `europeanAchievement` is CALLED
 * from inside the `ACHIEVEMENT_DEFS` literal, so a `const` below that literal
 * would be in its temporal dead zone at call time. */
const CUP_TIERS = [1, 3, 5, 10, 15, 25];

/** One squad-quality ladder, keyed on the position GROUP the XI names. Written
 * as a factory because the four of them differ only in which group they read —
 * spelling out four near-identical objects is how one of them ends up quietly
 * reading another's key. */
function groupRatingAchievement(
  id: string,
  title: string,
  blurb: string,
  emoji: string,
  group: string
): AchievementDef {
  return {
    id,
    title,
    blurb,
    emoji,
    group: "squad",
    unit: "rating",
    value: (_s, a) => a.peakGroupOverall?.[group] ?? 0,
    tiers: RATING_TIERS,
  };
}

/** One European cup's ladder. Same thresholds as the domestic cup — a cup is a
 * cup — with the tier number the only thing that varies. */
function europeanAchievement(
  id: string,
  title: string,
  emoji: string,
  tier: number,
  cupName: string
): AchievementDef {
  return {
    id,
    title,
    blurb: `Win the ${cupName}.`,
    emoji,
    group: "silverware",
    unit: "count",
    value: (_s, a) => a.europeanCups?.[tier] ?? 0,
    tiers: CUP_TIERS,
  };
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // ── Silverware ──
  //
  // v2.0: "Champions" and "Dynasty" were the same pursuit at two depths (win
  // one title / win five), so they are now ONE ladder — winning is winning, and
  // what changes with the twentieth is the tier of the badge, not the name of
  // the thing. "The Climb" (3 promotions) and "Kings of the Land" (win a top
  // division) are deleted: the first is a season's outcome rather than a
  // cabinet entry, and the second is a special case of the league ladder that
  // fires on a technicality of which division you happened to be in.
  {
    id: "firstLeagueTitle",
    title: "Dynasty",
    blurb: "Win league titles with your club.",
    emoji: "🏆",
    group: "silverware",
    unit: "count",
    value: (_s, a) => a.leagueTitles,
    tiers: [1, 3, 7, 15, 25, 50],
  },
  {
    id: "firstCup",
    title: "Cup Glory",
    blurb: "Win the domestic cup.",
    emoji: "🥇",
    group: "silverware",
    unit: "count",
    value: (_s, a) => a.cupsWon,
    tiers: CUP_TIERS,
  },
  europeanAchievement("euroCup1", "European Champions", "🌟", 1, "Champions League"),
  europeanAchievement("euroCup2", "Europa Kings", "🔶", 2, "Europa League"),
  europeanAchievement("euroCup3", "Conference Conquerors", "🟢", 3, "Conference League"),

  // ── Squad ──
  //
  // v2.0: the old four (World Class / Galácticos / Loaded / Trophy Cabinet)
  // all counted BODIES over a threshold, which measures squad size as much as
  // squad quality and says nothing about shape — five 85s at centre-back is not
  // a good team. These six read the XI the club actually fields, through the
  // same `squadOverall` / `pickLineup` the team card and the simulation use, so
  // an achievement can never claim a rating the match wouldn't.
  {
    id: "clubInstitution",
    title: "World Class Institution",
    blurb: "Build a club overall rating worthy of the name.",
    emoji: "🏛️",
    group: "squad",
    unit: "rating",
    value: (_s, a) => a.peakClubOverall ?? 0,
    // Five points below the XI ladders throughout: the club figure folds the
    // bench in at `squadOverallXIWeight`, so it is structurally lower than the
    // starting XI's and an identical ladder would make this the strictly harder
    // achievement for no stated reason.
    tiers: [65, 70, 75, 80, 85, 90],
  },
  {
    id: "dreamTeam",
    title: "Dream Team",
    blurb: "Field a starting XI of the highest quality.",
    emoji: "⚡",
    group: "squad",
    unit: "rating",
    value: (_s, a) => a.peakStartingOverall ?? 0,
    tiers: RATING_TIERS,
  },
  groupRatingAchievement("brickWall", "Brick Wall", "Field a goalkeeper of the highest quality.", "🧤", "GK"),
  groupRatingAchievement("fortress", "Fortress", "Field a defence of the highest quality.", "🛡️", "DEF"),
  groupRatingAchievement("playmaker", "Playmaker", "Field a midfield of the highest quality.", "🎯", "MID"),
  groupRatingAchievement("apex", "Apex", "Field an attack of the highest quality.", "🔥", "ATT"),

  // ── Player (v2.0) ──
  //
  // Its own shelf below Squad, and the split is the point: Squad is about the
  // ELEVEN — a shape, a collective rating, the thing that takes the field —
  // where this is about producing an INDIVIDUAL. A club can be excellent
  // without ever holding a superstar, and the two shouldn't compete for the
  // same row.
  {
    id: "superstar",
    title: "Superstar",
    blurb: "Have a player reach a world-class rating.",
    emoji: "💫",
    group: "player",
    unit: "rating",
    value: (_s, a) => a.peakPlayerOverall ?? 0,
    tiers: [75, 80, 85, 88, 91, 94],
  },
  {
    id: "eliteCore",
    title: "Star-Studded",
    blurb: "Hold several 85-rated players at once.",
    emoji: "✨",
    group: "player",
    unit: "count",
    value: (_s, a) => a.peak85Overalls,
    tiers: [1, 3, 5, 8, 11, 15],
  },
  {
    id: "ninetyClub",
    title: "The 90 Club",
    blurb: "Hold 90-rated players at once.",
    emoji: "🌠",
    group: "player",
    unit: "count",
    value: (_s, a) => a.peak90Overalls,
    tiers: [1, 2, 3, 5, 7, 11],
  },
  {
    id: "tenPlayerAwards",
    title: "Trophy Cabinet",
    blurb: "Have your players win individual honours.",
    emoji: "🎖️",
    group: "player",
    unit: "count",
    value: (_s, a) => a.playerAwards,
    tiers: [1, 5, 15, 35, 60, 100],
  },
  {
    id: "decoratedGreat",
    title: "Decorated Great",
    blurb: "Have one player amass individual honours.",
    emoji: "🏅",
    group: "player",
    unit: "count",
    value: (_s, a) => a.peakPlayerHonours ?? 0,
    tiers: [1, 3, 6, 10, 15, 22],
  },
  {
    id: "ballonDor",
    title: "Best in the World",
    blurb: "Have a player win Legacy Player of the Year.",
    emoji: "👑",
    group: "player",
    unit: "count",
    value: (_s, a) => a.legacyPlayerAwards ?? 0,
    tiers: [1, 2, 4, 6, 9, 13],
  },

  // ── Finance ──
  {
    id: "budget100m",
    title: "Money in the Bank",
    blurb: "Grow your club's transfer budget.",
    emoji: "💷",
    group: "finance",
    unit: "money",
    value: (_s, a) => a.peakBudget,
    tiers: [50_000_000, 250_000_000, 1_000_000_000, 5_000_000_000, 25_000_000_000, 100_000_000_000],
  },
  {
    id: "squadValue",
    title: "Priceless",
    blurb: "Assemble a squad of enormous market value.",
    emoji: "📊",
    group: "finance",
    unit: "money",
    value: (_s, a) => a.peakSquadValue ?? 0,
    tiers: [100_000_000, 400_000_000, 1_000_000_000, 2_500_000_000, 5_000_000_000, 10_000_000_000],
  },
  {
    id: "totalReceived",
    title: "Selling Club",
    blurb: "Bank transfer receipts across your career.",
    emoji: "🏧",
    group: "finance",
    unit: "money",
    value: (_s, a) => a.totalReceived,
    tiers: [50_000_000, 250_000_000, 750_000_000, 2_000_000_000, 5_000_000_000, 15_000_000_000],
  },

  // ── Market ──
  {
    id: "spend100m",
    title: "Marquee Signing",
    blurb: "Break your own record on a single signing.",
    emoji: "✍️",
    group: "market",
    unit: "money",
    value: (_s, a) => a.biggestSigningFee,
    tiers: [25_000_000, 75_000_000, 150_000_000, 250_000_000, 400_000_000, 750_000_000],
  },
  {
    id: "sell100m",
    title: "Cash In",
    blurb: "Sell a player for a record fee.",
    emoji: "💰",
    group: "market",
    unit: "money",
    value: (_s, a) => a.biggestSaleFee,
    tiers: [25_000_000, 75_000_000, 150_000_000, 250_000_000, 400_000_000, 750_000_000],
  },
  {
    id: "spend500mTotal",
    title: "Big Spender",
    blurb: "Spend on transfers across your career.",
    emoji: "🛒",
    group: "market",
    unit: "money",
    value: (_s, a) => a.totalSpent,
    tiers: [50_000_000, 250_000_000, 750_000_000, 2_000_000_000, 5_000_000_000, 15_000_000_000],
  },
  {
    id: "dealmaker",
    title: "Dealmaker",
    blurb: "Complete signings across your career.",
    emoji: "🤝",
    group: "market",
    unit: "count",
    value: (_s, a) => a.playersBought ?? 0,
    tiers: [5, 20, 50, 100, 200, 400],
  },
  {
    id: "trader",
    title: "Trader",
    blurb: "Sell players on across your career.",
    emoji: "📤",
    group: "market",
    unit: "count",
    value: (_s, a) => a.playersSold ?? 0,
    tiers: [5, 20, 50, 100, 200, 400],
  },

  // ── Global Club Network (v1.64) ──
  // The end-game layer earns its own shelf: unlocking it, growing it, and the
  // two ways it can be grown (bought clubs and founded ones) are different
  // achievements because they're different games. v2.0 put every tally-shaped
  // one onto a ladder and added the seats, the hubs and the hub pipeline —
  // which were three whole features with nothing in the cabinet to show for
  // them.
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
    blurb: "Buy clubs into the network.",
    emoji: "🏙️",
    group: "network",
    unit: "count",
    value: (_s, a) => a.gcnClubsBought,
    tiers: [1, 3, 6, 10, 16, 25],
  },
  {
    id: "gcnFound1",
    title: "Club Builder",
    blurb: "Found brand-new clubs for the network.",
    emoji: "🧱",
    group: "network",
    unit: "count",
    value: (_s, a) => a.gcnClubsFounded,
    tiers: [1, 3, 5, 8, 12, 20],
  },
  {
    id: "gcnEmpire",
    title: "Empire",
    blurb: "Hold clubs in the network at once.",
    emoji: "🗺️",
    group: "network",
    unit: "count",
    value: (_s, a) => a.gcnPeakClubsOwned ?? 0,
    tiers: [2, 5, 9, 14, 20, 30],
  },
  {
    id: "gcnBuy10bnClub",
    title: "Crown Jewel",
    blurb: "Buy an expensive club for the network.",
    emoji: "💎",
    group: "network",
    unit: "money",
    value: (_s, a) => a.gcnBiggestClubPurchase,
    tiers: [
      500_000_000, 2_000_000_000, 10_000_000_000, 30_000_000_000, 75_000_000_000, 200_000_000_000,
    ],
  },
  {
    id: "gcnTreasury10bn",
    title: "War Chest",
    blurb: "Hold a fortune in the GCN treasury.",
    emoji: "🏛️",
    group: "network",
    unit: "money",
    value: (_s, a) => a.gcnPeakTreasury,
    tiers: [
      500_000_000, 2_000_000_000, 10_000_000_000, 40_000_000_000, 100_000_000_000, 500_000_000_000,
    ],
  },
  {
    id: "gcnFeeder10",
    title: "Feeder System",
    blurb: "Send players out on loan to your network clubs.",
    emoji: "🔁",
    group: "network",
    unit: "count",
    value: (_s, a) => a.gcnFeederLoans,
    tiers: [1, 10, 25, 50, 100, 200],
  },
  {
    id: "gcnBoardroom",
    title: "The Boardroom",
    blurb: "Fill your Global Executive seats.",
    emoji: "💼",
    group: "network",
    unit: "count",
    // Only three seats exist, so the top three rungs are about KEEPING a full
    // board rather than filling a fourth chair — the ladder tops out at the
    // feature's own ceiling instead of inventing a target it can't reach.
    value: (_s, a) => a.gcnPeakExecsSeated ?? 0,
    tiers: [1, 2, 3, 3, 3, 3],
  },
  {
    id: "gcnHubs",
    title: "Global Reach",
    blurb: "Establish International Scouting Hubs.",
    emoji: "📡",
    group: "network",
    unit: "count",
    value: (_s, a) => a.gcnHubsBuilt ?? 0,
    tiers: [1, 3, 6, 10, 15, 24],
  },
  {
    id: "gcnHubProspects",
    title: "Talent Pipeline",
    blurb: "Sign prospects off your hubs' reports.",
    emoji: "🌍",
    group: "network",
    unit: "count",
    value: (_s, a) => a.gcnHubProspects ?? 0,
    tiers: [1, 10, 30, 75, 150, 300],
  },

  // ── Legacy ──
  {
    id: "tenSeasons",
    title: "The Long Game",
    blurb: "Complete seasons at the helm.",
    emoji: "📅",
    group: "legacy",
    unit: "count",
    value: (_s, a) => a.seasonsPlayed,
    tiers: [1, 5, 10, 25, 50, 100],
  },
  {
    id: "hundredWins",
    title: "Centurion",
    blurb: "Win matches.",
    emoji: "💯",
    group: "legacy",
    unit: "count",
    value: (_s, a) => a.matchesWon,
    tiers: [10, 50, 100, 300, 750, 1500],
  },
];

/** Display metadata for the accolade groups (order + labels). */
export const ACHIEVEMENT_GROUPS: { id: AchievementDef["group"]; label: string }[] = [
  { id: "silverware", label: "Silverware" },
  { id: "squad", label: "Squad" },
  { id: "player", label: "Player" },
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
      met = meets(def, state, a);
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

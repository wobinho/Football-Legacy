// ── Long-save maintenance (§13) ───────────────────────────────────────────
//
// A save's cost splits in two, and only one half is a problem:
//
//   • The LIVING world is bounded. Squads are capped and leagues are fixed, so
//     the number of players who can actually be picked, developed or bought
//     never really grows. Iterating that is fine forever.
//   • Everything that has EVER existed is unbounded. Retired players are never
//     deleted, so by season 20 they are already the majority of `state.players`
//     — and every full-world pass still walks them while every autosave still
//     serialises them in full.
//
// Measured at season 20 (scripts/perf.ts), the weight sits in two places: a
// retired player's `devLog` is ~68% of his stored bytes, and `state.careers` is
// the single largest block in the save. Both are pure history, so neither can
// simply be deleted — the record book, the academy ledger and every profile
// page read them. Instead they are COMPACTED: the facts the UI actually asks
// for are kept and the per-season detail behind them is dropped.
//
// `activePlayers()` then gives the hot loops a living-world-only iteration, so
// their cost tracks squad sizes rather than the graveyard.

import type { DevLogEntry, GameState, PlayerBio } from "./types";

/**
 * Compact a retired player's development log to the single entry that recorded
 * his peak. The academy ledger reads a graduate's peak overall off `devLog`,
 * and that is the only question anyone asks a retired player's growth history —
 * the year-by-year curve is only interesting while he can still improve.
 *
 * Idempotent, so it's safe on every rollover.
 */
export function compactRetiredPlayer(p: PlayerBio): boolean {
  if (!p.retired) return false;
  let changed = false;

  if (p.devLog && p.devLog.length > 1) {
    let peak: DevLogEntry = p.devLog[0];
    for (const d of p.devLog) if (d.toOverall > peak.toOverall) peak = d;
    p.devLog = [peak];
    changed = true;
  }

  // Live-play state a retired man can never use again. Left as empty/among the
  // cheapest possible values rather than deleted, so every existing read of
  // `p.stats.apps` or `p.contract?.wage` keeps working unchanged.
  if (p.youthStats) {
    p.youthStats = undefined;
    changed = true;
  }
  if (p.contract) {
    p.contract = undefined;
    changed = true;
  }
  if (p.loan) {
    p.loan = undefined;
    changed = true;
  }
  if (p.trainingPlan) {
    p.trainingPlan = undefined;
    changed = true;
  }
  if (p.stats.apps !== 0 || p.stats.minutes !== 0) {
    p.stats = { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 };
    changed = true;
  }

  return changed;
}

/**
 * How many seasons of per-season career detail a player keeps once he's retired.
 * His totals are preserved regardless (see `compactCareer`) — this only governs
 * how much of the season-by-season breakdown survives, which is what the profile
 * page renders as a table.
 */
const RETIRED_CAREER_SEASONS_KEPT = 6;

/**
 * Compact a retired player's career record.
 *
 * Career rows are the largest single block in a long save, and a 20-season
 * veteran carries 20+ of them. Rather than drop history outright, the rows are
 * folded: the most recent seasons stay intact (that's what a profile page shows
 * and what feels like a career), and everything older collapses into one
 * summary row carrying the same totals. All-time club records read
 * `row.clubName`/`apps`/`goals`, so the club a player made his name at must
 * survive the fold — the summary is therefore grouped BY CLUB, not flattened
 * into a single line.
 */
export function compactCareer(state: GameState, playerId: string): boolean {
  const career = state.careers[playerId];
  if (!career || career.seasons.length <= RETIRED_CAREER_SEASONS_KEPT + 1) return false;

  const sorted = career.seasons.slice().sort((a, b) => a.season - b.season);
  const cut = sorted.length - RETIRED_CAREER_SEASONS_KEPT;
  const old = sorted.slice(0, cut);
  const recent = sorted.slice(cut);

  // Group the folded years by club so club record books stay correct.
  const byClub = new Map<string, { apps: number; goals: number; assists: number; from: number; to: number; ratingSum: number }>();
  for (const row of old) {
    const acc = byClub.get(row.clubName) ?? {
      apps: 0,
      goals: 0,
      assists: 0,
      from: row.season,
      to: row.season,
      ratingSum: 0,
    };
    acc.apps += row.apps;
    acc.goals += row.goals;
    acc.assists += row.assists;
    acc.ratingSum += row.avgRating * row.apps;
    acc.from = Math.min(acc.from, row.season);
    acc.to = Math.max(acc.to, row.season);
    byClub.set(row.clubName, acc);
  }

  const folded = [...byClub.entries()].map(([clubName, a]) => ({
    season: a.from,
    clubName,
    // Marks the row as a fold in the UI without needing a new field on the type.
    competition: a.from === a.to ? `${a.from}` : `${a.from}–${a.to} (${a.to - a.from + 1} seasons)`,
    apps: a.apps,
    goals: a.goals,
    assists: a.assists,
    avgRating: a.apps ? Math.round((a.ratingSum / a.apps) * 100) / 100 : 0,
    awards: [],
  }));

  career.seasons = [...folded, ...recent];
  return true;
}

export interface PruneReport {
  /** Retired players whose live-play data was dropped. */
  compacted: number;
  /** Careers whose old seasons were folded into per-club summaries. */
  careersFolded: number;
  /** Career records belonging to nobody the save can still name. */
  careersDropped: number;
}

/**
 * The rollover's housekeeping pass. Runs AFTER the season summary and this
 * season's career rows have been written, so nothing being compacted is still
 * needed by the season just finished.
 */
export function pruneRetired(state: GameState): PruneReport {
  const report: PruneReport = { compacted: 0, careersFolded: 0, careersDropped: 0 };

  for (const p of Object.values(state.players)) {
    if (!p.retired) continue;
    if (compactRetiredPlayer(p)) report.compacted++;
    if (compactCareer(state, p.id)) report.careersFolded++;
  }

  // A career whose player no longer exists can never be rendered — the record
  // book resolves every name through `state.players`.
  for (const id of Object.keys(state.careers)) {
    if (!state.players[id]) {
      delete state.careers[id];
      report.careersDropped++;
    }
  }

  return report;
}

// ── Active-player index ───────────────────────────────────────────────────
//
// The hot passes (development, valuation, contracts, fitness) all want "every
// player still in the football world". Written as `Object.values(state.players)`
// that cost grows with everyone who has ever played; written through this helper
// it tracks the living world, which stays flat across a long save.

/** Every non-retired player — the living world, bounded by squad sizes. */
export function activePlayers(state: GameState): PlayerBio[] {
  const out: PlayerBio[] = [];
  for (const p of Object.values(state.players)) {
    if (!p.retired) out.push(p);
  }
  return out;
}

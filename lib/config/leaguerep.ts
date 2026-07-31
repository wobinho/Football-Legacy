// ── League reputation (v1.72) ─────────────────────────────────────────────
//
// How much STANDING a division has in the world game, on a 0–10 scale. This is
// a property of the LEAGUE, not of the clubs in it: the English top flight is a
// 10 whether or not its champion happens to be a weak side this season, and a
// fourth division is a 1 no matter how well-run its clubs are.
//
// Club reputation (Team.reputation, 1–100) already answers a different question
// — "how big is this club" — and it moves with results. League reputation is
// fixed structural data: a country's league system either is a major one or it
// isn't, and its tiers step down from there.
//
// Pure data, keyed by country code and tier. Nothing here names a country in
// code — the bands are a table, exactly like the wage bands in tuning.ts, so
// adding a nation is one entry in one array.

/** The reputation scale's endpoints. A league is always inside this range. */
export const LEAGUE_REP_MIN = 0;
export const LEAGUE_REP_MAX = 10;

/**
 * One band of countries whose league systems carry the same standing, and the
 * reputation each of its tiers is worth (index 0 = tier 1).
 *
 * Tiers beyond the array keep its last entry, so a country running a deeper
 * pyramid than the band authors doesn't fall off the table.
 */
export interface LeagueRepBand {
  /** Short label for the band, for UI and debugging. Never read as logic. */
  label: string;
  /** Country codes in this band. */
  codes: string[];
  /** Reputation by tier, index = tier − 1. */
  byTier: number[];
}

/**
 * The bands, strongest first.
 *
 * Band 1 — the five major European systems: 10 / 8 / 6 / 4.
 * Band 2 — the strong secondary systems, European and South American: 9 / 6 / 3 / 1.
 * Band 3 — the remaining established systems: 7 / 4 / 1 / 1.
 *
 * A country in no band takes `DEFAULT_LEAGUE_REP_BY_TIER`.
 */
export const LEAGUE_REP_BANDS: LeagueRepBand[] = [
  {
    label: "Major",
    codes: ["ENG", "GER", "FRA", "ITA", "ESP"],
    byTier: [10, 8, 6, 4],
  },
  {
    label: "Strong",
    codes: ["NED", "POR", "TUR", "ARG", "BRA", "BEL"],
    byTier: [9, 6, 3, 1],
  },
  {
    label: "Established",
    codes: [
      "NOR", "USA", "KSA", "POL", "AUT", "AUS", "CHN", "DEN", "IND",
      "JPN", "KOR", "MEX", "ROU", "RUS", "IRL", "SCO", "SRB", "SUI", "SWE",
    ],
    byTier: [7, 4, 1, 1],
  },
];

/** What a country the bands don't list is worth. Deliberately below the lowest
 * authored band: an unlisted system is a smaller one, and a custom-uploaded
 * database shouldn't silently inherit a major nation's standing. */
export const DEFAULT_LEAGUE_REP_BY_TIER = [5, 3, 1, 1];

const BAND_OF: Record<string, LeagueRepBand> = (() => {
  const out: Record<string, LeagueRepBand> = {};
  for (const band of LEAGUE_REP_BANDS) for (const code of band.codes) out[code] = band;
  return out;
})();

/** The band a country's league system sits in, or undefined if unlisted. */
export function leagueRepBand(code: string | null | undefined): LeagueRepBand | undefined {
  return code ? BAND_OF[code] : undefined;
}

/** Read a tier out of a by-tier array, holding the last entry for deeper tiers. */
function atTier(byTier: number[], tier: number): number {
  if (byTier.length === 0) return LEAGUE_REP_MIN;
  const i = Math.max(1, Math.round(tier)) - 1;
  return byTier[Math.min(i, byTier.length - 1)];
}

/**
 * The reputation of a division, from its country code and tier — the form
 * worldgen uses, since it stamps leagues before they exist as state.
 *
 * Always returns a number in [LEAGUE_REP_MIN, LEAGUE_REP_MAX].
 */
export function leagueReputationFor(code: string | null | undefined, tier: number): number {
  const band = leagueRepBand(code);
  const raw = atTier(band?.byTier ?? DEFAULT_LEAGUE_REP_BY_TIER, tier);
  return Math.max(LEAGUE_REP_MIN, Math.min(LEAGUE_REP_MAX, raw));
}

/** The country code a league id belongs to ("ENG2" → "ENG"). Mirrors the same
 * helper in contracts.ts; league ids are the one place the code is encoded. */
export function leagueCountryCode(leagueId: string): string | null {
  return /^([A-Z]{3})\d*$/.exec(leagueId)?.[1] ?? null;
}

/** Reputation of a league by its id alone, for callers that only hold the id.
 * `tier` is needed because the id doesn't encode it reliably (a country's
 * second division may be "ENG2" but a custom one may not follow the pattern). */
export function leagueReputationOf(leagueId: string, tier: number): number {
  return leagueReputationFor(leagueCountryCode(leagueId), tier);
}

/**
 * The reputation of a league object, tolerant of saves written before the field
 * existed. A stamped value wins; anything older is derived from the same table
 * worldgen would have used, so an old save reads identically to a new one
 * without needing a migration pass.
 */
export function leagueReputation(league: { id: string; tier: number; reputation?: number }): number {
  if (typeof league.reputation === "number" && Number.isFinite(league.reputation)) {
    return Math.max(LEAGUE_REP_MIN, Math.min(LEAGUE_REP_MAX, league.reputation));
  }
  return leagueReputationOf(league.id, league.tier);
}

/** A one-word reading of a reputation figure, for the UI. */
export function leagueRepLabel(rep: number): string {
  if (rep >= 9) return "World Class";
  if (rep >= 7) return "Elite";
  if (rep >= 5) return "Strong";
  if (rep >= 3) return "Competitive";
  if (rep >= 1) return "Modest";
  return "Amateur";
}

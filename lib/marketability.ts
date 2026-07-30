/**
 * Club Marketability (v44) — the 0–100 score behind the Investments page.
 *
 * The v20 model read a handful of `marketabilityBonus` traits off the squad, so
 * the entire commercial game hinged on whether the RNG had handed you a player
 * with one specific trait. A club could win the league, fill the ground and
 * rebuild the squad without the number moving at all, and a club that happened
 * to roll a Marketable striker in the fourth division out-earned one that
 * didn't. Traits no longer feed it.
 *
 * Marketability is now built from four things the manager actually controls,
 * each capped at its own weight:
 *
 *   A. League & Division Status  35 — what division you're in, plus Europe
 *   B. Squad Star Power          25 — the mean of your three best players
 *   C. Recent Team Form          25 — the last ten results, plus unbeaten runs
 *   D. Club Facilities           15 — mean level across the income upgrades
 *
 * Every threshold is a band table in `lib/config/tuning.ts`; nothing here holds
 * a number of its own. The score is derived on read rather than stored, so it
 * updates the moment a result lands or an upgrade is bought — there is no cache
 * to invalidate and no save field to migrate.
 *
 * The score drives three things, all through `marketabilityTier`: how *many*
 * suitors will talk at once, how *good* the brands are, and how much they *pay*.
 */

import type { GameState } from "./types";
import type { TuningConfig } from "./config/tuning";
import { FACILITY_KEYS, incomeUpgradeLevel } from "./economy";
import { TRAITS } from "./config/traits";

/** One factor's contribution, with the working shown. The Investments page
 * renders this list directly, so what the user reads is by construction the
 * same arithmetic the sponsor money uses — the two cannot drift. */
export interface MarketabilityFactor {
  key: "league" | "starPower" | "form" | "facilities";
  label: string;
  /** Points earned, already capped at `max`. */
  points: number;
  /** This factor's weight — the most it can contribute. */
  max: number;
  /** Short human reading of *why* ("Tier 1 League", "Unbeaten in 6"). */
  detail: string;
}

export interface MarketabilityBreakdown {
  /** The 0–100 headline. */
  total: number;
  factors: MarketabilityFactor[];
  /** Whole stars, 1–5. */
  stars: number;
  /** Offers that may sit on the table at once. */
  maxOffers: number;
  /** Multiplier applied to every offer's money. */
  valueMult: number;
  /** The calibre of brand this band attracts ("Global Brands"). */
  flavour: string;
}

// ── A. League & Division Status ────────────────────────────────────────────

/** Whether a club is in a continental competition this season. Unlike
 * `userEuroCup` this works for any club, because AI books are priced by the
 * same model and a European AI club should be worth more to a sponsor too. */
function inEurope(state: GameState, teamId: string): boolean {
  return (state.european?.cups ?? []).some((c) => c.teamIds.includes(teamId));
}

function leagueFactor(state: GameState, teamId: string, cfg: TuningConfig): MarketabilityFactor {
  const team = state.teams[teamId];
  const league = state.leagues[team?.leagueId ?? ""];
  const tier = league?.tier ?? cfg.marketabilityTierPoints.length;
  const table = cfg.marketabilityTierPoints;
  const base = table[Math.max(0, Math.min(table.length - 1, tier - 1))] ?? 0;
  const euro = inEurope(state, teamId);
  const raw = base + (euro ? cfg.marketabilityEuropeanBonus : 0);
  const max = cfg.marketabilityWeightLeague;
  const tierLabel = league ? `Tier ${tier} League` : "No League";
  return {
    key: "league",
    label: "League Division",
    points: Math.min(max, raw),
    max,
    detail: euro ? `${tierLabel} + Europe` : tierLabel,
  };
}

// ── B. Squad Star Power ────────────────────────────────────────────────────

/**
 * Mean overall of the club's best `topN` senior players, or 0 for an empty
 * squad. Academy players don't count: a sponsor is buying the first team.
 *
 * Commercial traits (Marketable, Fan Favourite, Global Icon) are folded in here
 * as a small uplift to a player's effective rating rather than as a factor of
 * their own. The v20 model made those traits the *gate* on the whole system,
 * which is what this rework removes — but they describe exactly the thing this
 * factor measures (what a club's headline names are worth to a brand), so
 * deleting their effect would leave three traits whose in-game description
 * promises something they no longer do. A Global Icon is worth a few points of
 * star power; he is no longer the difference between having a commercial
 * department and not.
 */
export function topSquadAverage(state: GameState, teamId: string, topN: number): number {
  const team = state.teams[teamId];
  if (!team) return 0;
  const rated = team.playerIds
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired)
    .map((p) => p.overall + commercialUplift(p))
    .sort((a, b) => b - a)
    .slice(0, topN);
  if (rated.length === 0) return 0;
  return rated.reduce((s, o) => s + o, 0) / rated.length;
}

/** Effective-rating uplift from a player's commercial traits, in overall points.
 * Table-driven off `marketabilityBonus`, so the engine never names a trait. */
function commercialUplift(p: { traits: string[] }): number {
  let bonus = 0;
  for (const id of p.traits) {
    const trait = TRAIT_BY_ID.get(id);
    bonus += (trait?.effects.marketabilityBonus ?? 0) * COMMERCIAL_TRAIT_SCALE;
  }
  return bonus;
}

/** Overall points per unit of `marketabilityBonus`. At 0.22 (Global Icon) this
 * is worth ~+4.4 effective rating; Marketable (0.14) ~+2.8. Enough to move a
 * squad across a star-power band, never enough to carry the factor alone. */
const COMMERCIAL_TRAIT_SCALE = 20;

const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));

/** Points from a low-to-high `[threshold, points]` band table: the last band
 * whose threshold is met. Shared by star power and facilities so the two read
 * their tuning the same way. */
function bandPoints(bands: [number, number][], value: number): number {
  let out = bands.length > 0 ? bands[0][1] : 0;
  for (const [min, pts] of bands) if (value >= min) out = pts;
  return out;
}

function starPowerFactor(state: GameState, teamId: string, cfg: TuningConfig): MarketabilityFactor {
  const avg = topSquadAverage(state, teamId, cfg.marketabilityStarPowerTopN);
  const max = cfg.marketabilityWeightStarPower;
  return {
    key: "starPower",
    label: "Squad Star Power",
    points: Math.min(max, bandPoints(cfg.marketabilityStarPowerBands, avg)),
    max,
    detail: avg > 0 ? `Top Stars: ${Math.round(avg)} Avg` : "No senior squad",
  };
}

// ── C. Recent Team Form ────────────────────────────────────────────────────

/** The club's last completed matches, most recent first. Only clubs in playable
 * leagues have per-fixture results; sim leagues resolve statistically, so a sim
 * club has no form and scores zero on this factor. */
function recentResults(state: GameState, teamId: string, limit: number): ("W" | "D" | "L")[] {
  return state.fixtures
    .filter((f) => f.played && (f.homeId === teamId || f.awayId === teamId))
    .sort((a, b) => b.day - a.day || b.round - a.round)
    .slice(0, limit)
    .map((f) => {
      const home = f.homeId === teamId;
      const own = (home ? f.homeGoals : f.awayGoals) ?? 0;
      const opp = (home ? f.awayGoals : f.homeGoals) ?? 0;
      return own > opp ? "W" : own === opp ? "D" : "L";
    });
}

function formFactor(state: GameState, teamId: string, cfg: TuningConfig): MarketabilityFactor {
  const max = cfg.marketabilityWeightForm;
  const results = recentResults(state, teamId, cfg.marketabilityFormMatches);
  if (results.length === 0) {
    return { key: "form", label: "Recent Form", points: 0, max, detail: "No matches played" };
  }
  const raw = results.reduce(
    (s, r) => s + (r === "W" ? cfg.marketabilityFormWin : r === "D" ? cfg.marketabilityFormDraw : 0),
    0
  );
  // Scaled off the theoretical maximum for a FULL run of matches, not off the
  // games actually played — otherwise a club three games into a season with
  // three wins would read as perfect form.
  const ceiling = cfg.marketabilityFormMatches * cfg.marketabilityFormWin;
  let points = ceiling > 0 ? (raw / ceiling) * max : 0;

  // Unbeaten run: counted from the most recent match backwards.
  let unbeaten = 0;
  for (const r of results) {
    if (r === "L") break;
    unbeaten++;
  }
  const onRun = unbeaten >= cfg.marketabilityFormUnbeatenGames;
  if (onRun) points += cfg.marketabilityFormUnbeatenBonus;

  const w = results.filter((r) => r === "W").length;
  const d = results.filter((r) => r === "D").length;
  return {
    key: "form",
    label: "Recent Form",
    points: Math.min(max, Math.round(points)),
    max,
    detail: onRun ? `Unbeaten in ${unbeaten}` : `${w}W ${d}D ${results.length - w - d}L in ${results.length}`,
  };
}

// ── D. Club Facilities & Infrastructure ────────────────────────────────────

/** Mean level across every income-upgrade track. Tracks that haven't been
 * bought count as level 0, so this reads as "how developed is this club" rather
 * than "how good is your best upgrade". */
export function averageFacilityLevel(state: GameState, teamId: string): number {
  if (FACILITY_KEYS.length === 0) return 0;
  const total = FACILITY_KEYS.reduce((s, k) => s + incomeUpgradeLevel(state, teamId, k), 0);
  return total / FACILITY_KEYS.length;
}

function facilitiesFactor(state: GameState, teamId: string, cfg: TuningConfig): MarketabilityFactor {
  const avg = averageFacilityLevel(state, teamId);
  const max = cfg.marketabilityWeightFacilities;
  const label = avg >= 8 ? "Elite Hub" : avg >= 4 ? "Mid-Tier Hub" : avg >= 1 ? "Basic Facilities" : "Undeveloped";
  return {
    key: "facilities",
    label: "Club Facilities",
    points: Math.min(max, bandPoints(cfg.marketabilityFacilityBands, avg)),
    max,
    detail: `${label} (L${avg.toFixed(1)} avg)`,
  };
}

// ── The score ──────────────────────────────────────────────────────────────

/** The full 0–100 breakdown for a club: the number, its four factors with their
 * working, and everything the number buys. This is the single source of truth —
 * `marketabilityScore`, the star rating and the sponsor maths all read it. */
export function marketabilityBreakdown(
  state: GameState,
  teamId: string,
  cfg: TuningConfig
): MarketabilityBreakdown {
  const factors: MarketabilityFactor[] = [
    leagueFactor(state, teamId, cfg),
    starPowerFactor(state, teamId, cfg),
    formFactor(state, teamId, cfg),
    facilitiesFactor(state, teamId, cfg),
  ];
  const total = Math.max(0, Math.min(100, Math.round(factors.reduce((s, f) => s + f.points, 0))));
  const tier = tierForPoints(total, cfg);
  return {
    total,
    factors,
    stars: tier.stars,
    maxOffers: tier.offers,
    valueMult: tier.valueMult,
    flavour: tier.flavour,
  };
}

/** The tier band a score falls in. Bands are read low to high; a score above the
 * last band's ceiling takes the last band, so the table can be re-cut freely. */
function tierForPoints(points: number, cfg: TuningConfig) {
  const tiers = cfg.marketabilityTiers;
  for (let i = 0; i < tiers.length; i++) {
    if (points <= tiers[i].maxPoints) return { ...tiers[i], stars: i + 1 };
  }
  const last = tiers[tiers.length - 1];
  return { ...last, stars: tiers.length };
}

/** The 0–100 headline on its own. */
export function marketabilityScore(state: GameState, teamId: string, cfg: TuningConfig): number {
  return marketabilityBreakdown(state, teamId, cfg).total;
}

/** Whole-star reading of Club Marketability, 1–5. */
export function marketabilityStarRating(state: GameState, teamId: string, cfg: TuningConfig): number {
  return marketabilityBreakdown(state, teamId, cfg).stars;
}

/** Multiplier applied to every sponsorship offer's money. */
export function marketabilityValueMult(state: GameState, teamId: string, cfg: TuningConfig): number {
  return marketabilityBreakdown(state, teamId, cfg).valueMult;
}

/** How many sponsor offers may sit on the table at once for this club. */
export function marketabilityMaxLiveOffers(state: GameState, teamId: string, cfg: TuningConfig): number {
  return marketabilityBreakdown(state, teamId, cfg).maxOffers;
}

/** Flavour label for a star rating — what the commercial department would say. */
export function marketabilityLabel(stars: number): string {
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  return ["Local Draw", "Modest Draw", "Solid Appeal", "Great Draw", "World-Class Draw"][s - 1];
}

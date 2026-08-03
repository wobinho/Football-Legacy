/**
 * Club Marketability (v1.86) — the 0–100 score behind the Investments page.
 *
 * SIX factors, each producing a normalised 0–1 score which is then multiplied by
 * its weight from `marketabilityWeights`. Separating the score from the weight is
 * the whole shape of this rework: in v44 a factor's weight WAS its points budget,
 * so every band table encoded its own importance and re-weighting anything meant
 * re-cutting every number inside it. Now a factor answers only "how well is this
 * club doing at this thing, 0 to 1", and the weights table alone decides what
 * that is worth.
 *
 *   A. League Division    32 — the division's own 0–10 reputation
 *   B. European Cups      20 — how far you got, times what the cup is worth
 *   C. Squad Star Power   15 — the mean of your three best players
 *   D. Club Facilities    14 — levels held across the staff facilities
 *   E. League Position    12 — where you sit in your division
 *   F. Recent Form         7 — the last ten results
 *
 * Two things here are rules rather than tuning, and both exist because the naive
 * version is wrong in a way that only shows up in play:
 *
 * 1. **Europe renormalises away when it is unavailable.** A club not in a
 *    continental competition is not scored zero out of 20 — that factor is
 *    removed and its weight redistributed proportionally across the other five.
 *    Scoring it zero would cap every club outside Europe at 80/100 through no
 *    fault of its own: season one has no European football at all, and a club in
 *    a non-European nation can never qualify. The elite money band would have
 *    been unreachable by construction. Renormalising means "as good as a club
 *    can be, given what is open to it" reads as 100 either way, and a club that
 *    DOES have Europe is measured on the owner's stated weights exactly.
 *
 * 2. **Facilities are counted, not averaged.** The factor reads total levels
 *    held over total levels available across `FACILITY_SPECS` — one point per
 *    upgrade — so a fifth facility shipping tomorrow moves the denominator by
 *    itself and nothing here needs editing. It deliberately reads the STAFF
 *    facilities (`lib/facilities.ts`), not the income upgrades it used to: those
 *    are a revenue line, and scoring "how much sponsor money you attract" off
 *    "how much sponsor money you already collect" was a loop.
 *
 * The score is derived on read rather than stored, so it updates the moment a
 * result lands or an upgrade is bought — no cache, no save field, no migration.
 */

import type { GameState, EuroStage } from "./types";
import type { TuningConfig } from "./config/tuning";
import { FACILITY_SPECS, facilityMaxLevel } from "./config/facilities";
import { facilityLevel } from "./facilities";
import { leagueReputation } from "./config/leaguerep";
import { computeTable } from "./season";
import { TRAITS } from "./config/traits";

/** The six things marketability is made of. */
export type MarketabilityFactorKey =
  | "league"
  | "position"
  | "form"
  | "starPower"
  | "facilities"
  | "europe";

/** One factor's contribution, with the working shown. The Investments page
 * renders this list directly, so what the user reads is by construction the
 * same arithmetic the sponsor money uses — the two cannot drift. */
export interface MarketabilityFactor {
  key: MarketabilityFactorKey;
  label: string;
  /** Points earned — the factor's 0–1 score times its effective weight. */
  points: number;
  /** This factor's effective weight — the most it can contribute. Note this is
   * the RENORMALISED weight, not the raw tuning entry, so `points/max` is always
   * a fair reading of how well the club is doing at this factor. */
  max: number;
  /** The raw 0–1 score, before weighting. */
  score: number;
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
  /** Headline "offer multiplier" the page quotes — what a major deal's annual
   * value works out to relative to the floor. Display only (v1.86): the money
   * itself is computed from the score directly by `marketabilityOfferAnnual`. */
  valueMult: number;
  /** The calibre of brand this band attracts ("Global Brands"). */
  flavour: string;
  /** True when the club has European football and factor F is live. When false
   * its weight has been shared out across the other five. */
  europeActive: boolean;
}

/** Points from a low-to-high `[threshold, score]` band table: the last band whose
 * threshold is met. */
function bandAtOrAbove(bands: [number, number][], value: number): number {
  let out = bands.length > 0 ? bands[0][1] : 0;
  for (const [min, score] of bands) if (value >= min) out = score;
  return out;
}

/** Score from a low-to-high `[maxValue, score]` table: the FIRST band the value
 * does not exceed. The mirror of `bandAtOrAbove`, for a metric where lower is
 * better (a league position fraction). */
function bandAtOrBelow(bands: [number, number][], value: number): number {
  for (const [max, score] of bands) if (value <= max) return score;
  return bands.length > 0 ? bands[bands.length - 1][1] : 0;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── A. League Division ─────────────────────────────────────────────────────

function leagueFactor(state: GameState, teamId: string, cfg: TuningConfig) {
  const league = state.leagues[state.teams[teamId]?.leagueId ?? ""];
  if (!league) return { score: 0, detail: "No league" };
  // The division's own 0–10 standing, not its tier number: a top flight in a
  // major nation and a top flight in a small one are genuinely worth different
  // money to a brand, and `leagueReputation` is the game's existing answer to
  // exactly that question.
  const rep = Math.round(leagueReputation(league));
  const table = cfg.marketabilityLeagueRepScore;
  const score = table[Math.max(0, Math.min(table.length - 1, rep))] ?? 0;
  return { score, detail: `${league.name} · reputation ${rep}/10` };
}

// ── B. League Position ─────────────────────────────────────────────────────

/** The club's current rank in its own division, 1-based, and the division size.
 * Position is null for a club whose league has no table (a sim league resolves
 * statistically and holds no per-fixture results). */
function leagueRank(
  state: GameState,
  teamId: string
): { rank: number; of: number; played: number } | null {
  const league = state.leagues[state.teams[teamId]?.leagueId ?? ""];
  if (!league?.playable || league.teamIds.length === 0) return null;
  const table = computeTable(state.fixtures, league.id, league.teamIds);
  const rank = table.findIndex((r) => r.teamId === teamId);
  if (rank < 0) return null;
  return { rank: rank + 1, of: league.teamIds.length, played: table[rank].played };
}

function positionFactor(state: GameState, teamId: string, cfg: TuningConfig) {
  const placed = leagueRank(state, teamId);
  if (!placed) return { score: 0, detail: "No league table" };
  // Before a ball is kicked the table is alphabetical, not meaningful: every
  // club is on zero points and `computeTable`'s tie-break decides the order. A
  // club would otherwise be scored as though it were bottom of the division for
  // the whole pre-season and the opening weeks — which is exactly when a manager
  // is looking at sponsorship offers. Score it mid-table until there is a result
  // to read, so an unplayed season is neutral rather than a punishment.
  if (placed.played === 0) {
    return { score: bandAtOrBelow(cfg.marketabilityPositionBands, 0.5), detail: "Season not started" };
  }
  // As a fraction of the division rather than an absolute position, so an
  // 18-club league and a 24-club one read alike: 4th of 20 and 4th of 24 are not
  // the same achievement, and the fraction is what a brand actually cares about.
  const fraction = placed.of > 1 ? (placed.rank - 1) / (placed.of - 1) : 0;
  return {
    score: bandAtOrBelow(cfg.marketabilityPositionBands, fraction),
    detail: `${placed.rank}${ordinal(placed.rank)} of ${placed.of}`,
  };
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
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

function formFactor(state: GameState, teamId: string, cfg: TuningConfig) {
  const results = recentResults(state, teamId, cfg.marketabilityFormMatches);
  // Same reasoning as `positionFactor`: with no matches on record the honest
  // reading is "unknown", not "terrible". Scored as an even record so a club
  // between seasons isn't quoted relegation money.
  if (results.length === 0) return { score: 0.5, detail: "No recent matches" };

  const raw = results.reduce(
    (s, r) => s + (r === "W" ? cfg.marketabilityFormWin : r === "D" ? cfg.marketabilityFormDraw : 0),
    0
  );
  // Scaled off the theoretical maximum for a FULL run of matches, not off the
  // games actually played — otherwise a club three games into a season with
  // three wins would read as perfect form.
  const ceiling = cfg.marketabilityFormMatches * cfg.marketabilityFormWin;
  let score = ceiling > 0 ? raw / ceiling : 0;

  // Unbeaten run: counted from the most recent match backwards.
  let unbeaten = 0;
  for (const r of results) {
    if (r === "L") break;
    unbeaten++;
  }
  const onRun = unbeaten >= cfg.marketabilityFormUnbeatenGames;
  if (onRun) score += cfg.marketabilityFormUnbeatenBonus;

  const w = results.filter((r) => r === "W").length;
  const d = results.filter((r) => r === "D").length;
  return {
    score: clamp01(score),
    detail: onRun
      ? `Unbeaten in ${unbeaten}`
      : `${w}W ${d}D ${results.length - w - d}L in ${results.length}`,
  };
}

// ── D. Squad Star Power ────────────────────────────────────────────────────

/**
 * Mean overall of the club's best `topN` senior players, or 0 for an empty
 * squad. Academy players don't count: a sponsor is buying the first team.
 *
 * Commercial traits (Marketable, Fan Favourite, Global Icon) are folded in here
 * as a small uplift to a player's effective rating rather than as a factor of
 * their own. The v20 model made those traits the *gate* on the whole system —
 * but they describe exactly the thing this factor measures (what a club's
 * headline names are worth to a brand), so deleting their effect would leave
 * three traits whose in-game description promises something they no longer do.
 * A Global Icon is worth a few points of star power; he is no longer the
 * difference between having a commercial department and not.
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

function starPowerFactor(state: GameState, teamId: string, cfg: TuningConfig) {
  const avg = topSquadAverage(state, teamId, cfg.marketabilityStarPowerTopN);
  return {
    score: bandAtOrAbove(cfg.marketabilityStarPowerBands, avg),
    detail: avg > 0 ? `Top ${cfg.marketabilityStarPowerTopN}: ${Math.round(avg)} avg` : "No senior squad",
  };
}

// ── E. Club Facilities ─────────────────────────────────────────────────────

/** Total facility levels held and the total available, across every facility in
 * `FACILITY_SPECS` (v1.86). One point per upgrade: an unbuilt club is 0/20 with
 * four five-level facilities, and shipping a fifth facility moves the
 * denominator on its own without anything here changing. */
export function facilityProgress(state: GameState, teamId: string): { held: number; total: number } {
  const team = state.teams[teamId];
  let held = 0;
  let total = 0;
  for (const spec of FACILITY_SPECS) {
    total += facilityMaxLevel(spec);
    if (team) held += facilityLevel(team, spec.id);
  }
  return { held, total };
}

function facilitiesFactor(state: GameState, teamId: string) {
  const { held, total } = facilityProgress(state, teamId);
  // Linear, deliberately. A band table here would make the last upgrade inside a
  // band worth literally nothing, and these are the most expensive purchases in
  // the game — every one of them should move the number.
  return {
    score: total > 0 ? held / total : 0,
    detail: `${held}/${total} facility levels`,
  };
}

// ── F. European Cup Performance ────────────────────────────────────────────

/** The club's European standing this season: the cup it is in and how far it
 * got, or null if it has no continental football. Unlike `userEuroCup` this
 * works for any club, so an AI club's book is priced on the same terms. */
function europeanStanding(
  state: GameState,
  teamId: string
): { cupName: string; tier: number; stage: EuroStage | "qualified" } | null {
  for (const cup of state.european?.cups ?? []) {
    if (!cup.teamIds.includes(teamId)) continue;
    // `exitStage` is only written when a club goes out (or wins it), so a club
    // still alive mid-campaign reads as `qualified` rather than as eliminated.
    const stage = cup.winnerId === teamId ? "champion" : cup.exitStage[teamId] ?? "qualified";
    return { cupName: cup.name, tier: cup.tier, stage };
  }
  return null;
}

function europeFactor(state: GameState, teamId: string, cfg: TuningConfig) {
  const standing = europeanStanding(state, teamId);
  if (!standing) return null;
  const stageScore = cfg.marketabilityEuroStageScore[standing.stage] ?? 0;
  const tierMult =
    cfg.marketabilityEuroTierMult[
      Math.max(0, Math.min(cfg.marketabilityEuroTierMult.length - 1, standing.tier - 1))
    ] ?? 1;
  return {
    score: clamp01(stageScore * tierMult),
    detail: `${standing.cupName} · ${STAGE_LABEL[standing.stage] ?? standing.stage}`,
  };
}

/**
 * The floor a club's European score is measured against — what it would have
 * scored had it not qualified at all.
 *
 * Without this, renormalisation punishes qualification. A club with no Europe
 * has that factor removed and its other five scaled up to 100, so a perfect
 * domestic season reads as 100. The same club winning the Conference League
 * gains a 20-point factor scored at 0.45 and drops to 89 — qualifying for a
 * weak cup made it *less* marketable, which is nonsense and would have been a
 * genuine trap (the optimal play being to avoid European football).
 *
 * So the factor is floored: a European campaign can never score a club below
 * what the same club would have got with no European football at all. Europe is
 * upside only. It is a floor rather than a rescaling because the top of the
 * range must stay honest — only a deep Champions League run reaches 1.0, and
 * that is what the 20 points are for.
 */
function europeFloor(otherScore: number): number {
  return clamp01(otherScore);
}

const STAGE_LABEL: Record<string, string> = {
  qualified: "Qualified",
  groupStage: "Group Stage",
  roundOf16: "Round of 16",
  quarterFinal: "Quarter-Final",
  semiFinal: "Semi-Final",
  runnerUp: "Runners-Up",
  champion: "Champions",
};

// ── The score ──────────────────────────────────────────────────────────────

const FACTOR_LABEL: Record<MarketabilityFactorKey, string> = {
  league: "League Division",
  europe: "European Cups",
  starPower: "Squad Star Power",
  facilities: "Club Facilities",
  position: "League Position",
  form: "Recent Form",
};

/** The full 0–100 breakdown for a club: the number, its factors with their
 * working, and everything the number buys. This is the single source of truth —
 * `marketabilityScore`, the star rating and the sponsor maths all read it. */
export function marketabilityBreakdown(
  state: GameState,
  teamId: string,
  cfg: TuningConfig
): MarketabilityBreakdown {
  const weightOf = (k: MarketabilityFactorKey) => cfg.marketabilityWeights[k] ?? 0;

  const domestic: { key: MarketabilityFactorKey; score: number; detail: string }[] = [
    { key: "league", ...leagueFactor(state, teamId, cfg) },
    { key: "starPower", ...starPowerFactor(state, teamId, cfg) },
    { key: "facilities", ...facilitiesFactor(state, teamId) },
    { key: "position", ...positionFactor(state, teamId, cfg) },
    { key: "form", ...formFactor(state, teamId, cfg) },
  ];

  // The domestic factors on their own, renormalised to 100 — both the score a
  // club with no European football gets, and the floor a European campaign is
  // measured against so that qualifying can never cost points. See `europeFloor`.
  const domesticWeight = domestic.reduce((s, f) => s + weightOf(f.key), 0);
  const domesticNorm = domesticWeight > 0 ? 1 / domesticWeight : 0;
  const domesticScore = domestic.reduce((s, f) => s + clamp01(f.score) * weightOf(f.key) * domesticNorm, 0);

  const europe = europeFactor(state, teamId, cfg);
  const raw = europe
    ? [
        domestic[0],
        {
          key: "europe" as const,
          ...europe,
          score: Math.max(europe.score, europeFloor(domesticScore)),
        },
        ...domestic.slice(1),
      ]
    : domestic;

  // Renormalise: the weights of the factors actually in play are scaled up to
  // sum to 100. With Europe live this is the identity (the table already sums to
  // 100); without it, Europe's 20 is shared out in proportion. See the header —
  // scoring an unavailable factor zero would put the top money band permanently
  // out of reach for most of the world.
  const liveWeight = raw.reduce((s, f) => s + weightOf(f.key), 0);
  const norm = liveWeight > 0 ? 100 / liveWeight : 0;

  const factors: MarketabilityFactor[] = raw.map((f) => {
    const max = weightOf(f.key) * norm;
    return {
      key: f.key,
      label: FACTOR_LABEL[f.key],
      score: clamp01(f.score),
      points: Math.round(clamp01(f.score) * max * 10) / 10,
      max: Math.round(max * 10) / 10,
      detail: f.detail,
    };
  });

  const total = Math.max(
    0,
    Math.min(100, Math.round(raw.reduce((s, f) => s + clamp01(f.score) * weightOf(f.key) * norm, 0)))
  );
  const tier = tierForPoints(total, cfg);
  return {
    total,
    factors,
    stars: tier.stars,
    maxOffers: tier.offers,
    valueMult: offerValueMult(total, cfg),
    flavour: tier.flavour,
    europeActive: europe !== null,
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

// ── What the score is worth in money (v1.86) ───────────────────────────────

/**
 * The ANNUAL value of a front-of-shirt deal at a National suitor, for a club on
 * this marketability score. Every major offer in the game is this figure scaled
 * by the slot's share and the tier roll.
 *
 * Continuous rather than banded: under v44 the money came off
 * `marketabilityTiers[].valueMult`, so a club could add fifteen points of
 * marketability and see its offers not move at all, then gain one more point and
 * watch them jump 60%. A curve means every point of the score is worth
 * something, which is the whole reason the six factors exist.
 */
export function marketabilityOfferAnnual(score: number, cfg: TuningConfig): number {
  const t = Math.pow(clamp01(score / 100), cfg.sponsorMajorAnnualCurve);
  return cfg.sponsorMajorAnnualMin + (cfg.sponsorMajorAnnualMax - cfg.sponsorMajorAnnualMin) * t;
}

/** The headline "offer multiplier" the Investments page quotes — the annual band
 * at this score relative to its floor. Derived from the same curve the money
 * uses, so the page can never advertise a multiplier the offers don't honour. */
function offerValueMult(score: number, cfg: TuningConfig): number {
  const floor = cfg.sponsorMajorAnnualMin;
  return floor > 0 ? marketabilityOfferAnnual(score, cfg) / floor : 1;
}

/** The 0–100 headline on its own. */
export function marketabilityScore(state: GameState, teamId: string, cfg: TuningConfig): number {
  return marketabilityBreakdown(state, teamId, cfg).total;
}

/** Whole-star reading of Club Marketability, 1–5. */
export function marketabilityStarRating(state: GameState, teamId: string, cfg: TuningConfig): number {
  return marketabilityBreakdown(state, teamId, cfg).stars;
}

/** Display multiplier on offer money for this club. */
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

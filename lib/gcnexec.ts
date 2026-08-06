// Global Executives (v1.95) — the GCN Operations boardroom.
//
// Three seats, each driving exactly ONE network-wide channel:
//
//   football  → every player at every owned club plays and develops better.
//   commerce  → the network's passive income multiplies.
//   scouting  → hubs cost less to establish and file faster.
//
// The shape is deliberately NOT the club's backroom. A club's staff system is a
// staffing PUZZLE — many people, ten buildings, an assignment grid, three badge
// slots each — and repeating that at network scale would be the same game played
// twice with bigger numbers. An executive is a SEAT: one hire, one salary, one
// blanket effect, and the only question is what pedigree the treasury can carry.
//
// What it DOES share with the club system is the scaling, because it is the same
// idea at a different altitude: `base` for holding the seat at all, a per-STAR
// term, and a per-BADGE-TIER term earned by serving. The split between the last
// two is the design's load-bearing part and is asserted by `verify:gcn`: a
// brand-new 5-star hire gets roughly half of a seat's ceiling, and the rest is
// only ever available to an executive the network KEEPS. That is what makes a
// ten-season appointment a bet worth taking rather than a rounding error against
// re-hiring whoever is best on the market this month.
//
// Every number lives in tuning. Nothing here branches on a role by name except
// the tables themselves, which are the role's definition.

import type {
  BadgeTier,
  GameState,
  GcnExecCandidate,
  GcnExecRole,
  GcnExecutive,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import { NAME_POOLS } from "./config/names";
import { deriveSeed, mulberry32, pick, randInt, uid, type RNG } from "./rng";

// ── The three seats ──────────────────────────────────────────────────────────

export interface GcnExecRoleSpec {
  id: GcnExecRole;
  title: string;
  /** What the seat is, in the boardroom's own words. */
  blurb: string;
  /** What the number this seat produces MEANS — the unit, in one phrase. Every
   * seat's effect is a percentage, but they are percentages of very different
   * things, and a card that just says "+18%" is a card that says nothing. */
  effectLabel: string;
  icon: string;
}

/** The seats, in boardroom order. This table IS the role definition — adding a
 * fourth seat is a row here plus a row in each of the three tuning records, and
 * nothing else in this file changes. */
export const GCN_EXEC_ROLES: GcnExecRoleSpec[] = [
  {
    id: "football",
    title: "Director of Global Football",
    blurb:
      "Runs the football side of every club the network owns. Sets the coaching standard, the playing model and the development pathway across the whole group.",
    effectLabel: "to match ratings and development speed at every owned club",
    icon: "⚽",
  },
  {
    id: "commerce",
    title: "Director of Global Commerce",
    blurb:
      "The network's financial engine. Negotiates the group's brand deals and broadcast rights, and turns the network's standing into money in the treasury.",
    effectLabel: "to Brand Deals and GCN Deals income",
    icon: "📈",
  },
  {
    id: "scouting",
    title: "Director of Global Scouting",
    blurb:
      "Conductor of the International Scouting Hubs. Opens doors in regions the network has never worked, and keeps every hub on the map filing.",
    effectLabel: "off hub costs, and the same again onto hub speed",
    icon: "🌍",
  },
];

export const GCN_EXEC_ROLE_MAP: Record<GcnExecRole, GcnExecRoleSpec> = Object.fromEntries(
  GCN_EXEC_ROLES.map((r) => [r.id, r])
) as Record<GcnExecRole, GcnExecRoleSpec>;

// ── The executive badge ladder ───────────────────────────────────────────────
// Shares the club system's tier NAMES on purpose — one vocabulary for "how good
// is this thing" across the whole game — but its own season costs, because an
// executive holds one seat rather than competing for three badge slots.

const BADGE_TIERS: BadgeTier[] = ["bronze", "silver", "gold", "diamond", "obsidian", "legacy"];

/** The tier a number of completed seasons in a seat earns, or null below the
 * first rung — an executive who hasn't served a full season holds no badge. */
export function execBadgeTierFor(cfg: TuningConfig, seasons: number): BadgeTier | null {
  let out: BadgeTier | null = null;
  cfg.gcnExecBadgeSeasons.forEach((need, i) => {
    if (seasons >= need) out = BADGE_TIERS[i] ?? out;
  });
  return out;
}

/** A tier's numeric weight (bronze = 1 … legacy = 6) — what `gcnExecBadgeEffect`
 * is multiplied by. An absent badge weighs nothing. */
export function execBadgeWeight(tier: BadgeTier | undefined): number {
  if (!tier) return 0;
  const i = BADGE_TIERS.indexOf(tier);
  return i < 0 ? 0 : i + 1;
}

/** Seasons still to serve before the next tier, or null once at the top. */
export function execSeasonsToNextBadge(cfg: TuningConfig, seasons: number): number | null {
  const next = cfg.gcnExecBadgeSeasons.find((need) => seasons < need);
  return next === undefined ? null : next - seasons;
}

// ── Reading a seat ───────────────────────────────────────────────────────────

export function executiveIn(state: GameState, role: GcnExecRole): GcnExecutive | undefined {
  return state.gcn?.executives?.[role];
}

/** Everyone currently employed, in boardroom order. */
export function hiredExecutives(state: GameState): { role: GcnExecRole; exec: GcnExecutive }[] {
  const out: { role: GcnExecRole; exec: GcnExecutive }[] = [];
  for (const spec of GCN_EXEC_ROLES) {
    const exec = executiveIn(state, spec.id);
    if (exec) out.push({ role: spec.id, exec });
  }
  return out;
}

/** The combined weekly wage bill of the boardroom, paid from the TREASURY. */
export function execWageBill(state: GameState): number {
  return hiredExecutives(state).reduce((s, { exec }) => s + exec.wage, 0);
}

// ── The effect ───────────────────────────────────────────────────────────────

/** One seat's effect, broken into its three terms so the boardroom card can show
 * the arithmetic rather than one opaque number — and so the UI reads the same
 * function the engine consumes, which is what stops a card quoting a figure the
 * simulation won't use. */
export interface GcnExecEffect {
  role: GcnExecRole;
  /** Held-the-seat term. Zero when the seat is vacant. */
  base: number;
  /** From the executive's stars. */
  stars: number;
  /** From the badge earned in this seat. */
  badges: number;
  /** base + stars + badges, as a PERCENT. */
  total: number;
  /** The ceiling this seat can ever reach, for the card's progress read. */
  max: number;
  /** Whether anyone is actually in the chair. */
  filled: boolean;
}

/** What a seat is worth right now. A vacant seat is all zeroes — an executive
 * has no intrinsic effect and neither does an empty chair, which is the same
 * rule the club staff system runs on. */
export function execEffect(state: GameState, role: GcnExecRole, cfg: TuningConfig): GcnExecEffect {
  const exec = executiveIn(state, role);
  const max =
    cfg.gcnExecBaseEffect[role] +
    5 * cfg.gcnExecStarEffect[role] +
    BADGE_TIERS.length * cfg.gcnExecBadgeEffect[role];
  if (!exec) {
    return { role, base: 0, stars: 0, badges: 0, total: 0, max, filled: false };
  }
  const base = cfg.gcnExecBaseEffect[role];
  const stars = exec.stars * cfg.gcnExecStarEffect[role];
  const badges = execBadgeWeight(exec.badge) * cfg.gcnExecBadgeEffect[role];
  return { role, base, stars, badges, total: base + stars + badges, max, filled: true };
}

/**
 * The Director of Global Football's multiplier on an owned club's players.
 *
 * ONE number, consumed in two places that are both already multipliers — the
 * match-day rating seam (`coachMult` in gameloop's `sideInputFor`, and the sim
 * resolver's strength read) and the development pass's facility multiplier. It
 * is deliberately not a third channel of its own: both call sites take a
 * multiplier today, so this rides the lever that already exists.
 *
 * Returns exactly 1 for every club the network does not own, and for a network
 * with the seat vacant — so a save with no boardroom is arithmetically
 * untouched, and no caller needs to know whether the GCN exists.
 */
export function globalFootballMult(state: GameState, clubId: string, cfg: TuningConfig): number {
  // The manager's OWN club is excluded on purpose. He runs it himself, with its
  // own facilities and its own staff; letting the network's boardroom also
  // multiply it would stack an end-game bonus on top of the club systems the
  // whole game has been about, and make the GCN the best way to improve the team
  // you actually pick.
  if (clubId === state.userTeamId) return 1;
  if (!state.gcn?.clubIds.includes(clubId)) return 1;
  return 1 + execEffect(state, "football", cfg).total / 100;
}

/** The Director of Global Commerce's multiplier on the network's passive income
 * — Brand Deals into the treasury, GCN Deals out to the clubs. 1 when vacant. */
export function globalCommerceMult(state: GameState, cfg: TuningConfig): number {
  return 1 + execEffect(state, "commerce", cfg).total / 100;
}

/** The Director of Global Scouting's discount on establishing and upgrading a
 * hub: a multiplier ON THE COST, so 1 is full price and lower is cheaper.
 *
 * Floored well above zero — a discount that can reach 100% would make hubs free,
 * which is a different feature. */
export function globalScoutingCostMult(state: GameState, cfg: TuningConfig): number {
  return Math.max(0.5, 1 - execEffect(state, "scouting", cfg).total / 100);
}

/** The same director's multiplier on how fast hubs file. Above 1; the cadence
 * function DIVIDES by it, so a faster director means fewer days between
 * batches. */
export function globalScoutingSpeedMult(state: GameState, cfg: TuningConfig): number {
  return 1 + execEffect(state, "scouting", cfg).total / 100;
}

// ── The elite market ─────────────────────────────────────────────────────────

const EXEC_NATS = [
  "ENG", "ESP", "ITA", "GER", "FRA", "NED", "POR", "BRA", "ARG", "USA",
  "JPN", "SUI", "BEL", "SWE", "MEX", "URU",
];

function execName(rng: RNG): { name: string; nationality: string } {
  const nat = pick(rng, EXEC_NATS);
  const pool = NAME_POOLS.find((p) => p.nat === nat) ?? NAME_POOLS[0];
  return { name: `${pick(rng, pool.first)} ${pick(rng, pool.last)}`, nationality: nat };
}

/** Roll a star rating off the cumulative market weights. Table lookup, never a
 * branch on the value. */
function rollStars(rng: RNG, cfg: TuningConfig): number {
  const roll = rng();
  const i = cfg.gcnExecMarketStarWeights.findIndex((w) => roll <= w);
  return (i < 0 ? cfg.gcnExecMarketStarWeights.length : i + 1);
}

/** What an executive of this pedigree costs per week. */
export function execWageFor(cfg: TuningConfig, stars: number, badge: BadgeTier | undefined): number {
  return Math.round(
    cfg.gcnExecWageBase +
      stars * cfg.gcnExecWagePerStar +
      execBadgeWeight(badge) * cfg.gcnExecWagePerBadgeTier
  );
}

/** The one-off fee to prise them out of wherever they are. */
export function execFeeFor(cfg: TuningConfig, wage: number): number {
  return Math.round(wage * cfg.gcnExecFeeWeeks);
}

function generateCandidate(rng: RNG, cfg: TuningConfig, role: GcnExecRole): GcnExecCandidate {
  const { name, nationality } = execName(rng);
  const stars = rollStars(rng, cfg);
  // Prior service, and therefore an arriving badge. Capped at
  // `gcnExecBadgeHireMaxSeasons` — the top of the ladder is only ever earned at
  // your own network, exactly as the club staff market works.
  const seasonsServed =
    rng() < cfg.gcnExecBadgeHireChance
      ? randInt(rng, cfg.gcnExecBadgeSeasons[0], cfg.gcnExecBadgeHireMaxSeasons)
      : 0;
  const badge = execBadgeTierFor(cfg, seasonsServed) ?? undefined;
  const wage = execWageFor(cfg, stars, badge);
  return {
    id: uid("exec"),
    name,
    nationality,
    // An executive is a career administrator: the band starts where a playing or
    // coaching career has already ended and runs to an ordinary retirement.
    age: randInt(rng, 38, 64),
    stars,
    wage,
    fee: execFeeFor(cfg, wage),
    seasonsServed,
    badge,
    role,
  };
}

/** Build a fresh shortlist: `gcnExecMarketPerRole` candidates for each of the
 * three seats. Deterministic from the world seed and the day, like every other
 * market in the game. */
export function generateExecMarket(state: GameState, cfg: TuningConfig): GcnExecCandidate[] {
  const rng = mulberry32(deriveSeed(state.seed, `gcnexec:${state.currentDay}`));
  const out: GcnExecCandidate[] = [];
  for (const spec of GCN_EXEC_ROLES) {
    for (let i = 0; i < cfg.gcnExecMarketPerRole; i++) {
      out.push(generateCandidate(rng, cfg, spec.id));
    }
  }
  return out;
}

/** The shortlist for one seat. */
export function execMarketFor(state: GameState, role: GcnExecRole): GcnExecCandidate[] {
  return (state.gcn?.execMarket ?? []).filter((c) => c.role === role);
}

/** Cycle the shortlist on the loop's own clock — `marketRefreshDays`, the same
 * constant the club's staff market uses. There is deliberately no second refresh
 * constant for the boardroom: two markets running on two clocks is a thing the
 * manager has to keep in his head for no benefit. */
export function execMarketTick(state: GameState, cfg: TuningConfig) {
  const gcn = state.gcn;
  if (!gcn) return;
  const last = gcn.execMarketDay ?? -Infinity;
  if (!gcn.execMarket || state.currentDay - last >= cfg.marketRefreshDays) {
    gcn.execMarket = generateExecMarket(state, cfg);
    gcn.execMarketDay = state.currentDay;
  }
}

// ── Hiring and dismissing ────────────────────────────────────────────────────

/** Appoint a candidate to their seat, paying the fee from the treasury. The
 * previous holder, if any, simply leaves — a seat holds one person, and swapping
 * is the ordinary way to change one. Returns an error string on failure. */
export function hireExecutive(state: GameState, candidateId: string, _cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const cand = (gcn.execMarket ?? []).find((c) => c.id === candidateId);
  if (!cand) return "That candidate is no longer available.";
  if (cand.fee > gcn.treasury) return "The GCN treasury can't afford the appointment fee.";
  gcn.treasury -= cand.fee;
  const exec: GcnExecutive = {
    id: cand.id,
    name: cand.name,
    nationality: cand.nationality,
    age: cand.age,
    stars: cand.stars,
    wage: cand.wage,
    hiredSeason: state.season,
    // Prior service travels with them — it is what the arriving badge is derived
    // from, and it keeps counting toward the next tier at this network. An
    // executive's record is his own; the seat is what he brings it to.
    seasonsServed: cand.seasonsServed,
    badge: cand.badge,
  };
  (gcn.executives ??= {})[cand.role] = exec;
  gcn.execMarket = (gcn.execMarket ?? []).filter((c) => c.id !== candidateId);
}

/** Dismiss the holder of a seat. No compensation — the wage simply stops, which
 * is the whole cost of the decision. Returns an error string on failure. */
export function dismissExecutive(state: GameState, role: GcnExecRole): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!gcn.executives?.[role]) return "That seat is already vacant.";
  delete gcn.executives[role];
}

// ── The season's end ─────────────────────────────────────────────────────────

/**
 * Credit every sitting executive with a completed season and re-derive their
 * badge. Called from the season rollover.
 *
 * Two things are deliberate. Service is credited to whoever is in the chair at
 * the ROLLOVER, so hiring in January and dismissing in April earns nothing — a
 * badge is for serving a season, not for appearing in one. And an executive who
 * passes `STAFF_MAX_AGE`-equivalent retirement is NOT modelled: the seat is
 * about the manager's decision to keep someone, and a director retiring out from
 * under him is a random event that takes that decision away.
 */
export function execSeasonRollover(state: GameState, cfg: TuningConfig): { role: GcnExecRole; exec: GcnExecutive; newTier: BadgeTier }[] {
  const promoted: { role: GcnExecRole; exec: GcnExecutive; newTier: BadgeTier }[] = [];
  for (const { role, exec } of hiredExecutives(state)) {
    exec.age += 1;
    const before = exec.badge;
    exec.seasonsServed += 1;
    const tier = execBadgeTierFor(cfg, exec.seasonsServed) ?? undefined;
    exec.badge = tier;
    if (tier && tier !== before) promoted.push({ role, exec, newTier: tier });
  }
  return promoted;
}

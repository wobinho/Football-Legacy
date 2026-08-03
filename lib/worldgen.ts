// World generator (§12): builds the fictional game world — England's two
// playable divisions plus selected sim-only leagues — into the game schema.
// Deterministic given a seed. A future CSV importer writes the same shapes.

import type { Attributes, Foot, GameState, League, PlayerBio, Pos, Team, Tactic } from "./types";
import { SCHEMA_VERSION } from "./types";
import { TUNING, type TuningConfig } from "./config/tuning";
import { ARCHETYPE_BY_PLAN, profileOf } from "./config/archetype";
import { TRAINING_PLAN_MAP, plansForPosition, type TrainingPlanDef } from "./config/training";
import { traitsForPosition } from "./config/traits";
import { fitAttrsToOverall, keyAttrsFor, LEFT_FOOT_CHANCE, overallFromAttrs } from "./config/positions";
import { ATTR_KEYS, normalizeAttrs } from "./config/attributes";
import { poolFor, NAME_POOLS } from "./config/names";
import { defaultCountryDB, type ClubSeed, type CountryDatabase, type PlayerSeed } from "./database";
import { AI_FORMATIONS } from "./config/formations";
import {
  DEFAULT_TIER_NAMES,
  MAX_DIVISION_DEPTH,
  generateDivisionClubs,
  topUpDivisionClubs,
} from "./config/divisions";
import { leagueReputationOf } from "./config/leaguerep";
import { mulberry32, deriveSeed, pick, randInt, randNormal, randRange, shuffle, type RNG } from "./rng";
import { formatMoney, playerValue } from "./value";
import { buildSeasonSchedule } from "./calendar";
import { generateLeagueFixtures, initCup } from "./season";
import { generateStaffMarket } from "./facilities";
import { generateScoutMarket } from "./scouts";
import { resolveSimLeagues } from "./simresolver";
import { refreshSponsorOffers, seedAiSponsorBooks } from "./sponsors";
import { initAcademyState, seedInitialAcademy } from "./academy";
import { canRunEuropeanCups, initEuropeanState } from "./european";
import { emptyProgress, syncProgress } from "./achievements";
import { baseWage, ensureContracts, marketWageMult } from "./contracts";

/** The season a brand-new world is built at. Authored contract terms are anchored
 * to it so "N years remaining" resolves to an absolute expiry season. */
const WORLDGEN_SEASON = 1;
import { assignAllKitNumbers } from "./kitnumbers";
import type { AcademyState } from "./types";

// Squad template: how many players per position a generated club carries.
const SQUAD_TEMPLATE: [Pos, number][] = [
  ["GK", 3], ["CB", 4], ["LB", 2], ["RB", 2], ["DM", 2], ["CM", 3], ["LM", 1], ["RM", 1], ["AM", 2], ["LW", 2], ["RW", 2], ["ST", 3],
];

// Secondary-position table (§ multi-position): a player has their primary plus,
// with the given probability, ONE realistic secondary. Not every player gets
// one — this is what makes a versatile player worth noting. Left/right of the
// same role is the most common overlap; some center backs cover full back;
// central mids drop to CDM or push to CAM; wide players can invert to AM.
const SECONDARY_OPTIONS: Partial<Record<Pos, { pos: Pos; chance: number }[]>> = {
  CB: [{ pos: "LB", chance: 0.12 }, { pos: "RB", chance: 0.12 }],
  LB: [{ pos: "RB", chance: 0.45 }, { pos: "LW", chance: 0.18 }, { pos: "CB", chance: 0.12 }],
  RB: [{ pos: "LB", chance: 0.45 }, { pos: "RW", chance: 0.18 }, { pos: "CB", chance: 0.12 }],
  DM: [{ pos: "CM", chance: 0.4 }, { pos: "CB", chance: 0.1 }],
  CM: [{ pos: "DM", chance: 0.3 }, { pos: "AM", chance: 0.3 }, { pos: "LM", chance: 0.1 }, { pos: "RM", chance: 0.1 }],
  LM: [{ pos: "RM", chance: 0.45 }, { pos: "LW", chance: 0.3 }, { pos: "CM", chance: 0.15 }],
  RM: [{ pos: "LM", chance: 0.45 }, { pos: "RW", chance: 0.3 }, { pos: "CM", chance: 0.15 }],
  AM: [{ pos: "CM", chance: 0.35 }, { pos: "LW", chance: 0.15 }, { pos: "RW", chance: 0.15 }],
  LW: [{ pos: "RW", chance: 0.5 }, { pos: "LM", chance: 0.25 }, { pos: "AM", chance: 0.22 }, { pos: "ST", chance: 0.12 }],
  RW: [{ pos: "LW", chance: 0.5 }, { pos: "RM", chance: 0.25 }, { pos: "AM", chance: 0.22 }, { pos: "ST", chance: 0.12 }],
  ST: [{ pos: "AM", chance: 0.14 }, { pos: "LW", chance: 0.08 }, { pos: "RW", chance: 0.08 }],
};

/** Roll a single realistic secondary position for a primary, or none. */
function rollSecondary(rng: RNG, primary: Pos): Pos[] {
  const options = SECONDARY_OPTIONS[primary];
  if (!options) return [];
  for (const o of options) {
    if (rng() < o.chance) return [o.pos];
  }
  return [];
}

let playerCounter = 0;
function pid(): string {
  return `p${(++playerCounter).toString(36)}`;
}

function makeName(rng: RNG, nat: string): string {
  const pool = poolFor(nat);
  return `${pick(rng, pool.first)} ${pick(rng, pool.last)}`;
}

function pickNationality(rng: RNG, homeNat: string, homeShare: number): string {
  if (rng() < homeShare) return homeNat;
  return pick(rng, NAME_POOLS).nat;
}

/**
 * Physical maturity at a given age, 0..1 (v15). This replaces the old hard
 * age-bracketed overall cap, which had two problems: it was a cliff (a player
 * one day past `youthOverallCapClearAge` was suddenly uncapped) and it was
 * *flat* inside a bracket, so a 14-year-old and a 16-year-old were treated as
 * equally capable.
 *
 * The curve is smooth and monotonic: a 14-year-old sits far below a 16-year-old,
 * who sits below an 18-year-old, who is close to (but not quite) a finished
 * adult. It reaches 1.0 at `maturityFullAge` and stays there, so nothing about
 * an adult's generation changes.
 *
 * Shape: a smoothstep between `maturityStartAge` and `maturityFullAge`, biased
 * by `maturityCurve` (>1 = the late-teen years are where most of the catching-up
 * happens, which is how youth football actually looks).
 */
export function maturityAt(age: number, cfg: TuningConfig): number {
  if (age >= cfg.maturityFullAge) return 1;
  if (age <= cfg.maturityStartAge) return cfg.maturityFloor;
  const span = cfg.maturityFullAge - cfg.maturityStartAge;
  const t = (age - cfg.maturityStartAge) / span;
  const eased = Math.pow(t, cfg.maturityCurve);
  return cfg.maturityFloor + (1 - cfg.maturityFloor) * eased;
}

/**
 * The realistic *current* ability for a player of this age given the ability
 * they're being generated toward (v15). A prospect's requested overall is read
 * as the level they'd show as a finished player; what they can do *today* is
 * that scaled by maturity, with a small seeded spread so two 15-year-olds of
 * the same promise aren't identical.
 *
 * Crucially this is continuous in age, so 14 < 15 < 16 < 17 always holds on
 * average — the thing the old bracketed cap got wrong.
 */
function ageAdjustedOverall(rng: RNG, requested: number, age: number, cfg: TuningConfig): number {
  const maturity = maturityAt(age, cfg);
  if (maturity >= 1) return requested;
  // Scale toward the quality floor rather than toward zero: even a raw 14-year-old
  // in a professional academy is a footballer, not a random body.
  const floor = cfg.minOverall;
  const scaled = floor + (requested - floor) * maturity;
  const jitter = randNormal(rng) * cfg.maturitySpread;
  return scaled + jitter;
}

/** Roll a height in cm from the archetype's band, with a small age allowance:
 * the youngest prospects haven't finished growing yet (v15). */
function rollHeight(rng: RNG, planId: string, age: number, cfg: TuningConfig): number {
  const [mean, sd] = profileOf(ARCHETYPE_BY_PLAN[planId]).heightCm;
  const adult = mean + randNormal(rng) * sd;
  // Below the full-growth age a prospect is still short of his adult frame.
  const grown = age >= cfg.heightFullAge ? 1 : 1 - (cfg.heightFullAge - age) * cfg.heightPerYoungYear;
  return Math.round(Math.max(160, Math.min(210, adult * Math.max(0.9, grown))));
}

/** Roll a preferred foot (v42) from the position's real-world left/right split.
 * Descriptive only — nothing in the engine reads it — but it makes a squad list
 * read like a real one, with left-footers concentrated down the left. */
function rollFoot(rng: RNG, pos: Pos): Foot {
  return rng() < LEFT_FOOT_CHANCE[pos] ? "Left" : "Right";
}

/**
 * Roll a full 35-attribute line for a player of the given ability (v41).
 *
 * The TRAINING PLAN's weights say WHERE this player's quality should sit (the
 * poacher plan's finishing is its signature; its tackling is not). The weights
 * are a 0..1 emphasis, so they are read as a spread around the requested
 * ability: primary attributes land above it, background ones below, with a
 * small per-attribute jitter so no two players off the same plan are twins.
 *
 * v1.77: this used to read a seed archetype's `attrProfile`. Generating from the
 * plan instead is what collapsed the two archetype systems into one — the
 * archetype a player reads as is derived from the line this produces, and
 * because the line was shaped by that archetype's own plan, the two agree by
 * construction rather than by coincidence.
 *
 * The result is then FITTED to the requested overall (fitAttrsToOverall), which
 * is what keeps the two consistent: the attributes are the source of truth and
 * the headline number is derived from them, so the spread can be as expressive
 * as it likes without the rating drifting.
 */
function deriveAttrs(rng: RNG, overall: number, plan: TrainingPlanDef, pos: Pos): Attributes {
  const profile = plan.weights;
  const maxW = Math.max(...ATTR_KEYS.map((k) => profile[k])) || 1;
  const attrs = {} as Attributes;
  for (const k of ATTR_KEYS) {
    const rel = profile[k] / maxW; // 1.0 for the signature attribute
    const v = overall * (0.55 + 0.48 * rel) + randNormal(rng) * 3;
    attrs[k] = Math.round(Math.max(10, Math.min(99, v)));
  }
  // Settle the line onto the ability it was rolled for. The fit is
  // weight-proportional, so a position with one dominant attribute (a keeper's
  // handling/diving/reflexes/positioning quartet) would otherwise see that
  // attribute absorb almost the whole correction and pin at 99. Pre-compensating
  // the top-weighted attributes downward leaves the fit room to work, so a good
  // keeper reads as good across his skills rather than maxed in one.
  const top = keyAttrsFor(pos, 4);
  for (const k of top) attrs[k] = Math.round(Math.max(10, attrs[k] - overall * 0.06));
  return fitAttrsToOverall(attrs, pos, overall);
}

/** Overlay a (possibly partial) authored attribute set onto a generated one.
 * Authored values win; anything the author omitted keeps the procedurally
 * rolled value, so a seed that specifies three attributes still yields a
 * coherent 35-attribute player rather than a flat one. */
function normalizeAttrsOnto(base: Attributes, authored: Partial<Attributes>): Attributes {
  const out = { ...base };
  for (const k of ATTR_KEYS) {
    const v = Number(authored[k]);
    if (Number.isFinite(v)) out[k] = Math.max(1, Math.min(99, v));
  }
  return out;
}

export function generatePlayer(
  rng: RNG,
  cfg: TuningConfig,
  opts: { pos: Pos; overall: number; nat: string; age?: number; prodigy?: boolean; planId?: string }
): PlayerBio {
  const age = opts.age ?? Math.round(Math.min(35, Math.max(17, 24 + randNormal(rng) * 4.2)));
  // Quality floor (balance): no generated player is ever weaker than cfg.minOverall,
  // so the world holds no hopeless 38-rated bodies — every player is at least a
  // rough professional, and every prospect is genuinely developable.
  const requested = Math.round(Math.max(cfg.minOverall, Math.min(94, opts.overall)));
  // The caller may brief a specific archetype by naming its training plan (a
  // scout looking for a "Sniper" asks for `st_poacher`); otherwise pick one of
  // the position's five at random. A plan from another position group is ignored
  // — briefing a striker plan for a centre back would generate an incoherent
  // line — so a mismatched id falls back to a random valid plan.
  const briefed = opts.planId ? TRAINING_PLAN_MAP[opts.planId] : undefined;
  const options = plansForPosition(opts.pos);
  const plan =
    briefed && options.some((o) => o.id === briefed.id) ? briefed : pick(rng, options);

  // Age realism (§5, v15): a young player's *current* ability is his requested
  // ability scaled by a smooth physical/technical maturity curve. Unlike the old
  // bracketed soft cap this is continuous in age, so a 14-year-old is reliably
  // behind a 16-year-old who is behind an 18-year-old — no cliffs, no flat
  // brackets where two years of development counted for nothing.
  //
  // A rare seeded "prodigy" roll lets a teenager mature early and keep much more
  // of his requested ability — that's the genuine 80-rated 17-year-old. The
  // caller may force it (intake/scouting roll the chance themselves, so a gem
  // isn't gated twice); otherwise it's rolled here, which is what lets an elite
  // club's squad occasionally throw up a high-rated teenager.
  const isProdigy = opts.prodigy ?? rng() < cfg.youthProdigyChance;
  let overall: number;
  if (maturityAt(age, cfg) >= 1) {
    overall = requested; // adult — nothing to scale
  } else {
    const natural = ageAdjustedOverall(rng, requested, age, cfg);
    if (isProdigy) {
      // A prodigy is physically and technically ahead of his age group: he keeps
      // a large, randomised share of the gap between what an ordinary kid his age
      // would show and his full requested ability.
      const keep = cfg.youthProdigyKeepMin + rng() * (cfg.youthProdigyKeepMax - cfg.youthProdigyKeepMin);
      overall = Math.round(natural + (requested - natural) * keep);
    } else {
      overall = Math.round(natural);
    }
  }
  overall = Math.max(cfg.minOverall, Math.min(requested, overall));
  const trimmed = Math.max(0, requested - overall);

  // Younger players carry headroom; veterans are what they are. Any ability the
  // youth cap trimmed is added back as headroom (so the ceiling is preserved),
  // on top of the normal age-based growth room.
  let headroom = trimmed;
  if (age <= cfg.growthEndAge) {
    headroom += Math.max(0, Math.round((cfg.growthEndAge - age) * 1.9 + randNormal(rng) * 3.5));
  } else if (age <= 27) {
    headroom += Math.max(0, randInt(rng, 0, 2));
  }
  let potential = Math.min(96, overall + headroom);
  // Balance (v10): give still-growing players a hidden ceiling in a high,
  // well-spread band so almost every prospect is worth developing while ceilings
  // still vary. A seeded roll spreads potentials across the band rather than
  // piling them at the floor; prime/veteran players keep their small headroom.
  if (age <= cfg.growthEndAge) {
    const bandTop = Math.min(cfg.potentialAbsoluteCap, cfg.youthPotentialBandTop);
    const banded = Math.round(cfg.youthPotentialFloor + rng() * (bandTop - cfg.youthPotentialFloor));
    potential = Math.max(potential, banded);
  }
  potential = Math.max(potential, overall);

  // Traits are gated by position group (§ trait eligibility) so a striker never
  // gets a defender's trait — table lookup only, never a name special-case.
  const traits: string[] = [];
  const nTraits = rng() < 0.35 ? (rng() < 0.25 ? 2 : 1) : 0;
  const eligibleTraits = shuffle(rng, traitsForPosition(opts.pos));
  for (let i = 0; i < nTraits && i < eligibleTraits.length; i++) traits.push(eligibleTraits[i].id);

  // Multi-position: primary is the slot generated for; a realistic secondary is
  // rolled per player (not everyone is versatile). The archetype itself may span
  // both flanks (e.g. a full-back archetype covers LB & RB) but the player only
  // *plays* the extra side if the roll grants it.
  const secondary = rollSecondary(rng, opts.pos);
  const positions: Pos[] = [opts.pos, ...secondary];

  // v2 attribute-driven model: attributes are the source of truth and overall is
  // DERIVED from them (position-weighted). We still roll a target overall through
  // all the youth-cap / prodigy / potential logic above, generate an attribute
  // spread from it, then recompute overall from those attrs so the stored number
  // matches what the engine and UI read off the six attributes.
  const attrs = deriveAttrs(rng, overall, plan, opts.pos);
  overall = Math.max(cfg.minOverall, overallFromAttrs(attrs, opts.pos));
  potential = Math.max(potential, overall);

  const p: PlayerBio = {
    id: pid(),
    name: makeName(rng, opts.nat),
    age,
    nationality: opts.nat,
    heightCm: rollHeight(rng, plan.id, age, cfg),
    foot: rollFoot(rng, opts.pos),
    positions,
    // The plan he was generated from is also the plan he starts on, so an
    // untouched player keeps developing into the archetype he already reads as
    // rather than drifting off it the moment the first season rolls over.
    trainingPlan: plan.id,
    attrs,
    overall,
    potential,
    // Baseline for the season's +X/-X growth badge (v19). Stamped at creation so
    // a player generated mid-season (an intake kid, a scouted prospect) measures
    // his movement from where he actually joined the world — and so season one
    // of a new save shows growth rather than nothing until the first rollover.
    seasonStartOverall: overall,
    fitness: 100,
    form: 1.0,
    clubId: null,
    value: 0,
    traits,
    longevity: rng(),
    stats: { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 },
  };
  p.value = playerValue(p, cfg);
  return p;
}

/**
 * Player regen (v1.55): a fresh teenager born from a retiring player.
 *
 * When a genuinely good player hangs up his boots the world would otherwise be
 * strictly poorer for it. A regen carries his profile forward — same position,
 * nationality, archetype and physical frame — but as a raw teenager: a mediocre
 * current overall with his predecessor's PEAK potential as the ceiling to grow
 * into. He is generated as a free agent (no club), so the market, not the game,
 * decides where he lands.
 *
 * `retiree.potential` is read as the peak: by retirement age a player's potential
 * has long since converged onto (and been dragged up by) his best rating, so it
 * is the honest high-water mark of the career being succeeded.
 */
export function regenFromRetiree(rng: RNG, cfg: TuningConfig, retiree: PlayerBio): PlayerBio {
  const age = randInt(rng, cfg.regenAgeMin, cfg.regenAgeMax);
  const pos = retiree.positions[0];
  // Debut as a mediocre teenager — the ability is the potential's, the rating
  // isn't yet. generatePlayer's maturity curve scales this raw request down for
  // the age, so a 16-year-old regen reads appropriately unfinished.
  const requested = Math.round(randRange(rng, cfg.regenOverallMin, cfg.regenOverallMax));
  const p = generatePlayer(rng, cfg, {
    pos,
    overall: requested,
    nat: retiree.nationality,
    age,
    // A regen inherits the retiree's identity by inheriting the plan that
    // produced it — the successor is the same kind of footballer.
    planId: retiree.trainingPlan,
  });
  // Inherit the retiree's peak ceiling — the whole point of a regen is the chance
  // it grows into the shoes it was born to fill.
  p.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 6, retiree.potential)));
  // Same frame as the man he succeeds (a target man's regen is a target man),
  // down to the foot he plays off.
  if (typeof retiree.heightCm === "number") p.heightCm = retiree.heightCm;
  if (retiree.foot) p.foot = retiree.foot;
  // A free agent: no club, ready to be signed off the market.
  p.clubId = null;
  p.contract = undefined;
  p.value = playerValue(p, cfg);
  return p;
}

/** Materialize a hand-authored player from a custom-database seed. Two authoring
 * modes (both supported):
 *   • v2 (attribute-driven): the seed carries the six `attrs` — those are used
 *     verbatim and `overall` is DERIVED from them via the position weighting.
 *   • v1 (overall-driven): the seed carries `overall` — attrs are generated from
 *     it, exactly as before, for back-compat with `fl-country-db@1` files.
 * Anything the seed omits (potential, archetype, traits) is filled procedurally,
 * so a modder can still specify as little as name + positions + (attrs OR overall). */
export function materializePlayer(
  rng: RNG,
  cfg: TuningConfig,
  seed: PlayerSeed,
  homeNat: string,
  /** The wage-market scale of the division being built (v1.65). Only used for the
   * curve fallback below — an explicitly authored wage is always taken verbatim. */
  wageMult = 1
): PlayerBio {
  const primary = seed.positions[0];
  // A seed rating just to route the generator through age/potential logic; the
  // real overall is settled below from whichever mode the seed uses.
  const seedOverall =
    seed.overall ?? (seed.attrs ? overallFromAttrs(normalizeAttrs(seed.attrs), primary) : 60);
  const p = generatePlayer(rng, cfg, {
    pos: primary,
    overall: seedOverall,
    nat: seed.nationality ?? homeNat,
    age: seed.age,
  });
  p.name = seed.name;
  // Full name (v27) — only stored when it actually says more than the short
  // form, so the UI's "fullName ?? name" fallback never renders a duplicate.
  const full = seed.fullName?.trim();
  if (full && full !== seed.name.trim()) p.fullName = full;
  // honor explicit multi-position lists (else keep the generated primary+rolled)
  if (seed.positions.length > 1) p.positions = [...seed.positions];
  // A seed may name the training plan the player should start on (and so the
  // archetype he is meant to read as). Only a plan valid for his position is
  // taken; anything else keeps the procedurally rolled one.
  if (seed.trainingPlan && plansForPosition(primary).some((o) => o.id === seed.trainingPlan)) {
    p.trainingPlan = seed.trainingPlan;
  }
  // Authored height (v41) beats the archetype roll — the real-world databases
  // carry the player's actual height, which is simply better data.
  if (typeof seed.heightCm === "number" && Number.isFinite(seed.heightCm)) {
    p.heightCm = Math.round(Math.max(150, Math.min(215, seed.heightCm)));
  }
  // Authored foot (v42) beats the positional roll, same reasoning as height.
  if (seed.foot === "Left" || seed.foot === "Right") p.foot = seed.foot;

  if (seed.attrs) {
    // Attribute-driven: authored attrs are the source of truth; overall derives.
    // A hand-authored seed may specify only some of the 35 attributes, so the
    // generated line stands in for whatever it left out rather than defaulting
    // the rest to a flat number that would flatten the player's profile.
    p.attrs = normalizeAttrsOnto(p.attrs, seed.attrs);
    p.overall = overallFromAttrs(p.attrs, primary);
  } else if (typeof seed.overall === "number") {
    // Overall-driven (v1): honor the authored overall verbatim, past the youth cap.
    // Modded rosters may deliberately author sub-floor players, so the custom-DB
    // path is NOT clamped to cfg.minOverall — only procedural generation is.
    p.overall = Math.round(Math.max(40, Math.min(99, seed.overall)));
  }

  if (typeof seed.potential === "number") {
    p.potential = Math.round(Math.min(96, Math.max(p.overall, seed.potential)));
  }
  // keep the ceiling sane after settling the overall
  p.potential = Math.max(p.potential, p.overall);
  // Re-stamp the growth baseline against the SETTLED overall. generatePlayer
  // stamped it against its own rolled rating, which the authored attrs/overall
  // above then replaced — leaving the two out of step and every database player
  // wearing a phantom "+X this season" on a brand-new save (v1.5 fix).
  p.seasonStartOverall = p.overall;
  if (Array.isArray(seed.traits)) p.traits = [...seed.traits];
  p.value = playerValue(p, cfg);

  // Authored contract terms (v1.46): a rostered seed may fix the player's wage
  // and/or years remaining. The world is built at season 1, so a term of N
  // seasons runs through season N. ensureContracts() runs after worldgen and
  // skips any player that already carries a contract, so this stands as authored.
  // Wage-only authoring still gets a default-length deal; years-only uses the
  // wage curve for the number.
  if (seed.wage !== undefined || seed.contractYears !== undefined) {
    const wage =
      seed.wage !== undefined
        ? Math.max(0, Math.round(seed.wage))
        : Math.round((baseWage(p.overall, cfg) * wageMult) / 100) * 100;
    const years = Math.max(1, Math.round(seed.contractYears ?? cfg.contractRenewYearsDefault));
    p.contract = { wage, expirySeason: WORLDGEN_SEASON + years - 1, signedSeason: WORLDGEN_SEASON };
  }
  return p;
}

function generateSquad(
  rng: RNG,
  cfg: TuningConfig,
  club: ClubSeed,
  homeNat: string,
  homeShare: number,
  players: Record<string, PlayerBio>,
  teamId: string,
  seeds?: PlayerSeed[],
  /** Wage-market scale of the division this squad plays in (v1.65). */
  wageMult = 1
): string[] {
  const ids: string[] = [];

  // Custom database: materialize the authored roster verbatim first.
  if (seeds && seeds.length) {
    for (const seed of seeds) {
      const p = materializePlayer(rng, cfg, seed, homeNat, wageMult);
      p.clubId = teamId;
      players[p.id] = p;
      ids.push(p.id);
    }
  }

  // Fill out any positions the template still needs (a partial custom roster is
  // topped up procedurally; a fully generated club fills the whole template).
  const have = new Map<Pos, number>();
  for (const id of ids) {
    const pos = players[id].positions[0];
    have.set(pos, (have.get(pos) ?? 0) + 1);
  }
  // Squad strength: an authored squadQuality (create-a-club / modded DBs)
  // overrides reputation as the generated squad's level.
  const rep = club.squadQuality ?? club.rep;
  // `starterAvg` is the *first-choice* level the slot targets below are built
  // from — depth penalties, the superstar boost and the youth maturity curve all
  // pull the realised squad mean below it. An authored `squadAvgOverall` asks
  // for a specific realised mean instead, so solve for the starter level that
  // lands there (see solveStarterAvg) rather than using the rep curve.
  const starterAvg =
    club.squadAvgOverall !== undefined
      ? solveStarterAvg(cfg, club.squadAvgOverall, rep, have, homeNat, homeShare, teamId)
      : 40 + rep * 0.5;
  for (const p of fillSquad(rng, cfg, starterAvg, rep, have, homeNat, homeShare)) {
    p.clubId = teamId;
    players[p.id] = p;
    ids.push(p.id);
  }
  return ids;
}

/** Generate the procedural players a squad template still needs, at a given
 * first-choice level. Pure: returns the players without filing them anywhere, so
 * the squad-average solver can generate throwaway squads through exactly the
 * same code path the real pass uses. */
function fillSquad(
  rng: RNG,
  cfg: TuningConfig,
  starterAvg: number,
  rep: number,
  have: Map<Pos, number>,
  homeNat: string,
  homeShare: number
): PlayerBio[] {
  // Superstar seeding: at a genuine giant, a handful of first-choice players are
  // lifted into world-class territory so a fresh world actually holds 90-rated
  // stars. The boost scales with how far the club is above the elite threshold
  // (0 at the threshold, full at the top of the reputation scale) and is spent on
  // the club's first `eliteStarterCount` first-choice slots — its marquee spine.
  const eliteReach = Math.max(0, (rep - cfg.eliteClubRepThreshold) / (99 - cfg.eliteClubRepThreshold));
  const eliteBoost = eliteReach * cfg.eliteStarterBoostMax;
  // Spend the superstar quota on the marquee spine first — the positions where a
  // star is legible (a talismanic ST, a playmaking AM, a match-winning winger)
  // rather than on whichever slot the template happens to list first. Any quota
  // left over falls through to the rest of the first-choice XI.
  const ELITE_PRIORITY: Pos[] = ["ST", "AM", "LW", "RW", "CM", "CB", "GK", "DM", "LM", "RM", "LB", "RB"];
  const eliteSlots = new Set<Pos>();
  if (eliteBoost > 0) {
    for (const pos of ELITE_PRIORITY) {
      if (eliteSlots.size >= cfg.eliteStarterCount) break;
      if (SQUAD_TEMPLATE.some(([p]) => p === pos)) eliteSlots.add(pos);
    }
  }
  const out: PlayerBio[] = [];
  for (const [pos, count] of SQUAD_TEMPLATE) {
    for (let i = have.get(pos) ?? 0; i < count; i++) {
      // first player per position ≈ starter level, later ones are depth
      const depthPenalty = i === 0 ? 0 : 2.5 + i * 2.5;
      // A giant's first-choice slots on the marquee spine get the superstar boost,
      // so the stars sit clear of the rest of the squad and land where they read.
      const boost = i === 0 && eliteSlots.has(pos) ? eliteBoost : 0;
      const overall = Math.min(cfg.eliteHardCap, starterAvg - depthPenalty + boost + randNormal(rng) * 2.5);
      out.push(
        generatePlayer(rng, cfg, {
          pos,
          overall,
          nat: pickNationality(rng, homeNat, homeShare),
        })
      );
    }
  }
  return out;
}

/** Solve for the first-choice level (`starterAvg`) whose generated squad
 * actually averages `target` overall (v1.51, authored `squadAvgOverall`).
 *
 * There's no closed form to invert: between the requested slot level and the
 * stored overall sit the depth ladder, the superstar boost, the youth maturity
 * curve, the `minOverall` floor, the elite hard cap and the attribute
 * re-derivation. So measure instead — generate a throwaway squad, read its mean,
 * shift by the error, repeat. The response is very nearly 1:1 in the unclamped
 * middle of the range, so a few passes converge tightly; at the extremes (a
 * target under the quality floor, or above what the hard cap allows once depth
 * is priced in) it settles at the closest achievable mean.
 *
 * Runs on its own derived RNG so the probing never disturbs the shared
 * league stream — the caller's `rng` is consumed exactly once, by the real pass,
 * leaving every other club in the division byte-identical. */
function solveStarterAvg(
  cfg: TuningConfig,
  target: number,
  rep: number,
  have: Map<Pos, number>,
  homeNat: string,
  homeShare: number,
  teamId: string
): number {
  const SOLVE_PASSES = 8;
  // Each pass averages several independent probe squads. Fitting a single
  // sample would chase that sample's noise (a 27-man squad at σ≈2.5 per player
  // still swings ±0.5 on the mean) and the real pass — which draws a different
  // stream — would then land systematically off target. Averaging estimates the
  // *expected* mean instead, which is what actually transfers.
  const PROBES_PER_PASS = 8;
  // Start at the target: response is ≈1:1, so the passes only need to price in
  // the depth ladder, the youth maturity curve and the clamps.
  let starterAvg = target;
  let best = starterAvg;
  let bestErr = Infinity;
  for (let pass = 0; pass < SOLVE_PASSES; pass++) {
    let total = 0;
    let n = 0;
    for (let s = 0; s < PROBES_PER_PASS; s++) {
      // A fresh stream per probe: the estimate must not depend on how many
      // players an earlier probe drew, or the solve would wander with roster size.
      const probe = mulberry32(deriveSeed(SQUAD_AVG_SOLVE_SEED, `${teamId}:${pass}:${s}`));
      const squad = fillSquad(probe, cfg, starterAvg, rep, have, homeNat, homeShare);
      if (!squad.length) return starterAvg; // fully authored roster — nothing to size
      total += squad.reduce((sum, p) => sum + p.overall, 0);
      n += squad.length;
    }
    const err = target - total / n;
    if (Math.abs(err) < Math.abs(bestErr)) {
      bestErr = err;
      best = starterAvg;
    }
    if (Math.abs(err) < 0.02) break;
    starterAvg += err;
  }
  return best;
}

/** Fixed seed for the squad-average solver's throwaway probe squads. Constant
 * (not the world seed) so a club authored with a target average generates the
 * same strength in every save — the number the editor previews is the number the
 * world builds, regardless of which seed the legacy rolled. */
const SQUAD_AVG_SOLVE_SEED = 0x5A1F_00D5;

/** The average overall a fully generated squad actually lands on for a legacy
 * 1–100 `squadQuality`/`rep` dial. The forward direction of solveStarterAvg —
 * exported so the club editor can migrate a club authored on the old dial to
 * the equivalent average-overall number without guessing at the curve. */
export function squadAvgForQuality(quality: number, cfg: TuningConfig = TUNING): number {
  let total = 0;
  let n = 0;
  for (let s = 0; s < 8; s++) {
    const probe = mulberry32(deriveSeed(SQUAD_AVG_SOLVE_SEED, `preview:${Math.round(quality)}:${s}`));
    const squad = fillSquad(probe, cfg, 40 + quality * 0.5, quality, new Map(), "ENG", 0.6);
    total += squad.reduce((sum, p) => sum + p.overall, 0);
    n += squad.length;
  }
  return Math.round(total / n);
}

/** The band of squad averages worldgen can actually hit, for the editor to bound
 * its input to. Asking outside it isn't an error — the solver just settles at the
 * closest achievable mean — but the UI shouldn't offer a number the world can't
 * build. The floor is the generated-player quality floor (`minOverall`); the
 * ceiling is what a full 27-man squad can average once the depth ladder and the
 * `eliteHardCap` are priced in, measured rather than assumed. */
export const SQUAD_AVG_MIN = TUNING.minOverall;
export const SQUAD_AVG_MAX = 87;

/** A fixed, sensible default tactic (4-3-3, balanced possession). Exported for
 * clubs stood up outside worldgen (v34, GCN founding) that need a starting
 * tactic without a seeded RNG. */
export function defaultTactic(): Tactic {
  return { formationId: "433", mentality: "Balanced", style: "Possession" };
}

function randomTactic(rng: RNG): Tactic {
  // The three classic styles stay the backbone of the league (listed twice), with
  // the v19 hybrids appearing as the distinctive minority — so a Gegenpress or a
  // Park-the-Bus side is a match-up worth noticing rather than the norm.
  return {
    formationId: pick(rng, AI_FORMATIONS).id,
    mentality: pick(rng, ["Defensive", "Balanced", "Balanced", "Attacking"] as const),
    style: pick(rng, [
      "Possession", "Possession",
      "Counter", "Counter",
      "Direct", "Direct",
      "Gegenpress",
      "ParkTheBus",
      "WingPlay",
    ] as const),
  };
}

/** Starting transfer budget from reputation. Exported so the new-game setup can
 * preview the budget a created club will open with. v1.42: +25% across all clubs. */
export function clubBudget(rep: number): number {
  // v1.43: starting budgets cut 25% across the board to tighten the early economy.
  return Math.max(1_875_000, Math.round(Math.pow(Math.max(0, rep - 40), 2) * 37_500));
}

/** Generate a full procedural squad for a club created mid-save (v34, GCN
 * founding). Files the players into `players`, stamps their `clubId`, and
 * returns their ids — the same pipeline worldgen uses for a fresh club, exposed
 * so lib/gcn.ts can stand up a brand-new club without reaching into worldgen
 * internals. `avgOverall` sets the realised squad mean (a founded club is
 * deliberately weak); `homeNat` seeds nationalities. Deterministic given `seed`. */
export function generateClubSquad(
  seed: number,
  cfg: TuningConfig,
  teamId: string,
  name: string,
  rep: number,
  avgOverall: number,
  homeNat: string,
  players: Record<string, PlayerBio>
): string[] {
  const rng = mulberry32(deriveSeed(seed, `gcn-squad:${teamId}`));
  const club: ClubSeed = {
    name,
    short: name.slice(0, 3).toUpperCase(),
    rep,
    colors: ["#1a1a1a", "#c8a24a"],
    stadium: `${name} Stadium`,
    squadAvgOverall: avgOverall,
  };
  return generateSquad(rng, cfg, club, homeNat, 0.6, players, teamId, undefined);
}

export interface NewGameOptions {
  saveName: string;
  managerName: string;
  userTeamId: string; // resolved from teamIdFor(topDivisionId, clubIndex)
  /** The country the user manages in (3-letter code). Its divisions are playable. */
  playableCountry: string;
  /** Other countries to include as sim-only (view/shopping). */
  viewCountries: string[];
  /** How many divisions deep the playable country runs (1–3, v12). Tiers beyond
   * what the country's database authors are generated procedurally. Defaults to
   * whatever the database already provides (capped at MAX_DIVISION_DEPTH). */
  divisionDepth?: number;
  /** Per-country division depth (v17), keyed by country code — e.g.
   * `{ ENG: 2, GER: 3, FRA: 1 }`. Lets each included country run its own
   * pyramid depth. The playable country's entry wins over `divisionDepth`;
   * a country absent here keeps whatever its database authors. */
  divisionDepths?: Record<string, number>;
  /** Optional user-chosen league names, indexed by tier (1-based) — e.g.
   * `{ 1: "My Premier League" }`. Any tier left out keeps the database's name
   * (tier 1) or the DEFAULT_TIER_NAMES entry (generated tiers). */
  divisionNames?: Record<number, string>;
  /** Per-country database (default or user-uploaded). Missing entries fall back
   * to the built-in default for that country. Keyed by country code. */
  countryDBs?: Record<string, CountryDatabase>;
  /** European competitions (v1.51): how many continental tiers to run — 1 =
   * Champions League only, 2 = + Europa League, 3 = + Conference League. 0 (or
   * omitted) disables them entirely. Requires at least `EURO_MIN_COUNTRIES`
   * European countries in the save; below that the setting is ignored.
   *
   * The competitions begin in SEASON 2, because qualification is read from the
   * previous season's final league tables. */
  europeanTiers?: number;
  /** The user's qualification design (v1.65), keyed by country code: which cup
   * each finishing position in that country's top flight enters. See
   * `EuroSlotMap`. Omitted, the engine's defaults are used. */
  europeanSlots?: Record<string, number[]>;
  /** Whether the domestic cup winner takes a Europa League place (v1.65). */
  europeanCupWinnerQualifies?: boolean;
  /**
   * A financial takeover (v1.88): cash injected into the chosen club's budget at
   * kick-off, £0–£10bn. This is a SANDBOX dial, deliberately unbounded at the top
   * — the fantasy is the billionaire buy-out, and someone who asks for ten
   * billion has asked for a world where money is not the constraint.
   *
   * It is added to the club's ordinary opening war chest rather than replacing
   * it, so a takeover of a big club still starts richer than one of a small club
   * — the takeover changes the manager's ceiling, not the club's identity.
   * Clamped in `generateWorld`, so a hand-edited save file can't smuggle in more.
   */
  takeoverAmount?: number;
  seed?: number;
}

/** The ceiling on a new-save financial takeover (v1.88). Ten billion is the
 * owner's number: high enough to be absurd on purpose, finite so the figure
 * stays a number the economy can format and reason about. */
export const MAX_TAKEOVER_AMOUNT = 10_000_000_000;

export function teamIdFor(leagueId: string, index: number): string {
  return `${leagueId}_t${index}`;
}

/** Resolve the database for a country: an uploaded custom one if provided, else
 * the built-in default. */
function dbFor(opts: NewGameOptions, code: string): CountryDatabase | null {
  return opts.countryDBs?.[code] ?? defaultCountryDB(code);
}

/** A stable 32-bit hash of a string (FNV-1a). Used to derive a deterministic
 * default world seed from the new-game configuration. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The world seed for a new game. Determinism matters: with the built-in default
 * database, picking the same country + club must always build the *same* world
 * (the players you scout, your rivals' squads, everything) — a default database
 * is supposed to be a fixed, seeded dataset, not a fresh roll each save. So when
 * no explicit seed is given we derive one from the configuration: the playable
 * country + club + the set of included countries, plus a fingerprint of any
 * uploaded custom database (so a custom DB still produces its own stable world).
 * Pass an explicit `opts.seed` to deliberately reroll (e.g. a "surprise me").
 */
function resolveSeed(opts: NewGameOptions): number {
  if (typeof opts.seed === "number") return opts.seed >>> 0;
  const parts = [
    opts.playableCountry,
    opts.userTeamId,
    [...opts.viewCountries].sort().join(","),
  ];
  // fingerprint custom databases so a modded roster (or a created club/player)
  // yields its own stable world — content-hashed, so any edit rerolls
  if (opts.countryDBs) {
    for (const code of Object.keys(opts.countryDBs).sort()) {
      parts.push(`db:${code}:${hashString(JSON.stringify(opts.countryDBs[code]))}`);
    }
  }
  return hashString(parts.join("|"));
}

/**
 * The seed procedurally-generated DIVISIONS are built from (v17).
 *
 * This deliberately excludes the chosen club. The world seed keys off
 * `userTeamId`, but a generated lower division must be pickable *before* the
 * club is chosen — and choosing a club from it must not reshuffle the very list
 * it was chosen from. Keying generated tiers off the country + included
 * countries alone makes the setup preview and the built world produce identical
 * clubs, while the rest of the world (squads, scouting) still varies per club.
 */
export function divisionSeed(opts: {
  playableCountry: string;
  viewCountries: string[];
  countryDBs?: Record<string, CountryDatabase>;
  seed?: number;
}): number {
  if (typeof opts.seed === "number") return opts.seed >>> 0;
  const parts = [opts.playableCountry, [...opts.viewCountries].sort().join(",")];
  if (opts.countryDBs) {
    for (const code of Object.keys(opts.countryDBs).sort()) {
      parts.push(`db:${code}:${hashString(JSON.stringify(opts.countryDBs[code]))}`);
    }
  }
  return hashString(parts.join("|"));
}

/** Build a complete fresh GameState from the chosen country databases. */
export function generateWorld(opts: NewGameOptions): GameState {
  const seed = resolveSeed(opts);
  // Generated divisions key off a club-independent seed so the setup screen can
  // preview the exact clubs the world will contain (see divisionSeed).
  const divSeed = divisionSeed(opts);
  const cfg = TUNING;
  playerCounter = 0;

  const players: Record<string, PlayerBio> = {};
  const teams: Record<string, Team> = {};
  const leagues: Record<string, League> = {};

  const makeDivision = (
    db: CountryDatabase,
    div: CountryDatabase["divisions"][number],
    playable: boolean
  ) => {
    const rng = mulberry32(deriveSeed(seed, `league:${div.id}`));
    const homeShare = db.homeShare ?? 0.6;
    const teamIds: string[] = [];
    // The wage market this whole division is paid in (v1.65) — its country band
    // and its tier. Only reaches the curve fallback for authored contract terms;
    // everyone else is priced by ensureContracts once the world stands up.
    const wageMult = marketWageMult(/^([A-Z]{3})\d*$/.exec(div.id)?.[1] ?? null, div.tier, cfg);
    div.clubs.forEach((club, i) => {
      const teamId = teamIdFor(div.id, i);
      const playerIds = generateSquad(rng, cfg, club, db.nat, homeShare, players, teamId, club.players, wageMult);
      teams[teamId] = {
        id: teamId,
        name: club.name,
        short: club.short,
        leagueId: div.id,
        colors: club.colors,
        reputation: club.rep,
        // An authored starting budget (create-a-club / modded DBs) is honored
        // verbatim; otherwise the reputation curve sets the opening war chest.
        budget: club.budget !== undefined ? Math.max(0, Math.round(club.budget)) : clubBudget(club.rep),
        playerIds,
        tactic: randomTactic(rng),
        // Every club starts with nothing built and nobody employed (v1.79).
        // Only the user's club ever fills these in — an AI club's development
        // runs on the neutral curve, exactly as it did before the rework.
        facilities: {},
        staffRoster: [],
        stadium: club.stadium,
        academyPlayerIds: [],
        assignments: {},
        sponsors: [],
        sponsorOffers: [],
      };
      teamIds.push(teamId);
    });
    leagues[div.id] = {
      id: div.id,
      name: div.name,
      country: db.name,
      tier: div.tier,
      playable,
      teamIds,
      // Structural standing of the division (v1.72), from the country band and
      // the tier — see config/leaguerep.ts. Stamped once here; it never moves.
      reputation: leagueReputationOf(div.id, div.tier),
    };
  };

  // Playable country: every division runs the real engine (the user's club sits
  // in one; promotion/relegation moves clubs between adjacent tiers).
  const playCode = opts.playableCountry;
  const playDb = dbFor(opts, playCode);
  if (!playDb) throw new Error(`Unknown playable country "${playCode}".`);

  // Resolve a country's division ladder (v12; per-country depth v17). The
  // database supplies whatever tiers it authors; the requested depth beyond that
  // is generated procedurally, so any country can run a 2- or 3-tier pyramid
  // with working promotion/relegation.
  const buildLadder = (db: CountryDatabase, code: string, depth: number): CountryDatabase["divisions"] => {
    const authored = [...db.divisions].sort((a, b) => a.tier - b.tier);
    const want = Math.max(1, Math.min(MAX_DIVISION_DEPTH, depth));
    const authoredNames = new Set(authored.flatMap((d) => d.clubs.map((c) => c.name)));
    // A database that authors only a token league (four or six clubs — several
    // shipped countries do) is filled out to a playable size before anything
    // else looks at it, so every country runs a real season (v1.72).
    const ladder: CountryDatabase["divisions"] = authored.slice(0, want).map((d) => {
      const clubs = topUpDivisionClubs(divSeed, code, d.tier, d.clubs, authoredNames);
      if (clubs === d.clubs) return d;
      for (const c of clubs) authoredNames.add(c.name);
      return { ...d, clubs };
    });
    for (let tier = authored.length + 1; tier <= want; tier++) {
      ladder.push({
        id: `${code}${tier}`,
        name: DEFAULT_TIER_NAMES[tier] ?? `Division ${tier}`,
        tier,
        clubs: generateDivisionClubs(divSeed, code, tier, authoredNames),
      });
    }
    return ladder;
  };

  /** The depth a country should run: its explicit per-country setting, else the
   * legacy single `divisionDepth` for the playable country, else whatever the
   * database authors. */
  const depthFor = (db: CountryDatabase, code: string): number =>
    opts.divisionDepths?.[code] ?? (code === playCode ? opts.divisionDepth ?? db.divisions.length : db.divisions.length);

  const ladder = buildLadder(playDb, playCode, depthFor(playDb, playCode));
  // Apply any user-chosen league names over the resolved ladder.
  for (const div of ladder) {
    const custom = opts.divisionNames?.[div.tier]?.trim();
    if (custom) div.name = custom;
  }
  for (const div of ladder) makeDivision(playDb, div, true);

  // View-only countries: sim leagues (shopping / atmosphere). These honour their
  // own chosen depth too, so a save can run 3 tiers in Germany while France
  // stays a single division.
  const depths: Record<string, number> = { [playCode]: ladder.length };
  for (const code of opts.viewCountries) {
    if (code === playCode) continue;
    const db = dbFor(opts, code);
    if (!db) continue;
    const simLadder = buildLadder(db, code, depthFor(db, code));
    depths[code] = simLadder.length;
    for (const div of simLadder) makeDivision(db, div, false);
  }

  // The playable country's division ladder, top-first (v12). A single-division
  // country yields a one-entry ladder and simply has no promotion/relegation.
  const divisionIds: string[] = ladder.map((d) => d.id);

  // Free agents — signable during windows (home-nation flavored to the country)
  const faRng = mulberry32(deriveSeed(seed, "freeagents"));
  for (let i = 0; i < 45; i++) {
    const pos = pick(faRng, SQUAD_TEMPLATE)[0];
    const p = generatePlayer(faRng, cfg, {
      pos,
      overall: 48 + faRng() * 22,
      nat: pickNationality(faRng, playDb.nat, 0.4),
      age: randInt(faRng, 24, 34),
    });
    players[p.id] = p;
  }

  const schedule = buildSeasonSchedule(1);
  const playableDivisionIds = Array.from(new Set(divisionIds));
  const fixtures = playableDivisionIds.flatMap((id, idx) =>
    generateLeagueFixtures(id, leagues[id].teamIds, schedule.leagueRoundDays, seed + idx)
  );
  const cup = initCup(playableDivisionIds.flatMap((id) => leagues[id].teamIds), teams);

  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    saveName: opts.saveName,
    seed,
    managerName: opts.managerName,
    userTeamId: opts.userTeamId,
    playableCountry: playCode,
    divisionIds,
    divisionDepths: depths,
    season: 1,
    currentDay: schedule.seasonStartDay,
    players,
    careers: {},
    teams,
    leagues,
    fixtures,
    cup,
    schedule,
    lineup: {},
    inbox: [],
    offers: [],
    transferList: [],
    shortlist: [],
    staffMarket: generateStaffMarket(deriveSeed(seed, "staff:1")),
    scoutMarket: generateScoutMarket(deriveSeed(seed, "scouts:1"), cfg),
    marketRefreshDay: schedule.seasonStartDay + cfg.marketRefreshDays,
    simResults: [],
    academy: null as unknown as AcademyState, // filled below — needs the state object
    recordBook: { seasons: [], biggestWin: null },
    progress: emptyProgress(),
    hallOfFame: [],
    pendingMatchFixtureId: null,
    lastExportSeason: 1,
    news: [],
    transferNews: [],
  };
  state.academy = initAcademyState(state, cfg);
  // European cups (v1.51). Only attached when the user asked for them AND the
  // save actually holds enough European countries to fill the competitions.
  // `cups` starts empty: qualification reads the previous season's final tables,
  // so the first continental campaign is drawn at the season-1 rollover.
  if (opts.europeanTiers && opts.europeanTiers > 0 && canRunEuropeanCups(state)) {
    state.european = initEuropeanState(
      state,
      opts.europeanTiers,
      opts.europeanSlots,
      opts.europeanCupWinnerQualifies ?? true
    );
  }
  seedInitialAcademy(state, cfg);
  // Shirt numbers (v15): every squad in the world is numbered once the rosters
  // are final — best players first, so the stars wear the classic low numbers.
  assignAllKitNumbers(state);
  // Every club-attached player gets an initial individual contract (§10 v5).
  // Academy players stay wage-free until promoted.
  ensureContracts(state, cfg);
  // Seed opening sponsorship offers for the user's empty slots (v6).
  refreshSponsorOffers(state, cfg);
  // Every AI club opens the save with a sponsorship book of its own (v1.5),
  // resolved automatically, so the world's commercial money is real from day
  // one rather than materialising at the first rollover. No budget credit here:
  // clubBudget() has already set each club's opening war chest, and banking the
  // majors on top would double-count the money they start the game with.
  seedAiSponsorBooks(state, cfg);
  // Resolve the non-playable leagues once up front so a brand-new save already
  // has the season's fresh, not-yet-started tables (teams loaded in strength
  // order, 0 games) for the open summer window. They fill in at the winter window
  // (~halfway) and again after their final round (full).
  resolveSimLeagues(state, 0, cfg);

  // Seed the accolade high-water marks off the opening squad and war chest
  // (v1.7). Without this the cabinet reads "Peak Budget £0" on a brand-new save
  // — the marks are only refreshed at a match, transfer or rollover, so a club
  // that starts with £53m and an 88-rated striker showed nothing until its first
  // game. New worlds skip the migration path that syncs everything else.
  syncProgress(state);

  const user = teams[opts.userTeamId];

  // Financial takeover (v1.88). Applied AFTER syncProgress so the accolade
  // high-water marks are the club's own opening war chest — a takeover is the
  // manager's money arriving, not a record the club set before he walked in.
  // Peak Budget catches up at the first match, transfer or rollover like any
  // other balance.
  const takeover = Math.max(0, Math.min(MAX_TAKEOVER_AMOUNT, Math.round(opts.takeoverAmount ?? 0)));
  if (takeover > 0) user.budget += takeover;

  state.inbox.push({
    id: "welcome",
    day: state.currentDay,
    season: 1,
    type: "board",
    title: `Welcome to ${user.name}`,
    body: `The board welcomes ${opts.managerName} as the new manager of ${user.name}. Your budget is available now and the summer transfer window is open until 1 September. The season kicks off in mid-August — set your tactics, shape your squad, and build a legacy.`,
    read: false,
  });

  if (takeover > 0) {
    state.inbox.push({
      id: "takeover",
      day: state.currentDay,
      season: 1,
      type: "board",
      title: `${user.name} taken over`,
      body: `New ownership has completed its acquisition of ${user.name}, injecting ${formatMoney(takeover)} directly into the club's transfer and wage budget. The board's message to ${opts.managerName} is short: the money is there, the expectation is silverware. Spend it well — a squad is easier to buy than a legacy.`,
      read: false,
    });
  }

  return state;
}

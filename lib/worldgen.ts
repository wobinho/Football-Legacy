// World generator (§12): builds the fictional game world — England's two
// playable divisions plus selected sim-only leagues — into the game schema.
// Deterministic given a seed. A future CSV importer writes the same shapes.

import type { GameState, League, PlayerBio, Pos, Team, Tactic } from "./types";
import { SCHEMA_VERSION } from "./types";
import { TUNING, type TuningConfig } from "./config/tuning";
import { archetypesForPosition, getArchetype, DEFAULT_HEIGHT_CM } from "./config/archetypes";
import { traitsForPosition } from "./config/traits";
import { overallFromAttrs } from "./config/positions";
import { poolFor, NAME_POOLS } from "./config/names";
import { defaultCountryDB, type ClubSeed, type CountryDatabase, type PlayerSeed } from "./database";
import { FORMATIONS } from "./config/formations";
import { DEFAULT_TIER_NAMES, MAX_DIVISION_DEPTH, generateDivisionClubs } from "./config/divisions";
import { mulberry32, deriveSeed, pick, randInt, randNormal, shuffle, type RNG } from "./rng";
import { playerValue } from "./value";
import { buildSeasonSchedule } from "./calendar";
import { generateLeagueFixtures, initCup } from "./season";
import { generateStaffMarket } from "./staff";
import { generateScoutMarket } from "./scouts";
import { resolveSimLeagues } from "./simresolver";
import { refreshSponsorOffers } from "./sponsors";
import { initAcademyState, seedInitialAcademy } from "./academy";
import { ensureContracts } from "./contracts";
import { assignAllKitNumbers } from "./kitnumbers";
import type { AcademyState } from "./types";

// Squad template: how many players per position a generated club carries.
const SQUAD_TEMPLATE: [Pos, number][] = [
  ["GK", 3], ["CB", 4], ["LB", 2], ["RB", 2], ["DM", 2], ["CM", 3], ["AM", 2], ["LW", 2], ["RW", 2], ["ST", 3],
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
  CM: [{ pos: "DM", chance: 0.3 }, { pos: "AM", chance: 0.3 }],
  AM: [{ pos: "CM", chance: 0.35 }, { pos: "LW", chance: 0.15 }, { pos: "RW", chance: 0.15 }],
  LW: [{ pos: "RW", chance: 0.5 }, { pos: "AM", chance: 0.22 }, { pos: "ST", chance: 0.12 }],
  RW: [{ pos: "LW", chance: 0.5 }, { pos: "AM", chance: 0.22 }, { pos: "ST", chance: 0.12 }],
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
function rollHeight(rng: RNG, archetypeId: string, age: number, cfg: TuningConfig): number {
  const [mean, sd] = getArchetype(archetypeId).heightCm ?? DEFAULT_HEIGHT_CM;
  const adult = mean + randNormal(rng) * sd;
  // Below the full-growth age a prospect is still short of his adult frame.
  const grown = age >= cfg.heightFullAge ? 1 : 1 - (cfg.heightFullAge - age) * cfg.heightPerYoungYear;
  return Math.round(Math.max(160, Math.min(210, adult * Math.max(0.9, grown))));
}

function deriveAttrs(rng: RNG, overall: number, archetypeId: string) {
  const profile = getArchetype(archetypeId).attrProfile;
  const keys = ["pac", "sho", "pas", "dri", "def", "phy"] as const;
  const maxW = Math.max(...keys.map((k) => profile[k]));
  const attrs = {} as Record<(typeof keys)[number], number>;
  for (const k of keys) {
    const rel = profile[k] / maxW; // 1.0 for the signature attribute
    const v = overall * (0.55 + 0.48 * rel) + randNormal(rng) * 3;
    attrs[k] = Math.round(Math.max(20, Math.min(99, v)));
  }
  return attrs;
}

export function generatePlayer(
  rng: RNG,
  cfg: TuningConfig,
  opts: { pos: Pos; overall: number; nat: string; age?: number; prodigy?: boolean; archetypeId?: string }
): PlayerBio {
  const age = opts.age ?? Math.round(Math.min(35, Math.max(17, 24 + randNormal(rng) * 4.2)));
  // Quality floor (balance): no generated player is ever weaker than cfg.minOverall,
  // so the world holds no hopeless 38-rated bodies — every player is at least a
  // rough professional, and every prospect is genuinely developable.
  const requested = Math.round(Math.max(cfg.minOverall, Math.min(94, opts.overall)));
  // The caller may brief a specific archetype (e.g. a scout looking for a "Poacher");
  // otherwise pick a realistic one for the position. Guard against a mismatched id.
  const briefed = opts.archetypeId ? getArchetype(opts.archetypeId) : null;
  const archetype = briefed && briefed.positions.includes(opts.pos) ? briefed : pick(rng, archetypesForPosition(opts.pos));

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
  const attrs = deriveAttrs(rng, overall, archetype.id);
  overall = Math.max(cfg.minOverall, overallFromAttrs(attrs, opts.pos));
  potential = Math.max(potential, overall);

  const p: PlayerBio = {
    id: pid(),
    name: makeName(rng, opts.nat),
    age,
    nationality: opts.nat,
    heightCm: rollHeight(rng, archetype.id, age, cfg),
    positions,
    archetypeId: archetype.id,
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
  homeNat: string
): PlayerBio {
  const primary = seed.positions[0];
  // A seed rating just to route the generator through age/potential logic; the
  // real overall is settled below from whichever mode the seed uses.
  const seedOverall = seed.overall ?? (seed.attrs ? overallFromAttrs(seed.attrs, primary) : 60);
  const p = generatePlayer(rng, cfg, {
    pos: primary,
    overall: seedOverall,
    nat: seed.nationality ?? homeNat,
    age: seed.age,
  });
  p.name = seed.name;
  // honor explicit multi-position lists (else keep the generated primary+rolled)
  if (seed.positions.length > 1) p.positions = [...seed.positions];
  if (seed.archetypeId && getArchetype(seed.archetypeId).id === seed.archetypeId) p.archetypeId = seed.archetypeId;

  if (seed.attrs) {
    // Attribute-driven: authored attrs are the source of truth; overall derives.
    p.attrs = { ...seed.attrs };
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
  if (Array.isArray(seed.traits)) p.traits = [...seed.traits];
  p.value = playerValue(p, cfg);
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
  seeds?: PlayerSeed[]
): string[] {
  const ids: string[] = [];

  // Custom database: materialize the authored roster verbatim first.
  if (seeds && seeds.length) {
    for (const seed of seeds) {
      const p = materializePlayer(rng, cfg, seed, homeNat);
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
  const starterAvg = 40 + (club.squadQuality ?? club.rep) * 0.5;
  for (const [pos, count] of SQUAD_TEMPLATE) {
    for (let i = have.get(pos) ?? 0; i < count; i++) {
      // first player per position ≈ starter level, later ones are depth
      const depthPenalty = i === 0 ? 0 : 2.5 + i * 2.5;
      const overall = starterAvg - depthPenalty + randNormal(rng) * 2.5;
      const p = generatePlayer(rng, cfg, {
        pos,
        overall,
        nat: pickNationality(rng, homeNat, homeShare),
      });
      p.clubId = teamId;
      players[p.id] = p;
      ids.push(p.id);
    }
  }
  return ids;
}

function randomTactic(rng: RNG): Tactic {
  // The three classic styles stay the backbone of the league (listed twice), with
  // the v19 hybrids appearing as the distinctive minority — so a Gegenpress or a
  // Park-the-Bus side is a match-up worth noticing rather than the norm.
  return {
    formationId: pick(rng, FORMATIONS).id,
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
 * preview the budget a created club will open with. */
export function clubBudget(rep: number): number {
  return Math.max(2_000_000, Math.round(Math.pow(Math.max(0, rep - 40), 2) * 40_000));
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
  seed?: number;
}

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
    div.clubs.forEach((club, i) => {
      const teamId = teamIdFor(div.id, i);
      const playerIds = generateSquad(rng, cfg, club, db.nat, homeShare, players, teamId, club.players);
      teams[teamId] = {
        id: teamId,
        name: club.name,
        short: club.short,
        leagueId: div.id,
        colors: club.colors,
        reputation: club.rep,
        budget: clubBudget(club.rep),
        playerIds,
        tactic: randomTactic(rng),
        staff: {},
        stadium: club.stadium,
        academyPlayerIds: [],
        assignments: {},
        sponsors: [],
        sponsorOffers: [],
      };
      teamIds.push(teamId);
    });
    leagues[div.id] = { id: div.id, name: div.name, country: db.name, tier: div.tier, playable, teamIds };
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
    const ladder: CountryDatabase["divisions"] = authored.slice(0, want);
    const authoredNames = new Set(authored.flatMap((d) => d.clubs.map((c) => c.name)));
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
  const cup = initCup(playableDivisionIds.flatMap((id) => leagues[id].teamIds));

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
    pendingMatchFixtureId: null,
    lastExportSeason: 1,
    news: [],
    transferNews: [],
  };
  state.academy = initAcademyState(state, cfg);
  seedInitialAcademy(state, cfg);
  // Shirt numbers (v15): every squad in the world is numbered once the rosters
  // are final — best players first, so the stars wear the classic low numbers.
  assignAllKitNumbers(state);
  // Every club-attached player gets an initial individual contract (§10 v5).
  // Academy players stay wage-free until promoted.
  ensureContracts(state, cfg);
  // Seed opening sponsorship offers for the user's empty slots (v6).
  refreshSponsorOffers(state, cfg);
  // Resolve the non-playable leagues once up front so a brand-new save already
  // has plausible tables, form and top-scorer lists for the open summer window —
  // otherwise the other leagues would read as empty until the winter resolution.
  resolveSimLeagues(state, 1, cfg);

  const user = teams[opts.userTeamId];
  state.inbox.push({
    id: "welcome",
    day: state.currentDay,
    season: 1,
    type: "board",
    title: `Welcome to ${user.name}`,
    body: `The board welcomes ${opts.managerName} as the new manager of ${user.name}. Your budget is available now and the summer transfer window is open until 1 September. The season kicks off in mid-August — set your tactics, shape your squad, and build a legacy.`,
    read: false,
  });

  return state;
}

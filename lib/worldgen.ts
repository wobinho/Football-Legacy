// World generator (§12): builds the fictional game world — England's two
// playable divisions plus selected sim-only leagues — into the game schema.
// Deterministic given a seed. A future CSV importer writes the same shapes.

import type { GameState, League, PlayerBio, Pos, Team, Tactic } from "./types";
import { SCHEMA_VERSION } from "./types";
import { TUNING, type TuningConfig } from "./config/tuning";
import { archetypesForPosition, getArchetype } from "./config/archetypes";
import { traitsForPosition } from "./config/traits";
import { overallFromAttrs } from "./config/positions";
import { poolFor, NAME_POOLS, type ClubDef } from "./config/names";
import { defaultCountryDB, type CountryDatabase, type PlayerSeed } from "./database";
import { FORMATIONS } from "./config/formations";
import { mulberry32, deriveSeed, pick, randInt, randNormal, shuffle, type RNG } from "./rng";
import { playerValue } from "./value";
import { buildSeasonSchedule } from "./calendar";
import { generateLeagueFixtures, initCup } from "./season";
import { generateStaffMarket } from "./staff";
import { refreshSponsorOffers } from "./sponsors";
import { initAcademyState, seedInitialAcademy } from "./academy";
import { ensureContracts } from "./contracts";
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

  // Youth overall realism (§5, v9): a young player's *current* overall is pulled
  // toward an age-appropriate SOFT cap — a 17-year-old is usually in the 50s–low
  // 60s, not already an 88. But the cap is soft, not a hard ceiling: a rare
  // seeded "prodigy" roll lets a teenager keep most of a high requested overall,
  // so once in a while a genuine 80-rated 17yo with a 90+ ceiling shows up. Any
  // ability the cap trims isn't lost — it becomes potential headroom below, so
  // even a trimmed kid reads as a high-ceiling prospect who has to grow into it.
  const softCap =
    age >= cfg.youthOverallCapClearAge
      ? 99
      : cfg.youthOverallCapBase + (age - cfg.youthOverallCapStartAge) * cfg.youthOverallCapPerYear;

  // A prodigy keeps most of the ability above the soft cap. The caller may force
  // it (intake/scouting roll the chance themselves, so a high-overall gem isn't
  // gated twice); otherwise generatePlayer rolls the chance itself, which is what
  // lets an elite club's squad occasionally throw up a high-rated teenager.
  const isProdigy = opts.prodigy ?? rng() < cfg.youthProdigyChance;
  let overall: number;
  if (age >= cfg.youthOverallCapClearAge || requested <= softCap) {
    overall = requested; // adult, or already at/under the soft cap — nothing to trim
  } else if (isProdigy) {
    // Prodigy: keep most of the ability that sits above the soft cap. The keep
    // fraction is random within a band, so prodigies vary from "very good for
    // their age" to "generational". This is the rare tail the design wants.
    const keep = cfg.youthProdigyKeepMin + rng() * (cfg.youthProdigyKeepMax - cfg.youthProdigyKeepMin);
    overall = Math.round(softCap + (requested - softCap) * keep);
  } else {
    // Ordinary youth: land around the soft cap with a little upward jitter, never
    // above the requested ability.
    overall = Math.round(Math.min(requested, softCap + rng() * cfg.youthSoftCapOvershoot));
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
    positions,
    archetypeId: archetype.id,
    attrs,
    overall,
    potential,
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
  club: ClubDef,
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
  const starterAvg = 40 + club.rep * 0.5;
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
  return {
    formationId: pick(rng, FORMATIONS).id,
    mentality: pick(rng, ["Defensive", "Balanced", "Balanced", "Attacking"] as const),
    style: pick(rng, ["Possession", "Counter", "Direct"] as const),
  };
}

function clubBudget(rep: number): number {
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
  // fingerprint custom databases so a modded roster yields its own stable world
  if (opts.countryDBs) {
    for (const code of Object.keys(opts.countryDBs).sort()) {
      parts.push(`db:${code}:${JSON.stringify(opts.countryDBs[code]).length}`);
    }
  }
  return hashString(parts.join("|"));
}

/** Build a complete fresh GameState from the chosen country databases. */
export function generateWorld(opts: NewGameOptions): GameState {
  const seed = resolveSeed(opts);
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
  // in one; promotion/relegation swaps between them).
  const playCode = opts.playableCountry;
  const playDb = dbFor(opts, playCode);
  if (!playDb) throw new Error(`Unknown playable country "${playCode}".`);
  for (const div of playDb.divisions) makeDivision(playDb, div, true);

  // View-only countries: sim leagues (shopping / atmosphere).
  for (const code of opts.viewCountries) {
    if (code === playCode) continue;
    const db = dbFor(opts, code);
    if (!db) continue;
    for (const div of db.divisions) makeDivision(db, div, false);
  }

  // The playable country's two division ids [top, second]. If it has only one
  // division, the second mirrors the first (no relegation partner).
  const playDivs = [...playDb.divisions].sort((a, b) => a.tier - b.tier);
  const divisionIds: [string, string] = [playDivs[0].id, (playDivs[1] ?? playDivs[0]).id];

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
  const playableDivisionIds = Array.from(new Set(playDb.divisions.map((d) => d.id)));
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
    staffMarket: generateStaffMarket(deriveSeed(seed, "staff:1")),
    simResults: [],
    academy: null as unknown as AcademyState, // filled below — needs the state object
    recordBook: { seasons: [], biggestWin: null },
    pendingMatchFixtureId: null,
    lastExportSeason: 1,
    news: [],
  };
  state.academy = initAcademyState(state, cfg);
  seedInitialAcademy(state, cfg);
  // Every club-attached player gets an initial individual contract (§10 v5).
  // Academy players stay wage-free until promoted.
  ensureContracts(state, cfg);
  // Seed opening sponsorship offers for the user's empty slots (v6).
  refreshSponsorOffers(state, cfg);

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

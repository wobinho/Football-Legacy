// ── Football Legacy — core schema ─────────────────────────────────────────
// Single source of truth for all game data shapes. Schema-versioned so the
// save/export format doubles as the modding format (GAME_DESIGN.md §2, §13).

export const SCHEMA_VERSION = 49;

// Visual identity (v1.96). Types only — the rules and the defaults live in
// lib/visual/, and nothing in the schema depends on them at runtime.
import type { BadgeSpec } from "./visual/badge";
import type { KitSet } from "./visual/kit";
export type { BadgeSpec, KitSet };

export type Pos = "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "LM" | "RM" | "AM" | "LW" | "RW" | "ST";

/** Preferred foot (v42). Descriptive colour, in the same class as height: it is
 * never read by the match engine, only shown. */
export type Foot = "Left" | "Right";

export type Mentality = "Defensive" | "Balanced" | "Attacking";

/** Playing style (v19: expanded from three to six).
 *
 * The original trio (Possession / Counter / Direct) are the "pure" styles and
 * still form the rock-paper-scissors core of the hidden counter matrix. The
 * three added styles are hybrids that lean on a specific instruction package:
 *
 *   Gegenpress — Counter's aggression turned into sustained high pressing.
 *   ParkTheBus — an extreme Defensive shell that concedes the ball by design.
 *   WingPlay   — Direct football routed through the flanks rather than the middle.
 *
 * Every style is a pure table lookup (archetype synergy, counter matrix, and the
 * v19 styleShape table) — the engine never branches on a style by name. */
export type Style = "Possession" | "Counter" | "Direct" | "Gegenpress" | "ParkTheBus" | "WingPlay";

// Extended tactic instructions (§6, expanded). All presets — no sliders. Every
// axis feeds the engine through the tuning table; the Tactics screen explains
// what each does. Optional so v2 saves migrate with sensible defaults.
export type Tempo = "Slow" | "Standard" | "High";
export type Width = "Narrow" | "Standard" | "Wide";
export type Press = "Low" | "Medium" | "High";
export type DefLine = "Deep" | "Standard" | "High";
/** Attacking focus. "Wide" (v19) emphasises BOTH flanks equally rather than
 * picking a side — the same goal-involvement bias Left/Right give their own
 * flank, applied to left and right together. */
export type Focus = "Left" | "Central" | "Right" | "Wide" | "Mixed";

/**
 * Per-slot role brief (v1.99) — formation slot id → archetype id.
 *
 * What the Tactic Creator authors: the KIND of player the manager wants in each
 * position. Sparse by design — an unbriefed slot is the normal case and costs
 * nothing. Keyed by slot id rather than by position because two centre backs
 * are two different jobs, which is the whole reason the feature exists.
 *
 * See lib/tacticbrief.ts for what a brief is worth; nothing else decides.
 */
export type RoleBrief = Record<string, string>;

export interface Tactic {
  formationId: string;
  mentality: Mentality;
  style: Style;
  tempo?: Tempo;
  width?: Width;
  press?: Press;
  line?: DefLine;
  focus?: Focus;
  /** The Tactic Creator's per-slot role brief (v1.99). Absent on every tactic
   * that never used the Creator, and the engine returns exactly 1 for an absent
   * brief — so an old save computes precisely what it always did. */
  roles?: RoleBrief;
}

/**
 * A named tactic the manager has saved (v1.53).
 *
 * Switching formation clears the starting XI — that is correct (the slots
 * change), but it makes an accidental click expensive: the whole side has to be
 * picked again. A saved tactic is the undo: the instructions, the XI and the
 * bench captured together, restorable in one action.
 *
 * `lineup` and `bench` hold player IDs, which can go stale (sold, retired,
 * loaned out). Loading therefore filters rather than trusts — see
 * `loadSavedTactic` in lib/tactics.ts — so a preset saved three seasons ago
 * still restores whatever part of it is still legal.
 */
export interface SavedTactic {
  id: string;
  name: string;
  tactic: Tactic;
  /** Formation slot id → player id, as the lineup stood when saved. */
  lineup: Record<string, string>;
  /** Ordered substitute list, as it stood when saved. */
  bench: string[];
  /** Season and day it was saved, for display ("saved S3, day 120"). */
  season: number;
  day: number;
}

/**
 * The 35 player attributes (v41).
 *
 * Replaces the six aggregate attributes (pac/sho/pas/dri/def/phy) the schema
 * carried through v40. Every value is 1–99. Overall is derived from these by
 * position — see `overallFromAttrs` in config/positions.ts — so the attributes
 * are the source of truth and the headline rating is a view onto them.
 *
 * The last six are the goalkeeping attributes. They only carry meaning for a
 * keeper: an outfielder holds low values in them and they contribute almost
 * nothing at his position's weighting. Conversely a keeper's outfield stats are
 * real (he can pass, he has stamina) but barely move his rating.
 *
 * Keys, display names and UI grouping live in config/attributes.ts; anything
 * iterating attributes should use its ATTR_KEYS rather than an inline list.
 */
export interface Attributes {
  // Attacking
  crossing: number;
  finishing: number;
  headingAccuracy: number;
  shortPassing: number;
  volleys: number;
  // Skill
  dribbling: number;
  curve: number;
  fkAccuracy: number;
  longPassing: number;
  ballControl: number;
  // Movement
  acceleration: number;
  sprintSpeed: number;
  agility: number;
  reactions: number;
  balance: number;
  // Power
  shotPower: number;
  jumping: number;
  stamina: number;
  strength: number;
  longShots: number;
  // Mentality
  aggression: number;
  interceptions: number;
  positioning: number;
  vision: number;
  penalties: number;
  composure: number;
  // Defending
  markingAwareness: number;
  standingTackle: number;
  slidingTackle: number;
  // Goalkeeping — only meaningful for a GK.
  diving: number;
  handling: number;
  kicking: number;
  gkPositioning: number;
  reflexes: number;
  gkSpeed: number;
}

// Hot data — always loaded, touched constantly by engine + UI (§5).
export interface PlayerBio {
  id: string;
  /** Display name — the short form used everywhere space is tight: squad lists,
   * lineups, tables, the pitch view ("G. Donnarumma"). */
  name: string;
  /** Full given + family name (v27), shown where the player gets the whole row
   * to himself — the profile modal's header ("Gianluigi Donnarumma"). Optional:
   * procedurally generated players already have a full name in `name`, and old
   * saves carry none, so the UI falls back to `name` whenever this is absent or
   * identical. Only the real-world databases author it. */
  fullName?: string;
  age: number;
  nationality: string; // 3-letter code
  /** Height in centimetres (v15). Stored metric — the UI renders feet/inches.
   * Rolled from the archetype's height profile, so a Target Man towers over a
   * Poacher. Purely descriptive: the engine never reads it. */
  heightCm?: number;
  /** Preferred foot (v42). Descriptive only — the engine never reads it, exactly
   * like `heightCm`. Authored by the real-world databases; rolled from the
   * position's real-world left/right split for a generated player. Optional so
   * pre-v42 saves (and seeds that omit it) simply show nothing. */
  foot?: Foot;
  /** Shirt number (v15), 1–99, unique within the club's senior squad. Academy
   * players carry their own numbering. Assigned automatically on joining a club
   * and re-assignable by the user (swapping with the incumbent). */
  kitNumber?: number;
  positions: Pos[]; // first entry = primary
  attrs: Attributes;
  overall: number; // 1-99, drives the sim
  potential: number;
  fitness: number; // 0-100
  form: number; // multiplier, tuning.formMin..formMax
  clubId: string | null; // null = free agent / retired
  value: number; // market value, stored (§10)
  traits: string[]; // 0-3 trait ids
  longevity: number; // hidden 0..1 — aging variance (§5)
  // current-season running stats (compressed into PlayerCareer at rollover)
  stats: SeasonPlayerStats;
  retired?: boolean;
  /** Per-season development log — how overall & potential moved each summer.
   * Powers the Development page's growth history. Newest last. Optional (v2). */
  devLog?: DevLogEntry[];
  /** Overall this player started the current season on (v19). The UI subtracts
   * it from the live `overall` to show the running +X/-X a player has gained or
   * lost this season. Stamped for everyone at the season rollover (and when a
   * player is first created), so it always reflects THIS season only. */
  seasonStartOverall?: number;
  /** Youth Academy (§18, v4). The club whose academy this player came through
   * (joined at ≤18 via intake or a youth signing). Permanent — the Academy DNA
   * ledger and graduate news are built from this. */
  academyClubId?: string;
  /** The prospect tier (Bronze→Legacy) this player came through the academy at
   * (v1.6). Unlike `u21Tier` — which is a live label cleared on promotion — this
   * is a permanent record of the rarity he graduated as, shown as a history tag
   * in the Career section of his profile. Stamped from `u21Tier` when the tier
   * is set, and never cleared. */
  academyTier?: ProspectTier;
  /** Quality tier this player was rolled at as a registered U21 prospect (v18).
   * Set on rival prospects so youth scouting can price and badge them; the elite
   * tiers are what make a kid genuinely hard to buy. */
  u21Tier?: ProspectTier;
  /** The International Scouting Hub this prospect is developing at (v1.95) — a
   * SCOUT_WORLD sub-region id. Present ONLY while he is on the hub's books:
   * placing him at a club, or promoting him into the manager's own academy,
   * clears it. It is a LOCATION, not a badge, which is why it is cleared rather
   * than kept as a record — `academyClubId` is where his origin story lives.
   *
   * A hub prospect has no `clubId`: the network holds him, and no club does. */
  gcnHubRegion?: string;
  /** Current-season U21-league + loan stats. Raw (unweighted); the rollover
   * folds them into development at the §18 minute weights. Optional (v4). */
  youthStats?: SeasonPlayerStats;
  /** Season-long loan away from the owning club (§18, out only). */
  loan?: LoanState;
  /** Individual contract (wages + length + expiry, v5). Present for any player
   * attached to a club; free agents and retirees carry none. Old saves without
   * one are backfilled at migration from the derived wage curve. */
  contract?: Contract;
  /** Development training plan (§5, v8) — a `TrainingPlanId` biasing where this
   * player's seasonal growth flows across the six attributes, plus a small
   * growth-rate nudge. Undefined = the "balanced" default. Only meaningful for
   * the user's players; AI squads grow on the neutral curve. */
  trainingPlan?: string;
  /** Player accolades (v24) — the honours this player has won, newest last. Each
   * is stamped at the season rollover when awards are computed; the profile card
   * renders them and the record book's season review lists that season's winners.
   * Optional (absent = never won anything); survives on retired players so a
   * legend's cabinet is permanent. */
  accolades?: Accolade[];
  /** The season this player joined his CURRENT club through a transfer or free
   * signing (v1.54; extended to every club in v1.89). While it equals the current
   * season the player can't be sold, transfer-listed or bought — a signing can't
   * be flipped inside the same season it was made, and that is now a world rule
   * rather than a rule about the manager's own squad. Re-stamped by
   * `completeTransfer` on every move; cleared only by a release, since a free
   * agent nobody bought has nothing to flip. Absent = not a fresh signing
   * (academy graduate, worldgen squad member, or signed in a past season). */
  acquiredSeason?: number;
  /** Consecutive in-game days this player has gone without meaningful football
   * (v1.66) — either unattached, or attached and playing under
   * `desperationMinutesShare` of his side's available minutes. Drives the
   * desperation curve in lib/consent.ts: the longer it runs, the further down the
   * pyramid he'll drop and the more of his wage floor he'll give up. Reset to 0
   * the moment he plays enough or signs somewhere. Absent = never idle. */
  inactiveDays?: number;
  /** Absolute day this player last became available to the market (v1.66) — put
   * on the transfer list, released, or left to run his contract down. Peer clubs
   * hold exclusive rights to bid for `peerPriorityDays` after it, so a big name
   * isn't hoovered up by a lower division before his own level has looked.
   * Absent = not currently on the market through any of those routes. */
  availableSince?: number;
}

/** A per-league or save-wide season award (v24). Individual honours (Player of
 * the Season, Golden Boot, …) and a Team-of-the-Season place are both modelled
 * here — a `teamOfSeason`/`legacyTeamOfSeason` accolade simply carries the
 * position the player was picked in. Titles/prizes live in tuning-free data
 * (ACCOLADE_META in lib/accolades.ts), so the type carries only the facts. */
export type AccoladeType =
  | "playerOfSeason" // per league — highest average rating
  | "youngPlayerOfSeason" // per league — highest-rated U21
  | "goldenBoot" // per league — most goals
  | "goldenPlaymaker" // per league — most assists
  | "goldenGlove" // per league — highest-rated goalkeeper
  | "goldenWall" // per league — highest-rated centre-back
  | "teamOfSeason" // per league — one of the XI of the season
  | "legacyPlayerOfSeason" // save-wide — highest-rated player across all leagues
  | "legacyTeamOfSeason"; // save-wide — one of the XI across all leagues

export interface Accolade {
  type: AccoladeType;
  season: number;
  /** The league this honour was won in — absent for the two save-wide (legacy)
   * awards, which span every league. */
  leagueId?: string;
  /** Denormalised league name so a retired player's cabinet still reads right
   * even if his old league is renamed or pruned. Absent for legacy awards. */
  leagueName?: string;
  /** The position slot a Team-of-the-Season pick occupied (GK/DEF/MID/ATT),
   * present only on the two team accolades. */
  slot?: "GK" | "DEF" | "MID" | "ATT";
}

/** An individual player contract (v5). Overrides the old aggregate wage bill:
 * the squad wage bill is now the sum of real contract wages. A contract counts
 * down each season; when it hits its expiry season the player must be re-signed
 * or leaves on a free (§10 renewals). */
export interface Contract {
  wage: number; // weekly, in £
  /** Season number this contract runs through (inclusive). Expires at the
   * rollover that ends this season. */
  expirySeason: number;
  signedSeason: number; // season the current deal was agreed
  /** Optional release clause (v21): a fixed fee any club may pay to trigger an
   * automatic sale, bypassing the selling club's ask price. Undefined = none.
   * The player discounts his wage demand for accepting one — a cheaper deal in
   * exchange for a guaranteed exit route. */
  releaseClause?: number;
}

/** A player out on a season loan (§18). The player stays on the owning club's
 * academy/senior roster; the destination never fields them in the real engine —
 * loan minutes are credited statistically into youthStats. */
export interface LoanState {
  toClubId: string;
  startDay: number;
  /** How much a loan minute counts toward development vs a senior minute. */
  minutesWeight: number;
  /** Whether the destination will play him every week or rotate him (v1.52).
   * Set when the loan is agreed, from the rep gap the user saw in the chooser —
   * so the role promised at the point of decision is the role he actually gets.
   * Absent on pre-v1.52 loans, which fall back to rotation. */
  role?: "starter" | "rotation";
}

/** One summer's development outcome for a player (Development page, §5). */
export interface DevLogEntry {
  season: number; // the season that just finished
  age: number; // age going into the new season
  fromOverall: number;
  toOverall: number;
  fromPotential: number;
  toPotential: number;
  phase: "growth" | "prime" | "decline";
}

export interface SeasonPlayerStats {
  apps: number;
  goals: number;
  assists: number;
  ratingSum: number; // avg = ratingSum / apps
  minutes: number;
  /** Clean sheets kept this season (v1.54). Credited to a goalkeeper whose side
   * conceded no goals in a match he appeared in. Optional so old saves and the
   * many `{apps:0,...}` initialisers default it to undefined (read as 0); only
   * keepers ever accumulate it. */
  cleanSheets?: number;
}

// Cold data — append-only, loaded on demand (§5).
export interface CareerRow {
  season: number;
  clubName: string;
  /** The club this season was played for (v1.65), for its badge and country
   * flag. Undefined on rows written before this version — those fall back to a
   * neutral crest built from `clubName`, exactly as transfer rows do. */
  clubId?: string;
  competition: string;
  /** The overall this player carried into the season (v1.63) — his rating on
   * the day it kicked off, not the one he finished on. Read straight off
   * `seasonStartOverall` when the row is written at the rollover, which is
   * before the summer's development re-stamps that baseline. Undefined on rows
   * written before this version; the profile renders those as a dash rather
   * than inventing a number the save never recorded. */
  startOverall?: number;
  apps: number;
  goals: number;
  assists: number;
  avgRating: number;
  awards: string[];
  /** Clean sheets kept in this season/competition (v1.54). Optional — absent on
   * pre-v1.54 rows and on outfield players who never keep one. */
  cleanSheets?: number;
}

export interface TransferRow {
  season: number;
  day: number;
  from: string;
  to: string;
  fee: number;
  /** Club ids for badge rendering (v1.44). Undefined on pre-v1.44 rows and for
   * non-club endpoints (free agency, released, youth football) — the UI falls
   * back to a name-only crest in those cases. */
  fromId?: string;
  toId?: string;
}

export interface PlayerCareer {
  playerId: string;
  seasons: CareerRow[];
  transfers: TransferRow[];
}

// ── Clubs & competitions ──────────────────────────────────────────────────

// ── Facilities & staff (v1.79) ────────────────────────────────────────────
//
// A complete rework. The old model — twelve independent facility LEVELS, each
// with its own hard-coded multiplier, plus eight named staff SLOTS (Head Coach,
// Physio, …) each buffing a different quantity — is gone. It had no single
// place where "what does the club invest in?" was answered, and staff and
// facilities never touched each other.
//
// The new model has exactly one shape, and the two halves are one decision:
//   FACILITIES hold the effects. A facility is unlocked once, then upgraded for
//   staff slots only — an upgrade never changes the base effect.
//   STAFF are the conductors. They carry no effect of their own; they are hired
//   onto the club's roster and ASSIGNED to a facility, where their stars and
//   their badges amplify that facility's effect.
//
// Every facility therefore scales the same three ways, and a new facility is a
// table row (`FACILITY_SPECS`), never new engine code:
//   base   — the effect at level 1 with nobody assigned
//   stars  — +`starEffect` per `STAFF_STARS_PER_STEP` total assigned stars
//   badges — +`badgeEffect` per `badgeTiersPerStep` badge TIERS a staff member
//            holds FOR THIS facility (bronze=1 … legacy=6)
//
// v1.82: a facility may produce SEVERAL quantities (the Youth Academy governs
// squad size, focus slots and prospect value), so a spec carries a list of
// `channels`, each of which runs the three-way scaling above independently.

/** Which facility. The system is built as a table so a new one is a row in
 * `FACILITY_SPECS`, not code — the only thing that lives here is the id.
 *
 * `highPerformanceCenter` (v1.81) is the end-game building: it does not make
 * growth faster the way the ETC does, it makes the ELITE-RESISTANCE BRAKE
 * weaker, which is the only thing standing between a 90 and a 95. The two are
 * deliberately not substitutes — see `eliteResistRelief` in lib/facilities.ts.
 *
 * `youthAcademy` and `scoutingNetwork` (v1.82) are the Academy screen's old
 * Upgrades tab, brought into this system. Those were bought-by-the-level
 * numbers on a tab of their own; now the level buys staff slots and the staff
 * buy the numbers, like every other facility. Both produce more than one
 * quantity, which is why a spec carries `channels` rather than a single
 * base/star/badge triple.
 *
 * `clubIncomeCenter` / `clubExpenseCenter` (v1.93) are the commercial pair —
 * the first facilities whose channels move MONEY rather than players. They are
 * two buildings rather than one net-cash lever on purpose: income scales with
 * how big the club already is (a percentage of a large revenue is a large
 * number) while the expense side is worth most to a club whose wage bill is
 * outrunning it, so the same £100M buys different things at different points in
 * a save.
 *
 * The five `*Development` centers (v1.93) are one facility per archetype CLASS.
 * Each does two distinct things: it speeds up growth for players of its class
 * (an ordinary channel), and at level 5 it unlocks that class's section of the
 * Development → Archetype page, where a player can be converted onto one of
 * that class's archetypes over a couple of seasons. The set is exactly
 * `ARCHETYPE_CLASSES` — see ARCHETYPE_DEV_CLASS in config/facilities.ts, which
 * asserts the two never drift apart. */
export type FacilityId =
  | "eliteTrainingCenter"
  | "highPerformanceCenter"
  | "youthAcademy"
  | "scoutingNetwork"
  | "clubIncomeCenter"
  | "clubExpenseCenter"
  | "engineDevelopment"
  | "creatorDevelopment"
  | "enforcerDevelopment"
  | "maverickDevelopment"
  | "blitzerDevelopment";

/** Badge tiers, best last. A staff member earns the next tier by completing
 * another qualifying run of seasons assigned to the SAME facility — see
 * `BADGE_LADDER` in config/facilities.ts for the season costs. The names match
 * the prospect-tier ladder used by scouting, deliberately: one vocabulary for
 * "how good is this thing" across the game. */
export type BadgeTier = "bronze" | "silver" | "gold" | "diamond" | "obsidian" | "legacy";

/** One badge on a staff member's record: which facility earned it and how far
 * up the ladder it has climbed. `seasons` is the number of completed seasons
 * served at that facility, and is what `tier` is derived from — it keeps
 * counting past `legacy` so the record stays truthful. A staff member holds at
 * most `STAFF_BADGE_SLOTS` (3) of these, one per distinct facility. */
export interface StaffBadge {
  facility: FacilityId;
  /** Completed seasons served at this facility, across all spells. */
  seasons: number;
  /** Derived from `seasons` via `badgeTierFor()`; stored so the UI and the
   * save read the same value without recomputing. */
  tier: BadgeTier;
}

/** A member of the club's backroom. Identity (name, age, nationality) plus the
 * three things that actually matter: what they cost, how good they are, and
 * what they have earned. They have no job title — a staff member is defined by
 * where you assign them, not by a slot they were born into. */
export interface StaffPerson {
  id: string;
  name: string;
  nationality: string; // 3-letter code
  age: number;
  /** 1–5. Total assigned stars drive a facility's star bonus. */
  stars: number;
  /** Weekly wage, paid while employed whether assigned or not. */
  wage: number;
  /** Which facility they currently work at, or absent if unassigned. An
   * unassigned member costs their wage and contributes nothing — assignment is
   * the whole point of employing them. */
  assignedTo?: FacilityId;
  /** Badges earned, max `STAFF_BADGE_SLOTS`. Progress toward the badge for the
   * CURRENT assignment lives here too (a fresh assignment adds a 0-season
   * entry once the first season completes). */
  badges: StaffBadge[];
}

/** A club's state for one facility. Absent from the record = never unlocked. */
export interface FacilityState {
  /** 1–`maxLevel`. Level only ever buys staff slots. */
  level: number;
}

/**
 * One archetype retraining programme in progress (v1.93).
 *
 * The player is being reshaped toward `targetPlanId` — the training plan that
 * IS the target archetype, since the two are 1:1 — over a number of seasons the
 * responsible development center's staff can shorten.
 *
 * Two things about the shape are load-bearing:
 *
 *   - Progress is `seasonsServed`, a COUNT, not a target season. The centre's
 *     staff can change mid-programme, so a stored completion date would be a
 *     promise the simulation might not keep; a count re-reads the current speed
 *     every summer and is honest about it.
 *   - `startOverall` is stored so the reshaping can be checked against where he
 *     began. Conversion preserves overall by construction, but a player also
 *     GROWS during the programme, and the two effects have to be separable or
 *     the UI can't say which of them moved him.
 */
export interface ArchetypeConversion {
  playerId: string;
  /** The training plan (and therefore archetype) he is being retrained onto. */
  targetPlanId: string;
  /** The facility running it — which is to say, the target archetype's class
   * center. Stored rather than re-derived so a programme survives the target
   * archetype being re-classed by a future balance change. */
  facility: FacilityId;
  /** Season the programme began, for the UI's "started in S4". */
  startSeason: number;
  /** His overall when it began — see above. */
  startOverall: number;
  /** Whole seasons completed. The programme finishes when this reaches the
   * requirement `conversionSeasonsRequired` reports for the centre as it stands
   * TODAY, which is why this is a count and not a deadline. */
  seasonsServed: number;
}

/** EA-FC-style on-pitch responsibilities (v6). Each holds a playerId from the
 * senior squad, or is absent. Captain (with the Leader trait) buffs the side;
 * the set-piece takers bias scorer/assist selection on the relevant chances. */
export interface TeamAssignments {
  captainId?: string;
  penaltyTakerId?: string;
  freeKickTakerId?: string;
  cornerTakerId?: string;
}

/** An AI club's season-scale market intent (§10). Recomputed each time a
 * transfer window opens, from league position vs. reputation-implied
 * expectation, finances and squad age. Drives who the club buys, who it sells
 * and what it will pay — see lib/ai/strategy.ts (STANCE_PROFILE). */
export type ClubStance = "title" | "compete" | "stabilise" | "rebuild";

export interface Team {
  id: string;
  name: string;
  short: string; // 3-letter
  leagueId: string;
  colors: [string, string];
  /** An AUTHORED crest (v1.96). Absent — which it is for almost every club in
   * the world — the badge is derived from the club's identity by `badgeFor()`
   * in lib/visual/badge.ts. Read it through that function, never directly:
   * a spec stored on all ~800 clubs would cost every autosave ~64KB to say
   * what a hash of the name already says. Only a club somebody edited stores
   * one. */
  badge?: BadgeSpec;
  /** An AUTHORED kit set (v1.96), same contract as `badge` — derived by
   * `kitsFor()` unless somebody drew one. */
  kits?: KitSet;
  reputation: number; // 1-100, drives gate income + AI valuation attitude
  budget: number;
  playerIds: string[];
  /** Current market stance and the season it was last evaluated in (v13).
   * Optional for old saves — derived on demand by stanceOf(). */
  stance?: ClubStance;
  stanceSeason?: number;
  tactic: Tactic;
  /** Unlocked facilities and their level (v1.79). A missing key means the club
   * has never unlocked that facility. Only the user's club builds these. */
  facilities?: Partial<Record<FacilityId, FacilityState>>;
  /** The backroom roster (v1.79): everyone employed, assigned or not. Replaces
   * the old eight named staff slots. Only the user's club fills this. */
  staffRoster?: StaffPerson[];
  /** The club's scouting department (v14): a roster of hired scouts, each with
   * their own experience/judgement ratings. Replaces the old single `scout`
   * staff slot. Only the user's club fills this. Optional for old saves. */
  scouts?: Scout[];
  stadium: string;
  /** Revenue upgrades (§ club income), v43. Level 0 = base; each level is a
   * one-time purchase. See `INCOME_UPGRADE_SPEC` in lib/economy.ts for the
   * per-level payouts — these fields only ever hold the level.
   *   lowTierIncomeLevel / midTierIncomeLevel / highTierIncomeLevel
   *                        → flat weekly income, three price/yield brackets
   *   playerBonusLevel     → weekly income per squad player at/above a rating
   *   contractAccountingLevel → percentage discount on the weekly wage bill
   *   stadiumBonusLevel    → lump sum banked on every home fixture
   *   performanceBonusLevel → lump sum banked per win/draw/loss
   * All optional (default 0) for old saves. */
  lowTierIncomeLevel?: number;
  midTierIncomeLevel?: number;
  highTierIncomeLevel?: number;
  playerBonusLevel?: number;
  contractAccountingLevel?: number;
  stadiumBonusLevel?: number;
  performanceBonusLevel?: number;
  // v1.82: the seven academy/scouting upgrade levels that used to live here —
  // academyLevel, scoutNetworkLevel, academySquadLevel, focusSlotLevel,
  // scoutSpeedLevel, scoutFilterLevel and youthPrLevel — are gone. Everything
  // they governed is now produced by the `youthAcademy` and `scoutingNetwork`
  // facilities above, so the level lives in `facilities` like every other
  // building's. Schema v47 drops the fields; see migrateV46toV47.
  /** Academy squad (§18, v4): uncapped, ages 15–21, outside the senior cap.
   * `playerIds` stays senior-only so cap/selection/wage logic is untouched.
   * Only the user's club carries a populated academy roster. */
  academyPlayerIds?: string[];
  /** On-pitch responsibilities (v6, captain + set-piece takers). */
  assignments?: TeamAssignments;
  /** Active season-long sponsorship deals (v6). Filled for every club since
   * v1.5: the user signs theirs by accepting offers, AI clubs have theirs
   * resolved automatically at the rollover (same deal shapes, no decision). */
  sponsors?: SponsorDeal[];
  /** Pending sponsorship offers the user can accept (v6). Regenerated when a
   * slot is empty; expire after a while. */
  sponsorOffers?: SponsorOffer[];
  /** Per-slot day before which no new offer will be generated (v11). Set when
   * an offer lapses or is rejected, so a slot the user passed on goes quiet for
   * a while instead of re-offering the next day. Keyed by SponsorSlot. */
  sponsorCooldowns?: Partial<Record<SponsorSlot, number>>;
  /** An AI club's weekly commercial income (v19).
   *
   * Since v1.5 this is *derived*: it's the sum of the club's signed minor deals,
   * recomputed at each rollover when its book is resolved. The old abstract
   * reputation-scaled figure survives only as a floor, for a club whose minors
   * all lapsed in a given season. AI clubs still don't run the interactive
   * offer/slot machinery — they simply take what the market quotes them — so
   * this stays the single number the wage and affordability tests read. */
  commercialIncome?: number;
  /** Lump-sum investment income an AI club banked this season (v19). Since v1.5
   * this is what the club's newly-signed major deals paid up front — the same
   * money on the same terms as the user's majors — falling back to the abstract
   * windfall in a season where it signed none. */
  lastInvestmentWindfall?: number;
  /** Owned by the manager's Global Club Network (v34, GCN). A GCN-owned club
   * keeps running on the sim/AI machinery — the manager oversees it rather than
   * managing it — but the network can move players in/out and a feeder loan to
   * it grants guaranteed minutes. Never set on `userTeamId` (the club the
   * manager plays). Absent on non-network clubs. */
  gcnOwned?: boolean;
  /** The season the network acquired this club (v1.64). Drives the minimum-hold
   * rule — a club can't be sold out of the network until `gcnMinHoldSeasons`
   * seasons after this. Absent on a pre-v1.64 save's owned clubs, which are
   * treated as long-held and free to sell. */
  gcnAcquiredSeason?: number;
  /** Set when the network owns a club in the manager's OWN country (v1.64). Such
   * a club is ring-fenced: no network funding, no player movement to or from the
   * rest of the network, no feeder loans. Owning it is a legacy/financial play
   * only, so it can never be used to strengthen (or weaken) the manager's own
   * domestic competition. */
  gcnRingFenced?: boolean;
}

// ── Sponsors / investments (v6, Club → Income) ────────────────────────────

/** A sponsorship category (v19: widened from five slots to eleven).
 *
 * Slots are no longer a flat list with an artificial "one major at a time" cap.
 * They now mirror how a real club's commercial portfolio is actually shaped:
 * the landmark deals (shirt front, kit manufacturer, stadium naming) are genuine
 * majors that each occupy their own exclusive slot, while the long tail of
 * smaller partnerships (sleeve, training kit, regional partners…) are minors
 * that a club can stack several of at once.
 *
 * Capacity per slot is data — see SPONSOR_SLOTS in lib/sponsors.ts, where each
 * slot declares how many concurrent deals it supports. */
export type SponsorSlot =
  // ── Majors: the landmark, lump-sum deals ──
  | "shirt" // front-of-shirt — the single biggest commercial asset
  | "apparel" // kit manufacturer
  | "stadium" // naming rights
  | "backOfShirt" // back-of-shirt, above the number
  // ── Minors: the steady weekly partnerships ──
  | "sleeve"
  | "shorts"
  | "trainingKit"
  | "boot"
  | "regional" // regional partners — several may run at once
  | "beverage"
  | "automotive";

/** Two investment shapes (v7):
 *  - "major": a one-time lump sum (`upfront`) paid on signing, running for
 *    several seasons; contributes nothing weekly.
 *  - "minor": a weekly income boost (`weeklyAmount`) that runs at most one
 *    season; no upfront payment. */
export type SponsorKind = "major" | "minor";

/** A signed sponsorship. Majors pay `upfront` once on signing; minors pay
 * `weeklyAmount` every economy tick. Both expire at the season they run
 * through (renewed via a fresh offer). */
export interface SponsorDeal {
  id: string;
  slot: SponsorSlot;
  kind: SponsorKind;
  brand: string;
  weeklyAmount: number; // minor deals only (0 for majors)
  upfront: number; // major deals only (0 for minors)
  /** Season this deal runs through (inclusive); expires at that rollover. */
  expirySeason: number;
  signedSeason: number;
  /** Length in seasons, for display. */
  seasons: number;
  /** Set when the deal was signed on the performance-bonus terms (v44): the
   * club took less up front in exchange for a bonus if it finishes at or above
   * `bonusFinishPosition`. Absent on a guaranteed deal and on every deal signed
   * before v44. */
  bonus?: SponsorBonusTerms;
}

/** The performance-bonus half of a contract (v44). Held on both the offer (as
 * the alternative on the table) and on the signed deal (as the outstanding
 * obligation the rollover settles). */
export interface SponsorBonusTerms {
  /** Reduced lump sum paid on signing under this option. */
  upfront: number;
  /** Paid at the season rollover if the target is met. */
  bonusAmount: number;
  /** League position the club must finish at or above. */
  finishPosition: number;
  /** Seasons the bonus can still be earned in — set when signed, decremented as
   * each season is settled, so a 3-year deal has three chances at it. Absent on
   * an offer (it is `seasons` until signed). */
  seasonsRemaining?: number;
}

// ── Dynamic rivalries (v1.94) ─────────────────────────────────────────────

/** Why two clubs became rivals. Stored rather than re-derived: the record book
 * gets compacted and the fixtures that made the case are gone a few seasons
 * later, so the reason has to be captured at the moment it is recognised — the
 * same rule `cupRunnerUp` and `europeanWinners` follow. */
export type RivalryCause = "cupFinal" | "titleRace";

/**
 * One modern rivalry: the manager's club against one other.
 *
 * Always between the USER's club and an AI club — `rivalId` is the other party.
 * A world-wide rivalry graph is a different (and much larger) feature; this one
 * exists to give the manager's own save a narrative, so it is deliberately
 * one-sided in scope even though the football that formed it was not.
 */
export interface Rivalry {
  rivalId: string;
  /** Denormalised so a rivalry still reads right if the club is renamed or the
   * record book is compacted — the same reason award winners store a name. */
  rivalName: string;
  /** Season the rivalry was declared. */
  formedSeason: number;
  cause: RivalryCause;
  /** One line for the inbox and the club card, written when it formed. */
  story: string;
  /** Meetings since the rivalry formed, and how they went for the USER. Kept as
   * a running tally rather than derived from fixtures, because the fixtures of
   * a season five years ago no longer exist to count. */
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Season the two last met. Used to let a rivalry go quiet — see
   * `rivalryDormantSeasons`. */
  lastMetSeason: number;
}

/** A pending offer for an empty sponsor slot. */
export interface SponsorOffer {
  id: string;
  slot: SponsorSlot;
  kind: SponsorKind;
  brand: string;
  weeklyAmount: number; // minor offers only (0 for majors)
  upfront: number; // major offers only (0 for minors)
  seasons: number;
  /** Tier label for flavour ("Global", "National", "Regional"). */
  tier: string;
  day: number;
  expiresDay: number;
  /** The performance-bonus alternative, when the sponsor is offering one (v44).
   * Majors only, and only some of the time — see `sponsorBonusOfferChance`. The
   * guaranteed terms above are always available alongside it, so this widens the
   * decision rather than replacing it. */
  bonus?: SponsorBonusTerms;
}

export interface League {
  id: string;
  name: string;
  country: string;
  tier: number;
  playable: boolean;
  teamIds: string[];
  /** Standing of this division in the world game, 0–10 (v1.72).
   *
   * A property of the league itself, not of the clubs in it: the English top
   * flight is a 10 regardless of who wins it, and a fourth division is a 1.
   * Stamped at worldgen from `config/leaguerep.ts` (country band × tier).
   *
   * Optional so pre-v1.72 saves load; `leagueReputation()` in that module
   * recomputes it for a league that predates the field. */
  reputation?: number;
}

export interface MatchEvent {
  minute: number;
  type: "goal" | "chance" | "save" | "sub" | "kickoff" | "halftime" | "fulltime" | "info";
  teamId?: string;
  text: string;
  scorerId?: string;
  assistId?: string;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  scorers: { playerId: string; teamId: string; minute: number; assistId?: string }[];
  stats: {
    possession: [number, number];
    shots: [number, number];
    onTarget: [number, number];
  };
  ratings: Record<string, number>; // playerId -> match rating
  minutes: Record<string, number>; // playerId -> minutes played
}

/** Compact post-match summary kept on a played fixture (v11) so the Match
 * History tab can show goalscorers and team stats without replaying the match.
 * Deliberately not the full `MatchResult`: the minute-by-minute event log and
 * per-player ratings/minutes are dropped, since a season of fixtures is held in
 * the save and the event log dwarfs everything else in it. Current season only —
 * the rollover clears these along with the fixture list. */
export interface MatchDetail {
  possession: [number, number];
  shots: [number, number];
  onTarget: [number, number];
}

export interface Fixture {
  id: string;
  day: number;
  competition: string; // league id or "CUP"
  round: number;
  homeId: string;
  awayId: string;
  played: boolean;
  homeGoals?: number;
  awayGoals?: number;
  scorers?: { playerId: string; teamId: string; minute: number; assistId?: string }[];
  /** Team stats for the played match (v11). Absent on old saves and on
   * fixtures played before the upgrade — the UI degrades to scorers only. */
  detail?: MatchDetail;
  /** Cup ties that finish level are settled on penalties. */
  shootoutWinnerId?: string;
  /** European group-stage fixtures (v1.51): which of the 8 groups this belongs
   * to. Absent on knockout legs and every non-European fixture. */
  euroGroup?: number;
  /** European knockout legs (v1.51): the `EuroTie` this leg belongs to, so the
   * two legs of an aggregate tie can find each other. */
  euroTieId?: string;
}

export interface TableRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

// Sim-only league synthetic results (§4)
export interface SimTopScorer {
  playerId: string;
  goals: number;
}

/** A synthetic assist line for a sim league (v23). Same shape as the scorer
 * line — the resolver credits assists off the same weighted draw. */
export interface SimTopAssister {
  playerId: string;
  assists: number;
}

export interface SimLeagueResult {
  leagueId: string;
  season: number;
  half: 0 | 1 | 2; // 0 = season start (fresh table), 1 = winter window (~halfway), 2 = after the final round (full)
  table: TableRow[];
  topScorers: SimTopScorer[];
  /** Top assist-makers (v23). Absent on saves resolved before the upgrade — the
   * UI degrades to scorers only. */
  topAssists?: SimTopAssister[];
}

// ── Economy / transfers ───────────────────────────────────────────────────

export interface TransferOffer {
  id: string;
  day: number;
  playerId: string;
  fromClubId: string; // buying club
  toClubId: string; // selling club
  fee: number; // the buyer's current offer on the table
  direction: "incoming" | "outgoing"; // relative to user club
  status: "pending" | "accepted" | "rejected" | "countered" | "withdrawn" | "completed";
  counterFee?: number;
  deadlineDay: number;
  // ── EA-FC-style negotiation state (incoming offers) ──────────────────────
  /** The most the buyer will ever pay for this player. Hidden from the user —
   * the AI accepts a counter at/under this, and edges toward it when it counters
   * back. Seeded at offer creation so a negotiation is deterministic. */
  buyerCeiling?: number;
  /** How many counter rounds the user has spent. The buyer's patience is finite;
   * push too hard and they walk. */
  negotiationRound?: number;
  /** Total patience this buyer brought to THIS negotiation (v19), rolled per
   * deal rather than a global constant. A club desperate for the player, or one
   * with money to burn, will haggle for longer than a lukewarm suitor — so the
   * bar the user sees is genuinely different every time. */
  patienceMax?: number;
  /** Patience remaining, 0..patienceMax. Each counter costs patience, and an
   * unreasonable ask costs far more than a modest one — so how hard you push
   * matters as much as how often. At 0 the buyer walks. */
  patience?: number;
}

/** One completed deal in the world's transfer feed (v22, Transfers → News).
 *
 * Every senior transfer between clubs is logged here as it completes — the
 * user's own business, AI↔AI trades, release-clause triggers and free-agent
 * moves — so the Transfer News tab reads as a live wire of market activity.
 * Distinct from `state.news` (a short flavour ticker that rolls off): this is a
 * structured, filterable ledger the UI renders with crests and fees. Newest
 * first; capped so a long save doesn't accumulate unbounded history. */
export interface TransferNewsItem {
  id: string;
  season: number;
  day: number;
  playerId: string;
  playerName: string; // denormalised — survives even if the player is later pruned
  /** Denormalised player nationality (3-letter code) so the wire can flag him
   * even after the player is pruned from a long save. Absent on saves logged
   * before this field shipped — the UI falls back to the live player if present. */
  playerNat?: string;
  /** Selling club id, or null for a free-agent signing. */
  fromClubId: string | null;
  fromName: string;
  /** Buying club id, or null when a player is released to free agency. */
  toClubId: string | null;
  toName: string;
  fee: number;
  /** How the move came about — colours the row and lets the UI badge it. */
  kind: "transfer" | "free" | "release" | "clause" | "loan";
  /** True when the user's own club was a party to the deal (buyer or seller). */
  involvesUser: boolean;
}

/** Someone available to hire onto the backroom roster (v1.79). Identical to a
 * `StaffPerson` minus the club-side state — candidates carry no assignment, and
 * their badges are what they earned at PREVIOUS clubs (a veteran arriving with
 * a gold badge is worth more than a blank 5-star). */
export interface StaffCandidate {
  id: string;
  name: string;
  nationality: string;
  age: number;
  stars: number;
  /** One-off signing fee, paid from the budget on hire. */
  fee: number;
  wage: number;
  badges: StaffBadge[];
}

// ── Inbox / news ──────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  day: number;
  season: number;
  type: "match" | "transfer" | "window" | "board" | "award" | "news" | "offer" | "academy" | "scout";
  title: string;
  body: string;
  read: boolean;
  offerId?: string;
  /** Links a scout prospect report (§18) so the inbox can deep-link it. */
  reportId?: string;
}

// ── Record book (§13) ─────────────────────────────────────────────────────

/** A single award winner recorded on a season summary (v24). Denormalised so a
 * historical season review always reads right, independent of later world
 * changes (a promoted club, a pruned retiree). `stat` carries the headline
 * number where one applies (goals, assists, avg rating). */
export interface AwardWinner {
  playerId: string;
  name: string;
  teamName: string;
  /** Club id for badge rendering (v1.44). Undefined on pre-v1.44 summaries and
   * for clubless winners — the UI falls back to text-only in those cases. */
  teamId?: string;
  /** Player nationality (3-letter code) for flag rendering (v1.44). Undefined on
   * pre-v1.44 summaries — the UI omits the flag. */
  nationality?: string;
  /** Primary position — lets the record book badge a Team-of-the-Season pick. */
  pos?: Pos;
  /** Headline number for the award (goals / assists / avg rating), if any. */
  stat?: number;
}

/** The full set of honours decided in one season (v24), stored on the summary so
 * the record book's season review can show them without re-deriving from a world
 * that has since moved on. Per-league awards are keyed by league id; the two
 * `legacy*` awards are save-wide. */
export interface SeasonAccolades {
  /** Per-league individual honours, keyed by league id. */
  byLeague: Record<
    string,
    {
      playerOfSeason?: AwardWinner;
      youngPlayerOfSeason?: AwardWinner;
      goldenBoot?: AwardWinner;
      goldenPlaymaker?: AwardWinner;
      goldenGlove?: AwardWinner;
      /** Golden Wall (v1.54) — the highest-rated centre-back in the league. */
      goldenWall?: AwardWinner;
      /** The XI of the season, in pick order (GK → DEF → MID → ATT). */
      teamOfSeason?: AwardWinner[];
    }
  >;
  /** Save-wide Legacy Player of the Year — best rating across every league. */
  legacyPlayerOfSeason?: AwardWinner;
  /** Save-wide Legacy Team of the Year — best XI across every league. */
  legacyTeamOfSeason?: AwardWinner[];
}

export interface SeasonSummary {
  season: number;
  yearLabel: string; // e.g. "2025/26"
  championsByLeague: Record<string, { teamId: string; teamName: string }>;
  cupWinner: { teamId: string; teamName: string } | null;
  /** Who LOST the domestic cup final (v1.91). Same reason as the European
   * runners-up below: the bracket is rebuilt at the rollover, so the beaten
   * finalist is unrecoverable a moment later. Absent on older summaries, and
   * null in a season whose final was a bye rather than a tie. */
  cupRunnerUp?: { teamId: string; teamName: string } | null;
  /** Who won each European competition this season (v1.67), best cup first.
   * Recorded on the summary because the European state is rebuilt for the new
   * season during the same rollover — after that the winner is unrecoverable, so
   * a review that didn't capture it here could only ever show a dash. Absent on
   * summaries written before v1.67, and empty in a season with no European
   * football (season 1, or a save that runs no continental layer). */
  europeanWinners?: {
    tier: number;
    cupName: string;
    teamId: string;
    teamName: string;
    /** The beaten finalist (v1.91) — read off the cup's own final tie, which the
     * rollover discards a few steps later. Absent on pre-v1.91 summaries. */
    runnerUpId?: string;
    runnerUpName?: string;
  }[];
  finalTables: Record<string, TableRow[]>;
  topScorers: Record<string, { playerId: string; name: string; teamName: string; goals: number }>;
  playerOfSeason: { playerId: string; name: string; teamName: string } | null;
  youngPlayerOfSeason: { playerId: string; name: string; teamName: string } | null;
  /** Full per-league + save-wide honours for the season (v24). Optional — old
   * summaries predate it and the review degrades to the two legacy fields above. */
  accolades?: SeasonAccolades;
  userTeamId: string;
  userFinish: string; // e.g. "3rd in Premier Division"
  /** The same finish as a bare league position, 1-based; 0 when the user's club
   * has no final table (a sim league, or a season with no fixtures). Added in
   * v44 so the sponsor performance bonuses can be settled against the finish
   * without re-deriving the table. Absent on pre-v44 saves. */
  userPosition?: number;
  notableTransfers: {
    playerName: string;
    from: string;
    to: string;
    fee: number;
    /** Player nationality (3-letter code) for the flag (v1.44). */
    nationality?: string;
    /** Club ids of the two endpoints, for badge rendering (v1.44). Undefined for
     * non-club endpoints (free agency, released) or on pre-v1.44 summaries. */
    fromId?: string;
    toId?: string;
  }[];
  promoted: string[];
  relegated: string[];
  /** Club ids for the promoted/relegated sides, parallel to the name arrays above
   * (v1.44) — lets the review badge each move. Undefined on pre-v1.44 summaries. */
  promotedIds?: string[];
  relegatedIds?: string[];
  /** League ids each moving club left / landed in (v1.5), parallel to the name
   * arrays — lets the review group promotion and relegation per division instead
   * of one flat list. Undefined on summaries written before v1.5, which fall
   * back to the ungrouped rendering. */
  promotedFrom?: string[];
  promotedTo?: string[];
  relegatedFrom?: string[];
  relegatedTo?: string[];
}

export interface RecordBook {
  seasons: SeasonSummary[];
  /** The USER CLUB's biggest win only — never an AI-vs-AI scoreline.
   *  `goalsFor` breaks ties between equal margins (7–1 beats 5–0). */
  biggestWin: { season: number; text: string; margin: number; goalsFor?: number } | null;
}

// ── Season schedule (calendar anchors, §3) ────────────────────────────────

export interface SeasonSchedule {
  seasonStartDay: number; // Jul 1
  /** Consecutive Saturdays from mid-August, as many as the LONGEST playable
   * division needs (v1.91): every league takes the first 2×(n−1) of them, so a
   * 20-club tier plays 38 and a 24-club one 46 off the same calendar. */
  leagueRoundDays: number[];
  cupRoundDays: number[]; // 6 rounds
  summerCloseDay: number; // Sep 1
  winterOpenDay: number; // Jan 1
  winterCloseDay: number; // Feb 1
  simResolveDay1: number; // just before winter window
  simResolveDay2: number; // just before season end
  /** Season awards day (v1.44): the day after the final game (cup final), in the
   * dead week before the rollover — no fixtures remain, so the individual honours
   * and Teams of the Season are handed out here rather than only at END SEASON.
   * Optional so pre-v1.44 saves fall back to awarding at the rollover. */
  accoladesDay?: number;
  /** Contract resolution day (v1.51): the day after the awards, still inside the
   * dead week. Every expiring deal on the user's books is put to them here — renew
   * or let him walk — so nobody leaves on a free without the manager having had
   * the choice. Optional so pre-v1.51 saves keep the silent-release rollover. */
  contractResolveDay?: number;
  seasonEndDay: number; // review + rollover
  /** Dead since v1.89 — the annual youth intake was removed, so no schedule
   * books this day and nothing reads it. Kept on the type only so a save
   * written before v1.89 still parses. */
  intakeDay?: number;
  /** European matchdays (v1.51): 6 group days (Sept–Dec) then 7 knockout days
   * (two legs each of R16/QF/SF, then the final) — 13 midweek dates, all shared
   * by the three cups and kept clear of the domestic cup. Optional so pre-v1.51
   * saves simply run no European football. */
  euroRoundDays?: number[];
}

export interface CupState {
  // teamIds still alive; populated round by round
  aliveTeamIds: string[];
  currentRound: number; // index into schedule.cupRoundDays
  winnerId: string | null;
  roundNames: string[];
}

// ── European Cups (v1.51) ─────────────────────────────────────────────────
// Three continental competitions running alongside the domestic season, in the
// classic pre-2024 format: 32 teams → 8 groups of 4 (double round-robin) → the
// top 2 of each group into a two-leg R16/QF/SF → a single-match final.
//
// All three cups share the same midweek matchdays (as the real ones do), so a
// club is only ever in one of them and the user only ever has one European
// fixture on a given date. Qualification comes from the PREVIOUS season's final
// league positions, which is why the competitions begin in season 2.

/** Which continental competition. 1 = Champions League, 2 = Europa League,
 * 3 = Conference League — the index into `europeanCupPrizeByTier` too. */
export type EuroCupTier = 1 | 2 | 3;

/** How far a club got, for the prize table and the record book. */
export type EuroStage = "groupStage" | "roundOf16" | "quarterFinal" | "semiFinal" | "runnerUp" | "champion";

/** One club's line in a European group table. Mirrors `TableRow` so the same
 * table-rendering code can display it. */
export interface EuroGroupRow extends TableRow {
  groupIndex: number;
}

/** A two-legged knockout tie. `legs` holds the fixture ids in order; the winner
 * is decided on aggregate, and a level aggregate goes straight to penalties
 * (there is deliberately no away-goals rule). The final is a single leg. */
export interface EuroTie {
  id: string;
  round: number; // 0 = R16, 1 = QF, 2 = SF, 3 = Final
  /** The two clubs. For a two-leg tie, `teamA` hosts the FIRST leg. */
  teamAId: string;
  teamBId: string;
  legFixtureIds: string[];
  winnerId: string | null;
  /** Aggregate once both legs are played, for display. */
  aggA?: number;
  aggB?: number;
  /** Set when a level aggregate was settled on penalties. */
  shootoutWinnerId?: string;
}

/** Everything about one of the three cups for the current season. */
export interface EuroCupState {
  tier: EuroCupTier;
  name: string;
  /** Accent colour for the UI, per the locked spec. */
  color: string;
  /** The 32 qualified clubs, in seeded order. */
  teamIds: string[];
  /** 8 groups of 4 — indices into nothing; these are team ids. */
  groups: string[][];
  /** Live group tables, rebuilt from played fixtures. */
  groupRows: EuroGroupRow[];
  /** Knockout ties, appended round by round. */
  ties: EuroTie[];
  /** How far the competition has got: 0–5 group matchdays, then knockout rounds. */
  currentRound: number;
  winnerId: string | null;
  /** Stage each club bowed out at, for prizes at the rollover. */
  exitStage: Record<string, EuroStage>;
  /** Set once the winner has been announced, so the news/inbox item fires
   * exactly once however many times the settle pass runs. */
  announced?: boolean;
}

/**
 * Which cup a given finishing position in a country's top flight qualifies for
 * (v1.65). Index 0 is the champion, index 1 the runner-up, and so on down the
 * table; the value is the cup tier that position enters, or 0 for "no European
 * football". An array shorter than the division simply means every position
 * past its end qualifies for nothing.
 *
 * This replaces the old count-per-tier shape, which could only ever express
 * "the top N go to the Champions League, the next M to the Europa League" in
 * that fixed order. Per-position mapping lets a save say (as the real
 * competitions do) that 1st–4th go to the Champions League, 5th–6th to the
 * Europa League and 7th to the Conference League — or any other arrangement the
 * user builds at setup, including gaps.
 */
export type EuroSlotMap = number[];

/** The whole European layer for the current season. Absent entirely when the
 * save didn't enable it (or has fewer than the required European countries). */
export interface EuropeanState {
  /** How many tiers this save runs (1–3). */
  tiers: number;
  /** The cups actually in progress this season. Empty in season 1, since
   * qualification reads the previous season's final tables. */
  cups: EuroCupState[];
  /** Per-nation qualification map, keyed by country code: which cup each
   * finishing position enters. See `EuroSlotMap`. */
  slots: Record<string, EuroSlotMap>;
  /** Whether the domestic cup winner takes a Europa League place (v1.65) —
   * user-configurable at setup. Defaults to true. */
  cupWinnerQualifies?: boolean;
}

// ── Youth Academy (§18, v4) ───────────────────────────────────────────────

/** A scout's position brief: a broad group, or (v17) one specific position.
 *
 * Groups alone could not express "find me a right back" — DEF rolled uniformly
 * across CB/LB/RB, so the flank you actually wanted was a one-in-three chance
 * and RB/RW were effectively unrequestable. Every `Pos` is now a valid brief,
 * and lib/academy's POS_GROUPS maps each one to the positions it may return. */
export type ScoutPosGroup = "GK" | "DEF" | "MID" | "ATT" | "ANY" | Pos;

/** A scouting target (v17): a country (by 3-letter nationality code), a
 * sub-region ("EastAsia"), a continent ("Europe"), or "World".
 *
 * This was a closed union of ten country names through v16, which capped
 * scouting at the countries the engine simulates. The targets are now derived
 * from the SCOUT_WORLD tree in lib/config/scouting.ts, so the id is an open
 * string and that tree is the single source of truth for what's scoutable.
 * Unknown ids resolve to Worldwide rather than throwing. */
export type ScoutRegion = string;

/**
 * How far from home a scouting brief sends someone (v1.85) — the axis trip costs
 * are priced on.
 *
 * Measured against the country the manager MANAGES in (`state.playableCountry`),
 * walking the same SCOUT_WORLD tree the targets themselves come from:
 *
 *   home      — the manager's own country
 *   region    — a different country in the same sub-region (England → Scotland)
 *   continent — same continent, different sub-region (England → Spain)
 *   overseas  — a different continent entirely
 *
 * A broad target (a whole continent, or Worldwide) is priced at the DEAREST band
 * it can reach, since that is where the scout may end up. See
 * `scoutTravelBandFor` in lib/scouts.ts — nothing outside that function decides a
 * band, so the tree stays the single source of truth.
 */
export type ScoutTravelBand = "home" | "region" | "continent" | "overseas";

/** A scout on the club's books (v14). Scouts are no longer a single staff slot
 * with one star rating — the club employs a roster of them, and each carries two
 * independent 1–5★ ratings:
 *
 *   experience → how many prospects come back in one report (1–6). Higher stars
 *                shift the distribution toward the bigger returns.
 *   judgement  → the QUALITY of what comes back: which prospect tier (Bronze →
 *                Legacy) a find lands in, and how tight the potential read is.
 *
 * How many scouts may be employed at once is the Max Scouts facility cap, and
 * the number employed is in turn the ceiling on concurrent assignments. */
export interface Scout {
  id: string;
  name: string;
  nationality: string; // 3-letter code
  experience: number; // 1-5
  judgement: number; // 1-5
  wage: number; // weekly
}

/** A scout candidate on the hiring market (v14). Same shape as a hired Scout
 * plus the one-time signing fee and the dismiss-to-refresh arrival day. */
export interface ScoutCandidate extends Scout {
  fee: number;
  /** Set while a refreshed shortlist is still in transit. */
  availableDay?: number;
}

/** Prospect quality tiers (v14; diamond added v17; the six-rung ladder v1.53). A
 * scout's judgement rolls one of these per find; the tier fixes the band the
 * prospect's overall and potential land in.
 *
 * The ladder runs Bronze → Silver → Gold → Diamond → Obsidian → Legacy. Bronze
 * and Silver are the everyday academy intake, Gold the genuinely promising kid,
 * and Diamond the wonderkid a good scout turns up a couple of times a season.
 * OBSIDIAN and LEGACY are the rarities: even a 5★ judge finds an obsidian about
 * once in seventy reports and a legacy about once in a hundred and thirty, so
 * most saves never see the top rung. Bands live in tuning (prospectTierBands).
 *
 * `platinum` is the pre-v1.53 name for what is now `diamond`; it is kept in the
 * union so old saves parse, and `migrateProspectTier` (lib/scouts.ts) folds it
 * onto diamond on load. Nothing new is ever written with it. */
export type ProspectTier =
  | "bronze"
  | "silver"
  | "gold"
  | "diamond"
  | "obsidian"
  | "legacy"
  /** @deprecated pre-v1.53 alias for `diamond` — migrated away on load. */
  | "platinum";

/** One scout out on assignment (v5). Each scout the club can field (capacity
 * grows with the Scouting Network facility) may be pointed at a country and a
 * position focus independently — several may share a country. `nextReportDay`
 * is per-assignment so busy departments surface reports steadily. */
export interface ScoutAssignment {
  id: string;
  /** Which employed scout is out on this brief (v14). Their experience drives
   * the batch size and their judgement the prospect tier. Optional only for
   * saves migrated from before the scout roster existed. */
  scoutId?: string;
  region: ScoutRegion;
  positions: ScoutPosGroup;
  /** Archetype focus (v7): the player *types* the scout is briefed to look for.
   * Empty/undefined = no preference (any archetype in the position group). When
   * set, reports are drawn only from these archetype ids. Locked in when the
   * scout is sent — part of the brief, like region and position. */
  archetypes?: string[];
  nextReportDay: number;
  /** How many batches this scout has filed (v12). Stamped onto each report so a
   * scout's finds stay distinguishable as they pile up. */
  reportsFiled?: number;
  /** Day the assignment automatically ends (v25). The user picks a duration in
   * months when sending the scout; once `currentDay` passes this, the scout
   * files no more reports and comes home on the next tick. Absent = open-ended
   * (legacy saves, or a brief sent before durations existed). */
  endsDay?: number;
  /** The duration the user chose, in months (v25). Stored for display so the
   * assignment card can show "3 months" rather than only a raw end day. */
  durationMonths?: number;
  /** The travel band this brief was priced at (v1.85), stamped at send time.
   * Stored rather than re-derived because the manager may change clubs — and
   * therefore countries — mid-trip, and a scout already in the air was booked at
   * the old price. Absent on pre-v1.85 saves, which ran their trips for free. */
  travelBand?: ScoutTravelBand;
  /** Weekly retainer still owed on an OPEN-ENDED brief (v1.85). A fixed-duration
   * trip pays its whole retainer upfront and leaves this unset; an open-ended one
   * is billed this much each week until the scout is recalled. */
  weeklyCost?: number;
  /** Auto-filter on what the scout is allowed to file (v1.67). A find that fails
   * any set clause is discarded rather than reported, so the board only ever
   * holds prospects worth the manager's attention. Absent = file everything,
   * which is what every brief sent before this feature did. */
  filter?: ScoutFilter;
  /** How many consecutive report cycles filed nothing (v1.67). Reset the moment a
   * find gets through, so the assignment card can warn that a filter is choking
   * the pipeline without the UI having to remember history itself. */
  emptyReports?: number;
}

/** The auto-filter clauses on a scouting brief (v1.67). Every field is optional
 * and an unset field is simply not tested — a filter with nothing set behaves
 * exactly like no filter at all.
 *
 * A narrow filter costs report volume, not scout time: the scout keeps its normal
 * cadence and batch size, but a batch only contains the finds that matched, so a
 * legacy-only brief may file nothing for weeks. That is the trade the manager is
 * choosing, and it's why the UI shows the expected yield. */
export interface ScoutFilter {
  /** Inclusive age bounds on the prospect. */
  minAge?: number;
  maxAge?: number;
  /** Inclusive bounds on current ability. */
  minOverall?: number;
  maxOverall?: number;
  /** Rarity tiers the brief will accept. Empty/undefined = every tier. Stored
   * post-migration (never `platinum`), and compared through
   * `migrateProspectTier` so an old saved brief still matches. */
  tiers?: ProspectTier[];
}

/** A youth prospect surfaced by the scout (§18). The player object is embedded
 * here — it only enters `state.players` if signed, so passed reports leave no
 * residue in the world. */
export interface ProspectReport {
  id: string;
  player: PlayerBio;
  fee: number;
  /** Legacy scout flavour line (v18 removed it from the report card). Kept
   * optional so pre-v18 saves still parse; nothing reads it. */
  note?: string;
  day: number;
  expiresDay: number;
  /** Which region the scout found them in (v5, for display). */
  region?: ScoutRegion;
  /** Which scout assignment surfaced the report (v5). */
  assignmentId?: string;
  /** 1-based index of the batch this prospect arrived in (v12). Reports from a
   * scout accumulate — batch 1 stays on the board while batch 2 lands — so the
   * UI groups by batch to show which trip turned up whom. */
  batch?: number;
  /** Quality tier this find was rolled into (v14), from the scouting scout's
   * judgement. Display-only — the bands are already baked into the player. */
  tier?: ProspectTier;
  /** Which employed scout filed this report (v14, for display). */
  scoutId?: string;
}

/** How a club treats offers for its own registered prospects (v18). The stance
 * is rolled per club per competition and drives the asking price youth scouting
 * has to beat — see `lib/config/tuning.ts` u21SellStance*. */
export type U21SellStance = "willing" | "premium" | "unwilling";

/** One U21 opponent: a strength number wearing a parent club's name, plus the
 * seven prospects it registered for the competition (v18).
 *
 * The §4 sim-league performance rule still holds for the world at large — this
 * is a bounded exception: only the 11 sides in the user's own U21 league carry
 * rosters, and only the 7 registered names each, because youth scouting needs
 * something real to look at. Their prospects are stored in `state.players` like
 * anyone else so the profile screen, valuation and transfer code all just work. */
export interface U21Opponent {
  name: string;
  short: string;
  strength: number;
  /** Parent club id — the side is that club's U21 team. */
  clubId?: string;
  /** The 7 prospects registered for this competition (ids into state.players). */
  prospectIds?: string[];
  /** This club's stance on selling its registered prospects, rolled per competition. */
  sellStance?: U21SellStance;
}

export interface U21TableRow {
  name: string; // "user" row carries the club's U21 name
  isUser: boolean;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

export interface U21Result {
  day: number;
  opponent: string;
  home: boolean;
  gf: number;
  ga: number;
  /** User scorers only — names for the report line. */
  scorers: string[];
}

/** One running of the U21 league (§18 v18): 12 teams, double round-robin over 22
 * rounds, resolved statistically with zero interaction. Two of these run per
 * season — the first kicking off a month after the senior season, the second
 * once the first has finished — each with its own registration window. */
export interface U21Season {
  /** Which running this is within the season: 0 = first, 1 = second (v18). */
  half?: number;
  opponents: U21Opponent[]; // 11 sides; the user U21s are team 0
  matchDays: number[]; // 22 midweek days
  roundsPlayed: number;
  table: U21TableRow[];
  results: U21Result[]; // user matches only
  /** Last day the user may register a side. Registration closes the day before
   * the first round; miss it and the entry is forfeited (v18). */
  registrationDay?: number;
  /** The 7 academy players the user registered for this competition. Empty until
   * they submit; the U21 side is drawn only from these once set (v18). */
  registered?: string[];
  /** Set when the user failed to register in time and a randomly drawn side took
   * their place for this running. The league plays on; the user sits it out. */
  forfeited?: boolean;
  /** Name of the side that replaced the user after a forfeit, for the table. */
  replacedBy?: string;
}

export interface AcademyState {
  /** Focus prospects (≤3): guaranteed U21 starts + youth-coach attention. */
  focusIds: string[];
  /** Players tagged into the U21 matchday squad (like a lineup, no tactics). When
   * non-empty, only tagged academy players are fielded in the U21 league; empty
   * falls back to auto-selection (focus first, then best available). */
  u21Squad?: string[];
  /** Players (≤21) listed for a season loan; AI uptake during windows. */
  loanList: string[];
  /** Legacy single-scout focus (v4). Kept for save migration only — the live
   * system is the `assignments` list below. */
  scoutFocus?: { positions: ScoutPosGroup; region: ScoutRegion } | null;
  /** Active scout assignments (v5). Length is capped by the scout-network
   * capacity (base staff scouts + Scouting Network facility level). */
  assignments: ScoutAssignment[];
  reports: ProspectReport[];
  /** Legacy global cadence (v4); the live cadence is per-assignment. */
  nextReportDay: number;
  /** The competition currently running (or the next one due). */
  u21: U21Season;
  /** The season's second U21 competition, built at rollover alongside the first
   * and swapped into `u21` when the first finishes (v18). */
  u21Next?: U21Season;
  /** Finished U21 competitions from this season, oldest first — kept so the
   * first half's final table survives the swap (v18). */
  u21History?: U21Season[];
  lastIntake: { season: number; playerIds: string[]; golden: boolean } | null;
}

// ── Root game state ───────────────────────────────────────────────────────

export type ScreenId =
  | "home"
  | "squad"
  | "tactics"
  | "matchday"
  | "competition"
  | "transfers"
  | "club"
  | "achievements"
  | "gcn"
  | "development"
  /** Facilities & Staff (v1.72): the club's physical plant and its backroom,
   * sitting between Club and Achievements in the nav. */
  | "facilities"
  | "academy"
  | "player";

// ── Manager progress: user accolades & achievements (§ Achievements, v1.45) ──

/** Passively-recorded career milestones for the manager (v1.45). Every field is
 * a running tally or high-water mark maintained as the save plays out — the
 * Achievements page reads them directly. Separate from the record book (which is
 * a per-season museum) and from player accolades (which live on the players):
 * these are the MANAGER's own numbers, spanning the whole save.
 *
 * All optional-with-defaults so the whole block can be backfilled at migration
 * and grown later without another schema bump. */
export interface UserAccolades {
  /** Seasons the manager has fully completed (incremented at each rollover). */
  seasonsPlayed: number;
  /** League titles won with the user's club, by division tier reached (any). */
  leagueTitles: number;
  /** Domestic cups won by the user's club. */
  cupsWon: number;
  /** Promotions earned. */
  promotions: number;
  /** Career total matches played by the user's club (all competitions). */
  matchesPlayed: number;
  matchesWon: number;
  matchesDrawn: number;
  matchesLost: number;
  /** Career goals for / against across the user's matches. */
  goalsFor: number;
  goalsAgainst: number;
  /** Most players rated 90+ overall the user's squad has held at once. */
  peak90Overalls: number;
  /** Most players rated 85+ overall the user's squad has held at once. */
  peak85Overalls: number;
  /** Highest club budget ever reached (high-water mark). */
  peakBudget: number;
  /** Highest single transfer fee the user's club has ever paid for a signing. */
  biggestSigningFee: number;
  /** Highest fee the user's club has ever received for a sale. */
  biggestSaleFee: number;
  /** Total spent on incoming transfers across the save. */
  totalSpent: number;
  /** Total received from outgoing transfers across the save. */
  totalReceived: number;
  /** Individual player honours won by players AT the user's club (Player of the
   * Season, Golden Boot, etc.) — a running count of silverware in the cabinet. */
  playerAwards: number;
  /** Clubs bought into the Global Club Network across the save (v1.64). */
  gcnClubsBought: number;
  /** Clubs founded from scratch for the network. */
  gcnClubsFounded: number;
  /** The highest buy price the network has ever paid for a club. */
  gcnBiggestClubPurchase: number;
  /** Highest GCN treasury balance ever reached (high-water mark). */
  gcnPeakTreasury: number;
  /** Feeder loans sent to network-owned clubs across the save. */
  gcnFeederLoans: number;
  /** International Scouting Hubs established across the save (v1.95). Optional
   * with a 0 default so an existing progress block backfills without a
   * migration — every accolade in this block is a running tally, and a tally
   * that has never been incremented is legitimately zero. */
  gcnHubsBuilt?: number;
  /** Prospects signed onto a hub's books across the save (v1.95). */
  gcnHubProspects?: number;

  // ── v2.0 tallies ─────────────────────────────────────────────────────────
  //
  // All optional with a 0 default, for the reason stated above: a running tally
  // that has never been incremented is legitimately zero, so a save gains these
  // without a schema bump or a migration.

  /** European cups won, split by the cup's own tier (1 = Champions League,
   * 2 = Europa League, 3 = Conference League). Kept as three tallies rather
   * than one because the three are three different achievements — winning the
   * Conference League is not a Champions League title with a smaller number. */
  europeanCups?: Record<number, number>;
  /** Highest club overall (`squadOverall().overall`) ever reached — the XI
   * weighted against its bench, the v1.90 rule, never a squad mean. */
  peakClubOverall?: number;
  /** Highest starting-XI overall ever reached. */
  peakStartingOverall?: number;
  /** Highest overall reached by the picked XI's best player in each position
   * group. Keyed by `PosGroup`, so a back four's figure is the mean of the
   * defenders actually named in the shape the club plays. */
  peakGroupOverall?: Record<string, number>;
  /** Highest overall any single player at the user's club has ever reached. */
  peakPlayerOverall?: number;
  /** Individual honours won by the single most-decorated player to have played
   * for the user's club — a high-water mark over players, not a club total. */
  peakPlayerHonours?: number;
  /** Ballon-d'Or-equivalents: Legacy Player of the Year awards won by the
   * user's players (the save's single best season, so far rarer than the
   * per-league honours `playerAwards` counts). */
  legacyPlayerAwards?: number;
  /** Players bought and sold across the save. Counted rather than valued: a
   * career of business is a different achievement from a single record fee,
   * which `biggestSigningFee` already covers. */
  playersBought?: number;
  playersSold?: number;
  /** Highest total squad value ever reached (high-water mark). */
  peakSquadValue?: number;
  /** Owned network clubs held at once (high-water mark). Distinct from
   * `gcnClubsBought` + `gcnClubsFounded`, which are lifetime tallies and do not
   * fall when a holding is sold. */
  gcnPeakClubsOwned?: number;
  /** Global Executive seats filled at once (high-water mark, 0–3). */
  gcnPeakExecsSeated?: number;
  /** WHO the record signing / sale was (v1.7). The fees above are the numbers;
   * these carry the player behind them so the cabinet can put a name and a face
   * to the record instead of a bare figure. Snapshotted at the moment of the
   * deal — the player may later be sold on, re-rated or pruned from a long save,
   * and the record must survive all three, so nothing here is re-derived from
   * live state. Absent until the club's first paid deal of that direction. */
  recordSigning?: TransferRecord;
  recordSale?: TransferRecord;
}

/** A snapshot of the player behind a record transfer (v1.7). `playerId` is a
 * convenience for deep-linking to a profile and may dangle once a long save
 * prunes him — every field needed to RENDER the record is copied here. */
export interface TransferRecord {
  playerId: string;
  name: string;
  overall: number;
  pos: Pos;
  nationality: string;
  fee: number;
  /** The season the deal was done, for the "S4" stamp on the card. */
  season: number;
}

/** An earned achievement (v1.45): the id of an ACHIEVEMENT_DEFS entry, plus the
 * season it was unlocked in. Unlock-once and permanent for the save. */
export interface EarnedAchievement {
  id: string;
  season: number;
}

/** Manager progress block (v1.45): the passively-tracked accolades plus the set
 * of one-off achievements already earned. Optional on GameState so old saves
 * migrate in with a fresh, zeroed block. */
export interface UserProgress {
  accolades: UserAccolades;
  /** Earned achievements, keyed by achievement id (so a check is O(1) and an
   * unlock can't be double-recorded). */
  earned: Record<string, EarnedAchievement>;
}

export interface GameState {
  schemaVersion: number;
  saveName: string;
  seed: number;
  managerName: string;
  userTeamId: string;
  /** The country the user manages in (3-letter code, v7). Its two divisions are
   * the real-engine playable leagues; all other countries run as sims. */
  playableCountry: string;
  /** The playable country's division ladder, ordered top-first (v12). Length is
   * 1–3: the user picks the depth at new-game setup. Every id here runs the real
   * engine, and promotion/relegation runs between each adjacent pair, so a club
   * can climb or fall the whole ladder over a long save.
   *
   * Was a fixed `[top, second]` pair through v11; migration widens it in place,
   * so index 0 is still the top flight and `divisionIds[1]` still reads as the
   * second tier wherever that was assumed. */
  divisionIds: string[];
  /** How many divisions each included country runs (v17), keyed by country code
   * — e.g. `{ ENG: 2, GER: 3, FRA: 1 }`. The user sets this per country at
   * setup, so a save can run a deep English pyramid alongside a single-division
   * France. The playable country's entry always matches `divisionIds.length`;
   * view-only countries use theirs purely to size their generated ladder. */
  divisionDepths?: Record<string, number>;
  season: number; // 1-based
  currentDay: number; // days since Jul 1 2025
  players: Record<string, PlayerBio>;
  careers: Record<string, PlayerCareer>;
  teams: Record<string, Team>;
  leagues: Record<string, League>;
  fixtures: Fixture[]; // current season, playable competitions
  cup: CupState;
  /** European competitions (v1.51). Absent when the save didn't enable them.
   * `cups` is empty during season 1 — qualification reads the previous season's
   * final tables, so the first European campaign is season 2. */
  european?: EuropeanState;
  schedule: SeasonSchedule;
  lineup: Record<string, string>; // formation slot id -> playerId (user team)
  /** The user's chosen bench (v25): an ordered list of senior-squad player ids
   * the manager has picked as substitutes, best/most-wanted first. The match
   * engine's auto-subs draw from this bench in order. Empty/absent falls back to
   * an auto-picked bench (best of the rest), so a manager who never touches it
   * still fields a full matchday squad. Players in the XI or on loan are ignored. */
  userBench?: string[];
  /** Tactics the manager has saved by name (v1.53), newest first. Each captures
   * the instructions, the XI and the bench together, so a formation change made
   * by accident is one click from being undone. Absent on pre-v31 saves. */
  savedTactics?: SavedTactic[];
  inbox: InboxItem[];
  offers: TransferOffer[];
  transferList: string[]; // user players listed for sale
  /** The user's scouting shortlist (v21): players at OTHER clubs (or free agents)
   * the manager is tracking. Purely a personal watchlist — being on it has no
   * effect on the world, it just collects targets in one place (Transfers →
   * Shortlist). Added from a player's card; distinct from `transferList`, which
   * is the user's own players put up for sale. */
  shortlist?: string[];
  /** User players made available for loan (v14). Like `transferList`, this is a
   * visibility flag rather than a queue: listed players draw AI loan interest
   * during open windows. Academy loans share the same list. */
  loanList?: string[];
  /** "Do not disturb" for incoming bids (v1.91). Set, no AI club opens an offer
   * for a user player — the manager who has finished building a squad stops
   * fielding approaches for it every week.
   *
   * It gates only the OPENING of a bid, in `aiWeeklyTransferTick`. Offers
   * already on the table keep their deadlines and stay answerable, so switching
   * it on can never silently void a negotiation the user was in the middle of.
   * A release clause is deliberately NOT gated: the clause is a term the manager
   * agreed to and a buyer paying it isn't making an offer, so honouring the
   * toggle there would turn a UI switch into a contract the user never signed.
   *
   * Optional — absent on pre-v1.91 saves, which read as "offers on". */
  offersPaused?: boolean;
  staffMarket: StaffCandidate[];
  /** Scout hiring market (v14) — the scouting department's own shortlist,
   * separate from `staffMarket` since scouts carry two ratings. */
  scoutMarket?: ScoutCandidate[];
  /** Day the staff & scout hiring markets next cycle in (v20). On top of the
   * dismiss-to-refresh cadence, every `marketRefreshDays` the whole for-hire pool
   * turns over so the shortlists don't go stale. Optional for old saves. */
  marketRefreshDay?: number;
  simResults: SimLeagueResult[]; // latest per sim league
  /**
   * Archetype retraining programmes currently running (v1.93).
   *
   * The Development → Archetype tab's whole state. Unlocked one class at a time
   * by taking that class's development center to level 5; each center runs
   * `archetypeConvertSlots` programme at once, so the list is short and the
   * choice of who to retrain is the decision.
   *
   * Progress is measured in SEASONS SERVED rather than in a completion date,
   * because the staff assigned to the center — and therefore the speed — can
   * change while a programme runs. See `lib/archetypedev.ts`.
   *
   * Optional so every existing save migrates in with nothing running.
   */
  archetypeConversions?: ArchetypeConversion[];
  /**
   * Modern rivalries (v1.94) — clubs the save's own history has turned into
   * enemies. Formed by `lib/rivalry.ts` at the rollover, never by worldgen: a
   * rivalry is meant to be a thing the manager EARNED, so a fresh save has none
   * and a long one has several. Optional, so every existing save loads with an
   * empty rivalry list and starts building its own.
   */
  rivalries?: Rivalry[];
  academy: AcademyState; // Youth Academy (§18, v4)
  recordBook: RecordBook;
  pendingMatchFixtureId: string | null; // set when Continue stops on a matchday
  lastExportSeason: number; // for backup reminders
  news: string[]; // ticker
  /** Structured world-wide transfer feed (v22, Transfers → News). Every senior
   * deal that completes is appended (newest first) and rendered as a filterable
   * ledger. Optional for old saves — backfilled empty at migration. */
  transferNews?: TransferNewsItem[];
  /** Season honours computed at the dead-week awards ceremony (v1.44), held here
   * until the rollover folds them into the season summary. Present only between
   * `accoladesDay` and END SEASON; cleared once the summary is built. Optional so
   * saves that predate the ceremony simply compute honours at the rollover. */
  pendingAccolades?: SeasonAccolades;
  /** Manager progress (v1.45): passively-tracked user accolades and the set of
   * one-off achievements earned. Optional so pre-v1.45 saves migrate in with a
   * fresh, zeroed block; see lib/achievements.ts. */
  progress?: UserProgress;
  /** The club's Hall of Fame (v1.55): player ids the manager has enshrined from a
   * player's profile. A permanent, hand-curated honour roll — being on it changes
   * nothing in the world, it just collects the legends the manager wants
   * remembered (living, retired, sold or still at the club). Newest first.
   * Optional so old saves migrate in empty. Rendered on the Achievements screen. */
  hallOfFame?: string[];
  /** End-of-season contract resolution (v1.51). Opened on `contractResolveDay`
   * — after the awards ceremony, before END SEASON — listing every player on the
   * user's books whose deal expires this summer. The manager renews or releases
   * each one; the rollover reads the decisions instead of releasing silently.
   *
   * Present only between that day and the rollover, which clears it. Optional so
   * a save made before the step simply never sees it (the rollover falls back to
   * the old release-everyone behaviour for anything left undecided). */
  contractResolution?: ContractResolution;
  /** Academy graduates awaiting the manager's decision (v1.51). A prospect who
   * ages out of the academy no longer walks into the senior squad on his own —
   * he lands here at the rollover and the manager signs him or lets him go. */
  pendingGraduates?: PendingGraduate[];
  /** Global Club Network (v34) — the end-game ownership layer. Absent until the
   * manager funds the unlock threshold and opts in. Once present the GCN screen
   * appears; see lib/gcn.ts. */
  gcn?: GlobalClubNetwork;
  /** GCN Funds (v34): money the manager has committed toward the GCN unlock
   * threshold, deposited from the club budget over time before GCN exists. Spent
   * (zeroed) at unlock. Absent/0 means nothing deposited yet. */
  gcnFunds?: number;
}

/** The Global Club Network (v34). The manager, having funded the unlock
 * threshold, becomes head of a network of AI-run clubs across leagues and
 * countries. GCN runs its own treasury (topped up from the main club) and can
 * found new clubs, buy existing ones, move players between owned clubs, and
 * invest in network-wide Operations upgrades. The manually-managed club
 * (`userTeamId`) is never part of `clubIds`. See lib/gcn.ts. */
export interface GlobalClubNetwork {
  name: string;
  foundedSeason: number;
  /** GCN's own purse, separate from every club's `budget`. Funded only by
   * explicit deposits from the main club; pays for buying/founding clubs,
   * Operations upgrades, and (future) GCN staff. */
  treasury: number;
  /** Owned clubs, EXCLUDING `userTeamId`. Each is also flagged `gcnOwned`. */
  clubIds: string[];
  /** Operations upgrade levels, keyed by facility. Absent key = level 0. */
  ops: Partial<Record<GcnFacility, number>>;
  /** Automated weekly funding (v1.63): how much the treasury sends each owned
   * club every Monday, keyed by club id. Absent/0 = no standing order. Entries
   * for clubs that leave the network are ignored and cleaned up on sale. */
  autoFunding?: Record<string, number>;
  /** The three Global Executive seats (v1.95), keyed by role. An absent key is a
   * vacant seat, which is the state a network starts in and returns to on a
   * dismissal — never a null placeholder, so "is this seat filled" is one
   * question with one answer. See lib/gcn/executives.ts. */
  executives?: Partial<Record<GcnExecRole, GcnExecutive>>;
  /** The elite executive shortlist (v1.95). Cycles on the same
   * `marketRefreshDays` clock the club's staff market uses — there is
   * deliberately no second refresh constant. */
  execMarket?: GcnExecCandidate[];
  /** Day the executive shortlist last cycled. */
  execMarketDay?: number;
  /** International Scouting Hubs (v1.95), keyed by SCOUT_WORLD sub-region id.
   * An absent key is a region with no hub — the hub grid renders every region
   * either way, so this map only ever holds what has actually been built. */
  hubs?: Record<string, GcnHub>;
  /** Prospects the hubs have turned up and the network has signed, held at the
   * hub rather than at any club. Ids into `state.players`; the player carries
   * `gcnHubRegion` so his home is a property of him, not only of this list. */
  hubProspectIds?: string[];
  /** Live hub reports awaiting a sign/pass decision, across every hub. */
  hubReports?: ProspectReport[];
}

/** The three Global Executive seats (v1.95).
 *
 * Deliberately three, and deliberately not a roster: the club's backroom is a
 * staffing problem (many people, many buildings, an assignment grid), and
 * repeating it at network scale would be the same game played twice with bigger
 * numbers. An executive is a SEAT — one hire, one salary, one blanket effect —
 * so the decision is which pedigree the network can afford rather than how to
 * arrange twelve people.
 *
 * Each seat drives exactly one channel, and the three are the three things a
 * network of clubs actually owns: the football, the money, and the pipeline. */
export type GcnExecRole = "football" | "commerce" | "scouting";

/** A hired Global Executive (v1.95).
 *
 * Shares the club staff model's two quality axes — `stars` and a badge earned by
 * SERVING — because they are the same idea at a different scale, and one
 * vocabulary across the game is worth more than a bespoke ladder here. The
 * difference is that a badge is earned for the SEAT rather than for a facility:
 * an executive holds at most one, and moving seats is starting over. */
export interface GcnExecutive {
  id: string;
  name: string;
  nationality: string; // 3-letter code
  age: number;
  /** 1–5. */
  stars: number;
  /** Weekly wage, paid from the TREASURY (never a club's budget) — the network
   * employs these people, not any one club. */
  wage: number;
  /** Season they took the seat, for the record and for the badge count. */
  hiredSeason: number;
  /** Completed seasons served in this seat, across all spells at this network.
   * `tier` is derived from it via the shared badge ladder. */
  seasonsServed: number;
  /** Derived from `seasonsServed`; stored so the save and the UI agree. Absent
   * until the first full season completes. */
  badge?: BadgeTier;
}

/** An executive on the elite shortlist (v1.95). A hired executive plus the
 * one-off signing fee, and the badge they arrive carrying — pedigree earned at
 * whatever network employed them before. */
export interface GcnExecCandidate {
  id: string;
  name: string;
  nationality: string;
  age: number;
  stars: number;
  wage: number;
  fee: number;
  /** Seasons of prior service, which is what any arriving badge is derived
   * from — an executive's record travels with them. */
  seasonsServed: number;
  badge?: BadgeTier;
  /** The seat this candidate is a candidate FOR. The shortlist is per-seat: a
   * Director of Global Commerce is not an interchangeable body. */
  role: GcnExecRole;
}

/** An International Scouting Hub (v1.95) — a physical academy the network builds
 * in one SCOUT_WORLD sub-region.
 *
 * The end-game counterpart to club scouting: instead of sending a scout on a
 * trip, the network owns the ground and the pipeline runs continuously. A hub
 * files its own reports on its own clock, at a quality the club academy can't
 * reach, and the prospects it signs live AT THE HUB rather than in the club
 * academy — which is what makes the "keep or place" decision the feature's
 * actual choice. */
export interface GcnHub {
  /** SCOUT_WORLD sub-region id — the hub IS its region, so this is the key. */
  region: string;
  /** 1–`gcnHubMaxLevel`. Level buys report quality and cadence. */
  level: number;
  foundedSeason: number;
  /** Day the next report batch is due. */
  nextReportDay: number;
  /** How many batches this hub has filed, stamped onto reports so a hub's finds
   * stay distinguishable as they accumulate. */
  reportsFiled?: number;
  /**
   * Scouting paused (v1.99). A paused hub files nothing — no batch is generated
   * and `nextReportDay` stops advancing — but it keeps its level, its prospects
   * and its upkeep. It is the reversible half of what closing a hub used to be
   * the only version of: "stop the reports coming" and "demolish the building"
   * are different decisions and only the second is irreversible.
   */
  paused?: boolean;
  /**
   * The brief (v1.99): what this hub looks for. Every field is optional and an
   * absent one means "no preference" — a hub with no brief behaves exactly as
   * it did before this existed, which is what keeps a pre-v1.99 save unchanged.
   *
   * A focus is a BIAS, not a filter (`gcnHubFocusHitChance`): a hub told to look
   * for Brazilian centre-backs still turns up the odd winger, because a scouting
   * network reports what it finds and a hard filter would make the brief a
   * player-generator rather than an instruction.
   */
  focus?: GcnHubFocus;
}

/** A hub's standing instruction (v1.99). Stored on the hub, read only by
 * `generateHubProspect` — nothing else in the engine consults it. */
export interface GcnHubFocus {
  /** Nationality code, and it must be one of the hub region's own `nats`. */
  nat?: string;
  pos?: Pos;
  /** An `Archetype` id. The brief steers the prospect's TRAINING PLAN, which is
   * what worldgen shapes an attribute line from — so a focused find genuinely
   * reads as that archetype rather than being labelled one. */
  archetype?: string;
}

/** A GCN Operations upgrade track (v34). Table-driven like TrainingFacility —
 * adding one is a data change in lib/gcn.ts + lib/config/tuning.ts, never a new
 * branch in the purchase path.
 *
 * v1.62 replaced the original four cosmetic tracks (financing/development/
 * scouting/logistics — only financing was ever wired to an effect) with a single
 * track that gates the thing the network is actually about: how many clubs it
 * can hold. `ops` is a partial record, so a pre-v1.62 save's dead keys are
 * simply ignored.
 *
 * v1.63 added two revenue tracks (`brandDeals`, `gcnDeals`); **v1.99 removed
 * them both**. They were passive weekly income bought by the level — the exact
 * shape v1.79 and v1.82 exist to delete on the club side — and between them they
 * meant the network's money problem was solved by pressing Upgrade rather than
 * by running clubs and hubs well. What remains is the one track that gates the
 * thing the network is actually about: how many clubs it can hold.
 *
 * `ops` is a partial record, so a pre-v1.99 save's two dead keys are simply
 * ignored, exactly as v1.62's four were. No refund, no conversion. */
export type GcnFacility = "groupClubs";

/** One expiring deal awaiting the manager's call at the end of a season (v1.51). */
export interface ExpiringContract {
  playerId: string;
  /** Where he sits on the books — an academy prospect's "renewal" is simply
   * keeping him in the youth setup, which costs no wage. */
  academy: boolean;
  /** What the manager decided. `undecided` until they act; the rollover treats
   * anything still undecided as `release`, which is what used to happen anyway. */
  decision: "undecided" | "renew" | "release";
  /** The terms a `renew` decision applies at the rollover. Set when the manager
   * agrees a deal in the resolution modal. */
  terms?: { wage: number; years: number; releaseClause?: number };
}

/** The end-of-season contract round (v1.51). */
export interface ContractResolution {
  /** The season whose expiries these are — guards against a stale block from an
   * interrupted rollover being applied to the wrong year. */
  season: number;
  /** The day the round opened (`schedule.contractResolveDay`). */
  openedDay: number;
  items: ExpiringContract[];
  /** Set once the manager has been through the list, so the prompt stops
   * re-opening itself while they finish the rest of the season. */
  acknowledged?: boolean;
}

/** An academy prospect who has aged out and needs a senior decision (v1.51). */
export interface PendingGraduate {
  playerId: string;
  /** The season he aged out in, for the inbox copy. */
  season: number;
}

// ── Football Legacy — core schema ─────────────────────────────────────────
// Single source of truth for all game data shapes. Schema-versioned so the
// save/export format doubles as the modding format (GAME_DESIGN.md §2, §13).

export const SCHEMA_VERSION = 10;

export type Pos = "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

export type Mentality = "Defensive" | "Balanced" | "Attacking";
export type Style = "Possession" | "Counter" | "Direct";

// Extended tactic instructions (§6, expanded). All presets — no sliders. Every
// axis feeds the engine through the tuning table; the Tactics screen explains
// what each does. Optional so v2 saves migrate with sensible defaults.
export type Tempo = "Slow" | "Standard" | "High";
export type Width = "Narrow" | "Standard" | "Wide";
export type Press = "Low" | "Medium" | "High";
export type DefLine = "Deep" | "Standard" | "High";
export type Focus = "Left" | "Central" | "Right" | "Mixed";

export interface Tactic {
  formationId: string;
  mentality: Mentality;
  style: Style;
  tempo?: Tempo;
  width?: Width;
  press?: Press;
  line?: DefLine;
  focus?: Focus;
}

// Six visible attributes (GKs reuse the slots with GK-flavored labels in UI).
export interface Attributes {
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  phy: number;
}

// Hot data — always loaded, touched constantly by engine + UI (§5).
export interface PlayerBio {
  id: string;
  name: string;
  age: number;
  nationality: string; // 3-letter code
  positions: Pos[]; // first entry = primary
  archetypeId: string;
  attrs: Attributes;
  overall: number; // 1-99, drives the sim
  potential: number;
  fitness: number; // 0-100
  form: number; // multiplier, tuning.formMin..formMax
  clubId: string | null; // null = free agent / retired
  value: number; // market value, stored (§10)
  traits: string[]; // 0-2 trait ids
  longevity: number; // hidden 0..1 — aging variance (§5)
  // current-season running stats (compressed into PlayerCareer at rollover)
  stats: SeasonPlayerStats;
  retired?: boolean;
  /** Per-season development log — how overall & potential moved each summer.
   * Powers the Development page's growth history. Newest last. Optional (v2). */
  devLog?: DevLogEntry[];
  /** Youth Academy (§18, v4). The club whose academy this player came through
   * (joined at ≤18 via intake or a youth signing). Permanent — the Academy DNA
   * ledger and graduate news are built from this. */
  academyClubId?: string;
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
}

/** A player out on a season loan (§18). The player stays on the owning club's
 * academy/senior roster; the destination never fields them in the real engine —
 * loan minutes are credited statistically into youthStats. */
export interface LoanState {
  toClubId: string;
  startDay: number;
  /** How much a loan minute counts toward development vs a senior minute. */
  minutesWeight: number;
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
}

// Cold data — append-only, loaded on demand (§5).
export interface CareerRow {
  season: number;
  clubName: string;
  competition: string;
  apps: number;
  goals: number;
  assists: number;
  avgRating: number;
  awards: string[];
}

export interface TransferRow {
  season: number;
  day: number;
  from: string;
  to: string;
  fee: number;
}

export interface PlayerCareer {
  playerId: string;
  seasons: CareerRow[];
  transfers: TransferRow[];
}

// ── Clubs & competitions ──────────────────────────────────────────────────

export type StaffSlot =
  | "headCoach"
  | "assistantCoach"
  | "devCoach"
  | "fitnessCoach"
  | "gkCoach"
  | "scout"
  | "youthCoach"
  | "physio";

export interface StaffMember {
  id: string;
  name: string;
  nationality: string; // 3-letter code (v6)
  slot: StaffSlot;
  stars: number; // 1-5
  wage: number; // weekly
}

/** Where each staff slot is managed in the UI (v6). Business/backroom staff sit
 * on the Club page; coaching on Development; scouting on Academy. Pure display
 * grouping — the engine reads slots, never departments. */
export type StaffDept = "club" | "development" | "academy";

/** EA-FC-style on-pitch responsibilities (v6). Each holds a playerId from the
 * senior squad, or is absent. Captain (with the Leader trait) buffs the side;
 * the set-piece takers bias scorer/assist selection on the relevant chances. */
export interface TeamAssignments {
  captainId?: string;
  penaltyTakerId?: string;
  freeKickTakerId?: string;
  cornerTakerId?: string;
}

export interface Team {
  id: string;
  name: string;
  short: string; // 3-letter
  leagueId: string;
  colors: [string, string];
  reputation: number; // 1-100, drives gate income + AI valuation attitude
  budget: number;
  playerIds: string[];
  tactic: Tactic;
  staff: Partial<Record<StaffSlot, StaffMember>>;
  stadium: string;
  /** Revenue facilities (§ club income). Level 0 = base; each level is a one-time
   * purchase giving a permanent weekly income boost. Optional for old saves. */
  stadiumLevel?: number;
  commercialLevel?: number;
  /** Training facilities (Player Development, §5). Level 0 = base; each level is
   * a one-time purchase that speeds/deepens development. Optional for old saves.
   * trainingLevel  → growth speed toward potential
   * medicalLevel   → fitness recovery + softer age-related fitness drain
   * academyLevel   → dormant until the Youth Academy ships ([FUTURE]) */
  trainingLevel?: number;
  medicalLevel?: number;
  academyLevel?: number;
  /** Scouting Network facility (v5): raises how many scouts can be out on
   * assignment at once (capacity = base + scoutNetworkLevel). One-time
   * upgrades in the Scouting Department Upgrades panel, no weekly cost.
   * Optional for old saves. */
  scoutNetworkLevel?: number;
  /** Academy squad-size facility (v7): raises how many prospects the academy can
   * hold at once (cap = academySquadSizeBase + level*academySquadSizePerLevel).
   * One-time upgrades in the Scouting Department Upgrades panel. Optional for old
   * saves (default 0). */
  academySquadLevel?: number;
  /** Academy squad (§18, v4): uncapped, ages 15–21, outside the senior cap.
   * `playerIds` stays senior-only so cap/selection/wage logic is untouched.
   * Only the user's club carries a populated academy roster. */
  academyPlayerIds?: string[];
  /** Extra revenue facilities (v6) — same one-time-upgrade / weekly-income
   * pattern as stadium/commercial. Optional for old saves (default 0).
   *   trainingGroundLevel → community & academy tours (small steady income)
   *   mediaLevel          → club media / streaming revenue
   *   hospitalityLevel    → matchday corporate boxes & premium seating
   *   retailLevel         → megastore + online merchandising */
  mediaLevel?: number;
  hospitalityLevel?: number;
  retailLevel?: number;
  /** On-pitch responsibilities (v6, captain + set-piece takers). */
  assignments?: TeamAssignments;
  /** Active season-long sponsorship deals (v6). Only the user's club fills
   * this; AI clubs run on their abstract income. */
  sponsors?: SponsorDeal[];
  /** Pending sponsorship offers the user can accept (v6). Regenerated when a
   * slot is empty; expire after a while. */
  sponsorOffers?: SponsorOffer[];
}

// ── Sponsors / investments (v6, Club → Income) ────────────────────────────

/** A sponsorship category. Each club may hold at most one deal per slot. */
export type SponsorSlot = "shirt" | "sleeve" | "apparel" | "boot" | "stadium";

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
}

export interface League {
  id: string;
  name: string;
  country: string;
  tier: number;
  playable: boolean;
  teamIds: string[];
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
  scorers?: { playerId: string; teamId: string; minute: number }[];
  /** Cup ties that finish level are settled on penalties. */
  shootoutWinnerId?: string;
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

export interface SimLeagueResult {
  leagueId: string;
  season: number;
  half: 1 | 2; // resolved before winter window (1) and before summer (2)
  table: TableRow[];
  topScorers: SimTopScorer[];
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
}

export interface StaffCandidate {
  id: string;
  name: string;
  nationality: string; // 3-letter code (v6)
  slot: StaffSlot;
  stars: number;
  fee: number;
  wage: number;
  /** Day a dismissed slot's replacements become available (v6). Candidates
   * generated immediately have no delay; dismiss-to-refresh sets this so the
   * slot reads "vacant" until the new crop arrives (~2 days later). */
  availableDay?: number;
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

export interface SeasonSummary {
  season: number;
  yearLabel: string; // e.g. "2025/26"
  championsByLeague: Record<string, { teamId: string; teamName: string }>;
  cupWinner: { teamId: string; teamName: string } | null;
  finalTables: Record<string, TableRow[]>;
  topScorers: Record<string, { playerId: string; name: string; teamName: string; goals: number }>;
  playerOfSeason: { playerId: string; name: string; teamName: string } | null;
  youngPlayerOfSeason: { playerId: string; name: string; teamName: string } | null;
  userTeamId: string;
  userFinish: string; // e.g. "3rd in Premier Division"
  notableTransfers: { playerName: string; from: string; to: string; fee: number }[];
  promoted: string[];
  relegated: string[];
}

export interface RecordBook {
  seasons: SeasonSummary[];
  biggestWin: { season: number; text: string; margin: number } | null;
}

// ── Season schedule (calendar anchors, §3) ────────────────────────────────

export interface SeasonSchedule {
  seasonStartDay: number; // Jul 1
  leagueRoundDays: number[]; // 38 Saturdays
  cupRoundDays: number[]; // 6 rounds
  summerCloseDay: number; // Sep 1
  winterOpenDay: number; // Jan 1
  winterCloseDay: number; // Feb 1
  simResolveDay1: number; // just before winter window
  simResolveDay2: number; // just before season end
  seasonEndDay: number; // review + rollover
  /** Youth intake day (§18): mid-March, once per season. Optional (v4). */
  intakeDay?: number;
}

export interface CupState {
  // teamIds still alive; populated round by round
  aliveTeamIds: string[];
  currentRound: number; // index into schedule.cupRoundDays
  winnerId: string | null;
  roundNames: string[];
}

// ── Youth Academy (§18, v4) ───────────────────────────────────────────────

export type ScoutPosGroup = "GK" | "DEF" | "MID" | "ATT" | "ANY";

/** Scouting targets (v5): specific countries plus a couple of broad regions,
 * EA-FC style. Each maps to a nationality pool in lib/config/scouting.ts. */
export type ScoutRegion =
  | "England"
  | "Spain"
  | "Italy"
  | "Germany"
  | "France"
  | "Brazil"
  | "Argentina"
  | "Netherlands"
  | "Sweden"
  | "Nigeria"
  | "Europe"
  | "World";

/** One scout out on assignment (v5). Each scout the club can field (capacity
 * grows with the Scouting Network facility) may be pointed at a country and a
 * position focus independently — several may share a country. `nextReportDay`
 * is per-assignment so busy departments surface reports steadily. */
export interface ScoutAssignment {
  id: string;
  region: ScoutRegion;
  positions: ScoutPosGroup;
  /** Archetype focus (v7): the player *types* the scout is briefed to look for.
   * Empty/undefined = no preference (any archetype in the position group). When
   * set, reports are drawn only from these archetype ids. Locked in when the
   * scout is sent — part of the brief, like region and position. */
  archetypes?: string[];
  nextReportDay: number;
}

/** A youth prospect surfaced by the scout (§18). The player object is embedded
 * here — it only enters `state.players` if signed, so passed reports leave no
 * residue in the world. */
export interface ProspectReport {
  id: string;
  player: PlayerBio;
  fee: number;
  note: string;
  day: number;
  expiresDay: number;
  /** Which region the scout found them in (v5, for display). */
  region?: ScoutRegion;
  /** Which scout assignment surfaced the report (v5). */
  assignmentId?: string;
}

/** One abstract U21 opponent: a strength number wearing a parent club's name.
 * Never a roster (§4 sim-league performance rule applies to youth football). */
export interface U21Opponent {
  name: string;
  short: string;
  strength: number;
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

/** The academy's U21 league season (§18): 12 teams, double round-robin,
 * one midweek match a week, resolved statistically with zero interaction. */
export interface U21Season {
  opponents: U21Opponent[]; // 11 abstract sides; the user U21s are team 0
  matchDays: number[]; // 22 midweek days
  roundsPlayed: number;
  table: U21TableRow[];
  results: U21Result[]; // user matches only
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
  u21: U21Season;
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
  | "development"
  | "academy"
  | "player";

export interface GameState {
  schemaVersion: number;
  saveName: string;
  seed: number;
  managerName: string;
  userTeamId: string;
  /** The country the user manages in (3-letter code, v7). Its two divisions are
   * the real-engine playable leagues; all other countries run as sims. */
  playableCountry: string;
  /** The playable country's two division league ids, [top, second] (v7). The
   * user's club always sits in one of these; promotion/relegation swaps clubs
   * between them. Replaces the old hardcoded ["ENG1","ENG2"]. */
  divisionIds: [string, string];
  season: number; // 1-based
  currentDay: number; // days since Jul 1 2025
  players: Record<string, PlayerBio>;
  careers: Record<string, PlayerCareer>;
  teams: Record<string, Team>;
  leagues: Record<string, League>;
  fixtures: Fixture[]; // current season, playable competitions
  cup: CupState;
  schedule: SeasonSchedule;
  lineup: Record<string, string>; // formation slot id -> playerId (user team)
  inbox: InboxItem[];
  offers: TransferOffer[];
  transferList: string[]; // user players listed for sale
  staffMarket: StaffCandidate[];
  simResults: SimLeagueResult[]; // latest per sim league
  academy: AcademyState; // Youth Academy (§18, v4)
  recordBook: RecordBook;
  pendingMatchFixtureId: string | null; // set when Continue stops on a matchday
  lastExportSeason: number; // for backup reminders
  news: string[]; // ticker
}

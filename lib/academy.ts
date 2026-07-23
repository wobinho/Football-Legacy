// ── Youth Academy (§18) ───────────────────────────────────────────────────
// The prospect pipeline: intake day, the U21 league, youth scouting, loans out,
// potential fog-of-war, and academy DNA tagging. Prospects are normal PlayerBio
// players developed by the same aging function (§5) — this module only supplies
// what the curve responds to: minutes, coaching, and a pipeline. Nothing here
// ever stops the Continue loop; everything streams through the inbox.

import type {
  AcademyState,
  GameState,
  PlayerBio,
  Pos,
  ProspectReport,
  Scout,
  ScoutAssignment,
  ScoutPosGroup,
  ScoutRegion,
  Team,
  U21Opponent,
  U21Season,
  U21SellStance,
  U21TableRow,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import { mulberry32, deriveSeed, pick, pickWeighted, randInt, randRange, randPoisson, shuffle, uid, type RNG } from "./rng";
import { generatePlayer } from "./worldgen";
import { playerValue } from "./value";
import { transferWindowState } from "./calendar";
import { regionNats } from "./config/scouting";
import { getArchetype } from "./config/archetypes";
import { grantDefaultContract } from "./contracts";
import { academySquadCap } from "./economy";
import { pushInboxItem } from "./inbox";
import { assignKitNumber, clearKitNumber } from "./kitnumbers";
import {
  assignmentCapacity,
  bestJudgement,
  hasScout,
  idleScouts,
  rollProspectTier,
  rollReportSize,
  rollTierQuality,
  scoutById,
  userScouts,
} from "./scouts";

/** What each position brief may return. Broad groups roll across their whole
 * group; a specific position (v17) returns exactly that position, which is what
 * makes "find me a right back" a brief you can actually give. Note GK is both a
 * group and a Pos — the single entry serves both. */
const POS_GROUPS: Record<ScoutPosGroup, Pos[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB"],
  MID: ["DM", "CM", "LM", "RM", "AM"],
  ATT: ["LW", "RW", "ST"],
  ANY: ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"],
  // one entry per specific position
  CB: ["CB"],
  LB: ["LB"],
  RB: ["RB"],
  DM: ["DM"],
  CM: ["CM"],
  LM: ["LM"],
  RM: ["RM"],
  AM: ["AM"],
  LW: ["LW"],
  RW: ["RW"],
  ST: ["ST"],
};

// Intake classes lean toward the spine positions, with keepers rare.
const INTAKE_POS_POOL: Pos[] = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "LM", "RM", "AM", "LW", "RW", "ST", "ST"];

const pushInbox = pushInboxItem;

function userTeam(state: GameState): Team {
  return state.teams[state.userTeamId];
}

function youthCoachStars(state: GameState): number {
  return userTeam(state).staff.youthCoach?.stars ?? 0;
}

/** The department's sharpest judge of a player (v14). Judgement — not
 * experience — is what tightens a potential read, so the fog on players outside
 * the club is lifted by the best judgement on the books. */
function scoutStars(state: GameState): number {
  return bestJudgement(state);
}

export function academyPlayers(state: GameState): PlayerBio[] {
  return (userTeam(state).academyPlayerIds ?? []).map((id) => state.players[id]).filter((p) => p && !p.retired);
}

/** Worldgen id counters reset per session, so anything generated during play
 * must not reuse the `p<n>` sequence — reassign a collision-proof id. */
function freshId(p: PlayerBio): PlayerBio {
  p.id = uid("y");
  return p;
}

// ── Potential fog-of-war (§18) ────────────────────────────────────────────
// True potential stays in the schema; the UI shows a 1–5 star range for anyone
// still growing (under the growth-end age). The range is centred on a seeded
// estimate (truth ± error) so a range can be wrong, not just wide. Everything
// is deterministic per player — no re-roll scumming — and converges toward the
// truth as age, minutes, and staff quality add information.

export interface PotentialView {
  /** Exact potential when no fog applies (age ≥ growth end), else null. */
  exact: number | null;
  /** The scout's best single-number read (= truth when exact). UI projections
   * for fogged players must use this, never the real potential. */
  estimate: number;
  /** Star range, 1–5 in half-star steps (equal when exact). */
  loStars: number;
  hiStars: number;
}

/** Stars read as FLOORS of a potential band, not midpoints: 5★ means 90+, 4.5★
 * means 85–89, 4★ means 80–84, and so on at starScalePerHalf points a step down
 * to 1★ at starScaleMin. Flooring (rather than rounding) is what makes "a full
 * five stars" a promise the number keeps — an 89 potential must not show five. */
export function potentialStars(cfg: TuningConfig, potential: number): number {
  const steps = Math.floor((potential - cfg.starScaleMin) / cfg.starScalePerHalf);
  const raw = 1 + steps * 0.5;
  return Math.min(5, Math.max(1, raw));
}

export function potentialView(state: GameState, p: PlayerBio, cfg: TuningConfig): PotentialView {
  if (p.age >= cfg.growthEndAge || p.retired) {
    const s = potentialStars(cfg, p.potential);
    return { exact: p.potential, estimate: p.potential, loStars: s, hiStars: s };
  }
  // Own players are read by the youth coach; everyone else's by the sharpest
  // judgement in the scouting department (v14 — judgement, not experience, is
  // what makes a read tight).
  const isOwn = p.clubId === state.userTeamId;
  const stars = isOwn ? youthCoachStars(state) : scoutStars(state);
  const perStar = isOwn ? cfg.fogCoachStarReduction : cfg.fogJudgementStarReduction;
  const staffCut = Math.min(0.45, stars * perStar);
  const seasonsSeen = p.devLog?.length ?? 0;
  const minutes = (p.stats.minutes + (p.youthStats?.minutes ?? 0)) / 3000;
  const info = Math.min(1, Math.max(0, (p.age - 16) * 0.09 + seasonsSeen * 0.08 + Math.min(1, minutes) * 0.15));
  const fog = Math.max(0.12, (1 - info) * (1 - staffCut));

  const err = mulberry32(deriveSeed(state.seed, `fog:${p.id}`))() * 2 - 1;
  const center = Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall, p.potential + err * cfg.fogBaseError * fog));
  const width = Math.max(cfg.fogMinWidth, cfg.fogBaseWidth * fog);
  return {
    exact: null,
    estimate: Math.round(center),
    loStars: potentialStars(cfg, center - width / 2),
    hiStars: potentialStars(cfg, center + width / 2),
  };
}

/** Compact text form for inbox bodies, e.g. "3–4.5★". */
export function starRangeLabel(state: GameState, p: PlayerBio, cfg: TuningConfig): string {
  const v = potentialView(state, p, cfg);
  if (v.exact !== null) return `${v.exact} POT`;
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
  return v.loStars === v.hiStars ? `${fmt(v.loStars)}★` : `${fmt(v.loStars)}–${fmt(v.hiStars)}★`;
}

// ── Academy state / U21 season construction ───────────────────────────────

/** Roll the seven prospects a rival club registers for a U21 competition (v18).
 *
 * These are real PlayerBio records living in `state.players` and owned by the
 * parent club, because youth scouting has to be able to look at them, value
 * them, and buy them. The club's reputation plays the part a scout's judgement
 * plays elsewhere — a big academy registers better kids — so the tier ladder is
 * the same one the user's own intake and scout reports roll on. */
function rollRivalProspects(state: GameState, cfg: TuningConfig, rng: RNG, club: Team): string[] {
  const judgement = Math.max(1, Math.min(5, Math.round(1 + (club.reputation - 38) * 0.055)));
  const ids: string[] = [];
  // one keeper, six outfielders — the same shape the user must register
  const slots: Pos[] = ["GK", ...shuffle(rng, INTAKE_POS_POOL.filter((p) => p !== "GK")).slice(0, 6)];
  for (const pos of slots) {
    const tier = rollProspectTier(rng, cfg, judgement);
    const band = rollTierQuality(rng, cfg, tier);
    const prodigy = tier === "platinum" || tier === "diamond";
    const p = freshId(
      generatePlayer(rng, cfg, {
        pos,
        overall: band.overall,
        nat: "ENG",
        // A registered U21 squad is competition-age, not the whole academy: the
        // floor is the age a prospect could step up at, not intake age.
        age: randInt(rng, cfg.academyPromoteMinAge, cfg.academyMaxAge),
        prodigy,
      })
    );
    p.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 2, band.potential)));
    p.value = playerValue(p, cfg);
    p.clubId = club.id;
    p.academyClubId = club.id;
    p.u21Tier = tier;
    state.players[p.id] = p;
    ids.push(p.id);
  }
  return ids;
}

/** Build one 12-team U21 competition: the user U21s plus 11 sides wearing other
 * playable clubs' names, each registering seven of its own prospects (v18).
 *
 * `half` is which running of the season this is (0 or 1). The first kicks off
 * u21FirstKickoffDays after the senior season starts; the second follows on
 * directly once the first's 22 rounds are done. Registration closes
 * u21RegistrationLeadDays before round 1. */
export function buildU21Season(state: GameState, cfg: TuningConfig, half = 0, startDay?: number): U21Season {
  const rng = mulberry32(deriveSeed(state.seed, `u21:${state.season}:${half}`));
  const user = userTeam(state);
  const clubs = Object.values(state.teams).filter((t) => t.id !== user.id && state.leagues[t.leagueId]?.playable);
  const opponents = shuffle(rng, clubs)
    .slice(0, 11)
    .map((t) => ({
      name: `${t.name} U21`,
      short: t.short,
      clubId: t.id,
      strength: cfg.u21OppStrengthBase + t.reputation * cfg.u21OppStrengthPerRep + randRange(rng, -3, 3),
      prospectIds: rollRivalProspects(state, cfg, rng, t),
      sellStance: pickWeighted(
        rng,
        ["willing", "premium", "unwilling"] as const,
        (s) => cfg.u21SellStanceWeights[s]
      ),
    }));

  // Both competitions have to fit between the first kickoff (a month into the
  // senior season) and the season's end, so the round interval is derived from
  // the window actually available rather than assumed. It is capped at the
  // nominal weekly spacing — a short calendar tightens the fixture list, it
  // never stretches it past a week.
  const firstKickoff = state.schedule.seasonStartDay + cfg.u21FirstKickoffDays;
  const window = state.schedule.seasonEndDay - firstKickoff;
  const totalRounds = cfg.u21RoundsPerCompetition * cfg.u21CompetitionsPerSeason;
  const interval = Math.max(1, Math.min(cfg.u21RoundIntervalDays, Math.floor(window / totalRounds)));
  const kickoff = startDay ?? firstKickoff;
  const matchDays = Array.from({ length: cfg.u21RoundsPerCompetition }, (_, i) => kickoff + i * interval);
  const table: U21TableRow[] = [
    { name: `${user.name} U21`, isUser: true, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
    ...opponents.map((o) => ({ name: o.name, isUser: false, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })),
  ];
  return {
    half,
    opponents,
    matchDays,
    roundsPlayed: 0,
    table,
    results: [],
    registrationDay: kickoff - cfg.u21RegistrationLeadDays,
    registered: [],
  };
}

/** The day the competition after `u21` should kick off — one round interval past
 * the last round of the current one, reusing that competition's own spacing so
 * the two runnings stay flush inside the season. */
export function nextU21Kickoff(u21: U21Season, cfg: TuningConfig): number {
  const days = u21.matchDays;
  const interval = days.length > 1 ? days[1] - days[0] : cfg.u21RoundIntervalDays;
  return days[days.length - 1] + interval;
}

export function initAcademyState(state: GameState, cfg: TuningConfig): AcademyState {
  const first = buildU21Season(state, cfg, 0);
  return {
    focusIds: [],
    u21Squad: [],
    loanList: [],
    assignments: [],
    reports: [],
    nextReportDay: state.currentDay + cfg.scoutReportDaysBase,
    u21: first,
    u21Next: buildU21Season(state, cfg, 1, nextU21Kickoff(first, cfg)),
    u21History: [],
    lastIntake: null,
  };
}

// ── Scouting network capacity (v14) ───────────────────────────────────────
// Assignments are capped by HEADCOUNT: a scout can only be in one place at a
// time, so the club can have as many briefs running as it employs scouts. The
// Max Scouts facility now caps how many may be employed (see maxScouts), which
// makes the upgrade the real gate on department size.

export function scoutCapacity(state: GameState, _cfg: TuningConfig): number {
  return assignmentCapacity(state);
}

// ── Intake day (§18) ──────────────────────────────────────────────────────

function rollIntakeProspect(
  state: GameState,
  rng: RNG,
  cfg: TuningConfig,
  opts: { golden: boolean }
): PlayerBio {
  const team = userTeam(state);
  const level = team.academyLevel ?? 0;
  const age = randInt(rng, cfg.intakeAgeMin, cfg.intakeAgeMax);

  // Tiered ratings (v15): an intake prospect is rolled into the same Bronze →
  // Platinum tiers a scout's find uses, so the two pipelines speak one quality
  // language. The academy's own quality — its facility level, youth coach and
  // the club's reputation — plays the role a scout's judgement plays, biasing
  // WHICH tier the kid lands in. A better academy doesn't just add potential
  // points, it turns up better prospects.
  const academyJudgement = Math.max(
    1,
    Math.min(
      5,
      Math.round(
        1 +
          level * 0.6 +
          youthCoachStars(state) * 0.4 +
          (team.reputation - 40) * 0.035 +
          (opts.golden ? 2 : 0)
      )
    )
  );
  const tier = rollProspectTier(rng, cfg, academyJudgement);
  const band = rollTierQuality(rng, cfg, tier);

  // The tier band describes a finished prospect's level; generatePlayer's
  // maturity curve scales it down to what a kid this age can actually do today,
  // so a 14-year-old Gold and a 17-year-old Gold share a ceiling but not a
  // current rating — which is exactly the age realism this pass is after.
  const prodigy = tier === "platinum" || tier === "diamond" || (opts.golden && rng() < 0.5);
  const p = freshId(
    generatePlayer(rng, cfg, { pos: pick(rng, INTAKE_POS_POOL), overall: band.overall, nat: "ENG", age, prodigy })
  );

  let pot = band.potential;
  if (opts.golden) {
    // Golden-generation kids get the elite ceiling regardless of rolled tier.
    pot = Math.max(pot, randRange(rng, cfg.goldenGenPotentialMin, cfg.goldenGenPotentialMax));
  }
  p.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 2, pot)));
  p.value = playerValue(p, cfg);
  p.clubId = team.id;
  p.academyClubId = team.id;
  // The prospect tier stays on the player as an academy label (Gold/Silver/…/
  // Diamond). It's shown while the kid is in the academy and dropped on
  // promotion to the senior squad. Golden-gen kids get the elite ceiling above
  // but keep their rolled tier as the badge.
  p.u21Tier = tier;
  return p;
}

/** The season's intake class arrives (user club only; AI clubs intake at
 * rollover, invisibly). Golden generations are the forever-save lottery. */
export function runIntakeDay(state: GameState, cfg: TuningConfig) {
  const team = userTeam(state);
  const rng = mulberry32(deriveSeed(state.seed, `intake:${state.season}:user`));
  const golden = rng() < cfg.goldenGenChance;
  const level = team.academyLevel ?? 0;
  let size = Math.max(2, Math.round(cfg.intakeClassBase + level * cfg.intakeClassPerLevel + randRange(rng, -0.4, 1.2)));
  if (golden) size += cfg.goldenGenExtra;
  // Never overflow the academy squad-size cap (§18 v7): the intake fills whatever
  // slots remain. If the academy is already full, the class is skipped entirely.
  const room = Math.max(0, academySquadCap(state, team.id, cfg) - (team.academyPlayerIds?.length ?? 0));
  size = Math.min(size, room);
  if (size <= 0) {
    pushInbox(
      state,
      "academy",
      "Intake day: no room in the academy",
      "This year's crop had nowhere to go — the academy is at full capacity. Promote, sell, release, or upgrade Academy Squad Size to make space for next year's intake."
    );
    return;
  }

  const ids: string[] = [];
  const lines: string[] = [];
  for (let i = 0; i < size; i++) {
    const p = rollIntakeProspect(state, rng, cfg, { golden: golden && i < 2 });
    state.players[p.id] = p;
    (team.academyPlayerIds ??= []).push(p.id);
    assignKitNumber(state, p);
    ids.push(p.id);
    lines.push(`${p.name} — ${p.positions[0]}, ${p.age}, ${starRangeLabel(state, p, cfg)}`);
  }
  state.academy.lastIntake = { season: state.season, playerIds: ids, golden };

  const title = golden ? "INTAKE DAY — a golden generation!" : "Intake day: this year's academy class";
  const intro = golden
    ? "The coaches are calling it the best crop in a generation. Clear space — some of these kids are special.\n\n"
    : `${size} prospects join the academy. The coaches' first reads:\n\n`;
  pushInbox(state, "academy", title, intro + lines.join("\n"));
  if (golden) state.news.unshift(`${team.name}'s academy is buzzing about a once-in-a-generation intake class.`);
}

/** A fresh save starts with an academy that can actually enter the season's
 * first U21 competition (v18): enough bodies to register a legal seven, keeper
 * included. Before v18 this seeded three prospects, which meant the opening
 * competition was forfeited before the user could do anything about it. Silent
 * — no inbox. Called from worldgen. */
export function seedInitialAcademy(state: GameState, cfg: TuningConfig) {
  const team = userTeam(state);
  const rng = mulberry32(deriveSeed(state.seed, "intake:0:user"));
  // A couple spare beyond the registration seven, so there is a choice to make
  // rather than a single legal line-up.
  const size = cfg.u21RegistrationSize + 2;
  for (let i = 0; i < size; i++) {
    const p = rollIntakeProspect(state, rng, cfg, { golden: false });
    state.players[p.id] = p;
    (team.academyPlayerIds ??= []).push(p.id);
    assignKitNumber(state, p);
  }
  // Guarantee a keeper — registration is illegal without one, and the intake
  // position pool can easily return none in a small class.
  const players = (team.academyPlayerIds ?? []).map((id) => state.players[id]);
  if (!players.some((p) => p.positions[0] === "GK")) {
    const gk = freshId(
      generatePlayer(rng, cfg, {
        pos: "GK",
        overall: 50 + rng() * 8,
        nat: "ENG",
        age: randInt(rng, cfg.intakeAgeMin, cfg.intakeAgeMax),
      })
    );
    gk.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(gk.overall + 6, 62 + rng() * 18)));
    gk.value = playerValue(gk, cfg);
    gk.clubId = team.id;
    gk.academyClubId = team.id;
    state.players[gk.id] = gk;
    (team.academyPlayerIds ??= []).push(gk.id);
    assignKitNumber(state, gk);
  }
}

/** Invisible AI intake at rollover: keeps every club viable forever (replaces
 * the old emergencyIntake stopgap). Goes straight into senior squads — only the
 * user runs a visible academy — but carries the same graduate tagging. */
export function aiIntake(state: GameState, cfg: TuningConfig, rngSeed: number) {
  const rng = mulberry32(rngSeed);
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    const alive = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
    team.playerIds = alive.map((p) => p.id);
    const needed = 19 - alive.length;
    const hasGk = alive.some((p) => p.positions[0] === "GK");
    for (let i = 0; i < needed; i++) {
      const pos = !hasGk && i === 0 ? "GK" : pick(rng, POS_GROUPS.ANY);
      const p = freshId(
        generatePlayer(rng, cfg, {
          pos,
          overall: 40 + team.reputation * 0.35 + rng() * 6,
          nat: "ENG",
          age: 16 + Math.floor(rng() * 3),
        })
      );
      p.clubId = team.id;
      p.academyClubId = team.id;
      grantDefaultContract(state, p, cfg);
      state.players[p.id] = p;
      team.playerIds.push(p.id);
      assignKitNumber(state, p);
    }
  }
  // the user's own squad still needs the retiree cleanup pass
  const user = userTeam(state);
  user.playerIds = user.playerIds.filter((id) => state.players[id] && !state.players[id].retired);
  user.academyPlayerIds = (user.academyPlayerIds ?? []).filter((id) => state.players[id] && !state.players[id].retired);
}

// ── U21 league sim (§18) ──────────────────────────────────────────────────

// The U21s play 7-a-side. The user's side is locked out of the league until the
// academy can field a full seven: at least one goalkeeper and six outfielders
// (loanees are away, so they don't count toward eligibility).
export const U21_SIDE_SIZE = 7;
export const U21_MIN_GK = 1;
export const U21_MIN_OUTFIELD = 6;

/** Non-loan academy players split into keepers and outfielders — the pool the
 * U21 side is drawn from and the basis for the lock check. */
function u21Pool(state: GameState): { gks: PlayerBio[]; outfield: PlayerBio[] } {
  const avail = academyPlayers(state).filter((p) => !p.loan);
  return {
    gks: avail.filter((p) => p.positions[0] === "GK"),
    outfield: avail.filter((p) => p.positions[0] !== "GK"),
  };
}

/** Whether the academy can field a legal 7-a-side U21 side (≥1 GK, ≥6 outfield).
 * While false the U21 league is locked — no rounds are resolved. */
export function u21Eligible(state: GameState): boolean {
  const { gks, outfield } = u21Pool(state);
  return gks.length >= U21_MIN_GK && outfield.length >= U21_MIN_OUTFIELD;
}

/** How many more players of each kind the academy still needs to unlock the U21s. */
export function u21Shortfall(state: GameState): { gk: number; outfield: number } {
  const { gks, outfield } = u21Pool(state);
  return {
    gk: Math.max(0, U21_MIN_GK - gks.length),
    outfield: Math.max(0, U21_MIN_OUTFIELD - outfield.length),
  };
}

// ── Registration (§18 v18) ────────────────────────────────────────────────
// Each competition opens with a registration window: the club submits exactly
// seven prospects (≥1 GK) before the deadline. Miss it — or fail to field a
// legal seven at all — and a randomly drawn side takes the entry for that
// running. The competition never waits for the user.

/** Whether registration for this competition is still open. */
export function u21RegistrationOpen(state: GameState, u21: U21Season = state.academy.u21): boolean {
  return !u21.forfeited && state.currentDay <= (u21.registrationDay ?? 0);
}

/** Whether the user has a valid seven registered for this competition. */
export function u21Registered(state: GameState, u21: U21Season = state.academy.u21): boolean {
  return (u21.registered?.length ?? 0) === U21_SIDE_SIZE;
}

/** Days left to register, or null once the window has closed. */
export function u21RegistrationDaysLeft(state: GameState, u21: U21Season = state.academy.u21): number | null {
  const left = (u21.registrationDay ?? 0) - state.currentDay;
  return left >= 0 ? left : null;
}

/** Submit the club's seven for the current competition. Validates squad shape
 * (exactly seven, at least one keeper, all fit academy players not out on loan)
 * so a registration can never produce an illegal side. */
export function registerU21Squad(state: GameState, playerIds: string[], cfg: TuningConfig): string | null {
  const u21 = state.academy.u21;
  if (u21.forfeited) return "You forfeited this competition — the next one opens for registration soon.";
  if (!u21RegistrationOpen(state, u21)) return "Registration for this competition has closed.";
  if (playerIds.length !== cfg.u21RegistrationSize) {
    return `Register exactly ${cfg.u21RegistrationSize} prospects — you have ${playerIds.length}.`;
  }
  const academy = new Set(userTeam(state).academyPlayerIds ?? []);
  const players = playerIds.map((id) => state.players[id]);
  if (players.some((p, i) => !p || !academy.has(playerIds[i]))) return "Only academy players can be registered.";
  if (players.some((p) => p.loan)) return "A prospect out on loan can't be registered.";
  if (players.some((p) => p.retired)) return "That prospect has retired.";
  if (new Set(playerIds).size !== playerIds.length) return "Each prospect can only be registered once.";
  if (!players.some((p) => p.positions[0] === "GK")) return "Your seven must include at least one goalkeeper.";
  u21.registered = [...playerIds];
  return null;
}

/** Deadline check, run daily. If the user hasn't registered a legal seven by the
 * close of the window, the entry is forfeited and a randomly drawn side replaces
 * them for the whole competition — the other eleven play on around it. */
export function enforceU21Registration(state: GameState, cfg: TuningConfig) {
  const u21 = state.academy.u21;
  if (u21.forfeited || u21Registered(state, u21)) return;
  if (state.currentDay <= (u21.registrationDay ?? 0)) return; // window still open

  const rng = mulberry32(deriveSeed(state.seed, `u21forfeit:${state.season}:${u21.half ?? 0}`));
  const taken = new Set(u21.opponents.map((o) => o.clubId));
  const replacements = Object.values(state.teams).filter(
    (t) => t.id !== state.userTeamId && !taken.has(t.id) && state.leagues[t.leagueId]?.playable
  );
  const stand = replacements.length ? pick(rng, replacements) : null;
  const name = stand ? `${stand.name} U21` : "Invited XI";

  u21.forfeited = true;
  u21.replacedBy = name;
  u21.registered = [];
  // The replacement inherits the user's slot outright: row 0 becomes their row,
  // so the table still reads as a full twelve and the pairings never change.
  const row = u21.table.find((r) => r.isUser);
  if (row) {
    row.isUser = false;
    row.name = name;
  }
  if (stand) {
    u21.opponents.push({
      name,
      short: stand.short,
      clubId: stand.id,
      strength: cfg.u21OppStrengthBase + stand.reputation * cfg.u21OppStrengthPerRep,
      prospectIds: rollRivalProspects(state, cfg, rng, stand),
      sellStance: pickWeighted(rng, ["willing", "premium", "unwilling"] as const, (s) => cfg.u21SellStanceWeights[s]),
    });
  }
  pushInbox(
    state,
    "academy",
    "U21 entry forfeited — no squad registered",
    `The registration deadline passed without a legal seven submitted, so ${name} have taken our place in this U21 competition. ` +
      `Our prospects sit this one out. Register a squad in good time for the next competition — the Academy → U21 League tab shows the deadline.`
  );
}

/** Circle-method pairings for a 12-team double round-robin. Team 0 = user. */
function roundPairings(round: number): [number, number][] {
  const n = 12;
  const r = round % (n - 1);
  const secondLeg = round >= n - 1;
  const rot = Array.from({ length: n - 1 }, (_, i) => 1 + ((i + r) % (n - 1)));
  const pairs: [number, number][] = [[0, rot[0]]];
  for (let i = 1; i < n / 2; i++) pairs.push([rot[i], rot[n - 1 - i]]);
  return pairs.map(([a, b], i) => {
    const swap = (r + i) % 2 === 0 ? secondLeg : !secondLeg;
    return swap ? [b, a] : [a, b];
  });
}

/** The 7-a-side side the youth coach fields (one keeper + six outfielders).
 *
 * From v18 the REGISTERED seven are the squad — once a competition is under way
 * only those names are eligible, which is the whole point of a registration
 * window. Anyone since sold, released or loaned out simply leaves a hole. Before
 * registration (and on pre-v18 saves) it falls back to the old behaviour: the
 * tagged matchday squad if there is one, else focus prospects then the best of
 * the rest. */
function u21Seven(state: GameState): PlayerBio[] {
  const focus = new Set(state.academy.focusIds);
  const u21 = state.academy.u21;
  let avail = academyPlayers(state).filter((p) => !p.loan);
  if (u21Registered(state, u21)) {
    const reg = new Set(u21.registered);
    avail = avail.filter((p) => reg.has(p.id));
  } else {
    const tagged = new Set(state.academy.u21Squad ?? []);
    if (tagged.size > 0) avail = avail.filter((p) => tagged.has(p.id) || focus.has(p.id));
  }
  const rank = (a: PlayerBio, b: PlayerBio) =>
    (focus.has(b.id) ? 1 : 0) - (focus.has(a.id) ? 1 : 0) || b.overall - a.overall;
  const gks = avail.filter((p) => p.positions[0] === "GK").sort(rank);
  const outfield = avail.filter((p) => p.positions[0] !== "GK").sort(rank);
  const side: PlayerBio[] = [];
  if (gks.length > 0) side.push(gks[0]); // one keeper leads the side
  for (const p of outfield) {
    if (side.length >= U21_SIDE_SIZE) break;
    side.push(p);
  }
  return side.slice(0, U21_SIDE_SIZE);
}

export function userU21Strength(state: GameState, cfg: TuningConfig): number {
  const side = u21Seven(state);
  const total = side.reduce((s, p) => s + p.overall, 0) + (U21_SIDE_SIZE - side.length) * 30;
  return total / U21_SIDE_SIZE + youthCoachStars(state) * cfg.u21CoachStrengthPerStar;
}

/** Projected U21 role for an academy player — how many minutes they'll get.
 * The youth coach fields focus prospects first, then the best of the rest, so
 * this is the same logic the sim uses (u21Seven). Loanees are away entirely. */
export type U21Role = "Starter" | "Rotation" | "Bench" | "On loan";
export function u21RoleFor(state: GameState, playerId: string): U21Role {
  const p = state.players[playerId];
  if (!p) return "Bench";
  if (p.loan) return "On loan";
  const side = u21Seven(state);
  const idx = side.findIndex((x) => x.id === playerId);
  if (idx === -1) return "Bench";
  // focus prospects + the top of the side are nailed-on starters; the tail rotates
  if (state.academy.focusIds.includes(playerId) || idx < 5) return "Starter";
  return "Rotation";
}

const U21_SCORER_WEIGHT: Partial<Record<Pos, number>> = {
  ST: 4, LW: 2.5, RW: 2.5, AM: 2, LM: 1.5, RM: 1.5, CM: 1, DM: 0.5, CB: 0.4, LB: 0.4, RB: 0.4, GK: 0.05,
};

function tableRowFor(u21: U21Season, teamIdx: number): U21TableRow {
  return u21.table[teamIdx];
}

function applyU21Score(u21: U21Season, homeIdx: number, awayIdx: number, hg: number, ag: number) {
  const h = tableRowFor(u21, homeIdx);
  const a = tableRowFor(u21, awayIdx);
  h.played++; a.played++;
  h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
  if (hg > ag) { h.won++; a.lost++; h.points += 3; }
  else if (hg < ag) { a.won++; h.lost++; a.points += 3; }
  else { h.drawn++; a.drawn++; h.points++; a.points++; }
}

/** Resolve any due U21 rounds. Statistical, zero-interaction: scorelines from
 * strength shares, minutes/goals/ratings credited to academy players'
 * youthStats. Never touches fitness or the real match engine. Catch-up loop so
 * a mid-season migrated save (or any skipped day) can't strand the season. */
export function runU21MatchDay(state: GameState, cfg: TuningConfig) {
  // The registration deadline is checked first so a competition that kicks off
  // today already knows whether the user is in it.
  enforceU21Registration(state, cfg);
  let u21 = state.academy.u21;
  while (u21.roundsPlayed < u21.matchDays.length && u21.matchDays[u21.roundsPlayed] <= state.currentDay) {
    resolveU21Round(state, cfg, u21.roundsPlayed++);
  }
  // Competition over: file the review and roll the next one in (v18). The loop
  // repeats so a long skipped stretch can't strand a whole competition.
  while (u21.roundsPlayed >= u21.matchDays.length && advanceU21Competition(state, cfg)) {
    u21 = state.academy.u21;
    enforceU21Registration(state, cfg);
    while (u21.roundsPlayed < u21.matchDays.length && u21.matchDays[u21.roundsPlayed] <= state.currentDay) {
      resolveU21Round(state, cfg, u21.roundsPlayed++);
    }
  }
}

/** Drop a retired competition's rival prospects from the world.
 *
 * These exist only so the user can scout that competition's registered sides; a
 * competition generates 77 of them and two run per season, so keeping them would
 * add ~150 dead player records to the save every year. Anyone the user actually
 * signed has moved to their academy (clubId changed) and is skipped, as is
 * anyone with career history worth preserving. */
function releaseU21Prospects(state: GameState, u21: U21Season) {
  for (const o of u21.opponents) {
    for (const id of o.prospectIds ?? []) {
      const p = state.players[id];
      // still at the club that registered him, and never transacted → disposable
      if (!p || p.clubId !== o.clubId) continue;
      if (state.careers[id]?.transfers?.length) continue;
      delete state.players[id];
      const club = state.teams[o.clubId ?? ""];
      if (club) club.playerIds = club.playerIds.filter((x) => x !== id);
    }
    o.prospectIds = [];
  }
}

/** Retire the finished competition into history and promote the next one. Returns
 * false when the season has no competition left to run — the rollover builds the
 * next season's pair. */
function advanceU21Competition(state: GameState, cfg: TuningConfig): boolean {
  const ac = state.academy;
  // Nothing to promote: the season's last competition stays in place, finished,
  // until the rollover builds next season's pair. Retiring it here would re-file
  // its review and re-push it into history on every subsequent day.
  if (!ac.u21Next) return false;
  const done = ac.u21;
  fileU21Review(state, done);
  releaseU21Prospects(state, done);
  (ac.u21History ??= []).push(done);
  ac.u21 = ac.u21Next;
  ac.u21Next = undefined;
  // Youth stats are cumulative across the season by design (they feed one
  // development pass at rollover), so nothing is cleared between competitions —
  // only the registration slate is new.
  pushInbox(
    state,
    "academy",
    "U21 registration open — second competition",
    `The season's second U21 competition kicks off soon. Register ${cfg.u21RegistrationSize} prospects before the deadline ` +
      `or our place goes to another club. Academy → U21 League.`
  );
  return true;
}

/** The end-of-competition inbox review (was the end-of-season review pre-v18). */
function fileU21Review(state: GameState, u21: U21Season) {
  if (u21.roundsPlayed <= 0) return;
  const label = `U21 competition ${(u21.half ?? 0) + 1}`;
  if (u21.forfeited) {
    pushInbox(
      state,
      "academy",
      `${label}: forfeited`,
      `We took no part — ${u21.replacedBy ?? "another club"} filled our place. The prospects lost a half-season of competitive minutes.`
    );
    return;
  }
  const pos = u21.table.findIndex((r) => r.isUser) + 1;
  const suffix = pos === 1 ? "st" : pos === 2 ? "nd" : pos === 3 ? "rd" : "th";
  const topKid = academyPlayers(state)
    .filter((p) => p.youthStats?.apps)
    .sort((a, b) => (b.youthStats!.goals || 0) - (a.youthStats!.goals || 0))[0];
  pushInbox(
    state,
    "academy",
    `${label} review: ${pos}${suffix}`,
    `The U21s finished ${pos}${suffix} of 12.` +
      (topKid?.youthStats?.goals ? ` Top scorer: ${topKid.name} with ${topKid.youthStats.goals}.` : "") +
      (pos === 1 ? " Champions — the academy is producing." : "")
  );
}

function resolveU21Round(state: GameState, cfg: TuningConfig, round: number) {
  const u21 = state.academy.u21;
  const rng = mulberry32(deriveSeed(state.seed, `u21:${state.season}:${u21.half ?? 0}:r${round}`));
  // On a forfeit the replacement side occupies slot 0 and plays the full card as
  // an ordinary opponent — the league is always a full twelve.
  const standIn = u21.forfeited ? u21.opponents[u21.opponents.length - 1] : null;
  const strengthOf = (idx: number) =>
    idx === 0 ? standIn?.strength ?? userU21Strength(state, cfg) : u21.opponents[idx - 1].strength;
  // The user's fixtures only count while the academy can field a legal seven.
  // While locked, their matches are skipped (no result, no youth minutes) —
  // the rest of the league plays on around the empty slot.
  const eligible = u21Eligible(state);

  for (const [homeIdx, awayIdx] of roundPairings(round)) {
    // Slot 0 is only "the user's match" while they still hold the entry.
    const userMatch = (homeIdx === 0 || awayIdx === 0) && !u21.forfeited;
    if (userMatch && !eligible) continue; // U21 league locked for the user

    const sh = strengthOf(homeIdx) + 2; // small youth home edge
    const sa = strengthOf(awayIdx);
    const share = Math.pow(sh, 2.2) / (Math.pow(sh, 2.2) + Math.pow(sa, 2.2));
    const hg = randPoisson(rng, cfg.u21GoalsPerMatch * share);
    const ag = randPoisson(rng, cfg.u21GoalsPerMatch * (1 - share));
    applyU21Score(u21, homeIdx, awayIdx, hg, ag);

    if (!userMatch) continue;

    // the user's match: credit minutes, goals and ratings to the side
    const home = homeIdx === 0;
    const [gf, ga] = home ? [hg, ag] : [ag, hg];
    const eleven = u21Seven(state);
    const scorers: string[] = [];
    const outfield = eleven.filter((p) => p.positions[0] !== "GK");
    for (let g = 0; g < gf && outfield.length; g++) {
      const scorer = pickWeighted(rng, outfield, (p) => (U21_SCORER_WEIGHT[p.positions[0]] ?? 1) * (p.overall / 50));
      (scorer.youthStats ??= { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 }).goals += 1;
      scorers.push(scorer.name);
    }
    const perf = gf - ga;
    for (const p of eleven) {
      const ys = (p.youthStats ??= { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 });
      ys.apps += 1;
      ys.minutes += 90;
      const goals = scorers.filter((n) => n === p.name).length;
      const rating = Math.min(10, Math.max(4, 6.4 + perf * 0.15 + goals * 0.7 + randRange(rng, -0.5, 0.6)));
      ys.ratingSum += Math.round(rating * 10) / 10;
    }
    const oppName = u21.opponents[(home ? awayIdx : homeIdx) - 1].name;
    u21.results.push({ day: u21.matchDays[round], opponent: oppName, home, gf, ga, scorers });

    // standouts stream past as ticker news, never an interrupt
    const hatTrick = scorers.find((n) => scorers.filter((x) => x === n).length >= 3);
    if (hatTrick) state.news.unshift(`U21s: ${hatTrick} hits a hat-trick against ${oppName}.`);
    else if (gf - ga >= 4) state.news.unshift(`U21s put ${gf} past ${oppName}.`);
  }
  u21.table.sort((a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf);
}

/** Tag/untag an academy player into the U21 matchday squad. Only academy
 * players can be tagged; a tagged squad overrides auto-selection in the U21
 * league (focus prospects always start regardless). */
export function toggleU21Squad(state: GameState, playerId: string): string | null {
  const ac = state.academy;
  ac.u21Squad ??= [];
  if (!(userTeam(state).academyPlayerIds ?? []).includes(playerId)) {
    return "Only academy players can be added to the U21 squad.";
  }
  if (ac.u21Squad.includes(playerId)) {
    ac.u21Squad = ac.u21Squad.filter((id) => id !== playerId);
  } else {
    ac.u21Squad.push(playerId);
  }
  return null;
}

/** How many focus prospects the user may flag: base slots + the Focus Slots
 * facility level, capped at the absolute u21FocusMax. */
export function focusSlots(state: GameState, cfg: TuningConfig): number {
  const level = userTeam(state).focusSlotLevel ?? 0;
  return Math.min(cfg.u21FocusMax, cfg.u21FocusBase + level);
}

/** Flag/unflag a focus prospect (up to focusSlots): guaranteed U21 starts + coach attention. */
export function toggleFocus(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const ac = state.academy;
  if (ac.focusIds.includes(playerId)) {
    ac.focusIds = ac.focusIds.filter((id) => id !== playerId);
    return null;
  }
  if (!(userTeam(state).academyPlayerIds ?? []).includes(playerId)) return "Only academy players can be focus prospects.";
  const cap = focusSlots(state, cfg);
  if (ac.focusIds.length >= cap) return `You can only focus on ${cap} prospects at a time — upgrade Focus Slots for more.`;
  ac.focusIds.push(playerId);
  return null;
}

// ── Squad moves ───────────────────────────────────────────────────────────

export function promoteToSenior(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const team = userTeam(state);
  const academy = team.academyPlayerIds ?? [];
  if (!academy.includes(playerId)) return "Not an academy player.";
  const prospect = state.players[playerId];
  // Age gate (§18 v7): a prospect can't step up to the senior team until they turn
  // academyPromoteMinAge — the youngest kids develop in the academy/U21s first.
  if (prospect && prospect.age < cfg.academyPromoteMinAge) {
    return `Too young to promote — prospects join the senior squad at ${cfg.academyPromoteMinAge}.`;
  }
  if (prospect?.loan) return "Recall the loan first.";
  // A prospect registered for the U21 competition is locked to that side for the
  // duration — promoting mid-competition would pull him from a squad he can no
  // longer be replaced in, so the registration bars the promotion until it lapses.
  if ((state.academy.u21.registered ?? []).includes(playerId)) {
    return "Registered for the U21 competition — he can't be promoted until the next registration window.";
  }
  // No senior squad cap (v14) — promotion is a football decision, not a slot
  // hunt. The academy squad cap is still the pipeline's real constraint.
  team.academyPlayerIds = academy.filter((id) => id !== playerId);
  team.playerIds.push(playerId);
  state.academy.focusIds = state.academy.focusIds.filter((id) => id !== playerId);
  state.academy.u21Squad = (state.academy.u21Squad ?? []).filter((id) => id !== playerId);
  // A promoted graduate signs his first professional deal (§10 v5 contracts)
  // and takes a senior shirt (the academy and senior squads number separately).
  const p = state.players[playerId];
  if (p && !p.contract) grantDefaultContract(state, p, cfg);
  if (p) {
    clearKitNumber(p);
    assignKitNumber(state, p);
    // The prospect tier (Gold/Silver/…/Diamond) is an academy label — it comes
    // off the moment the player joins the senior squad.
    delete p.u21Tier;
  }
  return null;
}

export function demoteToAcademy(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const team = userTeam(state);
  const p = state.players[playerId];
  if (!team.playerIds.includes(playerId)) return "Not in the senior squad.";
  if (!p || p.age > cfg.academyMaxAge) return `Only players ${cfg.academyMaxAge} or younger can join the academy squad.`;
  team.playerIds = team.playerIds.filter((id) => id !== playerId);
  (team.academyPlayerIds ??= []).push(playerId);
  clearKitNumber(p);
  assignKitNumber(state, p);
  for (const [slot, id] of Object.entries(state.lineup)) {
    if (id === playerId) delete state.lineup[slot];
  }
  return null;
}

export function releaseFromAcademy(state: GameState, playerId: string): string | null {
  const team = userTeam(state);
  const p = state.players[playerId];
  if (!(team.academyPlayerIds ?? []).includes(playerId) || !p) return "Not an academy player.";
  team.academyPlayerIds = (team.academyPlayerIds ?? []).filter((id) => id !== playerId);
  state.academy.focusIds = state.academy.focusIds.filter((id) => id !== playerId);
  state.academy.u21Squad = (state.academy.u21Squad ?? []).filter((id) => id !== playerId);
  state.academy.loanList = state.academy.loanList.filter((id) => id !== playerId);
  p.clubId = null;
  p.loan = undefined;
  clearKitNumber(p);
  if (!state.careers[playerId]) state.careers[playerId] = { playerId, seasons: [], transfers: [] };
  state.careers[playerId].transfers.push({ season: state.season, day: state.currentDay, from: team.name, to: "Released", fee: 0, fromId: team.id });
  return null;
}

// ── Youth scouting (§18, v5): a department of scouts on country assignments ─
// The user hires Scouts as staff and the Scouting Network facility sets how
// many can be out at once (scoutCapacity). Each assignment points a scout at a
// country + position focus; several may share a country. Reports arrive per
// assignment on their own cadence.

/** Days until a scout's next report. Experience is what makes a scout quick as
 * well as thorough, so the cadence keys off that rating; with no scout named
 * (legacy saves, season reset) the best experience on the books stands in. */
function reportCadence(state: GameState, cfg: TuningConfig, scout?: Scout): number {
  const experience = scout?.experience ?? userScouts(state).reduce((b, s) => Math.max(b, s.experience), 0);
  return Math.max(10, cfg.scoutReportDaysBase - experience * cfg.scoutReportDaysPerStar);
}

/** Add a new scout assignment if there's spare capacity. The full brief (region,
 * position group, and optional archetype focus) is locked in at send time (§18 v7)
 * — it isn't edited afterwards; recall the scout and re-send to change the brief. */
export function addScoutAssignment(
  state: GameState,
  region: ScoutRegion,
  positions: ScoutPosGroup,
  cfg: TuningConfig,
  archetypes: string[] = [],
  scoutId?: string,
  durationMonths?: number
): string | null {
  const ac = state.academy;
  if (!hasScout(state)) return "Hire a scout in the Academy → Staff tab before sending one out.";
  // A brief belongs to one scout — their experience sets the batch size and
  // their judgement the quality of what comes back. Pick the named scout if one
  // was chosen, otherwise the first one not already out on a trip.
  const free = idleScouts(state);
  const scout = scoutId ? free.find((s) => s.id === scoutId) : free[0];
  if (!scout) {
    return scoutId
      ? "That scout is already out on an assignment."
      : "Every scout is already out — recall one, or hire more (Max Scouts caps the department).";
  }
  // The user may cap the trip's length (v25): a scout sent for N months files
  // reports until the window closes, then comes home automatically. 0/undefined
  // means open-ended — the scout stays out until recalled.
  const months = durationMonths && durationMonths > 0 ? Math.round(durationMonths) : undefined;
  ac.assignments.push({
    id: uid("asg"),
    scoutId: scout.id,
    region,
    positions,
    archetypes: archetypes.length ? [...archetypes] : undefined,
    nextReportDay: state.currentDay + 7 + Math.round(reportCadence(state, cfg, scout) * 0.4),
    durationMonths: months,
    endsDay: months ? state.currentDay + months * DAYS_PER_MONTH : undefined,
  });
  return null;
}

/** Calendar days a scouting "month" stands for (v25). Assignment durations are
 * chosen in months and stored as an end day; the sim's day counter is calendar
 * days, so a month is ~30 of them. */
const DAYS_PER_MONTH = 30;

export function updateScoutAssignment(
  state: GameState,
  id: string,
  patch: Partial<Pick<ScoutAssignment, "region" | "positions" | "archetypes">>
) {
  const a = state.academy.assignments.find((x) => x.id === id);
  if (a) Object.assign(a, patch);
}

export function removeScoutAssignment(state: GameState, id: string) {
  state.academy.assignments = state.academy.assignments.filter((a) => a.id !== id);
}

/** End every assignment whose fixed duration has elapsed (v25). The scout is
 * brought home (its brief removed, freeing the slot) and a single note per
 * finished trip lands in the inbox. Open-ended briefs (no `endsDay`) are left
 * alone — only a duration the user set can expire. */
export function expireScoutAssignments(state: GameState) {
  const done = state.academy.assignments.filter(
    (a) => a.endsDay !== undefined && state.currentDay > a.endsDay
  );
  if (!done.length) return;
  state.academy.assignments = state.academy.assignments.filter(
    (a) => a.endsDay === undefined || state.currentDay <= a.endsDay
  );
  for (const a of done) {
    const scout = scoutById(state, a.scoutId);
    const who = scout?.name ?? "The scout";
    pushInbox(
      state,
      "scout",
      `${who} returns from ${a.region}`,
      `${who} has completed the ${a.durationMonths ?? ""}${a.durationMonths ? "-month " : ""}assignment in ${a.region} and is back at the club. ` +
        `Any prospects they filed are still on the board until the trail goes cold — send them out again from the Academy screen whenever you're ready.`
    );
  }
}

/** Keep the assignment list honest (v14): every brief must belong to a scout
 * still on the books, and one scout can only hold one brief. Runs after hiring
 * changes and at rollover, so a fired scout's trip ends with them. */
export function clampScoutAssignments(state: GameState, cfg: TuningConfig) {
  const roster = new Set(userScouts(state).map((s) => s.id));
  const taken = new Set<string>();
  state.academy.assignments = state.academy.assignments.filter((a) => {
    if (!a.scoutId || !roster.has(a.scoutId) || taken.has(a.scoutId)) return false;
    taken.add(a.scoutId);
    return true;
  });
  const cap = scoutCapacity(state, cfg);
  if (state.academy.assignments.length > cap) {
    state.academy.assignments = state.academy.assignments.slice(0, cap);
  }
}

/** Resolve the (position, archetype) a scout report should surface from an
 * assignment's brief. The position is drawn from the position group; if the
 * assignment carries an archetype focus, both the position and the archetype are
 * constrained to that focus (falling back to the plain group if the brief can't
 * be honoured for the rolled group). */
function briefTarget(a: ScoutAssignment, rng: RNG): { pos: Pos; archetypeId?: string } {
  const focus = a.archetypes ?? [];
  if (focus.length === 0) return { pos: pick(rng, POS_GROUPS[a.positions]) };
  // archetypes in the focus that also sit in the requested position group
  const groupPositions = new Set(POS_GROUPS[a.positions]);
  const eligible = focus
    .map((id) => getArchetype(id))
    .filter((arch) => arch.positions.some((p) => groupPositions.has(p)));
  if (eligible.length === 0) return { pos: pick(rng, POS_GROUPS[a.positions]) };
  const arch = pick(rng, eligible);
  const pos = pick(rng, arch.positions.filter((p) => groupPositions.has(p)));
  return { pos, archetypeId: arch.id };
}

/** How many prospects a scout brings back in one report (v14). Driven by the
 * scout's EXPERIENCE through the tuning distribution — a 1★ scout files a
 * single name almost every time, a 5★ scout returns the full seven about half
 * the time. Sampled per report, so batch size varies trip to trip. */
export function prospectsPerReport(rng: RNG, cfg: TuningConfig, scout: Scout): number {
  return rollReportSize(rng, cfg, scout.experience);
}

/** Build one prospect for a report. The scout's JUDGEMENT rolls a quality tier
 * (Bronze → Platinum), and the tier's band supplies both the ability the kid
 * arrives with and the ceiling they're given — that's the whole quality story
 * for a scouted find. A platinum is the wonderkid. */
function generateScoutReport(
  state: GameState,
  cfg: TuningConfig,
  a: ScoutAssignment,
  rng: RNG,
  batch: number,
  scout: Scout
): ProspectReport {
  const { pos, archetypeId } = briefTarget(a, rng);
  const nat = pick(rng, regionNats(a.region));
  const age = randInt(rng, cfg.scoutProspectAgeMin, cfg.scoutProspectAgeMax);
  const tier = rollProspectTier(rng, cfg, scout.judgement);
  const band = rollTierQuality(rng, cfg, tier);
  // Platinum and diamond finds are generational, so they take the prodigy path
  // through worldgen — that's what lets a teenager keep a genuinely high overall
  // instead of being pulled back to the age soft cap.
  const prodigy = tier === "platinum" || tier === "diamond";
  const p = freshId(generatePlayer(rng, cfg, { pos, overall: band.overall, nat, age, prodigy, archetypeId }));
  p.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 3, band.potential)));
  p.value = playerValue(p, cfg);
  return {
    id: uid("rep"),
    player: p,
    // Academy signings are free (v11) — kept on the type at 0 so old saves and
    // the career ledger still read cleanly.
    fee: 0,
    day: state.currentDay,
    expiresDay: state.currentDay + cfg.scoutReportExpiryDays,
    region: a.region,
    assignmentId: a.id,
    batch,
    tier,
    scoutId: scout.id,
  };
}

/** Daily tick: expire stale reports; each due assignment files a new batch of
 * prospects. No scout hired or no assignments → the pipeline stays quiet.
 *
 * Reports ACCUMULATE (v12): a scout's earlier finds stay on the board while
 * later ones land, so a shortlist builds up over a window. Nothing clears a
 * report but its own expiry, the user signing or passing on it, or the season
 * rollover — a new batch never displaces the last one. */
export function dailyScoutTick(state: GameState, cfg: TuningConfig) {
  const ac = state.academy;
  ac.reports = ac.reports.filter((r) => r.expiresDay > state.currentDay);
  if (!hasScout(state) || ac.assignments.length === 0) return;
  clampScoutAssignments(state, cfg);

  // Auto-end any assignment whose fixed window has closed (v25). The scout comes
  // home and the brief is removed so its slot frees up; a short note lets the
  // user know the trip is over and the scout is available again.
  expireScoutAssignments(state);

  for (const a of ac.assignments) {
    if (a.endsDay !== undefined && state.currentDay > a.endsDay) continue;
    if (state.currentDay < a.nextReportDay) continue;
    const scout = scoutById(state, a.scoutId);
    if (!scout) continue; // clamped away next pass
    const rng = mulberry32(deriveSeed(state.seed, `scout:${a.id}:${state.currentDay}`));
    const batch = (a.reportsFiled ?? 0) + 1;
    a.reportsFiled = batch;

    // Batch size is the scout's experience (v14); each find's quality is their
    // judgement. The two ratings answer different questions, so a thorough but
    // undiscerning scout returns seven ordinary names.
    const count = prospectsPerReport(rng, cfg, scout);
    const found: ProspectReport[] = [];
    for (let i = 0; i < count; i++) {
      const report = generateScoutReport(state, cfg, a, rng, batch, scout);
      ac.reports.push(report);
      found.push(report);
    }
    a.nextReportDay = state.currentDay + reportCadence(state, cfg, scout) + randInt(rng, -3, 4);

    const regionLabel = a.region;
    const tierName = (r: ProspectReport) => (r.tier ? r.tier.toUpperCase() : "");
    const lines = found
      .map(
        (r) =>
          `${r.player.name} — ${r.player.positions[0]}, age ${r.player.age}, ${r.player.nationality}` +
          `${r.tier ? ` [${tierName(r)}]` : ""}, potential ${starRangeLabel(state, r.player, cfg)}`
      )
      .join("\n\n");
    // A diamond outranks a platinum for the headline — it's the once-a-career
    // find, so it should never be buried under an ordinary shortlist title.
    const diamond = found.find((r) => r.tier === "diamond");
    const best = diamond ?? found.find((r) => r.tier === "platinum");
    const title = diamond
      ? `Scout report: a generational talent in ${regionLabel} — ${diamond.player.name}`
      : best
      ? `Scout report: a special one in ${regionLabel} — ${best.player.name}`
      : found.length === 1
        ? `Scout report: ${found[0].player.name} (${found[0].player.positions[0]}, ${found[0].player.age})`
        : `Scout report: ${found.length} prospects from ${regionLabel}`;
    const intro =
      found.length === 1
        ? `${scout.name} files from ${regionLabel}:\n\n`
        : `${scout.name} files a shortlist of ${found.length} from ${regionLabel}:\n\n`;
    pushInbox(
      state,
      "scout",
      title,
      `${intro}${lines}\n\nNo fee — they'd join the academy on youth terms. ` +
        `The trail goes cold in ${cfg.scoutReportExpiryDays} days. Sign them from the Academy screen.`,
      found[0].id
    );
    if (best) {
      state.news.unshift(`${scout.name} has found something special in ${regionLabel}: ${best.player.name}, ${best.player.age}.`);
    }
  }
}

/** Sign a scouted prospect into the academy. Youth signings are deliberately
 * window-free (§18) — the fee is the only gate. */
export function signProspect(state: GameState, reportId: string, cfg: TuningConfig): string | null {
  const ac = state.academy;
  const report = ac.reports.find((r) => r.id === reportId);
  if (!report || report.expiresDay <= state.currentDay) return "That trail has gone cold.";
  const team = userTeam(state);
  if ((team.academyPlayerIds?.length ?? 0) >= academySquadCap(state, team.id, cfg)) {
    return "Academy is full — release a prospect or upgrade Academy Squad Size to sign more.";
  }
  // Academy prospects are free to sign (v11). Scouting is its own investment —
  // the scout wage, the network facility, and the academy squad cap are the
  // gates. Charging a fee on top made the whole pipeline feel like a worse
  // transfer market. The squad cap above is now the only limit.
  const p = report.player;
  p.clubId = team.id;
  p.academyClubId = team.id;
  // Carry the scout's prospect tier onto the player as its academy rarity badge,
  // so a scouted signing wears the same Bronze→Diamond label an intake kid does
  // — and keeps it until promotion clears it (parity with runIntakeDay above).
  if (report.tier) p.u21Tier = report.tier;
  state.players[p.id] = p;
  (team.academyPlayerIds ??= []).push(p.id);
  assignKitNumber(state, p);
  state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
  state.careers[p.id].transfers.push({ season: state.season, day: state.currentDay, from: "Youth football", to: team.name, fee: 0, toId: team.id });
  ac.reports = ac.reports.filter((r) => r.id !== reportId);
  state.news.unshift(`${team.name} sign ${p.age}-year-old ${p.name} for the academy.`);
  return null;
}

export function dismissReport(state: GameState, reportId: string) {
  state.academy.reports = state.academy.reports.filter((r) => r.id !== reportId);
}

// ── Rival U21 prospects (§18 v18) ─────────────────────────────────────────
// Every side in the U21 league registered seven of its own kids, and they can be
// approached. Unlike a scout's find these cost real money and can simply be
// refused: a club's stance decides whether it deals at a fair price, holds out
// for a premium, or won't sell at all — and the elite tiers multiply on top, so
// prising away a platinum or diamond is meant to be a genuine coup.

/** The U21 side an opponent index or club id belongs to, if it's in this
 * competition. Looked up by name because the table row is what the UI clicks. */
export function u21OpponentByName(state: GameState, name: string): U21Opponent | null {
  return state.academy.u21.opponents.find((o) => o.name === name) ?? null;
}

/** The seven prospects a rival side registered, best first. Retired or already
 * transferred-away players are filtered out so the list always reads true. */
export function u21OpponentProspects(state: GameState, opp: U21Opponent): PlayerBio[] {
  return (opp.prospectIds ?? [])
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired && p.clubId === opp.clubId)
    .sort((a, b) => b.potential - a.potential || b.overall - a.overall);
}

export interface U21ProspectQuote {
  /** What the club wants for him, or null if they simply won't deal. */
  price: number | null;
  stance: U21SellStance;
  /** Player-facing explanation of the stance — shown on the approach button. */
  note: string;
}

/** What a rival wants for one of its registered prospects. Deterministic per
 * (player, season) so a quote can't be re-rolled by reopening the screen. */
export function u21ProspectQuote(
  state: GameState,
  opp: U21Opponent,
  p: PlayerBio,
  cfg: TuningConfig
): U21ProspectQuote {
  const stance = opp.sellStance ?? "willing";
  const clubName = state.teams[opp.clubId ?? ""]?.name ?? opp.name;
  if (stance === "unwilling") {
    return {
      price: null,
      stance,
      note: `${clubName} are not selling their prospects at any price.`,
    };
  }
  // Elite kids are multiplied on top of the stance — that is what makes the top
  // of the tier ladder hard to buy rather than merely expensive.
  const tierMult =
    p.u21Tier === "diamond" ? cfg.u21SellDiamondMult : p.u21Tier === "platinum" ? cfg.u21SellPlatinumMult : 1;
  const stanceMult = stance === "premium" ? cfg.u21SellPricePremiumMult : cfg.u21SellPriceWillingMult;
  const price = Math.round((playerValue(p, cfg) * stanceMult * tierMult) / 1000) * 1000;
  return {
    price,
    stance,
    note:
      stance === "premium"
        ? `${clubName} will listen, but they know what they have.`
        : `${clubName} would do business at the right price.`,
  };
}

/** Approach a rival for one of its registered U21 prospects. Success moves him
 * straight into the user's academy for the quoted fee; a refusal costs nothing
 * but the answer, and is deterministic per player per season so it can't be
 * re-rolled by asking again the same year. */
export function signU21Prospect(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const u21 = state.academy.u21;
  const opp = u21.opponents.find((o) => (o.prospectIds ?? []).includes(playerId));
  const p = state.players[playerId];
  if (!opp || !p) return "That prospect is no longer registered in this competition.";
  if (p.clubId !== opp.clubId) return `${p.name} has already left ${opp.name}.`;

  const team = userTeam(state);
  if ((team.academyPlayerIds?.length ?? 0) >= academySquadCap(state, team.id, cfg)) {
    return "Academy is full — release a prospect or upgrade Academy Squad Size to sign more.";
  }
  const quote = u21ProspectQuote(state, opp, p, cfg);
  if (quote.price === null) return `${opp.name} refuse to discuss their prospects.`;
  if (team.budget < quote.price) return `Not enough budget — ${opp.name} want ${formatFee(quote.price)}.`;

  // Even a willing seller keeps a few kids back. Seeded per player per season so
  // the answer is the same however many times it is asked this year.
  const refuse = mulberry32(deriveSeed(state.seed, `u21buy:${state.season}:${p.id}`))();
  if (refuse < cfg.u21SellRefusalChance) {
    return `${opp.name} have taken ${p.name} off the market — he's part of their plans.`;
  }

  const from = state.teams[opp.clubId ?? ""];
  team.budget -= quote.price;
  if (from) from.budget += quote.price;

  // He leaves the rival's registered seven and joins the user's academy. His
  // academyClubId is NOT rewritten — he came through their academy, and the
  // Academy DNA ledger should keep saying so.
  opp.prospectIds = (opp.prospectIds ?? []).filter((id) => id !== playerId);
  if (from) from.playerIds = from.playerIds.filter((id) => id !== playerId);
  p.clubId = team.id;
  (team.academyPlayerIds ??= []).push(p.id);
  assignKitNumber(state, p);
  state.careers[p.id] ??= { playerId: p.id, seasons: [], transfers: [] };
  state.careers[p.id].transfers.push({
    season: state.season,
    day: state.currentDay,
    from: from?.name ?? opp.name,
    to: team.name,
    fee: quote.price,
    fromId: from?.id ?? opp.clubId,
    toId: team.id,
  });
  pushInbox(
    state,
    "academy",
    `${p.name} joins the academy from ${opp.name}`,
    `We've agreed ${formatFee(quote.price)} with ${from?.name ?? opp.name} for ${p.age}-year-old ${p.name} ` +
      `(${p.positions[0]}, ${starRangeLabel(state, p, cfg)}). He goes straight into the academy — ` +
      `register him for the U21s to get him playing.`
  );
  state.news.unshift(`${team.name} land ${p.name}, ${p.age}, from ${from?.name ?? opp.name}'s academy.`);
  return null;
}

function formatFee(n: number): string {
  return n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : `£${Math.round(n / 1000)}k`;
}

// ── Loans out (§18) ───────────────────────────────────────────────────────

function isUserPlayer(state: GameState, playerId: string): boolean {
  const t = userTeam(state);
  return t.playerIds.includes(playerId) || (t.academyPlayerIds ?? []).includes(playerId);
}

/** List/unlist a player for loan. Academy prospects go out on development loans
 * for minutes; senior players (v14) can be loaned out too — same machinery,
 * same weekly AI uptake, so a squad player you can't sell can still leave for a
 * season. Being listed is a visibility flag, not a queue: it tells other clubs
 * he's available and they come to you. */
export function toggleLoanList(state: GameState, playerId: string, _cfg: TuningConfig): string | null {
  const ac = state.academy;
  if (ac.loanList.includes(playerId)) {
    ac.loanList = ac.loanList.filter((id) => id !== playerId);
    return null;
  }
  const p = state.players[playerId];
  if (!p || !isUserPlayer(state, playerId)) return "Not your player.";
  if (p.loan) return "Already out on loan.";
  if (p.retired) return "That player has retired.";
  ac.loanList.push(playerId);
  return null;
}

function loanWeightFor(state: GameState, club: Team, cfg: TuningConfig): number {
  const league = state.leagues[club.leagueId];
  if (!league?.playable) return cfg.loanMinutesWeightSim;
  return league.tier === 1 ? cfg.loanMinutesWeightTop : cfg.loanMinutesWeightSecond;
}

// ── Direct academy loans (§18 v1.44) ──────────────────────────────────────
// Rather than list a prospect and wait for the weekly AI tick, the user can
// send an academy player out on the spot: the game finds clubs across the whole
// world — every playable and sim-only league — that can and want a development
// loanee, and the user picks one. The parent club keeps paying the wages, so a
// suitor is never priced out; the only thing that varies is the FIT — a club
// wants a prospect roughly a rung below its own level, where he'd actually play.

export interface LoanSuitor {
  clubId: string;
  name: string;
  short: string;
  colors: [string, string];
  reputation: number;
  leagueName: string;
  /** Projected role at this club, from the rep gap — the pitch to the user. */
  role: "Regular starter" | "Squad rotation";
  /** Development weight of a minute here (higher tier = more valuable). */
  minutesWeight: number;
}

/** Up to five clubs, across every league, that would take this academy prospect
 * on a development loan. A prospect goes out to get minutes, so the ideal home
 * sits a rung below him (targetRep = overall + margin) and a club well above his
 * level is dropped — he'd only warm their bench. Deterministic per player/day so
 * the same click always offers the same five until something changes. */
export function academyLoanSuitors(state: GameState, playerId: string, cfg: TuningConfig): LoanSuitor[] {
  const p = state.players[playerId];
  if (!p) return [];
  const rng = mulberry32(deriveSeed(state.seed, `loanpick:${playerId}:${state.currentDay}`));
  const targetRep = p.overall + cfg.academyLoanRepMargin;
  const suitors = Object.values(state.teams)
    .filter((t) => t.id !== state.userTeamId)
    // A prospect learns nothing warming the bench of a side far above him, so
    // clubs more than a band over his level don't come into it.
    .filter((t) => t.reputation <= p.overall + cfg.academyLoanRepCeiling)
    .map((t) => {
      const gap = Math.abs(t.reputation - targetRep);
      // small deterministic jitter so equally-good fits don't always tie-break
      // the same way, and the five offered feel picked rather than sorted.
      return { t, score: gap + rng() * cfg.academyLoanJitter };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(({ t }): LoanSuitor => {
      const league = state.leagues[t.leagueId];
      // A club at or below the prospect's level plays him; one above rotates him.
      const starter = t.reputation <= p.overall + cfg.academyLoanStarterBand;
      return {
        clubId: t.id,
        name: t.name,
        short: t.short,
        colors: t.colors,
        reputation: t.reputation,
        leagueName: league?.name ?? "—",
        role: starter ? "Regular starter" : "Squad rotation",
        minutesWeight: loanWeightFor(state, t, cfg),
      };
    });
  return suitors;
}

/** Send an academy prospect out on loan to a specific club, immediately. The
 * club is one the user chose from academyLoanSuitors; wages stay with the parent
 * club, so nothing here charges a fee or checks a budget. Mirrors the state a
 * weekly AI uptake would have produced. */
export function sendAcademyLoan(state: GameState, playerId: string, clubId: string, cfg: TuningConfig): string | null {
  const p = state.players[playerId];
  if (!p || !isUserPlayer(state, playerId)) return "Not your player.";
  if (p.loan) return "Already out on loan.";
  if (p.retired) return "That player has retired.";
  if ((state.academy.u21.registered ?? []).includes(playerId)) {
    return "Registered for the U21 competition — he can't go out on loan until the next registration window.";
  }
  const dest = state.teams[clubId];
  if (!dest || dest.id === state.userTeamId) return "That club can't take him.";
  const w = transferWindowState(state.currentDay, state.schedule);
  if (!w.open) return "Loans can only be arranged while a transfer window is open.";

  p.loan = { toClubId: dest.id, startDay: state.currentDay, minutesWeight: loanWeightFor(state, dest, cfg) };
  state.academy.loanList = state.academy.loanList.filter((x) => x !== playerId);
  for (const [slot, pid] of Object.entries(state.lineup)) {
    if (pid === playerId) delete state.lineup[slot];
  }
  pushInbox(
    state,
    "academy",
    `${p.name} joins ${dest.name} on loan`,
    `${p.name} (${p.age}) moves to ${dest.name} until the end of the season to play regular football. We keep paying his wages; progress reports will follow.`
  );
  return null;
}

function userLoanees(state: GameState): PlayerBio[] {
  const t = userTeam(state);
  return [...t.playerIds, ...(t.academyPlayerIds ?? [])]
    .map((id) => state.players[id])
    .filter((p) => p && p.loan) as PlayerBio[];
}

/** Every one of the user's players currently out on loan — academy prospects and
 * senior pros alike. Feeds the Loaned Players tab (v1.44). */
export function loanedOutPlayers(state: GameState): PlayerBio[] {
  return userLoanees(state);
}

/** Whether a loaned player is on the user's academy books (vs the senior squad). */
export function isAcademyLoanee(state: GameState, playerId: string): boolean {
  return (userTeam(state).academyPlayerIds ?? []).includes(playerId);
}

/** Weekly (Monday) loan machinery: AI uptake of listed players while a window
 * is open, plus statistical minutes for everyone already out. */
export function weeklyLoanTick(state: GameState, cfg: TuningConfig) {
  const ac = state.academy;
  const rng = mulberry32(deriveSeed(state.seed, `loan:${state.currentDay}`));

  if (transferWindowState(state.currentDay, state.schedule).open) {
    for (const id of [...ac.loanList]) {
      const p = state.players[id];
      if (!p || p.loan || rng() >= cfg.loanWeeklyChance) continue;
      // destination: a club whose level roughly matches the player's ability.
      // A senior pro is loaned to play, not to develop, so clubs at his own
      // level come calling; a prospect drops a rung to get minutes.
      const isSenior = userTeam(state).playerIds.includes(id);
      const targetRep = Math.min(80, Math.max(35, p.overall + (isSenior ? 0 : 10)));
      const candidates = Object.values(state.teams)
        .filter((t) => t.id !== state.userTeamId)
        .sort((a, b) => Math.abs(a.reputation - targetRep) - Math.abs(b.reputation - targetRep))
        .slice(0, 6);
      if (!candidates.length) continue;
      const dest = pick(rng, candidates);
      p.loan = { toClubId: dest.id, startDay: state.currentDay, minutesWeight: loanWeightFor(state, dest, cfg) };
      ac.loanList = ac.loanList.filter((x) => x !== id);
      for (const [slot, pid] of Object.entries(state.lineup)) {
        if (pid === id) delete state.lineup[slot];
      }
      pushInbox(
        state,
        "academy",
        `${p.name} joins ${dest.name} on loan`,
        `${p.name} (${p.age}) moves to ${dest.name} until the end of the season to play regular football. Progress reports will follow.`
      );
    }
  }

  for (const p of userLoanees(state)) {
    const dest = state.teams[p.loan!.toClubId];
    const benched = rng() < 0.1;
    const mins = Math.round(cfg.loanMinutesPerWeek * (benched ? 0.25 : randRange(rng, 0.55, 1.15)));
    const ys = (p.youthStats ??= { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 });
    ys.minutes += mins;
    if (mins >= 30) {
      ys.apps += 1;
      const rating = Math.min(9.5, Math.max(4.5, 6.2 + (p.overall - (dest.reputation - 12)) * 0.02 + randRange(rng, -0.4, 0.6)));
      ys.ratingSum += Math.round(rating * 10) / 10;
      const attacking = ["ST", "LW", "RW", "AM"].includes(p.positions[0]);
      if (attacking && rng() < 0.2) ys.goals += 1;
    }
  }
}

/** Mid-season loan check-in, sent when the winter window opens. */
export function loanMidseasonReports(state: GameState) {
  for (const p of userLoanees(state)) {
    const dest = state.teams[p.loan!.toClubId];
    const ys = p.youthStats;
    if (!ys || !ys.apps) continue;
    const avg = (ys.ratingSum / ys.apps).toFixed(2);
    pushInbox(
      state,
      "academy",
      `Loan report: ${p.name} at ${dest.name}`,
      `${ys.apps} appearances, ${ys.goals} goals, ${avg} average rating so far. ` +
        `He can be recalled during the winter window from the Academy screen, or left to see the season out.`
    );
  }
}

export function recallLoan(state: GameState, playerId: string): string | null {
  const p = state.players[playerId];
  if (!p?.loan) return "Not on loan.";
  const w = transferWindowState(state.currentDay, state.schedule);
  if (!w.open) return "Loans can only be recalled while a window is open.";
  const destName = state.teams[p.loan.toClubId]?.name ?? "his loan club";
  p.loan = undefined;
  pushInbox(state, "academy", `${p.name} recalled`, `${p.name} returns early from ${destName} and is available again.`);
  return null;
}

// ── Season rollover hooks (§18) ───────────────────────────────────────────

/** Before the development pass: send loan season reviews, fold this season's
 * youth/loan minutes into the stats the aging function reads (at §18 weights),
 * end all loans, and file the U21 season review. Career rows must already be
 * written — youth stats fold in *after* history is recorded. */
export function academyPreDevRollover(state: GameState, cfg: TuningConfig) {
  // loan season reviews + returns
  for (const p of userLoanees(state)) {
    const dest = state.teams[p.loan!.toClubId];
    const ys = p.youthStats;
    if (ys?.apps) {
      const avg = (ys.ratingSum / ys.apps).toFixed(2);
      pushInbox(
        state,
        "academy",
        `Back from loan: ${p.name}`,
        `${p.name} returns from ${dest.name}: ${ys.apps} apps, ${ys.goals} goals, ${avg} rating. The minutes will show in his development.`
      );
    }
  }

  // fold youth minutes into the development inputs at their §18 weight
  const team = userTeam(state);
  for (const id of [...team.playerIds, ...(team.academyPlayerIds ?? [])]) {
    const p = state.players[id];
    const ys = p?.youthStats;
    if (!p || !ys || (!ys.minutes && !ys.apps)) continue;
    const weight = p.loan ? p.loan.minutesWeight : cfg.u21MinutesWeight;
    p.stats.minutes += Math.round(ys.minutes * weight);
    p.stats.apps += Math.round(ys.apps * weight);
    p.stats.ratingSum += Math.round(ys.ratingSum * weight * 10) / 10;
    p.loan = undefined;
  }

  // Review whatever competition was still running when the season ended (a
  // completed one already filed its own review as it was retired).
  const u21 = state.academy.u21;
  if (u21.roundsPlayed > 0 && !state.academy.u21History?.includes(u21)) fileU21Review(state, u21);
}

/** After the development pass (ages are +1): enforce the age-out rule, warn
 * next summer's leavers, run the invisible AI intake, and reset the pipeline
 * for the new season. */
export function academyPostDevRollover(state: GameState, cfg: TuningConfig) {
  const team = userTeam(state);
  const academy = team.academyPlayerIds ?? [];

  // Age-out at academyMaxAge+1: everyone who comes through graduates. With the
  // senior squad cap gone (v14) there's always a pathway, so nobody is released
  // for want of a slot — trimming the squad is the user's call, not the rule's.
  for (const id of [...academy]) {
    const p = state.players[id];
    if (!p || p.retired || p.age <= cfg.academyMaxAge) continue;
    team.academyPlayerIds = (team.academyPlayerIds ?? []).filter((x) => x !== id);
    team.playerIds.push(id);
    if (!p.contract) grantDefaultContract(state, p, cfg);
    clearKitNumber(p);
    assignKitNumber(state, p);
    // Prospect tier is an academy-only label — drop it on graduation.
    delete p.u21Tier;
    pushInbox(state, "academy", `${p.name} steps up`, `${p.name} turns ${p.age} and graduates into the senior squad.`);
  }

  // warn about next summer's age-outs while there's a season to act
  const leavers = academyPlayers(state).filter((p) => p.age === cfg.academyMaxAge);
  if (leavers.length) {
    pushInbox(
      state,
      "academy",
      "Final academy season",
      `${leavers.map((p) => p.name).join(", ")} ${leavers.length === 1 ? "is" : "are"} now ${cfg.academyMaxAge} — ` +
        `promote, sell, or loan them this season, or they'll graduate into the senior squad automatically next summer.`
    );
  }

  aiIntake(state, cfg, deriveSeed(state.seed, `intake:${state.season}`));

  // new-season pipeline reset
  const ac = state.academy;
  ac.focusIds = ac.focusIds.filter((id) => (team.academyPlayerIds ?? []).includes(id));
  // Loan listings survive the summer for anyone still on the books (v14 opened
  // loans to senior players, so there's no age gate to re-apply here).
  ac.loanList = ac.loanList.filter((id) => isUserPlayer(state, id) && !state.players[id]?.retired);
  ac.reports = [];
  ac.nextReportDay = state.schedule.seasonStartDay + reportCadence(state, cfg);
  // Scout assignments persist across seasons; just requeue their next report and
  // clamp to whatever capacity survives (a scout may have been let go).
  clampScoutAssignments(state, cfg);
  for (const a of ac.assignments) {
    a.nextReportDay = state.schedule.seasonStartDay + reportCadence(state, cfg, scoutById(state, a.scoutId));
  }
  // Release every rival prospect this season's competitions put on the board
  // before building next season's — otherwise ~150 dead records accumulate per
  // season. Anyone signed has already moved clubs and is left alone.
  for (const past of [...(ac.u21History ?? []), ac.u21]) releaseU21Prospects(state, past);

  // Both of next season's competitions are built up front (v18) so the
  // registration deadline for the first is visible from day one.
  const first = buildU21Season(state, cfg, 0);
  ac.u21 = first;
  ac.u21Next = buildU21Season(state, cfg, 1, nextU21Kickoff(first, cfg));
  ac.u21History = [];
  ac.u21Squad = [];
}

// ── Academy DNA (§18): the graduate ledger ────────────────────────────────

export interface GraduateRow {
  playerId: string;
  name: string;
  age: number;
  overall: number;
  peak: number;
  clubName: string;
  retired: boolean;
}

/** Every player who ever came through a club's academy, best first. Computed on
 * demand — no extra store, same pattern as clubAllTimeRecords. */
export function academyGraduates(state: GameState, teamId: string): GraduateRow[] {
  const rows: GraduateRow[] = [];
  for (const p of Object.values(state.players)) {
    if (p.academyClubId !== teamId) continue;
    const peak = Math.max(p.overall, ...(p.devLog ?? []).map((d) => d.toOverall));
    rows.push({
      playerId: p.id,
      name: p.name,
      age: p.age,
      overall: p.overall,
      peak,
      clubName: p.retired ? "Retired" : p.clubId ? state.teams[p.clubId].name : "Free agent",
      retired: !!p.retired,
    });
  }
  return rows.sort((a, b) => b.peak - a.peak);
}

/** Post-summary hook: graduate glory elsewhere makes news (§18 Academy DNA). */
export function graduateAwardNews(state: GameState) {
  const latest = state.recordBook.seasons[state.recordBook.seasons.length - 1];
  if (!latest) return;
  const honours: { playerId: string; what: string }[] = [];
  if (latest.playerOfSeason) honours.push({ playerId: latest.playerOfSeason.playerId, what: "Player of the Season" });
  if (latest.youngPlayerOfSeason) honours.push({ playerId: latest.youngPlayerOfSeason.playerId, what: "Young Player of the Season" });
  for (const [leagueId, ts] of Object.entries(latest.topScorers)) {
    if (state.leagues[leagueId]?.playable) honours.push({ playerId: ts.playerId, what: "the Golden Boot" });
  }
  for (const h of honours) {
    const p = state.players[h.playerId];
    if (!p || p.academyClubId !== state.userTeamId || p.clubId === state.userTeamId) continue;
    pushInbox(
      state,
      "academy",
      `Academy DNA: ${p.name} wins ${h.what}`,
      `${p.name}, a graduate of your academy, has won ${h.what}${p.clubId ? ` at ${state.teams[p.clubId].name}` : ""}. The production line gets the credit.`
    );
  }
}

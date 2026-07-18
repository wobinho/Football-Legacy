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
  ScoutAssignment,
  ScoutPosGroup,
  ScoutRegion,
  Team,
  U21Season,
  U21TableRow,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import { mulberry32, deriveSeed, pick, pickWeighted, randInt, randNormal, randRange, randPoisson, shuffle, uid, type RNG } from "./rng";
import { generatePlayer } from "./worldgen";
import { playerValue, formatMoney } from "./value";
import { transferWindowState } from "./calendar";
import { regionNats } from "./config/scouting";
import { getArchetype } from "./config/archetypes";
import { grantDefaultContract } from "./contracts";
import { academySquadCap } from "./economy";
import { pushInboxItem } from "./inbox";

const POS_GROUPS: Record<ScoutPosGroup, Pos[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB"],
  MID: ["DM", "CM", "AM"],
  ATT: ["LW", "RW", "ST"],
  ANY: ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"],
};

// Intake classes lean toward the spine positions, with keepers rare.
const INTAKE_POS_POOL: Pos[] = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "ST"];

const pushInbox = pushInboxItem;

function userTeam(state: GameState): Team {
  return state.teams[state.userTeamId];
}

function youthCoachStars(state: GameState): number {
  return userTeam(state).staff.youthCoach?.stars ?? 0;
}

function scoutStars(state: GameState): number {
  // The Scout's rating drives report frequency + potential-range accuracy (§18).
  return userTeam(state).staff.scout?.stars ?? 0;
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

export function potentialStars(cfg: TuningConfig, potential: number): number {
  const raw = 1 + (4 * (potential - cfg.starScaleMin)) / (cfg.starScaleMax - cfg.starScaleMin);
  return Math.round(Math.min(5, Math.max(1, raw)) * 2) / 2;
}

export function potentialView(state: GameState, p: PlayerBio, cfg: TuningConfig): PotentialView {
  if (p.age >= cfg.growthEndAge || p.retired) {
    const s = potentialStars(cfg, p.potential);
    return { exact: p.potential, estimate: p.potential, loStars: s, hiStars: s };
  }
  const isOwn = p.clubId === state.userTeamId;
  const stars = isOwn ? youthCoachStars(state) : scoutStars(state);
  const staffCut = Math.min(0.45, stars * (isOwn ? cfg.fogCoachStarReduction : cfg.fogScoutStarReduction));
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

/** Build the season's 12-team U21 league: the user U21s plus 11 abstract sides
 * wearing other playable clubs' names. Opponents are strength numbers, never
 * rosters (§4 performance rule). */
export function buildU21Season(state: GameState, cfg: TuningConfig): U21Season {
  const rng = mulberry32(deriveSeed(state.seed, `u21:${state.season}`));
  const user = userTeam(state);
  const clubs = Object.values(state.teams).filter((t) => t.id !== user.id && state.leagues[t.leagueId]?.playable);
  const opponents = shuffle(rng, clubs)
    .slice(0, 11)
    .map((t) => ({
      name: `${t.name} U21`,
      short: t.short,
      strength: cfg.u21OppStrengthBase + t.reputation * cfg.u21OppStrengthPerRep + randRange(rng, -3, 3),
    }));
  // Spread the 22 rounds across the whole season (midweek, roughly every 11
  // days) so a March intake class still gets minutes before the summer.
  const firstDay = state.schedule.leagueRoundDays[0] + 3; // Tuesday after opening Saturday
  const lastDay = state.schedule.leagueRoundDays[37] - 4;
  const step = Math.floor((lastDay - firstDay) / 21);
  const matchDays = Array.from({ length: 22 }, (_, i) => firstDay + i * step);
  const table: U21TableRow[] = [
    { name: `${user.name} U21`, isUser: true, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
    ...opponents.map((o) => ({ name: o.name, isUser: false, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })),
  ];
  return { opponents, matchDays, roundsPlayed: 0, table, results: [] };
}

export function initAcademyState(state: GameState, cfg: TuningConfig): AcademyState {
  return {
    focusIds: [],
    u21Squad: [],
    loanList: [],
    assignments: [],
    reports: [],
    nextReportDay: state.currentDay + cfg.scoutReportDaysBase,
    u21: buildU21Season(state, cfg),
    lastIntake: null,
  };
}

// ── Scouting network capacity (v5) ────────────────────────────────────────
// How many scouts the club can have out on assignment at once: it needs at
// least one Scout on the staff to scout at all, and the Scouting Network
// facility raises the ceiling from there.

export function scoutCapacity(state: GameState, cfg: TuningConfig): number {
  const team = userTeam(state);
  if (!team.staff.scout) return 0;
  return cfg.scoutNetworkBase + (team.scoutNetworkLevel ?? 0);
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
  let overall = cfg.intakeOverallBase + (age - cfg.intakeAgeMin) * 2 + randNormal(rng) * cfg.intakeOverallSpread * 0.5;
  // Rare prodigy: request a much higher raw overall so generatePlayer's prodigy
  // branch produces a genuinely high-rated teenager (the ~80-rated 17yo gem).
  // Golden-generation members carry an elevated prodigy chance. We set prodigy
  // explicitly so the high request isn't gated a second time inside generatePlayer.
  const prodigyChance = opts.golden ? cfg.youthProdigyChance * 6 : cfg.youthProdigyChance;
  const prodigy = rng() < prodigyChance;
  if (prodigy) overall = Math.max(overall, randRange(rng, 74, 88));
  const p = freshId(generatePlayer(rng, cfg, { pos: pick(rng, INTAKE_POS_POOL), overall, nat: "ENG", age, prodigy }));
  let pot: number;
  if (opts.golden) {
    pot = randRange(rng, cfg.goldenGenPotentialMin, cfg.goldenGenPotentialMax);
  } else if (prodigy) {
    // A prodigy's ceiling matches the hype: 90+ for the rare high-overall gem.
    pot = randRange(rng, 88, cfg.potentialAbsoluteCap);
  } else {
    pot =
      cfg.intakePotentialBase +
      level * cfg.intakePotentialPerLevel +
      youthCoachStars(state) * cfg.intakePotentialPerCoachStar +
      team.reputation * cfg.intakePotentialRepFactor +
      randNormal(rng) * cfg.intakePotentialSpread;
  }
  // Balance (v10): intake prospects share the high, spread youth-potential band.
  const bandTop = Math.min(cfg.potentialAbsoluteCap, cfg.youthPotentialBandTop);
  pot = Math.max(pot, cfg.youthPotentialFloor + rng() * (bandTop - cfg.youthPotentialFloor));
  p.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 2, pot)));
  p.value = playerValue(p, cfg);
  p.clubId = team.id;
  p.academyClubId = team.id;
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

/** A fresh save starts with a modest academy so the screen isn't empty until
 * the first March intake. Silent — no inbox. Called from worldgen. */
export function seedInitialAcademy(state: GameState, cfg: TuningConfig) {
  const team = userTeam(state);
  const rng = mulberry32(deriveSeed(state.seed, "intake:0:user"));
  for (let i = 0; i < 3; i++) {
    const p = rollIntakeProspect(state, rng, cfg, { golden: false });
    state.players[p.id] = p;
    (team.academyPlayerIds ??= []).push(p.id);
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
    }
  }
  // the user's own squad still needs the retiree cleanup pass
  const user = userTeam(state);
  user.playerIds = user.playerIds.filter((id) => state.players[id] && !state.players[id].retired);
  user.academyPlayerIds = (user.academyPlayerIds ?? []).filter((id) => state.players[id] && !state.players[id].retired);
}

// ── U21 league sim (§18) ──────────────────────────────────────────────────

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

/** Current XI the youth coach fields. If the user has tagged a U21 matchday
 * squad, only tagged players are eligible (focus still starts first); otherwise
 * it auto-picks focus prospects first, then the best of the rest. Loanees are
 * away; missing bodies count as empty shirts. */
function u21Eleven(state: GameState): PlayerBio[] {
  const focus = new Set(state.academy.focusIds);
  const tagged = new Set(state.academy.u21Squad ?? []);
  let avail = academyPlayers(state).filter((p) => !p.loan);
  if (tagged.size > 0) avail = avail.filter((p) => tagged.has(p.id) || focus.has(p.id));
  return avail
    .sort((a, b) => (focus.has(b.id) ? 1 : 0) - (focus.has(a.id) ? 1 : 0) || b.overall - a.overall)
    .slice(0, 11);
}

export function userU21Strength(state: GameState, cfg: TuningConfig): number {
  const eleven = u21Eleven(state);
  const total = eleven.reduce((s, p) => s + p.overall, 0) + (11 - eleven.length) * 30;
  return total / 11 + youthCoachStars(state) * cfg.u21CoachStrengthPerStar;
}

/** Projected U21 role for an academy player — how many minutes they'll get.
 * The youth coach fields focus prospects first, then the best of the rest, so
 * this is the same logic the sim uses (u21Eleven). Loanees are away entirely. */
export type U21Role = "Starter" | "Rotation" | "Bench" | "On loan";
export function u21RoleFor(state: GameState, playerId: string): U21Role {
  const p = state.players[playerId];
  if (!p) return "Bench";
  if (p.loan) return "On loan";
  const eleven = u21Eleven(state);
  const idx = eleven.findIndex((x) => x.id === playerId);
  if (idx === -1) return "Bench";
  // focus prospects + the top of the XI are nailed-on starters; the tail rotates
  if (state.academy.focusIds.includes(playerId) || idx < 8) return "Starter";
  return "Rotation";
}

const U21_SCORER_WEIGHT: Partial<Record<Pos, number>> = {
  ST: 4, LW: 2.5, RW: 2.5, AM: 2, CM: 1, DM: 0.5, CB: 0.4, LB: 0.4, RB: 0.4, GK: 0.05,
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
  const u21 = state.academy.u21;
  while (u21.roundsPlayed < u21.matchDays.length && u21.matchDays[u21.roundsPlayed] <= state.currentDay) {
    resolveU21Round(state, cfg, u21.roundsPlayed++);
  }
}

function resolveU21Round(state: GameState, cfg: TuningConfig, round: number) {
  const u21 = state.academy.u21;
  const rng = mulberry32(deriveSeed(state.seed, `u21:${state.season}:r${round}`));
  const strengthOf = (idx: number) => (idx === 0 ? userU21Strength(state, cfg) : u21.opponents[idx - 1].strength);

  for (const [homeIdx, awayIdx] of roundPairings(round)) {
    const sh = strengthOf(homeIdx) + 2; // small youth home edge
    const sa = strengthOf(awayIdx);
    const share = Math.pow(sh, 2.2) / (Math.pow(sh, 2.2) + Math.pow(sa, 2.2));
    const hg = randPoisson(rng, cfg.u21GoalsPerMatch * share);
    const ag = randPoisson(rng, cfg.u21GoalsPerMatch * (1 - share));
    applyU21Score(u21, homeIdx, awayIdx, hg, ag);

    if (homeIdx !== 0 && awayIdx !== 0) continue;

    // the user's match: credit minutes, goals and ratings to the XI
    const home = homeIdx === 0;
    const [gf, ga] = home ? [hg, ag] : [ag, hg];
    const eleven = u21Eleven(state);
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

/** Flag/unflag a focus prospect (≤3): guaranteed U21 starts + coach attention. */
export function toggleFocus(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const ac = state.academy;
  if (ac.focusIds.includes(playerId)) {
    ac.focusIds = ac.focusIds.filter((id) => id !== playerId);
    return null;
  }
  if (!(userTeam(state).academyPlayerIds ?? []).includes(playerId)) return "Only academy players can be focus prospects.";
  if (ac.focusIds.length >= cfg.u21FocusMax) return `You can only focus on ${cfg.u21FocusMax} prospects at a time.`;
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
  if (team.playerIds.length >= cfg.squadCap) return `Senior squad is full (${cfg.squadCap}).`;
  team.academyPlayerIds = academy.filter((id) => id !== playerId);
  team.playerIds.push(playerId);
  state.academy.focusIds = state.academy.focusIds.filter((id) => id !== playerId);
  state.academy.u21Squad = (state.academy.u21Squad ?? []).filter((id) => id !== playerId);
  // A promoted graduate signs his first professional deal (§10 v5 contracts).
  const p = state.players[playerId];
  if (p && !p.contract) grantDefaultContract(state, p, cfg);
  return null;
}

export function demoteToAcademy(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const team = userTeam(state);
  const p = state.players[playerId];
  if (!team.playerIds.includes(playerId)) return "Not in the senior squad.";
  if (!p || p.age > cfg.academyMaxAge) return `Only players ${cfg.academyMaxAge} or younger can join the academy squad.`;
  team.playerIds = team.playerIds.filter((id) => id !== playerId);
  (team.academyPlayerIds ??= []).push(playerId);
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
  if (!state.careers[playerId]) state.careers[playerId] = { playerId, seasons: [], transfers: [] };
  state.careers[playerId].transfers.push({ season: state.season, day: state.currentDay, from: team.name, to: "Released", fee: 0 });
  return null;
}

// ── Youth scouting (§18, v5): a department of scouts on country assignments ─
// The user hires Scouts as staff and the Scouting Network facility sets how
// many can be out at once (scoutCapacity). Each assignment points a scout at a
// country + position focus; several may share a country. Reports arrive per
// assignment on their own cadence.

function reportCadence(state: GameState, cfg: TuningConfig): number {
  return Math.max(10, cfg.scoutReportDaysBase - scoutStars(state) * cfg.scoutReportDaysPerStar);
}

/** Add a new scout assignment if there's spare capacity. The full brief (region,
 * position group, and optional archetype focus) is locked in at send time (§18 v7)
 * — it isn't edited afterwards; recall the scout and re-send to change the brief. */
export function addScoutAssignment(
  state: GameState,
  region: ScoutRegion,
  positions: ScoutPosGroup,
  cfg: TuningConfig,
  archetypes: string[] = []
): string | null {
  const ac = state.academy;
  if (!userTeam(state).staff.scout) return "Hire a Scout on the Club page before assigning one.";
  if (ac.assignments.length >= scoutCapacity(state, cfg)) {
    return "No spare scouts — upgrade Max Scouts in the Scouting Department to send more.";
  }
  ac.assignments.push({
    id: uid("asg"),
    region,
    positions,
    archetypes: archetypes.length ? [...archetypes] : undefined,
    nextReportDay: state.currentDay + 7 + Math.round(reportCadence(state, cfg) * 0.4),
  });
  return null;
}

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

/** Trim assignments down to current capacity (e.g. a scout was let go). */
export function clampScoutAssignments(state: GameState, cfg: TuningConfig) {
  const cap = scoutCapacity(state, cfg);
  if (state.academy.assignments.length > cap) {
    state.academy.assignments = state.academy.assignments.slice(0, cap);
  }
}

const SCOUT_NOTES = [
  "Raw, but there's something you can't coach here.",
  "Reads the game two moves ahead of everyone on the pitch.",
  "Dominating boys two years older every week.",
  "Technique well beyond his age group.",
  "Local coaches rave about the attitude as much as the talent.",
  "Small club, big fish. Needs a real academy around him.",
];

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

function generateScoutReport(state: GameState, cfg: TuningConfig, a: ScoutAssignment, rng: RNG): ProspectReport {
  const stars = scoutStars(state);
  const { pos, archetypeId } = briefTarget(a, rng);
  const nat = pick(rng, regionNats(a.region));
  const age = randInt(rng, cfg.scoutProspectAgeMin, cfg.scoutProspectAgeMax);
  // Ability keeps scouted teenagers genuinely developable — a 15-year-old comes
  // back in the mid-50s (with room to grow), not a hopeless 38. The quality floor
  // in generatePlayer enforces cfg.minOverall regardless.
  let overall = cfg.minOverall + 5 + (age - cfg.scoutProspectAgeMin) * 2.5 + randNormal(rng) * 3;
  // A scout can rarely unearth a high-overall gem abroad — same prodigy tail as
  // the academy intake (set explicitly so it isn't gated twice downstream).
  const prodigy = rng() < cfg.youthProdigyChance;
  if (prodigy) overall = Math.max(overall, randRange(rng, 74, 88));
  const p = freshId(generatePlayer(rng, cfg, { pos, overall, nat, age, prodigy, archetypeId }));
  let potBase = prodigy
    ? randRange(rng, 88, cfg.potentialAbsoluteCap)
    : cfg.scoutPotentialBase + stars * cfg.scoutPotentialPerStar + randNormal(rng) * cfg.scoutPotentialSpread;
  // Balance (v10): scouted prospects share the high, spread youth-potential band.
  const bandTop = Math.min(cfg.potentialAbsoluteCap, cfg.youthPotentialBandTop);
  potBase = Math.max(potBase, cfg.youthPotentialFloor + rng() * (bandTop - cfg.youthPotentialFloor));
  p.potential = Math.round(Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 4, potBase)));
  p.value = playerValue(p, cfg);
  const fee = Math.max(200_000, Math.round((p.value * cfg.scoutFeeMult) / 50_000) * 50_000);
  return {
    id: uid("rep"),
    player: p,
    fee,
    note: pick(rng, SCOUT_NOTES),
    day: state.currentDay,
    expiresDay: state.currentDay + cfg.scoutReportExpiryDays,
    region: a.region,
    assignmentId: a.id,
  };
}

/** Daily tick: expire stale reports; each due assignment drops a new prospect
 * report. No scout hired or no assignments → the pipeline stays quiet. */
export function dailyScoutTick(state: GameState, cfg: TuningConfig) {
  const ac = state.academy;
  ac.reports = ac.reports.filter((r) => r.expiresDay > state.currentDay);
  const stars = scoutStars(state);
  if (!stars || ac.assignments.length === 0) return;
  clampScoutAssignments(state, cfg);

  for (const a of ac.assignments) {
    if (state.currentDay < a.nextReportDay) continue;
    const rng = mulberry32(deriveSeed(state.seed, `scout:${a.id}:${state.currentDay}`));
    const report = generateScoutReport(state, cfg, a, rng);
    ac.reports.push(report);
    a.nextReportDay = state.currentDay + reportCadence(state, cfg) + randInt(rng, -3, 4);
    pushInbox(
      state,
      "scout",
      `Scout report: ${report.player.name} (${report.player.positions[0]}, ${report.player.age})`,
      `${report.note}\n\n${report.player.name} — ${report.player.positions[0]}, age ${report.player.age}, ${report.player.nationality}, ` +
        `potential ${starRangeLabel(state, report.player, cfg)}. Asking fee ${formatMoney(report.fee)}. ` +
        `The trail goes cold in ${cfg.scoutReportExpiryDays} days. Sign him from the Academy screen.`,
      report.id
    );
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
  if (team.budget < report.fee) return "Not enough budget for the fee.";
  team.budget -= report.fee;
  const p = report.player;
  p.clubId = team.id;
  p.academyClubId = team.id;
  state.players[p.id] = p;
  (team.academyPlayerIds ??= []).push(p.id);
  state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
  state.careers[p.id].transfers.push({ season: state.season, day: state.currentDay, from: "Youth football", to: team.name, fee: report.fee });
  ac.reports = ac.reports.filter((r) => r.id !== reportId);
  state.news.unshift(`${team.name} sign ${p.age}-year-old ${p.name} for the academy.`);
  return null;
}

export function dismissReport(state: GameState, reportId: string) {
  state.academy.reports = state.academy.reports.filter((r) => r.id !== reportId);
}

// ── Loans out (§18) ───────────────────────────────────────────────────────

function isUserPlayer(state: GameState, playerId: string): boolean {
  const t = userTeam(state);
  return t.playerIds.includes(playerId) || (t.academyPlayerIds ?? []).includes(playerId);
}

export function toggleLoanList(state: GameState, playerId: string, cfg: TuningConfig): string | null {
  const ac = state.academy;
  if (ac.loanList.includes(playerId)) {
    ac.loanList = ac.loanList.filter((id) => id !== playerId);
    return null;
  }
  const p = state.players[playerId];
  if (!p || !isUserPlayer(state, playerId)) return "Not your player.";
  if (p.age > cfg.loanMaxAge) return `Only players ${cfg.loanMaxAge} or younger go out on development loans.`;
  if (p.loan) return "Already out on loan.";
  ac.loanList.push(playerId);
  return null;
}

function loanWeightFor(state: GameState, club: Team, cfg: TuningConfig): number {
  const league = state.leagues[club.leagueId];
  if (!league?.playable) return cfg.loanMinutesWeightSim;
  return league.tier === 1 ? cfg.loanMinutesWeightTop : cfg.loanMinutesWeightSecond;
}

function userLoanees(state: GameState): PlayerBio[] {
  const t = userTeam(state);
  return [...t.playerIds, ...(t.academyPlayerIds ?? [])]
    .map((id) => state.players[id])
    .filter((p) => p && p.loan) as PlayerBio[];
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
      // destination: a club whose level roughly matches the player's ability
      const targetRep = Math.min(80, Math.max(35, p.overall + 10));
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
export function loanMidseasonReports(state: GameState, cfg: TuningConfig) {
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

  // U21 season review
  const u21 = state.academy.u21;
  if (u21.roundsPlayed > 0) {
    const pos = u21.table.findIndex((r) => r.isUser) + 1;
    const suffix = pos === 1 ? "st" : pos === 2 ? "nd" : pos === 3 ? "rd" : "th";
    const topKid = academyPlayers(state)
      .filter((p) => p.youthStats?.apps)
      .sort((a, b) => (b.youthStats!.goals || 0) - (a.youthStats!.goals || 0))[0];
    pushInbox(
      state,
      "academy",
      `U21 season review: ${pos}${suffix}`,
      `The U21s finished ${pos}${suffix} of 12.` +
        (topKid?.youthStats?.goals ? ` Top scorer: ${topKid.name} with ${topKid.youthStats.goals}.` : "") +
        (pos === 1 ? " Champions — the academy is producing." : "")
    );
  }
}

/** After the development pass (ages are +1): enforce the age-out rule, warn
 * next summer's leavers, run the invisible AI intake, and reset the pipeline
 * for the new season. */
export function academyPostDevRollover(state: GameState, cfg: TuningConfig) {
  const team = userTeam(state);
  const academy = team.academyPlayerIds ?? [];

  // age-out at academyMaxAge+1: promote if there's room, otherwise released
  for (const id of [...academy]) {
    const p = state.players[id];
    if (!p || p.retired || p.age <= cfg.academyMaxAge) continue;
    if (team.playerIds.length < cfg.squadCap) {
      team.academyPlayerIds = (team.academyPlayerIds ?? []).filter((x) => x !== id);
      team.playerIds.push(id);
      if (!p.contract) grantDefaultContract(state, p, cfg);
      pushInbox(state, "academy", `${p.name} steps up`, `${p.name} turns ${p.age} and graduates into the senior squad.`);
    } else {
      releaseFromAcademy(state, id);
      pushInbox(
        state,
        "academy",
        `${p.name} released`,
        `${p.name} came through the ranks but there was no senior pathway — the squad is full. He leaves as a free agent.`
      );
    }
  }

  // warn about next summer's age-outs while there's a season to act
  const leavers = academyPlayers(state).filter((p) => p.age === cfg.academyMaxAge);
  if (leavers.length) {
    pushInbox(
      state,
      "academy",
      "Final academy season",
      `${leavers.map((p) => p.name).join(", ")} ${leavers.length === 1 ? "is" : "are"} now ${cfg.academyMaxAge} — ` +
        `promote, sell, or loan them this season, or they'll be promoted (if there's room) or released next summer.`
    );
  }

  aiIntake(state, cfg, deriveSeed(state.seed, `intake:${state.season}`));

  // new-season pipeline reset
  const ac = state.academy;
  ac.focusIds = ac.focusIds.filter((id) => (team.academyPlayerIds ?? []).includes(id));
  ac.loanList = ac.loanList.filter((id) => isUserPlayer(state, id) && (state.players[id]?.age ?? 99) <= cfg.loanMaxAge);
  ac.reports = [];
  ac.nextReportDay = state.schedule.seasonStartDay + reportCadence(state, cfg);
  // Scout assignments persist across seasons; just requeue their next report and
  // clamp to whatever capacity survives (a scout may have been let go).
  clampScoutAssignments(state, cfg);
  for (const a of ac.assignments) a.nextReportDay = state.schedule.seasonStartDay + reportCadence(state, cfg);
  ac.u21 = buildU21Season(state, cfg);
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

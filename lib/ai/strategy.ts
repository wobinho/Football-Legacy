// ── Club AI strategy (§10) ────────────────────────────────────────────────
// Each AI club carries a *stance* — a season-scale intent recomputed when a
// transfer window opens, from how the club is actually doing against what its
// reputation implies it should be doing. The stance then drives every market
// decision that module makes: who it hunts, what it will pay, who it will let
// go and at what discount.
//
// Nothing here special-cases a club, archetype or trait by name — stances are a
// table (STANCE_PROFILE) and every number lives in tuning.

import type { GameState, PlayerBio, Pos, Style, Tactic, Team, ClubStance } from "../types";
import { TUNING, type TuningConfig } from "../config/tuning";
import { computeTable } from "../season";
import { AI_FORMATIONS, FORMATIONS } from "../config/formations";
import { positionFit } from "../config/positions";
import { pickLineup, selectionScore, toEnginePlayer } from "../selection";
import { tacticalFitMult } from "../engine/match";
import { deriveSeed, mulberry32 } from "../rng";

/** Per-stance behaviour table. The engine only ever reads these fields — adding
 * a stance means adding a row here, never a branch in the market code. */
export interface StanceProfile {
  /** Age band this stance shops in (inclusive). */
  targetAge: [number, number];
  /** Weight on a target's current ability vs. its potential headroom. */
  abilityWeight: number;
  potentialWeight: number;
  /** Multiplier on what the club will pay over a player's market value. */
  buyPremium: number;
  /** Multiplier on the price it asks for its own players (>1 = reluctant). */
  sellAsk: number;
  /** Age from which its own players become sale candidates. */
  sellFromAge: number;
  /** Will it sell a player who is currently in its best XI? */
  sellsStarters: boolean;
  /** Relative appetite for doing deals at all this window. */
  activity: number;
  /** Player-facing label (news, and any future UI). */
  label: string;
}

export const STANCE_PROFILE: Record<ClubStance, StanceProfile> = {
  // Met or beat a big expectation: buy finished players, pay over the odds,
  // keep everyone who matters.
  // v1.43: sellAsk values pulled down across the board so a fair bid lands near
  // a player's market value instead of several times over it.
  // v1.43+: activity raised across every stance and the target age bands widened
  // so the world does more business each window without losing each stance's
  // distinct character.
  title: {
    targetAge: [23, 31], abilityWeight: 1.0, potentialWeight: 0.2,
    buyPremium: 1.35, sellAsk: 1.3, sellFromAge: 32, sellsStarters: false,
    activity: 1.5, label: "Going for the title",
  },
  // Roughly where it should be: targeted upgrades, sensible money.
  compete: {
    targetAge: [21, 30], abilityWeight: 0.8, potentialWeight: 0.5,
    buyPremium: 1.12, sellAsk: 1.12, sellFromAge: 31, sellsStarters: false,
    activity: 1.35, label: "Strengthening the squad",
  },
  // Under where it should be, and the books are tight: trim, don't build — but
  // still willing to sell a fringe starter to fund the right upgrade.
  stabilise: {
    targetAge: [20, 29], abilityWeight: 0.6, potentialWeight: 0.55,
    buyPremium: 0.95, sellAsk: 1.0, sellFromAge: 29, sellsStarters: true,
    activity: 1.05, label: "Balancing the books",
  },
  // Badly under, ageing squad: cash in on anyone with resale value and buy
  // young. The most aggressive seller.
  rebuild: {
    targetAge: [17, 24], abilityWeight: 0.35, potentialWeight: 1.0,
    buyPremium: 1.0, sellAsk: 0.9, sellFromAge: 26, sellsStarters: true,
    activity: 1.4, label: "Rebuilding",
  },
};

/**
 * The XI this club would actually field — used for "is this a starter" questions.
 *
 * v1.90: picked through `pickLineup` against the club's own formation and
 * tactic, which is the same function the matchday path uses. It used to be the
 * top eleven by raw overall, a list with no positions in it at all: a club whose
 * best eleven players were six strikers had a "best XI" it could never field,
 * so the sale guard protected the wrong people and let the actual first-choice
 * keeper go. Fitness is ignored — a starter carrying a knock is still a starter
 * for the purposes of who you may sell.
 */
function bestXIIds(state: GameState, team: Team): Set<string> {
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  if (!squad.length) return new Set();
  const formation = FORMATIONS.find((f) => f.id === team.tactic?.formationId) ?? FORMATIONS[0];
  const { lineup } = pickLineup(squad, formation, TUNING, false, undefined, team.tactic);
  return new Set(lineup.map((e) => e.player.id));
}

/** Where the club sits in its league right now, 0 = top, 1 = bottom. Falls back
 * to the reputation ordering before enough matches have been played. */
function leaguePositionRatio(state: GameState, team: Team): number {
  const league = state.leagues[team.leagueId];
  if (!league || league.teamIds.length < 2) return 0.5;
  const table = computeTable(state.fixtures, league.id, league.teamIds);
  const played = table.reduce((n, r) => n + r.played, 0);
  const order =
    played >= league.teamIds.length // a round or so in — the table means something
      ? table.map((r) => r.teamId)
      : league.teamIds
          .map((id) => state.teams[id])
          .filter(Boolean)
          .sort((a, b) => b.reputation - a.reputation)
          .map((t) => t.id);
  const idx = order.indexOf(team.id);
  if (idx < 0) return 0.5;
  return idx / Math.max(1, order.length - 1);
}

/** Where the club's *reputation* says it should sit, 0 = top, 1 = bottom. */
function expectedPositionRatio(state: GameState, team: Team): number {
  const league = state.leagues[team.leagueId];
  if (!league || league.teamIds.length < 2) return 0.5;
  const byRep = league.teamIds
    .map((id) => state.teams[id])
    .filter(Boolean)
    .sort((a, b) => b.reputation - a.reputation)
    .map((t) => t.id);
  const idx = byRep.indexOf(team.id);
  if (idx < 0) return 0.5;
  return idx / Math.max(1, byRep.length - 1);
}

/**
 * Decide a club's stance for the window that is opening. Reads three signals:
 *  - performance: league position against the reputation-implied expectation
 *  - finances: budget measured against the squad's own wage bill
 *  - age: how much of the squad is past its peak
 */
export function evaluateStance(state: GameState, team: Team, cfg: TuningConfig): ClubStance {
  const actual = leaguePositionRatio(state, team);
  const expected = expectedPositionRatio(state, team);
  // Positive = doing better than reputation implies.
  const overperformance = expected - actual;

  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  const avgAge = squad.length ? squad.reduce((n, p) => n + p.age, 0) / squad.length : 26;
  const ageing = avgAge >= cfg.aiAgeingSquadAge;

  // Financial health is measured against what the squad itself is worth, not the
  // wage bill — wages are a small number next to fees in this economy, so a
  // wage-based test would never fire. A club with less than a fraction of its
  // own squad value in the bank has no room to buy.
  const squadValue = squad.reduce((n, p) => n + p.value, 0);
  const skint = team.budget < squadValue * cfg.aiHealthyBudgetRatio;

  // A club already expected to finish last can't "underperform" against its
  // reputation, so weakness is also judged absolutely: propping up the table
  // counts as failing regardless of what was expected.
  const struggling = actual >= cfg.aiStrugglingRatio;

  // Top of its league and meeting the billing → go and win it.
  if (actual <= cfg.aiTitleContenderRatio && overperformance >= -cfg.aiStanceTolerance && !skint) {
    return "title";
  }
  // Well below where it should be, or simply bottom of the table. An ageing
  // squad or empty coffers means tearing it up; otherwise steady the ship.
  if (overperformance <= -cfg.aiUnderperformBand || struggling) {
    return ageing || skint ? "rebuild" : "stabilise";
  }
  // Roughly on target, but the squad is old and the money is gone anyway.
  if (ageing && skint) return "rebuild";
  if (skint) return "stabilise";
  return "compete";
}

/** Recompute every AI club's stance. Called when a transfer window opens, so a
 * stance is fixed for the duration of that window's business. Covers sim
 * (non-playable) clubs too (v1.44) — they now do their own window business, so
 * they need a stance to drive it just like their playable peers. */
export function refreshClubStances(state: GameState, cfg: TuningConfig) {
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    team.stance = evaluateStance(state, team, cfg);
    team.stanceSeason = state.season;
  }
}

/** Stance for any club, deriving one on demand for saves/clubs that predate the
 * field so callers never have to null-check. */
export function stanceOf(state: GameState, team: Team, cfg: TuningConfig): ClubStance {
  return (team.stance ??= evaluateStance(state, team, cfg));
}

// ── Playing identity (v1.90) ──────────────────────────────────────────────
//
// An AI club used to be handed a random formation and style at worldgen and
// keep them for the life of the save, however its squad changed around them —
// so a side could spend twenty seasons playing WingPlay with no wingers, and
// nothing in the game ever noticed. Two halves fix that, and they pull in
// opposite directions on purpose:
//
//   `bestTacticFor` picks the shape that suits the players the club HAS.
//   `tacticTargetFor` (used by the market, below) shops for the players its
//   CURRENT tactic wants.
//
// Together they are "build towards an identity with the squad you have": the
// club drifts toward the tactic its squad already fits, and then signs to
// deepen it, rather than flip-flopping every window. The hysteresis in
// `reviewClubTactics` is what keeps that a drift and not a flip-flop.

/** The styles an AI club will consider. Mirrors worldgen's seeding weights in
 * spirit — every style is reachable, so nothing here is special-cased. */
const AI_STYLES: Style[] = ["Possession", "Counter", "Direct", "Gegenpress", "ParkTheBus", "WingPlay"];

/**
 * How well a squad would play a given tactic: the mean `selectionScore` of the
 * XI it would field under it.
 *
 * Reads through the same `pickLineup`/`selectionScore` the matchday uses, so a
 * tactic scored well here is one the club will genuinely be better at — the
 * alternative, a bespoke "does this squad look counter-attacking" heuristic,
 * is a second opinion that can disagree with the simulation.
 */
export function tacticScore(squad: PlayerBio[], tactic: Tactic, cfg: TuningConfig): number {
  const formation = FORMATIONS.find((f) => f.id === tactic.formationId) ?? FORMATIONS[0];
  const { lineup } = pickLineup(squad, formation, cfg, false, undefined, tactic);
  if (!lineup.length) return 0;
  const slotById = new Map(formation.slots.map((s) => [s.id, s]));
  const total = lineup.reduce(
    (sum, e) => sum + selectionScore(e.player, slotById.get(e.slotId)?.pos ?? "CM", cfg, tactic),
    0
  );
  return total / lineup.length;
}

/**
 * The best formation+style this squad could be playing, and what it scores.
 *
 * Searches only formations the AI pool offers crossed with the six styles —
 * mentality is left alone, since it tracks the club's ambition rather than its
 * personnel. The search is exhaustive over that grid (a few dozen combinations
 * on a squad of ~25) and runs once per club per season, not per matchday.
 */
export function bestTacticFor(
  state: GameState,
  team: Team,
  cfg: TuningConfig
): { tactic: Tactic; score: number } | null {
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
  if (squad.length < 11) return null;
  const current = team.tactic ?? { formationId: FORMATIONS[0].id, mentality: "Balanced", style: "Possession" };

  let best: { tactic: Tactic; score: number } | null = null;
  for (const formation of AI_FORMATIONS) {
    for (const style of AI_STYLES) {
      const candidate: Tactic = { ...current, formationId: formation.id, style };
      const score = tacticScore(squad, candidate, cfg);
      if (!best || score > best.score) best = { tactic: candidate, score };
    }
  }
  return best;
}

/**
 * Once a season, let every AI club drift toward the tactic its squad actually
 * suits (v1.90).
 *
 * The `aiTacticSwitchGain` threshold is the hysteresis and it is the load-bearing
 * part: without it a club re-picks its shape every single season on noise, which
 * reads as an AI with no identity at all and quietly undoes the point of shopping
 * for a tactic. A club only changes when the alternative is clearly better, so a
 * side that has been built towards its current shape keeps it.
 */
export function reviewClubTactics(state: GameState, cfg: TuningConfig) {
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue; // the manager picks their own
    if (!team.tactic) continue;
    const best = bestTacticFor(state, team, cfg);
    if (!best) continue;
    const currentScore = tacticScore(
      team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan),
      team.tactic,
      cfg
    );
    if (best.score > currentScore * (1 + cfg.aiTacticSwitchGain)) {
      team.tactic = best.tactic;
    }
  }
}

// ── Squad needs ───────────────────────────────────────────────────────────

export interface PositionNeed {
  pos: Pos;
  /**
   * The ability of the MARGINAL starter — the weakest player the formation would
   * be forced to field here, which is `slotsNeeded`-th best, not the best (v1.89).
   *
   * This distinction is the whole point of the field. A club with one 81-rated
   * centre-back and a formation asking for two has a hole; if `incumbent` reports
   * 81, every candidate centre-back in the world scores as "not an upgrade" and
   * the club never signs one. Reporting the second slot's occupant — 0 when
   * nobody can fill it — is what makes the hole visible to `targetScore`.
   */
  incumbent: number;
  /** The BEST player available here, for callers that want to describe the club
   * ("their first-choice keeper is 84") rather than decide a signing. */
  best: number;
  /** How many bodies can cover it at all, natural or adjacent. */
  depth: number;
  /** How many players actually LIST this position (v1.89). Adjacent cover keeps
   * a side fieldable but it is not a centre-back; `naturalDepth` is what the
   * minimum-cover rule below counts, so a squad of full-backs never reads as
   * having centre-backs. */
  naturalDepth: number;
  /** How many of this position the club's formation asks for. Paired with
   * `naturalDepth` this is the whole "can I field this position?" question —
   * one natural centre-back is a gap in a back four and a full complement in a
   * back three, so neither number answers it alone. */
  slotsNeeded: number;
  /** Higher = more urgent. */
  urgency: number;
}

/** Every slot the club's chosen formation asks it to fill. */
function requiredSlots(team: Team): Pos[] {
  const formation = FORMATIONS.find((f) => f.id === team.tactic?.formationId) ?? FORMATIONS[0];
  return formation.slots.map((s) => s.pos);
}

/**
 * How well a player covers a slot: ability scaled by positional fit, and — when
 * a tactic is supplied (v1.90) — by how well his identity suits the football
 * that club plays.
 *
 * The tactic term is what makes an AI club sign FOR ITS SYSTEM rather than
 * collect the highest-rated bodies available: between two equally-rated wingers,
 * a possession side now prefers the one its style actually gets something out
 * of. It reads `tacticalFitMult`, the same lever the match applies, so a club
 * cannot value a signing on terms the simulation won't honour.
 *
 * The argument is optional because the same function answers "how good is he
 * here" in contexts with no tactic in view; omitted, this is the pure ability
 * measure it has always been.
 */
export function effectiveAt(p: PlayerBio, pos: Pos, cfg: TuningConfig, tactic?: Tactic): number {
  const base = p.overall * positionFit(p.positions, pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
  return tactic ? base * tacticalFitMult(toEnginePlayer(p), tactic, cfg) : base;
}

/**
 * Rank the club's positions by how badly it needs a player there. A position is
 * needy when the best available body is weak relative to the rest of the squad,
 * or when nobody real can cover it at all.
 */
export function squadNeeds(state: GameState, team: Team, cfg: TuningConfig): PositionNeed[] {
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  if (!squad.length) return [];
  // The club's own standard — what a typical starter for them looks like.
  const benchmark =
    [...squad].sort((a, b) => b.overall - a.overall).slice(0, 11).reduce((n, p) => n + p.overall, 0) /
    Math.min(11, squad.length);

  const needs: PositionNeed[] = [];
  const counted = new Map<Pos, number>();
  for (const pos of requiredSlots(team)) counted.set(pos, (counted.get(pos) ?? 0) + 1);

  for (const [pos, slotsNeeded] of counted) {
    // Rated against the club's own tactic (v1.90), so the incumbent a signing
    // has to beat is measured on the same terms the signing will be — see
    // `targetScore`. A player who doesn't suit the system is a weaker incumbent
    // than his raw overall suggests, which is precisely when the club should be
    // shopping for that position.
    const ranked = squad
      .map((p) => effectiveAt(p, pos, cfg, team.tactic))
      .sort((a, b) => b - a);
    // Genuine cover = someone who plays there or adjacent, not a filler.
    const depth = squad.filter(
      (p) => positionFit(p.positions, pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor) >= cfg.adjacentPositionMult
    ).length;
    // Players who actually LIST the position (v1.89). A back four covered by
    // three full-backs and a defensive midfielder passes the `depth` test above
    // and is still a side with no centre-backs — this is the number the
    // minimum-cover rule reads.
    const naturalDepth = squad.filter((p) => p.positions.includes(pos)).length;
    // The weakest player this formation would be forced to start here — zero if
    // the slot simply can't be filled. This is what a signing has to beat.
    const incumbent = ranked[slotsNeeded - 1] ?? 0;
    const shortfall = benchmark - incumbent;
    const thin = Math.max(0, slotsNeeded + 1 - depth); // want one spare per slot
    // A position the club cannot field NATURALLY is a different kind of problem
    // from a weak one, and the ordinary shortfall arithmetic understates it: a
    // side with no centre-back but a competent full-back filling in reads as a
    // modest rating gap rather than as a missing player. `aiMissingCoverUrgency`
    // per unfilled natural slot is what pushes the genuinely absent position to
    // the top of the list, ahead of every "could be better here".
    const uncovered = Math.max(0, slotsNeeded - naturalDepth);
    needs.push({
      pos,
      incumbent,
      best: ranked[0] ?? 0,
      depth,
      naturalDepth,
      slotsNeeded,
      urgency: shortfall + thin * cfg.aiDepthUrgencyWeight + uncovered * cfg.aiMissingCoverUrgency,
    });
  }
  return needs.sort((a, b) => b.urgency - a.urgency);
}

/**
 * Can the club field this position with players who actually play there (v1.89)?
 *
 * The single definition of "a genuine hole", shared by every path that has to
 * treat one differently from an ordinary upgrade — which need to shop for, how
 * hard to try, whether to bypass the free-agent pool floor. It is deliberately
 * about the FORMATION's requirement rather than a bare count: one natural
 * centre-back is a hole in a back four and a full complement in a back three, so
 * `naturalDepth` alone can't answer it.
 */
export function isUncovered(need: PositionNeed): boolean {
  return need.naturalDepth < need.slotsNeeded;
}

/** Positions the club cannot field naturally, most urgent first. `squadNeeds`
 * already sorts these to the front via `aiMissingCoverUrgency`. */
export function uncoveredPositions(state: GameState, team: Team, cfg: TuningConfig): PositionNeed[] {
  return squadNeeds(state, team, cfg).filter(isUncovered);
}

/**
 * Score a potential signing for a club: does this player actually improve them,
 * in a way that fits the stance? Returns 0 for "no reason to sign him".
 */
export function targetScore(
  state: GameState,
  team: Team,
  need: PositionNeed,
  p: PlayerBio,
  cfg: TuningConfig
): number {
  const profile = STANCE_PROFILE[stanceOf(state, team, cfg)];
  const [minAge, maxAge] = profile.targetAge;
  // Outside the stance's age band, interest falls away sharply.
  const ageMiss = p.age < minAge ? minAge - p.age : p.age > maxAge ? p.age - maxAge : 0;
  const ageFit = Math.pow(cfg.aiAgeBandFalloff, ageMiss);

  // Scored against the club's own tactic (v1.90): between two equally-rated
  // players the club prefers the one its style and instructions actually get
  // something out of. `need.incumbent` is measured the same way in `squadNeeds`,
  // so the comparison is like for like.
  const ability = effectiveAt(p, need.pos, cfg, team.tactic);
  const headroom = Math.max(0, p.potential - p.overall);

  // The whole point: he has to be better than what's already there — either now
  // (ability) or later (potential), weighted by stance. `need.incumbent` is the
  // MARGINAL starter (v1.89) — the weakest player the formation would be forced
  // to field here, and 0 when the slot can't be filled at all — so a candidate
  // for an empty slot is measured against nothing rather than against the club's
  // best player in that position. Before v1.89 this field held `ranked[0]`, which
  // meant a club with one good centre-back and a formation asking for two judged
  // every centre-back in the world "not an upgrade" and never signed one.
  const nowGain = ability - need.incumbent;
  const laterGain = p.potential * positionFit(p.positions, need.pos, cfg.adjacentPositionMult, cfg.outOfPositionFloor) - need.incumbent;
  const gain = profile.abilityWeight * nowGain + profile.potentialWeight * Math.max(0, laterGain) * (headroom > 0 ? 1 : 0);
  if (gain <= cfg.aiMinUpgradeGain) return 0;

  // Filling a position the club has no natural body for is not a squad upgrade
  // to be weighed against the stance's shopping preferences — it is the thing
  // the club has to do (v1.89). A candidate who genuinely plays there is scored
  // as if he were the club's most urgent target regardless of his age, so a
  // rebuilding side short of a centre-back will take a 30-year-old rather than
  // field none. He still has to clear the upgrade bar above; this changes what
  // the club *prefers*, never what it will accept.
  const fillsAGap = isUncovered(need) && p.positions.includes(need.pos);
  const preference = fillsAGap ? Math.max(ageFit, cfg.aiGapFillMinAgeFit) : ageFit;

  return gain * preference * (1 + need.urgency * cfg.aiNeedScoreWeight);
}

/**
 * Appearances this player has made FOR THIS CLUB (v1.90) — completed seasons
 * from his career rows plus the season in progress.
 *
 * Club-specific on purpose: a 33-year-old with 400 games elsewhere and 3 here is
 * not somebody these supporters would miss, and the guard this feeds is about
 * what a club's own crowd would make of the sale. Career rows written before
 * v1.65 carry no `clubId`; those fall back to matching on club NAME, so an old
 * save still recognises its own long servers rather than treating every one of
 * them as a new arrival.
 */
function clubApps(state: GameState, p: PlayerBio, clubId: string): number {
  const career = state.careers?.[p.id];
  const clubName = state.teams[clubId]?.name;
  const past = (career?.seasons ?? []).reduce(
    (n, row) => (row.clubId ? row.clubId === clubId : row.clubName === clubName) ? n + (row.apps ?? 0) : n,
    0
  );
  // The running season only counts toward the club he is at right now.
  return past + (p.clubId === clubId ? (p.stats?.apps ?? 0) : 0);
}

/**
 * Players this club is willing to move on, worst-fit first. Driven entirely by
 * stance: a rebuilding club cashes in on its thirty-somethings and will even
 * sell a star, a title-chasing one only clears deadwood.
 */
export function saleCandidates(state: GameState, team: Team, cfg: TuningConfig): PlayerBio[] {
  const profile = STANCE_PROFILE[stanceOf(state, team, cfg)];
  const starters = bestXIIds(state, team);
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  const needs = squadNeeds(state, team, cfg);
  const needyPositions = new Set(needs.slice(0, 2).map((n) => n.pos));

  // Minimum positional cover (v1.89) — the hard floor no stance may cross.
  //
  // The `needyPositions` guard below is soft twice over: it looks at only the two
  // most urgent holes, and `sellsStarters` (rebuild and stabilise) skips it
  // entirely. A rebuilding club would therefore happily sell its last centre-back
  // — which is precisely how a squad ends up unable to field one at all. This
  // counts natural cover per position and refuses to take a club below the
  // formation's requirement plus `aiMinSpareCover`, whatever its stance says.
  //
  // Note it counts NATURAL positions, not adjacent cover: selling the last
  // centre-back because two full-backs could stand in is the same mistake in a
  // different costume.
  const naturalCount = new Map<Pos, number>();
  for (const p of squad) for (const pos of p.positions) naturalCount.set(pos, (naturalCount.get(pos) ?? 0) + 1);
  const requiredSlotCount = new Map<Pos, number>();
  for (const pos of requiredSlots(team)) requiredSlotCount.set(pos, (requiredSlotCount.get(pos) ?? 0) + 1);
  /** Would selling him take any position he covers below its floor? */
  const wouldStripCover = (p: PlayerBio): boolean =>
    p.positions.some((pos) => {
      const needed = requiredSlotCount.get(pos) ?? 0;
      if (needed === 0) return false; // the formation doesn't ask for it
      return (naturalCount.get(pos) ?? 0) <= needed + cfg.aiMinSpareCover;
    });

  // Key players (v1.90) — the established first-teamers a club hangs on to.
  //
  // A club would previously part with anyone its stance allowed, which let the
  // user hollow out a rival by buying its best XI one player a window: the
  // players a club should least want to lose were the ones most likely to clear
  // the "is this an upgrade for the buyer" bar, so they left first. Two things
  // have to be true for the guard to bite — he has to be one of the club's BEST
  // (top `aiKeyPlayerCount` by tactical value), and he has to have PLAYED for
  // them (`aiKeyPlayerApps` appearances, ~two seasons). Ability alone would
  // protect a summer signing nobody has seen yet; appearances alone would
  // protect a loyal squad player the club is happy to move on.
  //
  // It is a reluctance, not a ban: a `aiKeyPlayerSellChance` roll still opens the
  // door, so marquee transfers happen — just rarely, and not on demand. The roll
  // is derived from the world seed plus club, player and season, so it is fixed
  // for the window: a rejected bidder cannot re-roll it by bidding again, and a
  // reloaded save answers identically.
  //
  // The appearance test has to tolerate a world with no history: worldgen seeds
  // no career rows, so in season 1 NOBODY clears the gate and a brand-new save
  // would be an open raiding window on exactly the clubs this protects
  // (measured: 0 of 240 top-six players qualified at kickoff, 228 by season 5).
  // A club that has not played yet falls back to standing alone — its best are
  // its key men until there are appearances to say otherwise. This is a floor on
  // the test, not a second rule: once the games are played, apps decide.
  const played = squad.some((p) => clubApps(state, p, team.id) > 0);
  const keyIds = new Set(
    [...squad]
      .filter((p) => !played || clubApps(state, p, team.id) >= cfg.aiKeyPlayerApps)
      .sort((a, b) => effectiveAt(b, b.positions[0], cfg, team.tactic) - effectiveAt(a, a.positions[0], cfg, team.tactic))
      .slice(0, cfg.aiKeyPlayerCount)
      .map((p) => p.id)
  );
  const willSellKeyPlayer = (p: PlayerBio): boolean =>
    mulberry32(deriveSeed(state.seed, `keysale:${state.season}:${team.id}:${p.id}`))() < cfg.aiKeyPlayerSellChance;

  return squad
    .filter((p) => {
      // The floor first: it outranks every stance, including the ones that sell
      // starters. A club may rebuild; it may not field ten men.
      if (wouldStripCover(p)) return false;
      // The club's own — kept unless this window's roll says otherwise.
      if (keyIds.has(p.id) && !willSellKeyPlayer(p)) return false;
      // Same-season resale lock (v1.89). A player who joined this season can't be
      // moved on until the next one — the same rule the user's sell paths have
      // enforced since v1.54, now applied to every club. This is the chokepoint
      // for it on the AI side: club-to-club deals, the sim world's windows and
      // the playable-league burst all shop from this one list, so the rule can't
      // be bypassed by whichever path someone forgets. (The predicate is inlined
      // rather than imported from lib/transfers.ts — that module imports this
      // one, and it is a single field comparison.)
      if (p.acquiredSeason === state.season) return false;
      if (starters.has(p.id) && !profile.sellsStarters) return false;
      // Never strip a position the club is already short in.
      if (p.positions.some((pos) => needyPositions.has(pos)) && !profile.sellsStarters) return false;
      // Old enough to be moved on, or simply surplus to requirements.
      const old = p.age >= profile.sellFromAge;
      const surplus = !starters.has(p.id);
      return old || surplus;
    })
    // Sell the oldest and least useful first.
    .sort((a, b) => b.age - a.age || a.overall - b.overall);
}

/** What this club will pay for a given player, given its stance and means. */
export function buyBudgetFor(state: GameState, team: Team, p: PlayerBio, cfg: TuningConfig): number {
  const profile = STANCE_PROFILE[stanceOf(state, team, cfg)];
  const willing = p.value * profile.buyPremium;
  // Never commit more than a share of the war chest to one player, and never
  // spend down to nothing — a reserve is always held back (v19).
  const spendable = spendableBudget(state, team, cfg);
  return Math.min(willing, spendable * cfg.aiMaxBudgetSharePerDeal);
}

// ── Club finances (v19) ───────────────────────────────────────────────────
// AI clubs used to buy against their raw budget number, which let a club spend
// itself to zero and left the market untethered from the economy. These helpers
// make a club's means the real constraint: it keeps a cash reserve, it must be
// able to cover its wage bill, and it banks what it earns from selling.

/** This club's weekly wage bill. */
export function wageBill(state: GameState, team: Team): number {
  return team.playerIds
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired)
    .reduce((n, p) => n + (p.contract?.wage ?? 0), 0);
}

/**
 * The part of a club's budget it is actually willing to spend. A club always
 * holds back a reserve (`aiBudgetReserveRatio`) plus enough cash to cover the
 * wage bill for `aiWageReserveWeeks` — so a signing can never leave it unable
 * to pay the players it already has.
 */
export function spendableBudget(state: GameState, team: Team, cfg: TuningConfig): number {
  const reserve = team.budget * cfg.aiBudgetReserveRatio;
  const wageCushion = wageBill(state, team) * cfg.aiWageReserveWeeks;
  return Math.max(0, team.budget - reserve - wageCushion);
}

/** A club below its wage cushion is in trouble and must raise cash: it sells at
 * a discount and won't buy at all until the books are back in order. */
export function isDistressed(state: GameState, team: Team, cfg: TuningConfig): boolean {
  return team.budget < wageBill(state, team) * cfg.aiWageReserveWeeks;
}

/**
 * Can this club afford to add a player at `fee` on `wage` a week? Both halves
 * matter — a free transfer on wages the club can't service is just as ruinous
 * as an unaffordable fee, and this is what stops AI squads inflating without
 * limit (v19).
 */
export function canAfford(
  state: GameState,
  team: Team,
  fee: number,
  weeklyWage: number,
  cfg: TuningConfig
): boolean {
  if (isDistressed(state, team, cfg)) return false;
  if (fee > spendableBudget(state, team, cfg)) return false;
  // Wage discipline: the bill after signing must stay within a share of income.
  const income = weeklyIncomeEstimate(state, team, cfg);
  const billAfter = wageBill(state, team) + weeklyWage;
  return billAfter <= income * cfg.aiMaxWageToIncomeRatio;
}

/**
 * A club's weekly income, for wage-affordability tests. Deliberately a light
 * estimate rather than a call into the economy module: it needs only the stable
 *, recurring lines (broadcast, gate, commercial), and keeping it here avoids a
 * circular import between the AI and economy layers.
 */
export function weeklyIncomeEstimate(state: GameState, team: Team, cfg: TuningConfig): number {
  const league = state.leagues[team.leagueId];
  // Both lines are read at the club's own tier, clamped into the tuning arrays
  // (v1.67). Inlined rather than imported from lib/economy to keep this module
  // free of that dependency — see the note above.
  const at = (table: number[], tier: number) =>
    table.length ? table[Math.max(0, Math.min(table.length - 1, Math.round(tier) - 1))] : 0;
  const tier = league?.tier ?? 2;
  const tv = at(cfg.weeklyIncomeByTier, tier);
  const gate = team.reputation * at(cfg.gateIncomePerReputationByTier, tier);
  const commercial = team.commercialIncome ?? 0;
  const base = tv + gate + commercial;

  // Squad-quality scaling (v1.51). The wage curve is EXPONENTIAL in overall while
  // the tier income above is a flat constant, so a database with better players
  // than the built-in one inflates every wage bill without moving income at all.
  // Whole divisions then sat permanently over `aiMaxWageToIncomeRatio`, which made
  // `canAfford` reject every signing and froze the transfer market — the "I changed
  // the database and the AI stopped doing transfers" bug.
  //
  // Income therefore scales with the standard of football the club actually plays,
  // using the SAME exponent as the wage curve so the two move together and the
  // ratio is database-independent. Clamped so a modded outlier can't run away.
  const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
  if (!squad.length) return base;
  const avgOverall = squad.reduce((n, p) => n + p.overall, 0) / squad.length;
  const gap = avgOverall - cfg.wageIncomeBaselineOverall;
  const mult = Math.max(
    cfg.wageIncomeQualityMultMin,
    Math.min(cfg.wageIncomeQualityMultMax, Math.exp(gap * cfg.wagePerOverallCurve.exponent))
  );
  return base * mult;
}

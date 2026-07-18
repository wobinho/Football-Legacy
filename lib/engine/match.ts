// ── Match Engine (GAME_DESIGN.md §7) ──────────────────────────────────────
// Pure function: squads + tactics + config + seed → events + result.
// Deterministic given a seed. Randomness lives in exactly two places:
// how many chances occur, and whether each converts.
//
// 90 minutes = 6 × 15-minute segments. Per segment:
//   1. effective rating per player  (overall × fit × synergy × form × fitness)
//   2. aggregate ATTACK / MIDFIELD / DEFENSE phase strengths
//   3. midfield share → chance volume (Poisson around expectation)
//   4. each chance: ATTACK vs DEFENSE → squashed goal probability
//
// The interactive wrapper exposes the single in-match interaction point:
// a tactic change at halftime (§6).

import type { Focus, MatchEvent, MatchResult, Mentality, Pos, Style, Tactic } from "../types";
import type { TuningConfig } from "../config/tuning";
import { getArchetype } from "../config/archetypes";
import { TRAIT_MAP } from "../config/traits";
import { PHASE_WEIGHTS, positionFit } from "../config/positions";
import { mulberry32, pickWeighted, randPoisson, type RNG } from "../rng";

// Resolved tactic-instruction defaults — a tactic may omit the expanded fields
// (v2 saves); the engine always reads a concrete value.
function tac<T>(v: T | undefined, fallback: T): T {
  return v ?? fallback;
}
function resolveTempo(t: Tactic) { return tac(t.tempo, "Standard" as const); }
function resolveWidth(t: Tactic) { return tac(t.width, "Standard" as const); }
function resolvePress(t: Tactic) { return tac(t.press, "Medium" as const); }
function resolveLine(t: Tactic) { return tac(t.line, "Standard" as const); }
function resolveFocus(t: Tactic): Focus { return tac(t.focus, "Mixed"); }

/** Left/right/central classification of a slot for width + focus handling. */
function slotSide(pos: Pos): "left" | "right" | "central" {
  if (pos === "LB" || pos === "LW") return "left";
  if (pos === "RB" || pos === "RW") return "right";
  return "central";
}
function isWide(pos: Pos): boolean {
  return slotSide(pos) !== "central";
}

export interface EnginePlayer {
  id: string;
  name: string;
  overall: number;
  positions: Pos[];
  archetypeId: string;
  traits: string[];
  form: number;
  fitness: number; // at kickoff
}

export interface LineupEntry {
  slotPos: Pos;
  player: EnginePlayer;
}

export interface SideInput {
  teamId: string;
  name: string;
  short: string;
  lineup: LineupEntry[]; // the XI
  bench: EnginePlayer[];
  tactic: Tactic;
  /** Head-coach match-day edge: effective-rating multiplier (1 = no coach). */
  coachMult?: number;
  /** EA-FC-style on-pitch assignments (v6). Player ids drawn from the XI; the
   * captain lifts the side (Leader trait), takers bias scorer/assist selection
   * on the relevant chances. Absent for AI sides (they field no assignments). */
  captainId?: string;
  penaltyTakerId?: string;
  freeKickTakerId?: string;
  cornerTakerId?: string;
}

interface OnPitch {
  entry: LineupEntry;
  enteredMinute: number;
  leftMinute: number | null;
}

interface SideState {
  input: SideInput;
  onPitch: OnPitch[];
  bench: EnginePlayer[];
  subsUsed: number;
  goals: number;
  chances: number;
  onTarget: number;
  midSum: number; // for possession
  tactic: Tactic;
  coachMult: number;
  /** Hidden style×mentality counter edge on ATTACK vs the current opponent (§6). */
  counterAttackMult: number;
}

export interface MatchState {
  rng: RNG;
  home: SideState;
  away: SideState;
  segment: number; // next segment to play (0-5)
  events: MatchEvent[];
  scorers: MatchResult["scorers"];
  cfg: TuningConfig;
}

const CHANCE_TEXT = [
  "{p} gets a sight of goal but the keeper stands tall.",
  "{p} shoots — inches wide!",
  "Great block! {p}'s effort is smothered.",
  "{p} forces a smart save at the near post.",
  "{p} heads over from a dangerous cross.",
  "{p} dances into the box but drags it wide.",
];

function fitnessMult(fitness: number, cfg: TuningConfig): number {
  const f = Math.max(0, Math.min(100, fitness));
  return cfg.fitnessFloorMult + (1 - cfg.fitnessFloorMult) * (f / 100);
}

function synergyMult(archetypeId: string, tactic: Tactic, cfg: TuningConfig): number {
  const raw = getArchetype(archetypeId).styleSynergy[tactic.style] ?? 1;
  return Math.max(1 - cfg.synergyCap, Math.min(1 + cfg.synergyCap, raw));
}

/** In-match fitness drain rate for a side, scaled by tempo + press instructions. */
function drainRateMult(side: SideState, cfg: TuningConfig): number {
  return (
    cfg.tempoFitnessDrainMult[resolveTempo(side.tactic)] *
    cfg.pressFitnessDrainMult[resolvePress(side.tactic)]
  );
}

/** Step 1 — effective rating for one on-pitch player at a given match minute. */
function effectiveRating(
  op: OnPitch,
  side: SideState,
  isHome: boolean,
  minute: number,
  cfg: TuningConfig
): number {
  const p = op.entry.player;
  const minutesPlayed = minute - op.enteredMinute;
  const drained = p.fitness - (minutesPlayed / 90) * cfg.fitnessDrainPerMatch * drainRateMult(side, cfg);
  const fit = positionFit(p.positions, op.entry.slotPos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
  let eff =
    p.overall *
    fit *
    synergyMult(p.archetypeId, side.tactic, cfg) *
    p.form *
    fitnessMult(drained, cfg) *
    side.coachMult;
  // Width shifts emphasis between wide and central roles (a wide player is worth
  // more in a Wide setup, less in a Narrow one, and vice-versa).
  if (isWide(op.entry.slotPos)) eff *= cfg.widthWideMult[resolveWidth(side.tactic)];
  else if (op.entry.slotPos !== "GK") eff *= cfg.widthCentralMult[resolveWidth(side.tactic)];
  if (isHome) eff *= cfg.homeAdvantage;
  if (minute >= cfg.clutchMinute) {
    for (const t of p.traits) {
      const cm = TRAIT_MAP[t]?.effects.clutchMult;
      if (cm) eff *= cm;
    }
  }
  return eff;
}

/** Step 2 — phase strengths. Also applies Leader team buff + mentality defense mult. */
function phaseStrengths(side: SideState, isHome: boolean, minute: number, cfg: TuningConfig) {
  let attack = 0.01;
  let midfield = 0.01;
  let defense = 0.01;
  let teamBuff = 1;
  let concedeMult = 1; // < 1 = this side's back line lets opponents convert fewer chances (Wall)
  for (const op of side.onPitch) {
    if (op.leftMinute !== null) continue;
    const isCaptain = side.input.captainId === op.entry.player.id;
    for (const t of op.entry.player.traits) {
      const eff = TRAIT_MAP[t]?.effects;
      if (!eff) continue;
      if (eff.teamBuffMult) teamBuff = Math.min(1.05, teamBuff * eff.teamBuffMult);
      // the armband unlocks a Leader's extra buff (captainBuffMult)
      if (isCaptain && eff.captainBuffMult) teamBuff = Math.min(1.05, teamBuff * eff.captainBuffMult);
      if (eff.concedeMult) concedeMult = Math.max(0.82, concedeMult * eff.concedeMult);
    }
  }
  for (const op of side.onPitch) {
    if (op.leftMinute !== null) continue;
    const eff = effectiveRating(op, side, isHome, minute, cfg) * teamBuff;
    const w = PHASE_WEIGHTS[op.entry.slotPos];
    attack += eff * w.attack;
    midfield += eff * w.midfield;
    defense += eff * w.defense;
  }
  defense *= cfg.mentalityDefenseMult[side.tactic.mentality];
  // Press wins more of the midfield battle; a higher line trades solidity for
  // territory; the hidden counter edge tilts attacking output.
  midfield *= cfg.pressMidfieldMult[resolvePress(side.tactic)];
  defense *= cfg.lineDefenseMult[resolveLine(side.tactic)];
  attack *= side.counterAttackMult;
  return { attack, midfield, defense, concedeMult };
}

function activePlayers(side: SideState): OnPitch[] {
  return side.onPitch.filter((op) => op.leftMinute === null);
}

/** Attacking-focus multiplier for a slot: emphasised side/centre gets more of the ball. */
function focusMult(focus: Focus, pos: Pos, cfg: TuningConfig): number {
  if (focus === "Mixed") return 1;
  const side = slotSide(pos);
  const target = focus === "Central" ? "central" : focus === "Left" ? "left" : "right";
  return side === target ? 1 + cfg.focusFlankBias : 1;
}

type SetPiece = "penalty" | "freekick" | "corner" | null;

/** Roll whether a chance is a set piece. Penalties are rare; free-kicks and
 * corners are more common and route the ball to the designated taker. */
function rollSetPiece(rng: RNG, side: SideState, cfg: TuningConfig): SetPiece {
  const r = rng();
  if (r < cfg.penaltyChance) return "penalty";
  if (r < cfg.penaltyChance + cfg.freeKickChance) return "freekick";
  if (r < cfg.penaltyChance + cfg.freeKickChance + cfg.cornerChance) return "corner";
  return null;
}

/** Step 4 helper — pick scorer & assister with archetype-weighted probabilities.
 * On a set piece, the designated taker is heavily favoured (penalty/free-kick →
 * scorer; corner → assister), honouring the EA-FC-style assignments. */
function pickScorer(rng: RNG, side: SideState, cfg: TuningConfig, setPiece: SetPiece = null): { scorer: OnPitch; assister: OnPitch | null } {
  const focus = resolveFocus(side.tactic);
  const active = side.onPitch.filter((op) => op.leftMinute === null && op.entry.slotPos !== "GK");
  const takerId =
    setPiece === "penalty" ? side.input.penaltyTakerId : setPiece === "freekick" ? side.input.freeKickTakerId : null;
  const cornerTakerId = setPiece === "corner" ? side.input.cornerTakerId : null;

  const scorer = pickWeighted(rng, active, (op) => {
    const arch = getArchetype(op.entry.player.archetypeId);
    let w = arch.scorerWeight * (0.25 + PHASE_WEIGHTS[op.entry.slotPos].attack) * op.entry.player.overall;
    w *= focusMult(focus, op.entry.slotPos, cfg);
    for (const t of op.entry.player.traits) {
      const sm = TRAIT_MAP[t]?.effects.scorerMult;
      if (sm) w *= sm;
    }
    // penalty / free-kick taker steps up to take (and usually score) it
    if (takerId && op.entry.player.id === takerId) w *= cfg.setPieceTakerBias;
    // the corner taker crosses it in rather than heading it home
    if (cornerTakerId && op.entry.player.id === cornerTakerId) w *= 0.4;
    return w;
  });
  let assister: OnPitch | null = null;
  const assistChance = setPiece === "corner" ? 0.85 : 0.65;
  if (rng() < assistChance) {
    const others = active.filter((op) => op !== scorer);
    if (others.length) {
      assister = pickWeighted(rng, others, (op) => {
        const arch = getArchetype(op.entry.player.archetypeId);
        const w = PHASE_WEIGHTS[op.entry.slotPos];
        let aw = arch.assistWeight * (0.2 + w.attack * 0.6 + w.midfield * 0.4) * op.entry.player.overall * focusMult(focus, op.entry.slotPos, cfg);
        for (const t of op.entry.player.traits) {
          const am = TRAIT_MAP[t]?.effects.assistMult;
          if (am) aw *= am;
        }
        // the designated corner taker whips in the assist
        if (cornerTakerId && op.entry.player.id === cornerTakerId) aw *= cfg.setPieceTakerBias;
        return aw;
      });
    }
  }
  return { scorer, assister };
}

function goalText(rng: RNG, scorer: OnPitch, assister: OnPitch | null): string {
  const arch = getArchetype(scorer.entry.player.archetypeId);
  const tmpl = arch.goalFlavor[Math.floor(rng() * arch.goalFlavor.length)] ?? "{p} scores!";
  let text = tmpl.replace("{p}", scorer.entry.player.name);
  if (assister) text += ` (assist: ${assister.entry.player.name})`;
  return text;
}

/** Auto-subs at cfg.subMinutes: bring on fresher legs for tired players. */
function maybeSubs(state: MatchState, side: SideState, minute: number) {
  const cfg = state.cfg;
  if (side.subsUsed >= cfg.maxSubs) return;
  const drainMult = drainRateMult(side, cfg);
  const active = activePlayers(side)
    .filter((op) => op.entry.slotPos !== "GK")
    .map((op) => {
      const played = minute - op.enteredMinute;
      const currentFitness = op.entry.player.fitness - (played / 90) * cfg.fitnessDrainPerMatch * drainMult;
      return { op, currentFitness };
    })
    .sort((a, b) => a.currentFitness - b.currentFitness);

  for (const { op, currentFitness } of active.slice(0, 2)) {
    if (side.subsUsed >= cfg.maxSubs) break;
    if (currentFitness > 55) continue;
    const slotPos = op.entry.slotPos;
    const candidates = side.bench.filter((b) => b.positions[0] !== "GK");
    if (!candidates.length) continue;
    // best bench option for this slot
    let best: EnginePlayer | null = null;
    let bestEff = 0;
    for (const b of candidates) {
      const fit = positionFit(b.positions, slotPos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
      const eff = b.overall * fit * fitnessMult(b.fitness, cfg);
      if (eff > bestEff) {
        bestEff = eff;
        best = b;
      }
    }
    const tiredEff = op.entry.player.overall * fitnessMult(currentFitness, cfg);
    if (best && bestEff > tiredEff * 0.98) {
      op.leftMinute = minute;
      side.bench = side.bench.filter((b) => b.id !== best.id);
      side.onPitch.push({
        entry: { slotPos, player: best },
        enteredMinute: minute,
        leftMinute: null,
      });
      side.subsUsed++;
      state.events.push({
        minute,
        type: "sub",
        teamId: side.input.teamId,
        text: `${side.input.short}: ${best.name} replaces ${op.entry.player.name}.`,
      });
    }
  }
}

function playSegment(state: MatchState) {
  const { cfg, rng } = state;
  const seg = state.segment;
  const segStart = seg * cfg.minutesPerSegment;

  // subs at configured minutes that fall on this segment boundary
  for (const m of cfg.subMinutes) {
    if (m === segStart) {
      maybeSubs(state, state.home, m);
      maybeSubs(state, state.away, m);
    }
  }

  const midMinute = segStart + Math.floor(cfg.minutesPerSegment / 2);
  const hp = phaseStrengths(state.home, true, midMinute, cfg);
  const ap = phaseStrengths(state.away, false, midMinute, cfg);

  // Step 3 — midfield decides chance volume (sharpness makes quality tell)
  const k = cfg.midfieldSharpness;
  const hMid = Math.pow(hp.midfield, k);
  const aMid = Math.pow(ap.midfield, k);
  const homeShare = hMid / (hMid + aMid);
  state.home.midSum += homeShare;
  state.away.midSum += 1 - homeShare;

  const mentality = (own: SideState, opp: SideState) =>
    cfg.mentalityChanceMult[own.tactic.mentality] *
    (1 + (cfg.mentalityChanceMult[opp.tactic.mentality] - 1) * 0.6);

  // Tempo raises chance volume for both teams (like a mentality dial); a side's
  // own chances also rise when the OPPONENT presses hard or holds a high line
  // (space in behind). These are the levers that make instructions felt.
  const tempoMult = (own: SideState, opp: SideState) =>
    (cfg.tempoChanceMult[resolveTempo(own.tactic)] + cfg.tempoChanceMult[resolveTempo(opp.tactic)]) / 2;
  const exposure = (opp: SideState) =>
    cfg.pressOppChanceMult[resolvePress(opp.tactic)] * cfg.lineOppChanceMult[resolveLine(opp.tactic)];

  const perSegBase = cfg.baseChancesPerSegment;
  const homeLambda = perSegBase * homeShare * mentality(state.home, state.away) * tempoMult(state.home, state.away) * exposure(state.away);
  const awayLambda = perSegBase * (1 - homeShare) * mentality(state.away, state.home) * tempoMult(state.away, state.home) * exposure(state.home);

  interface PendingChance {
    side: SideState;
    opp: { defense: number; concedeMult: number };
    attack: number;
    minute: number;
  }
  const chances: PendingChance[] = [];
  const nHome = randPoisson(rng, homeLambda);
  const nAway = randPoisson(rng, awayLambda);
  for (let i = 0; i < nHome; i++)
    chances.push({ side: state.home, opp: ap, attack: hp.attack, minute: segStart + 1 + Math.floor(rng() * (cfg.minutesPerSegment - 1)) });
  for (let i = 0; i < nAway; i++)
    chances.push({ side: state.away, opp: hp, attack: ap.attack, minute: segStart + 1 + Math.floor(rng() * (cfg.minutesPerSegment - 1)) });
  chances.sort((a, b) => a.minute - b.minute);

  // Step 4 — contested rolls
  for (const c of chances) {
    c.side.chances++;
    const q = c.attack / (c.attack + c.opp.defense); // ≈ chanceQualityCenter when even
    const squash = 1 / (1 + Math.exp(-cfg.chanceQualitySlope * (q - cfg.chanceQualityCenter)));
    // is this a set piece? penalties are rare & high-conversion; free-kicks /
    // corners are a normal chance but route the ball to the designated taker.
    const setPiece = rollSetPiece(rng, c.side, cfg);
    let pGoal = cfg.goalProbFloor + (cfg.goalProbCeil - cfg.goalProbFloor) * squash;
    // the opponent's back line (Wall) makes goals harder to come by
    pGoal *= c.opp.concedeMult;
    if (setPiece === "penalty") pGoal = cfg.penaltyConversion;
    if (rng() < pGoal) {
      c.side.goals++;
      c.side.onTarget++;
      const { scorer, assister } = pickScorer(rng, c.side, cfg, setPiece);
      state.scorers.push({
        playerId: scorer.entry.player.id,
        teamId: c.side.input.teamId,
        minute: c.minute,
        assistId: assister?.entry.player.id,
      });
      state.events.push({
        minute: c.minute,
        type: "goal",
        teamId: c.side.input.teamId,
        scorerId: scorer.entry.player.id,
        assistId: assister?.entry.player.id,
        text: `GOAL! ${state.home.goals}-${state.away.goals} — ${goalText(rng, scorer, assister)}`,
      });
    } else {
      if (rng() < 0.55) c.side.onTarget++;
      if (rng() < 0.45) {
        const { scorer } = pickScorer(rng, c.side, cfg, setPiece);
        state.events.push({
          minute: c.minute,
          type: "chance",
          teamId: c.side.input.teamId,
          text: CHANCE_TEXT[Math.floor(rng() * CHANCE_TEXT.length)].replace("{p}", scorer.entry.player.name),
        });
      }
    }
  }

  state.segment++;
}

function makeSideState(input: SideInput): SideState {
  return {
    input,
    onPitch: input.lineup.map((entry) => ({ entry, enteredMinute: 0, leftMinute: null })),
    bench: input.bench.slice(),
    subsUsed: 0,
    goals: 0,
    chances: 0,
    onTarget: 0,
    midSum: 0,
    tactic: { ...input.tactic },
    coachMult: input.coachMult ?? 1,
    counterAttackMult: 1,
  };
}

/**
 * Hidden counter edge (§6): own ATTACK is multiplied by how well own style and
 * mentality match up against the opponent's. Recomputed whenever a side's tactic
 * changes (kickoff and any halftime tweak) so the read stays live. Never surfaced
 * in the UI — the player discovers matchups by playing.
 */
function refreshCounters(state: MatchState) {
  const { cfg } = state;
  const edge = (own: SideState, opp: SideState) => {
    const s: Style = own.tactic.style;
    const os: Style = opp.tactic.style;
    const m: Mentality = own.tactic.mentality;
    const om: Mentality = opp.tactic.mentality;
    return (cfg.styleCounter[s]?.[os] ?? 1) * (cfg.mentalityCounter[m]?.[om] ?? 1);
  };
  state.home.counterAttackMult = edge(state.home, state.away);
  state.away.counterAttackMult = edge(state.away, state.home);
}

export function createMatch(home: SideInput, away: SideInput, cfg: TuningConfig, seed: number): MatchState {
  const state: MatchState = {
    rng: mulberry32(seed >>> 0),
    home: makeSideState(home),
    away: makeSideState(away),
    segment: 0,
    events: [],
    scorers: [],
    cfg,
  };
  refreshCounters(state);
  state.events.push({ minute: 0, type: "kickoff", text: `Kick-off: ${home.name} vs ${away.name}.` });
  return state;
}

/** Play segments 1-3. Returns state paused at halftime for the tactic tweak. */
export function playFirstHalf(state: MatchState): MatchState {
  while (state.segment < 3) playSegment(state);
  state.events.push({
    minute: 45,
    type: "halftime",
    text: `Half-time: ${state.home.input.name} ${state.home.goals}-${state.away.goals} ${state.away.input.name}.`,
  });
  return state;
}

/** The one in-match interaction point (§6): change mentality/style at the break. */
export function applyHalftimeTactic(state: MatchState, side: "home" | "away", tactic: Partial<Tactic>) {
  const s = side === "home" ? state.home : state.away;
  s.tactic = { ...s.tactic, ...tactic };
  refreshCounters(state); // the matchup shifts with the change
}

export function playSecondHalf(state: MatchState): MatchState {
  while (state.segment < state.cfg.segmentsPerMatch) playSegment(state);
  state.events.push({
    minute: 90,
    type: "fulltime",
    text: `Full-time: ${state.home.input.name} ${state.home.goals}-${state.away.goals} ${state.away.input.name}.`,
  });
  return state;
}

export function finalizeResult(state: MatchState): MatchResult {
  const ratings: Record<string, number> = {};
  const minutes: Record<string, number> = {};
  const gd = state.home.goals - state.away.goals;

  for (const [side, sideGd] of [
    [state.home, gd],
    [state.away, -gd],
  ] as [SideState, number][]) {
    for (const op of side.onPitch) {
      const p = op.entry.player;
      const mins = (op.leftMinute ?? 90) - op.enteredMinute;
      minutes[p.id] = (minutes[p.id] ?? 0) + mins;
      const goals = state.scorers.filter((s) => s.playerId === p.id).length;
      const assists = state.scorers.filter((s) => s.assistId === p.id).length;
      let r = 6.5 + goals * 1.0 + assists * 0.5 + sideGd * 0.15 + (state.rng() - 0.5) * 0.8;
      if (op.entry.slotPos === "GK" || op.entry.slotPos === "CB") {
        const conceded = side === state.home ? state.away.goals : state.home.goals;
        if (conceded === 0) r += 0.5;
      }
      ratings[p.id] = Math.max(4, Math.min(10, Math.round(r * 10) / 10));
    }
  }

  const totalMid = state.home.midSum + state.away.midSum;
  const posHome = Math.round((state.home.midSum / totalMid) * 100);

  return {
    homeGoals: state.home.goals,
    awayGoals: state.away.goals,
    events: state.events,
    scorers: state.scorers,
    stats: {
      possession: [posHome, 100 - posHome],
      shots: [state.home.chances, state.away.chances],
      onTarget: [state.home.onTarget, state.away.onTarget],
    },
    ratings,
    minutes,
  };
}

/** One-shot simulation — used for all AI vs AI matches and the harness. */
export function simulateMatch(home: SideInput, away: SideInput, cfg: TuningConfig, seed: number): MatchResult {
  const state = createMatch(home, away, cfg, seed);
  playFirstHalf(state);
  playSecondHalf(state);
  return finalizeResult(state);
}

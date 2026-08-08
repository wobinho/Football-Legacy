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
import {
  NEUTRAL_ARCHETYPE_PROFILE,
  deriveArchetype,
  profileForAttrs,
  type ArchetypeProfile,
} from "../config/archetype";
import { TRAIT_MAP } from "../config/traits";
import {
  executionOf,
  roleAt,
  rollChanceType,
  shapeResistance,
  sideExecution,
  sideMix,
  sideResistance,
  typeConversionMult,
  type ChanceMix,
  type ChanceType,
  type MixPlayer,
  type Resistance,
} from "../chancetypes";
import { familiarityMult } from "../familiarity";
import type { ClubFamiliarity } from "../types";
import { PHASE_WEIGHTS, positionFit } from "../config/positions";
import type { AttrKey } from "../config/attributes";
import {
  fitDrainMultiplier,
  fitMultiplier,
  tacticDemands,
  type FitDemand,
  type FitPlayer,
} from "../config/tacticfit";
import { instructionFitScore, type InstructionView } from "../config/archetype";
import { mulberry32, pickWeighted, randNormal, randPoisson, type RNG } from "../rng";

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
  traits: string[];
  form: number;
  fitness: number; // at kickoff
  /** Age (v1.66) — read only by the garbage-time sub rule, which favours giving
   * a prospect the minutes when the game is already won. Optional so a caller
   * building an EnginePlayer by hand (the harness) needn't supply it; absent
   * simply means no prospect bias. */
  age?: number;
  /** The 35 attributes (v1.72), read by the tactical-fit pass: how well this
   * player suits what his side's instructions are asking of him.
   *
   * Optional so a caller building an EnginePlayer by hand needn't supply a full
   * attribute line — a side whose players carry none simply scores neutral fit
   * (1.0×) and behaves exactly as it did before tactical fit existed. */
  attrs?: Record<AttrKey, number>;
}

export interface LineupEntry {
  slotPos: Pos;
  player: EnginePlayer;
  /** The formation slot he is filling (v1.99). Carried so the Tactic Creator's
   * per-slot role brief can be read — two centre backs share a `slotPos` and
   * may hold different briefs, so the position alone cannot answer it. Optional
   * because a caller with no formation in hand (the calibration harness, a
   * substitute coming on) has no slot to name, and an absent slot id simply
   * means "no brief applies". */
  slotId?: string;
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
  /**
   * The club's squad-familiarity record (v2.1), or absent when it has none.
   *
   * Carried on the side rather than looked up because the engine holds no
   * `GameState` — the same reason `coachMult` is passed in. Absent means every
   * player reads exactly 1, which is what keeps a pre-v2.1 save (and the
   * calibration harness, which builds sides by hand) computing what it always
   * did. See lib/familiarity.ts for what it is worth and why it is centred.
   */
  familiarity?: ClubFamiliarity;
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
  /**
   * How the player actually PERFORMED, accumulated per segment (v2.0).
   *
   * `perfSum` is the running total of his effective rating divided by his own
   * overall — i.e. what fraction of himself he was on the day, once form,
   * fitness, position fit, the tactic and the coach have had their say.
   * `perfSegments` is how many segments that sum covers, so the two divide into
   * a mean over the time he was actually on the pitch (a 70th-minute substitute
   * is judged on his twenty minutes, not on the match).
   *
   * Accumulated in `phaseStrengths`, which already computes `effectiveRating`
   * for every player every segment — so this is free, and more importantly it
   * is the SAME number the simulation used to decide the match. A rating
   * derived from a second, parallel estimate of how well someone played could
   * disagree with the result on the board.
   */
  perfSum: number;
  perfSegments: number;
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
  /** How well this side's players suit its own instructions (v1.72). */
  fit: TacticFit;
  /** The five advanced dials, resolved once per tactic change (v1.78). Every
   * player's instruction fit is scored against this — an inert value object,
   * not an accumulated effect. */
  instructions: InstructionView;
}

/** Per-phase tactical-fit multipliers. `drain` is a fitness-drain multiplier —
 * below 1 means the side holds its instructions better than average. */
export interface TacticFit {
  attack: number;
  midfield: number;
  defense: number;
  drain: number;
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

/**
 * The archetype profile for one player (v1.77).
 *
 * An archetype is DERIVED from the 35 attributes, and deriving it means scoring
 * five training plans across 35 keys — far too much to repeat for every player
 * on every one of the ~40 lookups a match makes. It is a pure function of the
 * attribute line, though, and a player's attributes never move during a match,
 * so the result is memoised per player for the duration of the call.
 *
 * The cache is keyed by identity of the attrs object rather than by player id:
 * two matches in the same tick may hold different snapshots of the same player,
 * and keying on the object means a stale line can never be read for a fresh one.
 * A WeakMap so nothing is retained once the match is done.
 */
const PROFILE_CACHE = new WeakMap<object, ArchetypeProfile>();

function profileOfPlayer(p: EnginePlayer): ArchetypeProfile {
  // A caller-built player with no attribute line (the calibration harness) has
  // no archetype to read — neutral in every respect, exactly as before.
  if (!p.attrs) return NEUTRAL_ARCHETYPE_PROFILE;
  const hit = PROFILE_CACHE.get(p.attrs);
  if (hit) return hit;
  const prof = profileForAttrs(p.attrs, p.positions[0]);
  PROFILE_CACHE.set(p.attrs, prof);
  return prof;
}

function synergyMult(p: EnginePlayer, tactic: Tactic, cfg: TuningConfig): number {
  const raw = profileOfPlayer(p).styleSynergy[tactic.style] ?? 1;
  return Math.max(1 - cfg.synergyCap, Math.min(1 + cfg.synergyCap, raw));
}

/**
 * How well this player's ROLE suits the five advanced dials (v1.78).
 *
 * The archetype half of the identity system, where `synergyMult` above is the
 * class half. Bounded to `1 ± instructionFitSwing` by construction — the score
 * is a mean of per-axis −1/0/+1 verdicts, so it cannot leave −1..1 and needs no
 * clamp. A player whose archetype names no preferences scores 0 and multiplies
 * by exactly 1, which is how a harness side with no attributes stays neutral
 * without the engine branching on it.
 */
function instructionMult(p: EnginePlayer, side: SideState, cfg: TuningConfig): number {
  const prefs = profileOfPlayer(p).instructionPrefs;
  return 1 + instructionFitScore(prefs, side.instructions) * cfg.instructionFitSwing;
}

/**
 * How much this player's identity is worth under a given tactic (v1.90) — the
 * product of the two levers `effectiveRating` applies, and nothing else.
 *
 * Exported so SELECTION can ask the same question the match will answer. The
 * engine composes `synergyMult × instructionMult` into a player's effective
 * rating; a lineup picked on raw overall alone therefore fields the better
 * player rather than the better player *for this tactic*, and the two disagree
 * often enough that an AI club could play a possession game with a squad of
 * counter-attackers and never notice.
 *
 * This is deliberately NOT a third channel (see CLAUDE.md, v1.78): it is a read
 * of the existing two, so a change to either table moves selection and the
 * simulation together and they cannot drift apart.
 */
export function tacticalFitMult(
  p: EnginePlayer,
  tactic: Tactic,
  cfg: TuningConfig,
  /** The formation slot being filled (v1.99). Supplied, the manager's own role
   * brief for that slot is folded in, so a tactic-aware pick prefers the player
   * the BRIEF asks for exactly as the match will rate him. Omitted — the common
   * case, and every pre-v1.99 caller — the brief contributes nothing, which is
   * correct for a question with no slot in it ("how useful is he to this tactic
   * at all", which is what the bench ranking asks). */
  slot?: { pos: Pos; id: string },
  /** The club's familiarity record (v2.1). Supplied, how settled this player is
   * in this slot is folded in exactly as the match will rate him — so a manager
   * picking a side sees the settled incumbent preferred over the marginally
   * better newcomer, which is the decision the feature exists to create.
   * Omitted, it contributes nothing. */
  familiarity?: ClubFamiliarity
): number {
  const prof = profileOfPlayer(p);
  const synergy = Math.max(
    1 - cfg.synergyCap,
    Math.min(1 + cfg.synergyCap, prof.styleSynergy[tactic.style] ?? 1)
  );
  const instructions =
    1 + instructionFitScore(prof.instructionPrefs, resolveInstructions(tactic)) * cfg.instructionFitSwing;
  // v2.2: a role no longer multiplies a rating (the brief is deleted), so what
  // selection reads here is how well this player would EXECUTE the role his
  // slot was given — the same `executionOf` the match applies to the chances
  // that role manufactures. It is not a bonus: it is 1 for the role asked for
  // and below 1 for a player who is not built for it, which is exactly the
  // ordering a manager picking that slot wants.
  const role = slot ? roleAt(tactic, slot.id) : undefined;
  const exec = role && p.attrs ? executionOf(deriveArchetype(p.attrs, slot!.pos), role) : 1;
  const settled = familiarity ? familiarityMult(familiarity, p.id, slot?.id) : 1;
  return synergy * instructions * exec * settled;
}

/** The intrinsic shape of a side's chosen style (v19). A pure table lookup —
 * an unknown style (an old save, a mod) falls back to a neutral shape rather
 * than throwing, so the engine never has to know what styles exist. */
const NEUTRAL_SHAPE = { midfield: 1, defense: 1, oppChance: 1, fitnessDrain: 1, wideBias: 0 };
function styleShape(tactic: Tactic, cfg: TuningConfig) {
  return cfg.styleShape?.[tactic.style] ?? NEUTRAL_SHAPE;
}

/** In-match fitness drain rate for a side, scaled by tempo + press instructions
 * and the chosen style's own energy cost (v19). */
function drainRateMult(side: SideState, cfg: TuningConfig): number {
  return (
    cfg.tempoFitnessDrainMult[resolveTempo(side.tactic)] *
    cfg.pressFitnessDrainMult[resolvePress(side.tactic)] *
    styleShape(side.tactic, cfg).fitnessDrain *
    // v1.72: a squad built for the instructions holds them better. A side told to
    // press with no stamina fades faster than one that has the legs for it.
    side.fit.drain
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
    // What KIND of player he is, against the STYLE (class-level).
    synergyMult(p, side.tactic, cfg) *
    // v1.78: and how well HIS ROLE suits the five advanced dials. Style is a
    // class question, the dials are a role question — which is why a Sniper and
    // a Ram, the same class at the same position, now diverge here.
    instructionMult(p, side, cfg) *
    // v2.1: and how well he and this squad actually KNOW this system — the
    // earned half of identity, where the three above are the looked-up half.
    // Exactly 1 for a side carrying no record, and centred so the world's mean
    // does not drift (see lib/familiarity.ts).
    familiarityMult(side.input.familiarity, p.id, op.entry.slotId) *
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
    // v2.0: bank what fraction of himself he was this segment, for the match
    // rating. `phaseStrengths` is called exactly once per side per segment (the
    // only two call sites are in `playSegment`), so this is one sample per
    // player per segment and the mean below is over the time he was on.
    // Divided by his own overall so the figure is "how well did HE play"
    // rather than "how good is he" — the second is already known and would
    // simply hand every rating to the best player on the pitch.
    const base = op.entry.player.overall;
    if (base > 0) {
      op.perfSum += eff / base;
      op.perfSegments += 1;
    }
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
  // The style's own shape (v19): a pressing side wins more of the midfield, a
  // low block trades that away for solidity.
  const shape = styleShape(side.tactic, cfg);
  midfield *= shape.midfield;
  defense *= shape.defense;
  attack *= side.counterAttackMult;
  // Tactical fit (v1.72): the instructions name the attributes they lean on, and
  // a side that has them plays them better. Bounded to ±TACTIC_FIT_SWING per
  // phase, so this sharpens a well-matched setup rather than deciding matches.
  attack *= side.fit.attack;
  midfield *= side.fit.midfield;
  defense *= side.fit.defense;
  return { attack, midfield, defense, concedeMult };
}

function activePlayers(side: SideState): OnPitch[] {
  return side.onPitch.filter((op) => op.leftMinute === null);
}

/** Attacking-focus multiplier for a slot: emphasised side/centre gets more of
 * the ball. "Wide" (v19) emphasises BOTH flanks equally — a left winger and a
 * right winger get the same lift a one-sided focus would give its own flank —
 * so it is the choice for a side with threats on either touchline rather than
 * one star to feed. The style's own wide bias (Wing Play) stacks on top. */
function focusMult(focus: Focus, pos: Pos, tactic: Tactic, cfg: TuningConfig): number {
  const side = slotSide(pos);
  let mult = 1;
  if (focus === "Wide") {
    if (side !== "central") mult *= 1 + cfg.focusFlankBias;
  } else if (focus !== "Mixed") {
    const target = focus === "Central" ? "central" : focus === "Left" ? "left" : "right";
    if (side === target) mult *= 1 + cfg.focusFlankBias;
  }
  const wideBias = styleShape(tactic, cfg).wideBias;
  if (wideBias && side !== "central") mult *= 1 + wideBias;
  return mult;
}

type SetPiece = "penalty" | "freekick" | "corner" | null;

/** Roll whether a chance is a set piece. Penalties are rare; free-kicks and
 * corners are more common and route the ball to the designated taker. */
function rollSetPiece(rng: RNG, cfg: TuningConfig): SetPiece {
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
    const arch = profileOfPlayer(op.entry.player);
    let w = arch.scorerWeight * (0.25 + PHASE_WEIGHTS[op.entry.slotPos].attack) * op.entry.player.overall;
    w *= focusMult(focus, op.entry.slotPos, side.tactic, cfg);
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
  // A penalty is scored from a dead ball with nobody to credit — every other
  // kind of goal is assisted at the rate the tuning sets, set pieces higher
  // because a corner or a free kick is by definition delivered by someone.
  const assistChance =
    setPiece === "penalty"
      ? 0
      : setPiece === "corner" || setPiece === "freekick"
        ? cfg.assistChanceSetPiece
        : cfg.assistChance;
  if (rng() < assistChance) {
    const others = active.filter((op) => op !== scorer);
    if (others.length) {
      assister = pickWeighted(rng, others, (op) => {
        const arch = profileOfPlayer(op.entry.player);
        const w = PHASE_WEIGHTS[op.entry.slotPos];
        let aw =
          arch.assistWeight *
          (0.2 + w.attack * 0.6 + w.midfield * 0.4) *
          op.entry.player.overall *
          focusMult(focus, op.entry.slotPos, side.tactic, cfg);
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
  const arch = profileOfPlayer(scorer.entry.player);
  const tmpl = arch.goalFlavor[Math.floor(rng() * arch.goalFlavor.length)] ?? "{p} scores!";
  let text = tmpl.replace("{p}", scorer.entry.player.name);
  if (assister) text += ` (assist: ${assister.entry.player.name})`;
  return text;
}

/** A starter's in-match fitness right now — his kickoff figure less what the
 * minutes he's actually been on the pitch have taken out of him. */
function currentFitnessOf(op: OnPitch, side: SideState, minute: number, cfg: TuningConfig): number {
  const played = minute - op.enteredMinute;
  return op.entry.player.fitness - (played / 90) * cfg.fitnessDrainPerMatch * drainRateMult(side, cfg);
}

/** The best bench option for a slot, and how good it would be there. Fresh legs
 * are already priced in through `fitnessMult` on the bench player's own fitness. */
function bestBenchFor(
  side: SideState,
  slotPos: Pos,
  cfg: TuningConfig,
  /** Weight applied per candidate — garbage time uses it to favour prospects. */
  bias: (b: EnginePlayer) => number = () => 1
): { player: EnginePlayer; eff: number } | null {
  let best: EnginePlayer | null = null;
  let bestEff = 0;
  for (const b of side.bench) {
    // An outfield slot is never filled by the reserve keeper — he's cover for
    // one position and one only.
    if (b.positions[0] === "GK") continue;
    const fit = positionFit(b.positions, slotPos, cfg.adjacentPositionMult, cfg.outOfPositionFloor);
    const eff = b.overall * fit * fitnessMult(b.fitness, cfg) * bias(b);
    if (eff > bestEff) {
      bestEff = eff;
      best = b;
    }
  }
  return best ? { player: best, eff: bestEff } : null;
}

/** Put the change through: the starter comes off, the sub takes his slot. */
function makeSub(
  state: MatchState,
  side: SideState,
  op: OnPitch,
  incoming: EnginePlayer,
  minute: number,
  why: string
) {
  op.leftMinute = minute;
  side.bench = side.bench.filter((b) => b.id !== incoming.id);
  side.onPitch.push({
    entry: { slotPos: op.entry.slotPos, player: incoming },
    enteredMinute: minute,
    leftMinute: null,
    perfSum: 0,
    perfSegments: 0,
  });
  side.subsUsed++;
  // The XI has changed, so how well this side suits its own instructions has too
  // (v1.72) — a like-for-like swap barely moves it, but bringing a runner on for
  // a passer genuinely changes what the side can do.
  side.fit = computeFit(side);
  // The archetypes need no recompute (v1.78): instruction fit is scored on each
  // player's OWN rating, so the man coming on brings his own automatically.
  state.events.push({
    minute,
    type: "sub",
    teamId: side.input.teamId,
    text: `${side.input.short}: ${incoming.name} replaces ${op.entry.player.name}${why}.`,
  });
}

/**
 * The AI manager's substitution pass, run at each window in cfg.subMinutes.
 *
 * The old pass had exactly one reason to make a change — a tired starter who
 * could be upgraded — so a side that stayed fresh made none at all and the bench
 * never played. A manager now works down four reasons in priority order, and
 * keeps going until he's made `minSubsPerMatch` changes or run out of bench:
 *
 *  1. Performance (halftime and the early second half only): a starter having a
 *     poor game comes off regardless of his legs. A manager who is going to make
 *     this change makes it at the break, not on 80 minutes.
 *  2. Fatigue: anyone at/below `fatigueSubFitness` comes off unconditionally —
 *     fresh legs beat tired quality, so there is no upgrade test on this one.
 *     This is what guarantees changes get made in every match.
 *  3. Garbage time: two goals up after `garbageTimeMinute`, the game is safe and
 *     the bench plays. The quality bar drops to `garbageTimeUpgradeMargin` and
 *     young players are favoured, which is where prospects get their minutes.
 *  4. Rotation: the original behaviour — a tiring starter replaced when a bench
 *     option comes within `subUpgradeMargin` of his drained effectiveness.
 *
 * Every threshold is a tuning number; nothing here reads a player's name,
 * archetype or trait.
 */
function maybeSubs(state: MatchState, side: SideState, opponent: SideState, minute: number) {
  const cfg = state.cfg;
  if (side.subsUsed >= cfg.maxSubs) return;

  // Outfield starters, most tired first — the order every reason works through.
  const outfield = () =>
    activePlayers(side)
      .filter((op) => op.entry.slotPos !== "GK")
      .map((op) => ({ op, fit: currentFitnessOf(op, side, minute, cfg) }))
      .sort((a, b) => a.fit - b.fit);

  const canContinue = () => side.subsUsed < cfg.maxSubs && side.bench.some((b) => b.positions[0] !== "GK");

  // ── 1. Performance ────────────────────────────────────────────────────────
  // Ratings aren't computed until full time, so the in-match read is the honest
  // proxy a watching manager has: how the player has actually affected the game.
  if (minute <= cfg.performanceSubLastMinute) {
    for (const { op } of outfield()) {
      if (!canContinue()) break;
      if (liveRating(state, side, op, minute) > cfg.performanceSubRating) continue;
      const best = bestBenchFor(side, op.entry.slotPos, cfg);
      // Only if the replacement is a genuine like-for-like — hooking a poor
      // performer for someone worse helps nobody.
      if (best && best.eff > op.entry.player.overall * cfg.subUpgradeMargin) {
        makeSub(state, side, op, best.player, minute, " — a change after a poor first half");
      }
    }
  }

  // ── 2. Fatigue ────────────────────────────────────────────────────────────
  for (const { op, fit } of outfield()) {
    if (!canContinue()) break;
    if (fit > cfg.fatigueSubFitness) continue;
    const best = bestBenchFor(side, op.entry.slotPos, cfg);
    if (best) makeSub(state, side, op, best.player, minute, " — tiring");
  }

  // ── 3. Garbage time ───────────────────────────────────────────────────────
  const lead = side.goals - opponent.goals;
  if (minute >= cfg.garbageTimeMinute && lead >= cfg.garbageTimeLead) {
    // Favour the kids: a prospect is worth a notch more than his rating here,
    // because the whole point of the change is the appearance, not the result.
    const prospectBias = (b: EnginePlayer) =>
      b.age !== undefined && b.age <= cfg.garbageTimeProspectAge ? 1.15 : 1;
    for (const { op, fit } of outfield()) {
      if (!canContinue()) break;
      const best = bestBenchFor(side, op.entry.slotPos, cfg, prospectBias);
      const tiredEff = op.entry.player.overall * fitnessMult(fit, cfg);
      if (best && best.eff > tiredEff * cfg.garbageTimeUpgradeMargin) {
        makeSub(state, side, op, best.player, minute, " — minutes for the bench with the game won");
      }
    }
  }

  // ── 4. Rotation, to the minimum ───────────────────────────────────────────
  // Whatever the reasons above produced, a manager makes his changes: keep
  // rotating tiring starters until the floor is met.
  for (const { op, fit } of outfield()) {
    if (!canContinue() || side.subsUsed >= cfg.minSubsPerMatch) break;
    if (fit > cfg.subFitnessThreshold) continue;
    const best = bestBenchFor(side, op.entry.slotPos, cfg);
    const tiredEff = op.entry.player.overall * fitnessMult(fit, cfg);
    if (best && best.eff > tiredEff * cfg.subUpgradeMargin) {
      makeSub(state, side, op, best.player, minute, "");
    }
  }
}

/**
 * A watching manager's read on how a player is going, on the same 1-10 scale
 * `finalizeResult` uses at full time. Built from the facts available mid-match —
 * goals, assists, and how the side is doing — so a performance sub is made on
 * the same evidence the final rating will be.
 *
 * Deliberately shares the shape of the full-time formula rather than being a
 * second opinion; the difference is only that it has fewer minutes to judge.
 */
function liveRating(state: MatchState, side: SideState, op: OnPitch, minute: number): number {
  const p = op.entry.player;
  const goals = state.scorers.filter((s) => s.playerId === p.id).length;
  const assists = state.scorers.filter((s) => s.assistId === p.id).length;
  const gd = side.goals - (side === state.home ? state.away.goals : state.home.goals);
  // Seeded off the player and the window, so the same match always makes the
  // same decision — the engine's determinism rule applies to subs too.
  const jitter = mulberry32(hashId(p.id) ^ (minute * 2654435761))() - 0.5;
  return 6.5 + goals * 1.0 + assists * 0.5 + gd * 0.15 + jitter * 0.8;
}

/** Cheap string hash for seeding a per-player decision inside a match. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function playSegment(state: MatchState) {
  const { cfg, rng } = state;
  const seg = state.segment;
  const segStart = seg * cfg.minutesPerSegment;

  // subs at configured minutes that fall on this segment boundary. Each side is
  // passed its opponent so the manager can read the scoreline (garbage time).
  for (const m of cfg.subMinutes) {
    if (m === segStart) {
      maybeSubs(state, state.home, state.away, m);
      maybeSubs(state, state.away, state.home, m);
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
    cfg.pressOppChanceMult[resolvePress(opp.tactic)] *
    cfg.lineOppChanceMult[resolveLine(opp.tactic)] *
    styleShape(opp.tactic, cfg).oppChance;

  /**
   * How much a side's own attackers exploit the space the OPPONENT's line leaves
   * (v2.1) — the archetype system reaching the simulation rather than the rating.
   *
   * `paceReliance` had, until now, exactly two readers and both were in ageing:
   * a pace-reliant archetype declines earlier and faster. Nothing in a match ever
   * asked the question the attribute is named for. This is that question: a high
   * line leaves ball in behind, and a Speedster or a Bullet is who punishes it,
   * where a Battering Ram is not.
   *
   * It moves chance VOLUME, not anyone's rating — so it makes two sides of equal
   * strength produce visibly different matches against the same opponent, which
   * is the whole point of pushing identity here instead. Centred on
   * `paceExploitPivot`, so an ordinary attack is exactly 1 and this cannot lift
   * the world's scoring; and it only ever bites against a line that is actually
   * exposed, via the same `lineOppChanceMult` the term already reads.
   */
  const paceExploit = (own: SideState, opp: SideState) => {
    const exposedBy = cfg.lineOppChanceMult[resolveLine(opp.tactic)] - 1;
    if (exposedBy <= 0) return 1; // a deep block leaves nothing to run into
    let paceSum = 0;
    let weightSum = 0;
    for (const op of own.onPitch) {
      if (op.leftMinute !== null) continue;
      const w = PHASE_WEIGHTS[op.entry.slotPos].attack;
      if (w <= 0) continue;
      paceSum += profileOfPlayer(op.entry.player).paceReliance * w;
      weightSum += w;
    }
    if (weightSum <= 0) return 1;
    const meanPace = paceSum / weightSum;
    return 1 + (meanPace - cfg.paceExploitPivot) * cfg.paceExploitSwing * exposedBy;
  };

  const perSegBase = cfg.baseChancesPerSegment;
  const homeLambda =
    perSegBase *
    homeShare *
    mentality(state.home, state.away) *
    tempoMult(state.home, state.away) *
    exposure(state.away) *
    paceExploit(state.home, state.away);
  const awayLambda =
    perSegBase *
    (1 - homeShare) *
    mentality(state.away, state.home) *
    tempoMult(state.away, state.home) *
    exposure(state.home) *
    paceExploit(state.away, state.home);

  /**
   * The chance-type contest (v2.2) — where archetypes reach the simulation.
   *
   * Each side's MIX (what kind of chances its roles manufacture) and each
   * side's RESISTANCE (what kind its personnel and shape smother) are computed
   * once per segment, not per chance: they are pure functions of who is on the
   * pitch, which only changes at a substitution, and a match makes far more
   * chance rolls than it makes segments.
   *
   * `sideExecution` is the other half of a role assignment: the mix says the
   * side is manufacturing the ROLE's chances, and this says how well the player
   * actually standing there takes them. See lib/chancetypes.ts.
   */
  const mixOf = (side: SideState): { mix: ChanceMix; exec: number } => {
    const players: MixPlayer[] = [];
    for (const op of side.onPitch) {
      if (op.leftMinute !== null) continue;
      players.push({ attrs: op.entry.player.attrs, slotPos: op.entry.slotPos, slotId: op.entry.slotId });
    }
    return { mix: sideMix(players, side.tactic), exec: sideExecution(players, side.tactic) };
  };
  const resistOf = (side: SideState): { personnel: Resistance; shape: Resistance } => {
    const players: MixPlayer[] = [];
    for (const op of side.onPitch) {
      if (op.leftMinute !== null) continue;
      players.push({ attrs: op.entry.player.attrs, slotPos: op.entry.slotPos, slotId: op.entry.slotId });
    }
    return { personnel: sideResistance(players), shape: shapeResistance(side.tactic) };
  };
  const homeAttack = mixOf(state.home);
  const awayAttack = mixOf(state.away);
  const homeDefence = resistOf(state.home);
  const awayDefence = resistOf(state.away);

  interface PendingChance {
    side: SideState;
    opp: { defense: number; concedeMult: number };
    attack: number;
    minute: number;
    /** What this side manufactures and how well it finishes it. */
    mix: ChanceMix;
    exec: number;
    /** What the side facing it smothers. */
    resist: { personnel: Resistance; shape: Resistance };
  }
  const chances: PendingChance[] = [];
  const nHome = randPoisson(rng, homeLambda);
  const nAway = randPoisson(rng, awayLambda);
  for (let i = 0; i < nHome; i++)
    chances.push({
      side: state.home,
      opp: ap,
      attack: hp.attack,
      minute: segStart + 1 + Math.floor(rng() * (cfg.minutesPerSegment - 1)),
      mix: homeAttack.mix,
      exec: homeAttack.exec,
      resist: awayDefence,
    });
  for (let i = 0; i < nAway; i++)
    chances.push({
      side: state.away,
      opp: hp,
      attack: ap.attack,
      minute: segStart + 1 + Math.floor(rng() * (cfg.minutesPerSegment - 1)),
      mix: awayAttack.mix,
      exec: awayAttack.exec,
      resist: homeDefence,
    });
  chances.sort((a, b) => a.minute - b.minute);

  // Step 4 — contested rolls
  for (const c of chances) {
    c.side.chances++;
    const q = c.attack / (c.attack + c.opp.defense); // ≈ chanceQualityCenter when even
    const squash = 1 / (1 + Math.exp(-cfg.chanceQualitySlope * (q - cfg.chanceQualityCenter)));
    // is this a set piece? penalties are rare & high-conversion; free-kicks /
    // corners are a normal chance but route the ball to the designated taker.
    const setPiece = rollSetPiece(rng, cfg);
    let pGoal = cfg.goalProbFloor + (cfg.goalProbCeil - cfg.goalProbFloor) * squash;
    // the opponent's back line (Wall) makes goals harder to come by
    pGoal *= c.opp.concedeMult;
    /**
     * v2.2 — what KIND of chance this was, and whether they can defend it.
     *
     * Rolled from the attacking side's own mix, then contested against the
     * defending side's resistance to that specific type. This is the archetype
     * system reaching the match: a crossing side against two Towers converts
     * worse than the same side against two ball-playing centre backs, at
     * identical ratings on both sides.
     *
     * `exec` is the role half — how well the players actually fielded take the
     * chances their assigned roles manufacture. Both are exactly 1 for a side
     * with no roles and an ordinarily-shaped defence, which is why a save that
     * never opens the Creator computes what it always did.
     *
     * A penalty is exempt: it is a dead ball from twelve yards and belongs to
     * no chance type, which is why the type roll happens before the override.
     */
    const chanceType: ChanceType = rollChanceType(rng(), c.mix);
    pGoal *= typeConversionMult(chanceType, c.resist.personnel, c.resist.shape, cfg.chanceTypeSwing) * c.exec;
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
    onPitch: input.lineup.map((entry) => ({
      entry,
      enteredMinute: 0,
      leftMinute: null,
      perfSum: 0,
      perfSegments: 0,
    })),
    bench: input.bench.slice(),
    subsUsed: 0,
    goals: 0,
    chances: 0,
    onTarget: 0,
    midSum: 0,
    tactic: { ...input.tactic },
    coachMult: input.coachMult ?? 1,
    counterAttackMult: 1,
    fit: NEUTRAL_FIT,
    instructions: resolveInstructions(input.tactic),
  };
}

/** The five advanced dials with their v2-save defaults applied — the same
 * resolution `resolveTempo` and friends do, gathered into one object so the
 * per-player scoring reads settled values.
 *
 * Exported (v1.90) so squad SELECTION can score a player against the very dials
 * the match will run on. Picking a side against a second, re-derived copy of the
 * defaults is how a lineup ends up optimised for a tactic the engine isn't
 * playing. */
export function resolveInstructions(t: Tactic): InstructionView {
  return {
    tempo: resolveTempo(t),
    width: resolveWidth(t),
    press: resolvePress(t),
    line: resolveLine(t),
    focus: resolveFocus(t),
  };
}

/** A side whose tactic asks nothing of it, or whose players carry no attributes
 * (a hand-built harness side) — every phase neutral. */
const NEUTRAL_FIT: TacticFit = { attack: 1, midfield: 1, defense: 1, drain: 1 };

/**
 * How well a side's players suit what its instructions are asking of them
 * (v1.72), as one multiplier per phase.
 *
 * Recomputed whenever the tactic changes rather than per segment: the demands
 * come from the tactic and the squad, and neither moves within a segment. Only
 * the players currently on the pitch count, so a side that presses well with its
 * starters and badly with its bench genuinely fades — which is the point.
 */
function computeFit(side: SideState): TacticFit {
  const players: FitPlayer[] = [];
  for (const op of side.onPitch) {
    if (op.leftMinute !== null) continue;
    const a = op.entry.player.attrs;
    if (a) players.push({ overall: op.entry.player.overall, attrs: a });
  }
  // No attribute data (a harness side) → no fit adjustment at all.
  if (players.length === 0) return NEUTRAL_FIT;
  const demands: FitDemand[] = tacticDemands(side.tactic);
  if (demands.length === 0) return NEUTRAL_FIT;
  return {
    attack: fitMultiplier(players, demands, "attack"),
    midfield: fitMultiplier(players, demands, "midfield"),
    defense: fitMultiplier(players, demands, "defense"),
    drain: fitDrainMultiplier(players, demands),
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
  // Tactical fit (v1.72) depends only on a side's own tactic and its players, so
  // it refreshes on the same beat as the counter edge — kickoff, and any change.
  state.home.fit = computeFit(state.home);
  state.away.fit = computeFit(state.away);
  // The dials themselves can change at halftime, and every player's instruction
  // fit is scored against them, so they re-resolve on the same beat (v1.78).
  state.home.instructions = resolveInstructions(state.home.tactic);
  state.away.instructions = resolveInstructions(state.away.tactic);
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
  return playSegments(state, 3);
}

function pushHalftime(state: MatchState) {
  state.events.push({
    minute: 45,
    type: "halftime",
    text: `Half-time: ${state.home.input.name} ${state.home.goals}-${state.away.goals} ${state.away.input.name}.`,
  });
}

/**
 * Advance the match to (but not into) segment `upTo`, one 15-minute block at a
 * time (v1.68).
 *
 * The live view used to simulate a whole half in one call and then merely reveal
 * the events on a clock, which meant nothing the manager did while watching could
 * possibly matter — the goals had already happened. Playing segment by segment is
 * what makes a mid-match substitution or a shift in mentality real: the engine has
 * genuinely not resolved the next fifteen minutes yet.
 *
 * Segment boundaries are the only pause points, and deliberately so. A change
 * takes effect from the next block rather than the next minute, which is also the
 * granularity at which `phaseStrengths` is sampled — pausing anywhere finer would
 * offer a decision the simulation cannot act on.
 *
 * Determinism is unaffected: the RNG stream is consumed in exactly the same order
 * whether the six segments are played in one call or six, so an untouched match
 * watched live produces the identical result to the same match simulated instantly.
 */
export function playSegments(state: MatchState, upTo: number): MatchState {
  const target = Math.min(upTo, state.cfg.segmentsPerMatch);
  while (state.segment < target) {
    playSegment(state);
    // The half-time and full-time milestones belong to the clock, not to a
    // segment, so they're emitted as the boundary is crossed however the caller
    // chose to slice the match up.
    if (state.segment === 3) pushHalftime(state);
    if (state.segment === state.cfg.segmentsPerMatch) pushFulltime(state);
  }
  return state;
}

/** The in-match interaction point (§6): change mentality/style. Called at the
 * break, and — since v1.68 — at any segment boundary while watching live. */
export function applyHalftimeTactic(state: MatchState, side: "home" | "away", tactic: Partial<Tactic>) {
  const s = side === "home" ? state.home : state.away;
  s.tactic = { ...s.tactic, ...tactic };
  refreshCounters(state); // the matchup shifts with the change
}

/** A player currently on the pitch for a side, with the slot he occupies. */
export function onPitchFor(state: MatchState, side: "home" | "away"): OnPitch[] {
  return activePlayers(side === "home" ? state.home : state.away);
}

/** The players still available on a side's bench. */
export function benchFor(state: MatchState, side: "home" | "away"): EnginePlayer[] {
  return (side === "home" ? state.home : state.away).bench.slice();
}

/** Subs made / allowed for a side — what the UI needs to grey out the control. */
export function subsUsedFor(state: MatchState, side: "home" | "away"): { used: number; max: number } {
  const s = side === "home" ? state.home : state.away;
  return { used: s.subsUsed, max: state.cfg.maxSubs };
}

/**
 * The manager's own substitution (v1.68) — `offId` comes off, `onId` comes on in
 * his slot, at `minute`.
 *
 * Shares `makeSub` with the AI pass, so a manual change is bookkept identically:
 * minutes played, the event line, and the subs-used count that limits both alike.
 * Returns false and does nothing if the change isn't legal (either player isn't
 * where he's claimed to be, or the side has used its allocation), so the caller
 * can surface a refusal rather than silently half-applying one.
 */
export function manualSub(
  state: MatchState,
  side: "home" | "away",
  offId: string,
  onId: string,
  minute: number
): boolean {
  const s = side === "home" ? state.home : state.away;
  if (s.subsUsed >= state.cfg.maxSubs) return false;
  const op = activePlayers(s).find((o) => o.entry.player.id === offId);
  const incoming = s.bench.find((b) => b.id === onId);
  if (!op || !incoming) return false;
  makeSub(state, s, op, incoming, minute, "");
  return true;
}

/**
 * Swap two players' positions without using a substitution (v1.68) — the other
 * half of in-match shape management. Pushing a full-back forward costs a manager
 * nothing but a shout, and the engine already reads `slotPos` per segment, so the
 * change is felt from the next block through `positionFit` and the phase weights.
 */
export function swapPositions(state: MatchState, side: "home" | "away", aId: string, bId: string): boolean {
  const s = side === "home" ? state.home : state.away;
  const a = activePlayers(s).find((o) => o.entry.player.id === aId);
  const b = activePlayers(s).find((o) => o.entry.player.id === bId);
  if (!a || !b || a === b) return false;
  const tmp = a.entry.slotPos;
  a.entry = { ...a.entry, slotPos: b.entry.slotPos };
  b.entry = { ...b.entry, slotPos: tmp };
  return true;
}

/** Live in-match condition for an on-pitch player, for the watching UI — the
 * same figure `effectiveRating` prices his legs at. */
export function liveFitness(state: MatchState, side: "home" | "away", op: OnPitch, minute: number): number {
  return currentFitnessOf(op, side === "home" ? state.home : state.away, minute, state.cfg);
}

export type { OnPitch };

function pushFulltime(state: MatchState) {
  state.events.push({
    minute: 90,
    type: "fulltime",
    text: `Full-time: ${state.home.input.name} ${state.home.goals}-${state.away.goals} ${state.away.input.name}.`,
  });
}

export function playSecondHalf(state: MatchState): MatchState {
  // `playSegments` emits full-time as it crosses the boundary; if the caller has
  // already advanced this far there is nothing left to play.
  return playSegments(state, state.cfg.segmentsPerMatch);
}

/**
 * The performance baseline (v2.0) — what `eff / overall` comes to for a player
 * having a wholly ordinary game.
 *
 * `effectiveRating` multiplies a player's overall by fit, synergy, the role
 * brief, instruction fit, form, fitness, the coach, width and home advantage.
 * For an average player in his own position, on average form, at full fitness,
 * with no coach edge, every one of those sits at ~1 — so the ordinary case is
 * ~1 and a ratio above it means he outplayed himself.
 *
 * The two systematic exceptions are handled rather than ignored, because
 * neither is anything the PLAYER did: home advantage lifts one whole side, and
 * fitness falls through the match for everybody. Both are divided back out, so
 * an away player isn't marked down for playing away and a full ninety minutes
 * doesn't rate below a cameo purely for having been tiring.
 */
function performanceRatio(op: OnPitch, side: SideState, isHome: boolean, cfg: TuningConfig): number {
  if (op.perfSegments === 0) return 1;
  const mean = op.perfSum / op.perfSegments;
  // Undo home advantage — a side-wide constant, not a personal performance.
  const homeAdj = isHome ? cfg.homeAdvantage : 1;
  // Undo the average fitness multiplier across his time on the pitch. Taken at
  // the MIDPOINT of his spell, which is the mean of a linear drain.
  const mins = (op.leftMinute ?? 90) - op.enteredMinute;
  const drained =
    op.entry.player.fitness -
    (mins / 2 / 90) * cfg.fitnessDrainPerMatch * drainRateMult(side, cfg);
  const fitAdj = Math.max(0.1, fitnessMult(drained, cfg));
  // Undo position fit. This one was found by MEASURING rather than by reading
  // the formula, and leaving it in inverted the whole system: season averages
  // correlated −0.20 with overall, i.e. the WORSE player reliably rated higher.
  //
  // The cause is selection, not performance. A squad player only makes the XI
  // when he is a natural fit for the slot (fit = 1.0), where a star is
  // routinely shifted into an imperfect one to get him on the pitch at all —
  // so a term meant to measure "how well did he play" was quietly measuring
  // "was he picked in his best position", and marking down exactly the players
  // good enough to be accommodated. Being played out of position is the
  // manager's decision; the engine already charges the TEAM for it through the
  // phase strengths, and charging the player's rating for it as well is both
  // double-counting and a judgement on the wrong person.
  const posAdj = Math.max(
    0.1,
    positionFit(op.entry.player.positions, op.entry.slotPos, cfg.adjacentPositionMult, cfg.outOfPositionFloor)
  );
  return mean / (homeAdj * fitAdj * posAdj);
}

export function finalizeResult(state: MatchState): MatchResult {
  const ratings: Record<string, number> = {};
  const minutes: Record<string, number> = {};
  const gd = state.home.goals - state.away.goals;

  // The standard of THIS match — everyone who took the field, both sides. What
  // the quality term below is measured against.
  const everyone = [...state.home.onPitch, ...state.away.onPitch];
  const matchMeanOverall = everyone.length
    ? everyone.reduce((s, o) => s + o.entry.player.overall, 0) / everyone.length
    : 70;

  for (const [side, sideGd, isHome] of [
    [state.home, gd, true],
    [state.away, -gd, false],
  ] as [SideState, number, boolean][]) {
    const conceded = side === state.home ? state.away.goals : state.home.goals;
    for (const op of side.onPitch) {
      const p = op.entry.player;
      const mins = (op.leftMinute ?? 90) - op.enteredMinute;
      minutes[p.id] = (minutes[p.id] ?? 0) + mins;
      const goals = state.scorers.filter((s) => s.playerId === p.id).length;
      const assists = state.scorers.filter((s) => s.assistId === p.id).length;

      // ── Everything he EARNED, over and above simply turning out ──
      //
      // The performance term is the one that matters (v2.0). Before it, a
      // player who neither scored nor assisted rated 6.5 ± 0.4 every week
      // whatever he did, so a season of averages carried almost no signal and
      // the individual awards fell out of team success alone.
      const perf = performanceRatio(op, side, isHome, state.cfg);
      let earned = (perf - 1) * state.cfg.ratingFormWeight;

      // How good he is for the company he is keeping. `performanceRatio` is
      // scaled by his OWN overall and is therefore quality-NEUTRAL by
      // construction — an 88-rated player at 100% of himself and a 62-rated one
      // at 100% of himself both score zero on it, which is right for "how well
      // did he play" and useless for "who had the better season". Measured, a
      // season of the performance term alone correlated ~0 with overall.
      //
      // So the standard of the match is the yardstick: his overall against the
      // mean of the twenty-two on the pitch. Deliberately the MATCH's mean and
      // not the league's — a good player in a bad side is carrying it, and that
      // is precisely the season an individual award is meant to find.
      earned += (p.overall - matchMeanOverall) * state.cfg.ratingPerOverallEdge;

      earned += goals * state.cfg.ratingPerGoal;
      earned += assists * state.cfg.ratingPerAssist;
      earned += sideGd * state.cfg.ratingPerGoalDiff;

      // Keeping goals out, and letting them in, are the defence's business.
      const w = PHASE_WEIGHTS[op.entry.slotPos];
      // Weighted by how much of the slot's job IS defending, so a centre-back
      // carries the clean sheet and a winger barely feels it — a table lookup,
      // never a named-position conditional.
      const defShare = Math.min(1, w.defense);
      if (conceded === 0) earned += state.cfg.ratingCleanSheet * defShare;
      else earned -= conceded * state.cfg.ratingPerConcededDef * defShare;

      // A substitute is judged on his cameo, so what he earned is scaled by how
      // much of the match he saw — otherwise a 5-minute goal is a 9.0 and wins
      // Player of the Season off eight appearances.
      const share = Math.max(0, Math.min(1, mins / 90));
      earned *= 1 - state.cfg.ratingSubDamping * (1 - share);

      // Luck. Normal rather than uniform: real ratings cluster with genuine
      // outliers, where a flat band produces no 8.5s at all.
      const noise = randNormal(state.rng) * state.cfg.ratingNoiseSd;

      const r = state.cfg.ratingBase + earned + noise;
      ratings[p.id] = Math.max(
        state.cfg.ratingMin,
        Math.min(state.cfg.ratingMax, Math.round(r * 10) / 10)
      );
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

// ── Tactical fit: what a setup demands of the players (v1.72) ──────────────
//
// Before this, a tactic was a set of flat multipliers on team-level phase
// strengths, and a player entered the match engine as a single `overall` number.
// That meant the instructions could never be *wrong for your squad*: picking
// Possession gave the same +4% midfield whether the side was full of passers or
// full of runners, and Gegenpress cost the same legs whether or not anyone had
// the stamina for it. With 35 attributes on every player, that is a real gap —
// the attributes describe exactly the things the instructions are asking for.
//
// This module closes it. Each tactical choice — mentality, style, and the five
// advanced instructions — names the ATTRIBUTES it leans on. The engine then
// compares what the setup demands against what the players on the pitch actually
// have, and turns the gap into a modest multiplier: a side asked to press with
// no stamina presses worse than a side built for it.
//
// Everything here is pure data plus one scoring pass. Nothing names a player, an
// archetype or a formation, and the engine never branches on a style by name —
// it looks a row up in these tables exactly as it already does for `styleShape`.
//
// ── Deliberate scope ──────────────────────────────────────────────────────
// Fit is an EDGE, not a gate. `TACTIC_FIT_SWING` caps how much the whole system
// can move a side (±8% on the affected phase), which is smaller than the swing
// between a good and a bad player and roughly the size of the existing style
// counter matrix. A squad that suits its instructions should feel sharper, not
// win by default — the balance targets (~2.7 goals/match, ~45% home wins) still
// have to hold, so the calibration harness is the check on this file.

import type { AttrKey } from "./attributes";
import type { DefLine, Mentality, Press, Style, Tempo, Width } from "../types";

/**
 * Which phase of the game a demand applies to. A demand that isn't met damps
 * that phase; one that is exceeded lifts it.
 *
 *   attack   → the side's attacking output
 *   midfield → its share of the ball, and so its chance volume
 *   defense  → its solidity
 *   stamina  → how well it holds the instruction over 90 minutes (fitness drain)
 */
export type FitPhase = "attack" | "midfield" | "defense" | "stamina";

/** One tactical choice's demand: the attributes it leans on, and where it bites. */
export interface FitDemand {
  phase: FitPhase;
  /** Attributes the choice asks for, with relative weights. Normalised on read,
   * so the weights only express relative importance within the demand. */
  attrs: Partial<Record<AttrKey, number>>;
  /** How strongly this particular demand is felt, 0..1. A choice that is a
   * genuine specialism (Gegenpress, Park the Bus) asks more of the squad than a
   * neutral default, which asks nothing at all. */
  intensity: number;
}

/** No demand — the neutral default for a choice that asks nothing special. */
const NONE: FitDemand[] = [];

// ── Mentality ─────────────────────────────────────────────────────────────
// How far up the pitch the side plays. Attacking asks players to create and
// finish; Defensive asks them to hold shape and read danger.

export const MENTALITY_DEMANDS: Record<Mentality, FitDemand[]> = {
  Attacking: [
    {
      phase: "attack",
      // Playing on the front foot is about making and taking chances.
      attrs: { finishing: 1, positioning: 0.9, vision: 0.7, dribbling: 0.6, composure: 0.5 },
      intensity: 0.7,
    },
  ],
  Balanced: NONE,
  Defensive: [
    {
      phase: "defense",
      // Sitting in asks for shape, reading of the game, and duels won.
      attrs: { markingAwareness: 1, interceptions: 0.9, standingTackle: 0.7, positioning: 0.5, strength: 0.4 },
      intensity: 0.7,
    },
  ],
};

// ── Style ─────────────────────────────────────────────────────────────────
// The six playing styles, each asking for the thing it is actually made of.

export const STYLE_DEMANDS: Record<Style, FitDemand[]> = {
  Possession: [
    {
      phase: "midfield",
      // Keeping the ball is passing, control and composure under pressure.
      attrs: { shortPassing: 1, ballControl: 0.9, composure: 0.7, vision: 0.6, longPassing: 0.4 },
      intensity: 1.0,
    },
  ],
  Counter: [
    {
      phase: "attack",
      // Breaking at speed: get out fast and finish the moment it's on.
      attrs: { sprintSpeed: 1, acceleration: 0.9, finishing: 0.6, reactions: 0.5, longPassing: 0.4 },
      intensity: 1.0,
    },
  ],
  Direct: [
    {
      phase: "attack",
      // Going long: hit it, win it, and get on the second ball.
      attrs: { longPassing: 1, strength: 0.8, headingAccuracy: 0.7, jumping: 0.6, shotPower: 0.4 },
      intensity: 0.9,
    },
  ],
  Gegenpress: [
    {
      phase: "midfield",
      // Winning it back high asks for aggression and reading the trigger.
      attrs: { aggression: 1, interceptions: 0.9, standingTackle: 0.7, reactions: 0.6 },
      intensity: 1.1,
    },
    {
      phase: "stamina",
      // And the legs to do it for ninety minutes — the cost of the style.
      attrs: { stamina: 1, strength: 0.4 },
      intensity: 1.2,
    },
  ],
  ParkTheBus: [
    {
      phase: "defense",
      // A low block is bodies, blocks and heads on everything.
      attrs: { markingAwareness: 1, standingTackle: 0.9, slidingTackle: 0.7, headingAccuracy: 0.6, jumping: 0.5 },
      intensity: 1.1,
    },
  ],
  WingPlay: [
    {
      phase: "attack",
      // Everything through the flanks: beat the man, whip it in.
      attrs: { crossing: 1, dribbling: 0.8, sprintSpeed: 0.7, curve: 0.5, acceleration: 0.4 },
      intensity: 1.0,
    },
  ],
};

// ── Advanced instructions ─────────────────────────────────────────────────
// Only the non-default settings carry a demand: "Standard" anything asks nothing
// of the squad, which is exactly why it's the safe choice.

export const TEMPO_DEMANDS: Record<Tempo, FitDemand[]> = {
  Slow: [
    {
      phase: "midfield",
      // Controlling the game slowly is a patience and passing exercise.
      attrs: { composure: 1, shortPassing: 0.8, ballControl: 0.6, vision: 0.5 },
      intensity: 0.6,
    },
  ],
  Standard: NONE,
  High: [
    {
      phase: "midfield",
      // Playing quickly asks for first touch, sharpness and legs.
      attrs: { agility: 1, reactions: 0.9, ballControl: 0.7, acceleration: 0.6 },
      intensity: 0.7,
    },
    { phase: "stamina", attrs: { stamina: 1 }, intensity: 0.8 },
  ],
};

export const WIDTH_DEMANDS: Record<Width, FitDemand[]> = {
  Narrow: [
    {
      phase: "midfield",
      // Playing through a congested middle needs close control and quick feet.
      attrs: { ballControl: 1, shortPassing: 0.8, agility: 0.6, balance: 0.5 },
      intensity: 0.5,
    },
  ],
  Standard: NONE,
  Wide: [
    {
      phase: "attack",
      // Stretching the pitch needs someone who can actually deliver from there.
      attrs: { crossing: 1, sprintSpeed: 0.7, stamina: 0.6, curve: 0.4 },
      intensity: 0.5,
    },
  ],
};

export const PRESS_DEMANDS: Record<Press, FitDemand[]> = {
  Low: NONE,
  Medium: NONE,
  High: [
    {
      phase: "midfield",
      attrs: { aggression: 1, interceptions: 0.8, standingTackle: 0.6, reactions: 0.5 },
      intensity: 0.9,
    },
    { phase: "stamina", attrs: { stamina: 1 }, intensity: 1.0 },
  ],
};

export const LINE_DEMANDS: Record<DefLine, FitDemand[]> = {
  Deep: [
    {
      phase: "defense",
      // Defending your own box: win the header, block the shot.
      attrs: { markingAwareness: 1, headingAccuracy: 0.7, standingTackle: 0.6, jumping: 0.5 },
      intensity: 0.5,
    },
  ],
  Standard: NONE,
  High: [
    {
      phase: "defense",
      // A high line lives or dies on recovery pace and reading the through ball.
      attrs: { sprintSpeed: 1, acceleration: 0.8, interceptions: 0.7, markingAwareness: 0.5 },
      intensity: 1.0,
    },
  ],
};

/** Every demand a tactic carries, from all six of its axes. */
export function tacticDemands(t: {
  mentality: Mentality;
  style: Style;
  tempo?: Tempo;
  width?: Width;
  press?: Press;
  line?: DefLine;
}): FitDemand[] {
  return [
    ...(MENTALITY_DEMANDS[t.mentality] ?? NONE),
    ...(STYLE_DEMANDS[t.style] ?? NONE),
    ...(TEMPO_DEMANDS[t.tempo ?? "Standard"] ?? NONE),
    ...(WIDTH_DEMANDS[t.width ?? "Standard"] ?? NONE),
    ...(PRESS_DEMANDS[t.press ?? "Medium"] ?? NONE),
    ...(LINE_DEMANDS[t.line ?? "Standard"] ?? NONE),
  ];
}

// ── Scoring ───────────────────────────────────────────────────────────────

/**
 * The rating a demand is measured against — the level at which a squad is
 * considered to meet its instructions exactly, returning a neutral 1.0×.
 *
 * Anchored to the player's own overall rather than to a fixed number, because a
 * League Two side should be judged on whether ITS players suit ITS tactics, not
 * on whether they'd suit them in the Premier League. A 60-rated squad of runners
 * playing Counter is well set up; the same squad playing Possession is not. This
 * is what keeps tactical fit a tactical question rather than a second quality
 * check the good teams win twice.
 *
 * The OFFSET corrects the anchor. `overallFromAttrs` is a position-WEIGHTED sum,
 * so a player's headline rating is pulled up by the handful of attributes his
 * position rewards and sits well above his mean attribute — measured across the
 * shipped English database, a player's average outfield attribute is about 7
 * points under his overall, and the gap widens with quality (−5.5 at 40–60,
 * −9.6 at 80+). Comparing raw attributes against `overall` therefore scored
 * almost every side as mismatched, and elite sides worst of all, which is
 * precisely backwards.
 *
 * Anchoring at `overall + FIT_NEUTRAL_OFFSET` puts the neutral point on the
 * typical attribute level instead, so "meets its instructions" means what it
 * says and the readout is centred rather than uniformly red.
 */
export const FIT_NEUTRAL_OFFSET = -7;

/** How far the whole fit system may move a phase, either way. ±8%. */
export const TACTIC_FIT_SWING = 0.08;

/** How wide a gap (in attribute points, vs. the player's overall) counts as a
 * complete mismatch or a perfect fit. Beyond this the multiplier saturates. */
export const FIT_FULL_GAP = 12;

/** A player as this module needs to see one: his attributes and his level. */
export interface FitPlayer {
  overall: number;
  attrs: Record<AttrKey, number>;
}

/**
 * How well one player meets one demand, as a signed score in −1..1.
 *
 * 0 means "exactly as good at this as he is in general" — the honest neutral.
 * Positive means the demanded attributes are a strength relative to his overall
 * level; negative means the instruction is asking him for something he hasn't
 * got.
 */
export function demandScore(p: FitPlayer, demand: FitDemand): number {
  let sum = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(demand.attrs) as [AttrKey, number][]) {
    sum += (p.attrs[key] ?? 0) * w;
    weight += w;
  }
  if (weight <= 0) return 0;
  const have = sum / weight;
  const want = p.overall + FIT_NEUTRAL_OFFSET;
  return Math.max(-1, Math.min(1, (have - want) / FIT_FULL_GAP));
}

/**
 * The multiplier a set of demands produces for one phase, given the players on
 * the pitch.
 *
 * Averaged over the squad and over the demands that touch this phase, then
 * scaled by `TACTIC_FIT_SWING` — so the return is always within
 * [1 − swing, 1 + swing] and a tactic with no demand for the phase returns
 * exactly 1.
 */
export function fitMultiplier(players: FitPlayer[], demands: FitDemand[], phase: FitPhase): number {
  const relevant = demands.filter((d) => d.phase === phase);
  if (relevant.length === 0 || players.length === 0) return 1;

  let weighted = 0;
  let intensity = 0;
  for (const d of relevant) {
    let sum = 0;
    for (const p of players) sum += demandScore(p, d);
    weighted += (sum / players.length) * d.intensity;
    intensity += d.intensity;
  }
  if (intensity <= 0) return 1;
  const score = weighted / intensity; // −1..1
  return 1 + score * TACTIC_FIT_SWING;
}

/**
 * The fitness-drain multiplier a tactic's stamina demands imply.
 *
 * Inverted relative to the other phases: meeting a stamina demand should make a
 * side drain LESS, not more, so a squad built to press can actually press for
 * ninety minutes while one that isn't fades. Returns 1 when the tactic makes no
 * stamina demand at all (which is most of them).
 */
export function fitDrainMultiplier(players: FitPlayer[], demands: FitDemand[]): number {
  const m = fitMultiplier(players, demands, "stamina");
  // m > 1 means the squad exceeds the demand → less drain, hence the inversion.
  return 2 - m;
}

// ── Reporting (for the Tactics screen) ────────────────────────────────────

/** One line of the "how well does this suit us" readout. */
export interface FitReportRow {
  phase: FitPhase;
  /** −1..1, the squad's average score against this phase's demands. */
  score: number;
  /** The resulting multiplier, for display. */
  mult: number;
  /** The attributes this phase's demands actually lean on, strongest first. */
  attrs: AttrKey[];
}

export const FIT_PHASE_LABEL: Record<FitPhase, string> = {
  attack: "Attack",
  midfield: "Midfield",
  defense: "Defence",
  stamina: "Endurance",
};

/**
 * A full readout of how well a squad suits a tactic, for the Tactics screen.
 *
 * Only phases the tactic actually makes a demand on appear — a Balanced,
 * Standard-everything setup asks nothing and reports nothing, which is the
 * honest answer rather than a row of neutral bars.
 */
export function tacticFitReport(players: FitPlayer[], demands: FitDemand[]): FitReportRow[] {
  const phases: FitPhase[] = ["attack", "midfield", "defense", "stamina"];
  const rows: FitReportRow[] = [];
  for (const phase of phases) {
    const relevant = demands.filter((d) => d.phase === phase);
    if (relevant.length === 0) continue;
    const mult = phase === "stamina"
      ? fitDrainMultiplier(players, demands)
      : fitMultiplier(players, demands, phase);
    // Recover the underlying score for display, undoing the swing scaling.
    const raw = fitMultiplier(players, demands, phase);
    const score = TACTIC_FIT_SWING > 0 ? (raw - 1) / TACTIC_FIT_SWING : 0;
    // The attributes the phase leans on, by total weight across its demands.
    const totals = new Map<AttrKey, number>();
    for (const d of relevant) {
      for (const [k, w] of Object.entries(d.attrs) as [AttrKey, number][]) {
        totals.set(k, (totals.get(k) ?? 0) + w * d.intensity);
      }
    }
    const attrs = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    rows.push({ phase, score, mult, attrs });
  }
  return rows;
}

/** A one-word reading of a fit score, for the UI. */
export function fitLabel(score: number): string {
  if (score >= 0.5) return "Ideal";
  if (score >= 0.2) return "Suited";
  if (score > -0.2) return "Workable";
  if (score > -0.5) return "Stretched";
  return "Mismatched";
}

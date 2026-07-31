// ── Persona archetypes & classes (§5, v1.73) ───────────────────────────────
//
// A Persona is the identity a player has EARNED, read off the attributes he
// actually has. It is a derived view — like `overall` and the six card faces —
// never a stored field, and it re-reads itself every time his attributes move.
// The loop the design asks for is:
//
//     Training Plan → Attributes → Persona → Tactical effect
//
// ── Why this is not the archetype ─────────────────────────────────────────
// `config/archetypes.ts` keeps its job. An archetype is the player's GENERATION
// SEED: worldgen shapes his attribute line from `attrProfile`, development
// distributes his growth along it, and his scorer/assist weights, pace reliance,
// height band and goal flavour all hang off it. It is assigned at birth and does
// not move.
//
// A persona cannot do that job, because a persona is computed FROM attributes —
// if it also generated them the definition would be circular. So the two live
// side by side: the archetype says what kind of player he was made to be, the
// persona says what he has actually become. A prospect generated as a Stopper
// who is trained on passing for four seasons keeps the Stopper generation seed
// and becomes The Architect, which is precisely the design's example.
//
// ── The 1:1 plan mapping ──────────────────────────────────────────────────
// There are exactly 45 personas because there are exactly 45 training plans
// (9 position groups × 5). Each persona names its plan, and assignment scores a
// player's attributes against that plan's own PRIMARY and SECONDARY lists. This
// is what makes the loop legible to a player: the plan you train IS the persona
// you are aiming at, by name.
//
// Everything here is pure data. `derivePersona` is the only logic, and it reads
// the training table rather than duplicating it — nothing names an attribute.

import type { Pos } from "../types";
import { ATTR_KEYS, type AttrKey } from "./attributes";
import {
  OTHER_SHARE,
  PRIMARY_SHARE,
  SECONDARY_SHARE,
  TRAINING_PLAN_MAP,
  defaultPlanFor,
  planPosOf,
  plansForPosition,
  type TrainingPlanDef,
} from "./training";

/**
 * The four classes a persona belongs to. A class is what the TACTICAL engine
 * reads — personas exist for identity and flavour, classes exist for maths.
 *
 *   Creators   — the playmakers. Want time on the ball; hate chasing it.
 *   Engines    — the runners. The lungs of the side; wasted sitting deep.
 *   Enforcers  — the destroyers. Excel with play in front of them; exposed by
 *                a high line.
 *   Spearheads — the attackers. Thrive in fast, chaotic attacks; go missing in
 *                a slow, defensive setup.
 */
export type PersonaClass = "Creator" | "Engine" | "Enforcer" | "Spearhead";

export const PERSONA_CLASS_ORDER: PersonaClass[] = ["Creator", "Engine", "Enforcer", "Spearhead"];

export const PERSONA_CLASS_LABEL: Record<PersonaClass, string> = {
  Creator: "Creator",
  Engine: "Engine",
  Enforcer: "Enforcer",
  Spearhead: "Spearhead",
};

/** One-line description of what a class does for a side, for the UI. */
export const PERSONA_CLASS_BLURB: Record<PersonaClass, string> = {
  Creator: "Playmakers. Thrive with time on the ball; tire quickly when made to chase.",
  Engine: "Runners. The lungs of the side; restricted by a deep defensive line.",
  Enforcer: "Destroyers. Excel with the play in front of them; exposed by a high line.",
  Spearhead: "Attackers. Thrive in fast attacks; isolated by a slow, defensive setup.",
};

export interface Persona {
  id: string;
  /** The earned name — "The Architect", "The Apex Predator". */
  name: string;
  /** The training plan this persona corresponds to, 1:1. */
  planId: string;
  cls: PersonaClass;
  /** One-line player-facing summary of the identity. */
  desc: string;
}

/**
 * The 45 personas, grouped by the position set whose plans they mirror.
 *
 * Class placement follows the design doc. The doc's own class lists named 37 of
 * the 45; the remaining eight (marked ✚) were placed by the same logic the doc
 * uses — what the role actually does on the pitch — and were approved with that
 * reasoning. They also even the classes out, which matters: a class's SIZE sets
 * how easy its tactical bonus is to stack, so leaving four balanced personas
 * unclassed would have made whole squad-building routes contribute nothing.
 */
export const PERSONAS: Persona[] = [
  // ── Goalkeepers ──────────────────────────────────────────────────────────
  { id: "wall", name: "The Wall", planId: "gk_shotstopper", cls: "Enforcer",
    desc: "A reflex specialist who lives on his line and stops what reaches him." },
  { id: "vanguard", name: "The Vanguard", planId: "gk_sweeper", cls: "Engine",
    desc: "A sweeper keeper who defends the space behind a high line." },
  { id: "initiator", name: "The Initiator", planId: "gk_distribution", cls: "Spearhead",
    desc: "A keeper whose release starts the attack." },
  { id: "general", name: "The General", planId: "gk_command", cls: "Spearhead",
    desc: "A commanding presence who owns his box and organises the men in front." },
  { id: "guardian", name: "The Guardian", planId: "gk_balanced", cls: "Enforcer",
    desc: "The all-round keeper — no specialism, no weakness." },

  // ── Centre backs ─────────────────────────────────────────────────────────
  { id: "enforcer", name: "The Enforcer", planId: "cb_stopper", cls: "Enforcer",
    desc: "Front-foot defending: wins the ball, the header and the duel." },
  { id: "architect", name: "The Architect", planId: "cb_ballplaying", cls: "Creator",
    desc: "A defender who starts the attack with the pass." },
  { id: "interceptor", name: "The Interceptor", planId: "cb_cover", cls: "Enforcer",
    desc: "Reads it early and has the legs to get there — cover for a high line." },
  { id: "tower", name: "The Tower", planId: "cb_aerial", cls: "Enforcer",
    desc: "Everything in the air, at both ends of the pitch." },
  { id: "sentinel", name: "The Sentinel", planId: "cb_balanced", cls: "Enforcer",
    desc: "The complete defender — solid in every phase." },

  // ── Full backs ───────────────────────────────────────────────────────────
  { id: "engine", name: "The Engine", planId: "fb_wingback", cls: "Engine",
    desc: "Up and down the touchline all game — the overlap and the cross." },
  { id: "anchor", name: "The Anchor", planId: "fb_defensive", cls: "Enforcer",
    desc: "A full back who defends first — his winger does not get past him." },
  { id: "constructor", name: "The Constructor", planId: "fb_inverted", cls: "Creator",
    desc: "Steps inside to build the play from the half-space." },
  { id: "dynamo", name: "The Dynamo", planId: "fb_athlete", cls: "Engine",
    desc: "Pure engine — the athlete who covers the whole flank." },
  { id: "protector", name: "The Protector", planId: "fb_balanced", cls: "Enforcer",
    desc: "The modern full back — defends the flank, joins the attack." },

  // ── Defensive midfield ───────────────────────────────────────────────────
  { id: "destroyer", name: "The Destroyer", planId: "dm_anchor", cls: "Enforcer",
    desc: "Screens the back four and breaks up everything through the middle." },
  { id: "metronome", name: "The Metronome", planId: "dm_regista", cls: "Creator",
    desc: "Sets the tempo from in front of the defence." },
  { id: "iron_lung", name: "The Iron Lung", planId: "dm_boxtobox", cls: "Engine",
    desc: "A holding player with the lungs to get forward too." },
  // ✚ Press resistance is a technical, time-on-the-ball skill — a Creator trait.
  { id: "escapist", name: "The Escapist", planId: "dm_pressresist", cls: "Creator",
    desc: "Receives under pressure and plays the first pass past a press." },
  { id: "shield", name: "The Shield", planId: "dm_balanced", cls: "Enforcer",
    desc: "The complete holding midfielder — protect, receive, distribute." },

  // ── Central midfield ─────────────────────────────────────────────────────
  { id: "workhorse", name: "The Workhorse", planId: "cm_boxtobox", cls: "Engine",
    desc: "End to end for ninety minutes — in both boxes." },
  { id: "maestro", name: "The Maestro", planId: "cm_metronome", cls: "Creator",
    desc: "The midfielder the game is played at the speed of." },
  // ✚ Carrying the ball out of midfield is the runner's job.
  { id: "dribbler", name: "The Dribbler", planId: "cm_carrier", cls: "Engine",
    desc: "Beats the first line by running at it — carries it out of midfield." },
  // ✚ A half-space threat makes and takes space: a Creator.
  { id: "infiltrator", name: "The Infiltrator", planId: "cm_mezzala", cls: "Creator",
    desc: "Drifts into the half-space and arrives late in the box." },
  // ✚ The balanced box-to-box central role — an Engine.
  { id: "engine_room", name: "The Engine Room", planId: "cm_balanced", cls: "Engine",
    desc: "The complete midfielder — controls the middle in every phase." },

  // ── Attacking midfield ───────────────────────────────────────────────────
  { id: "visionary", name: "The Visionary", planId: "am_playmaker", cls: "Creator",
    desc: "The pass nobody else sees — a creator between the lines." },
  { id: "phantom", name: "The Phantom", planId: "am_shadowstriker", cls: "Spearhead",
    desc: "Runs beyond the striker and finishes — a second forward." },
  { id: "marksman", name: "The Marksman", planId: "am_sniper", cls: "Spearhead",
    desc: "Shoots from distance and means it." },
  // ✚ Creating and finding space is the playmaker's craft.
  { id: "illusionist", name: "The Illusionist", planId: "am_agility", cls: "Creator",
    desc: "Turns in a phone box — makes space where there isn't any." },
  // ✚ The balanced number ten creates first.
  { id: "catalyst", name: "The Catalyst", planId: "am_balanced", cls: "Creator",
    desc: "The all-round number ten — creates, carries and finishes." },

  // ── Wide midfield ────────────────────────────────────────────────────────
  { id: "provider", name: "The Provider", planId: "wm_winger", cls: "Creator",
    desc: "Outside the full back and to the back post — width and delivery." },
  { id: "conductor", name: "The Conductor", planId: "wm_playmaker", cls: "Creator",
    desc: "A number ten operating from the touchline." },
  { id: "marathoner", name: "The Marathoner", planId: "wm_workhorse", cls: "Engine",
    desc: "Tracks the full back, holds the width, runs all afternoon." },
  { id: "inside_invader", name: "The Inside Invader", planId: "wm_inverted", cls: "Engine",
    desc: "Cuts in on the stronger foot — a wide player who is really a scorer." },
  // ✚ The balanced wide midfielder does the up-and-down job — an Engine.
  { id: "specialist", name: "The Specialist", planId: "wm_balanced", cls: "Engine",
    desc: "The complete wide midfielder — beat a man, deliver, get back." },

  // ── Wingers ──────────────────────────────────────────────────────────────
  { id: "razor", name: "The Razor", planId: "w_cutter", cls: "Spearhead",
    desc: "Starts wide, finishes central — a winger whose job is goals." },
  { id: "speedster", name: "The Speedster", planId: "w_speed", cls: "Spearhead",
    desc: "Pure pace on the outside — knock it past him and go." },
  { id: "virtuoso", name: "The Virtuoso", planId: "w_trickster", cls: "Spearhead",
    desc: "One-v-one every time — the winger defenders don't want to face." },
  { id: "architect_winger", name: "The Architect Winger", planId: "w_creator", cls: "Spearhead",
    desc: "The assist man from wide — delivery, vision and dead balls." },
  // ✚ Placed with the other wingers, all of which the doc classes as Spearheads.
  { id: "complete_winger", name: "The Complete Winger", planId: "w_balanced", cls: "Spearhead",
    desc: "The all-round wide forward — beat a man, create, and score." },

  // ── Strikers ─────────────────────────────────────────────────────────────
  { id: "battering_ram", name: "The Battering Ram", planId: "st_targetman", cls: "Spearhead",
    desc: "Holds it up and wins it in the air — the reference point up front." },
  { id: "sniper", name: "The Sniper", planId: "st_poacher", cls: "Spearhead",
    desc: "Lives on the shoulder and finishes first time." },
  { id: "decoy", name: "The Decoy", planId: "st_false9", cls: "Creator",
    desc: "Drops in to make the numbers up — creates as much as he scores." },
  { id: "bullet", name: "The Bullet", planId: "st_speed", cls: "Spearhead",
    desc: "Runs in behind and finishes at pace." },
  { id: "apex_predator", name: "The Apex Predator", planId: "st_balanced", cls: "Spearhead",
    desc: "The complete centre forward — scores in every way there is." },
];

export const PERSONA_MAP: Record<string, Persona> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p])
);

/** The persona a training plan aims at — the other half of the 1:1 mapping. */
export const PERSONA_BY_PLAN: Record<string, Persona> = Object.fromEntries(
  PERSONAS.map((p) => [p.planId, p])
);

export function getPersona(id: string): Persona | undefined {
  return PERSONA_MAP[id];
}

/** Every persona a player at this position can earn (his plan set's five). */
export function personasForPosition(pos: Pos): Persona[] {
  return plansForPosition(pos)
    .map((plan) => PERSONA_BY_PLAN[plan.id])
    .filter((p): p is Persona => !!p);
}

// ── Deriving a persona from attributes ────────────────────────────────────

/**
 * How strongly a player matches one plan's attribute profile.
 *
 * The score is how far the plan's OWN attributes stand above the player's
 * baseline — his mean attribute — weighted by the plan's tier shares. It is a
 * measure of SHAPE, not of level.
 *
 * Measuring shape is the whole trick. The obvious scoring (a weighted average
 * over all 35 attributes) does not work: every plan weights every attribute,
 * and the 27 attributes in the "other" tier at 0.2 share swamp the four
 * primaries at 1.0. Every persona then scores within a point or two of the
 * others, the balanced persona — whose profile is nearest a flat average — wins
 * almost every time, and a specialist's identity never surfaces. Subtracting
 * the player's own mean removes that common term, so what remains is only what
 * makes this plan different from the others.
 *
 * Anchoring on the player's own mean also makes the comparison fair across
 * quality: a League Two defender is judged on the shape of HIS attribute line,
 * not against a Premier League one. The same reasoning `tacticfit.ts` anchors
 * on, for the same reason.
 *
 * Positive means the plan's attributes are a genuine strength of his; near zero
 * means he is no more suited to this plan than to any other.
 */
export function planMatchScore(attrs: Record<AttrKey, number>, plan: TrainingPlanDef): number {
  let mean = 0;
  for (const k of ATTR_KEYS) mean += attrs[k] ?? 0;
  mean /= ATTR_KEYS.length;

  // Tier shares minus the flat "other" baseline: only the primaries (0.8) and
  // secondaries (0.4) carry signal, and the 27 background attributes drop out
  // entirely rather than diluting it.
  let sum = 0;
  let weight = 0;
  for (const k of ATTR_KEYS) {
    const w = plan.weights[k] - OTHER_SHARE;
    if (w <= 0) continue;
    sum += ((attrs[k] ?? 0) - mean) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/** A persona match, with the score that earned it — for the UI's "next identity". */
export interface PersonaMatch {
  persona: Persona;
  score: number;
}

/**
 * The average tier share each attribute carries across a position's five plans.
 *
 * This is what a plan is measured AGAINST. Every balanced plan is built from its
 * position's most common attributes, so it overlaps its four specialists almost
 * completely — measured across the shipped table, all eight of a balanced plan's
 * targets also appear in at least one specialist, at every position. Scored on
 * raw shape, the balanced plan therefore cannot lose: whatever the player is
 * good at, it already claims a share of, and it collects credit from all four
 * specialisms at once. A ball-playing centre back came out as The Sentinel, and
 * every keeper came out as The Guardian.
 *
 * Subtracting the positional mean fixes that by asking a sharper question: not
 * "is he good at what this plan trains" but "is he good at what makes this plan
 * DIFFERENT from its siblings". An attribute all five plans want carries no
 * signal about which of them he is, and drops out. The balanced plan is left
 * with almost nothing of its own — which is correct, and is exactly why it wins
 * only when no specialism fits, rather than by default.
 *
 * Memoised per position: the plan table is static, so this is computed once.
 */
const DISTINCTIVE_WEIGHTS = new Map<string, Record<AttrKey, number>>();

function distinctiveWeights(pos: Pos): Record<AttrKey, number> {
  const planPos = planPosOf(pos);
  const cached = DISTINCTIVE_WEIGHTS.get(planPos);
  if (cached) return cached;

  const plans = plansForPosition(pos);
  const mean = {} as Record<AttrKey, number>;
  for (const k of ATTR_KEYS) {
    let s = 0;
    for (const p of plans) s += p.weights[k];
    mean[k] = plans.length > 0 ? s / plans.length : 0;
  }
  DISTINCTIVE_WEIGHTS.set(planPos, mean);
  return mean;
}

/**
 * How distinctively a player matches one plan, among the five at his position.
 *
 * Same shape measure as `planMatchScore`, but each attribute is weighted by how
 * much MORE this plan wants it than its siblings do — so the score reflects the
 * identity the plan uniquely stands for.
 */
function distinctiveScore(
  attrs: Record<AttrKey, number>,
  plan: TrainingPlanDef,
  mean: Record<AttrKey, number>
): number {
  let attrMean = 0;
  for (const k of ATTR_KEYS) attrMean += attrs[k] ?? 0;
  attrMean /= ATTR_KEYS.length;

  let sum = 0;
  let weight = 0;
  for (const k of ATTR_KEYS) {
    const w = plan.weights[k] - mean[k];
    if (w <= 0) continue;
    sum += ((attrs[k] ?? 0) - attrMean) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * Rank every persona available at `pos` by how well the attributes fit it.
 *
 * Returned strongest-first, so `[0]` is the earned persona and `[1]` is the
 * identity he is closest to shifting into.
 */
export function rankPersonas(attrs: Record<AttrKey, number>, pos: Pos): PersonaMatch[] {
  const mean = distinctiveWeights(pos);
  const out: PersonaMatch[] = [];
  for (const persona of personasForPosition(pos)) {
    const plan = TRAINING_PLAN_MAP[persona.planId];
    if (!plan) continue;
    out.push({ persona, score: distinctiveScore(attrs, plan, mean) });
  }
  // Ties break toward the earlier persona in the table, which is stable across
  // runs — the plan table's own order, specialisations before balanced.
  return out.sort((a, b) => b.score - a.score);
}

/**
 * How much better the leading persona must score than the incumbent before the
 * player actually changes identity.
 *
 * Without this, a player sitting between two profiles would flip persona on
 * every rounding-level attribute tick, and his class — and so his side's
 * tactical modifiers — would flicker season to season. The margin makes the
 * identity sticky: it changes when training has genuinely moved him, not when
 * one point of Agility crossed a line.
 */
export const PERSONA_SWITCH_MARGIN = 1.5;

/**
 * How clearly a specialism must show before it displaces the balanced persona.
 *
 * Scored distinctively, a balanced plan has almost no weight of its own (that is
 * the point — it stands for nothing in particular), so it would otherwise never
 * win and the balanced personas would be unreachable. Instead the leading
 * SPECIALIST must clear this bar, in attribute points above the player's own
 * mean, to claim him; a genuinely well-rounded player clears nothing and is
 * correctly read as balanced.
 *
 * In attribute points, so it reads directly: a specialist needs its distinctive
 * attributes sitting this far above the player's own average before that counts
 * as an identity rather than noise.
 *
 * Calibrated against a generated world rather than guessed. Across the shipped
 * English database the leading specialist score runs p10≈7.6, p50≈11.4,
 * p90≈15.5, so a threshold in the single digits claims essentially everyone: at
 * 3 the balanced personas were literally unreachable (0.0% of 2,152 players),
 * leaving four of the 45 as dead data. 8 puts roughly one player in eight on a
 * balanced persona — a real minority who genuinely have no standout specialism —
 * and evens the class split, which matters because a class's share of the world
 * decides how easy its tactical bonus is to field.
 */
export const SPECIALISM_THRESHOLD = 8;

/**
 * The persona a player has earned.
 *
 * `currentId` is his existing persona, if any: passing it in applies the
 * hysteresis margin above, so an established identity is only displaced by a
 * clearly better fit. Omit it for a fresh read (a newly generated player, or the
 * UI asking "what would he be").
 *
 * Pure and deterministic — the same attribute line always gives the same answer.
 */
export function derivePersona(
  attrs: Record<AttrKey, number>,
  pos: Pos,
  currentId?: string
): Persona | undefined {
  const ranked = rankPersonas(attrs, pos);
  if (ranked.length === 0) return undefined;

  // The balanced persona is the one whose plan is its position's default — the
  // last in the set. It stands for no specialism, so it wins by DEFAULT rather
  // than by score: a player only leaves it when a specialism genuinely shows.
  const balancedId = PERSONA_BY_PLAN[defaultPlanFor(pos).id]?.id;
  const leader = ranked.find((r) => r.persona.id !== balancedId);
  const best =
    leader && leader.score >= SPECIALISM_THRESHOLD
      ? leader
      : ranked.find((r) => r.persona.id === balancedId) ?? ranked[0];

  if (!currentId || currentId === best.persona.id) return best.persona;

  const incumbent = ranked.find((r) => r.persona.id === currentId);
  // An incumbent that isn't in this position's set at all (he was retrained to a
  // new position) has no claim — take the new best outright.
  if (!incumbent) return best.persona;
  return best.score >= incumbent.score + PERSONA_SWITCH_MARGIN ? best.persona : incumbent.persona;
}

// ── Class tallies ─────────────────────────────────────────────────────────

/** An empty per-class tally. */
export function emptyClassCount(): Record<PersonaClass, number> {
  return { Creator: 0, Engine: 0, Enforcer: 0, Spearhead: 0 };
}

if (process.env.NODE_ENV !== "production") {
  // Every persona must name a real plan, and every plan must have exactly one
  // persona — the 1:1 mapping is the whole design, so a drift is a bug.
  const planIds = new Set(Object.keys(TRAINING_PLAN_MAP));
  for (const p of PERSONAS) {
    if (!planIds.has(p.planId)) throw new Error(`Persona "${p.id}" names unknown plan "${p.planId}"`);
  }
  if (PERSONA_BY_PLAN && Object.keys(PERSONA_BY_PLAN).length !== PERSONAS.length) {
    throw new Error("Two personas share a training plan — the mapping must be 1:1");
  }
  for (const planId of planIds) {
    if (!PERSONA_BY_PLAN[planId]) throw new Error(`Training plan "${planId}" has no persona`);
  }
  const ids = new Set(PERSONAS.map((p) => p.id));
  if (ids.size !== PERSONAS.length) throw new Error("Duplicate persona id");
}

// Re-exported so callers that only need the tier shares don't reach into the
// training table for them.
export { PRIMARY_SHARE, SECONDARY_SHARE };

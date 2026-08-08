// ── Chance types: how identity reaches the simulation (v2.2) ───────────────
//
// This module replaces the role brief (`lib/tacticbrief.ts`, deleted) and is a
// deliberately different KIND of answer to the same question.
//
// ── Why the brief had to go ────────────────────────────────────────────────
//
// The brief was a lookup that landed on a player's effective rating: name the
// role standing in a slot, and a matching player multiplied his rating up. It
// was scrupulously zero-sum (see the deleted module's own note) and it was
// still the wrong shape, for a reason no amount of centring fixes: a rating
// bonus makes an archetype a NUMBER. Two sides of equal rating played the same
// match whatever they were made of, because every identity channel in the game
// collapsed into the same scalar before it reached anything the match actually
// simulated.
//
// The precedent for the fix already existed. `paceExploit` (v2.1) asked the one
// question the archetype system had never asked — a high line leaves ball in
// behind, and a Speedster is who punishes it — and answered it by moving chance
// VOLUME rather than anyone's rating. This module generalises that from one
// channel to the whole attacking phase.
//
// ── The model ──────────────────────────────────────────────────────────────
//
// A side does not create "chances". It creates through-balls, crosses, long
// shots and box play, in a MIX set by the archetypes on the pitch. The opposing
// side does not have "a defence". It has a resistance to each of those four
// types, set by ITS archetypes and its shape dials.
//
// A chance rolls its type from the attacker's mix, then converts against the
// defender's resistance to that specific type. So a Tower centre back genuinely
// smothers a crossing side and is genuinely no use against a Sniper striking
// from 25 yards — which is the real-life logic a flat multiplier cannot express
// and the reason two identically-rated squads now play visibly different games.
//
// ── The two invariants, and why the world's scoring cannot drift ───────────
//
// 1. A MIX IS NORMALISED. Every side always creates exactly 100% of its own
//    chances; archetypes decide their composition and never their number. This
//    module therefore cannot inflate chance volume, which is the quantity
//    `npm run calibrate` measures.
//
// 2. RESISTANCE IS CENTRED ON A MEASURED PIVOT. `RESIST_PIVOT` is computed from
//    the archetype table itself at module load — the type-weighted mean across
//    every archetype with a real defensive phase weight — so an ORDINARY defence
//    multiplies conversion by exactly 1. The same discipline `paceExploitPivot`
//    follows, and for the same reason: a channel that does not centre is a
//    world-wide buff or nerf wearing a decision's clothing.
//
// Together those two mean a save that never opens the Tactic Creator computes
// what it always did, and that this file can sit in the engine's hot path.
//
// ── Where roles fit ────────────────────────────────────────────────────────
//
// A Creator-authored tactic assigns each formation slot a ROLE. The role is the
// INSTRUCTION — it sets what that slot contributes to the mix. The player
// standing there is who CARRIES IT OUT, and how well he does that is decided by
// how close his own derived archetype sits to the role he was given.
//
// This is the part that has no bonus in it anywhere. Put a Battering Ram in a
// Sniper's slot and the side still manufactures the Sniper's long shots — the
// Ram is simply bad at them, so those chances convert at his execution rather
// than the Sniper's. The mismatch punishes itself through the chances it
// creates, not through a penalty table someone has to keep centred.

import type { AttrKey } from "./config/attributes";
import type { Pos, RoleBrief, Tactic } from "./types";
import { getFormation } from "./config/formations";
import {
  ARCHETYPE_ROSTER,
  archetypesForPosition,
  deriveArchetype,
  getArchetype,
  type Archetype,
} from "./config/archetype";
import { PHASE_WEIGHTS, POS_ORDER } from "./config/positions";

/**
 * The four ways a chance is manufactured.
 *
 * Deliberately four and not more: each has to be something a manager can SEE in
 * his squad ("I have two tall centre backs, crosses do not hurt me") and
 * something the archetype roster genuinely distinguishes. A fifth type nobody
 * can staff differently is a number with no decision attached to it.
 */
export type ChanceType = "through" | "cross" | "longshot" | "box";

export const CHANCE_TYPES: ChanceType[] = ["through", "cross", "longshot", "box"];

/** A normalised mix over the four types. Always sums to 1 — see invariant 1. */
export type ChanceMix = Record<ChanceType, number>;

/** Per-type resistance, centred on 1. Above 1 = this defence smothers the type. */
export type Resistance = Record<ChanceType, number>;

/**
 * What each archetype CREATES, before position weighting.
 *
 * These are relative shares, not probabilities — the mix is normalised at the
 * end, so only the ratios matter and a row need not sum to anything. Rows are
 * derived from the class where the archetype does not differ from it, exactly
 * as `ARCHETYPE_OVERRIDE` works for scorer/assist weights: the class says what
 * KIND of footballer this is, and only genuinely distinct roles get their own
 * row.
 *
 * The numbers are read off what the role is famous for. A Speedster runs in
 * behind, so `through` dominates. A Tower attacks crosses, so his own creation
 * is `box` (he is on the end of them, he does not deliver them). A Sniper
 * shoots from anywhere. A Motor overlaps and crosses.
 */
const CLASS_CREATION: Record<string, ChanceMix> = {
  //          through  cross  longshot  box
  Creator:  { through: 0.40, cross: 0.28, longshot: 0.18, box: 0.14 },
  Engine:   { through: 0.28, cross: 0.34, longshot: 0.16, box: 0.22 },
  Enforcer: { through: 0.20, cross: 0.24, longshot: 0.20, box: 0.36 },
  Blitzer:  { through: 0.44, cross: 0.20, longshot: 0.16, box: 0.20 },
  Maverick: { through: 0.26, cross: 0.20, longshot: 0.32, box: 0.22 },
};

/**
 * Per-archetype creation rows, for roles that genuinely differ from their class.
 *
 * Same discipline as `ARCHETYPE_OVERRIDE`: absent means "the class row is
 * right". Only roles whose real-world identity is ABOUT a particular kind of
 * chance appear here, which keeps the table something a reader can check
 * against the roster's own descriptions rather than a wall of tuned numbers.
 */
const ARCHETYPE_CREATION: Record<string, ChanceMix> = {
  // Wingers and full backs who live on the touchline deliver crosses.
  engine:           { through: 0.22, cross: 0.56, longshot: 0.08, box: 0.14 },
  dynamo:           { through: 0.26, cross: 0.48, longshot: 0.10, box: 0.16 },
  constructor:      { through: 0.34, cross: 0.34, longshot: 0.20, box: 0.12 },
  architect_winger: { through: 0.24, cross: 0.58, longshot: 0.10, box: 0.08 },
  provider:         { through: 0.28, cross: 0.50, longshot: 0.10, box: 0.12 },
  conductor:        { through: 0.42, cross: 0.34, longshot: 0.16, box: 0.08 },

  // Runners in behind.
  speedster:        { through: 0.62, cross: 0.20, longshot: 0.08, box: 0.10 },
  bullet:           { through: 0.58, cross: 0.12, longshot: 0.12, box: 0.18 },
  razor:            { through: 0.48, cross: 0.18, longshot: 0.18, box: 0.16 },
  infiltrator:      { through: 0.50, cross: 0.16, longshot: 0.18, box: 0.16 },

  // Shooters.
  sniper:           { through: 0.30, cross: 0.10, longshot: 0.30, box: 0.30 },
  virtuoso:         { through: 0.26, cross: 0.20, longshot: 0.38, box: 0.16 },
  visionary:        { through: 0.46, cross: 0.22, longshot: 0.24, box: 0.08 },

  // Target men and poachers — on the end of things rather than starting them.
  battering_ram:    { through: 0.12, cross: 0.22, longshot: 0.14, box: 0.52 },
  apex_predator:    { through: 0.30, cross: 0.12, longshot: 0.16, box: 0.42 },
  decoy:            { through: 0.34, cross: 0.20, longshot: 0.16, box: 0.30 },
  tower:            { through: 0.08, cross: 0.14, longshot: 0.10, box: 0.68 },

  // Deep builders play the pass that springs a run; they do not cross.
  metronome:        { through: 0.52, cross: 0.20, longshot: 0.20, box: 0.08 },
  maestro:          { through: 0.48, cross: 0.24, longshot: 0.20, box: 0.08 },
  architect:        { through: 0.54, cross: 0.18, longshot: 0.20, box: 0.08 },
};

/**
 * What each archetype STOPS, before position weighting.
 *
 * Read as "how much better than an ordinary defender is he against this type",
 * on the same relative footing as the creation rows — the pivot below turns
 * these into multipliers centred on 1, so the absolute level of the table is
 * irrelevant and only the spread between roles carries meaning.
 */
const CLASS_DEFENCE: Record<string, Resistance> = {
  Creator:  { through: 0.90, cross: 0.90, longshot: 1.00, box: 0.92 },
  Engine:   { through: 1.10, cross: 1.06, longshot: 0.98, box: 0.94 },
  Enforcer: { through: 1.02, cross: 1.14, longshot: 1.04, box: 1.18 },
  Blitzer:  { through: 1.04, cross: 0.92, longshot: 0.94, box: 0.96 },
  Maverick: { through: 0.96, cross: 0.94, longshot: 0.98, box: 0.96 },
};

const ARCHETYPE_DEFENCE: Record<string, Resistance> = {
  // Aerial monsters own their box and are worth nothing against a low drive.
  tower:       { through: 0.88, cross: 1.42, longshot: 0.96, box: 1.36 },
  enforcer:    { through: 0.92, cross: 1.24, longshot: 1.00, box: 1.30 },
  sentinel:    { through: 1.00, cross: 1.18, longshot: 1.06, box: 1.20 },
  // Recovery pace and reading the game is what kills a ball over the top.
  interceptor: { through: 1.34, cross: 1.02, longshot: 1.04, box: 1.06 },
  anchor:      { through: 1.22, cross: 1.18, longshot: 0.98, box: 0.98 },
  protector:   { through: 1.12, cross: 1.14, longshot: 1.00, box: 1.04 },
  // Screening midfielders block the shooting lane; they are not aerial.
  destroyer:   { through: 1.08, cross: 0.96, longshot: 1.26, box: 1.02 },
  shield:      { through: 1.12, cross: 0.98, longshot: 1.30, box: 1.00 },
  iron_lung:   { through: 1.14, cross: 1.02, longshot: 1.14, box: 0.96 },
  // Keepers. A sweeper kills through-balls; a big one commands his box.
  vanguard:    { through: 1.30, cross: 1.02, longshot: 1.00, box: 0.98 },
  general:     { through: 0.98, cross: 1.28, longshot: 1.02, box: 1.22 },
  wall:        { through: 0.98, cross: 1.02, longshot: 1.24, box: 1.16 },
  initiator:   { through: 1.08, cross: 1.00, longshot: 1.02, box: 1.00 },
  guardian:    { through: 1.06, cross: 1.08, longshot: 1.08, box: 1.06 },
};

/**
 * The neutral rows, for an archetype that cannot be resolved (a mod file, a
 * corrupted save) or a player with no derivable identity.
 *
 * Declared ABOVE the accessors and above `RESIST_PIVOT`, and that placement is
 * load-bearing rather than stylistic: `RESIST_PIVOT` is computed in an IIFE at
 * module load, and it calls `defenceOf`, which falls back to `NEUTRAL_RESIST`.
 * A `const` declared after the IIFE is in its temporal dead zone when the IIFE
 * runs, so the fallback read `undefined` and the whole pivot came out `NaN` —
 * which then silently turned every resistance into `NaN` and made the entire
 * chance-type contest a no-op. Caught by `verify:chancetypes`; keep these here.
 */
const NEUTRAL_MIX: ChanceMix = { through: 0.25, cross: 0.25, longshot: 0.25, box: 0.25 };
const NEUTRAL_RESIST: Resistance = { through: 1, cross: 1, longshot: 1, box: 1 };

/**
 * Look a row up by archetype or class id, WITHOUT consulting the prototype.
 *
 * ── Why this is not a plain `table[id]` ────────────────────────────────────
 *
 * The roster contains an archetype whose id is `constructor` (the inverted
 * full back). A plain index lookup on an object literal walks the prototype
 * chain, so `ARCHETYPE_DEFENCE["constructor"]` returns `Object.prototype.
 * constructor` — a FUNCTION, which is truthy, so `??` never falls through to
 * the class row, and reading `.cross` off it yields `undefined`.
 *
 * That is exactly what happened: `RESIST_PIVOT` summed one `undefined` into
 * every total and came out `NaN`, which silently turned the entire chance-type
 * contest into a no-op multiplying every conversion by `NaN`. Nothing threw,
 * and a spot check of any other archetype looked perfect. `verify:chancetypes`
 * caught it; the fix is structural so no future row can reintroduce it, and
 * the same guard covers `toString`, `valueOf` and `hasOwnProperty` should the
 * roster ever name a role after one of those.
 */
function rowFor<T>(table: Record<string, T>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}

/** The creation row for one archetype — its own, else its class's. */
export function creationOf(a: Archetype | undefined): ChanceMix {
  if (!a) return NEUTRAL_MIX;
  return rowFor(ARCHETYPE_CREATION, a.id) ?? rowFor(CLASS_CREATION, a.cls) ?? NEUTRAL_MIX;
}

/** The defensive row for one archetype — its own, else its class's. */
export function defenceOf(a: Archetype | undefined): Resistance {
  if (!a) return NEUTRAL_RESIST;
  return rowFor(ARCHETYPE_DEFENCE, a.id) ?? rowFor(CLASS_DEFENCE, a.cls) ?? NEUTRAL_RESIST;
}

/**
 * The measured pivot — invariant 2, and the reason this cannot move world
 * scoring.
 *
 * Computed at module load from the archetype table itself, weighted by how much
 * each archetype actually DEFENDS. An ordinary back line therefore lands on
 * exactly 1 and converts chances at precisely the rate it always did; only a
 * defence that is DIFFERENTLY shaped from the average moves anything.
 *
 * ── Why this is weighted, and how that was found ───────────────────────────
 *
 * The first cut took a flat mean over the roster, and it was measurably wrong.
 * `sideResistance` weights each player by his slot's DEFENSIVE phase weight, so
 * a real back line is made almost entirely of the defensive archetypes — while
 * a flat roster mean also counts every Sniper and Winger, who never defend and
 * whose rows sit below 1. Centred on that lower number, every real defence read
 * as better than average.
 *
 * Measured across 380 real club-vs-club pairings, the mean conversion
 * multiplier came out at **0.975** rather than 1, and `calibrate` duly fell
 * from 2.62 to 2.55 goals/match — a world-wide scoring nerf, which is exactly
 * what a pivot exists to prevent.
 *
 * Weighting each archetype by the mean defensive phase weight of the positions
 * it can actually play makes the pivot describe the population that is really
 * doing the defending. Derived rather than authored, for the same reason
 * `paceExploitPivot` is: add an archetype and the pivot re-centres itself,
 * where a hardcoded number silently tilts the feature the day the table
 * changes.
 */
export const RESIST_PIVOT: Resistance = (() => {
  const sum: Resistance = { through: 0, cross: 0, longshot: 0, box: 0 };
  let total = 0;
  for (const a of ARCHETYPE_ROSTER) {
    // How much this archetype defends, averaged over the positions it plays —
    // the same `PHASE_WEIGHTS[...].defense` that `sideResistance` weights by.
    let w = 0;
    let n = 0;
    for (const pos of POS_ORDER) {
      if (!archetypesForPosition(pos).some((x) => x.id === a.id)) continue;
      w += PHASE_WEIGHTS[pos]?.defense ?? 0;
      n++;
    }
    if (n === 0 || w <= 0) continue;
    const weight = w / n;
    const row = defenceOf(a);
    for (const t of CHANCE_TYPES) sum[t] += row[t] * weight;
    total += weight;
  }
  const out = {} as Resistance;
  for (const t of CHANCE_TYPES) out[t] = total > 0 ? sum[t] / total : 1;
  return out;
})();

/**
 * How well a player EXECUTES the role his slot was given.
 *
 * The whole of what a Creator-authored role assignment means mechanically, and
 * the one place a role and a player meet. Returns 1 when the slot carries no
 * role (an ordinary tactic), when the player has no derivable archetype, or
 * when he simply IS the role asked for.
 *
 * Note what this is NOT: it is not a rating multiplier and it is not scored
 * against a centred penalty table. It only ever scales how well chances OF THE
 * ROLE'S OWN TYPE are taken — so a mismatch costs exactly what the mismatch
 * actually is (the side is manufacturing chances this player is not built for),
 * and nothing has to be kept artificially zero-sum, because a manager who
 * briefs roles he does not have is not being taxed; he is asking his players to
 * do something they are bad at.
 */
export function executionOf(actual: Archetype | undefined, role: Archetype | undefined): number {
  if (!role || !actual) return 1;
  if (actual.id === role.id) return 1;
  // Same class is the near miss — he is the KIND of player asked for, and does
  // a passable job of the instruction.
  if (actual.cls === role.cls) return EXEC_SAME_CLASS;
  return EXEC_MISMATCH;
}

/** A player who is the wrong KIND entirely takes the role's chances poorly. */
const EXEC_MISMATCH = 0.86;
const EXEC_SAME_CLASS = 0.95;

/** One player as this module needs to see him. */
export interface MixPlayer {
  attrs?: Record<AttrKey, number>;
  slotPos: Pos;
  slotId?: string;
}

/**
 * The chance mix a side manufactures.
 *
 * Each player contributes his role's creation row (or his own archetype's, on
 * an unbriefed tactic), weighted by how much of the attacking phase his slot is
 * responsible for — `PHASE_WEIGHTS`, never a named-position conditional, so a
 * formation that invents a new slot is handled by construction.
 *
 * The result is normalised, which is invariant 1: this decides composition and
 * can never decide volume.
 */
export function sideMix(players: MixPlayer[], tactic: Tactic): ChanceMix {
  const acc: ChanceMix = { through: 0, cross: 0, longshot: 0, box: 0 };
  let total = 0;
  for (const p of players) {
    const w = PHASE_WEIGHTS[p.slotPos]?.attack ?? 0;
    if (w <= 0) continue;
    // The ROLE decides what the slot manufactures — it is the instruction. The
    // player only decides how well it is executed (see `executionOf`).
    const role = roleAt(tactic, p.slotId);
    const arch = role ?? (p.attrs ? deriveArchetype(p.attrs, p.slotPos) : undefined);
    const row = creationOf(arch);
    for (const t of CHANCE_TYPES) acc[t] += row[t] * w;
    total += w;
  }
  if (total <= 0) return NEUTRAL_MIX;
  const out = {} as ChanceMix;
  let sum = 0;
  for (const t of CHANCE_TYPES) sum += acc[t];
  if (sum <= 0) return NEUTRAL_MIX;
  for (const t of CHANCE_TYPES) out[t] = acc[t] / sum;
  return out;
}

/**
 * How well a side takes each type of chance, given who is actually on the pitch.
 *
 * This is where a role mismatch is paid for. The mix says the side is
 * manufacturing long shots because the manager briefed a Sniper; this says the
 * Battering Ram he actually fielded is taking them at 0.86 of a Sniper's rate.
 * Weighted by attacking phase share, so the striker's execution dominates his
 * own slot's contribution rather than being averaged flat across the XI.
 */
export function sideExecution(players: MixPlayer[], tactic: Tactic): number {
  let acc = 0;
  let total = 0;
  for (const p of players) {
    const w = PHASE_WEIGHTS[p.slotPos]?.attack ?? 0;
    if (w <= 0) continue;
    const role = roleAt(tactic, p.slotId);
    if (!role) {
      acc += w;
      total += w;
      continue;
    }
    const actual = p.attrs ? deriveArchetype(p.attrs, p.slotPos) : undefined;
    acc += executionOf(actual, role) * w;
    total += w;
  }
  return total > 0 ? acc / total : 1;
}

/**
 * A side's resistance to each chance type, centred on the measured pivot.
 *
 * Weighted by DEFENSIVE phase share, so the back line and the screening
 * midfield decide this and a winger contributes almost nothing — the mirror of
 * how `sideMix` weights by attack.
 *
 * Returns exactly 1 per type for a side whose defenders are of average shape,
 * which is invariant 2 and the reason `calibrate` is unmoved.
 */
export function sideResistance(players: MixPlayer[]): Resistance {
  const acc: Resistance = { through: 0, cross: 0, longshot: 0, box: 0 };
  let total = 0;
  for (const p of players) {
    const w = PHASE_WEIGHTS[p.slotPos]?.defense ?? 0;
    if (w <= 0) continue;
    const arch = p.attrs ? deriveArchetype(p.attrs, p.slotPos) : undefined;
    const row = defenceOf(arch);
    for (const t of CHANCE_TYPES) acc[t] += row[t] * w;
    total += w;
  }
  const out = {} as Resistance;
  if (total <= 0) {
    for (const t of CHANCE_TYPES) out[t] = 1;
    return out;
  }
  for (const t of CHANCE_TYPES) {
    const mean = acc[t] / total;
    const pivot = RESIST_PIVOT[t] || 1;
    out[t] = mean / pivot;
  }
  return out;
}

/**
 * The shape dials' own contribution to resistance.
 *
 * A deep line kills the ball over the top and invites shots from distance; a
 * narrow shape concedes the flanks and packs the box. These are the same
 * quantities the dials already move elsewhere — stated here per TYPE so the
 * tactical decision and the personnel decision land on one contested number
 * rather than two unrelated ones.
 */
export function shapeResistance(tactic: Tactic): Resistance {
  const line = tactic.line ?? "Standard";
  const width = tactic.width ?? "Standard";
  const out: Resistance = { through: 1, cross: 1, longshot: 1, box: 1 };
  if (line === "Deep") {
    out.through *= 1.14; // no space in behind
    out.longshot *= 0.90; // but they can shoot at you all day
    out.box *= 0.96; // and you defend deep, with bodies in the area
  } else if (line === "High") {
    out.through *= 0.88;
    out.longshot *= 1.08;
  }
  if (width === "Narrow") {
    out.cross *= 0.90; // the flanks are free
    out.box *= 1.08; // but the middle is packed
    out.longshot *= 1.06;
  } else if (width === "Wide") {
    out.cross *= 1.10;
    out.box *= 0.94;
  }
  return out;
}

/** The role assigned to a slot by a Creator-authored tactic, if any. */
export function roleAt(tactic: Tactic, slotId: string | undefined): Archetype | undefined {
  if (!slotId) return undefined;
  const id = tactic.roles?.[slotId];
  return id ? getArchetype(id) : undefined;
}

/** True when this tactic assigns any roles at all — the cheap guard, so an
 * ordinary tactic never pays for the role half of this feature. */
export function hasRoles(tactic: Tactic): boolean {
  const roles = tactic.roles;
  if (!roles) return false;
  for (const _k in roles) return true;
  return false;
}

/**
 * Strip roles naming a slot the formation does not have.
 *
 * A role is keyed by slot id, and slot ids belong to a formation — so changing
 * formation in the Creator would otherwise leave roles attached to slots that
 * no longer exist, which then travel into a saved tactic where they can never
 * be seen or cleared. Same forgiving discipline `loadSavedTactic` applies to a
 * stale player id.
 */
export function pruneRoles(roles: RoleBrief | undefined, formationId: string): RoleBrief | undefined {
  if (!roles) return undefined;
  const slots = new Set(getFormation(formationId).slots.map((s) => s.id));
  const out: RoleBrief = {};
  let kept = 0;
  for (const [slotId, archetypeId] of Object.entries(roles)) {
    if (!slots.has(slotId) || !getArchetype(archetypeId)) continue;
    out[slotId] = archetypeId;
    kept++;
  }
  return kept > 0 ? out : undefined;
}

/**
 * Roll which type a chance is, from a normalised mix.
 *
 * Takes the RNG the match is already running on, so this is as deterministic as
 * everything else in the engine (the v2.0 rule).
 */
export function rollChanceType(r: number, mix: ChanceMix): ChanceType {
  let acc = 0;
  for (const t of CHANCE_TYPES) {
    acc += mix[t];
    if (r < acc) return t;
  }
  return "box";
}

/**
 * What a chance of this type is worth against this defence — the number the
 * engine multiplies into its goal probability.
 *
 * Bounded, because an unbounded product of personnel and shape could in
 * principle stack two extremes into something that decides matches on its own.
 * The bound is generous enough never to bind on an ordinary side and exists to
 * make the worst case knowable rather than to shape the common one.
 */
export function typeConversionMult(
  type: ChanceType,
  personnel: Resistance,
  shape: Resistance,
  swing: number
): number {
  const resist = personnel[type] * shape[type];
  // resist > 1 means this defence is better than average at this type, so the
  // chance is worth less. Scaled by `swing` so the whole feature has one dial.
  const raw = 1 - (resist - 1) * swing;
  return Math.max(1 - CONVERSION_BOUND, Math.min(1 + CONVERSION_BOUND, raw));
}

const CONVERSION_BOUND = 0.35;

/**
 * A human-readable read of a side's mix — what the Tactics screen prints so a
 * manager can see what his side is actually built to do.
 *
 * Derived from the same functions the engine calls, so the screen can never
 * claim something the simulation will not do (the standing rule).
 */
export const CHANCE_TYPE_LABEL: Record<ChanceType, string> = {
  through: "Through balls",
  cross: "Crosses",
  longshot: "Long shots",
  box: "Box play",
};

export const CHANCE_TYPE_BLURB: Record<ChanceType, string> = {
  through: "Runs in behind. Punishes a high line; smothered by a deep block.",
  cross: "Deliveries from wide. Beaten by tall centre backs and a narrow shape.",
  longshot: "Efforts from distance. Screened by a holding midfielder.",
  box: "Work in the area. Contested by physical, aerial defenders.",
};

// ── Archetype table (GAME_DESIGN.md §5) ───────────────────────────────────
// The archetype roster, reworked to the owner's final list (archetypes_modified.csv).
// It is PURE DATA: position weights, per-style synergies, event weightings,
// flavor tags. The engine reads this table and never special-cases any archetype
// by name. Swapping this file (or a mod file with the same shape) changes the
// game, not the code.
//
// Style synergies are authored PER STYLE now (v1.54), not derived from three core
// styles. Each archetype declares a bonus for all six styles — the CSV's
// percentages, straight through: +20% → ×1.20, -10% → ×0.90. The design range is
// +20% to -10%, and the engine's `synergyCap` (tuning) is set to 0.20 so nothing
// authored inside that band is clipped. Getting the right archetype into the
// right tactic is worth up to +20%; the wrong one costs up to -10%.

import type { Pos, Style, Attributes } from "../types";

export interface Archetype {
  id: string;
  name: string;
  positions: Pos[];
  /** One-line player-facing summary of what the archetype does on the pitch. */
  desc: string;
  /** Per-style multipliers; engine clamps each to 1 ± tuning.synergyCap. */
  styleSynergy: Record<Style, number>;
  /** Relative chance of being the scorer / assister on a goal (engine-normalized). */
  scorerWeight: number;
  assistWeight: number;
  /** 0..1 — pace-reliant archetypes decline earlier/harder (§5 aging). */
  paceReliance: number;
  /** Attribute profile: relative emphasis used to derive the six attrs from overall. */
  attrProfile: Attributes;
  /** Flavor templates for goals: {p}=player, {a}=assister, {t}=team. */
  goalFlavor: string[];
  /** Typical adult height band in cm (v15): [mean, standard deviation]. Pure
   * flavour — nothing in the engine reads height — but it's what makes a Target
   * Man read as a Target Man. Optional so a mod file can omit it. */
  heightCm?: [number, number];
}

/** Fallback height band for any archetype that doesn't declare one. */
export const DEFAULT_HEIGHT_CM: [number, number] = [180, 6];

/** A per-style synergy row, authored as percentage BONUSES in the CSV's column
 * order — Possession, Counter, Direct, Gegenpress, Park the Bus, Wing Play.
 * `pct(20)` → ×1.20; `pct(-10)` → ×0.90. A whole archetype's row is six of these. */
type StyleRow = [number, number, number, number, number, number];

/** Turn a percentage-bonus row into the six-key synergy record the engine reads. */
function synergy([pos, cnt, dir, geg, ptb, wing]: StyleRow): Record<Style, number> {
  const m = (p: number) => 1 + p / 100;
  return {
    Possession: m(pos),
    Counter: m(cnt),
    Direct: m(dir),
    Gegenpress: m(geg),
    ParkTheBus: m(ptb),
    WingPlay: m(wing),
  };
}

const A = (
  id: string, name: string, positions: Pos[], desc: string,
  row: StyleRow,
  scorerWeight: number, assistWeight: number, paceReliance: number,
  attrProfile: Attributes, goalFlavor: string[]
): Archetype => ({ id, name, positions, desc, styleSynergy: synergy(row), scorerWeight, assistWeight, paceReliance, attrProfile, goalFlavor });

export const ARCHETYPES: Archetype[] = [
  // ── Goalkeepers ──────────────────────────────────────────────────────────
  A("shot_stopper", "Shot Stopper", ["GK"],
    "A reflex specialist who lives on his line and thrives on point-blank saves.",
    [0, 10, -5, 0, 10, 0], 0.01, 0.01, 0.1,
    { pac: 0.5, sho: 0.3, pas: 0.6, dri: 0.4, def: 1.0, phy: 0.9 },
    ["{p} scores?! A goalkeeper on the scoresheet!"]),
  A("sweeper_keeper", "Sweeper Keeper", ["GK"],
    "A modern keeper who patrols the space behind the defence and starts attacks with the ball at his feet.",
    [15, -5, 0, 15, -5, 0], 0.01, 0.05, 0.3,
    { pac: 0.7, sho: 0.3, pas: 0.9, dri: 0.6, def: 0.95, phy: 0.8 },
    ["{p} scores?! Incredible scenes!"]),
  A("ball_playing_keeper", "Ball-Playing Keeper", ["GK"],
    "A keeper picked as much for his feet as his hands — comfortable as an eleventh outfielder in the build-up.",
    [15, 0, 15, 10, -5, 0], 0.01, 0.06, 0.25,
    { pac: 0.6, sho: 0.3, pas: 1.0, dri: 0.7, def: 0.9, phy: 0.8 },
    ["{p} launches it upfield — and it ends up in the net! What a start!"]),
  A("commanding_keeper", "Commanding Keeper", ["GK"],
    "A vocal presence who dominates his box, claims every cross, and organises the men in front of him.",
    [0, 10, 10, 0, 10, 10], 0.01, 0.02, 0.15,
    { pac: 0.55, sho: 0.3, pas: 0.7, dri: 0.45, def: 1.0, phy: 1.0 },
    ["{p} comes up for the corner — and scores! Unbelievable!"]),
  A("distributor", "Distributor", ["GK"],
    "A keeper who turns defence into attack in one throw or one pass — his release starts the break.",
    [10, 15, 15, 0, 0, 10], 0.01, 0.08, 0.2,
    { pac: 0.6, sho: 0.3, pas: 1.0, dri: 0.6, def: 0.9, phy: 0.8 },
    ["{p} lands a pass on a sixpence — and the move he began finishes in the net!"]),

  // ── Centre backs ─────────────────────────────────────────────────────────
  A("stopper", "Stopper", ["CB"],
    "An old-school defender who wins his headers, throws his body in the way, and is a threat at set pieces.",
    [-5, 10, 10, 0, 10, 0], 0.35, 0.1, 0.2,
    { pac: 0.55, sho: 0.3, pas: 0.5, dri: 0.4, def: 1.0, phy: 1.0 },
    ["{p} rises highest at the corner and thumps a header in!",
     "A goalmouth scramble — {p} bundles it over the line!"]),
  A("ball_playing_def", "Ball-Playing Defender", ["CB"],
    "A composed centre back who steps out of the back line and passes his team up the pitch.",
    [15, 0, 10, 10, -5, 10], 0.25, 0.25, 0.25,
    { pac: 0.6, sho: 0.3, pas: 0.85, dri: 0.65, def: 1.0, phy: 0.85 },
    ["{p} strides out of defense and finishes the move he started!"]),
  A("libero", "Libero", ["CB", "DM"],
    "A free defender who steps into midfield with the ball and dictates play from the back.",
    [20, -5, 0, 15, -5, 10], 0.3, 0.45, 0.3,
    { pac: 0.65, sho: 0.4, pas: 0.95, dri: 0.8, def: 0.95, phy: 0.8 },
    ["{p} carries it out of defence and lashes it home!",
     "The libero {p} arrives in the box like a forward!"]),
  A("no_nonsense_def", "No-Nonsense Defender", ["CB"],
    "Row Z is a valid pass. Wins everything in the air and clears his lines without a second thought.",
    [-5, 10, 15, 0, 15, 0], 0.3, 0.05, 0.15,
    { pac: 0.5, sho: 0.25, pas: 0.35, dri: 0.3, def: 1.0, phy: 1.0 },
    ["{p} bullets a header in from the set piece!"]),

  // ── Full backs (shared across left & right) ──────────────────────────────
  A("wing_back", "Attacking Wing-Back", ["LB", "RB"],
    "A relentless flank runner who overlaps to supply crosses and joins the attack as an extra winger.",
    [10, 10, 0, 15, -5, 15], 0.4, 0.9, 0.75,
    { pac: 0.95, sho: 0.45, pas: 0.8, dri: 0.8, def: 0.7, phy: 0.75 },
    ["{p} arrives late at the far post to turn it in!"]),
  A("def_fullback", "Defensive Full Back", ["LB", "RB"],
    "A disciplined defender first: stays home, locks down the flank, and rarely gets caught upfield.",
    [-5, 10, 10, 0, 10, 0], 0.15, 0.4, 0.5,
    { pac: 0.75, sho: 0.3, pas: 0.6, dri: 0.55, def: 0.95, phy: 0.85 },
    ["{p} of all people smashes one in from distance!"]),
  A("inverted_fullback", "Inverted Full-Back", ["LB", "RB"],
    "Tucks into midfield in possession, giving his side an extra body to build through the middle.",
    [20, -5, 0, 10, 0, -5], 0.25, 0.75, 0.5,
    { pac: 0.8, sho: 0.4, pas: 0.9, dri: 0.75, def: 0.8, phy: 0.75 },
    ["{p} drifts inside and curls one in from the edge of the box!"]),
  A("complete_wingback", "Complete Wing-Back", ["LB", "RB"],
    "The complete flank player — defends his line, bombs forward, crosses and finishes. No weak phase.",
    [10, 10, 10, 10, 0, 10], 0.45, 0.95, 0.7,
    { pac: 0.95, sho: 0.5, pas: 0.85, dri: 0.85, def: 0.8, phy: 0.8 },
    ["{p} completes the overlap and finishes it himself!",
     "Box to box down the flank from {p} — and he's there at the end of it!"]),

  // ── Defensive mids ───────────────────────────────────────────────────────
  A("anchor", "Anchor", ["DM"],
    "A screen in front of the back four who breaks up play and shields the defence.",
    [0, 15, 0, 10, 15, 0], 0.2, 0.35, 0.25,
    { pac: 0.6, sho: 0.4, pas: 0.75, dri: 0.6, def: 0.95, phy: 0.95 },
    ["{p} lets fly from 25 yards — what a hit!"]),
  A("deep_playmaker", "Deep-Lying Playmaker", ["DM", "CM"],
    "A metronome who sits deep and dictates tempo, spraying passes to launch every attack.",
    [15, 0, 10, 0, -5, 0], 0.25, 1.1, 0.2,
    { pac: 0.55, sho: 0.55, pas: 1.0, dri: 0.8, def: 0.7, phy: 0.7 },
    ["{p} caps a sweeping move he orchestrated himself!"]),
  A("ball_winner", "Ball-Winning Midfielder", ["DM", "CM"],
    "A destroyer who hunts the ball down, snaps into tackles, and never stops running.",
    [-5, 10, 0, 10, 10, 0], 0.25, 0.4, 0.4,
    { pac: 0.75, sho: 0.45, pas: 0.65, dri: 0.6, def: 0.95, phy: 0.95 },
    ["{p} wins it high up the pitch and finishes the job himself!"]),
  A("box_crasher", "Box Crasher", ["DM", "CM"],
    "A late-arriving midfield runner who breaks from deep and crashes the box unmarked.",
    [0, 15, 10, 15, -5, 10], 0.9, 0.5, 0.55,
    { pac: 0.85, sho: 0.8, pas: 0.7, dri: 0.75, def: 0.6, phy: 0.85 },
    ["{p} times his run to perfection and smashes it in!",
     "Nobody tracked {p} from deep — and he makes them pay!"]),

  // ── Central mids ─────────────────────────────────────────────────────────
  A("box_to_box", "Box-to-Box", ["CM", "LM", "RM"],
    "An engine who covers the whole pitch — defending one box, arriving late in the other.",
    [10, 10, 10, 10, 0, 10], 0.8, 0.8, 0.5,
    { pac: 0.75, sho: 0.7, pas: 0.8, dri: 0.75, def: 0.7, phy: 0.9 },
    ["{p} storms into the box and buries it!",
     "End to end from {p} — started it in his own half, finishes it in theirs!"]),
  A("playmaker", "Playmaker", ["CM", "AM"],
    "The creative hub who sees the pass no one else does and turns possession into chances.",
    [15, -5, 0, 0, -5, 10], 0.6, 1.4, 0.3,
    { pac: 0.6, sho: 0.65, pas: 1.0, dri: 0.9, def: 0.4, phy: 0.55 },
    ["{p} threads through a crowd and passes it into the net!",
     "A moment of pure vision from {p}!"]),
  A("mezzala", "Mezzala", ["CM"],
    "A wide-roaming central midfielder who drifts into the half-space and arrives in the box unmarked.",
    [15, 0, 0, 10, -5, 15], 1.0, 1.0, 0.55,
    { pac: 0.8, sho: 0.75, pas: 0.85, dri: 0.9, def: 0.5, phy: 0.7 },
    ["{p} ghosts into the half-space and finishes with the outside of his boot!"]),
  A("regista", "Regista", ["DM", "CM"],
    "The deepest creator — dictates the game's rhythm and picks defences apart from in front of the back line.",
    [20, -5, 10, 0, -5, 0], 0.3, 1.25, 0.15,
    { pac: 0.5, sho: 0.6, pas: 1.0, dri: 0.8, def: 0.6, phy: 0.6 },
    ["{p} steps forward and bends one in from 30 yards!"]),
  A("carrilero", "Carrilero", ["CM"],
    "A shuttling midfielder who covers the channel — links defence and attack and does the unseen running.",
    [10, 10, 0, 10, 10, 15], 0.5, 0.7, 0.5,
    { pac: 0.8, sho: 0.55, pas: 0.85, dri: 0.8, def: 0.8, phy: 0.85 },
    ["{p} pops up in the channel and slots it home!"]),

  // ── Attacking mids ───────────────────────────────────────────────────────
  A("shadow_striker", "Shadow Striker", ["AM", "ST"],
    "A goal-hungry playmaker who runs off the striker and ghosts into the box to finish.",
    [0, 15, 10, 10, 10, 0], 1.4, 0.7, 0.6,
    { pac: 0.8, sho: 0.9, pas: 0.7, dri: 0.85, def: 0.25, phy: 0.6 },
    ["{p} ghosts in behind the striker and slots home!",
     "Nobody picked up {p} — clinical!"]),
  A("classic_ten", "Classic 10", ["AM"],
    "A pure number 10 who plays with the ball at his feet and the game on a string — flair over graft.",
    [20, -5, -5, -5, -5, 0], 0.85, 1.5, 0.3,
    { pac: 0.6, sho: 0.75, pas: 1.0, dri: 0.95, def: 0.2, phy: 0.45 },
    ["{p} produces a piece of magic and finishes it off himself!"]),
  A("adv_playmaker", "Advanced Playmaker", ["AM"],
    "A number 10 who operates between the lines and unlocks defences with the final ball.",
    [15, 0, 0, 10, -5, 10], 0.9, 1.5, 0.4,
    { pac: 0.7, sho: 0.75, pas: 1.0, dri: 0.95, def: 0.3, phy: 0.5 },
    ["{p} finds a pocket of space and curls one into the corner!"]),
  A("trequartista", "Trequartista", ["AM"],
    "A free-roaming artist with no defensive duties — pure invention between the lines.",
    [20, 0, 0, -5, -5, 10], 1.0, 1.55, 0.35,
    { pac: 0.7, sho: 0.8, pas: 1.0, dri: 1.0, def: 0.15, phy: 0.45 },
    ["A flash of genius from {p} — nobody else saw that!",
     "{p} dinks it over the keeper with the outside of his foot!"]),
  A("half_winger", "Half Winger", ["AM"],
    "A wide-drifting attacking mid who plays between the number 10 and the touchline — a winger's threat from an inside start.",
    [10, 10, 0, 10, 0, 15], 1.1, 1.1, 0.6,
    { pac: 0.85, sho: 0.8, pas: 0.85, dri: 0.95, def: 0.25, phy: 0.55 },
    ["{p} drifts wide, cuts back in and finishes across the keeper!"]),
  A("enganche", "Enganche", ["AM"],
    "The hook — a static, deep-lying playmaker the whole attack is built around. Everything goes through him.",
    [20, -5, -5, -5, -5, 0], 0.75, 1.6, 0.2,
    { pac: 0.5, sho: 0.7, pas: 1.0, dri: 0.9, def: 0.2, phy: 0.5 },
    ["{p} stands it up on a plate — then arrives to finish the next one himself!"]),

  // ── Wingers (shared across left & right) ─────────────────────────────────
  A("speed_winger", "Speed Winger", ["LW", "RW", "LM", "RM"],
    "A flyer who beats his marker on the outside with raw pace and whips the ball across goal.",
    [0, 15, 10, 10, -5, 15], 1.1, 1.1, 0.95,
    { pac: 1.0, sho: 0.7, pas: 0.7, dri: 0.95, def: 0.2, phy: 0.55 },
    ["{p} burns past his man and fires across the keeper!",
     "Pure pace from {p} — in behind and it's a goal!"]),
  A("inverted_winger", "Inverted Winger", ["LW", "RW"],
    "A wide forward who cuts inside onto his stronger foot to shoot, defending from a flank but attacking centrally.",
    [15, 10, 0, 10, -5, 10], 1.3, 0.9, 0.7,
    { pac: 0.85, sho: 0.9, pas: 0.75, dri: 1.0, def: 0.2, phy: 0.5 },
    ["{p} cuts inside onto his stronger foot — top corner!",
     "{p} whips it into the far side netting!"]),
  A("raumdeuter", "Raumdeuter", ["RW", "LW"],
    "An instinctive space-interpreter who plays off the shoulder of the last man and arrives at the back post.",
    [10, 20, 0, 10, 0, 0], 1.5, 0.7, 0.6,
    { pac: 0.85, sho: 0.95, pas: 0.6, dri: 0.75, def: 0.2, phy: 0.6 },
    ["{p} is completely unmarked at the back post — tap-in!",
     "Nobody tracked the run of {p} — and he makes them pay!"]),
  A("classic_winger", "Classic Winger", ["LW", "RW", "LM", "RM"],
    "A touchline-hugging traditionalist who beats his man to the byline and whips in crosses all afternoon.",
    [0, 10, 15, 0, 0, 15], 0.75, 1.5, 0.8,
    { pac: 0.95, sho: 0.6, pas: 0.85, dri: 0.95, def: 0.25, phy: 0.6 },
    ["{p} beats his man and finishes at the near post!"]),
  A("wide_playmaker", "Wide Playmaker", ["LW", "RW"],
    "A creator stationed wide who drifts inside to dictate — the team's chief supplier from a flank start.",
    [15, 0, -5, 10, -5, 10], 0.85, 1.5, 0.55,
    { pac: 0.8, sho: 0.65, pas: 1.0, dri: 0.95, def: 0.25, phy: 0.5 },
    ["{p} drifts in off the flank and threads it home!"]),

  // ── Strikers ─────────────────────────────────────────────────────────────
  A("poacher", "Poacher", ["ST"],
    "A pure finisher who lives in the box, reads the rebound, and needs one chance to score.",
    [0, 15, 10, 0, 0, 10], 2.2, 0.3, 0.55,
    { pac: 0.85, sho: 1.0, pas: 0.5, dri: 0.75, def: 0.15, phy: 0.65 },
    ["Tap-in for {p}! Right place, right time as always.",
     "{p} reacts first to the rebound — that's what he's there for!",
     "The flag stays down and {p} finishes one-on-one!"]),
  A("target_man", "Target Man", ["ST"],
    "A physical focal point who holds the ball up, wins aerial duels, and finishes with his head.",
    [-5, 10, 20, -5, 10, 15], 1.8, 0.6, 0.2,
    { pac: 0.55, sho: 0.9, pas: 0.55, dri: 0.55, def: 0.35, phy: 1.0 },
    ["{p} climbs above everyone and powers a header home!",
     "Long ball, chest down, swivel, finish — {p} at his best!"]),
  A("complete_forward", "Complete Forward", ["ST"],
    "A do-it-all striker who links play, drives forward, and finishes with either foot or his head.",
    [10, 10, 10, 10, 0, 10], 1.9, 0.8, 0.5,
    { pac: 0.85, sho: 1.0, pas: 0.75, dri: 0.9, def: 0.2, phy: 0.85 },
    ["{p} does it all himself — dropped deep, drove forward, finished!",
     "Unstoppable from {p}!"]),
  A("pressing_forward", "Pressing Forward", ["ST"],
    "The first line of defence — harries centre backs relentlessly and feeds on the mistakes he forces.",
    [0, 10, 0, 15, -5, 0], 1.6, 0.7, 0.7,
    { pac: 0.9, sho: 0.85, pas: 0.6, dri: 0.75, def: 0.45, phy: 0.9 },
    ["{p} closes down the keeper, wins it, and rolls it in!",
     "Relentless from {p} — he forced that mistake himself!"]),
  A("false_nine", "False Nine", ["ST", "AM"],
    "A striker who drops off the front line, drags centre backs out of position, and creates the space he then exploits.",
    [20, -5, -5, 10, -5, 0], 1.4, 1.3, 0.4,
    { pac: 0.75, sho: 0.85, pas: 0.95, dri: 0.95, def: 0.2, phy: 0.55 },
    ["{p} drops deep, turns, and finishes from the edge of the box!"]),
  A("advanced_forward", "Advanced Forward", ["ST"],
    "A relentless spearhead who plays on the last shoulder, runs in behind and lives to score.",
    [10, 15, 10, 10, -5, 0], 2.0, 0.5, 0.8,
    { pac: 0.95, sho: 1.0, pas: 0.6, dri: 0.85, def: 0.15, phy: 0.7 },
    ["{p} runs in behind and finishes with ease!",
     "In behind again — {p} is too quick for them and buries it!"]),
];

// Height bands per archetype (v15), applied onto the table above so the `A()`
// signature stays readable. Keepers and target men are the tall end; wingers,
// poachers and playmakers the short end — the same spread real squads show.
const HEIGHT_BANDS: Record<string, [number, number]> = {
  // Goalkeepers
  shot_stopper: [191, 4],
  sweeper_keeper: [189, 4],
  ball_playing_keeper: [190, 4],
  commanding_keeper: [193, 4],
  distributor: [190, 4],
  // Centre backs
  stopper: [190, 4],
  ball_playing_def: [186, 4],
  libero: [186, 4],
  no_nonsense_def: [192, 4],
  // Full backs
  wing_back: [178, 5],
  def_fullback: [180, 5],
  inverted_fullback: [179, 5],
  complete_wingback: [180, 5],
  // Defensive / central midfield
  anchor: [185, 5],
  deep_playmaker: [180, 5],
  ball_winner: [181, 5],
  box_crasher: [183, 5],
  box_to_box: [182, 5],
  playmaker: [177, 5],
  mezzala: [180, 5],
  regista: [178, 5],
  carrilero: [180, 5],
  // Attacking midfield
  shadow_striker: [177, 5],
  classic_ten: [175, 5],
  adv_playmaker: [175, 5],
  trequartista: [174, 5],
  half_winger: [176, 5],
  enganche: [176, 5],
  // Wingers
  speed_winger: [174, 5],
  inverted_winger: [176, 5],
  raumdeuter: [180, 5],
  classic_winger: [176, 5],
  wide_playmaker: [176, 5],
  // Strikers
  poacher: [179, 5],
  target_man: [191, 4],
  complete_forward: [185, 5],
  pressing_forward: [183, 5],
  false_nine: [178, 5],
  advanced_forward: [182, 5],
};

for (const a of ARCHETYPES) {
  a.heightCm = HEIGHT_BANDS[a.id] ?? DEFAULT_HEIGHT_CM;
}

export const ARCHETYPE_MAP: Record<string, Archetype> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a])
);

export function archetypesForPosition(pos: Pos): Archetype[] {
  return ARCHETYPES.filter((a) => a.positions[0] === pos || a.positions.includes(pos));
}

export function getArchetype(id: string): Archetype {
  return ARCHETYPE_MAP[id] ?? ARCHETYPES[0];
}

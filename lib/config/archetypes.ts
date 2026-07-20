// ── Archetype table (GAME_DESIGN.md §5) ───────────────────────────────────
// [OPEN] The final roster is being designed by the owner. This is the interim
// placeholder set the design doc explicitly allows. It is PURE DATA: position
// weights, style synergies, event weightings, flavor tags. The engine reads
// this table and never special-cases any archetype by name. Swapping this
// file (or a mod file with the same shape) changes the game, not the code.

import type { Pos, Style, Attributes } from "../types";

export interface Archetype {
  id: string;
  name: string;
  positions: Pos[];
  /** One-line player-facing summary of what the archetype does on the pitch. */
  desc: string;
  /** Raw style multipliers; engine clamps the combined synergy to ±tuning.synergyCap. */
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

const A = (
  id: string, name: string, positions: Pos[], desc: string,
  styleSynergy: Record<Style, number>,
  scorerWeight: number, assistWeight: number, paceReliance: number,
  attrProfile: Attributes, goalFlavor: string[]
): Archetype => ({ id, name, positions, desc, styleSynergy, scorerWeight, assistWeight, paceReliance, attrProfile, goalFlavor });

export const ARCHETYPES: Archetype[] = [
  // ── Goalkeepers ──
  A("shot_stopper", "Shot Stopper", ["GK"],
    "A reflex specialist who lives on his line and thrives on point-blank saves.",
    { Possession: 0.98, Counter: 1.02, Direct: 1.0 }, 0.01, 0.01, 0.1,
    { pac: 0.5, sho: 0.3, pas: 0.6, dri: 0.4, def: 1.0, phy: 0.9 },
    ["{p} scores?! A goalkeeper on the scoresheet!"]),
  A("sweeper_keeper", "Sweeper Keeper", ["GK"],
    "A modern keeper who patrols the space behind the defence and starts attacks with the ball at his feet.",
    { Possession: 1.05, Counter: 1.0, Direct: 0.96 }, 0.01, 0.05, 0.3,
    { pac: 0.7, sho: 0.3, pas: 0.9, dri: 0.6, def: 0.95, phy: 0.8 },
    ["{p} scores?! Incredible scenes!"]),

  // ── Centre backs ──
  A("stopper", "Stopper", ["CB"],
    "An old-school defender who wins his headers, throws his body in the way, and is a threat at set pieces.",
    { Possession: 0.96, Counter: 1.03, Direct: 1.04 }, 0.35, 0.1, 0.2,
    { pac: 0.55, sho: 0.3, pas: 0.5, dri: 0.4, def: 1.0, phy: 1.0 },
    ["{p} rises highest at the corner and thumps a header in!",
     "A goalmouth scramble — {p} bundles it over the line!"]),
  A("ball_playing_def", "Ball-Playing Defender", ["CB"],
    "A composed centre back who steps out of the back line and passes his team up the pitch.",
    { Possession: 1.06, Counter: 1.0, Direct: 0.95 }, 0.25, 0.25, 0.25,
    { pac: 0.6, sho: 0.3, pas: 0.85, dri: 0.65, def: 1.0, phy: 0.85 },
    ["{p} strides out of defense and finishes the move he started!"]),

  // ── Full backs (shared across left & right) ──
  A("wing_back", "Attacking Wing-Back", ["LB", "RB"],
    "A relentless flank runner who overlaps to supply crosses and joins the attack as an extra winger.",
    { Possession: 1.03, Counter: 1.05, Direct: 0.98 }, 0.4, 0.9, 0.75,
    { pac: 0.95, sho: 0.45, pas: 0.8, dri: 0.8, def: 0.7, phy: 0.75 },
    ["{p} arrives late at the far post to turn it in!"]),
  A("def_fullback", "Defensive Full Back", ["LB", "RB"],
    "A disciplined defender first: stays home, locks down the flank, and rarely gets caught upfield.",
    { Possession: 0.98, Counter: 1.02, Direct: 1.02 }, 0.15, 0.4, 0.5,
    { pac: 0.75, sho: 0.3, pas: 0.6, dri: 0.55, def: 0.95, phy: 0.85 },
    ["{p} of all people smashes one in from distance!"]),

  // ── Defensive mids ──
  A("anchor", "Anchor", ["DM"],
    "A screen in front of the back four who breaks up play and shields the defence.",
    { Possession: 1.0, Counter: 1.03, Direct: 1.02 }, 0.2, 0.35, 0.25,
    { pac: 0.6, sho: 0.4, pas: 0.75, dri: 0.6, def: 0.95, phy: 0.95 },
    ["{p} lets fly from 25 yards — what a hit!"]),
  A("deep_playmaker", "Deep-Lying Playmaker", ["DM", "CM"],
    "A metronome who sits deep and dictates tempo, spraying passes to launch every attack.",
    { Possession: 1.08, Counter: 0.98, Direct: 0.94 }, 0.25, 1.1, 0.2,
    { pac: 0.55, sho: 0.55, pas: 1.0, dri: 0.8, def: 0.7, phy: 0.7 },
    ["{p} caps a sweeping move he orchestrated himself!"]),

  // ── Central mids ──
  A("box_to_box", "Box-to-Box", ["CM"],
    "An engine who covers the whole pitch — defending one box, arriving late in the other.",
    { Possession: 1.0, Counter: 1.04, Direct: 1.03 }, 0.8, 0.8, 0.5,
    { pac: 0.75, sho: 0.7, pas: 0.8, dri: 0.75, def: 0.7, phy: 0.9 },
    ["{p} storms into the box and buries it!",
     "End to end from {p} — started it in his own half, finishes it in theirs!"]),
  A("playmaker", "Playmaker", ["CM", "AM"],
    "The creative hub who sees the pass no one else does and turns possession into chances.",
    { Possession: 1.09, Counter: 0.97, Direct: 0.93 }, 0.6, 1.4, 0.3,
    { pac: 0.6, sho: 0.65, pas: 1.0, dri: 0.9, def: 0.4, phy: 0.55 },
    ["{p} threads through a crowd and passes it into the net!",
     "A moment of pure vision from {p}!"]),

  // ── Attacking mids ──
  A("adv_playmaker", "Advanced Playmaker", ["AM"],
    "A number 10 who operates between the lines and unlocks defences with the final ball.",
    { Possession: 1.08, Counter: 1.0, Direct: 0.94 }, 0.9, 1.5, 0.4,
    { pac: 0.7, sho: 0.75, pas: 1.0, dri: 0.95, def: 0.3, phy: 0.5 },
    ["{p} finds a pocket of space and curls one into the corner!"]),
  A("shadow_striker", "Shadow Striker", ["AM", "ST"],
    "A goal-hungry playmaker who runs off the striker and ghosts into the box to finish.",
    { Possession: 1.0, Counter: 1.07, Direct: 1.0 }, 1.4, 0.7, 0.6,
    { pac: 0.8, sho: 0.9, pas: 0.7, dri: 0.85, def: 0.25, phy: 0.6 },
    ["{p} ghosts in behind the striker and slots home!",
     "Nobody picked up {p} — clinical!"]),

  // ── Wingers (shared across left & right) ──
  A("speed_winger", "Speed Winger", ["LW", "RW"],
    "A flyer who beats his marker on the outside with raw pace and whips the ball across goal.",
    { Possession: 0.96, Counter: 1.09, Direct: 1.03 }, 1.1, 1.1, 0.95,
    { pac: 1.0, sho: 0.7, pas: 0.7, dri: 0.95, def: 0.2, phy: 0.55 },
    ["{p} burns past his man and fires across the keeper!",
     "Pure pace from {p} — in behind and it's a goal!"]),
  A("inverted_winger", "Inverted Winger", ["LW", "RW"],
    "A wide forward who cuts inside onto his stronger foot to shoot, defending from a flank but attacking centrally.",
    { Possession: 1.05, Counter: 1.03, Direct: 0.96 }, 1.3, 0.9, 0.7,
    { pac: 0.85, sho: 0.9, pas: 0.75, dri: 1.0, def: 0.2, phy: 0.5 },
    ["{p} cuts inside onto his stronger foot — top corner!",
     "{p} whips it into the far side netting!"]),

  // ── Strikers ──
  A("poacher", "Poacher", ["ST"],
    "A pure finisher who lives in the box, reads the rebound, and needs one chance to score.",
    { Possession: 1.0, Counter: 1.06, Direct: 1.02 }, 2.2, 0.3, 0.55,
    { pac: 0.85, sho: 1.0, pas: 0.5, dri: 0.75, def: 0.15, phy: 0.65 },
    ["Tap-in for {p}! Right place, right time as always.",
     "{p} reacts first to the rebound — that's what he's there for!",
     "The flag stays down and {p} finishes one-on-one!"]),
  A("target_man", "Target Man", ["ST"],
    "A physical focal point who holds the ball up, wins aerial duels, and finishes with his head.",
    { Possession: 0.95, Counter: 1.0, Direct: 1.09 }, 1.8, 0.6, 0.2,
    { pac: 0.55, sho: 0.9, pas: 0.55, dri: 0.55, def: 0.35, phy: 1.0 },
    ["{p} climbs above everyone and powers a header home!",
     "Long ball, chest down, swivel, finish — {p} at his best!"]),
  A("complete_forward", "Complete Forward", ["ST"],
    "A do-it-all striker who links play, drives forward, and finishes with either foot or his head.",
    { Possession: 1.04, Counter: 1.04, Direct: 1.02 }, 1.9, 0.8, 0.5,
    { pac: 0.85, sho: 1.0, pas: 0.75, dri: 0.9, def: 0.2, phy: 0.85 },
    ["{p} does it all himself — dropped deep, drove forward, finished!",
     "Unstoppable from {p}!"]),
];

// Height bands per archetype (v15), applied onto the table above so the `A()`
// signature stays readable. Keepers and target men are the tall end; wingers,
// poachers and playmakers the short end — the same spread real squads show.
const HEIGHT_BANDS: Record<string, [number, number]> = {
  shot_stopper: [191, 4],
  sweeper_keeper: [189, 4],
  stopper: [190, 4],
  ball_playing_def: [186, 4],
  wing_back: [178, 5],
  def_fullback: [180, 5],
  anchor: [185, 5],
  deep_playmaker: [180, 5],
  box_to_box: [182, 5],
  playmaker: [177, 5],
  adv_playmaker: [175, 5],
  shadow_striker: [177, 5],
  speed_winger: [174, 5],
  inverted_winger: [176, 5],
  poacher: [179, 5],
  target_man: [191, 4],
  complete_forward: [185, 5],
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

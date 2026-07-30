// Preset formations only (GAME_DESIGN.md §6). Each slot has a pitch position
// for the tactics screen (x: 0-100 left→right, y: 0-100 own goal→opp goal).
//
// SLOT LABELS USE REAL POSITIONS ONLY (Pos in types.ts). LM/RM are now
// first-class positions, so the deep wide slots in two-banks-of-four shapes are
// genuine LM/RM (a wide midfielder who tracks back), distinct from the higher
// LW/RW in a front three. There is still no LWB/RWB slot label: a wing-back is
// an LB/RB pushed high, expressed through the player (the "Attacking Wing-Back"
// archetype and the training plans), not a distinct slot. Showing a label that
// isn't a Pos was misleading: it implied a distinct slot the engine doesn't
// model, so a player could look "out of position" in a role he in fact filled.
//
// The engine only ever reads `pos`; `label` is display text and MUST equal the
// slot's `pos` so the two can never drift apart again.

import type { Mentality, Pos, Style } from "../types";

// ── Tactic option lists (v19) ─────────────────────────────────────────────
// The canonical option sets and display names, so no screen re-declares them
// (the Tactics screen and the half-time team talk both read these).

export const MENTALITY_OPTIONS: Mentality[] = ["Defensive", "Balanced", "Attacking"];

export const STYLE_OPTIONS: Style[] = [
  "Possession",
  "Counter",
  "Direct",
  "Gegenpress",
  "ParkTheBus",
  "WingPlay",
];

/** Display names for styles whose ids aren't presentable as-is. */
const STYLE_LABEL: Partial<Record<Style, string>> = {
  ParkTheBus: "Park the Bus",
  WingPlay: "Wing Play",
};

export function styleLabel(s: string): string {
  return STYLE_LABEL[s as Style] ?? s;
}

export interface FormationSlot {
  id: string;
  pos: Pos;
  /** Display text. Always the slot's own `pos` — see the note above. */
  label: Pos;
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  name: string;
  slots: FormationSlot[];
  /** One-line shape note shown next to the formation picker. */
  desc: string;
  /**
   * Which family this shape belongs to in the picker (v1.69). Purely a display
   * grouping — the engine never reads it. Formations that are the same shape with
   * a different midfield share a family, so the picker can show one button per
   * shape with the variants beside it instead of thirty flat buttons.
   */
  family?: string;
  /** Short variant label within a family (e.g. "1 DM · 2 CM"). Display only. */
  variant?: string;
  /**
   * How often an AI club may be seeded into this shape (v1.69). Defaults to 1.
   *
   * This is a league-composition control, not a balance number, which is why it
   * lives here rather than in tuning. With twenty-two shapes on the table an
   * unweighted pick makes every club equally likely to play a 3-3-3-1 or a 4-1-3-2
   * — and since those shapes commit far more men forward, a whole league of them
   * lifts goals per match well above the §6 target. Conventional shapes therefore
   * carry the weight, the adventurous ones appear as the distinctive minority, and
   * the purely situational ones (0) never turn up as a club's season-long default:
   * a 4-2-4 is something you throw on for the last ten minutes, and no AI side
   * should be seeded playing it in August. All of them stay fully available to the
   * manager — this only governs the random assignment.
   */
  aiWeight?: number;
}

function s(id: string, pos: Pos, x: number, y: number): FormationSlot {
  return { id, pos, label: pos, x, y };
}

export const FORMATIONS: Formation[] = [
  {
    id: "442",
    name: "4-4-2",
    desc: "Classic two banks of four. The wide four are LM/RM — they defend the flank as much as they attack it.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("lm", "LM", 15, 52), s("lcm", "CM", 38, 48), s("rcm", "CM", 62, 48), s("rm", "RM", 85, 52),
      s("lst", "ST", 40, 82), s("rst", "ST", 60, 82),
    ],
  },
  // ── 4-3-3 and its midfield variants ─────────────────────────────────────
  // The shape's identity is the back four and the front three; what changes is
  // how the middle three are staggered, and that changes a lot (PHASE_WEIGHTS
  // gives DM 0.85 midfield / 0.55 defense against AM's 0.75 / 0.10). They are
  // separate formations rather than a modifier because the engine only ever reads
  // slot positions — a variant IS a different set of slots.
  {
    id: "433",
    name: "4-3-3",
    family: "433",
    variant: "1 DM · 2 CM",
    desc: "A holding midfielder behind two eights, with a front three stretching the pitch.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("dm", "DM", 50, 40), s("lcm", "CM", 32, 52), s("rcm", "CM", 68, 52),
      s("lw", "LW", 18, 76), s("st", "ST", 50, 84), s("rw", "RW", 82, 76),
    ],
  },
  {
    id: "433-dm2",
    name: "4-3-3 (Double Pivot)",
    family: "433",
    variant: "2 DM · 1 CM",
    desc: "Two holding midfielders screen the back four with one eight ahead of them — the most solid way to play a front three.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("ldm", "DM", 36, 38), s("rdm", "DM", 64, 38), s("cm", "CM", 50, 54),
      s("lw", "LW", 18, 76), s("st", "ST", 50, 84), s("rw", "RW", 82, 76),
    ],
  },
  {
    id: "433-am1",
    aiWeight: 0.5,
    name: "4-3-3 (Attacking)",
    family: "433",
    variant: "2 CM · 1 AM",
    desc: "Two eights with a 10 pushed on ahead of them, playing between the lines behind the front three.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("lcm", "CM", 34, 42), s("rcm", "CM", 66, 42), s("am", "AM", 50, 60),
      s("lw", "LW", 18, 78), s("st", "ST", 50, 86), s("rw", "RW", 82, 78),
    ],
  },
  {
    id: "433-am2",
    aiWeight: 0.25,
    name: "4-3-3 (Free Roles)",
    family: "433",
    variant: "1 CM · 2 AM",
    desc: "A lone eight holding the middle with two free roles either side of him — enormous attacking threat, and a lot of ground for one midfielder to cover.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("cm", "CM", 50, 40), s("lam", "AM", 32, 58), s("ram", "AM", 68, 58),
      s("lw", "LW", 18, 78), s("st", "ST", 50, 86), s("rw", "RW", 82, 78),
    ],
  },
  {
    id: "4231",
    name: "4-2-3-1",
    desc: "A double pivot shields the back four; a 10 plays off a lone striker.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("ldm", "DM", 38, 40), s("rdm", "DM", 62, 40),
      s("lw", "LW", 18, 64), s("am", "AM", 50, 62), s("rw", "RW", 82, 64),
      s("st", "ST", 50, 84),
    ],
  },
  {
    id: "4141",
    name: "4-1-4-1",
    desc: "An anchor screens the defence behind a flat four. Compact and hard to play through.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("dm", "DM", 50, 38),
      // The wide two of the "4" are a flat bank with the centre pair — a wide
      // MIDFIELDER who tracks the full-back, not a winger held high.
      s("lm", "LM", 15, 58), s("lcm", "CM", 38, 56), s("rcm", "CM", 62, 56), s("rm", "RM", 85, 58),
      s("st", "ST", 50, 84),
    ],
  },
  {
    id: "4411",
    name: "4-4-1-1",
    desc: "Two banks of four with a second striker dropping between the lines.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("lm", "LM", 15, 50), s("lcm", "CM", 38, 46), s("rcm", "CM", 62, 46), s("rm", "RM", 85, 50),
      s("am", "AM", 50, 68),
      s("st", "ST", 50, 86),
    ],
  },
  {
    id: "352",
    name: "3-5-2",
    desc: "Three at the back with wide midfielders providing all the width — they cover the whole flank on their own.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      // The wide two of the "5" are LM/RM: with only three at the back the flanks
      // belong to midfielders, so the slot asks for a wide midfielder's balance of
      // attack and recovery rather than a full-back's.
      s("lm", "LM", 10, 48), s("rm", "RM", 90, 48),
      s("dm", "DM", 50, 40), s("lcm", "CM", 34, 54), s("rcm", "CM", 66, 54),
      s("lst", "ST", 40, 82), s("rst", "ST", 60, 82),
    ],
  },
  {
    id: "3421",
    name: "3-4-2-1",
    desc: "Three at the back, wide midfielders holding the flanks, and two free roles behind a lone striker.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("lm", "LM", 10, 48), s("rm", "RM", 90, 48),
      s("lcm", "CM", 36, 46), s("rcm", "CM", 64, 46),
      s("lam", "AM", 32, 70), s("ram", "AM", 68, 70),
      s("st", "ST", 50, 86),
    ],
  },
  {
    id: "343",
    name: "3-4-3",
    desc: "Aggressive three at the back with a full front three. The wide midfielders must cover a lot of ground.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("lm", "LM", 10, 48), s("rm", "RM", 90, 48),
      s("lcm", "CM", 36, 46), s("rcm", "CM", 64, 46),
      s("lw", "LW", 18, 76), s("st", "ST", 50, 84), s("rw", "RW", 82, 76),
    ],
  },
  {
    id: "532",
    name: "5-3-2",
    desc: "A back five that drops deep out of possession. The widest two are LB/RB — attacking full backs turn it into a 3-5-2.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lwb", "LB", 10, 30), s("lcb", "CB", 30, 18), s("ccb", "CB", 50, 16), s("rcb", "CB", 70, 18), s("rwb", "RB", 90, 30),
      s("lcm", "CM", 30, 50), s("cm", "CM", 50, 46), s("rcm", "CM", 70, 50),
      s("lst", "ST", 40, 80), s("rst", "ST", 60, 80),
    ],
  },
  {
    id: "4222",
    name: "4-2-2-2",
    desc: "A double pivot with two narrow attacking mids feeding a front two. Width has to come from the full backs.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("ldm", "DM", 38, 40), s("rdm", "DM", 62, 40),
      s("lam", "AM", 28, 64), s("ram", "AM", 72, 64),
      s("lst", "ST", 40, 84), s("rst", "ST", 60, 84),
    ],
  },

  // ── Narrow four-at-the-back shapes (v1.69) ──────────────────────────────
  {
    id: "41212",
    aiWeight: 0.4,
    name: "4-1-2-1-2",
    desc: "The narrow diamond: a pivot, two shuttling eights and a 10 behind a front two. Packs the centre completely — all the width has to come from your full-backs.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 13, 26), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 87, 26),
      s("dm", "DM", 50, 38),
      s("lcm", "CM", 32, 54), s("rcm", "CM", 68, 54),
      s("am", "AM", 50, 68),
      s("lst", "ST", 40, 86), s("rst", "ST", 60, 86),
    ],
  },
  {
    id: "4321",
    aiWeight: 0.4,
    name: "4-3-2-1",
    desc: "The Christmas tree: three central midfielders behind two attacking mids supporting a lone striker. Superb central combinations, very hard to play through — and no natural width at all.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 13, 26), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 87, 26),
      s("lcm", "CM", 30, 44), s("cm", "CM", 50, 40), s("rcm", "CM", 70, 44),
      s("lam", "AM", 36, 66), s("ram", "AM", 64, 66),
      s("st", "ST", 50, 86),
    ],
  },
  {
    id: "4132",
    aiWeight: 0.25,
    name: "4-1-3-2",
    desc: "One holding midfielder protects the back four while three attacking mids push high behind a front two — a deliberate overload of the opponent's defensive third.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 13, 26), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 87, 26),
      s("dm", "DM", 50, 36),
      s("lam", "AM", 20, 62), s("cam", "AM", 50, 60), s("ram", "AM", 80, 62),
      s("lst", "ST", 40, 86), s("rst", "ST", 60, 86),
    ],
  },
  {
    // Historical, and today a "chasing the game" shape. Kept out of the AI's
    // random pool: no league side should be seeded playing without a midfield.
    id: "424",
    name: "4-2-4",
    aiWeight: 0,
    desc: "A throwback, and now a last-ten-minutes gamble: two midfielders and a front four. It bypasses the middle of the pitch entirely — and hands it to the opposition.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 13, 26), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 87, 26),
      s("lcm", "CM", 36, 46), s("rcm", "CM", 64, 46),
      s("lw", "LW", 14, 76), s("lst", "ST", 38, 84), s("rst", "ST", 62, 84), s("rw", "RW", 86, 76),
    ],
  },

  // ── Three-at-the-back shapes (v1.69) ────────────────────────────────────
  {
    id: "3241",
    aiWeight: 0.4,
    name: "3-2-4-1",
    desc: "The box midfield: three centre-backs and a double pivot under a bank of four, making a box of four central midfielders. Dominates the ball and smothers counter-attacks.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("ldm", "DM", 36, 38), s("rdm", "DM", 64, 38),
      s("lm", "LM", 12, 62), s("lam", "AM", 38, 60), s("ram", "AM", 62, 60), s("rm", "RM", 88, 62),
      s("st", "ST", 50, 86),
    ],
  },
  {
    id: "3142",
    aiWeight: 0.4,
    name: "3-1-4-2",
    desc: "A 3-5-2 with a stricter division of labour: one anchor holds the centre so both other central midfielders push right into the box.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("dm", "DM", 50, 36),
      s("lm", "LM", 11, 54), s("lam", "AM", 37, 60), s("ram", "AM", 63, 60), s("rm", "RM", 89, 54),
      s("lst", "ST", 40, 86), s("rst", "ST", 60, 86),
    ],
  },
  {
    id: "3331",
    aiWeight: 0.25,
    name: "3-3-3-1",
    desc: "The Bielsa shape: three at the back, a narrow midfield three, two wingers around a 10, and a lone striker. Man-to-man pressing everywhere — and it demands extraordinary fitness.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("lcm", "CM", 30, 44), s("dm", "DM", 50, 40), s("rcm", "CM", 70, 44),
      s("lw", "LW", 15, 68), s("am", "AM", 50, 64), s("rw", "RW", 85, 68),
      s("st", "ST", 50, 86),
    ],
  },

  // ── Back-five shapes (v1.69) ────────────────────────────────────────────
  {
    // Park the bus. Deliberately not in the AI's random pool — a club seeded into
    // this would play every fixture of the season behind the ball.
    id: "541",
    name: "5-4-1",
    aiWeight: 0,
    desc: "The bus, parked: a back five and a bank of four, with almost no space between the lines. Your lone striker will spend the afternoon chasing clearances.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lwb", "LB", 9, 28), s("lcb", "CB", 30, 18), s("ccb", "CB", 50, 16), s("rcb", "CB", 70, 18), s("rwb", "RB", 91, 28),
      s("lm", "LM", 16, 50), s("lcm", "CM", 39, 46), s("rcm", "CM", 61, 46), s("rm", "RM", 84, 50),
      s("st", "ST", 50, 84),
    ],
  },
  {
    id: "523",
    name: "5-2-3",
    aiWeight: 0,
    desc: "Deep counter-attacking: a back five and two central midfielders absorb everything while three forwards stay high, ready to break the instant you win it.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lwb", "LB", 9, 28), s("lcb", "CB", 30, 18), s("ccb", "CB", 50, 16), s("rcb", "CB", 70, 18), s("rwb", "RB", 91, 28),
      s("lcm", "CM", 38, 44), s("rcm", "CM", 62, 44),
      s("lw", "LW", 18, 74), s("st", "ST", 50, 82), s("rw", "RW", 82, 74),
    ],
  },
];

/**
 * The pool a club's random formation is drawn from (v1.69).
 *
 * Weights are realised as repeats so a caller can keep using a plain uniform
 * `pick()` — worldgen's RNG contract is one draw from an array, and expanding the
 * weights here means no seeded-randomness code has to change. Weights are read at
 * a granularity of 0.05, which is finer than any of them needs.
 *
 * Formations at weight 0 are absent entirely: they are the situational shapes no
 * club should be seeded into for a whole season. Every formation remains fully
 * available to the manager through the picker.
 */
export const AI_FORMATIONS: Formation[] = FORMATIONS.flatMap((f) => {
  const repeats = Math.round((f.aiWeight ?? 1) / 0.05);
  return Array.from({ length: repeats }, () => f);
});

/**
 * The formation picker's structure (v1.69): one entry per SHAPE, carrying its
 * variants. A formation with no `family` is its own group of one, so adding a
 * plain formation needs nothing here — only a family needs naming.
 *
 * Display only. The engine still reads a single `formationId`; this is what stops
 * the picker becoming twenty-four undifferentiated buttons.
 */
export interface FormationGroup {
  id: string;
  /** The family's display name — the base variant's, minus its parenthetical. */
  name: string;
  /** Members in list order; the first is the default the family button selects. */
  formations: Formation[];
}

export const FORMATION_GROUPS: FormationGroup[] = (() => {
  const groups: FormationGroup[] = [];
  const byFamily = new Map<string, FormationGroup>();
  for (const f of FORMATIONS) {
    if (!f.family) {
      groups.push({ id: f.id, name: f.name, formations: [f] });
      continue;
    }
    const existing = byFamily.get(f.family);
    if (existing) {
      existing.formations.push(f);
      continue;
    }
    // The family takes its name from its first member, with any parenthetical
    // stripped — "4-3-3 (Double Pivot)" would be a poor label for the family the
    // plain 4-3-3 also belongs to.
    const group: FormationGroup = {
      id: f.family,
      name: f.name.replace(/\s*\(.*\)$/, ""),
      formations: [f],
    };
    byFamily.set(f.family, group);
    groups.push(group);
  }
  return groups;
})();

/** The picker group a formation id belongs to, or undefined if unknown. */
export function formationGroupOf(id: string): FormationGroup | undefined {
  return FORMATION_GROUPS.find((g) => g.formations.some((f) => f.id === id));
}

export function getFormation(id: string): Formation {
  // Fall back to the 4-3-3 by id, not by index: the list is grouped by family
  // now, so a positional fallback would silently change meaning the next time a
  // formation is inserted.
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS.find((f) => f.id === "433")!;
}

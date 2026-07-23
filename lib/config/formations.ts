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
  {
    id: "433",
    name: "4-3-3",
    desc: "A holding midfielder behind two eights, with a front three stretching the pitch.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lb", "LB", 15, 24), s("lcb", "CB", 38, 20), s("rcb", "CB", 62, 20), s("rb", "RB", 85, 24),
      s("dm", "DM", 50, 40), s("lcm", "CM", 32, 52), s("rcm", "CM", 68, 52),
      s("lw", "LW", 18, 76), s("st", "ST", 50, 84), s("rw", "RW", 82, 76),
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
      s("lw", "LW", 15, 58), s("lcm", "CM", 38, 56), s("rcm", "CM", 62, 56), s("rw", "RW", 85, 58),
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
    desc: "Three at the back with LB/RB pushed high as wing-backs — give them the Attacking Wing-Back archetype to get the most from the overlap.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      // Wing-backs are LB/RB pushed high (y 44), not a distinct LWB/RWB slot.
      s("lwb", "LB", 10, 44), s("rwb", "RB", 90, 44),
      s("dm", "DM", 50, 40), s("lcm", "CM", 34, 54), s("rcm", "CM", 66, 54),
      s("lst", "ST", 40, 82), s("rst", "ST", 60, 82),
    ],
  },
  {
    id: "3421",
    name: "3-4-2-1",
    desc: "Three at the back, high wing-backs, and two free roles behind a lone striker.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("lwb", "LB", 10, 46), s("rwb", "RB", 90, 46),
      s("lcm", "CM", 36, 46), s("rcm", "CM", 64, 46),
      s("lam", "AM", 32, 70), s("ram", "AM", 68, 70),
      s("st", "ST", 50, 86),
    ],
  },
  {
    id: "343",
    name: "3-4-3",
    desc: "Aggressive three at the back with a full front three. Wing-backs must cover a lot of ground.",
    slots: [
      s("gk", "GK", 50, 5),
      s("lcb", "CB", 28, 20), s("ccb", "CB", 50, 18), s("rcb", "CB", 72, 20),
      s("lwb", "LB", 10, 46), s("rwb", "RB", 90, 46),
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
];

export function getFormation(id: string): Formation {
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[1];
}

// Preset formations only (GAME_DESIGN.md §6). Each slot has a pitch position
// for the tactics screen (x: 0-100 left→right, y: 0-100 own goal→opp goal).

import type { Pos } from "../types";

export interface FormationSlot {
  id: string;
  pos: Pos;
  label: string;
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  name: string;
  slots: FormationSlot[];
}

function s(id: string, pos: Pos, label: string, x: number, y: number): FormationSlot {
  return { id, pos, label, x, y };
}

export const FORMATIONS: Formation[] = [
  {
    id: "442",
    name: "4-4-2",
    slots: [
      s("gk", "GK", "GK", 50, 5),
      s("lb", "LB", "LB", 15, 24), s("lcb", "CB", "CB", 38, 20), s("rcb", "CB", "CB", 62, 20), s("rb", "RB", "RB", 85, 24),
      s("lm", "LW", "LM", 15, 52), s("lcm", "CM", "CM", 38, 48), s("rcm", "CM", "CM", 62, 48), s("rm", "RW", "RM", 85, 52),
      s("lst", "ST", "ST", 40, 82), s("rst", "ST", "ST", 60, 82),
    ],
  },
  {
    id: "433",
    name: "4-3-3",
    slots: [
      s("gk", "GK", "GK", 50, 5),
      s("lb", "LB", "LB", 15, 24), s("lcb", "CB", "CB", 38, 20), s("rcb", "CB", "CB", 62, 20), s("rb", "RB", "RB", 85, 24),
      s("dm", "DM", "DM", 50, 40), s("lcm", "CM", "CM", 32, 52), s("rcm", "CM", "CM", 68, 52),
      s("lw", "LW", "LW", 18, 76), s("st", "ST", "ST", 50, 84), s("rw", "RW", "RW", 82, 76),
    ],
  },
  {
    id: "4231",
    name: "4-2-3-1",
    slots: [
      s("gk", "GK", "GK", 50, 5),
      s("lb", "LB", "LB", 15, 24), s("lcb", "CB", "CB", 38, 20), s("rcb", "CB", "CB", 62, 20), s("rb", "RB", "RB", 85, 24),
      s("ldm", "DM", "DM", 38, 40), s("rdm", "DM", "DM", 62, 40),
      s("lw", "LW", "LW", 18, 64), s("am", "AM", "AM", 50, 62), s("rw", "RW", "RW", 82, 64),
      s("st", "ST", "ST", 50, 84),
    ],
  },
  {
    id: "352",
    name: "3-5-2",
    slots: [
      s("gk", "GK", "GK", 50, 5),
      s("lcb", "CB", "CB", 28, 20), s("ccb", "CB", "CB", 50, 18), s("rcb", "CB", "CB", 72, 20),
      s("lwb", "LB", "LWB", 10, 44), s("rwb", "RB", "RWB", 90, 44),
      s("dm", "DM", "DM", 50, 40), s("lcm", "CM", "CM", 34, 54), s("rcm", "CM", "CM", 66, 54),
      s("lst", "ST", "ST", 40, 82), s("rst", "ST", "ST", 60, 82),
    ],
  },
  {
    id: "532",
    name: "5-3-2",
    slots: [
      s("gk", "GK", "GK", 50, 5),
      s("lwb", "LB", "LWB", 10, 30), s("lcb", "CB", "CB", 30, 18), s("ccb", "CB", "CB", 50, 16), s("rcb", "CB", "CB", 70, 18), s("rwb", "RB", "RWB", 90, 30),
      s("lcm", "CM", "CM", 30, 50), s("cm", "CM", "CM", 50, 46), s("rcm", "CM", "CM", 70, 50),
      s("lst", "ST", "ST", 40, 80), s("rst", "ST", "ST", 60, 80),
    ],
  },
];

export function getFormation(id: string): Formation {
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[1];
}

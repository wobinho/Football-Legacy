// ── Suggesting roles for a shape (v2.2) ────────────────────────────────────
//
// What survives of `lib/assistant.ts`, which is deleted along with the Squad
// Blueprint, the Assistant's report and the role brief's grading.
//
// The distinction is worth stating, because it is why this file is 90 lines
// where its predecessor was 643. The assistant GRADED you: it took the eleven
// players you had picked, scored them against an ideal it computed, and printed
// a letter and a list of notes. That is a wiki telling a manager what to think
// about his own squad, and it is the thing being removed.
//
// This answers a narrower and more honest question, and only where the manager
// explicitly asks it: given a formation and a style, WHICH ROLE would suit each
// slot? It fills in the Tactic Creator when you press the button, and it powers
// the help chapter that names an ideal XI per style. It never grades a lineup,
// never scores a player, and nothing consumes it automatically.
//
// It is a suggestion about ROLES — things a manager can go and buy — and not
// about the players he already owns, which is the line the old blueprint kept
// crossing.

import type { Pos, Style, Tactic } from "./types";
import {
  archetypesForPosition,
  instructionFitScore,
  profileOf,
  type Archetype,
  type InstructionView,
} from "./config/archetype";
// The engine's own resolver, so a suggestion is scored against exactly the
// dials the match will read — including its defaults for an unset axis.
import { resolveInstructions } from "./engine/match";

/** How well a role suits a style plus a set of dials, as a percentage swing.
 * The two terms the engine itself applies to identity — nothing else. */
function setupScore(a: Archetype, style: Style, view: InstructionView, swing: number) {
  const prof = profileOf(a);
  const styleTerm = (prof.styleSynergy[style] - 1) * 100;
  const dials = instructionFitScore(prof.instructionPrefs, view) * swing * 100;
  return styleTerm + dials;
}

export interface SuggestedRole {
  slotId: string;
  role: Archetype;
}

/**
 * The role best suited to each slot in a shape.
 *
 * ── Why a position GROUP is solved together (kept from v1.93) ──────────────
 *
 * Picking each slot's best role independently makes the answer very nearly a
 * function of the STYLE alone, because the style term dwarfs the dial term. The
 * measured result was two Architect centre backs, two Constructor full backs
 * and two Maestro centre mids in every 4-3-3, every time — a style lookup
 * printed eleven times, and bad advice besides: a back four of two identical
 * ball-players has nobody to defend the box.
 *
 * So each position group takes its best role first, then for each further slot
 * the best role NOT ALREADY USED in that group. Greedy, which is optimal here
 * because slots within a group are interchangeable and the scores don't
 * interact. Ordered by `x` so the answer reads left-to-right across the pitch
 * and is stable against the slot list being reordered.
 *
 * Note LB/RB and LW/RW correctly still share a role: they are different `Pos`
 * values, so they are separate groups of one. Mirrored flanks share a job;
 * paired central slots don't.
 */
export function suggestRoles(
  slots: { id: string; pos: Pos; x?: number }[],
  tactic: Tactic,
  instructionFitSwing: number
): SuggestedRole[] {
  const view = resolveInstructions(tactic);
  const score = (a: Archetype) => setupScore(a, tactic.style, view, instructionFitSwing);

  const byPos = new Map<Pos, typeof slots>();
  for (const s of slots) {
    const list = byPos.get(s.pos) ?? [];
    list.push(s);
    byPos.set(s.pos, list);
  }

  const out = new Map<string, Archetype>();
  for (const [pos, group] of byPos) {
    const options = archetypesForPosition(pos);
    if (!options.length) continue;
    const ordered = [...group].sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || a.id.localeCompare(b.id));
    const used = new Set<string>();
    for (const s of ordered) {
      // Fall back to the full list once a group is deeper than the position's
      // five options — no shipped formation has six of one position, but this
      // keeps the function total rather than undefined.
      const pool = options.filter((a) => !used.has(a.id));
      const from = pool.length ? pool : options;
      const pick = from.reduce((best, a) => (score(a) > score(best) ? a : best), from[0]);
      if (pick) {
        used.add(pick.id);
        out.set(s.id, pick);
      }
    }
  }

  // Returned in the caller's own slot order, so a consumer can zip it against
  // the formation without re-sorting.
  const result: SuggestedRole[] = [];
  for (const s of slots) {
    const role = out.get(s.id);
    if (role) result.push({ slotId: s.id, role });
  }
  return result;
}

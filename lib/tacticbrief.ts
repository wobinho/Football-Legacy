// ── The Tactic Creator's role brief (v1.99) ────────────────────────────────
//
// A custom tactic names, per formation slot, the ARCHETYPE the manager wants
// standing there — EA FC's player roles, in this game's vocabulary. This module
// is the whole of what that assignment means to the simulation; the screen
// draws it and decides nothing.
//
// ── Why this is not a third channel ────────────────────────────────────────
//
// v1.78 is explicit that identity reaches the engine through ONE lever:
// `synergyMult × instructionMult`, both landing on a player's effective rating.
// The obvious way to build a role brief violates that outright — grant a bonus
// when a player matches his slot's brief — and it fails for a second, worse
// reason: it is not zero-sum. `CLASS_STYLE_ROW` sums to zero per class
// precisely so no style is a free win, and a bonus every manager collects by
// briefing the roles his squad already holds is a world-wide rating rise
// dressed up as a decision. It would need re-calibrating and it would make the
// Creator mandatory rather than interesting.
//
// So a brief REDISTRIBUTES rather than adds. A slot whose brief is met earns a
// bonus, a slot whose brief is missed pays a penalty, and across the eleven
// slots the two are designed to cancel. Setting a brief is therefore a BET:
// name the roles you actually intend to field and the side is sharper than it
// was; name roles you do not have and it is worse. The expected value of a
// brief chosen at random is zero, which is what keeps the feature honest
// against a manager who never opens it — and a tactic with NO brief returns
// exactly 1 everywhere, so every existing save computes what it always did.
//
// ── Where it lands ─────────────────────────────────────────────────────────
//
// On the same quantity the other two levers land on, and nowhere else. The
// engine multiplies `roleBriefMult` into `effectiveRating` alongside
// `synergyMult` and `instructionMult`, and `tacticalFitMult` folds it in so
// SELECTION asks the same question the match answers (the v1.90 rule). It is
// not a new engine quantity, it does not touch scoring, chance creation or
// fitness, and no code outside this file decides what a brief is worth.

import type { AttrKey } from "./config/attributes";
import type { Pos, RoleBrief, Tactic } from "./types";
import { archetypesForPosition, deriveArchetype, getArchetype, type Archetype } from "./config/archetype";
import { getFormation } from "./config/formations";

/**
 * How far a met or missed brief moves a player's rating.
 *
 * Deliberately sized BETWEEN the two existing levers — style synergy runs ±15%
 * and the instruction layer ±6% — so the brief is a real decision without
 * outranking the question of who you actually signed. A 78-rated player reads
 * about 84 on brief and about 72 off it, which is a difference a manager feels
 * in the table without it ever beating a genuinely better footballer by much.
 *
 * Lives here rather than in `config/tuning.ts` because it is the definition of
 * this feature rather than a balance dial shared by anything else; the two
 * bounds it is calibrated against are tuning values and are read as such.
 */
export const ROLE_BRIEF_SWING = 0.08;

/**
 * A slot's brief is "met" on a sliding scale, not a coin flip.
 *
 * Asking for an exact archetype match alone would make the brief almost always
 * a miss: there are five archetypes per position and a squad rarely holds the
 * precise one named. The CLASS is the middle ground — a manager who asks for a
 * Sniper and fields a Predator got the KIND of player he wanted even though he
 * missed the exact role.
 *
 *   exact archetype  → +1.0
 *   same class       → +0.5
 *   anything else    → the penalty below, which is DERIVED, not authored.
 *
 * ── Why the penalty is computed per position ───────────────────────────────
 *
 * The zero-sum promise is the whole justification for this feature existing
 * inside the v1.78 one-lever rule, and a hand-picked penalty does not deliver
 * it. Measured with a flat −1 (`verify:brief`), a brief chosen at random was
 * worth **−16.7%** across an XI — the Creator was a tax, and a manager who
 * understood it would never have opened the screen.
 *
 * The reason is that the five roles at a position are not spread evenly across
 * the classes, and the spread differs enormously by position: at CB four of the
 * five roles are Enforcers (a same-class near-miss is 48% likely), while at GK
 * all five are different classes (a same-class near-miss is impossible). No
 * single constant can centre both.
 *
 * So the miss penalty is solved per position, from the position's own roster,
 * to make the expected score of a RANDOMLY chosen brief exactly zero:
 *
 *   pExact·1 + pSame·0.5 + pOther·penalty = 0
 *   penalty = -(pExact + 0.5·pSame) / pOther
 *
 * That keeps the reward side fixed and legible (you always get +1 for the role
 * you asked for) while making the downside exactly what the upside costs. It is
 * derived from the archetype table, so adding a role to a position re-centres
 * itself rather than silently tilting the feature.
 */
const MISS_PENALTY = new Map<Pos, number>();

function missPenalty(pos: Pos): number {
  const cached = MISS_PENALTY.get(pos);
  if (cached !== undefined) return cached;

  const options = archetypesForPosition(pos);
  const n = options.length;
  let exact = 0;
  let same = 0;
  let other = 0;
  for (const brief of options) {
    for (const actual of options) {
      if (actual.id === brief.id) exact++;
      else if (actual.cls === brief.cls) same++;
      else other++;
    }
  }
  const total = n * n;
  // A position where every role is the same class (or there is only one) has no
  // "other" case at all, so nothing can be centred and nothing needs to be.
  const penalty = other === 0 ? 0 : -((exact / total) * 1 + (same / total) * 0.5) / (other / total);
  MISS_PENALTY.set(pos, penalty);
  return penalty;
}

function slotFit(brief: Archetype, actual: Archetype | undefined, pos: Pos): number {
  if (!actual) return 0; // empty slot — nothing to reward or punish
  if (actual.id === brief.id) return 1;
  if (actual.cls === brief.cls) return 0.5;
  return missPenalty(pos);
}

/** The brief for one slot, or undefined when the slot is unbriefed. */
export function briefFor(tactic: Tactic, slotId: string): Archetype | undefined {
  const id = tactic.roles?.[slotId];
  return id ? getArchetype(id) : undefined;
}

/** True when this tactic carries any role brief at all. The cheap guard every
 * consumer takes first, so an ordinary tactic never pays for this feature. */
export function hasBrief(tactic: Tactic): boolean {
  const roles = tactic.roles;
  if (!roles) return false;
  for (const _k in roles) return true;
  return false;
}

/**
 * The multiplier a player earns for how well he answers his slot's brief.
 *
 * Returns exactly 1 when there is no brief for the slot, when the tactic has no
 * briefs at all, or when the player has no derivable archetype — so this is
 * inert for every save that never opens the Creator, which is the property that
 * lets it sit in the engine's hot path at all.
 *
 * `slotId` is the FORMATION slot he is filling, not his position: a brief is
 * attached to a place on the pitch, and a midfielder asked to play right back
 * is answering the right back's brief.
 */
export function roleBriefMult(
  attrs: Record<AttrKey, number> | undefined,
  slotPos: Pos,
  slotId: string,
  tactic: Tactic
): number {
  if (!attrs) return 1;
  const brief = briefFor(tactic, slotId);
  if (!brief) return 1;
  // Read at the slot he is FILLING, exactly as the blueprint and the engine do.
  const actual = deriveArchetype(attrs, slotPos);
  return 1 + slotFit(brief, actual, slotPos) * ROLE_BRIEF_SWING;
}

/**
 * What a brief is worth across a whole XI, as a percentage swing — the number
 * the Creator prints so the manager can see the bet he is making.
 *
 * This is the zero-sum claim made visible: brief every slot with the role that
 * is already there and this reads strongly positive; brief eleven roles you do
 * not have and it reads strongly negative. A manager can therefore see, before
 * he saves, that the Creator is not free money.
 */
export function briefBalance(
  tactic: Tactic,
  lineup: { slotId: string; slotPos: Pos; attrs?: Record<AttrKey, number> }[]
): { total: number; met: number; near: number; missed: number; briefed: number } {
  let total = 0;
  let met = 0;
  let near = 0;
  let missed = 0;
  let briefed = 0;
  for (const slot of lineup) {
    const brief = briefFor(tactic, slot.slotId);
    if (!brief) continue;
    briefed++;
    if (!slot.attrs) continue;
    const fit = slotFit(brief, deriveArchetype(slot.attrs, slot.slotPos), slot.slotPos);
    total += fit * ROLE_BRIEF_SWING * 100;
    if (fit === 1) met++;
    else if (fit === 0.5) near++;
    else if (fit < 0) missed++;
  }
  return { total, met, near, missed, briefed };
}

/**
 * Strip briefs naming a slot the formation does not have.
 *
 * A brief is keyed by slot id, and slot ids belong to a formation — so changing
 * formation inside the Creator would otherwise leave briefs attached to slots
 * that no longer exist, which then travel into a saved tactic and can never be
 * seen or cleared. Same forgiving discipline `loadSavedTactic` applies to a
 * stale player id.
 */
export function pruneBrief(roles: RoleBrief | undefined, formationId: string): RoleBrief | undefined {
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

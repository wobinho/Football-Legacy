// ── Trait pool (GAME_DESIGN.md §5) ────────────────────────────────────────
// Pure data: each trait exposes numeric effect hooks the engine, economy and
// dev systems read. The engine NEVER special-cases a trait by name — it reads
// these numeric effects only (lookups in TRAIT_MAP).
//
// v7: traits are curated to make football sense (no "poacher"/"wall" clutter),
// each carries a position `eligible` group so worldgen never hands a striker a
// defender's trait, and each exposes a structured `influence` list so the UI
// tooltip can explain the *actual* in-game effect rather than flavour text.

import type { Pos } from "../types";

/** Which players a trait can be assigned to (by primary position group). */
export type TraitEligible = "any" | "gk" | "def" | "mid" | "att";

/** One concrete, player-facing effect line for the hover tooltip. */
export interface TraitInfluence {
  label: string; // what it affects, e.g. "Last 15 minutes"
  detail: string; // the concrete effect, e.g. "+8% match rating"
}

export interface Trait {
  id: string;
  name: string;
  desc: string;
  /** One-word category, for grouping in the UI only (never read by the engine). */
  group: "match" | "mental" | "physical" | "development" | "off-pitch";
  /** Position group a player must belong to for this trait to be assignable. */
  eligible: TraitEligible;
  /** Concrete effect lines shown in the styled hover tooltip. */
  influence: TraitInfluence[];
  effects: {
    /** Effective-rating multiplier from tuning.clutchMinute onward. */
    clutchMult?: number;
    /** Multiplier on fitness drain (< 1 = tires slower). */
    fitnessDrainMult?: number;
    /** Small effective-rating buff to all teammates on pitch (passive). */
    teamBuffMult?: number;
    /** Extra team buff applied only when this player wears the captain's armband. */
    captainBuffMult?: number;
    /** Extra scorer-selection weight multiplier. */
    scorerMult?: number;
    /** Extra assist-selection weight multiplier. */
    assistMult?: number;
    /** While on the pitch, multiplies opponents' chance-conversion (< 1 = stingier). */
    concedeMult?: number;
    /** Slower decline in the aging function (adds to longevity read). */
    longevityBonus?: number;
    /** Form swings dampened (consistent) — 0..1, higher = steadier. */
    formStability?: number;
    /** Sponsor offer quality/value multiplier for the club (see lib/sponsors.ts).
     * Summed across the squad's on-books players, so a marketable star lifts deals. */
    marketabilityBonus?: number;
    /** Extra season-development growth multiplier for the club's youngsters
     * (a mentor in the dressing room). Read by the rollover, not the engine. */
    mentorBonus?: number;
  };
}

export const TRAITS: Trait[] = [
  // ── Match-defining ──
  {
    id: "clutch", name: "Clutch", group: "match", eligible: "any",
    desc: "Raises their game when it matters most, deep into the second half.",
    influence: [{ label: "Last 15 minutes", detail: "+8% match rating" }],
    effects: { clutchMult: 1.08 },
  },
  {
    id: "clinical", name: "Clinical", group: "match", eligible: "att",
    desc: "A ruthless finisher — needs only a half-chance to score.",
    influence: [{ label: "In front of goal", detail: "+22% chance to be the scorer" }],
    effects: { scorerMult: 1.22 },
  },
  {
    id: "maestro", name: "Maestro", group: "match", eligible: "mid",
    desc: "Pulls the strings — creates far more for others.",
    influence: [{ label: "Creating chances", detail: "+35% chance to grab the assist" }],
    effects: { assistMult: 1.35 },
  },
  {
    id: "dead_ball", name: "Dead-Ball Specialist", group: "match", eligible: "any",
    desc: "Deadly from set pieces — sharper as your penalty & free-kick taker.",
    influence: [
      { label: "Set pieces", detail: "+10% scorer weight" },
      { label: "As your taker", detail: "converts penalties & free-kicks more often" },
    ],
    effects: { scorerMult: 1.1 },
  },

  // ── Mental / leadership ──
  {
    id: "leader", name: "Leader", group: "mental", eligible: "any",
    desc: "Lifts the whole team — and much more with the armband.",
    influence: [
      { label: "Whole XI (passive)", detail: "+1% match rating for teammates" },
      { label: "As captain", detail: "+2% additional to the whole side" },
    ],
    effects: { teamBuffMult: 1.01, captainBuffMult: 1.02 },
  },
  {
    id: "talisman", name: "Talisman", group: "mental", eligible: "any",
    desc: "The heartbeat of the side; inspires everyone around them.",
    influence: [{ label: "Whole XI (passive)", detail: "+1.5% match rating for teammates" }],
    effects: { teamBuffMult: 1.015 },
  },
  {
    id: "consistent", name: "Consistent", group: "mental", eligible: "any",
    desc: "Rarely swings between hot and cold form.",
    influence: [{ label: "Form", detail: "swings dampened by ~50%" }],
    effects: { formStability: 0.5 },
  },
  {
    id: "composed", name: "Composed", group: "mental", eligible: "any",
    desc: "Ice in the veins — steady late and from the spot.",
    influence: [
      { label: "Last 15 minutes", detail: "+4% match rating" },
      { label: "Form", detail: "swings dampened by ~25%" },
    ],
    effects: { clutchMult: 1.04, formStability: 0.25 },
  },

  // ── Physical ──
  {
    id: "engine", name: "Engine", group: "physical", eligible: "any",
    desc: "Runs all day — greatly reduced fitness drain.",
    influence: [{ label: "Stamina", detail: "tires 30% slower" }],
    effects: { fitnessDrainMult: 0.7 },
  },
  {
    id: "workhorse", name: "Workhorse", group: "physical", eligible: "any",
    desc: "Tireless — tires a little slower and lifts the press.",
    influence: [
      { label: "Stamina", detail: "tires 15% slower" },
      { label: "Whole XI (passive)", detail: "+0.5% match rating" },
    ],
    effects: { fitnessDrainMult: 0.85, teamBuffMult: 1.005 },
  },
  {
    id: "marshal", name: "Marshal", group: "physical", eligible: "def",
    desc: "Organises the back line — opponents convert fewer chances while they play.",
    influence: [{ label: "While on the pitch", detail: "opponents convert 10% fewer chances" }],
    effects: { concedeMult: 0.9 },
  },
  {
    id: "evergreen", name: "Evergreen", group: "physical", eligible: "any",
    desc: "Ages gracefully; declines later and slower.",
    influence: [{ label: "Aging", detail: "slower, later decline" }],
    effects: { longevityBonus: 0.25 },
  },

  // ── Off-pitch / development ──
  {
    id: "marketable", name: "Marketable", group: "off-pitch", eligible: "any",
    desc: "A commercial draw — attracts stronger sponsorship offers to the club.",
    influence: [{ label: "Sponsorships", detail: "lifts every offer the club receives" }],
    effects: { marketabilityBonus: 0.14 },
  },
  {
    id: "mentor", name: "Mentor", group: "development", eligible: "any",
    desc: "A model professional — young teammates develop faster.",
    influence: [{ label: "Youngsters at the club", detail: "+10% development speed" }],
    effects: { mentorBonus: 0.1 },
  },

  // ── v19 additions ────────────────────────────────────────────────────────
  // Every one reuses the existing numeric effect hooks, so the engine needs no
  // new branches — a trait is still nothing but a bag of multipliers.

  // Match-defining
  {
    id: "target", name: "Aerial Threat", group: "match", eligible: "any",
    desc: "Dominant in the air — a constant menace from crosses and set pieces.",
    influence: [{ label: "From crosses & set pieces", detail: "+15% chance to be the scorer" }],
    effects: { scorerMult: 1.15 },
  },
  {
    id: "long_shot", name: "Long-Range Threat", group: "match", eligible: "any",
    desc: "Will shoot from anywhere — and hits the target often enough to justify it.",
    influence: [{ label: "Shooting", detail: "+12% chance to be the scorer" }],
    effects: { scorerMult: 1.12 },
  },
  {
    id: "crosser", name: "Pinpoint Crosser", group: "match", eligible: "any",
    desc: "Delivers from wide areas with real precision — the assist machine of a flank attack.",
    influence: [{ label: "Creating chances", detail: "+25% chance to grab the assist" }],
    effects: { assistMult: 1.25 },
  },
  {
    id: "dribbler", name: "Dribbler", group: "match", eligible: "any",
    desc: "Takes his man on every time and creates something out of nothing.",
    influence: [
      { label: "Creating chances", detail: "+15% assist weight" },
      { label: "In front of goal", detail: "+8% scorer weight" },
    ],
    effects: { assistMult: 1.15, scorerMult: 1.08 },
  },
  {
    id: "sweeper", name: "Sweeper", group: "match", eligible: "gk",
    desc: "Reads danger early and snuffs out attacks before they become chances.",
    influence: [{ label: "While on the pitch", detail: "opponents convert 8% fewer chances" }],
    effects: { concedeMult: 0.92 },
  },

  // Mental
  {
    id: "big_game", name: "Big-Game Player", group: "mental", eligible: "any",
    desc: "Saves his very best for the occasions that matter.",
    influence: [{ label: "Last 15 minutes", detail: "+6% match rating" }],
    effects: { clutchMult: 1.06 },
  },
  {
    id: "temperamental", name: "Temperamental", group: "mental", eligible: "any",
    desc: "Mercurial — capable of anything, but the highs and lows come in waves.",
    influence: [
      { label: "Form", detail: "swings amplified by ~40%" },
      { label: "In front of goal", detail: "+10% scorer weight" },
    ],
    effects: { formStability: 1.4, scorerMult: 1.1 },
  },
  {
    id: "professional", name: "Consummate Professional", group: "mental", eligible: "any",
    desc: "Never a bad day at the office, and the youngsters watch how he works.",
    influence: [
      { label: "Form", detail: "swings dampened by ~35%" },
      { label: "Youngsters at the club", detail: "+6% development speed" },
    ],
    effects: { formStability: 0.35, mentorBonus: 0.06 },
  },

  // Physical
  {
    id: "pace_merchant", name: "Blistering Pace", group: "physical", eligible: "any",
    desc: "Frightening acceleration — defenders simply cannot live with him in a foot race.",
    influence: [
      { label: "In front of goal", detail: "+10% scorer weight" },
      { label: "Stamina", detail: "tires 8% faster" },
    ],
    effects: { scorerMult: 1.1, fitnessDrainMult: 1.08 },
  },
  {
    id: "iron_man", name: "Iron Man", group: "physical", eligible: "any",
    desc: "Built to last — barely tires and keeps playing long after others fade.",
    influence: [
      { label: "Stamina", detail: "tires 22% slower" },
      { label: "Aging", detail: "slower decline" },
    ],
    effects: { fitnessDrainMult: 0.78, longevityBonus: 0.12 },
  },
  {
    id: "enforcer", name: "Enforcer", group: "physical", eligible: "def",
    desc: "Nobody enjoys playing against him — he makes the whole back line harder to break down.",
    influence: [{ label: "While on the pitch", detail: "opponents convert 7% fewer chances" }],
    effects: { concedeMult: 0.93 },
  },
  {
    id: "injury_prone", name: "Glass Ankles", group: "physical", eligible: "any",
    desc: "Wonderful when fit — the trouble is keeping him that way.",
    influence: [{ label: "Stamina", detail: "tires 25% faster" }],
    effects: { fitnessDrainMult: 1.25 },
  },

  // Off-pitch / development
  {
    id: "fan_favourite", name: "Fan Favourite", group: "off-pitch", eligible: "any",
    desc: "Adored on the terraces — lifts the mood around the club and shifts plenty of shirts.",
    influence: [
      { label: "Sponsorships", detail: "lifts every offer the club receives" },
      { label: "Whole XI (passive)", detail: "+0.5% match rating" },
    ],
    effects: { marketabilityBonus: 0.09, teamBuffMult: 1.005 },
  },
  {
    id: "global_icon", name: "Global Icon", group: "off-pitch", eligible: "any",
    desc: "A worldwide name — sponsors queue up for the association.",
    influence: [{ label: "Sponsorships", detail: "substantially lifts every offer" }],
    effects: { marketabilityBonus: 0.22 },
  },
  {
    id: "prodigy", name: "Natural Talent", group: "development", eligible: "any",
    desc: "Everything comes easily to him — he improves faster than anyone around him.",
    influence: [{ label: "Youngsters at the club", detail: "+8% development speed" }],
    effects: { mentorBonus: 0.08 },
  },
];

export const TRAIT_MAP: Record<string, Trait> = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

/** Trait ids that are no longer part of the pool (v7). Migration scrubs these
 * from existing players so nothing dangles.
 *
 * Note `big_game` is NOT listed here any more: v19 reintroduces it as a real
 * trait, so scrubbing it would strip a trait the pool now defines. Anything
 * listed here must stay absent from TRAITS. */
export const RETIRED_TRAIT_IDS = ["poacher", "wall", "livewire"];

/** All trait ids that carry a given effect hook — small helper for the systems
 * that scan the squad (economy sponsors, development rollover) so they never
 * hard-code trait names. */
export function traitsWithEffect(key: keyof Trait["effects"]): string[] {
  return TRAITS.filter((t) => t.effects[key] !== undefined).map((t) => t.id);
}

const POS_GROUP: Record<Pos, TraitEligible> = {
  GK: "gk",
  CB: "def", LB: "def", RB: "def",
  DM: "mid", CM: "mid", LM: "mid", RM: "mid", AM: "mid",
  LW: "att", RW: "att", ST: "att",
};

/** Which position group a primary position belongs to (for trait eligibility). */
export function positionGroupOf(pos: Pos): TraitEligible {
  return POS_GROUP[pos] ?? "any";
}

/** Traits assignable to a player at a given primary position: "any" traits plus
 * those matching the player's position group. Keepers also draw from "def" so
 * a marshalling keeper is possible; everyone gets the universal set. */
export function traitsForPosition(pos: Pos): Trait[] {
  const group = positionGroupOf(pos);
  return TRAITS.filter((t) => t.eligible === "any" || t.eligible === group || (group === "gk" && t.eligible === "def"));
}

"use client";

// Tactics (§15.3): formation preset, mentality, style, lineup, synergy hints.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { DefLine, Focus, Mentality, PlayerBio, Pos, Press, Style, Tactic, TeamAssignments, Tempo, Width } from "@/lib/types";
import {
  BACK_LINE_LABEL,
  backLineOfGroup,
  FORMATION_GROUPS,
  formationGroupOf,
  getFormation,
  MENTALITY_OPTIONS,
  STYLE_OPTIONS,
  styleLabel,
} from "@/lib/config/formations";
import { instructionFitScore, profileForAttrs, type InstructionPrefs } from "@/lib/config/archetype";
import { positionFit } from "@/lib/config/positions";
import { TUNING } from "@/lib/config/tuning";
import { benchCap, selectionScore } from "@/lib/selection";

import { ensureUserLineup } from "@/lib/gameloop";
import { bestForRole, MAX_SAVED_TACTICS, savedTactics, tacticSummary } from "@/lib/tactics";
import {
  archetypesForPosition,
  deriveArchetype,
  ARCHETYPE_CLASS_BLURB,
  ARCHETYPE_CLASS_COLOR,
  ARCHETYPE_CLASS_LABEL,
  ARCHETYPE_CLASS_ORDER,
  type ArchetypeClass,
} from "@/lib/config/archetype";
import { briefBalance, hasBrief, pruneBrief } from "@/lib/tacticbrief";
import { assistantReport, instructionViewOf, squadBlueprint, type BlueprintSlot, type NoteTone, type ReportSlot, type SlotGrade } from "@/lib/assistant";
import { ConfirmButton, displayFullName, Flag, GhostButton, GoldButton, Modal, Ovr, ArchetypeIcon, ArchetypeLabel, PlayerSelect, PosBadge, Section, Select, Tabs, useIsMobile, type SelectOption } from "../ui";
import TacticsHelp from "./TacticsHelp";

const MENTALITIES = MENTALITY_OPTIONS;
const STYLES = STYLE_OPTIONS;
const TEMPOS: Tempo[] = ["Slow", "Standard", "High"];
const WIDTHS: Width[] = ["Narrow", "Standard", "Wide"];
const PRESSES: Press[] = ["Low", "Medium", "High"];
const LINES: DefLine[] = ["Deep", "Standard", "High"];
const FOCI: Focus[] = ["Left", "Central", "Right", "Wide", "Mixed"];

// Plain-language "what this does" copy for every instruction. Shown under each
// control so the user always knows how their choice bends the simulation. The
// hidden style/mentality counter system is deliberately NOT documented here.
const INSTRUCTION_INFO: Record<string, string> = {
  Mentality:
    "How much you commit forward. Attacking raises chances for BOTH teams; Defensive lowers both and tightens your shape.",
  Style:
    "How you play through the pitch. Each archetype thrives or suffers in a style (capped at ±10%) — a coherent squad matters.",
  Tempo:
    "Speed of play. High tempo creates more chances for both sides but drains fitness faster; Slow controls the game and saves legs.",
  Width:
    "Where you attack from. Wide gets more out of your full-backs and wingers; Narrow funnels play through the centre.",
  Press:
    "How aggressively you hunt the ball. High press wins more of the midfield battle but tires players and leaves a little more space behind.",
  "Defensive Line":
    "How high your back line sits. A High line squeezes the pitch but can be exposed in behind; a Deep line is solid but concedes territory.",
  Focus:
    "Which channel your attacks favour. Biases who gets the ball in the final third — pick a flank to feed a star winger, or Central for your 10.",
};

const OPTION_DETAIL: Record<string, string> = {
  Defensive: "Sit deeper, fewer chances both ways.",
  Balanced: "Even risk and control.",
  Attacking: "Push up, more chances both ways.",
  Possession: "Patient build-up; rewards passers & playmakers.",
  Counter: "Soak and break; rewards pace & direct runners.",
  Direct: "Go forward fast; rewards target men & physical play.",
  Gegenpress: "Win it back instantly, high up — dominant but exhausting.",
  ParkTheBus: "A defensive shell: concede the ball, concede almost nothing else.",
  WingPlay: "Attack through the flanks; goals come from wide areas.",
  Slow: "Fewer chances, less fatigue.",
  High: "More chances, more fatigue.",
  Narrow: "Overload the centre.",
  Wide: "Stretch the flanks.",
  Low: "Conserve energy, stay compact.",
  Medium: "Balanced pressing.",
  Deep: "Solid, concede space.",
  Left: "Attack down the left.",
  Central: "Attack through the middle.",
  Right: "Attack down the right.",
  Mixed: "No fixed bias.",
};

/** Focus needs its own copy for "Wide": the label is shared with the Width
 * instruction, where it means something quite different. */
const FOCUS_DETAIL: Partial<Record<Focus, string>> = {
  Wide: "Both flanks equally — feeds two wingers, not one.",
};

// ── Numeric effect labels ──────────────────────────────────────────────────
// Every instruction's real simulation effect, READ STRAIGHT OFF `TUNING` so the
// numbers on screen are the numbers the engine uses — retune in tuning.ts and
// these labels follow automatically. Deliberately NOT surfaced: the hidden
// style×mentality counter matrix (§6), which the UI must never reveal.
type Effect = { label: string; mult: number };

/** Render a multiplier (1.15) as a signed percentage ("+15%"). */
function pct(mult: number): string {
  const v = Math.round((mult - 1) * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** The measurable effects of one option, in engine terms. Empty = neutral. */
function effectsFor(label: string, option: string): Effect[] {
  const T = TUNING;
  const out: Effect[] = [];
  const push = (name: string, mult: number | undefined) => {
    if (typeof mult === "number" && Math.abs(mult - 1) >= 0.005) out.push({ label: name, mult });
  };
  switch (label) {
    case "Mentality":
      push("chances (both sides)", T.mentalityChanceMult[option as Mentality]);
      push("your defense", T.mentalityDefenseMult[option as Mentality]);
      break;
    case "Style": {
      // Beyond the per-player archetype synergy (handled specially by
      // EffectTags), each style carries an intrinsic shape (v19) — this is what
      // separates Gegenpress from Counter at the team level.
      const shape = T.styleShape?.[option as Style];
      if (shape) {
        push("your midfield", shape.midfield);
        push("your defense", shape.defense);
        push("chances conceded", shape.oppChance);
        push("fitness drain", shape.fitnessDrain);
        if (shape.wideBias) out.push({ label: "wide goal involvement", mult: 1 + shape.wideBias });
      }
      break;
    }
    case "Tempo":
      push("chances (both sides)", T.tempoChanceMult[option as Tempo]);
      push("fitness drain", T.tempoFitnessDrainMult[option as Tempo]);
      break;
    case "Width":
      push("wide roles (LB/RB/LW/RW)", T.widthWideMult[option as Width]);
      push("central roles", T.widthCentralMult[option as Width]);
      break;
    case "Press":
      push("your midfield", T.pressMidfieldMult[option as Press]);
      push("fitness drain", T.pressFitnessDrainMult[option as Press]);
      push("chances conceded", T.pressOppChanceMult[option as Press]);
      break;
    case "Defensive Line":
      push("your defense", T.lineDefenseMult[option as DefLine]);
      push("chances conceded", T.lineOppChanceMult[option as DefLine]);
      break;
    case "Focus":
      if (option === "Wide") {
        // Both flanks get the same lift a one-sided focus gives its own side.
        out.push({ label: "left & right goal involvement", mult: 1 + T.focusFlankBias });
      } else if (option !== "Mixed") {
        out.push({ label: `${option.toLowerCase()}-side goal involvement`, mult: 1 + T.focusFlankBias });
      }
      break;
  }
  return out;
}

/** Colour a multiplier by whether it helps or hurts. Costs (fatigue, chances
 *  conceded) invert: a number above 1 is a downside there, not an upside. */
const COST_EFFECTS = new Set(["fitness drain", "chances conceded"]);

/**
 * Style mastery (v1.77) — how well the XI plays the chosen style, as one word.
 *
 * This replaces the two tags that used to sit here ("per-player fit ±20% | your
 * XI avg +10.9%"), which stated the mechanism and the raw arithmetic and left
 * the player to decide whether +10.9% was good. The band is a fixed property of
 * the game, not of their team, so it was never news; the average only meant
 * something against a scale nobody was given.
 *
 * So: a bar, a word, and a percentage. The exact figure the bar was cut from
 * stays available on hover, which is where a number that precise belongs.
 */
function StyleMastery({ styleFit, style }: { styleFit?: number; style: string }) {
  if (typeof styleFit !== "number") {
    return <span className="text-[10px] text-faint">Pick your XI to see how well they play this style.</span>;
  }
  // The authored synergy band runs ±15%, and since v1.78 it is ZERO-CENTRED:
  // every class row sums to zero, so a random XI reads "Average" rather than the
  // "Excellent" the old positively-biased rows produced. The cuts below were
  // always written for a centred band — they only became correct here.
  const t = Math.max(0, Math.min(1, 0.5 + styleFit / 40));
  const [label, tone] =
    styleFit >= 10 ? ["Excellent", "text-win"]
    : styleFit >= 4 ? ["High", "text-win"]
    : styleFit >= -2 ? ["Average", "text-dim"]
    : styleFit >= -6 ? ["Low", "text-loss"]
    : ["Poor", "text-loss"];
  const color = styleFit >= 4 ? "var(--color-win)" : styleFit >= -2 ? "#9aa4b2" : "var(--color-loss)";
  return (
    <span
      className="flex items-center gap-2 text-[10px] text-faint"
      title={`Average class synergy across your XI in ${style}: ${styleFit > 0 ? "+" : ""}${styleFit.toFixed(1)}% (each player is capped at ±${Math.round(TUNING.synergyCap * 100)}%)`}
    >
      <span>Style mastery</span>
      <span className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-raised">
        <span className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${t * 100}%`, background: color }} />
      </span>
      <b className={tone}>{label}</b>
      <span className="tnum text-faint">({Math.round(t * 100)}%)</span>
    </span>
  );
}

function EffectTags({ label, option, styleFit }: { label: string; option: string; styleFit?: number }) {
  // Style is per-player, so instead of a team multiplier we show how well the
  // current XI actually plays it.
  if (label === "Style") return <StyleMastery styleFit={styleFit} style={styleLabel(option as Style)} />;

  const effects = effectsFor(label, option);
  if (effects.length === 0) {
    // Every multiplier for this option is exactly 1.0 — the neutral baseline the
    // others are measured against. Said briefly: all five advanced dials default
    // here, so the long form was the same sentence five times down one panel,
    // crowding out the roles readout beneath it, which is the line that actually
    // differs per dial.
    return <span className="text-[10px] text-faint">baseline — no modifier</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {effects.map((e) => {
        const isCost = COST_EFFECTS.has(e.label);
        const good = isCost ? e.mult < 1 : e.mult > 1;
        const tone = Math.abs(e.mult - 1) < 0.005 ? "text-faint" : good ? "text-win" : "text-loss";
        return (
          <span key={e.label} className="rounded-sm border border-line px-1 py-px text-[10px] text-faint">
            {e.label} <b className={`tnum ${tone}`}>{pct(e.mult)}</b>
          </span>
        );
      })}
    </span>
  );
}

function synergyOf(p: PlayerBio, style: Style): number {
  const raw = profileForAttrs(p.attrs, p.positions[0]).styleSynergy[style];
  return Math.max(1 - TUNING.synergyCap, Math.min(1 + TUNING.synergyCap, raw));
}

function SynergyDot({ p, style }: { p: PlayerBio; style: Style }) {
  const s = synergyOf(p, style);
  const pct = Math.round((s - 1) * 100);
  if (pct > 2) return <span className="text-win" title={`+${pct}% in ${styleLabel(style)}`}>▲</span>;
  if (pct < -2) return <span className="text-loss" title={`${pct}% in ${styleLabel(style)}`}>▼</span>;
  return <span className="text-faint" title="Neutral">•</span>;
}

/** A labelled segmented control with a "what this does" line beneath it. */
/**
 * How the XI's own roles feel about the setting currently selected (v1.78).
 *
 * The five advanced dials became an ARCHETYPE-level question in v1.78, and
 * without this the whole layer is invisible on the screen where it is chosen —
 * `EffectTags` above shows only the team-level multiplier from TUNING. This is
 * the point of contact between the decision and its consequence: change the
 * dial and watch the counts move.
 */
/** How many of the XI want / reject one setting on one axis. */
function tallyAxis(xi: ReportSlot[], axis: keyof InstructionPrefs, value: string) {
  let want = 0;
  let hate = 0;
  const wanters: string[] = [];
  const haters: string[] = [];
  for (const s of xi) {
    const pref = profileForAttrs(s.player.attrs, s.slotPos).instructionPrefs[axis] as
      | { likes?: readonly string[]; dislikes?: readonly string[] }
      | undefined;
    if (!pref) continue;
    const name = deriveArchetype(s.player.attrs, s.slotPos)?.name ?? s.slotPos;
    if (pref.likes?.includes(value)) {
      want++;
      wanters.push(name);
    } else if (pref.dislikes?.includes(value)) {
      hate++;
      haters.push(name);
    }
  }
  return { want, hate, wanters, haters };
}

/**
 * The squad's verdict on the SELECTED setting, as a diverging bar (v1.79).
 *
 * v1.78 shipped this as a sentence ("4 of your XI want this · 2 don't"), which
 * was accurate and completely flat: two numbers in prose that the eye has to
 * parse before it can compare. A diverging bar answers "is this setting good for
 * my side?" pre-attentively, and the names on hover answer "who?" — which is the
 * only follow-up question, and the one the sentence could never fit.
 */
function RolesLine({
  axis,
  value,
  options,
  xi,
}: {
  axis: keyof InstructionPrefs;
  value: string;
  options: readonly string[];
  xi: ReportSlot[];
}) {
  const { want, hate, wanters, haters } = useMemo(() => tallyAxis(xi, axis, value), [axis, value, xi]);

  // Which option this XI would actually prefer. Every dial defaults to a
  // "Standard" that no archetype names, so without this the panel opens with
  // five identical "no one minds" lines in exactly the state a new game starts
  // in — informative only once the manager has already changed something.
  const best = useMemo(() => {
    if (xi.length === 0) return undefined;
    let top: { option: string; net: number } | undefined;
    for (const o of options) {
      const { want: w, hate: h } = tallyAxis(xi, axis, o);
      if (w === 0 && h === 0) continue;
      if (!top || w - h > top.net) top = { option: o, net: w - h };
    }
    return top && top.net > 0 && top.option !== value ? top : undefined;
  }, [axis, options, value, xi]);

  if (xi.length === 0) return null;
  if (want === 0 && hate === 0) {
    return (
      <span className="text-[10px] text-faint">
        No one in your XI minds either way.
        {best && (
          <>
            {" "}
            <b className="text-win">{best.option}</b> would suit {best.net} of them.
          </>
        )}
      </span>
    );
  }
  // Scaled against the loudest voice on this axis, not against eleven: a dial
  // only three roles have an opinion about should still fill its bar.
  const span = Math.max(want, hate, 3);
  const net = want - hate;
  return (
    <span
      className="flex items-center gap-2 text-[10px]"
      title={[
        wanters.length ? `Wants it: ${wanters.join(", ")}` : "",
        haters.length ? `Fighting it: ${haters.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {/* Two bars growing out from a shared centre line. */}
      <span className="flex h-2 w-24 shrink-0 items-center">
        <span className="flex h-full flex-1 justify-end">
          <span className="h-full rounded-l-sm bg-loss/70" style={{ width: `${(hate / span) * 100}%` }} />
        </span>
        <span className="h-full w-px shrink-0 bg-line" />
        <span className="flex h-full flex-1">
          <span className="h-full rounded-r-sm bg-win/70" style={{ width: `${(want / span) * 100}%` }} />
        </span>
      </span>
      <span className={net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-faint"}>
        {want > 0 && `${want} want${want === 1 ? "s" : ""} this`}
        {want > 0 && hate > 0 && " · "}
        {hate > 0 && `${hate} ${hate === 1 ? "doesn't" : "don't"}`}
      </span>
      {/* Only when another option is strictly better for this XI — otherwise the
          current pick already is the best one and saying so is noise. */}
      {best && (
        <span className="text-faint">
          → <b className="text-win">{best.option}</b> suits {best.net} more
        </span>
      )}
    </span>
  );
}

/**
 * A dot on each unselected option showing what the XI would make of it (v1.79).
 *
 * The bar above reports the setting you already chose; this is what makes the
 * choice comparable without clicking through all three. Green means more of your
 * roles want that option than fight it — so the best setting for the side you
 * picked is visible on the button itself, which is the whole point of moving the
 * instructions to archetype level.
 */
function OptionMood({ axis, value, xi }: { axis: keyof InstructionPrefs; value: string; xi: ReportSlot[] }) {
  const { want, hate } = useMemo(() => tallyAxis(xi, axis, value), [axis, value, xi]);
  const net = want - hate;
  if (want === 0 && hate === 0) return null;
  return (
    <span
      className={`ml-1 align-middle text-[9px] ${net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-faint"}`}
      title={`${want} of your XI want this, ${hate} don't`}
      aria-hidden
    >
      {net > 0 ? "▲" : net < 0 ? "▼" : "•"}
    </span>
  );
}

/**
 * What the five advanced dials are worth to this XI, as one line (v1.79).
 *
 * Shown on the Basic tab, where the advanced instructions are otherwise a tab
 * label with nothing on it. Reads the same `instructionFitScore` the engine
 * multiplies onto each player's rating, averaged across the XI and expressed as
 * the percentage swing it actually is — so "worth +2.1%" is a real figure, not a
 * proxy, and a manager can decide from the Basic tab whether fine-tuning is
 * worth their time.
 */
function InstructionSummary({ xi, tactic, onOpen }: { xi: ReportSlot[]; tactic: Tactic; onOpen: () => void }) {
  const { pct, worst } = useMemo(() => {
    if (xi.length === 0) return { pct: 0, worst: undefined as undefined | { name: string; score: number } };
    const view = instructionViewOf(tactic);
    let sum = 0;
    let worst: { name: string; score: number } | undefined;
    for (const s of xi) {
      const prof = profileForAttrs(s.player.attrs, s.slotPos);
      const score = instructionFitScore(prof.instructionPrefs, view);
      sum += score;
      const name = deriveArchetype(s.player.attrs, s.slotPos)?.name;
      if (name && score < 0 && (!worst || score < worst.score)) worst = { name, score };
    }
    return { pct: (sum / xi.length) * TUNING.instructionFitSwing * 100, worst };
  }, [xi, tactic]);

  if (xi.length === 0) return null;
  const tone = pct >= 0.5 ? "text-win" : pct <= -0.5 ? "text-loss" : "text-faint";
  return (
    <p className="text-[10px] leading-snug text-faint">
      Your roles make these dials worth{" "}
      <b className={`tnum ${tone}`}>
        {pct > 0 ? "+" : ""}
        {pct.toFixed(1)}%
      </b>
      {worst ? (
        <>
          {" "}— your <b className="text-dim">{worst.name}</b> is fighting them.{" "}
          <button onClick={onOpen} className="text-dim underline underline-offset-2 hover:text-ink">
            Fix
          </button>
        </>
      ) : (
        " across the XI."
      )}
    </p>
  );
}

/**
 * One dial (v1.84 rework).
 *
 * Every version of this control up to v1.83 rendered FIVE things at once: a
 * label, the selected option's blurb, the buttons, a row of effect tags, a
 * diverging roles bar, and a paragraph explaining what the dial is. Multiply by
 * the five advanced dials and the panel became roughly thirty lines of prose
 * and micro-charts wrapped around fifteen buttons — every line accurate, and
 * collectively unreadable. Nobody tuning a defensive line needs to be told what
 * a defensive line is, every time, forever.
 *
 * So the dial is now a LABEL AND ITS BUTTONS, and nothing else. Everything that
 * used to sit underneath still exists and is one click away behind the ⓘ on the
 * label row — the same information, opened when it is wanted rather than
 * broadcast when it isn't. The two signals that genuinely belong ON the control
 * stay inline, because they are how you compare options without opening
 * anything: the mood dot on each unselected button, and the blurb of whatever
 * is currently selected.
 */
function Instruction<T extends string>({
  label,
  options,
  current,
  onPick,
  styleFit,
  axis,
  xi,
}: {
  label: string;
  options: readonly T[];
  current: T;
  onPick: (v: T) => void;
  /** Style row only: the current XI's average synergy, as a percentage. */
  styleFit?: number;
  /** Advanced-dial rows only: which axis this is, for the roles readout. */
  axis?: keyof InstructionPrefs;
  xi?: ReportSlot[];
}) {
  const [detail, setDetail] = useState(false);
  // Focus overrides the shared copy for "Wide" (Width uses the same word for a
  // different idea); Style renders presentable names for its camel-case ids.
  const detailFor = (o: string) =>
    (label === "Focus" ? FOCUS_DETAIL[o as Focus] : undefined) ?? OPTION_DETAIL[o] ?? "";
  const textFor = (o: string) => (label === "Style" ? styleLabel(o) : o);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="shrink-0 text-[11px] uppercase tracking-widest text-faint">{label}</span>
        {/* The selected option's own one-liner stays inline: it is the caption
            to the choice, not an explanation of the dial. */}
        <span className="min-w-0 flex-1 truncate text-[10px] text-faint" title={detailFor(current)}>
          {detailFor(current)}
        </span>
        <button
          onClick={() => setDetail((v) => !v)}
          aria-expanded={detail}
          title={`What ${label} does, and what your XI makes of it`}
          className={`display shrink-0 rounded-full border px-1.5 text-[10px] leading-[1.35] transition-colors ${
            detail ? "border-gold text-gold" : "border-line text-faint hover:border-faint hover:text-dim"
          }`}
        >
          i
        </button>
      </div>
      {/* Wrap rather than a single row: Style now offers six options, which do
          not fit side by side on a phone. */}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onPick(o)}
            title={detailFor(o)}
            className={`display min-w-[5.5rem] flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
              current === o ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
            }`}
          >
            {textFor(o)}
            {/* What the XI makes of the options you HAVEN'T picked. This one
                signal stays inline at all times: it is what makes the buttons
                comparable at a glance, which is the whole reason the rest can
                be folded away. */}
            {axis && xi && current !== o && <OptionMood axis={axis} value={o} xi={xi} />}
          </button>
        ))}
      </div>

      {detail && (
        <div className="mt-2 space-y-1.5 rounded-md border border-line/60 bg-raised px-2.5 py-2">
          <p className="text-[11px] leading-snug text-dim">{INSTRUCTION_INFO[label]}</p>
          {/* live numbers for the SELECTED option, straight from TUNING, and
              what the ROLES you have picked make of it (v1.78). Each on its own
              line: both can render as a bare inline span ("baseline — no
              modifier", "No one in your XI minds either way"), and side by side
              those two run together into one nonsense sentence. */}
          <div>
            <EffectTags label={label} option={current} styleFit={styleFit} />
          </div>
          {axis && xi && (
            <div>
              <RolesLine axis={axis} value={current} options={options} xi={xi} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── On-pitch assignments (v6): captain + set-piece takers (EA-FC style) ─────
const ASSIGNMENT_ROLES: { role: keyof TeamAssignments; label: string; hint: string; wants: string }[] = [
  { role: "captainId", label: "Captain", hint: "A Leader captain lifts the whole side on match day.", wants: "leader" },
  { role: "penaltyTakerId", label: "Penalty Taker", hint: "Steps up from the spot. A Dead-Ball Specialist rarely misses.", wants: "dead_ball" },
  { role: "freeKickTakerId", label: "Free-Kick Taker", hint: "Takes direct free-kicks near goal.", wants: "dead_ball" },
  { role: "cornerTakerId", label: "Corner Taker", hint: "Whips in corners — creates chances for the tall lads.", wants: "maestro" },
];

function Assignments() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setAssignment = useGame((s) => s.setAssignment);
  const autoAssign = useGame((s) => s.autoAssign);
  const team = game.teams[game.userTeamId];
  const assignments = team.assignments ?? {};

  // pick takers/captain from the current XI so an unavailable player never holds a role
  const xi = Object.values(game.lineup)
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired);

  return (
    <Section
      title="Assignments"
      right={
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">captain &amp; set pieces</span>
          <GhostButton onClick={autoAssign} disabled={xi.length === 0} className="!px-2.5 !py-1 text-[11px]">
            Auto-assign
          </GhostButton>
        </div>
      }
    >
      {xi.length === 0 ? (
        <div className="rounded-md border border-line bg-surface px-3 py-3 text-sm text-faint">
          Pick your lineup first — assignments are chosen from your starting XI.
        </div>
      ) : (
        <div className="space-y-2">
          {ASSIGNMENT_ROLES.map(({ role, label, hint, wants }) => {
            const currentId = assignments[role];
            const current = currentId ? game.players[currentId] : null;
            const hasTrait = current?.traits.includes(wants);
            // What Auto-assign would choose for this row. Shown when it differs
            // from the current holder, so the recommendation is visible without
            // having to press the button to find out what it thinks.
            const best = bestForRole(game, role);
            return (
              <div key={role} className="rounded-md border border-line bg-surface px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-[11px] uppercase tracking-widest text-faint">{label}</span>
                  {/* flag + position tag visible in the picker (v7) */}
                  <PlayerSelect players={xi} value={currentId ?? null} onChange={(id) => setAssignment(role, id)} />
                  {hasTrait && <span className="display shrink-0 rounded-sm border border-gold-lo/50 px-1.5 text-[9px] font-semibold text-gold">IDEAL</span>}
                </div>
                <p className="mt-1 pl-[7.75rem] text-[11px] leading-snug text-faint">
                  {hint}
                  {best && best.id !== currentId && (
                    <>
                      {" "}
                      <button
                        onClick={() => setAssignment(role, best.id)}
                        className="text-gold underline decoration-dotted hover:text-gold-hi"
                        title={`Give ${displayFullName(best)} this role`}
                      >
                        Best fit: {best.name}
                      </button>
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── Drag & drop (v1.5) ─────────────────────────────────────────────────────
// Lineup and substitutions are now arranged by dragging players — a pitch token
// onto another pitch token to swap the two, a bench/squad player onto a pitch
// slot to field him, a starter onto the bench to drop him out.
//
// This is deliberately hand-rolled on pointer events rather than the HTML5 drag
// API. HTML5 drag doesn't fire on touch at all, and this game is played on
// phones as much as desktops (there's a dedicated mobile UI test); pointer
// events are one code path for mouse, touch and pen. The cost is that we render
// our own drag image, which is the floating token below.
//
// Everything remains reachable without dragging: every slot and bench row is
// still a button that opens the existing picker modal, so keyboard and
// screen-reader users lose nothing.

/** What is being dragged: a player, and where he came from. */
type DragSource =
  | { kind: "slot"; playerId: string; slotId: string }
  | { kind: "bench"; playerId: string; index: number }
  | { kind: "squad"; playerId: string };

/** Where a drag is currently hovering. The squad pool is a drop target in its
 * own right (v1.63), so dragging a starter or a sub back onto the list is how
 * you take him out of the matchday squad — the reverse of the gesture that put
 * him there, rather than hunting for a separate control. */
type DropTarget =
  | { kind: "slot"; slotId: string }
  | { kind: "bench"; index: number }
  | { kind: "squad" }
  | null;

interface DragState {
  source: DragSource;
  /** Viewport coords of the floating token. */
  x: number;
  y: number;
  /** True once the pointer has moved past the slop threshold — below it the
   * gesture is still a tap and should open the picker instead. */
  active: boolean;
  target: DropTarget;
}

/** Pointer travel (px) before a press becomes a drag rather than a tap. Small
 * enough to feel immediate, large enough that a jittery tap still counts as a
 * tap on a touchscreen. */
const DRAG_SLOP = 6;

/** Drop zones register themselves here, so hit-testing is a plain geometric
 * scan — no dependency on pointer-events or elementFromPoint, which the
 * floating drag token would otherwise sit on top of and block.
 *
 * Keyed by a STRING identity of the target rather than by the DOM node. The ref
 * callbacks are created inline during render, so React detaches and reattaches
 * every zone on each re-render — and a drag re-renders on every pointermove.
 * Keying by node meant an attach could be undone by the matching detach that
 * followed it, leaving the map empty exactly while a drag was in flight. */
type ZoneMap = Map<string, { node: HTMLElement; target: Exclude<DropTarget, null> }>;

/**
 * Stable string key for a registered zone — the map's identity.
 *
 * The same drop TARGET is offered by two different surfaces: a formation slot is
 * both a token on the pitch and a row in the Starting XI list, and dropping on
 * either must field the player in that slot. They therefore need distinct keys
 * but identical targets, which is what `surface` separates. Keying on the target
 * alone would let the list's registration overwrite the pitch's, and the pitch —
 * the surface you actually drag onto — would stop accepting drops.
 */
function zoneKey(t: Exclude<DropTarget, null>, surface: string): string {
  const id = t.kind === "slot" ? `slot:${t.slotId}` : t.kind === "bench" ? `bench:${t.index}` : "squad";
  return `${surface}/${id}`;
}

/**
 * The whole drag interaction, as one hook.
 *
 * Returns `begin` (call from onPointerDown on anything draggable), the live
 * drag state for rendering, and `registerZone` (a ref callback drop zones use to
 * publish their bounds). The drop itself is delegated to `onDrop` so the store
 * actions stay in the component that owns them.
 */
function useLineupDrag(onDrop: (source: DragSource, target: Exclude<DropTarget, null>) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const zones = useRef<ZoneMap>(new Map());
  // The live drag lives in a ref as well as state: the pointer handlers are
  // bound once and must read the current value without re-subscribing on frame.
  const dragRef = useRef<DragState | null>(null);
  const setDragBoth = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const registerZone = useCallback((target: Exclude<DropTarget, null>, surface = "pitch") => {
    const key = zoneKey(target, surface);
    return (node: HTMLElement | null) => {
      // Attach writes the current node; detach only clears the entry if the node
      // it held has actually left the document. That ordering is what makes this
      // safe when React reattaches every ref mid-drag (a drag re-renders on each
      // pointermove): a stale detach can no longer wipe the fresh registration
      // that has already replaced it.
      if (node) zones.current.set(key, { node, target });
      else if (zones.current.get(key)?.node.isConnected === false) zones.current.delete(key);
    };
  }, []);

  /** Which registered zone is under (x, y), if any. Slots and bench rows are
   * checked before the squad pool: the pool is a large container that can
   * overlap the smaller zones, and the specific target must win. */
  const hitTest = useCallback((x: number, y: number): DropTarget => {
    let pool: DropTarget = null;
    for (const { node, target } of zones.current.values()) {
      if (!node.isConnected) continue;
      const r = node.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (target.kind === "squad") pool = target;
      else return target;
    }
    return pool;
  }, []);

  const begin = useCallback(
    (source: DragSource, e: React.PointerEvent) => {
      // Left button / touch / pen only — a right-click must not start a drag.
      if (e.button !== 0) return;
      setDragBoth({ source, x: e.clientX, y: e.clientY, active: false, target: null });
    },
    [setDragBoth]
  );

  useEffect(() => {
    if (!drag) return;
    const origin = { x: drag.x, y: drag.y };

    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const far =
        cur.active || Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > DRAG_SLOP;
      setDragBoth({
        ...cur,
        x: e.clientX,
        y: e.clientY,
        active: far,
        target: far ? hitTest(e.clientX, e.clientY) : null,
      });
    };

    const up = (e: PointerEvent) => {
      const cur = dragRef.current;
      setDragBoth(null);
      if (!cur || !cur.active) return; // a tap — the button's onClick handles it
      const target = hitTest(e.clientX, e.clientY);
      if (target) onDrop(cur.source, target);
    };

    const cancel = () => setDragBoth(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    // Bound once per drag gesture; movement updates flow through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.source.playerId, hitTest, onDrop, setDragBoth]);

  // While dragging, suppress the browser's own touch scrolling and text
  // selection — otherwise a drag down the pitch scrolls the page instead.
  useEffect(() => {
    if (!drag?.active) return;
    const prevTouch = document.body.style.touchAction;
    const prevSelect = document.body.style.userSelect;
    document.body.style.touchAction = "none";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.touchAction = prevTouch;
      document.body.style.userSelect = prevSelect;
    };
  }, [drag?.active]);

  return { drag: drag?.active ? drag : null, pending: drag, begin, registerZone };
}

/** The token that follows the pointer during a drag. Rendered fixed to the
 * viewport and pointer-transparent so it never becomes its own drop target. */
function DragGhost({ p, x, y }: { p: PlayerBio; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-2 rounded-full border border-gold-lo bg-raised px-2.5 py-1.5 shadow-2xl ring-2 ring-gold/30">
        <span className="display flex h-8 w-8 items-center justify-center rounded-full bg-hover text-sm font-bold text-ink tnum">
          {p.overall}
        </span>
        <span className="max-w-32 truncate pr-1 text-xs font-semibold text-ink">{p.name}</span>
      </div>
    </div>
  );
}

/**
 * The pitch token's shape (v1.99).
 *
 * A circle, at the hexagon's size — v1.98 clipped it to a hex to echo the
 * archetype artwork's frame, and at 44px on a dark pitch the flats read as a
 * badge rather than as a player. Everything the hex carried is unchanged: the
 * border is still position fit, the wash behind the rating is still the class.
 *
 * Still a CSS `clip-path` rather than `border-radius`, because it is applied to
 * the drag GUIDE as well as the token, and the guide is a plain box the drag
 * hit-testing measures by bounding box. One constant, so the token, the guide
 * and the legend swatches can never disagree about what shape a player is.
 */
const TOKEN_CLIP = "circle(50% at 50% 50%)";

/**
 * The archetype class a player reads as in the slot he is FILLING (v1.77),
 * resolved exactly as the engine and the assistant's report do so all three
 * agree about what he is being asked to be. Null when no archetype derives.
 */
function classOf(p: PlayerBio, slotPos: Pos): ArchetypeClass | null {
  return deriveArchetype(p.attrs, slotPos)?.cls ?? null;
}

/**
 * The class colour INSIDE the token (v1.98), not a badge floating off it.
 *
 * The v1.77 corner dot answered the right question in the wrong glyph: parked
 * at the token's top-right with its own glow it read as an unread-message
 * badge, i.e. as a transient alert rather than as what the player permanently
 * IS. It is now a fill — a soft radial wash of the class colour behind the
 * rating — so being a Creator is a property of the node rather than something
 * stuck to it. Low opacity on purpose: the rating is still the thing the eye
 * lands on, and five of these on a pitch at full strength is a fruit salad.
 *
 * The palette is the shared one every other surface uses (ARCHETYPE_CLASS_COLOR),
 * so the association a manager learns in the squad list is the same one here.
 */
function classFill(cls: ArchetypeClass | null): string {
  if (!cls) return "transparent";
  const c = ARCHETYPE_CLASS_COLOR[cls];
  return `radial-gradient(circle at 50% 35%, ${c}2e 0%, ${c}14 55%, transparent 100%)`;
}

/**
 * Colour a player token by how well he fits the slot he's standing in.
 *
 * The rings carry the fit ALONE now (v1.98) — the red "ADAPTED" caption under
 * every misplaced player is gone. Three tokens' worth of loud red text under a
 * back four said nothing the ring above it hadn't already, and it was the
 * noisiest thing on a screen whose job is to be scanned. To make the ring able
 * to carry it unaided the border is thicker and an out-of-position token is
 * also FADED (see `fitOpacity`), which is the reading a manager already has for
 * "this man is less effective here".
 */
function fitRing(fit: number): string {
  if (fit >= 1) return "border-2 border-gold-lo";
  if (fit > TUNING.outOfPositionFloor) return "border-2 border-draw/80";
  return "border-2 border-loss";
}

/** Out-of-position players are drawn faded — the wordless version of the
 * caption this replaced. An adapted player is only slightly dimmed; a genuine
 * out-of-position one drops far enough to read as a problem at a glance. */
function fitOpacity(fit: number): string {
  if (fit >= 1) return "";
  if (fit > TUNING.outOfPositionFloor) return "opacity-80";
  return "opacity-60";
}

/**
 * The pitch markings (v1.98), shared by the desktop board and the phone's
 * read-only diagram so the two can never drift apart.
 *
 * A spotlight and dashed lines rather than a flat box of hairlines: a radial
 * wash lifts the centre a shade above the page black and falls away to nothing
 * at the corners, which puts the eye on the formation rather than on the frame.
 * The lines are dashed and faint with a soft glow, so the pitch reads as a
 * tactical screen being drawn on rather than as a vector clip-art football
 * pitch. Purely decorative — `aria-hidden`, pointer-transparent, and never a
 * drop target.
 */
const PITCH_LINE = "rgba(255,255,255,0.15)";
const PITCH_GLOW = "drop-shadow(0 0 3px rgba(226,181,63,0.16))";

function PitchMarkings() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ filter: PITCH_GLOW }}
    >
      {/* Spotlight: brightest over the centre circle, black at the corners. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 50%, rgba(120,190,150,0.10) 0%, rgba(20,40,30,0.05) 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <div
        className="absolute inset-x-[12%] top-0 h-[14%] rounded-b border border-t-0"
        style={{ borderColor: PITCH_LINE, borderStyle: "dashed" }}
      />
      <div
        className="absolute inset-x-[12%] bottom-0 h-[14%] rounded-t border border-b-0"
        style={{ borderColor: PITCH_LINE, borderStyle: "dashed" }}
      />
      <div
        className="absolute inset-x-0 top-1/2 border-t"
        style={{ borderColor: PITCH_LINE, borderStyle: "dashed" }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ borderColor: PITCH_LINE, borderStyle: "dashed" }}
      />
    </div>
  );
}

/**
 * A player (or an empty slot) as drawn on the pitch — the one definition both
 * boards use (v1.98).
 *
 * Four readings from one node, and every one of them is now INSIDE the glyph
 * rather than hung off it: the token's border is position fit, its whole
 * opacity repeats that fit, the wash behind the rating is his archetype class,
 * and the rating itself is the display face. Underneath, the position and the
 * surname sit on a dark pill so they read as a label on a tactical board rather
 * than text floating in the dark.
 */
function PitchToken({
  p,
  slot,
  fit,
  isTarget,
  isSource,
}: {
  p: PlayerBio | null;
  slot: { label: string; pos: Pos };
  fit: number;
  isTarget?: boolean;
  isSource?: boolean;
}) {
  const cls = p ? classOf(p, slot.pos) : null;
  return (
    <>
      {p ? (
        <span
          className={`display relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-sm font-bold transition-all ${fitRing(fit)} ${fitText(fit)} ${
            isSource ? "opacity-30" : fitOpacity(fit)
          } ${isTarget ? "scale-110 !border-gold" : ""}`}
          style={{ clipPath: TOKEN_CLIP, background: "#16181d" }}
          title={cls ? `${cls} — ${ARCHETYPE_CLASS_BLURB[cls]}` : undefined}
        >
          {/* The class wash, behind the number and clipped to the same circle.
              `rounded-full` on the wash as well as the parent: the parent's
              border sits OUTSIDE its padding box, so an `inset-0` child squares
              off the corners the border curves around and the wash reads as a
              dark box inside a ring. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ background: classFill(cls) }}
          />
          <span className="relative">{p.overall}</span>
        </span>
      ) : (
        <span
          className={`display flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-dashed border-line text-sm font-bold text-faint transition-all ${
            isTarget ? "scale-110 border-solid !border-gold" : ""
          }`}
          style={{ clipPath: TOKEN_CLIP, background: "#101216" }}
        >
          {slot.label}
        </span>
      )}
      {/* Name plate. A pill grounds the text against the pitch, and the two
          facts are ranked: the position is muted grey, the surname crisp. A
          40px token is the one place a full name genuinely will not go — the
          surname alone is what a shirt carries.
          `max-w-full` against the slot's own 4rem box, so a long surname
          truncates INSIDE its plate rather than widening it into the plate of
          whoever is standing beside him — the midfield of a 5-3-2 puts three
          tokens close enough together for that to overlap. */}
      <span
        className={`mt-1 flex max-w-full items-center gap-1 overflow-hidden rounded-full border border-line/70 bg-[#16181d]/90 px-1.5 py-0.5 leading-none ${
          p ? fitOpacity(fit) : ""
        }`}
      >
        <span
          className={`display shrink-0 text-[8px] font-bold uppercase leading-none tracking-wider ${
            !p || fit >= 1 ? "text-faint" : fit > TUNING.outOfPositionFloor ? "text-draw" : "text-loss"
          }`}
        >
          {slot.label}
        </span>
        {p && (
          <span className="min-w-0 truncate text-[10px] font-semibold leading-none text-ink">
            {p.name.split(" ").slice(-1)[0]}
          </span>
        )}
      </span>
    </>
  );
}

/**
 * What the token borders mean (v1.99) — ONE definition, like `PitchToken` and
 * `PitchMarkings` beside it. The desktop board and the phone diagram shipped a
 * copy each, which is exactly how the hexagon change had to be made in two
 * places and how a third would have been missed.
 */
function FitLegend() {
  const swatches: [string, string][] = [
    ["border-gold-lo", "natural"],
    ["border-draw/80 opacity-80", "adapted"],
    ["border-loss opacity-60", "out of position"],
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-faint">
      {swatches.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-full border-2 ${cls}`} style={{ clipPath: TOKEN_CLIP }} /> {label}
        </span>
      ))}
    </div>
  );
}

/** Colour the RATING inside a token by position fit (v1.66) — the ring already
 * carries fit, but a number that turns red is what actually catches the eye when
 * you are scanning eleven tokens for the one man playing out of position. */
function fitText(fit: number): string {
  if (fit >= 1) return "text-ink";
  if (fit > TUNING.outOfPositionFloor) return "text-draw";
  return "text-loss";
}

/**
 * Condition colour, green → amber → red as fitness falls (v1.66).
 *
 * The outer condition ARC that used to wrap each pitch token is gone (v1.69) —
 * two concentric rings around a 40px circle, one for position fit and one for
 * stamina, was more ink than either question was worth, and it made the pitch
 * read as a field of dials. The colour itself still earns its keep in the roster
 * list, where condition is a column you scan down.
 */
function conditionColor(fitness: number): string {
  if (fitness >= 85) return "#3fb950";
  if (fitness >= 70) return "#d0a215";
  if (fitness >= 50) return "#d97706";
  return "#da3633";
}

/**
 * The phone lineup (v1.64): the same side, picked entirely by tapping.
 *
 * A phone gets no squad pool and no drag surface. Dragging a token across a
 * 390px screen means fighting the page scroll for a target the size of a
 * fingertip, and the squad pool below it is a second scroll container inside
 * the first — the gesture that reads well with a mouse is the worst way to do
 * this on a touchscreen. So the phone keeps only what a tap can drive: the XI
 * as a list of slots, each opening the existing picker, and the bench with an
 * Auto-pick and a remove button per row.
 *
 * Nothing here is phone-only capability — it is the same store actions and the
 * same picker modal the desktop board falls back to when you tap rather than
 * drag. The pitch diagram is kept (it is read-only on a phone, but it is how
 * you see your shape); what's dropped is the dragging, not the information.
 */
function MobileLineup({
  onPickSlot,
  onOpenPlayer,
}: {
  onPickSlot: (slotId: string) => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const dropFromMatchday = useGame((s) => s.dropFromMatchday);
  const autoBench = useGame((s) => s.autoBench);
  const clearBench = useGame((s) => s.clearBench);
  const clearLineup = useGame((s) => s.clearLineup);
  const bump = useGame((s) => s.bump);

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  const cap = benchCap(TUNING);

  const inLineup = new Set(Object.values(game.lineup));
  const benchIds = (game.userBench ?? []).filter(
    (id) => !inLineup.has(id) && game.players[id] && !game.players[id].loan
  );
  const benched = benchIds.map((id) => game.players[id]).filter((p): p is PlayerBio => !!p);

  const autoPick = () => {
    game.lineup = {};
    ensureUserLineup(game);
    bump(true);
  };

  const filled = Object.values(game.lineup).filter((id) => game.players[id]).length;

  const startersScore =
    Object.entries(game.lineup).reduce((sum, [slotId, pid]) => {
      const p = game.players[pid];
      const slot = formation.slots.find((s) => s.id === slotId);
      if (!p || !slot) return sum;
      return (
        sum +
        p.overall *
          positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor) *
          synergyOf(p, tactic.style)
      );
    }, 0) / Math.max(1, Object.keys(game.lineup).length);

  return (
    <>
      {/* Shape, read-only — the pitch is still the clearest picture of the side. */}
      <Section
        title="Lineup"
        right={
          <div className="flex items-center gap-3">
            <span className="text-xs text-faint">
              <span className="display tnum text-sm text-ink">{filled}</span>/11 picked
            </span>
            <GhostButton onClick={autoPick} className="!px-3 !py-1 text-xs">
              Auto-pick
            </GhostButton>
            {/* Emptying the XI is a two-tap decision (v1.80) — eleven picks are
                too much work to lose to a stray tap, and there is no undo. */}
            <ConfirmButton
              label="Clear"
              confirmLabel="Sure?"
              tone="danger"
              onConfirm={clearLineup}
              disabled={filled === 0}
              className="!px-3 !py-1 !text-xs"
            />
          </div>
        }
      >
        <div
          className="relative mx-auto aspect-[3/4] w-full max-w-md select-none overflow-hidden rounded-md border border-line"
          style={{ background: "linear-gradient(180deg, #0e1512 0%, #0c110e 100%)" }}
        >
          <PitchMarkings />

          {formation.slots.map((slot) => {
            const pid = game.lineup[slot.id];
            const p = pid ? game.players[pid] : null;
            const fit = p
              ? positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor)
              : 1;
            return (
              <div
                key={slot.id}
                className="absolute -translate-x-1/2 translate-y-1/2"
                // Same compressed 6–94% band as the desktop board: the token is
                // a token plus a name plate, and the pitch clips its overflow, so
                // a keeper at y=4% loses his plate off the bottom edge.
                style={{ left: `${slot.x}%`, bottom: `${6 + slot.y * 0.88}%` }}
              >
                <button
                  onClick={() => onPickSlot(slot.id)}
                  title={p ? `${displayFullName(p)} — tap to change` : `Tap to pick a ${slot.label}`}
                  className="flex w-16 cursor-pointer flex-col items-center"
                >
                  <PitchToken p={p} slot={slot} fit={fit} />
                </button>
              </div>
            );
          })}
        </div>

        <FitLegend />
      </Section>

      {/* The XI as a list of slots — tapping one opens the picker. */}
      <Section
        title="Starting XI"
        right={
          <span className="text-xs text-faint">
            effective ≈{" "}
            <span className="display tnum text-sm text-ink">{startersScore ? startersScore.toFixed(1) : "—"}</span>
          </span>
        }
      >
        <p className="mb-2 text-[11px] leading-snug text-faint">
          Tap a position to choose who plays there.
        </p>
        <div className="space-y-1">
          {formation.slots.map((slot) => {
            const pid = game.lineup[slot.id];
            const p = pid ? game.players[pid] : null;
            const fit = p
              ? positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor)
              : 1;
            return (
              <button
                key={slot.id}
                onClick={() => onPickSlot(slot.id)}
                className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-left hover:bg-hover"
              >
                <PosBadge pos={slot.label} />
                {p ? (
                  <>
                    <Flag nat={p.nationality} size={12} />
                    <span className="min-w-0 shrink truncate font-medium">{displayFullName(p)}</span>
                    {fit < 1 && (
                      <span className="shrink-0 text-[10px] text-loss" title="Out of natural position">
                        {fit <= TUNING.outOfPositionFloor ? "OUT OF POS" : "adapted"}
                      </span>
                    )}
                    <span className="ml-auto" />
                    <SynergyDot p={p} style={tactic.style} />
                    <Ovr value={p.overall} size="sm" />
                  </>
                ) : (
                  <span className="flex-1 text-faint">— tap to pick</span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {/* The bench: Auto-pick fills it, ✕ clears a row, tapping opens a player. */}
      <Section
        title="Bench"
        right={
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-faint">
              <span className="tnum">{benched.length}</span>/{cap} subs · used in order
            </span>
            <GhostButton onClick={autoBench} className="!px-2.5 !py-1 text-[11px]">
              Auto-pick
            </GhostButton>
            <ConfirmButton
              label="Clear"
              confirmLabel="Sure?"
              tone="danger"
              onConfirm={clearBench}
              disabled={benched.length === 0}
              className="!px-2.5 !py-1 !text-[11px]"
            />
          </div>
        }
      >
        <div className="space-y-1">
          {benched.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-gold-lo/50 bg-hover px-2.5 py-2"
            >
              <button
                onClick={() => onOpenPlayer(p.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="w-4 shrink-0 text-center tnum text-[11px] text-faint">{i + 1}</span>
                <PosBadge pos={p.positions[0]} />
                <Flag nat={p.nationality} size={12} />
                <span className="min-w-0 flex-1 truncate">{displayFullName(p)}</span>
                <Ovr value={p.overall} size="sm" />
              </button>
              <button
                onClick={() => dropFromMatchday(p.id)}
                title="Take him out of the matchday squad"
                aria-label={`Remove ${displayFullName(p)} from the bench`}
                className="shrink-0 px-1 text-sm leading-none text-faint hover:text-loss"
              >
                ✕
              </button>
            </div>
          ))}
          {benched.length === 0 && (
            <div className="rounded-md border border-dashed border-line px-3 py-2.5 text-center text-[11px] text-faint">
              No substitutes named — tap Auto-pick, or leave it empty and the best of the rest are
              benched automatically.
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

/**
 * The matchday board (v1.66): pitch and roster side by side, one drag surface.
 *
 * The board used to stack four full-width sections — squad pool, pitch, a
 * textual Starting XI, and the bench — so the thing you drag FROM and the thing
 * you drop ONTO were a scroll apart, and the pitch's empty flanks carried
 * nothing at all. It is now two panes: the pitch on the left (sticky, so it
 * stays under the pointer however far the roster scrolls), and on the right a
 * single fixed-height roster panel with the bench beneath it.
 *
 * The separate Starting XI list is gone. The pitch already IS the XI — a second
 * rendering of the same eleven was a third list to keep in your head, and the
 * detail it carried (fit, condition) now lives on the tokens themselves. Players
 * already deployed stay in the roster wearing an XI or SUB chip and dimmed, so
 * the list still answers "where does this man stand?" without duplicating it.
 *
 * Four gestures, one mental model — a player is a token, and you put tokens
 * where you want them:
 *   • roster → pitch        fields him; whoever he displaced drops out
 *   • roster → occupied     swaps the two instantly (no remove-first step)
 *   • pitch → pitch         swaps the two players' slots
 *   • roster/pitch → bench  names him a substitute, in bench order
 *   • pitch/bench → roster  takes him out of the matchday squad
 *
 * While a drag is in flight every slot the dragged player can fill is haloed and
 * the natural ones pulse, so the valid targets announce themselves rather than
 * having to be discovered by hovering.
 *
 * Tapping instead of dragging still opens the picker modal or the player, so
 * nothing here is drag-only — that matters for keyboard users and for anyone who
 * simply prefers a list. The bench order is meaningful: auto-subs work down it.
 */
function MatchdayBoard({
  onPickSlot,
  onPickBench,
  onOpenPlayer,
}: {
  onPickSlot: (slotId: string) => void;
  /** Open the sub picker for a bench seat (v1.99) — the bench's counterpart to
   * `onPickSlot`, so neither half of the matchday squad is drag-only. */
  onPickBench: (index: number) => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const swapLineup = useGame((s) => s.swapLineup);
  const moveBench = useGame((s) => s.moveBench);
  const dropFromMatchday = useGame((s) => s.dropFromMatchday);
  const autoBench = useGame((s) => s.autoBench);
  const clearBench = useGame((s) => s.clearBench);
  const clearLineup = useGame((s) => s.clearLineup);
  const bump = useGame((s) => s.bump);

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  const cap = benchCap(TUNING);

  const inLineup = new Set(Object.values(game.lineup));
  // A player away on loan (§18) can't be fielded, so he's kept off the bench too
  // even if he was benched before the loan was agreed.
  const benchIds = (game.userBench ?? []).filter(
    (id) => !inLineup.has(id) && game.players[id] && !game.players[id].loan
  );
  const benched = benchIds.map((id) => game.players[id]).filter((p): p is PlayerBio => !!p);
  const benchedSet = new Set(benchIds);
  // The pool lists the WHOLE squad (v1.63), not just whoever is left over.
  // A manager reading his side wants to see everyone available and where each of
  // them currently stands, so starters and subs stay in the list wearing a chip
  // that says so. The old "rest of squad" shrank as you worked, which is the
  // opposite of what a surface you drag from should do.
  const squadPool = team.playerIds
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired && !p.loan)
    .sort((a, b) => b.overall - a.overall);

  const handleDrop = useCallback(
    (source: DragSource, target: Exclude<DropTarget, null>) => {
      if (target.kind === "slot") {
        // Dropping a player back on the slot he already occupies is a no-op.
        if (source.kind === "slot" && source.slotId === target.slotId) return;
        swapLineup(target.slotId, source.playerId);
      } else if (target.kind === "bench") {
        moveBench(source.playerId, target.index);
      } else {
        // Back to the pool — only meaningful for someone currently in the squad.
        if (source.kind === "squad") return;
        dropFromMatchday(source.playerId);
      }
    },
    [swapLineup, moveBench, dropFromMatchday]
  );

  const { drag, begin, registerZone } = useLineupDrag(handleDrop);
  const dragging = drag?.source.playerId ?? null;
  const dragged = dragging ? game.players[dragging] : null;
  // The pool only lights up as a drop target when dropping there would DO
  // something — dragging a pool player around must not offer to remove him from
  // a squad he isn't in.
  const poolArmed = !!drag && drag.source.kind !== "squad";

  const autoPick = () => {
    game.lineup = {};
    ensureUserLineup(game);
    bump(true);
  };

  const filled = Object.values(game.lineup).filter((id) => game.players[id]).length;

  // The side's average effective rating — overall scaled by how well each man
  // fits the slot he stands in and how his archetype takes to the style. It used
  // to head the Starting XI list; with that list gone it belongs on the pitch,
  // which is now the only place the XI is shown.
  const startersScore =
    Object.entries(game.lineup).reduce((sum, [slotId, pid]) => {
      const p = game.players[pid];
      const slot = formation.slots.find((s) => s.id === slotId);
      if (!p || !slot) return sum;
      return (
        sum +
        p.overall *
          positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor) *
          synergyOf(p, tactic.style)
      );
    }, 0) / Math.max(1, Object.keys(game.lineup).length);

  // One list, the whole squad (v1.69). The Bench and Reserves tabs are gone: the
  // bench has its own section directly below, and "Reserves" was All Squad minus
  // the people already wearing an XI/SUB chip — a filter you can apply with your
  // eyes, at the cost of a third place to look for a player.
  const rosterList = squadPool;

  return (
    <>
      {/* Two panes: the pitch you arrange, and the roster you arrange it from.
          They are the first two columns of the Tactics page's own grid (v1.68) —
          hence the fragment rather than a wrapper, so the pitch, the roster and
          the setup column are siblings that share one 30/30/40 track list. Below
          `xl` that grid collapses to a single column and these simply stack. */}
      <>
        {/* ── Left: the pitch, where the side is ARRANGED ───────────────
            Sticky, so however far the roster scrolls the drop targets stay
            under the pointer — the whole point of the split. */}
        <div className="min-w-0 xl:sticky xl:top-4">
          <Section
            title="Lineup"
            right={
              <div className="flex items-center gap-3">
                <span className="text-xs text-faint">
                  effective ≈{" "}
                  <span className="display tnum text-sm text-ink">
                    {startersScore ? startersScore.toFixed(1) : "—"}
                  </span>
                </span>
                <span className="text-xs text-faint">
                  <span className="display tnum text-sm text-ink">{filled}</span>/11
                </span>
                <GhostButton onClick={autoPick} className="!px-3 !py-1 text-xs">
                  Auto-pick
                </GhostButton>
                {/* Two-step, like every other irreversible control on the page
                    (v1.80): the XI is the most expensive thing on this screen to
                    rebuild by hand and nothing here can be undone. */}
                <ConfirmButton
                  label="Clear"
                  confirmLabel="Sure?"
                  tone="danger"
                  onConfirm={clearLineup}
                  disabled={filled === 0}
                  className="!px-3 !py-1 !text-xs"
                />
              </div>
            }
          >
            {/* No max-width from `xl` up: the pitch is a 30% column of the page
                grid now, and capping it there would leave the tokens crowded into
                the middle of a half-empty panel. Below that breakpoint the page
                is one column and the cap still stops a full-width pitch. */}
            <div
              className="relative mx-auto aspect-[3/4] w-full max-w-md select-none overflow-hidden rounded-md border border-line xl:max-w-none"
              style={{ background: "linear-gradient(180deg, #0e1512 0%, #0c110e 100%)" }}
            >
              <PitchMarkings />

              {formation.slots.map((slot) => {
                const pid = game.lineup[slot.id];
                const p = pid ? game.players[pid] : null;
                const fit = p
                  ? positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor)
                  : 1;
                const isTarget = drag?.target?.kind === "slot" && drag.target.slotId === slot.id;
                const isSource = !!p && p.id === dragging;
                // While a drag is in flight, every slot advertises how well the
                // man in the air would fit it: natural slots pulse, adapted ones
                // hold a steady halo, and the rest stay quiet. Dragging a starter
                // around his own slot is excluded — it is a no-op drop.
                const guide =
                  dragged && !isSource
                    ? positionFit(
                        dragged.positions,
                        slot.pos,
                        TUNING.adjacentPositionMult,
                        TUNING.outOfPositionFloor
                      )
                    : null;
                // Drawn as a halo BEHIND the token rather than a ring on it: the
                // condition arc is an opaque disc, so a ring on the inner token
                // would be hidden underneath it exactly when it matters.
                // The token is CLIPPED (v1.98), so `ring-*` — which draws a
                // box-shadow, and a box-shadow is not clipped with the box —
                // can't be used. A filled disc behind the token says the same
                // thing and survives the clip.
                const guideHalo =
                  guide === null || isTarget
                    ? ""
                    : guide >= 1
                      ? "animate-pulse bg-win/45"
                      : guide > TUNING.outOfPositionFloor
                        ? "bg-draw/25"
                        : "";
                return (
                  <div
                    key={slot.id}
                    ref={registerZone({ kind: "slot", slotId: slot.id })}
                    className="absolute -translate-x-1/2 translate-y-1/2"
                    // Slot y is compressed into a 6–94% band. A token is now three
                    // lines tall (rating, position, surname) and the pitch clips
                    // its overflow, so a keeper at y=4% lost his name off the
                    // bottom edge. The band keeps the same shape, inset enough for
                    // the whole stack to fit.
                    style={{ left: `${slot.x}%`, bottom: `${6 + slot.y * 0.88}%` }}
                  >
                    <button
                      onPointerDown={(e) => {
                        if (p) begin({ kind: "slot", playerId: p.id, slotId: slot.id }, e);
                      }}
                      onClick={() => onPickSlot(slot.id)}
                      title={
                        p
                          ? `${displayFullName(p)} — ${slot.label}, ${Math.round(p.fitness)}% condition — drag to move, tap to change`
                          : `Tap to pick a ${slot.label}`
                      }
                      className={`flex w-16 touch-none flex-col items-center ${drag ? "cursor-grabbing" : p ? "cursor-grab" : "cursor-pointer"}`}
                    >
                      {/* The drag halo sits BEHIND the token (v1.69's reason
                          still holds: the token is opaque, so a ring drawn on it
                          would be hidden underneath exactly when it matters).
                          It is clipped to the same circle so the guide reads as
                          the slot lighting up rather than as a stray circle. */}
                      <span className="relative inline-flex items-center justify-center">
                        {guideHalo && (
                          <span
                            className={`pointer-events-none absolute h-[3.6rem] w-[3.6rem] rounded-full ${guideHalo}`}
                            style={{ clipPath: TOKEN_CLIP }}
                          />
                        )}
                        <span className="relative flex flex-col items-center">
                          <PitchToken
                            p={p}
                            slot={slot}
                            fit={fit}
                            isTarget={isTarget}
                            isSource={isSource}
                          />
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Legend — what the borders mean, so a red token reads as a
                warning rather than decoration. */}
            <FitLegend />
          </Section>

          {/* ── The bench, directly under the pitch it belongs to (v1.99) ──
              It used to hang below the Roster in the next column over, which
              put the two halves of ONE decision — who starts and who is behind
              them — in different places, and left the manager reading his subs
              while looking at somebody else's list. The XI and the bench are
              the matchday squad; they are one column now.

              Every gesture the pitch has, the bench has: drag to reorder or to
              promote a sub into the XI, and TAP an empty slot to open the same
              kind of picker a pitch slot opens (v1.99) — the board was
              drag-only on this half, which made naming a bench impossible
              without a mouse. */}
          <BenchSection
            benched={benched}
            cap={cap}
            drag={drag}
            dragging={dragging}
            registerZone={registerZone}
            begin={begin}
            onPickBench={onPickBench}
            onRemove={dropFromMatchday}
            autoBench={autoBench}
            clearBench={clearBench}
          />
        </div>

        {/* ── Right: the roster you drag FROM ───────────────────────────
            One panel, fixed height and scrolled internally — so the pitch never
            moves out from under a drag. */}
        <div className="min-w-0">
          <Section
            title="Roster"
            right={
              <span className="text-xs text-faint">
                <span className="display tnum text-sm text-ink">{rosterList.length}</span> shown
              </span>
            }
          >
            <p className="mb-2 text-[11px] leading-snug text-faint">
              Drag a player onto a position to field him — drop him on an occupied one and the two swap.
              Drop him on the bench to name him a substitute, or back here to take him out of the squad.
              Tap to open his profile.
            </p>
            <div
              ref={registerZone({ kind: "squad" })}
              // Height +50% (v2.0): 26→39rem, 34→51rem. The panel is scrolled
              // internally and fixed-height on purpose (the pitch must never
              // move out from under a drag), which made it the one list in the
              // game whose length was a design number rather than the content's
              // — and at 26rem a 25-man squad was read eight rows at a time.
              className={`h-[39rem] space-y-1 overflow-y-auto rounded-md p-1 transition-colors xl:h-[51rem] ${
                poolArmed
                  ? drag?.target?.kind === "squad"
                    ? "bg-hover ring-1 ring-gold/60"
                    : "ring-1 ring-line"
                  : ""
              }`}
            >
              {rosterList.map((p) => {
                const starting = inLineup.has(p.id);
                const isSub = benchedSet.has(p.id);
                // A deployed player stays in the list — the list is how you read
                // your squad — but dimmed and chipped, so "already used" is
                // obvious without him disappearing from where you expect him.
                const deployed = starting || isSub;
                return (
                  <button
                    key={p.id}
                    onPointerDown={(e) => {
                      // Where he stands now decides what the drag MEANS: dragging
                      // a starter moves him out of his slot, dragging a sub moves
                      // him off the bench, and dragging anyone else is a call-up.
                      if (starting) {
                        const slotId = Object.entries(game.lineup).find(([, id]) => id === p.id)?.[0];
                        if (slotId) return begin({ kind: "slot", playerId: p.id, slotId }, e);
                      }
                      if (isSub) return begin({ kind: "bench", playerId: p.id, index: benchIds.indexOf(p.id) }, e);
                      begin({ kind: "squad", playerId: p.id }, e);
                    }}
                    onClick={() => onOpenPlayer(p.id)}
                    className={`flex w-full touch-none cursor-grab items-center gap-2 rounded-md border bg-surface px-2.5 py-2 text-left hover:bg-hover hover:opacity-100 sm:gap-3 sm:px-3 ${
                      starting ? "border-gold-lo/50" : "border-line"
                    } ${deployed ? "opacity-60" : ""} ${p.id === dragging ? "!opacity-30" : ""}`}
                  >
                    <PosBadge pos={p.positions[0]} />
                    <Flag nat={p.nationality} size={12} />
                    {/* Name and identity stacked (v1.99). The roster is the
                        list you pick a side FROM, and until now it said what a
                        player is RATED without ever saying what he IS — so the
                        archetype the whole tactical system runs on was the one
                        fact you had to leave the screen to read. Beside the
                        name rather than in a column of its own: the column is
                        30% of the page and both facts truncate inside it.
                        `ArchetypeLabel` is the canonical surface (ui.tsx), so
                        the colour matches every other list in the game. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate leading-tight">{displayFullName(p)}</span>
                      <ArchetypeLabel p={p} icon={false} className="text-[10px] leading-tight" />
                    </span>
                    {starting && (
                      <span className="display shrink-0 rounded-sm border border-gold-lo/60 px-1 text-[9px] font-semibold text-gold">
                        XI
                      </span>
                    )}
                    {isSub && (
                      <span className="display shrink-0 rounded-sm border border-line px-1 text-[9px] font-semibold text-dim">
                        SUB
                      </span>
                    )}
                    <SynergyDot p={p} style={tactic.style} />
                    <span
                      className="hidden w-8 shrink-0 text-right tnum text-xs sm:inline"
                      style={{ color: conditionColor(p.fitness) }}
                      title={`Condition ${Math.round(p.fitness)}%`}
                    >
                      {Math.round(p.fitness)}%
                    </span>
                    <Ovr value={p.overall} size="sm" />
                  </button>
                );
              })}
              {rosterList.length === 0 && (
                <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
                  No senior players available — everyone is retired, sold or out on loan.
                </div>
              )}
            </div>
          </Section>
        </div>
      </>

      {drag && dragged && <DragGhost p={dragged} x={drag.x} y={drag.y} />}
    </>
  );
}

/**
 * The bench, under the pitch (v1.99; drawn as SLOTS in v2.0).
 *
 * It was a list of rows, which made the two halves of one decision read as two
 * different kinds of thing — a board above, a spreadsheet below. Every seat is
 * a circular token now, the same `PitchToken` the XI is drawn with, laid out as
 * a wrapping row of dugout places. So the whole matchday squad is one visual
 * language: a filled seat carries the rating, the class wash and the name plate
 * exactly as a fielded player does, and an empty one is the same dashed circle
 * an unfilled position is.
 *
 * Every seat is rendered whether or not anyone is in it, so the panel is a
 * constant `cap` places and naming a sub never moves the page. An empty seat is
 * a real seat rather than one tail-end "drop here" strip — which is what lets it
 * be BOTH a drop target of its own and a tap target that opens the picker.
 *
 * A bench seat has no position of its own, so the token is handed the player's
 * OWN primary position as its slot and a fit of 1: a sub is not out of position
 * on the bench, and colouring him against a pitch slot he isn't standing in
 * would be a reading the match will not honour.
 *
 * Order is meaningful (auto-subs work down it), so the numbers are not
 * decoration and dragging one seat onto another is a reorder.
 */
function BenchSection({
  benched,
  cap,
  drag,
  dragging,
  registerZone,
  begin,
  onPickBench,
  onRemove,
  autoBench,
  clearBench,
}: {
  benched: PlayerBio[];
  cap: number;
  drag: ReturnType<typeof useLineupDrag>["drag"];
  dragging: string | null;
  registerZone: (t: Exclude<DropTarget, null>, surface?: string) => (node: HTMLElement | null) => void;
  begin: (s: DragSource, e: React.PointerEvent) => void;
  onPickBench: (index: number) => void;
  onRemove: (playerId: string) => void;
  autoBench: () => void;
  clearBench: () => void;
}) {
  const seats = Array.from({ length: cap }, (_, i) => benched[i] ?? null);
  return (
    <Section
      title="Bench"
      right={
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-faint">
            <span className="tnum">{benched.length}</span>/{cap} subs · used in order
          </span>
          <GhostButton onClick={autoBench} className="!px-2.5 !py-1 text-[11px]">
            Auto-pick
          </GhostButton>
          <ConfirmButton
            label="Clear"
            confirmLabel="Sure?"
            tone="danger"
            onConfirm={clearBench}
            disabled={benched.length === 0}
            className="!px-2.5 !py-1 !text-[11px]"
          />
        </div>
      }
    >
      {/* The dugout: a wrapping row of places, sized to the same 4rem box a
          pitch slot uses so the two surfaces line up on any width. */}
      <div className="flex flex-wrap justify-center gap-x-1 gap-y-3 rounded-md border border-line/50 bg-[#0e1014] px-2 py-3">
        {seats.map((p, i) => (
          <BenchSeat
            key={p ? p.id : `empty-${i}`}
            p={p}
            index={i}
            registerZone={registerZone}
            isTarget={drag?.target?.kind === "bench" && drag.target.index === i}
            isSource={!!p && p.id === dragging}
            dragging={!!drag}
            onPointerDown={(e) => p && begin({ kind: "bench", playerId: p.id, index: i }, e)}
            onClick={() => onPickBench(i)}
            onRemove={() => p && onRemove(p.id)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-faint">
        Tap a seat to name a substitute, or drag one in from the roster. Subs come on in this order — drag a seat
        onto an earlier one to move him up.
      </p>
    </Section>
  );
}

/**
 * One dugout place — filled or empty, one component (v2.0).
 *
 * Both states were separate components while the bench was a list of rows, and
 * the two had already drifted (only one of them was draggable, only one carried
 * a remove button). As a token they are the same object in two states, which is
 * how the pitch has always drawn its own slots.
 *
 * The seat NUMBER rides above the token rather than in a column of its own:
 * bench order is meaningful and a circle has no left edge to put it on.
 */
function BenchSeat({
  p,
  index,
  registerZone,
  isTarget,
  isSource,
  dragging,
  onPointerDown,
  onClick,
  onRemove,
}: {
  p: PlayerBio | null;
  index: number;
  registerZone: (t: Exclude<DropTarget, null>, surface?: string) => (node: HTMLElement | null) => void;
  isTarget: boolean;
  isSource: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div ref={registerZone({ kind: "bench", index }, "bench")} className="relative">
      <button
        onPointerDown={onPointerDown}
        onClick={onClick}
        title={
          p
            ? `${displayFullName(p)} — sub ${index + 1}, ${Math.round(p.fitness)}% condition — drag to reorder, tap to change`
            : `Pick substitute ${index + 1}`
        }
        aria-label={p ? `Substitute ${index + 1}: ${displayFullName(p)}` : `Pick substitute ${index + 1}`}
        className={`flex w-16 touch-none flex-col items-center ${
          p ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"
        }`}
      >
        <span
          className={`display mb-0.5 tnum text-[9px] font-bold leading-none ${
            p ? "text-gold" : "text-faint"
          }`}
        >
          {index + 1}
        </span>
        {/* A sub is not out of position on the bench, so his own primary
            position is the slot and the fit is a flat 1 — the token then reads
            as "named and available" rather than being graded against a pitch
            slot he is not standing in. */}
        <PitchToken
          p={p}
          slot={{ label: p ? p.positions[0] : "—", pos: p ? p.positions[0] : "CM" }}
          fit={1}
          isTarget={isTarget}
          isSource={isSource}
        />
      </button>
      {p && (
        <button
          onClick={onRemove}
          title="Take him out of the matchday squad"
          aria-label={`Remove ${displayFullName(p)} from the bench`}
          className="absolute -right-0.5 -top-1 rounded-full border border-line bg-surface px-1 text-[10px] leading-none text-faint hover:border-loss hover:text-loss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Saved tactics (v1.53) ──────────────────────────────────────────────────
// Changing formation clears the XI, which makes a mis-click expensive. A saved
// tactic is the undo: instructions, starting XI and bench captured together
// under a name, restored in one click. The panel sits directly above Formation
// — the control it exists to make safe.

function SaveTacticModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const save = useGame((s) => s.saveTactic);
  const presets = savedTactics(game);
  const [name, setName] = useState("");

  // Saving over an existing name overwrites that preset — say so before the
  // click rather than after, so "update my home tactic" is a deliberate act.
  const clash = presets.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const full = !clash && presets.length >= MAX_SAVED_TACTICS;
  const filled = Object.keys(game.lineup).length;

  const commit = () => {
    if (!name.trim() || full) return;
    save(name);
    onClose();
  };

  return (
    <Modal title="Save tactic" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[11px] leading-snug text-faint">
          Saves your formation, every instruction, the starting XI and the bench order together.
          Load it later to put all of it back — handy before you try something new.
        </p>
        <div className="rounded-md border border-line bg-surface px-3 py-2 text-[11px] text-faint">
          Capturing <b className="text-dim">{tacticSummary(game.teams[game.userTeamId].tactic)}</b> ·{" "}
          <span className="tnum text-dim">{filled}</span>/11 picked ·{" "}
          <span className="tnum text-dim">{(game.userBench ?? []).length}</span> subs
        </div>

        {/* Overwrite an existing slot (v1.69).
            Saving used to be a bare name field, so updating "Home 4-3-3" after a
            tweak meant retyping its name exactly — and a typo silently created a
            second preset instead, which is how you fill all eight slots with
            near-duplicates. The presets you already have are now listed here:
            click one to overwrite it in place. */}
        {presets.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">
              Overwrite a saved tactic
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {presets.map((t) => {
                const selected = t.name.toLowerCase() === name.trim().toLowerCase();
                return (
                  <button
                    key={t.id}
                    onClick={() => setName(t.name)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                      selected ? "border-gold bg-hover" : "border-line bg-surface hover:bg-hover"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{t.name}</div>
                      <div className="truncate text-[11px] text-faint">{tacticSummary(t.tactic)}</div>
                    </div>
                    <span
                      className={`display shrink-0 text-[9px] font-semibold uppercase tracking-wider ${
                        selected ? "text-gold" : "text-faint"
                      }`}
                    >
                      {selected ? "selected" : "overwrite"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">
            {presets.length > 0 ? "…or save under a new name" : "Name"}
          </div>
          <input
            autoFocus
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            placeholder="e.g. Home 4-3-3"
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm placeholder:text-faint focus:border-gold focus:outline-none"
          />
        </div>
        {clash && (
          <p className="text-[11px] text-draw">
            &ldquo;{clash.name}&rdquo; already exists — saving will overwrite it.
          </p>
        )}
        {full && (
          <p className="text-[11px] text-loss">
            You already have {MAX_SAVED_TACTICS} saved tactics. Delete one to make room.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton onClick={commit} disabled={!name.trim() || full}>
            {clash ? "OVERWRITE" : "SAVE"}
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

// ── Tactic Creator (v1.99) ─────────────────────────────────────────────────
//
// Design a tactic as a PLAN rather than as a snapshot of today's side: pick a
// formation and a style, then say what KIND of player belongs in each position.
// The rules — what a brief is worth, and why it is zero-sum — live entirely in
// lib/tacticbrief.ts; this draws them and decides nothing, per the project's
// "React never implements rules".
//
// The live balance readout is the honest part of the screen. Because a brief
// redistributes rather than adds, a manager needs to see BEFORE he saves whether
// the plan suits the players he actually has — so every change re-reads the
// same `briefBalance` the engine's arithmetic is built from.

/** One row of the brief editor: a slot, and the role wanted in it. */
function BriefRow({
  slot,
  brief,
  incumbent,
  selected,
  onSelect,
  onPick,
}: {
  slot: { id: string; pos: Pos; label: string };
  brief?: string;
  incumbent?: PlayerBio;
  /** True when the pitch beside this list is pointing at the same slot (v2.0). */
  selected?: boolean;
  onSelect?: () => void;
  onPick: (archetypeId: string | undefined) => void;
}) {
  const options = archetypesForPosition(slot.pos);
  const actual = incumbent?.attrs ? deriveArchetype(incumbent.attrs, slot.pos) : undefined;
  const chosen = brief ? options.find((a) => a.id === brief) : undefined;
  const ref = useRef<HTMLDivElement>(null);

  // Selecting a slot ON THE PITCH has to bring its row into view, or clicking a
  // full-back in a 5-3-2 highlights a row that is scrolled out of the list.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // How this slot currently grades against its own brief — the same three-way
  // verdict the engine applies, so the row can never promise what the match
  // won't pay.
  const verdict = !chosen || !actual ? null : actual.id === chosen.id ? "met" : actual.cls === chosen.cls ? "near" : "miss";

  return (
    <div
      ref={ref}
      className={`flex items-center gap-2 rounded-md border bg-surface px-2 py-1.5 transition-colors ${
        selected ? "border-gold bg-hover" : "border-line"
      }`}
    >
      <button
        onClick={onSelect}
        title={`Highlight ${slot.label} on the pitch`}
        className="w-10 shrink-0 cursor-pointer text-left"
      >
        <PosBadge pos={slot.label} />
      </button>
      <div className="min-w-0 flex-1">
        <Select
          value={brief ?? ""}
          onChange={(v) => onPick(v || undefined)}
          options={[
            { value: "", label: "— no brief —", hint: "This slot is judged on ability alone." },
            // The archetype ART, in the menu AND on the closed control (v2.0).
            // A manager reads the Sniper mark long before he reads 45 role
            // names, and this is the one screen in the game where naming a role
            // IS the whole interaction — a bare list of words made it the only
            // place the identity system was invisible. `ring` is on so the class
            // colour rides along, the same pairing every other surface uses.
            ...options.map((a) => ({
              value: a.id,
              label: a.name,
              group: ARCHETYPE_CLASS_LABEL[a.cls],
              icon: <ArchetypeIcon archetype={a} size={18} />,
            })),
          ]}
        />
      </div>
      {/* Who is actually standing there, and how he grades. The point of the
          whole screen is the gap between the two columns. */}
      <div className="w-32 shrink-0 truncate text-right text-[11px]">
        {incumbent ? (
          <>
            <div className="truncate text-dim">{incumbent.name}</div>
            <div
              className={`truncate ${
                verdict === "met"
                  ? "text-win"
                  : verdict === "near"
                    ? "text-draw"
                    : verdict === "miss"
                      ? "text-loss"
                      : "text-faint"
              }`}
            >
              {actual?.name ?? "—"}
              {verdict === "met" ? " ✓" : verdict === "near" ? " ~" : verdict === "miss" ? " ✗" : ""}
            </div>
          </>
        ) : (
          <span className="text-faint">empty</span>
        )}
      </div>
    </div>
  );
}

/**
 * The Creator's own pitch (v2.0).
 *
 * The brief was a list of eleven rows, which is the one form that cannot answer
 * the question the screen exists for: a shape is a SHAPE, and "two Snipers and
 * an Architect" says nothing about whether they are standing anywhere sensible.
 * It draws the same `PitchMarkings` the Tactics board does, so the plan is read
 * on the same field the side is picked on.
 *
 * What stands in a slot here is the ROLE, not a player — the archetype's own
 * art, which is the Creator's whole subject. An unbriefed slot is the dashed
 * circle an unfilled position is on the board, so "I have not said what belongs
 * here" reads as the same kind of gap in both places.
 *
 * Clicking a slot selects it, which is what ties the two halves together: the
 * brief row beside it highlights, so a manager can work either from the shape
 * or from the list without the two ever disagreeing about which slot is which.
 */
function CreatorPitch({
  slots,
  roles,
  incumbents,
  selected,
  onSelect,
}: {
  slots: { id: string; pos: Pos; label: string; x: number; y: number }[];
  roles: Record<string, string> | undefined;
  incumbents: Record<string, PlayerBio | undefined>;
  selected: string | null;
  onSelect: (slotId: string) => void;
}) {
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border border-line bg-[#0e1014]">
      <PitchMarkings />
      {slots.map((slot) => {
        const briefId = roles?.[slot.id];
        const role = briefId ? archetypesForPosition(slot.pos).find((a) => a.id === briefId) : undefined;
        const p = incumbents[slot.id];
        const actual = p?.attrs ? deriveArchetype(p.attrs, slot.pos) : undefined;
        // The same three-way verdict the rows print and the engine pays, so the
        // pitch can never grade a slot differently from the list beside it.
        const verdict =
          !role || !actual ? null : actual.id === role.id ? "met" : actual.cls === role.cls ? "near" : "miss";
        const isSel = selected === slot.id;
        return (
          <div
            key={slot.id}
            className="absolute -translate-x-1/2 translate-y-1/2"
            // The same compressed 6–94% band the board uses: a token here is
            // also two lines tall, and the pitch clips its overflow.
            style={{ left: `${slot.x}%`, bottom: `${6 + slot.y * 0.88}%` }}
          >
            <button
              onClick={() => onSelect(slot.id)}
              title={
                role
                  ? `${slot.label} — ${role.name}${actual ? ` · ${p?.name} reads as ${actual.name}` : ""}`
                  : `${slot.label} — no brief yet`
              }
              className="flex w-16 cursor-pointer flex-col items-center"
            >
              <span
                className={`display relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 text-sm font-bold transition-all ${
                  isSel
                    ? "scale-110 border-gold"
                    : verdict === "met"
                      ? "border-win/70"
                      : verdict === "near"
                        ? "border-draw/70"
                        : verdict === "miss"
                          ? "border-loss/70"
                          : role
                            ? "border-gold-lo/70"
                            : "border-dashed border-line"
                }`}
                style={{ clipPath: TOKEN_CLIP, background: role ? "#16181d" : "#101216" }}
              >
                {role ? (
                  <>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full"
                      style={{ background: classFill(role.cls) }}
                    />
                    <ArchetypeIcon archetype={role} size={26} ring={false} />
                  </>
                ) : (
                  <span className="text-faint">{slot.label}</span>
                )}
              </span>
              {/* Position, then the role wanted there — the same name plate the
                  board uses, saying what the slot is FOR rather than who is in
                  it. */}
              <span className="mt-1 flex max-w-full flex-col items-center overflow-hidden rounded border border-line/70 bg-[#16181d]/90 px-1 py-0.5 leading-none">
                <span className="display text-[8px] font-bold uppercase leading-none tracking-wider text-faint">
                  {slot.label}
                </span>
                <span
                  className={`mt-0.5 min-w-0 max-w-full truncate text-[9px] font-semibold leading-none ${
                    role ? "text-ink" : "text-faint"
                  }`}
                >
                  {role?.name ?? "—"}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TacticCreatorModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const saveDesigned = useGame((s) => s.saveDesignedTactic);
  const applyDesigned = useGame((s) => s.applyDesignedTactic);
  const presets = savedTactics(game);

  const team = game.teams[game.userTeamId];
  // Seeded from the side's current setup: the common case is "take what I play
  // now and give it roles", not "start from nothing".
  const [draft, setDraft] = useState<Tactic>(() => ({ ...team.tactic }));
  const [name, setName] = useState("");
  // Which slot the pitch and the list are both pointing at (v2.0). One piece of
  // state for two surfaces, so they can never disagree about which slot is
  // being briefed.
  const [selected, setSelected] = useState<string | null>(null);

  const formation = getFormation(draft.formationId);

  // The XI as it stands, so each row can show who would answer its brief. Read
  // through the live lineup rather than a fresh pick — this is a description of
  // the side the manager has set, not a suggestion of another one.
  const incumbents = useMemo(() => {
    const out: Record<string, PlayerBio | undefined> = {};
    for (const slot of formation.slots) {
      const pid = game.lineup?.[slot.id];
      out[slot.id] = pid ? game.players[pid] : undefined;
    }
    return out;
  }, [formation, game.lineup, game.players]);

  const balance = useMemo(
    () =>
      briefBalance(
        draft,
        formation.slots.map((s) => ({
          slotId: s.id,
          slotPos: s.pos,
          attrs: incumbents[s.id]?.attrs,
        }))
      ),
    [draft, formation, incumbents]
  );

  /** Changing formation re-keys every slot, so briefs naming a slot the new
   * shape doesn't have are dropped — the same forgiveness `loadSavedTactic`
   * applies to a stale player id. */
  const setFormation = (formationId: string) =>
    setDraft((d) => ({ ...d, formationId, roles: pruneBrief(d.roles, formationId) }));

  const setRole = (slotId: string, archetypeId: string | undefined) =>
    setDraft((d) => {
      const roles = { ...(d.roles ?? {}) };
      if (archetypeId) roles[slotId] = archetypeId;
      else delete roles[slotId];
      return { ...d, roles: Object.keys(roles).length ? roles : undefined };
    });

  /** Fill every slot with the role already standing in it — the fastest way to
   * turn "the side I have" into "the side I meant". */
  const briefFromXI = () =>
    setDraft((d) => {
      const roles: Record<string, string> = {};
      for (const slot of formation.slots) {
        const p = incumbents[slot.id];
        const a = p?.attrs ? deriveArchetype(p.attrs, slot.pos) : undefined;
        if (a) roles[slot.id] = a.id;
      }
      return { ...d, roles: Object.keys(roles).length ? roles : undefined };
    });

  /** Fill every slot with the role the assistant would pick for this setup —
   * the ideal side for the style, which is a shopping list rather than a
   * description. Uses the same blueprint the Assistant panel prints. */
  const briefFromBlueprint = () => {
    const bp = squadBlueprint(
      formation.slots.map((s) => ({ id: s.id, pos: s.pos, label: s.label, x: s.x })),
      Object.fromEntries(formation.slots.map((s) => [s.id, incumbents[s.id]])),
      draft,
      TUNING.instructionFitSwing
    );
    const roles: Record<string, string> = {};
    for (const row of bp.slots) roles[row.slotId] = row.ideal.id;
    setDraft((d) => ({ ...d, roles }));
  };

  const clash = presets.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const full = !clash && presets.length >= MAX_SAVED_TACTICS;

  const commit = () => {
    if (!name.trim() || full) return;
    saveDesigned(name, draft);
    onClose();
  };

  return (
    <Modal title="Tactic Creator" onClose={onClose} size="xl">
      <div className="space-y-4">
        <p className="text-[11px] leading-snug text-faint">
          Design a tactic as a plan: the shape, the style, and the <b className="text-dim">kind of player</b> you
          want in each position. A slot whose brief is met sharpens that player; one that is missed blunts him
          by as much — a brief is a bet on the squad you have or intend to build, never free.
        </p>

        {/* ── Two columns (v2.0): the shape on the left, everything you set on
            the right ──────────────────────────────────────────────────────
            The Creator was a single column of eleven dropdowns, which made a
            SHAPE — the thing it exists to design — the one thing it never
            showed. Below `lg` they stack, and the pitch stays first: on a phone
            the shape is still what orients the list under it. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-0 lg:self-start">
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Shape</div>
            <CreatorPitch
              slots={formation.slots}
              roles={draft.roles}
              incumbents={incumbents}
              selected={selected}
              onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            />
            <p className="mt-2 text-[10px] leading-snug text-faint">
              Each circle is the role you want there, not the player in it. Click one to jump to its brief.
            </p>
          </div>

          {/* Right: the controls. */}
          <div className="min-w-0 space-y-4">

        {/* Shape and style first — the brief below is keyed to the slots the
            formation defines, so these two choices come before the roles. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Formation</div>
            <Select value={formationGroupOf(draft.formationId)?.id ?? draft.formationId}
              onChange={(gid) => setFormation(FORMATION_GROUPS.find((g) => g.id === gid)?.formations[0].id ?? gid)}
              options={FORMATION_OPTIONS} />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Style</div>
            <Select
              value={draft.style}
              onChange={(style) => setDraft((d) => ({ ...d, style: style as Style }))}
              options={STYLES.map((s) => ({ value: s, label: styleLabel(s), hint: OPTION_DETAIL[s] }))}
            />
          </div>
        </div>

        {/* The live verdict. This is the feature's honesty: it says plainly
            whether the plan suits the side, before anything is saved. */}
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
            balance.total > 0.5
              ? "border-win/40 bg-win/5"
              : balance.total < -0.5
                ? "border-loss/40 bg-loss/5"
                : "border-line bg-surface"
          }`}
        >
          <div className="text-[11px] text-faint">
            Against your current XI ·{" "}
            <span className="tnum text-win">{balance.met}</span> met,{" "}
            <span className="tnum text-draw">{balance.near}</span> close,{" "}
            <span className="tnum text-loss">{balance.missed}</span> missed
          </div>
          <div
            className={`display text-sm font-semibold tnum ${
              balance.total > 0.5 ? "text-win" : balance.total < -0.5 ? "text-loss" : "text-dim"
            }`}
          >
            {balance.total >= 0 ? "+" : ""}
            {balance.total.toFixed(1)}%
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <GhostButton onClick={briefFromXI} className="!px-3 !py-1 text-xs">
            Brief from current XI
          </GhostButton>
          <GhostButton onClick={briefFromBlueprint} className="!px-3 !py-1 text-xs">
            Use assistant&rsquo;s ideal
          </GhostButton>
          <GhostButton
            onClick={() => setDraft((d) => ({ ...d, roles: undefined }))}
            className="!px-3 !py-1 text-xs"
          >
            Clear briefs
          </GhostButton>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-widest text-faint">
            <span>Role brief</span>
            <span className="normal-case tracking-normal">
              <span className="tnum">{balance.briefed}</span>/{formation.slots.length} slots briefed
            </span>
          </div>
          <div className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
            {formation.slots.map((slot) => (
              <BriefRow
                key={slot.id}
                slot={slot}
                brief={draft.roles?.[slot.id]}
                incumbent={incumbents[slot.id]}
                selected={selected === slot.id}
                onSelect={() => setSelected((cur) => (cur === slot.id ? null : slot.id))}
                onPick={(a) => setRole(slot.id, a)}
              />
            ))}
          </div>
        </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Save as</div>
          <input
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            placeholder="e.g. Gegenpress 4-3-3"
            className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm placeholder:text-faint focus:border-gold focus:outline-none"
          />
        </div>
        {clash && (
          <p className="text-[11px] text-draw">
            &ldquo;{clash.name}&rdquo; already exists — saving will overwrite it.
          </p>
        )}
        {full && (
          <p className="text-[11px] text-loss">
            You already have {MAX_SAVED_TACTICS} saved tactics. Delete one to make room.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          {/* Adopting and saving are separate on purpose: a manager may design
              next season's shape without tearing up this Saturday's. */}
          <GhostButton
            onClick={() => {
              applyDesigned(draft);
              onClose();
            }}
          >
            APPLY NOW
          </GhostButton>
          <GoldButton onClick={commit} disabled={!name.trim() || full}>
            {clash ? "OVERWRITE" : "SAVE TACTIC"}
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

function SavedTactics() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const load = useGame((s) => s.loadTactic);
  const remove = useGame((s) => s.deleteTactic);
  const save = useGame((s) => s.saveTactic);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const presets = savedTactics(game);

  return (
    <>
      <Section
        title="Saved Tactics"
        right={
          <div className="flex gap-1.5">
            {/* The Creator designs a PLAN (shape, style, roles); "Save current"
                snapshots the side as it stands, players and all. Two different
                things, so two buttons. */}
            <GhostButton onClick={() => setCreating(true)} className="!px-3 !py-1 text-xs">
              Creator
            </GhostButton>
            <GhostButton onClick={() => setSaving(true)} className="!px-3 !py-1 text-xs">
              Save current
            </GhostButton>
          </div>
        }
      >
        {presets.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-surface px-3 py-3 text-[11px] leading-snug text-faint">
            Nothing saved yet. Save your setup before changing formation — switching formation clears
            the starting XI, and a saved tactic puts the whole thing back in one click.
          </div>
        ) : (
          <div className="space-y-1">
            {presets.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{t.name}</div>
                  {/* A Creator preset names no players by design, so counting
                      "0 starters" at it would read as a broken save rather than
                      as what it is — a plan. Say which kind it is instead. */}
                  <div className="truncate text-[11px] text-faint">
                    {tacticSummary(t.tactic)}
                    {hasBrief(t.tactic) && (
                      <span className="text-gold"> · {Object.keys(t.tactic.roles ?? {}).length} roles</span>
                    )}
                    {" · "}
                    {Object.keys(t.lineup).length === 0 ? (
                      "plan only"
                    ) : (
                      <>
                        <span className="tnum">{Object.keys(t.lineup).length}</span> starters,{" "}
                        <span className="tnum">{t.bench.length}</span> subs
                      </>
                    )}
                  </div>
                </div>
                <GhostButton onClick={() => load(t.id)} className="!px-3 !py-1 text-xs">
                  Load
                </GhostButton>
                {/* Overwrite in place (v1.69) — the common case after a tweak.
                    Confirmed, because it destroys the snapshot you saved earlier
                    and there is no undo for that. */}
                <ConfirmButton
                  label="Save"
                  confirmLabel="Overwrite?"
                  onConfirm={() => save(t.name)}
                  className="!px-3 !py-1 text-xs"
                />
                <ConfirmButton
                  label="✕"
                  confirmLabel="Delete?"
                  tone="danger"
                  onConfirm={() => remove(t.id)}
                  className="!px-2 !py-1 text-xs"
                />
              </div>
            ))}
          </div>
        )}
      </Section>
      {saving && <SaveTacticModal onClose={() => setSaving(false)} />}
      {creating && <TacticCreatorModal onClose={() => setCreating(false)} />}
    </>
  );
}

/**
 * Formation, mentality, style and the advanced instructions (v1.68).
 *
 * Lifted out of the old Setup tab into a component of its own so it can sit as
 * the third column of the one-page Tactics layout — and, on a phone, stack under
 * the lineup instead. It owns the formation-switch confirm because that dialogue
 * belongs to the control that triggers it, not to the screen.
 */
/** The two halves of the setup. Basic is everything a casual manager needs to
 * touch; Advanced is the fine-tuning. */
type SetupTab = "basic" | "advanced";

/**
 * The formation dropdown's options, sectioned by how many defenders the shape
 * lines up with (v1.77).
 *
 * Built once at module load: the formation table is static, and the grouping is
 * derived from the slots rather than authored, so there is nothing per-render to
 * recompute. Options are emitted already ordered by bucket, which is what lets
 * `Select` render a heading on each change without reordering anything itself.
 */
const FORMATION_OPTIONS: SelectOption<string>[] = ([3, 4, 5] as const).flatMap((back) =>
  FORMATION_GROUPS.filter((g) => backLineOfGroup(g) === back).map((g) => ({
    value: g.id,
    label: g.name,
    group: BACK_LINE_LABEL[back],
    hint: g.formations[0].desc,
  }))
);

function SetupPanel() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setTactic = useGame((s) => s.setTactic);
  const [setupTab, setSetupTab] = useState<SetupTab>("basic");
  /** Formation the user has clicked but not yet confirmed. Null when none. */
  const [formationSwitch, setFormationSwitch] = useState<string | null>(null);

  const tactic = game.teams[game.userTeamId].tactic;
  // Resolved instruction values (v2 saves may omit the expanded fields).
  const tempo = tactic.tempo ?? "Standard";
  const width = tactic.width ?? "Standard";
  const press = tactic.press ?? "Medium";
  const line = tactic.line ?? "Standard";
  const focus = tactic.focus ?? "Mixed";
  const formation = getFormation(tactic.formationId);
  const picked = Object.values(game.lineup).filter((id) => game.players[id]).length;
  const activeGroup = formationGroupOf(tactic.formationId);

  /** Select a formation. Switching wipes the XI (the slots themselves change), so
   * a picked side gets a confirm rather than vanishing on a stray click; an empty
   * XI has nothing to lose and switches straight away. */
  const pickFormation = (id: string) => {
    if (id === tactic.formationId) return;
    if (picked > 0) setFormationSwitch(id);
    else setTactic({ formationId: id });
  };

  // Average archetype synergy of the picked XI in the chosen style, as a
  // percentage — the headline number for "does this style suit my squad?".
  const xiPlayers = Object.values(game.lineup)
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p);
  const styleFit = xiPlayers.length
    ? (xiPlayers.reduce((sum, p) => sum + synergyOf(p, tactic.style), 0) / xiPlayers.length - 1) * 100
    : undefined;

  // The XI paired with the slot each player is FILLING — the same reading the
  // engine and the assistant report use, so the roles readout under each dial
  // can never disagree with them.
  const xiSlots: ReportSlot[] = formation.slots.flatMap((slot) => {
    const p = game.players[game.lineup[slot.id]];
    return p?.attrs ? [{ player: p, slotPos: slot.pos }] : [];
  });

  return (
    <>
      <Section title="Setup">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="shrink-0 text-[11px] uppercase tracking-widest text-faint">Formation</span>
              {/* Style mastery, promoted out of the Style dial's effect tags to
                  the top of the panel (v1.84). It was the one genuinely
                  headline number down there — "does this style suit my squad?"
                  — and folding the dials' detail away would have buried it. One
                  copy, always visible, above everything it summarises. */}
              <span className="flex min-w-0 flex-1 justify-end">
                <StyleMastery styleFit={styleFit} style={styleLabel(tactic.style)} />
              </span>
            </div>
            {/* v1.77: a dropdown sectioned by back line, not a grid of nineteen
                buttons. The buttons were the largest block on the screen, all of
                them permanently visible for a choice made once, and they offered
                no way to answer the question a manager asks first — "what plays
                with a back three?". Sectioning by defenders makes that scannable
                and reclaims the vertical space.

                Variants of one shape (the 4-3-3's midfield options) stay folded
                behind their family and appear as a row below once it is chosen:
                they are the same formation, and four near-identical "4-3-3 (…)"
                rows in the list would undo the grouping. */}
            <Select
              value={activeGroup?.id ?? FORMATION_GROUPS[0].id}
              options={FORMATION_OPTIONS}
              onChange={(id) => {
                const g = FORMATION_GROUPS.find((x) => x.id === id);
                if (g) pickFormation(g.formations[0].id);
              }}
              ariaLabel="Formation"
              title={formation.desc}
            />
            {/* The variant row, only for a family that has more than one shape. */}
            {activeGroup && activeGroup.formations.length > 1 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-l border-line pl-2">
                <span className="text-[10px] uppercase tracking-widest text-faint">Midfield</span>
                {activeGroup.formations.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => pickFormation(f.id)}
                    className={`rounded px-2 py-1 text-[11px] font-medium ${
                      tactic.formationId === f.id
                        ? "border border-gold bg-hover text-gold"
                        : "border border-line text-dim hover:text-ink"
                    }`}
                  >
                    {f.variant ?? f.name}
                  </button>
                ))}
              </div>
            )}
            {/* v1.84: the shape's description was printed here in full AND
                carried as the Select's own title and per-option hint. One copy
                is enough, and the dropdown's is the one attached to the choice.
                What survives is the single line the picker can't show — the
                variant, once one is chosen. */}
            {/* The `w-0 min-w-full` pair is load-bearing, not tidiness (v1.87).
                `truncate` sets `white-space: nowrap`, which makes this
                paragraph's MIN-CONTENT width its whole one-line width — and an
                `fr` grid track never shrinks below its content's min-content, so
                the longest description in a family silently widened the entire
                Setup column and squeezed the pitch beside it. The 4-3-3's "Free
                Roles" variant is the longest line in the table and dragged the
                30/30/40 grid to 297/333/724, which is why changing only the
                midfield appeared to change the page's width.

                `min-w-0` alone does NOT fix it: that overrides the automatic
                minimum on a flex/grid ITEM, and this is a plain block. Declaring
                a definite `width: 0` is what stops the text contributing any
                intrinsic width at all; `min-width: 100%` then lays it back out
                across the column it no longer gets a vote on. */}
            {activeGroup && activeGroup.formations.length > 1 && (
              <p className="mt-1.5 w-0 min-w-full truncate text-[11px] text-faint" title={formation.desc}>
                {formation.desc}
              </p>
            )}
          </div>
          {/* v1.77: the instructions split across two tabs rather than stacking
              two always-open controls above a collapsible block of five. Basic is
              the whole game for a casual manager — how committed you are, and how
              you play — and Advanced is fine-tuning that now costs nothing to
              ignore. The old collapsible carried a summary line because it was
              hidden by default; a tab is visible in the strip itself, so that
              summary moves onto the Basic panel as a link across. */}
          <Tabs
            className="mb-0"
            tabs={[
              { id: "basic", label: "Basic" },
              { id: "advanced", label: "Advanced" },
            ]}
            active={setupTab}
            onChange={setSetupTab}
          />
          {setupTab === "basic" ? (
            <div className="space-y-4">
              <Instruction label="Mentality" options={MENTALITIES} current={tactic.mentality} onPick={(v) => setTactic({ mentality: v })} />
              <Instruction label="Style" options={STYLES} current={tactic.style} onPick={(v) => setTactic({ style: v })} styleFit={styleFit} />
              {/* v1.84: one line where there were two. The old pair said what
                  the five advanced dials are set to AND what they're worth, in
                  separate paragraphs, both of which are answering the same
                  question — "do I need to open Advanced?". The settings roll up
                  into the button's own subtitle; the worth stays a sentence,
                  because it's the half that changes as you pick. */}
              <button
                onClick={() => setSetupTab("advanced")}
                className="flex w-full items-baseline gap-2 rounded-md border border-line/60 px-2.5 py-1.5 text-left transition-colors hover:border-faint hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-[10px] text-faint">
                  {tempo.toLowerCase()} tempo · {width.toLowerCase()} · {press.toLowerCase()} press ·{" "}
                  {line.toLowerCase()} line · {focus.toLowerCase()} focus
                </span>
                <span className="shrink-0 text-[10px] text-dim">Fine-tune →</span>
              </button>
              {/* What those five dials are worth to the XI, summed (v1.79).
                  Without it the Advanced tab is a door with nothing written on
                  it — this is the one number that says whether it's worth
                  opening, and it moves the moment the XI or the dials change. */}
              <InstructionSummary xi={xiSlots} tactic={tactic} onOpen={() => setSetupTab("advanced")} />
            </div>
          ) : (
            <div className="space-y-4">
              <Instruction label="Tempo" options={TEMPOS} current={tempo} onPick={(v) => setTactic({ tempo: v })} axis="tempo" xi={xiSlots} />
              <Instruction label="Width" options={WIDTHS} current={width} onPick={(v) => setTactic({ width: v })} axis="width" xi={xiSlots} />
              <Instruction label="Press" options={PRESSES} current={press} onPick={(v) => setTactic({ press: v })} axis="press" xi={xiSlots} />
              <Instruction label="Defensive Line" options={LINES} current={line} onPick={(v) => setTactic({ line: v })} axis="line" xi={xiSlots} />
              <Instruction label="Focus" options={FOCI} current={focus} onPick={(v) => setTactic({ focus: v })} axis="focus" xi={xiSlots} />
            </div>
          )}
          {/* One report in place of the old Squad-fit and Squad-identity panels
              (v1.77) — the far end of the Training Plan → Attributes → Archetype
              → Tactics loop, stated as advice rather than as three charts. */}
          <AssistantReportPanel tactic={tactic} />

          {/* And the side you SHOULD be building for this plan (v1.79) — the
              question the report above can't answer, because it only ever grades
              the players you already have. */}
          <SquadBlueprintPanel tactic={tactic} />

          {/* v1.84: the ▲▼ legend was a permanent paragraph explaining two
              glyphs that already carry the same sentence in their own tooltips.
              It is gone; the marks are self-describing on hover. */}
        </div>
      </Section>

      {formationSwitch && (
        <Modal title="Change formation?" onClose={() => setFormationSwitch(null)}>
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-dim">
              Switching to <b className="text-ink">{getFormation(formationSwitch).name}</b> clears your
              starting XI — the positions are different, so all{" "}
              <span className="tnum">{picked}</span> picks are lost.
            </p>
            <p className="text-[11px] leading-snug text-faint">
              Save the current setup first if you might want it back — Saved Tactics restores the
              formation, instructions, XI and bench in one click.
            </p>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setFormationSwitch(null)}>Keep {formation.name}</GhostButton>
              <GoldButton
                onClick={() => {
                  setTactic({ formationId: formationSwitch });
                  setFormationSwitch(null);
                }}
              >
                CHANGE
              </GoldButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The page's two halves (v1.80): the side you're picking, and the manual for
 * how any of it works. */
type TacticsTab = "team" | "help";

export default function TacticsScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setLineupSlot = useGame((s) => s.setLineupSlot);
  const moveBench = useGame((s) => s.moveBench);
  const dropFromMatchday = useGame((s) => s.dropFromMatchday);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  // Which bench SEAT the sub picker is open on (v1.99). An index rather than a
  // player id, because the seat is the thing being filled — seat 3 exists and
  // is pickable whether or not anybody is sitting in it.
  const [pickBench, setPickBench] = useState<number | null>(null);
  const [tab, setTab] = useState<TacticsTab>("team");
  // Phones get the tap-driven lineup instead of the drag-and-drop board.
  const isMobile = useIsMobile();

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  // players away on loan (§18) can't be fielded
  const squad = team.playerIds.map((id) => game.players[id]).filter((p) => p && !p.retired && !p.loan);
  const inLineup = new Set(Object.values(game.lineup));

  const slotFor = (slotId: string) => formation.slots.find((s) => s.id === slotId)!;

  return (
    <div>
      {/* One page, three columns (v1.68).
          Picking the side and setting it up were split across a Squad/Setup tab
          pair, which meant the two halves of one decision could never be seen at
          once — you chose a style on one tab and read its ▲▼ synergy marks on the
          other. They are now columns of a single layout: the pitch (30%), the
          roster you fill it from (30%), and the setup you play it with (40%).

          Mobile keeps the stacked, tap-driven flow — see MobileLineup — because
          three columns of anything is not a phone layout; the grid simply
          collapses to one column below `xl`. */}
      {/* v1.80: a Help tab beside the team. The identity system is the deepest
          thing in the game and was entirely undocumented in-game — the screen
          showed a manager his grade without ever telling him where it came
          from. It is a sibling tab rather than a modal because it is a reference
          you read alongside the setup, not a dialogue you dismiss. */}
      <Tabs
        tabs={[
          { id: "team", label: "Team" },
          { id: "help", label: "Help" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "help" ? (
        <TacticsHelp />
      ) : isMobile ? (
        <>
          <MobileLineup onPickSlot={setPickSlot} onOpenPlayer={viewPlayer} />
          <SetupPanel />
          <SavedTactics />
          <Assignments />
        </>
      ) : (
        // `minmax(0, …)` on every track, not a bare `Nfr` (v1.99).
        // An `fr` track's automatic minimum is its content's MIN-CONTENT width,
        // so the three columns were only 30/30/40 while nothing in them was
        // wider than that — and the moment the lineup filled, the longest
        // player name in a bench row or a roster chip pushed its column's
        // minimum past its share and the whole page re-proportioned itself.
        // That is why populating four defenders visibly widened Setup and
        // narrowed Lineup. Zeroing the minimum makes the ratio the ONLY thing
        // that decides the widths, so the layout is a constant and content
        // truncates inside it instead of moving it. Same class of bug as the
        // formation description's `w-0 min-w-full` (v1.87), fixed at the grid
        // rather than one item at a time.
        <div className="grid grid-cols-1 items-start gap-x-6 xl:grid-cols-[minmax(0,30fr)_minmax(0,30fr)_minmax(0,40fr)]">
          <MatchdayBoard onPickSlot={setPickSlot} onPickBench={setPickBench} onOpenPlayer={viewPlayer} />
          <div className="min-w-0">
            <SetupPanel />
            <SavedTactics />
            <Assignments />
          </div>
        </div>
      )}

      {pickSlot && (
        <Modal title={`Select ${slotFor(pickSlot).label}`} onClose={() => setPickSlot(null)}>
          <div className="space-y-1">
            {squad
              .slice()
              .sort((a, b) => selectionScore(b, slotFor(pickSlot).pos, TUNING) - selectionScore(a, slotFor(pickSlot).pos, TUNING))
              .map((p) => {
                const fit = positionFit(p.positions, slotFor(pickSlot).pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor);
                const used = inLineup.has(p.id) && game.lineup[pickSlot] !== p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setLineupSlot(pickSlot, p.id);
                      setPickSlot(null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left hover:bg-hover ${
                      used ? "opacity-50" : ""
                    }`}
                  >
                    <PosBadge pos={p.positions[0]} />
                    <Flag nat={p.nationality} size={12} />
                    <span className="flex-1 truncate">
                      {displayFullName(p)}
                      {used && <span className="ml-2 text-[10px] text-faint">in XI</span>}
                    </span>
                    <ArchetypeLabel p={p} className="text-[11px]" />
                    <SynergyDot p={p} style={tactic.style} />
                    {fit < 1 && <span className="text-[10px] text-loss">{Math.round(fit * 100)}%</span>}
                    <span className="w-8 text-right tnum text-xs text-dim">{Math.round(p.fitness)}%</span>
                    <Ovr value={p.overall} size="sm" />
                  </button>
                );
              })}
            <GhostButton
              onClick={() => {
                setLineupSlot(pickSlot, null);
                setPickSlot(null);
              }}
              className="mt-2 w-full"
            >
              Clear slot
            </GhostButton>
          </div>
        </Modal>
      )}

      {/* The bench's picker (v1.99) — the same dialogue a pitch slot opens, so
          naming a substitute is the same gesture as naming a starter.
          A bench seat has no position of its own, so the order is the squad's
          own ranking rather than `selectionScore` at a slot: the question here
          is "who is the best player still available", not "who is best at RB".
          `moveBench` is what commits it — the same store action a drop calls,
          so the picker can't put a player somewhere a drag couldn't. */}
      {pickBench !== null && (
        <Modal title={`Select substitute ${pickBench + 1}`} onClose={() => setPickBench(null)}>
          <div className="space-y-1">
            {squad
              .slice()
              .sort((a, b) => b.overall - a.overall)
              .map((p) => {
                const starting = inLineup.has(p.id);
                const benchIdx = (game.userBench ?? []).indexOf(p.id);
                const here = benchIdx === pickBench;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      moveBench(p.id, pickBench);
                      setPickBench(null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left hover:bg-hover ${
                      starting || (benchIdx >= 0 && !here) ? "opacity-50" : ""
                    }`}
                  >
                    <PosBadge pos={p.positions[0]} />
                    <Flag nat={p.nationality} size={12} />
                    <span className="min-w-0 flex-1 truncate">
                      {displayFullName(p)}
                      {starting && <span className="ml-2 text-[10px] text-faint">in XI</span>}
                      {benchIdx >= 0 && (
                        <span className="ml-2 text-[10px] text-faint">
                          {here ? "this seat" : `sub ${benchIdx + 1}`}
                        </span>
                      )}
                    </span>
                    <ArchetypeLabel p={p} className="text-[11px]" />
                    <SynergyDot p={p} style={tactic.style} />
                    <span className="w-8 text-right tnum text-xs text-dim">{Math.round(p.fitness)}%</span>
                    <Ovr value={p.overall} size="sm" />
                  </button>
                );
              })}
            {(game.userBench ?? [])[pickBench] && (
              <GhostButton
                onClick={() => {
                  dropFromMatchday((game.userBench ?? [])[pickBench]);
                  setPickBench(null);
                }}
                className="mt-2 w-full"
              >
                Clear seat
              </GhostButton>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * How well the picked XI suits the instructions it's been given (v1.72).
 *
 * The tactical-fit system asks each setting what attributes it leans on and
 * compares that to the players actually on the pitch. This panel is that
 * comparison made visible: without it, the effect is real but invisible, and a
 * manager would have no way to learn that their Gegenpress needs legs.
 *
 * Only phases the current setup actually makes a demand on appear. A Balanced,
 * Standard-everything tactic asks nothing and shows nothing — which is honest,
 * and is also the hint that the safe setup is the one with no requirements.
 */
// ── The Assistant Manager's report (§15.3, v1.77) ─────────────────────────
//
// One box replacing three. Until v1.77 this column carried a "Squad fit" panel
// of centred bars, a "Squad identity" stacked bar with five class counts and a
// list of signed percentages, and a line of raw arithmetic under the style
// picker. Every number was accurate and none of it was advice — the player had
// to hold three scales in their head and work out for themselves whether the
// combination was good.
//
// The report does that work instead: a single grade, then at most four
// sentences in the voice of an assistant manager. The numbers still exist and
// each note carries the figure that produced it on hover, but they are the
// evidence for the advice rather than the interface itself.
//
// The class MIX moved out of here entirely: it is now drawn on the pitch, as a
// coloured ring on each player node (`MatchdayBoard`), which is where it is
// actually actionable — you can see which slot is which class while you are
// picking, instead of reading a bar chart beside the picture.
//
// All of the analysis lives in `lib/assistant.ts` and is computed from the same
// functions the match engine calls, so this can never claim something the
// simulation won't do.

const NOTE_ICON: Record<NoteTone, string> = { good: "👍", warn: "⚠️", tip: "💡" };
const NOTE_TONE: Record<NoteTone, string> = {
  good: "text-win",
  warn: "text-loss",
  tip: "text-gold",
};

/** The grade's colour ramp — A green through E red. */
function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "var(--color-win)";
  if (grade.startsWith("B")) return "#7fbf5f";
  if (grade.startsWith("C")) return "#d9a441";
  if (grade.startsWith("D")) return "#d97a4a";
  return "var(--color-loss)";
}

function AssistantReportPanel({ tactic }: { tactic: Tactic }) {
  const game = useGame((s) => s.game)!;
  // `rev` is a real dependency, not just a re-render subscription: lib modules
  // mutate the single GameState in place, so `game` keeps its identity when the
  // lineup changes and a memo keyed on it alone would never recompute.
  const rev = useGame((s) => s.rev);
  const formation = getFormation(tactic.formationId);
  // Collapsed by default (v1.84), like the blueprint below it. The grade and
  // the loudest note ride on the header, which is the part that is read every
  // time; the other three notes and the class key are the part that is read
  // once. Declared above the empty-XI early return so the hook order holds.
  const [open, setOpen] = useState(false);

  const report = useMemo(() => {
    // Judged against the slot each player is FILLING, exactly as the engine
    // does — a midfielder at full back is read as the full back he is asked to
    // be, so the report and Saturday agree.
    const slots: ReportSlot[] = [];
    for (const slot of formation.slots) {
      const p = game.players[game.lineup[slot.id]];
      if (p?.attrs) slots.push({ player: p, slotPos: slot.pos });
    }
    return assistantReport(slots, tactic, synergyOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, rev, formation, tactic]);

  if (report.filled === 0) {
    return (
      <div className="rounded-md border border-line px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-widest text-faint">Assistant&apos;s report</div>
        <p className="mt-1.5 text-[11px] leading-snug text-faint">
          Pick a starting XI and I&apos;ll tell you how well it suits this plan.
        </p>
      </div>
    );
  }

  const color = gradeColor(report.grade);
  // The loudest note, shown alongside the grade when the panel is shut. A grade
  // on its own says how good the setup is but never why, and "why" is the only
  // part a manager can act on — so one sentence of it stays above the fold and
  // the rest opens. Warnings outrank praise: a B with a problem in it is worth
  // surfacing the problem, not the compliment.
  const headline =
    report.notes.find((n) => n.tone === "warn") ?? report.notes[0];

  return (
    <div className="rounded-md border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-hover"
      >
        {/* The grade IS the summary — everything else is why. */}
        <span
          className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base font-bold"
          style={{ color, background: `${color}1a`, border: `1px solid ${color}59` }}
        >
          {report.grade}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-widest text-faint">
            Tactical synergy
            {report.filled < 11 && <span className="ml-1.5 normal-case tracking-normal">{report.filled}/11 picked</span>}
          </span>
          <span className="block truncate text-[11px] leading-snug text-dim">
            {headline ? (
              <>
                <b className={NOTE_TONE[headline.tone]}>{headline.title}:</b> {headline.body}
              </>
            ) : (
              "Nothing stands out either way — a workable, unremarkable setup."
            )}
          </span>
        </span>
        <span className="shrink-0 text-[10px] text-faint" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <>
          {/* Every note, including the one already quoted above — the expanded
              view is the full report, not the remainder of it, so a note doesn't
              move around depending on whether the panel is shut. */}
          <div className="space-y-1.5 border-t border-line/60 px-3 py-2.5">
            {report.notes.length === 0 ? (
              <p className="text-[11px] leading-snug text-faint">
                Nothing stands out either way — this is a workable, unremarkable setup.
              </p>
            ) : (
              report.notes.map((n, i) => (
                <p key={i} className="flex gap-1.5 text-[11px] leading-snug text-dim" title={n.detail}>
                  <span className="shrink-0" aria-hidden>{NOTE_ICON[n.tone]}</span>
                  <span className="min-w-0">
                    <b className={NOTE_TONE[n.tone]}>{n.title}:</b> {n.body}
                  </span>
                </p>
              ))
            )}
          </div>

          {/* The class mix, as a one-line key to the coloured rings on the pitch —
              the counts without the chart the pitch now carries. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 px-3 py-2">
            {ARCHETYPE_CLASS_ORDER.map((c) => (
              <span
                key={c}
                className={`flex items-center gap-1.5 text-[10px] ${report.counts[c] > 0 ? "" : "opacity-30"}`}
                title={ARCHETYPE_CLASS_BLURB[c]}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ARCHETYPE_CLASS_COLOR[c] }} />
                <span className="text-faint">{c}</span>
                <span className="tnum font-semibold text-dim">{report.counts[c]}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Squad Blueprint (§9c, v1.79) ───────────────────────────────────────────
//
// The report above grades the side you have. This is the side you SHOULD have:
// for the current formation, style and dials, the best archetype at every slot,
// how the incumbent measures up, and a button that opens the transfer market
// already filtered to what's missing.
//
// It exists because the redesign is only worth building if a manager can act on
// it. Knowing that a Possession 4-3-3 wants a Constructor at full back rather
// than a Protector otherwise means holding 45 archetypes × 6 styles × five dials
// in your head — that is a wiki, not a game. All the ranking lives in
// `lib/assistant.ts`; this only draws it.
//
// Collapsed by default: it is a planning tool, not a per-matchday readout, and
// the assistant's report stays the headline.

const GRADE_MARK: Record<SlotGrade, { mark: string; tone: string; title: string }> = {
  ideal: { mark: "✓", tone: "text-win", title: "The best role available here for this setup" },
  // "0 is neutral, not a trap" made visible: a role that simply isn't what the
  // style is built around costs you a little, and is not a mistake.
  fine: { mark: "~", tone: "text-dim", title: "Workable — not the ideal role, but no real cost" },
  poor: { mark: "✗", tone: "text-loss", title: "This role is costing you against the best you could field here" },
};

function BlueprintRow({ row }: { row: BlueprintSlot }) {
  const g = GRADE_MARK[row.grade];
  // The row's own `gap` (v1.93), not `idealPct - actualPct`: a slot's ideal may
  // be a differentiated second-choice role chosen to vary the line, and charging
  // the incumbent for that would contradict the ✓ beside it.
  const gap = row.gap;
  // Worth naming only where the dials disagree with the style — which is the
  // interesting case and, because style is the bigger lever, not the common one.
  const dialPick = row.bestForDials.id !== row.ideal.id ? row.bestForDials : undefined;
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-[11px] odd:bg-raised/30">
      <span className="w-7 shrink-0 font-semibold text-faint">{row.label}</span>

      {/* What this slot should be. */}
      <span className="flex min-w-0 flex-[1.1] items-center gap-1" title={`${row.ideal.name} · ${row.ideal.cls} — ${row.ideal.desc}`}>
        <ArchetypeIcon archetype={row.ideal} size={14} />
        <span className="truncate text-dim">{row.ideal.name}</span>
        {dialPick && (
          <span
            className="shrink-0 text-faint"
            title={`${row.ideal.name} is the best fit for ${row.slotPos} in this style. For your dials alone, a ${dialPick.name} suits them better — but the style is the bigger lever, so it doesn't overturn the pick.`}
          >
            /{dialPick.name}
          </span>
        )}
      </span>

      {/* What it is. */}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        {row.actual ? (
          <>
            <ArchetypeIcon archetype={row.actual} size={14} />
            <span
              className="truncate text-faint"
              title={[
                row.incumbent ? displayFullName(row.incumbent) : "",
                `Style ${row.actualStylePct > 0 ? "+" : ""}${row.actualStylePct.toFixed(0)}% · dials ${row.actualDialsPct > 0 ? "+" : ""}${row.actualDialsPct.toFixed(1)}%`,
              ]
                .filter(Boolean)
                .join("\n")}
            >
              {row.actual.name}
            </span>
          </>
        ) : (
          <span className="italic text-faint">empty</span>
        )}
      </span>

      <span className={`w-4 shrink-0 text-center ${g.tone}`} title={g.title} aria-label={row.grade}>
        {g.mark}
      </span>
      {/* The cost, not the absolute: what this slot gives up against its ideal.
          Shown only from the `fine` band up, so the column carries the same
          message as the mark beside it rather than pricing every rounding error. */}
      <span className={`w-9 shrink-0 text-right tnum ${row.grade === "poor" ? "text-loss" : "text-faint"}`}>
        {row.actual && gap > 4 ? `−${Math.round(gap)}%` : ""}
      </span>
    </div>
  );
}

function SquadBlueprintPanel({ tactic }: { tactic: Tactic }) {
  const game = useGame((s) => s.game)!;
  const rev = useGame((s) => s.rev);
  const scoutFor = useGame((s) => s.scoutFor);
  const [open, setOpen] = useState(false);
  const formation = getFormation(tactic.formationId);

  const bp = useMemo(() => {
    const lineup: Record<string, PlayerBio | undefined> = {};
    for (const slot of formation.slots) lineup[slot.id] = game.players[game.lineup[slot.id]];
    return squadBlueprint(
      // `x` is passed so the blueprint can order a position group left-to-right
      // when it differentiates their roles (v1.93) — see `squadBlueprint`.
      formation.slots.map((s) => ({ id: s.id, pos: s.pos, label: s.label, x: s.x })),
      lineup,
      tactic,
      TUNING.instructionFitSwing
    );
    // `rev` is a real dependency: lib modules mutate GameState in place, so
    // `game` keeps its identity when the lineup changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, rev, formation, tactic]);

  return (
    <div className="rounded-md border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover"
      >
        <span className="flex-1 text-[11px] uppercase tracking-widest text-faint">Squad blueprint</span>
        {/* The headline even when collapsed — one sentence of advice is worth
            more than a disclosure triangle on its own. */}
        <span className="truncate text-[10px] text-dim">
          {bp.weakest ? (
            <>
              Weakest link: <b className="text-loss">{bp.weakest.label}</b>
            </>
          ) : (
            "Every slot is well suited"
          )}
        </span>
        <span className="shrink-0 text-[10px] text-faint" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <>
          <p className="border-t border-line/60 px-3 py-2 text-[11px] leading-snug text-faint">
            The side to build for <b className="text-dim">{styleLabel(tactic.style)}</b> — and how your XI measures
            up. Where a line has two of the same position it asks for two different roles, because a back four of
            two identical centre backs covers less between them than a pair that complement each other. The ✓/~/✗
            still grades each player against the best role available to him, so playing a recommended role in the
            other slot is never marked down. This ranks ROLES; whether these particular players have the attributes
            the plan demands is the assistant&apos;s report above, and it is the larger half of the grade.
          </p>
          <div className="flex items-center gap-2 border-b border-line/60 px-3 pb-1 text-[9px] uppercase tracking-widest text-faint">
            <span className="w-7 shrink-0">Slot</span>
            <span className="flex-[1.1]">Ideal</span>
            <span className="flex-1">You have</span>
            <span className="w-4 shrink-0" />
            <span className="w-9 shrink-0" />
          </div>
          <div className="py-1">
            {bp.slots.map((row) => (
              <BlueprintRow key={row.slotId} row={row} />
            ))}
          </div>

          {/* The shopping list. This is what makes the panel quality-of-life
              rather than one more readout: a ✗ row now has somewhere to go. */}
          {bp.wants.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 px-3 py-2">
              <span className="text-[10px] text-faint">Shop for:</span>
              {bp.wants.slice(0, 3).map((w) => (
                <button
                  key={w.archetype.id}
                  onClick={() => scoutFor(w.archetype.id, w.pos)}
                  title={`Search the market for a ${w.archetype.name} at ${w.pos}`}
                  className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-dim hover:border-gold hover:text-gold"
                >
                  <ArchetypeIcon archetype={w.archetype} size={12} ring={false} />
                  {w.archetype.name}
                  <span className="text-faint">({w.pos})</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

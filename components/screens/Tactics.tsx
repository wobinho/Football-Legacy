"use client";

// Tactics (§15.3): formation preset, mentality, style, lineup, synergy hints.

import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { DefLine, Focus, Mentality, PlayerBio, Press, Style, TeamAssignments, Tempo, Width } from "@/lib/types";
import { FORMATIONS, getFormation, MENTALITY_OPTIONS, STYLE_OPTIONS, styleLabel } from "@/lib/config/formations";
import { getArchetype } from "@/lib/config/archetypes";
import { positionFit } from "@/lib/config/positions";
import { TUNING } from "@/lib/config/tuning";
import { selectionScore } from "@/lib/selection";
import { ensureUserLineup } from "@/lib/gameloop";
import { Flag, GhostButton, Modal, Ovr, PlayerSelect, PosBadge, Section, TraitChip } from "../ui";

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

function EffectTags({ label, option, styleFit }: { label: string; option: string; styleFit?: number }) {
  // Style is per-player, so instead of a team multiplier we show the band and
  // the current XI's actual average fit in the selected style.
  if (label === "Style") {
    const cap = Math.round(TUNING.synergyCap * 100);
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded-sm border border-line px-1 py-px text-[10px] text-faint">
          per-player fit <b className="tnum text-dim">±{cap}%</b>
        </span>
        {typeof styleFit === "number" && (
          <span className="rounded-sm border border-line px-1 py-px text-[10px] text-faint">
            your XI avg{" "}
            <b className={`tnum ${styleFit > 0.5 ? "text-win" : styleFit < -0.5 ? "text-loss" : "text-faint"}`}>
              {styleFit > 0 ? "+" : ""}
              {styleFit.toFixed(1)}%
            </b>
          </span>
        )}
      </span>
    );
  }

  const effects = effectsFor(label, option);
  if (effects.length === 0) {
    // Every multiplier for this option is exactly 1.0 — it's the neutral
    // baseline the other options are measured against, not an inert choice.
    return <span className="text-[10px] text-faint">baseline — no modifier (other options are measured against this)</span>;
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
  const raw = getArchetype(p.archetypeId).styleSynergy[style];
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
function Instruction<T extends string>({
  label,
  options,
  current,
  onPick,
  styleFit,
}: {
  label: string;
  options: readonly T[];
  current: T;
  onPick: (v: T) => void;
  /** Style row only: the current XI's average synergy, as a percentage. */
  styleFit?: number;
}) {
  // Focus overrides the shared copy for "Wide" (Width uses the same word for a
  // different idea); Style renders presentable names for its camel-case ids.
  const detailFor = (o: string) =>
    (label === "Focus" ? FOCUS_DETAIL[o as Focus] : undefined) ?? OPTION_DETAIL[o] ?? "";
  const textFor = (o: string) => (label === "Style" ? styleLabel(o) : o);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="shrink-0 text-[11px] uppercase tracking-widest text-faint">{label}</span>
        <span className="text-right text-[10px] text-faint">{detailFor(current)}</span>
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
          </button>
        ))}
      </div>
      {/* live numbers for the SELECTED option, straight from TUNING */}
      <div className="mt-1.5">
        <EffectTags label={label} option={current} styleFit={styleFit} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-faint">{INSTRUCTION_INFO[label]}</p>
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
  const team = game.teams[game.userTeamId];
  const assignments = team.assignments ?? {};

  // pick takers/captain from the current XI so an unavailable player never holds a role
  const xi = Object.values(game.lineup)
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired);

  return (
    <Section title="Assignments" right={<span className="text-xs text-faint">captain & set pieces</span>}>
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
            return (
              <div key={role} className="rounded-md border border-line bg-surface px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-[11px] uppercase tracking-widest text-faint">{label}</span>
                  {/* flag + position tag visible in the picker (v7) */}
                  <PlayerSelect players={xi} value={currentId ?? null} onChange={(id) => setAssignment(role, id)} />
                  {hasTrait && <span className="display shrink-0 rounded-sm border border-gold-lo/50 px-1.5 text-[9px] font-semibold text-gold">IDEAL</span>}
                </div>
                <p className="mt-1 pl-[7.75rem] text-[11px] leading-snug text-faint">{hint}</p>
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

/** Where a drag is currently hovering. */
type DropTarget = { kind: "slot"; slotId: string } | { kind: "bench"; index: number } | null;

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

/** Drop zones register themselves here by DOM node, so hit-testing is a plain
 * geometric scan — no dependency on pointer-events or elementFromPoint, which
 * the floating drag token would otherwise sit on top of and block. */
type ZoneMap = Map<Element, Exclude<DropTarget, null>>;

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

  const registerZone = useCallback((target: Exclude<DropTarget, null>) => {
    return (node: HTMLElement | null) => {
      // Re-registering the same target on re-render: drop the stale node first
      // so the map never accumulates detached elements.
      for (const [el, t] of zones.current) {
        if (t.kind === target.kind && (t as { slotId?: string; index?: number }).slotId === (target as { slotId?: string }).slotId && (t as { index?: number }).index === (target as { index?: number }).index) {
          zones.current.delete(el);
        }
      }
      if (node) zones.current.set(node, target);
    };
  }, []);

  /** Which registered zone is under (x, y), if any. */
  const hitTest = useCallback((x: number, y: number): DropTarget => {
    for (const [el, target] of zones.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return target;
    }
    return null;
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

/** Colour a player token by how well he fits the slot he's standing in. */
function fitRing(fit: number): string {
  if (fit >= 1) return "border-gold-lo bg-raised";
  if (fit > TUNING.outOfPositionFloor) return "border-draw/60 bg-raised";
  return "border-loss/70 bg-raised";
}

/**
 * The lineup board (v1.5): the pitch, the bench and the rest of the squad as one
 * drag-and-drop surface, in the EA-FC idiom.
 *
 * Three gestures, one mental model — a player is a token, and you put tokens
 * where you want them:
 *   • pitch → pitch  swaps the two players' slots
 *   • bench/squad → pitch  fields him; whoever he displaced takes his place
 *   • pitch → bench  drops him out of the XI and into the subs, in that order
 *
 * Tapping instead of dragging still opens the picker modal, so nothing here is
 * drag-only — that matters for keyboard users and for anyone who simply prefers
 * a list. The bench order is meaningful: the engine's auto-subs work down it.
 */
function LineupBoard({
  onPickSlot,
  onOpenPlayer,
}: {
  onPickSlot: (slotId: string) => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const swapLineup = useGame((s) => s.swapLineup);
  const moveBench = useGame((s) => s.moveBench);
  const toggleBench = useGame((s) => s.toggleBench);
  const bump = useGame((s) => s.bump);

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  const cap = TUNING.matchdaySquad - 11;

  const inLineup = new Set(Object.values(game.lineup));
  const benchIds = (game.userBench ?? []).filter((id) => !inLineup.has(id) && game.players[id]);
  const benched = benchIds.map((id) => game.players[id]).filter((p): p is PlayerBio => !!p);
  const benchedSet = new Set(benchIds);
  const rest = team.playerIds
    .map((id) => game.players[id])
    .filter(
      (p): p is PlayerBio =>
        !!p && !p.retired && !p.loan && !inLineup.has(p.id) && !benchedSet.has(p.id)
    )
    .sort((a, b) => b.overall - a.overall);

  const handleDrop = useCallback(
    (source: DragSource, target: Exclude<DropTarget, null>) => {
      if (target.kind === "slot") {
        // Dropping a player back on the slot he already occupies is a no-op.
        if (source.kind === "slot" && source.slotId === target.slotId) return;
        swapLineup(target.slotId, source.playerId);
      } else {
        moveBench(source.playerId, target.index);
      }
    },
    [swapLineup, moveBench]
  );

  const { drag, begin, registerZone } = useLineupDrag(handleDrop);
  const dragging = drag?.source.playerId ?? null;
  const dragged = dragging ? game.players[dragging] : null;

  const autoPick = () => {
    game.lineup = {};
    ensureUserLineup(game);
    bump(true);
  };

  const filled = Object.values(game.lineup).filter((id) => game.players[id]).length;

  return (
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
        </div>
      }
    >
      <p className="mb-3 text-[11px] leading-snug text-faint">
        Drag a player onto a position to field him — drag one shirt onto another to swap them, or down to the bench to take him out.
        Tap a position instead to pick from a list.
      </p>

      {/* ── The pitch ─────────────────────────────────────────────────── */}
      <div
        className="relative mx-auto aspect-[3/4] w-full max-w-md select-none overflow-hidden rounded-md border border-line"
        style={{ background: "linear-gradient(180deg, #0e1512 0%, #0c110e 100%)" }}
      >
        {/* pitch markings */}
        <div className="absolute inset-x-[12%] top-0 h-[14%] rounded-b border border-t-0 border-white/10" />
        <div className="absolute inset-x-[12%] bottom-0 h-[14%] rounded-t border border-b-0 border-white/10" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />

        {formation.slots.map((slot) => {
          const pid = game.lineup[slot.id];
          const p = pid ? game.players[pid] : null;
          const fit = p
            ? positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor)
            : 1;
          const isTarget = drag?.target?.kind === "slot" && drag.target.slotId === slot.id;
          const isSource = !!p && p.id === dragging;
          return (
            <div
              key={slot.id}
              ref={registerZone({ kind: "slot", slotId: slot.id })}
              className="absolute -translate-x-1/2 translate-y-1/2"
              style={{ left: `${slot.x}%`, bottom: `${slot.y}%` }}
            >
              <button
                onPointerDown={(e) => {
                  if (p) begin({ kind: "slot", playerId: p.id, slotId: slot.id }, e);
                }}
                onClick={() => onPickSlot(slot.id)}
                title={p ? `${p.name} — drag to move, tap to change` : `Tap to pick a ${slot.label}`}
                className={`flex w-16 touch-none flex-col items-center ${drag ? "cursor-grabbing" : p ? "cursor-grab" : "cursor-pointer"}`}
              >
                <span
                  className={`display flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold transition-all ${
                    p ? fitRing(fit) : "border-dashed border-line bg-surface text-faint"
                  } ${
                    isTarget
                      ? "scale-110 border-gold ring-2 ring-gold/60"
                      : isSource
                        ? "opacity-30"
                        : ""
                  } ${p ? "text-ink" : ""}`}
                >
                  {p ? p.overall : slot.label}
                </span>
                <span className="mt-0.5 w-full truncate text-center text-[10px] leading-tight text-dim">
                  {p ? p.name.split(" ").slice(-1)[0] : slot.label}
                </span>
                {p && fit < 1 && (
                  <span className="text-[8px] uppercase leading-none tracking-wide text-loss">
                    {fit <= TUNING.outOfPositionFloor ? "out of pos" : "adapted"}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Legend — what the ring colours mean, so a red token reads as a warning
          rather than decoration. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-gold-lo" /> natural
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-draw/60" /> adapted
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-loss/70" /> out of position
        </span>
      </div>

      {/* ── The bench ─────────────────────────────────────────────────── */}
      <div className="mt-5">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-widest text-faint">Bench</span>
          <span className="text-[10px] text-faint">
            <span className="tnum">{benched.length}</span>/{cap} subs · used in order
          </span>
        </div>

        <div className="space-y-1">
          {benched.map((p, i) => (
            <BenchRow
              key={p.id}
              p={p}
              index={i}
              registerZone={registerZone}
              isTarget={drag?.target?.kind === "bench" && drag.target.index === i}
              isSource={p.id === dragging}
              onPointerDown={(e) => begin({ kind: "bench", playerId: p.id, index: i }, e)}
              onClick={() => onOpenPlayer(p.id)}
              onRemove={() => toggleBench(p.id)}
            />
          ))}

          {/* Tail drop zone: always present so there is somewhere to drop a
              player when the bench is empty, and so dropping past the last row
              appends rather than missing entirely. */}
          {benched.length < cap && (
            <div
              ref={registerZone({ kind: "bench", index: benched.length })}
              className={`rounded-md border border-dashed px-3 py-2.5 text-center text-[11px] transition-colors ${
                drag?.target?.kind === "bench" && drag.target.index === benched.length
                  ? "border-gold bg-hover text-ink"
                  : "border-line text-faint"
              }`}
            >
              {benched.length === 0
                ? "Drop a player here to name your substitutes — or leave it empty and the best of the rest are benched automatically."
                : "Drop here to add a substitute"}
            </div>
          )}
        </div>
      </div>

      {/* ── The rest of the squad ─────────────────────────────────────── */}
      {rest.length > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">
            Rest of squad
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
            {rest.map((p) => (
              <button
                key={p.id}
                onPointerDown={(e) => begin({ kind: "squad", playerId: p.id }, e)}
                onClick={() => onOpenPlayer(p.id)}
                className={`flex w-full touch-none cursor-grab items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left hover:bg-hover ${
                  p.id === dragging ? "opacity-30" : ""
                }`}
              >
                <PosBadge pos={p.positions[0]} />
                <Flag nat={p.nationality} size={12} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="hidden text-[11px] text-faint sm:inline">
                  {getArchetype(p.archetypeId).name}
                </span>
                <SynergyDot p={p} style={tactic.style} />
                <span className="w-8 shrink-0 text-right tnum text-xs text-dim">
                  {Math.round(p.fitness)}%
                </span>
                <Ovr value={p.overall} size="sm" />
              </button>
            ))}
          </div>
        </div>
      )}

      {drag && dragged && <DragGhost p={dragged} x={drag.x} y={drag.y} />}
    </Section>
  );
}

/** One named substitute. Draggable to reorder or to promote into the XI. */
function BenchRow({
  p,
  index,
  registerZone,
  isTarget,
  isSource,
  onPointerDown,
  onClick,
  onRemove,
}: {
  p: PlayerBio;
  index: number;
  registerZone: (t: Exclude<DropTarget, null>) => (node: HTMLElement | null) => void;
  isTarget: boolean;
  isSource: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      ref={registerZone({ kind: "bench", index })}
      className={`flex items-center gap-3 rounded-md border bg-hover px-3 py-2 transition-colors ${
        isTarget ? "border-gold ring-1 ring-gold/50" : "border-gold-lo/50"
      } ${isSource ? "opacity-30" : ""}`}
    >
      <button
        onPointerDown={onPointerDown}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-3 text-left"
      >
        <span className="w-4 shrink-0 text-center tnum text-[11px] text-faint">{index + 1}</span>
        <PosBadge pos={p.positions[0]} />
        <Flag nat={p.nationality} size={12} />
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        <span className="w-8 shrink-0 text-right tnum text-xs text-dim">{Math.round(p.fitness)}%</span>
        <Ovr value={p.overall} size="sm" />
      </button>
      <button
        onClick={onRemove}
        title="Remove from the bench"
        aria-label={`Remove ${p.name} from the bench`}
        className="shrink-0 text-sm leading-none text-faint hover:text-loss"
      >
        ✕
      </button>
    </div>
  );
}

export default function TacticsScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setTactic = useGame((s) => s.setTactic);
  const setLineupSlot = useGame((s) => s.setLineupSlot);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  // Resolved instruction values (v2 saves may omit the expanded fields).
  const tempo = tactic.tempo ?? "Standard";
  const width = tactic.width ?? "Standard";
  const press = tactic.press ?? "Medium";
  const line = tactic.line ?? "Standard";
  const focus = tactic.focus ?? "Mixed";
  const formation = getFormation(tactic.formationId);
  // players away on loan (§18) can't be fielded
  const squad = team.playerIds.map((id) => game.players[id]).filter((p) => p && !p.retired && !p.loan);
  const inLineup = new Set(Object.values(game.lineup));

  const slotFor = (slotId: string) => formation.slots.find((s) => s.id === slotId)!;

  // Average archetype synergy of the picked XI in the chosen style, as a
  // percentage — the headline number for "does this style suit my squad?".
  const xiPlayers = Object.values(game.lineup)
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p);
  const styleFit = xiPlayers.length
    ? (xiPlayers.reduce((sum, p) => sum + synergyOf(p, tactic.style), 0) / xiPlayers.length - 1) * 100
    : undefined;

  const startersScore =
    Object.entries(game.lineup).reduce((sum, [slotId, pid]) => {
      const p = game.players[pid];
      const slot = slotFor(slotId);
      if (!p || !slot) return sum;
      return sum + p.overall * positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor) * synergyOf(p, tactic.style);
    }, 0) / Math.max(1, Object.keys(game.lineup).length);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <Section title="Setup">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Formation</div>
              <div className="flex flex-wrap gap-1.5">
                {FORMATIONS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setTactic({ formationId: f.id })}
                    className={`display rounded px-3 py-1.5 text-sm font-semibold ${
                      tactic.formationId === f.id ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-faint">{formation.desc}</p>
            </div>
            <Instruction label="Mentality" options={MENTALITIES} current={tactic.mentality} onPick={(v) => setTactic({ mentality: v })} />
            <Instruction label="Style" options={STYLES} current={tactic.style} onPick={(v) => setTactic({ style: v })} styleFit={styleFit} />

            {/* Advanced instructions collapse into a dropdown so the setup doesn't
                fill the screen — the core three (formation/mentality/style) stay
                open, the fine-tuning tucks away with a live summary. */}
            <div className="rounded-md border border-line">
              <button
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                aria-expanded={advancedOpen}
              >
                <span className="text-[11px] uppercase tracking-widest text-faint">Advanced instructions</span>
                <span className="flex items-center gap-2">
                  {!advancedOpen && (
                    <span className="hidden text-[10px] text-faint sm:inline">
                      {tempo} · {width} · {press} press · {line} line · {focus}
                    </span>
                  )}
                  <span className={`text-xs text-dim transition-transform ${advancedOpen ? "rotate-180" : ""}`}>▾</span>
                </span>
              </button>
              {advancedOpen && (
                <div className="space-y-4 border-t border-line px-3 py-3">
                  <Instruction label="Tempo" options={TEMPOS} current={tempo} onPick={(v) => setTactic({ tempo: v })} />
                  <Instruction label="Width" options={WIDTHS} current={width} onPick={(v) => setTactic({ width: v })} />
                  <Instruction label="Press" options={PRESSES} current={press} onPick={(v) => setTactic({ press: v })} />
                  <Instruction label="Defensive Line" options={LINES} current={line} onPick={(v) => setTactic({ line: v })} />
                  <Instruction label="Focus" options={FOCI} current={focus} onPick={(v) => setTactic({ focus: v })} />
                </div>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              ▲▼ marks show each player&apos;s fit with <b className="text-dim">{styleLabel(tactic.style)}</b>.
            </p>
          </div>
        </Section>

        {/* The picked XI in detail. The pitch is where the lineup is ARRANGED;
            this is where it's read — traits, synergy and position fit per slot,
            which don't fit on a 40px token. */}
        <Section
          title="Starting XI"
          right={
            <span className="text-xs text-faint">
              effective ≈{" "}
              <span className="display tnum text-sm text-ink">
                {startersScore ? startersScore.toFixed(1) : "—"}
              </span>
            </span>
          }
        >
          <div className="space-y-1">
            {formation.slots.map((slot) => {
              const pid = game.lineup[slot.id];
              const p = pid ? game.players[pid] : null;
              const fit = p ? positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor) : 1;
              return (
                <button
                  key={slot.id}
                  onClick={() => setPickSlot(slot.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left transition-colors hover:bg-hover"
                >
                  <PosBadge pos={slot.label} />
                  {p ? (
                    <>
                      {/* flag to the LEFT of the name (v7) */}
                      <Flag nat={p.nationality} size={12} />
                      <span className="min-w-0 shrink truncate font-medium">{p.name}</span>
                      {fit < 1 && (
                        <span className="shrink-0 text-[10px] text-loss" title="Out of natural position">
                          {fit <= TUNING.outOfPositionFloor ? "OUT OF POS" : "adapted"}
                        </span>
                      )}
                      {/* Spacer pushes everything after it hard to the right, so
                          the synergy dot and overall stay right-justified even
                          when the player carries no traits (v1.43 fix). */}
                      <span className="ml-auto" />
                      {/* traits in their own containers to the RIGHT (v7) so you
                          can see who has the Leader / Dead-Ball trait at a glance */}
                      {p.traits.length > 0 && (
                        <span
                          className="flex flex-wrap items-center justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.traits.map((t) => (
                            <TraitChip key={t} id={t} size="xs" />
                          ))}
                        </span>
                      )}
                      <SynergyDot p={p} style={tactic.style} />
                      <Ovr value={p.overall} size="sm" />
                    </>
                  ) : (
                    <span className="flex-1 text-faint">— select player</span>
                  )}
                </button>
              );
            })}
          </div>
        </Section>

        <Assignments />
      </div>

      {/* The drag-and-drop board: pitch, bench and squad as one surface. */}
      <div>
        <LineupBoard onPickSlot={setPickSlot} onOpenPlayer={viewPlayer} />
      </div>

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
                      {p.name}
                      {used && <span className="ml-2 text-[10px] text-faint">in XI</span>}
                    </span>
                    <span className="text-[11px] text-faint">{getArchetype(p.archetypeId).name}</span>
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
    </div>
  );
}

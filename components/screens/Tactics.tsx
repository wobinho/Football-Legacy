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
import { MAX_SAVED_TACTICS, savedTactics, tacticSummary } from "@/lib/tactics";
import { ConfirmButton, displayFullName, Flag, GhostButton, GoldButton, Modal, Ovr, PlayerSelect, PosBadge, Section, Tabs, TraitChip, useIsMobile } from "../ui";

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

/** Colour a player token by how well he fits the slot he's standing in. */
function fitRing(fit: number): string {
  if (fit >= 1) return "border-gold-lo bg-raised";
  if (fit > TUNING.outOfPositionFloor) return "border-draw/60 bg-raised";
  return "border-loss/70 bg-raised";
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
  const bump = useGame((s) => s.bump);

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  const cap = TUNING.matchdaySquad - 11;

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
          </div>
        }
      >
        <div
          className="relative mx-auto aspect-[3/4] w-full max-w-md select-none overflow-hidden rounded-md border border-line"
          style={{ background: "linear-gradient(180deg, #0e1512 0%, #0c110e 100%)" }}
        >
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
            return (
              <div
                key={slot.id}
                className="absolute -translate-x-1/2 translate-y-1/2"
                style={{ left: `${slot.x}%`, bottom: `${slot.y}%` }}
              >
                <button
                  onClick={() => onPickSlot(slot.id)}
                  title={p ? `${displayFullName(p)} — tap to change` : `Tap to pick a ${slot.label}`}
                  className="flex w-16 cursor-pointer flex-col items-center"
                >
                  <span
                    className={`display flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold ${
                      p ? `${fitRing(fit)} text-ink` : "border-dashed border-line bg-surface text-faint"
                    }`}
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
 * The matchday board (v1.63): squad pool, pitch, starting XI and bench as one
 * drag-and-drop surface, in the order a manager actually works in.
 *
 * The screen used to scatter this across four sections — a read-only "Starting
 * XI" list in one column, then a pitch, a bench and a "rest of squad" list in
 * the other — so picking a side meant looking in two places at once, and the
 * squad you drag FROM sat at the very bottom, below everything it feeds. The
 * order is now the workflow: the pool you pick from, the pitch you arrange, the
 * XI that results, the bench beneath it.
 *
 * Four gestures, one mental model — a player is a token, and you put tokens
 * where you want them:
 *   • pool → pitch          fields him; whoever he displaced drops out
 *   • pitch → pitch         swaps the two players' slots
 *   • pool/pitch → bench    names him a substitute, in bench order
 *   • pitch/bench → pool    takes him out of the matchday squad
 *
 * Tapping instead of dragging still opens the picker modal or the player, so
 * nothing here is drag-only — that matters for keyboard users and for anyone who
 * simply prefers a list. The bench order is meaningful: auto-subs work down it.
 *
 * Mobile: every draggable carries `touch-none` so a press-drag moves the token
 * rather than scrolling the page, the pointer handlers are one code path for
 * mouse and touch, and rows drop their optional columns below `sm` so a phone
 * keeps the name, the badge and the rating instead of truncating all three.
 */
function MatchdayBoard({
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
  const dropFromMatchday = useGame((s) => s.dropFromMatchday);
  const autoBench = useGame((s) => s.autoBench);
  const bump = useGame((s) => s.bump);

  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  const cap = TUNING.matchdaySquad - 11;

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

  return (
    <>
      {/* ── 1. The squad pool: what you drag FROM ─────────────────────── */}
      <Section
        title="Squad"
        right={
          <span className="text-xs text-faint">
            <span className="display tnum text-sm text-ink">{squadPool.length}</span> available
          </span>
        }
      >
        <p className="mb-2 text-[11px] leading-snug text-faint">
          Drag a player onto a position to field him, or onto the bench to name him a substitute. Drag him back
          here to take him out of the squad. Tap a player to open his profile.
        </p>
        <div
          ref={registerZone({ kind: "squad" })}
          className={`max-h-80 space-y-1 overflow-y-auto rounded-md p-1 transition-colors ${
            poolArmed
              ? drag?.target?.kind === "squad"
                ? "bg-hover ring-1 ring-gold/60"
                : "ring-1 ring-line"
              : ""
          }`}
        >
          {squadPool.map((p) => {
            const starting = inLineup.has(p.id);
            const isSub = benchedSet.has(p.id);
            return (
              <button
                key={p.id}
                onPointerDown={(e) => {
                  // Where he stands now decides what the drag MEANS: dragging a
                  // starter moves him out of his slot, dragging a sub moves him
                  // off the bench, and dragging anyone else is a call-up.
                  if (starting) {
                    const slotId = Object.entries(game.lineup).find(([, id]) => id === p.id)?.[0];
                    if (slotId) return begin({ kind: "slot", playerId: p.id, slotId }, e);
                  }
                  if (isSub) return begin({ kind: "bench", playerId: p.id, index: benchIds.indexOf(p.id) }, e);
                  begin({ kind: "squad", playerId: p.id }, e);
                }}
                onClick={() => onOpenPlayer(p.id)}
                className={`flex w-full touch-none cursor-grab items-center gap-2 rounded-md border bg-surface px-2.5 py-2 text-left hover:bg-hover sm:gap-3 sm:px-3 ${
                  starting ? "border-gold-lo/50" : "border-line"
                } ${p.id === dragging ? "opacity-30" : ""}`}
              >
                <PosBadge pos={p.positions[0]} />
                <Flag nat={p.nationality} size={12} />
                <span className="min-w-0 flex-1 truncate">{displayFullName(p)}</span>
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
                <span className="hidden text-[11px] text-faint lg:inline">{getArchetype(p.archetypeId).name}</span>
                <SynergyDot p={p} style={tactic.style} />
                <span className="hidden w-8 shrink-0 text-right tnum text-xs text-dim sm:inline">
                  {Math.round(p.fitness)}%
                </span>
                <Ovr value={p.overall} size="sm" />
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── 2. The pitch: where the side is ARRANGED ──────────────────── */}
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
                  title={p ? `${displayFullName(p)} — drag to move, tap to change` : `Tap to pick a ${slot.label}`}
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
                  {/* A 40px token is the one place a full name genuinely will not
                      go — the surname alone is what a shirt carries anyway. */}
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
      </Section>

      {/* ── 3+4. The XI and the bench, side by side (v1.66) ────────────
          The two lists are one decision — who starts and who backs them up —
          and stacked they pushed the bench a full screen below the XI it
          relates to. Two columns puts both in view at once, which also means a
          drag from the bench into the XI no longer crosses a scroll. They stack
          again below `lg`, where there isn't the width for two readable lists. */}
      <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
        <StartingXIList onPickSlot={onPickSlot} registerZone={registerZone} begin={begin} drag={drag} />

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
            </div>
          }
        >
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
                onRemove={() => dropFromMatchday(p.id)}
              />
            ))}

            {/* Tail drop zone: always present so there is somewhere to drop a
                player when the bench is empty, and so dropping past the last row
                appends rather than missing entirely. */}
            {benched.length < cap && (
              <div
                ref={registerZone({ kind: "bench", index: benched.length }, "bench")}
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
        </Section>
      </div>

      {drag && dragged && <DragGhost p={dragged} x={drag.x} y={drag.y} />}
    </>
  );
}

/**
 * The picked XI in detail. The pitch is where the lineup is ARRANGED; this is
 * where it is read — traits, synergy and position fit per slot, none of which
 * fit on a 40px token. Each row is also a live drop zone for its own slot, so
 * the list builds the same side rather than merely reporting it.
 */
function StartingXIList({
  onPickSlot,
  registerZone,
  begin,
  drag,
}: {
  onPickSlot: (slotId: string) => void;
  registerZone: (t: Exclude<DropTarget, null>, surface?: string) => (node: HTMLElement | null) => void;
  begin: (source: DragSource, e: React.PointerEvent) => void;
  drag: DragState | null;
}) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const team = game.teams[game.userTeamId];
  const tactic = team.tactic;
  const formation = getFormation(tactic.formationId);
  const slotFor = (slotId: string) => formation.slots.find((s) => s.id === slotId);
  const dragging = drag?.source.playerId ?? null;

  // The side's average effective rating: overall, scaled by how well each man
  // fits the slot he is standing in and how his archetype takes to the style.
  const startersScore =
    Object.entries(game.lineup).reduce((sum, [slotId, pid]) => {
      const p = game.players[pid];
      const slot = slotFor(slotId);
      if (!p || !slot) return sum;
      return (
        sum +
        p.overall *
          positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor) *
          synergyOf(p, tactic.style)
      );
    }, 0) / Math.max(1, Object.keys(game.lineup).length);

  return (
    <Section
      title="Starting XI"
      right={
        <span className="text-xs text-faint">
          effective ≈{" "}
          <span className="display tnum text-sm text-ink">{startersScore ? startersScore.toFixed(1) : "—"}</span>
        </span>
      }
    >
      <div className="space-y-1">
        {formation.slots.map((slot) => {
          const pid = game.lineup[slot.id];
          const p = pid ? game.players[pid] : null;
          const fit = p ? positionFit(p.positions, slot.pos, TUNING.adjacentPositionMult, TUNING.outOfPositionFloor) : 1;
          const isTarget = drag?.target?.kind === "slot" && drag.target.slotId === slot.id;
          return (
            <div key={slot.id} ref={registerZone({ kind: "slot", slotId: slot.id }, "xi-list")}>
              <button
                onPointerDown={(e) => {
                  if (p) begin({ kind: "slot", playerId: p.id, slotId: slot.id }, e);
                }}
                onClick={() => onPickSlot(slot.id)}
                className={`flex w-full touch-none items-center gap-2 rounded-md border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-hover sm:px-3 ${
                  isTarget ? "border-gold ring-1 ring-gold/50" : "border-line"
                } ${p && p.id === dragging ? "opacity-30" : ""} ${p ? "cursor-grab" : "cursor-pointer"}`}
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
                    {/* Spacer pushes everything after it hard to the right, so the
                        synergy dot and overall stay right-justified even when the
                        player carries no traits (v1.43 fix). */}
                    <span className="ml-auto" />
                    {/* Traits in their own containers to the RIGHT (v7) so you can
                        see who has the Leader / Dead-Ball trait at a glance. They
                        are the first thing to go on a phone, where the name and
                        the rating matter more. */}
                    {p.traits.length > 0 && (
                      <span
                        className="hidden flex-wrap items-center justify-end gap-1 sm:flex"
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
                  <span className="flex-1 text-faint">— drag a player here, or tap to pick</span>
                )}
              </button>
            </div>
          );
        })}
      </div>
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
  registerZone: (t: Exclude<DropTarget, null>, surface?: string) => (node: HTMLElement | null) => void;
  isTarget: boolean;
  isSource: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      ref={registerZone({ kind: "bench", index }, "bench")}
      className={`flex items-center gap-2 rounded-md border bg-hover px-2.5 py-2 transition-colors sm:gap-3 sm:px-3 ${
        isTarget ? "border-gold ring-1 ring-gold/50" : "border-gold-lo/50"
      } ${isSource ? "opacity-30" : ""}`}
    >
      <button
        onPointerDown={onPointerDown}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-2 text-left sm:gap-3"
      >
        <span className="w-4 shrink-0 text-center tnum text-[11px] text-faint">{index + 1}</span>
        <PosBadge pos={p.positions[0]} />
        <Flag nat={p.nationality} size={12} />
        <span className="min-w-0 flex-1 truncate">{displayFullName(p)}</span>
        <span className="hidden w-8 shrink-0 text-right tnum text-xs text-dim sm:inline">{Math.round(p.fitness)}%</span>
        <Ovr value={p.overall} size="sm" />
      </button>
      <button
        onClick={onRemove}
        title="Take him out of the matchday squad"
        aria-label={`Remove ${displayFullName(p)} from the bench`}
        className="shrink-0 px-1 text-sm leading-none text-faint hover:text-loss"
      >
        ✕
      </button>
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
        <input
          autoFocus
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          placeholder="e.g. Home 4-3-3"
          className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm placeholder:text-faint focus:border-gold focus:outline-none"
        />
        <div className="rounded-md border border-line bg-surface px-3 py-2 text-[11px] text-faint">
          Capturing <b className="text-dim">{tacticSummary(game.teams[game.userTeamId].tactic)}</b> ·{" "}
          <span className="tnum text-dim">{filled}</span>/11 picked ·{" "}
          <span className="tnum text-dim">{(game.userBench ?? []).length}</span> subs
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

function SavedTactics() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const load = useGame((s) => s.loadTactic);
  const remove = useGame((s) => s.deleteTactic);
  const [saving, setSaving] = useState(false);

  const presets = savedTactics(game);

  return (
    <>
      <Section
        title="Saved Tactics"
        right={
          <GhostButton onClick={() => setSaving(true)} className="!px-3 !py-1 text-xs">
            Save current
          </GhostButton>
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
                  <div className="truncate text-[11px] text-faint">
                    {tacticSummary(t.tactic)} ·{" "}
                    <span className="tnum">{Object.keys(t.lineup).length}</span> starters,{" "}
                    <span className="tnum">{t.bench.length}</span> subs
                  </div>
                </div>
                <GhostButton onClick={() => load(t.id)} className="!px-3 !py-1 text-xs">
                  Load
                </GhostButton>
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
    </>
  );
}

/** The two halves of the Tactics screen (v1.65). Picking the side and setting
 * the side up are two different jobs done at different moments — the squad board
 * is the one you land on, the setup panel is where formation, saved tactics and
 * on-pitch roles live. Splitting them means neither has to share a column with
 * the other, so both get the full width on every screen size. */
type TacticsSection = "squad" | "setup";

export default function TacticsScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setTactic = useGame((s) => s.setTactic);
  const setLineupSlot = useGame((s) => s.setLineupSlot);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [section, setSection] = useState<TacticsSection>("squad");
  const [pickSlot, setPickSlot] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Phones get the tap-driven lineup instead of the drag-and-drop board.
  const isMobile = useIsMobile();
  /** Formation the user has clicked but not yet confirmed — see the switch
   * confirm below. Null when no switch is pending. */
  const [formationSwitch, setFormationSwitch] = useState<string | null>(null);

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
  const picked = Object.values(game.lineup).filter((id) => game.players[id]).length;

  // Average archetype synergy of the picked XI in the chosen style, as a
  // percentage — the headline number for "does this style suit my squad?".
  const xiPlayers = Object.values(game.lineup)
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p);
  const styleFit = xiPlayers.length
    ? (xiPlayers.reduce((sum, p) => sum + synergyOf(p, tactic.style), 0) / xiPlayers.length - 1) * 100
    : undefined;

  return (
    <div>
      {/* Squad first and selected by default (v1.65): picking the side is what
          this screen is for, so it's what you land on. Setup — saved tactics,
          formation, instructions and on-pitch roles — is the second section,
          visited when you want to change how the side plays rather than who is
          in it. Mobile drops the drag-and-drop surfaces — see MatchdayBoard. */}
      <Tabs<TacticsSection>
        tabs={[
          { id: "squad", label: "Squad" },
          { id: "setup", label: "Setup" },
        ]}
        active={section}
        onChange={setSection}
      />

      <div className={section === "squad" ? "" : "hidden"}>
        {isMobile ? (
          <MobileLineup onPickSlot={setPickSlot} onOpenPlayer={viewPlayer} />
        ) : (
          <MatchdayBoard onPickSlot={setPickSlot} onOpenPlayer={viewPlayer} />
        )}
      </div>

      {/* Setup keeps its subtree mounted (hidden rather than unmounted) so the
          Advanced-instructions disclosure and any half-typed state survive a
          trip to the Squad section and back. */}
      <div className={`grid grid-cols-1 gap-x-6 lg:grid-cols-2 ${section === "setup" ? "" : "hidden"}`}>
        <div>
          <SavedTactics />
          <Assignments />
        </div>
        <Section title="Setup">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-widest text-faint">Formation</div>
              <div className="flex flex-wrap gap-1.5">
                {FORMATIONS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      // Switching formation wipes the XI (the slots themselves
                      // change), so a picked side gets a confirm rather than
                      // vanishing on a stray click. An empty XI has nothing to
                      // lose and switches straight away.
                      if (f.id === tactic.formationId) return;
                      if (picked > 0) setFormationSwitch(f.id);
                      else setTactic({ formationId: f.id });
                    }}
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
      </div>

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

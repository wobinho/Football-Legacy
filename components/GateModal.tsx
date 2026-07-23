"use client";

// Progress gate prompt (§3). When a calendar "simulate ahead" spans an important
// day — a U21 registration deadline, a transfer window opening or closing, the
// youth intake — the loop pauses the day before it and the store surfaces the
// gate here. The user can jump to the relevant screen to act, wave it through
// and keep simulating toward their original destination, or stay put.

import { useGame } from "@/store/gameStore";
import { formatDay } from "@/lib/calendar";
import { useEscapeKey } from "./ui";

/** Per-gate accent so the prompt reads at a glance as "your youth" vs "the
 * market" vs "the clock". Keyed by the gate id prefix the gameloop stamps. */
function gateAccent(id: string): { icon: string; ring: string } {
  if (id.startsWith("u21reg") || id.startsWith("intake")) return { icon: "🎓", ring: "border-[#4a7bd0]/60" };
  if (id.startsWith("winOpen")) return { icon: "🟢", ring: "border-win/50" };
  if (id.startsWith("sumClose") || id.startsWith("winClose")) return { icon: "⏳", ring: "border-loss/50" };
  return { icon: "📌", ring: "border-gold-lo/60" };
}

const SCREEN_LABEL: Record<string, string> = {
  academy: "Go to Academy",
  transfers: "Go to Transfers",
};

export default function GateModal() {
  const gate = useGame((s) => s.pendingGate);
  const target = useGame((s) => s.pendingSimTarget);
  const setScreen = useGame((s) => s.setScreen);
  const dismissGate = useGame((s) => s.dismissGate);
  const simulateToDay = useGame((s) => s.simulateToDay);
  useEscapeKey(dismissGate);

  if (!gate) return null;

  const accent = gateAccent(gate.id);
  // "Keep going" only makes sense if there's still road left past the pause.
  const canContinue = target !== null && target > gate.day;

  const goThere = () => {
    if (gate.screen) setScreen(gate.screen);
    dismissGate();
  };
  const keepGoing = () => {
    if (target !== null) simulateToDay(target, gate.id);
    else dismissGate();
  };

  return (
    /* The gate is a stop the game deliberately made; it closes on its own
       controls (or ✕), never on a stray click into the backdrop. */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div
        className={`w-full max-w-sm rounded-lg border bg-surface p-5 shadow-2xl ${accent.ring}`}
        aria-label={gate.title}
      >
        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-2xl leading-none" aria-hidden>
            {accent.icon}
          </span>
          <div className="display flex-1 text-base font-semibold">{gate.title}</div>
          <button
            onClick={dismissGate}
            className="-mr-1 rounded px-2 py-1 text-dim transition-colors hover:bg-hover hover:text-ink"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>
        <div className="gold-thread mb-3" />

        <div className="mb-2 text-[11px] uppercase tracking-widest text-faint">
          Paused at {formatDay(gate.day - 1)}
        </div>
        <p className="text-[13px] leading-relaxed text-dim">{gate.body}</p>

        <div className="mt-4 flex flex-col gap-2">
          {gate.screen && (
            <button
              onClick={goThere}
              className="gold-grad display w-full rounded-md px-4 py-2 text-sm font-bold text-[#14120a]"
            >
              {SCREEN_LABEL[gate.screen] ?? "Take me there"}
            </button>
          )}
          <div className="flex gap-2">
            {canContinue && (
              <button
                onClick={keepGoing}
                className="flex-1 rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-dim hover:text-ink"
              >
                Keep simulating ▸
              </button>
            )}
            <button
              onClick={dismissGate}
              className="flex-1 rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-dim hover:text-ink"
            >
              Stay here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

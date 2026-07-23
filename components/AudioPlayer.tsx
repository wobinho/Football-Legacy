"use client";

// The soundtrack widget: a floating puck in the bottom-right corner that expands
// into a full transport with volume controls (v1.52).
//
// It used to live inline in the shell header, competing for space with the date,
// budget and Continue button — which meant the controls were cramped on desktop
// and reduced to a single icon on phones. A floating widget owns its own corner
// instead: collapsed it is just a play/pause puck showing that music is running,
// expanded it is the whole player.
//
// The player itself is `lib/audio.ts` — this component only renders it. That
// split is what lets the music survive screen changes: the <audio> element is
// owned by a module-level manager, never by a React subtree that unmounts.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { audio } from "@/lib/audio";
import { trackLabel } from "@/lib/config/audio";

/** Subscribe to the audio manager. Also boots it on first mount. */
export function useAudio() {
  const state = useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getServerSnapshot);
  useEffect(() => {
    audio.init();
  }, []);
  return state;
}

/** A labelled 0–100 volume slider. */
function VolumeRow({
  label,
  value,
  enabled,
  onValue,
  onToggle,
}: {
  label: string;
  value: number;
  enabled: boolean;
  onValue: (v: number) => void;
  onToggle: () => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="display text-[10px] font-semibold uppercase tracking-widest text-faint">{label}</span>
        <button
          onClick={onToggle}
          className={`display rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide transition-colors ${
            enabled ? "border-gold-lo/60 text-gold" : "border-line text-faint hover:text-dim"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onValue(Number(e.target.value) / 100)}
        disabled={!enabled}
        aria-label={`${label} volume`}
        className="mt-1.5 w-full accent-[var(--color-gold-hi)] disabled:opacity-40"
      />
    </div>
  );
}

/**
 * The floating soundtrack widget. Renders fixed to the bottom-right of the
 * viewport, above everything except modals (which sit at z-50).
 *
 * Collapsed: a single round puck. It plays/pauses on click when the music is
 * already going, and expands on click when it isn't — so the common case (mute
 * the music quickly) stays one click, and the uncommon one (change the volume)
 * is one click away.
 */
export default function AudioPlayer() {
  const state = useAudio();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Collapse on an outside click or Escape. This is a floating widget, not a
  // modal — dismissing it costs nothing, so an outside click is the right
  // behaviour here even though dialogs no longer work that way.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const btn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-30";
  const playing = state.musicEnabled && state.playing;

  return (
    <div ref={wrapRef} className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="w-64 rounded-lg border border-line bg-surface p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="display text-[11px] font-semibold uppercase tracking-widest text-faint">
              Soundtrack
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded px-1.5 py-0.5 text-dim transition-colors hover:bg-hover hover:text-ink"
              aria-label="Collapse player"
              title="Collapse"
            >
              ✕
            </button>
          </div>
          <div className="gold-thread mb-3" />

          {/* Now playing */}
          <div className="mb-2">
            <div className="display text-[9px] uppercase tracking-widest text-faint">Now playing</div>
            <div className="truncate text-[12px] text-ink" title={state.current ? trackLabel(state.current) : undefined}>
              {state.current ? trackLabel(state.current) : "—"}
            </div>
          </div>

          {/* Transport */}
          <div className="mb-3 flex items-center justify-center gap-1">
            <button
              onClick={() => audio.prev()}
              title="Previous track"
              aria-label="Previous track"
              className={btn}
              disabled={!state.musicEnabled}
            >
              <span className="text-[11px] leading-none">◀◀</span>
            </button>
            <button
              onClick={() => audio.toggleMusic()}
              title={state.musicEnabled ? "Pause music" : "Play music"}
              aria-label={state.musicEnabled ? "Pause music" : "Play music"}
              className={`${btn} ${playing ? "text-gold" : ""}`}
            >
              <span className="text-[13px] leading-none">{playing ? "❚❚" : "▶"}</span>
            </button>
            <button
              onClick={() => audio.next()}
              title="Next track"
              aria-label="Next track"
              className={btn}
              disabled={!state.musicEnabled}
            >
              <span className="text-[11px] leading-none">▶▶</span>
            </button>
          </div>

          <div className="space-y-3">
            <VolumeRow
              label="Music"
              value={state.musicVolume}
              enabled={state.musicEnabled}
              onValue={(v) => audio.setMusicVolume(v)}
              onToggle={() => audio.toggleMusic()}
            />
            <VolumeRow
              label="Sound Effects"
              value={state.sfxVolume}
              enabled={state.sfxEnabled}
              onValue={(v) => audio.setSfxVolume(v)}
              onToggle={() => audio.setSfxEnabled(!state.sfxEnabled)}
            />
          </div>
        </div>
      )}

      {/* The puck. Its ring lights gold while music is actually playing, so the
          widget doubles as an at-a-glance indicator without being expanded. */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Collapse music player" : "Music player"}
        aria-label={open ? "Collapse music player" : "Open music player"}
        aria-expanded={open}
        className={`flex h-11 w-11 items-center justify-center rounded-full border bg-surface shadow-xl transition-colors ${
          playing ? "border-gold-lo/70 text-gold" : "border-line text-dim hover:text-ink"
        }`}
      >
        <span className="text-[15px] leading-none">{playing ? "♪" : "🔇"}</span>
      </button>
    </div>
  );
}

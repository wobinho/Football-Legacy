"use client";

import { useEffect } from "react";
import { useGame } from "@/store/gameStore";
import { audio, playClick } from "@/lib/audio";
import MainMenu from "./MainMenu";
import Shell from "./Shell";
import KeyGate from "./KeyGate";

/**
 * The UI click sound, wired once for the whole app (v1.52).
 *
 * A delegated listener on the document beats calling playClick() from every
 * onClick: there are hundreds of buttons across the ten screens, and any new one
 * would otherwise arrive silent. Capture phase, so a handler that stops
 * propagation (the modals do) still clicks.
 *
 * Only genuinely interactive elements make a sound — clicking a table cell or a
 * paragraph should not — and a disabled control stays silent, because nothing
 * happened.
 */
function useClickSound() {
  useEffect(() => {
    audio.init();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        "button, a, select, [role='button'], input[type='checkbox'], input[type='radio']"
      );
      if (!el) return;
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;
      playClick();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

function BootedApp() {
  const booted = useGame((s) => s.booted);
  const hasGame = useGame((s) => s.game !== null);
  const boot = useGame((s) => s.boot);
  const toast = useGame((s) => s.toast);

  useClickSound();

  useEffect(() => {
    boot();
  }, [boot]);

  if (!booted) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="display text-2xl text-dim">FOOTBALL LEGACY</div>
      </div>
    );
  }

  return (
    <>
      {hasGame ? <Shell /> : <MainMenu />}
      {toast && (
        <div className="toast-in fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md border border-gold-lo bg-raised px-4 py-2 text-sm shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
}

export default function GameRoot() {
  // The key gate wraps everything: with auth configured (a public key embedded
  // in lib/auth.ts), a valid signed key is required before the game boots; with
  // auth off, the gate renders straight through.
  return (
    <KeyGate>
      <BootedApp />
    </KeyGate>
  );
}

"use client";

import { useEffect } from "react";
import { useGame } from "@/store/gameStore";
import MainMenu from "./MainMenu";
import Shell from "./Shell";
import KeyGate from "./KeyGate";

function BootedApp() {
  const booted = useGame((s) => s.booted);
  const hasGame = useGame((s) => s.game !== null);
  const boot = useGame((s) => s.boot);
  const toast = useGame((s) => s.toast);

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

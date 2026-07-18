"use client";

// The access gate: the app is locked behind one of the hardcoded game keys
// (lib/auth.ts). A valid key is remembered so it's asked only once, and its id
// becomes the save-owner namespace (local + cloud) via setCloudOwner — that's
// what gives each player their own persistent save space.

import { useEffect, useState } from "react";
import { verifyKey, storedKey, rememberKey, type GameKey } from "@/lib/auth";
import { setCloudOwner } from "@/lib/cloud";
import { GoldButton } from "./ui";

type Phase = "checking" | "locked" | "unlocked";

export default function KeyGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [gameKey, setGameKey] = useState<GameKey | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  // On mount: try the remembered key silently.
  useEffect(() => {
    const saved = storedKey();
    if (saved) {
      setCloudOwner(saved.id);
      setGameKey(saved);
      setPhase("unlocked");
    } else {
      setPhase("locked");
    }
  }, []);

  const submit = () => {
    const res = verifyKey(input);
    if (res.ok) {
      rememberKey(res.gameKey);
      setCloudOwner(res.gameKey.id);
      setGameKey(res.gameKey);
      setError(null);
      setPhase("unlocked");
    } else {
      setError(res.reason);
    }
  };

  if (phase === "unlocked") return <>{children}</>;

  if (phase === "checking") {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="display text-2xl text-dim">FOOTBALL LEGACY</div>
      </div>
    );
  }

  // locked — key entry
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <div className="display text-4xl font-bold tracking-wide sm:text-5xl">
            FOOTBALL <span className="gold-text">LEGACY</span>
          </div>
          <div className="gold-thread mx-auto mt-3 w-48" />
          <p className="mt-3 text-sm text-dim">Enter your game key to play.</p>
        </header>

        <div className="rounded-lg border border-line bg-surface p-5">
          <label className="block">
            <span className="display text-xs font-semibold tracking-widest text-faint">GAME KEY</span>
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
              spellCheck={false}
              className="mt-1 w-full break-all rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
            />
          </label>
          {error && <div className="mt-2 text-[13px] text-loss">{error}</div>}
          <div className="mt-4 flex justify-end">
            <GoldButton onClick={submit} disabled={!input.trim()}>
              UNLOCK
            </GoldButton>
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-faint">
          Your game key gives you your own save space. Need one? Ask the game owner.
        </p>
      </div>
    </div>
  );
}

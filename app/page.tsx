"use client";

import dynamic from "next/dynamic";

// The whole game is client-side (IndexedDB, zustand); skip SSR entirely.
const GameRoot = dynamic(() => import("@/components/GameRoot"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center">
      <div className="display text-2xl text-dim">FOOTBALL LEGACY</div>
    </div>
  ),
});

export default function Page() {
  return <GameRoot />;
}

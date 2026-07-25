"use client";

// GCN unlock + naming prompt (v34). Raised when GCN Funds first reach the
// threshold (dismissible — unlocking is opt-in). Naming it stands up the
// network and opens the GCN page.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { formatMoney } from "@/lib/value";
import { TUNING } from "@/lib/config/tuning";
import { GoldButton, Modal } from "../ui";

export default function GcnUnlockModal({ onClose }: { onClose: () => void }) {
  const unlock = useGame((s) => s.unlockGcn);
  const [name, setName] = useState("");
  const canConfirm = name.trim().length > 0;

  return (
    <Modal title="Unlock the Global Club Network" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-dim">
          You've reserved <span className="gold-text font-semibold">{formatMoney(TUNING.gcnUnlockFundsTarget)}</span>.
          Commit it and you become the head of a <span className="text-ink font-semibold">Global Club Network</span> —
          a network of clubs across leagues and countries. You keep managing your own club; the network is
          your macro empire on top of it.
        </p>
        <ul className="space-y-1.5 text-sm text-dim">
          <li>• Found new clubs or buy existing ones into the network.</li>
          <li>• Move players and run true feeder loans between your clubs.</li>
          <li>• Invest in network-wide Operations upgrades.</li>
        </ul>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-widest text-faint">
            Name your network
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={48}
            autoFocus
            placeholder="e.g. Aurora Football Group"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </div>
        <p className="text-[11px] text-faint">
          The reserved {formatMoney(TUNING.gcnUnlockFundsTarget)} is spent to establish the network. Afterwards
          the network runs its own treasury, which you top up from your club.
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-dim transition-colors hover:text-ink"
          >
            Not yet
          </button>
          <GoldButton disabled={!canConfirm} onClick={() => canConfirm && unlock(name)}>
            Establish Network
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

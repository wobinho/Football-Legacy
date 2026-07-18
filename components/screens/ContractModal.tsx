"use client";

// Contract negotiation modal (§10 v5). Used to renew a current player's deal:
// pick a wage and length, the player weighs it against their demand and either
// accepts, counters with their number, or walks. Kept deliberately light — one
// offer, an instant verdict, no multi-round haggling drama (design pillar §1).

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { PlayerBio } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { wageDemand, maxLengthFor, yearsLeft } from "@/lib/contracts";
import { formatMoney } from "@/lib/value";
import { GhostButton, GoldButton, Modal, Ovr } from "../ui";

export default function ContractModal({ p, onClose }: { p: PlayerBio; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const negotiate = useGame((s) => s.negotiateContract);
  const renew = useGame((s) => s.renewContract);

  const demand = useMemo(() => wageDemand(game, p, TUNING), [game, p]);
  const maxYears = maxLengthFor(p, TUNING);
  const [wage, setWage] = useState(demand);
  const [years, setYears] = useState(Math.min(TUNING.contractRenewYearsDefault, maxYears));
  const [feedback, setFeedback] = useState<string | null>(null);

  const budgetPerWeek = game.teams[game.userTeamId].budget;
  const current = yearsLeft(game, p);

  const submit = () => {
    const verdict = negotiate(p.id, wage, years);
    if (verdict.kind === "accepted") {
      renew(p.id, wage, years);
      onClose();
      return;
    }
    // player wants their number — offer to meet it
    setFeedback(verdict.message);
    if (verdict.kind === "countered") setWage(verdict.wage);
  };

  return (
    <Modal title={`Contract — ${p.name}`} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-sm text-dim">
        <span className="flex items-center gap-2">
          <Ovr value={p.overall} size="sm" /> {p.age}y
        </span>
        <span className="text-xs text-faint">
          {p.contract ? (
            <>
              Current: {formatMoney(p.contract.wage)}/wk · {current <= 1 ? "final year" : `${current} yrs left`}
            </>
          ) : (
            "No current contract"
          )}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-widest text-faint">
            <span>Weekly wage</span>
            <span className="tnum text-dim">{formatMoney(wage)}/wk</span>
          </div>
          <input
            type="number"
            value={wage}
            min={500}
            step={500}
            onChange={(e) => setWage(Math.max(0, Number(e.target.value)))}
            className="w-full rounded-md border border-line bg-raised px-3 py-2 tnum focus:border-gold focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] uppercase tracking-widest text-faint">Length</div>
          <div className="flex gap-1.5">
            {Array.from({ length: maxYears }, (_, i) => i + 1).map((y) => (
              <button
                key={y}
                onClick={() => setYears(y)}
                className={`display flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
                  years === y ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
                }`}
              >
                {y} yr{y > 1 ? "s" : ""}
              </button>
            ))}
          </div>
          {maxYears < TUNING.contractLengthMax && (
            <p className="mt-1 text-[11px] text-faint">At {p.age}, he&apos;ll only commit to {maxYears} year{maxYears > 1 ? "s" : ""}.</p>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-faint">
          <span>He&apos;s looking for around {formatMoney(demand)}/wk.</span>
          <button className="hover:text-dim" onClick={() => setWage(demand)}>
            Match demand
          </button>
        </div>

        {feedback && <div className="rounded-md border border-line bg-raised p-3 text-sm text-dim">{feedback}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose} className="!py-1.5">
            Cancel
          </GhostButton>
          <GoldButton onClick={submit} className="!py-1.5">
            OFFER {formatMoney(wage)}/wk
          </GoldButton>
        </div>
        {wage * 4 > budgetPerWeek && (
          <p className="text-[11px] text-loss">Heads up: this wage is a big share of your current budget.</p>
        )}
      </div>
    </Modal>
  );
}

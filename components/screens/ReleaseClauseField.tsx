"use client";

// Release clause control (§10, v21). Shared by every path that agrees terms —
// signing a player, signing a free agent, renewing an existing deal — so the
// clause always reads and behaves the same way wherever terms are struck.
//
// The trade is the whole point and so it's stated plainly: the player accepts
// less money per week in exchange for a fixed price at which anyone can buy him.
// The cheaper the clause, the bigger the discount, and the likelier it is that
// someone actually triggers it.

import type { PlayerBio } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { releaseClauseBounds, releaseClauseWageDiscount } from "@/lib/contracts";
import { formatMoney } from "@/lib/value";
import { MoneyInput } from "../ui";

export default function ReleaseClauseField({
  p,
  clause,
  onChange,
}: {
  p: PlayerBio;
  clause: number | null;
  onChange: (clause: number | null) => void;
}) {
  const bounds = releaseClauseBounds(p, TUNING);
  const enabled = clause !== null;
  const discount = releaseClauseWageDiscount(p, clause ?? undefined, TUNING);
  const tooLow = enabled && clause! < bounds.min;

  return (
    <div className="mt-4 border-t border-line/60 pt-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? bounds.suggested : null)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-gold)]"
        />
        <span className="min-w-0">
          <span className="text-[11px] uppercase tracking-widest text-faint">Release clause</span>
          <span className="ml-2 text-[10px] text-faint">optional</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-dim">
            A fixed fee any club can pay to take him — his club can&apos;t refuse it. He&apos;ll accept lower wages
            for the security of an exit route.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-2.5 pl-6.5">
          <div className="flex items-center gap-2">
            <span className="relative flex flex-1 items-center">
              <span className="pointer-events-none absolute left-3 text-dim">£</span>
              <MoneyInput
                value={clause!}
                onChange={(n) => onChange(Math.max(0, n))}
                min={0}
                className="w-full rounded-md border border-line bg-raised py-2 pl-7 pr-3 tnum focus:border-gold focus:outline-none"
              />
            </span>
            <button
              className="shrink-0 text-[11px] text-faint hover:text-dim"
              onClick={() => onChange(bounds.suggested)}
            >
              Suggested {formatMoney(bounds.suggested)}
            </button>
          </div>

          {tooLow ? (
            <div className="mt-1.5 text-[11px] text-loss">
              He won&apos;t be bought out that cheaply — the clause has to start around{" "}
              {formatMoney(bounds.min)}.
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-faint">
              <span>
                {discount > 0 ? (
                  <>
                    Worth <span className="text-win">{Math.round(discount * 100)}% off</span> his wage demand.
                  </>
                ) : (
                  <>Too remote to interest him — no wage discount.</>
                )}
              </span>
              <span>
                Cheapest he&apos;d take: {formatMoney(bounds.min)} · market value {formatMoney(p.value)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

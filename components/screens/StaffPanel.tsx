"use client";

// Shared staff department panel (v6). Renders the hire/dismiss market for one
// department's slots — used by Club (business/backroom), Development (coaching)
// and Academy (youth + scouting). Staff carry a nationality flag; each slot
// lists 3 candidates you can dismiss to reshuffle the shortlist (a fresh crop
// arrives ~2 days later).

import { useGame } from "@/store/gameStore";
import type { StaffDept, StaffSlot } from "@/lib/types";
import { staffSlotsForDept } from "@/lib/staff";
import { formatMoney } from "@/lib/value";
import { Card, ConfirmButton, Flag, Stars } from "../ui";

// A distinct accent colour per staff slot, so each position reads as its own
// bounded module (requirement: visual boundary + coloured borders per slot).
const SLOT_ACCENT: Record<StaffSlot, string> = {
  headCoach: "#d9a441", // gold — the marquee appointment
  assistantCoach: "#7ea6e0", // blue
  fitnessCoach: "#5fbf8a", // green
  physio: "#4fb8b8", // teal
  devCoach: "#c07de0", // violet
  gkCoach: "#e08a5f", // amber
  youthCoach: "#d9a441",
  scout: "#7ea6e0",
};

export default function StaffPanel({ dept, intro }: { dept: StaffDept; intro?: React.ReactNode }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const hire = useGame((s) => s.hire);
  const dismiss = useGame((s) => s.dismissStaff);
  const fire = useGame((s) => s.fireStaff);
  const team = game.teams[game.userTeamId];
  const slots = staffSlotsForDept(dept);

  return (
    <div className="space-y-6">
      {intro && <p className="max-w-3xl text-[13px] leading-relaxed text-dim">{intro}</p>}
      <div className="grid grid-cols-1 gap-x-6 gap-y-6 lg:grid-cols-2">
      {slots.map((def) => {
        const current = team.staff[def.slot];
        const all = game.staffMarket.filter((c) => c.slot === def.slot);
        const ready = all.filter((c) => c.availableDay === undefined || c.availableDay <= game.currentDay);
        const pending = all.length > 0 && ready.length === 0;
        const accent = SLOT_ACCENT[def.slot];
        return (
          // Each position is its own bounded module: a coloured left border + a
          // faint tint keyed to the slot's accent give a clear visual boundary.
          <section
            key={def.slot}
            className="rounded-lg border border-line p-3.5"
            style={{ borderLeft: `3px solid ${accent}`, background: `linear-gradient(to right, ${accent}0d, transparent 40%)` }}
          >
            <div className="mb-2.5 flex items-baseline justify-between">
              <h3 className="display text-sm font-semibold uppercase tracking-wide" style={{ color: accent }}>{def.title}</h3>
              <span className="text-xs text-faint">{def.buff}</span>
            </div>
            {def.dormant ? (
              <div className="rounded-md border border-line bg-raised p-3 text-sm text-faint">{def.dormant}.</div>
            ) : (
              <div className="space-y-2">
                {/* current appointment + live effect */}
                <Card className="p-3">
                  <div className="flex items-center justify-between">
                    {current ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Flag nat={current.nationality} size={12} />
                          <span className="font-semibold">{current.name}</span>
                          <span className="text-xs text-faint">{formatMoney(current.wage)}/wk</span>
                        </div>
                        <Stars n={current.stars} />
                      </>
                    ) : (
                      <span className="text-sm text-faint">Position vacant</span>
                    )}
                  </div>
                  {def.effectAt && (
                    <div className="mt-2 flex items-center gap-2 border-t border-line/60 pt-2 text-[12px]">
                      <span className="text-[10px] uppercase tracking-widest text-faint">Impact</span>
                      <span className={`display font-semibold ${current ? "gold-text" : "text-faint"}`}>
                        {def.effectAt(current?.stars ?? 0)}
                      </span>
                    </div>
                  )}
                  {current && (
                    <div className="mt-2 flex justify-end border-t border-line/60 pt-2">
                      <ConfirmButton
                        label="Fire"
                        confirmLabel={`Fire ${current.name}?`}
                        tone="danger"
                        onConfirm={() => fire(def.slot)}
                        className="!px-3 !py-1 text-xs"
                      />
                    </div>
                  )}
                </Card>

                {ready.length > 0 && <div className="text-[10px] uppercase tracking-widest text-faint">Available to hire</div>}
                {pending && (
                  <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-faint">
                    Shortlist cleared — new candidates arrive in a couple of days.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {ready.map((c) => {
                    const better = current ? c.stars > current.stars : true;
                    return (
                      <Card key={c.id} className="flex flex-col p-3">
                        <div className="flex items-center justify-between">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Flag nat={c.nationality} size={11} />
                            <span className="truncate text-sm font-medium">{c.name}</span>
                          </span>
                          <Stars n={c.stars} />
                        </div>
                        {def.effectAt && (
                          <div className={`mt-1 text-[11px] ${better ? "text-win" : "text-dim"}`}>{def.effectAt(c.stars)}</div>
                        )}
                        <div className="mt-1 text-[11px] text-faint">
                          Fee {formatMoney(c.fee)} · {formatMoney(c.wage)}/wk
                        </div>
                        <div className="mt-2 flex items-stretch gap-1.5">
                          <ConfirmButton
                            label={current ? "Replace" : "Hire"}
                            confirmLabel="Confirm?"
                            onConfirm={() => hire(c.id)}
                            className="flex-1 !px-2 !py-1 text-xs"
                          />
                          <button
                            onClick={() => dismiss(c.id)}
                            title="Dismiss — remove from the shortlist"
                            className="w-7 shrink-0 rounded border border-line text-sm leading-none text-dim transition-colors hover:border-loss/50 hover:text-loss"
                          >
                            ✕
                          </button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
      </div>
    </div>
  );
}

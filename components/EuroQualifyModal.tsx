"use client";

// ── European qualification setup (v1.65) ──────────────────────────────────
//
// The continental cups used to allocate their places from a fixed default the
// user never saw: the strongest nations got four Champions League slots, the
// next band three, and so on. That is a reasonable default, but it is not a
// design the manager chose — and because the world is built from whichever
// leagues the user switched on, there is no real-world slot table to copy from
// either. A save with England, Turkey and Scotland but no Spain has a shape the
// real competitions have never had.
//
// So the allocation is authored here instead. The user opens one country at a
// time, sees every finishing position in that country's top flight, and puts
// each position into a competition — 1st–4th to the Champions League, 5th–6th to
// the Europa League, 7th to the Conference League, or any other arrangement,
// gaps included. All three cups are configured in the same pass, because all
// three run simultaneously and a position can only feed one of them.
//
// The result is an `EuroSlotMap` per country — exactly the shape lib/european.ts
// reads at qualification time, so what is built here is what the world plays.

import { useMemo, useState } from "react";
import { EURO_CUP_DEFS, EURO_TEAMS_PER_CUP, defaultSlotMapFor, slotCounts, totalSlotCounts } from "@/lib/european";
import { CountryFlag, GhostButton, GoldButton, Modal } from "./ui";

/**
 * The competition colours are the real ones (the Champions League's is a very
 * dark navy), which reads on a light broadcast graphic but disappears against
 * this app's near-black surface. Each cup therefore gets a display colour for
 * the UI — the same hue lifted to something legible on a dark panel — while the
 * canonical `color` on EURO_CUP_DEFS stays untouched for everything else.
 */
const CUP_UI_COLOR: Record<number, string> = {
  1: "#5b7bd5", // Champions League navy, lifted
  2: "#F26A24", // Europa orange reads as-is
  3: "#00FF9D", // Conference green reads as-is
};

const cupColor = (tier: number) => CUP_UI_COLOR[tier] ?? "#8a8f9a";

/** One country the save includes, as the modal needs to know it. */
export interface EuroCountry {
  code: string;
  name: string;
  /** Clubs in its top flight — how many positions there are to allocate. */
  divisionSize: number;
}

/** The tier a position is assigned to: 0 = no European football. */
const NO_CUP = 0;

export default function EuroQualifyModal({
  countries,
  tiers,
  slots,
  cupWinnerQualifies,
  onApply,
  onClose,
}: {
  /** Every European country in the save, strongest first. */
  countries: EuroCountry[];
  /** How many cups this save runs (1–3). */
  tiers: number;
  slots: Record<string, number[]>;
  cupWinnerQualifies: boolean;
  onApply: (slots: Record<string, number[]>, cupWinnerQualifies: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, number[]>>(() => {
    // Start from whatever is already configured, filling in any country that has
    // no map yet with the engine default for its rank.
    const out: Record<string, number[]> = {};
    countries.forEach((c, i) => {
      out[c.code] = slots[c.code] ? [...slots[c.code]] : defaultSlotMapFor(i, tiers, c.divisionSize);
    });
    return out;
  });
  const [cupWinner, setCupWinner] = useState(cupWinnerQualifies);
  // Which country's positions are expanded. One at a time: a save can carry
  // twenty countries, and twenty open position grids is not a screen anyone can
  // read. Opens on the strongest nation, which is the one most users edit.
  const [open, setOpen] = useState<string | null>(countries[0]?.code ?? null);

  const totals = useMemo(() => totalSlotCounts(draft), [draft]);
  const activeCups = EURO_CUP_DEFS.slice(0, tiers);

  /** Put one finishing position into a competition (or take it out). */
  const assign = (code: string, position: number, tier: number) => {
    setDraft((d) => {
      const map = [...(d[code] ?? [])];
      // Pad with "no European football" so the position being set is addressable
      // even when nothing below it was assigned.
      while (map.length <= position) map.push(NO_CUP);
      map[position] = tier;
      // Trim trailing empties so the stored map stays the minimum that describes
      // the design — a map is read by position, so trailing zeroes say nothing.
      while (map.length && map[map.length - 1] === NO_CUP) map.pop();
      return { ...d, [code]: map };
    });
  };

  const resetToDefaults = () => {
    const out: Record<string, number[]> = {};
    countries.forEach((c, i) => {
      out[c.code] = defaultSlotMapFor(i, tiers, c.divisionSize);
    });
    setDraft(out);
  };

  return (
    <Modal title="European Qualification" onClose={onClose} size="lg">
      <p className="text-[11px] text-faint">
        All {tiers === 1 ? "one competition runs" : `${tiers} competitions run`} at the same time, so each
        finishing position feeds only one of them. Open a country and choose what its league places qualify
        for. Positions left blank play no European football.
      </p>

      {/* How full each competition is. A cup short of 32 is topped up at the draw
          from the best clubs not already qualified, so this is guidance rather
          than a hard gate — but a user building a real slot table wants to see it. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {activeCups.map((cup) => {
          const filled = totals[cup.tier - 1];
          const full = filled >= EURO_TEAMS_PER_CUP;
          return (
            <div
              key={cup.tier}
              className="flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-1.5"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cupColor(cup.tier) }} />
              <span className="text-sm text-dim">{cup.name}</span>
              <span className={`tnum text-sm font-semibold ${full ? "text-win" : "text-gold"}`}>
                {filled}
                <span className="text-faint">/{EURO_TEAMS_PER_CUP}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-faint">
        A competition short of {EURO_TEAMS_PER_CUP} is topped up at the draw from the best clubs who
        haven&apos;t qualified elsewhere, so an incomplete table still produces a full bracket.
      </p>

      <div className="mt-4 space-y-1.5">
        {countries.map((c) => {
          const map = draft[c.code] ?? [];
          const counts = slotCounts(map);
          const isOpen = open === c.code;
          return (
            <div key={c.code} className="rounded-md border border-line bg-surface">
              <button
                onClick={() => setOpen(isOpen ? null : c.code)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hover"
              >
                <span className="text-xs text-faint">{isOpen ? "▾" : "▸"}</span>
                <CountryFlag country={c.name} size={12} />
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                {/* The country's contribution at a glance, so a collapsed list
                    still reads as a slot table. */}
                <span className="flex shrink-0 items-center gap-1.5">
                  {activeCups.map((cup) => (
                    <span
                      key={cup.tier}
                      title={`${counts[cup.tier - 1]} into the ${cup.name}`}
                      className="tnum rounded-sm px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{
                        color: counts[cup.tier - 1] ? cupColor(cup.tier) : undefined,
                        border: `1px solid ${counts[cup.tier - 1] ? `${cupColor(cup.tier)}66` : "transparent"}`,
                      }}
                    >
                      {counts[cup.tier - 1] || "—"}
                    </span>
                  ))}
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] text-faint">{c.divisionSize} clubs</span>
              </button>

              {isOpen && (
                <div className="border-t border-line px-3 py-3">
                  <div className="space-y-1">
                    {Array.from({ length: c.divisionSize }, (_, pos) => {
                      const current = map[pos] ?? NO_CUP;
                      return (
                        <div key={pos} className="flex items-center gap-2">
                          <span className="tnum w-10 shrink-0 text-xs text-faint">
                            {ordinal(pos + 1)}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            <SlotButton
                              label="None"
                              active={current === NO_CUP}
                              onClick={() => assign(c.code, pos, NO_CUP)}
                            />
                            {activeCups.map((cup) => (
                              <SlotButton
                                key={cup.tier}
                                label={cup.short}
                                title={cup.name}
                                color={cupColor(cup.tier)}
                                active={current === cup.tier}
                                onClick={() => assign(c.code, pos, cup.tier)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tiers >= 2 && (
        <label className="mt-4 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={cupWinner}
            onChange={(e) => setCupWinner(e.target.checked)}
            className="mt-0.5 accent-gold"
          />
          <span className="text-sm text-dim">
            The domestic cup winner takes a {EURO_CUP_DEFS[1].name} place
            <span className="block text-[11px] text-faint">
              Only in your own country — the simulated nations play no knockout cup. If they&apos;ve already
              qualified through the league, the place simply isn&apos;t used.
            </span>
          </span>
        </label>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <GhostButton onClick={resetToDefaults}>Reset to defaults</GhostButton>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <GoldButton onClick={() => onApply(draft, cupWinner)}>SAVE QUALIFICATION</GoldButton>
      </div>
    </Modal>
  );
}

/** One competition choice for one finishing position. */
function SlotButton({
  label,
  title,
  color,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`display rounded-sm border px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors ${
        active ? "text-ink" : "border-line text-faint hover:text-dim"
      }`}
      style={active ? { borderColor: color ?? "var(--color-gold-lo)", background: color ? `${color}22` : undefined } : undefined}
    >
      {label}
    </button>
  );
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

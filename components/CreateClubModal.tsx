"use client";

// Create-a-club (new-game setup): design a custom club — identity, reputation,
// generated-squad strength — and pick which top-division club it replaces. The
// result is a ClubSeed that MainMenu splices into the playable country's
// database before worldgen runs; no engine code knows the club is custom.

import { useState } from "react";
import type { ClubSeed } from "@/lib/database";
import { clubBudget } from "@/lib/worldgen";
import { formatMoney, groupDigits, parseMoney } from "@/lib/value";
import { Crest, GoldButton, GhostButton, Modal } from "./ui";

/** Ceiling on a created club's starting transfer budget (v1.6): ten billion.
 * Budget is now set directly by the manager, no longer derived from reputation. */
export const MAX_CLUB_BUDGET = 10_000_000_000;

/** The setup-form state for a created club: the seed itself plus which slot in
 * the top division it takes over. */
export interface CustomClub {
  name: string;
  short: string;
  colors: [string, string];
  stadium: string;
  rep: number;
  /** Generated-squad strength (1–100), independent of reputation. */
  squadQuality: number;
  /** Target average overall of the generated squad (v1.53). Carried through from
   * a library club so an imported side keeps the strength it was authored with;
   * wins over `squadQuality` in worldgen when set. Not editable here. */
  squadAvgOverall?: number;
  /** Starting transfer budget in pounds. Set directly by the manager (v1.6, max
   * MAX_CLUB_BUDGET) — independent of reputation — or carried through from a
   * library club's authored budget. Always present once the form is saved. */
  budget?: number;
  /** Division the created club joins — the id of the tier it takes a slot in
   * (v1.43). Undefined means the top authored division, for older prefills. */
  divisionId?: string;
  /** Index into the target division's club list — the club being replaced. */
  replaceIndex: number;
}

export function customClubSeed(c: CustomClub): ClubSeed {
  return {
    name: c.name,
    short: c.short,
    colors: c.colors,
    rep: c.rep,
    stadium: c.stadium,
    squadQuality: c.squadQuality,
    // Preserve an authored average-overall / budget when one came through from a
    // library club; omit otherwise so worldgen keeps its reputation-derived path.
    ...(c.squadAvgOverall !== undefined ? { squadAvgOverall: c.squadAvgOverall } : {}),
    ...(c.budget !== undefined ? { budget: c.budget } : {}),
  };
}

function qualityLabel(q: number): string {
  if (q >= 86) return "World class";
  if (q >= 74) return "Title challengers";
  if (q >= 60) return "Solid mid-table";
  if (q >= 46) return "Battlers";
  return "Relegation fodder";
}

function repLabel(r: number): string {
  if (r >= 86) return "Continental giant";
  if (r >= 72) return "Established name";
  if (r >= 55) return "Respected club";
  return "Unfancied";
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  hint: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="display text-xs font-semibold tracking-widest text-faint">{label}</span>
        <span className="text-[11px] text-dim">
          <span className="display tnum mr-1.5 text-sm font-bold text-gold">{value}</span>
          {hint}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--color-gold-hi)]"
      />
    </label>
  );
}

export default function CreateClubModal({
  clubs,
  divisionId,
  divisionName,
  initial,
  onSave,
  onClose,
}: {
  /** The chosen start division's ORIGINAL clubs (replacement candidates). */
  clubs: ClubSeed[];
  /** Id of the division the created club joins (v1.43 — lower divisions too). */
  divisionId: string;
  /** Display name of that division, for the modal copy. */
  divisionName: string;
  initial: CustomClub | null;
  onSave: (club: CustomClub) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [short, setShort] = useState(initial?.short ?? "");
  const [stadium, setStadium] = useState(initial?.stadium ?? "");
  const [colors, setColors] = useState<[string, string]>(initial?.colors ?? ["#b8860b", "#0b0c0f"]);
  const [rep, setRep] = useState(initial?.rep ?? 60);
  const [squadQuality, setSquadQuality] = useState(initial?.squadQuality ?? 60);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(initial?.replaceIndex ?? null);
  // Carried through untouched from a library-imported club (no UI to edit here).
  const squadAvgOverall = initial?.squadAvgOverall;

  // Starting budget is set directly (v1.6), no longer tied to reputation. The
  // field is a free-text money box (accepts "250m", "1.5bn", grouped digits);
  // `budget` is the clamped value it resolves to, and drives the preview + save.
  const initialBudget = initial?.budget ?? clubBudget(initial?.rep ?? 60);
  const [budgetText, setBudgetText] = useState(groupDigits(initialBudget));
  const parsedBudget = parseMoney(budgetText);
  const budget = Math.min(MAX_CLUB_BUDGET, Math.max(0, parsedBudget ?? 0));
  const budgetOverMax = parsedBudget !== null && parsedBudget > MAX_CLUB_BUDGET;

  const shortClean = short.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const valid =
    name.trim().length > 0 &&
    shortClean.length >= 2 &&
    stadium.trim().length > 0 &&
    replaceIndex !== null &&
    parsedBudget !== null;

  return (
    <Modal title="Create Your Club" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border border-line bg-raised p-3">
          <Crest colors={colors} short={shortClean || "?"} size={40} />
          <div className="min-w-0">
            <div className="display truncate text-lg font-semibold">{name.trim() || "Your Club"}</div>
            <div className="text-[11px] text-faint">
              {stadium.trim() || "Your stadium"} · {repLabel(rep)} · Budget {formatMoney(budget)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="display text-xs font-semibold tracking-widest text-faint">CLUB NAME</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverton United"
              className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink placeholder:text-faint focus:border-gold focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="display text-xs font-semibold tracking-widest text-faint">SHORT CODE (2–4)</span>
            <input
              value={short}
              onChange={(e) => setShort(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              placeholder="e.g. RVU"
              className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 uppercase text-ink placeholder:normal-case placeholder:text-faint focus:border-gold focus:outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="display text-xs font-semibold tracking-widest text-faint">STADIUM</span>
            <input
              value={stadium}
              onChange={(e) => setStadium(e.target.value)}
              placeholder="e.g. Riverside Park"
              className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-ink placeholder:text-faint focus:border-gold focus:outline-none"
            />
          </label>
          <div className="block">
            <span className="display text-xs font-semibold tracking-widest text-faint">COLORS</span>
            <div className="mt-1 flex items-center gap-3">
              {([0, 1] as const).map((i) => (
                <label key={i} className="flex items-center gap-1.5 text-[11px] text-dim">
                  <input
                    type="color"
                    value={colors[i]}
                    onChange={(e) => {
                      const next: [string, string] = [...colors];
                      next[i] = e.target.value;
                      setColors(next);
                    }}
                    className="h-8 w-10 cursor-pointer rounded border border-line bg-raised p-0.5"
                  />
                  {i === 0 ? "Primary" : "Secondary"}
                </label>
              ))}
            </div>
          </div>
        </div>

        <Slider
          label="REPUTATION"
          value={rep}
          min={30}
          max={95}
          onChange={setRep}
          hint={repLabel(rep)}
        />
        <Slider
          label="SQUAD QUALITY"
          value={squadQuality}
          min={30}
          max={95}
          onChange={setSquadQuality}
          hint={`${qualityLabel(squadQuality)} · starters ≈ ${Math.round(40 + squadQuality * 0.5)} OVR`}
        />

        <label className="block">
          <span className="flex items-baseline justify-between">
            <span className="display text-xs font-semibold tracking-widest text-faint">STARTING BUDGET</span>
            <span className="text-[11px] text-dim">
              <span className="display tnum mr-1.5 text-sm font-bold text-gold">{formatMoney(budget)}</span>
              max {formatMoney(MAX_CLUB_BUDGET)}
            </span>
          </span>
          <div className="mt-1 flex items-center gap-2">
            <span className="display text-sm text-faint">£</span>
            <input
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={() =>
                setBudgetText(groupDigits(parseMoney(budgetText) !== null ? budget : initialBudget))
              }
              inputMode="numeric"
              placeholder="e.g. 250m"
              className={`w-full rounded-md border bg-raised px-3 py-2 tnum text-ink placeholder:text-faint focus:outline-none ${
                parsedBudget === null || budgetOverMax ? "border-loss focus:border-loss" : "border-line focus:border-gold"
              }`}
            />
            <button
              type="button"
              onClick={() => setBudgetText(groupDigits(clubBudget(rep)))}
              className="shrink-0 rounded-md border border-line px-2 py-2 text-[11px] text-dim transition-colors hover:border-gold hover:text-gold"
              title="Use the budget a club of this reputation would normally start with"
            >
              Rep-based
            </button>
          </div>
          <p className="mt-1 text-[11px] text-faint">
            {parsedBudget === null
              ? "Enter a starting budget (accepts figures like 250m or 1.5bn)."
              : budgetOverMax
                ? `Capped at ${formatMoney(MAX_CLUB_BUDGET)} — that's the most you can start with.`
                : "Set independently of reputation. Accepts shorthand like 250m or 1.5bn."}
          </p>
        </label>

        <div>
          <span className="display text-xs font-semibold tracking-widest text-faint">
            CLUB TO REPLACE — {divisionName}
          </span>
          <p className="mb-2 mt-0.5 text-[11px] text-faint">
            Your club takes this club&apos;s place in {divisionName} — the league keeps its size.
          </p>
          <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto pr-1">
            {clubs.map((c, i) => (
              <button
                key={c.short + i}
                onClick={() => setReplaceIndex(i)}
                className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors ${
                  replaceIndex === i ? "border-gold bg-hover" : "border-line bg-surface hover:bg-hover"
                }`}
              >
                <Crest colors={c.colors} short={c.short} size={24} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{c.name}</div>
                  <div className="text-[10px] text-faint">Rep {c.rep}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton
            disabled={!valid}
            onClick={() =>
              replaceIndex !== null &&
              onSave({
                name: name.trim(),
                short: shortClean,
                colors,
                stadium: stadium.trim(),
                rep,
                squadQuality,
                ...(squadAvgOverall !== undefined ? { squadAvgOverall } : {}),
                budget,
                divisionId,
                replaceIndex,
              })
            }
          >
            SAVE CLUB
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

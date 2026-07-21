"use client";

// Library club editor (v25): design a reusable custom club — identity, colours,
// reputation, generated-squad strength — and optionally hand-pick a roster from
// the players already saved in the library. SAVE persists it to the library so
// it can be dropped into any new legacy later (replacing a top-flight side).
//
// Unlike CreateClubModal (new-game setup) there's no "club to replace" here:
// placement happens when the club is pulled into a world, not when it's built.

import { useState } from "react";
import type { LibraryClub, LibraryPlayer } from "@/lib/customdb";
import { libraryPlayerToSeed } from "@/lib/customdb";
import { clubBudget } from "@/lib/worldgen";
import { formatMoney } from "@/lib/value";
import { overallFromAttrs } from "@/lib/config/positions";
import { Crest, Flag, GoldButton, GhostButton, Modal, Ovr, PosBadge } from "./ui";

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

export default function LibraryClubModal({
  libraryPlayers,
  initial,
  onSave,
  onClose,
}: {
  /** The saved library players available to add to this club's roster. */
  libraryPlayers: LibraryPlayer[];
  /** The club being edited, or null to create a new one. */
  initial: LibraryClub | null;
  /** Called with the finished club. `id`/`updatedAt` are set by the store.
   * `rosterIds` are the library-player ids chosen for the roster. */
  onSave: (club: Omit<LibraryClub, "updatedAt" | "players">, rosterIds: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [short, setShort] = useState(initial?.short ?? "");
  const [stadium, setStadium] = useState(initial?.stadium ?? "");
  const [colors, setColors] = useState<[string, string]>(initial?.colors ?? ["#b8860b", "#0b0c0f"]);
  const [rep, setRep] = useState(initial?.rep ?? 60);
  const [squadQuality, setSquadQuality] = useState(initial?.squadQuality ?? 60);
  // Roster: which saved library players are attached. Stored on the club as full
  // seeds, but tracked here by the library-player id so the picker stays in sync
  // and re-editing a saved club re-selects the right entries by name match.
  const [rosterIds, setRosterIds] = useState<string[]>(() => {
    if (!initial?.players?.length) return [];
    // Re-map the saved seed roster back to library ids by (name, primary pos).
    const key = (n: string, p: string) => `${n.toLowerCase()}|${p}`;
    const byKey = new Map(libraryPlayers.map((lp) => [key(lp.name, lp.positions[0]), lp.id]));
    return initial.players
      .map((seed) => byKey.get(key(seed.name, seed.positions[0])))
      .filter((id): id is string => Boolean(id));
  });

  const shortClean = short.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const valid = name.trim().length > 0 && shortClean.length >= 2 && stadium.trim().length > 0;

  const toggleRoster = (id: string) =>
    setRosterIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  return (
    <Modal title={initial ? "Edit Club" : "Create Your Club"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border border-line bg-raised p-3">
          <Crest colors={colors} short={shortClean || "?"} size={40} />
          <div className="min-w-0">
            <div className="display truncate text-lg font-semibold">{name.trim() || "Your Club"}</div>
            <div className="text-[11px] text-faint">
              {stadium.trim() || "Your stadium"} · {repLabel(rep)} · Est. budget {formatMoney(clubBudget(rep))}
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
          hint={`${repLabel(rep)} · budget ${formatMoney(clubBudget(rep))}`}
        />
        <Slider
          label="SQUAD QUALITY"
          value={squadQuality}
          min={30}
          max={95}
          onChange={setSquadQuality}
          hint={`${qualityLabel(squadQuality)} · fills any roster gaps`}
        />

        {/* Optional roster: attach saved library players. Anything not filled by
            these is generated at the squad-quality strength above. */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="display text-xs font-semibold tracking-widest text-faint">ROSTER (OPTIONAL)</span>
            <span className="text-[11px] text-faint">{rosterIds.length} added</span>
          </div>
          {libraryPlayers.length === 0 ? (
            <p className="mt-1 text-[11px] text-faint">
              Save some players to your library first, then attach them to this club here.
            </p>
          ) : (
            <>
              <p className="mb-2 mt-0.5 text-[11px] text-faint">
                Hand-pick saved players for this club. Any remaining squad slots are generated at the strength above.
              </p>
              <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {libraryPlayers.map((lp) => {
                  const on = rosterIds.includes(lp.id);
                  const ovr = overallFromAttrs(lp.attrs, lp.positions[0]);
                  return (
                    <button
                      key={lp.id}
                      onClick={() => toggleRoster(lp.id)}
                      className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors ${
                        on ? "border-gold bg-hover" : "border-line bg-surface hover:bg-hover"
                      }`}
                    >
                      <span className="text-[13px] text-faint">{on ? "✓" : "＋"}</span>
                      <Flag nat={lp.nationality} size={12} />
                      <PosBadge pos={lp.positions[0]} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{lp.name}</span>
                      <Ovr value={ovr} size="sm" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton
            disabled={!valid}
            onClick={() =>
              onSave(
                {
                  id: initial?.id ?? "",
                  name: name.trim(),
                  short: shortClean,
                  colors,
                  stadium: stadium.trim(),
                  rep,
                  squadQuality,
                },
                rosterIds
              )
            }
          >
            SAVE CLUB
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

/** Resolve chosen library-player ids into the ClubSeed roster stored on a
 * library club. Exported so the editor screen can build the club entry. */
export function rosterSeedsFor(ids: string[], libraryPlayers: LibraryPlayer[]) {
  const byId = new Map(libraryPlayers.map((lp) => [lp.id, lp]));
  return ids
    .map((id) => byId.get(id))
    .filter((lp): lp is LibraryPlayer => Boolean(lp))
    .map(libraryPlayerToSeed);
}

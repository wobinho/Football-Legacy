"use client";

// Library club editor (v25): design a reusable custom club — identity, colours,
// reputation, generated-squad strength — and optionally hand-pick a roster from
// the players already saved in the library. SAVE persists it to the library so
// it can be dropped into any new legacy later (replacing a top-flight side).
//
// Unlike CreateClubModal (new-game setup) there's no "club to replace" here:
// placement happens when the club is pulled into a world, not when it's built.

import { useEffect, useState } from "react";
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
  onCreatePlayer,
  autoSelectId,
}: {
  /** The saved library players available to add to this club's roster. */
  libraryPlayers: LibraryPlayer[];
  /** The club being edited, or null to create a new one. */
  initial: LibraryClub | null;
  /** Called with the finished club. `id`/`updatedAt` are set by the store.
   * `rosterIds` are the library-player ids chosen for the roster; `rosterTerms`
   * carries each rostered player's authored wage / contract years. */
  onSave: (
    club: Omit<LibraryClub, "updatedAt" | "players">,
    rosterIds: string[],
    rosterTerms: Record<string, RosterTerms>
  ) => void;
  onClose: () => void;
  /** Open the create-a-player flow for a brand-new roster member (v1.45). The
   * parent authors the player, saves it to the library, and hands its id back via
   * `autoSelectId` so it lands in this club's roster without leaving the modal. */
  onCreatePlayer?: () => void;
  /** A library-player id to auto-add to the roster (a player just created via
   * `onCreatePlayer`). Bumped by the parent each time; the effect below folds it
   * into the selection. */
  autoSelectId?: string | null;
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

  // Per-roster-member contract terms (v1.46): wage + years remaining, keyed by
  // library-player id. Only a rostered player is "in a team", so these terms
  // exist here rather than on the standalone library player. Reconstructed from
  // the saved seeds when re-editing a club (same name/pos re-map as rosterIds).
  const [rosterTerms, setRosterTerms] = useState<Record<string, RosterTerms>>(() => {
    if (!initial?.players?.length) return {};
    const key = (n: string, p: string) => `${n.toLowerCase()}|${p}`;
    const byKey = new Map(libraryPlayers.map((lp) => [key(lp.name, lp.positions[0]), lp.id]));
    const out: Record<string, RosterTerms> = {};
    for (const seed of initial.players) {
      const id = byKey.get(key(seed.name, seed.positions[0]));
      if (!id) continue;
      if (seed.wage !== undefined || seed.contractYears !== undefined) {
        out[id] = { wage: seed.wage, contractYears: seed.contractYears };
      }
    }
    return out;
  });

  const setTerm = (id: string, patch: RosterTerms) =>
    setRosterTerms((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  // A player just authored via "＋ New player" (parent saved it to the library and
  // handed its id here) is auto-added to this club's roster.
  useEffect(() => {
    if (autoSelectId) setRosterIds((r) => (r.includes(autoSelectId) ? r : [...r, autoSelectId]));
  }, [autoSelectId]);

  // Roster picker search (v1.45): a library of many saved players is a long list,
  // so filter it by name / position as you type.
  const [rosterQuery, setRosterQuery] = useState("");
  const filteredPlayers = libraryPlayers.filter((lp) => {
    const q = rosterQuery.trim().toLowerCase();
    if (!q) return true;
    return lp.name.toLowerCase().includes(q) || lp.positions[0].toLowerCase().includes(q);
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
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-faint">{rosterIds.length} added</span>
              {onCreatePlayer && (
                <button onClick={onCreatePlayer} className="text-[11px] text-gold hover:underline">
                  ＋ New player
                </button>
              )}
            </div>
          </div>
          <p className="mb-2 mt-0.5 text-[11px] text-faint">
            Hand-pick saved players for this club — or create a brand-new one for it with{" "}
            <span className="text-dim">＋ New player</span>. Any remaining squad slots are generated at the strength above.
          </p>
          {libraryPlayers.length === 0 ? (
            <p className="mt-1 rounded-md border border-dashed border-line bg-surface px-3 py-4 text-center text-[11px] text-faint">
              No saved players yet. Use <span className="text-gold">＋ New player</span> to build this club&apos;s squad —
              a Haaland for your Man City.
            </p>
          ) : (
            <>
              {libraryPlayers.length > 6 && (
                <input
                  value={rosterQuery}
                  onChange={(e) => setRosterQuery(e.target.value)}
                  placeholder="Search players by name or position…"
                  className="mb-2 w-full rounded-md border border-line bg-raised px-3 py-1.5 text-[13px] text-ink placeholder:text-faint focus:border-gold focus:outline-none"
                />
              )}
              <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredPlayers.length === 0 && (
                  <p className="col-span-full py-3 text-center text-[11px] text-faint">No players match &ldquo;{rosterQuery}&rdquo;.</p>
                )}
                {filteredPlayers.map((lp) => {
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

        {/* Contract terms (v1.46): a player is only "in a team" once he's on this
            club's roster, so his wage and years-remaining are edited here. Blank
            = let the wage curve / a default-length deal decide at world build. */}
        {rosterIds.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="display text-xs font-semibold tracking-widest text-faint">CONTRACTS (OPTIONAL)</span>
              <span className="text-[11px] text-faint">{rosterIds.length} rostered</span>
            </div>
            <p className="mb-2 mt-0.5 text-[11px] text-faint">
              Set each rostered player&apos;s weekly wage and years left on his deal. Leave a field blank to let the game
              decide.
            </p>
            <div className="space-y-1.5">
              {rosterIds.map((id) => {
                const lp = libraryPlayers.find((x) => x.id === id);
                if (!lp) return null;
                const t = rosterTerms[id] ?? {};
                return (
                  <div key={id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-2">
                    <Flag nat={lp.nationality} size={12} />
                    <PosBadge pos={lp.positions[0]} />
                    <span className="min-w-0 flex-1 basis-28 truncate text-[13px] font-medium">{lp.name}</span>
                    <label className="flex items-center gap-1 text-[11px] text-faint">
                      <span className="hidden sm:inline">Wage £</span>
                      <span className="sm:hidden">£</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        inputMode="numeric"
                        value={t.wage ?? ""}
                        placeholder="auto"
                        onChange={(e) => {
                          const v = e.target.value;
                          setTerm(id, { wage: v === "" ? undefined : Math.max(0, Math.round(Number(v) || 0)) });
                        }}
                        className="tnum w-20 rounded border border-line bg-surface px-2 py-1.5 text-ink placeholder:text-faint focus:border-gold focus:outline-none"
                      />
                      <span className="hidden text-faint sm:inline">/wk</span>
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-faint">
                      <span>Yrs</span>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        inputMode="numeric"
                        value={t.contractYears ?? ""}
                        placeholder="auto"
                        onChange={(e) => {
                          const v = e.target.value;
                          setTerm(id, {
                            contractYears: v === "" ? undefined : Math.max(1, Math.min(6, Math.round(Number(v) || 1))),
                          });
                        }}
                        className="tnum w-14 rounded border border-line bg-surface px-2 py-1.5 text-ink placeholder:text-faint focus:border-gold focus:outline-none"
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                rosterIds,
                // Only keep terms for players still on the roster.
                Object.fromEntries(rosterIds.filter((id) => rosterTerms[id]).map((id) => [id, rosterTerms[id]]))
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

/** A rostered player's authored contract terms — wage per week and years left.
 * Keyed by library-player id, kept alongside the roster selection so a player is
 * only "in a team" (and so carries a contract) when attached to a club here. */
export interface RosterTerms {
  wage?: number;
  contractYears?: number;
}

/** Resolve chosen library-player ids into the ClubSeed roster stored on a
 * library club, folding in any per-player contract terms. Exported so the editor
 * screen can build the club entry. */
export function rosterSeedsFor(
  ids: string[],
  libraryPlayers: LibraryPlayer[],
  terms?: Record<string, RosterTerms>
) {
  const byId = new Map(libraryPlayers.map((lp) => [lp.id, lp]));
  return ids
    .map((id) => (byId.has(id) ? { id, lp: byId.get(id)! } : null))
    .filter((x): x is { id: string; lp: LibraryPlayer } => Boolean(x))
    .map(({ id, lp }) => {
      const seed = libraryPlayerToSeed(lp);
      const t = terms?.[id];
      if (t?.wage !== undefined) seed.wage = t.wage;
      if (t?.contractYears !== undefined) seed.contractYears = t.contractYears;
      return seed;
    });
}

"use client";

// Import from the default database (v1.47).
//
// Browse the real-world database that ships with the game and pull any club or
// player into the editor's library as an EDITABLE COPY. This is what makes the
// Database Editor an editor of the default data rather than only a creator of
// new content: import Liverpool, change what you like, and the edited version is
// what drops into your next save.
//
// The shipped assets are never written to. An import is a deep copy stamped with
// a fresh library id, so the original stays intact for other saves.

import { useEffect, useMemo, useState } from "react";
import type { CountryDatabase, ClubSeed, PlayerSeed } from "@/lib/database";
import type { LibraryClub, LibraryPlayer } from "@/lib/customdb";
import { seedToLibraryClub, seedToLibraryPlayer } from "@/lib/customdb";
import { PRESETS, loadPreset } from "@/lib/config/presets";
import { overallFromAttrs } from "@/lib/config/positions";
import { matchesPlayerName, matchesText } from "@/lib/search";
import { CountryFlag, Crest, Flag, Modal, Ovr, PosBadge } from "./ui";

/** A club row flattened out of the loaded country database. */
interface ClubRow {
  seed: ClubSeed;
  divisionName: string;
  tier: number;
}

/** A player row, carrying the club it came from for display + nationality fallback. */
interface PlayerRow {
  seed: PlayerSeed;
  clubName: string;
  overall: number;
}

export default function ImportFromDefaultModal({
  mode,
  onImportClub,
  onImportPlayer,
  onClose,
}: {
  /** Which tab of the editor opened this — clubs or players. */
  mode: "clubs" | "players";
  /** Import a club. `roster` is the club's real squad, already converted to
   * library players — the editor must save those too, because the club modal
   * re-maps a roster to library entries by (name, position). Without them a
   * re-saved club would silently lose its squad. */
  onImportClub: (club: LibraryClub, roster: LibraryPlayer[]) => void;
  onImportPlayer: (player: LibraryPlayer) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState<string>(PRESETS[0]?.code ?? "ENG");
  const [db, setDb] = useState<CountryDatabase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Which imported ids have been pulled in this session, for the ✓ affordance. */
  const [imported, setImported] = useState<Set<string>>(new Set());

  // Load the picked country's database. Presets are cached by loadPreset(), so
  // flipping back to a country already seen is instant.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDb(null);
    loadPreset(code)
      .then((loaded) => {
        if (!cancelled) setDb(loaded);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load that database.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const clubRows = useMemo<ClubRow[]>(() => {
    if (!db) return [];
    return [...db.divisions]
      .sort((a, b) => a.tier - b.tier)
      .flatMap((d) => d.clubs.map((seed) => ({ seed, divisionName: d.name, tier: d.tier })));
  }, [db]);

  const playerRows = useMemo<PlayerRow[]>(() => {
    if (!db) return [];
    const rows: PlayerRow[] = [];
    for (const d of db.divisions) {
      for (const club of d.clubs) {
        for (const seed of club.players ?? []) {
          const attrs = seed.attrs;
          rows.push({
            seed,
            clubName: club.name,
            overall: attrs ? overallFromAttrs(attrs, seed.positions[0]) : (seed.overall ?? 60),
          });
        }
      }
    }
    // Best first — importing usually means reaching for a name you know.
    return rows.sort((a, b) => b.overall - a.overall);
  }, [db]);

  // Accent-insensitive (v1.5), and player search covers the seed's full name so
  // "Desire Doue" finds the row the list renders as "D. Doué".
  const q = query.trim();
  // Long lists are capped: 18k players can't render, and a search narrows fast.
  const LIMIT = 60;
  const shownClubs = useMemo(
    () => (!q ? clubRows : clubRows.filter((c) => matchesText(c.seed.name, q))).slice(0, LIMIT),
    [clubRows, q]
  );
  const shownPlayers = useMemo(
    () =>
      (!q
        ? playerRows
        : playerRows.filter((p) => matchesPlayerName(p.seed, q) || matchesText(p.clubName, q))
      ).slice(0, LIMIT),
    [playerRows, q]
  );

  const totalShown = mode === "clubs" ? clubRows.length : playerRows.length;
  const visible = mode === "clubs" ? shownClubs.length : shownPlayers.length;

  const markImported = (key: string) => setImported((s) => new Set(s).add(key));

  return (
    <Modal title={`Import from the default database`} onClose={onClose} size="lg">
      <p className="mb-3 text-[13px] leading-relaxed text-dim">
        Pull a real {mode === "clubs" ? "club" : "player"} into your library as an editable copy. Change anything you
        like — the shipped database stays untouched, and your edited version is what drops into a new legacy.
      </p>

      {/* Country picker */}
      <div className="mb-3">
        <span className="display text-[11px] font-semibold tracking-widest text-faint">COUNTRY</span>
        <select
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setQuery("");
          }}
          className="mt-1 w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
        >
          {PRESETS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name} — {p.clubs ?? 0} clubs, {p.players ?? 0} players
            </option>
          ))}
        </select>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={mode === "clubs" ? "Search clubs…" : "Search players or clubs…"}
        className="mb-3 w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
      />

      {loading && <p className="py-8 text-center text-sm text-faint">Loading database…</p>}
      {error && <p className="py-8 text-center text-sm text-loss">{error}</p>}

      {!loading && !error && db && (
        <>
          <div className="mb-2 flex items-center gap-2 text-[11px] text-faint">
            <CountryFlag country={db.name} size={13} />
            <span>
              Showing {visible} of {totalShown}
              {visible < totalShown ? " — search to narrow" : ""}
            </span>
          </div>

          <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
            {mode === "clubs"
              ? shownClubs.map((row, i) => {
                  const key = `${db.code}:${row.seed.name}`;
                  const done = imported.has(key);
                  return (
                    <div
                      key={`${key}:${i}`}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2"
                    >
                      <Crest colors={row.seed.colors} short={row.seed.short} size={28} />
                      <div className="min-w-0 flex-1 basis-40">
                        <div className="truncate text-sm font-medium">{row.seed.name}</div>
                        <div className="text-[11px] text-faint">
                          {row.divisionName} · Rep {row.seed.rep}
                          {row.seed.players?.length ? ` · ${row.seed.players.length} players` : " · generated squad"}
                        </div>
                      </div>
                      <ImportButton
                        done={done}
                        onClick={() => {
                          const roster = (row.seed.players ?? []).map((p) => seedToLibraryPlayer(p, db.nat));
                          onImportClub(seedToLibraryClub(row.seed), roster);
                          markImported(key);
                        }}
                      />
                    </div>
                  );
                })
              : shownPlayers.map((row, i) => {
                  const key = `${db.code}:${row.clubName}:${row.seed.name}`;
                  const done = imported.has(key);
                  return (
                    <div
                      key={`${key}:${i}`}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2"
                    >
                      <Flag nat={row.seed.nationality ?? db.nat} size={13} />
                      <PosBadge pos={row.seed.positions[0]} />
                      <div className="min-w-0 flex-1 basis-32">
                        <div className="truncate text-sm font-medium">{row.seed.name}</div>
                        <div className="text-[11px] text-faint tnum">
                          {row.clubName}
                          {row.seed.age ? ` · Age ${row.seed.age}` : ""}
                        </div>
                      </div>
                      <Ovr value={row.overall} size="sm" />
                      <ImportButton
                        done={done}
                        onClick={() => {
                          onImportPlayer(seedToLibraryPlayer(row.seed, db.nat));
                          markImported(key);
                        }}
                      />
                    </div>
                  );
                })}

            {visible === 0 && (
              <p className="rounded-md border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-faint">
                Nothing matches &ldquo;{query}&rdquo;.
              </p>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function ImportButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded border px-2 py-1 text-[11px] transition-colors ${
        done
          ? "border-line text-win"
          : "border-gold-lo/50 text-gold hover:bg-hover"
      }`}
      title={done ? "Imported — click to import another copy" : "Copy into your library"}
    >
      {done ? "✓ Imported" : "Import"}
    </button>
  );
}

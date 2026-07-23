"use client";

// Database Editor (v25): a persistent library of custom clubs and players that
// the user builds once and can pull into ANY new legacy. This is the "database
// creator" — create-a-club / create-a-player, but saved.
//
// It reads and mutates the owner-scoped library in the store (lib/customdb.ts).
// Clubs may carry a hand-picked roster drawn from the saved players, so the two
// compose: build players, then assemble clubs from them. Placement into a world
// happens later, at new-game setup — nothing here touches a running save.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { LibraryClub, LibraryPlayer } from "@/lib/customdb";
import { libraryId } from "@/lib/customdb";
import { NAME_POOLS } from "@/lib/config/names";
import { COUNTRIES } from "@/lib/config/countries";
import { PRESETS } from "@/lib/config/presets";
import { overallFromAttrs } from "@/lib/config/positions";
import { clubBudget, squadAvgForQuality } from "@/lib/worldgen";
import { formatMoney } from "@/lib/value";
import { matchesAny, matchesPlayerName } from "@/lib/search";
import { Crest, Flag, GhostButton, Ovr, PosBadge } from "./ui";
import LibraryClubModal, { rosterSeedsFor } from "./LibraryClubModal";
import LibraryPlayerModal from "./LibraryPlayerModal";
import ImportFromDefaultModal from "./ImportFromDefaultModal";

/** Squad average for a pre-v1.51 club still on the 1–100 quality dial. Each call
 * generates probe squads, so memoize per dial value — the club list would
 * otherwise re-run the whole thing for every row on every render. */
const legacyAvgCache = new Map<number, number>();
function legacyAvg(quality: number): number {
  const key = Math.round(quality);
  let v = legacyAvgCache.get(key);
  if (v === undefined) {
    v = squadAvgForQuality(key);
    legacyAvgCache.set(key, v);
  }
  return v;
}

/** Nationality codes offered when authoring a player — every name pool plus
 * every selectable country/preset code. */
const NAT_OPTIONS: string[] = Array.from(
  new Set([
    ...NAME_POOLS.map((p) => p.nat),
    ...COUNTRIES.map((c) => c.code),
    ...PRESETS.map((p) => p.code),
  ])
).sort();

export default function DatabaseEditor({ onBack }: { onBack: () => void }) {
  const library = useGame((s) => s.library);
  const saveLibraryClub = useGame((s) => s.saveLibraryClub);
  const removeLibraryClub = useGame((s) => s.removeLibraryClub);
  const saveLibraryPlayer = useGame((s) => s.saveLibraryPlayer);
  const removeLibraryPlayer = useGame((s) => s.removeLibraryPlayer);
  const showToast = useGame((s) => s.showToast);

  const [tab, setTab] = useState<"clubs" | "players">("clubs");
  /** null = closed, "new" = creating, otherwise the entry being edited. */
  const [clubModal, setClubModal] = useState<LibraryClub | "new" | null>(null);
  const [playerModal, setPlayerModal] = useState<LibraryPlayer | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Create-a-player launched from INSIDE the club modal (v1.45): the club modal
  // stays mounted underneath, and the id of the just-saved player is handed back
  // via `autoAddPlayerId` so it lands straight in the club's roster. `nestedPlayer`
  // being non-null renders the player modal ON TOP of the club modal.
  const [nestedPlayer, setNestedPlayer] = useState(false);
  const [autoAddPlayerId, setAutoAddPlayerId] = useState<string | null>(null);
  // Import-from-the-default-database browser (v1.47). Open on whichever tab the
  // user is on, so "Import" always means the thing they're currently looking at.
  const [importOpen, setImportOpen] = useState(false);

  // Search both libraries by name (and clubs by short code); empty = show all.
  // Accent-insensitive throughout (v1.5): "Doue" finds "Doué". Player search
  // also covers the full name, so a first name the row abbreviates still hits.
  const q = query.trim();
  const shownClubs = useMemo(
    () => (!q ? library.clubs : library.clubs.filter((c) => matchesAny([c.name, c.short], q))),
    [library.clubs, q]
  );
  const shownPlayers = useMemo(
    () =>
      !q
        ? library.players
        : library.players.filter(
            (p) => matchesPlayerName(p, q) || matchesAny([p.positions[0], p.nationality], q)
          ),
    [library.players, q]
  );

  /** Save a copy of a library entry under a new id so the user can spin a variant
   * (a B-team, an alternate Haaland) without rebuilding it. */
  const duplicateClub = (c: LibraryClub) => {
    saveLibraryClub({ ...c, id: libraryId("club"), name: `${c.name} (copy)` });
    showToast(`Copied ${c.name}.`);
  };
  const duplicatePlayer = (p: LibraryPlayer) => {
    saveLibraryPlayer({ ...p, id: libraryId("player"), name: `${p.name} (copy)` });
    showToast(`Copied ${p.name}.`);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="display text-xs font-semibold tracking-widest text-faint">DATABASE EDITOR</div>
        <p className="mt-1 text-sm text-dim">
          Build custom clubs and players, or <b className="text-ink">import them from the default database</b> and edit
          the real thing — change Liverpool&apos;s squad, retune a player, then drop your version into a new legacy.
          Attach players to a club to author a whole team that plugs into any save intact. Your library lives on this
          device, tied to your key; the shipped database is never modified.
        </p>
      </div>

      {/* Tab switch */}
      <div className="flex items-center gap-1 rounded-md border border-line p-0.5">
        {(["clubs", "players"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`display flex-1 rounded px-3 py-2 text-xs font-semibold tracking-widest transition-colors ${
              tab === t ? "bg-hover text-ink" : "text-faint hover:text-dim"
            }`}
          >
            {t === "clubs" ? `CLUBS (${library.clubs.length})` : `PLAYERS (${library.players.length})`}
          </button>
        ))}
      </div>

      {/* Library search — filters whichever tab is active. */}
      {(library.clubs.length > 0 || library.players.length > 0) && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === "clubs" ? "Search clubs…" : "Search players…"}
          className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
        />
      )}

      {tab === "clubs" ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-dim">Custom clubs — each can replace a top-flight side.</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setImportOpen(true)} className="text-[11px] text-gold hover:underline">
                ↓ Import from default
              </button>
              <button onClick={() => setClubModal("new")} className="text-[11px] text-gold hover:underline">
                ＋ Create a club
              </button>
            </div>
          </div>
          {library.clubs.length === 0 ? (
            <EmptyState
              label="No custom clubs yet."
              action="Create your first club"
              onClick={() => setClubModal("new")}
              secondaryAction="Import one from the default database"
              onSecondary={() => setImportOpen(true)}
            />
          ) : shownClubs.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-faint">
              No clubs match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="space-y-2">
              {shownClubs.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <Crest colors={c.colors} short={c.short} size={30} />
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-faint">
                      Squad avg{" "}
                      <span className="tnum">{c.squadAvgOverall ?? legacyAvg(c.squadQuality ?? c.rep)}</span> ·
                      Budget {formatMoney(c.budget ?? clubBudget(c.rep))}
                      {c.players?.length ? ` · ${c.players.length} authored` : ""}
                    </div>
                  </div>
                  <RowActions
                    onEdit={() => setClubModal(c)}
                    onDuplicate={() => duplicateClub(c)}
                    confirming={confirmDelete === c.id}
                    onAskDelete={() => setConfirmDelete(c.id)}
                    onCancelDelete={() => setConfirmDelete(null)}
                    onConfirmDelete={() => {
                      removeLibraryClub(c.id);
                      setConfirmDelete(null);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-dim">Custom players — attach them to clubs or drop them into any squad.</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setImportOpen(true)} className="text-[11px] text-gold hover:underline">
                ↓ Import from default
              </button>
              <button onClick={() => setPlayerModal("new")} className="text-[11px] text-gold hover:underline">
                ＋ Create a player
              </button>
            </div>
          </div>
          {library.players.length === 0 ? (
            <EmptyState
              label="No custom players yet."
              action="Create your first player"
              onClick={() => setPlayerModal("new")}
              secondaryAction="Import one from the default database"
              onSecondary={() => setImportOpen(true)}
            />
          ) : shownPlayers.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-faint">
              No players match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="space-y-2">
              {shownPlayers.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <Flag nat={p.nationality} size={13} />
                  <PosBadge pos={p.positions[0]} />
                  <div className="min-w-0 flex-1 basis-32">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-[11px] text-faint tnum">
                      Age {p.age} · Potential {p.potential}
                    </div>
                  </div>
                  <Ovr value={overallFromAttrs(p.attrs, p.positions[0])} size="sm" />
                  <RowActions
                    onEdit={() => setPlayerModal(p)}
                    onDuplicate={() => duplicatePlayer(p)}
                    confirming={confirmDelete === p.id}
                    onAskDelete={() => setConfirmDelete(p.id)}
                    onCancelDelete={() => setConfirmDelete(null)}
                    onConfirmDelete={() => {
                      removeLibraryPlayer(p.id);
                      setConfirmDelete(null);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="flex justify-between pt-2">
        <GhostButton onClick={onBack}>← Back to menu</GhostButton>
      </div>

      {/* Import browser (v1.47): copies a real club/player out of the shipped
          database and straight into the library, where it edits like any other
          entry. Stays open so several can be pulled in one visit. */}
      {importOpen && (
        <ImportFromDefaultModal
          mode={tab}
          onImportClub={(club, roster) => {
            // The club modal re-maps a roster to library players by (name,
            // position), so an imported squad has to exist in the library too —
            // otherwise re-saving the club would quietly drop all of it. Players
            // already saved under the same name+position are reused rather than
            // duplicated, so importing two clubs never doubles up a shared name.
            const key = (n: string, p: string) => `${n.toLowerCase()}|${p}`;
            const existing = new Set(library.players.map((p) => key(p.name, p.positions[0])));
            let added = 0;
            for (const p of roster) {
              if (existing.has(key(p.name, p.positions[0]))) continue;
              saveLibraryPlayer(p);
              existing.add(key(p.name, p.positions[0]));
              added++;
            }
            saveLibraryClub(club);
            showToast(
              added
                ? `${club.name} imported with ${added} player${added === 1 ? "" : "s"}.`
                : `${club.name} imported — edit it in your library.`
            );
          }}
          onImportPlayer={(player) => {
            saveLibraryPlayer(player);
            showToast(`${player.name} imported — edit them in your library.`);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

      {clubModal !== null && (
        <LibraryClubModal
          libraryPlayers={library.players}
          initial={clubModal === "new" ? null : clubModal}
          onSave={(club, rosterIds, rosterTerms) => {
            const roster = rosterSeedsFor(rosterIds, library.players, rosterTerms);
            saveLibraryClub({ ...club, players: roster.length ? roster : undefined });
            setClubModal(null);
            setAutoAddPlayerId(null);
            showToast(clubModal === "new" ? `${club.name} added to your library.` : `${club.name} updated.`);
          }}
          onClose={() => {
            setClubModal(null);
            setAutoAddPlayerId(null);
          }}
          onCreatePlayer={() => setNestedPlayer(true)}
          autoSelectId={autoAddPlayerId}
        />
      )}
      {/* Standalone create/edit player (Players tab) — hidden while a nested
          create-a-player is open over the club modal so only one shows at a time. */}
      {playerModal !== null && !nestedPlayer && (
        <LibraryPlayerModal
          natOptions={NAT_OPTIONS}
          initial={playerModal === "new" ? null : playerModal}
          onSave={(player) => {
            saveLibraryPlayer(player);
            setPlayerModal(null);
            showToast(playerModal === "new" ? `${player.name} added to your library.` : `${player.name} updated.`);
          }}
          onClose={() => setPlayerModal(null)}
        />
      )}
      {/* Nested create-a-player launched from the club modal (v1.45): renders on
          top of the still-open club modal. On save, the new player is added to the
          library and its id handed to the club modal to auto-select in the roster. */}
      {nestedPlayer && (
        <LibraryPlayerModal
          natOptions={NAT_OPTIONS}
          initial={null}
          onSave={(player) => {
            const id = saveLibraryPlayer(player);
            setAutoAddPlayerId(id);
            setNestedPlayer(false);
            showToast(`${player.name} added — attached to this club.`);
          }}
          onClose={() => setNestedPlayer(false)}
        />
      )}
    </div>
  );
}

function RowActions({
  onEdit,
  onDuplicate,
  confirming,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  onEdit: () => void;
  onDuplicate?: () => void;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  // Tap targets sized for a phone (min 32px high) while staying compact on
  // desktop. The action cluster can wrap to its own line on a narrow row.
  const btn = "rounded border px-2.5 py-1.5 text-[11px] min-h-[32px]";
  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={onConfirmDelete} className={`${btn} border-loss text-loss hover:bg-hover`}>
          Delete
        </button>
        <button onClick={onCancelDelete} className={`${btn} border-line text-dim hover:text-ink`}>
          Keep
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onEdit} className={`${btn} border-line text-dim hover:text-ink`}>
        Edit
      </button>
      {onDuplicate && (
        <button onClick={onDuplicate} className={`${btn} border-line text-dim hover:text-ink`} title="Save a copy">
          Copy
        </button>
      )}
      <button
        onClick={onAskDelete}
        className={`${btn} border-line text-faint hover:text-loss`}
        title="Remove from library"
      >
        ✕
      </button>
    </div>
  );
}

function EmptyState({
  label,
  action,
  onClick,
  secondaryAction,
  onSecondary,
}: {
  label: string;
  action: string;
  onClick: () => void;
  /** Optional second route out of the empty state — used to offer importing
   * from the default database alongside authoring something from scratch. */
  secondaryAction?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface px-4 py-8 text-center">
      <p className="text-sm text-faint">{label}</p>
      <button onClick={onClick} className="mt-2 block w-full text-[13px] text-gold hover:underline">
        {action} →
      </button>
      {secondaryAction && onSecondary && (
        <button onClick={onSecondary} className="mt-1 block w-full text-[13px] text-gold hover:underline">
          {secondaryAction} →
        </button>
      )}
    </div>
  );
}

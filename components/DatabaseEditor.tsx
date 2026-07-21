"use client";

// Database Editor (v25): a persistent library of custom clubs and players that
// the user builds once and can pull into ANY new legacy. This is the "database
// creator" — create-a-club / create-a-player, but saved.
//
// It reads and mutates the owner-scoped library in the store (lib/customdb.ts).
// Clubs may carry a hand-picked roster drawn from the saved players, so the two
// compose: build players, then assemble clubs from them. Placement into a world
// happens later, at new-game setup — nothing here touches a running save.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import type { LibraryClub, LibraryPlayer } from "@/lib/customdb";
import { NAME_POOLS } from "@/lib/config/names";
import { COUNTRIES } from "@/lib/config/countries";
import { PRESETS } from "@/lib/config/presets";
import { overallFromAttrs } from "@/lib/config/positions";
import { Crest, Flag, GhostButton, Ovr, PosBadge } from "./ui";
import LibraryClubModal, { rosterSeedsFor } from "./LibraryClubModal";
import LibraryPlayerModal from "./LibraryPlayerModal";

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

  return (
    <div className="space-y-6">
      <div>
        <div className="display text-xs font-semibold tracking-widest text-faint">DATABASE EDITOR</div>
        <p className="mt-1 text-sm text-dim">
          Build custom clubs and players once, save them, and drop any of them into a new legacy. Your library lives on
          this device, tied to your key.
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

      {tab === "clubs" ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-dim">Custom clubs — each can replace a top-flight side.</span>
            <button onClick={() => setClubModal("new")} className="text-[11px] text-gold hover:underline">
              ＋ Create a club
            </button>
          </div>
          {library.clubs.length === 0 ? (
            <EmptyState label="No custom clubs yet." action="Create your first club" onClick={() => setClubModal("new")} />
          ) : (
            <div className="space-y-2">
              {library.clubs.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <Crest colors={c.colors} short={c.short} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-faint">
                      Rep {c.rep} · Squad {c.squadQuality ?? c.rep}
                      {c.players?.length ? ` · ${c.players.length} authored` : ""}
                    </div>
                  </div>
                  <RowActions
                    onEdit={() => setClubModal(c)}
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
            <button onClick={() => setPlayerModal("new")} className="text-[11px] text-gold hover:underline">
              ＋ Create a player
            </button>
          </div>
          {library.players.length === 0 ? (
            <EmptyState label="No custom players yet." action="Create your first player" onClick={() => setPlayerModal("new")} />
          ) : (
            <div className="space-y-2">
              {library.players.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <Flag nat={p.nationality} size={13} />
                  <PosBadge pos={p.positions[0]} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-[11px] text-faint tnum">
                      Age {p.age} · Potential {p.potential}
                    </div>
                  </div>
                  <Ovr value={overallFromAttrs(p.attrs, p.positions[0])} size="sm" />
                  <RowActions
                    onEdit={() => setPlayerModal(p)}
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

      {clubModal !== null && (
        <LibraryClubModal
          libraryPlayers={library.players}
          initial={clubModal === "new" ? null : clubModal}
          onSave={(club, rosterIds) => {
            const roster = rosterSeedsFor(rosterIds, library.players);
            saveLibraryClub({ ...club, players: roster.length ? roster : undefined });
            setClubModal(null);
            showToast(clubModal === "new" ? `${club.name} added to your library.` : `${club.name} updated.`);
          }}
          onClose={() => setClubModal(null)}
        />
      )}
      {playerModal !== null && (
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
    </div>
  );
}

function RowActions({
  onEdit,
  confirming,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  onEdit: () => void;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={onConfirmDelete} className="rounded border border-loss px-2 py-1 text-[11px] text-loss hover:bg-hover">
          Delete
        </button>
        <button onClick={onCancelDelete} className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:text-ink">
          Keep
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onEdit} className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:text-ink">
        Edit
      </button>
      <button
        onClick={onAskDelete}
        className="rounded border border-line px-2 py-1 text-[11px] text-faint hover:text-loss"
        title="Remove from library"
      >
        ✕
      </button>
    </div>
  );
}

function EmptyState({ label, action, onClick }: { label: string; action: string; onClick: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-surface px-4 py-8 text-center">
      <p className="text-sm text-faint">{label}</p>
      <button onClick={onClick} className="mt-2 text-[13px] text-gold hover:underline">
        {action} →
      </button>
    </div>
  );
}

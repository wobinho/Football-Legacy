"use client";

// Detailed team card — a popup overlay opened from the Competition screen when
// a club is clicked. Shows club identity, league standing, finances, and the
// squad (each player opens the full profile). Read-only: it's a scouting glance
// at any club in the world, not a management surface.

import { useMemo } from "react";
import { useGame } from "@/store/gameStore";
import { computeTable } from "@/lib/season";
import { formatDayShort } from "@/lib/calendar";
import { POS_ORDER } from "@/lib/config/positions";
import { getArchetype } from "@/lib/config/archetypes";
import { squadWageBill } from "@/lib/value";
import { TUNING } from "@/lib/config/tuning";
import type { Fixture } from "@/lib/types";
import { ArchetypeIcon, Card, Crest, Flag, Money, Ovr, PosBadge, useEscapeKey } from "../ui";

export default function TeamCard({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  useEscapeKey(onClose);

  const team = game.teams[teamId];
  const league = game.leagues[team.leagueId];

  const squad = useMemo(
    () =>
      team.playerIds
        .map((id) => game.players[id])
        .filter(Boolean)
        .sort(
          (a, b) =>
            POS_ORDER.indexOf(a.positions[0]) - POS_ORDER.indexOf(b.positions[0]) || b.overall - a.overall
        ),
    [team.playerIds, game.players]
  );

  // Standing: playable leagues have a live table; sim leagues use the last
  // resolved table if there is one.
  const standing = useMemo(() => {
    if (league?.playable) {
      const table = computeTable(game.fixtures, team.leagueId, league.teamIds);
      const pos = table.findIndex((r) => r.teamId === teamId);
      return pos >= 0 ? { pos: pos + 1, of: table.length } : null;
    }
    const sim = game.simResults.find((r) => r.leagueId === team.leagueId);
    if (!sim) return null;
    const pos = sim.table.findIndex((r) => r.teamId === teamId);
    return pos >= 0 ? { pos: pos + 1, of: sim.table.length } : null;
  }, [game.fixtures, game.simResults, team.leagueId, league, teamId]);

  // This season's leaders, drawn from the squad's running stats. Populated live
  // for playable leagues and by the sim resolver for the rest, so both work.
  const topScorer = useMemo(() => {
    const best = squad.filter((p) => p.stats.goals > 0).sort((a, b) => b.stats.goals - a.stats.goals)[0];
    return best ? { p: best, value: best.stats.goals } : null;
  }, [squad]);
  const topAssist = useMemo(() => {
    const best = squad.filter((p) => p.stats.assists > 0).sort((a, b) => b.stats.assists - a.stats.assists)[0];
    return best ? { p: best, value: best.stats.assists } : null;
  }, [squad]);

  // Recent results (this season). Only playable leagues carry per-fixture data;
  // sim leagues resolve statistically, so there's nothing to list for them.
  const recent = useMemo(() => {
    if (!league?.playable) return [] as Fixture[];
    return game.fixtures
      .filter((f) => f.played && (f.homeId === teamId || f.awayId === teamId))
      .sort((a, b) => b.day - a.day || b.round - a.round)
      .slice(0, 8);
  }, [game.fixtures, league, teamId]);

  const avgOvr = squad.length ? Math.round(squad.reduce((s, p) => s + p.overall, 0) / squad.length) : 0;
  const squadValue = squad.reduce((s, p) => s + p.value, 0);
  const wageBill = squadWageBill(squad, TUNING);

  const stat = (label: string, value: React.ReactNode) => (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-center">
      <div className="display tnum text-lg font-bold text-ink">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative my-auto w-full max-w-2xl rounded-lg border border-line bg-surface p-5 shadow-2xl">
        {/* The ✕ (and Escape) are the only ways out — a backdrop click no longer
            dismisses, so a stray click can't close the card. */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded px-2 py-1 text-faint transition-colors hover:bg-hover hover:text-ink sm:right-5 sm:top-5"
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>

        {/* header */}
        <div className="mb-5 flex items-center gap-4 rounded-lg border border-line bg-raised p-5">
          <Crest colors={team.colors} short={team.short} size={56} />
          <div className="min-w-0 flex-1">
            <div className="display text-2xl font-bold leading-tight">{team.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-dim">
              <span>{league?.name ?? "—"}</span>
              {standing && (
                <>
                  <span className="text-faint">·</span>
                  <span>
                    {standing.pos}
                    {ordinal(standing.pos)} of {standing.of}
                  </span>
                </>
              )}
              <span className="text-faint">·</span>
              <span>{team.stadium}</span>
            </div>
          </div>
        </div>

        {/* stats */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat("Avg Ovr", avgOvr || "—")}
          {stat("Squad", squad.length)}
          {stat("Reputation", team.reputation)}
          {stat("Value", <Money value={squadValue} />)}
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {stat("Budget", <Money value={team.budget} />)}
          {stat("Wage bill / wk", <Money value={wageBill} />)}
        </div>

        {/* season leaders */}
        {(topScorer || topAssist) && (
          <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LeaderCard
              label="Top Scorer"
              suffix="goals"
              leader={topScorer}
              onView={(id) => {
                onClose();
                viewPlayer(id);
              }}
            />
            <LeaderCard
              label="Top Assists"
              suffix="assists"
              leader={topAssist}
              onView={(id) => {
                onClose();
                viewPlayer(id);
              }}
            />
          </div>
        )}

        {/* recent results (playable leagues only) */}
        {recent.length > 0 && (
          <div className="mb-5">
            <div className="mb-1 flex items-end justify-between">
              <h3 className="display text-lg font-semibold">Recent Results</h3>
              <span className="text-xs text-faint">This season</span>
            </div>
            <div className="gold-thread mb-3" />
            <Card className="divide-y divide-line/50">
              {recent.map((f) => {
                const home = f.homeId === teamId;
                const oppId = home ? f.awayId : f.homeId;
                const opp = game.teams[oppId];
                const gf = home ? f.homeGoals! : f.awayGoals!;
                const ga = home ? f.awayGoals! : f.homeGoals!;
                const shootoutWon = f.shootoutWinnerId ? f.shootoutWinnerId === teamId : null;
                const won = shootoutWon ?? gf > ga;
                const lost = f.shootoutWinnerId ? !shootoutWon : gf < ga;
                const badge = won ? "W" : lost ? "L" : "D";
                const badgeTone = won ? "bg-win/20 text-win" : lost ? "bg-loss/20 text-loss" : "bg-draw/20 text-draw";
                const compLabel = f.competition === "CUP" ? "Cup" : game.leagues[f.competition]?.name ?? "";
                return (
                  <div key={f.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                    <span className={`display flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-bold ${badgeTone}`}>
                      {badge}
                    </span>
                    <span className="w-10 shrink-0 text-[10px] uppercase text-faint">{home ? "vs" : "at"}</span>
                    <Crest colors={opp.colors} short={opp.short} size={16} />
                    <span className="min-w-0 flex-1 truncate">{opp.name}</span>
                    <span className="shrink-0 tnum text-[10px] text-faint">{formatDayShort(f.day)}</span>
                    <span className="display w-12 shrink-0 text-center tnum font-semibold">
                      {gf}–{ga}
                    </span>
                    {compLabel && <span className="hidden w-14 shrink-0 truncate text-right text-[10px] text-faint sm:inline">{compLabel}</span>}
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        {/* squad */}
        <div className="mb-1 flex items-end justify-between">
          <h3 className="display text-lg font-semibold">Squad</h3>
          <span className="text-xs text-faint">Tap a player for their profile</span>
        </div>
        <div className="gold-thread mb-3" />
        <Card className="max-h-[45vh] overflow-y-auto">
          {squad.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onClose();
                viewPlayer(p.id);
              }}
              className="flex w-full items-center gap-3 border-b border-line/50 px-3 py-2 text-left text-sm last:border-0 hover:bg-hover"
            >
              <PosBadge pos={p.positions[0]} />
              <span className="flex items-center gap-1.5">
                <Flag nat={p.nationality} size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="hidden items-center gap-1.5 truncate text-[11px] text-faint sm:flex">
                <ArchetypeIcon archetypeId={p.archetypeId} size={12} />
                {getArchetype(p.archetypeId).name}
              </span>
              <span className="w-8 text-center tnum text-[11px] text-faint">{p.age}y</span>
              <Ovr value={p.overall} size="sm" />
            </button>
          ))}
          {squad.length === 0 && <div className="p-4 text-sm text-faint">No players.</div>}
        </Card>
      </div>
    </div>
  );
}

/** A season-leader tile (top scorer / assists): headshot-free, name + tally.
 * Renders a muted placeholder when the club has nobody on the board yet. */
function LeaderCard({
  label,
  suffix,
  leader,
  onView,
}: {
  label: string;
  suffix: string;
  leader: { p: import("@/lib/types").PlayerBio; value: number } | null;
  onView: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{label}</div>
      {leader ? (
        <button onClick={() => onView(leader.p.id)} className="flex w-full items-center justify-between text-left hover:text-gold">
          <span className="flex min-w-0 items-center gap-1.5">
            <Flag nat={leader.p.nationality} size={13} />
            <span className="min-w-0 truncate text-sm font-medium">{leader.p.name}</span>
          </span>
          <span className="display shrink-0 tnum text-sm font-bold">
            {leader.value}
            <span className="ml-1 text-[10px] font-normal text-faint">{suffix}</span>
          </span>
        </button>
      ) : (
        <div className="text-sm text-faint">—</div>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

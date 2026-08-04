"use client";

// Detailed team card — a popup overlay opened from the Competition screen when
// a club is clicked. Shows club identity, league standing, finances, and the
// squad (each player opens the full profile). Read-only: it's a scouting glance
// at any club in the world, not a management surface.

import { useMemo } from "react";
import { useGame } from "@/store/gameStore";
import { computeTable } from "@/lib/season";
import { formatDayShort } from "@/lib/calendar";
import { POS_ORDER, POS_GROUP, POS_GROUP_COLORS, type PosGroup } from "@/lib/config/positions";
import { squadOverall } from "@/lib/selection";
import { getFormation } from "@/lib/config/formations";
import { squadWageBill } from "@/lib/value";
import { TUNING } from "@/lib/config/tuning";
import type { Fixture } from "@/lib/types";
import { BackButton, Card, Crest, Flag, Money, Ovr, ArchetypeLabel, PosBadge, useEscapeKey } from "../ui";

// Plural department names for the strength tiles. POS_GROUP_COLORS carries the
// singular ("Goalkeeper"), which is right for a legend and wrong for a column
// heading counting a group of players.
const DEPT_LABEL: Record<PosGroup, string> = {
  GK: "Goalkeepers",
  DEF: "Defenders",
  MID: "Midfielders",
  ATT: "Forwards",
};

/**
 * The team card, wired to the store's overlay stack (v1.91).
 *
 * It used to be the Competition screen's own local state, which meant only that
 * screen could open a club and a club could never be opened from a player's
 * profile. `teamId` is now optional: given, it renders that club (the legacy
 * call site); omitted, it renders `store.selectedTeamId` and nothing at all when
 * that is null — which is how the app mounts one global instance.
 */
export default function TeamCard({ teamId, onClose }: { teamId?: string; onClose?: () => void }) {
  const game = useGame((s) => s.game);
  const storeTeamId = useGame((s) => s.selectedTeamId);
  const storeClose = useGame((s) => s.closeTeam);

  const id = teamId ?? storeTeamId;
  const close = onClose ?? storeClose;
  // The body below reads a club unconditionally, so the gate lives out here —
  // an inner component keeps its hooks off the "nothing is open" path.
  if (!game || !id || !game.teams[id]) return null;
  return <TeamCardBody key={id} teamId={id} onClose={close} />;
}

function TeamCardBody({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const canBack = useGame((s) => s.overlayStack.length > 0);
  const back = useGame((s) => s.overlayBack);
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

  // Club overall (v1.90): the XI this club would actually field, plus the bench
  // behind it — not a flat mean over the whole roster, which rewarded carrying
  // fewer fringe players. `squadOverall` is the shared rule (lib/selection.ts)
  // and it picks through the same `pickLineup` the matchday path uses, against
  // the club's OWN formation, so the card can never quote an XI the simulation
  // wouldn't name.
  const strength = useMemo(
    () => squadOverall(squad, getFormation(team.tactic?.formationId ?? "433"), TUNING),
    [squad, team.tactic?.formationId]
  );

  // Departmental strength: the club's average overall in each of the four broad
  // position groups. A single squad average hides the shape of a side — a club
  // that averages 72 might be 80 up front and 64 at the back, and that is the
  // thing a manager is actually scouting for. Grouped by POS_GROUP off each
  // player's primary position, so the split matches the badge colours the rows
  // below already use. `n` rides along to caption the tile and to distinguish
  // "no players here" from "average happens to be low".
  const departments = useMemo(() => {
    const groups: PosGroup[] = ["GK", "DEF", "MID", "ATT"];
    return groups.map((g) => {
      const members = squad.filter((p) => POS_GROUP[p.positions[0]] === g);
      const avg = members.length
        ? Math.round(members.reduce((s, p) => s + p.overall, 0) / members.length)
        : null;
      return { group: g, avg, n: members.length };
    });
  }, [squad]);
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
        {/* The ✕ (and Escape) dismiss the card — a backdrop click no longer
            does, so a stray click can't close it. ← steps back to whatever
            overlay the user opened this club FROM (v1.91), and only appears
            when there is one. */}
        <div className="absolute right-4 top-4 flex items-center gap-1.5 sm:right-5 sm:top-5">
          {canBack && <BackButton onClick={back} />}
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* header */}
        <div className="mb-5 flex items-center gap-4 rounded-lg border border-line bg-raised p-5 pr-14 sm:pr-28">
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
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat("Overall", strength.overall || "—")}
          {stat("Squad", squad.length)}
          {stat("Reputation", team.reputation)}
          {stat("Value", <Money value={squadValue} />)}
        </div>
        {/* The two halves behind the headline. Shown alongside it rather than
            folded in, because "how good is the first team" and "how far does it
            fall when they're rested" are separate questions before a cup run. */}
        <div className="mb-5 grid grid-cols-2 gap-2">
          {stat(`Starting XI (${strength.xiCount})`, strength.starting || "—")}
          {stat(`Bench (${strength.benchCount})`, strength.bench || "—")}
        </div>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {stat("Budget", <Money value={team.budget} />)}
          {stat("Wage bill / wk", <Money value={wageBill} />)}
        </div>

        {/* squad strength by department — where this club is actually good */}
        <div className="mb-1 flex items-end justify-between">
          <h3 className="display text-lg font-semibold">Squad Strength</h3>
          <span className="text-xs text-faint">Average OVR by department</span>
        </div>
        <div className="gold-thread mb-3" />
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {departments.map(({ group, avg, n }) => {
            const c = POS_GROUP_COLORS[group];
            return (
              <div
                key={group}
                className="rounded-md border border-line bg-raised px-3 py-2 text-center"
                title={`${c.label}s — ${n} in the squad`}
              >
                <div className="display tnum text-xl font-bold" style={{ color: avg === null ? undefined : c.bg }}>
                  {avg ?? "—"}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-faint">
                  {DEPT_LABEL[group]}
                </div>
                <div className="tnum text-[10px] text-faint">{n}</div>
              </div>
            );
          })}
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
                <ArchetypeLabel p={p} iconSize={14} />
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

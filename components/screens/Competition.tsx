"use client";

// Competition (§15.5): tables, results, top scorers; playable + sim tabs.

import { createContext, useContext, useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { TableRow } from "@/lib/types";
import { computeTable } from "@/lib/season";
import { formatDayShort } from "@/lib/calendar";
import { Card, CountryFlag, Crest, Section, Tabs } from "../ui";
import TeamCard from "./TeamCard";

// Lets any nested row open the team card without threading a prop everywhere.
const OpenTeam = createContext<(teamId: string) => void>(() => {});

export default function CompetitionScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);

  // Playable tabs come from the country's divisions (v7 — no hardcoded ids);
  // dedupe in case a single-division country lists the same id twice.
  const playableIds = useMemo(() => Array.from(new Set(game.divisionIds)), [game.divisionIds]);

  const tabs = useMemo(() => {
    const t: { id: string; label: string }[] = [
      ...playableIds.map((id) => ({ id, label: game.leagues[id]?.name ?? id })),
      { id: "CUP", label: "Cup" },
    ];
    for (const l of Object.values(game.leagues)) {
      if (!l.playable) t.push({ id: l.id, label: `${l.name} ◇` });
    }
    return t;
  }, [game.leagues, playableIds]);

  const [tab, setTab] = useState(game.divisionIds[0]);
  const [teamCard, setTeamCard] = useState<string | null>(null);

  return (
    <OpenTeam.Provider value={setTeamCard}>
      <div>
        <Tabs<string> tabs={tabs} active={tab} onChange={setTab} />
        {tab === "CUP" ? <CupView /> : game.leagues[tab]?.playable ? <LeagueView leagueId={tab} /> : <SimLeagueView leagueId={tab} />}
      </div>
      {teamCard && <TeamCard teamId={teamCard} onClose={() => setTeamCard(null)} />}
    </OpenTeam.Provider>
  );
}

function TableCard({ rows, highlight, note }: { rows: TableRow[]; highlight?: string; note?: (teamId: string, pos: number) => string }) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeam);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-widest text-faint">
            <th className="py-2 pl-3 text-left">#</th>
            <th className="py-2 text-left">Club</th>
            <th className="w-9 py-2 text-center">P</th>
            <th className="w-9 py-2 text-center">W</th>
            <th className="w-9 py-2 text-center">D</th>
            <th className="w-9 py-2 text-center">L</th>
            <th className="w-12 py-2 text-center">GD</th>
            <th className="w-12 py-2 pr-3 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const t = game.teams[row.teamId];
            const mine = row.teamId === highlight;
            const flag = note?.(row.teamId, i + 1) ?? "";
            return (
              <tr
                key={row.teamId}
                onClick={() => openTeam(row.teamId)}
                className={`cursor-pointer border-b border-line/50 last:border-0 hover:bg-hover ${mine ? "bg-hover" : ""}`}
                title={`View ${t.name}`}
              >
                <td className={`py-1.5 pl-3 tnum ${i === 0 ? "gold-text font-bold" : "text-faint"}`}>{i + 1}</td>
                <td className="py-1.5">
                  <span className={`flex items-center gap-2 ${mine ? "font-semibold" : ""}`}>
                    <Crest colors={t.colors} short={t.short} size={20} />
                    <span className="truncate">{t.name}</span>
                    {flag && <span className="text-[10px] text-faint">{flag}</span>}
                  </span>
                </td>
                <td className="py-1.5 text-center tnum text-dim">{row.played}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.won}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.drawn}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.lost}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.gf - row.ga > 0 ? "+" : ""}{row.gf - row.ga}</td>
                <td className={`py-1.5 pr-3 text-right tnum font-semibold ${mine ? "gold-text" : ""}`}>{row.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function LeagueView({ leagueId }: { leagueId: string }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const league = game.leagues[leagueId];
  const table = computeTable(game.fixtures, leagueId, league.teamIds);

  const recent = game.fixtures
    .filter((f) => f.competition === leagueId && f.played)
    .sort((a, b) => b.day - a.day)
    .slice(0, 10);
  const upcoming = game.fixtures
    .filter((f) => f.competition === leagueId && !f.played)
    .sort((a, b) => a.day - b.day)
    .slice(0, 10);

  const scorers = Object.values(game.players)
    .filter((p) => p.clubId && game.teams[p.clubId]?.leagueId === leagueId && p.stats.goals > 0)
    .sort((a, b) => b.stats.goals - a.stats.goals)
    .slice(0, 10);

  const n = table.length;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section title="Table">
          <TableCard
            rows={table}
            highlight={game.userTeamId}
            note={(_, pos) => {
              const isTop = leagueId === game.divisionIds[0];
              const isSecond = leagueId === game.divisionIds[1] && game.divisionIds[1] !== game.divisionIds[0];
              if (isTop) return pos > n - 3 ? "▼" : "";
              if (isSecond) return pos <= 3 ? "▲" : "";
              return "";
            }}
          />
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Top Scorers">
          <Card className="p-2">
            {scorers.length === 0 && <div className="p-2 text-sm text-faint">No goals yet.</div>}
            {scorers.map((p, i) => (
              <button key={p.id} onClick={() => viewPlayer(p.id)} className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-hover">
                <span className="truncate">
                  <span className="mr-2 tnum text-faint">{i + 1}</span>
                  {p.name}
                  <span className="ml-1.5 text-[10px] text-faint">{p.clubId ? game.teams[p.clubId].short : ""}</span>
                </span>
                <span className="display tnum font-semibold">{p.stats.goals}</span>
              </button>
            ))}
          </Card>
        </Section>
        <Section title="Results">
          <FixtureList fixtures={recent} />
        </Section>
        <Section title="Fixtures">
          <FixtureList fixtures={upcoming} />
        </Section>
      </div>
    </div>
  );
}

function FixtureList({ fixtures }: { fixtures: import("@/lib/types").Fixture[] }) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeam);
  if (!fixtures.length) return <div className="text-sm text-faint">—</div>;
  return (
    <Card className="divide-y divide-line/50">
      {fixtures.map((f) => {
        const h = game.teams[f.homeId];
        const a = game.teams[f.awayId];
        const mine = f.homeId === game.userTeamId || f.awayId === game.userTeamId;
        return (
          <div key={f.id} className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${mine ? "bg-hover/50" : ""}`}>
            <span className="w-12 shrink-0 tnum text-[11px] text-faint">{formatDayShort(f.day)}</span>
            <button onClick={() => openTeam(f.homeId)} className="flex flex-1 items-center justify-end gap-1.5 truncate hover:text-gold" title={h.name}>
              <span className="truncate">{h.short}</span>
              <Crest colors={h.colors} short={h.short} size={16} />
            </button>
            <span className="display w-12 shrink-0 text-center tnum font-semibold">
              {f.played ? `${f.homeGoals}–${f.awayGoals}` : "v"}
            </span>
            <button onClick={() => openTeam(f.awayId)} className="flex flex-1 items-center gap-1.5 truncate hover:text-gold" title={a.name}>
              <Crest colors={a.colors} short={a.short} size={16} />
              <span className="truncate">{a.short}</span>
            </button>
          </div>
        );
      })}
    </Card>
  );
}

function CupView() {
  const game = useGame((s) => s.game)!;
  const rounds = game.cup.roundNames.map((name, i) => ({
    name,
    day: game.schedule.cupRoundDays[i],
    fixtures: game.fixtures.filter((f) => f.competition === "CUP" && f.round === i + 1),
  }));
  return (
    <div className="space-y-6">
      {game.cup.winnerId && (
        <Card className="border-gold-lo p-4 text-center">
          <div className="text-[11px] uppercase tracking-widest text-faint">Cup Winners</div>
          <div className="display gold-text mt-1 text-2xl font-bold">{game.teams[game.cup.winnerId].name}</div>
        </Card>
      )}
      {rounds.map((r) => (
        <Section key={r.name} title={`${r.name} — ${formatDayShort(r.day)}`}>
          {r.fixtures.length ? (
            <FixtureList fixtures={r.fixtures} />
          ) : (
            <div className="text-sm text-faint">
              {game.cup.currentRound >= game.cup.roundNames.indexOf(r.name) ? "Draw made on the day." : "Awaiting earlier rounds."}
            </div>
          )}
        </Section>
      ))}
    </div>
  );
}

function SimLeagueView({ leagueId }: { leagueId: string }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const league = game.leagues[leagueId];
  const result = game.simResults.find((r) => r.leagueId === leagueId);
  if (!result) {
    return (
      <div className="pt-10 text-center text-sm text-faint">
        {league && (
          <div className="mb-3 flex items-center justify-center gap-2">
            <CountryFlag country={league.country} size={18} />
            <span className="display text-dim">{league.name}</span>
          </div>
        )}
        <div className="display mb-2 text-lg text-dim">NO TABLE YET</div>
        Sim leagues resolve twice a season, just before each transfer window opens.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section
          title={`Table — ${result.half === 1 ? "mid-season" : "final"} (Season ${result.season})`}
          right={league && <span className="flex items-center gap-1.5 text-xs text-faint"><CountryFlag country={league.country} size={14} />{league.country}</span>}
        >
          <TableCard rows={result.table} />
        </Section>
      </div>
      <Section title="Top Scorers">
        <Card className="p-2">
          {result.topScorers.map((s, i) => {
            const p = game.players[s.playerId];
            if (!p) return null;
            return (
              <button key={s.playerId} onClick={() => viewPlayer(p.id)} className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-hover">
                <span className="truncate">
                  <span className="mr-2 tnum text-faint">{i + 1}</span>
                  {p.name}
                  <span className="ml-1.5 text-[10px] text-faint">{p.clubId ? game.teams[p.clubId].short : ""}</span>
                </span>
                <span className="display tnum font-semibold">{s.goals}</span>
              </button>
            );
          })}
        </Card>
      </Section>
    </div>
  );
}

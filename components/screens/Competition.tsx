"use client";

// Competition (§15.5): tables, results, top scorers; playable + sim tabs.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Fixture, TableRow } from "@/lib/types";
import { computeTable, computeForm, type FormResult } from "@/lib/season";
import { formatDayShort } from "@/lib/calendar";
import { Card, CountryFlag, Crest, Flag, Modal, Section, Tabs } from "../ui";

/** A team's country, resolved through its league — teams carry no country of
 * their own, so the flag comes from the division they play in. */
function teamCountry(game: import("@/lib/types").GameState, teamId: string): string | undefined {
  const t = game.teams[teamId];
  return t ? game.leagues[t.leagueId]?.country : undefined;
}
import TeamCard from "./TeamCard";

/** Competition colour coding for Match History. Keyed by the competition's role
 * rather than its id, so it holds for any playable country (v7 divisions are
 * data-driven). Gold stays reserved for the cup — the prestige competition —
 * per the design language; the leagues take cool, distinct hues. */
type CompStyle = { label: string; dot: string; chip: string };

function useCompStyles(): Record<string, CompStyle> {
  const game = useGame((s) => s.game)!;
  return useMemo(() => {
    const map: Record<string, CompStyle> = {
      CUP: {
        label: "Cup",
        dot: "bg-[var(--color-gold)]",
        chip: "border-gold-lo/50 text-gold",
      },
    };
    // One hue per tier, top-first (v12: the ladder may be 1–3 deep). Gold stays
    // reserved for the cup, so the tiers take cool, distinct hues.
    const TIER_HUES = [
      { dot: "bg-[#4a7bd0]", chip: "border-[#4a7bd0]/50 text-[#8fb4ee]" },
      { dot: "bg-[#3fb27f]", chip: "border-[#3fb27f]/50 text-[#6fcaa0]" },
      { dot: "bg-[#b07fd0]", chip: "border-[#b07fd0]/50 text-[#cba6e4]" },
    ];
    Array.from(new Set(game.divisionIds)).forEach((id, i) => {
      const hue = TIER_HUES[Math.min(i, TIER_HUES.length - 1)];
      map[id] = { label: game.leagues[id]?.name ?? id, ...hue };
    });
    return map;
  }, [game.divisionIds, game.leagues]);
}

function compStyleFor(styles: Record<string, CompStyle>, competition: string, leagueName?: string): CompStyle {
  return (
    styles[competition] ?? {
      label: leagueName ?? competition,
      dot: "bg-[var(--color-faint)]",
      chip: "border-line text-faint",
    }
  );
}

// Lets any nested row open the team card without threading a prop everywhere.
const OpenTeam = createContext<(teamId: string) => void>(() => {});

export default function CompetitionScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);

  // Playable tabs come from the country's divisions (v7 — no hardcoded ids);
  // dedupe in case a single-division country lists the same id twice.
  const playableIds = useMemo(() => Array.from(new Set(game.divisionIds)), [game.divisionIds]);

  // The tab bar stays deliberately small (v24): only the competitions the user
  // is actually invested in — their own league, the divisions immediately above
  // and below it on the ladder, the cup and match history. Every other country's
  // league is a sim, and with many leagues selected these would swamp the bar,
  // so they all move into the "Other leagues" dropdown instead.
  const userLeagueId = game.teams[game.userTeamId]?.leagueId;
  const focusIds = useMemo(() => {
    const idx = playableIds.indexOf(userLeagueId);
    if (idx === -1) return playableIds; // user not on the playable ladder — show all
    // the user's division plus the one directly above and below it
    return playableIds.filter((_, i) => Math.abs(i - idx) <= 1);
  }, [playableIds, userLeagueId]);

  const tabs = useMemo(() => {
    return [
      ...focusIds.map((id) => ({ id, label: game.leagues[id]?.name ?? id })),
      { id: "CUP", label: "Cup" },
      { id: "HISTORY", label: "Match History" },
    ];
  }, [game.leagues, focusIds]);

  // Every non-playable division, grouped for the dropdown — these are the sim
  // leagues that used to clutter the tab bar.
  const otherLeagues = useMemo(
    () =>
      Object.values(game.leagues)
        .filter((l) => !l.playable)
        .sort((a, b) => a.country.localeCompare(b.country) || a.tier - b.tier || a.name.localeCompare(b.name)),
    [game.leagues]
  );

  const [tab, setTab] = useState<string>(userLeagueId ?? game.divisionIds[0]);
  const [teamCard, setTeamCard] = useState<string | null>(null);

  // Whether the current tab is one of the "other leagues" (dropdown) selections,
  // so the dropdown trigger reflects the active choice rather than a tab.
  const otherSelected = tab !== "CUP" && tab !== "HISTORY" && !focusIds.includes(tab);

  return (
    <OpenTeam.Provider value={setTeamCard}>
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-line">
          <Tabs<string> tabs={tabs} active={otherSelected ? "" : tab} onChange={setTab} className="!mb-0 !border-0" />
          {otherLeagues.length > 0 && (
            <div className="pb-1.5">
              <OtherLeaguesDropdown
                leagues={otherLeagues}
                active={otherSelected ? tab : null}
                onSelect={setTab}
              />
            </div>
          )}
        </div>
        {tab === "HISTORY" ? (
          <MatchHistoryView />
        ) : tab === "CUP" ? (
          <CupView />
        ) : game.leagues[tab]?.playable ? (
          <LeagueView leagueId={tab} />
        ) : (
          <SimLeagueView leagueId={tab} />
        )}
      </div>
      {teamCard && <TeamCard teamId={teamCard} onClose={() => setTeamCard(null)} />}
    </OpenTeam.Provider>
  );
}

/** Dropdown of every sim (non-playable) league, each with its country flag, so
 * the tab bar stays focused on the user's own ladder. A country's leagues are
 * grouped under a flagged heading. Closes on outside-click or Escape. */
function OtherLeaguesDropdown({
  leagues,
  active,
  onSelect,
}: {
  leagues: import("@/lib/types").League[];
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Group leagues by country so the menu reads as a world of nations.
  const byCountry = useMemo(() => {
    const map = new Map<string, import("@/lib/types").League[]>();
    for (const l of leagues) {
      const list = map.get(l.country);
      if (list) list.push(l);
      else map.set(l.country, [l]);
    }
    return Array.from(map.entries());
  }, [leagues]);

  const activeLeague = active ? leagues.find((l) => l.id === active) : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`display flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors ${
          activeLeague ? "border-gold-lo/60 text-gold" : "border-line text-faint hover:text-dim"
        }`}
      >
        {activeLeague && <CountryFlag country={activeLeague.country} size={12} />}
        <span className="max-w-[10rem] truncate">{activeLeague ? activeLeague.name : "Other leagues"}</span>
        <span className={`text-[9px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-xl">
          {byCountry.map(([country, ls]) => (
            <div key={country}>
              <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] uppercase tracking-widest text-faint">
                <CountryFlag country={country} size={11} />
                <span className="truncate">{country}</span>
              </div>
              {ls.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    onSelect(l.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover ${
                    active === l.id ? "gold-text font-semibold" : "text-dim"
                  }`}
                >
                  <CountryFlag country={l.country} size={11} />
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The five little result pills that make up a form guide (oldest→newest). */
function FormGuide({ form }: { form: FormResult[] }) {
  if (!form.length) return <span className="text-[11px] text-faint">—</span>;
  const tone: Record<FormResult, string> = {
    W: "bg-win/20 text-win",
    D: "bg-draw/20 text-draw",
    L: "bg-loss/20 text-loss",
  };
  return (
    <span className="flex items-center justify-center gap-1">
      {form.map((r, i) => (
        <span
          key={i}
          className={`display flex h-4 w-4 items-center justify-center rounded-[3px] text-[9px] font-bold leading-none ${tone[r]}`}
          title={r === "W" ? "Win" : r === "D" ? "Draw" : "Loss"}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

function TableCard({
  rows,
  highlight,
  note,
  form,
}: {
  rows: TableRow[];
  highlight?: string;
  note?: (teamId: string, pos: number) => string;
  /** Last-5 form per team (playable leagues only); omit to hide the column. */
  form?: Record<string, FormResult[]>;
}) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeam);
  return (
    <Card className="overflow-x-auto">
      {/* table-fixed (not auto) so the columns land in the SAME place in every
          division. Under auto layout the widths are derived from content, so a
          division with longer club names — or one that reaches position 10 —
          shifted every stat column and the table visibly jumped when switching
          tabs. Fixed layout + an explicit width per column makes the grid
          identical across all of them; the club cell absorbs the slack.
          The Form column (v23) is hidden below sm so the phone layout keeps the
          same compact stat grid it always had; the table scrolls when shown. */}
      <table className={`w-full table-fixed text-sm ${form ? "min-w-[560px]" : "min-w-[480px]"}`}>
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-12" />
          <col className="w-12" />
          {form && <col className="hidden w-28 sm:table-column" />}
        </colgroup>
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-widest text-faint">
            <th className="py-2 pl-3 text-left">#</th>
            <th className="py-2 text-left">Club</th>
            <th className="py-2 text-center">P</th>
            <th className="py-2 text-center">W</th>
            <th className="py-2 text-center">D</th>
            <th className="py-2 text-center">L</th>
            <th className="py-2 text-center">GD</th>
            <th className="py-2 pr-3 text-right">Pts</th>
            {form && <th className="hidden py-2 pr-3 text-center sm:table-cell">Form</th>}
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
                <td className="min-w-0 py-1.5">
                  <span className={`flex min-w-0 items-center gap-2 ${mine ? "font-semibold" : ""}`}>
                    <Crest colors={t.colors} short={t.short} size={20} />
                    <CountryFlag country={game.leagues[t.leagueId]?.country ?? ""} size={11} />
                    <span className="truncate">{t.name}</span>
                    {flag && <span className="shrink-0 text-[10px] text-faint">{flag}</span>}
                  </span>
                </td>
                <td className="py-1.5 text-center tnum text-dim">{row.played}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.won}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.drawn}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.lost}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.gf - row.ga > 0 ? "+" : ""}{row.gf - row.ga}</td>
                <td className={`py-1.5 pr-3 text-right tnum font-semibold ${mine ? "gold-text" : ""}`}>{row.points}</td>
                {form && (
                  <td className="hidden py-1.5 pr-3 sm:table-cell">
                    <FormGuide form={form[row.teamId] ?? []} />
                  </td>
                )}
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
  const form = computeForm(game.fixtures, leagueId, league.teamIds);

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

  const assisters = Object.values(game.players)
    .filter((p) => p.clubId && game.teams[p.clubId]?.leagueId === leagueId && p.stats.assists > 0)
    .sort((a, b) => b.stats.assists - a.stats.assists)
    .slice(0, 10);

  const n = table.length;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section
          title="Table"
          right={
            league.country ? (
              <span className="flex items-center gap-1.5 text-xs text-faint">
                <CountryFlag country={league.country} size={14} />
                {league.country}
              </span>
            ) : undefined
          }
        >
          <TableCard
            rows={table}
            highlight={game.userTeamId}
            form={form}
            note={(_, pos) => {
              // The ladder may be 1–3 deep (v12): a middle tier has BOTH a
              // promotion zone at the top and a relegation zone at the bottom.
              const ladder = Array.from(new Set(game.divisionIds));
              const tier = ladder.indexOf(leagueId);
              if (tier === -1) return "";
              const canGoUp = tier > 0;
              const canGoDown = tier < ladder.length - 1;
              if (canGoUp && pos <= 3) return "▲";
              if (canGoDown && pos > n - 3) return "▼";
              return "";
            }}
          />
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Top Scorers">
          <StatLeaders
            rows={scorers.map((p) => ({ id: p.id, name: p.name, nat: p.nationality, short: p.clubId ? game.teams[p.clubId].short : "", value: p.stats.goals }))}
            emptyLabel="No goals yet."
            onView={viewPlayer}
          />
        </Section>
        <Section title="Top Assists">
          <StatLeaders
            rows={assisters.map((p) => ({ id: p.id, name: p.name, nat: p.nationality, short: p.clubId ? game.teams[p.clubId].short : "", value: p.stats.assists }))}
            emptyLabel="No assists yet."
            onView={viewPlayer}
          />
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

/** A ranked leaderboard (top scorers / top assists): rank, name, club, tally. */
function StatLeaders({
  rows,
  emptyLabel,
  onView,
}: {
  rows: { id: string; name: string; nat: string; short: string; value: number }[];
  emptyLabel: string;
  onView: (id: string) => void;
}) {
  return (
    <Card className="p-2">
      {rows.length === 0 && <div className="p-2 text-sm text-faint">{emptyLabel}</div>}
      {rows.map((r, i) => (
        <button key={r.id} onClick={() => onView(r.id)} className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-hover">
          <span className="flex min-w-0 items-center truncate">
            <span className="mr-2 tnum text-faint">{i + 1}</span>
            <Flag nat={r.nat} size={11} className="mr-1.5" />
            <span className="truncate">{r.name}</span>
            <span className="ml-1.5 shrink-0 text-[10px] text-faint">{r.short}</span>
          </span>
          <span className="display tnum font-semibold">{r.value}</span>
        </button>
      ))}
    </Card>
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
  const [view, setView] = useState<"rounds" | "bracket">("rounds");

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

      <div className="flex items-center justify-between">
        <span className="display text-sm font-semibold">Cup</span>
        <div className="flex overflow-hidden rounded-md border border-line">
          {(["rounds", "bracket"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`display px-3 py-1 text-[11px] font-semibold transition-colors ${
                view === v ? "gold-grad text-black" : "text-faint hover:text-dim"
              }`}
            >
              {v === "rounds" ? "ROUNDS" : "BRACKET"}
            </button>
          ))}
        </div>
      </div>

      {view === "bracket" ? (
        <CupBracket rounds={rounds} />
      ) : (
        rounds.map((r) => (
          <Section key={r.name} title={`${r.name} — ${formatDayShort(r.day)}`}>
            {r.fixtures.length ? (
              <FixtureList fixtures={r.fixtures} />
            ) : (
              <div className="text-sm text-faint">
                {game.cup.currentRound >= game.cup.roundNames.indexOf(r.name) ? "Draw made on the day." : "Awaiting earlier rounds."}
              </div>
            )}
          </Section>
        ))
      )}
    </div>
  );
}

// ── Cup bracket (v19) ─────────────────────────────────────────────────────
// The knockout laid out as columns, one per round, so the path to the final is
// readable at a glance.
//
// Mobile: a bracket is intrinsically wide, so rather than shrink it to
// illegibility the columns keep a workable minimum width and the whole grid
// scrolls horizontally inside its own container (the page itself never scrolls
// sideways). Each round column is also a scroll-snap target, so on a phone you
// swipe cleanly from round to round.

interface BracketRound {
  name: string;
  day: number;
  fixtures: Fixture[];
}

function CupBracket({ rounds }: { rounds: BracketRound[] }) {
  const drawn = rounds.filter((r) => r.fixtures.length > 0);

  if (!drawn.length) {
    return (
      <Card className="p-8 text-center text-sm text-faint">
        <div className="display mb-2 text-lg text-dim">NO TIES YET</div>
        The bracket fills in as each round is drawn.
      </Card>
    );
  }

  return (
    <Card className="overflow-x-auto p-3">
      {/* Because the ties render only 3-letter abbreviations (never full names),
          each round column can be narrow — narrow enough that on a desktop the
          whole bracket, final included, fits without horizontal scroll. The
          columns keep a small minimum so they stay legible and become
          scroll-snap targets when the screen is too small to hold them all. */}
      <div className="flex snap-x snap-mandatory gap-2 sm:gap-3">
        {drawn.map((r) => (
          <div key={r.name} className="w-[8.5rem] shrink-0 grow snap-start sm:w-auto sm:flex-1">
            <div className="mb-2 border-b border-line pb-1.5">
              <div className="display truncate text-[11px] font-semibold uppercase tracking-widest text-dim">{r.name}</div>
              <div className="text-[10px] text-faint">{formatDayShort(r.day)}</div>
            </div>
            {/* Ties are spread down the column so a round with few matches (the
                final) sits centred against the fuller rounds beside it. */}
            <div className="flex h-full flex-col justify-around gap-2">
              {r.fixtures.map((f) => (
                <BracketTie key={f.id} f={f} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {drawn.length > 1 && (
        <div className="mt-2 text-center text-[10px] text-faint sm:hidden">Swipe to see later rounds →</div>
      )}
    </Card>
  );
}

/** One tie in the bracket: both sides stacked, winner highlighted. */
function BracketTie({ f }: { f: Fixture }) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeam);

  // A cup tie level after 90 is settled on penalties, so the winner is the
  // shootout winner where there is one, otherwise whoever scored more.
  const winnerId = !f.played
    ? null
    : f.shootoutWinnerId ?? (f.homeGoals! > f.awayGoals! ? f.homeId : f.awayGoals! > f.homeGoals! ? f.awayId : null);

  const side = (teamId: string, goals: number | undefined) => {
    const t = game.teams[teamId];
    const won = winnerId === teamId;
    const lost = f.played && winnerId !== null && !won;
    const mine = teamId === game.userTeamId;
    return (
      <button
        onClick={() => openTeam(teamId)}
        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-hover ${
          lost ? "text-faint" : ""
        } ${mine ? "bg-hover/40" : ""}`}
        title={t.name}
      >
        <Crest colors={t.colors} short={t.short} size={16} />
        <span className={`flex min-w-0 flex-1 items-center gap-1 truncate ${won ? "font-semibold text-ink" : ""} ${mine ? "font-semibold" : ""}`}>
          <CountryFlag country={teamCountry(game, teamId) ?? ""} size={9} />
          <span className="truncate">{t.short}</span>
        </span>
        {f.played && <span className={`display tnum ${won ? "gold-text font-bold" : ""}`}>{goals}</span>}
      </button>
    );
  };

  return (
    <div className={`overflow-hidden rounded-md border ${winnerId ? "border-line" : "border-dashed border-line"}`}>
      {side(f.homeId, f.homeGoals)}
      <div className="h-px bg-line" />
      {side(f.awayId, f.awayGoals)}
      {f.shootoutWinnerId && (
        <div className="border-t border-line bg-raised px-2 py-0.5 text-center text-[9px] text-faint">
          {game.teams[f.shootoutWinnerId].short} on pens
        </div>
      )}
    </div>
  );
}

// ── Match History (v11) ───────────────────────────────────────────────────
// Every played fixture of the *current* season across all playable
// competitions, newest first, colour-coded by competition and clickable for
// the scorers and team stats stored on the fixture. `state.fixtures` only ever
// holds the current season (the rollover clears it), so no season filter is
// needed — but we key off game.season in the heading to make that explicit.

function MatchHistoryView() {
  const game = useGame((s) => s.game)!;
  const styles = useCompStyles();
  const [scope, setScope] = useState<"all" | "mine">("mine");
  const [openId, setOpenId] = useState<string | null>(null);

  const played = useMemo(() => {
    return game.fixtures
      .filter((f) => f.played)
      .filter((f) => scope === "all" || f.homeId === game.userTeamId || f.awayId === game.userTeamId)
      .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id));
  }, [game.fixtures, game.userTeamId, scope]);

  // Group by matchday so a round reads as a block rather than a flat wall.
  const groups = useMemo(() => {
    const byDay = new Map<number, Fixture[]>();
    for (const f of played) {
      const list = byDay.get(f.day);
      if (list) list.push(f);
      else byDay.set(f.day, [f]);
    }
    return Array.from(byDay.entries());
  }, [played]);

  const openFixture = openId ? played.find((f) => f.id === openId) ?? null : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="display text-sm font-semibold">This Season&apos;s Results</div>
          <div className="text-[11px] text-faint">
            Season {game.season} · {played.length} match{played.length === 1 ? "" : "es"} played · tap a result for details
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Competition colour key — teaches the coding at a glance. */}
          <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
            {Object.entries(styles).map(([id, s]) => (
              <span key={id} className="flex items-center gap-1.5 text-[11px] text-faint">
                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </span>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`display px-3 py-1 text-[11px] font-semibold transition-colors ${
                  scope === s ? "gold-grad text-black" : "text-faint hover:text-dim"
                }`}
              >
                {s === "mine" ? "MY CLUB" : "ALL"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {played.length === 0 ? (
        <Card className="p-8 text-center text-sm text-faint">
          <div className="display mb-2 text-lg text-dim">NO MATCHES YET</div>
          Results appear here as the season is played.
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, fixtures]) => (
            <div key={day}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="display text-[11px] uppercase tracking-widest text-faint">{formatDayShort(day)}</span>
                <span className="gold-thread h-px flex-1" />
              </div>
              <Card className="divide-y divide-line/50">
                {fixtures.map((f) => (
                  <HistoryRow key={f.id} f={f} styles={styles} onOpen={() => setOpenId(f.id)} />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      {openFixture && <MatchDetailModal f={openFixture} styles={styles} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function HistoryRow({ f, styles, onOpen }: { f: Fixture; styles: Record<string, CompStyle>; onOpen: () => void }) {
  const game = useGame((s) => s.game)!;
  const h = game.teams[f.homeId];
  const a = game.teams[f.awayId];
  const s = compStyleFor(styles, f.competition, game.leagues[f.competition]?.name);
  const mine = f.homeId === game.userTeamId || f.awayId === game.userTeamId;

  // Result tint from the user's perspective; neutral for matches they're not in.
  let tone = "text-ink";
  if (mine) {
    const myGoals = f.homeId === game.userTeamId ? f.homeGoals! : f.awayGoals!;
    const oppGoals = f.homeId === game.userTeamId ? f.awayGoals! : f.homeGoals!;
    const won = f.shootoutWinnerId ? f.shootoutWinnerId === game.userTeamId : myGoals > oppGoals;
    const lost = f.shootoutWinnerId ? f.shootoutWinnerId !== game.userTeamId : myGoals < oppGoals;
    tone = won ? "text-win" : lost ? "text-loss" : "text-draw";
  }

  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover ${mine ? "bg-hover/40" : ""}`}
      title="View match details"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} title={s.label} />
      <span className="flex flex-1 items-center justify-end gap-1.5 truncate">
        <span className="truncate">{h.name}</span>
        <Crest colors={h.colors} short={h.short} size={16} />
      </span>
      <span className={`display w-14 shrink-0 text-center tnum font-semibold ${tone}`}>
        {f.homeGoals}–{f.awayGoals}
      </span>
      <span className="flex flex-1 items-center gap-1.5 truncate">
        <Crest colors={a.colors} short={a.short} size={16} />
        <span className="truncate">{a.name}</span>
      </span>
      {f.shootoutWinnerId && (
        <span className="hidden shrink-0 text-[10px] text-faint sm:inline">
          {game.teams[f.shootoutWinnerId].short} on pens
        </span>
      )}
    </button>
  );
}

function MatchDetailModal({ f, styles, onClose }: { f: Fixture; styles: Record<string, CompStyle>; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const h = game.teams[f.homeId];
  const a = game.teams[f.awayId];
  const s = compStyleFor(styles, f.competition, game.leagues[f.competition]?.name);
  const scorers = f.scorers ?? [];
  const homeScorers = scorers.filter((x) => x.teamId === f.homeId).sort((x, y) => x.minute - y.minute);
  const awayScorers = scorers.filter((x) => x.teamId === f.awayId).sort((x, y) => x.minute - y.minute);

  const goalLine = (list: typeof scorers, align: "left" | "right") => (
    <div className={`space-y-1 ${align === "right" ? "text-right" : "text-left"}`}>
      {list.length === 0 && <div className="text-[11px] text-faint">—</div>}
      {list.map((g, i) => {
        const p = game.players[g.playerId];
        const assist = g.assistId ? game.players[g.assistId] : null;
        return (
          <div key={`${g.playerId}-${g.minute}-${i}`} className="text-[12px]">
            <button
              onClick={() => p && viewPlayer(p.id)}
              className="font-medium hover:text-gold"
              disabled={!p}
            >
              {p?.name ?? "Unknown"}
            </button>
            <span className="ml-1.5 tnum text-faint">{g.minute}&apos;</span>
            {assist && <div className="text-[10px] text-faint">assist {assist.name}</div>}
          </div>
        );
      })}
    </div>
  );

  return (
    <Modal title="Match Details" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`display rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${s.chip}`}>
          {s.label.toUpperCase()}
        </span>
        <span className="text-[11px] text-faint">{formatDayShort(f.day)}</span>
      </div>

      {/* Scoreline */}
      <div className="flex items-center gap-3 rounded-md border border-line bg-raised px-4 py-3">
        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          <Crest colors={h.colors} short={h.short} size={30} />
          <span className="text-[12px] leading-tight">{h.name}</span>
        </div>
        <div className="text-center">
          <div className="display text-3xl font-bold tnum">
            {f.homeGoals}–{f.awayGoals}
          </div>
          {f.shootoutWinnerId && (
            <div className="text-[10px] text-faint">{game.teams[f.shootoutWinnerId].short} win on penalties</div>
          )}
        </div>
        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          <Crest colors={a.colors} short={a.short} size={30} />
          <span className="text-[12px] leading-tight">{a.name}</span>
        </div>
      </div>

      {/* Goalscorers */}
      <div className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Goalscorers</div>
        <div className="grid grid-cols-2 gap-4">
          {goalLine(homeScorers, "right")}
          {goalLine(awayScorers, "left")}
        </div>
      </div>

      {/* Team stats — absent on fixtures played before the v11 upgrade. */}
      <div className="mt-4 border-t border-line/60 pt-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Match Stats</div>
        {f.detail ? (
          <div className="space-y-2.5">
            <StatBar label="Possession" home={f.detail.possession[0]} away={f.detail.possession[1]} suffix="%" />
            <StatBar label="Shots" home={f.detail.shots[0]} away={f.detail.shots[1]} />
            <StatBar label="On Target" home={f.detail.onTarget[0]} away={f.detail.onTarget[1]} />
          </div>
        ) : (
          <div className="text-[12px] text-faint">
            Detailed stats weren&apos;t recorded for this match. They&apos;re kept for every match from now on.
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A two-sided proportional bar for one match stat. */
function StatBar({ label, home, away, suffix = "" }: { label: string; home: number; away: number; suffix?: string }) {
  const total = home + away;
  const homePct = total > 0 ? (home / total) * 100 : 50;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="display tnum font-semibold">{home}{suffix}</span>
        <span className="text-faint">{label}</span>
        <span className="display tnum font-semibold">{away}{suffix}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-line">
        <div className="bg-[var(--color-gold)]" style={{ width: `${homePct}%` }} />
        <div className="flex-1 bg-[#4a7bd0]" />
      </div>
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
        Sim leagues resolve at the start of the season, when the winter window
        opens, and once more after their final round.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section
          title={`Table — ${result.half === 0 ? "not started" : result.half === 1 ? "in progress" : "final"} (Season ${result.season})`}
          right={league && <span className="flex items-center gap-1.5 text-xs text-faint"><CountryFlag country={league.country} size={14} />{league.country}</span>}
        >
          <TableCard rows={result.table} />
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Top Scorers">
          <StatLeaders
            rows={result.topScorers
              .map((s) => ({ p: game.players[s.playerId], value: s.goals }))
              .filter((r) => r.p)
              .map((r) => ({ id: r.p.id, name: r.p.name, nat: r.p.nationality, short: r.p.clubId ? game.teams[r.p.clubId].short : "", value: r.value }))}
            emptyLabel="No goals recorded."
            onView={viewPlayer}
          />
        </Section>
        <Section title="Top Assists">
          <StatLeaders
            rows={(result.topAssists ?? [])
              .map((s) => ({ p: game.players[s.playerId], value: s.assists }))
              .filter((r) => r.p)
              .map((r) => ({ id: r.p.id, name: r.p.name, nat: r.p.nationality, short: r.p.clubId ? game.teams[r.p.clubId].short : "", value: r.value }))}
            emptyLabel="No assists recorded."
            onView={viewPlayer}
          />
        </Section>
      </div>
    </div>
  );
}

"use client";

// Competition (§15.5): tables, results, top scorers; playable + sim tabs.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { EuroCupTier, Fixture, League, TableRow } from "@/lib/types";
import { LEAGUE_REP_MAX, leagueRepLabel, leagueReputation } from "@/lib/config/leaguerep";
import { computeTable, computeForm, type FormResult } from "@/lib/season";
import { EURO_CUP_DEFS, euroCompetitionId, euroSlotForPosition } from "@/lib/european";
import { formatDayShort } from "@/lib/calendar";
import { Card, CountryFlag, Crest, Flag, Modal, Section, Tabs } from "../ui";

import EuropeanView, { OpenTeamCtx } from "./EuropeanView";

/** Competition colour coding for Match History. Keyed by the competition's role
 * rather than its id, so it holds for any playable country (v7 divisions are
 * data-driven). Gold stays reserved for the cup — the prestige competition —
 * per the design language; the leagues take cool, distinct hues. */
/** `dot`/`chip` are Tailwind class strings for the palette-driven competitions;
 * `color` is a literal hex for the ones whose colour is data (the European cups
 * carry their own brand colour in EURO_CUP_DEFS). When `color` is set it wins,
 * and the class strings are left empty. */
type CompStyle = { label: string; dot: string; chip: string; color?: string };

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
    // The three European cups, each in its own competition colour (v1.65). Without
    // these a Europa or Conference fixture fell through to the grey fallback and
    // was labelled with its raw key ("EURO2") — the two secondary cups were the
    // only competitions on the page with no visual identity of their own. The
    // colours are the same ones the qualification stripes use, so a place in the
    // table and a result from that cup read as the same competition.
    if (game.european) {
      for (const d of EURO_CUP_DEFS) {
        map[euroCompetitionId(d.tier)] = {
          label: d.name,
          dot: "",
          chip: "",
          color: d.color,
        };
      }
    }
    return map;
  }, [game.divisionIds, game.leagues, game.european]);
}

/** The competition's colour dot — a class-driven hue for the leagues and cup, a
 * literal brand colour for the European cups. */
function CompDot({ s, className = "" }: { s: CompStyle; className?: string }) {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.color ? "" : s.dot} ${className}`}
      style={s.color ? { backgroundColor: s.color } : undefined}
      title={s.label}
    />
  );
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

  // Every division of the nation the user manages in gets its own tab (v1.45).
  // These are the real-engine playable divisions — `game.divisionIds` is exactly
  // the home-nation ladder, top-first — so a manager in the third tier can still
  // read the first division's table at a glance. Other countries' leagues are
  // sims and move into the "Other leagues" dropdown so the bar stays home-nation.
  const userLeagueId = game.teams[game.userTeamId]?.leagueId;
  const focusIds = playableIds;

  const tabs = useMemo(() => {
    return [
      ...focusIds.map((id) => ({ id, label: game.leagues[id]?.name ?? id })),
      { id: "CUP", label: "Cup" },
      // Europe only appears when the save actually runs the continental cups,
      // so a save without them keeps exactly the tab bar it always had.
      ...(game.european ? [{ id: "EURO", label: "Europe" }] : []),
      { id: "HISTORY", label: "Match History" },
    ];
  }, [game.leagues, focusIds, game.european]);

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
  // The team card is a store overlay now (v1.91) — mounted once in the Shell so
  // any screen can open a club, and so it shares the player profile's back
  // stack. The two contexts stay as the screen's own plumbing; they simply hand
  // the click to the store instead of to local state.
  const setTeamCard = useGame((s) => s.viewTeam);

  // Whether the current tab is one of the "other leagues" (dropdown) selections,
  // so the dropdown trigger reflects the active choice rather than a tab.
  const otherSelected = tab !== "CUP" && tab !== "EURO" && tab !== "HISTORY" && !focusIds.includes(tab);

  return (
    <OpenTeam.Provider value={setTeamCard}>
      <OpenTeamCtx.Provider value={setTeamCard}>
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-line">
          <Tabs<string> tabs={tabs} active={otherSelected ? "" : tab} onChange={setTab} className="!mb-0 !border-0" />
          {/* Which continental cups this save actually runs (v1.65). The Europe tab
              is one word for three competitions, so the Europa and Conference
              Leagues were invisible until you opened it — these chips name them
              in their own colours, the same colours the qualification stripes and
              Match History dots use. */}
          {game.european && game.european.cups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
              {game.european.cups.map((c) => (
                <button
                  key={c.tier}
                  onClick={() => setTab("EURO")}
                  title={`Open the ${c.name}`}
                  className="display flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-100"
                  style={{
                    borderColor: `${c.color}80`,
                    color: c.color,
                    opacity: tab === "EURO" ? 1 : 0.75,
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                  {EURO_CUP_DEFS.find((d) => d.tier === c.tier)?.short ?? c.name}
                </button>
              ))}
            </div>
          )}
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
        ) : tab === "EURO" ? (
          <EuropeanView />
        ) : game.leagues[tab]?.playable ? (
          <LeagueView leagueId={tab} />
        ) : (
          <SimLeagueView leagueId={tab} />
        )}
      </div>
      </OpenTeamCtx.Provider>
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
  euroSlot,
}: {
  rows: TableRow[];
  highlight?: string;
  note?: (teamId: string, pos: number) => string;
  /** Last-5 form per team (playable leagues only); omit to hide the column. */
  form?: Record<string, FormResult[]>;
  /** Which European cup a finishing position qualifies for (v1.63), 1-based.
   * Omit — or return null — and the qualification stripe isn't drawn at all,
   * which is what a table with no European places should look like. */
  euroSlot?: (pos: number) => EuroCupTier | null;
}) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeam);
  // Which cups this table actually feeds, in tier order — the legend lists only
  // these, so a nation sending clubs to one cup doesn't advertise three.
  const cupsInPlay = euroSlot
    ? EURO_CUP_DEFS.filter((d) => rows.some((_, i) => euroSlot(i + 1) === d.tier))
    : [];
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
      <table className={`w-full table-fixed text-sm ${form ? "min-w-[620px]" : "min-w-[540px]"}`}>
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-9" />
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
            <th className="py-2 text-center">GF</th>
            <th className="py-2 text-center">GA</th>
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
            // The European place this position carries, if any (v1.63).
            const cupTier = euroSlot?.(i + 1) ?? null;
            const cup = cupTier ? EURO_CUP_DEFS.find((d) => d.tier === cupTier) : undefined;
            return (
              <tr
                key={row.teamId}
                onClick={() => openTeam(row.teamId)}
                className={`cursor-pointer border-b border-line/50 last:border-0 hover:bg-hover ${mine ? "bg-hover" : ""}`}
                title={`View ${t.name}`}
              >
                <td className={`relative py-1.5 pl-3 tnum ${i === 0 ? "gold-text font-bold" : "text-faint"}`}>
                  {/* Qualification stripe: a 3px bar in the cup's own colour down
                      the left edge of the row. Colour alone never carries the
                      meaning — the legend below names each cup, and the stripe
                      carries the cup name as a title for a hover/screen reader. */}
                  {cup && (
                    <span
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ backgroundColor: cup.color }}
                      title={`Qualifies for the ${cup.name}`}
                      aria-label={`Qualifies for the ${cup.name}`}
                    />
                  )}
                  {i + 1}
                </td>
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
                <td className="py-1.5 text-center tnum text-dim">{row.gf}</td>
                <td className="py-1.5 text-center tnum text-dim">{row.ga}</td>
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
      {cupsInPlay.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line/60 px-3 py-2 text-[10px] text-faint">
          <span className="uppercase tracking-widest">Qualification</span>
          {cupsInPlay.map((d) => (
            <span key={d.tier} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-[3px] rounded-sm" style={{ backgroundColor: d.color }} />
              {d.name}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * A league's standing in the world game (v1.72), as a compact chip.
 *
 * Structural data, not form: it says how much this division is worth on the
 * global map, which is what makes "top of the Norwegian first tier" and "top of
 * the Premier Division" legibly different achievements.
 */
function LeagueRepBadge({ league }: { league: League }) {
  const rep = leagueReputation(league);
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-faint"
      title={`League reputation ${rep}/${LEAGUE_REP_MAX} — ${leagueRepLabel(rep)}`}
    >
      <span className="display gold-text tnum font-semibold">{rep}</span>
      <span className="text-faint">/{LEAGUE_REP_MAX}</span>
      <span className="text-dim">{leagueRepLabel(rep)}</span>
    </span>
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

  const keepers = Object.values(game.players)
    .filter((p) => p.clubId && game.teams[p.clubId]?.leagueId === leagueId && (p.stats.cleanSheets ?? 0) > 0)
    .sort((a, b) => (b.stats.cleanSheets ?? 0) - (a.stats.cleanSheets ?? 0))
    .slice(0, 10);

  const n = table.length;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section
          title="Table"
          right={
            <span className="flex items-center gap-3">
              <LeagueRepBadge league={league} />
              {league.country && (
                <span className="flex items-center gap-1.5 text-xs text-faint">
                  <CountryFlag country={league.country} size={14} />
                  {league.country}
                </span>
              )}
            </span>
          }
        >
          <TableCard
            rows={table}
            highlight={game.userTeamId}
            form={form}
            euroSlot={(pos) => euroSlotForPosition(game, leagueId, pos)}
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
            rows={scorers.map((p) => ({ id: p.id, name: p.name, nat: p.nationality, pos: p.positions[0], short: p.clubId ? game.teams[p.clubId].short : "", value: p.stats.goals }))}
            emptyLabel="No goals yet."
            onView={viewPlayer}
          />
        </Section>
        <Section title="Top Assists">
          <StatLeaders
            rows={assisters.map((p) => ({ id: p.id, name: p.name, nat: p.nationality, pos: p.positions[0], short: p.clubId ? game.teams[p.clubId].short : "", value: p.stats.assists }))}
            emptyLabel="No assists yet."
            onView={viewPlayer}
          />
        </Section>
        <Section title="Clean Sheets">
          <StatLeaders
            rows={keepers.map((p) => ({ id: p.id, name: p.name, nat: p.nationality, pos: p.positions[0], short: p.clubId ? game.teams[p.clubId].short : "", value: p.stats.cleanSheets ?? 0 }))}
            emptyLabel="No clean sheets yet."
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

/** A ranked leaderboard (top scorers / assists / clean sheets): rank, name,
 * position, club, tally. */
function StatLeaders({
  rows,
  emptyLabel,
  onView,
}: {
  rows: { id: string; name: string; nat: string; pos?: string; short: string; value: number }[];
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
            {r.pos && <span className="ml-1.5 shrink-0 rounded-sm bg-raised px-1 text-[9px] font-semibold text-faint">{r.pos}</span>}
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

/**
 * The cup, round by round (v1.91).
 *
 * The bracket view was deleted rather than fixed. A knockout tree is
 * intrinsically wide, so on anything narrower than a desktop it became a
 * horizontally-scrolling grid of three-letter codes with no scores visible
 * until you swiped to them — the shape was legible, but nothing else was. What
 * a manager actually reads a cup page for is who played who, what the score
 * was, and who went through, and a round is the unit that answers all three.
 *
 * So there is one view now and no toggle. Each round is a card that states its
 * own status (the user's tie is pulled to the top of its round), winners are
 * marked, and a shootout says so on the row rather than in a footnote.
 */
function CupView() {
  const game = useGame((s) => s.game)!;

  const rounds = game.cup.roundNames.map((name, i) => ({
    name,
    index: i,
    day: game.schedule.cupRoundDays[i],
    fixtures: game.fixtures.filter((f) => f.competition === "CUP" && f.round === i + 1),
  }));

  return (
    <div className="space-y-4">
      {game.cup.winnerId && (
        <Card className="border-gold-lo p-4 text-center">
          <div className="text-[11px] uppercase tracking-widest text-faint">Cup Winners</div>
          <div className="display gold-text mt-1 text-2xl font-bold">{game.teams[game.cup.winnerId].name}</div>
        </Card>
      )}

      {rounds.map((r) => {
        // A round is "done" once every tie in it has been played — that, not the
        // calendar, is what decides whether the heading reports a result or a date.
        const played = r.fixtures.filter((f) => f.played).length;
        const complete = r.fixtures.length > 0 && played === r.fixtures.length;
        const drawn = r.fixtures.length > 0;
        // The user's own tie leads its round; everything else keeps draw order.
        const ordered = [...r.fixtures].sort((a, b) => {
          const mine = (f: typeof a) => (f.homeId === game.userTeamId || f.awayId === game.userTeamId ? 0 : 1);
          return mine(a) - mine(b);
        });

        return (
          <Card key={r.name} className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
              <div className="min-w-0">
                <div className="display truncate text-[13px] font-semibold uppercase tracking-wider">{r.name}</div>
                <div className="text-[11px] text-faint">
                  {formatDayShort(r.day)}
                  {drawn && ` · ${r.fixtures.length} ${r.fixtures.length === 1 ? "tie" : "ties"}`}
                </div>
              </div>
              <span
                className={`display shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  complete ? "bg-raised text-faint" : drawn ? "gold-grad text-black" : "border border-line text-faint"
                }`}
              >
                {complete ? "Complete" : drawn ? `${played}/${r.fixtures.length} played` : "Not drawn"}
              </span>
            </div>

            {drawn ? (
              <div className="divide-y divide-line/50">
                {ordered.map((f) => (
                  <CupTieRow key={f.id} f={f} />
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-faint">
                {game.cup.currentRound >= r.index ? "Draw made on the day." : "Awaiting earlier rounds."}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * One cup tie as a single row: both clubs, the score, and who advanced.
 *
 * Full club names (not the bracket's three-letter codes) — a row has the width
 * for them, and they are what makes the page scannable. The loser is dimmed and
 * the winner carries the gold score, so "who went through" needs no legend.
 */
function CupTieRow({ f }: { f: Fixture }) {
  const game = useGame((s) => s.game)!;
  const openTeam = useContext(OpenTeam);

  const winnerId = !f.played
    ? null
    : f.shootoutWinnerId ?? (f.homeGoals! > f.awayGoals! ? f.homeId : f.awayGoals! > f.homeGoals! ? f.awayId : null);
  const mine = f.homeId === game.userTeamId || f.awayId === game.userTeamId;

  const club = (teamId: string, align: "right" | "left") => {
    const t = game.teams[teamId];
    const won = winnerId === teamId;
    const lost = f.played && winnerId !== null && !won;
    return (
      <button
        onClick={() => openTeam(teamId)}
        className={`flex min-w-0 flex-1 items-center gap-2 truncate hover:text-gold ${
          align === "right" ? "justify-end text-right" : "justify-start text-left"
        } ${lost ? "text-faint" : ""} ${won ? "font-semibold text-ink" : ""}`}
        title={t.name}
      >
        {align === "left" && <Crest colors={t.colors} short={t.short} size={18} />}
        <span className="truncate">{t.name}</span>
        {align === "right" && <Crest colors={t.colors} short={t.short} size={18} />}
      </button>
    );
  };

  return (
    <div className={`px-3 py-2 text-[13px] ${mine ? "bg-hover/50" : ""}`}>
      <div className="flex items-center gap-2">
        {club(f.homeId, "right")}
        <span
          className={`display w-14 shrink-0 text-center tnum font-bold ${
            f.played ? "gold-text" : "text-faint"
          }`}
        >
          {f.played ? `${f.homeGoals}–${f.awayGoals}` : "v"}
        </span>
        {club(f.awayId, "left")}
      </div>
      {f.shootoutWinnerId && (
        <div className="mt-0.5 text-center text-[10px] text-faint">
          {game.teams[f.shootoutWinnerId].name} win on penalties
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
                <CompDot s={s} />
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
      <CompDot s={s} />
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
        <span
          className={`display rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${s.color ? "" : s.chip}`}
          style={s.color ? { borderColor: `${s.color}80`, color: s.color } : undefined}
        >
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
          right={
            league && (
              <span className="flex items-center gap-3">
                <LeagueRepBadge league={league} />
                <span className="flex items-center gap-1.5 text-xs text-faint">
                  <CountryFlag country={league.country} size={14} />
                  {league.country}
                </span>
              </span>
            )
          }
        >
          <TableCard rows={result.table} euroSlot={(pos) => euroSlotForPosition(game, leagueId, pos)} />
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Top Scorers">
          <StatLeaders
            rows={result.topScorers
              .map((s) => ({ p: game.players[s.playerId], value: s.goals }))
              .filter((r) => r.p)
              .map((r) => ({ id: r.p.id, name: r.p.name, nat: r.p.nationality, pos: r.p.positions[0], short: r.p.clubId ? game.teams[r.p.clubId].short : "", value: r.value }))}
            emptyLabel="No goals recorded."
            onView={viewPlayer}
          />
        </Section>
        <Section title="Top Assists">
          <StatLeaders
            rows={(result.topAssists ?? [])
              .map((s) => ({ p: game.players[s.playerId], value: s.assists }))
              .filter((r) => r.p)
              .map((r) => ({ id: r.p.id, name: r.p.name, nat: r.p.nationality, pos: r.p.positions[0], short: r.p.clubId ? game.teams[r.p.clubId].short : "", value: r.value }))}
            emptyLabel="No assists recorded."
            onView={viewPlayer}
          />
        </Section>
      </div>
    </div>
  );
}

"use client";

// Squad (§15.2): roster with fitness/form at a glance, sortable and filterable.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { PlayerBio, Pos } from "@/lib/types";
import { POS_LABELS, POS_ORDER } from "@/lib/config/positions";
import { yearsLeft } from "@/lib/contracts";
import { formatMoney } from "@/lib/value";
import { matchesPlayerName } from "@/lib/search";
import { Card, displayFullName, FitnessBar, Flag, FormChip, GhostButton, GoldButton, Modal, Money, Ovr, ArchetypeLabel, PlayerCard, PlayerGrid, PosBadge, Section, usePlayerView, ViewToggle } from "../ui";
import { parsePlayerFile, type PlayerFile } from "@/lib/playerfile";

// The contract used to be a single column (years, then wage as a tiebreak). It's
// now split so wage/week and years-left are each their own sortable column with
// their own filter (v1.54) — a squad's wage bill and its contract runway are
// different questions and the manager wants to slice on each independently.
type SortKey = "pos" | "name" | "age" | "overall" | "fitness" | "value" | "goals" | "apps" | "wage" | "years";

// Wage brackets (weekly, £) the wage filter offers. Open-ended top bracket.
const WAGE_BANDS: { key: string; label: string; min: number; max: number }[] = [
  { key: "all", label: "Any wage", min: 0, max: Infinity },
  { key: "u5", label: "< £5k/wk", min: 0, max: 5_000 },
  { key: "5-20", label: "£5k–£20k/wk", min: 5_000, max: 20_000 },
  { key: "20-50", label: "£20k–£50k/wk", min: 20_000, max: 50_000 },
  { key: "50-100", label: "£50k–£100k/wk", min: 50_000, max: 100_000 },
  { key: "o100", label: "> £100k/wk", min: 100_000, max: Infinity },
];

// Contract-length buckets the years filter offers.
const YEARS_BANDS: { key: string; label: string; test: (yl: number) => boolean }[] = [
  { key: "all", label: "Any length", test: () => true },
  { key: "expiring", label: "Final year", test: (yl) => yl <= 1 },
  { key: "short", label: "1–2 yrs", test: (yl) => yl >= 1 && yl <= 2 },
  { key: "mid", label: "3–4 yrs", test: (yl) => yl >= 3 && yl <= 4 },
  { key: "long", label: "5+ yrs", test: (yl) => yl >= 5 },
];

export default function SquadScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [sort, setSort] = useState<SortKey>("pos");
  const [desc, setDesc] = useState(false);
  const [view, setView] = usePlayerView("squad");

  // Filters (v1.54): name search, position, and the two contract facets.
  const [nameQuery, setNameQuery] = useState("");
  const [posFilter, setPosFilter] = useState<"ALL" | Pos>("ALL");
  const [wageBand, setWageBand] = useState("all");
  const [yearsBand, setYearsBand] = useState("all");

  // A parsed player file awaiting confirmation (v1.91).
  const [pendingImport, setPendingImport] = useState<PlayerFile | null>(null);
  const showToast = useGame((s) => s.showToast);

  const team = game.teams[game.userTeamId];

  const allPlayers = useMemo(
    () => team.playerIds.map((id) => game.players[id]).filter(Boolean),
    [team.playerIds, game.players]
  );

  const players = useMemo(() => {
    const wage = WAGE_BANDS.find((b) => b.key === wageBand) ?? WAGE_BANDS[0];
    const years = YEARS_BANDS.find((b) => b.key === yearsBand) ?? YEARS_BANDS[0];
    const filtered = allPlayers
      .filter((p) => posFilter === "ALL" || p.positions[0] === posFilter)
      .filter((p) => matchesPlayerName(p, nameQuery))
      .filter((p) => {
        if (wage.key === "all") return true;
        const w = p.contract?.wage ?? 0;
        return w >= wage.min && w < wage.max;
      })
      .filter((p) => (years.key === "all" ? true : years.test(yearsLeft(game, p))));

    const dir = desc ? -1 : 1;
    const cmp: Record<SortKey, (a: PlayerBio, b: PlayerBio) => number> = {
      pos: (a, b) => POS_ORDER.indexOf(a.positions[0]) - POS_ORDER.indexOf(b.positions[0]) || b.overall - a.overall,
      name: (a, b) => a.name.localeCompare(b.name),
      age: (a, b) => a.age - b.age,
      overall: (a, b) => b.overall - a.overall,
      fitness: (a, b) => a.fitness - b.fitness,
      value: (a, b) => b.value - a.value,
      goals: (a, b) => b.stats.goals - a.stats.goals,
      apps: (a, b) => b.stats.apps - a.stats.apps,
      wage: (a, b) => (b.contract?.wage ?? 0) - (a.contract?.wage ?? 0),
      years: (a, b) => yearsLeft(game, a) - yearsLeft(game, b) || (a.contract?.wage ?? 0) - (b.contract?.wage ?? 0),
    };
    return filtered.slice().sort((a, b) => dir * cmp[sort](a, b));
  }, [allPlayers, sort, desc, game, nameQuery, posFilter, wageBand, yearsBand]);

  const filtered = players.length !== allPlayers.length;

  const TH = ({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={`cursor-pointer select-none px-2 py-2 text-[11px] font-semibold uppercase tracking-widest text-faint hover:text-dim ${className}`}
      onClick={() => {
        if (sort === k) setDesc(!desc);
        else {
          setSort(k);
          setDesc(false);
        }
      }}
    >
      {children}
      {sort === k && <span className="gold-text ml-1">{desc ? "▾" : "▴"}</span>}
    </th>
  );

  const selCls =
    "display rounded border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none transition-colors hover:border-faint focus:border-gold-lo/60";

  const filterBar = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* Name search */}
      <div className="relative">
        <input
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="Search name…"
          className="w-44 rounded border border-line bg-raised px-2.5 py-1.5 text-xs text-ink outline-none transition-colors placeholder:text-faint hover:border-faint focus:border-gold-lo/60"
        />
        {nameQuery && (
          <button
            onClick={() => setNameQuery("")}
            title="Clear"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-sm leading-none text-faint hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {/* Position filter */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-faint">Pos</span>
        <select value={posFilter} onChange={(e) => setPosFilter(e.target.value as "ALL" | Pos)} className={selCls}>
          <option value="ALL">All positions</option>
          {POS_ORDER.map((p) => (
            <option key={p} value={p}>
              {POS_LABELS[p]}
            </option>
          ))}
        </select>
      </label>

      {/* Wage filter */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-faint">Wage</span>
        <select value={wageBand} onChange={(e) => setWageBand(e.target.value)} className={selCls}>
          {WAGE_BANDS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      {/* Contract years filter */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-faint">Contract</span>
        <select value={yearsBand} onChange={(e) => setYearsBand(e.target.value)} className={selCls}>
          {YEARS_BANDS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      {filtered && (
        <span className="text-[11px] text-faint">
          <span className="tnum text-dim">{players.length}</span> of {allPlayers.length}
        </span>
      )}

      {/* Import a player file (v1.91). Sits with the squad tools rather than in
          Transfers because it isn't a transfer — no fee, no negotiation. The
          chosen file opens a preview first: signing someone sight-unseen out of
          a file is exactly the mistake this control could otherwise invite. */}
      <label className="ml-auto cursor-pointer">
        <span className="display rounded border border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint transition-colors hover:border-gold-lo/60 hover:text-gold">
          Import Player
        </span>
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            // Reset immediately so re-picking the SAME file fires onChange again.
            e.target.value = "";
            if (!f) return;
            try {
              setPendingImport(parsePlayerFile(await f.text()));
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Couldn't read that file.");
            }
          }}
        />
      </label>
    </div>
  );

  return (
    <Section
      title={`Squad — ${allPlayers.length} players`}
      right={
        <span className="flex items-center gap-3">
          <span className="hidden text-xs text-faint sm:inline">
            {[
              game.transferList.length ? `${game.transferList.length} transfer-listed` : "",
              game.academy.loanList.length ? `${game.academy.loanList.length} loan-listed` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <ViewToggle view={view} onChange={setView} />
        </span>
      }
    >
      {filterBar}
      {players.length === 0 ? (
        <Card className="px-4 py-6 text-sm text-faint">No players match these filters.</Card>
      ) : view === "grid" ? (
        <PlayerGrid>
          {players.map((p) => (
            <PlayerCard
              key={p.id}
              p={p}
              onOpen={() => viewPlayer(p.id)}
              ovr={<Ovr value={p.overall} size="sm" />}
              sub={<ArchetypeLabel p={p} iconSize={14} />}
              badges={
                <>
                  {game.transferList.includes(p.id) && <span className="text-[10px] text-gold">LISTED</span>}
                  {!p.loan && game.academy.loanList.includes(p.id) && (
                    <span className="text-[10px] text-win">LOAN-LISTED</span>
                  )}
                  {p.loan && (
                    <span className="text-[10px] text-win">ON LOAN · {game.teams[p.loan.toClubId]?.short}</span>
                  )}
                  {p.traits.length > 0 && <span className="text-[10px] text-faint">{"◆".repeat(p.traits.length)}</span>}
                </>
              }
              stats={
                <>
                  <FitnessBar value={p.fitness} />
                  <FormChip form={p.form} />
                  <span className="tnum">
                    {p.stats.goals}/{p.stats.assists}
                  </span>
                  <Money value={p.value} className="text-dim" />
                </>
              }
            />
          ))}
        </PlayerGrid>
      ) : (
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[940px] text-sm">
          <thead className="border-b border-line">
            <tr>
              <TH k="pos" className="text-left">Pos</TH>
              <TH k="name" className="text-left">Player</TH>
              <TH k="age">Age</TH>
              <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-widest text-faint">Archetype</th>
              <TH k="overall">Ovr</TH>
              <TH k="fitness" className="text-left">Fitness</TH>
              <th className="px-2 py-2 text-[11px] font-semibold uppercase tracking-widest text-faint">Form</th>
              <TH k="apps">Apps</TH>
              <TH k="goals">G / A</TH>
              <TH k="value" className="text-right">Value</TH>
              <TH k="wage" className="text-right">Wage/wk</TH>
              <TH k="years" className="text-right">Years</TH>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.id}
                onClick={() => viewPlayer(p.id)}
                className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-hover"
              >
                <td className="px-2 py-2">
                  <PosBadge pos={p.positions[0]} />
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <Flag nat={p.nationality} size={14} />
                    <span className="font-medium">{displayFullName(p)}</span>
                    {game.transferList.includes(p.id) && <span className="text-[10px] text-gold">LISTED</span>}
                    {!p.loan && game.academy.loanList.includes(p.id) && (
                      <span className="text-[10px] text-win">LOAN-LISTED</span>
                    )}
                    {p.loan && <span className="text-[10px] text-win">ON LOAN · {game.teams[p.loan.toClubId]?.short}</span>}
                    {p.traits.length > 0 && <span className="text-[10px] text-faint">{"◆".repeat(p.traits.length)}</span>}
                  </span>
                </td>
                <td className="px-2 py-2 text-center tnum text-dim">{p.age}</td>
                {/* v1.75: the archetype icon that used to sit here is gone —
                    ArchetypeLabel now carries the archetype's own art, and two
                    circular glyphs in a column headed "Archetype" read as one
                    thing repeated. The archetype is still on the profile. */}
                <td className="px-2 py-2 text-[13px] text-dim">
                  <ArchetypeLabel p={p} />
                </td>
                <td className="px-2 py-2 text-center">
                  {/* No season-growth badge on the squad list (v21): at the start
                      of a season nobody has moved yet, so the badge would read as
                      a flat column of nothing. The running +/- lives on the Player
                      Profile and Development screens where it has context. */}
                  <Ovr value={p.overall} size="sm" />
                </td>
                <td className="px-2 py-2">
                  <FitnessBar value={p.fitness} />
                </td>
                <td className="px-2 py-2 text-center">
                  <FormChip form={p.form} />
                </td>
                <td className="px-2 py-2 text-center tnum text-dim">{p.stats.apps}</td>
                <td className="px-2 py-2 text-center tnum text-dim">
                  {p.stats.goals} / {p.stats.assists}
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={p.value} className="text-dim" />
                </td>
                <td className="px-2 py-2 text-right tnum text-dim">
                  {p.contract ? `${formatMoney(p.contract.wage)}` : <span className="text-[10px] text-faint">—</span>}
                </td>
                <td className="px-2 py-2 text-right">
                  {p.contract ? (
                    (() => {
                      const yl = yearsLeft(game, p);
                      return (
                        <span className={`tnum ${yl <= 1 ? "text-loss" : "text-dim"}`}>
                          {yl <= 1 ? "final" : `${yl} yrs`}
                        </span>
                      );
                    })()
                  ) : (
                    <span className="text-[10px] text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {pendingImport && (
        <ImportPlayerModal file={pendingImport} onClose={() => setPendingImport(null)} />
      )}
    </Section>
  );
}

/**
 * Confirm an incoming player file (v1.91).
 *
 * Shows what the file actually contains — ratings, honours, where he came from —
 * before anything touches the save, and states plainly that this is a modding
 * tool rather than a signing: no fee changes hands and nobody negotiates. The
 * free-agent option exists for the user who wants the character to EXIST in
 * this world but would rather sign him properly through the market.
 */
function ImportPlayerModal({ file, onClose }: { file: PlayerFile; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const importPlayerFile = useGame((s) => s.importPlayerFile);
  const showToast = useGame((s) => s.showToast);
  const p = file.player;
  const seasons = file.career?.seasons?.length ?? 0;
  const honours = p.accolades?.length ?? 0;

  const sign = (clubId: string | null) => {
    const err = importPlayerFile(file, clubId);
    if (err) showToast(err);
    else onClose();
  };

  return (
    <Modal title="Import player" onClose={onClose}>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Ovr value={p.overall} />
            <div className="min-w-0 flex-1">
              <div className="display truncate text-lg font-semibold">{displayFullName(p)}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                <PosBadge pos={p.positions[0]} />
                <span>{p.age}y</span>
                <Flag nat={p.nationality} />
                <span>Potential {p.potential}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
            From <span className="text-dim">{file.origin.saveName}</span>
            {file.origin.clubName && <> · {file.origin.clubName}</>} · season {file.origin.season}
            {(seasons > 0 || honours > 0) && (
              <>
                <br />
                Carries {seasons} season{seasons === 1 ? "" : "s"} of career history
                {honours > 0 && <> and {honours} honour{honours === 1 ? "" : "s"}</>}.
              </>
            )}
          </div>
        </Card>

        <p className="text-[12px] leading-relaxed text-faint">
          Importing is a modding tool, not a transfer — no fee is paid and nobody negotiates. He
          arrives on a fresh 3-year contract and, like any signing, can&apos;t be sold on until next
          season.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton onClick={() => sign(null)} className="!py-1.5 text-xs">
            ADD AS FREE AGENT
          </GhostButton>
          <GoldButton onClick={() => sign(game.userTeamId)} className="!py-1.5">
            SIGN TO MY CLUB
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

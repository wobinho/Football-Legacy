"use client";

// Interactive season calendar (Home). Shows the user's fixtures on their days
// and lets you fast-forward ("simulate to") any future day EA-FC style — the
// engine force-plays your matches with your saved lineup along the way.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Fixture } from "@/lib/types";
import { dayMonth, monthGrid, monthLabel, dayOfMonth, formatDay } from "@/lib/calendar";
import { isSeasonComplete } from "@/lib/gameloop";
import { Crest } from "./ui";
import GateModal from "./GateModal";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export default function Calendar() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const simulateToDay = useGame((s) => s.simulateToDay);
  const onMatchday = game.pendingMatchFixtureId !== null;
  const seasonOver = isSeasonComplete(game);

  // fixtures involving the user, keyed by day
  const byDay = useMemo(() => {
    const m = new Map<number, Fixture>();
    for (const f of game.fixtures) {
      if (f.homeId === game.userTeamId || f.awayId === game.userTeamId) m.set(f.day, f);
    }
    return m;
  }, [game.fixtures, game.userTeamId]);

  const cur = dayMonth(game.currentDay);
  const [view, setView] = useState<{ year: number; month0: number }>(cur);
  const [confirm, setConfirm] = useState<number | null>(null);

  const grid = useMemo(() => monthGrid(view.year, view.month0), [view]);

  const step = (dir: number) => {
    const m0 = view.month0 + dir;
    const year = view.year + Math.floor(m0 / 12);
    setView({ year, month0: ((m0 % 12) + 12) % 12 });
  };
  const goToday = () => setView(dayMonth(game.currentDay));

  const confirmFixture = confirm != null ? byDay.get(confirm) : undefined;
  // count the user's matches that would be auto-played on the way to `confirm`
  const autoMatches = useMemo(() => {
    if (confirm == null) return 0;
    let n = 0;
    for (const [d, f] of byDay) if (d > game.currentDay && d <= confirm && !f.played) n++;
    return n;
  }, [confirm, byDay, game.currentDay]);

  const runSim = (target: number) => {
    simulateToDay(target);
    setConfirm(null);
    // A progress gate may have paused the sim before `target`, so snap the view
    // to where the calendar actually landed rather than the intended day.
    setView(dayMonth(Math.min(target, game.currentDay, game.schedule.seasonEndDay)));
  };

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      {/* month header */}
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => step(-1)} className="rounded px-2 py-1 text-dim hover:bg-hover hover:text-ink" aria-label="Previous month">
          ‹
        </button>
        <div className="display text-sm font-semibold">{monthLabel(view.year, view.month0)}</div>
        <button onClick={() => step(1)} className="rounded px-2 py-1 text-dim hover:bg-hover hover:text-ink" aria-label="Next month">
          ›
        </button>
      </div>

      {/* weekday row */}
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-faint">
        {WEEKDAYS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      {/* day grid */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((day, i) => {
          if (day == null) return <div key={i} />;
          const isToday = day === game.currentDay;
          const isPast = day < game.currentDay;
          const fixture = byDay.get(day);
          const canSim = day > game.currentDay && day <= game.schedule.seasonEndDay && !onMatchday && !seasonOver;

          let cell = "border-line/40 text-faint";
          if (isToday) cell = "border-gold-lo bg-hover text-ink ring-1 ring-gold-lo";
          else if (fixture) cell = "border-line bg-raised text-ink";
          else if (!isPast) cell = "border-line/40 text-dim";

          const opp = fixture
            ? game.teams[fixture.homeId === game.userTeamId ? fixture.awayId : fixture.homeId]
            : null;
          const isHome = fixture ? fixture.homeId === game.userTeamId : false;

          const clickable = canSim;
          return (
            <button
              key={i}
              disabled={!clickable}
              onClick={() => clickable && setConfirm(day)}
              title={
                clickable
                  ? `Simulate to ${formatDay(day)}`
                  : fixture
                    ? `${isHome ? "vs" : "@"} ${opp?.name}${fixture.played ? "" : isHome ? " (Home)" : " (Away)"}`
                    : formatDay(day)
              }
              className={`relative flex aspect-square flex-col items-center justify-center rounded border p-0.5 transition-colors ${cell} ${
                clickable ? "cursor-pointer hover:border-gold-lo hover:bg-hover" : "cursor-default"
              }`}
            >
              {/* On fixture days, the opponent crest is the hero of the cell so
                  you can read the opponent at a glance; the date tucks up top. */}
              {fixture && opp ? (
                <>
                  <span className="absolute left-1 top-0.5 tnum text-[9px] leading-none text-faint">{dayOfMonth(day)}</span>
                  <span
                    className={`absolute right-0.5 top-0.5 rounded-[3px] px-1 text-[8px] font-bold leading-none ${
                      isHome ? "text-win/80" : "text-dim"
                    }`}
                    title={isHome ? "Home" : "Away"}
                  >
                    {isHome ? "H" : "A"}
                  </span>
                  <Crest colors={opp.colors} short={opp.short} size={22} />
                  {fixture.played && (
                    <span className="mt-0.5">
                      <ResultDot fixture={fixture} userTeamId={game.userTeamId} />
                    </span>
                  )}
                </>
              ) : (
                <span className="tnum text-[11px] leading-none">{dayOfMonth(day)}</span>
              )}
              {fixture?.competition === "CUP" && (
                <span className="absolute bottom-0.5 left-0.5 text-[8px] text-gold">◆</span>
              )}
            </button>
          );
        })}
      </div>

      {/* legend + jump-to-today */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-faint">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-win" />Win</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-loss" />Loss</span>
          <span className="text-gold">◆ Cup</span>
        </div>
        <button onClick={goToday} className="hover:text-dim">Today</button>
      </div>

      {onMatchday && (
        <div className="mt-2 rounded border border-gold-lo/50 bg-raised p-2 text-[11px] text-gold">
          Play your match first — head to Match Day before simulating ahead.
        </div>
      )}

      {!onMatchday && seasonOver && (
        <div className="mt-2 rounded border border-gold-lo/50 bg-raised p-2 text-[11px] text-gold">
          Season complete — every match has been played. Press END SEASON to close it out.
        </div>
      )}

      {/* confirm dialog */}
      {confirm != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5" onClick={(e) => e.stopPropagation()}>
            <div className="display mb-1 text-base font-semibold">Simulate ahead?</div>
            <div className="gold-thread mb-3" />
            <p className="text-sm text-dim">
              Fast-forward to <span className="text-ink">{formatDay(confirm)}</span>.
            </p>
            {confirmFixture && !confirmFixture.played && (
              <p className="mt-2 text-[13px] text-faint">A match of yours falls on that day and will be played too.</p>
            )}
            {autoMatches > 0 && (
              <p className="mt-2 rounded border border-line bg-raised p-2 text-[12px] text-dim">
                ⚠ {autoMatches} of your {autoMatches === 1 ? "match" : "matches"} will be auto-played with your saved lineup. Set your tactics first if you want control.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-dim hover:text-ink">
                Cancel
              </button>
              <button onClick={() => runSim(confirm)} className="gold-grad display rounded-md px-4 py-1.5 text-sm font-bold text-[#14120a]">
                SIMULATE ▸
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress gate (§3): a multi-day sim paused before an important calendar
          day. The user acts on it, keeps going, or stays here. */}
      <GateModal />
    </div>
  );
}

function ResultDot({ fixture, userTeamId }: { fixture: Fixture; userTeamId: string }) {
  const isHome = fixture.homeId === userTeamId;
  const gf = isHome ? fixture.homeGoals! : fixture.awayGoals!;
  const ga = isHome ? fixture.awayGoals! : fixture.homeGoals!;
  let color = "bg-draw";
  if (gf > ga) color = "bg-win";
  else if (gf < ga) color = "bg-loss";
  // shootout in cups still shows a result colour by who advanced
  if (fixture.competition === "CUP" && gf === ga && fixture.shootoutWinnerId) {
    color = fixture.shootoutWinnerId === userTeamId ? "bg-win" : "bg-loss";
  }
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={`${gf}–${ga}`} />
  );
}

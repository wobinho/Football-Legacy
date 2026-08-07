"use client";

// Interactive season calendar (Home). Shows the user's fixtures on their days
// and lets you fast-forward ("simulate to") any future day EA-FC style — the
// engine force-plays your matches with your saved lineup along the way.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Fixture } from "@/lib/types";
import { dayMonth, monthGrid, monthLabel, dayOfMonth, formatDay, formatDayShort } from "@/lib/calendar";
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

  // The next ten of the user's unplayed fixtures, in date order (v1.98). The
  // calendar answers "what does this month look like"; this answers "what is
  // coming", which is the question a manager actually has and which a month
  // grid can only answer by paging. Both drive the SAME confirm dialog and the
  // same `simulateToDay`, so the rail can never fast-forward on terms the
  // calendar wouldn't.
  const upcoming = useMemo(() => {
    return game.fixtures
      .filter(
        (f) =>
          (f.homeId === game.userTeamId || f.awayId === game.userTeamId) &&
          !f.played &&
          f.day >= game.currentDay
      )
      .sort((a, b) => a.day - b.day)
      .slice(0, 10);
  }, [game.fixtures, game.userTeamId, game.currentDay]);

  // The last five results, most recent first (v1.99). The counterpart to the
  // rail above and deliberately its mirror image: Upcoming answers "what is
  // coming" and this answers "how has it been going", which is the other half of
  // the question a manager opens this screen with. Five rather than ten because
  // that is what the column has room for under Upcoming, and because five is
  // already the length every other form reading in the game uses.
  //
  // It reads only fixtures the engine has already played — like the grid cells
  // and unlike nothing else on this screen, it never simulates and has no
  // clickable target: there is nothing to fast-forward to in the past.
  const results = useMemo(() => {
    return game.fixtures
      .filter(
        (f) => (f.homeId === game.userTeamId || f.awayId === game.userTeamId) && f.played
      )
      .sort((a, b) => b.day - a.day)
      .slice(0, 5);
  }, [game.fixtures, game.userTeamId]);

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      {/* 70/30 (v1.98): the month grid keeps the bulk of the width and the
          upcoming rail takes the remainder. Below `lg` they stack — a 30%
          column of a phone is not a column. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[7fr_3fr]">
        <div>
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
              className={`relative flex aspect-square min-h-[3.25rem] flex-col items-center justify-center overflow-hidden rounded border p-0.5 transition-colors ${cell} ${
                clickable ? "cursor-pointer hover:border-gold-lo hover:bg-hover" : "cursor-default"
              }`}
            >
              {/* On fixture days, the opponent crest is the hero of the cell so
                  you can read the opponent at a glance; the date tucks up top.
                  Below it (v1.97) the opponent's SHORT CODE and, once the match
                  has been played, the score — the calendar now sits in the wide
                  column, and a crest alone in a cell that big was reading the
                  fixture list through a keyhole. Both lines only ever say what
                  the fixture already records; nothing here simulates. */}
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
                  <Crest team={opp} size={22} />
                  {/* 9px → 11px, and `text-ink` (v1.99). At the old size and a
                      dimmed colour the abbreviation was decoration under the
                      crest rather than something you could read across the
                      grid, which is the whole reason it was added in v1.97.
                      `max-w-full truncate` still holds it inside the cell. */}
                  <span className="display mt-0.5 max-w-full truncate text-[11px] font-bold leading-none tracking-wide text-ink">
                    {opp.short}
                  </span>
                  {fixture.played && (
                    <span className="mt-0.5 flex items-center gap-1 leading-none">
                      <ResultDot fixture={fixture} userTeamId={game.userTeamId} />
                      <ScoreLine fixture={fixture} userTeamId={game.userTeamId} />
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
        </div>

        {/* ── Upcoming fixtures (v1.98) ────────────────────────────────────
            Ten rows, each the fixture in abbreviation: competition mark, H/A,
            the opponent's SHORT code, the date. Clicking one simulates up to
            AND INCLUDING that match, through the same confirmation the
            calendar uses — the fixture's own day IS the target, so nothing
            here needs to know how the engine plays a matchday. */}
        <div className="min-w-0 lg:border-l lg:border-line/60 lg:pl-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="display text-sm font-semibold">Upcoming</div>
            <span className="text-[10px] uppercase tracking-widest text-faint">Next {upcoming.length}</span>
          </div>
          <div className="gold-thread mb-2" />
          {upcoming.length === 0 ? (
            <div className="rounded border border-line/50 bg-raised p-3 text-center text-[11px] text-faint">
              No fixtures left this season.
            </div>
          ) : (
            <ul className="space-y-1">
              {upcoming.map((f) => {
                const isHome = f.homeId === game.userTeamId;
                const opp = game.teams[isHome ? f.awayId : f.homeId];
                const isNext = f.day <= game.currentDay;
                // The same gate the grid applies: you may only fast-forward to a
                // FUTURE day, inside the season, and not while a match of yours
                // is waiting to be played.
                const clickable =
                  f.day > game.currentDay &&
                  f.day <= game.schedule.seasonEndDay &&
                  !onMatchday &&
                  !seasonOver;
                return (
                  <li key={f.id}>
                    <button
                      disabled={!clickable}
                      onClick={() => clickable && setConfirm(f.day)}
                      title={
                        clickable
                          ? `Simulate through ${isHome ? "vs" : "@"} ${opp?.name} on ${formatDay(f.day)}`
                          : `${isHome ? "vs" : "@"} ${opp?.name} — ${formatDay(f.day)}`
                      }
                      className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                        isNext ? "border-gold-lo bg-hover" : "border-line/50 bg-raised"
                      } ${clickable ? "cursor-pointer hover:border-gold-lo hover:bg-hover" : "cursor-default opacity-80"}`}
                    >
                      <span
                        className={`display w-3 shrink-0 text-center text-[9px] font-bold leading-none ${
                          f.competition === "CUP" ? "text-gold" : "text-faint"
                        }`}
                        title={f.competition === "CUP" ? "Cup" : "League"}
                      >
                        {f.competition === "CUP" ? "◆" : "·"}
                      </span>
                      <span
                        className={`display w-3 shrink-0 text-[9px] font-bold leading-none ${isHome ? "text-win/80" : "text-dim"}`}
                        title={isHome ? "Home" : "Away"}
                      >
                        {isHome ? "H" : "A"}
                      </span>
                      {opp && <Crest team={opp} size={16} />}
                      {/* The club's FULL name (v2.0), not its short code. The
                          rail is a list of ten rows in a column of its own, so
                          it has the width the month grid's square never had —
                          and "Manchester United" is what a manager reads a
                          fixture list for. `truncate` holds the long ones. */}
                      <span className="display min-w-0 flex-1 truncate text-[13px] font-bold tracking-wide text-ink">
                        {opp?.name ?? "—"}
                      </span>
                      <span className="tnum shrink-0 text-[10px] leading-none text-faint">{formatDayShort(f.day)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!onMatchday && !seasonOver && upcoming.length > 0 && (
            <div className="mt-2 text-[10px] leading-snug text-faint">
              Click a fixture to simulate up to and including it.
            </div>
          )}

          {/* ── Results (v1.99) ───────────────────────────────────────────
              The last five, most recent first, in the same abbreviation as
              Upcoming so the two read as one column: competition mark, H/A,
              crest, short code, then the score with its W/D/L colour where the
              date sits above. Nothing here is clickable — the past is not a
              day you can fast-forward to. */}
          {results.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="display text-sm font-semibold">Results</div>
                <span className="text-[10px] uppercase tracking-widest text-faint">
                  Last {results.length}
                </span>
              </div>
              <div className="gold-thread mb-2" />
              <ul className="space-y-1">
                {results.map((f) => {
                  const isHome = f.homeId === game.userTeamId;
                  const opp = game.teams[isHome ? f.awayId : f.homeId];
                  return (
                    <li key={f.id}>
                      <div
                        className="flex w-full items-center gap-2 rounded border border-line/50 bg-raised px-2 py-1.5 text-left"
                        title={`${isHome ? "vs" : "@"} ${opp?.name} — ${formatDay(f.day)}`}
                      >
                        <span
                          className={`display w-3 shrink-0 text-center text-[9px] font-bold leading-none ${
                            f.competition === "CUP" ? "text-gold" : "text-faint"
                          }`}
                          title={f.competition === "CUP" ? "Cup" : "League"}
                        >
                          {f.competition === "CUP" ? "◆" : "·"}
                        </span>
                        <span
                          className={`display w-3 shrink-0 text-[9px] font-bold leading-none ${
                            isHome ? "text-win/80" : "text-dim"
                          }`}
                          title={isHome ? "Home" : "Away"}
                        >
                          {isHome ? "H" : "A"}
                        </span>
                        {opp && <Crest team={opp} size={16} />}
                        <span className="display min-w-0 flex-1 truncate text-[13px] font-bold tracking-wide text-ink">
                          {opp?.name ?? "—"}
                        </span>
                        <ResultDot fixture={f} userTeamId={game.userTeamId} />
                        <ScoreLine fixture={f} userTeamId={game.userTeamId} size="rail" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
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
      {/* Cancel is the way out — a backdrop click must not fast-forward-adjacent
          dialogs away by accident. */}
      {confirm != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5">
            <div className="display mb-1 text-base font-semibold">Simulate ahead?</div>
            <div className="gold-thread mb-3" />
            <p className="text-sm text-dim">
              Fast-forward to <span className="text-ink">{formatDay(confirm)}</span>.
            </p>
            {confirmFixture && !confirmFixture.played && (
              <p className="mt-2 text-[13px] text-faint">
                Your match that day —{" "}
                <span className="text-dim">
                  {confirmFixture.homeId === game.userTeamId ? "vs" : "@"}{" "}
                  {game.teams[confirmFixture.homeId === game.userTeamId ? confirmFixture.awayId : confirmFixture.homeId]?.name}
                </span>{" "}
                — is included and will be played too.
              </p>
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

/**
 * The score of a played fixture, from the user's side — "2–1" is always
 * theirs-first, so it reads the same way as the W/D/L colour beside it rather
 * than needing the manager to work out which end of the fixture they were.
 *
 * A cup tie settled on penalties says so (`3–1p`): the goals alone would read as
 * a draw next to a win-coloured dot.
 *
 * Two sizes (v1.99), because it is drawn in two places that have very different
 * room: `cell` inside a day of the month grid, where it shares a square with a
 * crest and a date, and `rail` in the Results list, where the score IS the row's
 * payload and was the smallest thing in it.
 */
function ScoreLine({
  fixture,
  userTeamId,
  size = "cell",
}: {
  fixture: Fixture;
  userTeamId: string;
  size?: "cell" | "rail";
}) {
  const isHome = fixture.homeId === userTeamId;
  const gf = isHome ? fixture.homeGoals! : fixture.awayGoals!;
  const ga = isHome ? fixture.awayGoals! : fixture.homeGoals!;
  const pens = fixture.competition === "CUP" && gf === ga && !!fixture.shootoutWinnerId;
  return (
    <span
      className={`tnum shrink-0 font-bold leading-none text-ink ${
        size === "rail" ? "text-[13px]" : "text-[11px]"
      }`}
      title={`${gf}–${ga}`}
    >
      {gf}–{ga}
      {pens && <span className="text-faint">p</span>}
    </span>
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

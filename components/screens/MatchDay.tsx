"use client";

// Match Day (§15.4): event-based text sim watchable in ~30–60s, or instant
// result. Halftime exposes the one in-match interaction point (§6).

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Fixture, MatchEvent, MatchResult, Mentality, Style } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import {
  createMatch,
  playFirstHalf,
  playSecondHalf,
  applyHalftimeTactic,
  finalizeResult,
  type MatchState,
} from "@/lib/engine/match";
import { buildSideInput, headCoachMult } from "@/lib/selection";
import { ensureUserLineup, matchSeed } from "@/lib/gameloop";
import { Card, Crest, GhostButton, GoldButton, Section } from "../ui";

type Phase = "pre" | "first" | "half" | "second" | "done";

export default function MatchDayScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const applyUserResult = useGame((s) => s.applyUserResult);
  const setScreen = useGame((s) => s.setScreen);

  const liveFixture = game.pendingMatchFixtureId
    ? game.fixtures.find((f) => f.id === game.pendingMatchFixtureId) ?? null
    : null;

  const [phase, setPhase] = useState<Phase>("pre");
  // applying the result clears pendingMatchFixtureId — keep the finished
  // fixture around locally so the full-time report stays on screen
  const [doneFixture, setDoneFixture] = useState<Fixture | null>(null);
  const [visibleEvents, setVisibleEvents] = useState<MatchEvent[]>([]);
  const [clock, setClock] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [halfTactic, setHalfTactic] = useState<{ mentality: Mentality; style: Style } | null>(null);
  const matchRef = useRef<MatchState | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(1);
  speedRef.current = speed;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // a fresh matchday arrived — reset any leftover report from the last match
  const liveId = liveFixture?.id ?? null;
  useEffect(() => {
    if (liveId) {
      setPhase("pre");
      setResult(null);
      setVisibleEvents([]);
      setDoneFixture(null);
    }
  }, [liveId]);

  const fixture = liveFixture ?? (phase === "done" ? doneFixture : null);
  if (!fixture) return <NoMatch lastResult={result} onBack={() => setScreen("home")} />;

  const home = game.teams[fixture.homeId];
  const away = game.teams[fixture.awayId];
  const isHome = fixture.homeId === game.userTeamId;
  const userTeam = game.teams[game.userTeamId];

  const buildSides = () => {
    const userLineup = ensureUserLineup(game);
    const mk = (teamId: string) => {
      const t = game.teams[teamId];
      const players = t.playerIds.map((id) => game.players[id]).filter((p) => p && !p.retired && !p.loan);
      const coach = teamId === game.userTeamId ? headCoachMult(t.staff.headCoach?.stars ?? 0, TUNING) : 1;
      const assignments = teamId === game.userTeamId ? t.assignments : undefined;
      return teamId === game.userTeamId
        ? buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, userLineup, coach, assignments)
        : buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, undefined, coach, assignments);
    };
    return { homeSide: mk(fixture.homeId), awaySide: mk(fixture.awayId) };
  };

  const scoreFromEvents = (events: MatchEvent[]) => {
    let h = 0, a = 0;
    for (const e of events) {
      if (e.type === "goal") e.teamId === fixture.homeId ? h++ : a++;
    }
    return { h, a };
  };

  /** Reveal `events` progressively on a minute clock, then call done. */
  const streamEvents = (events: MatchEvent[], fromMinute: number, toMinute: number, done: () => void) => {
    let minute = fromMinute;
    setClock(minute);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      minute += 1;
      if (minute > toMinute) {
        if (timerRef.current) clearInterval(timerRef.current);
        done();
        return;
      }
      setClock(minute);
      setVisibleEvents((prev) => {
        const upTo = events.filter((e) => e.minute <= minute);
        return upTo.length !== prev.length ? upTo : prev;
      });
    }, 140 / speedRef.current);
  };

  const kickOff = () => {
    const { homeSide, awaySide } = buildSides();
    const state = createMatch(homeSide, awaySide, TUNING, matchSeed(game, fixture));
    matchRef.current = state;
    playFirstHalf(state);
    const firstHalfEvents = state.events.slice();
    setPhase("first");
    setVisibleEvents([]);
    streamEvents(firstHalfEvents, 0, 45, () => {
      setVisibleEvents(firstHalfEvents);
      setHalfTactic({ mentality: userTeam.tactic.mentality, style: userTeam.tactic.style });
      setPhase("half");
    });
  };

  const resume = () => {
    const state = matchRef.current!;
    if (halfTactic) {
      applyHalftimeTactic(state, isHome ? "home" : "away", halfTactic);
      userTeam.tactic = { ...userTeam.tactic, ...halfTactic };
    }
    const before = state.events.length;
    playSecondHalf(state);
    const all = state.events.slice();
    setPhase("second");
    streamEvents(all, 45, 91, () => finish(state, all));
  };

  const finish = (state: MatchState, allEvents: MatchEvent[]) => {
    setVisibleEvents(allEvents);
    const res = finalizeResult(state);
    setResult(res);
    setDoneFixture(fixture);
    setPhase("done");
    applyUserResult(fixture, res);
  };

  const instant = () => {
    const { homeSide, awaySide } = buildSides();
    const state = createMatch(homeSide, awaySide, TUNING, matchSeed(game, fixture));
    playFirstHalf(state);
    playSecondHalf(state);
    finish(state, state.events.slice());
  };

  const { h, a } = result ? { h: result.homeGoals, a: result.awayGoals } : scoreFromEvents(visibleEvents);
  const compLabel =
    fixture.competition === "CUP"
      ? `Cup · ${game.cup.roundNames[fixture.round - 1]}`
      : `${game.leagues[fixture.competition]?.name} · Round ${fixture.round}`;

  return (
    <div className="mx-auto max-w-3xl">
      {/* scoreboard */}
      <div className="mb-5 rounded-lg border border-line bg-surface p-5">
        <div className="mb-3 text-center text-[11px] uppercase tracking-widest text-faint">{compLabel}</div>
        <div className="flex items-center justify-between gap-4">
          <TeamSide crest={home} mine={home.id === game.userTeamId} align="left" />
          <div className="text-center">
            <div className="display tnum text-6xl font-bold leading-none">
              {h}<span className="mx-2 text-line">–</span>{a}
            </div>
            <div className="display mt-1 text-sm tnum text-gold">
              {phase === "pre" ? "KICK-OFF" : phase === "half" ? "HALF-TIME" : phase === "done" ? shootoutLabel(fixture, game.userTeamId) ?? "FULL-TIME" : `${clock}'`}
            </div>
          </div>
          <TeamSide crest={away} mine={away.id === game.userTeamId} align="right" />
        </div>
        {(phase === "first" || phase === "second") && (
          <div className="mt-3 flex justify-center gap-1.5">
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded px-2 py-0.5 text-xs ${speed === s ? "gold-grad font-bold text-black" : "border border-line text-faint"}`}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
      </div>

      {phase === "pre" && (
        <div className="flex flex-col items-center gap-4">
          <p className="max-w-md text-center text-sm text-dim">
            Your XI is set from the Tactics screen (auto-picked where empty). {isHome ? "Home advantage is yours." : "Away day."}
          </p>
          <div className="flex gap-3">
            <GoldButton onClick={kickOff}>WATCH MATCH</GoldButton>
            <GhostButton onClick={instant}>Instant result</GhostButton>
            <GhostButton onClick={() => setScreen("tactics")}>Tactics</GhostButton>
          </div>
        </div>
      )}

      {phase === "half" && halfTactic && (
        <Card className="mb-5 p-4">
          <div className="display mb-2 text-sm font-semibold text-gold">HALF-TIME TEAM TALK</div>
          <div className="flex flex-wrap items-end gap-4">
            {([["Mentality", ["Defensive", "Balanced", "Attacking"], halfTactic.mentality, (v: string) => setHalfTactic({ ...halfTactic, mentality: v as Mentality })],
               ["Style", ["Possession", "Counter", "Direct"], halfTactic.style, (v: string) => setHalfTactic({ ...halfTactic, style: v as Style })]] as const).map(
              ([label, opts, cur, apply]) => (
                <div key={label}>
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{label}</div>
                  <div className="flex gap-1">
                    {opts.map((o) => (
                      <button
                        key={o}
                        onClick={() => apply(o)}
                        className={`display rounded px-2.5 py-1 text-xs font-semibold ${cur === o ? "gold-grad text-black" : "border border-line text-dim"}`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
            <GoldButton onClick={resume} className="ml-auto">
              PLAY ON ▸
            </GoldButton>
          </div>
        </Card>
      )}

      {phase !== "pre" && (
        <div className="space-y-1.5">
          {visibleEvents
            .slice()
            .reverse()
            .map((e, i) => (
              <EventRow key={visibleEvents.length - i} e={e} userTeamId={game.userTeamId} />
            ))}
        </div>
      )}

      {phase === "done" && result && (
        <PostMatch result={result} fixture={fixture} onDone={() => setScreen("home")} />
      )}
    </div>
  );
}

function shootoutLabel(fixture: Fixture, userTeamId: string): string | null {
  if (!fixture.shootoutWinnerId) return null;
  return fixture.shootoutWinnerId === userTeamId ? "WON ON PENALTIES" : "LOST ON PENALTIES";
}

function TeamSide({ crest, mine, align }: { crest: { name: string; short: string; colors: [string, string] }; mine: boolean; align: "left" | "right" }) {
  return (
    <div className={`flex flex-1 items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <Crest colors={crest.colors} short={crest.short} size={44} />
      <div className={`display text-lg font-bold leading-tight ${mine ? "gold-text" : ""}`}>{crest.name}</div>
    </div>
  );
}

function EventRow({ e, userTeamId }: { e: MatchEvent; userTeamId: string }) {
  const isGoal = e.type === "goal";
  const isMilestone = e.type === "kickoff" || e.type === "halftime" || e.type === "fulltime";
  return (
    <div
      className={`event-in flex gap-3 rounded-md border px-3 py-2 text-sm ${
        isGoal
          ? e.teamId === userTeamId
            ? "border-gold-lo bg-hover"
            : "border-loss/40 bg-surface"
          : isMilestone
            ? "border-line bg-raised text-dim"
            : "border-line/50 bg-surface text-dim"
      }`}
    >
      <span className="display w-8 shrink-0 text-right tnum font-semibold text-faint">{e.minute}&apos;</span>
      <span className={isGoal ? "font-medium text-ink" : ""}>{e.text}</span>
    </div>
  );
}

function PostMatch({ result, fixture, onDone }: { result: MatchResult; fixture: Fixture; onDone: () => void }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const home = game.teams[fixture.homeId];
  const away = game.teams[fixture.awayId];

  const ratingRows = Object.entries(result.ratings)
    .map(([pid, rating]) => ({ p: game.players[pid], rating }))
    .filter((r) => r.p)
    .sort((x, y) => y.rating - x.rating);
  const best = ratingRows[0];

  return (
    <div className="mt-6">
      <Section title="Full-Time Report">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="p-4">
            <StatBar label="Possession" a={result.stats.possession[0]} b={result.stats.possession[1]} suffix="%" />
            <StatBar label="Chances" a={result.stats.shots[0]} b={result.stats.shots[1]} />
            <StatBar label="On target" a={result.stats.onTarget[0]} b={result.stats.onTarget[1]} />
            {best && (
              <div className="mt-3 border-t border-line pt-3 text-sm">
                <span className="text-[11px] uppercase tracking-widest text-faint">Player of the match </span>
                <button className="gold-text ml-1 font-semibold hover:underline" onClick={() => viewPlayer(best.p.id)}>
                  {best.p.name}
                </button>
                <span className="display ml-2 tnum">{best.rating.toFixed(1)}</span>
              </div>
            )}
          </Card>
          <Card className="max-h-64 overflow-y-auto p-3">
            {ratingRows.map(({ p, rating }) => (
              <button
                key={p.id}
                onClick={() => viewPlayer(p.id)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-hover"
              >
                <span className="truncate">
                  <span className="mr-1.5 text-[10px] text-faint">{p.clubId === home.id ? home.short : away.short}</span>
                  {p.name}
                </span>
                <span className={`display tnum font-semibold ${rating >= 7.5 ? "gold-text" : rating < 6 ? "text-loss" : ""}`}>
                  {rating.toFixed(1)}
                </span>
              </button>
            ))}
          </Card>
        </div>
        <div className="mt-4 flex justify-center">
          <GoldButton onClick={onDone}>BACK TO THE WEEK ▸</GoldButton>
        </div>
      </Section>
    </div>
  );
}

function StatBar({ label, a, b, suffix = "" }: { label: string; a: number; b: number; suffix?: string }) {
  const total = a + b || 1;
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs text-dim">
        <span className="tnum">{a}{suffix}</span>
        <span className="text-[10px] uppercase tracking-widest text-faint">{label}</span>
        <span className="tnum">{b}{suffix}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="gold-grad" style={{ width: `${(a / total) * 100}%` }} />
        <div className="bg-line" style={{ width: `${(b / total) * 100}%` }} />
      </div>
    </div>
  );
}

function NoMatch({ lastResult, onBack }: { lastResult: MatchResult | null; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 pt-16 text-center">
      <div className="display text-2xl font-semibold text-dim">NO MATCH TODAY</div>
      <p className="max-w-sm text-sm text-faint">
        {lastResult ? "The result is in the books." : "Hit Continue on the Home screen — the calendar will stop on your next matchday."}
      </p>
      <GhostButton onClick={onBack}>Home</GhostButton>
    </div>
  );
}

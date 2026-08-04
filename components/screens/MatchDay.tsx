"use client";

// Match Day (§15.4): event-based text sim watchable in ~30–60s, or instant
// result. Halftime exposes the one in-match interaction point (§6).

import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Fixture, MatchEvent, MatchResult, Mentality, PlayerBio, Style } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import {
  isFinalLeagueRound,
  liveScoresFor,
  liveTable,
  scoreAt,
  type LiveScore,
} from "@/lib/livescores";
import {
  createMatch,
  playSegments,
  playFirstHalf,
  playSecondHalf,
  applyHalftimeTactic,
  finalizeResult,
  manualSub,
  swapPositions,
  onPitchFor,
  benchFor,
  subsUsedFor,
  liveFitness,
  type MatchState,
  type OnPitch,
} from "@/lib/engine/match";
import { MENTALITY_OPTIONS, STYLE_OPTIONS, styleLabel } from "@/lib/config/formations";
import { buildSideInput } from "@/lib/selection";
import { rotationContextFor, rotationMultiplier } from "@/lib/rotation";
import { ensureUserLineup, matchSeed } from "@/lib/gameloop";
import { Card, Crest, GhostButton, GoldButton, Modal, Ovr, PosBadge, Section } from "../ui";

type Phase = "pre" | "first" | "half" | "second" | "done";

/** Real milliseconds one match minute takes at 1×. Slowed 50% from the original
 * 140ms (v1.68) — the default watch is now a read-along rather than a blur, and
 * the 2×/4× buttons are what get you back to the old pace and quicker. */
const MINUTE_MS = 210;

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
  /** Paused mid-half by the manager (v1.68) — the clock stops and the touchline
   * panel opens. Distinct from half-time, which is a phase of its own. */
  const [paused, setPaused] = useState(false);
  /** Open panel while paused: the substitutions board, or nothing. */
  const [subsOpen, setSubsOpen] = useState(false);
  /** Bumped whenever a sub or a shape change is applied, so the touchline panel
   * re-reads the engine state it renders straight out of `matchRef`. */
  const [touchlineRev, setTouchlineRev] = useState(0);
  /** Final-day scoreboard: the rest of the division, live alongside your match.
   * Off by default — it is a deliberate choice to watch the title race rather
   * than something that appears over your own game unasked. */
  const [scoreboard, setScoreboard] = useState(false);
  const matchRef = useRef<MatchState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedRef = useRef(1);
  speedRef.current = speed;
  /** Set while the clock is stopped by the pause button. The tick loop reads it
   * through the ref (it is bound once per half) and simply stops rescheduling
   * itself; `resumeClock` starts it again from the minute it stopped on. */
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  /** Restarts a paused clock. Held by the streamer for the same reason `skipRef`
   * is — the tick loop owns the local minute counter. */
  const resumeRef = useRef<(() => void) | null>(null);
  /** The half currently streaming, so "Simulate to the end" can finish it from
   * wherever the clock is: the first half hands over to the team talk, the second
   * jumps straight to full time. Null when nothing is streaming. */
  const skipRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // a fresh matchday arrived — reset any leftover report from the last match
  const liveId = liveFixture?.id ?? null;
  useEffect(() => {
    if (liveId) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      skipRef.current = null;
      resumeRef.current = null;
      setPhase("pre");
      setResult(null);
      setVisibleEvents([]);
      setSpeed(1);
      setDoneFixture(null);
      setPaused(false);
      setSubsOpen(false);
      setScoreboard(false);
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
      // v1.79: the head-coach match-day edge went with the old staff system,
      // so both sides play on their merits. Kept as a named constant because
      // `buildSideInput` still takes the multiplier — a future facility that
      // owns match-day rating plugs in here.
      const coach = 1;
      const assignments = teamId === game.userTeamId ? t.assignments : undefined;
      const bench = teamId === game.userTeamId ? game.userBench : undefined;
      if (teamId === game.userTeamId) {
        return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, userLineup, coach, assignments, bench);
      }
      // The AI opponent rotates for this fixture the same way it does in a
      // simulated one (v1.66) — otherwise the side the user watches would be
      // picked by different rules from the side the rest of the league faces.
      const ctx = rotationContextFor(game, teamId, fixture, TUNING);
      const weight = (p: PlayerBio) => rotationMultiplier(game, p, ctx, TUNING);
      return buildSideInput(
        teamId, t.name, t.short, players, t.tactic, TUNING, undefined, coach, assignments, undefined, weight
      );
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

  /**
   * Run the clock from `fromMinute` to `toMinute`, simulating each 15-minute
   * segment only as the clock reaches it, then call `done`.
   *
   * This is the change that makes watching a match interactive (v1.68). It used
   * to take a fully-simulated half and merely reveal its events, so a manager
   * could watch but never intervene — the goals had already been scored before
   * the first minute was drawn. Now the engine holds at each segment boundary
   * (`playSegments(state, n)`), which is why a substitution or a shift in
   * mentality made while paused genuinely changes what happens next.
   *
   * Each minute schedules the next rather than running off a fixed-period
   * interval, so `speedRef` and `pausedRef` are re-read on every tick: pressing
   * 2× or Pause takes effect on the very next minute rather than the next half.
   * `skipRef` finishes the half from wherever the clock is; `resumeRef` restarts
   * a paused one on the minute it stopped.
   */
  const streamHalf = (state: MatchState, fromMinute: number, toMinute: number, done: () => void) => {
    let minute = fromMinute;
    setClock(minute);
    if (timerRef.current) clearTimeout(timerRef.current);

    const stop = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      skipRef.current = null;
      resumeRef.current = null;
    };

    /** Make sure the engine has played far enough to cover `m`. The last segment
     * runs to 90 but the clock ticks to 91 for stoppage time, so the minute is
     * clamped before it is turned into a segment index. */
    const ensureSimulated = (m: number) => {
      const seg = Math.min(
        TUNING.segmentsPerMatch,
        Math.floor(Math.min(m, 89) / TUNING.minutesPerSegment) + 1
      );
      if (state.segment < seg) playSegments(state, seg);
    };

    /** Reveal everything the engine has produced up to `m`. Read fresh off the
     * live state each tick, because that state grows as segments are played. */
    const revealTo = (m: number) => {
      const upTo = state.events.filter((e) => e.minute <= m);
      setVisibleEvents((prev) => (upTo.length !== prev.length ? upTo : prev));
    };

    // Jumping to the end plays out whatever is left of the half at once and hands
    // over exactly where the clock would have — the result is identical, only the
    // waiting is skipped.
    skipRef.current = () => {
      stop();
      ensureSimulated(toMinute);
      setClock(toMinute);
      setVisibleEvents(state.events.slice());
      done();
    };

    const schedule = () => {
      timerRef.current = setTimeout(tick, MINUTE_MS / speedRef.current);
    };

    const tick = () => {
      // Checked BEFORE the minute advances: pausing has to stop the clock on the
      // minute the manager pressed it, not one after. Anything already scheduled
      // when he pressed pause lands here and must simply stand down — otherwise
      // the game moves on under a panel that claims it is stopped.
      if (pausedRef.current) {
        timerRef.current = null; // resumeRef picks the clock back up
        return;
      }
      minute += 1;
      if (minute > toMinute) {
        stop();
        done();
        return;
      }
      // Play the block this minute falls in BEFORE drawing it, so a change the
      // manager made while paused is already in force for these fifteen minutes.
      ensureSimulated(minute);
      setClock(minute);
      revealTo(minute);
      schedule();
    };

    resumeRef.current = () => {
      if (timerRef.current) return; // already running
      schedule();
    };

    schedule();
  };

  const kickOff = () => {
    const { homeSide, awaySide } = buildSides();
    const state = createMatch(homeSide, awaySide, TUNING, matchSeed(game, fixture));
    matchRef.current = state;
    setPhase("first");
    setVisibleEvents([]);
    setPaused(false);
    streamHalf(state, 0, 45, () => {
      setVisibleEvents(state.events.slice());
      setHalfTactic({ mentality: userTeam.tactic.mentality, style: userTeam.tactic.style });
      setPaused(false);
      setSubsOpen(false);
      setPhase("half");
    });
  };

  const resume = () => {
    const state = matchRef.current!;
    if (halfTactic) {
      applyHalftimeTactic(state, isHome ? "home" : "away", halfTactic);
      userTeam.tactic = { ...userTeam.tactic, ...halfTactic };
    }
    setPhase("second");
    setPaused(false);
    streamHalf(state, 45, 91, () => finish(state, state.events.slice()));
  };

  const finish = (state: MatchState, allEvents: MatchEvent[]) => {
    setVisibleEvents(allEvents);
    setPaused(false);
    setSubsOpen(false);
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

  /** Abandon the watch mid-match and take the result (v1.68).
   *
   * The remaining segments are played out immediately under whatever tactics and
   * personnel are in force at the moment you press it, then revealed at once.
   * From the first half it stops at the team talk, because halftime is a decision
   * the manager is owed; from the second it runs through to full time. */
  const simulateToEnd = () => {
    const jump = skipRef.current;
    if (jump) {
      // Skipping from a paused clock is still a skip — drop the pause so the
      // touchline panel closes rather than hanging over a finished half.
      setPaused(false);
      setSubsOpen(false);
      jump();
      return;
    }
    // At half-time nothing is streaming: play the second half out and finish it.
    const state = matchRef.current;
    if (phase === "half" && state) {
      if (halfTactic) {
        applyHalftimeTactic(state, isHome ? "home" : "away", halfTactic);
        userTeam.tactic = { ...userTeam.tactic, ...halfTactic };
      }
      playSecondHalf(state);
      finish(state, state.events.slice());
    }
  };

  // ── Touchline controls (v1.68) ────────────────────────────────────────────
  // Stopping the clock is what turns the watch into management: while paused the
  // manager can make his changes, and because the engine has genuinely not played
  // the next block yet, they matter.

  /** Stop the clock. The ref is set alongside the state because the tick loop is
   * bound outside React's render and reads the ref, not the state — waiting for
   * the flush would let one more minute through. The minute already in flight is
   * cancelled rather than left to stand itself down, which keeps `timerRef` null
   * while stopped: exactly what `resumeRef` tests before restarting. */
  const pauseClock = () => {
    setPaused(true);
    pausedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      setSubsOpen(false);
      pausedRef.current = false;
      resumeRef.current?.();
    } else {
      pauseClock();
    }
  };

  /** The side the user manages, as the engine names it. */
  const userSide = isHome ? ("home" as const) : ("away" as const);

  const doSub = (offId: string, onId: string) => {
    const state = matchRef.current;
    if (!state) return;
    if (manualSub(state, userSide, offId, onId, Math.max(1, clock))) {
      // A substitution is an event like any other, so it belongs in the feed the
      // moment it happens rather than at the next tick.
      setVisibleEvents(state.events.filter((e) => e.minute <= Math.max(1, clock)));
      setTouchlineRev((r) => r + 1);
    }
  };

  const doSwap = (aId: string, bId: string) => {
    const state = matchRef.current;
    if (!state) return;
    if (swapPositions(state, userSide, aId, bId)) setTouchlineRev((r) => r + 1);
  };

  /** Mentality/style changed from the touchline. Mirrored onto the team's saved
   * tactic exactly as the half-time talk does, so the change persists past the
   * final whistle rather than silently reverting. */
  const doTactic = (patch: { mentality?: Mentality; style?: Style }) => {
    const state = matchRef.current;
    if (!state) return;
    applyHalftimeTactic(state, userSide, patch);
    userTeam.tactic = { ...userTeam.tactic, ...patch };
    setTouchlineRev((r) => r + 1);
  };

  const live = phase === "first" || phase === "second";

  const { h, a } = result ? { h: result.homeGoals, a: result.awayGoals } : scoreFromEvents(visibleEvents);

  // ── Final-day scoreboard (§15.4) ──────────────────────────────────────────
  // Offered only on the last round of the league season — the day the table is
  // actually decided. Every other matchday keeps the screen clear.
  //
  // The other results are already in the save (gameloop plays them before
  // handing the day back), so this is a read, not a second simulation. The panel
  // is what times the reveal against your own clock.
  const isDecider = isFinalLeagueRound(game, fixture);
  // Assigned minutes are fixed for the whole match — they come off the fixture's
  // own seed, not off the clock — so this is built once rather than on each of
  // the ~90 re-renders a watched match causes.
  const otherScores = useMemo(
    () => (isDecider ? liveScoresFor(game, fixture) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDecider, fixture.id]
  );
  // Once your match is over the rest of the day is over too: hold the panel at
  // 90 so it settles on the real final table rather than freezing mid-reveal.
  const boardMinute = phase === "done" ? 90 : phase === "pre" ? 0 : clock;
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
              {phase === "pre"
                ? "KICK-OFF"
                : phase === "half"
                  ? "HALF-TIME"
                  : phase === "done"
                    ? shootoutLabel(fixture, game.userTeamId) ?? "FULL-TIME"
                    : paused
                      ? `${clock}' · PAUSED`
                      : `${clock}'`}
            </div>
          </div>
          <TeamSide crest={away} mine={away.id === game.userTeamId} align="right" />
        </div>
        {(phase === "first" || phase === "second" || phase === "half") && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {live && (
              <>
                {/* Stop the clock to work (v1.68). The engine holds at the next
                    segment boundary, so anything changed here is in force for
                    the football that follows. */}
                <button
                  onClick={togglePause}
                  title={paused ? "Resume the match" : "Stop the clock to make changes"}
                  className={`display rounded px-2.5 py-0.5 text-xs font-semibold ${
                    paused ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
                  }`}
                >
                  {paused ? "▶ RESUME" : "❚❚ PAUSE"}
                </button>
                <button
                  onClick={() => {
                    // Opening the board always stops the clock — reading your
                    // bench while the game runs on is how you miss the moment.
                    if (!paused) pauseClock();
                    setSubsOpen(true);
                  }}
                  title="Substitutions, shape and mentality"
                  className="display rounded border border-line px-2.5 py-0.5 text-xs font-semibold text-dim hover:text-ink"
                >
                  TOUCHLINE
                </button>
              </>
            )}
            {live &&
              [1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  title={`Play at ${s}× speed`}
                  className={`display rounded px-2 py-0.5 text-xs ${
                    speed === s ? "gold-grad font-bold text-black" : "border border-line text-faint hover:text-dim"
                  }`}
                >
                  {s}×
                </button>
              ))}
            {/* Bail out of the watch at any point — the rest is played out under
                the tactics currently in force and shown at once (v1.68). */}
            <button
              onClick={simulateToEnd}
              title={phase === "first" ? "Skip to half-time" : "Skip to full-time"}
              className="rounded border border-line px-2 py-0.5 text-xs text-faint hover:border-faint hover:text-dim"
            >
              {phase === "first" ? "Skip to half-time ▸▸" : "Simulate to the end ▸▸"}
            </button>
          </div>
        )}
        {/* The final-day toggle sits on its own row rather than among the speed
            controls: it is available before kick-off and after full time too, so
            it can't live inside the block that only renders while a match runs. */}
        {isDecider && (
          <div className="mt-3 flex items-center justify-center border-t border-line/60 pt-3">
            <button
              onClick={() => setScoreboard((v) => !v)}
              title="Follow the rest of the division as your match plays out"
              className={`display rounded px-3 py-1 text-xs font-semibold ${
                scoreboard ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
              }`}
            >
              {scoreboard ? "▾ HIDE OTHER SCORES" : "▸ FINAL DAY · OTHER SCORES & TABLE"}
            </button>
          </div>
        )}
        {/* A stopped clock with the board closed would otherwise sit there saying
            only "PAUSED" — say what the pause is FOR, and give the way back in. */}
        {live && paused && !subsOpen && (
          <p className="mt-2 text-center text-[11px] text-faint">
            Clock stopped —{" "}
            <button onClick={() => setSubsOpen(true)} className="text-gold underline-offset-2 hover:underline">
              open the touchline
            </button>{" "}
            to make changes, or resume play.
          </p>
        )}
      </div>

      {isDecider && scoreboard && (
        <FinalDayBoard
          fixture={fixture}
          scores={otherScores}
          minute={boardMinute}
          userHome={h}
          userAway={a}
        />
      )}

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
            {([["Mentality", MENTALITY_OPTIONS, halfTactic.mentality, (v: string) => setHalfTactic({ ...halfTactic, mentality: v as Mentality })],
               ["Style", STYLE_OPTIONS, halfTactic.style, (v: string) => setHalfTactic({ ...halfTactic, style: v as Style })]] as const).map(
              ([label, opts, cur, apply]) => (
                <div key={label}>
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{label}</div>
                  <div className="flex flex-wrap gap-1">
                    {opts.map((o) => (
                      <button
                        key={o}
                        onClick={() => apply(o)}
                        className={`display rounded px-2.5 py-1 text-xs font-semibold ${cur === o ? "gold-grad text-black" : "border border-line text-dim"}`}
                      >
                        {label === "Style" ? styleLabel(o) : o}
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

      {/* The touchline board (v1.68). Only reachable while the clock is stopped,
          which is the whole point — the engine has not played the next block yet,
          so a change made here still decides something. */}
      {subsOpen && matchRef.current && live && (
        <TouchlinePanel
          state={matchRef.current}
          side={userSide}
          minute={clock}
          rev={touchlineRev}
          tactic={userTeam.tactic}
          onSub={doSub}
          onSwap={doSwap}
          onTactic={doTactic}
          onClose={() => setSubsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Substitutions, shape and mentality from the touchline, in one modal.
 *
 * Everything is read straight out of the live `MatchState` rather than mirrored
 * into React state — the engine is the truth about who is on the pitch, and the
 * `rev` prop is what tells this to look again after a change lands. Selection is
 * a two-tap flow shared by both jobs: pick a man on the pitch, then either a
 * bench player to replace him or another starter to swap positions with.
 */
function TouchlinePanel({
  state,
  side,
  minute,
  rev,
  tactic,
  onSub,
  onSwap,
  onTactic,
  onClose,
}: {
  state: MatchState;
  side: "home" | "away";
  minute: number;
  rev: number;
  tactic: { mentality: Mentality; style: Style };
  onSub: (offId: string, onId: string) => void;
  onSwap: (aId: string, bId: string) => void;
  onTactic: (patch: { mentality?: Mentality; style?: Style }) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // `rev` is a render key, not something to read: it changes whenever the engine
  // state behind these lists has moved.
  void rev;

  const onPitch: OnPitch[] = onPitchFor(state, side);
  const bench = benchFor(state, side);
  const { used, max } = subsUsedFor(state, side);
  const subsLeft = max - used;
  const pickedOp = onPitch.find((o) => o.entry.player.id === picked) ?? null;

  const chooseStarter = (id: string) => {
    // Tapping a second starter is a position swap; tapping the same one clears.
    if (picked && picked !== id) {
      onSwap(picked, id);
      setPicked(null);
      return;
    }
    setPicked(picked === id ? null : id);
  };

  const chooseBench = (id: string) => {
    if (!picked || subsLeft <= 0) return;
    onSub(picked, id);
    setPicked(null);
  };

  return (
    <Modal title={`Touchline · ${minute}'`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[12px] leading-snug text-dim">
          {pickedOp ? (
            <>
              <b className="text-ink">{pickedOp.entry.player.name}</b> selected — tap a bench player to bring him on, or
              another starter to switch their positions.
            </>
          ) : (
            <>Tap a player on the pitch to start a substitution or a position switch.</>
          )}
        </p>

        {/* On the pitch. Fitness is the number that decides a substitution, so it
            is the number shown — live, off the same call the engine rates him by. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-faint">On the pitch</span>
            <span className="tnum text-[11px] text-dim">
              {subsLeft} of {max} subs left
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {onPitch.map((op) => {
              const p = op.entry.player;
              const on = picked === p.id;
              const fit = Math.round(liveFitness(state, side, op, Math.max(1, minute)));
              return (
                <button
                  key={p.id}
                  onClick={() => chooseStarter(p.id)}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left ${
                    on ? "border-gold-lo/70 bg-hover" : "border-line bg-raised hover:border-faint"
                  }`}
                >
                  <PosBadge pos={op.entry.slotPos} />
                  <span className={`min-w-0 flex-1 truncate text-sm ${on ? "text-gold" : "text-ink"}`}>{p.name}</span>
                  <span
                    className={`tnum shrink-0 text-[11px] ${fit < 60 ? "text-loss" : fit < 80 ? "text-dim" : "text-faint"}`}
                    title="Live condition"
                  >
                    {fit}%
                  </span>
                  <Ovr value={p.overall} size="sm" />
                </button>
              );
            })}
          </div>
        </div>

        {/* The bench. Disabled wholesale once the allocation is gone — a manager
            should see why he can't act, not find the taps silently dead. */}
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Bench</div>
          {bench.length === 0 ? (
            <p className="text-[11px] text-faint">Nobody left on the bench.</p>
          ) : (
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {bench.map((p) => {
                const usable = !!picked && subsLeft > 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => chooseBench(p.id)}
                    disabled={!usable}
                    title={
                      subsLeft <= 0
                        ? "No substitutions left"
                        : picked
                          ? `Bring ${p.name} on`
                          : "Pick the player coming off first"
                    }
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left ${
                      usable ? "border-line bg-raised hover:border-gold-lo/70 hover:bg-hover" : "border-line/50 bg-surface opacity-50"
                    }`}
                  >
                    <PosBadge pos={p.positions[0]} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                    <Ovr value={p.overall} size="sm" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mentality and style, the same two dials the half-time talk offers —
            available here because a game can turn long before the break. */}
        <div className="border-t border-line/60 pt-3">
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["Mentality", MENTALITY_OPTIONS, tactic.mentality, (v: string) => onTactic({ mentality: v as Mentality })],
                ["Style", STYLE_OPTIONS, tactic.style, (v: string) => onTactic({ style: v as Style })],
              ] as const
            ).map(([label, opts, cur, apply]) => (
              <div key={label}>
                <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{label}</div>
                <div className="flex flex-wrap gap-1">
                  {opts.map((o) => (
                    <button
                      key={o}
                      onClick={() => apply(o)}
                      className={`display rounded px-2.5 py-1 text-xs font-semibold ${
                        cur === o ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
                      }`}
                    >
                      {label === "Style" ? styleLabel(o) : o}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <GoldButton onClick={onClose}>BACK TO THE MATCH ▸</GoldButton>
        </div>
      </div>
    </Modal>
  );
}


/**
 * The final day, as a scoreboard (§15.4).
 *
 * Two halves of one question — what is happening elsewhere, and what that makes
 * the table. Both are read off `lib/livescores.ts` at the minute the manager's
 * own match has reached, so the panel can never show a table the save won't
 * settle on: at 90' it IS the real final table, because every other result was
 * already played before kick-off and the user's own line is his actual score.
 *
 * The reveal is what makes it worth watching. A match that has just scored is
 * flashed for a few minutes of match time, so a title changing hands is
 * something you SEE happen rather than something you notice later in the table.
 */
function FinalDayBoard({
  fixture,
  scores,
  minute,
  userHome,
  userAway,
}: {
  fixture: Fixture;
  scores: LiveScore[];
  minute: number;
  userHome: number;
  userAway: number;
}) {
  const game = useGame((s) => s.game)!;
  const viewTeam = useGame((s) => s.viewTeam);
  // The table moves only when a GOAL lands, not on every tick of the clock, so
  // it is keyed on the scorelines rather than on the minute — most of the 90
  // re-renders a watched match causes then cost nothing. The key is cheap: it
  // reads the same `scoreAt` the rows do.
  const scoreKey = scores.map((s) => {
    const { home, away } = scoreAt(s, minute);
    return `${home}-${away}`;
  }).join("|");
  const table = useMemo(
    () => liveTable(game, fixture, scores, minute, userHome, userAway),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixture.id, scores, scoreKey, userHome, userAway]
  );
  const league = game.leagues[fixture.competition];
  const userPos = table.findIndex((r) => r.teamId === game.userTeamId) + 1;

  return (
    <div className="mb-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="display text-sm font-semibold text-gold">
          FINAL DAY · {league?.name ?? "LEAGUE"}
        </span>
        <span className="text-[11px] text-faint">
          {minute >= 90 ? "Final table" : `As it stands · ${minute}'`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Other matches */}
        <Card className="max-h-72 overflow-y-auto p-2">
          {scores.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-faint">
              No other matches in the division today.
            </p>
          ) : (
            <div className="space-y-0.5">
              {scores.map((s) => (
                <OtherScoreRow key={s.fixtureId} s={s} minute={minute} />
              ))}
            </div>
          )}
        </Card>

        {/* Live table */}
        <Card className="max-h-72 overflow-y-auto p-0">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-raised">
              <tr className="border-b border-line/60 text-[10px] uppercase tracking-widest text-faint">
                <th className="py-1.5 pl-2 text-left">#</th>
                <th className="py-1.5 text-left">Club</th>
                <th className="py-1.5 text-center">P</th>
                <th className="py-1.5 text-center">GD</th>
                <th className="py-1.5 pr-2 text-right">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {table.map((r, i) => {
                const t = game.teams[r.teamId];
                const mine = r.teamId === game.userTeamId;
                const gd = r.gf - r.ga;
                return (
                  <tr
                    key={r.teamId}
                    onClick={() => viewTeam(r.teamId)}
                    className={`cursor-pointer hover:bg-hover ${mine ? "bg-gold-lo/[0.10]" : ""}`}
                  >
                    <td className={`py-1 pl-2 tnum ${i === 0 ? "font-bold text-gold" : "text-faint"}`}>{i + 1}</td>
                    <td className={`py-1 pr-1 ${mine ? "font-semibold text-gold" : ""}`}>
                      <span className="block truncate">{t?.name ?? "?"}</span>
                    </td>
                    <td className="py-1 text-center tnum text-dim">{r.played}</td>
                    <td className="py-1 text-center tnum text-dim">{gd > 0 ? `+${gd}` : gd}</td>
                    <td className="display py-1 pr-2 text-right tnum font-semibold">{r.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {userPos > 0 && (
        <p className="text-center text-[11px] text-faint">
          {minute >= 90 ? "You finish" : "On current scores you finish"}{" "}
          <span className="display font-semibold text-gold">
            {userPos}
            {ordinalSuffix(userPos)}
          </span>
          {userPos === 1 && " — champions."}
        </p>
      )}
    </div>
  );
}

/** One other match on the scoreboard, at the minute your own clock has reached. */
function OtherScoreRow({ s, minute }: { s: LiveScore; minute: number }) {
  const game = useGame((s2) => s2.game)!;
  const viewTeam = useGame((s2) => s2.viewTeam);
  const { home, away } = scoreAt(s, minute);
  // A goal in the last few minutes of match time is worth calling out — a title
  // changing hands should be visible as it happens, not just in the table below.
  const justScored = s.goals.some((g) => g.minute <= minute && minute - g.minute < 3);
  const ft = minute >= 90;
  const h = game.teams[s.homeId];
  const a = game.teams[s.awayId];

  return (
    <div
      className={`flex items-center gap-2 rounded px-2 py-1 text-[12px] ${
        justScored ? "bg-gold-lo/15" : "hover:bg-hover"
      }`}
    >
      <button
        onClick={() => viewTeam(s.homeId)}
        className="min-w-0 flex-1 truncate text-right hover:text-gold"
      >
        {h?.name ?? "?"}
      </button>
      <span className="display shrink-0 rounded bg-raised px-1.5 py-0.5 tnum font-semibold">
        {home}–{away}
      </span>
      <button
        onClick={() => viewTeam(s.awayId)}
        className="min-w-0 flex-1 truncate hover:text-gold"
      >
        {a?.name ?? "?"}
      </button>
      <span className={`shrink-0 text-[10px] tnum ${ft ? "text-faint" : "text-dim"}`}>
        {ft ? "FT" : `${minute}'`}
      </span>
    </div>
  );
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
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
                <button className="gold-text ml-1 font-semibold transition-[filter] hover:brightness-125" onClick={() => viewPlayer(best.p.id)}>
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

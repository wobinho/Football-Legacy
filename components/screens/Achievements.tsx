"use client";

// Achievements (§ Achievements, v1.45): the manager's own cabinet — two tabs.
//
//   • User Accolades — the manager's legacy & trophy cabinet (v1.7). Pure
//     read-outs of state.progress.accolades, kept fresh by the game loop, but
//     ranked by weight: a manager ID hero, then gold honour badges, then the
//     routine tallies compressed into strips.
//   • Achievements — the one-off milestones. Earned ones show gold and stamped
//     with the season won; locked ones show greyed with a progress bar where the
//     target is a number worth chasing.
//
// The screen reads state.progress only; all evaluation happens in the engine.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import {
  ACHIEVEMENT_DEFS,
  ACHIEVEMENT_GROUPS,
  ensureProgress,
  type AchievementDef,
} from "@/lib/achievements";
import type { PlayerBio, TransferRecord, UserAccolades } from "@/lib/types";
import { formatMoney } from "@/lib/value";
import { POS_LABELS } from "@/lib/config/positions";
import { Card, Crest, Flag, GhostButton, Ovr, PosBadge, Section, Tabs } from "../ui";

export default function AchievementsScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<"accolades" | "achievements" | "hallOfFame">("accolades");

  // `ensureProgress` mutates the state to backfill a blank block — safe here
  // because it only fills defaults and never changes an existing value, and the
  // block is guaranteed present on any v26+ save anyway.
  const progress = ensureProgress(game);
  const earnedCount = Object.keys(progress.earned).length;
  const hofCount = (game.hallOfFame ?? []).length;

  return (
    <div>
      <Tabs
        tabs={[
          { id: "accolades", label: "User Accolades" },
          { id: "achievements", label: `Achievements (${earnedCount}/${ACHIEVEMENT_DEFS.length})` },
          { id: "hallOfFame", label: `Hall of Fame${hofCount ? ` (${hofCount})` : ""}` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "accolades" ? (
        <AccoladesTab a={progress.accolades} />
      ) : tab === "achievements" ? (
        <AchievementsTab earned={progress.earned} a={progress.accolades} />
      ) : (
        <HallOfFameTab />
      )}
    </div>
  );
}

// ── Hall of Fame ───────────────────────────────────────────────────────────

/** The club's hand-curated honour roll. Players are enshrined from a player's
 * profile (Actions → Hall of Fame); this reads `game.hallOfFame` and renders
 * each, with a way to open the profile or remove the induction. Ids whose player
 * has since been pruned from a long save are skipped. */
function HallOfFameTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const toggleHallOfFame = useGame((s) => s.toggleHallOfFame);

  const inductees = (game.hallOfFame ?? [])
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p);

  if (inductees.length === 0) {
    return (
      <Section title="Hall of Fame">
        <Card className="p-6 text-center text-sm text-faint">
          Your club&apos;s Hall of Fame is empty. Open any player&apos;s profile and choose{" "}
          <span className="text-dim">Add to Hall of Fame</span> to enshrine your legends here.
        </Card>
      </Section>
    );
  }

  return (
    <Section title={`Hall of Fame (${inductees.length})`}>
      <Card className="divide-y divide-line/50">
        {inductees.map((p) => {
          const club = p.clubId ? game.teams[p.clubId] : null;
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => viewPlayer(p.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80"
                title="View profile"
              >
                <Ovr value={p.overall} />
                <div className="min-w-0 flex-1">
                  <div className="display flex items-center gap-2 font-semibold text-ink">
                    <Flag nat={p.nationality} size={16} />
                    <span className="truncate">{p.name}</span>
                    {p.retired && <span className="text-[10px] font-normal text-faint">RETIRED</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-faint">
                    <PosBadge pos={p.positions[0]} />
                    <span>{POS_LABELS[p.positions[0]]}</span>
                    <span className="text-faint">·</span>
                    <span>{p.age}y</span>
                    {club && (
                      <>
                        <span className="text-faint">·</span>
                        <span className="flex items-center gap-1.5">
                          <Crest colors={club.colors} short={club.short} size={16} />
                          {club.name}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
              <GhostButton onClick={() => toggleHallOfFame(p.id)} className="shrink-0 !py-1 text-[11px]">
                REMOVE
              </GhostButton>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

// ── User Accolades ─────────────────────────────────────────────────────────
//
// The manager's trophy cabinet (v1.7). The numbers are the same read-outs of
// state.progress.accolades as before; what changed is the WEIGHT given to each.
// Major honours (titles, cups, promotions, player awards) get gold badge cards
// with a watermark trophy behind the number — and a silhouetted, muted card when
// the count is still 0, so an unwon honour reads as an empty plinth rather than
// as a zero in a grid. Everything routine (match tallies, squad peaks, money)
// collapses into compact strips, which is what killed the old screen's dead
// space: twenty identical boxes gave a league title the same visual rank as
// "matches drawn".

/** A major honour: big gold number over a watermark emblem, muted when unwon. */
function HonourCard({
  label,
  value,
  emblem,
  sub,
}: {
  label: string;
  value: number;
  emblem: string;
  sub?: string;
}) {
  const won = value > 0;
  return (
    <Card
      className={`relative overflow-hidden p-4 ${
        won ? "border-gold-lo/50 bg-hover/30" : "border-line bg-surface"
      }`}
    >
      {/* Watermark emblem — sits behind the number, never competes with it. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-2 -top-1 select-none text-6xl leading-none ${
          won ? "opacity-[0.13]" : "opacity-[0.06] grayscale"
        }`}
      >
        {emblem}
      </div>
      <div className="relative">
        <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
        <div
          className={`display mt-1 text-4xl font-bold tnum ${won ? "gold-text" : "text-faint/60"}`}
        >
          {value}
        </div>
        <div className="mt-0.5 min-h-4 text-[11px] text-faint">{won ? sub : "Not yet won"}</div>
      </div>
    </Card>
  );
}

/** One cell in a compact stat strip. `tone` colours the figure — positive stats
 * green, negative red — so form reads without parsing the labels. */
function StripStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "gold";
}) {
  const color =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-rose-400"
        : tone === "gold"
          ? "gold-text"
          : "text-ink";
  return (
    <div className="border-l border-t border-line/50 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
      <div className={`display mt-0.5 text-xl font-bold tnum ${color}`}>{value}</div>
    </div>
  );
}

/** Wraps stat cells in one bordered strip with hairline separators between them.
 *
 * The separators are per-cell top+left borders rather than Tailwind's `divide-*`
 * helpers: `divide-x` on a WRAPPING grid skips only the very first child, so
 * every row after the first opens with a stray left edge. Negative margins on
 * the grid pull the outermost borders under the card's own, which leaves clean
 * interior hairlines at any column count. */
function StatStrip({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <Card className="overflow-hidden">
      <div className={`grid ${cols} -ml-px -mt-px`}>{children}</div>
    </Card>
  );
}

/** Win/draw/loss proportions as a single bar — the season's shape at a glance.
 * Renders a flat empty track before a ball has been kicked rather than three
 * zero-width slivers. */
function WinRateBar({ w, d, l }: { w: number; d: number; l: number }) {
  const total = w + d + l;
  if (total === 0) return <div className="h-2 w-full rounded-full bg-line" />;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
      <div className="bg-emerald-500" style={{ width: pct(w) }} title={`${w} won`} />
      <div className="bg-white/25" style={{ width: pct(d) }} title={`${d} drawn`} />
      <div className="bg-rose-500" style={{ width: pct(l) }} title={`${l} lost`} />
    </div>
  );
}

/** A record signing / sale. Shows the player behind the fee — rating, flag,
 * position and the season the deal was done — and clicks through to his profile
 * while he still exists in the save. Falls back to an empty plinth before the
 * club's first paid deal in that direction. */
function RecordTransferCard({
  title,
  rec,
  accent,
}: {
  title: string;
  rec?: TransferRecord;
  accent: "in" | "out";
}) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);

  if (!rec) {
    return (
      <Card className="p-4">
        <div className="text-[10px] uppercase tracking-widest text-faint">{title}</div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-lg text-faint/50">
            ?
          </div>
          <div className="text-[12px] text-faint">No major transfers yet</div>
        </div>
      </Card>
    );
  }

  // The id may dangle once a long save prunes the player — the card is built
  // from the snapshot either way, and only the click-through is gated.
  const exists = !!game.players[rec.playerId];
  const body = (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-raised">
        <Ovr value={rec.overall} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="display flex items-center gap-2 font-semibold text-ink">
          <Flag nat={rec.nationality} size={14} />
          <span className="truncate">{rec.name}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <PosBadge pos={rec.pos} />
          <span>Season {rec.season}</span>
        </div>
      </div>
      <div
        className={`display shrink-0 text-xl font-bold tnum ${
          accent === "in" ? "text-ink" : "text-emerald-400"
        }`}
      >
        {formatMoney(rec.fee)}
      </div>
    </div>
  );

  return (
    <Card className="border-gold-lo/30 p-4">
      <div className="text-[10px] uppercase tracking-widest text-faint">{title}</div>
      <div className="mt-2.5">
        {exists ? (
          <button
            onClick={() => viewPlayer(rec.playerId)}
            className="w-full text-left transition-opacity hover:opacity-80"
            title="View profile"
          >
            {body}
          </button>
        ) : (
          body
        )}
      </div>
    </Card>
  );
}

/** The manager ID badge: who you are, where you are, and the two numbers that
 * sum up a career — seasons served and silverware lifted. */
function ManagerHero({ a }: { a: UserAccolades }) {
  const game = useGame((s) => s.game)!;
  const club = game.teams[game.userTeamId];
  const league = club ? game.leagues[club.leagueId] : undefined;
  const trophies = a.leagueTitles + a.cupsWon;

  return (
    <Card className="relative mb-6 overflow-hidden border-gold-lo/40">
      {/* Soft gold wash from the left so the badge glows without a hard border. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background:
            "radial-gradient(120% 140% at 0% 0%, var(--color-gold-hi), transparent 60%)",
        }}
      />
      {/* The identity block takes a whole row on a phone (basis-full) and shares
          one with the tallies from `sm` up — at 390px the two side by side
          truncated the manager's name to make room for two single digits. */}
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-4 p-5">
        {club && <Crest colors={club.colors} short={club.short} size={52} />}
        <div className="min-w-0 flex-1 basis-[60%] sm:basis-auto">
          <div className="text-[10px] uppercase tracking-widest text-faint">Manager</div>
          <div className="display truncate text-2xl font-bold text-ink">
            {game.managerName || "Manager"}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-dim">
            {club ? club.name : "—"}
            {league && <span className="text-faint"> · {league.name}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-faint">Seasons</div>
            <div className="display text-3xl font-bold tnum text-ink">{a.seasonsPlayed}</div>
          </div>
          <div className="h-10 w-px bg-line" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-faint">Trophies</div>
            <div className="display text-3xl font-bold tnum gold-text">{trophies}</div>
          </div>
        </div>
      </div>
      <div className="gold-thread w-full" />
    </Card>
  );
}

function AccoladesTab({ a }: { a: UserAccolades }) {
  const winPct = a.matchesPlayed > 0 ? Math.round((a.matchesWon / a.matchesPlayed) * 100) : 0;
  const gd = a.goalsFor - a.goalsAgainst;
  const net = a.totalSpent - a.totalReceived;

  return (
    <div>
      <ManagerHero a={a} />

      <Section title="Major Honours">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HonourCard label="League Titles" value={a.leagueTitles} emblem="🏆" />
          <HonourCard label="Cups Won" value={a.cupsWon} emblem="🥇" />
          <HonourCard label="Promotions" value={a.promotions} emblem="⬆️" />
          <HonourCard
            label="Player Honours"
            value={a.playerAwards}
            emblem="⭐"
            sub="won by your players"
          />
        </div>
      </Section>

      <Section title="Match Record">
        <div className="space-y-3">
          <StatStrip cols="grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            <StripStat label="Played" value={String(a.matchesPlayed)} />
            <StripStat label="Won" value={String(a.matchesWon)} tone="good" />
            <StripStat label="Drawn" value={String(a.matchesDrawn)} />
            <StripStat label="Lost" value={String(a.matchesLost)} tone="bad" />
            <StripStat label="Goals For" value={String(a.goalsFor)} tone="good" />
            <StripStat label="Goals Against" value={String(a.goalsAgainst)} tone="bad" />
            <StripStat
              label="Goal Diff"
              value={`${gd >= 0 ? "+" : ""}${gd}`}
              tone={gd > 0 ? "good" : gd < 0 ? "bad" : "neutral"}
            />
          </StatStrip>
          <Card className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-widest text-faint">Win Rate</span>
              <span className="display text-lg font-bold tnum text-ink">{winPct}%</span>
            </div>
            <WinRateBar w={a.matchesWon} d={a.matchesDrawn} l={a.matchesLost} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-emerald-500" /> {a.matchesWon} won
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-white/25" /> {a.matchesDrawn} drawn
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-rose-500" /> {a.matchesLost} lost
              </span>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Squad Records">
        <div className="space-y-3">
          <StatStrip cols="grid-cols-2">
            <StripStat label="Peak 90+ Rated" value={String(a.peak90Overalls)} tone="gold" />
            <StripStat label="Peak 85+ Rated" value={String(a.peak85Overalls)} tone="gold" />
          </StatStrip>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RecordTransferCard title="Record Signing" rec={a.recordSigning} accent="in" />
            <RecordTransferCard title="Record Sale" rec={a.recordSale} accent="out" />
          </div>
        </div>
      </Section>

      <Section title="Financial Legacy">
        <StatStrip cols="grid-cols-2 lg:grid-cols-4">
          <StripStat label="Peak Budget" value={formatMoney(a.peakBudget)} tone="gold" />
          <StripStat label="Total Spent" value={formatMoney(a.totalSpent)} tone="bad" />
          <StripStat label="Total Received" value={formatMoney(a.totalReceived)} tone="good" />
          <StripStat
            label={net >= 0 ? "Net Spend" : "Net Profit"}
            value={formatMoney(Math.abs(net))}
            tone={net > 0 ? "bad" : net < 0 ? "good" : "neutral"}
          />
        </StatStrip>
      </Section>
    </div>
  );
}

// ── Achievements ───────────────────────────────────────────────────────────

/** Format a progress pair for the achievement bar. Money targets (≥£1M) render
 * as money; everything else as a plain ratio. */
function progressLabel(cur: number, target: number): string {
  const money = target >= 1_000_000;
  const shown = Math.min(cur, target);
  return money ? `${formatMoney(shown)} / ${formatMoney(target)}` : `${shown} / ${target}`;
}

function AchievementCard({
  def,
  earnedSeason,
  a,
  state,
}: {
  def: AchievementDef;
  earnedSeason?: number;
  a: UserAccolades;
  state: import("@/lib/types").GameState;
}) {
  const earned = earnedSeason !== undefined;
  const prog = !earned && def.progress ? def.progress(state, a) : null;
  const pct = prog && prog[1] > 0 ? Math.min(100, Math.round((prog[0] / prog[1]) * 100)) : 0;

  return (
    <Card className={`p-3.5 ${earned ? "border-gold-lo/50 bg-hover/40" : ""}`}>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xl ${
            earned ? "bg-gold/15" : "bg-raised grayscale opacity-50"
          }`}
        >
          {def.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`display truncate text-sm font-semibold ${earned ? "text-ink" : "text-dim"}`}>
              {def.title}
            </span>
            {earned ? (
              <span className="display shrink-0 text-[10px] font-semibold uppercase tracking-widest text-gold">
                ✓ S{earnedSeason}
              </span>
            ) : (
              <span className="shrink-0 text-[10px] uppercase tracking-widest text-faint">Locked</span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-faint">{def.blurb}</div>
          {prog && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="gold-grad h-full rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-right text-[10px] tnum text-faint">
                {progressLabel(prog[0], prog[1])}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function AchievementsTab({
  earned,
  a,
}: {
  earned: Record<string, { id: string; season: number }>;
  a: UserAccolades;
}) {
  const game = useGame((s) => s.game)!;
  // Group the catalogue for display; within a group, earned achievements float
  // to the top, then locked ones ordered by how close they are to unlocking.
  const grouped = useMemo(() => {
    return ACHIEVEMENT_GROUPS.map((g) => {
      const defs = ACHIEVEMENT_DEFS.filter((d) => d.group === g.id).sort((x, y) => {
        const ex = earned[x.id] ? 1 : 0;
        const ey = earned[y.id] ? 1 : 0;
        if (ex !== ey) return ey - ex;
        return 0;
      });
      return { ...g, defs };
    }).filter((g) => g.defs.length > 0);
  }, [earned]);

  return (
    <div className="space-y-6">
      {grouped.map((g) => (
        <Section key={g.id} title={g.label}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.defs.map((def) => (
              <AchievementCard
                key={def.id}
                def={def}
                earnedSeason={earned[def.id]?.season}
                a={a}
                state={game}
              />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

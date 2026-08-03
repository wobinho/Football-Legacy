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
import { careerSummary } from "@/lib/recordbook";
import type { PlayerBio, TransferRecord, UserAccolades } from "@/lib/types";
import { formatMoney } from "@/lib/value";
import { POS_LABELS } from "@/lib/config/positions";
import { Card, ConfirmButton, Crest, Flag, Ovr, PosBadge, Section, Tabs } from "../ui";

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

/** One number in the inductee's career strip. */
function CareerStat({ label, value, gold = false }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded border border-line/60 bg-raised/50 px-2.5 py-1.5">
      <div className="text-[9.5px] uppercase tracking-widest text-faint">{label}</div>
      <div className={`display mt-0.5 text-base font-bold tnum ${gold ? "gold-text" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * One enshrined legend (v1.86).
 *
 * The point of the Hall of Fame is remembering a player, so the row expands into
 * the case for him: who he was, and what he actually did in the shirt. The
 * summary is `careerSummary` from `lib/recordbook.ts` — the same rollup over the
 * save's stored career rows, never re-totalled here — and the header still opens
 * the full profile modal, which is the deeper read this is a preview of.
 *
 * Collapsed by default: a cabinet of twenty legends should open as a list of
 * names, and unfold only the one being remembered.
 */
function Inductee({ p }: { p: PlayerBio }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const toggleHallOfFame = useGame((s) => s.toggleHallOfFame);
  const [open, setOpen] = useState(false);

  const sum = useMemo(() => careerSummary(game, p.id), [game, p.id]);
  const club = p.clubId ? game.teams[p.clubId] : null;
  const perGame = sum.apps > 0 ? ((sum.goals + sum.assists) / sum.apps).toFixed(2) : "—";
  const isGk = p.positions[0] === "GK";

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 rounded px-1 py-1 text-[10px] text-faint transition-colors hover:text-ink"
          title={open ? "Collapse" : "Expand career"}
        >
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        </button>
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
              <span>·</span>
              <span>{p.age}y</span>
              {club && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1.5">
                    <Crest colors={club.colors} short={club.short} size={16} />
                    {club.name}
                  </span>
                </>
              )}
            </div>
          </div>
        </button>
        {/* Two-step, like every other destructive action in the game (v1.87).
            An induction is a deliberate curatorial act and REMOVE sat directly
            beside the row's own expand/profile buttons, so a misclick quietly
            undid it with nothing to undo it with. */}
        <ConfirmButton
          label="REMOVE"
          confirmLabel="REMOVE?"
          tone="danger"
          onConfirm={() => toggleHallOfFame(p.id)}
          className="shrink-0 !px-2.5 !py-1 !text-[11px] !font-normal"
        />
      </div>

      {open && (
        <div className="border-t border-line/40 bg-raised/20 px-4 py-3">
          {sum.apps === 0 ? (
            <div className="text-[12px] text-faint">
              No completed season yet — his record is written when the season ends.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <CareerStat label="Seasons" value={String(sum.seasons)} />
                <CareerStat label="Apps" value={String(sum.apps)} />
                {isGk ? (
                  <CareerStat label="Clean Sheets" value={String(sum.cleanSheets)} gold />
                ) : (
                  <CareerStat label="Goals" value={String(sum.goals)} gold />
                )}
                <CareerStat label="Assists" value={String(sum.assists)} />
                <CareerStat
                  label="Avg Rating"
                  value={sum.avgRating > 0 ? sum.avgRating.toFixed(2) : "—"}
                  gold={sum.avgRating >= 7.2}
                />
                <CareerStat label="Peak OVR" value={String(sum.peakOverall)} gold />
              </div>

              <div className="mt-3 space-y-1.5 text-[12px] leading-snug text-dim">
                {sum.span && (
                  <div>
                    <span className="text-faint">Career </span>
                    Season {sum.span.from} – {sum.span.to}
                    {!isGk && sum.apps > 0 && (
                      <>
                        <span className="text-faint"> · </span>
                        {perGame} goal contributions per appearance
                      </>
                    )}
                  </div>
                )}
                {sum.clubs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-faint">Clubs</span>
                    {sum.clubs.map((c, i) => {
                      const t = c.id ? game.teams[c.id] : undefined;
                      return (
                        <span key={`${c.name}-${i}`} className="flex items-center gap-1.5">
                          {t && <Crest colors={t.colors} short={t.short} size={14} />}
                          {c.name}
                        </span>
                      );
                    })}
                  </div>
                )}
                {sum.awards.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-faint">Honours</span>
                    {sum.awards.map((aw) => (
                      <span
                        key={aw.name}
                        className="rounded border border-gold-lo/40 bg-gold-lo/10 px-1.5 py-0.5 text-[10.5px] text-gold"
                      >
                        {aw.name}
                        {aw.count > 1 && <span className="tnum"> ×{aw.count}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The club's hand-curated honour roll. Players are enshrined from a player's
 * profile (Actions → Hall of Fame); this reads `game.hallOfFame` and renders
 * each, with a way to open the profile or remove the induction. Ids whose player
 * has since been pruned from a long save are skipped. */
function HallOfFameTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);

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
      <p className="mb-2 text-[12px] leading-relaxed text-dim">
        The players this club remembers. Expand one for his career in your colours; open him for the
        full profile.
      </p>
      <Card className="divide-y divide-line/50">
        {inductees.map((p) => (
          <Inductee key={p.id} p={p} />
        ))}
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

/** The fill for a progress bar, by how close the chase is (v1.86).
 *
 * Colour carries the same information the number does, so a wall of locked cards
 * sorts itself at a glance: what is nearly done glows gold, what has barely
 * started reads cold. The gold band is deliberately the last quarter only —
 * gold is the design language's "the important thing" accent, and spending it on
 * a bar at 30% would make every card shout. */
function progressFill(pct: number): string {
  if (pct >= 75) return "gold-grad";
  if (pct >= 25) return "bg-amber-500/80";
  return "bg-rose-500/70";
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
    // Locked cards recede (dimmer surface, no accent) so the earned ones and the
    // ones being actively chased are what the eye lands on first. An earned card
    // gets the gold border plus a soft gold bloom — the reward for finishing it.
    <Card
      className={`relative overflow-hidden p-3.5 ${
        earned ? "border-gold-lo/60 bg-hover/50 shadow-[0_0_18px_-6px_var(--color-gold-lo)]" : "bg-surface/60"
      }`}
    >
      {earned && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            background: "radial-gradient(110% 130% at 0% 0%, var(--color-gold-hi), transparent 62%)",
          }}
        />
      )}
      {/* Cards with no progress bar centre their contents instead of leaving a
          gap where the bar would be, so a mixed row still reads as one row. */}
      <div className={`relative flex gap-3 ${prog ? "items-start" : "items-center"}`}>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xl ${
            earned ? "bg-gold/15" : "bg-raised/80 opacity-60 grayscale"
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
              // A padlock rather than the word "LOCKED": the old grey-on-grey
              // label was both the lowest-contrast text on the screen and the
              // least informative thing on the card.
              <span className="shrink-0 text-[12px] leading-none text-dim" title="Locked" aria-label="Locked">
                🔒
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-dim">{def.blurb}</div>
          {prog && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.09]">
                <div className={`${progressFill(pct)} h-full rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] tnum text-faint">{pct}%</span>
                <span className="text-[11.5px] font-medium tnum text-dim">
                  {progressLabel(prog[0], prog[1])}
                </span>
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
  // to the top, then locked ones ordered by how close they are to unlocking —
  // which is what makes the redesigned bar colours worth scanning, since the
  // nearly-there cards cluster.
  const grouped = useMemo(() => {
    const nearness = (d: AchievementDef) => {
      if (!d.progress) return -1;
      const [cur, target] = d.progress(game, a);
      return target > 0 ? Math.min(1, cur / target) : -1;
    };
    return ACHIEVEMENT_GROUPS.map((g) => {
      const defs = ACHIEVEMENT_DEFS.filter((d) => d.group === g.id).sort((x, y) => {
        const ex = earned[x.id] ? 1 : 0;
        const ey = earned[y.id] ? 1 : 0;
        if (ex !== ey) return ey - ex;
        if (ex === 1) return 0;
        return nearness(y) - nearness(x);
      });
      return { ...g, defs };
    }).filter((g) => g.defs.length > 0);
    // `game` is mutated in place and identified by `rev`, which the screen
    // already subscribes to — the parent re-renders and this recomputes with it.
  }, [earned, game, a]);

  return (
    // Categories are separated by a full row of breathing room rather than the
    // stock gap, so a header always reads as belonging to the cards below it.
    <div className="space-y-10">
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

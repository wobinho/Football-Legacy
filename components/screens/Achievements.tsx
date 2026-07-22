"use client";

// Achievements (§ Achievements, v1.45): the manager's own cabinet — two tabs.
//
//   • User Accolades — the passively-recorded career numbers (seasons played,
//     matches, peak 90-overalls held, highest budget, biggest signing…). Pure
//     read-outs of state.progress.accolades, kept fresh by the game loop.
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
import type { UserAccolades } from "@/lib/types";
import { formatMoney } from "@/lib/value";
import { Card, Section, Tabs } from "../ui";

export default function AchievementsScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<"accolades" | "achievements">("accolades");

  // `ensureProgress` mutates the state to backfill a blank block — safe here
  // because it only fills defaults and never changes an existing value, and the
  // block is guaranteed present on any v26+ save anyway.
  const progress = ensureProgress(game);
  const earnedCount = Object.keys(progress.earned).length;

  return (
    <div>
      <Tabs
        tabs={[
          { id: "accolades", label: "User Accolades" },
          { id: "achievements", label: `Achievements (${earnedCount}/${ACHIEVEMENT_DEFS.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "accolades" ? (
        <AccoladesTab a={progress.accolades} />
      ) : (
        <AchievementsTab earned={progress.earned} a={progress.accolades} />
      )}
    </div>
  );
}

// ── User Accolades ─────────────────────────────────────────────────────────

/** One stat tile. `hero` styling is reserved for the headline lifetime numbers. */
function StatTile({
  label,
  value,
  sub,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
}) {
  return (
    <Card className={`p-4 ${hero ? "border-gold-lo/40" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
      <div className={`display mt-1 font-bold tnum ${hero ? "gold-text text-3xl" : "text-2xl"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </Card>
  );
}

function AccoladesTab({ a }: { a: UserAccolades }) {
  const winPct =
    a.matchesPlayed > 0 ? Math.round((a.matchesWon / a.matchesPlayed) * 100) : 0;
  return (
    <div className="space-y-6">
      <Section title="Career">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Seasons Played" value={String(a.seasonsPlayed)} hero />
          <StatTile label="League Titles" value={String(a.leagueTitles)} hero />
          <StatTile label="Cups Won" value={String(a.cupsWon)} hero />
          <StatTile label="Promotions" value={String(a.promotions)} hero />
        </div>
      </Section>

      <Section title="Matches">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Played" value={String(a.matchesPlayed)} />
          <StatTile label="Won" value={String(a.matchesWon)} sub={`${winPct}% win rate`} />
          <StatTile label="Drawn" value={String(a.matchesDrawn)} />
          <StatTile label="Lost" value={String(a.matchesLost)} />
          <StatTile label="Goals For" value={String(a.goalsFor)} />
          <StatTile label="Goals Against" value={String(a.goalsAgainst)} />
          <StatTile
            label="Goal Difference"
            value={`${a.goalsFor - a.goalsAgainst >= 0 ? "+" : ""}${a.goalsFor - a.goalsAgainst}`}
          />
        </div>
      </Section>

      <Section title="Squad Quality">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Peak 90+ Rated" value={String(a.peak90Overalls)} sub="held at once" />
          <StatTile label="Peak 85+ Rated" value={String(a.peak85Overalls)} sub="held at once" />
          <StatTile label="Player Honours" value={String(a.playerAwards)} sub="won by your players" />
        </div>
      </Section>

      <Section title="Finances & Market">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Peak Budget" value={formatMoney(a.peakBudget)} hero />
          <StatTile label="Biggest Signing" value={formatMoney(a.biggestSigningFee)} />
          <StatTile label="Biggest Sale" value={formatMoney(a.biggestSaleFee)} />
          <StatTile label="Total Spent" value={formatMoney(a.totalSpent)} />
          <StatTile label="Total Received" value={formatMoney(a.totalReceived)} />
          <StatTile
            label="Net Spend"
            value={formatMoney(a.totalSpent - a.totalReceived)}
            sub={a.totalSpent - a.totalReceived >= 0 ? "spent" : "profit"}
          />
        </div>
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

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
  ACHIEVEMENT_TIERS,
  achievementTier,
  ensureProgress,
  type AchievementDef,
  type TierState,
} from "@/lib/achievements";
import { BADGE_COLOR } from "@/lib/config/facilities";
import { ACCOLADE_META } from "@/lib/accolades";
import {
  careerSummary,
  clubHonours,
  userPlayerHonours,
  type PlayerHonourRow,
  cupHistories,
  leagueHistories,
  type CupHistory,
  type LeagueHistory,
} from "@/lib/recordbook";
import type { AccoladeType, BadgeTier, PlayerBio, TransferRecord, UserAccolades } from "@/lib/types";
import { formatMoney } from "@/lib/value";
import { POS_LABELS } from "@/lib/config/positions";
import { Card, ConfirmButton, CountryFlag, Crest, Flag, Modal, Ovr, PosBadge, Section, Tabs } from "../ui";

export default function AchievementsScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<"accolades" | "achievements" | "hallOfFame" | "history">("accolades");

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
          { id: "history", label: "History" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "accolades" ? (
        <AccoladesTab a={progress.accolades} />
      ) : tab === "achievements" ? (
        <AchievementsTab earned={progress.earned} a={progress.accolades} />
      ) : tab === "hallOfFame" ? (
        <HallOfFameTab />
      ) : (
        <HistoryTab />
      )}
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────────────
//
// The world's record, not the manager's (v1.91). Everything here is derived on
// demand from `state.recordBook.seasons` by `leagueHistories` / `cupHistories` —
// the same stored rows the season review renders, grouped the other way — so
// this view and that one can never disagree.
//
// A league season is its podium (champion + top four), because that is what a
// league is remembered by: who won it and who else got into Europe. A cup season
// is its two finalists, because a cup has no table.

/** A club chip — badge plus name, clickable through to the team card when the
 * club still exists in the world. Crests are cosmetic and looked up live. */
function ClubLine({
  teamId,
  teamName,
  bold = false,
  size = 16,
}: {
  teamId: string;
  teamName: string;
  bold?: boolean;
  size?: number;
}) {
  const game = useGame((s) => s.game)!;
  const openTeam = useGame((s) => s.viewTeam);
  const t = game.teams[teamId];
  const body = (
    <span className="flex min-w-0 items-center gap-1.5">
      {t && <Crest team={t} size={size} />}
      <span className={`truncate ${bold ? "font-semibold text-ink" : "text-dim"}`}>{teamName}</span>
    </span>
  );
  if (!t) return body;
  return (
    <button
      onClick={() => openTeam(teamId)}
      className="flex min-w-0 items-center text-left transition-colors hover:text-gold"
      title={`View ${teamName}`}
    >
      {body}
    </button>
  );
}

/** One division's season-by-season podium. Collapsed to the most recent seasons
 * with a "show all" — a fifty-season save would otherwise render a wall per
 * league, and there can be dozens of leagues. */
function LeagueHistoryCard({ h }: { h: LeagueHistory }) {
  const game = useGame((s) => s.game)!;
  const [expanded, setExpanded] = useState(false);
  const INITIAL = 5;
  const shown = expanded ? h.seasons : h.seasons.slice(0, INITIAL);
  const more = h.seasons.length - shown.length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 bg-raised/40 px-3 py-2">
        <span className="display flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <span className="truncate">{h.name}</span>
          {h.own && (
            <span className="shrink-0 rounded-sm border border-gold-lo/40 bg-gold-lo/10 px-1.5 py-px text-[9.5px] uppercase tracking-widest text-gold">
              Your pyramid
            </span>
          )}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-widest text-faint">
          Tier {h.tier} · {h.seasons.length} {h.seasons.length === 1 ? "season" : "seasons"}
        </span>
      </div>

      <div className="divide-y divide-line/40">
        {shown.map((s) => (
          <div key={s.season} className="px-3 py-2.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="display text-[13px] font-bold gold-text">{s.yearLabel}</span>
              <span className="text-[10px] uppercase tracking-widest text-faint">Top {s.top.length}</span>
            </div>
            <div className="space-y-1">
              {s.top.map((p) => {
                const mine = p.teamId === game.userTeamId;
                return (
                  <div
                    key={p.teamId}
                    className={`flex items-center gap-2 text-[12.5px] ${mine ? "text-gold" : ""}`}
                  >
                    <span
                      className={`display flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold tnum ${
                        p.position === 1 ? "gold-grad text-black" : "bg-raised text-faint"
                      }`}
                      style={{ height: 18, width: 18 }}
                    >
                      {p.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <ClubLine teamId={p.teamId} teamName={p.teamName} bold={p.position === 1} />
                    </span>
                    <span className="shrink-0 tnum text-[11px] text-faint">
                      {p.points} pts
                      <span className="ml-1.5">
                        {p.goalDifference > 0 ? "+" : ""}
                        {p.goalDifference}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {more > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full border-t border-line/50 py-1.5 text-[11px] text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          Show {more} earlier {more === 1 ? "season" : "seasons"}
        </button>
      )}
      {expanded && h.seasons.length > INITIAL && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full border-t border-line/50 py-1.5 text-[11px] text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          Show fewer
        </button>
      )}
    </Card>
  );
}

/** One cup's roll of finals: winner and, where the save recorded it, the club
 * they beat. Pre-v1.91 summaries stored only the winner, so the runner-up line
 * simply doesn't render for those seasons rather than showing a dash. */
function CupHistoryCard({ h }: { h: CupHistory }) {
  const [expanded, setExpanded] = useState(false);
  const INITIAL = 6;
  const shown = expanded ? h.seasons : h.seasons.slice(0, INITIAL);
  const more = h.seasons.length - shown.length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 bg-raised/40 px-3 py-2">
        <span className="display truncate text-sm font-semibold text-ink">
          {h.kind === "cup" ? "🏅" : "⭐"} {h.name}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-widest text-faint">
          {h.seasons.length} {h.seasons.length === 1 ? "final" : "finals"}
        </span>
      </div>
      <div className="divide-y divide-line/40">
        {shown.map((s) => (
          <div key={s.season} className="flex items-center gap-3 px-3 py-2">
            <span className="display w-14 shrink-0 text-[12px] font-bold tnum gold-text">{s.yearLabel}</span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
                <span className="shrink-0 text-[11px] text-gold">🏆</span>
                <ClubLine teamId={s.winner.teamId} teamName={s.winner.teamName} bold />
              </div>
              {s.runnerUp && (
                <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
                  <span className="shrink-0 text-[10px] text-faint" title="Runner-up">
                    🥈
                  </span>
                  <ClubLine teamId={s.runnerUp.teamId} teamName={s.runnerUp.teamName} size={14} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {more > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full border-t border-line/50 py-1.5 text-[11px] text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          Show {more} earlier {more === 1 ? "final" : "finals"}
        </button>
      )}
    </Card>
  );
}

/**
 * The world's honours board (v1.91) — every league's champions and podium,
 * grouped by nation then division, plus the finals of every cup.
 *
 * Nations are collapsible and only the manager's own opens by default: a full
 * world holds dozens of divisions, and a page that renders them all at once is a
 * scroll rather than a reference.
 */
function HistoryTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);

  const leagues = useMemo(() => leagueHistories(game), [game]);
  const cups = useMemo(() => cupHistories(game), [game]);

  // Group by country, preserving the order `leagueHistories` already sorted into
  // (own pyramid, then home nation, then the rest alphabetically).
  const byCountry = useMemo(() => {
    const groups: { country: string; own: boolean; leagues: LeagueHistory[] }[] = [];
    for (const h of leagues) {
      const g = groups.find((x) => x.country === h.country);
      if (g) {
        g.leagues.push(h);
        g.own = g.own || h.own;
      } else groups.push({ country: h.country, own: h.own, leagues: [h] });
    }
    return groups;
  }, [leagues]);

  const [openCountries, setOpenCountries] = useState<Record<string, boolean>>({});
  const isOpen = (g: { country: string; own: boolean }) => openCountries[g.country] ?? g.own;
  const toggle = (country: string, current: boolean) =>
    setOpenCountries((prev) => ({ ...prev, [country]: !current }));

  if (!leagues.length && !cups.length) {
    return (
      <Section title="History">
        <Card className="p-6 text-center text-sm text-faint">
          No history yet. Finish a season and the world&apos;s champions are recorded here.
        </Card>
      </Section>
    );
  }

  return (
    <div>
      {cups.length > 0 && (
        <Section title="Cups" right={<span className="text-xs text-faint">Winner and runner-up</span>}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {cups.map((c) => (
              <CupHistoryCard key={c.id} h={c} />
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Leagues"
        right={<span className="text-xs text-faint">Champions and the top four</span>}
      >
        <div className="space-y-4">
          {byCountry.map((g) => {
            const open = isOpen(g);
            const divisions = g.leagues.length;
            return (
              <div key={g.country}>
                <button
                  onClick={() => toggle(g.country, open)}
                  aria-expanded={open}
                  className="mb-2 flex w-full items-center gap-2 rounded-md border border-line bg-raised/40 px-3 py-2 text-left transition-colors hover:bg-hover"
                >
                  <span className={`shrink-0 text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}>
                    ▶
                  </span>
                  <CountryFlag country={g.country} size={16} />
                  <span className="display min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {g.country}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-widest text-faint">
                    {divisions} {divisions === 1 ? "division" : "divisions"}
                  </span>
                </button>
                {open && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {g.leagues.map((h) => (
                      <LeagueHistoryCard key={h.id} h={h} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
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
                    <Crest team={club} size={16} />
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
                          {t && <Crest team={t} size={14} />}
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
  onOpen,
}: {
  label: string;
  value: number;
  emblem: string;
  sub?: string;
  /** Opens the breakdown behind the tally (v1.91). A card with nothing to show
   * — an honour not yet won — is rendered as a plain plinth rather than as a
   * button that opens an empty list. */
  onOpen?: () => void;
}) {
  const won = value > 0;
  const interactive = won && !!onOpen;
  const body = (
    <>
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
        <div className="mt-0.5 min-h-4 text-[11px] text-faint">
          {won ? (
            interactive ? (
              <span className="transition-colors group-hover:text-gold">
                {sub ? `${sub} · ` : ""}View
                <span className="ml-0.5 inline-block transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            ) : (
              sub
            )
          ) : (
            "Not yet won"
          )}
        </div>
      </div>
    </>
  );

  if (!interactive) {
    return (
      <Card className={`relative overflow-hidden p-4 ${won ? "border-gold-lo/50 bg-hover/30" : "border-line bg-surface"}`}>
        {body}
      </Card>
    );
  }
  return (
    <button
      onClick={onOpen}
      aria-label={`${label}: show the ${value} won`}
      className="group relative overflow-hidden rounded-lg border border-gold-lo/50 bg-hover/30 p-4 text-left transition-colors hover:border-gold-lo hover:bg-hover/60"
    >
      {body}
    </button>
  );
}

/** The seasons behind one TROPHY tally (v1.91) — the rows the count was
 * accumulated from, most recent first, naming the competition.
 *
 * Player honours used to share this modal and now have their own
 * (`PlayerHonoursModal`): a trophy list is genuinely one flat chronology, where
 * a player's awards are several different awards that happen to share a count.
 */
function HonourDetailModal({
  title,
  trophies,
  onClose,
}: {
  title: string;
  trophies: ReturnType<typeof clubHonours>;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {trophies.length === 0 ? (
        <div className="text-sm text-faint">Nothing won yet.</div>
      ) : (
        <Card className="divide-y divide-line/50">
          {trophies.map((h) => (
            <div key={`${h.season}:${h.competition}`} className="flex items-center gap-3 px-3 py-2.5">
              <span className="display w-16 shrink-0 text-[12px] font-bold tnum gold-text">{h.yearLabel}</span>
              <span aria-hidden className="shrink-0 text-gold">
                {h.kind === "league" ? "🏆" : h.kind === "cup" ? "🏅" : "⭐"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{h.competition}</span>
            </div>
          ))}
        </Card>
      )}
    </Modal>
  );
}

/**
 * The player-honours board (v2.0) — grouped by AWARD, not by season.
 *
 * It was one flat chronological list in the narrow modal every other tally
 * uses, which is the wrong shape for this particular tally and only this one.
 * "Player Honours" is not one honour counted many times: it is nine different
 * awards — a Golden Boot, a Legacy Team of the Year, a Golden Glove — sharing a
 * single number on the card. Chronologically interleaved, the one question a
 * manager actually has ("who of mine has ever made the Team of the Year?")
 * could only be answered by reading every row and mentally sorting it.
 *
 * So: one section per award type, each with its own emblem, its blurb (which
 * says what winning it MEANS, and had nowhere to appear before) and its own
 * count, laid out in columns at `xl` width. Within a section the winners are
 * grouped BY PLAYER rather than listed per season — a striker who won three
 * Golden Boots is one line reading "×3" with his years beside it, which is the
 * form a cabinet takes and which the flat list turned into three separate rows
 * that never sat together.
 *
 * `ACCOLADE_ORDER` fixes the section order by prestige rather than letting it
 * fall out of whatever was won first, so the board reads the same way in every
 * save — and an award never won is still drawn, as an empty plinth, exactly as
 * `HonourCard` draws an unwon honour.
 */
const ACCOLADE_ORDER: AccoladeType[] = [
  "legacyPlayerOfSeason",
  "legacyTeamOfSeason",
  "playerOfSeason",
  "youngPlayerOfSeason",
  "teamOfSeason",
  "goldenBoot",
  "goldenPlaymaker",
  "goldenGlove",
  "goldenWall",
];

function PlayerHonoursModal({
  honours,
  onClose,
}: {
  honours: PlayerHonourRow[];
  onClose: () => void;
}) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);

  // Group twice: by award, then by the player who won it. The second grouping
  // is what turns "Golden Boot 2031, Golden Boot 2032" into one man's record.
  const sections = useMemo(() => {
    const byType = new Map<AccoladeType, PlayerHonourRow[]>();
    for (const h of honours) {
      const list = byType.get(h.type);
      if (list) list.push(h);
      else byType.set(h.type, [h]);
    }
    return ACCOLADE_ORDER.map((type) => {
      const rows = byType.get(type) ?? [];
      const byPlayer = new Map<string, { name: string; years: string[]; leagueName?: string }>();
      for (const h of rows) {
        const entry = byPlayer.get(h.playerId);
        if (entry) entry.years.push(h.yearLabel);
        else byPlayer.set(h.playerId, { name: h.playerName, years: [h.yearLabel], leagueName: h.leagueName });
      }
      const winners = [...byPlayer.entries()]
        .map(([playerId, w]) => ({ playerId, ...w }))
        // Most-decorated first, then the most recent — a three-time winner is
        // the headline of his own section.
        .sort((a, b) => b.years.length - a.years.length || b.years[0].localeCompare(a.years[0]));
      return { type, meta: ACCOLADE_META[type], count: rows.length, winners };
    });
  }, [honours]);

  const total = honours.length;

  return (
    <Modal title="Player Honours" onClose={onClose} size="xl">
      {total === 0 ? (
        <div className="text-sm text-faint">
          None of your players has won an individual award yet.
        </div>
      ) : (
        <>
          <p className="mb-3 text-[11px] leading-snug text-faint">
            <span className="display gold-text tnum text-sm font-bold">{total}</span> individual{" "}
            {total === 1 ? "award" : "awards"} won by players of your club, grouped by honour. A player who has won
            one several times keeps a single line — the years are beside his name.
          </p>
          {/* Columns rather than one long scroll: nine sections stacked is a
              page you page through, where side by side the whole cabinet is one
              glance. `break-inside-avoid` keeps a section from being split
              across the column break, which would separate a heading from the
              winners under it. */}
          <div className="gap-3 md:columns-2 xl:columns-3">
            {sections.map((s) => (
              <div
                key={s.type}
                className={`mb-3 break-inside-avoid rounded-md border bg-surface p-3 ${
                  s.count > 0 ? "border-gold-lo/40" : "border-line"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span aria-hidden className={`text-lg leading-none ${s.count > 0 ? "" : "opacity-30 grayscale"}`}>
                    {s.meta.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="display truncate text-[13px] font-semibold text-ink">{s.meta.title}</div>
                    <div className="text-[10px] leading-snug text-faint">{s.meta.blurb}</div>
                  </div>
                  <span
                    className={`display shrink-0 tnum text-lg font-bold ${s.count > 0 ? "gold-text" : "text-faint"}`}
                  >
                    {s.count}
                  </span>
                </div>
                {s.winners.length > 0 && <div className="gold-thread my-2" />}
                {s.winners.length === 0 ? (
                  <div className="mt-2 text-[11px] text-faint">Not yet won.</div>
                ) : (
                  <ul className="space-y-1">
                    {s.winners.map((w) => {
                      // A long save prunes retirees, so the click-through is
                      // gated on the player still existing rather than assumed.
                      // The same lookup is where his flag and position come from
                      // (v2.1) — `PlayerHonourRow` records who won and when, not
                      // who the man was, and reading them here means a pruned
                      // winner simply shows neither rather than a guess.
                      const player = game.players[w.playerId];
                      const exists = !!player;
                      const inner = (
                        <>
                          {player && <PosBadge pos={player.positions[0]} />}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              {player && <Flag nat={player.nationality} size={11} />}
                              <span className="min-w-0 truncate text-[12px] font-semibold text-ink">{w.name}</span>
                            </span>
                            <span className="block truncate text-[10px] tnum text-faint">
                              {w.years.join(" · ")}
                            </span>
                          </span>
                          {w.years.length > 1 && (
                            <span className="display shrink-0 rounded-sm border border-gold-lo/60 px-1 text-[9px] font-bold tnum text-gold">
                              ×{w.years.length}
                            </span>
                          )}
                        </>
                      );
                      return (
                        <li key={w.playerId}>
                          {exists ? (
                            <button
                              onClick={() => viewPlayer(w.playerId)}
                              title="View profile"
                              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-hover"
                            >
                              {inner}
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 px-1 py-1">{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
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
        {club && <Crest team={club} size={52} />}
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
  const game = useGame((s) => s.game)!;
  const winPct = a.matchesPlayed > 0 ? Math.round((a.matchesWon / a.matchesPlayed) * 100) : 0;
  const gd = a.goalsFor - a.goalsAgainst;
  const net = a.totalSpent - a.totalReceived;

  // Which tally's breakdown is open (v1.91). The rows come from the record book
  // — `clubHonours` for silverware, `userPlayerHonours` for individual awards —
  // which is the same stored data the counters were accumulated from, so the
  // modal can never list a different number of trophies than the card shows.
  const [open, setOpen] = useState<"league" | "cup" | "player" | null>(null);
  const honours = useMemo(() => clubHonours(game, game.userTeamId), [game]);
  const playerHonours = useMemo(() => userPlayerHonours(game), [game]);
  const leagueTitles = honours.filter((h) => h.kind === "league");
  // "Cups won" covers the domestic cup and the European ones alike — both are
  // knockout silverware and both are what the counter counts.
  const cupTitles = honours.filter((h) => h.kind !== "league");

  return (
    <div>
      <ManagerHero a={a} />

      {/* Promotions was removed as an honour card (v1.91) — going up is a
          season's outcome rather than something in the cabinet, and it is still
          tracked as an achievement. Three cards, so the row splits evenly. */}
      <Section title="Major Honours">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <HonourCard
            label="League Titles"
            value={a.leagueTitles}
            emblem="🏆"
            onOpen={() => setOpen("league")}
          />
          <HonourCard label="Cups Won" value={a.cupsWon} emblem="🥇" onOpen={() => setOpen("cup")} />
          <HonourCard
            label="Player Honours"
            value={a.playerAwards}
            emblem="⭐"
            sub="won by your players"
            onOpen={() => setOpen("player")}
          />
        </div>
      </Section>

      {open === "league" && (
        <HonourDetailModal title="League Titles" trophies={leagueTitles} onClose={() => setOpen(null)} />
      )}
      {open === "cup" && (
        <HonourDetailModal title="Cups Won" trophies={cupTitles} onClose={() => setOpen(null)} />
      )}
      {open === "player" && (
        <PlayerHonoursModal honours={playerHonours} onClose={() => setOpen(null)} />
      )}

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
function progressLabel(cur: number, target: number, unit?: AchievementDef["unit"]): string {
  // A tiered achievement STATES its unit; a flat one is inferred from the size
  // of its target, which is the rule that shipped and still covers every flat
  // card in the table.
  const money = unit ? unit === "money" : target >= 1_000_000;
  const shown = Math.min(cur, target);
  return money ? `${formatMoney(shown)} / ${formatMoney(target)}` : `${shown} / ${target}`;
}

/**
 * The tier badge on a tiered card (v2.0).
 *
 * A pill in the tier's own colour, drawn from `BADGE_COLOR` — the same palette
 * the staff badges use, so bronze is one bronze across the whole game rather
 * than a second one invented here. Deliberately NOT the facility badge ART:
 * that art carries a facility's mark, which would say something false about
 * what an achievement is.
 */
function TierPill({ tier, className = "" }: { tier: BadgeTier; className?: string }) {
  const color = BADGE_COLOR[tier];
  return (
    <span
      className={`display shrink-0 rounded-sm border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-widest ${className}`}
      style={{ borderColor: `${color}66`, color, backgroundColor: `${color}18` }}
    >
      {tier}
    </span>
  );
}

/**
 * The six-rung ladder as a row of pips — how far along a tiered achievement is,
 * without having to read the numbers.
 *
 * This is what makes a tiered card worth looking at once it has unlocked. A
 * plain progress bar says "68% of the way to the next thing" and nothing about
 * depth, so a bronze Cup Glory and an obsidian one would look identical at a
 * glance; six pips say which rung immediately and how many are left.
 */
function TierTrack({ index }: { index: number }) {
  return (
    <span className="flex shrink-0 items-center gap-[3px]" aria-hidden>
      {ACHIEVEMENT_TIERS.map((t, i) => (
        <i
          key={t}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: i <= index ? BADGE_COLOR[t] : "rgba(255,255,255,0.13)",
          }}
        />
      ))}
    </span>
  );
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

/**
 * One achievement card — flat or tiered (v2.0).
 *
 * The two shapes share everything except what the right-hand corner and the bar
 * mean. A flat card is unlocked or not, and its bar chases a single target. A
 * tiered card carries its current tier as a coloured pill plus the six-pip
 * ladder, and its bar chases the NEXT rung — which is what stops an unlocked
 * card going inert the moment it first fires.
 *
 * An earned card is tinted by its TIER rather than always gold: gold is the
 * design language's "the important thing" accent, and if every unlocked card
 * wore it there would be nothing left to distinguish a legacy Dynasty from a
 * bronze one. Gold's own rung still reads gold, which is the happy accident of
 * the badge ladder already containing it.
 */
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
  const ts: TierState | null = achievementTier(def, state, a);

  // What the bar is chasing. For a tiered card that is the next rung (measured
  // from the one already cleared, so the bar reads as progress ACROSS a rung
  // rather than as a fraction of an absolute total that starts near-full); for
  // a flat card it is the definition's own single target, and only while locked.
  const prog: [number, number] | null = ts
    ? ts.nextTarget !== null
      ? [ts.value, ts.nextTarget]
      : null
    : !earned && def.progress
      ? def.progress(state, a)
      : null;
  const pct = prog
    ? ts
      ? // Span of the CURRENT rung, so a bronze card at 1/3 titles doesn't show
        // 33% of the way to silver when it is actually at the very start of it.
        Math.min(
          100,
          Math.max(
            0,
            Math.round(((ts.value - ts.reached) / Math.max(1, prog[1] - ts.reached)) * 100)
          )
        )
      : prog[1] > 0
        ? Math.min(100, Math.round((prog[0] / prog[1]) * 100))
        : 0
    : 0;

  const tierColor = ts?.tier ? BADGE_COLOR[ts.tier] : null;

  return (
    // Locked cards recede (dimmer surface, no accent) so the earned ones and the
    // ones being actively chased are what the eye lands on first. An earned card
    // gets a border plus a soft bloom in its own tier's colour — the reward for
    // finishing it, and on a tiered card also the record of how far it went.
    <Card
      className={`relative overflow-hidden p-3.5 ${
        earned
          ? tierColor
            ? "bg-hover/50"
            : "border-gold-lo/60 bg-hover/50 shadow-[0_0_18px_-6px_var(--color-gold-lo)]"
          : "bg-surface/60"
      }`}
      style={
        earned && tierColor
          ? { borderColor: `${tierColor}99`, boxShadow: `0 0 18px -6px ${tierColor}` }
          : undefined
      }
    >
      {earned && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            background: `radial-gradient(110% 130% at 0% 0%, ${
              tierColor ?? "var(--color-gold-hi)"
            }, transparent 62%)`,
          }}
        />
      )}
      {/* Cards with no progress bar centre their contents instead of leaving a
          gap where the bar would be, so a mixed row still reads as one row. */}
      <div className={`relative flex gap-3 ${prog ? "items-start" : "items-center"}`}>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xl ${
            earned ? "" : "bg-raised/80 opacity-60 grayscale"
          }`}
          style={earned ? { backgroundColor: `${tierColor ?? "#ffd200"}26` } : undefined}
        >
          {def.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`display truncate text-sm font-semibold ${earned ? "text-ink" : "text-dim"}`}>
              {def.title}
            </span>
            {earned ? (
              ts?.tier ? (
                <TierPill tier={ts.tier} />
              ) : (
                <span className="display shrink-0 text-[10px] font-semibold uppercase tracking-widest text-gold">
                  ✓
                </span>
              )
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

          {/* The unlock stamp, spelled out (v2.0). "S1" was the shortest thing
              on the card and the only one that needed decoding; there is room
              for the word, and this is the line that tells a story. */}
          {earned && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="display text-[10px] font-semibold uppercase tracking-widest text-faint">
                ✓ Season {earnedSeason}
              </span>
              {ts && <TierTrack index={ts.tierIndex} />}
            </div>
          )}
          {!earned && ts && (
            <div className="mt-1 flex justify-end">
              <TierTrack index={-1} />
            </div>
          )}

          {prog && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.09]">
                <div
                  className={ts ? "h-full rounded-full" : `${progressFill(pct)} h-full rounded-full`}
                  style={{
                    width: `${pct}%`,
                    // A tiered bar is coloured by the rung it is CHASING, so the
                    // bar and the pill it is heading toward agree.
                    ...(ts?.next ? { backgroundColor: BADGE_COLOR[ts.next] } : null),
                  }}
                />
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] tnum text-faint">
                  {ts?.next ? `Next: ${ts.next}` : `${pct}%`}
                </span>
                <span className="text-[11.5px] font-medium tnum text-dim">
                  {progressLabel(prog[0], prog[1], def.unit)}
                </span>
              </div>
            </div>
          )}
          {/* Topped out: the ladder is finished, so there is no next rung to
              chase and a bar at 100% would read as unfinished business. */}
          {ts && !ts.next && earned && (
            <div className="mt-2 text-[11px] font-medium uppercase tracking-widest" style={{ color: tierColor ?? undefined }}>
              Maxed · {def.unit === "money" ? formatMoney(ts.value) : ts.value}
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
    // How close a LOCKED card is to unlocking — for a tiered one that is its
    // bronze rung, since bronze is what the unlock is.
    const nearness = (d: AchievementDef) => {
      if (d.tiers && d.value) {
        const t = d.tiers[0];
        return t > 0 ? Math.min(1, d.value(game, a) / t) : -1;
      }
      if (!d.progress) return -1;
      const [cur, target] = d.progress(game, a);
      return target > 0 ? Math.min(1, cur / target) : -1;
    };
    // Among EARNED cards, the deepest tier floats up: a legacy Dynasty is the
    // proudest thing in the group and shouldn't sort below a bronze one just
    // because the bronze happens to appear first in the table.
    const depth = (d: AchievementDef) => achievementTier(d, game, a)?.tierIndex ?? -1;
    return ACHIEVEMENT_GROUPS.map((g) => {
      const defs = ACHIEVEMENT_DEFS.filter((d) => d.group === g.id).sort((x, y) => {
        const ex = earned[x.id] ? 1 : 0;
        const ey = earned[y.id] ? 1 : 0;
        if (ex !== ey) return ey - ex;
        if (ex === 1) return depth(y) - depth(x);
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

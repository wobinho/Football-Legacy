"use client";

// Academy (§18, 9th screen): the youth pillar. Academy squad with fog-of-war
// potential, the scouting pipeline, and loans — all the "grow your own"
// decisions in one place.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Pos, PlayerBio, ProspectReport, ScoutPosGroup, ScoutRegion } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { ARCHETYPE_MAP } from "@/lib/config/archetype";
import {
  academyGrowthSummary,
  academyPlayers,
  prospectGrowth,
  type ProspectGrowth,
  focusSlots,
  pendingGraduates,
  potentialView,
  reportCadence,
  describeFilter,
  filterIsActive,
  prospectSignFee,
  quickSellQuote,
  scoutCapacity,
} from "@/lib/academy";
import { POS_GROUP_COLORS, POS_LABELS, POS_ORDER, posGroup } from "@/lib/config/positions";
import { academySquadCap } from "@/lib/economy";
import { seasonGrowth } from "@/lib/development";
import { SCOUT_WORLD, locateTarget, scoutRegion } from "@/lib/config/scouting";
import {
  expectedReportSize,
  idleScouts,
  maxScouts,
  scoutById,
  scoutTripQuote,
  tierChance,
  TIER_COLOR,
  TIER_LABEL,
  TRAVEL_BAND_LABEL,
} from "@/lib/scouts";
import { transferWindowState } from "@/lib/calendar";
import { formatMoney } from "@/lib/value";
import { matchesPlayerName } from "@/lib/search";
import { Card, ConfirmButton, displayFullName, Flag, GhostButton, GoldButton, Modal, Ovr, ArchetypeLabel, PlayerCard, PlayerGrid, PosBadge, PotentialBadge, Section, Stars, StarRange, Tabs, usePlayerView, ViewToggle } from "../ui";
// The loan and sale choosers are shared with the senior squad (v1.52, v1.71) —
// both squads resolve a move the same way, so the modals live outside this
// screen and a prospect is sold through exactly the path a senior pro is.
import { LoanOfferModal, SellPlayerModal } from "./SquadMoveModals";
import { signedThisSeason } from "@/lib/transfers";

// The Staff tab is gone (v1.65): the Youth Coach and the scout roster were split
// across two tabs from the assignments they drive, so hiring a scout and sending
// one out were different pages. Scouting is now the single academy-personnel
// surface — coach, department, assignments and reports in one place.
// v1.82: the "upgrades" tab is gone. Everything it sold — squad size, focus
// slots, prospect value, max scouts, report speed and the brief auto-filter —
// is produced by the Youth Academy and Scouting Network facilities now, so it
// is bought and read on the Facilities screen like every other building.
// v2.1: three tabs gone. **Development** is deleted because a prospect's plan is
// no longer his manager's to pick — `optimalTrainingPlan` is stamped on him when
// he joins and re-asserted every rollover, so a screen for choosing one would
// have been a control that silently reverted every summer. **Loaned Players** is
// deleted as a TAB only: loaning a prospect out is unchanged, and the squad list
// tags a loanee and offers his recall in place, which is where the decision
// already was. **U21 League** is removed outright pending a rework.
type Tab = "squad" | "growth" | "scouting";

export default function AcademyScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<Tab>("squad");
  const reports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay);

  return (
    <div>
      <Tabs
        tabs={[
          { id: "squad", label: "Academy Squad" },
          { id: "scouting", label: "Scouting", badge: reports.length },
          { id: "growth", label: "Growth" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "squad" && <SquadTab />}
      {tab === "growth" && <AcademyGrowthTab />}
      {tab === "scouting" && <ScoutingTab />}
    </div>
  );
}

// ── Academy staff (EA-FC-flavoured) ────────────────────────────────────────
// A deliberately distinct layout from the generic backroom StaffPanel: the
// Youth Coach reads as the single figure who *runs* the academy (one wide,
// gold-accented card), while Scouts read as a network of talent-finders — a
// grid of scout cards with the "report speed" stat front and centre.


/** A scout's two ratings, side by side. Experience and judgement answer
 * different questions, so they're always shown together and always labelled —
 * a 5★/1★ scout is a very different hire from a 1★/5★ one. */
function ScoutRatings({ experience, judgement }: { experience: number; judgement: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="w-[68px] text-[10px] uppercase tracking-widest text-faint">Exp</span>
        <Stars n={experience} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-[68px] text-[10px] uppercase tracking-widest text-faint">Judge</span>
        <Stars n={judgement} />
      </div>
    </div>
  );
}

/** A tier chance as a readable percentage. The top of the ladder sits well under
 * 1%, where rounding to whole percent would render every rare tier as "0%" — so
 * anything below 1 keeps a decimal. */
function tierPct(chance: number): string {
  const pct = chance * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return `${pct.toFixed(2).replace(/0$/, "")}%`;
  return `${Math.round(pct)}%`;
}

/** What a scout's ratings actually buy you, in plain numbers: the average size
 * of a report (experience) and the odds of a good find (judgement). The tiers
 * shown are the top of the ladder read off tuning, so adding a rung surfaces it
 * here without editing this component. */
function ScoutOutlook({ experience, judgement }: { experience: number; judgement: number }) {
  const avg = expectedReportSize(TUNING, experience);
  const headline = TUNING.prospectTierOrder.slice(-3); // gold and everything above it
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px]">
      <span className="display rounded-sm border border-line px-1.5 py-0.5 text-dim">
        ~<span className="tnum font-semibold text-ink">{avg.toFixed(1)}</span> per report
      </span>
      {headline.map((tier) => (
        <span
          key={tier}
          className="display rounded-sm border px-1.5 py-0.5"
          style={{ borderColor: `${TIER_COLOR[tier]}55`, color: TIER_COLOR[tier] }}
        >
          <span className="tnum font-semibold">{tierPct(tierChance(TUNING, judgement, tier))}</span>{" "}
          {TIER_LABEL[tier].toLowerCase()}
        </span>
      ))}
    </div>
  );
}

/** Countdown to the next full turnover of the for-hire pools (v20). Shown on the
 * staff/scout hiring shortlists so the manager knows when fresh faces arrive. */
export function MarketRefreshTimer() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  if (game.marketRefreshDay === undefined) return null;
  const daysLeft = Math.max(0, game.marketRefreshDay - game.currentDay);
  return (
    <span className="text-[11px] text-faint" title="The people available to hire refresh on this timer.">
      New faces in <span className={`tnum font-semibold ${daysLeft <= 2 ? "text-gold" : "text-dim"}`}>{daysLeft}</span>d
    </span>
  );
}

/** The scouting department (v14): a roster of employed scouts plus the hiring
 * shortlist. Headcount is what caps concurrent assignments, and Max Scouts caps
 * headcount — so this panel is where the size of the whole operation is set. */
function ScoutDepartmentPanel() {
  const game = useGame((s) => s.game)!;
  const hire = useGame((s) => s.scoutHire);
  const fire = useGame((s) => s.scoutFire);
  const dismiss = useGame((s) => s.scoutDismissCandidate);
  const team = game.teams[game.userTeamId];
  const roster = team.scouts ?? [];
  const cap = maxScouts(game, TUNING);
  const full = roster.length >= cap;
  const market = (game.scoutMarket ?? []).filter((c) => c.availableDay === undefined || c.availableDay <= game.currentDay);
  const onAssignment = new Set(game.academy.assignments.map((a) => a.scoutId));

  return (
    <Section
      title="Scouting Department"
      right={
        <span className="text-xs text-faint">
          <span className={`tnum font-semibold ${full ? "text-gold" : "text-ink"}`}>{roster.length}</span> / {cap} employed
        </span>
      }
    >
      {/* employed scouts */}
      {roster.length === 0 ? (
        <Card className="mb-4 p-4 text-sm text-dim">
          No scouts on the books. Hire one below, then send them out from <b className="text-ink">Operations</b>.
        </Card>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roster.map((s) => (
            <Card key={s.id} className="flex flex-col overflow-hidden border-t-2 border-t-gold-lo/40 p-0">
              <div className="flex items-start justify-between gap-2 bg-raised px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Flag nat={s.nationality} size={11} />
                    <span className="truncate text-sm font-semibold">{s.name}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">{formatMoney(s.wage)}/wk</div>
                </div>
                {onAssignment.has(s.id) ? (
                  <span className="display shrink-0 rounded-sm border border-win/40 px-1.5 py-0.5 text-[9px] font-semibold text-win">
                    ON ASSIGNMENT
                  </span>
                ) : (
                  <span className="display shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[9px] font-semibold text-faint">
                    AVAILABLE
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <ScoutRatings experience={s.experience} judgement={s.judgement} />
                <ScoutOutlook experience={s.experience} judgement={s.judgement} />
                <div className="mt-auto flex items-center justify-end border-t border-line/60 pt-2">
                  {onAssignment.has(s.id) ? (
                    <span className="text-[10px] text-faint" title="Recall the scout from the Scouting tab before releasing them.">
                      Recall before releasing
                    </span>
                  ) : (
                    <ConfirmButton
                      label="Release"
                      confirmLabel={`Release ${s.name}?`}
                      tone="danger"
                      onConfirm={() => fire(s.id)}
                      className="!px-3 !py-1 text-xs"
                    />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* hiring shortlist */}
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-faint">Scouts available to hire</span>
        <span className="flex items-baseline gap-3">
          <MarketRefreshTimer />
          {full && (
            <span className="text-[11px] text-gold">
              Department full — release a scout, or staff the Scouting Network to raise the cap.
            </span>
          )}
        </span>
      </div>
      {market.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-faint">
          Shortlist cleared — new scouts arrive in a couple of days.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {market.map((c) => (
            <Card key={c.id} className="flex flex-col overflow-hidden p-0">
              <div className="flex items-center justify-between gap-2 bg-raised px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Flag nat={c.nationality} size={11} />
                  <span className="truncate text-sm font-semibold">{c.name}</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <ScoutRatings experience={c.experience} judgement={c.judgement} />
                <ScoutOutlook experience={c.experience} judgement={c.judgement} />
                <div className="text-[11px] text-faint">
                  Fee {formatMoney(c.fee)} · {formatMoney(c.wage)}/wk
                </div>
                <div className="mt-auto flex items-stretch gap-1.5 pt-1">
                  <ConfirmButton
                    label={full ? "Full" : "Hire"}
                    confirmLabel="Confirm?"
                    disabled={full}
                    onConfirm={() => hire(c.id)}
                    className="flex-1 !px-2 !py-1 text-xs"
                  />
                  <button
                    onClick={() => dismiss(c.id)}
                    title="Dismiss — remove from the shortlist"
                    className="w-7 shrink-0 rounded border border-line text-sm leading-none text-dim transition-colors hover:border-loss/50 hover:text-loss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Academy squad ─────────────────────────────────────────────────────────

/** The prospect-tier badge (Bronze → Legacy) a player carries while in the
 * academy. Rendered in the tier's accent colour; nothing shows once the player
 * has graduated to the senior squad (the tier is cleared on promotion).
 *
 * The two rarest rungs get a soft halo on top of the colour. A save may go years
 * without one, so when it does turn up it should read as an event in a list of
 * badges rather than one more coloured chip. The threshold is derived from the
 * ladder's length, not from tier names. */
function TierTag({ tier, className = "" }: { tier: PlayerBio["u21Tier"]; className?: string }) {
  if (!tier) return null;
  const rank = TUNING.prospectTierOrder.indexOf(tier);
  const rare = rank >= TUNING.prospectTierOrder.length - 2;
  return (
    <span
      className={`display shrink-0 rounded-sm border px-1 text-[9px] font-semibold uppercase tracking-widest ${className}`}
      style={{
        borderColor: `${TIER_COLOR[tier]}77`,
        color: TIER_COLOR[tier],
        ...(rare ? { boxShadow: `0 0 6px ${TIER_COLOR[tier]}55` } : {}),
      }}
      title={`${TIER_LABEL[tier]} prospect`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

function statusChips(game: NonNullable<ReturnType<typeof useGame.getState>["game"]>, p: PlayerBio) {
  const chips: { label: string; cls: string }[] = [];
  if (game.academy.focusIds.includes(p.id)) chips.push({ label: "FOCUS", cls: "border-gold-lo/60 text-gold" });
  if (p.loan) chips.push({ label: `LOAN · ${game.teams[p.loan.toClubId]?.short ?? "?"}`, cls: "border-win/40 text-win" });
  else if (game.academy.loanList.includes(p.id)) chips.push({ label: "LOAN-LISTED", cls: "border-line text-dim" });
  if (p.age === TUNING.academyMaxAge) chips.push({ label: "FINAL SEASON", cls: "border-loss/40 text-loss" });
  return chips;
}

// ── Academy squad filters (v1.45) ──────────────────────────────────────────
// The squad list can grow past a screenful, so it's filterable by position and
// name and sortable by the columns that matter (name, age, overall, potential).

type SquadSort = "name" | "age" | "overall" | "potential";

const SQUAD_SORTS: { key: SquadSort; label: string }[] = [
  { key: "potential", label: "Potential" },
  { key: "overall", label: "Overall" },
  { key: "age", label: "Age" },
  { key: "name", label: "Name A–Z" },
];

/** Roster comparator for the chosen sort key. Potential/overall/age go high→low
 * (best first), except Age which reads youngest-first, and Name is alphabetical.
 * Potential uses the fogged star view — the same signal shown in the row. */
function squadCompare(
  game: NonNullable<ReturnType<typeof useGame.getState>["game"]>,
  a: PlayerBio,
  b: PlayerBio,
  key: SquadSort
): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "age":
      return a.age - b.age || b.overall - a.overall;
    case "overall":
      return b.overall - a.overall || a.name.localeCompare(b.name);
    case "potential":
    default: {
      const va = potentialView(game, a, TUNING);
      const vb = potentialView(game, b, TUNING);
      return vb.hiStars - va.hiStars || vb.loStars - va.loStars || b.overall - a.overall;
    }
  }
}

/** The filter/sort bar above the academy squad: a position dropdown, a name
 * search box, and a sort selector. Compact enough to sit on one row on desktop
 * and wrap gracefully on a phone. */
function SquadFilters({
  posFilter,
  onPos,
  nameQuery,
  onName,
  sortKey,
  onSort,
  shown,
  total,
}: {
  posFilter: "ALL" | Pos;
  onPos: (p: "ALL" | Pos) => void;
  nameQuery: string;
  onName: (q: string) => void;
  sortKey: SquadSort;
  onSort: (k: SquadSort) => void;
  shown: number;
  total: number;
}) {
  const selCls =
    "display rounded border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none transition-colors hover:border-faint focus:border-gold-lo/60";
  const filtered = shown !== total;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Name search */}
      <div className="relative">
        <input
          value={nameQuery}
          onChange={(e) => onName(e.target.value)}
          placeholder="Search name…"
          className="w-44 rounded border border-line bg-raised px-2.5 py-1.5 text-xs text-ink outline-none transition-colors placeholder:text-faint hover:border-faint focus:border-gold-lo/60"
        />
        {nameQuery && (
          <button
            onClick={() => onName("")}
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
        <select value={posFilter} onChange={(e) => onPos(e.target.value as "ALL" | Pos)} className={selCls}>
          <option value="ALL">All positions</option>
          {POS_ORDER.map((p) => (
            <option key={p} value={p}>
              {POS_LABELS[p]}
            </option>
          ))}
        </select>
      </label>

      {/* Sort */}
      <label className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-faint">Sort</span>
        <select value={sortKey} onChange={(e) => onSort(e.target.value as SquadSort)} className={selCls}>
          {SQUAD_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {filtered && (
        <span className="text-[11px] text-faint">
          <span className="tnum text-dim">{shown}</span> of {total}
        </span>
      )}
    </div>
  );
}

// Shared grid template for the academy squad header + rows, applied from md up.
// Fixed tracks for the data columns (Age/OVR/Potential/Actions) so the header —
// a separate grid container from each row — lines its labels up with the values
// below them. On phones the rows drop the grid entirely and stack: an identity
// line (pos · name · age · OVR · potential) with the actions wrapping beneath.
// v1.74: the archetype is a column of its own rather than a second line under
// the name — a wrapped sub-line was the only thing making these rows two-high.
//
// v1.89: the actions track is the widest thing in the row, not the narrowest.
// Six buttons sit in there and one of them carries a money figure ("Quick Sell
// £12.5M"), so the old 22rem ceiling wrapped the cluster onto a second line and
// doubled every row's height. It now takes a fixed 34rem at xl — enough for the
// whole cluster on one line at its longest — and the identity columns give up
// the room: the name track is `minmax(0,1fr)` so it truncates rather than
// pushing the actions, and the archetype column only appears from xl up, where
// there is width for both. Keep the actions track ahead of any future column:
// a wrapped action cluster is what this width exists to prevent.
const SQUAD_GRID =
  "md:grid-cols-[2.25rem_minmax(0,1fr)_2.5rem_3rem_4.5rem_minmax(0,26rem)] " +
  "xl:grid-cols-[2.25rem_minmax(0,1fr)_9rem_2.5rem_3rem_4.5rem_34rem]";

/**
 * Prospects who have outgrown the academy and are waiting on a senior decision
 * (§18, v1.51).
 *
 * They used to be pushed straight into the senior squad at the rollover, which
 * is what made a manager's squad appear to grow players it never signed. Now
 * they sit here — off both squad lists, on no wage — until the manager signs
 * them or lets them go. Rendered above the roster and only when the queue has
 * someone in it, so it reads as an inbox item that needs clearing rather than
 * permanent furniture.
 */
function GraduatesPanel() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const sign = useGame((s) => s.graduateSign);
  const release = useGame((s) => s.graduateRelease);

  const waiting = pendingGraduates(game);
  if (!waiting.length) return null;

  return (
    <Section
      title="Ready for the senior squad"
      right={
        <span className="text-xs text-faint">
          {waiting.length} awaiting a decision
        </span>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-faint">
        {waiting.length === 1 ? "This prospect has" : "These prospects have"} outgrown the youth setup.
        Sign {waiting.length === 1 ? "him" : "them"} to a senior contract or let {waiting.length === 1 ? "him" : "them"} go —
        nobody joins your squad, or your wage bill, until you decide.
      </p>
      <Card className="divide-y divide-line/50">
        {waiting.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <PosBadge pos={p.positions[0]} />
            <button
              onClick={() => viewPlayer(p.id)}
              className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-ink hover:text-gold"
            >
              {p.name}
            </button>
            <span className="tnum text-xs text-faint">{p.age}y</span>
            <Ovr value={p.overall} size="sm" />
            <PotentialBadge game={game} p={p} />
            <div className="flex items-center gap-2">
              <GoldButton onClick={() => sign(p.id)} className="!px-3 !py-1.5 text-xs">
                SIGN HIM
              </GoldButton>
              <ConfirmButton
                label="Release"
                confirmLabel="Release?"
                tone="danger"
                onConfirm={() => release(p.id)}
                className="!px-3 !py-1.5 !text-xs"
              />
            </div>
          </div>
        ))}
      </Card>
    </Section>
  );
}

function SquadTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const promote = useGame((s) => s.academyPromote);
  const release = useGame((s) => s.academyRelease);
  const quickSell = useGame((s) => s.academyQuickSell);
  const toggleFocus = useGame((s) => s.academyToggleFocus);
  const recall = useGame((s) => s.academyRecall);
  const [view, setView] = usePlayerView("academy");
  // Which prospect (if any) has the "Send on Loan" chooser open.
  const [loanFor, setLoanFor] = useState<string | null>(null);
  // …and which has the "Sell Player" chooser open (v1.71).
  const [sellFor, setSellFor] = useState<string | null>(null);

  const team = game.teams[game.userTeamId];
  const seniorRoom = TUNING.squadCap - team.playerIds.length;
  const windowOpen = transferWindowState(game.currentDay, game.schedule).open;

  // Squad filters (v1.45): a position filter, a live name search, and a sort key.
  // Held in local state so the roster below is a filtered+sorted view.
  const [posFilter, setPosFilter] = useState<"ALL" | Pos>("ALL");
  const [nameQuery, setNameQuery] = useState("");
  const [sortKey, setSortKey] = useState<SquadSort>("potential");

  // The academy squad is exactly your U21 prospects — one consolidated roster.
  const allProspects = academyPlayers(game);
  const roster = allProspects
    .filter((p) => (posFilter === "ALL" || p.positions[0] === posFilter))
    // Accent-insensitive, across short and full name (v1.5).
    .filter((p) => matchesPlayerName(p, nameQuery))
    .sort((a, b) => squadCompare(game, a, b, sortKey));

  const stats: { label: string; value: React.ReactNode; hint?: string }[] = [
    {
      label: "Academy places",
      value: `${allProspects.length}/${academySquadCap(game, team.id, TUNING)}`,
      hint: "Prospects in the academy — build or upgrade the Youth Academy facility for more room",
    },
    {
      label: "Focus slots",
      value: `${game.academy.focusIds.length}/${focusSlots(game, TUNING)}`,
      hint: "Focus prospects get guaranteed U21 starts and extra coaching",
    },
  ];

  const filterBar = (
    <SquadFilters
      posFilter={posFilter}
      onPos={setPosFilter}
      nameQuery={nameQuery}
      onName={setNameQuery}
      sortKey={sortKey}
      onSort={setSortKey}
      shown={roster.length}
      total={allProspects.length}
    />
  );

  const moveModals = (
    <>
      {loanFor && <LoanOfferModal playerId={loanFor} onClose={() => setLoanFor(null)} />}
      {sellFor && <SellPlayerModal playerId={sellFor} onClose={() => setSellFor(null)} />}
    </>
  );

  if (view === "grid")
    return (
      <>
        <GraduatesPanel />
        {grid()}
        {moveModals}
      </>
    );

  return (
    <div className="space-y-6">
      {moveModals}
      <GraduatesPanel />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md border border-line bg-surface px-3 py-1.5" title={s.hint}>
              <div className="text-[9px] uppercase tracking-widest text-faint">{s.label}</div>
              <div className="display tnum text-sm font-semibold text-ink">{s.value}</div>
            </div>
          ))}
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {filterBar}

      <Card className="divide-y divide-line/50">
        <div className={`hidden ${SQUAD_GRID} items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint md:grid`}>
          <span>Pos</span>
          <span>Player</span>
          {/* The archetype column only exists from xl up (see SQUAD_GRID) — the
              actions cluster takes that width below it. */}
          <span className="hidden xl:block">Archetype</span>
          <span className="text-center">Age</span>
          <span className="text-center">OVR</span>
          <span className="text-center">Potential</span>
          <span className="text-right">Actions</span>
        </div>
        {roster.length === 0 && (
          <div className="px-4 py-6 text-sm text-faint">
            {allProspects.length === 0
              ? "No academy prospects yet — send a scout out, and sign what they find."
              : "No prospects match these filters."}
          </div>
        )}
        {roster.map((p) => {
          const chips = statusChips(game, p);
          const isFocus = game.academy.focusIds.includes(p.id);
          return (
            <div key={p.id} className={`px-4 py-2.5 md:grid ${SQUAD_GRID} md:items-center md:gap-3`}>
              {/* identity line — md:contents dissolves the wrapper so these
                  become the first five grid cells on desktop */}
              <div className="flex items-center gap-2.5 md:contents">
                <PosBadge pos={p.positions[0]} />
                <button onClick={() => viewPlayer(p.id)} className="group min-w-0 flex-1 text-left md:flex-none">
                  <span className="flex items-center gap-1.5">
                    <Flag nat={p.nationality} size={11} />
                    <span className="truncate font-medium transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                    <TierTag tier={p.u21Tier} />
                  </span>
                  {/* The archetype lives in its own column from xl up; below
                      that there is no column for it, so it rejoins the chips. */}
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    <ArchetypeLabel p={p} className="xl:hidden" />
                    {chips.map((c) => (
                      <span key={c.label} className={`display rounded-sm border px-1 text-[9px] font-semibold ${c.cls}`}>
                        {c.label}
                      </span>
                    ))}
                  </span>
                </button>
                <span className="hidden min-w-0 text-[11px] text-faint xl:block">
                  <ArchetypeLabel p={p} />
                </span>
                <span className="shrink-0 text-center tnum text-sm text-dim">
                  {p.age}
                  <span className="md:hidden">y</span>
                </span>
                <span className="shrink-0 text-center">
                  <Ovr value={p.overall} size="sm" />
                </span>
                <span className="shrink-0 text-center">
                  <PotentialBadge game={game} p={p} />
                </span>
              </div>
              <span className="mt-2 flex flex-wrap items-center gap-1.5 md:mt-0 md:justify-end">
                <SquadActions
                  p={p}
                  isFocus={isFocus}
                  windowOpen={windowOpen}
                  signedLock={signedThisSeason(game, p)}
                  seniorRoom={seniorRoom}
                  onToggleFocus={toggleFocus}
                  onLoanClick={setLoanFor}
                  onSellClick={setSellFor}
                  onRecall={recall}
                  onPromote={promote}
                  onRelease={release}
                  onQuickSell={quickSell}
                />
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );

  function grid() {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-md border border-line bg-surface px-3 py-1.5" title={s.hint}>
                <div className="text-[9px] uppercase tracking-widest text-faint">{s.label}</div>
                <div className="display tnum text-sm font-semibold text-ink">{s.value}</div>
              </div>
            ))}
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>
        {filterBar}
        {roster.length === 0 ? (
          <Card className="px-4 py-6 text-sm text-faint">
            {allProspects.length === 0
              ? "No academy prospects yet — send a scout out, and sign what they find."
              : "No prospects match these filters."}
          </Card>
        ) : (
          <PlayerGrid>
            {roster.map((p) => {
              const chips = statusChips(game, p);
              const isFocus = game.academy.focusIds.includes(p.id);
              return (
                <PlayerCard
                  key={p.id}
                  p={p}
                  onOpen={() => viewPlayer(p.id)}
                  ovr={<Ovr value={p.overall} size="sm" />}
                  sub={<ArchetypeLabel p={p} />}
                  badges={[
                    ...(p.u21Tier ? [<TierTag key="tier" tier={p.u21Tier} />] : []),
                    ...chips.map((c) => (
                      <span key={c.label} className={`display rounded-sm border px-1 text-[9px] font-semibold ${c.cls}`}>
                        {c.label}
                      </span>
                    )),
                  ]}
                  stats={
                    <span className="flex items-center gap-1.5">
                      <span className="text-faint">POT</span>
                      <PotentialBadge game={game} p={p} />
                    </span>
                  }
                  actions={
                    <SquadActions
                      p={p}
                      isFocus={isFocus}
                      windowOpen={windowOpen}
                      signedLock={signedThisSeason(game, p)}
                      seniorRoom={seniorRoom}
                      onToggleFocus={toggleFocus}
                      onLoanClick={setLoanFor}
                      onSellClick={setSellFor}
                      onRecall={recall}
                      onPromote={promote}
                      onRelease={release}
                      onQuickSell={quickSell}
                    />
                  }
                />
              );
            })}
          </PlayerGrid>
        )}
      </div>
    );
  }
}

/** The per-prospect action cluster (training-plan picker, focus, loan, promote,
 * sell, release), shared between the academy squad's list rows and its grid
 * cards so both offer exactly the same controls. */
function SquadActions({
  p,
  isFocus,
  windowOpen,
  signedLock,
  seniorRoom,
  onToggleFocus,
  onLoanClick,
  onSellClick,
  onRecall,
  onPromote,
  onRelease,
  onQuickSell,
}: {
  p: PlayerBio;
  isFocus: boolean;
  windowOpen: boolean;
  signedLock: boolean;
  seniorRoom: number;
  onToggleFocus: (id: string) => void;
  onLoanClick: (id: string) => void;
  onSellClick: (id: string) => void;
  onRecall: (id: string) => void;
  onPromote: (id: string) => void;
  onRelease: (id: string) => void;
  onQuickSell: (id: string) => void;
}) {
  // A prospect's training plan is set by the coaching staff (v2.1) — the
  // Development tab that used to pick it is gone — so the squad row is entirely
  // about squad decisions.
  //
  // The quick-sell figure is quoted on the button rather than behind a modal:
  // the whole point of the route is that it's one click, and a price you have to
  // open something to see isn't a price you can act on at that speed. It comes
  // from the same `saleSuitors` model the Sell chooser uses, so the two numbers
  // on screen are directly comparable — which is exactly the choice being made.
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const quote = quickSellQuote(game, p.id, TUNING);
  const canQuickSell = windowOpen && !p.loan && !signedLock && quote.fee > 0;

  return (
    <>
      <TextBtn
        label={isFocus ? "★ Focus" : "☆ Focus"}
        title={isFocus ? "Remove focus" : "Make focus prospect (the youth coaches concentrate on him)"}
        active={isFocus}
        onClick={() => onToggleFocus(p.id)}
        disabled={!!p.loan}
      />
      {p.loan ? (
        <TextBtn
          label="Recall Loan"
          title={windowOpen ? "Recall from loan" : "Can only recall during a transfer window"}
          onClick={() => onRecall(p.id)}
          disabled={!windowOpen}
        />
      ) : (
        <TextBtn
          label="Send on Loan"
          title={
            windowOpen
              ? "Find clubs willing to take them on a development loan"
              : "Loans can only be arranged during a transfer window"
          }
          onClick={() => onLoanClick(p.id)}
          disabled={!windowOpen}
        />
      )}
      <TextBtn
        label="Promote"
        title={
          p.age < TUNING.academyPromoteMinAge
            ? `Too young — prospects join the senior squad at ${TUNING.academyPromoteMinAge}`
            : seniorRoom > 0
              ? "Promote to the senior (first) team"
              : "Senior squad is full — sell or release someone first"
        }
        onClick={() => onPromote(p.id)}
        disabled={seniorRoom <= 0 || !!p.loan || p.age < TUNING.academyPromoteMinAge}
      />
      {/* Sell a prospect straight out of the academy (v1.71). Releasing him gets
          you nothing; a club that actually wants him pays for him. Same chooser
          the senior squad uses, and the same rules gate it — an open window and
          no live loan. */}
      <TextBtn
        label="Sell"
        title={
          p.loan
            ? "Recall him from his loan spell first"
            : signedLock
              ? "Signed this season — he can't be sold until next season"
              : windowOpen
                ? "See which clubs would buy him and what each would pay"
                : "Players can only be sold while a transfer window is open"
        }
        onClick={() => onSellClick(p.id)}
        disabled={!windowOpen || !!p.loan || signedLock}
      />
      {/* Quick sell (v1.87) — 80% of the best offer, and the prospect leaves the
          world rather than joining the buyer. That's the trade: less money, but
          no rival is handed a player you didn't want. Confirmed because it is
          irreversible in a way the ordinary sale isn't — there is no club to buy
          him back from afterwards. */}
      <ConfirmButton
        label={canQuickSell ? `Quick Sell ${formatMoney(quote.fee)}` : "Quick Sell"}
        confirmLabel="Sell & delete?"
        tone="danger"
        title={
          p.loan
            ? "Recall him from his loan spell first"
            : signedLock
                ? "Signed this season — he can't be sold until next season"
                : !windowOpen
                  ? "Players can only be sold while a transfer window is open"
                  : quote.fee <= 0
                    ? "No club would buy him right now — release him instead"
                    : `${formatMoney(quote.fee)} — 80% of the best offer (${formatMoney(quote.bestFee)} from ${quote.from}). He leaves the game entirely rather than joining them.`
        }
        disabled={!canQuickSell}
        onConfirm={() => onQuickSell(p.id)}
        className="display !rounded !px-2 !py-1 !text-[11px] tracking-wide"
      />
      <ConfirmButton
        label="Release"
        confirmLabel="Release?"
        tone="danger"
        onConfirm={() => onRelease(p.id)}
        className="display !rounded !px-2 !py-1 !text-[11px] tracking-wide"
      />
    </>
  );
}

/** A compact labelled action button used across the academy rows. */
function TextBtn({
  label,
  title,
  onClick,
  active,
  danger,
  disabled,
}: {
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const tone = danger
    ? "border-line text-dim hover:border-loss/50 hover:text-loss"
    : active
      ? "border-gold-lo/60 bg-hover text-gold"
      : "border-line bg-raised text-dim hover:border-faint hover:text-ink";
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`display rounded border px-2 py-1 text-[11px] font-semibold tracking-wide transition-colors disabled:opacity-30 ${tone}`}
    >
      {label}
    </button>
  );
}

// ── Academy growth tracking (v1.52) ────────────────────────────────────────
// The academy's answer to "is this working?".
//
// Overall growth was previously only legible one prospect at a time, behind an
// expander on the Development tab — you could see that a kid was 62, but not
// that he arrived at 54 and has climbed 8 in two seasons, and certainly not how
// the intake as a whole was trending. This tab charts every prospect's overall
// over time and totals it into a few squad-level numbers.

/** A signed overall delta, coloured and always explicitly signed. */
function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (!value) return <span className="tnum text-faint">—</span>;
  return (
    <span className={`tnum font-semibold ${value > 0 ? "text-win" : "text-loss"}`}>
      {value > 0 ? "+" : ""}
      {Math.round(value * 10) / 10}
      {suffix}
    </span>
  );
}

type GrowthSort = "total" | "season" | "rate" | "overall" | "age";

const GROWTH_SORTS: { key: GrowthSort; label: string }[] = [
  { key: "total", label: "Total growth" },
  { key: "season", label: "This season" },
  { key: "rate", label: "Per season" },
  { key: "overall", label: "Overall" },
  { key: "age", label: "Age" },
];

// No sparkline column (v1.63) — see the matching note on the senior Growth tab.
// Seasons-on-record is a column rather than a second line under the name
// (v1.85) — see the matching note on the senior Growth tab. Two lines of text in
// one cell set the height of every row in the table, for one small number.
const GROWTH_GRID = "md:grid-cols-[2.25rem_1fr_3.5rem_2.5rem_3.5rem_4.5rem_4.5rem_4.5rem]";

function AcademyGrowthTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [sortKey, setSortKey] = useState<GrowthSort>("total");

  const rows = useMemo(() => {
    const list = academyPlayers(game).map((p) => prospectGrowth(game, p));
    const cmp: Record<GrowthSort, (a: ProspectGrowth, b: ProspectGrowth) => number> = {
      total: (a, b) => b.totalGain - a.totalGain || b.player.overall - a.player.overall,
      season: (a, b) => b.seasonGain - a.seasonGain || b.totalGain - a.totalGain,
      rate: (a, b) => b.perSeason - a.perSeason || b.totalGain - a.totalGain,
      overall: (a, b) => b.player.overall - a.player.overall,
      age: (a, b) => a.player.age - b.player.age || b.player.overall - a.player.overall,
    };
    return list.sort(cmp[sortKey]);
  }, [game, sortKey]);

  const summary = useMemo(() => academyGrowthSummary(rows), [rows]);

  if (rows.length === 0) {
    return (
      <Card className="border-dashed px-4 py-8 text-center text-sm text-faint">
        No academy prospects to track yet — send a scout out, and sign what they find.
      </Card>
    );
  }

  const stats: { label: string; value: React.ReactNode; hint: string }[] = [
    {
      label: "Prospects tracked",
      value: `${summary.tracked}/${rows.length}`,
      hint: "Prospects with at least one completed season on record",
    },
    {
      label: "Total OVR added",
      value: <Delta value={summary.totalGain} />,
      hint: "Overall the academy has added across every prospect since each joined",
    },
    {
      label: "Avg per season",
      value: <Delta value={Math.round(summary.avgPerSeason * 10) / 10} />,
      hint: "Mean overall a tracked prospect gains in a season — the academy's rate of climb",
    },
    {
      label: "Avg overall",
      value: <span className="tnum">{summary.avgOverall.toFixed(1)}</span>,
      hint: "Mean current overall across the academy squad",
    },
  ];

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="display font-semibold text-ink">How your academy is developing</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
          How every prospect&apos;s overall has moved: what he has added since he was first recorded, what he has added
          this season, and his average per season. Growth comes from U21 minutes, your Youth Coach and the Academy
          facility, so a prospect stuck on zero is usually one who isn&apos;t playing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md border border-line bg-surface px-3 py-1.5" title={s.hint}>
              <div className="text-[9px] uppercase tracking-widest text-faint">{s.label}</div>
              <div className="display text-sm font-semibold text-ink">{s.value}</div>
            </div>
          ))}
        </div>
        {summary.topRiser && (
          <div className="mt-3 flex items-center gap-2 border-t border-line/60 pt-3 text-[12px]">
            <span className="text-faint">Biggest riser</span>
            <Flag nat={summary.topRiser.player.nationality} size={11} />
            <button
              onClick={() => viewPlayer(summary.topRiser!.player.id)}
              className="font-semibold text-ink hover:text-gold"
            >
              {summary.topRiser.player.name}
            </button>
            <span className="tnum text-faint">
              {summary.topRiser.firstOverall} → {summary.topRiser.player.overall}
            </span>
            <Delta value={summary.topRiser.totalGain} />
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-faint">Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as GrowthSort)}
            className="display rounded border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none transition-colors hover:border-faint focus:border-gold-lo/60"
          >
            {GROWTH_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card className="divide-y divide-line/50">
        <div
          className={`hidden ${GROWTH_GRID} items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint md:grid`}
        >
          <span>Pos</span>
          <span>Prospect</span>
          <span className="text-center" title="Completed seasons on record for this prospect">
            Seasons
          </span>
          <span className="text-center">Age</span>
          <span className="text-center">OVR</span>
          <span className="text-center" title="Overall gained since he was first recorded">
            Total
          </span>
          <span className="text-center" title="Overall gained so far this season">
            Season
          </span>
          <span className="text-center" title="Average overall gained per completed season">
            Per yr
          </span>
        </div>
        {rows.map((g) => {
          const p = g.player;
          return (
            <div key={p.id} className={`px-4 py-2.5 md:grid ${GROWTH_GRID} md:items-center md:gap-3`}>
              <div className="flex items-center gap-2.5 md:contents">
                <PosBadge pos={p.positions[0]} />
                <button onClick={() => viewPlayer(p.id)} className="group min-w-0 flex-1 text-left md:flex-none">
                  <span className="flex items-center gap-1.5">
                    <Flag nat={p.nationality} size={11} />
                    <span className="truncate font-medium transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                    <TierTag tier={p.u21Tier} />
                  </span>
                </button>
                {/* Its own column from `md` up; on a phone, where the grid is a
                    stack rather than a table, it stays the caption it was. */}
                <span
                  className="shrink-0 text-center tnum text-sm text-dim"
                  title={g.seasons > 0 ? `${g.seasons} completed season${g.seasons === 1 ? "" : "s"} on record` : "First season on record"}
                >
                  {g.seasons > 0 ? g.seasons : <span className="text-faint">—</span>}
                </span>
                <span className="shrink-0 text-center tnum text-sm text-dim">
                  {p.age}
                  <span className="md:hidden">y</span>
                </span>
              </div>

              <span className="mt-2 flex items-center justify-center md:mt-0">
                <Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />
              </span>

              {/* On phones these three collapse into one labelled row. */}
              <span className="mt-2 flex items-center justify-between gap-3 text-sm md:mt-0 md:contents">
                <span className="text-center">
                  <span className="mr-1 text-[10px] uppercase tracking-widest text-faint md:hidden">Total</span>
                  <Delta value={g.totalGain} />
                </span>
                <span className="text-center">
                  <span className="mr-1 text-[10px] uppercase tracking-widest text-faint md:hidden">Season</span>
                  <Delta value={g.seasonGain} />
                </span>
                <span className="text-center">
                  <span className="mr-1 text-[10px] uppercase tracking-widest text-faint md:hidden">Per yr</span>
                  {g.seasons > 0 ? <Delta value={Math.round(g.perSeason * 10) / 10} /> : <span className="tnum text-faint">—</span>}
                </span>
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ── Scouting ──────────────────────────────────────────────────────────────

/** Position briefs offered when sending a scout. The broad groups come first,
 * then every specific position (v17) — without those, a right back or right
 * winger could not be requested at all: "Defenders" rolled across CB/LB/RB and
 * "Attackers" across LW/RW/ST, so the flank you wanted was left to chance. */
const POS_OPTIONS: { id: ScoutPosGroup; label: string; group?: string }[] = [
  { id: "ANY", label: "Any position" },
  { id: "GK", label: "Goalkeepers" },
  { id: "DEF", label: "Defenders (any)" },
  { id: "MID", label: "Midfielders (any)" },
  { id: "ATT", label: "Attackers (any)" },
  ...POS_ORDER.filter((p) => p !== "GK").map((p) => ({
    id: p as ScoutPosGroup,
    label: POS_LABELS[p],
    group: POS_GROUP_COLORS[posGroup(p)].label,
  })),
];

/** Shared pill-button styling for the scouting selectors (region). */
const chipClass = (active: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
    active ? "border-gold bg-hover text-ink" : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
  }`;

const posGroupLabel = (id: ScoutPosGroup) =>
  POS_OPTIONS.find((o) => o.id === id)?.label ?? POS_LABELS[id as Pos] ?? id;

// ── Scouting card furniture (v1.66) ────────────────────────────────────────
// Small presentational pieces shared by the assignment cards and the prospect
// reports. They exist so the two columns speak the same visual language: the
// same urgency ramp, the same progress bar, the same metadata tag.

/** A metadata tag on a prospect card. The report's context line used to be one
 * long grey sentence of dot-separated clauses, where the archetype, the age of
 * the find and the scout all had equal (low) weight. Each clause is now its own
 * bordered chip with a leading glyph, so they scan as discrete facts. */
function MetaTag({
  icon,
  children,
  className = "",
  title,
}: {
  icon: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`display inline-flex items-center gap-1 rounded-sm border border-line bg-raised px-1.5 py-0.5 text-[10px] text-dim ${className}`}
      title={title}
    >
      <span className="opacity-60" aria-hidden>
        {icon}
      </span>
      {children}
    </span>
  );
}

/** A thin progress bar. `pct` is clamped, so a stale or out-of-range input can
 * never render a bar that overflows its track. */
function MiniBar({ pct, className = "", trackClass = "bg-line" }: { pct: number; className?: string; trackClass?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full ${trackClass}`}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${className}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/**
 * How long a trail stays warm, as a badge plus a draining bar.
 *
 * The expiry used to be the tail of a grey sentence, which is exactly backwards:
 * it is the one number on the card with a deadline attached. The ramp is derived
 * from the tuned expiry window rather than hardcoded days, so retuning
 * `scoutReportExpiryDays` moves the thresholds with it — under a third of the
 * window is urgent (red), under two thirds is a warning (amber).
 */
function TrailTimer({ daysLeft }: { daysLeft: number }) {
  const window = TUNING.scoutReportExpiryDays;
  const left = Math.max(0, daysLeft);
  const frac = window > 0 ? left / window : 0;
  const tone =
    frac <= 1 / 3
      ? { text: "text-loss", border: "border-loss/50", bg: "bg-loss/10", bar: "bg-loss" }
      : frac <= 2 / 3
        ? { text: "text-gold", border: "border-gold-lo/50", bg: "bg-gold-lo/10", bar: "gold-grad" }
        : { text: "text-dim", border: "border-line", bg: "bg-raised", bar: "bg-dim/60" };
  return (
    <span
      className="inline-flex min-w-[128px] flex-col gap-1"
      title={`This trail goes cold in ${left} day${left === 1 ? "" : "s"} — after that the prospect is gone.`}
    >
      {/* No tracking on this chip: the display face's uppercase letter-spacing
          pushes the unit away from the number, so a "20d" countdown reads as
          "200". The unit is spelled out for the same reason. */}
      <span
        className={`display inline-flex items-center gap-1 self-start rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal ${tone.border} ${tone.bg} ${tone.text}`}
      >
        <span aria-hidden>⏳</span>
        cold in <span className="tnum">{left}</span> {left === 1 ? "day" : "days"}
      </span>
      <MiniBar pct={frac * 100} className={tone.bar} />
    </span>
  );
}

/**
 * The overall rating on a prospect card, in a value-graded pill.
 *
 * Potential already reads instantly (gold stars); the overall next to it was a
 * bare number, so the two halves of the same judgement were weighted very
 * differently. The bands are the metal ladder a manager already expects —
 * grey / bronze / silver / gold — and they key off the same thresholds `Ovr`
 * uses for its text colour, so the pill and the number never disagree.
 */
function OvrPill({ value }: { value: number }) {
  const band =
    value >= 80
      ? { border: "rgba(217,164,65,0.55)", bg: "rgba(217,164,65,0.12)", label: "Gold" }
      : value >= 70
        ? { border: "rgba(196,202,212,0.45)", bg: "rgba(196,202,212,0.10)", label: "Silver" }
        : value >= 60
          ? { border: "rgba(176,124,78,0.50)", bg: "rgba(176,124,78,0.12)", label: "Bronze" }
          : { border: "rgba(255,255,255,0.10)", bg: "rgba(255,255,255,0.03)", label: "Raw" };
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-0.5"
      style={{ borderColor: band.border, backgroundColor: band.bg }}
      title={`${band.label} — overall ${value}`}
    >
      <Ovr value={value} size="sm" />
    </span>
  );
}

/**
 * Scouting (v1.65): the whole academy talent operation on one page.
 *
 * It used to be two tabs — Scouting held the assignments and the reports, Staff
 * held the Youth Coach and the scouts themselves — which meant the answer to
 * "why can't I send anyone out?" lived on a different page from the question. The
 * two halves are now sub-sections of one tab, ordered the way the job runs:
 * OPERATIONS (who is out, what they found) first, because that is what a manager
 * checks every week, and PERSONNEL (coach, roster, hiring) behind it, because
 * that is what he changes occasionally.
 */
function ScoutingTab() {
  useGame((s) => s.rev);
  const game = useGame((s) => s.game)!;
  const [pane, setPane] = useState<"operations" | "personnel">("operations");

  const roster = game.teams[game.userTeamId].scouts ?? [];
  const reports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay);
  const cap = maxScouts(game, TUNING);

  return (
    <div className="space-y-5">
      {/* A compact switch rather than a second row of page tabs — these are two
          views of one department, not two departments. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-raised p-1">
          {([
            { id: "operations", label: "Operations", badge: reports.length },
            { id: "personnel", label: "Personnel", badge: 0 },
          ] as const).map((p) => (
            <button
              key={p.id}
              onClick={() => setPane(p.id)}
              className={`display flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                pane === p.id ? "gold-grad text-black" : "text-dim hover:text-ink"
              }`}
            >
              {p.label}
              {p.badge > 0 && (
                <span
                  className={`tnum rounded-full px-1.5 text-[10px] ${
                    pane === p.id ? "bg-black/25" : "bg-line text-dim"
                  }`}
                >
                  {p.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* The department at a glance, visible from either pane — the numbers
            that explain what you can and can't do right now. Borderless: three
            boxed tiles read as a separate widget floating above the page, so
            they're now a plain icon list divided by hairlines. Live reports is
            not here — it belongs to the reports column and is rendered there. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <DeptStat
            icon="🔍"
            label="Scouts"
            value={`${roster.length}/${cap}`}
            warn={roster.length === 0}
            title={`${roster.length} scout${roster.length === 1 ? "" : "s"} employed of ${cap} maximum`}
          />
        </div>
      </div>

      {pane === "operations" ? <ScoutOperationsPane /> : <ScoutPersonnelPane />}
    </div>
  );
}

/** One number in the scouting department's status strip. No border of its own —
 * the strip is a horizontal icon list, so the icon carries the identity and the
 * label sits inline with the value rather than stacked above it in a box. */
function DeptStat({
  icon,
  label,
  value,
  warn,
  title,
}: {
  icon: string;
  label: string;
  value: string;
  warn?: boolean;
  title?: string;
}) {
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="text-sm leading-none opacity-70" aria-hidden>
        {icon}
      </span>
      <span className="text-[9px] uppercase tracking-widest text-mute">{label}</span>
      <span className={`display tnum text-sm font-semibold ${warn ? "text-gold" : "text-ink"}`}>{value}</span>
    </span>
  );
}

/** Coach + scout roster + hiring — the "who works here" half of Scouting. */
function ScoutPersonnelPane() {
  useGame((s) => s.rev);
  return (
    <div className="space-y-8">
      <ScoutDepartmentPanel />
    </div>
  );
}

function ScoutOperationsPane() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const removeScout = useGame((s) => s.academyRemoveScout);
  const sign = useGame((s) => s.academySign);
  const dismiss = useGame((s) => s.academyDismiss);
  const viewProspect = useGame((s) => s.viewProspect);
  const [sending, setSending] = useState(false);

  const roster = game.teams[game.userTeamId].scouts ?? [];
  const free = idleScouts(game);
  const assignments = game.academy.assignments;
  const capacity = scoutCapacity(game, TUNING);
  const reports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay);
  const team = game.teams[game.userTeamId];
  const academyFull = (team.academyPlayerIds?.length ?? 0) >= academySquadCap(game, team.id, TUNING);
  // A find now carries a fee set by its badge (v1.85), so the board has to say
  // which ones the club can actually pay for — a SIGN button that fails on click
  // would be the worst version of this.
  const affordable = (r: ProspectReport) => team.budget >= prospectSignFee(TUNING, r.tier);
  // Reports accumulate across a scout's trips (v12), so order them newest-batch
  // first and keep each batch together — otherwise a big 5★ shortlist and the
  // previous trip's leftovers read as one undifferentiated pile.
  const sortedReports = [...reports].sort(
    (a, b) => b.day - a.day || (b.batch ?? 0) - (a.batch ?? 0) || b.player.overall - a.player.overall
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Section
          title="Scouts on Assignment"
          right={
            <span className="text-xs text-faint">
              <span className={`tnum font-semibold ${assignments.length >= capacity ? "text-gold" : "text-ink"}`}>
                {assignments.length}
              </span>{" "}
              / {capacity} out
            </span>
          }
        >
          {roster.length === 0 ? (
            <Card className="p-4 text-sm text-dim">
              No scouts on the books — hire one under <b className="text-ink">Personnel</b> above and you can start
              sending them abroad. A scout&apos;s <b className="text-ink">experience</b> sets how many prospects a report
              brings back, and their <b className="text-ink">judgement</b> sets how good those prospects are.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="space-y-2">
                {assignments.map((a) => {
                  const briefArch = (a.archetypes ?? []).map((id) => ARCHETYPE_MAP[id]?.name).filter(Boolean);
                  const s = scoutById(game, a.scoutId);
                  // How far through the current report cycle this scout is. The
                  // assignment stores only the next report day, so the cycle
                  // start is that day minus the engine's own cadence for this
                  // scout — never re-derived here (see reportCadence).
                  const cadence = Math.max(1, reportCadence(game, TUNING, s ?? undefined));
                  const daysToReport = Math.max(0, a.nextReportDay - game.currentDay);
                  const cyclePct = ((cadence - Math.min(daysToReport, cadence)) / cadence) * 100;
                  return (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-raised px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <Flag nat={scoutRegion(a.region).nats[0] ?? "ENG"} size={12} />
                          <span className="font-medium">{scoutRegion(a.region).label}</span>
                          <span className="text-faint">·</span>
                          <span className="text-dim">{posGroupLabel(a.positions)}</span>
                        </div>
                        {s && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="text-dim">{s.name}</span>
                            <span className="display rounded-sm border border-line px-1 text-[9px] text-faint">
                              EXP {s.experience}★
                            </span>
                            <span className="display rounded-sm border border-line px-1 text-[9px] text-faint">
                              JUDGE {s.judgement}★
                            </span>
                            <span className="text-faint">
                              · ~{expectedReportSize(TUNING, s.experience).toFixed(1)} per report
                            </span>
                          </div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-faint">
                          {briefArch.length > 0 ? (
                            briefArch.map((n) => (
                              <span key={n} className="display rounded-sm border border-gold-lo/40 px-1 text-[9px] font-semibold text-gold">
                                {n}
                              </span>
                            ))
                          ) : (
                            <span className="italic">any player type</span>
                          )}
                        </div>

                        {/* The auto-filter this scout is working to (v1.67), plus
                            a warning when it has been silencing them — a filtered
                            brief that files nothing looks identical to a broken
                            pipeline otherwise. */}
                        {filterIsActive(TUNING, a.filter) && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="display rounded-sm border border-line px-1 text-[9px] font-semibold text-dim">
                              FILTERED
                            </span>
                            <span className="text-faint">{describeFilter(a.filter).replace(/^Brief: /, "")}</span>
                            {(a.emptyReports ?? 0) >= 2 && (
                              <span className="text-danger" title="This brief keeps coming back empty">
                                · {a.emptyReports} blank cycles
                              </span>
                            )}
                          </div>
                        )}

                        {/* The trip's timeline. "next report ~15d" as bare text
                            gave no sense of movement; the bar fills as the cycle
                            runs down, so an assignment about to file reads
                            differently from one just sent. */}
                        <div className="mt-2 space-y-1">
                          <MiniBar pct={cyclePct} className={daysToReport <= 2 ? "gold-grad" : "bg-dim/60"} trackClass="bg-line/70" />
                          <div className="flex items-center justify-between gap-2 text-[10px] text-faint">
                            {/* Number and unit stay inside one tnum span — split
                                across two, the display tracking reads "14d" as
                                "140". */}
                            <span title="Days until this scout files their next batch of prospects">
                              Next report ~
                              <span className="tnum text-dim">{Math.max(1, a.nextReportDay - game.currentDay)}d</span>
                            </span>
                            {a.endsDay !== undefined && (
                              <span title="When the assignment ends and the scout comes home">
                                Returns ~
                                <span className="tnum text-dim">
                                  {Math.max(1, Math.round((a.endsDay - game.currentDay) / 7))}w
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeScout(a.id)}
                        title="Recall this scout — frees them for a new brief"
                        aria-label="Recall this scout"
                        className="h-9 w-9 shrink-0 self-start rounded border border-line bg-surface text-sm text-dim transition-colors hover:border-loss/60 hover:bg-loss/10 hover:text-loss md:h-7 md:w-7"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                {assignments.length === 0 && (
                  <div className="rounded border border-dashed border-line px-3 py-4 text-center text-sm text-faint">
                    No scouts on assignment yet.
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 text-[11px] text-faint">
                  {free.length === 0
                    ? "Every scout is out. Recall one, or hire more under Personnel."
                    : `${free.length} scout${free.length === 1 ? "" : "s"} available to send.`}
                </span>
                <GoldButton
                  onClick={() => setSending(true)}
                  disabled={free.length === 0}
                  className="shrink-0 !px-4 !py-1.5 text-xs"
                >
                  + SEND A SCOUT
                </GoldButton>
              </div>
            </Card>
          )}
        </Section>

      </div>

      <Section
        title="Prospect Reports"
        right={
          <span className="flex items-center gap-1.5 text-xs" title="Reports still on the board — each expires when its trail goes cold">
            <span className="opacity-70" aria-hidden>
              📋
            </span>
            <span className="text-[9px] uppercase tracking-widest text-mute">Live reports</span>
            <span className={`display tnum text-sm font-semibold ${reports.length > 0 ? "text-gold" : "text-dim"}`}>
              {reports.length}
            </span>
          </span>
        }
      >
        {reports.length === 0 ? (
          <Card className="p-4 text-sm text-faint">No live reports. Trails go cold after {TUNING.scoutReportExpiryDays} days.</Card>
        ) : (
          <div className="space-y-3">
            {academyFull && (
              <Card className="border-loss/50 p-3 text-[13px] text-dim">
                Academy is full ({team.academyPlayerIds?.length ?? 0}/{academySquadCap(game, team.id, TUNING)}). Release a prospect or
                upgrade <b className="text-ink">Academy Squad Size</b> before signing another.
              </Card>
            )}
            {sortedReports.map((r) => {
              const p = r.player;
              const v = potentialView(game, p, TUNING);
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      onClick={() => viewProspect(p)}
                      title="Open the full report — attributes, traits and history — before you sign"
                      className="group flex min-w-0 items-center gap-2 text-left"
                    >
                      <PosBadge pos={p.positions[0]} />
                      <Flag nat={p.nationality} size={12} />
                      <span className="truncate font-semibold transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                      <span className="tnum text-xs text-faint">age {p.age}</span>
                      {r.region && (
                        <span className="display rounded-sm border border-line px-1 text-[9px] font-semibold text-faint">
                          {scoutRegion(r.region).short}
                        </span>
                      )}
                      {r.tier && (
                        <span
                          className="display shrink-0 rounded-sm border px-1.5 text-[9px] font-bold uppercase tracking-wide"
                          style={{ borderColor: `${TIER_COLOR[r.tier]}77`, color: TIER_COLOR[r.tier] }}
                          title={`${TIER_LABEL[r.tier]} prospect — the tier your scout's judgement turned up`}
                        >
                          {TIER_LABEL[r.tier]}
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-faint">OVR</span>
                      <OvrPill value={p.overall} />
                      <span className="text-xs text-faint">POT</span>
                      <StarRange lo={v.loStars} hi={v.hiStars} />
                    </div>
                  </div>
                  {/* Discrete tags rather than one dot-separated grey sentence,
                      with the scout pushed right — whose find this is reads as a
                      byline, not as another clause in the middle of the line. */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <MetaTag icon="🎯" title="Player type your scout filed this prospect under">
                      <ArchetypeLabel p={p} icon={false} />
                    </MetaTag>
                    <MetaTag icon="📅" title="How long ago this report was filed">
                      {(() => {
                        const age = game.currentDay - r.day;
                        // Spelled out rather than "25d ago": in the condensed
                        // display face the tracking between the number and a
                        // bare "d" makes "25d" read as "250".
                        if (age <= 0) return "Found today";
                        return `Found ${age} ${age === 1 ? "day" : "days"} ago`;
                      })()}
                    </MetaTag>
                    {(() => {
                      const s = scoutById(game, r.scoutId);
                      if (!s) return null;
                      return (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-faint" title="The scout who filed this report">
                          <span className="opacity-60" aria-hidden>
                            🔍
                          </span>
                          {s.name}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-3">
                    <span className="flex flex-wrap items-center gap-3 text-xs text-faint">
                      {/* The fee is the badge's (v1.85), so it sits beside the
                          badge's own language rather than reading as a market
                          valuation — this is a scholarship, not a transfer. */}
                      <span>
                        <span
                          className={`display text-sm font-semibold ${
                            affordable(r) ? "text-gold" : "text-loss"
                          }`}
                        >
                          {formatMoney(prospectSignFee(TUNING, r.tier))}
                        </span>{" "}
                        · youth terms
                      </span>
                      {/* Market value beside the fee, never instead of it: the
                          fee is set by the badge and the valuation by the
                          player, so the gap between them is the whole judgement
                          on a signing. A kid already worth more than his
                          scholarship costs is a bargain you can see. */}
                      <span title="What he'd be valued at on the open market — the fee left of this is what he actually costs">
                        <span className="display text-sm font-semibold text-ink">
                          {formatMoney(p.value)}
                        </span>{" "}
                        · market value
                      </span>
                      <TrailTimer daysLeft={r.expiresDay - game.currentDay} />
                      {academyFull && <span className="text-loss">Academy full</span>}
                      {!academyFull && !affordable(r) && <span className="text-loss">Can't afford</span>}
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <GhostButton onClick={() => viewProspect(p)} className="!px-3 !py-1 text-xs">
                        View
                      </GhostButton>
                      {/* Passing throws the prospect away, so it must not look
                          like View. Muted red outline: clearly dismissive, but
                          still quieter than the gold primary. */}
                      <button
                        onClick={() => dismiss(r.id)}
                        title="Pass — drop this prospect from the board"
                        className="rounded-md border border-loss/40 bg-transparent px-3 py-1 text-xs text-loss/80 transition-colors hover:border-loss/70 hover:bg-loss/10 hover:text-loss"
                      >
                        Pass
                      </button>
                      <GoldButton
                        onClick={() => sign(r.id)}
                        disabled={academyFull || !affordable(r)}
                        className="!px-4 !py-1 text-xs"
                      >
                        SIGN
                      </GoldButton>
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {sending && <SendScoutModal onClose={() => setSending(false)} />}
    </div>
  );
}

/**
 * Where to send the scout (v17): continent → region → country, narrowing at each
 * step. Replaces a single flat dropdown that only offered ten countries, and
 * makes the whole scoutable world reachable — Asia → East Asia → Japan.
 *
 * Each level can also be taken as the brief itself: stopping at "Asia" scouts
 * the whole continent, stopping at "East Asia" scouts that region. Country rows
 * show their flag before the name.
 */
function RegionPicker({ region, onChange }: { region: ScoutRegion; onChange: (r: ScoutRegion) => void }) {
  // Open the picker wherever the current target lives, so re-opening it with a
  // country already chosen doesn't dump you back at the top of the tree.
  const located = locateTarget(region);
  const [continentId, setContinentId] = useState<string>(
    located?.continent ?? (SCOUT_WORLD.find((c) => c.id === region) ? region : "Europe")
  );
  const [regionId, setRegionId] = useState<string>(located?.region ?? "");

  const continent = SCOUT_WORLD.find((c) => c.id === continentId) ?? SCOUT_WORLD[0];
  const subRegion = continent.regions.find((r) => r.id === regionId) ?? null;

  const chip = chipClass;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-faint">Where to scout</span>
        <span className="text-[11px] text-dim">
          Brief: <span className="text-gold">{scoutRegion(region).label}</span>
        </span>
      </div>

      {/* 1 — continent */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {SCOUT_WORLD.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setContinentId(c.id);
              setRegionId("");
              onChange(c.id); // the continent itself is a valid brief
            }}
            className={chip(continentId === c.id)}
          >
            {c.label}
          </button>
        ))}
        <button onClick={() => onChange("World")} className={chip(region === "World")}>
          Worldwide
        </button>
      </div>

      {/* 2 — region within the continent */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{continent.label} — region</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {continent.regions.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setRegionId(r.id);
                // A single-country region has no broader target of its own, so
                // selecting it is the same as selecting that country.
                onChange(r.countries.length > 1 ? r.id : r.countries[0].id);
              }}
              className={chip(regionId === r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3 — country within the region */}
      {subRegion && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">{subRegion.label} — country</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {subRegion.countries.map((c) => (
              <button key={c.id} onClick={() => onChange(c.id)} className={chip(region === c.id)}>
                <span className="flex items-center gap-1.5">
                  <Flag nat={c.id} size={11} />
                  <span className="min-w-0 truncate">{c.label}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Send a scout (v2.1): pick who goes and WHERE, and nothing else.
 *
 * The brief used to carry five more decisions — a position group, an archetype
 * shortlist, a trip length and, behind a level-5 facility, a whole acceptance
 * filter with age, ability and rarity clauses. That is a form, and it stood
 * between the manager and the one question sending a scout actually asks: which
 * part of the world do you want to look at. Region alone also makes the price
 * legible, since the travel band — the only thing that moves the cost — is now
 * the only thing on the screen that can change it.
 *
 * The trip is open-ended by construction: with no duration control there is no
 * duration to commit to, so the scout files until he is recalled from the
 * Operations pane. The engine's brief fields still exist and are simply left at
 * their "no preference" values, so nothing downstream had to change.
 */
function SendScoutModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const addScout = useGame((s) => s.academyAddScout);
  const free = idleScouts(game);
  const [scoutId, setScoutId] = useState<string>(free[0]?.id ?? "");
  const [region, setRegion] = useState<ScoutRegion>("ENG");

  const chosenScout = free.find((s) => s.id === scoutId);
  const perReport = chosenScout ? expectedReportSize(TUNING, chosenScout.experience) : 0;

  // What this trip costs (v1.85). Quoted from the same function that charges it,
  // so the modal can never advertise a price the engine then doesn't take.
  // Duration 0 = open-ended, which is the only shape of trip this modal sends.
  const quote = scoutTripQuote(game, TUNING, region, 0);
  const affordable = game.teams[game.userTeamId].budget >= quote.total;

  const confirm = () => {
    addScout(region, "ANY", [], scoutId || undefined, 0, undefined);
    onClose();
  };

  return (
    <Modal title="Send a scout" onClose={onClose}>
      <div className="space-y-4">
        {/* Which scout goes: their two ratings decide what comes back, so this
            is the most consequential choice in the whole brief. */}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">Scout</div>
          <div className="space-y-1.5">
            {free.map((s) => {
              const on = s.id === scoutId;
              return (
                <button
                  key={s.id}
                  onClick={() => setScoutId(s.id)}
                  className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${
                    on ? "border-gold-lo/60 bg-hover" : "border-line bg-raised hover:border-faint"
                  }`}
                >
                  <Flag nat={s.nationality} size={12} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${on ? "text-gold" : "text-ink"}`}>{s.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
                      <span>EXP {s.experience}★</span>
                      <span>·</span>
                      <span>JUDGE {s.judgement}★</span>
                      <span>·</span>
                      <span>~{expectedReportSize(TUNING, s.experience).toFixed(1)} per report</span>
                      <span>·</span>
                      <span style={{ color: TIER_COLOR.diamond }}>
                        {tierPct(tierChance(TUNING, s.judgement, "diamond"))} diamond
                      </span>
                    </div>
                  </div>
                  {on && <span className="display shrink-0 text-[11px] font-bold text-gold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <RegionPicker region={region} onChange={setRegion} />

        {/* What the trip costs (v1.85). The band is shown alongside the money
            because the band is the thing the manager can actually change — the
            price follows from how far the brief sends him. */}
        <div className="rounded-md border border-line bg-raised/50 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[10px] uppercase tracking-widest text-faint">
              Travel · {TRAVEL_BAND_LABEL[quote.band]}
            </span>
            <span className={`display tnum text-[15px] font-bold ${affordable ? "text-gold" : "text-loss"}`}>
              {formatMoney(quote.total)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-dim">
            {formatMoney(quote.upfront)} up front, then {formatMoney(quote.weekly)}/wk for as long as they stay out.
            Recall them from the Operations pane when you&apos;ve seen enough.
          </p>
          {!affordable && (
            <p className="mt-1 text-[11px] leading-snug text-loss">
              Your budget is {formatMoney(game.teams[game.userTeamId].budget)}. Send them somewhere closer to home.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
            {chosenScout
              ? `~${perReport.toFixed(1)} prospects per report — anything they find is filed.`
              : "Hire a scout first."}
          </span>
          <span className="flex items-center gap-2">
            <GhostButton onClick={onClose} className="!px-3 !py-1.5 text-xs">
              Cancel
            </GhostButton>
            <GoldButton onClick={confirm} disabled={!affordable || !chosenScout} className="!px-5 !py-1.5 text-xs">
              SEND · {formatMoney(quote.total)}
            </GoldButton>
          </span>
        </div>
      </div>
    </Modal>
  );
}

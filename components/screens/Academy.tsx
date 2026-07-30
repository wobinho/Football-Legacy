"use client";

// Academy (§18, 9th screen): the youth pillar. Academy squad with fog-of-war
// potential, the background U21 league, the scouting pipeline, and loans —
// all the "grow your own" decisions in one place.

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Pos, PlayerBio, ProspectTier, ScoutPosGroup, ScoutRegion, U21Opponent } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { ARCHETYPES, getArchetype } from "@/lib/config/archetypes";
import {
  academyGrowthSummary,
  academyPlayers,
  prospectGrowth,
  isAcademyLoanee,
  type ProspectGrowth,
  loanedOutPlayers,
  focusSlots,
  pendingGraduates,
  potentialView,
  reportCadence,
  describeFilter,
  filterIsActive,
  filterPassRate,
  normalizeFilter,
  scoutCapacity,
  u21Eligible,
  u21OpponentByName,
  u21OpponentProspects,
  u21ProspectQuote,
  u21RegistrationDaysLeft,
  u21RegistrationOpen,
  u21Registered,
  u21Shortfall,
  U21_SIDE_SIZE,
  U21_MIN_GK,
  U21_MIN_OUTFIELD,
} from "@/lib/academy";
import { POS_GROUP_COLORS, POS_LABELS, POS_ORDER, posGroup } from "@/lib/config/positions";
import { academySquadCap, trainingNextCost } from "@/lib/economy";
import { optimalTrainingPlan, plansForPosition, resolveTrainingPlan, type TrainingPlanDef } from "@/lib/config/training";
import { devPhase, seasonAttrFocus, seasonGrowth, seasonGrowthEstimate } from "@/lib/development";
import { SCOUT_WORLD, locateTarget, scoutRegion } from "@/lib/config/scouting";
import {
  expectedReportSize,
  idleScouts,
  maxScouts,
  scoutById,
  tierChance,
  TIER_COLOR,
  TIER_LABEL,
} from "@/lib/scouts";
import { transferWindowState, formatDayShort } from "@/lib/calendar";
import { formatMoney } from "@/lib/value";
import { matchesPlayerName } from "@/lib/search";
import { staffSlotsForDept } from "@/lib/staff";
import { Card, ConfirmButton, CountryFlag, Crest, displayFullName, Flag, GhostButton, GoldButton, Modal, Ovr, PlayerCard, PlayerGrid, PosBadge, PotentialBadge, Section, Stars, StarRange, Tabs, UpgradeCard, usePlayerView, ViewToggle } from "../ui";
// The loan chooser is shared with the senior squad now (v1.52) — both squads
// resolve a move the same way, so the modal lives outside this screen.
import { LoanOfferModal } from "./SquadMoveModals";

// The Staff tab is gone (v1.65): the Youth Coach and the scout roster were split
// across two tabs from the assignments they drive, so hiring a scout and sending
// one out were different pages. Scouting is now the single academy-personnel
// surface — coach, department, assignments and reports in one place.
type Tab = "squad" | "development" | "growth" | "loaned" | "u21" | "scouting" | "upgrades";

export default function AcademyScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<Tab>("squad");
  const reports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay);
  const loanedCount = loanedOutPlayers(game).length;

  return (
    <div>
      <Tabs
        tabs={[
          { id: "squad", label: "Academy Squad" },
          { id: "scouting", label: "Scouting", badge: reports.length },
          { id: "development", label: "Development" },
          { id: "growth", label: "Growth" },
          { id: "upgrades", label: "Upgrades" },
          { id: "loaned", label: "Loaned Players", badge: loanedCount },
          { id: "u21", label: "U21 League" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "squad" && <SquadTab />}
      {tab === "development" && <AcademyDevelopmentTab />}
      {tab === "growth" && <AcademyGrowthTab />}
      {tab === "loaned" && <LoanedTab />}
      {tab === "u21" && <U21Tab />}
      {tab === "scouting" && <ScoutingTab />}
      {tab === "upgrades" && <UpgradesTab />}
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
          {full && <span className="text-[11px] text-gold">Department full — release a scout or upgrade Max Scouts.</span>}
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

/** The Youth Coach — one prominent card. This is the person who runs the show. */
function YouthCoachPanel({ def }: { def: ReturnType<typeof staffSlotsForDept>[number] }) {
  const game = useGame((s) => s.game)!;
  const hire = useGame((s) => s.hire);
  const dismiss = useGame((s) => s.dismissStaff);
  const fire = useGame((s) => s.fireStaff);
  const team = game.teams[game.userTeamId];
  const current = team.staff.youthCoach;
  const all = game.staffMarket.filter((c) => c.slot === "youthCoach");
  const ready = all.filter((c) => c.availableDay === undefined || c.availableDay <= game.currentDay);
  const pending = all.length > 0 && ready.length === 0;

  return (
    <Section title="Youth Coach" right={<span className="text-xs text-faint">{def.buff}</span>}>
      <Card className="overflow-hidden border-gold bg-gradient-to-br from-gold-lo/[0.10] to-transparent p-5 shadow-[0_0_0_1px_rgba(217,164,65,0.15)]">
        <div className="flex flex-wrap items-center gap-5">
          {/* coach identity */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-gold-lo/50 bg-gold-lo/10 text-3xl">
            🎓
          </div>
          <div className="min-w-0 flex-1">
            <div className="display text-[10px] uppercase tracking-widest text-gold">Runs your academy</div>
            {current ? (
              <>
                <div className="mt-0.5 flex items-center gap-2">
                  <Flag nat={current.nationality} size={13} />
                  <span className="text-lg font-semibold">{current.name}</span>
                  <Stars n={current.stars} />
                </div>
                <div className="mt-0.5 text-xs text-faint">{formatMoney(current.wage)}/wk</div>
              </>
            ) : (
              <div className="mt-1 text-lg font-semibold text-faint">No youth coach appointed</div>
            )}
          </div>
          {/* live impact */}
          <div className="rounded-md border border-line bg-raised px-4 py-2 text-center">
            <div className="text-[10px] uppercase tracking-widest text-faint">Academy growth</div>
            <div className={`display text-lg font-bold ${current ? "gold-text" : "text-faint"}`}>
              {def.effectAt ? def.effectAt(current?.stars ?? 0) : "—"}
            </div>
          </div>
          {current && (
            <ConfirmButton
              label="Fire"
              confirmLabel={`Fire ${current.name}?`}
              tone="danger"
              onConfirm={() => fire("youthCoach")}
              className="!px-3 !py-1.5 text-xs"
            />
          )}
        </div>

        {(ready.length > 0 || pending) && (
          <div className="mt-4 border-t border-line/60 pt-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-[10px] uppercase tracking-widest text-faint">Available to appoint</span>
              <MarketRefreshTimer />
            </div>
            {pending ? (
              <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-faint">
                Shortlist cleared — new candidates arrive in a couple of days.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ready.map((c) => {
                  const better = current ? c.stars > current.stars : true;
                  return (
                    <Card key={c.id} className="flex flex-col border-gold-lo/40 p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Flag nat={c.nationality} size={11} />
                          <span className="truncate text-sm font-medium">{c.name}</span>
                        </span>
                        <Stars n={c.stars} />
                      </div>
                      {def.effectAt && (
                        <div className={`mt-1 text-[11px] ${better ? "text-win" : "text-dim"}`}>{def.effectAt(c.stars)}</div>
                      )}
                      <div className="mt-1 text-[11px] text-faint">
                        Fee {formatMoney(c.fee)} · {formatMoney(c.wage)}/wk
                      </div>
                      <div className="mt-2 flex items-stretch gap-1.5">
                        <ConfirmButton
                          label={current ? "Replace" : "Appoint"}
                          confirmLabel="Confirm?"
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
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Card>
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
  if ((game.academy.u21.registered ?? []).includes(p.id)) chips.push({ label: "U21 REG", cls: "border-win/40 text-win" });
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
const SQUAD_GRID = "md:grid-cols-[2.25rem_1fr_2.5rem_3rem_4.5rem_minmax(0,22rem)]";

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
  const toggleFocus = useGame((s) => s.academyToggleFocus);
  const recall = useGame((s) => s.academyRecall);
  const [view, setView] = usePlayerView("academy");
  // Which prospect (if any) has the "Send on Loan" chooser open.
  const [loanFor, setLoanFor] = useState<string | null>(null);

  const team = game.teams[game.userTeamId];
  const seniorRoom = TUNING.squadCap - team.playerIds.length;
  const windowOpen = transferWindowState(game.currentDay, game.schedule).open;
  // Prospects locked to the U21 competition can't be promoted mid-competition.
  const u21Registered = new Set(game.academy.u21.registered ?? []);

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
      hint: "Prospects in the academy — upgrade Academy Squad Size for more room",
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

  const loanModal = loanFor ? (
    <LoanOfferModal playerId={loanFor} onClose={() => setLoanFor(null)} />
  ) : null;

  if (view === "grid")
    return (
      <>
        <GraduatesPanel />
        {grid()}
        {loanModal}
      </>
    );

  return (
    <div className="space-y-6">
      {loanModal}
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
          <span className="text-center">Age</span>
          <span className="text-center">OVR</span>
          <span className="text-center">Potential</span>
          <span className="text-right">Actions</span>
        </div>
        {roster.length === 0 && (
          <div className="px-4 py-6 text-sm text-faint">
            {allProspects.length === 0
              ? "No academy prospects yet — the first intake class arrives in March, and your scout can find more."
              : "No prospects match these filters."}
          </div>
        )}
        {roster.map((p) => {
          const chips = statusChips(game, p);
          const isFocus = game.academy.focusIds.includes(p.id);
          const registered = u21Registered.has(p.id);
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
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    {getArchetype(p.archetypeId).name}
                    {chips.map((c) => (
                      <span key={c.label} className={`display rounded-sm border px-1 text-[9px] font-semibold ${c.cls}`}>
                        {c.label}
                      </span>
                    ))}
                  </span>
                </button>
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
                  registered={registered}
                  windowOpen={windowOpen}
                  seniorRoom={seniorRoom}
                  onToggleFocus={toggleFocus}
                  onLoanClick={setLoanFor}
                  onRecall={recall}
                  onPromote={promote}
                  onRelease={release}
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
              ? "No academy prospects yet — the first intake class arrives in March, and your scout can find more."
              : "No prospects match these filters."}
          </Card>
        ) : (
          <PlayerGrid>
            {roster.map((p) => {
              const chips = statusChips(game, p);
              const isFocus = game.academy.focusIds.includes(p.id);
              const registered = u21Registered.has(p.id);
              return (
                <PlayerCard
                  key={p.id}
                  p={p}
                  onOpen={() => viewPlayer(p.id)}
                  ovr={<Ovr value={p.overall} size="sm" />}
                  sub={<span className="truncate">{getArchetype(p.archetypeId).name}</span>}
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
                      registered={registered}
                      windowOpen={windowOpen}
                      seniorRoom={seniorRoom}
                      onToggleFocus={toggleFocus}
                      onLoanClick={setLoanFor}
                      onRecall={recall}
                      onPromote={promote}
                      onRelease={release}
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
 * release), shared between the academy squad's list rows and its grid cards so
 * both offer exactly the same controls. */
function SquadActions({
  p,
  isFocus,
  registered,
  windowOpen,
  seniorRoom,
  onToggleFocus,
  onLoanClick,
  onRecall,
  onPromote,
  onRelease,
}: {
  p: PlayerBio;
  isFocus: boolean;
  registered: boolean;
  windowOpen: boolean;
  seniorRoom: number;
  onToggleFocus: (id: string) => void;
  onLoanClick: (id: string) => void;
  onRecall: (id: string) => void;
  onPromote: (id: string) => void;
  onRelease: (id: string) => void;
}) {
  // Training-plan selection lives on the Academy Development tab now, not in the
  // per-prospect action cluster, so the squad row stays about squad decisions.
  return (
    <>
      <TextBtn
        label={isFocus ? "★ Focus" : "☆ Focus"}
        title={isFocus ? "Remove focus" : "Make focus prospect (guaranteed U21 starts + coaching)"}
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
            registered
              ? "Registered for the U21 competition — can't be loaned out until the next window"
              : windowOpen
                ? "Find clubs willing to take them on a development loan"
                : "Loans can only be arranged during a transfer window"
          }
          onClick={() => onLoanClick(p.id)}
          disabled={!windowOpen || registered}
        />
      )}
      <TextBtn
        label="Promote"
        title={
          registered
            ? "Registered for the U21 competition — can't be promoted until the next registration window"
            : p.age < TUNING.academyPromoteMinAge
              ? `Too young — prospects join the senior squad at ${TUNING.academyPromoteMinAge}`
              : seniorRoom > 0
                ? "Promote to the senior (first) team"
                : "Senior squad is full — sell or release someone first"
        }
        onClick={() => onPromote(p.id)}
        disabled={seniorRoom <= 0 || !!p.loan || p.age < TUNING.academyPromoteMinAge || registered}
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

// ── Academy development (v1.46) ─────────────────────────────────────────────
// The academy's own Training Plans tab: the same per-player development focus
// the senior squad gets on the Development screen, but scoped to the academy
// prospects (who were removed from the senior Training Plans tab). Each row
// expands to show a one-season growth projection, where that growth flows, and
// the growth history — exactly like the senior tab, so a manager grows a
// prospect here the same way he grows a first-teamer there.

// Shared grid template for the academy training-plan header + rows. The focus
// dropdown track narrows on phones so a row still fits a small screen.
const ACADEMY_PLAN_GRID = "grid-cols-[2rem_1fr_2rem_2.5rem_8rem] sm:grid-cols-[2.25rem_1fr_2.5rem_3rem_11rem]";

const ACADEMY_ATTR_LABELS: [keyof PlayerBio["attrs"], string][] = [
  ["pac", "PAC"], ["sho", "SHO"], ["pas", "PAS"], ["dri", "DRI"], ["def", "DEF"], ["phy", "PHY"],
];

function academyDevPhaseChip(phase: "growth" | "prime" | "decline") {
  const map = {
    growth: { label: "Growing", cls: "text-win border-win/40" },
    prime: { label: "Prime", cls: "text-gold border-gold-lo/40" },
    decline: { label: "Declining", cls: "text-loss border-loss/40" },
  } as const;
  const m = map[phase];
  return <span className={`display rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}

function AcademyAttrProjection({ p, delta, plan }: { p: PlayerBio; delta: number; plan: TrainingPlanDef }) {
  const gains = seasonAttrFocus(p, delta, plan);
  return (
    <div className="space-y-1.5">
      {ACADEMY_ATTR_LABELS.map(([k, label]) => {
        const now = p.attrs[k];
        const gain = gains[k];
        const next = Math.min(99, now + gain);
        return (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="display w-8 text-faint">{label}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-line">
              <div className="absolute inset-y-0 left-0 bg-dim/60" style={{ width: `${now}%` }} />
              {gain > 0 && (
                <div className="absolute inset-y-0 gold-grad opacity-70" style={{ left: `${now}%`, width: `${next - now}%` }} />
              )}
            </div>
            <span className="w-14 text-right tnum">
              {now}
              {gain > 0 && <span className="text-win"> → {next}</span>}
            </span>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] leading-snug text-faint">
        {delta > 0
          ? "Where this season's growth is expected to flow — steered by the archetype and the training focus."
          : "No growth expected this season, so no attribute movement projected."}
      </p>
    </div>
  );
}

function AcademyDevelopmentTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setPlan = useGame((s) => s.setTrainingPlan);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = usePlayerView("academyDev");

  const team = game.teams[game.userTeamId];
  const devCoachStars = team.staff.devCoach?.stars ?? 0;
  const trainingLevel = team.trainingLevel ?? 0;

  // Academy prospects only, ordered position-first (keepers lead) so the list
  // reads in team-sheet order — the same default as the senior tab.
  const squad = academyPlayers(game).sort(
    (a, b) => (POS_ORDER.indexOf(a.positions[0]) - POS_ORDER.indexOf(b.positions[0])) || a.name.localeCompare(b.name)
  );

  const suboptimal = squad.filter(
    (p) => resolveTrainingPlan(p.trainingPlan, p.positions[0]).id !== optimalTrainingPlan(p).id
  );

  const autoAssignAll = () => {
    for (const p of suboptimal) setPlan(p.id, optimalTrainingPlan(p).id);
  };

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="display font-semibold text-ink">Optimal training focus</div>
          <div className="text-[12px] leading-relaxed text-faint">
            {squad.length === 0 ? (
              "No academy prospects yet — the first intake class arrives in March, and your scout can find more."
            ) : suboptimal.length > 0 ? (
              <>
                <span className="text-gold">{suboptimal.length}</span> prospect{suboptimal.length === 1 ? " is" : "s are"} on a
                focus that isn&apos;t the best fit. Auto-assign picks the plan that lifts each prospect&apos;s overall
                fastest, from their archetype, position and how much room each attribute still has.
              </>
            ) : (
              "Every prospect is already training the focus that suits them best."
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          <GoldButton onClick={autoAssignAll} disabled={suboptimal.length === 0} className="!py-1.5 text-xs">
            AUTO-ASSIGN ALL
          </GoldButton>
        </div>
      </Card>

      {squad.length === 0 ? null : view === "grid" ? (
        <PlayerGrid>
          {squad.map((p) => {
            const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
            const options = plansForPosition(p.positions[0]);
            const best = optimalTrainingPlan(p);
            const isOptimal = plan.id === best.id;
            const growing = p.age <= TUNING.growthEndAge;
            const last = p.devLog && p.devLog.length ? p.devLog[p.devLog.length - 1] : null;
            return (
              <PlayerCard
                key={p.id}
                p={p}
                onOpen={() => viewPlayer(p.id)}
                ovr={<Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />}
                sub={
                  <span className="flex items-center gap-1.5 truncate">
                    <TierTag tier={p.u21Tier} />
                    <span className="truncate">{growing ? "Still developing" : "Reached maturity"}</span>
                  </span>
                }
                stats={
                  last && last.toOverall !== last.fromOverall ? (
                    <span className={`tnum ${last.toOverall > last.fromOverall ? "text-win" : "text-loss"}`}>
                      {last.toOverall > last.fromOverall ? "+" : ""}
                      {last.toOverall - last.fromOverall} last season
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )
                }
                actions={
                  <span className="flex w-full items-center gap-1.5">
                    <span
                      className={`shrink-0 text-[10px] leading-none ${isOptimal ? "text-win" : "text-gold"}`}
                      title={isOptimal ? "Optimal training focus" : `Recommended: ${best.name}`}
                    >
                      {isOptimal ? "●" : "○"}
                    </span>
                    <select
                      value={plan.id}
                      onChange={(e) => setPlan(p.id, e.target.value)}
                      className="min-w-0 flex-1 truncate rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink focus:border-gold focus:outline-none"
                      title={plan.blurb}
                    >
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </span>
                }
              />
            );
          })}
        </PlayerGrid>
      ) : (
        <Card className="divide-y divide-line/50">
          <div className={`grid ${ACADEMY_PLAN_GRID} items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint`}>
            <span>Pos</span>
            <span>Prospect</span>
            <span className="text-center">Age</span>
            <span className="text-center">OVR</span>
            <span className="text-center">Training focus</span>
          </div>
          {squad.map((p) => {
            const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
            const options = plansForPosition(p.positions[0]);
            const best = optimalTrainingPlan(p);
            const isOptimal = plan.id === best.id;
            const isOpen = open === p.id;
            const phase = devPhase(p, TUNING);
            const season = seasonGrowthEstimate(p, TUNING, devCoachStars, trainingLevel, plan);
            const last = p.devLog && p.devLog.length ? p.devLog[p.devLog.length - 1] : null;

            return (
              <div key={p.id}>
                <div className={`grid ${ACADEMY_PLAN_GRID} items-center gap-3 px-4 py-2.5`}>
                  <PosBadge pos={p.positions[0]} />
                  <button
                    onClick={() => setOpen(isOpen ? null : p.id)}
                    className="group flex min-w-0 items-center gap-2 text-left"
                  >
                    <span className={`shrink-0 text-[10px] text-faint transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                    <Flag nat={p.nationality} size={12} />
                    <span className="truncate font-medium transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                    <TierTag tier={p.u21Tier} />
                    {last && last.toOverall !== last.fromOverall && (
                      <span className={`text-[11px] tnum ${last.toOverall > last.fromOverall ? "text-win" : "text-loss"}`}>
                        {last.toOverall > last.fromOverall ? "+" : ""}{last.toOverall - last.fromOverall} last season
                      </span>
                    )}
                  </button>
                  <span className="text-center tnum text-sm text-dim">{p.age}</span>
                  <span className="flex items-center justify-center">
                    <Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    <span
                      className={`shrink-0 text-[10px] leading-none ${isOptimal ? "text-win" : "text-gold"}`}
                      title={isOptimal ? "Optimal training focus" : `Recommended: ${best.name}`}
                    >
                      {isOptimal ? "●" : "○"}
                    </span>
                    <select
                      value={plan.id}
                      onChange={(e) => setPlan(p.id, e.target.value)}
                      className="w-full truncate rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
                      title={plan.blurb}
                    >
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>

                {isOpen && (
                  <div className="border-t border-line/50 bg-raised px-4 py-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-faint">
                          This season {academyDevPhaseChip(phase)}
                        </div>
                        {season && season.delta > 0 ? (
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-faint">Projected OVR</span>
                              <span className="tnum font-semibold text-win">{p.overall} → {p.overall + season.delta}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-faint">Est. growth this season</span>
                              <span className="tnum">≈ +{season.delta}</span>
                            </div>
                            <p className="pt-1 text-[11px] leading-snug text-faint">
                              An estimate for the coming season only, at academy game time with your current youth coach
                              &amp; facilities. More U21 minutes, a better Youth Coach, or a higher Youth Academy all lift it.
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-faint">
                            {phase === "decline"
                              ? "Past their peak — unusual for a prospect, but the focus now is managing minutes."
                              : "Settled — little growth expected this season."}
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">
                          This season&apos;s attribute focus
                        </div>
                        <AcademyAttrProjection p={p} delta={season?.delta ?? 0} plan={plan} />
                      </div>

                      <div>
                        <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Growth history</div>
                        {p.devLog && p.devLog.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {p.devLog.slice().reverse().map((d, i) => {
                              const delta = d.toOverall - d.fromOverall;
                              return (
                                <span key={i} className="rounded-sm border border-line bg-surface px-2 py-1 text-[11px] tnum">
                                  S{d.season}: {d.fromOverall}
                                  <span className={delta >= 0 ? "text-win" : "text-loss"}> → {d.toOverall}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-faint">No seasons on record yet.</p>
                        )}
                        <div className="mt-3">
                          <GhostButton onClick={() => viewPlayer(p.id)} className="!py-1 text-xs">
                            Full profile
                          </GhostButton>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
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
const GROWTH_GRID = "md:grid-cols-[2.25rem_1fr_2.5rem_3.5rem_4.5rem_4.5rem_4.5rem]";

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
        No academy prospects to track yet — the first intake class arrives in March, and your scout can find more.
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
                  <span className="text-[11px] text-faint">
                    {g.seasons > 0 ? `${g.seasons} season${g.seasons === 1 ? "" : "s"} on record` : "First season"}
                  </span>
                </button>
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

// ── Loaned players ─────────────────────────────────────────────────────────

/** The Loaned Players tab (v1.44; academy-only from v1.54): a monitor for the
 * ACADEMY prospects the club has out on loan. Senior pros on loan are managed
 * from the Squad page (tagged "on loan", recalled from their profile), so they
 * no longer appear here. Each row shows where he is, how he's doing (the
 * statistical loan minutes credited to youthStats this season), and a
 * window-gated Recall. */
function LoanedTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const recall = useGame((s) => s.academyRecall);
  const windowOpen = transferWindowState(game.currentDay, game.schedule).open;

  const loanees = loanedOutPlayers(game).sort((a, b) => b.overall - a.overall);

  if (loanees.length === 0) {
    return (
      <Card className="border-dashed px-4 py-8 text-center text-sm text-faint">
        No players out on loan. Send an academy prospect out from the{" "}
        <b className="text-ink">Academy Squad</b> tab to get them regular football.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <div className="rounded-md border border-line bg-surface px-3 py-1.5">
          <div className="text-[9px] uppercase tracking-widest text-faint">Out on loan</div>
          <div className="display tnum text-sm font-semibold text-ink">{loanees.length}</div>
        </div>
        {!windowOpen && (
          <div className="rounded-md border border-line bg-surface px-3 py-1.5">
            <div className="text-[9px] uppercase tracking-widest text-faint">Recalls</div>
            <div className="display text-sm font-semibold text-dim">Window shut</div>
          </div>
        )}
      </div>

      <Card className="divide-y divide-line/50">
        <div className="hidden grid-cols-[auto_1fr_1.2fr_auto_auto] items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint md:grid">
          <span>Pos</span>
          <span>Player</span>
          <span>Loan club</span>
          <span className="text-center">This season</span>
          <span className="text-right">Actions</span>
        </div>
        {loanees.map((p) => {
          const dest = game.teams[p.loan!.toClubId];
          const league = dest ? game.leagues[dest.leagueId] : undefined;
          const ys = p.youthStats;
          const avg = ys?.apps ? (ys.ratingSum / ys.apps).toFixed(2) : null;
          const academy = isAcademyLoanee(game, p.id);
          return (
            <div
              key={p.id}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 md:grid-cols-[auto_1fr_1.2fr_auto_auto]"
            >
              <PosBadge pos={p.positions[0]} />
              <button onClick={() => viewPlayer(p.id)} className="group min-w-0 text-left">
                <span className="flex items-center gap-1.5">
                  <Flag nat={p.nationality} size={11} />
                  <span className="truncate font-medium transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                  <span
                    className={`display rounded-sm border px-1 text-[9px] font-semibold ${
                      academy ? "border-gold-lo/50 text-gold" : "border-line text-dim"
                    }`}
                  >
                    {academy ? "ACADEMY" : "SENIOR"}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-faint">
                  {p.age}y · <Ovr value={p.overall} size="sm" />
                </span>
              </button>
              <div className="col-span-3 mt-1 flex items-center gap-2 md:col-span-1 md:mt-0">
                {dest ? (
                  <>
                    <Crest colors={dest.colors} short={dest.short} size={24} />
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-sm text-ink">{dest.name}</div>
                      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-faint">
                        {/* Fixed 14px flag slot so the league name starts at the same x
                            whether or not this country has a flag asset — otherwise
                            rows without a flag shift left and the column looks ragged. */}
                        <span className="flex h-[10px] w-[14px] shrink-0 items-center justify-center">
                          <CountryFlag country={league?.country ?? ""} size={10} />
                        </span>
                        <span className="truncate">{league?.name ?? "—"}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Crest colors={["#26282e", "#6b7280"]} short="?" size={24} />
                    <span className="text-sm text-faint">Unknown club</span>
                  </>
                )}
              </div>
              <div className="col-span-3 flex items-center gap-3 text-[11px] tnum text-dim md:col-span-1 md:justify-center">
                {ys?.apps ? (
                  <>
                    <span>
                      <span className="text-faint">Apps</span> {ys.apps}
                    </span>
                    <span>
                      <span className="text-faint">Gls</span> {ys.goals}
                    </span>
                    {avg && (
                      <span className={avg && Number(avg) >= 7.2 ? "gold-text font-semibold" : ""}>
                        <span className="text-faint">Avg</span> {avg}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-faint">Yet to feature</span>
                )}
              </div>
              <span className="col-span-3 flex justify-end md:col-span-1">
                <TextBtn
                  label="Recall"
                  title={windowOpen ? "Recall from loan — he returns early and is available again" : "Loans can only be recalled during a transfer window"}
                  onClick={() => recall(p.id)}
                  disabled={!windowOpen}
                />
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ── U21 league ────────────────────────────────────────────────────────────

/** Registration panel (v18): pick exactly seven prospects (≥1 GK) and submit
 * them before the deadline. Miss it and the entry is forfeited to another club,
 * so the deadline is the loudest thing on the panel. Once submitted the seven
 * are locked for that competition — they are the only players eligible. */
function U21RegistrationPanel() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const register = useGame((s) => s.academyRegisterU21);

  const u21 = game.academy.u21;
  const done = u21Registered(game);
  const open = u21RegistrationOpen(game);
  const daysLeft = u21RegistrationDaysLeft(game);
  const focus = new Set(game.academy.focusIds);

  // Locked-in seven get shown as-is; while the window is open this is a draft
  // the user is assembling, so it lives in local state until submitted.
  const [draft, setDraft] = useState<string[]>(() => u21.registered ?? []);
  useEffect(() => setDraft(u21.registered ?? []), [u21.registered, u21.half]);

  const players = academyPlayers(game)
    .filter((p) => !p.loan)
    .sort((a, b) => {
      const da = draft.includes(a.id) ? 1 : 0;
      const db = draft.includes(b.id) ? 1 : 0;
      if (da !== db) return db - da;
      return (focus.has(b.id) ? 1 : 0) - (focus.has(a.id) ? 1 : 0) || b.overall - a.overall;
    });

  const hasGk = draft.some((id) => game.players[id]?.positions[0] === "GK");
  const complete = draft.length === TUNING.u21RegistrationSize && hasGk;

  const toggle = (id: string) =>
    setDraft((d) =>
      d.includes(id) ? d.filter((x) => x !== id) : d.length >= TUNING.u21RegistrationSize ? d : [...d, id]
    );

  if (u21.forfeited) {
    return (
      <Card className="border-loss/40 p-4">
        <div className="display text-sm font-bold text-loss">Entry Forfeited</div>
        <p className="mt-1 text-[13px] leading-relaxed text-dim">
          No squad was registered in time, so <span className="text-ink">{u21.replacedBy}</span> took our place in this
          competition. Our prospects sit it out — watch for the next registration window.
        </p>
      </Card>
    );
  }

  return (
    <Section
      title={`U21 Registration · pick ${TUNING.u21RegistrationSize}`}
      right={
        done ? (
          <span className="text-xs text-win">registered ✓</span>
        ) : daysLeft !== null ? (
          <span className={`text-xs ${daysLeft <= 3 ? "text-loss" : "text-faint"}`}>
            <span className="tnum">{daysLeft}</span>d to register
          </span>
        ) : (
          <span className="text-xs text-loss">window closed</span>
        )
      }
    >
      <Card className="p-3">
        <p className="mb-2 px-1 text-[11px] leading-snug text-faint">
          {done
            ? "These seven are your registered squad for this competition — only they can play in it."
            : `Submit ${TUNING.u21RegistrationSize} prospects (at least one goalkeeper) before the deadline, or our place goes to another club.`}
        </p>
        {players.length === 0 ? (
          <div className="px-1 py-3 text-sm text-faint">No academy players available. Loanees can&apos;t be registered.</div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {players.map((p) => {
              const on = draft.includes(p.id);
              const locked = done || !open;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                    on ? "border-gold-lo/50 bg-hover" : "border-line bg-raised"
                  }`}
                >
                  <PosBadge pos={p.positions[0]} />
                  <button onClick={() => viewPlayer(p.id)} className="group min-w-0 flex-1 truncate text-left text-sm">
                    <span className="flex items-center gap-1.5">
                      <Flag nat={p.nationality} size={11} />
                      <span className="truncate font-medium transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                      <span className="tnum text-[11px] text-faint">{p.age}y</span>
                      {focus.has(p.id) && <span className="display text-[9px] font-semibold text-gold">★</span>}
                    </span>
                  </button>
                  <Ovr value={p.overall} size="sm" />
                  <button
                    disabled={locked}
                    onClick={() => toggle(p.id)}
                    className={`display w-16 rounded px-2 py-1 text-[11px] font-semibold tracking-wide ${
                      on ? "gold-grad text-black" : "border border-line text-faint hover:text-dim"
                    } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    {on ? "IN ✓" : "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {!done && open && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/60 pt-3">
            <span className="text-[11px] text-faint">
              <span className={`tnum ${complete ? "text-win" : "text-ink"}`}>{draft.length}</span>/
              {TUNING.u21RegistrationSize} selected
              {!hasGk && draft.length > 0 && <span className="ml-1 text-loss">· needs a goalkeeper</span>}
            </span>
            <GoldButton disabled={!complete} onClick={() => register(draft)} className="!px-4 !py-1.5 text-xs">
              Register Squad
            </GoldButton>
          </div>
        )}
      </Card>
    </Section>
  );
}

/** Rival prospect list (v18): the seven a U21 side registered, and what it would
 * take to prise one away. Opened by clicking that club in the U21 table. */
function U21ProspectsModal({ opp, onClose }: { opp: U21Opponent; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const sign = useGame((s) => s.academySignU21Prospect);
  const prospects = u21OpponentProspects(game, opp);
  const budget = game.teams[game.userTeamId].budget;

  return (
    <Modal onClose={onClose} title={`${opp.name} · registered prospects`}>
      <p className="mb-3 text-[12px] leading-relaxed text-dim">
        {opp.sellStance === "unwilling"
          ? "This club has no interest in selling any of its prospects."
          : opp.sellStance === "premium"
          ? "This club will deal, but only at a premium — they know exactly what they have."
          : "This club is open to business at the right price."}
      </p>
      <div className="space-y-1.5">
        {prospects.length === 0 && (
          <div className="px-1 py-4 text-sm text-faint">No registered prospects on file for this side.</div>
        )}
        {prospects.map((p) => {
          const quote = u21ProspectQuote(game, opp, p, TUNING);
          const view = potentialView(game, p, TUNING);
          const afford = quote.price !== null && quote.price <= budget;
          return (
            <div key={p.id} className="rounded-md border border-line bg-raised px-3 py-2">
              <div className="flex items-center gap-2">
                <PosBadge pos={p.positions[0]} />
                <button onClick={() => viewPlayer(p.id)} className="group min-w-0 flex-1 truncate text-left text-sm">
                  <span className="truncate font-medium transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                  <span className="ml-1.5 tnum text-[11px] text-faint">{p.age}y</span>
                  {/* The rival's badge in the tier's own colour — the price he
                      is quoted at keys off exactly this, so it should read the
                      same as it does on our own prospects. */}
                  {p.u21Tier && <TierTag tier={p.u21Tier} className="ml-1.5" />}
                </button>
                <StarRange lo={view.loStars} hi={view.hiStars} />
                <Ovr value={p.overall} size="sm" />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/50 pt-2">
                <span className="text-[11px] text-faint">
                  {quote.price === null ? (
                    <span className="text-loss">Not for sale</span>
                  ) : (
                    <>
                      Asking <span className="display text-[13px] font-semibold text-ink">{formatMoney(quote.price)}</span>
                      {!afford && <span className="ml-1 text-loss">· over budget</span>}
                    </>
                  )}
                </span>
                <GhostButton
                  disabled={quote.price === null || !afford}
                  onClick={() => sign(p.id)}
                  className="!px-3 !py-1 text-xs"
                >
                  Make Approach
                </GhostButton>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** Shown when the academy can't field a legal 7-a-side U21 side — the league is
 * locked until the roster has at least one keeper and six outfielders. */
function U21LockedBanner() {
  const game = useGame((s) => s.game)!;
  const short = u21Shortfall(game);
  const need: string[] = [];
  if (short.gk > 0) need.push(`${short.gk} goalkeeper${short.gk > 1 ? "s" : ""}`);
  if (short.outfield > 0) need.push(`${short.outfield} outfield player${short.outfield > 1 ? "s" : ""}`);
  return (
    <Card className="border-loss/60 bg-gradient-to-br from-loss/[0.10] to-transparent p-4 shadow-[0_0_0_1px_rgba(220,80,80,0.15)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-loss/40 bg-loss/10 text-2xl">
          🔒
        </div>
        <div className="min-w-0 flex-1">
          <div className="display text-sm font-bold text-loss">U21 League Locked</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-dim">
            The U21s play {U21_SIDE_SIZE}-a-side. You need at least{" "}
            <span className="text-ink">{U21_MIN_GK} goalkeeper</span> and{" "}
            <span className="text-ink">{U21_MIN_OUTFIELD} outfield players</span> in the academy (loanees don&apos;t
            count) before the side can take the field.
            {need.length > 0 && (
              <>
                {" "}Still needed: <span className="font-semibold text-loss">{need.join(" and ")}</span>.
              </>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

function U21Tab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const u21 = game.academy.u21;
  const results = [...u21.results].reverse().slice(0, 8);
  const performers = academyPlayers(game)
    .filter((p) => (p.youthStats?.apps ?? 0) > 0 && !p.loan)
    .sort((a, b) => (b.youthStats!.goals - a.youthStats!.goals) || b.youthStats!.ratingSum / b.youthStats!.apps - a.youthStats!.ratingSum / a.youthStats!.apps);

  const eligible = u21Eligible(game);
  // Clicking a rival in the table opens its registered seven — the youth
  // scouting entry point (v18).
  const [scouting, setScouting] = useState<U21Opponent | null>(null);

  return (
    <div className="space-y-6">
      {!eligible && <U21LockedBanner />}
      <U21RegistrationPanel />
      {scouting && <U21ProspectsModal opp={scouting} onClose={() => setScouting(null)} />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section
        title={`U21 Table · competition ${(u21.half ?? 0) + 1} of ${TUNING.u21CompetitionsPerSeason}`}
        right={<span className="text-xs text-faint">round {u21.roundsPlayed} of {u21.matchDays.length}</span>}
      >
        <Card>
          <div className="grid grid-cols-[auto_1fr_repeat(5,2.2rem)] gap-1 px-3 py-1.5 text-[10px] uppercase tracking-widest text-faint">
            <span className="w-5">#</span>
            <span>Team</span>
            <span className="text-center">P</span>
            <span className="text-center">GF</span>
            <span className="text-center">GA</span>
            <span className="text-center">GD</span>
            <span className="text-center">Pts</span>
          </div>
          {u21.table.map((r, i) => {
            const opp = r.isUser ? null : u21OpponentByName(game, r.name);
            const scoutable = !!opp && (opp.prospectIds?.length ?? 0) > 0;
            return (
              <div
                key={r.name}
                onClick={() => scoutable && setScouting(opp)}
                role={scoutable ? "button" : undefined}
                tabIndex={scoutable ? 0 : undefined}
                onKeyDown={(e) => {
                  if (scoutable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setScouting(opp);
                  }
                }}
                className={`grid grid-cols-[auto_1fr_repeat(5,2.2rem)] items-center gap-1 border-t border-line/40 px-3 py-1.5 text-sm ${
                  r.isUser ? "bg-hover font-semibold" : ""
                } ${scoutable ? "cursor-pointer hover:bg-hover" : ""}`}
              >
                <span className="w-5 tnum text-xs text-faint">{i + 1}</span>
                <span className={`truncate ${r.isUser ? "gold-text" : scoutable ? "hover:text-gold" : ""}`}>
                  {r.name}
                </span>
                <span className="text-center tnum">{r.played}</span>
                <span className="text-center tnum">{r.gf}</span>
                <span className="text-center tnum">{r.ga}</span>
                <span className="text-center tnum">{r.gf - r.ga}</span>
                <span className="text-center tnum font-semibold">{r.points}</span>
              </div>
            );
          })}
        </Card>
        <p className="mt-2 text-[11px] leading-snug text-faint">
          The U21s play {U21_SIDE_SIZE}-a-side, automatically — a fixture every week or so, across{" "}
          {TUNING.u21CompetitionsPerSeason} competitions of {TUNING.u21RoundsPerCompetition} rounds each season. Only your{" "}
          {TUNING.u21RegistrationSize} registered prospects can play; U21 minutes feed development at{" "}
          {Math.round(TUNING.u21MinutesWeight * 100)}% of senior weight.{" "}
          <span className="text-dim">Click a rival to scout the prospects they registered.</span>
        </p>
      </Section>

      <div className="space-y-6">
        <Section title="Recent Results">
          <Card className="divide-y divide-line/40">
            {results.length === 0 && <div className="px-4 py-5 text-sm text-faint">The U21 season hasn&apos;t started yet.</div>}
            {results.map((r) => (
              <div key={`${r.day}-${r.opponent}`} className="px-4 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="truncate">
                    <span className="tnum text-xs text-faint">{formatDayShort(r.day)}</span>{" "}
                    {r.home ? "vs" : "at"} {r.opponent}
                  </span>
                  <span className={`display tnum font-bold ${r.gf > r.ga ? "text-win" : r.gf < r.ga ? "text-loss" : "text-dim"}`}>
                    {r.gf}–{r.ga}
                  </span>
                </div>
                {r.scorers.length > 0 && <div className="text-[11px] text-faint">{r.scorers.join(", ")}</div>}
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Top Performers">
          <Card className="divide-y divide-line/40">
            {performers.length === 0 && <div className="px-4 py-5 text-sm text-faint">No U21 minutes yet this season.</div>}
            {performers.slice(0, 6).map((p) => {
              const ys = p.youthStats!;
              return (
                <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <PosBadge pos={p.positions[0]} />
                    <span className="truncate">{displayFullName(p)}</span>
                  </span>
                  <span className="tnum text-xs text-dim">
                    {ys.apps} apps · {ys.goals}g · {(ys.ratingSum / ys.apps).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </Card>
        </Section>
      </div>
      </div>
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

/** The ability window a scouted find can actually land in — the union of every
 * prospect tier's overall band. The auto-filter's slider runs across this, so it
 * can never be set to a number no 15–18-year-old prospect is ever generated at.
 * Derived from tuning rather than written down, so a band change carries. */
const OVR_FLOOR = Math.min(...TUNING.prospectTierOrder.map((t) => TUNING.prospectTierBands[t].overall[0]));
const OVR_CEIL = Math.max(...TUNING.prospectTierOrder.map((t) => TUNING.prospectTierBands[t].overall[1]));

/** Shared pill-button styling for the scouting selectors (region + duration). */
const chipClass = (active: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
    active ? "border-gold bg-hover text-ink" : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
  }`;

// Which positions each brief covers (mirrors POS_GROUPS in lib/academy).
const GROUP_POSITIONS: Record<ScoutPosGroup, Pos[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB"],
  MID: ["DM", "CM", "LM", "RM", "AM"],
  ATT: ["LW", "RW", "ST"],
  ANY: ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"],
  CB: ["CB"],
  LB: ["LB"],
  RB: ["RB"],
  DM: ["DM"],
  CM: ["CM"],
  LM: ["LM"],
  RM: ["RM"],
  AM: ["AM"],
  LW: ["LW"],
  RW: ["RW"],
  ST: ["ST"],
};

/** Archetypes a scout can be briefed to look for within a position group. */
function archetypesForGroup(group: ScoutPosGroup) {
  const positions = new Set(GROUP_POSITIONS[group]);
  return ARCHETYPES.filter((a) => a.positions.some((p) => positions.has(p)));
}

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
 * A summary of the whole scouting operation, filling the space under the
 * assignment list (a full department is only three scouts, so the bottom of that
 * column is otherwise permanently empty).
 *
 * Everything here is read off state that already exists — there is no
 * per-department spend ledger in the save, so the money figure is the standing
 * weekly wage bill of the scouts on the books rather than an invented
 * cumulative total.
 */
function ScoutingNetworkSummary() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const roster = game.teams[game.userTeamId].scouts ?? [];
  const assignments = game.academy.assignments;
  const reports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay);

  const wageBill = roster.reduce((sum, s) => sum + s.wage, 0);
  // Regions currently covered, with how many scouts sit in each.
  const byRegion = new Map<string, number>();
  for (const a of assignments) {
    const label = scoutRegion(a.region).label;
    byRegion.set(label, (byRegion.get(label) ?? 0) + 1);
  }
  const regions = [...byRegion.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Where the live prospects came from — the network's actual output.
  const byTier = new Map<string, number>();
  for (const r of reports) if (r.tier) byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1);
  const tiers = TUNING.prospectTierOrder.filter((t) => byTier.has(t)).reverse();

  if (roster.length === 0) return null;

  return (
    <Section title="Scouting Network">
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Wage bill", value: `${formatMoney(wageBill)}/wk`, hint: "Combined weekly wages of every scout on the books" },
            { label: "Regions covered", value: `${regions.length}`, hint: "Distinct regions your scouts are currently working" },
            { label: "Live prospects", value: `${reports.length}`, hint: "Reports still on the board — they expire as trails go cold" },
          ].map((s) => (
            <div key={s.label} title={s.hint}>
              <div className="text-[9px] uppercase tracking-widest text-mute">{s.label}</div>
              <div className="display tnum text-sm font-semibold text-ink">{s.value}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Active regions</div>
          {regions.length === 0 ? (
            <p className="text-[11px] text-faint">Nobody is out. Send a scout and the regions they cover show up here.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {regions.map(([label, n]) => (
                <MetaTag key={label} icon="📍" className="!text-ink">
                  {label}
                  {n > 1 && <span className="tnum text-faint">×{n}</span>}
                </MetaTag>
              ))}
            </div>
          )}
        </div>

        {tiers.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Prospects on the board</div>
            <div className="flex flex-wrap gap-1.5">
              {tiers.map((t) => (
                <span
                  key={t}
                  className="display rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ borderColor: `${TIER_COLOR[t]}55`, color: TIER_COLOR[t] }}
                >
                  <span className="tnum">{byTier.get(t)}</span> {TIER_LABEL[t].toLowerCase()}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
    </Section>
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
  const youthCoach = game.teams[game.userTeamId].staff.youthCoach;

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
            icon="🎓"
            label="Youth coach"
            value={youthCoach ? `${youthCoach.stars}★` : "None"}
            warn={!youthCoach}
            title={youthCoach ? `${youthCoach.name} — ${youthCoach.stars}★ youth coach` : "No youth coach appointed"}
          />
          <span className="h-6 w-px bg-line" aria-hidden />
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
  const youthCoachDef = staffSlotsForDept("academy").find((d) => d.slot === "youthCoach")!;
  return (
    <div className="space-y-8">
      <YouthCoachPanel def={youthCoachDef} />
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
                  const briefArch = (a.archetypes ?? []).map((id) => getArchetype(id).name);
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

        {/* A department caps out at a handful of scouts, so the foot of this
            column would otherwise always be dead space. */}
        <ScoutingNetworkSummary />
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
                      {getArchetype(p.archetypeId).name}
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
                      <span>
                        <span className="display text-sm font-semibold text-win">Free</span> · youth terms
                      </span>
                      <TrailTimer daysLeft={r.expiresDay - game.currentDay} />
                      {academyFull && <span className="text-loss">Academy full</span>}
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
                        disabled={academyFull}
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

/** Lock-in send-scout flow (§18 v7): choose region, position group and an optional
 * archetype focus, then confirm. The brief is fixed once the scout is out — recall
 * and re-send to change it. */
function SendScoutModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const addScout = useGame((s) => s.academyAddScout);
  const free = idleScouts(game);
  const [scoutId, setScoutId] = useState<string>(free[0]?.id ?? "");
  const [region, setRegion] = useState<ScoutRegion>("ENG");
  const [positions, setPositions] = useState<ScoutPosGroup>("ANY");
  const [archetypes, setArchetypes] = useState<string[]>([]);
  // Trip length (v25): 0 = open-ended (stay out until recalled), otherwise the
  // scout files reports for this many months then comes home automatically.
  const [durationMonths, setDurationMonths] = useState<number>(3);
  // Auto-filter (v1.67): the brief's own acceptance criteria. A scout only files
  // finds that clear these, so the board holds nothing the manager didn't ask
  // for. All three clauses are optional and off by default.
  const [filterOn, setFilterOn] = useState(false);
  const [minAge, setMinAge] = useState(TUNING.scoutProspectAgeMin);
  const [maxAge, setMaxAge] = useState(TUNING.scoutProspectAgeMax);
  const [minOverall, setMinOverall] = useState(OVR_FLOOR);
  const [tiers, setTiers] = useState<ProspectTier[]>([]);
  const DURATION_OPTIONS: { months: number; label: string }[] = [
    { months: 1, label: "1 month" },
    { months: 3, label: "3 months" },
    { months: 6, label: "6 months" },
    { months: 12, label: "1 season" },
    { months: 0, label: "Until recalled" },
  ];

  const archOptions = archetypesForGroup(positions);
  const briefPositions = new Set(GROUP_POSITIONS[positions] ?? []);
  // Drop any selected archetype that isn't valid for the current position group.
  const validArchIds = new Set(archOptions.map((a) => a.id));
  const selected = archetypes.filter((id) => validArchIds.has(id));

  const toggleArch = (id: string) =>
    setArchetypes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // The brief as the engine will store it — normalised here so the yield estimate
  // below is computed on exactly the filter the scout is sent with, not on the
  // raw slider values.
  const filter = filterOn
    ? normalizeFilter(TUNING, {
        minAge,
        maxAge,
        // The floor is the "no ability filter" position of the slider.
        minOverall: minOverall > OVR_FLOOR ? minOverall : undefined,
        tiers: tiers.length ? tiers : undefined,
      })
    : undefined;

  const chosenScout = free.find((s) => s.id === scoutId);
  const passRate = filterPassRate(TUNING, chosenScout?.judgement ?? 1, filter);
  const perReport = chosenScout ? expectedReportSize(TUNING, chosenScout.experience) * passRate : 0;

  const toggleTier = (t: ProspectTier) =>
    setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const confirm = () => {
    addScout(region, positions, selected, scoutId || undefined, durationMonths, filter);
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

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">Position focus</div>
          <select
            value={positions}
            onChange={(e) => {
              setPositions(e.target.value as ScoutPosGroup);
              setArchetypes([]); // reset the archetype brief when the group changes
            }}
            className="w-full rounded border border-line bg-raised px-2 py-2 text-sm"
          >
            {POS_OPTIONS.filter((o) => !o.group).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            {/* Specific positions, grouped by line so RB/RW are easy to find. */}
            {["Defender", "Midfielder", "Attacker"].map((group) => (
              <optgroup key={group} label={group}>
                {POS_OPTIONS.filter((o) => o.group === group).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Trip length (v25): how long the scout stays out before returning. */}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">Assignment length</div>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_OPTIONS.map((o) => (
              <button key={o.months} onClick={() => setDurationMonths(o.months)} className={chipClass(durationMonths === o.months)}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-faint">
            {durationMonths === 0
              ? "The scout stays out until you recall them."
              : `The scout files reports for ${durationMonths} month${durationMonths === 1 ? "" : "s"}, then returns automatically.`}
          </p>
        </div>

        {/* Auto-filter (v1.67): acceptance criteria on the brief itself. The scout
            works its normal cadence either way — a narrow brief buys quality with
            volume, which is why the expected yield is shown right here. */}
        <div className="rounded-md border border-line bg-raised/50 p-3">
          <button
            onClick={() => setFilterOn((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span>
              <span className="text-[10px] uppercase tracking-widest text-faint">Auto-filter</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-dim">
                Only accept reports matching an age, ability and rarity brief.
              </span>
            </span>
            <span
              className={`display shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold ${
                filterOn ? "border-gold bg-hover text-gold" : "border-line text-faint"
              }`}
            >
              {filterOn ? "ON" : "OFF"}
            </span>
          </button>

          {filterOn && (
            <div className="mt-3 space-y-3 border-t border-line/60 pt-3">
              {/* Age. Prospects are generated inside the tuning band, so the
                  inputs are bounded by it — an out-of-band age would silence the
                  scout for good. */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-faint">Age</span>
                  <span className="tnum text-[11px] text-dim">
                    {minAge}–{maxAge}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(
                    { length: TUNING.scoutProspectAgeMax - TUNING.scoutProspectAgeMin + 1 },
                    (_, i) => TUNING.scoutProspectAgeMin + i
                  ).map((age) => {
                    const on = age >= minAge && age <= maxAge;
                    return (
                      <button
                        key={age}
                        onClick={() => {
                          // Click inside the band to narrow to it; outside to extend.
                          if (age < minAge) setMinAge(age);
                          else if (age > maxAge) setMaxAge(age);
                          else if (age === minAge && age === maxAge) {
                            setMinAge(TUNING.scoutProspectAgeMin);
                            setMaxAge(TUNING.scoutProspectAgeMax);
                          } else {
                            setMinAge(age);
                            setMaxAge(age);
                          }
                        }}
                        className={`tnum ${chipClass(on)}`}
                      >
                        {age}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Minimum ability. A ceiling isn't offered: nobody briefs a scout
                  to bring back only the weaker kid. */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-faint">Minimum overall</span>
                  <span className="tnum text-[11px] text-dim">
                    {minOverall > OVR_FLOOR ? `${minOverall}+` : "any"}
                  </span>
                </div>
                <input
                  type="range"
                  min={OVR_FLOOR}
                  max={OVR_CEIL}
                  value={minOverall}
                  onChange={(e) => setMinOverall(Number(e.target.value))}
                  className="w-full accent-[color:var(--color-gold-lo)]"
                />
                <p className="mt-1 text-[11px] leading-snug text-faint">
                  A scouted prospect arrives raw — the whole band is {OVR_FLOOR}–{OVR_CEIL}. Set this high and only the
                  rarer tiers can clear it.
                </p>
              </div>

              {/* Rarity tiers. Table-driven off the tuning ladder, so a new rung
                  appears here without a code change. */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-faint">Rarity tier</span>
                  {tiers.length > 0 && (
                    <button onClick={() => setTiers([])} className="text-[11px] text-faint hover:text-dim">
                      Any
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TUNING.prospectTierOrder.map((t) => {
                    const on = tiers.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => toggleTier(t)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          on ? "bg-hover" : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
                        }`}
                        style={on ? { borderColor: TIER_COLOR[t], color: TIER_COLOR[t] } : undefined}
                      >
                        {TIER_LABEL[t]}
                        <span className="ml-1.5 text-[10px] text-faint">
                          {tierPct(tierChance(TUNING, chosenScout?.judgement ?? 1, t))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-faint">
                  Percentages are this scout&apos;s own chance of turning up each tier. Leave all off to accept any.
                </p>
              </div>

              {/* What the brief actually costs, in the only currency that matters
                  here: how many names come back. */}
              <div
                className={`rounded border px-2.5 py-2 text-[11px] leading-snug ${
                  perReport < 0.35 ? "border-danger/50 text-danger" : "border-line/60 text-dim"
                }`}
              >
                {!filterIsActive(TUNING, filter) ? (
                  <>Nothing set — the scout will file everything they find.</>
                ) : perReport < 0.05 ? (
                  <>
                    <b>This brief is too narrow.</b> Effectively nothing your scout finds will clear it — loosen the
                    ability floor or accept more tiers.
                  </>
                ) : (
                  <>
                    Expected yield <b className="tnum">~{perReport.toFixed(2)}</b> prospect
                    {perReport === 1 ? "" : "s"} per report ({Math.round(passRate * 100)}% of what they see clears the
                    brief). Reports still arrive on the same cadence — the ones that miss simply aren&apos;t filed.
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-faint">Player type (optional)</span>
            {selected.length > 0 && (
              <button onClick={() => setArchetypes([])} className="text-[11px] text-faint hover:text-dim">
                Clear
              </button>
            )}
          </div>
          <p className="mb-2 text-[11px] leading-snug text-faint">
            Brief the scout on the archetypes to hunt for. Leave all off to consider any player type in this group.
          </p>
          <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {archOptions.map((a) => {
              const on = selected.includes(a.id);
              // Badge EVERY position in the brief this archetype covers, not just
              // its first — a wing-back covers LB and RB and a winger LW and RW,
              // so showing only the first flank made RB/RW look absent from an
              // "Any position" list. Falls back to the primary if none intersect.
              const covered = a.positions.filter((p) => briefPositions.has(p));
              const badges = covered.length > 0 ? covered : [a.positions[0]];
              return (
                <button
                  key={a.id}
                  onClick={() => toggleArch(a.id)}
                  title={a.desc}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${
                    on ? "border-gold-lo/60 bg-hover text-gold" : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
                  }`}
                >
                  <span className="flex shrink-0 items-center gap-1">
                    {badges.map((p) => (
                      <PosBadge key={p} pos={p} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                  {on && <span className="display text-[10px] font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
            {describeFilter(filter) ||
              (selected.length > 0
                ? `${selected.length} archetype${selected.length === 1 ? "" : "s"} briefed`
                : "No filter — anything goes")}
          </span>
          <span className="flex items-center gap-2">
            <GhostButton onClick={onClose} className="!px-3 !py-1.5 text-xs">
              Cancel
            </GhostButton>
            <GoldButton onClick={confirm} className="!px-5 !py-1.5 text-xs">
              SEND SCOUT
            </GoldButton>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Academy upgrades (§18 v8; reworked v1.65): Max Scouts, Academy Squad Size,
 * Focus Slots and Youth PR. Each upgrade carries a distinct accent colour so
 * they read as separate at a glance. All are one-time purchases routed through
 * the shared training-facility machinery.
 *
 * The tab now leads with what the manager can actually spend and how far the
 * academy is built out, so the cards below are read against a budget rather than
 * in isolation.
 */
function UpgradesTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgradeTraining = useGame((s) => s.upgradeTraining);
  const team = game.teams[game.userTeamId];

  const scoutLevel = team.scoutNetworkLevel ?? 0;
  const squadLevel = team.academySquadLevel ?? 0;
  const focusLevel = team.focusSlotLevel ?? 0;
  const prLevel = team.youthPrLevel ?? 0;

  const upgrades: {
    key: "scoutNetwork" | "academySquad" | "focusSlot" | "youthPr";
    title: string;
    icon: string;
    accent: string; // hex accent for the coloured border + tint
    level: number;
    maxLevel: number;
    influence: string;
    now: string;
    next: string;
  }[] = [
    {
      key: "scoutNetwork",
      title: "Max Scouts",
      icon: "🔭",
      accent: "#4a90d9", // blue
      level: scoutLevel,
      maxLevel: TUNING.scoutNetworkMaxLevel,
      influence:
        "How many scouts you can employ. Each scout can be out on one assignment at a time, so headcount sets the size of your whole scouting operation.",
      now: `${TUNING.scoutNetworkBase + scoutLevel}`,
      next: `${TUNING.scoutNetworkBase + scoutLevel + 1} scouts (${team.scouts?.length ?? 0} employed)`,
    },
    {
      key: "academySquad",
      title: "Academy Squad Size",
      icon: "🏟️",
      accent: "#3fb27f", // green
      level: squadLevel,
      maxLevel: TUNING.academySquadMaxLevel,
      influence: "How many prospects the academy can hold at once — room for bigger intakes and more scouted signings.",
      now: `${TUNING.academySquadSizeBase + squadLevel * TUNING.academySquadSizePerLevel}`,
      next: `${TUNING.academySquadSizeBase + (squadLevel + 1) * TUNING.academySquadSizePerLevel} places`,
    },
    {
      key: "focusSlot",
      title: "Focus Slots",
      icon: "⭐",
      accent: "#b07fd9", // violet
      level: focusLevel,
      maxLevel: TUNING.focusSlotMaxLevel,
      influence: `How many prospects you can flag as focus at once — guaranteed U21 starts and extra coach attention. Base ${TUNING.u21FocusBase}, up to ${TUNING.u21FocusMax}.`,
      now: `${Math.min(TUNING.u21FocusMax, TUNING.u21FocusBase + focusLevel)}`,
      next: `${Math.min(TUNING.u21FocusMax, TUNING.u21FocusBase + focusLevel + 1)} slots`,
    },
    {
      key: "youthPr",
      title: "Youth PR",
      icon: "📣",
      accent: "#d97a4a", // amber
      level: prLevel,
      maxLevel: TUNING.youthPrMaxLevel,
      influence:
        "Media days, showcase friendlies and a club that talks its kids up. Raises what the market thinks every prospect in your academy is worth — it doesn't make them better players, it makes them cost more to buy.",
      now: `+${Math.round(prLevel * TUNING.youthPrValuePerLevel * 100)}%`,
      next: `+${Math.round((prLevel + 1) * TUNING.youthPrValuePerLevel * 100)}% prospect value`,
    },
  ];

  const spent = upgrades.filter((u) => u.level >= u.maxLevel).length;

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="display font-semibold text-ink">Academy infrastructure</div>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-mute">
            One-time purchases that raise the ceiling on the academy itself — how many scouts you can run, how many
            prospects you can hold, how many you can focus, and what the market pays for them. Nothing here has a weekly
            cost.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <div className="rounded-md border border-line bg-surface px-3 py-1.5">
            <div className="text-[9px] uppercase tracking-widest text-mute">Transfer budget</div>
            <div className="display tnum text-sm font-semibold text-ink">{formatMoney(team.budget)}</div>
          </div>
          <div className="rounded-md border border-line bg-surface px-3 py-1.5">
            <div className="text-[9px] uppercase tracking-widest text-mute">Fully built</div>
            <div className="display tnum text-sm font-semibold text-ink">
              {spent}/{upgrades.length}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {upgrades.map((f) => {
          const nextCost = trainingNextCost(game, game.userTeamId, f.key, TUNING);
          const maxed = nextCost === null;
          const canAfford = nextCost !== null && team.budget >= nextCost;
          return (
            <UpgradeCard
              key={f.key}
              title={f.title}
              icon={f.icon}
              accent={f.accent}
              level={f.level}
              maxLevel={f.maxLevel}
              blurb={f.influence}
              effectNow={f.now}
              effectNext={f.next}
              cost={maxed ? "—" : formatMoney(nextCost!)}
              maxed={maxed}
              canAfford={canAfford}
              note={canAfford || maxed ? undefined : "Not enough budget yet."}
              onUpgrade={() => upgradeTraining(f.key)}
            />
          );
        })}
      </div>
    </div>
  );
}

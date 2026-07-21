"use client";

// Academy (§18, 9th screen): the youth pillar. Academy squad with fog-of-war
// potential, the background U21 league, the scouting pipeline, and loans —
// all the "grow your own" decisions in one place.

import { useEffect, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Pos, PlayerBio, ScoutPosGroup, ScoutRegion, U21Opponent } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { ARCHETYPES, getArchetype } from "@/lib/config/archetypes";
import {
  academyPlayers,
  focusSlots,
  potentialView,
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
import { plansForPosition, resolveTrainingPlan } from "@/lib/config/training";
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
import { staffSlotsForDept } from "@/lib/staff";
import { Card, ConfirmButton, Flag, GhostButton, GoldButton, Modal, Ovr, PlayerCard, PlayerGrid, PosBadge, PotentialBadge, Section, Stars, StarRange, Tabs, UpgradeCard, usePlayerView, ViewToggle } from "../ui";

type Tab = "squad" | "u21" | "scouting" | "staff" | "upgrades";

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
          { id: "u21", label: "U21 League" },
          { id: "scouting", label: "Scouting", badge: reports.length },
          { id: "staff", label: "Staff" },
          { id: "upgrades", label: "Upgrades" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "squad" && <SquadTab />}
      {tab === "u21" && <U21Tab />}
      {tab === "scouting" && <ScoutingTab />}
      {tab === "staff" && <AcademyStaffTab />}
      {tab === "upgrades" && <UpgradesTab />}
    </div>
  );
}

// ── Academy staff (EA-FC-flavoured) ────────────────────────────────────────
// A deliberately distinct layout from the generic backroom StaffPanel: the
// Youth Coach reads as the single figure who *runs* the academy (one wide,
// gold-accented card), while Scouts read as a network of talent-finders — a
// grid of scout cards with the "report speed" stat front and centre.

function AcademyStaffTab() {
  useGame((s) => s.rev);
  const youthCoachDef = staffSlotsForDept("academy").find((d) => d.slot === "youthCoach")!;

  return (
    <div className="space-y-8">
      <YouthCoachPanel def={youthCoachDef} />
      <ScoutDepartmentPanel />
    </div>
  );
}

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

/** What a scout's ratings actually buy you, in plain numbers: the average size
 * of a report (experience) and the odds of a top-tier find (judgement). */
function ScoutOutlook({ experience, judgement }: { experience: number; judgement: number }) {
  const avg = expectedReportSize(TUNING, experience);
  const plat = tierChance(TUNING, judgement, "platinum");
  const gold = tierChance(TUNING, judgement, "gold");
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px]">
      <span className="display rounded-sm border border-line px-1.5 py-0.5 text-dim">
        ~<span className="tnum font-semibold text-ink">{avg.toFixed(1)}</span> per report
      </span>
      <span className="display rounded-sm border px-1.5 py-0.5" style={{ borderColor: `${TIER_COLOR.gold}55`, color: TIER_COLOR.gold }}>
        <span className="tnum font-semibold">{Math.round(gold * 100)}%</span> gold
      </span>
      <span className="display rounded-sm border px-1.5 py-0.5" style={{ borderColor: `${TIER_COLOR.platinum}55`, color: TIER_COLOR.platinum }}>
        <span className="tnum font-semibold">{Math.round(plat * 100)}%</span> platinum
      </span>
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
          No scouts on the books. Hire one below, then send them out from the <b className="text-ink">Scouting</b> tab.
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
                <div className="mt-auto flex justify-end border-t border-line/60 pt-2">
                  <ConfirmButton
                    label="Release"
                    confirmLabel={`Release ${s.name}?`}
                    tone="danger"
                    onConfirm={() => fire(s.id)}
                    className="!px-3 !py-1 text-xs"
                  />
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

/** The prospect-tier badge (Bronze → Diamond) a player carries while in the
 * academy. Rendered in the tier's accent colour; nothing shows once the player
 * has graduated to the senior squad (the tier is cleared on promotion). */
function TierTag({ tier, className = "" }: { tier: PlayerBio["u21Tier"]; className?: string }) {
  if (!tier) return null;
  return (
    <span
      className={`display shrink-0 rounded-sm border px-1 text-[9px] font-semibold uppercase tracking-widest ${className}`}
      style={{ borderColor: `${TIER_COLOR[tier]}77`, color: TIER_COLOR[tier] }}
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

// Shared grid template for the academy squad header + rows, applied from md up.
// Fixed tracks for the data columns (Age/OVR/Potential/Actions) so the header —
// a separate grid container from each row — lines its labels up with the values
// below them. On phones the rows drop the grid entirely and stack: an identity
// line (pos · name · age · OVR · potential) with the actions wrapping beneath.
const SQUAD_GRID = "md:grid-cols-[2.25rem_1fr_2.5rem_3rem_4.5rem_minmax(0,22rem)]";

function SquadTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const promote = useGame((s) => s.academyPromote);
  const release = useGame((s) => s.academyRelease);
  const toggleFocus = useGame((s) => s.academyToggleFocus);
  const toggleLoan = useGame((s) => s.academyToggleLoan);
  const recall = useGame((s) => s.academyRecall);
  const setPlan = useGame((s) => s.setTrainingPlan);
  const [view, setView] = usePlayerView("academy");

  const team = game.teams[game.userTeamId];
  const seniorRoom = TUNING.squadCap - team.playerIds.length;
  const windowOpen = transferWindowState(game.currentDay, game.schedule).open;
  const intakeDay = game.schedule.intakeDay;
  const intake = game.academy.lastIntake;
  // Prospects locked to the U21 competition can't be promoted mid-competition.
  const u21Registered = new Set(game.academy.u21.registered ?? []);

  // The academy squad is exactly your U21 prospects — one consolidated roster.
  const roster = academyPlayers(game).sort((a, b) => {
    const va = potentialView(game, a, TUNING);
    const vb = potentialView(game, b, TUNING);
    return vb.hiStars - va.hiStars || vb.loStars - va.loStars || b.overall - a.overall;
  });

  const stats: { label: string; value: React.ReactNode; hint?: string }[] = [
    {
      label: "Academy places",
      value: `${roster.length}/${academySquadCap(game, team.id, TUNING)}`,
      hint: "Prospects in the academy — upgrade Academy Squad Size for more room",
    },
    {
      label: "Focus slots",
      value: `${game.academy.focusIds.length}/${focusSlots(game, TUNING)}`,
      hint: "Focus prospects get guaranteed U21 starts and extra coaching",
    },
    { label: "Senior squad space", value: `${seniorRoom}`, hint: "Open spots in the first team for promotions" },
    ...(intakeDay !== undefined && intakeDay > game.currentDay
      ? [{ label: "Next intake class", value: formatDayShort(intakeDay), hint: "A new class of prospects arrives every March" }]
      : []),
    ...(intake
      ? [
          {
            label: "Last class",
            value: (
              <>
                {intake.playerIds.length} prospects
                {intake.golden && <span className="gold-text"> · GOLDEN</span>}
              </>
            ),
          },
        ]
      : []),
  ];

  if (view === "grid") return grid();

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
            No academy prospects yet — the first intake class arrives in March, and your scout can find more.
          </div>
        )}
        {roster.map((p) => {
          const chips = statusChips(game, p);
          const isFocus = game.academy.focusIds.includes(p.id);
          const listed = game.academy.loanList.includes(p.id);
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
                    <span className="truncate font-medium transition-colors group-hover:text-gold">{p.name}</span>
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
                  listed={listed}
                  registered={registered}
                  windowOpen={windowOpen}
                  seniorRoom={seniorRoom}
                  onSetPlan={setPlan}
                  onToggleFocus={toggleFocus}
                  onToggleLoan={toggleLoan}
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
        {roster.length === 0 ? (
          <Card className="px-4 py-6 text-sm text-faint">
            No academy prospects yet — the first intake class arrives in March, and your scout can find more.
          </Card>
        ) : (
          <PlayerGrid>
            {roster.map((p) => {
              const chips = statusChips(game, p);
              const isFocus = game.academy.focusIds.includes(p.id);
              const listed = game.academy.loanList.includes(p.id);
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
                      listed={listed}
                      registered={registered}
                      windowOpen={windowOpen}
                      seniorRoom={seniorRoom}
                      onSetPlan={setPlan}
                      onToggleFocus={toggleFocus}
                      onToggleLoan={toggleLoan}
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
  listed,
  registered,
  windowOpen,
  seniorRoom,
  onSetPlan,
  onToggleFocus,
  onToggleLoan,
  onRecall,
  onPromote,
  onRelease,
}: {
  p: PlayerBio;
  isFocus: boolean;
  listed: boolean;
  registered: boolean;
  windowOpen: boolean;
  seniorRoom: number;
  onSetPlan: (id: string, planId: string) => void;
  onToggleFocus: (id: string) => void;
  onToggleLoan: (id: string) => void;
  onRecall: (id: string) => void;
  onPromote: (id: string) => void;
  onRelease: (id: string) => void;
}) {
  const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
  const options = plansForPosition(p.positions[0]);
  return (
    <>
      <select
        value={plan.id}
        onChange={(e) => onSetPlan(p.id, e.target.value)}
        title={`Training plan — ${plan.blurb}`}
        className="display rounded border border-line bg-raised px-2 py-1 text-[11px] font-semibold tracking-wide text-dim transition-colors hover:border-faint hover:text-ink focus:border-gold focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
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
          label={listed ? "Loan-listed ✓" : "Send on Loan"}
          title={listed ? "Remove from the loan list" : "List for a season loan — an AI club may take them for first-team minutes"}
          active={listed}
          onClick={() => onToggleLoan(p.id)}
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
                      <span className="truncate font-medium transition-colors group-hover:text-gold">{p.name}</span>
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
                  <span className="truncate font-medium transition-colors group-hover:text-gold">{p.name}</span>
                  <span className="ml-1.5 tnum text-[11px] text-faint">{p.age}y</span>
                  {p.u21Tier && (
                    <span className="ml-1.5 display text-[9px] uppercase tracking-widest text-gold">{p.u21Tier}</span>
                  )}
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
                    <span className="truncate">{p.name}</span>
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

// Which positions each brief covers (mirrors POS_GROUPS in lib/academy).
const GROUP_POSITIONS: Record<ScoutPosGroup, Pos[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB"],
  MID: ["DM", "CM", "AM"],
  ATT: ["LW", "RW", "ST"],
  ANY: ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"],
  CB: ["CB"],
  LB: ["LB"],
  RB: ["RB"],
  DM: ["DM"],
  CM: ["CM"],
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

function ScoutingTab() {
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
              No scouts on the books — hire one on the <b className="text-ink">Staff</b> tab and you can start sending them
              abroad. A scout&apos;s <b className="text-ink">experience</b> sets how many prospects a report brings back, and
              their <b className="text-ink">judgement</b> sets how good those prospects are.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="space-y-2">
                {assignments.map((a) => {
                  const briefArch = (a.archetypes ?? []).map((id) => getArchetype(id).name);
                  const s = scoutById(game, a.scoutId);
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
                          <span className="ml-1">· next report ~{Math.max(1, a.nextReportDay - game.currentDay)}d</span>
                        </div>
                      </div>
                      <button
                        onClick={() => removeScout(a.id)}
                        title="Recall this scout — frees them for a new brief"
                        className="h-9 w-9 shrink-0 rounded border border-line text-sm text-dim hover:border-loss/50 hover:text-loss md:h-7 md:w-7"
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
                    ? "Every scout is out. Recall one, or hire more on the Staff tab."
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

      <Section title="Prospect Reports" right={<span className="text-xs text-faint">{reports.length} active</span>}>
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
                    <button onClick={() => viewProspect(p)} className="group flex min-w-0 items-center gap-2 text-left">
                      <PosBadge pos={p.positions[0]} />
                      <Flag nat={p.nationality} size={12} />
                      <span className="truncate font-semibold transition-colors group-hover:text-gold">{p.name}</span>
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
                      <Ovr value={p.overall} size="sm" />
                      <span className="text-xs text-faint">POT</span>
                      <StarRange lo={v.loStars} hi={v.hiStars} />
                    </div>
                  </div>
                  <div className="mt-1.5 text-[11px] text-faint">
                    {getArchetype(p.archetypeId).name}
                    {" · "}
                    {game.currentDay - r.day <= 0 ? "found today" : `found ${game.currentDay - r.day}d ago`}
                    {(() => {
                      const s = scoutById(game, r.scoutId);
                      return s ? ` · scouted by ${s.name}` : "";
                    })()}
                    {" · click the name for full stats before you sign"}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
                    <span className="text-xs text-faint">
                      <span className="display text-sm font-semibold text-win">Free</span> · youth terms · trail cold in{" "}
                      {r.expiresDay - game.currentDay}d
                      {academyFull && <span className="ml-1 text-loss">· academy full</span>}
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <GhostButton onClick={() => viewProspect(p)} className="!px-3 !py-1 text-xs">
                        View
                      </GhostButton>
                      <GhostButton onClick={() => dismiss(r.id)} className="!px-3 !py-1 text-xs">
                        Pass
                      </GhostButton>
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

  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
      active ? "border-gold bg-hover text-ink" : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
    }`;

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

  const archOptions = archetypesForGroup(positions);
  const briefPositions = new Set(GROUP_POSITIONS[positions] ?? []);
  // Drop any selected archetype that isn't valid for the current position group.
  const validArchIds = new Set(archOptions.map((a) => a.id));
  const selected = archetypes.filter((id) => validArchIds.has(id));

  const toggleArch = (id: string) =>
    setArchetypes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const confirm = () => {
    addScout(region, positions, selected, scoutId || undefined);
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
                      <span style={{ color: TIER_COLOR.platinum }}>
                        {Math.round(tierChance(TUNING, s.judgement, "platinum") * 100)}% platinum
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
              return (
                <button
                  key={a.id}
                  onClick={() => toggleArch(a.id)}
                  title={a.desc}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${
                    on ? "border-gold-lo/60 bg-hover text-gold" : "border-line bg-raised text-dim hover:border-faint hover:text-ink"
                  }`}
                >
                  {/* Badge the position this brief will actually return, not the
                      archetype's first — a wing-back covers LB and RB, and
                      always showing LB made an RB brief look like the wrong
                      side. */}
                  <PosBadge pos={a.positions.find((p) => briefPositions.has(p)) ?? a.positions[0]} />
                  <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                  {on && <span className="display text-[10px] font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="text-[11px] text-faint">
            {selected.length > 0 ? `${selected.length} archetype${selected.length === 1 ? "" : "s"} briefed` : "No player-type filter"}
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

/** Academy upgrades (§18 v8): Max Scouts, Academy Squad Size and Focus Slots.
 * Its own tab (after Staff). Each upgrade carries a distinct accent colour so
 * the three read as visually separate at a glance. All are one-time purchases
 * routed through the shared training-facility machinery. */
function UpgradesTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgradeTraining = useGame((s) => s.upgradeTraining);
  const team = game.teams[game.userTeamId];

  const scoutLevel = team.scoutNetworkLevel ?? 0;
  const squadLevel = team.academySquadLevel ?? 0;
  const focusLevel = team.focusSlotLevel ?? 0;

  const upgrades: {
    key: "scoutNetwork" | "academySquad" | "focusSlot";
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
        "How many scouts you can employ. Each scout can be out on one assignment at a time, so headcount is what sets the size of your scouting operation. Hire them on the Staff tab.",
      now: `${TUNING.scoutNetworkBase + scoutLevel} scouts (${team.scouts?.length ?? 0} employed)`,
      next: `${TUNING.scoutNetworkBase + scoutLevel + 1} scouts`,
    },
    {
      key: "academySquad",
      title: "Academy Squad Size",
      icon: "🏟️",
      accent: "#3fb27f", // green
      level: squadLevel,
      maxLevel: TUNING.academySquadMaxLevel,
      influence: "How many prospects the academy can hold at once — room for bigger intakes and more scouted signings.",
      now: `${TUNING.academySquadSizeBase + squadLevel * TUNING.academySquadSizePerLevel} places`,
      next: `${TUNING.academySquadSizeBase + (squadLevel + 1) * TUNING.academySquadSizePerLevel} places`,
    },
    {
      key: "focusSlot",
      title: "Focus Slots",
      icon: "⭐",
      accent: "#b07fd9", // violet
      level: focusLevel,
      maxLevel: TUNING.focusSlotMaxLevel,
      influence: `How many prospects you can flag as focus at once (guaranteed U21 starts + coach attention). Base ${TUNING.u21FocusBase}, up to ${TUNING.u21FocusMax}.`,
      now: `${Math.min(TUNING.u21FocusMax, TUNING.u21FocusBase + focusLevel)} slots`,
      next: `${Math.min(TUNING.u21FocusMax, TUNING.u21FocusBase + focusLevel + 1)} slots`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
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
            note={maxed ? "Fully upgraded." : canAfford ? "A one-time academy upgrade." : "Not enough budget yet."}
            onUpgrade={() => upgradeTraining(f.key)}
          />
        );
      })}
    </div>
  );
}

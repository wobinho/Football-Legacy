"use client";

// Academy (§18, 9th screen): the youth pillar. Academy squad with fog-of-war
// potential, the background U21 league, the scouting pipeline, and loans —
// all the "grow your own" decisions in one place.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Pos, PlayerBio, ScoutPosGroup, ScoutRegion } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { ARCHETYPES, getArchetype } from "@/lib/config/archetypes";
import { academyPlayers, potentialView, scoutCapacity } from "@/lib/academy";
import { academySquadCap, trainingNextCost } from "@/lib/economy";
import { SCOUT_REGIONS } from "@/lib/config/scouting";
import { transferWindowState, formatDayShort } from "@/lib/calendar";
import { formatMoney } from "@/lib/value";
import { staffSlotsForDept } from "@/lib/staff";
import { Card, ConfirmButton, Flag, GhostButton, GoldButton, Modal, Ovr, PosBadge, PotentialBadge, Section, Stars, StarRange, Tabs } from "../ui";

type Tab = "squad" | "u21" | "scouting" | "staff";

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
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "squad" && <SquadTab />}
      {tab === "u21" && <U21Tab />}
      {tab === "scouting" && <ScoutingTab />}
      {tab === "staff" && <AcademyStaffTab />}
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
  const scoutDef = staffSlotsForDept("academy").find((d) => d.slot === "scout")!;

  return (
    <div className="space-y-8">
      <YouthCoachPanel def={youthCoachDef} />
      <ScoutNetworkPanel def={scoutDef} />
    </div>
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
      <Card className="overflow-hidden border-l-2 border-l-gold bg-gradient-to-r from-gold-lo/[0.08] to-transparent p-5">
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
            <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Available to appoint</div>
            {pending ? (
              <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-faint">
                Shortlist cleared — new candidates arrive in a couple of days.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ready.map((c) => {
                  const better = current ? c.stars > current.stars : true;
                  return (
                    <Card key={c.id} className="flex flex-col border-l-2 border-l-gold-lo/40 p-3">
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

/** The scouting network — scouts read as a grid of talent-finder cards, each
 * with the report-speed stat up front. Deliberately unlike the backroom-staff
 * rows so scouts feel like the club's eyes on the youth game, not office hires. */
function ScoutNetworkPanel({ def }: { def: ReturnType<typeof staffSlotsForDept>[number] }) {
  const game = useGame((s) => s.game)!;
  const hire = useGame((s) => s.hire);
  const dismiss = useGame((s) => s.dismissStaff);
  const fire = useGame((s) => s.fireStaff);
  const team = game.teams[game.userTeamId];
  const current = team.staff.scout;
  const all = game.staffMarket.filter((c) => c.slot === "scout");
  const ready = all.filter((c) => c.availableDay === undefined || c.availableDay <= game.currentDay);
  const pending = all.length > 0 && ready.length === 0;

  return (
    <Section title="Scouting" right={<span className="text-xs text-faint">{def.buff}</span>}>
      {/* the appointed scout — a wide "field card" */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-2xl">
            🔎
          </div>
          {current ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Flag nat={current.nationality} size={13} />
                  <span className="text-lg font-semibold">{current.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                  <Stars n={current.stars} />
                  <span>· {formatMoney(current.wage)}/wk</span>
                </div>
              </div>
              <div className="rounded-md border border-line bg-raised px-4 py-2 text-center">
                <div className="text-[10px] uppercase tracking-widest text-faint">Read quality</div>
                <div className="display text-sm font-bold gold-text">{def.effectAt ? def.effectAt(current.stars) : "—"}</div>
              </div>
              <ConfirmButton
                label="Fire"
                confirmLabel={`Fire ${current.name}?`}
                tone="danger"
                onConfirm={() => fire("scout")}
                className="!px-3 !py-1.5 text-xs"
              />
            </>
          ) : (
            <div className="min-w-0 flex-1 text-sm text-dim">
              No scout on the books — appoint one below, then send them to countries on the{" "}
              <b className="text-ink">Scouting</b> tab.
            </div>
          )}
        </div>
      </Card>

      <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Scouts available to appoint</div>
      {pending ? (
        <div className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-faint">
          Shortlist cleared — new scouts arrive in a couple of days.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ready.map((c) => {
            const better = current ? c.stars > current.stars : true;
            return (
              <Card
                key={c.id}
                className="flex flex-col overflow-hidden border-t-2 border-t-gold-lo/40 p-0"
              >
                {/* scout "badge" header */}
                <div className="flex items-center gap-3 bg-raised px-3 py-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-lg">
                    🕵️
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Flag nat={c.nationality} size={11} />
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                    </div>
                    <Stars n={c.stars} />
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-3">
                  {def.effectAt && (
                    <div className={`text-[11px] font-medium ${better ? "text-win" : "text-dim"}`}>{def.effectAt(c.stars)}</div>
                  )}
                  <div className="mt-1 text-[11px] text-faint">
                    Fee {formatMoney(c.fee)} · {formatMoney(c.wage)}/wk
                  </div>
                  <div className="mt-3 flex items-stretch gap-1.5">
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
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── Academy squad ─────────────────────────────────────────────────────────

function statusChips(game: NonNullable<ReturnType<typeof useGame.getState>["game"]>, p: PlayerBio) {
  const chips: { label: string; cls: string }[] = [];
  if (game.academy.focusIds.includes(p.id)) chips.push({ label: "FOCUS", cls: "border-gold-lo/60 text-gold" });
  if (p.loan) chips.push({ label: `LOAN · ${game.teams[p.loan.toClubId]?.short ?? "?"}`, cls: "border-win/40 text-win" });
  else if (game.academy.loanList.includes(p.id)) chips.push({ label: "LOAN-LISTED", cls: "border-line text-dim" });
  if (p.age === TUNING.academyMaxAge) chips.push({ label: "FINAL SEASON", cls: "border-loss/40 text-loss" });
  return chips;
}

function SquadTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const promote = useGame((s) => s.academyPromote);
  const release = useGame((s) => s.academyRelease);
  const toggleFocus = useGame((s) => s.academyToggleFocus);
  const toggleLoan = useGame((s) => s.academyToggleLoan);
  const recall = useGame((s) => s.academyRecall);

  const team = game.teams[game.userTeamId];
  const seniorRoom = TUNING.squadCap - team.playerIds.length;
  const windowOpen = transferWindowState(game.currentDay, game.schedule).open;
  const intakeDay = game.schedule.intakeDay;
  const intake = game.academy.lastIntake;

  // The academy squad is exactly your U21 prospects — one consolidated roster.
  const roster = academyPlayers(game).sort((a, b) => {
    const va = potentialView(game, a, TUNING);
    const vb = potentialView(game, b, TUNING);
    return vb.hiStars - va.hiStars || vb.loStars - va.loStars || b.overall - a.overall;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-right text-xs text-faint">
          {intakeDay !== undefined && intakeDay > game.currentDay && (
            <div>
              Next intake class: <span className="tnum text-ink">{formatDayShort(intakeDay)}</span>
            </div>
          )}
          {intake && (
            <div>
              Last class: {intake.playerIds.length} prospects{intake.golden && <span className="gold-text font-semibold"> · GOLDEN GENERATION</span>}
            </div>
          )}
          <div>
            Focus slots: <span className="tnum text-ink">{game.academy.focusIds.length}/{TUNING.u21FocusMax}</span>
          </div>
          <div>
            Academy places:{" "}
            <span className="tnum text-ink">
              {roster.length}/{academySquadCap(game, team.id, TUNING)}
            </span>
          </div>
          <div>
            Senior squad space: <span className="tnum text-ink">{seniorRoom}</span>
          </div>
        </div>
      </div>

      <Card className="divide-y divide-line/50">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint">
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
          return (
            <div key={p.id} className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-2.5">
              <PosBadge pos={p.positions[0]} />
              <button onClick={() => viewPlayer(p.id)} className="min-w-0 text-left hover:underline">
                <span className="flex items-center gap-1.5">
                  <Flag nat={p.nationality} size={11} />
                  <span className="truncate font-medium">{p.name}</span>
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
              <span className="text-center tnum text-sm text-dim">{p.age}</span>
              <span className="text-center">
                <Ovr value={p.overall} size="sm" />
              </span>
              <span className="text-center">
                <PotentialBadge game={game} p={p} />
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                <TextBtn
                  label={isFocus ? "★ Focus" : "☆ Focus"}
                  title={isFocus ? "Remove focus" : "Make focus prospect (guaranteed U21 starts + coaching)"}
                  active={isFocus}
                  onClick={() => toggleFocus(p.id)}
                  disabled={!!p.loan}
                />
                {p.loan ? (
                  <TextBtn
                    label="Recall Loan"
                    title={windowOpen ? "Recall from loan" : "Can only recall during a transfer window"}
                    onClick={() => recall(p.id)}
                    disabled={!windowOpen}
                  />
                ) : (
                  <TextBtn
                    label={listed ? "Loan-listed ✓" : "Send on Loan"}
                    title={listed ? "Remove from the loan list" : "List for a season loan — an AI club may take them for first-team minutes"}
                    active={listed}
                    onClick={() => toggleLoan(p.id)}
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
                  onClick={() => promote(p.id)}
                  disabled={seniorRoom <= 0 || !!p.loan || p.age < TUNING.academyPromoteMinAge}
                />
                <TextBtn
                  label="Release"
                  title="Release this prospect"
                  danger
                  onClick={() => {
                    if (window.confirm(`Release ${p.name} from the academy?`)) release(p.id);
                  }}
                />
              </span>
            </div>
          );
        })}
      </Card>
    </div>
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

/** Consolidated U21 matchday-squad picker: tag academy players into the squad
 * that gets fielded in the U21 league (like a lineup, but no tactics). When no
 * one is tagged the coach auto-selects (focus first, then the best available). */
function U21SquadPicker() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const toggleU21 = useGame((s) => s.academyToggleU21Squad);

  const squad = new Set(game.academy.u21Squad ?? []);
  const focus = new Set(game.academy.focusIds);
  const players = academyPlayers(game)
    .filter((p) => !p.loan)
    .sort((a, b) => {
      // tagged first, then focus, then overall
      const ta = squad.has(a.id) ? 1 : 0;
      const tb = squad.has(b.id) ? 1 : 0;
      if (ta !== tb) return tb - ta;
      const fa = focus.has(a.id) ? 1 : 0;
      const fb = focus.has(b.id) ? 1 : 0;
      return fb - fa || b.overall - a.overall;
    });
  const tagged = players.filter((p) => squad.has(p.id)).length;

  return (
    <Section
      title="U21 Matchday Squad"
      right={
        <span className="text-xs text-faint">
          {tagged > 0 ? (
            <>
              <span className="tnum text-ink">{tagged}</span> tagged
            </>
          ) : (
            "auto-selected"
          )}
        </span>
      }
    >
      <Card className="p-3">
        {players.length === 0 ? (
          <div className="px-1 py-3 text-sm text-faint">No academy players available. Loanees can&apos;t play in the U21s.</div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {players.map((p) => {
              const on = squad.has(p.id);
              const isFocus = focus.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                    on ? "border-gold-lo/50 bg-hover" : "border-line bg-raised"
                  }`}
                >
                  <PosBadge pos={p.positions[0]} />
                  <button onClick={() => viewPlayer(p.id)} className="min-w-0 flex-1 truncate text-left text-sm hover:underline">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="tnum text-[11px] text-faint">{p.age}y</span>
                      {isFocus && <span className="display text-[9px] font-semibold text-gold">★</span>}
                    </span>
                  </button>
                  <Ovr value={p.overall} size="sm" />
                  <button
                    onClick={() => toggleU21(p.id)}
                    className={`display w-16 rounded px-2 py-1 text-[11px] font-semibold tracking-wide ${
                      on ? "gold-grad text-black" : "border border-line text-faint hover:text-dim"
                    }`}
                  >
                    {on ? "IN ✓" : "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {tagged > 0 && (
          <div className="mt-2 text-right">
            <button
              onClick={() => (game.academy.u21Squad ?? []).slice().forEach((id) => toggleU21(id))}
              className="text-[11px] text-faint hover:text-dim"
            >
              Clear squad (back to auto-select)
            </button>
          </div>
        )}
      </Card>
    </Section>
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

  return (
    <div className="space-y-6">
      <U21SquadPicker />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section title="U21 Table" right={<span className="text-xs text-faint">round {u21.roundsPlayed} of {u21.matchDays.length}</span>}>
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
          {u21.table.map((r, i) => (
            <div
              key={r.name}
              className={`grid grid-cols-[auto_1fr_repeat(5,2.2rem)] items-center gap-1 border-t border-line/40 px-3 py-1.5 text-sm ${
                r.isUser ? "bg-hover font-semibold" : ""
              }`}
            >
              <span className="w-5 tnum text-xs text-faint">{i + 1}</span>
              <span className={`truncate ${r.isUser ? "gold-text" : ""}`}>{r.name}</span>
              <span className="text-center tnum">{r.played}</span>
              <span className="text-center tnum">{r.gf}</span>
              <span className="text-center tnum">{r.ga}</span>
              <span className="text-center tnum">{r.gf - r.ga}</span>
              <span className="text-center tnum font-semibold">{r.points}</span>
            </div>
          ))}
        </Card>
        <p className="mt-2 text-[11px] leading-snug text-faint">
          The U21s play automatically — a midweek fixture every week or so. Your best prospects (focus first) start every
          match; U21 minutes feed development at {Math.round(TUNING.u21MinutesWeight * 100)}% of senior weight.
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

const POS_OPTIONS: { id: ScoutPosGroup; label: string }[] = [
  { id: "ANY", label: "Any position" },
  { id: "GK", label: "Goalkeepers" },
  { id: "DEF", label: "Defenders" },
  { id: "MID", label: "Midfielders" },
  { id: "ATT", label: "Attackers" },
];

// Which positions each scouting group covers (mirrors POS_GROUPS in lib/academy).
const GROUP_POSITIONS: Record<ScoutPosGroup, Pos[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB"],
  MID: ["DM", "CM", "AM"],
  ATT: ["LW", "RW", "ST"],
  ANY: ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"],
};

/** Archetypes a scout can be briefed to look for within a position group. */
function archetypesForGroup(group: ScoutPosGroup) {
  const positions = new Set(GROUP_POSITIONS[group]);
  return ARCHETYPES.filter((a) => a.positions.some((p) => positions.has(p)));
}

const posGroupLabel = (id: ScoutPosGroup) => POS_OPTIONS.find((o) => o.id === id)?.label ?? id;

function ScoutingTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const removeScout = useGame((s) => s.academyRemoveScout);
  const sign = useGame((s) => s.academySign);
  const dismiss = useGame((s) => s.academyDismiss);
  const viewProspect = useGame((s) => s.viewProspect);
  const [sending, setSending] = useState(false);

  const scout = game.teams[game.userTeamId].staff.scout;
  const assignments = game.academy.assignments;
  const capacity = scoutCapacity(game, TUNING);
  const reports = game.academy.reports.filter((r) => r.expiresDay > game.currentDay);
  const team = game.teams[game.userTeamId];
  const budget = team.budget;
  const academyFull = (team.academyPlayerIds?.length ?? 0) >= academySquadCap(game, team.id, TUNING);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Section
          title="Scouting Department"
          right={
            <span className="text-xs text-faint">
              {scout ? `${scout.name} · ${"★".repeat(scout.stars)}` : "No scout"}
            </span>
          }
        >
          {!scout ? (
            <Card className="p-4 text-sm text-dim">
              No scout on the books — hire a <b className="text-ink">Scout</b> on the <b className="text-ink">Staff</b> tab and you
              can start sending them abroad. More stars mean more reports and tighter potential reads; upgrade{" "}
              <b className="text-ink">Max Scouts</b> below to send more out at once.
            </Card>
          ) : (
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="display shrink-0 rounded border border-line px-2 py-1 text-xs">
                  Scouts out{" "}
                  <span className={`tnum font-semibold ${assignments.length >= capacity ? "text-gold" : "text-ink"}`}>
                    {assignments.length}
                  </span>
                  <span className="text-faint"> / {capacity}</span>
                </span>
              </div>

              <div className="space-y-2">
                {assignments.map((a, i) => {
                  const briefArch = (a.archetypes ?? []).map((id) => getArchetype(id).name);
                  return (
                    <div key={a.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-raised px-3 py-2">
                      <span className="display w-6 shrink-0 text-center text-sm font-bold text-faint">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <Flag nat={SCOUT_REGIONS.find((r) => r.id === a.region)?.nats[0] ?? "ENG"} size={12} />
                          <span className="font-medium">{SCOUT_REGIONS.find((r) => r.id === a.region)?.label ?? a.region}</span>
                          <span className="text-faint">·</span>
                          <span className="text-dim">{posGroupLabel(a.positions)}</span>
                        </div>
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
                        title="Recall this scout — frees the slot to send a new brief"
                        className="h-7 w-7 shrink-0 rounded border border-line text-sm text-dim hover:border-loss/50 hover:text-loss"
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

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-faint">
                  {assignments.length >= capacity
                    ? "All scouts deployed. Upgrade Max Scouts below to send more."
                    : `${capacity - assignments.length} scout${capacity - assignments.length === 1 ? "" : "s"} available.`}
                </span>
                <GoldButton
                  onClick={() => setSending(true)}
                  disabled={assignments.length >= capacity}
                  className="!px-4 !py-1.5 text-xs"
                >
                  + SEND A SCOUT
                </GoldButton>
              </div>
            </Card>
          )}
        </Section>

        <UpgradesPanel />
      </div>

      <Section title="Prospect Reports" right={<span className="text-xs text-faint">{reports.length} active</span>}>
        {reports.length === 0 ? (
          <Card className="p-4 text-sm text-faint">No live reports. Trails go cold after {TUNING.scoutReportExpiryDays} days.</Card>
        ) : (
          <div className="space-y-3">
            {academyFull && (
              <Card className="border-l-2 border-l-loss/50 p-3 text-[13px] text-dim">
                Academy is full ({team.academyPlayerIds?.length ?? 0}/{academySquadCap(game, team.id, TUNING)}). Release a prospect or
                upgrade <b className="text-ink">Academy Squad Size</b> before signing another.
              </Card>
            )}
            {reports.map((r) => {
              const p = r.player;
              const v = potentialView(game, p, TUNING);
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button onClick={() => viewProspect(p)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                      <PosBadge pos={p.positions[0]} />
                      <Flag nat={p.nationality} size={12} />
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="tnum text-xs text-faint">age {p.age}</span>
                      {r.region && (
                        <span className="display rounded-sm border border-line px-1 text-[9px] font-semibold text-faint">
                          {SCOUT_REGIONS.find((x) => x.id === r.region)?.short ?? r.region}
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
                    {getArchetype(p.archetypeId).name} · click the name for full stats before you sign
                  </div>
                  <p className="mt-2 text-[13px] italic leading-relaxed text-dim">&ldquo;{r.note}&rdquo;</p>
                  <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-3">
                    <span className="text-xs text-faint">
                      Fee <span className="display tnum text-sm font-semibold text-ink">{formatMoney(r.fee)}</span> · trail cold in{" "}
                      {r.expiresDay - game.currentDay}d
                    </span>
                    <span className="flex items-center gap-2">
                      <GhostButton onClick={() => viewProspect(p)} className="!px-3 !py-1 text-xs">
                        View
                      </GhostButton>
                      <GhostButton onClick={() => dismiss(r.id)} className="!px-3 !py-1 text-xs">
                        Pass
                      </GhostButton>
                      <GoldButton
                        onClick={() => sign(r.id)}
                        disabled={budget < r.fee || academyFull}
                        className="!px-4 !py-1 text-xs"
                      >
                        SIGN — {formatMoney(r.fee)}
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

/** Lock-in send-scout flow (§18 v7): choose region, position group and an optional
 * archetype focus, then confirm. The brief is fixed once the scout is out — recall
 * and re-send to change it. */
function SendScoutModal({ onClose }: { onClose: () => void }) {
  const addScout = useGame((s) => s.academyAddScout);
  const [region, setRegion] = useState<ScoutRegion>("England");
  const [positions, setPositions] = useState<ScoutPosGroup>("ANY");
  const [archetypes, setArchetypes] = useState<string[]>([]);

  const archOptions = archetypesForGroup(positions);
  // Drop any selected archetype that isn't valid for the current position group.
  const validArchIds = new Set(archOptions.map((a) => a.id));
  const selected = archetypes.filter((id) => validArchIds.has(id));

  const toggleArch = (id: string) =>
    setArchetypes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const confirm = () => {
    addScout(region, positions, selected);
    onClose();
  };

  return (
    <Modal title="Send a scout" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-faint">Country / region</div>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as ScoutRegion)}
            className="w-full rounded border border-line bg-raised px-2 py-2 text-sm"
          >
            {SCOUT_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

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
            {POS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
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
                  <PosBadge pos={a.positions[0]} />
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

/** Scouting Department upgrades (§18 v7): Max Scouts and Academy Squad Size. Both
 * are one-time purchases routed through the shared training-facility machinery. */
function UpgradesPanel() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgradeTraining = useGame((s) => s.upgradeTraining);
  const team = game.teams[game.userTeamId];

  const scoutLevel = team.scoutNetworkLevel ?? 0;
  const squadLevel = team.academySquadLevel ?? 0;

  const upgrades: {
    key: "scoutNetwork" | "academySquad";
    title: string;
    icon: string;
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
      level: scoutLevel,
      maxLevel: TUNING.scoutNetworkMaxLevel,
      influence: "How many scouts you can have out on assignment at once. Needs at least one Scout on the staff.",
      now: `${TUNING.scoutNetworkBase + scoutLevel} scouts`,
      next: `${TUNING.scoutNetworkBase + scoutLevel + 1} scouts`,
    },
    {
      key: "academySquad",
      title: "Academy Squad Size",
      icon: "🏟️",
      level: squadLevel,
      maxLevel: TUNING.academySquadMaxLevel,
      influence: "How many prospects the academy can hold at once — room for bigger intakes and more scouted signings.",
      now: `${TUNING.academySquadSizeBase + squadLevel * TUNING.academySquadSizePerLevel} places`,
      next: `${TUNING.academySquadSizeBase + (squadLevel + 1) * TUNING.academySquadSizePerLevel} places`,
    },
  ];

  return (
    <Section title="Upgrades">
      <div className="space-y-3">
        {upgrades.map((f) => {
          const nextCost = trainingNextCost(game, game.userTeamId, f.key, TUNING);
          const maxed = nextCost === null;
          const canAfford = nextCost !== null && team.budget >= nextCost;
          return (
            <Card key={f.key} className="p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-2xl">
                  {f.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="display font-semibold">{f.title}</span>
                    <span className="text-xs text-faint">
                      Level {f.level} / {f.maxLevel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-dim">{f.influence}</p>
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: f.maxLevel }).map((_, i) => (
                      <span key={i} className={`h-1.5 flex-1 rounded-full ${i < f.level ? "gold-grad" : "bg-line"}`} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-3">
                <span className="text-xs text-faint">
                  <span className="display font-semibold text-win">{f.now}</span>
                  {!maxed && <span className="text-faint"> → {f.next}</span>}
                  {!maxed && <span className="text-faint"> · {formatMoney(nextCost!)}</span>}
                </span>
                {maxed ? (
                  <span className="display rounded-md border border-gold-lo/50 px-3 py-1.5 text-xs font-semibold text-gold">MAX</span>
                ) : (
                  <GoldButton onClick={() => upgradeTraining(f.key)} disabled={!canAfford} className="!py-1.5 text-xs">
                    UPGRADE
                  </GoldButton>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

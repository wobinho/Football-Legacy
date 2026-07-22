"use client";

// Player Development (§5, new 8th screen). Training Plans is the heart of the
// screen: a per-player training focus you can set, with each row expanding to
// show how that player is developing — growth per season, projected ceilings,
// estimated time to potential, and growth history. Alongside it, the training
// facilities and development staff that drive it all.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import type { PlayerBio } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { devPhase, seasonGrowth, seasonGrowthEstimate, seasonAttrFocus } from "@/lib/development";
import { trainingNextCost, type TrainingFacility } from "@/lib/economy";
import { formatMoney } from "@/lib/value";
import { optimalTrainingPlan, plansForPosition, resolveTrainingPlan, type TrainingPlanDef } from "@/lib/config/training";
import { POS_ORDER } from "@/lib/config/positions";
import { Card, Flag, GhostButton, GoldButton, Ovr, PlayerCard, PlayerGrid, PosBadge, Tabs, UpgradeCard, usePlayerView, ViewToggle } from "../ui";
import StaffPanel from "./StaffPanel";

// Columns the Training Plans list can be sorted by. Position is the default —
// keepers first — so the list reads in team-sheet order out of the box.
type PlanSortKey = "pos" | "name" | "age" | "ovr";
const POS_RANK: Record<string, number> = Object.fromEntries(POS_ORDER.map((p, i) => [p, i]));

/** Ascending comparison of two players by the given sort column. */
function comparePlan(a: PlayerBio, b: PlayerBio, key: PlanSortKey): number {
  switch (key) {
    case "pos":
      return (POS_RANK[a.positions[0]] ?? 99) - (POS_RANK[b.positions[0]] ?? 99);
    case "age":
      return a.age - b.age;
    case "ovr":
      return a.overall - b.overall;
    case "name":
      return a.name.localeCompare(b.name);
  }
}

/** A small badge marking a player who is still in the youth academy (not yet on
 * the senior squad). Gold-accented, so a prospect reads at a glance. */
function AcademyTag() {
  return (
    <span
      className="display shrink-0 rounded-sm border border-gold-lo/50 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-gold"
      title="Still in the youth academy"
    >
      Academy
    </span>
  );
}

/** A clickable column header for the Training Plans list. Clicking the active
 * column flips its direction; clicking another switches to it (ascending). */
function SortHeader({
  label,
  col,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  col: PlanSortKey;
  sort: { key: PlanSortKey; dir: 1 | -1 };
  onSort: (s: { key: PlanSortKey; dir: 1 | -1 }) => void;
  align?: "left" | "center";
}) {
  const active = sort.key === col;
  return (
    <button
      onClick={() => onSort(active ? { key: col, dir: (sort.dir * -1) as 1 | -1 } : { key: col, dir: 1 })}
      className={`flex items-center gap-1 uppercase tracking-widest transition-colors hover:text-dim ${
        align === "center" ? "justify-center" : ""
      } ${active ? "text-gold" : ""}`}
      title={`Sort by ${label}`}
    >
      {label}
      <span className="text-[8px] leading-none">{active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
    </button>
  );
}

const ATTR_LABELS: [keyof PlayerBio["attrs"], string][] = [
  ["pac", "PAC"], ["sho", "SHO"], ["pas", "PAS"], ["dri", "DRI"], ["def", "DEF"], ["phy", "PHY"],
];

// Shared grid template for the Training Plans header + rows. The last track is a
// fixed width so the training-focus dropdown is the same size across every
// position (plan names differ per position) and its header lines up above it.
// The dropdown track narrows on phones so the row still fits a small screen.
const PLAN_GRID = "grid-cols-[2rem_1fr_2rem_2.5rem_8rem] sm:grid-cols-[2.25rem_1fr_2.5rem_3rem_11rem]";

type Tab = "plans" | "facilities" | "staff";

/** One upgrade card's worth of display data. The accent tints the whole card
 * so each facility reads as its own bounded module. */
interface FacilityRow {
  key: TrainingFacility;
  title: string;
  icon: string;
  accent: string;
  level: number;
  maxLevel: number;
  influence: string;
  effectNow: string;
  effectNext: string;
}

export default function DevelopmentScreen() {
  const [tab, setTab] = useState<Tab>("plans");
  return (
    <div>
      <Tabs
        tabs={[
          { id: "plans", label: "Training Plans" },
          { id: "facilities", label: "Training Facilities" },
          { id: "staff", label: "Development Staff" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "plans" && <TrainingPlansTab />}
      {tab === "facilities" && <FacilitiesTab />}
      {tab === "staff" && <StaffDevTab />}
    </div>
  );
}

// ── Training Plans (§5 v8): an EA-FC-style per-player development focus ─────
// Each plan biases where a player's seasonal growth flows across the six
// attributes and nudges its rate. Only the user's still-growing players benefit
// most, so the tab leads with the youngsters.
function TrainingPlansTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setPlan = useGame((s) => s.setTrainingPlan);
  const autoAssign = useGame((s) => s.autoAssignTrainingPlan);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = usePlayerView("development");
  // Column the list view is sorted by. Position ascending is the default, so
  // goalkeepers lead the list (POS_ORDER puts GK first); click a header to
  // re-sort, click again to flip the direction.
  const [sort, setSort] = useState<{ key: PlanSortKey; dir: 1 | -1 }>({ key: "pos", dir: 1 });
  const ctx = devContext(game);
  const team = game.teams[game.userTeamId];

  // Senior squad only — academy prospects have their own development tab on the
  // Academy screen (their training plans are set there, not here).
  const academyIds = new Set(team.academyPlayerIds ?? []);
  const ids = [...team.playerIds];
  const squad = ids
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired)
    .sort((a, b) => {
      const cmp = comparePlan(a, b, sort.key) * sort.dir;
      // Stable tiebreak so equal keys always land in the same order.
      return cmp || (POS_RANK[a.positions[0]] ?? 99) - (POS_RANK[b.positions[0]] ?? 99) || a.name.localeCompare(b.name);
    });

  // How many players aren't yet on the focus that would most improve them —
  // drives the auto-assign call to action.
  const suboptimal = squad.filter(
    (p) => resolveTrainingPlan(p.trainingPlan, p.positions[0]).id !== optimalTrainingPlan(p).id
  ).length;

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="display font-semibold text-ink">Optimal training focus</div>
          <div className="text-[12px] leading-relaxed text-faint">
            {suboptimal > 0 ? (
              <>
                <span className="text-gold">{suboptimal}</span> player{suboptimal === 1 ? " is" : "s are"} on a focus
                that isn&apos;t the best fit. Auto-assign picks the plan that lifts each player&apos;s overall fastest,
                from their archetype, position and how much room each attribute still has.
              </>
            ) : (
              "Every player is already training the focus that suits them best."
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          <GoldButton onClick={() => autoAssign()} disabled={suboptimal === 0} className="!py-1.5 text-xs">
            AUTO-ASSIGN ALL
          </GoldButton>
        </div>
      </Card>

      {view === "grid" ? (
        <PlayerGrid>
          {squad.map((p) => {
            const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
            const options = plansForPosition(p.positions[0]);
            const best = optimalTrainingPlan(p);
            const isOptimal = plan.id === best.id;
            const growing = p.age <= TUNING.growthEndAge;
            const inAcademy = academyIds.has(p.id);
            const last = p.devLog && p.devLog.length ? p.devLog[p.devLog.length - 1] : null;
            return (
              <PlayerCard
                key={p.id}
                p={p}
                onOpen={() => viewPlayer(p.id)}
                ovr={<Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />}
                sub={
                  <span className="flex items-center gap-1.5 truncate">
                    {inAcademy && <AcademyTag />}
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
        <div className={`grid ${PLAN_GRID} items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint`}>
          <SortHeader label="Pos" col="pos" sort={sort} onSort={setSort} />
          <SortHeader label="Player" col="name" sort={sort} onSort={setSort} />
          <SortHeader label="Age" col="age" sort={sort} onSort={setSort} align="center" />
          <SortHeader label="OVR" col="ovr" sort={sort} onSort={setSort} align="center" />
          <span className="text-center">Training focus</span>
        </div>
        {squad.map((p) => {
          const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
          const options = plansForPosition(p.positions[0]);
          const best = optimalTrainingPlan(p);
          const isOptimal = plan.id === best.id;
          const inAcademy = academyIds.has(p.id);
          const isOpen = open === p.id;

          // Potential is hidden from the manager. Everything shown here is a
          // one-season-ahead estimate — no ceilings, no multi-season horizon.
          const phase = devPhase(p, TUNING);
          const season = seasonGrowthEstimate(p, TUNING, ctx.devCoachStars, ctx.trainingLevel, plan);
          const last = p.devLog && p.devLog.length ? p.devLog[p.devLog.length - 1] : null;

          return (
            <div key={p.id}>
              <div className={`grid ${PLAN_GRID} items-center gap-3 px-4 py-2.5`}>
                <PosBadge pos={p.positions[0]} />
                <button
                  onClick={() => setOpen(isOpen ? null : p.id)}
                  className="group flex min-w-0 items-center gap-2 text-left"
                >
                  <span className={`shrink-0 text-[10px] text-faint transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                  <Flag nat={p.nationality} size={12} />
                  <span className="truncate font-medium transition-colors group-hover:text-gold">{p.name}</span>
                  {inAcademy && <AcademyTag />}
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
                  {/* A dot marks the focus that would improve this player most,
                      so a mis-set plan is visible without opening the row. */}
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
                    {/* this-season projection */}
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-faint">
                        This season {phaseChip(phase)}
                      </div>
                      {season && season.delta > 0 ? (
                        <div className="space-y-1 text-sm">
                          <Row k="Projected OVR" v={`${p.overall} → ${p.overall + season.delta}`} good />
                          <Row k="Est. growth this season" v={`≈ +${season.delta}`} />
                          <p className="pt-1 text-[11px] leading-snug text-faint">
                            An estimate for the coming season only, at full minutes with your current coach &amp; facilities.
                            More game time, a better Development Coach, or a higher Training Centre all lift it.
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-faint">
                          {phase === "decline"
                            ? "Past their peak — the focus now is managing minutes to slow decline."
                            : "Settled — little growth expected this season."}
                        </p>
                      )}
                    </div>

                    {/* where this season's growth will flow */}
                    <div>
                      <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">
                        This season&apos;s attribute focus
                      </div>
                      <AttrProjection p={p} delta={season?.delta ?? 0} plan={plan} />
                    </div>

                    {/* history */}
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

// ── how much dev help the club currently provides ──
function devContext(game: ReturnType<typeof useGame.getState>["game"]) {
  const team = game!.teams[game!.userTeamId];
  return {
    devCoachStars: team.staff.devCoach?.stars ?? 0,
    trainingLevel: team.trainingLevel ?? 0,
    medicalLevel: team.medicalLevel ?? 0,
  };
}

function phaseChip(phase: "growth" | "prime" | "decline") {
  const map = {
    growth: { label: "Growing", cls: "text-win border-win/40" },
    prime: { label: "Prime", cls: "text-gold border-gold-lo/40" },
    decline: { label: "Declining", cls: "text-loss border-loss/40" },
  } as const;
  const m = map[phase];
  return <span className={`display rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-faint">{k}</span>
      <span className={`tnum ${good ? "text-win font-semibold" : ""}`}>{v}</span>
    </div>
  );
}

function AttrProjection({ p, delta, plan }: { p: PlayerBio; delta: number; plan: TrainingPlanDef }) {
  // Where the coming season's growth (delta overall) is expected to flow across
  // the six attributes — this season only, never a lifetime ceiling.
  const gains = seasonAttrFocus(p, delta, plan);
  return (
    <div className="space-y-1.5">
      {ATTR_LABELS.map(([k, label]) => {
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

function FacilitiesTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgradeTraining = useGame((s) => s.upgradeTraining);
  const team = game.teams[game.userTeamId];

  const facilities: FacilityRow[] = [
    {
      key: "training",
      title: "Training Centre",
      icon: "🎯",
      accent: "#d9a441", // gold
      level: team.trainingLevel ?? 0,
      maxLevel: TUNING.trainingFacilityMaxLevel,
      influence:
        "Speeds up how fast players under 25 develop toward their potential each season. Works together with your Development Coach.",
      effectNow: `+${Math.round((team.trainingLevel ?? 0) * TUNING.trainingFacilityGrowthPerLevel * 100)}% development speed`,
      effectNext: `+${Math.round(((team.trainingLevel ?? 0) + 1) * TUNING.trainingFacilityGrowthPerLevel * 100)}% development speed`,
    },
    {
      key: "medical",
      title: "Medical Centre",
      icon: "➕",
      accent: "#4fb8b8", // teal
      level: team.medicalLevel ?? 0,
      maxLevel: TUNING.trainingFacilityMaxLevel,
      influence:
        "Improves fitness recovery between matches and softens the extra fatigue older players (30+) pick up, so your squad can play more often.",
      effectNow: `+${((team.medicalLevel ?? 0) * TUNING.medicalFacilityRecoveryPerLevel).toFixed(1)} fitness / day`,
      effectNext: `+${(((team.medicalLevel ?? 0) + 1) * TUNING.medicalFacilityRecoveryPerLevel).toFixed(1)} fitness / day`,
    },
    {
      key: "gymnasium",
      title: "Gymnasium",
      icon: "🏋️",
      accent: "#c96a6a", // clay red
      level: team.gymnasiumLevel ?? 0,
      maxLevel: TUNING.trainingFacilityMaxLevel,
      influence:
        "Strength and conditioning for the whole squad, every age. A broad development boost that stacks on top of the Training Centre — the Training Centre only helps your under-25s, this lifts everyone.",
      effectNow: `+${Math.round((team.gymnasiumLevel ?? 0) * TUNING.gymnasiumGrowthPerLevel * 100)}% development (all ages)`,
      effectNext: `+${Math.round(((team.gymnasiumLevel ?? 0) + 1) * TUNING.gymnasiumGrowthPerLevel * 100)}% development (all ages)`,
    },
    {
      key: "academy",
      title: "Youth Academy",
      icon: "🌱",
      accent: "#5fbf8a", // green
      level: team.academyLevel ?? 0,
      maxLevel: TUNING.academyMaxLevel,
      influence:
        "Bigger, better intake classes every March and faster growth for the academy squad. Costs a small weekly upkeep per level — the only thing academy players cost you.",
      effectNow: `~${Math.max(2, Math.round(TUNING.intakeClassBase + (team.academyLevel ?? 0) * TUNING.intakeClassPerLevel))} per class, +${Math.round((team.academyLevel ?? 0) * TUNING.trainingFacilityGrowthPerLevel * 100)}% academy growth`,
      effectNext: `~${Math.max(2, Math.round(TUNING.intakeClassBase + ((team.academyLevel ?? 0) + 1) * TUNING.intakeClassPerLevel))} per class, +${Math.round(((team.academyLevel ?? 0) + 1) * TUNING.trainingFacilityGrowthPerLevel * 100)}% academy growth`,
    },
    // Scouting-department upgrades (Max Scouts, Academy Squad Size) live on the
    // Academy → Scouting page (§18 v7), not here.
  ];

  // ── Specialist facilities (v15) ──
  // Two families beyond the core three. POSITION centres lift one position
  // group; PLAN centres amplify the training focuses the user is already
  // setting. Both are deliberately narrower (and cheaper) than the general
  // Training Centre, so a club can specialise rather than only scaling up.
  const posPct = (lvl: number) => Math.round(lvl * TUNING.positionFacilityGrowthPerLevel * 100);
  const planPct = (lvl: number) => Math.round(lvl * TUNING.planFacilityBoostPerLevel * 100);
  const youthPct = (lvl: number) => Math.round(lvl * TUNING.youthDevCentreGrowthPerLevel * 100);

  const positionFacilities: FacilityRow[] = [
    {
      key: "gkCentre", title: "Goalkeeping Centre", icon: "🧤", accent: "#c98cd4",
      level: team.gkCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "A dedicated keeper unit — specialist coaching, shot-stopping rigs and distribution work. Speeds up development for every goalkeeper on your books.",
      effectNow: `+${posPct(team.gkCentreLevel ?? 0)}% GK growth`,
      effectNext: `+${posPct((team.gkCentreLevel ?? 0) + 1)}% GK growth`,
    },
    {
      key: "defenceCentre", title: "Defensive Unit", icon: "🛡️", accent: "#5b8fd6",
      level: team.defenceCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "Back-line drills, shape work and duel training. Speeds up development for centre backs and full backs.",
      effectNow: `+${posPct(team.defenceCentreLevel ?? 0)}% defender growth`,
      effectNext: `+${posPct((team.defenceCentreLevel ?? 0) + 1)}% defender growth`,
    },
    {
      key: "midfieldCentre", title: "Midfield Hub", icon: "⚙️", accent: "#5fbf8a",
      level: team.midfieldCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "Rondos, tempo work and transition drills. Speeds up development for defensive, central and attacking midfielders.",
      effectNow: `+${posPct(team.midfieldCentreLevel ?? 0)}% midfielder growth`,
      effectNext: `+${posPct((team.midfieldCentreLevel ?? 0) + 1)}% midfielder growth`,
    },
    {
      key: "attackCentre", title: "Attacking Centre", icon: "⚔️", accent: "#d97a4a",
      level: team.attackCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "Final-third patterns, movement in behind and one-v-one work. Speeds up development for wingers and strikers.",
      effectNow: `+${posPct(team.attackCentreLevel ?? 0)}% forward growth`,
      effectNext: `+${posPct((team.attackCentreLevel ?? 0) + 1)}% forward growth`,
    },
  ];

  const planFacilities: FacilityRow[] = [
    {
      key: "sportsScience", title: "Sports Science Lab", icon: "🔬", accent: "#4fb8b8",
      level: team.sportsScienceLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: "GPS tracking, load management and conditioning science. Amplifies the Pace & Movement and Strength & Stamina training plans.",
      effectNow: `+${planPct(team.sportsScienceLevel ?? 0)}% on physical plans`,
      effectNext: `+${planPct((team.sportsScienceLevel ?? 0) + 1)}% on physical plans`,
    },
    {
      key: "techCentre", title: "Technical Centre", icon: "🎓", accent: "#8a7fd6",
      level: team.techCentreLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: "Video suites, pattern-of-play rooms and small-sided technical pitches. Amplifies the Playmaking, Ball Control and Defending plans.",
      effectNow: `+${planPct(team.techCentreLevel ?? 0)}% on technical plans`,
      effectNext: `+${planPct((team.techCentreLevel ?? 0) + 1)}% on technical plans`,
    },
    {
      key: "finishingCentre", title: "Finishing School", icon: "🥅", accent: "#d9a441",
      level: team.finishingCentreLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: "Dedicated shooting pitches and finishing coaches working in and around the box. Amplifies the Finishing training plan.",
      effectNow: `+${planPct(team.finishingCentreLevel ?? 0)}% on finishing plans`,
      effectNext: `+${planPct((team.finishingCentreLevel ?? 0) + 1)}% on finishing plans`,
    },
    {
      key: "youthDevCentre", title: "Youth Development Centre", icon: "🌿", accent: "#7fbf5f",
      level: team.youthDevCentreLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: `Age-group coaching, individual development plans and a pathway to the first team. Speeds up development for every player aged ${TUNING.academyMaxAge} or under, senior squad or academy.`,
      effectNow: `+${youthPct(team.youthDevCentreLevel ?? 0)}% growth for U${TUNING.academyMaxAge + 1}s`,
      effectNext: `+${youthPct((team.youthDevCentreLevel ?? 0) + 1)}% growth for U${TUNING.academyMaxAge + 1}s`,
    },
  ];

  const renderCard = (f: FacilityRow) => {
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
        effectNow={f.effectNow}
        effectNext={f.effectNext}
        cost={maxed ? "—" : formatMoney(nextCost!)}
        maxed={maxed}
        canAfford={canAfford}
        note={maxed ? "Fully upgraded." : canAfford ? "A long-term investment in your squad." : "Not enough budget yet."}
        onUpgrade={() => upgradeTraining(f.key)}
      />
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-4 text-[13px] leading-relaxed text-dim">
          Infrastructure is the slowest and most permanent way to improve a squad. The core facilities lift everyone;
          the specialist centres below are narrower but cheaper, so a club can build the identity it wants rather than
          only scaling up.
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">{facilities.map(renderCard)}</div>
      </div>

      <div>
        <h3 className="display mb-1 text-base font-semibold uppercase tracking-wide text-dim">Position Centres</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-faint">
          Each centre speeds up development for one position group. Cheaper than the Training Centre because each only
          helps a quarter of the squad — build the ones your best prospects sit in.
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">{positionFacilities.map(renderCard)}</div>
      </div>

      <div>
        <h3 className="display mb-1 text-base font-semibold uppercase tracking-wide text-dim">Training Plan Centres</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-faint">
          These amplify the training focuses you set on the Training Plans tab, so they pay off most when your squad is
          actually training the matching plans.
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">{planFacilities.map(renderCard)}</div>
      </div>
    </div>
  );
}

function StaffDevTab() {
  return <StaffPanel dept="development" />;
}

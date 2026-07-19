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
import { devPhase, seasonGrowthEstimate, seasonAttrFocus } from "@/lib/development";
import { trainingNextCost, type TrainingFacility } from "@/lib/economy";
import { formatMoney } from "@/lib/value";
import { plansForPosition, resolveTrainingPlan, type TrainingPlanDef } from "@/lib/config/training";
import { Card, Flag, GhostButton, Ovr, PosBadge, Tabs, UpgradeCard } from "../ui";
import StaffPanel from "./StaffPanel";

const ATTR_LABELS: [keyof PlayerBio["attrs"], string][] = [
  ["pac", "PAC"], ["sho", "SHO"], ["pas", "PAS"], ["dri", "DRI"], ["def", "DEF"], ["phy", "PHY"],
];

// Shared grid template for the Training Plans header + rows. The last track is a
// fixed width so the training-focus dropdown is the same size across every
// position (plan names differ per position) and its header lines up above it.
// The dropdown track narrows on phones so the row still fits a small screen.
const PLAN_GRID = "grid-cols-[2rem_1fr_2rem_2.5rem_8rem] sm:grid-cols-[2.25rem_1fr_2.5rem_3rem_11rem]";

type Tab = "plans" | "facilities" | "staff";

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
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [open, setOpen] = useState<string | null>(null);
  const ctx = devContext(game);
  const team = game.teams[game.userTeamId];

  // senior squad + academy. Potential is hidden from the manager, so we lead
  // with the players who still have room to grow (youngest first), then the rest.
  const ids = [...team.playerIds, ...(team.academyPlayerIds ?? [])];
  const squad = ids
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired)
    .sort((a, b) => {
      const ga = a.age <= TUNING.growthEndAge ? 0 : 1;
      const gb = b.age <= TUNING.growthEndAge ? 0 : 1;
      return ga - gb || a.age - b.age;
    });

  return (
    <div className="space-y-5">
      <Card className="divide-y divide-line/50">
        <div className={`grid ${PLAN_GRID} items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-faint`}>
          <span>Pos</span>
          <span>Player</span>
          <span className="text-center">Age</span>
          <span className="text-center">OVR</span>
          <span className="text-center">Training focus</span>
        </div>
        {squad.map((p) => {
          const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
          const options = plansForPosition(p.positions[0]);
          const growing = p.age <= TUNING.growthEndAge;
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
                  {!growing && <span className="text-[10px] text-faint">· settled</span>}
                  {last && last.toOverall !== last.fromOverall && (
                    <span className={`text-[11px] tnum ${last.toOverall > last.fromOverall ? "text-win" : "text-loss"}`}>
                      {last.toOverall > last.fromOverall ? "+" : ""}{last.toOverall - last.fromOverall} last season
                    </span>
                  )}
                </button>
                <span className="text-center tnum text-sm text-dim">{p.age}</span>
                <span className="flex items-center justify-center">
                  <Ovr value={p.overall} size="sm" />
                </span>
                <span className="flex justify-end">
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

  const facilities: {
    key: TrainingFacility;
    title: string;
    icon: string;
    accent: string; // per-upgrade accent so the cards read as bounded modules
    level: number;
    maxLevel: number;
    influence: string;
    effectNow: string;
    effectNext: string;
  }[] = [
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
      {facilities.map((f) => {
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
      })}
      </div>
    </div>
  );
}

function StaffDevTab() {
  return <StaffPanel dept="development" />;
}

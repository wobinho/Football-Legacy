"use client";

// Facilities upgrade panel — PARKED (v1.77).
//
// This is the twelve-card training-ground UI, lifted out of `Facilities.tsx`
// when both that page's tabs became placeholders. It is intentionally kept whole
// and unreferenced: the facility levels it edits are still live in the save and
// still feed development, recovery and intake, so the redesign of facilities +
// backroom staff starts from this rather than from scratch.
//
// Nothing imports it. Re-export it from `Facilities.tsx` to bring it back.

import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import { trainingNextCost, type TrainingFacility } from "@/lib/economy";
import { formatMoney } from "@/lib/value";
import { UpgradeCard } from "../ui";

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

export default function FacilitiesTab() {
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
      // effectNow is the bare figure and effectNext carries the unit — the card
      // renders them as "+0% ➔ +12% development speed", one progression rather
      // than two columns to compare.
      effectNow: `+${Math.round((team.trainingLevel ?? 0) * TUNING.trainingFacilityGrowthPerLevel * 100)}%`,
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
      effectNow: `+${((team.medicalLevel ?? 0) * TUNING.medicalFacilityRecoveryPerLevel).toFixed(1)}`,
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
      effectNow: `+${Math.round((team.gymnasiumLevel ?? 0) * TUNING.gymnasiumGrowthPerLevel * 100)}%`,
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
      effectNow: `~${Math.max(2, Math.round(TUNING.intakeClassBase + (team.academyLevel ?? 0) * TUNING.intakeClassPerLevel))} per class, +${Math.round((team.academyLevel ?? 0) * TUNING.trainingFacilityGrowthPerLevel * 100)}%`,
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
      effectNow: `+${posPct(team.gkCentreLevel ?? 0)}%`,
      effectNext: `+${posPct((team.gkCentreLevel ?? 0) + 1)}% GK growth`,
    },
    {
      key: "defenceCentre", title: "Defensive Unit", icon: "🛡️", accent: "#5b8fd6",
      level: team.defenceCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "Back-line drills, shape work and duel training. Speeds up development for centre backs and full backs.",
      effectNow: `+${posPct(team.defenceCentreLevel ?? 0)}%`,
      effectNext: `+${posPct((team.defenceCentreLevel ?? 0) + 1)}% defender growth`,
    },
    {
      key: "midfieldCentre", title: "Midfield Hub", icon: "⚙️", accent: "#5fbf8a",
      level: team.midfieldCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "Rondos, tempo work and transition drills. Speeds up development for defensive, central and attacking midfielders.",
      effectNow: `+${posPct(team.midfieldCentreLevel ?? 0)}%`,
      effectNext: `+${posPct((team.midfieldCentreLevel ?? 0) + 1)}% midfielder growth`,
    },
    {
      key: "attackCentre", title: "Attacking Centre", icon: "⚔️", accent: "#d97a4a",
      level: team.attackCentreLevel ?? 0, maxLevel: TUNING.positionFacilityMaxLevel,
      influence: "Final-third patterns, movement in behind and one-v-one work. Speeds up development for wingers and strikers.",
      effectNow: `+${posPct(team.attackCentreLevel ?? 0)}%`,
      effectNext: `+${posPct((team.attackCentreLevel ?? 0) + 1)}% forward growth`,
    },
  ];

  const planFacilities: FacilityRow[] = [
    {
      key: "sportsScience", title: "Sports Science Lab", icon: "🔬", accent: "#4fb8b8",
      level: team.sportsScienceLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: "GPS tracking, load management and conditioning science. Amplifies the athletic training plans — the ones built on pace, strength and stamina.",
      effectNow: `+${planPct(team.sportsScienceLevel ?? 0)}%`,
      effectNext: `+${planPct((team.sportsScienceLevel ?? 0) + 1)}% on athletic plans`,
    },
    {
      key: "techCentre", title: "Technical Centre", icon: "🎓", accent: "#8a7fd6",
      level: team.techCentreLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: "Video suites, pattern-of-play rooms and small-sided technical pitches. Amplifies the technical training plans — passing, control and defending work.",
      effectNow: `+${planPct(team.techCentreLevel ?? 0)}%`,
      effectNext: `+${planPct((team.techCentreLevel ?? 0) + 1)}% on technical plans`,
    },
    {
      key: "finishingCentre", title: "Finishing School", icon: "🥅", accent: "#d9a441",
      level: team.finishingCentreLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: "Dedicated shooting pitches and finishing coaches working in and around the box. Amplifies the finishing training plans.",
      effectNow: `+${planPct(team.finishingCentreLevel ?? 0)}%`,
      effectNext: `+${planPct((team.finishingCentreLevel ?? 0) + 1)}% on finishing plans`,
    },
    {
      key: "youthDevCentre", title: "Youth Development Centre", icon: "🌿", accent: "#7fbf5f",
      level: team.youthDevCentreLevel ?? 0, maxLevel: TUNING.planFacilityMaxLevel,
      influence: `Age-group coaching, individual development plans and a pathway to the first team. Speeds up development for every player aged ${TUNING.academyMaxAge} or under, senior squad or academy.`,
      effectNow: `+${youthPct(team.youthDevCentreLevel ?? 0)}%`,
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
        // Only a blocked state earns a note (v1.65). The old string here —
        // "A long-term investment in your squad." — was identical on all twelve
        // cards, so it carried no information and cost a line on each one.
        note={canAfford || maxed ? undefined : "Not enough budget yet."}
        onUpgrade={() => upgradeTraining(f.key)}
      />
    );
  };

  // The cards carry their own title now, so each family is introduced once by a
  // gold-threaded section head rather than every card announcing itself.
  const group = (title: string, blurb: string, rows: FacilityRow[]) => (
    <section>
      <h3 className="display text-base font-semibold uppercase tracking-wide text-ink">{title}</h3>
      <div className="gold-thread mt-1 mb-2 w-full" />
      <p className="mb-3 max-w-3xl text-[13px] leading-relaxed text-dim">{blurb}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">{rows.map(renderCard)}</div>
    </section>
  );

  return (
    <div className="space-y-7">
      {group(
        "Core Facilities",
        "Infrastructure is the slowest and most permanent way to improve a squad. These four lift the whole club; the specialist centres below are narrower but cheaper, so you can build an identity rather than only scaling up.",
        facilities
      )}
      {group(
        "Position Centres",
        "Each centre speeds up development for one position group. Cheaper than the Training Centre because each only helps a quarter of the squad — build the ones your best prospects sit in.",
        positionFacilities
      )}
      {group(
        "Training Plan Centres",
        "These amplify the training focuses you set on the Development page, so they pay off most when your squad is actually training the matching plans.",
        planFacilities
      )}
    </div>
  );
}

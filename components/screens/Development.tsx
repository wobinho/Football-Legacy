"use client";

// Player Development (§5, new 8th screen). Training Plans is the heart of the
// screen: a per-player training focus you can set, with each row expanding to
// show how that player is developing — growth per season, projected ceilings,
// estimated time to potential, and growth history.
//
// v1.74 rework of the Training Plans tab. The old list had five problems, all of
// them the same problem in different clothes — the row said what the plan was
// CALLED and nothing about what it DID:
//
//   · plan names truncated to "Balanced Goalke…" in an 11rem track;
//   · the dropdown was a native <select>, so its menu was the OS widget —
//     square corners, system-blue highlight, nothing to do with this theme;
//   · nothing showed which attributes a plan actually trains;
//   · a huge dead gutter between the player name and the right-hand columns;
//   · one green dot carrying a binary "optimal / not" with no third state.
//
// The row is now: identity (pos, name, flag, archetype) · age · OVR · phase ·
// growth · the plan itself with its target attributes underneath. The plan
// picker is the themed `Select`, whose menu has room for the archetype each plan
// aims at and the attributes it trains — the information that makes the choice
// mean something. See PlanStatus for the three-state indicator.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { Attributes, PlayerBio, Pos } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { eliteResistRelief, growthMultiplier } from "@/lib/facilities";
import {
  archetypeConversionEta,
  devPhase,
  seasonGrowth,
  seasonGrowthEstimate,
  seasonFamilyFocus,
  type ArchetypeEta,
} from "@/lib/development";
import { ATTR_FAMILY_LABELS, ATTR_FAMILY_ORDER, ATTR_META, GK_FAMILY_LABELS } from "@/lib/config/attributes";
import { academyGrowthSummary, prospectGrowth, type ProspectGrowth } from "@/lib/academy";
import { optimalTrainingPlan, plansForPosition, resolveTrainingPlan, type TrainingPlanDef } from "@/lib/config/training";
import { ARCHETYPE_BY_PLAN, ARCHETYPE_CLASS_COLOR, deriveArchetype, getArchetype } from "@/lib/config/archetype";
import { POS_ORDER } from "@/lib/config/positions";
import { Card, ClassDot, displayFullName, FitnessBar, Flag, GhostButton, GoldButton, Modal, Ovr, ArchetypeIcon, PlayerCard, PlayerGrid, PosBadge, Select, Tabs, usePlayerView, ViewToggle, type SelectOption } from "../ui";

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


// Shared grid template for the Training Plans header + rows.
//
// v1.74: the plan track went 11rem → 15rem, which is what the longest shipped
// plan name ("Balanced Goalkeeper", "Distribution Specialist") actually needs —
// the truncation was never a naming problem, it was a width one, so the names
// stay honest and the column grew. Two tracks were added between the name and
// the right-hand block (phase, growth), which is what closes the dead gutter:
// the space is now carrying the two numbers a development screen is for.
//
// v1.76: the archetype moved OUT of the name cell into a track of its own, and the
// two text tracks became `1fr` again. Both changes fix the same bug from opposite
// ends. Capping the name at 22rem and fixing every other track meant the row's
// total width was a constant ~55rem — on any wide window the whole table hugged
// the left edge with the right half of the card empty, which is the "half a
// container" the screen was showing. Letting name and archetype share the slack is
// what makes the row fill its card at any width. Stacking the archetype under the
// name was also the wrong shape for a sortable table: it made the name cell two
// lines tall and left the identity unreadable as a column. It is a fact about the
// player like age or overall, so it gets a column like them.
const PLAN_GRID =
  "grid-cols-[2rem_1fr_2rem_2.5rem_9rem] sm:grid-cols-[2.25rem_minmax(9rem,1fr)_minmax(8rem,1fr)_2.5rem_3rem_4.5rem_4.5rem_15rem]";

/** The position groups the filter bar offers, and which real positions each
 * covers. Filtering by unit is what a manager actually wants ("show me the
 * defenders"), and it is four buttons rather than twelve. */
const POS_GROUPS: { id: string; label: string; match: (pos: Pos) => boolean }[] = [
  { id: "GK", label: "GK", match: (p) => p === "GK" },
  { id: "DEF", label: "DEF", match: (p) => ["CB", "LB", "RB"].includes(p) },
  { id: "MID", label: "MID", match: (p) => ["DM", "CM", "AM", "LM", "RM"].includes(p) },
  { id: "ATT", label: "ATT", match: (p) => ["LW", "RW", "ST"].includes(p) },
];

/**
 * The three-state status marker for a player's training focus (v1.74).
 *
 * The old marker was binary — a green dot for "this is the optimal plan", a
 * gold ring for anything else — which collapsed two quite different situations
 * into one: a player on a deliberately-chosen alternative plan looked exactly
 * like a player nobody had ever looked at, and a player too old to gain anything
 * from any plan looked like a mistake.
 *
 *   ● green  Optimal — the plan that best fits the player he is.
 *   ● gold   Sub-optimal — a workable plan, but another fits him better.
 *   ● dim    Settled — past the growth window, so the plan changes little.
 *
 * Settled deliberately outranks sub-optimal: telling a 33-year-old's manager to
 * switch his focus is noise, and dimming him is what keeps the gold dots
 * meaningful as a to-do list.
 */
export function PlanStatus({ optimal, growing, best }: { optimal: boolean; growing: boolean; best: TrainingPlanDef }) {
  const state = !growing
    ? { cls: "text-faint", title: "Settled — past the growth window, so the focus changes little now." }
    : optimal
      ? { cls: "text-win", title: "Optimal — the focus that best fits this player." }
      : { cls: "text-gold", title: `Sub-optimal — ${best.name} fits him better.` };
  return (
    <span className={`shrink-0 text-[10px] leading-none ${state.cls}`} title={state.title} aria-label={state.title}>
      ●
    </span>
  );
}

/**
 * The attributes a plan trains, as compact chips (v1.74).
 *
 * "Why am I changing this focus?" was unanswerable from the old row — the plan
 * was a name and nothing else. A plan's four PRIMARY attributes are the answer,
 * and they are already authored in the training table, so this reads them rather
 * than restating anything: Distribution Specialist shows KIC · HAN · GKP · VIS.
 *
 * `secondary` adds the supporting four in a dimmer tone, for the dropdown menu
 * where there is room for the full picture.
 */
export function PlanTargets({
  plan,
  attrs,
  secondary = false,
  max = 4,
}: {
  plan: TrainingPlanDef;
  /** The player's current values, to colour a chip that has run out of room. */
  attrs?: Attributes;
  secondary?: boolean;
  max?: number;
}) {
  const keys = [...plan.primary.slice(0, max), ...(secondary ? plan.secondary.slice(0, max) : [])];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {keys.map((k, i) => {
        const isSecondary = i >= plan.primary.slice(0, max).length;
        const v = attrs?.[k];
        // An attribute already at the ceiling can't absorb more training, so it
        // reads dim even when it is a primary target — that is the honest
        // signal that this plan has less left to give this player.
        const maxed = v !== undefined && v >= 95;
        return (
          <span
            key={k}
            title={`${ATTR_META[k].name}${v !== undefined ? ` — currently ${v}` : ""}${
              isSecondary ? " (supporting)" : ""
            }${maxed ? ", little room left" : ""}`}
            className={`display shrink-0 rounded-sm border px-1 py-px text-[9px] font-semibold tracking-wide ${
              maxed
                ? "border-line text-faint"
                : isSecondary
                  ? "border-line text-dim"
                  : "border-gold-lo/40 text-gold"
            }`}
          >
            {ATTR_META[k].short}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Build the themed dropdown's options for one player's position.
 *
 * Each row carries what the bare name can't: the archetype the plan aims at (the
 * far end of the Training Plan → Attributes → Archetype loop, so the manager can
 * see he is training a Sniper rather than "Finishing"), the attributes it
 * trains, and a ★ on the recommended one.
 */
export function planOptions(pos: Pos, attrs: Attributes, bestId: string): SelectOption<string>[] {
  return plansForPosition(pos).map((o) => {
    const archetype = ARCHETYPE_BY_PLAN[o.id];
    return {
      value: o.id,
      label: o.name,
      hint: (
        <span className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            {archetype && (
              <>
                {/* The art leads the row: picking a plan IS picking the archetype
                    at the end of it, so the manager sees the badge he is
                    training toward before he reads its name. */}
                <ArchetypeIcon archetype={archetype} size={16} />
                <span style={{ color: ARCHETYPE_CLASS_COLOR[archetype.cls] }}>{archetype.name}</span>
                <ClassDot cls={archetype.cls} />
                <span className="text-faint">{archetype.cls}</span>
              </>
            )}
          </span>
          <PlanTargets plan={o} attrs={attrs} />
        </span>
      ),
      badge:
        o.id === bestId ? (
          <span className="shrink-0 text-[10px] text-gold" title="Recommended for this player">
            ★
          </span>
        ) : undefined,
    };
  });
}

type Tab = "plans" | "growth";

export default function DevelopmentScreen() {
  const [tab, setTab] = useState<Tab>("plans");
  return (
    <div>
      {/* v1.72: Training Facilities and Development Staff moved off this screen
          to the Facilities/Staff page. They are club-level concerns; Development
          is about individual players and where their growth is going. */}
      <Tabs
        tabs={[
          { id: "plans", label: "Training Plans" },
          { id: "growth", label: "Growth" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "plans" && <TrainingPlansTab />}
      {tab === "growth" && <GrowthTab />}
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
  // Filter bar (v1.74): a squad is 25+ players, so finding one was a scroll.
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Confirmation for auto-assign — it rewrites every plan in the squad at once,
  // which is not something to do on a mis-click with no statement of the rule.
  const [confirmAuto, setConfirmAuto] = useState(false);
  const ctx = devContext(game);
  const team = game.teams[game.userTeamId];

  // Senior squad only — academy prospects have their own development tab on the
  // Academy screen (their training plans are set there, not here).
  const academyIds = new Set(team.academyPlayerIds ?? []);
  const ids = [...team.playerIds];
  const all = ids
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired)
    .sort((a, b) => {
      const cmp = comparePlan(a, b, sort.key) * sort.dir;
      // Stable tiebreak so equal keys always land in the same order.
      return cmp || (POS_RANK[a.positions[0]] ?? 99) - (POS_RANK[b.positions[0]] ?? 99) || a.name.localeCompare(b.name);
    });

  const q = query.trim().toLowerCase();
  const squad = all.filter((p) => {
    if (group && !POS_GROUPS.find((g) => g.id === group)?.match(p.positions[0])) return false;
    if (q && !displayFullName(p).toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // How many players aren't yet on the focus that would most improve them —
  // drives the auto-assign call to action. Counted over the WHOLE squad, not
  // the filtered view: the button acts on everyone, so its count must too.
  const suboptimal = all.filter(
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
                that isn&apos;t the best fit. Auto-assign gives each player the plan that suits the player he already
                is — the one built around the attributes his archetype is defined by, where he still has room to grow.
              </>
            ) : (
              "Every player is already training the focus that suits them best."
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          <GoldButton
            onClick={() => setConfirmAuto(true)}
            disabled={suboptimal === 0}
            className="!py-1.5 text-xs"
            title={
              suboptimal === 0
                ? "Every player is already on his best-fit focus"
                : `Set all ${suboptimal} mismatched players to their best-fit focus`
            }
          >
            AUTO-ASSIGN ALL
          </GoldButton>
        </div>
      </Card>

      {/* Filter bar — position group and name search. Both narrow the list only;
          nothing here changes a plan, so it is safe to leave set. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setGroup(null)}
            className={`display rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              group === null ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
            }`}
          >
            All
          </button>
          {POS_GROUPS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroup(group === g.id ? null : g.id)}
              className={`display rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                group === g.id ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search squad…"
          className="w-44 rounded-md border border-line bg-raised px-2.5 py-1 text-xs text-ink outline-none transition-colors placeholder:text-faint hover:border-faint focus:border-gold"
        />
        <span className="text-[11px] text-faint">
          {squad.length === all.length ? `${all.length} players` : `${squad.length} of ${all.length}`}
        </span>
      </div>

      {view === "grid" ? (
        <PlayerGrid>
          {squad.map((p) => {
            const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
            const best = optimalTrainingPlan(p);
            const isOptimal = plan.id === best.id;
            const growing = p.age <= TUNING.growthEndAge;
            const inAcademy = academyIds.has(p.id);
            const last = p.devLog && p.devLog.length ? p.devLog[p.devLog.length - 1] : null;
            const eta = archetypeConversionEta(p, TUNING, ctx.facilityMult, ctx.eliteRelief, ctx.seasonDay);
            return (
              <PlayerCard
                key={p.id}
                p={p}
                onOpen={() => viewPlayer(p.id)}
                ovr={<Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />}
                sub={
                  // Only an ARRIVING conversion displaces the developing/matured
                  // line: it is the vaguer statement of the same fact, and the
                  // card has one subtitle to spend. A dead end deliberately does
                  // NOT take the slot here — "never" is the answer for most of
                  // the squad, and a grid of red would drown the one card that
                  // is actually converting. The list row and the drawer, where
                  // the manager is working plan by plan, still say it.
                  eta && eta.outcome === "arriving" ? (
                    <span className="flex items-center gap-1.5 truncate text-[11px]">
                      {inAcademy && <AcademyTag />}
                      <ArchetypeEtaChip eta={eta} compact />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 truncate">
                      {inAcademy && <AcademyTag />}
                      <span className="truncate">{growing ? "Still developing" : "Reached maturity"}</span>
                    </span>
                  )
                }
                stats={
                  <span className="flex items-center gap-1.5">
                    <PlanTargets plan={plan} attrs={p.attrs} max={3} />
                    {last && last.toOverall !== last.fromOverall && (
                      <span className={`tnum ${last.toOverall > last.fromOverall ? "text-win" : "text-loss"}`}>
                        {last.toOverall > last.fromOverall ? "+" : ""}
                        {last.toOverall - last.fromOverall}
                      </span>
                    )}
                  </span>
                }
                actions={
                  <span className="flex w-full items-center gap-1.5">
                    <PlanStatus optimal={isOptimal} growing={growing} best={best} />
                    <Select
                      value={plan.id}
                      options={planOptions(p.positions[0], p.attrs, best.id)}
                      onChange={(v) => setPlan(p.id, v)}
                      className="min-w-0 flex-1"
                      buttonClassName="!py-1 text-xs"
                      title={plan.blurb}
                      ariaLabel={`Training focus for ${p.name}`}
                    />
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
          {/* v1.76: the identity as its own column. Hidden on phones, where the
              row has no width to spare — the card view is the mobile answer. */}
          <span className="hidden sm:block" title="The identity his current attributes have earned">
            Archetype
          </span>
          <SortHeader label="Age" col="age" sort={sort} onSort={setSort} align="center" />
          <SortHeader label="OVR" col="ovr" sort={sort} onSort={setSort} align="center" />
          {/* v1.74: two columns pulled into the old dead gutter. Phase is the
              honest substitute for the potential the manager can't see, and
              Growth is this season's estimate — the two things that decide
              whether a training focus is worth thinking about at all. */}
          <span className="hidden text-center sm:block" title="Where this player is in his career arc">
            Phase
          </span>
          <span className="hidden text-center sm:block" title="Estimated overall gain this season on the current focus">
            Growth
          </span>
          <span className="text-center">Training focus</span>
        </div>
        {squad.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-faint">No players match that filter.</div>
        )}
        {squad.map((p) => {
          const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
          const best = optimalTrainingPlan(p);
          const isOptimal = plan.id === best.id;
          const inAcademy = academyIds.has(p.id);
          const isOpen = open === p.id;
          const growing = p.age <= TUNING.growthEndAge;

          // Potential is hidden from the manager. Everything shown here is a
          // one-season-ahead estimate — no ceilings, no multi-season horizon.
          const phase = devPhase(p, TUNING);
          const season = seasonGrowthEstimate(p, TUNING, ctx.facilityMult, plan, ctx.eliteRelief);
          const last = p.devLog && p.devLog.length ? p.devLog[p.devLog.length - 1] : null;
          // The archetype is the far end of the loop this screen drives: the plan
          // shapes attributes, and the attributes earn the identity. Showing it
          // beside the name is what makes the training focus feel consequential
          // rather than like a stat allocation.
          const archetype = deriveArchetype(p.attrs, p.positions[0]);
          // Null whenever there's nothing to say — he already IS the plan's
          // archetype, or he's stopped growing. See archetypeConversionEta.
          const eta = archetypeConversionEta(p, TUNING, ctx.facilityMult, ctx.eliteRelief, ctx.seasonDay);

          return (
            <div key={p.id}>
              <div className={`grid ${PLAN_GRID} items-center gap-3 px-4 py-2.5`}>
                <PosBadge pos={p.positions[0]} />
                <button
                  onClick={() => setOpen(isOpen ? null : p.id)}
                  className="group flex min-w-0 items-center gap-2 text-left"
                  aria-expanded={isOpen}
                >
                  <span className={`shrink-0 text-[10px] text-faint transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                  <Flag nat={p.nationality} size={12} />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium transition-colors group-hover:text-gold">
                      {displayFullName(p)}
                    </span>
                    {inAcademy && <AcademyTag />}
                  </span>
                </button>
                {/* The archetype column (v1.76). The far end of the loop this
                    screen drives: the plan shapes attributes, and the attributes
                    earn the identity — so it sits beside the focus that produced
                    it rather than tucked under the name. */}
                {/* v1.80: name and class on ONE line. Stacking them made every
                    row two lines tall for a word the colour already encodes —
                    the class now trails the name in small caps and the row keeps
                    a single line's height. */}
                {/* v1.84: the class word gives way to the conversion ETA when
                    there is one. Both are trailing context on the identity, the
                    colour already encodes the class, and "→ Sniper ≈ 14 weeks"
                    is the far more actionable of the two — so they share the one
                    slot rather than the row growing a second line for it. */}
                <span className="hidden min-w-0 sm:block">
                  {archetype ? (
                    <span
                      className="flex min-w-0 items-baseline gap-1.5 text-[12px]"
                      title={`${archetype.name} · ${archetype.cls} — ${archetype.desc}`}
                    >
                      <span className="shrink-0 self-center">
                        <ArchetypeIcon archetype={archetype} size={18} />
                      </span>
                      <span className="shrink-0 truncate" style={{ color: ARCHETYPE_CLASS_COLOR[archetype.cls] }}>
                        {archetype.name}
                      </span>
                      {/* A dead end earns the slot only when the focus is also
                          the wrong one — there it IS the reason to change it.
                          On an optimal focus it is true but inert: the best
                          plan for him remains the best plan for him, and
                          telling a settled 30-year-old he'll never reach his
                          plan's namesake is noise. An arriving conversion
                          always shows: that one is news either way. */}
                      {eta && (eta.outcome === "arriving" || !isOptimal) ? (
                        <span className="min-w-0 text-[11px]">
                          <ArchetypeEtaChip eta={eta} compact />
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] uppercase tracking-widest text-faint">
                          {archetype.cls}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[12px] text-faint">—</span>
                  )}
                </span>
                <span className="text-center tnum text-sm text-dim">{p.age}</span>
                <span className="flex items-center justify-center">
                  <Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />
                </span>
                <span className="hidden justify-center sm:flex">{phaseChip(phase)}</span>
                <span className="hidden justify-center text-center sm:flex">
                  {season && season.delta > 0 ? (
                    <span className="tnum text-sm font-semibold text-win">+{season.delta}</span>
                  ) : last && last.toOverall !== last.fromOverall ? (
                    <span
                      className={`text-[11px] tnum ${last.toOverall > last.fromOverall ? "text-win" : "text-loss"}`}
                      title="No growth projected — last season's movement instead"
                    >
                      {last.toOverall > last.fromOverall ? "+" : ""}
                      {last.toOverall - last.fromOverall}
                    </span>
                  ) : (
                    <span className="tnum text-faint">—</span>
                  )}
                </span>
                {/* v1.77: the four target chips used to sit under the picker on
                    a second line. They doubled the height of every row for
                    information the picker's own menu already carries, and the
                    drawer repeats in full — so the row is now a single line and
                    the chips live only where they're asked for. */}
                <span className="flex min-w-0 items-center gap-1.5">
                  <PlanStatus optimal={isOptimal} growing={growing} best={best} />
                  <Select
                    value={plan.id}
                    options={planOptions(p.positions[0], p.attrs, best.id)}
                    onChange={(v) => setPlan(p.id, v)}
                    className="min-w-0 flex-1"
                    title={plan.blurb}
                    ariaLabel={`Training focus for ${p.name}`}
                  />
                </span>
              </div>

              {isOpen && (
                <div className="border-t border-line/50 bg-raised px-4 py-4">
                  {/* Condition strip (v1.74): fitness and the current identity,
                      so the drawer answers "can he take this work right now?"
                      without a trip to the profile page. */}
                  <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line/60 pb-3">
                    <span className="flex min-w-[10rem] items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-faint">Fitness</span>
                      <span className="w-24">
                        <FitnessBar value={p.fitness} showValue />
                      </span>
                    </span>
                    {archetype && (
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-widest text-faint">Archetype</span>
                        <span className="display text-sm font-semibold text-ink">{archetype.name}</span>
                        <span className="rounded-sm border border-line px-1.5 py-px text-[10px] text-dim">
                          {archetype.cls}
                        </span>
                      </span>
                    )}
                    {/* The drawer has the room the row doesn't, so the ETA gets
                        its own labelled slot here and the sentence version of
                        the estimate rather than the four-word chip. */}
                    {eta && (
                      <span className="flex items-center gap-2 text-[12px]">
                        <span className="text-[10px] uppercase tracking-widest text-faint">Becoming</span>
                        <ArchetypeEtaChip eta={eta} />
                      </span>
                    )}
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-faint">Focus trains</span>
                      <PlanTargets plan={plan} attrs={p.attrs} secondary />
                    </span>
                  </div>
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

      {/* Auto-assign confirmation (v1.74). The button rewrites every plan in the
          squad at once, and the old one did it silently on a single click — so
          a deliberate hand-set plan could be wiped with no warning and no
          statement of the rule being applied. The rule is stated here. */}
      {confirmAuto && (
        <Modal title="Auto-assign every training focus?" onClose={() => setConfirmAuto(false)}>
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-dim">
              This sets <b className="text-ink tnum">{suboptimal}</b> player{suboptimal === 1 ? "" : "s"} to their
              best-fit focus. Any focus you set by hand on those players is replaced.
            </p>
            <p className="text-[12px] leading-relaxed text-faint">
              Best fit means the plan built around the attributes the player is already defined by, weighted by how
              much room each of those attributes still has to grow — so it points a target man at Target Man rather
              than at False 9. It is <b className="text-dim">not</b> the fastest route to a higher overall: every plan
              for a position develops overall at the same rate, so what you are choosing is where the growth
              <em> lands</em>, never how much of it there is.
            </p>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setConfirmAuto(false)}>Cancel</GhostButton>
              <GoldButton
                onClick={() => {
                  autoAssign();
                  setConfirmAuto(false);
                }}
              >
                AUTO-ASSIGN
              </GoldButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Squad growth tracking (v1.53) ──────────────────────────────────────────
// The Academy's Growth tab answers "is my academy producing?" for prospects.
// This is the same picture for the SENIOR squad: every first-team player's
// overall charted season by season, rolled up into a handful of squad numbers.
// It reuses the academy's growth helpers wholesale — `prospectGrowth` reads a
// player's `devLog`, which the rollover writes for senior players too, so
// nothing about it is academy-specific but the name.

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

// No sparkline column (v1.63): the curve read as decoration next to the three
// hard numbers beside it, and on a phone it ate a full row per player. Total /
// Season / Per-yr carry the same story in a form you can actually compare down
// the column.
const GROWTH_GRID = "md:grid-cols-[2.25rem_1fr_2.5rem_3.5rem_4.5rem_4.5rem_4.5rem]";

function GrowthTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [sortKey, setSortKey] = useState<GrowthSort>("total");

  const team = game.teams[game.userTeamId];
  // Senior squad only — academy prospects already have their own Growth tab on
  // the Academy screen, so listing them here too would double them up.
  const academyIds = new Set(team.academyPlayerIds ?? []);

  const rows = useMemo(() => {
    const list = team.playerIds
      .map((id) => game.players[id])
      .filter((p): p is PlayerBio => !!p && !p.retired && !academyIds.has(p.id))
      .map((p) => prospectGrowth(game, p));
    const cmp: Record<GrowthSort, (a: ProspectGrowth, b: ProspectGrowth) => number> = {
      total: (a, b) => b.totalGain - a.totalGain || b.player.overall - a.player.overall,
      season: (a, b) => b.seasonGain - a.seasonGain || b.totalGain - a.totalGain,
      rate: (a, b) => b.perSeason - a.perSeason || b.totalGain - a.totalGain,
      overall: (a, b) => b.player.overall - a.player.overall,
      age: (a, b) => a.player.age - b.player.age || b.player.overall - a.player.overall,
    };
    return list.sort(cmp[sortKey]);
    // academyIds is derived from game each render; game+sortKey cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, sortKey]);

  const summary = useMemo(() => academyGrowthSummary(rows), [rows]);

  if (rows.length === 0) {
    return (
      <Card className="border-dashed px-4 py-8 text-center text-sm text-faint">
        No senior players to track yet.
      </Card>
    );
  }

  const stats: { label: string; value: React.ReactNode; hint: string }[] = [
    {
      label: "Players tracked",
      value: `${summary.tracked}/${rows.length}`,
      hint: "Senior players with at least one completed season on record",
    },
    {
      label: "Total OVR added",
      value: <Delta value={summary.totalGain} />,
      hint: "Overall your squad has added across every player since each arrived",
    },
    {
      label: "Avg per season",
      value: <Delta value={Math.round(summary.avgPerSeason * 10) / 10} />,
      hint: "Mean overall a tracked player gains in a season — your squad's rate of climb",
    },
    {
      label: "Avg overall",
      value: <span className="tnum">{summary.avgOverall.toFixed(1)}</span>,
      hint: "Mean current overall across the senior squad",
    },
  ];

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="display font-semibold text-ink">How your squad is developing</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-faint">
          How every first-team player&apos;s overall has moved: what he has added since he was first recorded, what he
          has added this season, and his average per season. Growth comes from minutes, your coaching staff and your
          training facilities, so a settled number usually means a player at his level rather than a failing one.
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
          <span>Player</span>
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

// ── how much dev help the club currently provides ──
// v1.79: this used to gather three numbers from two systems (a dev coach's
// stars, a training level, a medical level). It is now one — the club's
// facilities multiplier — because there is one thing that makes players
// develop faster: the Elite Training Center and the staff working in it.
// v1.81 adds the second: the High Performance Center's elite-resistance relief.
// It is a second NUMBER, not a second system — both come out of `facilityEffect`,
// and a projection that omitted the relief would under-quote every elite player's
// coming season, which is precisely the group the building is bought for.
function devContext(game: ReturnType<typeof useGame.getState>["game"]) {
  return {
    facilityMult: growthMultiplier(game!, game!.userTeamId),
    eliteRelief: eliteResistRelief(game!, game!.userTeamId),
    // How far into the season the save stands, so an ETA can quote the days
    // left rather than rounding every answer up to a whole season.
    seasonDay: Math.max(0, game!.currentDay - game!.schedule.seasonStartDay),
  };
}

/**
 * "→ Sniper ≈ 7 seasons", or why he'll never be one (v1.84).
 *
 * The screen's whole premise is that a plan reshapes a player into someone
 * else, and until now the third arrow of that loop was invisible: you set the
 * plan and then had no idea whether the identity was one season out or never
 * coming at all.
 *
 * Conversion is real and reasonably common where there is growth to spend:
 * across every world-generated U21 with headroom, 17% of player×plan pairs
 * convert, median 7 seasons, some in one. Where it fails it is almost always
 * because the PLAYER is out of growth, not because the plan is wrong — so the
 * two dead ends say different things and are worded differently. "No growth
 * left" points at the player's age; "too far a shape" points at the plan.
 * Collapsing them into one "won't happen" made a squad of settled 28-year-olds
 * look like a broken training system.
 *
 * Nothing at all renders when the player is already the archetype his plan aims
 * at, which is the common case for a squad on auto-assigned plans: a row that
 * says "0 weeks to what he already is" is worse than a row that says nothing.
 */
function ArchetypeEtaChip({ eta, compact = false }: { eta: ArchetypeEta; compact?: boolean }) {
  const target = getArchetype(eta.targetId);
  if (!target) return null;
  const arriving = eta.outcome === "arriving";

  // Weeks inside a season and a bit, seasons beyond it — a manager thinks in
  // weeks up to a point and in seasons after it, and "≈ 340 weeks" is a
  // precision the estimate does not have.
  const when = !arriving
    ? eta.outcome === "noGrowth"
      ? "no growth left"
      : "too far a shape"
    : eta.weeks <= 60
      ? `≈ ${eta.weeks} week${eta.weeks === 1 ? "" : "s"}`
      : `≈ ${eta.seasons} season${eta.seasons === 1 ? "" : "s"}`;

  const title = arriving
    ? `Estimated ${eta.days} day${eta.days === 1 ? "" : "s"} (${eta.weeks} week${
        eta.weeks === 1 ? "" : "s"
      }, ${eta.seasons} season${eta.seasons === 1 ? "" : "s"}) on this focus before his attributes earn the ${
        target.name
      } identity. An estimate at full minutes with your current facilities — more game time gets there sooner, less takes longer.`
    : eta.outcome === "noGrowth"
      ? `This focus is pointing him the right way, but he runs out of development before it finishes the job — an archetype is earned by having its attributes stand clear of the player's own average, and he has no growth left to open that gap. Nothing is wrong with the plan; it needed to start years earlier. On a prospect it would work.`
      : `${target.name} is too far from the player he is for training alone to close it: he keeps developing for a full career on this focus and still never earns the identity. A focus nearer his current shape will land, and sooner.`;

  return (
    <span className={`flex min-w-0 items-center gap-1 ${arriving ? "text-dim" : "text-faint"}`} title={title}>
      <span className="shrink-0 opacity-70" aria-hidden>
        →
      </span>
      <span className={`shrink-0 ${arriving ? "" : "opacity-50"}`}>
        <ArchetypeIcon archetype={target} size={compact ? 12 : 14} />
      </span>
      <span className="truncate" style={{ color: arriving ? ARCHETYPE_CLASS_COLOR[target.cls] : undefined }}>
        {target.name}
      </span>
      {/* A dead end is stated plainly, not in alarm red: "no growth left" on a
          29-year-old is ordinary football, not a mistake the manager made. Only
          the genuinely wrong-shape case gets the loss tone. */}
      <span className={`tnum shrink-0 ${eta.outcome === "tooFar" ? "text-loss/80" : ""}`}>{when}</span>
    </span>
  );
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
  // Where the coming season's growth (delta overall) is expected to flow, rolled
  // up to the six card faces — this season only, never a lifetime ceiling. The
  // full 35-attribute breakdown lives on the player's profile.
  const proj = seasonFamilyFocus(p, delta, plan);
  const isGk = p.positions[0] === "GK";
  const labels = isGk ? GK_FAMILY_LABELS : ATTR_FAMILY_LABELS;
  return (
    <div className="space-y-1.5">
      {ATTR_FAMILY_ORDER.map((f) => {
        const { now, gain } = proj[f];
        const next = Math.min(99, now + gain);
        return (
          <div key={f} className="flex items-center gap-2 text-xs">
            <span className="display w-8 text-faint">{labels[f].slice(0, 3).toUpperCase()}</span>
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

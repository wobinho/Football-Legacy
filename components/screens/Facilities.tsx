"use client";

// Facilities & Staff (v1.79) — the club's physical plant and its backroom.
//
// The two tabs are one decision seen from two sides. A FACILITY holds an
// effect; the STAFF you assign to it amplify that effect. Neither is worth much
// alone, which is why they finally live on the same page: an empty Elite
// Training Center is a 5% building, and a 5-star coach with nowhere to work is
// a wage.
//
// The design rule this screen follows: never show a total without showing the
// arithmetic that produced it. `facilityEffect()` returns base/stars/badges
// separately for exactly this reason, and the same function is what the
// development pass consumes — so the number quoted here is the number the
// simulation uses, never a UI approximation of it.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import type { BadgeTier, FacilityId, StaffCandidate, StaffPerson } from "@/lib/types";
import {
  BADGE_COLOR,
  BADGE_LADDER,
  FACILITY_SPECS,
  FACILITY_MAP,
  STAFF_BADGE_SLOTS,
  STAFF_STARS_PER_STEP,
  facilityMaxLevel,
  type FacilitySpec,
} from "@/lib/config/facilities";
import { TUNING } from "@/lib/config/tuning";
import {
  assignedTo,
  badgeWeight,
  badgeWeightAt,
  facilityEffect,
  facilityLevel,
  isUnlocked,
  rosterOf,
  seasonsToNextBadge,
  slotCount,
  totalBadgeWeight,
  upgradeCost,
  type FacilityEffect,
} from "@/lib/facilities";
import { formatMoney } from "@/lib/value";
import {
  BadgeIcon,
  Card,
  ConfirmButton,
  FacilityBanner,
  Flag,
  GhostButton,
  GoldButton,
  Modal,
  Section,
  Stars,
  Tabs,
} from "../ui";

type Tab = "facilities" | "staff";

export default function FacilitiesScreen() {
  const [tab, setTab] = useState<Tab>("facilities");
  return (
    <div>
      <Tabs
        tabs={[
          { id: "facilities", label: "Facilities" },
          { id: "staff", label: "Backroom" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "facilities" ? <FacilitiesTab /> : <StaffTab />}
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────
//
// A badge is a crest, not a label. The art carries the facility's mark and the
// tier's ring, so a row of three reads as a career at a glance where three text
// pills read as a paragraph. The tier NAME still travels with every one of them
// in the `title`, because colour alone can't be the only carrier of the fact.

/** The sentence a badge's tooltip says. One place, so the hover text is
 * identical wherever a crest appears. */
function badgeTitle(facility: FacilityId, tier: BadgeTier, seasons: number): string {
  const spec = FACILITY_MAP[facility];
  const served = `${seasons} season${seasons === 1 ? "" : "s"} served`;
  if (!spec) return `${tier.toUpperCase()} badge — ${served}`;
  // What the badge is WORTH has to be quoted per channel now (v1.82): the Youth
  // Academy's tiers buy squad places and prospect value at once, and collapsing
  // that to one number would name a quantity the facility doesn't have.
  const weight = badgeWeight(tier);
  const worth = spec.channels
    .filter((ch) => ch.badgeEffect > 0)
    .map((ch) => {
      const steps = Math.floor(weight / ch.badgeTiersPerStep);
      return `+${round1(steps * ch.badgeEffect)}${ch.unit === "percent" ? "%" : ""} ${ch.label}`;
    });
  const tail = worth.length ? `, worth ${worth.join(" and ")} while assigned there` : "";
  return `${tier.toUpperCase()} ${spec.name} badge — ${served}${tail}`;
}

/** A channel's value, in the unit it is actually measured in. The `+` and the
 * `%` belong to rates; a headcount is just a number, and "+15% squad size"
 * would be a straightforwardly false thing to print. */
function formatChannel(unit: "percent" | "count", value: number): string {
  return unit === "percent" ? `+${round1(value)}%` : `${Math.round(value)}`;
}

/**
 * A badge that hasn't been earned — the crest's own silhouette, dashed.
 *
 * Drawn as the ABSENCE of a badge rather than as a second kind of one: no fill,
 * no label, just the octagon waiting. A dashed box with the word "empty" in it
 * competes with the real crests beside it, which is exactly backwards — the
 * earned thing has to be the loud thing.
 */
function EmptyBadgeMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <polygon
        points="30,7 70,7 93,30 93,70 70,93 30,93 7,70 7,30"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        className="text-line"
        strokeDasharray="9 7"
      />
    </svg>
  );
}

/**
 * Every badge a person holds, and the slots they have left — always all three.
 *
 * The cap is what makes a badge a decision rather than a reward: three
 * facilities, forever, and moving a veteran to a fourth earns nothing. That is
 * only legible if the unspent slots are drawn, so a blank career now renders
 * three empty octagons rather than the words "No badges". The empty mark is
 * deliberately quiet — outline, no fill, no label — so a card with two crests
 * and one gap still reads crests-first.
 */
function BadgeRow({
  person,
  size = 60,
}: {
  person: StaffPerson | StaffCandidate;
  size?: number;
}) {
  const empty = Math.max(0, STAFF_BADGE_SLOTS - person.badges.length);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {person.badges.map((b) => (
        <BadgeIcon
          key={b.facility}
          facility={b.facility}
          tier={b.tier}
          size={size}
          title={badgeTitle(b.facility, b.tier, b.seasons)}
        />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <span
          key={i}
          className="inline-flex shrink-0 items-center justify-center text-line"
          style={{ width: size, height: size }}
          title={
            person.badges.length === 0
              ? `No badges yet — ${STAFF_BADGE_SLOTS} slots, one per facility, earned by serving whole seasons there`
              : `${empty} badge slot${empty === 1 ? "" : "s"} left — ${STAFF_BADGE_SLOTS} is the cap`
          }
        >
          {/* Drawn a touch smaller than a crest of the same box: pure outline
              with no interior detail reads larger at equal dimensions. */}
          <EmptyBadgeMark size={Math.round(size * 0.82)} />
        </span>
      ))}
    </span>
  );
}

// ── Facilities tab ────────────────────────────────────────────────────────

function FacilitiesTab() {
  useGame((s) => s.rev);
  return (
    <div className="mt-4">
      {FACILITY_SPECS.map((spec) => (
        <FacilityPanel key={spec.id} id={spec.id} />
      ))}
    </div>
  );
}

function FacilityPanel({ id }: { id: FacilityId }) {
  const game = useGame((s) => s.game)!;
  const unlock = useGame((s) => s.unlockFacility);
  const upgrade = useGame((s) => s.upgradeFacility);
  const team = game.teams[game.userTeamId];
  const spec = FACILITY_MAP[id];
  const built = isUnlocked(team, id);
  const level = facilityLevel(team, id);
  const maxLevel = facilityMaxLevel(spec);
  const eff = facilityEffect(team, id);
  const cost = upgradeCost(team, id);

  // Not built: the same banner, but as a site plan rather than a home. The
  // photograph is the pitch — it shows what the money buys before it is spent —
  // so it runs at reduced height and the masthead carries the price instead of
  // an effect the club doesn't have yet.
  if (!built) {
    const short = spec.unlockCost - team.budget;
    return (
      <Section title={spec.name}>
        <Card className="overflow-hidden border-dashed p-0">
          <FacilityBanner facility={id} height={150}>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pb-4 pt-10">
              <div>
                <div className="display text-[10px] uppercase tracking-[0.2em] text-dim">
                  Not built
                </div>
                <h3 className="display mt-1 text-3xl font-bold uppercase leading-none tracking-wide text-ink">
                  {spec.name}
                </h3>
              </div>
              <span className="display pb-1 text-[10px] uppercase tracking-[0.2em] text-gold">
                {formatMoney(spec.unlockCost)} to build
              </span>
              {/* Sits on the same baseline as the name, not floating over the
                  open pitch to its right. */}
            </div>
          </FacilityBanner>

          <div className="p-5">
            <p className="max-w-2xl text-sm leading-relaxed text-faint">{spec.blurb}</p>
            {/* Every channel the building would produce, at its unbuilt base —
                the pitch has to name all of them, or a three-channel facility
                reads as costing the same as a one-channel one for less. */}
            <div className="mt-4 flex flex-wrap items-center gap-6">
              {spec.channels.map((ch) => (
                <Stat
                  key={ch.id}
                  label={ch.label}
                  value={formatChannel(ch.unit, ch.base)}
                />
              ))}
              <Stat label="Staff slots" value={`${spec.slotsByLevel[0]}`} />
              <Stat label="Cost to build" value={formatMoney(spec.unlockCost)} />
            </div>
            {spec.unlockAtLevel && (
              <p className="mt-3 text-xs leading-relaxed text-gold">
                At level {spec.unlockAtLevel.level}: {spec.unlockAtLevel.label} — {spec.unlockAtLevel.blurb}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <GoldButton
                onClick={() => unlock(id)}
                disabled={team.budget < spec.unlockCost}
                title={
                  short > 0
                    ? `Not enough budget — ${formatMoney(short)} short`
                    : `Build for ${formatMoney(spec.unlockCost)}`
                }
              >
                Build — {formatMoney(spec.unlockCost)}
              </GoldButton>
              {short > 0 && (
                <span className="text-xs text-loss">
                  {formatMoney(short)} short — budget is {formatMoney(team.budget)}.
                </span>
              )}
            </div>
          </div>
        </Card>
      </Section>
    );
  }

  return (
    <Section
      title={spec.name}
      right={<span className="text-xs text-faint">Level {level} of {maxLevel}</span>}
    >
      <Card className="overflow-hidden border-gold p-0">
        {/* The masthead: the building itself, with the one number it produces
            sitting on it. Everything below this line is the arithmetic behind
            that number — the screen's rule made into its layout. */}
        <FacilityBanner facility={id} height={150}>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pb-4 pt-10">
            <div>
              <h3 className="display text-sm font-semibold uppercase tracking-[0.16em] text-ink/90">
                {spec.name}
              </h3>
              {/* The headline channel at full size, and any others beside it —
                  a facility that governs three things must not present as if it
                  governs one. */}
              <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                {eff.channels.map((ch, i) => (
                  <span key={ch.id} className="flex items-baseline gap-2">
                    <span
                      className={`display gold-text font-bold leading-none ${i === 0 ? "text-5xl" : "text-3xl"}`}
                    >
                      {formatChannel(ch.unit, ch.total)}
                    </span>
                    <span className="display text-[10px] uppercase tracking-[0.2em] text-gold">
                      {ch.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <LevelPips level={level} max={maxLevel} />
          </div>
        </FacilityBanner>

        <div className="p-5">
          {/* The sum that produced the headline, on its own plinth directly
              under it. Never a total without its arithmetic. */}
          {/* One sum per channel. A multi-channel facility gets a labelled row
              each, because the three terms differ per channel — the Scouting
              Network's headcount has no badge term at all, and hiding that
              behind a single row would misprice a legacy badge. */}
          <div className="flex flex-col gap-2">
            {eff.channels.map((ch) => {
              const source = FACILITY_MAP[id].channels.find((c) => c.id === ch.id)!;
              return (
                <div key={ch.id} className="flex flex-wrap items-center gap-2 text-sm">
                  {eff.channels.length > 1 && (
                    <span className="display w-full text-[9px] uppercase tracking-widest text-faint sm:w-36 sm:shrink-0">
                      {ch.label}
                    </span>
                  )}
                  <Term label="Base" value={formatChannel(ch.unit, ch.base)} muted={ch.base === 0} />
                  <span className="text-faint">+</span>
                  <Term
                    label={`Stars (${eff.totalStars})`}
                    value={formatChannel(ch.unit, ch.stars)}
                    muted={ch.stars === 0}
                    title={
                      source.starEffect === 0
                        ? `Stars don't move ${ch.label}`
                        : `${eff.starSteps} complete step${eff.starSteps === 1 ? "" : "s"} of ${STAFF_STARS_PER_STEP} stars, each worth ${formatChannel(ch.unit, source.starEffect)}`
                    }
                  />
                  <span className="text-faint">+</span>
                  <Term
                    label="Badges"
                    value={formatChannel(ch.unit, ch.badges)}
                    muted={ch.badges === 0}
                    title={
                      source.badgeEffect === 0
                        ? `Badges don't move ${ch.label} — this one is staffing alone`
                        : `${eff.totalBadgeWeight} badge tier${eff.totalBadgeWeight === 1 ? "" : "s"} held here = ${ch.badgeSteps} step${ch.badgeSteps === 1 ? "" : "s"} of ${ch.badgeTiersPerStep}, each worth ${formatChannel(ch.unit, source.badgeEffect)}`
                    }
                  />
                </div>
              );
            })}
          </div>

          {/* The star bar: the step the assigned stars are part-way through, drawn
              as the breakpoint it actually is. The arithmetic above says "+4%";
              this says "two stars short of +6%", which is the thing that makes a
              manager go shopping. */}
          <StarStepBar eff={eff} spec={spec} />

          {/* What to do next, stated concretely rather than as a rule to infer.
              A multi-channel facility names what the next step buys across all
              of them — "another +2%" is the wrong sentence for a building whose
              step also buys three squad places. */}
          <p className="mt-3 text-xs leading-relaxed text-faint">
            {eff.slotsUsed < eff.slots ? (
              <>
                <span className="text-gold">{eff.slots - eff.slotsUsed} slot{eff.slots - eff.slotsUsed === 1 ? "" : "s"} free.</span>{" "}
              </>
            ) : null}
            {eff.totalStars > 0 || eff.slotsUsed > 0 ? (
              <>
                {eff.starsToNextStep} more star{eff.starsToNextStep === 1 ? "" : "s"} assigned here would add{" "}
                {describeStarStep(spec)}.
              </>
            ) : (
              <>
                Click a slot to assign someone — every {STAFF_STARS_PER_STEP} stars working here adds{" "}
                {describeStarStep(spec)}, and the badges they earn add {describeBadgeStep(spec)}.
              </>
            )}
          </p>
          {spec.unlockAtLevel && (
            <p className="mt-2 text-xs leading-relaxed">
              {level >= spec.unlockAtLevel.level ? (
                <span className="text-win">
                  {spec.unlockAtLevel.label} unlocked — {spec.unlockAtLevel.blurb}
                </span>
              ) : (
                <span className="text-faint">
                  <span className="text-gold">At level {spec.unlockAtLevel.level}:</span>{" "}
                  {spec.unlockAtLevel.label} — {spec.unlockAtLevel.blurb}
                </span>
              )}
            </p>
          )}

          {/* Slots, drawn as slots — filled, empty and still-locked all three, so
              the capacity an upgrade buys is a thing you can see rather than a
              number to read. Fixed at three columns so a level-5 six-slot facility
              wraps to a second row instead of squeezing six cards into one. */}
          <SlotGrid id={id} />

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line/60 pt-4">
            {cost !== null ? (
              <>
                <GoldButton
                  onClick={() => upgrade(id)}
                  disabled={team.budget < cost}
                  title={
                    team.budget < cost
                      ? `Not enough budget — ${formatMoney(cost - team.budget)} short`
                      : `Upgrade to level ${level + 1}`
                  }
                >
                  Upgrade to level {level + 1} — {formatMoney(cost)}
                </GoldButton>
                {team.budget < cost ? (
                  // A disabled gold button still LOOKS like the thing to click, so
                  // say the shortfall in words beside it rather than relying on
                  // opacity alone to carry the message.
                  <span className="text-xs text-loss">
                    {formatMoney(cost - team.budget)} short — budget is {formatMoney(team.budget)}.
                  </span>
                ) : (
                  <span className="text-xs text-faint">
                    Buys one more staff slot ({slotCount(team, id)} → {spec.slotsByLevel[level]}). The base
                    effect doesn&apos;t change — staff are what raise it.
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-faint">
                Fully upgraded — {eff.slots} staff slots. Everything from here comes from who works in them.
              </span>
            )}
          </div>
        </div>
      </Card>
    </Section>
  );
}

/**
 * The level as a row of pips rather than "Level 3 of 5".
 *
 * On the banner there is no room for a sentence and no appetite for one — the
 * pips say "three of five bought, two to go" in the same glance that reads the
 * headline number, and the section header above still spells it out in words
 * for anyone who wants the sentence.
 */
function LevelPips({ level, max }: { level: number; max: number }) {
  return (
    <span
      className="flex items-center gap-1.5"
      title={`Level ${level} of ${max}`}
      aria-label={`Level ${level} of ${max}`}
    >
      <span className="display mr-0.5 text-[10px] uppercase tracking-[0.2em] text-dim">Level</span>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-5 rounded-full ${i < level ? "gold-grad" : "bg-ink/20"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

/**
 * The star bonus as a breakpoint, not a formula.
 *
 * One row of `STAFF_STARS_PER_STEP` segments showing where the CURRENT step
 * stands — `totalStars % STAFF_STARS_PER_STEP` filled. Steps already banked are
 * stated as the multiplier beside it, because drawing every past segment would
 * turn a six-cell bar into a thirty-cell one at level 5 and lose the one number
 * that matters: how far to the next +starEffect%.
 */
function StarStepBar({ eff, spec }: { eff: FacilityEffect; spec: FacilitySpec }) {
  const into = eff.totalStars % STAFF_STARS_PER_STEP;
  return (
    <div className="mt-4 border-t border-line/60 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: STAFF_STARS_PER_STEP }, (_, i) => (
            <span
              key={i}
              className={`h-2.5 w-7 rounded-sm border transition-colors ${
                i < into ? "gold-grad border-transparent" : "border-line bg-raised"
              }`}
            />
          ))}
        </span>
        <span className="tnum text-[11px] text-faint">
          <span className={into > 0 ? "text-gold" : undefined}>
            {into}/{STAFF_STARS_PER_STEP}
          </span>{" "}
          toward the next{" "}
          <span className="text-gold">{describeStarStep(spec)}</span>
          {eff.starSteps > 0 ? (
            <>
              {" "}· {eff.starSteps} step{eff.starSteps === 1 ? "" : "s"} banked
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/**
 * Every slot the facility will ever have, in three columns: the ones in use,
 * the ones free, and the ones a future level unlocks.
 *
 * Showing the locked ones is the point — an upgrade stops being a line of copy
 * about "+1 slot" and becomes a padlock the manager can see themselves opening.
 */
/** The crest size in a facility slot, and the height every slot state shares.
 * One pair of constants so a filled card, an empty slot and a padlock are always
 * the same block — a grid that reflows as staff arrive reads as a bug. */
const SLOT_BADGE_SIZE = 104;
/** The empty octagon reads larger than a crest of the same box because it is
 * pure outline with no interior detail, so it is drawn a touch smaller to sit at
 * the same visual weight. */
const SLOT_EMPTY_BADGE_SIZE = 84;
const SLOT_MIN_H = "min-h-[248px]";

function SlotGrid({ id }: { id: FacilityId }) {
  const game = useGame((s) => s.game)!;
  const team = game.teams[game.userTeamId];
  const spec = FACILITY_MAP[id];
  const staff = assignedTo(team, id);
  const open = slotCount(team, id);
  // Round the row out to a multiple of three so the grid never ends ragged —
  // at level 1 that means 2 open + 1 locked, exactly the shape asked for.
  const maxSlots = spec.slotsByLevel[spec.slotsByLevel.length - 1];
  const shown = Math.min(maxSlots, Math.ceil(open / 3) * 3);

  return (
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: shown }, (_, i) => {
        const person = staff[i];
        if (person) return <AssignedCard key={person.id} person={person} facility={id} />;
        if (i < open) return <EmptySlot key={`empty${i}`} facility={id} />;
        // The level at which this slot opens: the first level whose slot count
        // reaches it. Table lookup, so a re-tuned ladder needs nothing here.
        const at = spec.slotsByLevel.findIndex((n) => n > i) + 1;
        return <LockedSlot key={`locked${i}`} level={at} />;
      })}
    </div>
  );
}

/** An empty slot is a button, not a label. Clicking it opens the picker right
 * here — the manager never has to leave the facility to fill its own slot. */
function EmptySlot({ facility }: { facility: FacilityId }) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <button
        onClick={() => setPicking(true)}
        className={`group flex flex-col items-center justify-center rounded-md border border-dashed border-line px-3 py-4 text-xs text-faint transition-colors hover:border-gold-lo/60 hover:bg-gold-lo/[0.06] hover:text-gold ${SLOT_MIN_H}`}
        title="Assign a staff member to this slot"
      >
        {/* The same octagon the filled card shows, at the same size — an empty
            slot is the shape of the badge nobody is earning in it yet. */}
        <span className="text-line transition-colors group-hover:text-gold-lo">
          <EmptyBadgeMark size={SLOT_EMPTY_BADGE_SIZE} />
        </span>
        <span className="mt-2.5">Empty slot</span>
        <span className="mt-0.5 text-[10px] text-dim transition-colors group-hover:text-gold-lo">
          Click to assign
        </span>
      </button>
      {picking && <AssignPicker facility={facility} onClose={() => setPicking(false)} />}
    </>
  );
}

function LockedSlot({ level }: { level: number }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-md border border-line/50 bg-raised/40 px-3 py-4 text-xs text-dim ${SLOT_MIN_H}`}
      title={`Unlocks at level ${level}`}
    >
      <span className="text-2xl leading-none opacity-40" aria-hidden>
        🔒
      </span>
      <span className="mt-2.5">Locked</span>
      <span className="mt-0.5 text-[10px]">Level {level}</span>
    </div>
  );
}

/**
 * The inline assignment picker.
 *
 * Lists everyone on the books who could take this slot, with the two things the
 * decision turns on — stars, and whether they already hold a record HERE (a
 * returning veteran resumes their badge; a newcomer starts at zero). Staff who
 * can't take it are still listed, greyed, with the reason: an option that
 * silently vanishes reads as a bug, and "why can't I use him?" is the question
 * the badge cap exists to provoke.
 */
function AssignPicker({ facility, onClose }: { facility: FacilityId; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const assign = useGame((s) => s.assignStaff);
  const team = game.teams[game.userTeamId];
  const spec = FACILITY_MAP[facility];

  // Anyone not already working here. Someone posted elsewhere can be poached
  // across — that is a real move, so it is offered rather than hidden.
  const candidates = rosterOf(team)
    .filter((p) => p.assignedTo !== facility)
    .map((p) => {
      const here = p.badges.find((b) => b.facility === facility);
      const capped = !here && p.badges.length >= STAFF_BADGE_SLOTS;
      return { person: p, here, capped };
    })
    .sort((a, b) => {
      // Best fit first: those who already have a record here, then by stars.
      const rec = badgeWeightAt(b.person, facility) - badgeWeightAt(a.person, facility);
      if (rec !== 0) return rec;
      if (a.capped !== b.capped) return a.capped ? 1 : -1;
      return b.person.stars - a.person.stars;
    });

  return (
    <Modal title={`Assign to ${spec.name}`} onClose={onClose}>
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">
          Nobody available. Everyone on the books already works here — hire from the Backroom tab&apos;s
          market to fill this slot.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map(({ person, here, capped }) => (
            <button
              key={person.id}
              disabled={capped}
              onClick={() => {
                assign(person.id, facility);
                onClose();
              }}
              title={
                capped
                  ? `${person.name} already holds ${STAFF_BADGE_SLOTS} facility badges and can't earn another`
                  : `Assign ${person.name} to the ${spec.name}`
              }
              className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                capped
                  ? "cursor-not-allowed border-line bg-raised/40 opacity-50"
                  : "border-line bg-raised hover:border-gold-lo/60 hover:bg-gold-lo/[0.06]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Flag nat={person.nationality} size={11} />
                  <span className="truncate text-sm font-medium">{person.name}</span>
                  <span className="text-[11px] text-faint">age {person.age}</span>
                </span>
                <Stars n={person.stars} />
              </div>
              <div className="mt-1.5 flex items-end justify-between gap-3">
                <span className="text-[11px] text-faint">{formatMoney(person.wage)}/wk</span>
                <BadgeRow person={person} size={46} />
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                {capped ? (
                  <span className="text-loss">
                    Badge slots full — assigning them here would earn nothing.
                  </span>
                ) : here ? (
                  <>
                    <BadgeIcon
                      facility={facility}
                      tier={here.tier}
                      size={26}
                      title={badgeTitle(facility, here.tier, here.seasons)}
                    />
                    <span className="text-win">
                      Served here before — resumes a {here.tier} badge at {here.seasons} season
                      {here.seasons === 1 ? "" : "s"}.
                    </span>
                  </>
                ) : person.assignedTo ? (
                  <span className="text-faint">
                    Currently at {FACILITY_MAP[person.assignedTo]?.name ?? person.assignedTo} — moving
                    them starts a new badge here.
                  </span>
                ) : (
                  <span className="text-faint">Unassigned — starts a new badge here.</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * Someone in post, and the badge they are building HERE — the crest at the size
 * it deserves.
 *
 * Reworked in v1.80: the crest used to be a 56px thumbnail beside the name, in a
 * row where it competed with a flag, a star rating and two lines of small text
 * for the same eye. It lost, every time — which is a strange outcome for the one
 * thing on the card the manager is actually accruing.
 *
 * So the card is now stacked rather than side-by-side, and the badge is the top
 * of it: centred, at `SLOT_BADGE_SIZE`, with the tier named directly underneath
 * in its own colour. Everything else — who this is, what they cost, when the
 * next tier lands — reads below as the caption to it. The empty state occupies
 * exactly the same block, so a facility filling up doesn't reflow: the outline
 * simply becomes a crest.
 */
function AssignedCard({ person, facility }: { person: StaffPerson; facility: FacilityId }) {
  const assign = useGame((s) => s.assignStaff);
  const badge = person.badges.find((b) => b.facility === facility);
  const next = badge ? seasonsToNextBadge(badge.seasons) : BADGE_LADDER[0].seasons;
  const spec = FACILITY_MAP[facility];

  return (
    <Card className={`flex flex-col border-gold-lo/40 p-3 ${SLOT_MIN_H}`}>
      {/* The crest, given the whole width and its own band. The faint radial
          behind it is what stops a transparent PNG from floating — it reads as
          a plinth the badge sits on rather than an image dropped on a card. */}
      <div
        className="flex flex-col items-center rounded-md border border-line/50 bg-raised/40 px-3 py-3.5"
        style={{
          backgroundImage: badge
            ? `radial-gradient(circle at 50% 42%, ${BADGE_COLOR[badge.tier]}1f 0%, transparent 68%)`
            : undefined,
        }}
      >
        {badge ? (
          <BadgeIcon
            facility={facility}
            tier={badge.tier}
            size={SLOT_BADGE_SIZE}
            title={badgeTitle(facility, badge.tier, badge.seasons)}
          />
        ) : (
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: SLOT_BADGE_SIZE, height: SLOT_BADGE_SIZE }}
            title="No badge here yet — a full season in post earns the first one"
            aria-label="No badge here yet"
          >
            <EmptyBadgeMark size={SLOT_EMPTY_BADGE_SIZE} />
          </span>
        )}

        {/* The tier, named under its own crest. Colour alone never carries it. */}
        {badge ? (
          <div
            className="display mt-2 text-center text-[11px] uppercase tracking-[0.22em]"
            style={{ color: BADGE_COLOR[badge.tier] }}
          >
            {badge.tier}
          </div>
        ) : (
          <div className="display mt-2 text-center text-[11px] uppercase tracking-[0.22em] text-dim">
            No badge yet
          </div>
        )}
        <div className="tnum mt-0.5 text-center text-[10px] text-faint">
          {badge ? (
            <>
              {badge.seasons} season{badge.seasons === 1 ? "" : "s"} served ·{" "}
              <span className="text-gold">{describeBadgeWorth(spec, badge.tier)}</span>
            </>
          ) : (
            <>Contributing stars only</>
          )}
        </div>
      </div>

      {/* Who is earning it. */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Flag nat={person.nationality} size={11} />
          <span className="truncate text-sm font-medium">{person.name}</span>
        </span>
        <Stars n={person.stars} />
      </div>

      <div className="mt-1 text-[11px] leading-snug text-dim">
        {next === null ? (
          <span className="text-gold">Legacy — the top of the ladder.</span>
        ) : (
          <>
            {next} more season{next === 1 ? "" : "s"} here for the next badge
            {spec ? <span className="text-faint"> ({describeBadgeStep(spec)})</span> : null}.
          </>
        )}
      </div>
      <div className="mb-2.5 mt-1 text-[11px] text-faint">{formatMoney(person.wage)}/wk</div>

      <GhostButton
        onClick={() => assign(person.id, null)}
        className="mt-auto w-full !px-2 !py-1 text-xs"
        title={`Take ${person.name} off the ${spec?.name ?? "facility"} — they keep the badge they've earned, but stop adding to it`}
      >
        Stand down
      </GhostButton>
    </Card>
  );
}

// ── Backroom tab ──────────────────────────────────────────────────────────

function StaffTab() {
  useGame((s) => s.rev);
  const game = useGame((s) => s.game)!;
  const team = game.teams[game.userTeamId];
  const roster = rosterOf(team);
  const wageBill = roster.reduce((s, m) => s + m.wage, 0);

  return (
    <div className="mt-4">
      <Section
        title="Employed"
        right={
          <span className="text-xs text-faint">
            {roster.length} on the books · {formatMoney(wageBill)}/wk
          </span>
        }
      >
        {roster.length === 0 ? (
          <Card className="border-dashed px-6 py-10 text-center">
            <p className="text-sm text-faint">
              Nobody employed. Hire from the market below, then assign them to a facility — an
              unassigned staff member draws their wage and does nothing.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {roster.map((person) => (
              <RosterCard key={person.id} person={person} />
            ))}
          </div>
        )}
      </Section>

      <StaffMarket />
    </div>
  );
}

function RosterCard({ person }: { person: StaffPerson }) {
  const game = useGame((s) => s.game)!;
  const assign = useGame((s) => s.assignStaff);
  const release = useGame((s) => s.releaseStaff);
  const team = game.teams[game.userTeamId];
  const where = person.assignedTo ? FACILITY_MAP[person.assignedTo] : undefined;

  // Only offer facilities that are built and have room (or that they already
  // work at). A disabled option the manager has to reason about is worse than
  // an option that isn't there.
  const options = FACILITY_SPECS.filter((spec) => {
    if (!isUnlocked(team, spec.id)) return false;
    if (person.assignedTo === spec.id) return false;
    return assignedTo(team, spec.id).length < slotCount(team, spec.id);
  });

  return (
    <Card className={`p-3 ${person.assignedTo ? "" : "border-dashed"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Flag nat={person.nationality} size={12} />
          <span className="truncate font-medium">{person.name}</span>
          <span className="text-xs text-faint">age {person.age}</span>
        </span>
        <Stars n={person.stars} />
      </div>

      {/* Wage left, badges right — the badges sit under the star rating and on
          the opposite edge to the wage, so the card has one column of what this
          person COSTS and one of what they have EARNED. */}
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-xs text-faint">{formatMoney(person.wage)}/wk</span>
        <BadgeRow person={person} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2.5">
        <span className="text-xs">
          {where ? (
            <>
              <span className="text-faint">Working at</span>{" "}
              <span className="text-gold">{where.name}</span>
            </>
          ) : (
            <span className="text-loss">Unassigned — earning nothing</span>
          )}
        </span>
        <span className="flex-1" />
        {options.map((spec) => (
          <GhostButton
            key={spec.id}
            onClick={() => assign(person.id, spec.id)}
            className="!px-2 !py-1 text-xs"
            title={
              person.badges.length >= STAFF_BADGE_SLOTS && !person.badges.some((b) => b.facility === spec.id)
                ? `${person.name} already holds ${STAFF_BADGE_SLOTS} badges and can't earn another`
                : `Assign to the ${spec.name}`
            }
          >
            → {spec.name}
          </GhostButton>
        ))}
        <ConfirmButton
          label="Release"
          confirmLabel={`Release ${person.name}?`}
          tone="danger"
          onConfirm={() => release(person.id)}
          className="!px-2 !py-1 text-xs"
        />
      </div>
    </Card>
  );
}

function StaffMarket() {
  const game = useGame((s) => s.game)!;
  const hire = useGame((s) => s.hire);
  const team = game.teams[game.userTeamId];
  const market = game.staffMarket ?? [];
  // The shortlist cycles on the loop's own clock (TUNING.marketRefreshDays,
  // every 10 days), so quote the actual countdown rather than "periodically" —
  // a manager weighing a marginal hire needs to know whether waiting is cheap.
  const daysToRefresh =
    game.marketRefreshDay !== undefined
      ? Math.max(0, game.marketRefreshDay - game.currentDay)
      : null;

  return (
    <Section
      title="Available to hire"
      right={
        <span className="text-xs text-faint">
          {daysToRefresh === null
            ? `A fresh shortlist every ${TUNING.marketRefreshDays} days`
            : daysToRefresh === 0
              ? "A fresh shortlist arrives today"
              : `New shortlist in ${daysToRefresh} day${daysToRefresh === 1 ? "" : "s"}`}
        </span>
      }
    >
      {market.length === 0 ? (
        <Card className="border-dashed px-6 py-8 text-center text-sm text-faint">
          No candidates on the market right now — a fresh crop arrives shortly.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {market.map((c) => {
            const weight = totalBadgeWeight(c);
            return (
              <Card key={c.id} className="flex flex-col p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Flag nat={c.nationality} size={11} />
                    <span className="truncate text-sm font-medium">{c.name}</span>
                  </span>
                  <Stars n={c.stars} />
                </div>
                {/* Age left, badges right and under the star rating — the same
                    two-column reading as the roster card. */}
                <div className="mt-1 flex items-end justify-between gap-3">
                  <span className="text-[11px] text-faint">age {c.age}</span>
                  <BadgeRow person={c} size={52} />
                </div>
                {weight > 0 && (
                  <div className="mt-1.5 text-[11px] text-win">
                    Arrives with a record — productive from day one at{" "}
                    {joinList(
                      c.badges
                        .map((b) => FACILITY_MAP[b.facility]?.name)
                        .filter((n): n is string => !!n)
                    )}
                    .
                  </div>
                )}
                <div className="mt-2 text-[11px] text-faint">
                  Fee {formatMoney(c.fee)} · {formatMoney(c.wage)}/wk
                </div>
                <div className="mt-auto pt-2.5">
                  <ConfirmButton
                    label="Hire"
                    confirmLabel="Confirm?"
                    onConfirm={() => hire(c.id)}
                    className="w-full !px-2 !py-1 text-xs"
                    disabled={team.budget < c.fee}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ── small shared bits ─────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** What one completed star step buys, across every channel it moves — e.g.
 * "+2% player growth", or "3 academy squad size, 1 focus slots and +3% prospect
 * value". Channels the step doesn't move are left out rather than printed as
 * zero: a list of noughts reads as a broken building. */
function describeStarStep(spec: FacilitySpec): string {
  return joinList(
    spec.channels
      .filter((ch) => ch.starEffect > 0)
      .map((ch) => `${formatChannel(ch.unit, ch.starEffect)} ${ch.label}`)
  );
}

/** The same for one badge step, naming what a step COSTS when it is more than a
 * single tier — otherwise the number looks like a per-badge rate it isn't. */
function describeBadgeStep(spec: FacilitySpec): string {
  const parts = spec.channels
    .filter((ch) => ch.badgeEffect > 0)
    .map((ch) => {
      const per = ch.badgeTiersPerStep === 1 ? "per tier" : `per ${ch.badgeTiersPerStep} tiers`;
      return `${formatChannel(ch.unit, ch.badgeEffect)} ${ch.label} ${per}`;
    });
  return parts.length ? joinList(parts) : "nothing — this one runs on stars alone";
}

/** What a badge at this tier is actually worth right now, across every channel
 * it moves. Quoted on the assigned card under the crest, where the manager is
 * looking at one person's contribution rather than the building's total. */
function describeBadgeWorth(spec: FacilitySpec | undefined, tier: BadgeTier): string {
  if (!spec) return "";
  const weight = badgeWeight(tier);
  const parts = spec.channels
    .filter((ch) => ch.badgeEffect > 0)
    .map((ch) => {
      const steps = Math.floor(weight / ch.badgeTiersPerStep);
      return `${formatChannel(ch.unit, steps * ch.badgeEffect)} ${ch.label}`;
    });
  return parts.length ? joinList(parts) : "stars only";
}

/** "a", "a and b", "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-faint">{label}</span>
      <span className="display tnum text-base font-semibold text-ink">{value}</span>
    </span>
  );
}

/** One term of the effect sum. Muted when it contributes nothing, so the parts
 * that are actually doing work stand out. */
function Term({
  label,
  value,
  muted,
  title,
}: {
  label: string;
  value: string;
  muted?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`rounded-md border px-2.5 py-1.5 text-center ${muted ? "border-line text-faint" : "border-gold-lo/40 bg-gold-lo/[0.06] text-ink"}`}
      title={title}
    >
      <span className="block text-[9px] uppercase tracking-widest text-faint">{label}</span>
      <span className="display tnum text-sm font-semibold">{value}</span>
    </span>
  );
}

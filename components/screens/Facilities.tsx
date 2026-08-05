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
 *
 * `dim` (v1.83) is for the inline rows — a candidate card's three slots, of
 * which two or three are usually empty. At full strength a row of dashes reads
 * as missing data or a failed load rather than as a placeholder, so there the
 * outline drops to a fraction of its opacity and gains a barely-there fill:
 * enough to say "a shape belongs here", not enough to be read as content. The
 * big standalone marks (an empty facility slot, where the octagon IS the
 * subject) keep the full-strength dash.
 */
function EmptyBadgeMark({ size, dim = false }: { size: number; dim?: boolean }) {
  const points = "30,7 70,7 93,30 93,70 70,93 30,93 7,70 7,30";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {dim && <polygon points={points} className="fill-line/20" />}
      <polygon
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={dim ? 4 : 5}
        className={dim ? "text-line/45" : "text-line"}
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
  center = false,
}: {
  person: StaffPerson | StaffCandidate;
  size?: number;
  /** Centre the crests instead of letting them sit against the start edge —
   * what the square person plates want, where the tray is the middle of the
   * card rather than a right-aligned stat. */
  center?: boolean;
}) {
  const empty = Math.max(0, STAFF_BADGE_SLOTS - person.badges.length);
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${center ? "justify-center" : ""}`}>
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
              with no interior detail reads larger at equal dimensions. Dimmed,
              because in a row these are placeholders — see EmptyBadgeMark. */}
          <EmptyBadgeMark size={Math.round(size * 0.82)} dim />
        </span>
      ))}
    </span>
  );
}

// ── Facilities tab ────────────────────────────────────────────────────────

/**
 * Four facilities per row (v1.93; was two in v1.83).
 *
 * The v1.83 note argued for two columns because four buildings stacked
 * full-width made the page a scroll — the fourth was three screens below the
 * first, so "which should I put my next coach in?", the actual question this
 * tab answers, could never be asked by looking. That argument is unchanged and
 * is exactly why the count had to rise with the table: at TEN facilities, two
 * columns is five rows and the same scroll is back.
 *
 * Four across at 2xl, three at xl, two at lg, one on a phone. The ladder
 * matters more than the top number — a facility card carries several channels
 * of arithmetic and a star bar, so it has a floor width below which the
 * arithmetic wraps into noise, and the breakpoints are where each count still
 * clears it.
 */
function FacilitiesTab() {
  useGame((s) => s.rev);
  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-x-5 gap-y-0 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {FACILITY_SPECS.map((spec) => (
        <FacilityPanel key={spec.id} id={spec.id} />
      ))}
    </div>
  );
}

/**
 * The height every facility card starts at, built or not (v1.85).
 *
 * Four buildings side by side in a two-column grid used to be four different
 * heights: an unbuilt card is a pitch and a price, a built one is two or three
 * channels of arithmetic plus a star bar plus a slot summary. The result was a
 * ragged grid where the amount of card told you nothing except how much text
 * that particular row happened to carry — and worse, a facility LOOKED cheaper
 * or smaller than its neighbour purely because it hadn't been built.
 *
 * So both states share this floor and both push their action bar to the bottom.
 * The number is MEASURED rather than judged by eye. With the floor removed, the
 * heights at 1440px wide are:
 *
 *   locked, all four            326–370px
 *   built + grid collapsed      326px (Youth Academy) … 556px (Scouting Network)
 *
 * The Scouting Network is the tall one and sets the floor: two channel rows,
 * each with its own label and four terms, plus the capability line the other
 * three don't have. 560 clears it with a little slack for a longer channel label
 * wrapping.
 *
 * Nothing that OPENS is constrained by it: a card with its slot grid expanded
 * grows past the floor freely. It just never starts below it.
 *
 * v1.93: the grid went to four columns and the table to ten facilities, and
 * this number deliberately did NOT change. It is a FLOOR, not a fixed height —
 * a narrower card whose channel rows wrap simply grows past it, and the two
 * facilities with four channels (the Club Expense Center) do exactly that. What
 * the floor is for is the opposite case: stopping a cheap-looking unbuilt card
 * sitting next to a built one, which is a per-ROW property and is unaffected by
 * how many cards a row holds. Re-measure it only if the ragged-grid problem
 * comes back, not merely because the column count moved.
 */
const CARD_MIN_H = "min-h-[560px]";

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
        <Card className={`flex flex-col overflow-hidden border-dashed p-0 ${CARD_MIN_H}`}>
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

          <div className="flex flex-1 flex-col p-5">
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
            {/* The build button sits on the card's floor, not directly under
                whatever the blurb happened to end at — so a short pitch and a
                long one still put their one action in the same place. Spacer
                rather than `mt-auto`, for the reason given on the built card. */}
            <div className="mt-5 flex-1" aria-hidden />
            <div className="flex flex-wrap items-center gap-3">
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
      <Card className={`flex flex-col overflow-hidden border-gold p-0 ${CARD_MIN_H}`}>
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

        <div className="flex flex-1 flex-col p-5">
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
                  {/* The level term only appears for a channel that HAS one —
                      one channel in the table does (v1.85), and printing a
                      permanent "+0" on every other facility would advertise a
                      lever that isn't there. */}
                  {source.levelEffect ? (
                    <>
                      <span className="text-faint">+</span>
                      <Term
                        label={`Level (${level})`}
                        value={formatChannel(ch.unit, ch.levels)}
                        muted={ch.levels === 0}
                        title={`${level - 1} level${level - 1 === 1 ? "" : "s"} above the first, each worth ${formatChannel(ch.unit, source.levelEffect)} ${ch.label}`}
                      />
                    </>
                  ) : null}
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

          {/* The flexible gap, as its own element rather than `mt-auto` on the
              bar below: a card grown past CARD_MIN_H (an open slot grid) has no
              slack left, and an auto margin would collapse to zero and butt the
              bar straight against the grid. A spacer with a minimum keeps the
              breathing room in both cases. */}
          <div className="mt-5 flex-1" aria-hidden />

          <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-4">
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
                    Buys one more staff slot ({slotCount(team, id)} → {spec.slotsByLevel[level]})
                    {describeLevelStep(spec) ? (
                      <>
                        {" "}and {describeLevelStep(spec)}
                      </>
                    ) : null}
                    . {describeLevelStep(spec)
                      ? "Everything else comes from who works in them."
                      : "The base effect doesn't change — staff are what raise it."}
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

  // Collapsed by default once the facility is STAFFED (v1.84). A slot card is
  // ~250px tall, so four buildings' worth of grids is most of the page's
  // height — and once a slot is filled its card is a status the manager only
  // wants to check occasionally, not the thing they came to the panel for. An
  // EMPTY facility opens itself: there the grid isn't a status, it's the call
  // to action, and hiding the button behind a disclosure would bury the one
  // move worth making. State is local and per-panel, so the manager can leave
  // the one they're working on open.
  const [open_, setOpen] = useState(staff.length === 0);
  const free = open - staff.length;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open_}
        className="group flex w-full items-center gap-2 rounded-md border border-line/60 bg-raised px-3 py-2 text-left transition-colors hover:border-gold-lo/50 hover:bg-hover"
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-[9px] leading-none text-dim transition-all group-hover:border-gold-lo group-hover:text-gold ${
            open_ ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ▶
        </span>
        <span className="display text-[11px] uppercase tracking-[0.16em] text-dim group-hover:text-ink">
          Staff slots
        </span>
        {/* The summary the collapsed state has to carry: with the grid shut,
            "two filled, one free" is the whole reason to open it. */}
        <span className="tnum ml-auto text-[11px] text-mute">
          <span className={staff.length > 0 ? "text-ink/85" : undefined}>
            {staff.length}/{open}
          </span>{" "}
          filled
          {free > 0 && <span className="text-gold"> · {free} free</span>}
        </span>
      </button>

      {open_ && (
        // Three columns is still the shape the round-out above assumes, but the
        // panel is only half the page from `xl` up (see FacilitiesTab), so the
        // grid steps back to two there and takes the third column again once
        // there is genuinely room for it.
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: shown }, (_, i) => {
            const person = staff[i];
            if (person) return <AssignedCard key={person.id} person={person} facility={id} />;
            if (i < open) return <EmptySlot key={`empty${i}`} facility={id} />;
            // The level at which this slot opens: the first level whose slot
            // count reaches it. Table lookup, so a re-tuned ladder needs
            // nothing here.
            const at = spec.slotsByLevel.findIndex((n) => n > i) + 1;
            return <LockedSlot key={`locked${i}`} level={at} />;
          })}
        </div>
      )}
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
                  <span className="truncate text-sm font-semibold text-ink">{person.name}</span>
                  <span className="text-[11px] text-mute">age {person.age}</span>
                </span>
                <Stars n={person.stars} />
              </div>
              <div className="mt-1.5 flex items-end justify-between gap-3">
                <span className="text-[11px] text-mute">
                  <span className="tnum font-medium text-ink/85">{formatMoney(person.wage)}</span>/wk
                </span>
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
        <div className="tnum mt-0.5 text-center text-[10px] text-mute">
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
          <span className="truncate text-sm font-semibold text-ink">{person.name}</span>
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
      <div className="mb-2.5 mt-1 text-[11px] text-mute">
        <span className="tnum font-medium text-ink/85">{formatMoney(person.wage)}</span>/wk
      </div>

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

/**
 * The shape both halves of the Backroom lay out on (v1.87): twice as many
 * plates across as v1.84 laid out, which is what halves the card.
 *
 * One constant, used by Employed and Available-to-hire alike, because the two
 * are the same object seen before and after a signature — if the grids ever
 * drifted apart, comparing a candidate against the man he'd replace would mean
 * comparing two differently-sized cards.
 *
 * The plate is a SQUARE, so its height is its width: doubling the column count
 * is what shrinks the card in both directions at once, and it does so without
 * touching a single type size, badge size or button inside it — the content is
 * unchanged and simply has less slack around it. Every breakpoint doubles
 * together so the step-down ladder keeps its shape on the way to a phone.
 */
const PERSON_GRID =
  "grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10";

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
          <div className={PERSON_GRID}>
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

/**
 * A person card in the Backroom, employed or on the market (v1.84).
 *
 * Both sides of this tab describe the same thing — a person, their rating, and
 * the three badge slots that are their career — so they are now literally the
 * same component with a different footer. That is what lets five fit across a
 * row where three used to: the card is a fixed SQUARE plate, so a row of them
 * is a row of equal tiles rather than a set of boxes each as tall as its own
 * longest sentence.
 *
 * Inside the square, the badge tray is the centre of gravity: all three slots,
 * always, centred both ways. Drawing the empties is the point — the cap is what
 * makes a badge a decision, and a career with one crest and two gaps has to
 * read as two-thirds unspent rather than as "has a badge". The identity sits
 * above it and the money below, both compact, so the crests own the middle.
 */
const PERSON_BADGE_SIZE = 42;

function PersonPlate({
  person,
  footer,
  dashed = false,
  note,
}: {
  person: StaffPerson | StaffCandidate;
  footer: React.ReactNode;
  dashed?: boolean;
  /** One line under the tray — where they work, or what they arrive with. */
  note?: React.ReactNode;
}) {
  return (
    <Card
      className={`flex aspect-square flex-col p-3 transition-colors hover:border-gold-lo/40 ${dashed ? "border-dashed" : ""}`}
    >
      {/* Who — name over age/stars, so the widest thing on the card gets the
          full width and truncation is a last resort rather than the norm at
          five-across. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <Flag nat={person.nationality} size={11} />
        <span className="truncate text-[13px] font-semibold leading-tight text-ink" title={person.name}>
          {person.name}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-mute">Age {person.age}</span>
        <span className="text-[11px] leading-none">
          <Stars n={person.stars} />
        </span>
      </div>

      {/* The tray: three slots, centred in whatever height the square leaves. */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-1.5">
        <BadgeRow person={person} size={PERSON_BADGE_SIZE} center />
      </div>

      {note && <div className="mb-1.5 truncate text-center text-[10px] leading-tight">{note}</div>}
      {footer}
    </Card>
  );
}

function RosterCard({ person }: { person: StaffPerson }) {
  const game = useGame((s) => s.game)!;
  const assign = useGame((s) => s.assignStaff);
  const release = useGame((s) => s.releaseStaff);
  const [moving, setMoving] = useState(false);
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
    <>
      <PersonPlate
        person={person}
        dashed={!person.assignedTo}
        note={
          where ? (
            <>
              <span className="text-faint">at</span> <span className="text-gold">{where.name}</span>
            </>
          ) : (
            <span className="text-loss">Unassigned — earning nothing</span>
          )
        }
        footer={
          <>
            <div className="mb-1.5 text-center text-[10px] text-mute">
              <span className="tnum font-medium text-ink/85">{formatMoney(person.wage)}</span>/wk
            </div>
            {/* One button per action rather than one per facility (v1.84): four
                "→ Elite Training Center" buttons is what made this card three
                lines tall and unshrinkable. The list of destinations moves into
                a picker, which is also where it already lives on the facilities
                tab — same decision, same control. */}
            <div className="flex gap-1.5">
              <GhostButton
                onClick={() => setMoving(true)}
                disabled={options.length === 0}
                className="flex-1 !px-1 !py-1 text-[11px]"
                title={
                  options.length === 0
                    ? "No built facility has a free slot"
                    : `Move ${person.name} to another facility`
                }
              >
                {person.assignedTo ? "Move" : "Assign"}
              </GhostButton>
              <ConfirmButton
                label="Release"
                confirmLabel="Sure?"
                tone="danger"
                onConfirm={() => release(person.id)}
                className="flex-1 !px-1 !py-1 text-[11px]"
              />
            </div>
          </>
        }
      />
      {moving && (
        <Modal title={`Assign ${person.name}`} onClose={() => setMoving(false)}>
          <div className="flex flex-col gap-2">
            {options.map((spec) => {
              const capped =
                person.badges.length >= STAFF_BADGE_SLOTS &&
                !person.badges.some((b) => b.facility === spec.id);
              const here = person.badges.find((b) => b.facility === spec.id);
              return (
                <button
                  key={spec.id}
                  disabled={capped}
                  onClick={() => {
                    assign(person.id, spec.id);
                    setMoving(false);
                  }}
                  title={
                    capped
                      ? `${person.name} already holds ${STAFF_BADGE_SLOTS} badges and can't earn another`
                      : `Assign to the ${spec.name}`
                  }
                  className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                    capped
                      ? "cursor-not-allowed border-line bg-raised/40 opacity-50"
                      : "border-line bg-raised hover:border-gold-lo/60 hover:bg-gold-lo/[0.06]"
                  }`}
                >
                  <span className="font-semibold text-ink">{spec.name}</span>
                  <span className="mt-0.5 block text-[11px]">
                    {capped ? (
                      <span className="text-loss">Badge slots full — would earn nothing here.</span>
                    ) : here ? (
                      <span className="text-win">
                        Served here before — resumes a {here.tier} badge at {here.seasons} season
                        {here.seasons === 1 ? "" : "s"}.
                      </span>
                    ) : (
                      <span className="text-faint">Starts a new badge here.</span>
                    )}
                  </span>
                </button>
              );
            })}
            {person.assignedTo && (
              <GhostButton
                onClick={() => {
                  assign(person.id, null);
                  setMoving(false);
                }}
                title={`Take ${person.name} off the ${where?.name ?? "facility"} — they keep the badge they've earned`}
              >
                Stand down — no facility
              </GhostButton>
            )}
          </div>
        </Modal>
      )}
    </>
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
        <div className={PERSON_GRID}>
          {market.map((c) => (
            <CandidateCard
              key={c.id}
              cand={c}
              affordable={team.budget >= c.fee}
              onHire={() => hire(c.id)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * One name on the shortlist — the same square plate the Employed section uses
 * (v1.84), with a fee-and-hire footer where the roster has move-and-release.
 *
 * The market shows all three slots too, which reverses v1.83's call. That
 * version hid the empties here on the grounds that a badge is a ~1-in-13
 * rarity, so twelve cards in thirteen would draw a band that says "nothing".
 * True, but the alternative turned out worse: with the tray optional, the two
 * halves of this tab stopped being the same object, and a candidate's card
 * couldn't be read against an employee's. Drawing all three makes the one
 * badged candidate on the page instantly findable — a filled slot in a row of
 * outlines is far louder than a lone crest among cards with no tray at all.
 */
function CandidateCard({
  cand,
  affordable,
  onHire,
}: {
  cand: StaffCandidate;
  affordable: boolean;
  onHire: () => void;
}) {
  const weight = totalBadgeWeight(cand);
  return (
    <PersonPlate
      person={cand}
      // Only the candidates who actually bring something say anything (v1.87).
      // "No record yet" was printed on ~12 cards in 13 — a caption that is
      // almost always the same word is not information, it is furniture, and on
      // the half-size plate it was furniture crowding the badge tray. The empty
      // slots in that tray already say "no record" far more directly.
      note={
        weight > 0 ? (
          <span
            className="text-win/85"
            title={`Arrives with a record — productive from day one at ${joinList(
              cand.badges.map((b) => FACILITY_MAP[b.facility]?.name).filter((n): n is string => !!n)
            )}.`}
          >
            Arrives with a record
          </span>
        ) : undefined
      }
      footer={
        <>
          <div className="mb-1.5 flex items-baseline justify-between gap-1 text-[10px] text-mute">
            <span>
              Fee <span className="tnum font-medium text-ink/85">{formatMoney(cand.fee)}</span>
            </span>
            <span>
              <span className="tnum font-medium text-ink/85">{formatMoney(cand.wage)}</span>/wk
            </span>
          </div>
          <ConfirmButton
            label="Hire"
            confirmLabel="Confirm?"
            onConfirm={onHire}
            tone="primary"
            className="w-full !px-2 !py-1 text-[11px]"
            disabled={!affordable}
          />
        </>
      }
    />
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

/** What one LEVEL buys on its own, across every channel that declares a
 * `levelEffect` — empty for every facility that doesn't (v1.85), which is what
 * lets the upgrade copy keep saying "staff are what raise it" where that is
 * still the whole truth. */
function describeLevelStep(spec: FacilitySpec): string {
  return joinList(
    spec.channels
      .filter((ch) => (ch.levelEffect ?? 0) > 0)
      .map((ch) => `${formatChannel(ch.unit, ch.levelEffect!)} ${ch.label}`)
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

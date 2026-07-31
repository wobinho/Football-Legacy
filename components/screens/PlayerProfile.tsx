"use client";

// Player Profile — a popup overlay (§15.8): Bio tab + Career tab, mirroring the
// hot/cold data split. Opened from anywhere via viewPlayer(id); it floats over
// the current screen rather than navigating away.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { POS_LABELS, posColors } from "@/lib/config/positions";
import { formatHeight, formatMoney, playerWage } from "@/lib/value";
import { TUNING } from "@/lib/config/tuning";
import { yearsLeft } from "@/lib/contracts";
import { seasonGrowth } from "@/lib/development";
import {
  OTHER_SHARE,
  PRIMARY_SHARE,
  SECONDARY_SHARE,
  optimalTrainingPlan,
  plansForPosition,
  resolveTrainingPlan,
  type TrainingPlanDef,
} from "@/lib/config/training";
import { ATTR_META, type AttrKey } from "@/lib/config/attributes";
import { MAX_KIT_NUMBER, MIN_KIT_NUMBER, squadNumbersFor } from "@/lib/kitnumbers";
import { ACCOLADE_META } from "@/lib/accolades";
import { TIER_COLOR, TIER_LABEL, migrateProspectTier } from "@/lib/scouts";
import type { Accolade, AccoladeType, GameState, PlayerBio } from "@/lib/types";
import { ARCHETYPE_CLASS_COLOR, deriveArchetype, describePrefs, profileOf, rankArchetypes } from "@/lib/config/archetype";
import { styleLabel } from "@/lib/config/formations";
import { ArchetypeIcon, AttrGrid, ClassPill, AttrSheet, Card, ConfirmButton, CountryFlag, Crest, displayFullName, Flag, FitnessBar, FormChip, GhostButton, GoldButton, GrowthBadge, Ovr, PosBadge, PotentialBadge, Section, Tabs, TraitChip, useEscapeKey } from "../ui";
import ContractModal from "./ContractModal";
import { LoanOfferModal, SellPlayerModal } from "./SquadMoveModals";
import { transferWindowState } from "@/lib/calendar";
import { signedThisSeason } from "@/lib/transfers";

export default function PlayerProfileModal() {
  const game = useGame((s) => s.game);
  useGame((s) => s.rev);
  const id = useGame((s) => s.selectedPlayerId);
  const close = useGame((s) => s.closePlayer);
  const setTrainingPlan = useGame((s) => s.setTrainingPlan);
  const autoAssignPlan = useGame((s) => s.autoAssignTrainingPlan);
  const toggleShortlist = useGame((s) => s.toggleShortlist);
  const toggleHallOfFame = useGame((s) => s.toggleHallOfFame);
  const releaseSenior = useGame((s) => s.releaseSenior);
  const recallLoanPlayer = useGame((s) => s.academyRecall);
  const [tab, setTab] = useState<"bio" | "career" | "manage">("bio");
  const [contractOpen, setContractOpen] = useState(false);
  // The two direct-move choosers (v1.52). Selling and loaning both resolve
  // through a club picker rather than a listing flag.
  const [sellOpen, setSellOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);
  // Escape dismisses the profile — the backdrop no longer does, so this and the
  // ✕ are the two ways out. Registered before the early return below so the hook
  // order stays stable.
  useEscapeKey(close);

  // A scouted prospect isn't in the world yet — the report carries the player
  // object, handed in via viewProspect and read here as a read-only preview.
  const preview = useGame((s) => s.previewPlayer);
  const p = game && id ? (game.players[id] ?? (preview?.id === id ? preview : null)) : null;
  const isPreview = !!p && !!game && !game.players[p.id];
  if (!game || !p) return null;

  const club = p.clubId ? game.teams[p.clubId] : null;
  const userTeam = game.teams[game.userTeamId];
  // The user can set a training plan for any player on their books (senior or
  // academy), not on loan / retired.
  const isUserOwned =
    !isPreview &&
    !p.retired &&
    !p.loan &&
    (userTeam.playerIds.includes(p.id) || (userTeam.academyPlayerIds ?? []).includes(p.id));
  // Only the user's own senior players (not on loan) can be re-signed here.
  const isUserSenior =
    !isPreview &&
    p.clubId === game.userTeamId && game.teams[game.userTeamId].playerIds.includes(p.id) && !p.loan && !p.retired;
  // A player signed this season can't be sold or listed until next season (v1.54).
  const signedLock = signedThisSeason(game, p);
  // A senior pro of the user's currently out on loan (v1.54): he stays on the
  // Squad page tagged "on loan" rather than in the Academy loan tab, so his
  // recall lives here on his own profile.
  const isUserLoanedSenior =
    !isPreview &&
    !!p.loan &&
    p.clubId === game.userTeamId &&
    game.teams[game.userTeamId].playerIds.includes(p.id) &&
    !(game.teams[game.userTeamId].academyPlayerIds ?? []).includes(p.id);
  // A recruitment target: a real world player at another club (or a free agent)
  // the user can add to their scouting shortlist (v21). Not for the user's own
  // players, retirees, or scouted previews (they aren't in the world yet).
  const canShortlist = !isPreview && !p.retired && p.clubId !== game.userTeamId;
  const shortlisted = (game.shortlist ?? []).includes(p.id);
  // The Hall of Fame is a hand-curated club honour roll — any real player can be
  // enshrined (a legend the manager raised, bought, or admired from afar), living
  // or retired. Only a not-yet-signed scouted preview is excluded.
  const canHallOfFame = !isPreview;
  const inHallOfFame = (game.hallOfFame ?? []).includes(p.id);
  // The archetype is EARNED — read off the attribute line he actually has, not
  // stored (§2). A scouted preview whose attributes are still hidden therefore
  // has no archetype at all: there is nothing to name until he is scouted far
  // enough to reveal what he can do.
  const archetype = p.attrs ? deriveArchetype(p.attrs, p.positions[0]) : undefined;
  // The identity he is closest to shifting into, for the "next" line.
  const nextArchetype = p.attrs
    ? rankArchetypes(p.attrs, p.positions[0]).find((r) => r.archetype.id !== archetype?.id)?.archetype
    : undefined;
  // The class colour, drawn straight from the archetype palette so the Role card's
  // frame, title and pill all match the artwork inside it.
  const classColor = archetype ? ARCHETYPE_CLASS_COLOR[archetype.cls] : undefined;
  // Both direct moves need an open window — the buttons say so rather than
  // failing on click.
  const windowOpen = transferWindowState(game.currentDay, game.schedule).open;
  const career = game.careers[p.id];
  const avgRating = p.stats.apps ? (p.stats.ratingSum / p.stats.apps).toFixed(2) : "—";
  const primaryColor = posColors(p.positions[0]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative my-auto w-full max-w-5xl rounded-lg border border-line bg-surface p-5 shadow-2xl">
        {/* header card */}
        <div className="mb-5 flex flex-wrap items-center gap-5 rounded-lg border border-line bg-raised p-5 pr-12">
          <div
            className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${primaryColor.bg}22`, border: `1px solid ${primaryColor.bg}` }}
          >
            <Ovr value={p.overall} size="lg" />
            {/* This season's movement, tucked under the rating so the big number
                stays the focus (v19). */}
            {seasonGrowth(p) !== 0 && (
              <span className="absolute -bottom-2 rounded-sm border border-line bg-surface px-1">
                <GrowthBadge delta={seasonGrowth(p)} size="sm" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {/* The profile is the one place a player gets the whole row to
                himself, so it shows the full name ("Gianluigi Donnarumma")
                where the lists that led here showed the short one. */}
            <div className="display flex items-center gap-2.5 text-2xl font-bold leading-tight">
              <Flag nat={p.nationality} size={22} />
              {displayFullName(p)}
              {p.retired && <span className="text-sm text-faint">RETIRED</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-dim">
              <PosBadge pos={p.positions[0]} />
              <span>{POS_LABELS[p.positions[0]]}</span>
              <span className="text-faint">·</span>
              <span>{p.age}y</span>
              <span className="text-faint">·</span>
              <span title={p.heightCm ? `${p.heightCm} cm` : undefined}>{formatHeight(p.heightCm)}</span>
              {p.foot && (
                <>
                  <span className="text-faint">·</span>
                  <span title={`${p.foot}-footed`}>{p.foot === "Left" ? "Left foot" : "Right foot"}</span>
                </>
              )}
              <span className="text-faint">·</span>
              <span>{p.nationality}</span>
              {typeof p.kitNumber === "number" && (
                <>
                  <span className="text-faint">·</span>
                  <span className="display tnum font-semibold text-ink" title="Shirt number">
                    #{p.kitNumber}
                  </span>
                </>
              )}
              {p.loan && (
                <span className="display rounded-sm border border-win/40 px-1.5 py-0.5 text-[10px] font-semibold text-win">
                  ON LOAN · {game.teams[p.loan.toClubId]?.name}
                </span>
              )}
              {p.academyClubId && (
                <span
                  className="display rounded-sm border border-gold-lo/40 px-1.5 py-0.5 text-[10px] font-semibold text-gold"
                  title={`Came through the ${game.teams[p.academyClubId]?.name ?? "?"} academy`}
                >
                  {game.teams[p.academyClubId]?.short ?? "?"} ACADEMY
                </span>
              )}
            </div>
            {p.traits.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {p.traits.map((t) => (
                  <TraitChip key={t} id={t} />
                ))}
              </div>
            )}
          </div>
          {/* The right-hand block (reworked v1.76). Four facts stacked in a
              narrow right-aligned column made the header as tall as its own
              content twice over — the modal opened with a band of empty space
              beside the name. They now run as a ROW of fields: the club on its
              own line above, then value / wage / potential side by side, which
              is the shape the data actually has (three small labelled numbers)
              and costs one line instead of three. */}
          <div className="flex shrink-0 flex-col items-end gap-2">
            {club && (
              <div className="flex items-center gap-2 text-sm">
                <Crest colors={club.colors} short={club.short} size={20} />
                <span className="truncate">{club.name}</span>
              </div>
            )}
            <div className="flex items-end gap-5 text-right">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-faint">Market value</div>
                <div className="display tnum text-xl font-semibold leading-tight">
                  {p.retired ? "—" : formatMoney(p.value)}
                </div>
              </div>
              {/* Wage sits beside the value so a player's cost reads at a glance
                  anywhere the profile opens — not just for the user's own squad,
                  where the Contract section on Manage carries the full terms. A
                  player with no signed deal (a free agent, a scouted preview)
                  shows what his rating would command. */}
              {!p.retired && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-faint">
                    {p.contract ? "Weekly wage" : "Wage demand"}
                  </div>
                  <div className="display tnum text-xl font-semibold leading-tight text-ink">
                    {formatMoney(p.contract?.wage ?? playerWage(p.overall, TUNING))}
                    <span className="text-sm font-normal text-faint">/wk</span>
                  </div>
                </div>
              )}
              {!p.retired && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-faint">Potential</div>
                  <div className="flex h-7 items-center justify-end">
                    <PotentialBadge game={game} p={p} />
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* The only way out of the profile now that the backdrop no longer
              dismisses it — so it shows on phones too, where it used to be
              hidden and the backdrop was the sole escape. */}
          <button
            onClick={close}
            className="absolute right-4 top-4 rounded px-2 py-1 text-faint transition-colors hover:bg-hover hover:text-ink sm:right-6 sm:top-6"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Three tabs (v1.76). Bio is now purely WHO HE IS — role, this season,
            attributes — and every lever the manager can actually pull moved to
            Manage. The split is what it always should have been: reading a
            player and acting on one are different jobs, and stacking the second
            under the first buried the attribute sheet under six action panels. */}
        <Tabs
          tabs={[
            { id: "bio", label: "Bio" },
            { id: "career", label: "Career" },
            { id: "manage", label: "Manage" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "bio" ? (
          <>
          {/* Role — the archetype is the soul of the player (§1, v1.73). It leads
              the card because it is what he has BECOME; the archetype line below
              is what he was made to be, and a mismatch is the visible proof that
              training changed him. */}
          <Section title="Role">
            <Card className="overflow-hidden">
              {/* v1.76: the profile is the one surface with room to show the
                  archetype art at the size it was drawn, so the icon runs at 64px
                  here rather than the 16px list badge — and the header tints to
                  the CLASS colour instead of gold, which is what makes the badge
                  and its label read as one object. The gold accent stays
                  reserved for the active/important thing elsewhere. */}
              <div
                className="flex items-center gap-3.5 border-b px-4 py-3.5"
                style={{
                  borderColor: classColor ? `${classColor}40` : undefined,
                  background: classColor
                    ? `linear-gradient(90deg, ${classColor}1f, transparent)`
                    : "linear-gradient(90deg, var(--color-gold-lo, #6b5a2a)15, transparent)",
                }}
              >
                {/* The card names the PERSONA, so it wears the archetype's art;
                    the archetype icon only stands in while no archetype is earned
                    (attributes still hidden), matching the title beneath it. */}
                <span
                  className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl border bg-surface"
                  style={{ borderColor: classColor ? `${classColor}59` : undefined }}
                >
                  {archetype ? (
                    <ArchetypeIcon archetype={archetype} size={64} ring={false} />
                  ) : (
                    <span className="display text-2xl text-faint">?</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="display text-xl font-bold leading-tight"
                    style={{ color: classColor ?? undefined }}
                  >
                    {archetype ? archetype.name : <span className="text-faint">Unknown</span>}
                  </div>
                  <div className="text-[11px] uppercase tracking-widest text-faint">Archetype</div>
                </div>
                {archetype && <ClassPill cls={archetype.cls} className="shrink-0 px-2.5 py-1 tracking-widest" />}
              </div>
              <p className="px-4 py-3 text-[13px] leading-relaxed text-dim">
                {archetype?.desc ?? "Scout this player further to reveal the kind of footballer he is."}
              </p>
              {archetype && (
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line/50 px-4 py-3 text-[11px]">
                  <span>
                    <span className="uppercase tracking-widest text-faint">Training</span>{" "}
                    <span className="text-dim">{resolveTrainingPlan(p.trainingPlan, p.positions[0]).name}</span>
                  </span>
                  {nextArchetype && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="uppercase tracking-widest text-faint">Closest to</span>
                      <ArchetypeIcon archetype={nextArchetype} size={14} />
                      <span className="text-dim">{nextArchetype.name}</span>
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-line/50 px-4 py-3">
                <span className="mr-1 text-[11px] uppercase tracking-widest text-faint">Positions</span>
                {p.positions.map((pos, i) => (
                  <span key={pos} className="flex items-center gap-1.5">
                    <PosBadge pos={pos} />
                    <span className="text-[12px] text-dim">
                      {POS_LABELS[pos]}
                      {i === 0 && p.positions.length > 1 && <span className="ml-1 text-[10px] text-faint">(primary)</span>}
                    </span>
                    {i < p.positions.length - 1 && <span className="ml-1 text-faint">·</span>}
                  </span>
                ))}
                {p.positions.length === 1 && (
                  <span className="text-[11px] text-faint">Specialist — plays one position.</span>
                )}
              </div>
            </Card>
          </Section>

          {/* Honours (v24) — the trophy cabinet. Permanent: it shows on the card
              from the season a player first wins something, and survives
              retirement. Absent on a player who's never won anything. */}
          {(p.accolades?.length ?? 0) > 0 && <HonoursSection accolades={p.accolades!} />}

          {/* This season reads as a horizontal strip (v1.71): six small numbers
              never needed half the modal, and giving that half back is what lets
              the 35-attribute sheet run the full width below. */}
          <Section title="This Season">
            <Card className="grid grid-cols-2 divide-line/50 sm:grid-cols-3 sm:divide-x lg:grid-cols-6">
              {[
                ["Condition", <FitnessBar key="f" value={p.fitness} showValue />],
                ["Form", <FormChip key="fo" form={p.form} />],
                ["Appearances", <span key="a" className="display tnum text-lg font-semibold">{p.stats.apps}</span>],
                ["Goals", <span key="g" className="display tnum text-lg font-semibold">{p.stats.goals}</span>],
                ["Assists", <span key="as" className="display tnum text-lg font-semibold">{p.stats.assists}</span>],
                ["Avg rating", <span key="r" className="display tnum text-lg font-semibold">{avgRating}</span>],
                ...(p.youthStats && p.youthStats.apps > 0
                  ? [[
                      p.loan ? "On loan" : "U21 league",
                      <span key="y" className="tnum text-sm text-dim">
                        {p.youthStats.apps} apps · {p.youthStats.goals}g · {(p.youthStats.ratingSum / p.youthStats.apps).toFixed(2)}
                      </span>,
                    ] as [string, React.ReactNode]]
                  : []),
              ].map(([k, v], i) => (
                <div key={i} className="border-b border-line/50 px-4 py-2.5 sm:border-b-0">
                  <div className="text-[10px] uppercase tracking-widest text-faint">{k as string}</div>
                  <div className="mt-1 flex h-6 items-center">{v}</div>
                </div>
              ))}
            </Card>
          </Section>

          {/* Attributes — the full width, all 35 (§the sheet is the profile). */}
          <Section title="Attributes">
            <div className="space-y-3">
              <AttrGrid p={p} />
              <Card className="p-3">
                <AttrSheet p={p} />
              </Card>
              <p className="text-[12px] leading-relaxed text-faint">
                <span className="text-gold">◆</span> marks an attribute the {POS_LABELS[p.positions[0]]} role
                actually rates — those are the numbers carrying his overall.
                {archetype && (
                  <>
                    {" "}
                    {/* v1.78: the band is zero-centred now, so ">1.02" no longer
                        means "a strength" — it meant that only against the old
                        positively-biased rows. Naming the struggles too is what
                        makes the sentence a decision rather than a compliment. */}
                    {archetype.name}: shines in{" "}
                    {Object.entries(profileOf(archetype).styleSynergy)
                      .filter(([, v]) => (v as number) >= 1.05)
                      .map(([k]) => styleLabel(k))
                      .join(", ") || "no style in particular"}
                    {(() => {
                      const weak = Object.entries(profileOf(archetype).styleSynergy)
                        .filter(([, v]) => (v as number) <= 0.95)
                        .map(([k]) => styleLabel(k));
                      return weak.length ? `; struggles in ${weak.join(", ")}` : "";
                    })()}
                    . Wants {describePrefs(profileOf(archetype).instructionPrefs)}.
                  </>
                )}
              </p>
            </div>
          </Section>

          </>
        ) : tab === "manage" ? (
          <>
          {/* Everything the manager can DO with this player (v1.76). The panels
              are unchanged; only their home is. A player none of them apply to
              (another club's, a retiree, a scouted preview) gets the empty note
              at the bottom rather than a blank tab. */}

          {/* Scouting shortlist (v21) — track another club's player (or a free
              agent) as a recruitment target. Purely a personal watchlist; it
              collects the target under Transfers → Shortlist. */}
          {canShortlist && (
            <Section title="Recruitment">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="display font-semibold text-ink">
                    Shortlist
                    {shortlisted && <span className="ml-2 text-[10px] font-normal text-gold">SHORTLISTED</span>}
                  </div>
                  <div className="text-[12px] leading-relaxed text-faint">
                    {shortlisted
                      ? "He's on your shortlist — find him under Transfers → Shortlist to make a move when the window's open."
                      : "Keep an eye on him. Adding him to your shortlist collects him with your other targets under Transfers → Shortlist."}
                  </div>
                </div>
                <GhostButton onClick={() => toggleShortlist(p.id)} className="shrink-0 !py-1.5 text-xs">
                  {shortlisted ? "REMOVE FROM SHORTLIST" : "ADD TO SHORTLIST"}
                </GhostButton>
              </Card>
            </Section>
          )}

          {/* Hall of Fame (v1.55) — enshrine a player in the club's honour roll.
              A permanent, hand-curated tribute; collected on the Achievements
              screen. Available for any real player, living or retired. */}
          {canHallOfFame && (
            <Section title="Hall of Fame">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="display font-semibold text-ink">
                    Club Hall of Fame
                    {inHallOfFame && <span className="ml-2 text-[10px] font-normal text-gold">ENSHRINED</span>}
                  </div>
                  <div className="text-[12px] leading-relaxed text-faint">
                    {inHallOfFame
                      ? "He's in your club's Hall of Fame — see the full honour roll under Achievements → Hall of Fame."
                      : "Enshrine him among your club's legends. A permanent tribute collected under Achievements → Hall of Fame."}
                  </div>
                </div>
                <GhostButton onClick={() => toggleHallOfFame(p.id)} className="shrink-0 !py-1.5 text-xs">
                  {inHallOfFame ? "REMOVE FROM HALL OF FAME" : "ADD TO HALL OF FAME"}
                </GhostButton>
              </Card>
            </Section>
          )}

          {/* Shirt number (v15) — re-assignable, swapping with the incumbent */}
          {isUserOwned && <KitNumberPanel playerId={p.id} />}

          {/* Training plan (§5 v8) — a development focus for the user's own players */}
          {isUserOwned && (
            <Section title="Training Plan">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                {(() => {
                  const plan = resolveTrainingPlan(p.trainingPlan, p.positions[0]);
                  const best = optimalTrainingPlan(p);
                  const isOptimal = plan.id === best.id;
                  return (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="display flex items-center gap-2 font-semibold text-ink">
                          {plan.name}
                          {isOptimal && (
                            <span className="display rounded-sm border border-win/40 px-1.5 py-0.5 text-[10px] font-semibold text-win">
                              OPTIMAL
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] leading-relaxed text-faint">
                          {plan.blurb}
                          {!isOptimal && (
                            <>
                              {" "}
                              <span className="text-gold">Recommended: {best.name}.</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <select
                          value={plan.id}
                          onChange={(e) => setTrainingPlan(p.id, e.target.value)}
                          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-gold focus:outline-none"
                        >
                          {plansForPosition(p.positions[0]).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                        <GhostButton
                          onClick={() => autoAssignPlan(p.id)}
                          disabled={isOptimal}
                          className="!py-1.5 text-xs"
                        >
                          AUTO
                        </GhostButton>
                      </div>
                      {/* What the plan actually trains (v1.72). The three tiers
                          are the whole system, so the picker shows them rather
                          than leaving the player to infer them from the name. */}
                      <div className="w-full border-t border-line/50 pt-3">
                        <PlanTiers plan={plan} />
                      </div>
                    </>
                  );
                })()}
              </Card>
            </Section>
          )}

          {/* A senior pro out on loan (v1.54): his only squad action here is to
              recall him. He's still on the Squad page tagged "on loan"; the other
              moves reappear once he's back. */}
          {isUserLoanedSenior && (
            <Section title="Actions">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="display font-semibold text-ink">Recall from loan</div>
                  <div className="text-[12px] leading-relaxed text-faint">
                    {windowOpen
                      ? `Bring him back from ${game.teams[p.loan!.toClubId]?.name ?? "his loan club"} early — he returns to your squad and is available to pick.`
                      : "Loans can only be recalled while a transfer window is open."}
                  </div>
                </div>
                <GhostButton
                  onClick={() => recallLoanPlayer(p.id)}
                  disabled={!windowOpen}
                  className="shrink-0 !py-1.5 text-xs"
                >
                  RECALL LOAN
                </GhostButton>
              </Card>
            </Section>
          )}

          {/* Squad actions (v14, reworked v1.52) — the three ways a player
              leaves. Selling and loaning both RESOLVE here: they open a chooser
              of clubs that would actually take him, rather than setting a flag
              and waiting on the weekly tick to maybe produce something. */}
          {isUserSenior && (
            <Section title="Actions">
              <Card className="divide-y divide-line/50">
                {(() => {
                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="display font-semibold text-ink">Sell player</div>
                          <div className="text-[12px] leading-relaxed text-faint">
                            {signedLock
                              ? "Signed this season — he can't be sold or transfer-listed until next season."
                              : windowOpen
                                ? "See which clubs would buy him and what each would pay, then pick one. The deal completes immediately."
                                : "Players can only be sold while a transfer window is open."}
                          </div>
                        </div>
                        <GhostButton
                          onClick={() => setSellOpen(true)}
                          disabled={!windowOpen || signedLock}
                          className="shrink-0 !py-1.5 text-xs"
                        >
                          SELL PLAYER
                        </GhostButton>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="display font-semibold text-ink">Send on loan</div>
                          <div className="text-[12px] leading-relaxed text-faint">
                            {windowOpen
                              ? "Find a club that will play him every week. You keep paying his wages, and the minutes count toward his development — the best route for a young player short of first-team football."
                              : "Loans can only be arranged while a transfer window is open."}
                          </div>
                        </div>
                        <GhostButton
                          onClick={() => setLoanOpen(true)}
                          disabled={!windowOpen}
                          className="shrink-0 !py-1.5 text-xs"
                        >
                          SEND ON LOAN
                        </GhostButton>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="display font-semibold text-loss">Release</div>
                          <div className="text-[12px] leading-relaxed text-faint">
                            Tear up his contract. He leaves immediately as a free agent and you receive no fee — this
                            can&apos;t be undone.
                          </div>
                        </div>
                        <ConfirmButton
                          label="RELEASE"
                          confirmLabel={`Release ${p.name}?`}
                          tone="danger"
                          onConfirm={() => releaseSenior(p.id)}
                          className="shrink-0 !px-3 !py-1.5 text-xs"
                        />
                      </div>
                    </>
                  );
                })()}
              </Card>
            </Section>
          )}

          {/* Contract (§10 v5) — wage, length, and a re-sign path for own players */}
          {(p.contract || isUserSenior) && (
            <Section title="Contract">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                {p.contract ? (
                  <div className="flex flex-wrap items-center gap-6 text-sm">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-faint">Weekly wage</div>
                      <div className="display tnum font-semibold">{formatMoney(p.contract.wage)}/wk</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-faint">Runs until</div>
                      <div className="display tnum font-semibold">
                        end of S{p.contract.expirySeason}
                        {(() => {
                          const yl = yearsLeft(game, p);
                          return <span className={`ml-2 text-xs font-normal ${yl <= 1 ? "text-loss" : "text-faint"}`}>{yl <= 1 ? "final year" : `${yl} yrs left`}</span>;
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-dim">Academy player — no professional contract until promoted.</span>
                )}
                {isUserSenior && (
                  <GoldButton onClick={() => setContractOpen(true)} className="!py-1.5 text-xs">
                    {p.contract && yearsLeft(game, p) <= 1 ? "RE-SIGN (URGENT)" : "OFFER NEW DEAL"}
                  </GoldButton>
                )}
              </Card>
            </Section>
          )}

          {/* Nothing to manage — he isn't yours and isn't a target. Said plainly
              rather than left as an empty tab. */}
          {!canShortlist && !canHallOfFame && !isUserOwned && !isUserSenior && !isUserLoanedSenior && !p.contract && (
            <Section title="Manage">
              <Card className="p-4 text-sm text-faint">
                Nothing to manage here — he isn&apos;t one of your players.
              </Card>
            </Section>
          )}
          </>
        ) : (
          <div className="space-y-6">
            <AcademyOriginSection game={game} p={p} />
            <Section title="Season by Season">
              {!career?.seasons.length ? (
                <div className="text-sm text-faint">First season in progress — history is written at the season&apos;s end.</div>
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full min-w-[580px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-[11px] uppercase tracking-widest text-faint">
                        <th className="px-3 py-2 text-left">Season</th>
                        <th className="px-2 py-2 text-left">Club</th>
                        <th className="px-2 py-2 text-left">Competition</th>
                        <th
                          className="w-12 px-2 py-2 text-center"
                          title="His overall at the start of that season"
                        >
                          OVR
                        </th>
                        <th className="w-12 px-2 py-2 text-center">Apps</th>
                        <th className="w-10 px-2 py-2 text-center">G</th>
                        <th className="w-10 px-2 py-2 text-center">A</th>
                        <th className="w-14 px-2 py-2 text-right">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {career.seasons.slice().reverse().map((row, i) => (
                        <tr key={i} className="border-b border-line/50 last:border-0">
                          <td className="px-3 py-1.5 tnum text-dim">S{row.season}</td>
                          <td className="px-2 py-1.5">
                            <CareerClub game={game} clubId={row.clubId} name={row.clubName} />
                          </td>
                          <td className="px-2 py-1.5 text-dim">{row.competition}</td>
                          {/* Rows written before v1.63 never recorded it — a dash
                              beats inventing a rating the save doesn't hold. */}
                          <td className="px-2 py-1.5 text-center tnum">
                            {typeof row.startOverall === "number" ? row.startOverall : <span className="text-faint">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center tnum">{row.apps}</td>
                          <td className="px-2 py-1.5 text-center tnum">{row.goals}</td>
                          <td className="px-2 py-1.5 text-center tnum">{row.assists}</td>
                          <td className={`px-2 py-1.5 text-right tnum ${row.avgRating >= 7.2 ? "gold-text font-semibold" : ""}`}>
                            {row.avgRating ? row.avgRating.toFixed(2) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </Section>
            <Section title="Transfer History">
              {!career?.transfers.length ? (
                <div className="text-sm text-faint">No transfers recorded.</div>
              ) : (
                <Card className="divide-y divide-line/50 text-sm">
                  {career.transfers.slice().reverse().map((t, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-10 shrink-0 text-[11px] tnum text-faint">S{t.season}</span>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <TransferEndpoint game={game} clubId={t.fromId} name={t.from} />
                        <span className="shrink-0 text-faint">→</span>
                        <TransferEndpoint game={game} clubId={t.toId} name={t.to} strong />
                      </div>
                      <span className="shrink-0 tnum">{t.fee > 0 ? formatMoney(t.fee) : "Free"}</span>
                    </div>
                  ))}
                </Card>
              )}
            </Section>
          </div>
        )}

        {contractOpen && <ContractModal p={p} onClose={() => setContractOpen(false)} />}
        {sellOpen && <SellPlayerModal playerId={p.id} onClose={() => setSellOpen(false)} />}
        {loanOpen && <LoanOfferModal playerId={p.id} onClose={() => setLoanOpen(false)} />}
      </div>
    </div>
  );
}

/**
 * Academy origin (v1.6) — a permanent "Youth Academy Player" credit shown at the
 * top of the Career tab for anyone who came through an academy, carrying the
 * rarity tag (Bronze → Legacy) he graduated at as a piece of history. The tier
 * lives on `academyTier`, which — unlike the live `u21Tier` badge — is never
 * cleared on promotion, so a senior star still wears the rung he was found at.
 */
function AcademyOriginSection({ game, p }: { game: GameState; p: PlayerBio }) {
  const tier = migrateProspectTier(p.academyTier);
  if (!tier) return null;
  const club = p.academyClubId ? game.teams[p.academyClubId] : undefined;
  const color = TIER_COLOR[tier];
  const rare = tier === "obsidian" || tier === "legacy";
  return (
    <Section title="Academy">
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-xs uppercase tracking-widest text-faint">Youth Academy Player</span>
        <span
          className="display rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest"
          style={{
            borderColor: `${color}77`,
            color,
            ...(rare ? { boxShadow: `0 0 8px ${color}55` } : {}),
          }}
          title={`Graduated as a ${TIER_LABEL[tier]} prospect`}
        >
          {TIER_LABEL[tier]}
        </span>
        {club && (
          <span className="flex min-w-0 items-center gap-2 text-sm text-dim">
            <span className="text-faint">·</span>
            <Crest colors={club.colors} short={club.short} size={20} />
            <CountryFlag country={game.leagues[club.leagueId]?.country ?? ""} size={12} />
            <span className="truncate">{club.name} Youth Academy</span>
          </span>
        )}
      </Card>
    </Section>
  );
}

/** A club in the season-by-season table (v1.65): its badge and country flag
 * beside the name, so a career that moves between leagues reads as one. Rows
 * written before v1.65 carry no club id and fall back to a neutral crest from
 * the stored name — the same fallback transfer rows use. */
function CareerClub({ game, clubId, name }: { game: GameState; clubId?: string; name: string }) {
  const club = clubId ? game.teams[clubId] : undefined;
  const country = club ? game.leagues[club.leagueId]?.country : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={name}>
      <Crest
        colors={club?.colors ?? (["#2a2c33", "#8a8f9a"] as [string, string])}
        short={club?.short ?? name.slice(0, 3).toUpperCase()}
        size={18}
      />
      {country && <CountryFlag country={country} size={11} />}
      <span className="truncate">{name}</span>
    </span>
  );
}

/** One end of a transfer row: a club crest + its name. When the row carries a
 * club id (v1.44+) the real club colours/short are used; older rows and
 * non-club endpoints (free agency, released, youth football) fall back to a
 * neutral crest built from the stored name. */
function TransferEndpoint({
  game,
  clubId,
  name,
  strong,
}: {
  game: GameState;
  clubId?: string;
  name: string;
  strong?: boolean;
}) {
  const club = clubId ? game.teams[clubId] : undefined;
  const short = club?.short ?? name.slice(0, 3).toUpperCase();
  const colors = club?.colors ?? (["#2a2c33", "#8a8f9a"] as [string, string]);
  // The club's country (v1.65) — a career that crosses borders should read as
  // one. Non-club endpoints ("Free agency", "Contract expired") have no league
  // and so no flag, which is correct: they aren't anywhere.
  const country = club ? game.leagues[club.leagueId]?.country : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={name}>
      <Crest colors={colors} short={short} size={20} />
      {country && <CountryFlag country={country} size={11} />}
      <span className={`truncate ${strong ? "text-ink" : "text-dim"}`}>{name}</span>
    </span>
  );
}

/**
 * Honours (v24) — a player's permanent trophy cabinet. Accolades are grouped by
 * type (so five Golden Boots read as one line with a ×5 badge), the group's
 * seasons and leagues listed beneath. Ordered by prestige so the marquee honours
 * (Legacy Player, Player of the Season) sit at the top.
 */
const ACCOLADE_ORDER: AccoladeType[] = [
  "legacyPlayerOfSeason",
  "legacyTeamOfSeason",
  "playerOfSeason",
  "youngPlayerOfSeason",
  "goldenBoot",
  "goldenPlaymaker",
  "goldenGlove",
  "goldenWall",
  "teamOfSeason",
];

function HonoursSection({ accolades }: { accolades: Accolade[] }) {
  // Group by type, gathering each win's (season, league) so a repeated honour is
  // one row with its full history rather than a wall of duplicates.
  const groups = new Map<AccoladeType, Accolade[]>();
  for (const a of accolades) {
    const list = groups.get(a.type);
    if (list) list.push(a);
    else groups.set(a.type, [a]);
  }
  const ordered = ACCOLADE_ORDER.filter((t) => groups.has(t)).map((t) => ({
    type: t,
    wins: groups.get(t)!.slice().sort((x, y) => x.season - y.season),
  }));

  const total = accolades.length;

  return (
    <Section title={`Honours (${total})`}>
      <Card className="divide-y divide-line/50">
        {ordered.map(({ type, wins }) => {
          const meta = ACCOLADE_META[type];
          return (
            <div key={type} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 text-lg leading-none" aria-hidden>
                {meta.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="display flex items-center gap-2 font-semibold text-ink">
                  {meta.title}
                  {wins.length > 1 && (
                    <span className="display rounded-sm border border-gold-lo/50 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                      ×{wins.length}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  {wins.map((w, i) => (
                    <span key={i} className="tnum">
                      S{w.season}
                      {w.leagueName ? <span className="ml-1 text-dim">{w.leagueName}</span> : null}
                      {i < wins.length - 1 ? " ·" : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

/**
 * Shirt-number editor (v15). Typing a number another squad member already wears
 * SWAPS the two — which is what actually happens when a squad re-numbers, and
 * what a manager expects when they claim a taken shirt. The panel names the
 * current holder before you commit, so the swap is never a surprise.
 */
function KitNumberPanel({ playerId }: { playerId: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const commit = useGame((s) => s.setKitNumber);
  const p = game.players[playerId];
  const [draft, setDraft] = useState<string>("");

  const current = p?.kitNumber;
  const taken = squadNumbersFor(game, playerId);
  const parsed = draft.trim() === "" ? null : Number(draft);
  const valid =
    parsed !== null && Number.isInteger(parsed) && parsed >= MIN_KIT_NUMBER && parsed <= MAX_KIT_NUMBER;
  const holder = valid && parsed !== current ? taken.get(parsed!) : undefined;

  return (
    <Section title="Shirt Number">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-gold-lo/50 bg-raised">
            <span className="display tnum text-2xl font-bold text-gold">
              {typeof current === "number" ? current : "—"}
            </span>
          </div>
          <div className="min-w-0">
            <div className="display font-semibold text-ink">Squad number</div>
            <div className="text-[12px] leading-relaxed text-faint">
              {holder ? (
                <>
                  <span className="text-gold">#{parsed}</span> is {holder}&apos;s — assigning it swaps their numbers.
                </>
              ) : (
                `Any number from ${MIN_KIT_NUMBER} to ${MAX_KIT_NUMBER}. Taking a teammate's number swaps the two.`
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={draft}
            placeholder={typeof current === "number" ? String(current) : "#"}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                commit(playerId, parsed!);
                setDraft("");
              }
            }}
            className="w-16 rounded-md border border-line bg-raised px-2 py-1.5 text-center text-sm tnum text-ink focus:border-gold focus:outline-none"
            aria-label="New shirt number"
          />
          <GhostButton
            onClick={() => {
              if (!valid) return;
              commit(playerId, parsed!);
              setDraft("");
            }}
            disabled={!valid || parsed === current}
            className="!py-1.5 text-xs"
          >
            {holder ? "SWAP" : "ASSIGN"}
          </GhostButton>
        </div>
      </Card>
    </Section>
  );
}

/**
 * The three training tiers a plan splits its effort across (v1.72).
 *
 * The plan system's whole substance is WHERE growth goes, so the picker names
 * the attributes rather than making the manager infer them from a plan title.
 * "Other" isn't listed — it's every remaining attribute, and the percentage is
 * the honest way to say "everything else ticks over".
 */
function PlanTiers({ plan }: { plan: TrainingPlanDef }) {
  const row = (label: string, share: number, keys: AttrKey[], accent: string) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="display w-20 shrink-0 text-[10px] uppercase tracking-widest" style={{ color: accent }}>
        {label}
      </span>
      <span className="tnum shrink-0 text-[10px] text-faint">{Math.round(share * 100)}%</span>
      <span className="min-w-0 text-[12px] leading-snug text-dim">
        {keys.map((k) => ATTR_META[k].name).join(" · ")}
      </span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row("Primary", PRIMARY_SHARE, plan.primary, "var(--color-gold-hi)")}
      {row("Secondary", SECONDARY_SHARE, plan.secondary, "#9aa4b2")}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="display w-20 shrink-0 text-[10px] uppercase tracking-widest text-faint">Other</span>
        <span className="tnum shrink-0 text-[10px] text-faint">{Math.round(OTHER_SHARE * 100)}%</span>
        <span className="min-w-0 text-[12px] leading-snug text-faint">
          Everything else ticks over in the background.
        </span>
      </div>
    </div>
  );
}

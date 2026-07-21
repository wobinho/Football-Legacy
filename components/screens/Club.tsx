"use client";

// Club (§15.7): finances, staff slots, club history & records, save tools.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import {
  weeklyBreakdown,
  facilityNextCost,
  wageBillItems,
  staffWageItems,
  facilityIncomeItems,
  sponsorIncomeItems,
  type BreakdownItem,
  type Facility,
} from "@/lib/economy";
import { clubAllTimeRecords } from "@/lib/recordbook";
import { academyGraduates } from "@/lib/academy";
import {
  SPONSOR_SLOTS,
  activeMajorCount,
  dealsInSlot,
  marketabilityContributors,
  marketabilityLabel,
  marketabilityMaxLiveOffers,
  marketabilityStarRating,
  marketabilityStars,
  slotBlockedReason,
  slotCapacity,
  sponsorCooldownUntil,
} from "@/lib/sponsors";
import { formatMoney } from "@/lib/value";
import { Card, GhostButton, GoldButton, Section, Stars, Tabs, UpgradeCard } from "../ui";
import SeasonDetailModal from "./SeasonDetailModal";

// v7: staff moved to Development → Staff, so the Club page no longer has a Staff tab.
type Tab = "finances" | "income" | "investments" | "history" | "save";

export default function ClubScreen() {
  const [tab, setTab] = useState<Tab>("finances");
  return (
    <div>
      <Tabs
        tabs={[
          { id: "finances", label: "Finances" },
          { id: "income", label: "Income" },
          { id: "investments", label: "Investments" },
          { id: "history", label: "History & Records" },
          { id: "save", label: "Save" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "finances" && <FinancesTab />}
      {tab === "income" && <IncomeTab />}
      {tab === "investments" && <InvestmentsTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "save" && <SaveTab />}
    </div>
  );
}

/**
 * One line of the weekly ledger (v21).
 *
 * Lines that are the sum of identifiable things — the wage bill, staff, the
 * facilities — expand to show exactly what makes them up, so "£312k of wages" is
 * always answerable with "on whom". Lines that are a single formula (the TV
 * money, the position bonus) instead explain how the number was arrived at.
 * Either way no figure on this page is a bare assertion.
 */
function LedgerRow({
  label,
  amount,
  items,
  note,
}: {
  label: string;
  amount: number;
  items?: BreakdownItem[];
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const expandable = (items?.length ?? 0) > 0;
  const negative = amount < 0;
  // A zero line is neither income nor cost: showing "+£0" in green reads as
  // money coming in, which is wrong for an unfilled staff roster.
  const zero = amount === 0;

  const head = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-dim">
        {expandable && (
          <span className={`text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        )}
        <span className="truncate">{label}</span>
        {expandable && <span className="shrink-0 text-[11px] text-faint">({items!.length})</span>}
      </span>
      <span className={`shrink-0 tnum font-medium ${zero ? "text-faint" : negative ? "text-loss" : "text-win"}`}>
        {zero ? "" : negative ? "−" : "+"}
        {formatMoney(Math.abs(amount))}
      </span>
    </>
  );

  return (
    <div>
      {expandable ? (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-hover"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-center justify-between px-4 py-2.5 text-sm">{head}</div>
      )}

      {/* The formula behind a line that has no constituent parts. */}
      {!expandable && note && <div className="px-4 pb-2 text-[11px] text-faint">{note}</div>}

      {expandable && open && (
        <div className="border-t border-line/40 bg-base/40 px-4 py-2">
          {note && <div className="pb-1.5 text-[11px] text-faint">{note}</div>}
          {/* Scrolls past ~12 rows; a full senior squad is 25+ names and the
              page shouldn't grow a screen-length column for one expanded line. */}
          <div className="max-h-72 overflow-y-auto">
            {items!.map((it, i) => (
              <div key={`${it.label}-${i}`} className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
                <span className="min-w-0">
                  <span className="truncate text-dim">{it.label}</span>
                  {it.detail && <span className="ml-2 text-[10px] text-faint">{it.detail}</span>}
                </span>
                <span className={`shrink-0 tnum ${it.amount < 0 ? "text-loss" : "text-win"}`}>
                  {formatMoney(Math.abs(it.amount))}
                </span>
              </div>
            ))}
          </div>
          {items!.length > 8 && (
            <div className="mt-1 flex justify-between border-t border-line/40 pt-1.5 text-[11px] text-faint">
              <span>{items!.length} entries — scroll for the rest</span>
              <span className="tnum">{formatMoney(Math.abs(amount))} total</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FinancesTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const team = game.teams[game.userTeamId];
  const b = weeklyBreakdown(game, game.userTeamId, TUNING);

  const league = game.leagues[team.leagueId];
  const wageItems = wageBillItems(game, game.userTeamId, TUNING);
  const staffItems = staffWageItems(game);
  const facilityItems = facilityIncomeItems(game, game.userTeamId, TUNING);
  const sponsorItems = sponsorIncomeItems(game, game.userTeamId);

  type Row = { label: string; amount: number; items?: BreakdownItem[]; note?: string };
  const rows: Row[] = [
    {
      label: "Broadcast & prize (weekly)",
      amount: b.tvIncome,
      note: `Tier ${league?.tier ?? "—"} central distribution — a flat weekly share for every club in the division.`,
    },
    {
      label: "League position bonus",
      amount: b.positionBonus,
      note: `Merit payment scaled by where you sit in the table, up to ${formatMoney(TUNING.positionBonusMax)}/wk for top spot.`,
    },
    {
      label: "Matchday income",
      amount: b.gateIncome,
      note: `Gate receipts from a reputation of ${team.reputation}.`,
    },
    ...(b.facilityIncome > 0
      ? [{ label: "Facilities", amount: b.facilityIncome, items: facilityItems }]
      : []),
    ...(b.sponsorIncome > 0
      ? [{ label: "Sponsorships", amount: b.sponsorIncome, items: sponsorItems, note: "Weekly income from minor deals; major deals pay a lump sum instead." }]
      : []),
    { label: "Squad wage bill", amount: -b.wageBill, items: wageItems },
    { label: "Staff wages", amount: -b.staffWages, items: staffItems },
    ...(b.academyUpkeep > 0
      ? [
          {
            label: "Academy upkeep",
            amount: -b.academyUpkeep,
            note: `Level ${team.academyLevel ?? 0} academy × ${formatMoney(TUNING.academyUpkeepPerLevel)}/level. Academy players themselves draw no wages.`,
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Section title="Balance">
        <Card className="p-5 text-center">
          <div className="text-[11px] uppercase tracking-widest text-faint">Available budget</div>
          <div className="display gold-text mt-1 text-5xl font-bold tnum">{formatMoney(team.budget)}</div>
          <div className={`mt-2 text-sm tnum ${b.net >= 0 ? "text-win" : "text-loss"}`}>
            {b.net >= 0 ? "+" : ""}
            {formatMoney(b.net)} / week
          </div>
        </Card>
      </Section>
      <div className="lg:col-span-2">
      <Section
        title="Weekly Breakdown"
        right={<span className="text-xs text-faint">Tap a line to see what makes it up</span>}
      >
        <Card className="divide-y divide-line/50">
          {rows.map((r) => (
            <LedgerRow key={r.label} label={r.label} amount={r.amount} items={r.items} note={r.note} />
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold">
            <span>Net</span>
            <span className={`tnum ${b.net >= 0 ? "text-win" : "text-loss"}`}>{formatMoney(b.net)}</span>
          </div>
        </Card>
      </Section>
      </div>
    </div>
  );
}

function IncomeTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgrade = useGame((s) => s.upgrade);
  const team = game.teams[game.userTeamId];

  const facilities: {
    key: Facility;
    title: string;
    blurb: string;
    level: number;
    perLevel: number;
    icon: string;
    accent: string; // per-upgrade accent colour for a clear visual boundary
  }[] = [
    {
      key: "stadium",
      title: "Stadium",
      blurb: "Expand the ground to seat more fans — every level lifts your weekly matchday income.",
      level: team.stadiumLevel ?? 0,
      perLevel: TUNING.stadiumIncomePerLevel,
      icon: "🏟️",
      accent: "#d9a441", // gold
    },
    {
      key: "commercial",
      title: "Commercial",
      blurb: "Grow the club's commercial arm — partnerships and licensing add steady weekly income.",
      level: team.commercialLevel ?? 0,
      perLevel: TUNING.commercialIncomePerLevel,
      icon: "💼",
      accent: "#7ea6e0", // blue
    },
    {
      key: "hospitality",
      title: "Hospitality",
      blurb: "Corporate boxes and premium seating — high-margin income on every matchday.",
      level: team.hospitalityLevel ?? 0,
      perLevel: TUNING.hospitalityIncomePerLevel,
      icon: "🥂",
      accent: "#c07de0", // violet
    },
    {
      key: "retail",
      title: "Retail",
      blurb: "Megastore and online merchandising — shirt and kit sales all year round.",
      level: team.retailLevel ?? 0,
      perLevel: TUNING.retailIncomePerLevel,
      icon: "👕",
      accent: "#5fbf8a", // green
    },
    {
      key: "media",
      title: "Media & Streaming",
      blurb: "Club channel, streaming and content — a modern revenue stream that grows with the brand.",
      level: team.mediaLevel ?? 0,
      perLevel: TUNING.mediaIncomePerLevel,
      icon: "📺",
      accent: "#e08a5f", // amber
    },
    // v21: three cheaper streams, so a smaller club has a ladder it can start
    // climbing long before a stadium expansion is affordable.
    {
      key: "membership",
      title: "Membership Scheme",
      blurb: "Supporters' club and season-ticket memberships — modest money, but it arrives every week without fail.",
      level: team.membershipLevel ?? 0,
      perLevel: TUNING.membershipIncomePerLevel,
      icon: "🎟️",
      accent: "#8ec5d6", // pale blue
    },
    {
      key: "events",
      title: "Events & Conferences",
      blurb: "Put the ground to work on non-matchdays — concerts, conferences and functions between fixtures.",
      level: team.eventsLevel ?? 0,
      perLevel: TUNING.eventsIncomePerLevel,
      icon: "🎪",
      accent: "#d67ba0", // rose
    },
    {
      key: "academyPartner",
      title: "Academy Partnerships",
      blurb: "Feeder clubs and community schemes — partner fees and development payments from across the game.",
      level: team.academyPartnerLevel ?? 0,
      perLevel: TUNING.academyPartnerIncomePerLevel,
      icon: "🤝",
      accent: "#9d8ee0", // periwinkle
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
      {facilities.map((f) => {
        const nextCost = facilityNextCost(game, game.userTeamId, f.key, TUNING);
        const maxed = nextCost === null;
        const current = f.level * f.perLevel;
        const afterUpgrade = (f.level + 1) * f.perLevel;
        const canAfford = nextCost !== null && team.budget >= nextCost;
        return (
          <UpgradeCard
            key={f.key}
            title={f.title}
            icon={f.icon}
            accent={f.accent}
            level={f.level}
            maxLevel={TUNING.facilityMaxLevel}
            blurb={f.blurb}
            effectNow={`+${formatMoney(current)}/wk`}
            effectNext={`+${formatMoney(afterUpgrade)}/wk`}
            cost={maxed ? "—" : formatMoney(nextCost!)}
            maxed={maxed}
            canAfford={canAfford}
            note={
              maxed
                ? "Fully upgraded."
                : canAfford
                  ? `Pays for itself in about ${Math.ceil(nextCost! / f.perLevel)} weeks.`
                  : "Not enough budget yet — sell players or climb the table."
            }
            onUpgrade={() => upgrade(f.key)}
          />
        );
      })}
      </div>
    </div>
  );
}

// ── Sponsor Marketability (v20) ────────────────────────────────────────────
// The headline of the Investments page: a 1–5 star reading of how attractive
// this club looks to a brand. It's the one number behind how many suitors call,
// how good they are, and what they pay — so it leads the page, and it shows its
// working (which players are drawing them in) rather than being a mystery score.
function MarketabilityPanel() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const stars = marketabilityStars(game, game.userTeamId, TUNING);
  const whole = marketabilityStarRating(game, game.userTeamId, TUNING);
  const contributors = marketabilityContributors(game, game.userTeamId);
  const liveOffers = marketabilityMaxLiveOffers(game, game.userTeamId, TUNING);
  const moneyBonus = Math.round((stars - 1) * TUNING.sponsorMarketabilityPerStar * 100);

  return (
    <Section title="Sponsor Marketability">
      <Card className="border-gold bg-gradient-to-br from-gold-lo/[0.10] to-transparent p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="display text-2xl leading-none">
              <Stars n={whole} />
            </div>
            <div className="display mt-1.5 text-lg font-bold gold-text">{marketabilityLabel(stars)}</div>
          </div>
          <div className="flex flex-wrap gap-4 text-right">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-faint">Offer value</div>
              <div className="display text-lg font-bold tnum text-win">
                {moneyBonus > 0 ? `+${moneyBonus}%` : "Base"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-faint">Suitors at once</div>
              <div className="display text-lg font-bold tnum">{liveOffers}</div>
            </div>
          </div>
        </div>

        <p className="mt-3 border-t border-line/60 pt-3 text-[13px] leading-relaxed text-dim">
          How appealing the club looks to sponsors. A higher rating means more brands come calling, better-known
          names among them, and larger offers on the table. Marketable players in your senior squad are what
          drives it — sign or develop commercial draws to climb the scale.
        </p>

        {contributors.length > 0 ? (
          <div className="mt-3 border-t border-line/60 pt-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Who&apos;s drawing them in</div>
            <div className="space-y-1.5">
              {contributors.slice(0, 6).map((c) => (
                <div key={c.playerId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="display font-semibold">{c.name}</span>
                    <span className="ml-2 text-[11px] tnum text-faint">{c.overall}</span>
                  </span>
                  <span className="text-[11px] text-gold">{c.traits.join(" · ")}</span>
                </div>
              ))}
              {contributors.length > 6 && (
                <div className="text-[11px] text-faint">+{contributors.length - 6} more</div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 border-t border-line/60 pt-3 text-[13px] text-faint">
            Nobody in the senior squad is a commercial draw yet — offers are built on reputation alone. A player
            with the <span className="text-gold">Marketable</span> trait would lift every deal you&apos;re shown.
          </div>
        )}
      </Card>
    </Section>
  );
}

// ── Investments (v7): major (lump-sum) + minor (weekly) sponsorships ───────
function InvestmentsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const sign = useGame((s) => s.signSponsor);
  const pass = useGame((s) => s.passSponsor);
  const team = game.teams[game.userTeamId];
  const deals = team.sponsors ?? [];
  const offers = (team.sponsorOffers ?? []).filter((o) => o.expiresDay > game.currentDay);
  const majorsHeld = activeMajorCount(game, game.userTeamId);
  const weekly = deals.filter((d) => d.kind === "minor").reduce((s, d) => s + d.weeklyAmount, 0);
  const upfrontThisSeason = deals
    .filter((d) => d.kind === "major" && d.signedSeason === game.season)
    .reduce((s, d) => s + d.upfront, 0);

  const majorSlots = SPONSOR_SLOTS.filter((d) => d.kind === "major");
  const minorSlots = SPONSOR_SLOTS.filter((d) => d.kind === "minor");

  const slotBlock = (def: (typeof SPONSOR_SLOTS)[number]) => {
    // A slot can now hold several deals (v19) — regional partners, boot deals —
    // so render all of them and only offer the slot as "full" at capacity.
    const slotDeals = dealsInSlot(game, game.userTeamId, def.slot);
    const capacity = slotCapacity(def.slot, TUNING);
    const blocked = slotBlockedReason(game, game.userTeamId, def.slot, TUNING);
    const offer = offers.find((o) => o.slot === def.slot);
    const isMajor = def.kind === "major";
    // Strong visual separation of the two investment kinds: majors read as gold
    // "big deal" cards; minors read as cool, steady weekly cards.
    const cardCls = isMajor
      ? "border-gold bg-gradient-to-br from-gold-lo/[0.10] to-transparent shadow-[0_0_0_1px_rgba(217,164,65,0.15)]"
      : "border-[#4a7bd0]/60 bg-gradient-to-br from-[#4a7bd0]/[0.08] to-transparent";
    return (
      <Section
        key={def.slot}
        title={def.title}
        right={
          <span className="text-xs text-faint">
            {/* Capacity is the headline fact for a stackable slot. */}
            {capacity > 1 && (
              <span className="mr-2 tnum text-dim">
                {slotDeals.length}/{capacity} signed
              </span>
            )}
            {slotDeals.length >= capacity ? (
              <span className="text-win">{capacity > 1 ? "Full" : "Deal signed"}</span>
            ) : offer ? (
              "Offer on the table"
            ) : (
              "No offer yet"
            )}
          </span>
        }
      >
        <Card className={`p-4 ${cardCls}`}>
          <div className="flex flex-wrap items-center gap-4">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-2xl ${
                isMajor ? "border-gold-lo/50 bg-gold-lo/10" : "border-line bg-raised"
              }`}
            >
              {def.icon}
            </div>
            <div className="min-w-0 flex-1">
              <span
                className={`display inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-bold ${
                  isMajor ? "gold-grad text-black" : "border border-[#4a7bd0]/50 text-[#8fb4ee]"
                }`}
              >
                {isMajor ? "MAJOR · LUMP SUM" : "MINOR · WEEKLY"}
              </span>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{def.blurb}</p>
            </div>
          </div>

          {/* Signed deals in this slot — one row each, since a stackable slot
              can be running several partnerships at once. */}
          {slotDeals.map((deal) => (
            <div
              key={deal.id}
              className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3"
            >
              <div>
                <span className="display font-semibold">{deal.brand}</span>
                <span className="ml-2 text-[11px] text-faint">
                  runs through S{deal.expirySeason} · {deal.seasons} season{deal.seasons > 1 ? "s" : ""}
                </span>
              </div>
              {deal.kind === "major" ? (
                <span className="display tnum font-semibold text-win">{formatMoney(deal.upfront)} paid</span>
              ) : (
                <span className="display tnum font-semibold text-win">+{formatMoney(deal.weeklyAmount)}/wk</span>
              )}
            </div>
          ))}

          {offer && !blocked ? (
            <div className="mt-3 border-t border-line/60 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="display font-semibold">{offer.brand}</span>
                  <span className="ml-2 display rounded-sm border border-gold-lo/50 px-1.5 text-[9px] font-semibold text-gold">
                    {offer.tier.toUpperCase()}
                  </span>
                  <div className="text-[11px] text-faint">
                    {offer.seasons} season{offer.seasons > 1 ? "s" : ""} commitment
                  </div>
                </div>
                {isMajor ? (
                  <span className="text-right">
                    <span className="display block tnum font-semibold text-win">{formatMoney(offer.upfront)}</span>
                    <span className="text-[10px] text-faint">one-time, paid now</span>
                  </span>
                ) : (
                  <span className="display tnum font-semibold text-win">+{formatMoney(offer.weeklyAmount)}/wk</span>
                )}
              </div>
              {/* The deadline — the decision pressure this panel is built around.
                  Escalates to loss red in the final stretch. */}
              {(() => {
                const daysLeft = offer.expiresDay - game.currentDay;
                const urgent = daysLeft <= 4;
                return (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-1.5 text-[11px] ${
                      urgent ? "border-loss/50 bg-loss/10 text-loss" : "border-line bg-raised text-dim"
                    }`}
                  >
                    <span>{urgent ? "⏳" : "🗓"}</span>
                    <span>
                      <span className="display font-bold tnum">{daysLeft}</span> day{daysLeft === 1 ? "" : "s"} to decide —
                      {urgent ? " they walk if you don't sign." : " the offer is withdrawn after that."}
                    </span>
                  </div>
                );
              })()}
              <div className="mt-3 flex items-center justify-end gap-2">
                <GhostButton onClick={() => pass(offer.id)} className="!px-3 !py-1 text-xs">
                  Pass
                </GhostButton>
                <GoldButton onClick={() => sign(offer.id)} className="!px-4 !py-1 text-xs">
                  {isMajor ? "TAKE THE LUMP SUM" : "ACCEPT DEAL"}
                </GoldButton>
              </div>
            </div>
          ) : (
            <div className="mt-3 border-t border-line/60 pt-3 text-[12px] text-faint">
              {(() => {
                if (blocked) return blocked;
                const until = sponsorCooldownUntil(game, def.slot);
                if (until) {
                  return `No suitors right now — after the last offer lapsed, expect interest again in about ${
                    until - game.currentDay
                  } days.`;
                }
                return capacity > slotDeals.length && slotDeals.length > 0
                  ? `Room for ${capacity - slotDeals.length} more here — another partner should come calling soon.`
                  : "No offer in this slot right now — one should arrive in the coming days.";
              })()}
            </div>
          )}
        </Card>
      </Section>
    );
  };

  return (
    <div className="space-y-6">
      <MarketabilityPanel />

      <div className="flex flex-wrap items-stretch gap-3">
        <Card className="px-4 py-2">
          <div className="text-[10px] uppercase tracking-widest text-faint">Weekly from minors</div>
          <div className="display gold-text text-xl font-bold tnum">+{formatMoney(weekly)}/wk</div>
          {upfrontThisSeason > 0 && (
            <div className="mt-0.5 text-[11px] text-win">{formatMoney(upfrontThisSeason)} lump sums this season</div>
          )}
        </Card>
        {/* Portfolio capacity (v19): the landmark assets are each exclusive, the
            smaller partnerships stack — so both counts are worth showing. */}
        {(() => {
          const capacityOf = (kind: "major" | "minor") =>
            SPONSOR_SLOTS.filter((s) => s.kind === kind).reduce((n, s) => n + slotCapacity(s.slot, TUNING), 0);
          const majorCap = capacityOf("major");
          const minorCap = capacityOf("minor");
          const minorsHeld = deals.filter((d) => d.kind === "minor").length;
          return (
            <>
              <Card className="px-4 py-2">
                <div className="text-[10px] uppercase tracking-widest text-faint">Major deals</div>
                <div className="display text-xl font-bold tnum">
                  {majorsHeld}<span className="text-faint">/{majorCap}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {majorsHeld >= majorCap ? "Every landmark asset sold" : "Exclusive — one per asset"}
                </div>
              </Card>
              <Card className="px-4 py-2">
                <div className="text-[10px] uppercase tracking-widest text-faint">Minor partners</div>
                <div className="display text-xl font-bold tnum">
                  {minorsHeld}<span className="text-faint">/{minorCap}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {minorsHeld >= minorCap ? "Portfolio full" : "Several can run at once"}
                </div>
              </Card>
            </>
          );
        })()}
      </div>

      {/* Active slots panel: every signed deal at a glance (v7) */}
      <Section title="Active Investments" right={<span className="text-xs text-faint">{deals.length} signed</span>}>
        {deals.length === 0 ? (
          <Card className="p-4 text-sm text-faint">No deals signed yet — accept an offer below.</Card>
        ) : (
          <Card className="divide-y divide-line/50">
            {deals.map((d) => {
              const def = SPONSOR_SLOTS.find((s) => s.slot === d.slot);
              return (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-lg">{def?.icon}</span>
                    <span className="min-w-0">
                      <span className="display font-semibold">{d.brand}</span>
                      <span
                        className={`ml-2 display rounded-sm border px-1 text-[9px] font-semibold ${
                          d.kind === "major" ? "border-gold-lo/50 text-gold" : "border-line text-dim"
                        }`}
                      >
                        {d.kind === "major" ? "MAJOR" : "MINOR"}
                      </span>
                      <span className="ml-2 text-[11px] text-faint">
                        {def?.title} · runs through S{d.expirySeason}
                      </span>
                    </span>
                  </span>
                  <span className="display tnum font-semibold text-win">
                    {d.kind === "major" ? `${formatMoney(d.upfront)} paid` : `+${formatMoney(d.weeklyAmount)}/wk`}
                  </span>
                </div>
              );
            })}
          </Card>
        )}
      </Section>

      <div>
        <div className="mb-3 flex items-center gap-3 rounded-md border border-gold-lo/40 bg-gradient-to-r from-gold-lo/[0.12] to-transparent px-4 py-2.5">
          <span className="text-2xl">💰</span>
          <div>
            <div className="display text-sm font-bold text-gold">Major Investment</div>
            <div className="text-[11px] text-dim">One big lump sum up front, locked in for several seasons.</div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">{majorSlots.map(slotBlock)}</div>
      </div>
      <div>
        <div className="mb-3 flex items-center gap-3 rounded-md border border-[#4a7bd0]/40 bg-gradient-to-r from-[#4a7bd0]/[0.10] to-transparent px-4 py-2.5">
          <span className="text-2xl">📆</span>
          <div>
            <div className="display text-sm font-bold text-[#8fb4ee]">Minor Investment</div>
            <div className="text-[11px] text-dim">Steady weekly income, one season at a time.</div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">{minorSlots.map(slotBlock)}</div>
      </div>
    </div>
  );
}

function HistoryTab() {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const records = clubAllTimeRecords(game, game.userTeamId);
  const seasons = game.recordBook.seasons.slice().reverse();
  const topDivId = game.divisionIds?.[0] ?? "ENG1";
  // The season whose full review is open (v21). Held by season number rather
  // than by object so it survives a re-render of the record book.
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const openSummary = seasons.find((s) => s.season === openSeason) ?? null;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Section
        title="Seasons Past"
        right={
          seasons.length > 0 ? <span className="text-xs text-faint">Click a season for the full review</span> : undefined
        }
      >
        {seasons.length === 0 && (
          <div className="text-sm text-faint">The history books are empty. Finish a season and they begin.</div>
        )}
        <div className="space-y-3">
          {seasons.map((s) => (
            <Card key={s.season} className="p-0">
              <button
                onClick={() => setOpenSeason(s.season)}
                className="group w-full rounded-lg p-4 text-left hover:bg-hover"
                aria-label={`Open the ${s.yearLabel} season review`}
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="display gold-text text-lg font-bold">{s.yearLabel}</span>
                  <span className="flex items-baseline gap-2 text-xs text-dim">
                    You: {s.userFinish}
                    <span className="text-faint transition-transform group-hover:translate-x-0.5">→</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-[13px] text-dim sm:grid-cols-2">
                  <div>🏆 {s.championsByLeague[topDivId]?.teamName ?? "—"}</div>
                  <div>🏅 Cup: {s.cupWinner?.teamName ?? "—"}</div>
                  {s.playerOfSeason && <div>Player of the Season: {s.playerOfSeason.name}</div>}
                  {s.topScorers[topDivId] && (
                    <div>
                      Top scorer: {s.topScorers[topDivId].name} ({s.topScorers[topDivId].goals})
                    </div>
                  )}
                  {s.promoted.length > 0 && <div className="text-win">▲ {s.promoted.join(", ")}</div>}
                  {s.relegated.length > 0 && <div className="text-loss">▼ {s.relegated.join(", ")}</div>}
                </div>
                {s.notableTransfers.length > 0 && (
                  <div className="mt-2 border-t border-line pt-2 text-[12px] text-faint">
                    Record deal: {s.notableTransfers[0].playerName} to {s.notableTransfers[0].to} ({formatMoney(s.notableTransfers[0].fee)})
                  </div>
                )}
              </button>
            </Card>
          ))}
        </div>
        {openSummary && <SeasonDetailModal summary={openSummary} onClose={() => setOpenSeason(null)} />}
      </Section>

      <div className="space-y-6">
        {game.recordBook.biggestWin && (
          <Section title="Our Biggest Win (all competitions)">
            <Card className="p-4 text-center">
              <div className="display text-xl font-bold">{game.recordBook.biggestWin.text}</div>
              <div className="mt-1 text-xs text-faint">Season {game.recordBook.biggestWin.season}</div>
            </Card>
          </Section>
        )}
        <Section title="All-Time Top Scorers (club)">
          <RecordList rows={records.topScorers.map((r) => ({ ...r, value: r.goals }))} onView={viewPlayer} unit="goals" />
        </Section>
        <Section title="All-Time Top Assists (club)">
          <RecordList rows={records.topAssists.map((r) => ({ ...r, value: r.assists }))} onView={viewPlayer} unit="assists" />
        </Section>
        <Section title="Most Appearances (club)">
          <RecordList rows={records.mostAppearances.map((r) => ({ ...r, value: r.apps }))} onView={viewPlayer} unit="apps" />
        </Section>
        <GraduatesLedger />
      </div>
    </div>
  );
}

/** Academy DNA (§18): every product of the club's academy, best first. */
function GraduatesLedger() {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const grads = academyGraduates(game, game.userTeamId);
  return (
    <Section title="Academy Graduates" right={<span className="text-xs text-faint">{grads.length} produced</span>}>
      {grads.length === 0 ? (
        <div className="text-sm text-faint">No academy products yet — the intake class arrives every March.</div>
      ) : (
        <Card className="p-2">
          {grads.slice(0, 10).map((g, i) => (
            <button
              key={g.playerId}
              onClick={() => viewPlayer(g.playerId)}
              className="flex w-full items-center justify-between px-2 py-1 text-left text-sm hover:bg-hover"
            >
              <span className="min-w-0 truncate">
                <span className="mr-2 tnum text-faint">{i + 1}</span>
                {g.name}
                <span className="ml-2 text-[11px] text-faint">{g.clubName}</span>
              </span>
              <span className="display tnum font-semibold">
                {g.peak} <span className="text-[10px] font-normal text-faint">peak</span>
              </span>
            </button>
          ))}
        </Card>
      )}
    </Section>
  );
}

function RecordList({ rows, onView, unit }: { rows: { id: string; name: string; value: number }[]; onView: (id: string) => void; unit: string }) {
  if (!rows.length) return <div className="text-sm text-faint">No records yet.</div>;
  return (
    <Card className="p-2">
      {rows.map((r, i) => (
        <button
          key={r.id}
          onClick={() => onView(r.id)}
          className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-hover"
        >
          <span className="min-w-0 truncate">
            <span className="mr-2 tnum text-faint">{i + 1}</span>
            {r.name}
          </span>
          <span className="display tnum font-semibold">
            {r.value} <span className="text-[10px] font-normal text-faint">{unit}</span>
          </span>
        </button>
      ))}
    </Card>
  );
}

function SaveTab() {
  const game = useGame((s) => s.game)!;
  const exportCurrent = useGame((s) => s.exportCurrent);
  const quitToMenu = useGame((s) => s.quitToMenu);

  return (
    <div className="max-w-xl space-y-6">
      <Section title="Backup">
        <p className="mb-3 text-sm leading-relaxed text-dim">
          Your save lives in this browser (IndexedDB) and auto-saves as you play. Export a JSON backup regularly — the
          same file doubles as the modding format.
          {game.season - game.lastExportSeason >= 3 && (
            <span className="text-gold"> It has been {game.season - game.lastExportSeason} seasons since your last export.</span>
          )}
        </p>
        <div className="flex gap-3">
          <GhostButton onClick={exportCurrent}>Export save (.json)</GhostButton>
          <GhostButton onClick={quitToMenu}>Save & quit to menu</GhostButton>
        </div>
      </Section>
      <Section title="Save Details">
        <Card className="divide-y divide-line/50 text-sm">
          {[
            ["Save name", game.saveName],
            ["Manager", game.managerName],
            ["Season", `${game.season}`],
            ["World seed", `${game.seed}`],
            ["Players in world", `${Object.values(game.players).filter((p) => !p.retired).length}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2">
              <span className="text-faint">{k}</span>
              <span className="tnum">{v}</span>
            </div>
          ))}
        </Card>
      </Section>
    </div>
  );
}

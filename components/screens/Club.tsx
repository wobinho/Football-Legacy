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
  academyWageItems,
  facilityIncomeItems,
  sponsorIncomeItems,
  type BreakdownItem,
  type Facility,
} from "@/lib/economy";
import { clubAllTimeRecords, clubPlayerHistory } from "@/lib/recordbook";
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
import type { SponsorDeal, SponsorOffer } from "@/lib/types";
import { formatMoney } from "@/lib/value";
import { gcnFundsOf, gcnOverview } from "@/lib/gcn";
import { Card, Flag, GhostButton, GoldButton, MoneyInput, Section, Stars, Tabs } from "../ui";
import SeasonDetailModal from "./SeasonDetailModal";

// v7: staff moved to Development → Staff, so the Club page no longer has a Staff tab.
type Tab = "finances" | "income" | "investments" | "history" | "players" | "save";

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
          { id: "players", label: "Club Players" },
          { id: "save", label: "Save" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "finances" && <FinancesTab />}
      {tab === "income" && <IncomeTab />}
      {tab === "investments" && <InvestmentsTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "players" && <ClubPlayersTab />}
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

/** GCN Funds (v34): the deposit box that gates the Global Club Network. Before
 * unlock it's a progress-to-threshold deposit; after unlock it becomes the
 * treasury top-up (deposit/withdraw between the club and the network). */
function GcnFundsSection() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const depositGcnFunds = useGame((s) => s.depositGcnFunds);
  const gcnDeposit = useGame((s) => s.gcnDeposit);
  const gcnWithdraw = useGame((s) => s.gcnWithdraw);
  const openGcnUnlockPrompt = useGame((s) => s.openGcnUnlockPrompt);
  const setScreen = useGame((s) => s.setScreen);
  const [amount, setAmount] = useState(0);

  const unlocked = !!game.gcn;

  if (unlocked) {
    const ov = gcnOverview(game, TUNING);
    return (
      <Section title="GCN Treasury">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-faint">{game.gcn!.name}</div>
          <div className="display gold-text mt-1 text-3xl font-bold tnum">{formatMoney(ov.treasury)}</div>
          <div className="mt-3 flex items-center gap-2">
            <MoneyInput
              value={amount}
              onChange={setAmount}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm tnum outline-none focus:border-gold"
              placeholder="Amount"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <GoldButton onClick={() => { gcnDeposit(amount); setAmount(0); }}>Deposit</GoldButton>
            <GhostButton onClick={() => { gcnWithdraw(amount); setAmount(0); }}>Withdraw</GhostButton>
          </div>
          <button
            className="mt-3 w-full text-center text-xs text-gold hover:underline"
            onClick={() => setScreen("gcn")}
          >
            Open Global Club Network →
          </button>
        </Card>
      </Section>
    );
  }

  const funds = gcnFundsOf(game);
  const target = TUNING.gcnUnlockFundsTarget;
  const pct = Math.min(100, Math.round((funds / target) * 100));
  const ready = funds >= target;
  return (
    <Section title="GCN Funds">
      <Card className="p-4">
        <div className="text-[10px] uppercase tracking-widest text-faint">
          Fund the Global Club Network
        </div>
        <div className="display mt-1 text-2xl font-bold tnum">
          {formatMoney(funds)} <span className="text-sm text-faint">/ {formatMoney(target)}</span>
        </div>
        {/* progress bar */}
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full gold-grad" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Deposit toward a {formatMoney(target)} reserve. Reach it and you can unlock the Global
          Club Network — becoming head of a network of clubs across the world.
        </p>
        {!ready && (
          <>
            <div className="mt-3">
              <MoneyInput
                value={amount}
                onChange={setAmount}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm tnum outline-none focus:border-gold"
                placeholder="Amount to deposit"
              />
            </div>
            <div className="mt-2">
              <GoldButton className="w-full" onClick={() => { depositGcnFunds(amount); setAmount(0); }}>Deposit to GCN Funds</GoldButton>
            </div>
          </>
        )}
        {ready && (
          <div className="mt-3">
            <GoldButton className="w-full" onClick={openGcnUnlockPrompt}>Unlock Global Club Network</GoldButton>
            <p className="mt-2 text-center text-[11px] text-faint">Threshold reached.</p>
          </div>
        )}
      </Card>
    </Section>
  );
}

function FinancesTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const team = game.teams[game.userTeamId];
  const b = weeklyBreakdown(game, game.userTeamId, TUNING);

  const league = game.leagues[team.leagueId];
  const wageItems = wageBillItems(game, game.userTeamId, TUNING);
  const academyWageBreakdown = academyWageItems(game, game.userTeamId, TUNING);
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
    ...(b.academyWages > 0
      ? [
          {
            label: "Academy wages",
            amount: -b.academyWages,
            items: academyWageBreakdown,
            note: `Youth scholarships — each prospect earns ${formatMoney(TUNING.academyWageMin)}–${formatMoney(TUNING.academyWageMax)}/wk on youth terms, scaled by ability.`,
          },
        ]
      : []),
    ...(b.academyUpkeep > 0
      ? [
          {
            label: "Academy upkeep",
            amount: -b.academyUpkeep,
            note: `Level ${team.academyLevel ?? 0} academy × ${formatMoney(TUNING.academyUpkeepPerLevel)}/level — the facility running cost.`,
          },
        ]
      : []),
  ];

  // Split the ledger into what comes in and what goes out, so the weekly picture
  // reads as two columns of a P&L rather than one long undifferentiated list.
  const incomeRows = rows.filter((r) => r.amount >= 0);
  const costRows = rows.filter((r) => r.amount < 0);
  const totalIn = incomeRows.reduce((s, r) => s + r.amount, 0);
  const totalOut = costRows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Section title="Balance">
          <Card className="overflow-hidden border-gold bg-gradient-to-br from-gold-lo/[0.10] to-transparent p-5 text-center shadow-[0_0_0_1px_rgba(217,164,65,0.15)]">
            <div className="text-[11px] uppercase tracking-widest text-faint">Available budget</div>
            <div className="display gold-text mt-1 text-5xl font-bold tnum">{formatMoney(team.budget)}</div>
            <div
              className={`display mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm tnum ${
                b.net >= 0 ? "border-win/40 text-win" : "border-loss/40 text-loss"
              }`}
            >
              {b.net >= 0 ? "▲" : "▼"} {b.net >= 0 ? "+" : ""}
              {formatMoney(b.net)} / week
            </div>
          </Card>
          {/* At-a-glance in/out totals — the two halves of the weekly net. */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Card className="p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-faint">Income / wk</div>
              <div className="display tnum mt-0.5 text-lg font-bold text-win">+{formatMoney(totalIn)}</div>
            </Card>
            <Card className="p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-faint">Costs / wk</div>
              <div className="display tnum mt-0.5 text-lg font-bold text-loss">−{formatMoney(Math.abs(totalOut))}</div>
            </Card>
          </div>
        </Section>
        <GcnFundsSection />
      </div>
      <div className="lg:col-span-2">
        <Section
          title="Weekly Breakdown"
          right={<span className="text-xs text-faint">Tap a line to see what makes it up</span>}
        >
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/50 bg-raised px-4 py-1.5 text-[10px] uppercase tracking-widest text-win">
              <span>Income</span>
              <span className="tnum">+{formatMoney(totalIn)}</span>
            </div>
            <div className="divide-y divide-line/50">
              {incomeRows.map((r) => (
                <LedgerRow key={r.label} label={r.label} amount={r.amount} items={r.items} note={r.note} />
              ))}
            </div>
            <div className="flex items-center justify-between border-y border-line/50 bg-raised px-4 py-1.5 text-[10px] uppercase tracking-widest text-loss">
              <span>Costs</span>
              <span className="tnum">−{formatMoney(Math.abs(totalOut))}</span>
            </div>
            <div className="divide-y divide-line/50">
              {costRows.map((r) => (
                <LedgerRow key={r.label} label={r.label} amount={r.amount} items={r.items} note={r.note} />
              ))}
            </div>
            <div className="flex items-center justify-between border-t-2 border-line bg-base/40 px-4 py-3 text-sm font-semibold">
              <span className="display uppercase tracking-wide">Net / week</span>
              <span className={`display tnum text-base ${b.net >= 0 ? "text-win" : "text-loss"}`}>
                {b.net >= 0 ? "+" : ""}
                {formatMoney(b.net)}
              </span>
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
    // v1.67: two more streams — one at the cheap end of the ladder, one modern
    // mid-priced stream, so the buy order has more shape between the extremes.
    {
      key: "ticketing",
      title: "Ticketing & Fan Experience",
      blurb: "Own the ticketing platform and work the fan zone — booking fees, concessions and matchday extras on every gate.",
      level: team.ticketingLevel ?? 0,
      perLevel: TUNING.ticketingIncomePerLevel,
      icon: "🎫",
      accent: "#d6b25f", // brass
    },
    {
      key: "digital",
      title: "Digital & Gaming",
      blurb: "The club app, online store, esports side and digital collectibles — a young audience that pays all year round.",
      level: team.digitalLevel ?? 0,
      perLevel: TUNING.digitalIncomePerLevel,
      icon: "🎮",
      accent: "#6fd0c0", // teal
    },
  ];

  // Running totals across every income stream — the headline this page was
  // missing: what the facilities pay now, and how many are fully built out.
  const totalNow = facilities.reduce((s, f) => s + f.level * f.perLevel, 0);
  const maxedCount = facilities.filter((f) => facilityNextCost(game, game.userTeamId, f.key, TUNING) === null).length;
  const totalLevels = facilities.reduce((s, f) => s + f.level, 0);
  const capLevels = facilities.length * TUNING.facilityMaxLevel;

  const rows = facilities.map((f) => {
    const nextCost = facilityNextCost(game, game.userTeamId, f.key, TUNING);
    return {
      ...f,
      nextCost,
      maxed: nextCost === null,
      current: f.level * f.perLevel,
      afterUpgrade: (f.level + 1) * f.perLevel,
      canAfford: nextCost !== null && team.budget >= nextCost,
    };
  });

  // Affordable upgrades first, then the rest, maxed streams last (v1.65). The
  // page's whole job is "what should I buy next", and the answer used to be
  // buried somewhere in eight identical full-size cards read top to bottom.
  const ordered = rows.slice().sort((a, b) => {
    const rank = (r: (typeof rows)[number]) => (r.maxed ? 2 : r.canAfford ? 0 : 1);
    return rank(a) - rank(b) || (a.nextCost ?? Infinity) - (b.nextCost ?? Infinity);
  });
  const affordable = rows.filter((r) => r.canAfford).length;

  return (
    <div className="space-y-5">
      {/* One summary strip instead of three separate cards — the same three facts
          on a single line, so the page opens with a sentence rather than a wall. */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 border-gold bg-gradient-to-br from-gold-lo/[0.08] to-transparent px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Facilities income</div>
          <div className="display gold-text text-2xl font-bold tnum">+{formatMoney(totalNow)}/wk</div>
        </div>
        <div className="text-sm text-dim">
          <span className="display tnum font-semibold text-ink">{totalLevels}</span>
          <span className="text-faint">/{capLevels}</span> levels built ·{" "}
          <span className="display tnum font-semibold text-ink">{maxedCount}</span>
          <span className="text-faint">/{facilities.length}</span> maxed
        </div>
        <div className="ml-auto text-sm">
          {affordable > 0 ? (
            <span className="text-win">
              <span className="display tnum font-semibold">{affordable}</span> upgrade
              {affordable === 1 ? "" : "s"} you can afford now
            </span>
          ) : (
            <span className="text-faint">No upgrade is affordable yet</span>
          )}
        </div>
      </Card>

      <Section
        title="Income Streams"
        right={<span className="text-xs text-faint">Best value first · tap a stream for detail</span>}
      >
        <Card className="divide-y divide-line/50">
          {ordered.map((f) => (
            <FacilityRow key={f.key} f={f} onUpgrade={() => upgrade(f.key)} />
          ))}
        </Card>
      </Section>
    </div>
  );
}

/**
 * One income stream as a single scannable line (v1.65).
 *
 * The page used to render eight `UpgradeCard`s — each an h2, a blurb, a pip bar
 * and a three-column stat grid — so comparing two streams meant scrolling
 * between two screen-height blocks, and the one number that decides the choice
 * (cost vs. what it adds) was never next to its neighbour's. Collapsed, a row is
 * icon, name, level bar, what it pays, what the next level costs, and the
 * button. The blurb and the payback maths are still here, one tap away, for when
 * you actually want them.
 */
function FacilityRow({
  f,
  onUpgrade,
}: {
  f: {
    key: Facility;
    title: string;
    blurb: string;
    icon: string;
    accent: string;
    level: number;
    perLevel: number;
    nextCost: number | null;
    maxed: boolean;
    current: number;
    afterUpgrade: number;
    canAfford: boolean;
  };
  onUpgrade: () => void;
}) {
  const [open, setOpen] = useState(false);
  const maxLevel = TUNING.facilityMaxLevel;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:flex-nowrap">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-base"
            style={{ borderColor: `${f.accent}66`, background: `${f.accent}14` }}
          >
            {f.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="display truncate font-semibold" style={{ color: f.accent }}>
                {f.title}
              </span>
              <span className="shrink-0 tnum text-[11px] text-faint">
                {f.level}/{maxLevel}
              </span>
              <span className={`shrink-0 text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
            </span>
            {/* Level bar: the same information the old pip row carried, at a
                fraction of the height. */}
            <span className="mt-1 flex gap-0.5">
              {Array.from({ length: maxLevel }).map((_, i) => (
                <span
                  key={i}
                  className="h-1 flex-1 rounded-full"
                  style={{ background: i < f.level ? f.accent : "var(--color-line)" }}
                />
              ))}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-4 text-right text-sm">
          <div className="w-24">
            <div className="text-[10px] uppercase tracking-widest text-faint">Pays</div>
            <div className="display tnum font-semibold text-win">+{formatMoney(f.current)}/wk</div>
          </div>
          <div className="w-24">
            <div className="text-[10px] uppercase tracking-widest text-faint">{f.maxed ? "Status" : "Next level"}</div>
            <div className="display tnum font-semibold">
              {f.maxed ? <span className="text-gold">MAX</span> : formatMoney(f.nextCost!)}
            </div>
          </div>
          {f.maxed ? (
            <span className="display w-24 rounded-md border border-gold-lo/50 py-1.5 text-center text-[11px] font-semibold text-gold">
              MAX
            </span>
          ) : (
            <GoldButton onClick={onUpgrade} disabled={!f.canAfford} className="w-24 !py-1.5 text-xs">
              UPGRADE
            </GoldButton>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-line/40 bg-base/40 px-3 py-2.5 text-[12px] leading-relaxed text-dim">
          <p>{f.blurb}</p>
          <p className="mt-1.5 text-[11px] text-faint">
            {f.maxed
              ? "Fully upgraded — this stream is paying everything it can."
              : `Level ${f.level + 1} would pay +${formatMoney(f.afterUpgrade)}/wk, ${formatMoney(
                  f.perLevel
                )}/wk more than now — about ${Math.ceil(f.nextCost! / f.perLevel)} weeks to pay for itself.` +
                (f.canAfford ? "" : " Not enough budget yet — sell players or climb the table.")}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sponsor Marketability (v20) ────────────────────────────────────────────
// The headline of the Investments page: a 1–5 star reading of how attractive
// this club looks to a brand. It's the one number behind how many suitors call,
// how good they are, and what they pay — so it leads the page, and it shows its
// working (which players are drawing them in) rather than being a mystery score.
function MarketabilityPanel({ weekly, upfrontThisSeason }: { weekly: number; upfrontThisSeason: number }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const stars = marketabilityStars(game, game.userTeamId, TUNING);
  const whole = marketabilityStarRating(game, game.userTeamId, TUNING);
  const contributors = marketabilityContributors(game, game.userTeamId);
  const liveOffers = marketabilityMaxLiveOffers(game, game.userTeamId, TUNING);
  const moneyBonus = Math.round((stars - 1) * TUNING.sponsorMarketabilityPerStar * 100);
  // The explanation and the "who's drawing them in" list are reference material,
  // not something you read every visit — they fold away (v1.65) so the header is
  // four numbers on one line instead of half a screen of prose.
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-gold bg-gradient-to-br from-gold-lo/[0.08] to-transparent px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Weekly from sponsors</div>
          <div className="display gold-text text-2xl font-bold tnum">+{formatMoney(weekly)}/wk</div>
          {upfrontThisSeason > 0 && (
            <div className="text-[11px] text-win">{formatMoney(upfrontThisSeason)} in lump sums this season</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Marketability</div>
          <div className="display flex items-baseline gap-2 text-lg leading-tight">
            <Stars n={whole} />
            <span className="gold-text text-sm font-bold">{marketabilityLabel(stars)}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Offer value</div>
          <div className="display text-lg font-bold tnum text-win">{moneyBonus > 0 ? `+${moneyBonus}%` : "Base"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Suitors at once</div>
          <div className="display text-lg font-bold tnum">{liveOffers}</div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto text-xs text-gold hover:underline"
        >
          {open ? "Hide detail" : "What drives this?"}
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-line/60 pt-3">
          <p className="text-[13px] leading-relaxed text-dim">
            How appealing the club looks to sponsors. A higher rating means more brands come calling,
            better-known names among them, and larger offers on the table. Marketable players in your senior
            squad are what drives it — sign or develop commercial draws to climb the scale.
          </p>
          {contributors.length > 0 ? (
            <div className="mt-3">
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
            <div className="mt-3 text-[13px] text-faint">
              Nobody in the senior squad is a commercial draw yet — offers are built on reputation alone. A
              player with the <span className="text-gold">Marketable</span> trait would lift every deal
              you&apos;re shown.
            </div>
          )}
        </div>
      )}
    </Card>
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

  const capacityOf = (kind: "major" | "minor") =>
    SPONSOR_SLOTS.filter((s) => s.kind === kind).reduce((n, s) => n + slotCapacity(s.slot, TUNING), 0);
  const majorCap = capacityOf("major");
  const minorCap = capacityOf("minor");
  const minorsHeld = deals.filter((d) => d.kind === "minor").length;

  // The only thing on this page that needs acting on: offers waiting for a
  // yes/no. They used to be scattered one per slot card among five silent ones,
  // so an expiring deal could sit unseen at the bottom of the page.
  const liveOffers = SPONSOR_SLOTS.map((def) => ({
    def,
    offer: offers.find((o) => o.slot === def.slot),
    blocked: slotBlockedReason(game, game.userTeamId, def.slot, TUNING),
  })).filter((x) => x.offer && !x.blocked);

  // One slot's full picture, so the portfolio rows can carry their own offer
  // (v1.66) rather than pointing at a separate list further up the page.
  const slotState = (def: (typeof SPONSOR_SLOTS)[number]) => {
    // A slot can hold several deals (v19) — regional partners, boot deals — so
    // it's "full" only at capacity, not at the first signing.
    const slotDeals = dealsInSlot(game, game.userTeamId, def.slot);
    const capacity = slotCapacity(def.slot, TUNING);
    const blocked = slotBlockedReason(game, game.userTeamId, def.slot, TUNING);
    const offer = liveOffers.find((x) => x.def.slot === def.slot)?.offer ?? null;
    const cooldown = sponsorCooldownUntil(game, def.slot);
    const status = blocked
      ? blocked
      : offer
        ? "A brand is at the table — decide below."
        : slotDeals.length >= capacity
          ? capacity > 1
            ? "Full — every partnership in this slot is signed."
            : "Signed."
          : cooldown
            ? `No suitors right now — expect interest again in about ${cooldown - game.currentDay} days.`
            : slotDeals.length > 0
              ? `Room for ${capacity - slotDeals.length} more — another partner should come calling soon.`
              : "No offer here right now — one should arrive in the coming days.";
    return { def, deals: slotDeals, capacity, status, offer };
  };

  const majorSlots = SPONSOR_SLOTS.filter((d) => d.kind === "major").map(slotState);
  const minorSlots = SPONSOR_SLOTS.filter((d) => d.kind === "minor").map(slotState);

  const renderGroup = (
    slots: ReturnType<typeof slotState>[],
    opts: { title: string; blurb: string; held: number; cap: number }
  ) => {
    const waiting = slots.filter((s) => s.offer).length;
    return (
      <Section
        title={opts.title}
        right={
          <span className="text-xs text-dim">
            {waiting > 0 && (
              <span className="mr-2 text-gold">
                {waiting} offer{waiting === 1 ? "" : "s"} waiting
              </span>
            )}
            <span className="tnum text-ink">{opts.held}</span>/{opts.cap} total signed
          </span>
        }
      >
        <p className="mb-2 max-w-3xl text-[12px] leading-snug text-dim">{opts.blurb}</p>
        <Card className="divide-y divide-line/50">
          {slots.map((s) => (
            <SlotRow
              key={s.def.slot}
              def={s.def}
              deals={s.deals}
              capacity={s.capacity}
              status={s.status}
              offer={s.offer}
              daysLeft={s.offer ? s.offer.expiresDay - game.currentDay : 0}
              onSign={() => s.offer && sign(s.offer.id)}
              onPass={() => s.offer && pass(s.offer.id)}
            />
          ))}
        </Card>
      </Section>
    );
  };

  return (
    <div className="space-y-5">
      <MarketabilityPanel weekly={weekly} upfrontThisSeason={upfrontThisSeason} />

      {/* Major and minor are two different businesses (v1.66) — a lump-sum
          landmark deal and a weekly top-up shouldn't share a list, because the
          decision each asks for is a different size. Each slot now carries its
          own live offer inline, so a brand at the table is shown against the
          thing it wants to sponsor rather than in a separate section above. */}
      {renderGroup(majorSlots, {
        title: "Major Sponsorships",
        blurb:
          "The landmark deals — shirt, kit, ground and back-of-shirt. Each pays a single large lump sum into the budget on signing, and runs for several seasons.",
        held: majorsHeld,
        cap: majorCap,
      })}

      {renderGroup(minorSlots, {
        title: "Minor Sponsorships",
        blurb:
          "The secondary partnerships. Smaller money, paid weekly rather than up front — but several can run at once and together they add up.",
        held: minorsHeld,
        cap: minorCap,
      })}
    </div>
  );
}

/**
 * One portfolio slot as a line: what it is, what's signed in it, and what the
 * slot is doing right now. The blurb expands on tap for anyone who wants it.
 *
 * Since v1.66 a live offer for this slot rides on the row itself rather than
 * living in a separate "Offers On The Table" section — the decision and the
 * thing being decided about are the same object, and splitting them meant
 * reading a brand's name in one place and what it wanted to sponsor in another.
 * The offer strip is always expanded: it is the one thing on this page that
 * expires, so it must never be hidden behind a tap.
 */
function SlotRow({
  def,
  deals,
  capacity,
  status,
  offer,
  daysLeft,
  onSign,
  onPass,
}: {
  def: (typeof SPONSOR_SLOTS)[number];
  deals: SponsorDeal[];
  capacity: number;
  status: string;
  offer: SponsorOffer | null;
  daysLeft: number;
  onSign: () => void;
  onPass: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isMajor = def.kind === "major";
  const urgent = daysLeft <= 4;
  return (
    <div className={offer ? "bg-gold-lo/[0.04]" : ""}>
      {/* The category header. Slightly raised background so it reads as the
          parent of anything nested beneath it, and the signed count sits with
          the title rather than stranded against the right edge (v1.67). */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover ${
          offer ? "bg-raised/80" : "bg-raised/40"
        }`}
      >
        <span className="text-xl">{def.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="display font-semibold uppercase tracking-wide">{def.title}</span>
            <span
              className={`display shrink-0 rounded-sm border px-1.5 py-px text-[9px] font-bold tnum tracking-wider ${
                deals.length >= capacity
                  ? "border-win/40 text-win"
                  : "border-line text-dim"
              }`}
            >
              {deals.length}/{capacity} SIGNED
            </span>
            {offer && (
              <span className="display shrink-0 rounded-sm bg-gold-lo/25 px-1.5 py-px text-[9px] font-bold tracking-wider text-gold">
                OFFER WAITING
              </span>
            )}
            <span className={`text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-dim">
            {deals.length > 0 ? deals.map((d) => d.brand).join(", ") : status}
          </span>
        </span>
      </button>

      {/* The Decision Zone — always visible, because it is on a clock. Indented
          and boxed so it reads as belonging to the category above it rather than
          as a sibling row, and everything sits left-aligned in a compact grid
          instead of being stretched across the full width (v1.67). */}
      {offer && (
        <div className="border-t border-line/40 py-2.5 pl-[3.25rem] pr-3">
          <div
            className={`inline-flex w-full max-w-2xl flex-wrap items-center gap-x-6 gap-y-3 rounded-md border-l-2 border-y border-r px-3 py-2.5 ${
              isMajor
                ? "border-l-gold-lo border-gold-lo/30 bg-gold-lo/[0.07]"
                : "border-l-[#4a7bd0] border-[#4a7bd0]/30 bg-[#4a7bd0]/[0.07]"
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="display font-semibold">{offer.brand}</span>
                <span
                  className={`display rounded-sm border px-1 text-[9px] font-semibold ${
                    isMajor ? "border-gold-lo/50 text-gold" : "border-[#4a7bd0]/50 text-[#8fb4ee]"
                  }`}
                >
                  {offer.tier.toUpperCase()}
                </span>
              </div>
              <div className="text-[11px] text-dim">
                {offer.seasons} season{offer.seasons > 1 ? "s" : ""} ·{" "}
                {isMajor ? "one-time lump sum" : "paid weekly"}
              </div>
            </div>
            <div>
              <div className="display tnum text-lg font-bold leading-tight text-win">
                {isMajor ? formatMoney(offer.upfront) : `+${formatMoney(offer.weeklyAmount)}/wk`}
              </div>
              <div className={`text-[11px] ${urgent ? "text-loss" : "text-dim"}`}>
                {urgent ? "⏳ " : ""}
                <span className="tnum font-semibold">{daysLeft}</span> day{daysLeft === 1 ? "" : "s"} to decide
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Pass is a real button, not a hole in the page: a medium-dark
                  fill reads as clickable without competing with Accept. */}
              <button
                onClick={onPass}
                className="rounded-md border border-line bg-[#26282e] px-4 py-2 text-xs font-medium text-dim transition-colors hover:border-faint hover:bg-[#32353c] hover:text-ink"
              >
                Pass
              </button>
              <GoldButton onClick={onSign} className="!px-7 !py-2.5 text-sm">
                ACCEPT
              </GoldButton>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-line/40 bg-base/40 px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-dim">{def.blurb}</p>
          {deals.map((d) => (
            <div key={d.id} className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
              <span>
                <span className="display font-semibold">{d.brand}</span>
                <span className="ml-2 text-[11px] text-faint">runs through S{d.expirySeason}</span>
              </span>
              <span className="display tnum font-semibold text-win">
                {d.kind === "major" ? `${formatMoney(d.upfront)} paid` : `+${formatMoney(d.weeklyAmount)}/wk`}
              </span>
            </div>
          ))}
          {deals.length > 0 && <p className="mt-1.5 text-[11px] text-dim">{status}</p>}
        </div>
      )}
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
        {records.cleanSheets.length > 0 && (
          <Section title="All-Time Clean Sheets (club)">
            <RecordList rows={records.cleanSheets.map((r) => ({ ...r, value: r.cleanSheets }))} onView={viewPlayer} unit="clean sheets" />
          </Section>
        )}
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

function RecordList({
  rows,
  onView,
  unit,
}: {
  rows: { id: string; name: string; nationality?: string; pos?: string; value: number }[];
  onView: (id: string) => void;
  unit: string;
}) {
  if (!rows.length) return <div className="text-sm text-faint">No records yet.</div>;
  return (
    <Card className="p-1.5">
      {rows.map((r, i) => {
        const rank = i + 1;
        // The leader carries a gold accent; the rest read as a plain ranked list.
        const lead = rank === 1;
        return (
          <button
            key={r.id}
            onClick={() => onView(r.id)}
            className="group flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-hover"
          >
            <span
              className={`display flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-bold tnum ${
                lead ? "gold-grad text-black" : "text-faint"
              }`}
            >
              {rank}
            </span>
            {r.nationality && <Flag nat={r.nationality} size={11} />}
            <span className="min-w-0 flex-1 truncate transition-colors group-hover:text-gold">
              {r.name}
              {r.pos && <span className="ml-1.5 rounded-sm bg-raised px-1 text-[9px] font-semibold text-faint">{r.pos}</span>}
            </span>
            <span className="display shrink-0 tnum font-semibold">
              {r.value} <span className="text-[10px] font-normal text-faint">{unit}</span>
            </span>
          </button>
        );
      })}
    </Card>
  );
}

/**
 * Club Players (v1.66) — everyone who has ever played for the club.
 *
 * The record book answers "who scored the most"; this answers "who has been
 * here". One row per spell: when he arrived, when he left (or that he is still
 * here), and what he did in the shirt. Sortable, because the question changes —
 * sometimes it's "who is the club's longest server", sometimes "who scored".
 */
function ClubPlayersTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [sort, setSort] = useState<"recent" | "apps" | "goals" | "assists" | "spell">("recent");
  const [filter, setFilter] = useState<"all" | "current" | "past">("all");
  const [q, setQ] = useState("");

  const all = clubPlayerHistory(game, game.userTeamId);

  const spellLength = (s: (typeof all)[number]) =>
    (s.leftSeason ?? game.season) - s.joinedSeason + 1;

  const rows = all
    .filter((s) => (filter === "all" ? true : filter === "current" ? s.current : !s.current))
    .filter((s) => (q ? s.name.toLowerCase().includes(q.toLowerCase()) : true))
    .slice()
    .sort((a, b) => {
      switch (sort) {
        case "apps":
          return b.apps - a.apps;
        case "goals":
          return b.goals - a.goals;
        case "assists":
          return b.assists - a.assists;
        case "spell":
          return spellLength(b) - spellLength(a);
        default:
          return 0; // clubPlayerHistory already returns current-first, most-recent-first
      }
    });

  const currentCount = all.filter((s) => s.current).length;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 border-gold bg-gradient-to-br from-gold-lo/[0.08] to-transparent px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Players on the books</div>
          <div className="display gold-text text-2xl font-bold tnum">{all.length}</div>
        </div>
        <div className="text-sm text-dim">
          <span className="display tnum font-semibold text-ink">{currentCount}</span> in the squad today ·{" "}
          <span className="display tnum font-semibold text-ink">{all.length - currentCount}</span> former
        </div>
        <div className="ml-auto text-xs text-faint">Click a name for the full profile</div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "current", "past"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`display rounded px-3 py-1 text-xs font-semibold ${
              filter === f ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
            }`}
          >
            {f === "all" ? "All" : f === "current" ? "Current" : "Former"}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name…"
          className="ml-auto min-w-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-gold"
        />
      </div>

      <Card className="overflow-hidden">
        {/* Wide on desktop, and the whole table scrolls sideways on a phone
            rather than crushing the stat columns into unreadable slivers. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-raised text-[10px] uppercase tracking-widest text-faint">
                <th className="px-3 py-2 text-left font-medium">Player</th>
                <SortHeader label="Spell" active={sort === "spell"} onClick={() => setSort("spell")} align="left" />
                <SortHeader label="Apps" active={sort === "apps"} onClick={() => setSort("apps")} />
                <SortHeader label="Goals" active={sort === "goals"} onClick={() => setSort("goals")} />
                <SortHeader label="Assists" active={sort === "assists"} onClick={() => setSort("assists")} />
                <th className="px-3 py-2 text-right font-medium">Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {rows.map((s, i) => (
                <tr
                  key={`${s.playerId}-${s.joinedSeason}-${i}`}
                  onClick={() => viewPlayer(s.playerId)}
                  className="cursor-pointer hover:bg-hover"
                >
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {s.nationality && <Flag nat={s.nationality} size={11} />}
                      <span className="truncate">{s.name}</span>
                      {s.pos && (
                        <span className="shrink-0 rounded-sm bg-raised px-1 text-[9px] font-semibold text-faint">
                          {s.pos}
                        </span>
                      )}
                      {s.current && (
                        <span className="display shrink-0 rounded-sm bg-gold-lo/20 px-1 text-[9px] font-semibold text-gold">
                          IN SQUAD
                        </span>
                      )}
                      {s.retired && !s.current && (
                        <span className="shrink-0 rounded-sm border border-line px-1 text-[9px] text-faint">
                          RETIRED
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[12px] text-dim">
                    <span className="tnum">S{s.joinedSeason}</span>
                    <span className="text-faint"> → </span>
                    {s.leftSeason === null ? (
                      <span className="text-win">still in club</span>
                    ) : (
                      <span className="tnum">S{s.leftSeason}</span>
                    )}
                    <span className="ml-1.5 text-[11px] text-faint">
                      ({spellLength(s)} {spellLength(s) === 1 ? "season" : "seasons"})
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tnum">{s.apps}</td>
                  <td className="px-3 py-2 text-right tnum">{s.goals}</td>
                  <td className="px-3 py-2 text-right tnum">{s.assists}</td>
                  <td className="px-3 py-2 text-right tnum text-dim">{s.avgRating ? s.avgRating.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-faint">
            {all.length === 0
              ? "Nobody has played for the club yet — the ledger fills as seasons are played."
              : "No player matches that filter."}
          </div>
        )}
      </Card>
    </div>
  );
}

function SortHeader({
  label,
  active,
  onClick,
  align = "right",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}>
      <button onClick={onClick} className={`uppercase tracking-widest hover:text-ink ${active ? "text-gold" : ""}`}>
        {label}
        {active && " ▾"}
      </button>
    </th>
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

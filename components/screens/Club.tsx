"use client";

// Club (§15.7): finances, staff slots, club history & records, save tools.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import {
  byTier,
  weeklyBreakdown,
  facilityNextCost,
  wageBillItems,
  staffWageItems,
  academyWageItems,
  facilityIncomeItems,
  sponsorIncomeItems,
  describeIncomeLevel,
  incomeUpgradeCost,
  incomeUpgradeInfo,
  incomeUpgradeLevel,
  incomeUpgradeMaxLevel,
  FACILITY_KEYS,
  type BreakdownItem,
  type Facility,
} from "@/lib/economy";
import { clubAllTimeRecords, clubPlayerHistory } from "@/lib/recordbook";
import { academyGraduates } from "@/lib/academy";
import {
  SPONSOR_SLOTS,
  activeMajorCount,
  buyoutBlockedReason,
  buyoutCost,
  dealsInSlot,
  marketabilityBreakdown,
  marketabilityLabel,
  slotBlockedReason,
  slotCapacity,
  sponsorCooldownUntil,
} from "@/lib/sponsors";
import type { SponsorPayoutChoice } from "@/lib/sponsors";
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
      // Quoted at THIS club's tier (v1.67) — the merit ceiling is per-division, so
      // a flat figure would promise a third-tier side top-flight money.
      note: `Merit payment scaled by where you sit in the table, up to ${formatMoney(
        byTier(TUNING.positionBonusMaxByTier, league?.tier ?? 1)
      )}/wk for top spot.`,
    },
    {
      label: "Matchday income",
      amount: b.gateIncome,
      note: `Gate receipts from a reputation of ${team.reputation}.`,
    },
    ...(b.facilityIncome > 0
      ? [
          {
            label: "Income upgrades",
            amount: b.facilityIncome,
            items: facilityItems,
            note: "Weekly payouts from Club → Income. The Stadium and Performance bonuses pay per match instead, so they aren't on this line.",
          },
        ]
      : []),
    ...(b.sponsorIncome > 0
      ? [{ label: "Sponsorships", amount: b.sponsorIncome, items: sponsorItems, note: "Weekly income from minor deals; major deals pay a lump sum instead." }]
      : []),
    {
      label: "Squad wage bill",
      amount: -b.wageBill,
      // The per-player rows are what the contracts say; the discount is a
      // separate credit so the line items still sum to the figure shown.
      items: b.wageDiscount > 0
        ? [...wageItems, { label: "Contract Accounting discount", amount: b.wageDiscount, detail: describeIncomeLevel("contractAccounting", incomeUpgradeLevel(game, game.userTeamId, "contractAccounting"), TUNING) }]
        : wageItems,
      ...(b.wageDiscount > 0
        ? { note: `Contract Accounting saves ${formatMoney(b.wageDiscount)}/wk off a gross bill of ${formatMoney(b.wageBill + b.wageDiscount)}.` }
        : {}),
    },
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

/** Per-track icon and accent colour. Presentation only — everything else about a
 * track (title, copy, level maths) comes from lib/economy's spec. */
const INCOME_UPGRADE_STYLE: Record<Facility, { icon: string; accent: string }> = {
  lowTier: { icon: "🪙", accent: "#8ec5d6" }, // pale blue
  midTier: { icon: "💼", accent: "#7ea6e0" }, // blue
  highTier: { icon: "🌍", accent: "#d9a441" }, // gold
  playerBonus: { icon: "⭐", accent: "#c07de0" }, // violet
  contractAccounting: { icon: "📋", accent: "#5fbf8a" }, // green
  stadiumBonus: { icon: "🏟️", accent: "#e08a5f" }, // amber
  performanceBonus: { icon: "🏆", accent: "#d67ba0" }, // rose
};

function IncomeTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgrade = useGame((s) => s.upgrade);
  const team = game.teams[game.userTeamId];
  const b = weeklyBreakdown(game, game.userTeamId, TUNING);

  const rows = FACILITY_KEYS.map((key) => {
    const level = incomeUpgradeLevel(game, game.userTeamId, key);
    const nextCost = facilityNextCost(game, game.userTeamId, key, TUNING);
    return {
      key,
      ...incomeUpgradeInfo(key),
      ...INCOME_UPGRADE_STYLE[key],
      level,
      maxLevel: incomeUpgradeMaxLevel(key, TUNING),
      nextCost,
      maxed: nextCost === null,
      // What the track pays now, and what the next level would pay instead —
      // levels replace each other rather than stacking, so these are absolutes.
      current: describeIncomeLevel(key, level, TUNING),
      next: describeIncomeLevel(key, level + 1, TUNING),
      canAfford: nextCost !== null && team.budget >= nextCost,
    };
  });

  const totalLevels = rows.reduce((s, r) => s + r.level, 0);
  const capLevels = rows.reduce((s, r) => s + r.maxLevel, 0);
  const maxedCount = rows.filter((r) => r.maxed).length;
  const affordable = rows.filter((r) => r.canAfford).length;

  // Affordable upgrades first, then the rest, maxed tracks last — the page's job
  // is "what should I buy next", so the answer sorts to the top.
  const ordered = rows.slice().sort((a, b2) => {
    const rank = (r: (typeof rows)[number]) => (r.maxed ? 2 : r.canAfford ? 0 : 1);
    return rank(a) - rank(b2) || (a.nextCost ?? Infinity) - (b2.nextCost ?? Infinity);
  });

  return (
    <div className="space-y-5">
      {/* The headline: what the upgrades pay every week, how far the board has
          been built out, and whether anything is affordable right now. */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 border-gold bg-gradient-to-br from-gold-lo/[0.08] to-transparent px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Upgrade income</div>
          <div className="display gold-text text-2xl font-bold tnum">+{formatMoney(b.facilityIncome)}/wk</div>
        </div>
        {b.wageDiscount > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-faint">Wages saved</div>
            <div className="display text-2xl font-bold tnum text-win">+{formatMoney(b.wageDiscount)}/wk</div>
          </div>
        )}
        <div className="text-sm text-dim">
          <span className="display tnum font-semibold text-ink">{totalLevels}</span>
          <span className="text-faint">/{capLevels}</span> levels bought ·{" "}
          <span className="display tnum font-semibold text-ink">{maxedCount}</span>
          <span className="text-faint">/{rows.length}</span> maxed
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
        title="Income Upgrades"
        right={<span className="text-xs text-faint">Best value first · tap an upgrade for detail</span>}
      >
        <Card className="divide-y divide-line/50">
          {ordered.map((f) => (
            <FacilityRow key={f.key} f={f} onUpgrade={() => upgrade(f.key)} />
          ))}
        </Card>
      </Section>

      <p className="text-[11px] leading-relaxed text-faint">
        Each level <em>replaces</em> the one below it rather than adding to it — Low Tier level 2 pays{" "}
        {describeIncomeLevel("lowTier", 2, TUNING)}, not level 1 plus level 2. The Stadium and Performance bonuses are
        paid into the budget as each match is played; everything else lands on the weekly finances.
      </p>
    </div>
  );
}

/**
 * One income upgrade as a single scannable line (v1.65, retabled v43).
 *
 * Collapsed, a row is icon, name, level bar, what the track pays now, what the
 * next level costs, and the button. The blurb and the full level ladder are one
 * tap away, for when you actually want them.
 *
 * The "pays" column is a *string* from lib/economy, not a number this component
 * formats: the seven tracks pay in four different shapes (weekly, per home game,
 * per result, a percentage off wages), and only the spec knows which is which.
 */
function FacilityRow({
  f,
  onUpgrade,
}: {
  f: {
    key: Facility;
    title: string;
    tagline: string;
    blurb: string;
    icon: string;
    accent: string;
    level: number;
    maxLevel: number;
    nextCost: number | null;
    maxed: boolean;
    current: string;
    next: string;
    canAfford: boolean;
  };
  onUpgrade: () => void;
}) {
  const [open, setOpen] = useState(false);

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
                {f.level}/{f.maxLevel}
              </span>
              <span className={`shrink-0 text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-faint">{f.tagline}</span>
            <span className="mt-1 flex gap-0.5">
              {Array.from({ length: f.maxLevel }).map((_, i) => (
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
          <div className="w-40">
            <div className="text-[10px] uppercase tracking-widest text-faint">Pays</div>
            <div className="display text-[13px] font-semibold tnum text-win">
              {f.level > 0 ? f.current : <span className="text-faint">Not bought</span>}
            </div>
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
              {f.level === 0 ? "BUY" : "UPGRADE"}
            </GoldButton>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-line/40 bg-base/40 px-3 py-2.5 text-[12px] leading-relaxed text-dim">
          <p>{f.blurb}</p>
          <p className="mt-1.5 text-[11px] text-faint">
            {f.maxed
              ? "Fully upgraded — this track is paying everything it can."
              : `Level ${f.level + 1} would pay ${f.next} for ${formatMoney(f.nextCost!)}.` +
                (f.canAfford ? "" : " Not enough budget yet — sell players or climb the table.")}
          </p>
          {/* The whole ladder, so the buy order can be planned rather than
              discovered one level at a time. */}
          <ol className="mt-2 grid gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-2">
            {Array.from({ length: f.maxLevel }).map((_, i) => {
              const lvl = i + 1;
              const bought = lvl <= f.level;
              const isNext = lvl === f.level + 1;
              return (
                <li
                  key={lvl}
                  className={`flex items-baseline justify-between gap-3 tnum ${
                    bought ? "text-dim" : isNext ? "text-ink" : "text-faint"
                  }`}
                >
                  <span className="truncate">
                    <span className="text-faint">L{lvl}</span> {describeIncomeLevel(f.key, lvl, TUNING)}
                  </span>
                  <span className="shrink-0">
                    {bought ? "✓" : formatMoney(incomeUpgradeCost(f.key, lvl, TUNING))}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Club Marketability (v44) ───────────────────────────────────────────────
// The headline of the Investments page: a 0–100 score for how attractive this
// club looks to a brand, and the one number behind how many suitors call, how
// good they are and what they pay.
//
// The v20 panel led with a star rating and explained it with a list of players
// holding a commercial trait — which meant the honest answer to "how do I
// improve this?" was "hope the RNG gives you a Marketable striker". The score is
// now four things the manager controls, and the panel shows all four with their
// points, so the page answers that question by construction: the smallest bar is
// the thing to go and fix.
function MarketabilityPanel({ weekly, upfrontThisSeason }: { weekly: number; upfrontThisSeason: number }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const m = marketabilityBreakdown(game, game.userTeamId, TUNING);
  const moneyBonus = Math.round((m.valueMult - 1) * 100);

  return (
    <Card className="border-gold bg-gradient-to-br from-gold-lo/[0.08] to-transparent px-4 py-3">
      {/* The score and what it buys, on one line. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Marketability</div>
          <div className="display flex items-baseline gap-2 leading-tight">
            <span className="gold-text text-3xl font-bold tnum">{m.total}</span>
            <span className="text-sm text-dim tnum">/ 100</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <Stars n={m.stars} />
            <span className="display text-[11px] font-bold uppercase tracking-wide text-gold">
              {marketabilityLabel(m.stars)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Weekly from sponsors</div>
          <div className="display text-2xl font-bold tnum text-win">+{formatMoney(weekly)}/wk</div>
          {upfrontThisSeason > 0 && (
            <div className="text-[11px] text-win">{formatMoney(upfrontThisSeason)} in lump sums this season</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Offer multiplier</div>
          <div className="display text-lg font-bold tnum text-win">
            {moneyBonus > 0 ? `+${moneyBonus}%` : "Base"}
          </div>
          <div className="text-[11px] text-faint">{m.valueMult.toFixed(1)}× base value</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Suitors at once</div>
          <div className="display text-lg font-bold tnum">{m.maxOffers}</div>
          <div className="text-[11px] text-faint">{m.flavour}</div>
        </div>
      </div>

      {/* The breakdown. Always visible — this is the part that tells you what to
          go and do, so hiding it behind a toggle (as v1.65 did with the old
          trait list) would hide the only actionable thing on the page. */}
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 border-t border-line/60 pt-3 sm:grid-cols-2">
        {m.factors.map((f) => (
          <div key={f.key} className="flex items-center gap-3 text-[13px]">
            <span className="w-32 shrink-0 text-dim">{f.label}</span>
            <span className="display w-14 shrink-0 tnum font-bold text-ink">
              {f.points}
              <span className="text-[11px] font-normal text-faint">/{f.max}</span>
            </span>
            {/* A bar makes "which of these is short" readable at a glance in a
                way four numbers in a column are not. */}
            <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line/60">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-gold-lo to-gold-hi"
                style={{ width: `${f.max > 0 ? (f.points / f.max) * 100 : 0}%` }}
              />
            </span>
            <span className="min-w-0 truncate text-[11px] text-faint">{f.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Investments (v7): major (lump-sum) + minor (weekly) sponsorships ───────
function InvestmentsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const sign = useGame((s) => s.signSponsor);
  const pass = useGame((s) => s.passSponsor);
  const buyout = useGame((s) => s.buyoutSponsorDeal);
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
              onSign={(payout) => s.offer && sign(s.offer.id, payout)}
              onPass={() => s.offer && pass(s.offer.id)}
              onBuyout={buyout}
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
  onBuyout,
}: {
  def: (typeof SPONSOR_SLOTS)[number];
  deals: SponsorDeal[];
  capacity: number;
  status: string;
  offer: SponsorOffer | null;
  daysLeft: number;
  onSign: (payout: SponsorPayoutChoice) => void;
  onPass: () => void;
  onBuyout: (dealId: string) => void;
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
              {/* With no performance alternative there is one thing to say yes
                  to, so it stays a single button. */}
              {!offer.bonus && (
                <GoldButton onClick={() => onSign("guaranteed")} className="!px-7 !py-2.5 text-sm">
                  ACCEPT
                </GoldButton>
              )}
            </div>

            {/* Two ways to be paid (v44). Shown as two priced options side by
                side rather than a toggle, because the choice IS the decision —
                the user should be comparing the guaranteed number against the
                gamble, not flipping a switch and then reading one number. */}
            {offer.bonus && (
              <div className="mt-1 flex w-full flex-wrap gap-2 border-t border-line/40 pt-2.5">
                <button
                  onClick={() => onSign("guaranteed")}
                  className="min-w-[13rem] flex-1 rounded-md border border-gold-lo/40 bg-gold-lo/[0.06] px-3 py-2 text-left transition-colors hover:border-gold-lo hover:bg-gold-lo/[0.12]"
                >
                  <div className="display text-[10px] font-bold uppercase tracking-widest text-faint">
                    Option A · Guaranteed
                  </div>
                  <div className="display tnum text-lg font-bold leading-tight text-win">
                    {formatMoney(offer.upfront)}
                  </div>
                  <div className="text-[11px] text-dim">All of it, paid on signing.</div>
                </button>
                <button
                  onClick={() => onSign("bonus")}
                  className="min-w-[13rem] flex-1 rounded-md border border-[#4a7bd0]/40 bg-[#4a7bd0]/[0.06] px-3 py-2 text-left transition-colors hover:border-[#4a7bd0] hover:bg-[#4a7bd0]/[0.12]"
                >
                  <div className="display text-[10px] font-bold uppercase tracking-widest text-faint">
                    Option B · Performance
                  </div>
                  <div className="display tnum text-lg font-bold leading-tight text-[#8fb4ee]">
                    {formatMoney(offer.bonus.upfront)}
                    <span className="text-[11px] font-normal text-dim">
                      {" "}
                      + {formatMoney(offer.bonus.bonusAmount)}
                    </span>
                  </div>
                  <div className="text-[11px] text-dim">
                    Bonus paid each season you finish top {offer.bonus.finishPosition}.
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-line/40 bg-base/40 px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-dim">{def.blurb}</p>
          {deals.map((d) => (
            <SignedDealRow key={d.id} deal={d} onBuyout={() => onBuyout(d.id)} />
          ))}
          {deals.length > 0 && <p className="mt-1.5 text-[11px] text-dim">{status}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * One signed deal inside an expanded slot, with its early-buyout control (v44).
 *
 * A multi-season major signed two divisions ago is the reason this exists: the
 * slot is locked at lower-league money while far better suitors are queuing, and
 * before v44 the only option was to wait it out. Buying out costs a percentage
 * of what's left, so it's a real trade rather than a free reset — the fee is
 * shown on the button itself, and the confirm step exists because it is money
 * leaving the budget for nothing tangible.
 */
function SignedDealRow({ deal, onBuyout }: { deal: SponsorDeal; onBuyout: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [confirming, setConfirming] = useState(false);
  const cost = buyoutCost(game, deal, TUNING);
  const blocked = buyoutBlockedReason(game, deal, TUNING);

  return (
    <div className="mt-1.5 border-t border-line/30 pt-1.5 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
        <span>
          <span className="display font-semibold">{deal.brand}</span>
          <span className="ml-2 text-[11px] text-faint">runs through S{deal.expirySeason}</span>
          {deal.bonus && (
            <span className="ml-2 text-[10px] text-[#8fb4ee]">
              performance terms · {formatMoney(deal.bonus.bonusAmount)} if top {deal.bonus.finishPosition}
            </span>
          )}
        </span>
        <span className="display tnum font-semibold text-win">
          {deal.kind === "major" ? `${formatMoney(deal.upfront)} paid` : `+${formatMoney(deal.weeklyAmount)}/wk`}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[11px] text-loss">
              Pay {formatMoney(cost)} to end this deal now?
            </span>
            <button
              onClick={() => {
                onBuyout();
                setConfirming(false);
              }}
              className="rounded-md border border-loss/50 bg-loss/15 px-3 py-1 text-[11px] font-semibold text-loss transition-colors hover:bg-loss/25"
            >
              Confirm buyout
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-[11px] text-faint hover:text-ink"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={blocked !== null}
            title={blocked ?? undefined}
            className="rounded-md border border-line px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-faint hover:text-ink disabled:cursor-not-allowed disabled:border-line/50 disabled:text-faint disabled:hover:text-faint"
          >
            Buy out — {formatMoney(cost)}
          </button>
        )}
        {blocked && !confirming && <span className="text-[11px] text-faint">{blocked}</span>}
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
                  {/* The top continental champion (v1.67) — the season's biggest
                      trophy after the league, so it belongs on the summary line. */}
                  {s.europeanWinners?.[0] && (
                    <div>
                      ⭐ {s.europeanWinners[0].cupName}: {s.europeanWinners[0].teamName}
                    </div>
                  )}
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
  // "Academy" (v1.71) is a different axis to the other three — it asks where a
  // player came FROM rather than whether he's here now, so it deliberately spans
  // both current players and the ones who've been sold on.
  const [filter, setFilter] = useState<"all" | "current" | "past" | "academy">("all");
  const [q, setQ] = useState("");

  const all = clubPlayerHistory(game, game.userTeamId);

  const spellLength = (s: (typeof all)[number]) =>
    (s.leftSeason ?? game.season) - s.joinedSeason + 1;

  const rows = all
    .filter((s) =>
      filter === "all"
        ? true
        : filter === "current"
          ? s.current
          : filter === "academy"
            ? s.academy
            : // "Former" means gone — an academy prospect is neither in the senior
              // squad nor a departure, so he belongs in neither of those two.
              !s.current && !s.inAcademy
    )
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
  // A prospect is on the books without being in the senior squad, so he counts
  // as neither current nor former — the three tallies have to be spelled out
  // rather than derived as "everyone else".
  const inAcademyCount = all.filter((s) => s.inAcademy).length;
  const formerCount = all.length - currentCount - inAcademyCount;
  // One row per SPELL, so a graduate who left and came back would be counted
  // twice — the academy tally is by player, which is what "he came through here"
  // actually means.
  const academyCount = new Set(all.filter((s) => s.academy).map((s) => s.playerId)).size;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 border-gold bg-gradient-to-br from-gold-lo/[0.08] to-transparent px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-faint">Players on the books</div>
          <div className="display gold-text text-2xl font-bold tnum">{all.length}</div>
        </div>
        <div className="text-sm text-dim">
          <span className="display tnum font-semibold text-ink">{currentCount}</span> in the squad today ·{" "}
          <span className="display tnum font-semibold text-ink">{inAcademyCount}</span> in the academy ·{" "}
          <span className="display tnum font-semibold text-ink">{formerCount}</span> former ·{" "}
          <span className="display tnum font-semibold text-gold">{academyCount}</span> academy-raised
        </div>
        <div className="ml-auto text-xs text-faint">Click a name for the full profile</div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "current", "past", "academy"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            title={
              f === "academy"
                ? "Everyone who came through your academy — still here, promoted, or sold on"
                : undefined
            }
            className={`display rounded px-3 py-1 text-xs font-semibold ${
              filter === f ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
            }`}
          >
            {f === "all" ? "All" : f === "current" ? "Current" : f === "past" ? "Former" : "Academy"}
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
                      {s.inAcademy && (
                        <span className="display shrink-0 rounded-sm bg-gold-lo/20 px-1 text-[9px] font-semibold text-gold">
                          IN ACADEMY
                        </span>
                      )}
                      {s.academy && !s.inAcademy && (
                        <span
                          className="display shrink-0 rounded-sm border border-gold-lo/40 px-1 text-[9px] font-semibold text-gold"
                          title="Came through your academy"
                        >
                          ACADEMY
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
              : filter === "academy" && !q
                ? "No academy players yet — the first intake class arrives in March, and every prospect you raise stays on this list for good."
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

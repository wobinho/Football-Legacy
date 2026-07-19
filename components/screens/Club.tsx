"use client";

// Club (§15.7): finances, staff slots, club history & records, save tools.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import { weeklyBreakdown, facilityNextCost, type Facility } from "@/lib/economy";
import { clubAllTimeRecords } from "@/lib/recordbook";
import { academyGraduates } from "@/lib/academy";
import { SPONSOR_SLOTS } from "@/lib/sponsors";
import { formatMoney } from "@/lib/value";
import { Card, GhostButton, GoldButton, Section, Tabs, UpgradeCard } from "../ui";

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

function FinancesTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const team = game.teams[game.userTeamId];
  const b = weeklyBreakdown(game, game.userTeamId, TUNING);

  const rows: [string, number][] = [
    ["Broadcast & prize (weekly)", b.tvIncome],
    ["League position bonus", b.positionBonus],
    ["Matchday income", b.gateIncome],
    ...(b.facilityIncome > 0 ? ([["Facilities", b.facilityIncome]] as [string, number][]) : []),
    ...(b.sponsorIncome > 0 ? ([["Sponsorships", b.sponsorIncome]] as [string, number][]) : []),
    ["Squad wage bill", -b.wageBill],
    ["Staff wages", -b.staffWages],
    ...(b.academyUpkeep > 0 ? ([["Academy upkeep", -b.academyUpkeep]] as [string, number][]) : []),
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
      <Section title="Weekly Breakdown">
        <Card className="divide-y divide-line/50">
          {rows.map(([label, v]) => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-dim">{label}</span>
              <span className={`tnum font-medium ${v < 0 ? "text-loss" : "text-win"}`}>
                {v < 0 ? "−" : "+"}
                {formatMoney(Math.abs(v))}
              </span>
            </div>
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

// ── Investments (v7): major (lump-sum) + minor (weekly) sponsorships ───────
function InvestmentsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const sign = useGame((s) => s.signSponsor);
  const pass = useGame((s) => s.passSponsor);
  const team = game.teams[game.userTeamId];
  const deals = team.sponsors ?? [];
  const offers = (team.sponsorOffers ?? []).filter((o) => o.expiresDay > game.currentDay);
  const weekly = deals.filter((d) => d.kind === "minor").reduce((s, d) => s + d.weeklyAmount, 0);
  const upfrontThisSeason = deals
    .filter((d) => d.kind === "major" && d.signedSeason === game.season)
    .reduce((s, d) => s + d.upfront, 0);

  const majorSlots = SPONSOR_SLOTS.filter((d) => d.kind === "major");
  const minorSlots = SPONSOR_SLOTS.filter((d) => d.kind === "minor");

  const slotBlock = (def: (typeof SPONSOR_SLOTS)[number]) => {
    const deal = deals.find((d) => d.slot === def.slot);
    const offer = offers.find((o) => o.slot === def.slot);
    const isMajor = def.kind === "major";
    // Strong visual separation of the two investment kinds: majors read as gold
    // "big deal" cards; minors read as cool, steady weekly cards.
    const cardCls = isMajor
      ? "border-l-2 border-l-gold bg-gradient-to-r from-gold-lo/[0.08] to-transparent"
      : "border-l-2 border-l-[#4a7bd0]/60";
    return (
      <Section
        key={def.slot}
        title={def.title}
        right={deal ? <span className="text-xs text-win">Deal signed</span> : <span className="text-xs text-faint">{offer ? "Offer on the table" : "No offer yet"}</span>}
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

          {deal ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
              <div>
                <span className="display font-semibold">{deal.brand}</span>
                <span className="ml-2 text-[11px] text-faint">
                  runs through S{deal.expirySeason} · {deal.seasons} season{deal.seasons > 1 ? "s" : ""}
                </span>
              </div>
              {isMajor ? (
                <span className="display tnum font-semibold text-win">{formatMoney(deal.upfront)} paid</span>
              ) : (
                <span className="display tnum font-semibold text-win">+{formatMoney(deal.weeklyAmount)}/wk</span>
              )}
            </div>
          ) : offer ? (
            <div className="mt-3 border-t border-line/60 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="display font-semibold">{offer.brand}</span>
                  <span className="ml-2 display rounded-sm border border-gold-lo/50 px-1.5 text-[9px] font-semibold text-gold">
                    {offer.tier.toUpperCase()}
                  </span>
                  <div className="text-[11px] text-faint">
                    {offer.seasons} season{offer.seasons > 1 ? "s" : ""} · offer expires in {offer.expiresDay - game.currentDay}d
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
              No offer in this slot right now — one should arrive in the coming days.
            </div>
          )}
        </Card>
      </Section>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Card className="px-4 py-2 text-right">
          <div className="text-[10px] uppercase tracking-widest text-faint">Weekly from minors</div>
          <div className="display gold-text text-xl font-bold tnum">+{formatMoney(weekly)}/wk</div>
          {upfrontThisSeason > 0 && (
            <div className="mt-0.5 text-[11px] text-win">{formatMoney(upfrontThisSeason)} lump sums this season</div>
          )}
        </Card>
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

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Section title="Seasons Past">
        {seasons.length === 0 && (
          <div className="text-sm text-faint">The history books are empty. Finish a season and they begin.</div>
        )}
        <div className="space-y-3">
          {seasons.map((s) => (
            <Card key={s.season} className="p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="display gold-text text-lg font-bold">{s.yearLabel}</span>
                <span className="text-xs text-dim">You: {s.userFinish}</span>
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
            </Card>
          ))}
        </div>
      </Section>

      <div className="space-y-6">
        {game.recordBook.biggestWin && (
          <Section title="Biggest Win (all competitions)">
            <Card className="p-4 text-center">
              <div className="display text-xl font-bold">{game.recordBook.biggestWin.text}</div>
              <div className="mt-1 text-xs text-faint">Season {game.recordBook.biggestWin.season}</div>
            </Card>
          </Section>
        )}
        <Section title="All-Time Top Scorers (club)">
          <RecordList rows={records.topScorers.map((r) => ({ ...r, value: r.goals }))} onView={viewPlayer} unit="goals" />
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

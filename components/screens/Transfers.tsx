"use client";

// Transfers (§15.6): search/browse market, incoming offers, listings, window countdown.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { PlayerBio, Pos } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { getArchetype } from "@/lib/config/archetypes";
import { POS_ORDER } from "@/lib/config/positions";
import { askPrice } from "@/lib/transfers";
import { wageDemand, maxLengthFor } from "@/lib/contracts";
import { transferWindowState } from "@/lib/calendar";
import { formatMoney } from "@/lib/value";
import { ArchetypeIcon, Card, Crest, Flag, GhostButton, GoldButton, Modal, Money, MoneyInput, Ovr, PosBadge, Tabs } from "../ui";

type Tab = "search" | "offers" | "listed" | "free";

export default function TransfersScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<Tab>("search");
  const pendingCount = game.offers.filter((o) => o.status === "pending" && o.direction === "incoming").length;
  const win = transferWindowState(game.currentDay, game.schedule);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className={`display text-sm font-semibold ${win.open ? "gold-text" : "text-faint"}`}>
          {win.open ? `● ${win.label} — closes in ${win.daysLeft} days` : win.daysLeft ? `○ ${win.label} in ${win.daysLeft} days` : `○ ${win.label}`}
        </div>
        <div className="text-sm text-dim">
          Budget <Money value={game.teams[game.userTeamId].budget} className="display font-semibold text-ink" />
        </div>
      </div>
      <Tabs
        tabs={[
          { id: "search", label: "Search" },
          { id: "offers", label: "Offers", badge: pendingCount },
          { id: "listed", label: "My Listings" },
          { id: "free", label: "Free Agents" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "search" && <SearchTab />}
      {tab === "offers" && <OffersTab />}
      {tab === "listed" && <ListedTab />}
      {tab === "free" && <FreeAgentsTab />}
    </div>
  );
}

function useScouted() {
  const game = useGame((s) => s.game)!;
  return (game.teams[game.userTeamId].staff.scout?.stars ?? 0) >= 1;
}

function PlayerRowButton({ p, right, onClick }: { p: PlayerBio; right: React.ReactNode; onClick: () => void }) {
  const game = useGame((s) => s.game)!;
  const club = p.clubId ? game.teams[p.clubId] : null;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 border-b border-line/50 px-3 py-2 text-left text-sm last:border-0 hover:bg-hover">
      <PosBadge pos={p.positions[0]} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate font-medium">
          <Flag nat={p.nationality} size={13} />
          {p.name} <span className="ml-1 text-[11px] text-faint">{p.age}y</span>
        </div>
        <div className="flex items-center gap-1.5 truncate text-[11px] text-faint">
          <ArchetypeIcon archetypeId={p.archetypeId} size={12} />
          <span className="truncate">{getArchetype(p.archetypeId).name}</span>
          <span>·</span>
          {club ? (
            <span className="flex items-center gap-1 truncate text-dim">
              <Crest colors={club.colors} short={club.short} size={13} />
              <span className="truncate">{club.name}</span>
            </span>
          ) : (
            <span className="text-win">Free agent</span>
          )}
        </div>
      </div>
      <Ovr value={p.overall} size="sm" />
      {right}
    </button>
  );
}

function SearchTab() {
  const game = useGame((s) => s.game)!;
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [maxValue, setMaxValue] = useState<number>(0);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const scouted = useScouted();

  const results = useMemo(() => {
    const list = Object.values(game.players).filter(
      (p) =>
        !p.retired &&
        p.clubId &&
        p.clubId !== game.userTeamId &&
        (pos === "ALL" || p.positions.includes(pos)) &&
        (maxValue === 0 || p.value <= maxValue) &&
        (query === "" || p.name.toLowerCase().includes(query.toLowerCase()))
    );
    return list.sort((a, b) => b.overall - a.overall).slice(0, 60);
  }, [game.players, game.userTeamId, pos, maxValue, query]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players…"
          className="w-48 rounded-md border border-line bg-raised px-3 py-1.5 text-sm placeholder:text-faint focus:border-gold focus:outline-none"
        />
        <select
          value={pos}
          onChange={(e) => setPos(e.target.value as Pos | "ALL")}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
        >
          <option value="ALL">All positions</option>
          {POS_ORDER.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={maxValue}
          onChange={(e) => setMaxValue(Number(e.target.value))}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
        >
          <option value={0}>Any value</option>
          {[2, 5, 10, 25, 50, 100].map((m) => (
            <option key={m} value={m * 1_000_000}>≤ £{m}M</option>
          ))}
        </select>
        {!scouted && <span className="text-[11px] text-faint">Hire a Scout for tighter potential reads on young players.</span>}
      </div>
      <Card>
        {results.map((p) => (
          <PlayerRowButton
            key={p.id}
            p={p}
            onClick={() => setTarget(p)}
            right={
              <div className="w-28 text-right">
                <Money value={p.value} className="text-dim" />
              </div>
            }
          />
        ))}
        {results.length === 0 && <div className="p-4 text-sm text-faint">No players match those filters.</div>}
      </Card>
      {target && <BidModal p={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function BidModal({ p, onClose }: { p: PlayerBio; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const bid = useGame((s) => s.bid);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const showToast = useGame((s) => s.showToast);
  const ask = askPrice(game, p, TUNING);
  const demand = wageDemand(game, p, TUNING);
  const maxYears = maxLengthFor(p, TUNING);
  const [fee, setFee] = useState(ask);
  const [wage, setWage] = useState(demand);
  const [years, setYears] = useState(Math.min(TUNING.contractRenewYearsDefault, maxYears));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [counter, setCounter] = useState<number | null>(null);

  const submit = (amount: number) => {
    const out = bid(p.id, amount, { wage, years });
    if (out.kind === "accepted") {
      showToast(`${p.name} joins for ${formatMoney(amount)} on ${formatMoney(wage)}/wk!`);
      onClose();
    } else if (out.kind === "countered") {
      setCounter(out.counterFee);
      setFeedback(`They want ${formatMoney(out.counterFee)}.`);
    } else {
      setFeedback(out.reason);
      setCounter(null);
    }
  };

  const budget = game.teams[game.userTeamId].budget;
  const overBudget = fee > budget;

  return (
    <Modal title={`Bid for ${p.name}`} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-sm text-dim">
        <span>
          {getArchetype(p.archetypeId).name} · {p.age}y · <Ovr value={p.overall} size="sm" />
        </span>
        <button className="text-xs text-faint hover:text-dim" onClick={() => viewPlayer(p.id)}>
          Full profile →
        </button>
      </div>

      {/* Budget on hand — so a bid is never entered blind against what's available. */}
      <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-raised px-3 py-2">
        <span className="text-[11px] uppercase tracking-widest text-faint">Budget available</span>
        <Money value={budget} className="display font-semibold text-ink" />
      </div>

      <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-widest text-faint">
        <span>Transfer fee</span>
        <span className="tnum text-dim">{formatMoney(fee)}</span>
      </div>
      <div className="flex gap-2">
        <span className="relative flex flex-1 items-center">
          <span className="pointer-events-none absolute left-3 text-dim">£</span>
          <MoneyInput
            value={fee}
            onChange={setFee}
            min={0}
            className="w-full rounded-md border border-line bg-raised py-2 pl-7 pr-3 tnum focus:border-gold focus:outline-none"
          />
        </span>
        <GoldButton onClick={() => submit(fee)}>BID</GoldButton>
      </div>
      <div className="mt-2 flex justify-between text-xs text-faint">
        <span>Market value {formatMoney(p.value)}</span>
        <button className="hover:text-dim" onClick={() => setFee(ask)}>Suggested: {formatMoney(ask)}</button>
      </div>
      {overBudget && (
        <div className="mt-1.5 text-[11px] text-loss">
          This fee is {formatMoney(fee - budget)} over your available budget.
        </div>
      )}

      {/* Contract terms (§10 v5) — agreed as part of the signing. */}
      <div className="mt-4 border-t border-line/60 pt-3">
        <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-widest text-faint">
          <span>Contract offer</span>
          <span className="tnum text-dim">{formatMoney(wage)}/wk</span>
        </div>
        <input
          type="number"
          value={wage}
          min={500}
          step={500}
          onChange={(e) => setWage(Math.max(0, Number(e.target.value)))}
          className="w-full rounded-md border border-line bg-raised px-3 py-2 tnum focus:border-gold focus:outline-none"
        />
        <div className="mt-2 flex gap-1.5">
          {Array.from({ length: maxYears }, (_, i) => i + 1).map((y) => (
            <button
              key={y}
              onClick={() => setYears(y)}
              className={`display flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
                years === y ? "gold-grad text-black" : "border border-line text-dim hover:text-ink"
              }`}
            >
              {y} yr{y > 1 ? "s" : ""}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-faint">
          <span>Wants ~{formatMoney(demand)}/wk</span>
          <button className="hover:text-dim" onClick={() => setWage(demand)}>Match demand</button>
        </div>
      </div>

      {feedback && (
        <div className="mt-3 rounded-md border border-line bg-raised p-3 text-sm text-dim">
          {feedback}
          {counter && (
            <GoldButton className="ml-3 !py-1 text-xs" onClick={() => submit(counter)}>
              MEET IT
            </GoldButton>
          )}
        </div>
      )}
    </Modal>
  );
}

function OffersTab() {
  const game = useGame((s) => s.game)!;
  const [negotiating, setNegotiating] = useState<string | null>(null);
  const offers = game.offers.filter((o) => o.direction === "incoming" && o.status === "pending");
  if (!offers.length) return <div className="pt-8 text-center text-sm text-faint">No offers on the table. List players to attract bids.</div>;
  return (
    <div className="space-y-3">
      {offers.map((o) => {
        const p = game.players[o.playerId];
        const buyer = game.teams[o.fromClubId];
        return (
          <Card key={o.id} className="flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {buyer.name} → <span className="gold-text">{formatMoney(o.fee)}</span> for {p.name}
              </div>
              <div className="text-xs text-faint">
                Valued {formatMoney(p.value)} · Ovr {p.overall} · {p.age}y · expires in {Math.max(0, o.deadlineDay - game.currentDay)}d
              </div>
            </div>
            <div className="flex gap-2">
              <GoldButton onClick={() => setNegotiating(o.id)} className="!py-1.5">NEGOTIATE</GoldButton>
            </div>
          </Card>
        );
      })}
      {negotiating && <NegotiateModal offerId={negotiating} onClose={() => setNegotiating(null)} />}
    </div>
  );
}

/** EA-FC-style negotiation over an incoming offer: accept the fee on the table,
 * name a counter and let the buyer's AI decide, or reject. The buyer can counter
 * back a few times before its patience runs out. */
function NegotiateModal({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const respondOffer = useGame((s) => s.respondOffer);
  const viewPlayer = useGame((s) => s.viewPlayer);

  const offer = game.offers.find((o) => o.id === offerId);
  // Seed the ask a notch above their current offer (rounded to £100k).
  const suggested = offer ? Math.round((offer.fee * 1.25) / 100_000) * 100_000 : 0;
  const [ask, setAsk] = useState(suggested);
  const [note, setNote] = useState<string | null>(null);

  if (!offer || offer.status !== "pending") {
    // Resolved (sold / withdrawn) — nothing more to do here.
    return (
      <Modal title="Negotiation" onClose={onClose}>
        <p className="text-sm text-dim">This negotiation has concluded.</p>
        <div className="mt-4 flex justify-end">
          <GoldButton onClick={onClose} className="!py-1.5">Done</GoldButton>
        </div>
      </Modal>
    );
  }

  const p = game.players[offer.playerId];
  const buyer = game.teams[offer.fromClubId];
  const round = offer.negotiationRound ?? 0;

  const doAccept = () => {
    const out = respondOffer(offer.id, "accept");
    setNote(out.message);
    setTimeout(onClose, 900);
  };
  const doReject = () => {
    respondOffer(offer.id, "reject");
    onClose();
  };
  const doCounter = () => {
    const out = respondOffer(offer.id, "counter", ask);
    if (out.kind === "countered") {
      // Buyer raised their offer — surface it and pre-fill the next ask above it.
      setNote(out.message);
      setAsk(Math.round((out.counterFee * 1.12) / 100_000) * 100_000);
    } else if (out.kind === "accepted") {
      setNote(out.message);
      setTimeout(onClose, 1000);
    } else {
      setNote(out.message);
      setTimeout(onClose, 1300);
    }
  };

  return (
    <Modal title={`Negotiate — ${p.name}`} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between text-sm text-dim">
        <span>
          {getArchetype(p.archetypeId).name} · {p.age}y · <Ovr value={p.overall} size="sm" />
        </span>
        <button className="text-xs text-faint hover:text-dim" onClick={() => viewPlayer(p.id)}>
          Full profile →
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between rounded-md border border-line bg-raised px-3 py-2">
        <span className="text-[11px] uppercase tracking-widest text-faint">
          {buyer.name}&apos;s offer on the table
        </span>
        <Money value={offer.fee} className="display font-semibold text-ink" />
      </div>
      <div className="mb-3 flex justify-between text-xs text-faint">
        <span>Market value {formatMoney(p.value)}</span>
        <span>
          Talks: round {round}/{TUNING.negotiationMaxRounds}
        </span>
      </div>

      <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-widest text-faint">
        <span>Your counter (ask)</span>
        <span className="tnum text-dim">{formatMoney(ask)}</span>
      </div>
      <div className="flex gap-2">
        <span className="relative flex flex-1 items-center">
          <span className="pointer-events-none absolute left-3 text-dim">£</span>
          <MoneyInput
            value={ask}
            onChange={(n) => setAsk(Math.max(0, n))}
            min={offer.fee}
            className="w-full rounded-md border border-line bg-raised py-2 pl-7 pr-3 tnum focus:border-gold focus:outline-none"
          />
        </span>
        <GhostButton onClick={doCounter} className="!py-2 whitespace-nowrap">
          Counter
        </GhostButton>
      </div>
      <div className="mt-1.5 text-[11px] text-faint">
        Name your price — they&apos;ll accept if it&apos;s within reach, haggle back, or walk if you push too hard.
      </div>

      {note && (
        <div className="mt-3 rounded-md border border-gold-lo/40 bg-raised p-3 text-sm text-dim">{note}</div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
        <GhostButton onClick={doReject} className="!py-1.5 !border-loss/40 !text-loss">
          Reject
        </GhostButton>
        <GoldButton onClick={doAccept} className="!py-1.5">
          Accept {formatMoney(offer.fee)}
        </GoldButton>
      </div>
    </Modal>
  );
}

function ListedTab() {
  const game = useGame((s) => s.game)!;
  const toggle = useGame((s) => s.toggleTransferList);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const team = game.teams[game.userTeamId];
  const players = team.playerIds.map((id) => game.players[id]).filter(Boolean).sort((a, b) => b.overall - a.overall);
  return (
    <Card>
      {players.map((p) => {
        const listed = game.transferList.includes(p.id);
        return (
          <div key={p.id} className="flex items-center gap-3 border-b border-line/50 px-3 py-2 text-sm last:border-0">
            <PosBadge pos={p.positions[0]} />
            <button onClick={() => viewPlayer(p.id)} className="group min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5 truncate font-medium">
                <Flag nat={p.nationality} size={13} />
                <span className="truncate transition-colors group-hover:text-gold">{p.name}</span>
                <span className="ml-1 text-[11px] text-faint">{p.age}y</span>
              </span>
              <span className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                <ArchetypeIcon archetypeId={p.archetypeId} size={12} />
                <span className="truncate">{getArchetype(p.archetypeId).name}</span>
              </span>
            </button>
            <Money value={p.value} className="text-dim" />
            <Ovr value={p.overall} size="sm" />
            <button
              onClick={() => toggle(p.id)}
              title={listed ? "Remove from the transfer list" : "Put on the transfer list to attract offers"}
              className={`display w-24 rounded px-2 py-1 text-xs font-semibold ${
                listed ? "gold-grad text-black" : "border border-line text-faint hover:text-dim"
              }`}
            >
              {listed ? "LISTED ✓" : "List"}
            </button>
          </div>
        );
      })}
    </Card>
  );
}

function FreeAgentsTab() {
  const game = useGame((s) => s.game)!;
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const agents = Object.values(game.players)
    .filter((p) => !p.retired && !p.clubId)
    .sort((a, b) => b.overall - a.overall);
  return (
    <>
      <Card>
        {agents.map((p) => (
          <PlayerRowButton key={p.id} p={p} onClick={() => setTarget(p)} right={<span className="w-24 text-right text-xs text-win">Free</span>} />
        ))}
        {agents.length === 0 && <div className="p-4 text-sm text-faint">No free agents available.</div>}
      </Card>
      {target && <BidModal p={target} onClose={() => setTarget(null)} />}
    </>
  );
}

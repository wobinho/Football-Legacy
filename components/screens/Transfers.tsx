"use client";

// Transfers (§15.6): search/browse market, incoming offers, listings, window countdown.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import type { PlayerBio, Pos } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { ARCHETYPES, getArchetype } from "@/lib/config/archetypes";
import { TRAITS } from "@/lib/config/traits";
import { POS_ORDER } from "@/lib/config/positions";
import { askPrice, negotiationStateOf } from "@/lib/transfers";
import { seasonGrowth } from "@/lib/development";
import { wageDemandWithClause, maxLengthFor, evaluateOffer } from "@/lib/contracts";
import { transferWindowState, formatDayShort, seasonYearLabel } from "@/lib/calendar";
import { formatMoney } from "@/lib/value";
import { ArchetypeIcon, Card, ConfirmButton, Crest, Flag, GhostButton, GoldButton, Modal, Money, MoneyInput, Ovr, PlayerCard, PlayerGrid, PosBadge, Tabs, usePlayerView, ViewToggle } from "../ui";
import ReleaseClauseField from "./ReleaseClauseField";

type Tab = "search" | "offers" | "listed" | "shortlist" | "free" | "news";

export default function TransfersScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<Tab>("search");
  const pendingCount = game.offers.filter((o) => o.status === "pending" && o.direction === "incoming").length;
  const shortlistCount = (game.shortlist ?? []).length;
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
          { id: "shortlist", label: "Shortlist", badge: shortlistCount },
          { id: "free", label: "Free Agents" },
          { id: "news", label: "Transfer News" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "search" && <SearchTab />}
      {tab === "offers" && <OffersTab />}
      {tab === "listed" && <ListedTab />}
      {tab === "shortlist" && <ShortlistTab />}
      {tab === "free" && <FreeAgentsTab />}
      {tab === "news" && <TransferNewsTab />}
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
      <Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />
      {right}
    </button>
  );
}

/** Grid-view counterpart to PlayerRowButton — the same identity + market info as
 * a card, with `right` (fee / free / listing action) tucked into the actions
 * row. Used by every browse tab so list and grid carry the same data. */
function PlayerCardButton({ p, right, onClick }: { p: PlayerBio; right: React.ReactNode; onClick: () => void }) {
  const game = useGame((s) => s.game)!;
  const club = p.clubId ? game.teams[p.clubId] : null;
  return (
    <PlayerCard
      p={p}
      onOpen={onClick}
      ovr={<Ovr value={p.overall} size="sm" growth={seasonGrowth(p)} />}
      sub={
        <>
          <ArchetypeIcon archetypeId={p.archetypeId} size={12} />
          <span className="truncate">{getArchetype(p.archetypeId).name}</span>
        </>
      }
      stats={
        club ? (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Crest colors={club.colors} short={club.short} size={13} />
            <span className="truncate">{club.name}</span>
          </span>
        ) : (
          <span className="text-win">Free agent</span>
        )
      }
      actions={<span className="flex w-full items-center justify-end gap-2">{right}</span>}
    />
  );
}

function SearchTab() {
  const game = useGame((s) => s.game)!;
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [maxValue, setMaxValue] = useState<number>(0);
  const [archetype, setArchetype] = useState<string>("ALL");
  const [trait, setTrait] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const [view, setView] = usePlayerView("transfers");
  const scouted = useScouted();

  // Archetypes offered in the picker narrow to the selected position, so the
  // list stays relevant — a "Target Man" filter makes no sense under Goalkeeper.
  const archetypeOptions = useMemo(
    () => (pos === "ALL" ? ARCHETYPES : ARCHETYPES.filter((a) => a.positions.includes(pos))),
    [pos]
  );

  const results = useMemo(() => {
    const list = Object.values(game.players).filter(
      (p) =>
        !p.retired &&
        p.clubId &&
        p.clubId !== game.userTeamId &&
        (pos === "ALL" || p.positions.includes(pos)) &&
        (maxValue === 0 || p.value <= maxValue) &&
        (archetype === "ALL" || p.archetypeId === archetype) &&
        (trait === "ALL" || p.traits.includes(trait)) &&
        (query === "" || p.name.toLowerCase().includes(query.toLowerCase()))
    );
    return list.sort((a, b) => b.overall - a.overall).slice(0, 60);
  }, [game.players, game.userTeamId, pos, maxValue, archetype, trait, query]);

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
          onChange={(e) => {
            const next = e.target.value as Pos | "ALL";
            setPos(next);
            // Drop an archetype filter that the new position can't field.
            if (archetype !== "ALL" && next !== "ALL" && !getArchetype(archetype).positions.includes(next)) {
              setArchetype("ALL");
            }
          }}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
        >
          <option value="ALL">All positions</option>
          {POS_ORDER.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={archetype}
          onChange={(e) => setArchetype(e.target.value)}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
          title="Filter by archetype"
        >
          <option value="ALL">All archetypes</option>
          {archetypeOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          value={trait}
          onChange={(e) => setTrait(e.target.value)}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
          title="Filter by trait"
        >
          <option value="ALL">All traits</option>
          {TRAITS.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
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
        <span className="ml-auto">
          <ViewToggle view={view} onChange={setView} />
        </span>
      </div>
      {results.length === 0 ? (
        <Card>
          <div className="p-4 text-sm text-faint">No players match those filters.</div>
        </Card>
      ) : view === "grid" ? (
        <PlayerGrid>
          {results.map((p) => (
            <PlayerCardButton
              key={p.id}
              p={p}
              onClick={() => setTarget(p)}
              right={<Money value={p.value} className="text-dim" />}
            />
          ))}
        </PlayerGrid>
      ) : (
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
        </Card>
      )}
      {target && <BidModal p={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function BidModal({ p, onClose }: { p: PlayerBio; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const bid = useGame((s) => s.bid);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const showToast = useGame((s) => s.showToast);
  // A free agent belongs to nobody, so there is no fee to agree and no selling
  // club to haggle with (v21) — the whole deal is the contract.
  const isFreeAgent = !p.clubId;
  const ask = askPrice(game, p, TUNING);
  const maxYears = maxLengthFor(p, TUNING);
  const [fee, setFee] = useState(isFreeAgent ? 0 : ask);
  const [years, setYears] = useState(Math.min(TUNING.contractRenewYearsDefault, maxYears));
  const [clause, setClause] = useState<number | null>(null);
  const demand = wageDemandWithClause(game, p, clause ?? undefined, TUNING);
  const [wage, setWage] = useState(demand);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [counter, setCounter] = useState<number | null>(null);

  const submit = (amount: number) => {
    const terms = { wage, years, releaseClause: clause ?? undefined };
    // The player has to agree to the contract before the clubs settle the fee —
    // otherwise a signing could complete on terms he'd have refused.
    const verdict = evaluateOffer(game, p, wage, years, TUNING, clause ?? undefined);
    if (verdict.kind !== "accepted") {
      setFeedback(verdict.message);
      setCounter(null);
      if (verdict.kind === "countered") setWage(verdict.wage);
      return;
    }
    const out = bid(p.id, amount, terms);
    if (out.kind === "accepted") {
      showToast(
        isFreeAgent
          ? `${p.name} signs on a free — ${formatMoney(wage)}/wk!`
          : `${p.name} joins for ${formatMoney(amount)} on ${formatMoney(wage)}/wk!`
      );
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
  const overBudget = !isFreeAgent && fee > budget;

  return (
    <Modal title={isFreeAgent ? `Sign ${p.name}` : `Bid for ${p.name}`} onClose={onClose}>
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

      {isFreeAgent ? (
        // No fee field at all — presenting one would imply a negotiation that
        // doesn't exist and invite the user to offer money to nobody.
        <div className="flex items-center gap-3 rounded-md border border-win/40 bg-win/[0.07] px-3 py-2.5">
          <span className="text-lg">✓</span>
          <div className="text-[13px] leading-relaxed text-dim">
            <span className="display font-semibold text-win">No transfer fee.</span> {p.name} is out of contract —
            agree personal terms and he&apos;s yours.
          </div>
        </div>
      ) : (
        <>
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
          </div>
          <div className="mt-2 flex justify-between text-xs text-faint">
            <span>Market value {formatMoney(p.value)}</span>
            <button className="hover:text-dim" onClick={() => setFee(ask)}>
              {p.contract?.releaseClause ? "Release clause" : "Suggested"}: {formatMoney(ask)}
            </button>
          </div>
          {/* A clause on the target's deal is the single most useful fact here:
              it's a fixed price his club cannot refuse. */}
          {p.contract?.releaseClause && (
            <div className="mt-1.5 rounded-md border border-gold-lo/40 bg-gold-lo/[0.08] px-3 py-1.5 text-[11px] text-dim">
              He has a <span className="text-gold">{formatMoney(p.contract.releaseClause)}</span> release clause — meet
              it and {game.teams[p.clubId!].name} have no say.
            </div>
          )}
          {overBudget && (
            <div className="mt-1.5 text-[11px] text-loss">
              This fee is {formatMoney(fee - budget)} over your available budget.
            </div>
          )}
        </>
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

      <ReleaseClauseField
        p={p}
        clause={clause}
        onChange={(next) => {
          setClause(next);
          // The demand moves with the clause, so keep the wage field on the new
          // number unless the user has deliberately typed something else.
          const before = wageDemandWithClause(game, p, clause ?? undefined, TUNING);
          if (wage === before) setWage(wageDemandWithClause(game, p, next ?? undefined, TUNING));
        }}
      />

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

      <div className="mt-4 flex justify-end border-t border-line/60 pt-3">
        <GoldButton onClick={() => submit(fee)}>
          {isFreeAgent ? `SIGN ON ${formatMoney(wage)}/WK` : "BID"}
        </GoldButton>
      </div>
    </Modal>
  );
}

function OffersTab() {
  const game = useGame((s) => s.game)!;
  const respondOffer = useGame((s) => s.respondOffer);
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
            <div className="flex items-center gap-2">
              {/* Turning down a bid outright — two-step, since the buyer walks
                  and the offer can't be recovered. */}
              <ConfirmButton
                label="Reject"
                confirmLabel="Reject?"
                tone="danger"
                onConfirm={() => respondOffer(o.id, "reject")}
                className="!px-3 !py-1.5 !text-xs"
              />
              <GoldButton onClick={() => setNegotiating(o.id)} className="!py-1.5">NEGOTIATE</GoldButton>
            </div>
          </Card>
        );
      })}
      {negotiating && <NegotiateModal offerId={negotiating} onClose={() => setNegotiating(null)} />}
    </div>
  );
}

/**
 * The buyer's patience for one negotiation (v19).
 *
 * Patience is rolled per deal, so this bar is genuinely different every time —
 * a club desperate for the player haggles far longer than a lukewarm one. Each
 * counter spends patience in proportion to how far past the buyer's limit the
 * ask sits, which is why a single greedy demand can empty a bar that three
 * measured ones barely dented.
 */
function PatienceBar({ offerId, buyerName }: { offerId: string; buyerName: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const st = negotiationStateOf(game, offerId, TUNING);
  if (!st) return null;

  const pct = Math.round(st.ratio * 100);
  const tone = st.ratio > 0.6 ? "bg-win" : st.ratio > 0.3 ? "bg-[var(--color-gold)]" : "bg-loss";
  const mood =
    st.ratio > 0.6 ? "Happy to talk" : st.ratio > 0.3 ? "Getting frustrated" : "About to walk away";

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="uppercase tracking-widest text-faint">{buyerName}&apos;s patience</span>
        <span className={st.ratio > 0.3 ? "text-dim" : "text-loss"}>{mood}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${buyerName} patience remaining`}
      >
        <div className={`h-full transition-all duration-300 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-faint">
        Every counter costs patience — asking far more than they can afford costs a great deal more.
      </div>
    </div>
  );
}

/** EA-FC-style negotiation over an incoming offer: accept the fee on the table,
 * name a counter and let the buyer's AI decide, or reject. The buyer can counter
 * back until its (per-deal, dynamic) patience runs out. */
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
      // The buyer came back with what it CAN do. Pre-fill the next ask only
      // slightly above that — their reply is close to their real limit, so a
      // small nudge is the move that might still land, and the user can always
      // type something bolder if they want to gamble the patience.
      setNote(out.message);
      setAsk(Math.round((out.counterFee * 1.06) / 100_000) * 100_000);
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
        <span>Talks: round {round}</span>
      </div>

      {/* Buyer patience (v19) — every deal has its own, so the bar tells the user
          how much room THIS negotiation has left rather than counting rounds
          against a fixed limit. An unreasonable ask drains it far faster than a
          measured one. */}
      <PatienceBar offerId={offerId} buyerName={buyer.name} />

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
  const [view, setView] = usePlayerView("transfers");
  const team = game.teams[game.userTeamId];
  const players = team.playerIds.map((id) => game.players[id]).filter(Boolean).sort((a, b) => b.overall - a.overall);

  const listBtn = (p: PlayerBio) => {
    const listed = game.transferList.includes(p.id);
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggle(p.id);
        }}
        title={listed ? "Remove from the transfer list" : "Put on the transfer list to attract offers"}
        className={`display w-24 rounded px-2 py-1 text-xs font-semibold ${
          listed ? "gold-grad text-black" : "border border-line text-faint hover:text-dim"
        }`}
      >
        {listed ? "LISTED ✓" : "List"}
      </button>
    );
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === "grid" ? (
        <PlayerGrid>
          {players.map((p) => (
            <PlayerCard
              key={p.id}
              p={p}
              onOpen={() => viewPlayer(p.id)}
              ovr={<Ovr value={p.overall} size="sm" />}
              sub={
                <>
                  <ArchetypeIcon archetypeId={p.archetypeId} size={12} />
                  <span className="truncate">{getArchetype(p.archetypeId).name}</span>
                </>
              }
              stats={<Money value={p.value} className="text-dim" />}
              actions={<span className="flex w-full justify-end">{listBtn(p)}</span>}
            />
          ))}
        </PlayerGrid>
      ) : (
        <Card>
          {players.map((p) => (
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
              {listBtn(p)}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function ShortlistTab() {
  const game = useGame((s) => s.game)!;
  const toggle = useGame((s) => s.toggleShortlist);
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const [view, setView] = usePlayerView("transfers");
  // The shortlist stores ids; resolve to live players and drop anyone who's since
  // retired or signed for the user (they no longer belong on a targets list).
  const players = (game.shortlist ?? [])
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired && p.clubId !== game.userTeamId)
    .sort((a, b) => b.overall - a.overall);

  if (!players.length) {
    return (
      <div className="pt-8 text-center text-sm text-faint">
        Your shortlist is empty. Open any player&apos;s card and use{" "}
        <span className="text-dim">Add to Shortlist</span> to track him here.
      </div>
    );
  }

  const right = (p: PlayerBio) => (
    <div className="flex items-center gap-2">
      <span className="w-20 text-right">
        {p.clubId ? <Money value={p.value} className="text-dim" /> : <span className="text-xs text-win">Free</span>}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggle(p.id);
        }}
        title="Remove from shortlist"
        className="rounded px-2 py-1 text-xs text-faint hover:text-loss"
      >
        ✕
      </button>
    </div>
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === "grid" ? (
        <PlayerGrid>
          {players.map((p) => (
            <PlayerCardButton key={p.id} p={p} onClick={() => setTarget(p)} right={right(p)} />
          ))}
        </PlayerGrid>
      ) : (
        <Card>
          {players.map((p) => (
            <PlayerRowButton key={p.id} p={p} onClick={() => setTarget(p)} right={right(p)} />
          ))}
        </Card>
      )}
      {target && <BidModal p={target} onClose={() => setTarget(null)} />}
    </>
  );
}

function FreeAgentsTab() {
  const game = useGame((s) => s.game)!;
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const [view, setView] = usePlayerView("transfers");
  const agents = Object.values(game.players)
    .filter((p) => !p.retired && !p.clubId)
    .sort((a, b) => b.overall - a.overall);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>
      {agents.length === 0 ? (
        <Card>
          <div className="p-4 text-sm text-faint">No free agents available.</div>
        </Card>
      ) : view === "grid" ? (
        <PlayerGrid>
          {agents.map((p) => (
            <PlayerCardButton key={p.id} p={p} onClick={() => setTarget(p)} right={<span className="text-xs text-win">Free</span>} />
          ))}
        </PlayerGrid>
      ) : (
        <Card>
          {agents.map((p) => (
            <PlayerRowButton key={p.id} p={p} onClick={() => setTarget(p)} right={<span className="w-24 text-right text-xs text-win">Free</span>} />
          ))}
        </Card>
      )}
      {target && <BidModal p={target} onClose={() => setTarget(null)} />}
    </>
  );
}

// ── Transfer News (v22) ────────────────────────────────────────────────────
// The world's market wire: every senior deal between clubs as it completes,
// newest first. Read-only — this is the story of the window, not another place
// to trade. Rows read left-to-right as the move itself (selling club → player →
// buying club), the fee is the scoreboard hero on the right, and a kind badge
// flags anything that isn't a straight cash transfer (free, release clause,
// loan). The user's own business is tinted gold so it stands out of the flow.

type NewsFilter = "all" | "mine";

/** Visual treatment per deal kind — a compact badge in the game's accent
 * vocabulary. A plain cash transfer carries no badge (the fee says it all). */
const NEWS_KIND: Record<string, { label: string; cls: string } | null> = {
  transfer: null,
  free: { label: "FREE", cls: "border-win/40 text-win" },
  release: { label: "RELEASED", cls: "border-loss/40 text-loss" },
  clause: { label: "CLAUSE", cls: "border-gold-lo/50 text-gold" },
  loan: { label: "LOAN", cls: "border-[#4a7bd0]/50 text-[#8fb4ee]" },
};

function TransferNewsTab() {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [filter, setFilter] = useState<NewsFilter>("all");

  const feed = game.transferNews ?? [];
  const rows = useMemo(
    () => (filter === "mine" ? feed.filter((n) => n.involvesUser) : feed),
    [feed, filter]
  );

  // Group by the season the deal happened in, so a long save reads as chapters
  // rather than one endless column. Newest season first (the feed is already
  // newest-first, so first-seen order preserves that).
  const groups = useMemo(() => {
    const bySeason = new Map<number, typeof rows>();
    for (const n of rows) {
      const list = bySeason.get(n.season);
      if (list) list.push(n);
      else bySeason.set(n.season, [n]);
    }
    return Array.from(bySeason.entries());
  }, [rows]);

  const mineCount = useMemo(() => feed.filter((n) => n.involvesUser).length, [feed]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="display text-sm font-semibold">Market Wire</div>
          <div className="text-[11px] text-faint">
            {feed.length} deal{feed.length === 1 ? "" : "s"} across the world · newest first
          </div>
        </div>
        <div className="flex overflow-hidden rounded-md border border-line">
          {(["all", "mine"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`display px-3 py-1 text-[11px] font-semibold transition-colors ${
                filter === f ? "gold-grad text-black" : "text-faint hover:text-dim"
              }`}
            >
              {f === "all" ? "ALL CLUBS" : `MY CLUB${mineCount ? ` (${mineCount})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-faint">
          <div className="display mb-2 text-lg text-dim">THE WIRE IS QUIET</div>
          {filter === "mine"
            ? "None of your own deals yet. Buy or sell a player and it lands here."
            : "No transfers have gone through yet. Deals appear here the moment a window opens and clubs start doing business."}
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([season, items]) => (
            <div key={season}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="display text-[11px] uppercase tracking-widest text-faint">
                  {seasonYearLabel(season)} season
                </span>
                <span className="gold-thread h-px flex-1" />
                <span className="text-[10px] tnum text-faint">{items.length}</span>
              </div>
              <Card className="divide-y divide-line/50">
                {items.map((n) => (
                  <TransferNewsRow key={n.id} n={n} onView={() => n.playerId && viewPlayer(n.playerId)} />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One deal on the wire: selling club → player → buying club, fee on the right. */
function TransferNewsRow({
  n,
  onView,
}: {
  n: NonNullable<GameStateTransferNews>[number];
  onView: () => void;
}) {
  const game = useGame((s) => s.game)!;
  const from = n.fromClubId ? game.teams[n.fromClubId] : null;
  const to = n.toClubId ? game.teams[n.toClubId] : null;
  const badge = NEWS_KIND[n.kind];
  // The player may still be in the world (clickable through to his card) or long
  // gone from a pruned long save — fall back to the denormalised name either way.
  const playerLive = !!game.players[n.playerId];

  const clubChip = (club: typeof from, fallback: string, align: "left" | "right") => (
    <span className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {club ? <Crest colors={club.colors} short={club.short} size={18} /> : <span className="text-faint">—</span>}
      <span className="truncate text-[12px] text-dim">{club?.name ?? fallback}</span>
    </span>
  );

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 ${n.involvesUser ? "bg-hover/40" : ""}`}>
      {/* Player + move direction — the sentence of the deal. */}
      <div className="flex min-w-0 flex-1 basis-[15rem] items-center gap-2">
        <button
          onClick={onView}
          disabled={!playerLive}
          className={`display shrink-0 text-sm font-semibold ${playerLive ? "hover:text-gold" : "text-dim"} ${
            n.involvesUser ? "gold-text" : ""
          }`}
          title={playerLive ? "View player" : undefined}
        >
          {n.playerName}
        </button>
        {badge && (
          <span className={`display shrink-0 rounded-sm border px-1 py-0.5 text-[8px] font-bold ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-2">
        {clubChip(from, n.fromName, "right")}
        <span className="shrink-0 text-faint" aria-hidden>
          →
        </span>
        {clubChip(to, n.toName, "left")}
      </div>

      {/* Fee — the scoreboard hero. A free move reads "Free" in win green. */}
      <div className="ml-auto shrink-0 text-right">
        {n.fee > 0 ? (
          <span className="display tnum text-sm font-bold">{formatMoney(n.fee)}</span>
        ) : (
          <span className="display text-xs font-semibold text-win">{n.kind === "release" ? "Released" : "Free"}</span>
        )}
        <div className="text-[10px] tnum text-faint">{formatDayShort(n.day)}</div>
      </div>
    </div>
  );
}

/** Helper alias so the row can type its item without importing the array type. */
type GameStateTransferNews = import("@/lib/types").GameState["transferNews"];

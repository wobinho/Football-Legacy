"use client";

// Transfers (§15.6): search/browse market, incoming offers, listings, window countdown.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { matchesPlayerName } from "@/lib/search";
import { ArchetypeIcon, Card, ConfirmButton, CountryFlag, Crest, displayFullName, Flag, GhostButton, GoldButton, Modal, Money, MoneyInput, Ovr, PlayerCard, PlayerGrid, PosBadge, Tabs, usePlayerView, ViewToggle } from "../ui";
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
          {/* Transfers is the scouting screen — the full name is the identity
              the user is deciding on, so it wins over the list abbreviation. */}
          <span className="truncate">{displayFullName(p)}</span>
          <span className="ml-1 shrink-0 text-[11px] text-faint">{p.age}y</span>
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
      fullName
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
  // Where a player plays and where he's from (v1.5) — the three questions a
  // scout actually asks of a market this size. League and Club cascade: pick a
  // league and the club picker narrows to that league's sides.
  const [leagueId, setLeagueId] = useState<string>("ALL");
  const [clubId, setClubId] = useState<string>("ALL");
  const [nat, setNat] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const [signed, setSigned] = useState<SignedDeal | null>(null);
  const [view, setView] = usePlayerView("transfers");
  const scouted = useScouted();

  // Archetypes offered in the picker narrow to the selected position, so the
  // list stays relevant — a "Target Man" filter makes no sense under Goalkeeper.
  const archetypeOptions = useMemo(
    () => (pos === "ALL" ? ARCHETYPES : ARCHETYPES.filter((a) => a.positions.includes(pos))),
    [pos]
  );

  // Leagues, in ladder order first (the user's own pyramid is what they browse
  // most) then the rest of the world alphabetically by country + tier.
  const leagueOptions = useMemo(() => {
    const ladder = (game.divisionIds ?? []).filter((id) => game.leagues[id]);
    const rest = Object.values(game.leagues)
      .filter((l) => !ladder.includes(l.id))
      .sort((a, b) => a.country.localeCompare(b.country) || a.tier - b.tier);
    return [...ladder.map((id) => game.leagues[id]), ...rest];
  }, [game.leagues, game.divisionIds]);

  // Clubs the user can actually buy from — never their own squad — narrowed to
  // the selected league when there is one.
  const clubOptions = useMemo(
    () =>
      Object.values(game.teams)
        .filter((t) => t.id !== game.userTeamId && (leagueId === "ALL" || t.leagueId === leagueId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [game.teams, game.userTeamId, leagueId]
  );

  // Nationalities present in the market, so the picker only ever offers codes
  // that can return a result. Counted over the same pool the search runs on.
  const natOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const p of Object.values(game.players)) {
      if (!p.retired && p.clubId && p.clubId !== game.userTeamId) seen.add(p.nationality);
    }
    return Array.from(seen).sort();
  }, [game.players, game.userTeamId]);

  const results = useMemo(() => {
    const list = Object.values(game.players).filter((p) => {
      if (p.retired || !p.clubId || p.clubId === game.userTeamId) return false;
      if (pos !== "ALL" && !p.positions.includes(pos)) return false;
      if (maxValue !== 0 && p.value > maxValue) return false;
      if (archetype !== "ALL" && p.archetypeId !== archetype) return false;
      if (trait !== "ALL" && !p.traits.includes(trait)) return false;
      if (clubId !== "ALL" && p.clubId !== clubId) return false;
      if (leagueId !== "ALL" && game.teams[p.clubId]?.leagueId !== leagueId) return false;
      if (nat !== "ALL" && p.nationality !== nat) return false;
      // Accent- and form-insensitive (v1.5): "Doue" finds "Doué", and the
      // query is tested against the full name as well as the abbreviated one,
      // so a first name the list never renders is still searchable.
      return matchesPlayerName(p, query);
    });
    return list.sort((a, b) => b.overall - a.overall).slice(0, 60);
  }, [game.players, game.teams, game.userTeamId, pos, maxValue, archetype, trait, clubId, leagueId, nat, query]);

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
        <select
          value={leagueId}
          onChange={(e) => {
            const next = e.target.value;
            setLeagueId(next);
            // Drop a club filter the new league doesn't contain, so the two
            // pickers can never contradict each other into an empty result.
            if (clubId !== "ALL" && next !== "ALL" && game.teams[clubId]?.leagueId !== next) {
              setClubId("ALL");
            }
          }}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
          title="Filter by league"
        >
          <option value="ALL">All leagues</option>
          {leagueOptions.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select
          value={clubId}
          onChange={(e) => setClubId(e.target.value)}
          className="max-w-[11rem] rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
          title="Filter by club"
        >
          <option value="ALL">All clubs</option>
          {clubOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          value={nat}
          onChange={(e) => setNat(e.target.value)}
          className="rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-dim focus:border-gold focus:outline-none"
          title="Filter by nationality"
        >
          <option value="ALL">All nationalities</option>
          {natOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
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
      {target && <BidModal p={target} onClose={() => setTarget(null)} onSigned={setSigned} />}
      {signed && <SigningModal deal={signed} onClose={() => setSigned(null)} />}
    </div>
  );
}

// ── Signing announcement (v1.5) ─────────────────────────────────────────────
// A completed signing is the biggest moment on this screen, and a toast that
// fades in three seconds is the wrong shape for it. This is the unveiling: the
// player presented in club colours with the deal that got him, held on screen
// until the user dismisses it.

/** Everything the announcement needs, snapshotted at the moment the deal closes
 * — the transfer has already moved the player, so his selling club can only be
 * read from before the bid, never from live state afterwards. */
type SignedDeal = {
  playerId: string;
  name: string;
  nationality: string;
  pos: Pos;
  age: number;
  overall: number;
  archetypeId: string;
  /** The club he came from, or null on a free transfer. */
  fromClubId: string | null;
  fromName: string;
  fee: number;
  wage: number;
  years: number;
  releaseClause?: number;
};

function SigningModal({ deal, onClose }: { deal: SignedDeal; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const viewPlayer = useGame((s) => s.viewPlayer);
  const club = game.teams[game.userTeamId];
  const from = deal.fromClubId ? game.teams[deal.fromClubId] : null;
  const free = deal.fee <= 0;

  return (
    <Modal title="Signing confirmed" onClose={onClose}>
      {/* The unveiling — the new man in his new club's colours. */}
      <div className="rounded-lg border border-gold-lo/40 bg-gradient-to-br from-gold-lo/[0.14] to-transparent px-4 py-4 text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <Crest colors={club.colors} short={club.short} size={30} />
          <span className="display text-[11px] uppercase tracking-widest text-faint">{club.name}</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Flag nat={deal.nationality} size={16} />
          <span className="display text-xl font-bold gold-text">{deal.name}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-2 text-[12px] text-dim">
          <PosBadge pos={deal.pos} />
          <span>{getArchetype(deal.archetypeId).name}</span>
          <span className="text-faint">·</span>
          <span className="tnum">{deal.age}y</span>
          <Ovr value={deal.overall} size="sm" />
        </div>
        {/* Where he came from — the move itself, read left to right. */}
        <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-faint">
          {from ? (
            <span className="flex items-center gap-1.5">
              <Crest colors={from.colors} short={from.short} size={16} />
              <span className="truncate text-dim">{from.name}</span>
            </span>
          ) : (
            <span className="text-win">{deal.fromName}</span>
          )}
          <span aria-hidden>→</span>
          <span className="flex items-center gap-1.5">
            <Crest colors={club.colors} short={club.short} size={16} />
            <span className="truncate text-dim">{club.name}</span>
          </span>
        </div>
      </div>

      {/* The terms of the deal, laid out as the three numbers that define it. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-md border border-line bg-raised px-3 py-2 text-center">
          <div className="text-[10px] uppercase tracking-widest text-faint">Fee</div>
          {free ? (
            <div className="display mt-0.5 text-sm font-bold text-win">Free</div>
          ) : (
            <Money value={deal.fee} className="display mt-0.5 text-sm font-bold text-ink" />
          )}
        </div>
        <div className="rounded-md border border-line bg-raised px-3 py-2 text-center">
          <div className="text-[10px] uppercase tracking-widest text-faint">Wage</div>
          <div className="display mt-0.5 text-sm font-bold tnum text-ink">{formatMoney(deal.wage)}<span className="text-[10px] font-normal text-faint">/wk</span></div>
        </div>
        <div className="rounded-md border border-line bg-raised px-3 py-2 text-center">
          <div className="text-[10px] uppercase tracking-widest text-faint">Contract</div>
          <div className="display mt-0.5 text-sm font-bold tnum text-ink">
            {deal.years} <span className="text-[10px] font-normal text-faint">yr{deal.years > 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
      {deal.releaseClause ? (
        <div className="mt-2 rounded-md border border-gold-lo/40 bg-gold-lo/[0.08] px-3 py-1.5 text-center text-[11px] text-dim">
          Release clause agreed at <span className="text-gold">{formatMoney(deal.releaseClause)}</span>.
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
        <button
          className="text-xs text-faint hover:text-dim"
          onClick={() => {
            onClose();
            viewPlayer(deal.playerId);
          }}
        >
          View his profile →
        </button>
        <GoldButton onClick={onClose}>DONE</GoldButton>
      </div>
    </Modal>
  );
}

function BidModal({ p, onClose, onSigned }: { p: PlayerBio; onClose: () => void; onSigned: (d: SignedDeal) => void }) {
  const game = useGame((s) => s.game)!;
  const bid = useGame((s) => s.bid);
  const viewPlayer = useGame((s) => s.viewPlayer);
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
  // The last response from the far side: a wage rejection/counter from the
  // player's camp, or a fee rejection/counter from the selling club. Rendered
  // as a status ribbon so it reads as a reply to the offer, not a bare error.
  const [reply, setReply] = useState<
    | { kind: "wage"; tone: "loss" | "gold"; text: string }
    | { kind: "fee-counter"; counterFee: number }
    | { kind: "fee-reject"; text: string }
    | null
  >(null);

  const submit = (amount: number) => {
    const terms = { wage, years, releaseClause: clause ?? undefined };
    // The player has to agree to the contract before the clubs settle the fee —
    // otherwise a signing could complete on terms he'd have refused.
    const verdict = evaluateOffer(game, p, wage, years, TUNING, clause ?? undefined);
    if (verdict.kind !== "accepted") {
      setReply({ kind: "wage", tone: verdict.kind === "countered" ? "gold" : "loss", text: verdict.message });
      if (verdict.kind === "countered") setWage(verdict.wage);
      return;
    }
    // Snapshot the selling club BEFORE the bid — a completed transfer moves the
    // player, so afterwards `p.clubId` is the user's own side.
    const fromClubId = p.clubId ?? null;
    const fromName = fromClubId ? game.teams[fromClubId]?.name ?? "—" : "Free agent";
    const out = bid(p.id, amount, terms);
    if (out.kind === "accepted") {
      // The signing gets its own announcement (v1.5) rather than a toast that
      // fades before the user has read it.
      onClose();
      onSigned({
        playerId: p.id,
        name: displayFullName(p),
        nationality: p.nationality,
        pos: p.positions[0],
        age: p.age,
        overall: p.overall,
        archetypeId: p.archetypeId,
        fromClubId: isFreeAgent ? null : fromClubId,
        fromName,
        fee: isFreeAgent ? 0 : amount,
        wage,
        years,
        releaseClause: clause ?? undefined,
      });
    } else if (out.kind === "countered") {
      setReply({ kind: "fee-counter", counterFee: out.counterFee });
    } else {
      setReply({ kind: "fee-reject", text: out.reason });
    }
  };

  const budget = game.teams[game.userTeamId].budget;
  const overBudget = !isFreeAgent && fee > budget;

  return (
    <Modal title={isFreeAgent ? `Sign ${displayFullName(p)}` : `Bid for ${displayFullName(p)}`} onClose={onClose}>
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
            <span className="display font-semibold text-win">No transfer fee.</span> {displayFullName(p)} is out of contract —
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
            <button className="text-gold hover:text-gold-hi" onClick={() => setFee(ask)}>
              {p.contract?.releaseClause ? "Release clause" : "Suggested"}: {formatMoney(ask)}
            </button>
          </div>
          {/* Quick moves against the two figures that matter — his valuation and
              the club's asking price — so the common bids are one tap. */}
          {!p.contract?.releaseClause && (
            <FeeChips
              base={ask}
              value={fee}
              onSet={setFee}
              refs={[
                { label: "Value", amount: p.value },
                { label: "Ask", amount: ask },
              ]}
            />
          )}
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

      {/* The far side's reply, rendered as a status ribbon that reads as an
          answer to the offer. A fee counter surfaces the club's number with a
          one-tap "Meet it" so accepting their figure is frictionless. */}
      {reply?.kind === "fee-counter" && (
        <div className="mt-3 rounded-md border border-gold-lo/40 bg-gold-lo/[0.08] p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-faint">
            <Crest colors={game.teams[p.clubId!].colors} short={game.teams[p.clubId!].short} size={16} />
            {game.teams[p.clubId!].name} counter
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[13px] text-dim">
              They&apos;ll sell for <Money value={reply.counterFee} className="display font-bold text-gold" />
            </span>
            <GoldButton className="!py-1 text-xs" onClick={() => { setFee(reply.counterFee); submit(reply.counterFee); }}>
              MEET IT
            </GoldButton>
          </div>
        </div>
      )}
      {reply?.kind === "fee-reject" && (
        <div className="mt-3 rounded-md border border-loss/40 bg-loss/[0.07] p-3 text-[13px] text-dim">
          {reply.text}
        </div>
      )}
      {reply?.kind === "wage" && (
        <div
          className={`mt-3 rounded-md border p-3 text-[13px] text-dim ${
            reply.tone === "gold" ? "border-gold-lo/40 bg-gold-lo/[0.08]" : "border-loss/40 bg-loss/[0.07]"
          }`}
        >
          {reply.text}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
        <span className="text-[11px] text-faint">
          {isFreeAgent ? (
            <>Total outlay <span className="tnum text-dim">{formatMoney(wage)}/wk</span></>
          ) : (
            <>
              {formatMoney(fee)} fee · <span className="tnum">{formatMoney(wage)}/wk</span>
            </>
          )}
        </span>
        <GoldButton onClick={() => submit(fee)} disabled={overBudget}>
          {isFreeAgent ? `SIGN ON ${formatMoney(wage)}/WK` : "SUBMIT BID"}
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
                {buyer.name} → <span className="gold-text">{formatMoney(o.fee)}</span> for {displayFullName(p)}
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
    <div>
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
    </div>
  );
}

// ── Negotiation transcript (v1.44) ──────────────────────────────────────────
// A running chat-style log of a back-and-forth so the user can see the whole
// conversation, not just the last line. Each line is one party's move; the
// club's replies sit left, the user's on the right, mirroring how a messaging
// thread reads. Outcome lines (deal done / walked away) span the width.

type ChatLine =
  | { who: "club"; text: string; fee?: number }
  | { who: "you"; text: string; fee?: number }
  | { who: "outcome"; text: string; tone: "win" | "loss" };

function ChatBubble({ line, clubName }: { line: ChatLine; clubName: string }) {
  if (line.who === "outcome") {
    const cls =
      line.tone === "win"
        ? "border-win/40 bg-win/[0.07] text-win"
        : "border-loss/40 bg-loss/[0.07] text-loss";
    return (
      <div className={`display rounded-md border px-3 py-2 text-center text-[13px] font-semibold ${cls}`}>
        {line.text}
      </div>
    );
  }
  const you = line.who === "you";
  return (
    <div className={`flex flex-col ${you ? "items-end" : "items-start"}`}>
      <span className="mb-0.5 px-1 text-[9px] uppercase tracking-widest text-faint">
        {you ? "You" : clubName}
      </span>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-snug ${
          you
            ? "gold-grad rounded-br-sm text-black"
            : "rounded-bl-sm border border-line bg-raised text-dim"
        }`}
      >
        {line.text}
        {line.fee !== undefined && (
          <span className={`display ml-1.5 font-bold tnum ${you ? "text-black" : "text-ink"}`}>
            {formatMoney(line.fee)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Quick-adjust chips for a fee field — nudge by a fraction or snap to a
 * reference figure, so the common moves are one tap. */
function FeeChips({
  base,
  value,
  onSet,
  refs,
}: {
  base: number;
  value: number;
  onSet: (n: number) => void;
  refs: { label: string; amount: number }[];
}) {
  const round = (n: number) => Math.max(0, Math.round(n / 100_000) * 100_000);
  const nudges = [
    { label: "−£1M", amount: value - 1_000_000 },
    { label: "+£1M", amount: value + 1_000_000 },
    { label: "+10%", amount: base * 1.1 },
    { label: "+25%", amount: base * 1.25 },
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button
          key={r.label}
          onClick={() => onSet(round(r.amount))}
          className="rounded border border-gold-lo/40 bg-gold-lo/[0.08] px-2 py-1 text-[11px] text-gold transition-colors hover:bg-gold-lo/20"
        >
          {r.label}
        </button>
      ))}
      {nudges.map((n) => (
        <button
          key={n.label}
          onClick={() => onSet(round(n.amount))}
          className="rounded border border-line px-2 py-1 text-[11px] text-dim transition-colors hover:border-gold hover:text-ink"
        >
          {n.label}
        </button>
      ))}
    </div>
  );
}

/** EA-FC-style negotiation over an incoming offer: accept the fee on the table,
 * name a counter and let the buyer's AI decide, or reject. The buyer can counter
 * back until its (per-deal, dynamic) patience runs out. The whole exchange is
 * shown as a running transcript so the haggling reads as a conversation. */
function NegotiateModal({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const respondOffer = useGame((s) => s.respondOffer);
  const viewPlayer = useGame((s) => s.viewPlayer);

  const offer = game.offers.find((o) => o.id === offerId);
  // Seed the ask a notch above their current offer (rounded to £100k).
  const suggested = offer ? Math.round((offer.fee * 1.25) / 100_000) * 100_000 : 0;
  const [ask, setAsk] = useState(suggested);
  // The conversation so far — opens with the buyer's bid on the table.
  const [chat, setChat] = useState<ChatLine[]>(() =>
    offer
      ? [{ who: "club", text: "We'd like to make an offer of", fee: offer.fee }]
      : []
  );
  const [done, setDone] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length]);

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
  const overValue = offer.fee - p.value;

  const push = (line: ChatLine) => setChat((c) => [...c, line]);

  const doAccept = () => {
    const feeNow = offer.fee;
    push({ who: "you", text: "We accept your offer of", fee: feeNow });
    const out = respondOffer(offer.id, "accept");
    push({ who: "outcome", text: out.message, tone: "win" });
    setDone(true);
    setTimeout(onClose, 1400);
  };
  const doReject = () => {
    push({ who: "you", text: "Thanks, but he's not for sale at that price." });
    respondOffer(offer.id, "reject");
    push({ who: "outcome", text: `Talks with ${buyer.name} ended.`, tone: "loss" });
    setDone(true);
    setTimeout(onClose, 1100);
  };
  const doCounter = () => {
    if (ask <= offer.fee) return;
    push({ who: "you", text: "We'd want", fee: ask });
    const out = respondOffer(offer.id, "counter", ask);
    if (out.kind === "countered") {
      // The buyer came back with what it CAN do. Pre-fill the next ask only
      // slightly above that — their reply is close to their real limit, so a
      // small nudge is the move that might still land, and the user can always
      // type something bolder if they want to gamble the patience.
      push({ who: "club", text: "We can't reach that, but we'll go to", fee: out.counterFee });
      setAsk(Math.round((out.counterFee * 1.06) / 100_000) * 100_000);
    } else if (out.kind === "accepted") {
      push({ who: "club", text: "Agreed. He's yours for", fee: out.fee });
      push({ who: "outcome", text: out.message, tone: "win" });
      setDone(true);
      setTimeout(onClose, 1400);
    } else {
      push({ who: "outcome", text: out.message, tone: "loss" });
      setDone(true);
      setTimeout(onClose, 1600);
    }
  };

  return (
    <Modal title={`Negotiate — ${displayFullName(p)}`} onClose={onClose}>
      {/* Player identity header */}
      <button
        onClick={() => viewPlayer(p.id)}
        className="group mb-3 flex w-full items-center gap-3 rounded-md border border-line bg-raised px-3 py-2.5 text-left transition-colors hover:border-gold-lo/50"
      >
        <PosBadge pos={p.positions[0]} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate font-semibold transition-colors group-hover:text-gold">
            <Flag nat={p.nationality} size={13} />
            <span className="truncate">{displayFullName(p)}</span>
          </div>
          <div className="truncate text-[11px] text-faint">
            {getArchetype(p.archetypeId).name} · {p.age}y
          </div>
        </div>
        <div className="text-right">
          <Ovr value={p.overall} size="sm" />
          <div className="mt-0.5 text-[10px] text-faint">Full profile →</div>
        </div>
      </button>

      {/* Key figures: the live offer vs. what he's worth. */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-gold-lo/40 bg-gold-lo/[0.06] px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-faint">On the table</div>
          <Money value={offer.fee} className="display text-lg font-bold text-gold" />
        </div>
        <div className="rounded-md border border-line bg-raised px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-faint">Market value</div>
          <div className="flex items-baseline gap-1.5">
            <Money value={p.value} className="display text-lg font-bold text-ink" />
            {Math.abs(overValue) >= 100_000 && (
              <span className={`text-[10px] tnum ${overValue > 0 ? "text-win" : "text-loss"}`}>
                {overValue > 0 ? "+" : ""}
                {formatMoney(overValue)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Buyer patience (v19) — every deal has its own, so the bar tells the user
          how much room THIS negotiation has left. An unreasonable ask drains it
          far faster than a measured one. */}
      <div className="mb-3">
        <PatienceBar offerId={offerId} buyerName={buyer.name} />
      </div>

      {/* The conversation so far. */}
      <div className="mb-3 max-h-56 space-y-2 overflow-y-auto rounded-md border border-line/60 bg-surface/60 p-3">
        {chat.map((line, i) => (
          <ChatBubble key={i} line={line} clubName={buyer.name} />
        ))}
        <div ref={chatEndRef} />
      </div>

      {!done && (
        <>
          <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-widest text-faint">
            <span>Your counter-offer</span>
            <span className="tnum text-dim">Round {round + 1}</span>
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
            <GhostButton
              onClick={doCounter}
              disabled={ask <= offer.fee}
              className="!py-2 whitespace-nowrap"
            >
              Send counter
            </GhostButton>
          </div>
          <FeeChips
            base={p.value}
            value={ask}
            onSet={setAsk}
            refs={[
              { label: "Value", amount: p.value },
              { label: "+15%", amount: p.value * 1.15 },
            ]}
          />
          {ask <= offer.fee && (
            <div className="mt-1.5 text-[11px] text-faint">
              Ask above the current offer to counter — or simply accept what&apos;s on the table.
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3">
            <GhostButton onClick={doReject} className="!py-1.5 !border-loss/40 !text-loss">
              Reject
            </GhostButton>
            <GoldButton onClick={doAccept} className="!py-1.5">
              Accept {formatMoney(offer.fee)}
            </GoldButton>
          </div>
        </>
      )}
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
              fullName
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
                  <span className="truncate transition-colors group-hover:text-gold">{displayFullName(p)}</span>
                  <span className="ml-1 shrink-0 text-[11px] text-faint">{p.age}y</span>
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
  const [signed, setSigned] = useState<SignedDeal | null>(null);
  const [view, setView] = usePlayerView("transfers");
  // The shortlist stores ids; resolve to live players and drop anyone who's since
  // retired or signed for the user (they no longer belong on a targets list).
  const players = (game.shortlist ?? [])
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired && p.clubId !== game.userTeamId)
    .sort((a, b) => b.overall - a.overall);

  if (!players.length) {
    // Signing the last man on the list empties it — the announcement still has
    // to render, so it hangs off the empty state too.
    return (
      <>
        <div className="pt-8 text-center text-sm text-faint">
          Your shortlist is empty. Open any player&apos;s card and use{" "}
          <span className="text-dim">Add to Shortlist</span> to track him here.
        </div>
        {signed && <SigningModal deal={signed} onClose={() => setSigned(null)} />}
      </>
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
      {target && <BidModal p={target} onClose={() => setTarget(null)} onSigned={setSigned} />}
      {signed && <SigningModal deal={signed} onClose={() => setSigned(null)} />}
    </>
  );
}

function FreeAgentsTab() {
  const game = useGame((s) => s.game)!;
  const [target, setTarget] = useState<PlayerBio | null>(null);
  const [signed, setSigned] = useState<SignedDeal | null>(null);
  const [view, setView] = usePlayerView("transfers");
  // The free-agent pool grows all season as clubs release players, so it needs
  // the same name search the market does (v1.5) — accent-insensitive, and over
  // the full name as well as the short one.
  const [query, setQuery] = useState("");
  const agents = useMemo(
    () =>
      Object.values(game.players)
        .filter((p) => !p.retired && !p.clubId && matchesPlayerName(p, query))
        .sort((a, b) => b.overall - a.overall),
    [game.players, query]
  );
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search free agents…"
          className="w-48 rounded-md border border-line bg-raised px-3 py-1.5 text-sm placeholder:text-faint focus:border-gold focus:outline-none"
        />
        <span className="ml-auto">
          <ViewToggle view={view} onChange={setView} />
        </span>
      </div>
      {agents.length === 0 ? (
        <Card>
          <div className="p-4 text-sm text-faint">
            {query.trim() ? "No free agents match that search." : "No free agents available."}
          </div>
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
      {target && <BidModal p={target} onClose={() => setTarget(null)} onSigned={setSigned} />}
      {signed && <SigningModal deal={signed} onClose={() => setSigned(null)} />}
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

type NewsFilter = "all" | "league" | "mine";

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

  // The league the user manages, and a tester for whether a deal touched it: a
  // move is "in your league" when either club currently sits in that league.
  // Look-up is live (news items don't store leagueId), so a deal survives here
  // only while both clubs are still in the world — fine, since the league view
  // is about the current-season market around the user.
  const userLeagueId = game.teams[game.userTeamId]?.leagueId;
  const inUserLeague = useMemo(() => {
    const tester = (n: (typeof feed)[number]) => {
      const fromL = n.fromClubId ? game.teams[n.fromClubId]?.leagueId : undefined;
      const toL = n.toClubId ? game.teams[n.toClubId]?.leagueId : undefined;
      return fromL === userLeagueId || toL === userLeagueId;
    };
    return tester;
  }, [game.teams, userLeagueId]);

  const rows = useMemo(() => {
    if (filter === "mine") return feed.filter((n) => n.involvesUser);
    if (filter === "league") return feed.filter(inUserLeague);
    return feed;
  }, [feed, filter, inUserLeague]);

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
  const leagueCount = useMemo(() => feed.filter(inUserLeague).length, [feed, inUserLeague]);
  const userLeagueName = userLeagueId ? game.leagues[userLeagueId]?.name : undefined;

  const FILTERS: { id: NewsFilter; label: string; count?: number }[] = [
    { id: "all", label: "ALL CLUBS" },
    { id: "league", label: "LEAGUE", count: leagueCount },
    { id: "mine", label: "MY CLUB", count: mineCount },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="display text-sm font-semibold">Market Wire</div>
          <div className="text-[11px] text-faint">
            {rows.length} deal{rows.length === 1 ? "" : "s"}
            {filter === "all"
              ? " across the world"
              : filter === "league"
                ? ` in ${userLeagueName ?? "your league"}`
                : " involving your club"}{" "}
            · newest first
          </div>
        </div>
        <div className="flex overflow-hidden rounded-md border border-line">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`display px-3 py-1 text-[11px] font-semibold transition-colors ${
                filter === f.id ? "gold-grad text-black" : "text-faint hover:text-dim"
              }`}
            >
              {f.label}
              {f.count ? ` (${f.count})` : ""}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-faint">
          <div className="display mb-2 text-lg text-dim">THE WIRE IS QUIET</div>
          {filter === "mine"
            ? "None of your own deals yet. Buy or sell a player and it lands here."
            : filter === "league"
              ? `No deals in ${userLeagueName ?? "your league"} yet. When a club here buys or sells, it lands on the wire.`
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

/** One deal on the wire: player (with flag) on the left, the club move
 * (from → to, each with its country flag) in the middle, fee on the right. */
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
  // gone from a pruned long save — fall back to the denormalised name/flag either
  // way. Older saves have no denormalised nat, so read it off the live player.
  const live = game.players[n.playerId];
  const playerLive = !!live;
  const playerNat = n.playerNat ?? live?.nationality;
  // Full name on the wire (v1.5), same as everywhere else on this screen. Read
  // off the live player when he's still in the world; a pruned save keeps only
  // the denormalised short name, which is what the feed stored at the time.
  const playerName = live ? displayFullName(live) : n.playerName;

  // A club's country flag comes from its league (leagues carry the country). A
  // pruned club falls back to no flag rather than a wrong one.
  const countryOf = (club: typeof from) =>
    club ? game.leagues[club.leagueId]?.country : undefined;

  const clubChip = (club: typeof from, fallback: string, align: "left" | "right") => {
    const country = countryOf(club);
    return (
      <span
        className={`flex min-w-0 flex-1 items-center gap-1.5 ${align === "right" ? "flex-row-reverse text-right" : ""}`}
      >
        {club ? <Crest colors={club.colors} short={club.short} size={18} /> : <span className="text-faint">—</span>}
        {country && <CountryFlag country={country} size={11} className="shrink-0" />}
        <span className="truncate text-[12px] text-dim">{club?.name ?? fallback}</span>
      </span>
    );
  };

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 ${n.involvesUser ? "bg-hover/40" : ""}`}>
      {/* Player — the subject of the deal, with his flag and any kind badge. */}
      <div className="flex min-w-0 flex-1 basis-[14rem] items-center gap-2">
        {playerNat && <Flag nat={playerNat} size={13} className="shrink-0" />}
        <button
          onClick={onView}
          disabled={!playerLive}
          className={`display min-w-0 truncate text-sm font-semibold ${playerLive ? "hover:text-gold" : "text-dim"} ${
            n.involvesUser ? "gold-text" : ""
          }`}
          title={playerLive ? "View player" : undefined}
        >
          {playerName}
        </button>
        {badge && (
          <span className={`display shrink-0 rounded-sm border px-1 py-0.5 text-[8px] font-bold ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>

      {/* The move: from club → to club, each flagged by country. */}
      <div className="flex min-w-0 flex-[1.4] basis-[18rem] items-center gap-2">
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

"use client";

// Global Club Network (§ end-game, v34). The macro layer: the manager oversees
// a network of AI-run clubs. Four tabs — Headquarters, Clubs, Operations, and a
// work-in-progress Staff. Rules live in lib/gcn.ts; this screen only reads and
// dispatches store actions.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import { formatMoney } from "@/lib/value";
import {
  GCN_FACILITY_SPEC,
  autoFundingOf,
  brandDealsWeekly,
  clubBuyPrice,
  clubSalePrice,
  clubStanding,
  foundableLeagues,
  fundableClubIds,
  gcnClubFinance,
  gcnClubStatus,
  gcnDealsWeekly,
  gcnLevelOf,
  gcnNextCost,
  gcnOverview,
  gcnPlayerSalePrice,
  groupClubsCap,
  isBuyableClub,
  isHomeCountryClub,
  isRingFenced,
  networkClubIds,
  seasonsUntilSellable,
  totalAutoFunding,
  type GcnClubFinance,
} from "@/lib/gcn";
import type { GcnFacility, PlayerBio } from "@/lib/types";
import {
  Card,
  ConfirmButton,
  CountryFlag,
  Crest,
  Flag,
  GhostButton,
  GoldButton,
  Modal,
  MoneyInput,
  Ovr,
  PosBadge,
  Section,
  Tabs,
  UpgradeCard,
} from "../ui";

type Tab = "hq" | "clubs" | "operations" | "staff";

export default function GcnScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<Tab>("hq");

  if (!game.gcn) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-dim">
        The Global Club Network isn't unlocked on this save.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="display text-2xl font-bold">{game.gcn.name}</h1>
        <span className="rounded-full border border-gold/40 px-2 py-0.5 text-[11px] uppercase tracking-widest text-gold">
          Global Club Network
        </span>
      </div>
      <Tabs
        tabs={[
          { id: "hq", label: "Headquarters" },
          { id: "clubs", label: "Clubs" },
          { id: "operations", label: "Operations" },
          { id: "staff", label: "Staff" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-5">
        {tab === "hq" && <HeadquartersTab />}
        {tab === "clubs" && <ClubsTab />}
        {tab === "operations" && <OperationsTab />}
        {tab === "staff" && <StaffTab />}
      </div>
    </div>
  );
}

// ── Headquarters ─────────────────────────────────────────────────────────────

/** The Headquarters actions (v1.62). Everything the network *does* lives behind
 * one of these cards — expansion, funding and player movement alike — rather
 * than expansion sitting in a header while the transfer console floated below. */
type HqAction = "found" | "buy" | "sell" | "move" | "fund" | "auto";

const HQ_ACTIONS: { id: HqAction; icon: string; label: string; blurb: string }[] = [
  { id: "found", icon: "🏗️", label: "Found a Club", blurb: "Build a new club from nothing in a league's lowest division." },
  { id: "buy", icon: "🤝", label: "Buy a Club", blurb: "Take over an existing side outright and fly the network's flag." },
  { id: "sell", icon: "🏷️", label: "Sell a Club", blurb: "Cash an owned club out of the network at its current worth." },
  { id: "move", icon: "🔁", label: "Move a Player", blurb: "Transfer or loan a player between any two clubs in the network." },
  { id: "fund", icon: "💷", label: "Fund a Club", blurb: "Send treasury money into an owned club's own budget." },
  { id: "auto", icon: "🔄", label: "Automate Funding", blurb: "Set a weekly standing order from the treasury to each owned club." },
];

function HeadquartersTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const ov = gcnOverview(game, TUNING);
  const [action, setAction] = useState<HqAction | null>(null);
  const atCap = ov.clubCount >= ov.clubCap;
  // The treasury's weekly balance (v1.63): Brand Deals in, standing funding
  // orders out. GCN Deals are paid to the clubs directly and never touch it.
  const brandIn = brandDealsWeekly(game, TUNING);
  const autoOut = totalAutoFunding(game);
  const treasuryNet = brandIn - autoOut;

  return (
    <div className="space-y-6">
      <Section title="Network at a glance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Treasury" value={formatMoney(ov.treasury)} gold />
          <Stat label="Clubs owned" value={`${ov.clubCount} / ${ov.clubCap}`} />
          <Stat label="Players" value={String(ov.totalPlayers)} />
          <Stat label="Club budgets" value={formatMoney(ov.totalClubBudgets)} />
        </div>
        {(brandIn > 0 || autoOut > 0) && (
          <p className="mt-2 text-[11px] text-faint">
            Treasury this week:{" "}
            {brandIn > 0 && (
              <>
                <span className="text-win tnum">+{formatMoney(brandIn)}</span> from Brand Deals
              </>
            )}
            {brandIn > 0 && autoOut > 0 && ", "}
            {autoOut > 0 && (
              <>
                <span className="text-loss tnum">−{formatMoney(autoOut)}</span> in automated funding
              </>
            )}
            {" · net "}
            <span className={`tnum ${treasuryNet >= 0 ? "text-win" : "text-loss"}`}>
              {treasuryNet >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(treasuryNet))}
            </span>
          </p>
        )}
        {atCap && (
          <p className="mt-2 text-[11px] text-faint">
            The network is at its club limit — raise <span className="text-ink">Group Clubs</span> in
            Operations to make room for more.
          </p>
        )}
      </Section>

      <Section title="Actions">
        <div className="grid gap-2 sm:grid-cols-2">
          {HQ_ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAction(a.id)}
              className="flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3 text-left transition-colors hover:border-gold/50 hover:bg-hover"
            >
              <span className="text-2xl leading-none">{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="display block text-sm font-semibold">{a.label}</span>
                <span className="block text-[11px] leading-snug text-faint">{a.blurb}</span>
              </span>
              <span className="text-faint">›</span>
            </button>
          ))}
        </div>
      </Section>

      {action === "found" && <FoundClubModal onClose={() => setAction(null)} />}
      {action === "buy" && <BuyClubModal onClose={() => setAction(null)} />}
      {action === "sell" && <SellClubModal onClose={() => setAction(null)} />}
      {action === "move" && <MovePlayerModal onClose={() => setAction(null)} />}
      {action === "fund" && <FundClubModal onClose={() => setAction(null)} />}
      {action === "auto" && <AutoFundingModal onClose={() => setAction(null)} />}
    </div>
  );
}

function Stat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <Card className="p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
      <div className={`display tnum mt-0.5 text-xl font-bold ${gold ? "gold-text" : "text-ink"}`}>{value}</div>
    </Card>
  );
}

/** A club chooser that renders as a club: crest, name, and the nation flag of
 * the league it plays in (v1.62). A native <select> can't hold an image, so this
 * is a button that opens a list — the same trade the NationalityPicker makes. */
function ClubPicker({
  clubIds,
  value,
  onChange,
  placeholder = "— pick a club —",
}: {
  clubIds: string[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const game = useGame((s) => s.game)!;
  const [open, setOpen] = useState(false);
  const selected = value ? game.teams[value] : null;

  return (
    <div className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-line bg-raised px-2 py-1.5 text-left text-sm outline-none transition-colors hover:border-gold/50"
      >
        {selected ? (
          <ClubLine clubId={selected.id} />
        ) : (
          <span className="flex-1 text-faint">{placeholder}</span>
        )}
        <span className="text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2xl">
          {clubIds.map((id) => (
            <button
              key={id}
              onClick={() => { onChange(id); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover ${
                id === value ? "bg-raised" : ""
              }`}
            >
              <ClubLine clubId={id} />
            </button>
          ))}
          {clubIds.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-faint">No clubs available.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One club rendered as crest + name + league-nation flag — the shared row of
 * the picker's button and its list. */
function ClubLine({ clubId }: { clubId: string }) {
  const game = useGame((s) => s.game)!;
  const t = game.teams[clubId];
  if (!t) return null;
  const league = game.leagues[t.leagueId];
  return (
    <>
      <Crest colors={t.colors} short={t.short} size={20} />
      <span className="min-w-0 flex-1 truncate">
        {t.name}
        {clubId === game.userTeamId && <span className="ml-1 text-[11px] text-gold">(your club)</span>}
      </span>
      {league && <CountryFlag country={league.country} size={11} />}
    </>
  );
}

/** A player chooser showing the position badge and the player's own nation flag
 * (v1.62) — the two things you actually pick a player by. */
function PlayerPicker({
  players,
  value,
  onChange,
}: {
  players: PlayerBio[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = players.find((p) => p.id === value) ?? null;

  return (
    <div className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-line bg-raised px-2 py-1.5 text-left text-sm outline-none transition-colors hover:border-gold/50"
      >
        {selected ? (
          <PlayerLine p={selected} />
        ) : (
          <span className="flex-1 text-faint">— pick a player —</span>
        )}
        <span className="text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2xl">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover ${
                p.id === value ? "bg-raised" : ""
              }`}
            >
              <PlayerLine p={p} />
            </button>
          ))}
          {players.length === 0 && (
            <p className="px-2 py-3 text-center text-[11px] text-faint">No available players.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerLine({ p }: { p: PlayerBio }) {
  return (
    <>
      <PosBadge pos={p.positions[0]} />
      <Flag nat={p.nationality} size={11} />
      <span className="min-w-0 flex-1 truncate">{p.name}</span>
      <span className="tnum text-[11px] text-faint">{p.age}y</span>
      <Ovr value={p.overall} size="sm" />
    </>
  );
}

/** The inter-club transfer & feeder-loan console — the heart of the network:
 * move a player between any two network clubs (the manager's own included, in
 * either direction as of v1.62), or send one of your own out on a guaranteed
 * feeder loan. */
function MovePlayerModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const movePlayer = useGame((s) => s.gcnMovePlayer);
  const sendFeeder = useGame((s) => s.gcnSendFeeder);

  const netIds = networkClubIds(game);
  const [fromClub, setFromClub] = useState(game.userTeamId);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [toClub, setToClub] = useState<string | null>(null);
  const [mode, setMode] = useState<"transfer" | "feeder">("transfer");
  const [role, setRole] = useState<"starter" | "rotation">("starter");

  const fromTeam = game.teams[fromClub];
  const squad = (fromTeam?.playerIds ?? [])
    .map((id) => game.players[id])
    .filter((p): p is PlayerBio => !!p && !p.loan)
    .sort((a, b) => b.overall - a.overall);
  // A permanent transfer can land anywhere in the network, the main club
  // included — pulling a prospect up is as valid as sending one down. A feeder
  // loan still only points at an owned club (your own club isn't a feeder).
  const allDestinations = netIds.filter((id) => id !== fromClub);
  const destinations =
    mode === "feeder" ? allDestinations.filter((id) => id !== game.userTeamId) : allDestinations;
  const feederAllowed = fromClub === game.userTeamId; // only your own players can be sent to feeders

  // Switching source or mode can strip the chosen destination out of the list.
  const toValid = toClub && destinations.includes(toClub) ? toClub : null;

  const commit = () => {
    if (!playerId || !toValid) return;
    if (mode === "feeder") sendFeeder(playerId, toValid, role);
    else movePlayer(playerId, toValid);
    onClose();
  };

  return (
    <Modal title="Move a player" onClose={onClose}>
      <div className="space-y-3">
        {/* source club */}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">From</span>
          <ClubPicker
            clubIds={netIds}
            value={fromClub}
            onChange={(id) => { setFromClub(id); setPlayerId(null); setToClub(null); }}
          />
        </div>

        {/* player */}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">Player</span>
          <PlayerPicker players={squad} value={playerId} onChange={setPlayerId} />
        </div>

        {/* destination */}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">To</span>
          <ClubPicker
            clubIds={destinations}
            value={toValid}
            onChange={setToClub}
            placeholder="— destination club —"
          />
        </div>

        {/* mode + role */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
          <button
            onClick={() => setMode("transfer")}
            className={`rounded px-3 py-1.5 text-sm ${mode === "transfer" ? "gold-grad text-[#14120a]" : "border border-line text-dim"}`}
          >
            Permanent transfer
          </button>
          <button
            onClick={() => feederAllowed && setMode("feeder")}
            disabled={!feederAllowed}
            className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${mode === "feeder" ? "gold-grad text-[#14120a]" : "border border-line text-dim"}`}
            title={feederAllowed ? "" : "Only your own players can be sent on a feeder loan"}
          >
            Feeder loan
          </button>
          {mode === "feeder" && (
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "starter" | "rotation")}
              className="rounded border border-line bg-raised px-2 py-1.5 text-sm outline-none focus:border-gold"
            >
              <option value="starter">Guaranteed starter</option>
              <option value="rotation">Rotation</option>
            </select>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          {mode === "feeder"
            ? "A feeder loan sends the player to an owned club that guarantees his minutes — reliable development you don't get loaning to a stranger."
            : "A permanent transfer between your own clubs is free — no money leaves the network. Your own club can be either end of the move."}
        </p>

        <div className="flex justify-end gap-2 border-t border-line/60 pt-3">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton disabled={!playerId || !toValid} onClick={commit}>
            {mode === "feeder" ? "Send on feeder loan" : "Transfer within network"}
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

/** Fund a Club (v1.62): the treasury's other outflow — top up an owned club's
 * own budget, with its weekly finances on show so the size of the cheque is an
 * informed decision. */
function FundClubModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const fund = useGame((s) => s.gcnFundClub);
  // Ring-fenced home-country clubs take no network money, so they aren't listed.
  const clubIds = fundableClubIds(game);
  const treasury = game.gcn?.treasury ?? 0;
  const [clubId, setClubId] = useState<string | null>(clubIds[0] ?? null);
  const [amount, setAmount] = useState(0);

  const fin = clubId ? gcnClubFinance(game, clubId, TUNING) : null;
  const canSend = !!clubId && amount > 0 && amount <= treasury;

  if (clubIds.length === 0) {
    return (
      <Modal title="Fund a club" onClose={onClose}>
        <p className="py-6 text-center text-sm text-dim">
          {(game.gcn?.clubIds.length ?? 0) > 0
            ? "Every club the network owns is ring-fenced in your own country — none of them can take network money."
            : "The network doesn't own any clubs yet — found or buy one first."}
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Fund a club" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">Club</span>
          <ClubPicker clubIds={clubIds} value={clubId} onChange={setClubId} />
        </div>

        {fin && <FinancePanel fin={fin} />}

        <div className="space-y-1 border-t border-line/60 pt-3">
          <label className="block text-[11px] uppercase tracking-widest text-faint">Amount to send</label>
          <MoneyInput
            value={amount}
            onChange={setAmount}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm tnum outline-none focus:border-gold"
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[0.1, 0.25, 0.5, 1].map((frac) => (
              <button
                key={frac}
                onClick={() => setAmount(Math.floor(treasury * frac))}
                className="rounded border border-line px-2 py-1 text-[11px] text-dim transition-colors hover:border-gold/50 hover:text-ink"
              >
                {frac === 1 ? "All" : `${frac * 100}%`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="text-sm text-dim">
            Treasury <span className="display gold-text tnum font-bold">{formatMoney(treasury)}</span>
          </span>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <GoldButton disabled={!canSend} onClick={() => { fund(clubId!, amount); onClose(); }}>
              Send funds
            </GoldButton>
          </div>
        </div>
        {amount > treasury && <p className="text-[11px] text-loss">The treasury doesn't hold that much.</p>}
      </div>
    </Modal>
  );
}

/** Automate Funding (v1.63): a standing weekly order per owned club, paid out of
 * the treasury every Monday. Every owned club is listed at once — the point is
 * to see the whole commitment against what the treasury takes in, not to set one
 * club in isolation. */
function AutoFundingModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setAuto = useGame((s) => s.gcnSetAutoFunding);
  // Ring-fenced home-country clubs can't draw a standing order, so they're out.
  const clubIds = fundableClubIds(game);
  const treasury = game.gcn?.treasury ?? 0;

  // A local draft so a half-typed figure isn't committed on every keystroke.
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(clubIds.map((id) => [id, autoFundingOf(game, id)]))
  );

  const committed = clubIds.reduce((s, id) => s + (draft[id] ?? 0), 0);
  const brandIn = brandDealsWeekly(game, TUNING);
  const net = brandIn - committed;
  const weeksOfCover = net < 0 ? Math.floor(treasury / -net) : null;
  const dirty = clubIds.some((id) => (draft[id] ?? 0) !== autoFundingOf(game, id));

  if (clubIds.length === 0) {
    return (
      <Modal title="Automate funding" onClose={onClose}>
        <p className="py-6 text-center text-sm text-dim">
          {(game.gcn?.clubIds.length ?? 0) > 0
            ? "Every club the network owns is ring-fenced in your own country — none of them can draw a standing order."
            : "The network doesn't own any clubs yet — found or buy one first."}
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Automate funding" onClose={onClose} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-dim">
          Each owned club can draw a fixed sum from the treasury every week. A week the treasury
          can't cover an order, that order is simply skipped — nothing goes into the red. Set 0 to
          stop a club's payments.
        </p>

        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
          {clubIds.map((id) => {
            const t = game.teams[id];
            if (!t) return null;
            const fin = gcnClubFinance(game, id, TUNING);
            return (
              <div key={id} className="flex items-center gap-3 rounded border border-line bg-raised px-3 py-2">
                <Crest colors={t.colors} short={t.short} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="display truncate text-sm font-semibold">{t.name}</div>
                  <div className="text-[11px] text-faint">
                    Funds <span className="tnum text-ink">{formatMoney(t.budget)}</span>
                    {fin && (
                      <>
                        {" · net "}
                        <span className={`tnum ${fin.net >= 0 ? "text-win" : "text-loss"}`}>
                          {fin.net >= 0 ? "+" : "−"}
                          {formatMoney(Math.abs(fin.net))}/wk
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <MoneyInput
                  value={draft[id] ?? 0}
                  onChange={(n) => setDraft({ ...draft, [id]: Math.max(0, n) })}
                  className="w-36 rounded-md border border-line bg-surface px-2 py-1.5 text-right text-sm tnum outline-none focus:border-gold"
                />
                <span className="text-[11px] text-faint">/ wk</span>
              </div>
            );
          })}
        </div>

        <div className="space-y-1 border-t border-line/60 pt-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-dim">Committed per week</span>
            <span className="display tnum font-bold text-ink">{formatMoney(committed)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dim">Brand Deals income</span>
            <span className="tnum text-win">+{formatMoney(brandIn)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-dim">Treasury net per week</span>
            <span className={`display tnum font-bold ${net >= 0 ? "text-win" : "text-loss"}`}>
              {net >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(net))}
            </span>
          </div>
        </div>
        {weeksOfCover !== null && (
          <p className="text-[11px] text-faint">
            At this rate the treasury's <span className="gold-text tnum">{formatMoney(treasury)}</span>{" "}
            covers about <span className="tnum text-ink">{weeksOfCover}</span>{" "}
            {weeksOfCover === 1 ? "week" : "weeks"} of orders.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line/60 pt-3">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton
            disabled={!dirty}
            onClick={() => {
              for (const id of clubIds) {
                if ((draft[id] ?? 0) !== autoFundingOf(game, id)) setAuto(id, draft[id] ?? 0);
              }
              onClose();
            }}
          >
            Save standing orders
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

/** Marks a home-country holding (v1.64). Ring-fenced clubs are owned at arm's
 * length — the tag is the manager's reminder that none of the network's levers
 * reach them. */
function RingFenceBadge({ title }: { title?: string } = {}) {
  return (
    <span
      className="display shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] font-semibold text-dim"
      title={title ?? "Home country — ring-fenced: no network funding, players or feeder loans."}
    >
      RING-FENCED
    </span>
  );
}

/** Sell a Club (v1.63): the counterpart to Buy a Club. The club survives as an
 * ordinary AI side — the network just cashes out, at its current worth less the
 * resale haircut, into the treasury. */
function SellClubModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const sell = useGame((s) => s.gcnSellClub);
  const clubIds = game.gcn?.clubIds ?? [];
  const [clubId, setClubId] = useState<string | null>(clubIds[0] ?? null);
  const [confirming, setConfirming] = useState(false);

  const club = clubId ? game.teams[clubId] : null;
  const price = clubId ? clubSalePrice(game, clubId, TUNING) : 0;
  const st = clubId ? gcnClubStatus(game, clubId) : null;
  const autoOrder = clubId ? autoFundingOf(game, clubId) : 0;
  // Minimum hold (v1.64) — a recently acquired club can't be sold on yet.
  const held = clubId ? seasonsUntilSellable(game, clubId, TUNING) : 0;

  if (clubIds.length === 0) {
    return (
      <Modal title="Sell a club" onClose={onClose}>
        <p className="py-6 text-center text-sm text-dim">The network doesn't own any clubs to sell.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Sell a club" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">Club</span>
          <ClubPicker
            clubIds={clubIds}
            value={clubId}
            onChange={(id) => { setClubId(id); setConfirming(false); }}
          />
        </div>

        {club && held > 0 && (
          <p className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-[11px] leading-relaxed text-loss">
            {club.name} is inside its {TUNING.gcnMinHoldSeasons}-season minimum hold. The network
            can't sell it until season{" "}
            <span className="tnum">{game.season + held}</span> — {held}{" "}
            {held === 1 ? "season" : "seasons"} away. Clubs join the network for the long term.
          </p>
        )}

        {club && st && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Offer" value={formatMoney(price)} gold />
              <Stat label="Squad" value={`${st.squadSize} · ${st.avgOverall} OVR`} />
              <Stat label="Reputation" value={String(st.reputation)} />
              <Stat label="Club funds" value={formatMoney(club.budget)} />
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              The offer is {Math.round(TUNING.gcnSellClubPriceFactor * 100)}% of what the club would
              cost to buy today, so a side the network has built up sells for more than it cost. The
              club keeps its squad, budget and identity and carries on as an ordinary side in{" "}
              {st.leagueName} — its funds do <span className="text-ink">not</span> come back to the
              treasury. Any feeder loan there is recalled
              {autoOrder > 0 && (
                <>
                  , and its <span className="text-ink tnum">{formatMoney(autoOrder)}</span>/wk standing
                  order is cancelled
                </>
              )}
              .
            </p>
          </>
        )}

        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="text-sm text-dim">
            Into the treasury <span className="display gold-text tnum font-bold">{formatMoney(price)}</span>
          </span>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            {confirming ? (
              <GoldButton onClick={() => { sell(clubId!); onClose(); }}>Confirm sale</GoldButton>
            ) : (
              <GoldButton disabled={!clubId || held > 0} onClick={() => setConfirming(true)}>
                Sell club
              </GoldButton>
            )}
          </div>
        </div>
        {confirming && (
          <p className="text-[11px] text-loss">
            Selling {club?.name} removes it from the network for good — buying it back later costs
            full price.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** A club's weekly finances, laid out the way the Finances page reads: the
 * headline budget, then income and expenses broken into their parts (v1.62).
 * Shared by Clubs → Finance and the Fund a Club dialog. */
function FinancePanel({ fin }: { fin: GcnClubFinance }) {
  const rows: { label: string; amount: number }[] = [
    { label: "TV & prize money", amount: fin.tvIncome },
    { label: "League position bonus", amount: fin.positionBonus },
    { label: "Matchday gate", amount: fin.gateIncome },
    { label: "Income upgrades", amount: fin.facilityIncome },
    { label: "Sponsorship", amount: fin.sponsorIncome },
    { label: "Solidarity payment", amount: fin.solidarityIncome },
    { label: "Network funding", amount: fin.networkIncome },
    // In a sim league the wage bill isn't debited weekly, so it's shown as the
    // squad's cost rather than a line in the net (see `banksOwnBooks`).
    { label: fin.banksOwnBooks ? "Player wages" : "Squad wage bill (not charged)", amount: -fin.wageBill },
    { label: "Staff wages", amount: -fin.staffWages },
  ].filter((r) => r.amount !== 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Funds" value={formatMoney(fin.budget)} gold />
        <Stat label="Income / wk" value={formatMoney(fin.income)} />
        <Stat label="Spend / wk" value={formatMoney(fin.expenses)} />
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-faint">Net / wk</div>
          <div className={`display tnum mt-0.5 text-xl font-bold ${fin.net >= 0 ? "text-win" : "text-loss"}`}>
            {fin.net >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(fin.net))}
          </div>
        </Card>
      </div>
      <Card className="divide-y divide-line/50">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-dim">{r.label}</span>
            <span className={`tnum ${r.amount >= 0 ? "text-ink" : "text-loss"}`}>
              {r.amount >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(r.amount))}
            </span>
          </div>
        ))}
      </Card>
      {!fin.banksOwnBooks && (
        <p className="text-[11px] leading-relaxed text-faint">
          This club plays in a simulated league, where matchday and TV money — and the wage bill —
          are abstracted rather than banked week to week. Its funds move on network payments and
          transfers only.
        </p>
      )}
      {fin.weeksOfCover !== null && (
        <p className="text-[11px] text-faint">
          Running at a loss — the current funds cover roughly{" "}
          <span className="text-ink tnum">{fin.weeksOfCover}</span> more{" "}
          {fin.weeksOfCover === 1 ? "week" : "weeks"} at this rate.
        </p>
      )}
    </div>
  );
}

function FoundClubModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const foundClubAction = useGame((s) => s.gcnFoundClub);
  const leagues = foundableLeagues(game);
  const [leagueId, setLeagueId] = useState(leagues[0]?.leagueId ?? "");
  const [name, setName] = useState("");
  const cost = TUNING.gcnFoundClubCost;
  const affordable = (game.gcn?.treasury ?? 0) >= cost;
  const cap = groupClubsCap(game, TUNING);
  const atCap = (game.gcn?.clubIds.length ?? 0) >= cap;
  const canConfirm = !!leagueId && name.trim().length > 0 && affordable && !atCap;

  return (
    <Modal title="Found a new club" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-dim">
          A new club takes over a slot in a league's lowest division, replacing an existing side,
          and starts with a freshly-built low-quality squad to grow from the bottom.
        </p>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-widest text-faint">League</label>
          <select
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            className="w-full rounded border border-line bg-raised px-2 py-2 text-sm outline-none focus:border-gold"
          >
            {leagues.map((l) => (
              <option key={l.leagueId} value={l.leagueId}>{l.name} · {l.country}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-widest text-faint">Club name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={48}
            autoFocus
            placeholder="e.g. Aurora City"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </div>
        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="text-sm text-dim">
            Cost <span className={`display tnum font-bold ${affordable ? "gold-text" : "text-loss"}`}>{formatMoney(cost)}</span>
          </span>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <GoldButton disabled={!canConfirm} onClick={() => { foundClubAction(leagueId, name); onClose(); }}>
              Found club
            </GoldButton>
          </div>
        </div>
        {atCap ? (
          <p className="text-[11px] text-loss">
            The network already holds its limit of {cap} clubs — raise Group Clubs in Operations first.
          </p>
        ) : (
          !affordable && <p className="text-[11px] text-loss">The treasury can't afford this yet.</p>
        )}
      </div>
    </Modal>
  );
}

function BuyClubModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const buy = useGame((s) => s.gcnBuyClub);
  const treasury = game.gcn?.treasury ?? 0;
  const cap = groupClubsCap(game, TUNING);
  const atCap = (game.gcn?.clubIds.length ?? 0) >= cap;
  const [query, setQuery] = useState("");

  // Buyable clubs, cheapest first, filtered by a name/league search.
  const q = query.trim().toLowerCase();
  const buyable = Object.values(game.teams)
    .filter((t) => isBuyableClub(game, t.id, TUNING))
    .map((t) => ({
      team: t,
      price: clubBuyPrice(game, t.id, TUNING),
      league: game.leagues[t.leagueId],
      // A home-country club is bought on ring-fenced terms — flag it in the list
      // so the manager knows before he pays, not after.
      home: isHomeCountryClub(game, t.id),
    }))
    .filter(({ team, league }) => !q || team.name.toLowerCase().includes(q) || league?.name.toLowerCase().includes(q) || league?.country.toLowerCase().includes(q))
    .sort((a, b) => a.price - b.price)
    .slice(0, 60);

  return (
    <Modal title="Buy a club" onClose={onClose} size="lg">
      <div className="space-y-3">
        {atCap && (
          <p className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-[11px] text-loss">
            The network already holds its limit of {cap} clubs — raise Group Clubs in Operations
            before buying another.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-faint">
          Clubs in your own country can be bought, but only as{" "}
          <span className="text-ink">ring-fenced</span> holdings: no network funding, no players
          moving either way, no feeder loans — and never a club in your own division. You own the
          balance sheet, not the sporting advantage.
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search club, league or country…"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
        />
        <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {buyable.map(({ team, price, league, home }) => {
            const afford = treasury >= price;
            return (
              <div key={team.id} className="flex items-center gap-3 rounded border border-line bg-raised px-3 py-2">
                <Crest colors={team.colors} short={team.short} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="display flex items-center gap-1.5 truncate text-sm font-semibold">
                    <span className="truncate">{team.name}</span>
                    {home && <RingFenceBadge />}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    {league && <CountryFlag country={league.country} size={11} />}
                    <span className="truncate">{league?.name}</span>
                    <span>· rep {team.reputation}</span>
                  </div>
                </div>
                <div className="display tnum text-sm font-bold text-ink">{formatMoney(price)}</div>
                <GoldButton disabled={!afford || atCap} onClick={() => buy(team.id)}>Buy</GoldButton>
              </div>
            );
          })}
          {buyable.length === 0 && <p className="py-6 text-center text-sm text-faint">No clubs match.</p>}
        </div>
        <p className="text-[11px] text-faint">
          Treasury: <span className="gold-text tnum">{formatMoney(treasury)}</span>. A club joins the
          network for at least {TUNING.gcnMinHoldSeasons} seasons before it can be sold on.
        </p>
      </div>
    </Modal>
  );
}

// ── Clubs ────────────────────────────────────────────────────────────────────

/** What an expanded club row shows (v1.62). The row used to open straight onto a
 * wall of names; now the squad is one of four views the manager picks. */
type ClubPanel = "squad" | "finance" | "status" | "edit";

const CLUB_PANELS: { id: ClubPanel; label: string }[] = [
  { id: "squad", label: "Squad" },
  { id: "finance", label: "Finance" },
  { id: "status", label: "Status" },
  { id: "edit", label: "Edit Club" },
];

function ClubsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  // Which club is expanded, and which of its panels is showing.
  const [open, setOpen] = useState<{ clubId: string; panel: ClubPanel } | null>(null);
  const clubIds = game.gcn?.clubIds ?? [];

  if (clubIds.length === 0) {
    return (
      <Card className="p-8 text-center text-dim">
        No clubs in the network yet. Head to <span className="text-ink">Headquarters</span> to found
        or buy your first club.
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {clubIds.map((id) => {
        const t = game.teams[id];
        if (!t) return null;
        const league = game.leagues[t.leagueId];
        const standing = clubStanding(game, id);
        const isOpen = open?.clubId === id;
        return (
          <Card key={id} className="overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : { clubId: id, panel: "squad" })}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
            >
              <Crest colors={t.colors} short={t.short} size={30} />
              <div className="min-w-0 flex-1">
                <div className="display flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{t.name}</span>
                  {isRingFenced(game, id) && <RingFenceBadge />}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-faint">
                  {league && <CountryFlag country={league.country} size={11} />}
                  <span className="truncate">{league?.name}</span>
                  {seasonsUntilSellable(game, id, TUNING) > 0 && (
                    <span title={`Minimum hold — sellable from S${game.season + seasonsUntilSellable(game, id, TUNING)}`}>
                      · held {seasonsUntilSellable(game, id, TUNING)}
                      {seasonsUntilSellable(game, id, TUNING) === 1 ? " season" : " seasons"}
                    </span>
                  )}
                </div>
              </div>
              {/* League position and cash in hand — the two numbers worth seeing
                  without opening the club (labelled, since "3 / 20" alone read
                  as a riddle before v1.62). */}
              <div className="text-right text-[11px] text-faint">
                <div>
                  <span className="uppercase tracking-widest">Pos </span>
                  <span className="tnum text-ink">{standing ? `${standing.pos}/${standing.of}` : "—"}</span>
                </div>
                <div>
                  <span className="uppercase tracking-widest">Funds </span>
                  <span className="tnum text-ink">{formatMoney(t.budget)}</span>
                </div>
              </div>
              <span className="text-faint">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="border-t border-line/60 p-3">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {CLUB_PANELS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setOpen({ clubId: id, panel: p.id })}
                      className={`rounded px-3 py-1.5 text-[12px] transition-colors ${
                        open.panel === p.id ? "gold-grad text-[#14120a]" : "border border-line text-dim hover:text-ink"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {open.panel === "squad" && <SquadPanel clubId={id} />}
                {open.panel === "finance" && <ClubFinancePanel clubId={id} />}
                {open.panel === "status" && <ClubStatusPanel clubId={id} />}
                {/* keyed so the draft re-seeds from the club, not the last one edited */}
                {open.panel === "edit" && <ClubEditPanel key={id} clubId={id} />}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Squad — every player, each a button onto his profile, each with a sale price
 * and a two-step SELL beside it (v1.63). The fee goes into this club's own
 * budget, not the treasury, so selling is how an owned club funds itself. */
function SquadPanel({ clubId }: { clubId: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const sellPlayerAction = useGame((s) => s.gcnSellPlayer);
  const squad = (game.teams[clubId]?.playerIds ?? [])
    .map((pid) => game.players[pid])
    .filter((p): p is PlayerBio => !!p)
    .sort((a, b) => b.overall - a.overall);
  const atMin = squad.length <= TUNING.gcnSellMinSquadSize;
  const fenced = isRingFenced(game, clubId);

  if (squad.length === 0) return <p className="py-4 text-center text-sm text-faint">No players.</p>;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {squad.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-raised">
            <button
              onClick={() => viewPlayer(p.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <PosBadge pos={p.positions[0]} />
              <Flag nat={p.nationality} size={11} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="tnum text-[11px] text-faint">{p.age}y</span>
              <Ovr value={p.overall} size="sm" />
            </button>
            <span className="tnum shrink-0 text-[11px] text-faint">
              {formatMoney(gcnPlayerSalePrice(game, p.id, TUNING))}
            </span>
            <ConfirmButton
              label="Sell"
              confirmLabel="Confirm"
              disabled={atMin || !!p.loan || fenced}
              onConfirm={() => sellPlayerAction(p.id)}
              className="!px-2 !py-1 !text-[11px]"
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {fenced ? (
          <span className="text-loss">
            This club is in your own country and ring-fenced — its squad can't be sold from or moved
            into the network. You own the club; you don't run its transfers.
          </span>
        ) : atMin ? (
          <span className="text-loss">
            This squad is down to the {TUNING.gcnSellMinSquadSize}-player minimum — nothing more can
            be sold.
          </span>
        ) : (
          <>
            A sale banks {Math.round(TUNING.gcnSellPlayerPriceFactor * 100)}% of the player's market
            value into <span className="text-ink">this club's</span> budget, and he leaves as a free
            agent. Squads can't drop below {TUNING.gcnSellMinSquadSize} players.
          </>
        )}
      </p>
    </div>
  );
}

function ClubFinancePanel({ clubId }: { clubId: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const fin = gcnClubFinance(game, clubId, TUNING);
  if (!fin) return null;
  return <FinancePanel fin={fin} />;
}

/** Status — where the club stands as a football club: league position and the
 * record behind it, plus the squad it fields. */
function ClubStatusPanel({ clubId }: { clubId: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const st = gcnClubStatus(game, clubId);
  if (!st) return null;
  const played = st.played > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Position" value={st.pos > 0 ? `${st.pos} of ${st.of}` : "—"} gold />
        <Stat label="Points" value={played ? String(st.points) : "—"} />
        <Stat label="Played" value={played ? String(st.played) : "—"} />
        <Stat label="Pts / game" value={played ? st.ppg.toFixed(2) : "—"} />
      </div>
      <Card className="divide-y divide-line/50">
        <Row label="League">
          <span className="flex items-center gap-1.5">
            {st.country && <CountryFlag country={st.country} size={11} />}
            <span>{st.leagueName}</span>
            <span className="text-faint">· tier {st.tier}</span>
          </span>
        </Row>
        <Row label="Record">
          {played ? (
            <span className="tnum">
              <span className="text-win">{st.won}W</span> · <span className="text-dim">{st.drawn}D</span> ·{" "}
              <span className="text-loss">{st.lost}L</span>
            </span>
          ) : (
            <span className="text-faint">Season not started</span>
          )}
        </Row>
        <Row label="Goals">
          {played ? (
            <span className="tnum">
              {st.gf} for · {st.ga} against ·{" "}
              <span className={st.gf - st.ga >= 0 ? "text-win" : "text-loss"}>
                {st.gf - st.ga >= 0 ? "+" : "−"}
                {Math.abs(st.gf - st.ga)}
              </span>
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </Row>
        <Row label="Reputation">
          <span className="tnum">{st.reputation}</span>
        </Row>
        <Row label="Squad">
          <span className="tnum">
            {st.squadSize} players · {st.avgOverall} avg OVR
          </span>
        </Row>
      </Card>
      {!played && (
        <p className="text-[11px] text-faint">
          This club plays in a simulated league — its table fills in once the season's rounds have
          been resolved.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="shrink-0 text-dim">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

/** Edit Club — the network owns this club, so it may re-brand it: name, crest
 * abbreviation, colours and stadium (v1.62). */
function ClubEditPanel({ clubId }: { clubId: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const editClubAction = useGame((s) => s.gcnEditClub);
  const t = game.teams[clubId]!;

  // Keyed on the club id so switching rows re-seeds the draft from that club.
  const [draft, setDraft] = useState({
    name: t.name,
    short: t.short,
    colors: t.colors,
    stadium: t.stadium,
  });

  const shortClean = draft.short.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const valid = draft.name.trim().length > 0 && shortClean.length >= 2 && draft.stadium.trim().length > 0;
  const dirty =
    draft.name !== t.name ||
    shortClean !== t.short ||
    draft.colors[0] !== t.colors[0] ||
    draft.colors[1] !== t.colors[1] ||
    draft.stadium !== t.stadium;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-md border border-line bg-raised p-3">
        <Crest colors={draft.colors} short={shortClean || "?"} size={40} />
        <div className="min-w-0">
          <div className="display truncate text-base font-semibold">{draft.name.trim() || "Unnamed club"}</div>
          <div className="truncate text-[11px] text-faint">{draft.stadium.trim() || "No stadium"}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Club name">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={48}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </Field>
        <Field label="Abbreviation (2–4)">
          <input
            value={draft.short}
            onChange={(e) => setDraft({ ...draft, short: e.target.value })}
            maxLength={4}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-gold"
          />
        </Field>
        <Field label="Stadium">
          <input
            value={draft.stadium}
            onChange={(e) => setDraft({ ...draft, stadium: e.target.value })}
            maxLength={64}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </Field>
        <Field label="Colours">
          <div className="flex gap-2">
            {[0, 1].map((i) => (
              <input
                key={i}
                type="color"
                value={draft.colors[i]}
                onChange={(e) => {
                  const next: [string, string] = [...draft.colors];
                  next[i] = e.target.value;
                  setDraft({ ...draft, colors: next });
                }}
                className="h-9 w-full cursor-pointer rounded border border-line bg-surface"
                title={i === 0 ? "Primary" : "Secondary"}
              />
            ))}
          </div>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
        <GhostButton
          disabled={!dirty}
          onClick={() => setDraft({ name: t.name, short: t.short, colors: t.colors, stadium: t.stadium })}
        >
          Reset
        </GhostButton>
        <GoldButton
          disabled={!valid || !dirty}
          onClick={() =>
            editClubAction(clubId, {
              name: draft.name,
              short: shortClean,
              colors: draft.colors,
              stadium: draft.stadium,
            })
          }
        >
          Save changes
        </GoldButton>
      </div>
      {!valid && (
        <p className="text-[11px] text-loss">
          A club needs a name, a stadium, and a 2–4 letter abbreviation.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-widest text-faint">{label}</span>
      {children}
    </label>
  );
}

// ── Operations ───────────────────────────────────────────────────────────────

function OperationsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgradeGcn = useGame((s) => s.upgradeGcn);
  const treasury = game.gcn?.treasury ?? 0;
  const facilities = Object.keys(GCN_FACILITY_SPEC) as GcnFacility[];

  const icons: Record<GcnFacility, string> = {
    groupClubs: "🏛️",
    brandDeals: "📣",
    gcnDeals: "🤝",
  };

  const owned = game.gcn?.clubIds.length ?? 0;
  const cap = groupClubsCap(game, TUNING);
  const brandNow = brandDealsWeekly(game, TUNING);
  const dealsNow = gcnDealsWeekly(game, TUNING);

  /** Each track states its effect in its own unit — club slots, treasury income,
   * per-club income (v1.63) — so the card reads as what it actually buys. */
  const effects: Record<GcnFacility, { now: string; next: string; note: (maxed: boolean) => string }> = {
    groupClubs: {
      now: `${cap} clubs`,
      next: `${cap + TUNING.gcnGroupClubsPerLevel} clubs`,
      note: (maxed) =>
        maxed
          ? `The network is at its ceiling of ${cap} clubs.`
          : `+${TUNING.gcnGroupClubsPerLevel} slots per level, up to ${
              TUNING.gcnGroupClubsBase + TUNING.gcnGroupClubsMaxLevel * TUNING.gcnGroupClubsPerLevel
            }.`,
    },
    brandDeals: {
      now: brandNow ? `${formatMoney(brandNow)} / wk` : "None",
      next: `${formatMoney(brandDealsWeekly(game, TUNING, gcnLevelOf(game, "brandDeals") + 1))} / wk`,
      note: (maxed) =>
        maxed
          ? `Brand Deals are maxed at ${formatMoney(brandNow)} a week into the treasury.`
          : `+${formatMoney(TUNING.gcnBrandDealsPerLevel)}/wk per level, up to ${formatMoney(
              brandDealsWeekly(game, TUNING, TUNING.gcnBrandDealsMaxLevel)
            )}/wk.`,
    },
    gcnDeals: {
      now: dealsNow ? `${formatMoney(dealsNow)} / wk each` : "None",
      next: `${formatMoney(gcnDealsWeekly(game, TUNING, gcnLevelOf(game, "gcnDeals") + 1))} / wk each`,
      note: (maxed) =>
        maxed
          ? `GCN Deals are maxed at ${formatMoney(dealsNow)} a week to every owned club.`
          : `+${formatMoney(TUNING.gcnDealsPerLevel)}/wk to each owned club per level, up to ${formatMoney(
              gcnDealsWeekly(game, TUNING, TUNING.gcnDealsMaxLevel)
            )}/wk.`,
    },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-faint">Treasury available</div>
          <div className="display gold-text tnum text-2xl font-bold">{formatMoney(treasury)}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-faint">Clubs owned</div>
          <div className="display tnum text-2xl font-bold text-ink">
            {owned} <span className="text-faint">/ {cap}</span>
          </div>
        </Card>
        <Stat label="Brand income / wk" value={brandNow ? formatMoney(brandNow) : "—"} />
        <Stat label="Club deals / wk" value={dealsNow ? `${formatMoney(dealsNow)} ea.` : "—"} />
      </div>
      {facilities.map((f) => {
        const spec = GCN_FACILITY_SPEC[f];
        const level = gcnLevelOf(game, f);
        const maxLevel = TUNING[spec.maxKey] as number;
        const cost = gcnNextCost(game, f, TUNING);
        const maxed = cost === null;
        const fx = effects[f];
        return (
          <UpgradeCard
            key={f}
            title={spec.label}
            icon={icons[f]}
            level={level}
            maxLevel={maxLevel}
            blurb={spec.blurb}
            effectNow={fx.now}
            effectNext={maxed ? "—" : fx.next}
            cost={maxed ? "Maxed" : formatMoney(cost!)}
            maxed={maxed}
            canAfford={!maxed && treasury >= cost!}
            note={fx.note(maxed)}
            onUpgrade={() => upgradeGcn(f)}
          />
        );
      })}
    </div>
  );
}

// ── Staff (work in progress) ─────────────────────────────────────────────────

function StaffTab() {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      <div className="text-4xl">🧑‍💼</div>
      <div className="display text-lg font-semibold">GCN Staff</div>
      <p className="max-w-md text-sm text-dim">
        As head of the network you'll hire staff who work across every club in the GCN — directors,
        analysts and recruitment leads that boost the whole operation.
      </p>
      <span className="rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-widest text-faint">
        Work in progress
      </span>
    </Card>
  );
}

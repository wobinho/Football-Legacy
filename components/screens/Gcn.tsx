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
  clubBuyPrice,
  clubStanding,
  foundableLeagues,
  gcnLevelOf,
  gcnNextCost,
  gcnOverview,
  isBuyableClub,
  networkClubIds,
} from "@/lib/gcn";
import type { GcnFacility, PlayerBio } from "@/lib/types";
import {
  Card,
  CountryFlag,
  Crest,
  GhostButton,
  GoldButton,
  Modal,
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

function HeadquartersTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const ov = gcnOverview(game, TUNING);
  const [founding, setFounding] = useState(false);
  const [buying, setBuying] = useState(false);

  return (
    <div className="space-y-6">
      <Section title="Network at a glance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Treasury" value={formatMoney(ov.treasury)} gold />
          <Stat label="Clubs owned" value={String(ov.clubCount)} />
          <Stat label="Players" value={String(ov.totalPlayers)} />
          <Stat label="Financing / wk" value={`+${formatMoney(ov.weeklyFinancingIncome)}`} />
        </div>
      </Section>

      <Section
        title="Actions"
        right={
          <div className="flex gap-2">
            <GhostButton onClick={() => setBuying(true)}>Buy a club</GhostButton>
            <GoldButton onClick={() => setFounding(true)}>Found a club</GoldButton>
          </div>
        }
      >
        <Card className="p-4 text-sm text-dim">
          Expand the network across the world's leagues. Found a new club in a league's lowest
          division, or buy an existing club outright. Both are paid from the treasury.
        </Card>
      </Section>

      <TransferConsole />

      {founding && <FoundClubModal onClose={() => setFounding(false)} />}
      {buying && <BuyClubModal onClose={() => setBuying(false)} />}
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

/** The inter-club transfer & feeder-loan console — the heart of the network:
 * move a player between owned clubs, or send one of your own out on a guaranteed
 * feeder loan. */
function TransferConsole() {
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
  const destinations = netIds.filter((id) => id !== fromClub);
  const feederAllowed = fromClub === game.userTeamId; // only your own players can be sent to feeders

  const commit = () => {
    if (!playerId || !toClub) return;
    if (mode === "feeder") sendFeeder(playerId, toClub, role);
    else movePlayer(playerId, toClub);
    setPlayerId(null);
    setToClub(null);
  };

  return (
    <Section title="Move a player">
      <Card className="space-y-3 p-4">
        {/* source club */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[11px] uppercase tracking-widest text-faint">From</span>
          <select
            value={fromClub}
            onChange={(e) => { setFromClub(e.target.value); setPlayerId(null); }}
            className="rounded border border-line bg-raised px-2 py-1.5 text-sm outline-none focus:border-gold"
          >
            {netIds.map((id) => (
              <option key={id} value={id}>
                {game.teams[id]?.name}{id === game.userTeamId ? " (your club)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* player */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[11px] uppercase tracking-widest text-faint">Player</span>
          <select
            value={playerId ?? ""}
            onChange={(e) => setPlayerId(e.target.value || null)}
            className="min-w-0 flex-1 rounded border border-line bg-raised px-2 py-1.5 text-sm outline-none focus:border-gold"
          >
            <option value="">— pick a player —</option>
            {squad.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.positions[0]} · {p.overall} OVR · {p.age}y
              </option>
            ))}
          </select>
        </div>

        {/* destination */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-[11px] uppercase tracking-widest text-faint">To</span>
          <select
            value={toClub ?? ""}
            onChange={(e) => setToClub(e.target.value || null)}
            className="rounded border border-line bg-raised px-2 py-1.5 text-sm outline-none focus:border-gold"
          >
            <option value="">— owned club —</option>
            {destinations
              .filter((id) => id !== game.userTeamId) // move/loan targets are owned clubs
              .map((id) => (
                <option key={id} value={id}>{game.teams[id]?.name}</option>
              ))}
          </select>
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
            : "A permanent transfer between your own clubs is free — no money leaves the network."}
        </p>

        <div>
          <GoldButton disabled={!playerId || !toClub} onClick={commit}>
            {mode === "feeder" ? "Send on feeder loan" : "Transfer within network"}
          </GoldButton>
        </div>
      </Card>
    </Section>
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
  const canConfirm = !!leagueId && name.trim().length > 0 && affordable;

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
        {!affordable && <p className="text-[11px] text-loss">The treasury can't afford this yet.</p>}
      </div>
    </Modal>
  );
}

function BuyClubModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  const buy = useGame((s) => s.gcnBuyClub);
  const treasury = game.gcn?.treasury ?? 0;
  const [query, setQuery] = useState("");

  // Buyable clubs, cheapest first, filtered by a name/league search.
  const q = query.trim().toLowerCase();
  const buyable = Object.values(game.teams)
    .filter((t) => isBuyableClub(game, t.id))
    .map((t) => ({ team: t, price: clubBuyPrice(game, t.id, TUNING), league: game.leagues[t.leagueId] }))
    .filter(({ team, league }) => !q || team.name.toLowerCase().includes(q) || league?.name.toLowerCase().includes(q) || league?.country.toLowerCase().includes(q))
    .sort((a, b) => a.price - b.price)
    .slice(0, 60);

  return (
    <Modal title="Buy a club" onClose={onClose} size="lg">
      <div className="space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search club, league or country…"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
        />
        <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {buyable.map(({ team, price, league }) => {
            const afford = treasury >= price;
            return (
              <div key={team.id} className="flex items-center gap-3 rounded border border-line bg-raised px-3 py-2">
                <Crest colors={team.colors} short={team.short} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="display truncate text-sm font-semibold">{team.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-faint">
                    {league && <CountryFlag country={league.country} size={11} />}
                    <span className="truncate">{league?.name}</span>
                    <span>· rep {team.reputation}</span>
                  </div>
                </div>
                <div className="display tnum text-sm font-bold text-ink">{formatMoney(price)}</div>
                <GoldButton disabled={!afford} onClick={() => buy(team.id)}>Buy</GoldButton>
              </div>
            );
          })}
          {buyable.length === 0 && <p className="py-6 text-center text-sm text-faint">No clubs match.</p>}
        </div>
        <p className="text-[11px] text-faint">
          Price = squad value × {TUNING.gcnBuyValueMultiplier}, plus premiums for league and club
          reputation. Treasury: <span className="gold-text tnum">{formatMoney(treasury)}</span>.
        </p>
      </div>
    </Modal>
  );
}

// ── Clubs ────────────────────────────────────────────────────────────────────

function ClubsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [openClub, setOpenClub] = useState<string | null>(null);
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
        const open = openClub === id;
        const squad = t.playerIds
          .map((pid) => game.players[pid])
          .filter((p): p is PlayerBio => !!p)
          .sort((a, b) => b.overall - a.overall);
        return (
          <Card key={id} className="overflow-hidden">
            <button
              onClick={() => setOpenClub(open ? null : id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
            >
              <Crest colors={t.colors} short={t.short} size={30} />
              <div className="min-w-0 flex-1">
                <div className="display truncate text-sm font-semibold">{t.name}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-faint">
                  {league && <CountryFlag country={league.country} size={11} />}
                  <span className="truncate">{league?.name}</span>
                </div>
              </div>
              <div className="text-right text-[11px] text-faint">
                <div>{standing ? `${standing.pos} / ${standing.of}` : "—"}</div>
                <div className="tnum">{formatMoney(t.budget)}</div>
              </div>
              <span className="text-faint">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="border-t border-line/60 px-2 py-2">
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {squad.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-raised">
                      <PosBadge pos={p.positions[0]} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-[11px] text-faint tnum">{p.age}y</span>
                      <Ovr value={p.overall} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
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
    financing: "💰",
    development: "📈",
    scouting: "🔭",
    logistics: "🚚",
  };

  return (
    <div className="space-y-6">
      <Card className="p-3 text-center">
        <div className="text-[10px] uppercase tracking-widest text-faint">Treasury available</div>
        <div className="display gold-text tnum text-2xl font-bold">{formatMoney(treasury)}</div>
      </Card>
      {facilities.map((f) => {
        const spec = GCN_FACILITY_SPEC[f];
        const level = gcnLevelOf(game, f);
        const maxLevel = TUNING[spec.maxKey] as number;
        const cost = gcnNextCost(game, f, TUNING);
        const maxed = cost === null;
        return (
          <UpgradeCard
            key={f}
            title={spec.label}
            icon={icons[f]}
            level={level}
            maxLevel={maxLevel}
            blurb={spec.blurb}
            effectNow={`Level ${level}`}
            effectNext={maxed ? "—" : `Level ${level + 1}`}
            cost={maxed ? "Maxed" : formatMoney(cost!)}
            maxed={maxed}
            canAfford={!maxed && treasury >= cost!}
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

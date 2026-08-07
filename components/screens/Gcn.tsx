"use client";

// Global Club Network (§19, reworked v1.95). The macro layer: the manager runs a
// network of AI-run clubs, a boardroom of Global Executives, and a map of
// International Scouting Hubs.
//
// Six tabs, and each one answers a single question — which is the whole reason
// the old four-tab shape was replaced. Headquarters used to be a dashboard AND
// the launcher for all seven network actions, so "how is my empire doing" and
// "buy a club" lived in the same place and neither got room. Now:
//
//   Headquarters  — how is the network doing? (read-only, no actions)
//   Clubs         — the holdings, and founding / buying / selling them
//   Players       — every player the network owns, in one filterable list
//   Intl Scouting — the hub map and its pipeline
//   Treasury      — all money: funding, standing orders, the books
//   Operations    — the boardroom and the upgrade tracks
//
// Rules live in lib/gcn.ts, lib/gcnexec.ts and lib/gcnhub.ts; this screen only
// reads and dispatches store actions. React never decides what is legal — every
// greyed-out control here is quoting an error function from those modules.

import { useMemo, useState } from "react";
import { useGame } from "@/store/gameStore";
import { TUNING } from "@/lib/config/tuning";
import { formatMoney } from "@/lib/value";
import {
  GCN_FACILITY_SPEC,
  autoFundingOf,
  clubBuyPrice,
  clubSalePrice,
  clubStanding,
  foundableLeagues,
  fundableClubIds,
  gcnClubFinance,
  gcnClubStatus,
  gcnEmpire,
  gcnLevelOf,
  gcnNextCost,
  gcnOverview,
  gcnPlayerSalePrice,
  groupClubsCap,
  isBuyableClub,
  isHomeCountryClub,
  isRingFenced,
  networkClubIds,
  networkMoveError,
  networkTransferFee,
  seasonsUntilSellable,
  totalAutoFunding,
  type GcnAlert,
  type GcnClubFinance,
} from "@/lib/gcn";
import {
  GCN_EXEC_ROLES,
  execEffect,
  execMarketFor,
  execSeasonsToNextBadge,
  execWageBill,
  executiveIn,
  hiredExecutives,
} from "@/lib/gcnexec";
import {
  ALL_POS,
  HUB_REGIONS,
  hasPresenceIn,
  hubBuildCost,
  hubCapacity,
  hubGrowthMult,
  hubHeadcount,
  hubIn,
  hubJudgement,
  hubPlacementError,
  hubPlacementOptions,
  hubProspects,
  hubRegion,
  hubReportDays,
  hubUpgradeCost,
  hubUpkeepWeekly,
  hubWageBill,
  hubs,
  type HubRegionDef,
} from "@/lib/gcnhub";
import { TIER_COLOR, TIER_LABEL } from "@/lib/scouts";
import {
  ARCHETYPE_MAP,
  ARCHETYPE_ROSTER,
  deriveArchetype,
  positionsOfArchetype,
} from "@/lib/config/archetype";
import type {
  BadgeTier,
  GcnExecRole,
  GcnHubFocus,
  PlayerBio,
  Pos,
  ProspectReport,
} from "@/lib/types";
import {
  Card,
  ClassPill,
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
  Select,
  Stars,
  Tabs,
  UpgradeCard,
} from "../ui";

type Tab = "hq" | "clubs" | "players" | "hubs" | "treasury" | "operations";

const TABS: { id: Tab; label: string }[] = [
  { id: "hq", label: "Headquarters" },
  { id: "clubs", label: "Clubs" },
  { id: "players", label: "Players" },
  { id: "hubs", label: "Intl Scouting Hub" },
  { id: "treasury", label: "Treasury" },
  { id: "operations", label: "Operations" },
];

export default function GcnScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [tab, setTab] = useState<Tab>("hq");

  if (!game.gcn) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-dim">
        The Global Club Network isn&apos;t unlocked on this save.
      </div>
    );
  }

  const empire = gcnEmpire(game, TUNING);
  const reports = game.gcn.hubReports?.length ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      {/* The masthead (v1.95). The network is the biggest thing the manager
          owns, so the page opens like a letterhead rather than a page title:
          the name in display face, the founding year and reach beneath it, and
          the treasury on the right where the eye lands last. */}
      {/* `.gold-thread` is a 1px DIVIDER element (it sets its own height), never
          a modifier on a container — applied to this card it collapses the whole
          masthead. It rides as a child rule at the top edge instead. */}
      <div className="relative mb-4 overflow-hidden rounded-lg border border-line bg-raised px-4 py-3.5 sm:px-5">
        <div className="gold-thread absolute inset-x-0 top-0" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-gold/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-gold">
                Global Club Network
              </span>
            </div>
            <h1 className="display mt-1 truncate text-2xl font-bold sm:text-3xl">{game.gcn.name}</h1>
            <p className="mt-0.5 text-[11px] text-faint">
              Founded S{game.gcn.foundedSeason} · {empire.countries.length}{" "}
              {empire.countries.length === 1 ? "country" : "countries"} ·{" "}
              {game.gcn.clubIds.length} {game.gcn.clubIds.length === 1 ? "club" : "clubs"} ·{" "}
              {hubs(game).length} {hubs(game).length === 1 ? "hub" : "hubs"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-faint">Treasury</div>
            <div className="display gold-text tnum text-2xl font-bold sm:text-3xl">
              {formatMoney(game.gcn.treasury)}
            </div>
            <div
              className={`tnum text-[11px] ${empire.totalNet >= 0 ? "text-win" : "text-loss"}`}
              title="Every owned club's weekly net, plus the treasury's own"
            >
              {empire.totalNet >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(empire.totalNet))} / wk
            </div>
          </div>
        </div>
      </div>

      <Tabs
        tabs={TABS.map((t) =>
          t.id === "hubs" && reports > 0 ? { ...t, badge: reports } : t
        )}
        active={tab}
        onChange={setTab}
      />
      <div className="mt-5">
        {tab === "hq" && <HeadquartersTab />}
        {tab === "clubs" && <ClubsTab />}
        {tab === "players" && <PlayersTab />}
        {tab === "hubs" && <HubsTab />}
        {tab === "treasury" && <TreasuryTab />}
        {tab === "operations" && <OperationsTab />}
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  gold,
  sub,
  tone,
}: {
  label: string;
  value: string;
  gold?: boolean;
  sub?: React.ReactNode;
  /** Colours the value for a signed quantity. */
  tone?: "win" | "loss";
}) {
  const color = tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : gold ? "gold-text" : "text-ink";
  return (
    <Card className="p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
      <div className={`display tnum mt-0.5 text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-faint">{sub}</div>}
    </Card>
  );
}

/** A signed weekly figure, coloured and prefixed — the network deals in these
 * constantly and they must read identically everywhere. */
function Net({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <span className={`tnum ${value >= 0 ? "text-win" : "text-loss"}`}>
      {value >= 0 ? "+" : "−"}
      {formatMoney(Math.abs(value))}
      {suffix}
    </span>
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

/**
 * One term of an executive seat's arithmetic (v1.99): what it is, where it came
 * from, and what it is worth.
 *
 * The `detail` is the load-bearing half. The three terms are worth wildly
 * different amounts and the reason is never the same twice — the seat pays a
 * flat rate for being filled, pedigree is his star rating times a per-star
 * figure, service is the badge he earned by staying — so a bare "+15.0" says
 * nothing about which lever the manager could pull to move it.
 */
function EffectTerm({ label, detail, value }: { label: string; detail: string; value: number }) {
  const zero = value <= 0;
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px]">
      <span className="min-w-0 truncate">
        <span className={zero ? "text-faint" : "text-dim"}>{label}</span>
        <span className="ml-1 text-faint">{detail}</span>
      </span>
      <span className={`tnum shrink-0 font-semibold ${zero ? "text-faint" : "text-ink"}`}>
        +{value.toFixed(1)}%
      </span>
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

/** Marks a home-country holding (v1.64). Ring-fenced clubs are owned at arm's
 * length — the tag is the manager's reminder that none of the network's levers
 * reach them. */
function RingFenceBadge({ title }: { title?: string } = {}) {
  return (
    <span
      className="display shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[10px] font-semibold text-dim"
      title={
        title ??
        "Home country — ring-fenced: no network funding and no feeder loans, and its squad never mixes with your own. It may still trade with other network clubs in its country, at market value."
      }
    >
      RING-FENCED
    </span>
  );
}

/** A GCN badge chip. The club system's `BadgeIcon` is keyed on a `FacilityId`
 * and an executive has no facility — his badge is for the SEAT — so this is the
 * minimum that reads correctly rather than a facility icon standing in for one. */
function ExecBadge({ tier, seasons }: { tier: BadgeTier; seasons: number }) {
  const color = TIER_COLOR[tier];
  return (
    <span
      className="display inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ borderColor: `${color}66`, color, backgroundColor: `${color}14` }}
      title={`${seasons} ${seasons === 1 ? "season" : "seasons"} of service`}
    >
      {tier}
    </span>
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
      <Crest team={t} size={20} />
      <span className="min-w-0 flex-1 truncate">
        {t.name}
        {clubId === game.userTeamId && <span className="ml-1 text-[11px] text-gold">(your club)</span>}
      </span>
      {league && <CountryFlag country={league.country} size={11} />}
    </>
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
        {selected ? <ClubLine clubId={selected.id} /> : <span className="flex-1 text-faint">{placeholder}</span>}
        <span className="text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2xl">
          {clubIds.map((id) => (
            <button
              key={id}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
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
        {selected ? <PlayerLine p={selected} /> : <span className="flex-1 text-faint">— pick a player —</span>}
        <span className="text-faint">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2xl">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
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

// ── Headquarters ─────────────────────────────────────────────────────────────
// Read-only by design (v1.95). Every action moved to the tab that owns its
// subject — founding a club to Clubs, funding one to Treasury — which is what
// gives the dashboard room to actually be one. A page that both reports and
// launches ends up doing neither well, which is exactly what the old
// Headquarters tab did with seven action cards under four totals.

/** What each kind of alert looks like at a glance (v1.88). */
const ALERT_ICON: Record<GcnAlert["kind"], string> = {
  insolvent: "🔻",
  thin: "👥",
  sliding: "📉",
};

function HeadquartersTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const ov = gcnOverview(game, TUNING);
  const empire = gcnEmpire(game, TUNING);
  const hubList = hubs(game);
  const prospects = hubProspects(game);
  const seats = hiredExecutives(game);

  const autoOut = totalAutoFunding(game);
  const execOut = execWageBill(game);
  const hubOut = hubUpkeepWeekly(game, TUNING) + hubWageBill(game, TUNING);

  if (ov.clubCount === 0 && hubList.length === 0 && seats.length === 0) {
    return (
      <Card className="p-10 text-center">
        <div className="text-4xl">🌐</div>
        <div className="display mt-3 text-lg font-semibold">{game.gcn?.name} is open for business</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-dim">
          Nothing has been built yet. Fund the treasury from your own club, then buy or found your
          first club, appoint a board, and put hubs on the map.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="The empire">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Clubs owned"
            value={`${ov.clubCount} / ${ov.clubCap}`}
            sub={`${empire.countries.length} ${empire.countries.length === 1 ? "country" : "countries"}`}
          />
          <Stat
            label="Players"
            value={String(ov.totalPlayers)}
            sub={empire.avgOverall > 0 ? `${empire.avgOverall} avg OVR` : undefined}
          />
          <Stat label="Squad value" value={formatMoney(empire.squadValue)} />
          <Stat
            label="Leading its league"
            value={`${empire.leadingLeagues} / ${ov.clubCount}`}
          />
        </div>
      </Section>

      {/* The weekly ledger. One card rather than a paragraph of inline figures:
          the network has several income and outflow lines, and a sentence can
          hold about two. Every line here is a term `gcnWeeklyTick` actually
          debits or credits — see `gcnEmpire`, which is where the arithmetic
          lives so the dashboard can't disagree with the simulation. */}
      <Section title="The week">
        <Card className="divide-y divide-line/50">
          <Row label="Clubs' own trading">
            <Net value={empire.clubsNet} suffix=" / wk" />
          </Row>
          {execOut > 0 && (
            <Row label={`Executive wages (${seats.length})`}>
              <Net value={-execOut} suffix=" / wk" />
            </Row>
          )}
          {hubOut > 0 && (
            <Row label={`Hub upkeep & youth wages (${hubList.length})`}>
              <Net value={-hubOut} suffix=" / wk" />
            </Row>
          )}
          {autoOut > 0 && (
            <Row label="Standing orders">
              <Net value={-autoOut} suffix=" / wk" />
            </Row>
          )}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="display font-semibold">Network net</span>
            <span className="display text-base font-bold">
              <Net value={empire.totalNet} suffix=" / wk" />
            </span>
          </div>
        </Card>
        {/* The cover read is only news when the runway is SHORT. A trivial loss
            against a large treasury produces figures like "55,011 weeks", which
            is not a warning — it is noise wearing a warning's clothes. Two
            seasons is the horizon at which a manager can still do something,
            which is the same threshold the club-level alert uses. */}
        {empire.totalNet < 0 && game.gcn && (
          (() => {
            const weeks = Math.max(0, Math.floor(game.gcn.treasury / -empire.totalNet));
            if (weeks > 104) return null;
            return (
              <p className="mt-2 text-[11px] text-loss">
                Running at a loss — the treasury&apos;s{" "}
                <span className="tnum">{formatMoney(game.gcn.treasury)}</span> covers about{" "}
                <span className="tnum">{weeks}</span> more {weeks === 1 ? "week" : "weeks"} at this
                rate.
              </p>
            );
          })()
        )}
      </Section>

      {/* The boardroom and the map, summarised. Both are whole tabs of their
          own; what belongs on a dashboard is only whether they are staffed. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Boardroom">
          <div className="space-y-1.5">
            {GCN_EXEC_ROLES.map((spec) => {
              const exec = executiveIn(game, spec.id);
              const fx = execEffect(game, spec.id, TUNING);
              return (
                <div
                  key={spec.id}
                  className="flex items-center gap-2.5 rounded border border-line bg-raised px-3 py-2"
                >
                  <span className="text-base leading-none">{spec.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="display truncate text-[12px] font-semibold">{spec.title}</div>
                    <div className="truncate text-[11px] text-faint">
                      {exec ? exec.name : <span className="text-loss">Vacant</span>}
                    </div>
                  </div>
                  <span className={`display tnum text-sm font-bold ${fx.filled ? "gold-text" : "text-faint"}`}>
                    {fx.total > 0 ? `+${fx.total.toFixed(1)}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Scouting hubs">
          {hubList.length === 0 ? (
            <Card className="p-5 text-center text-[12px] text-dim">
              No hubs on the map yet. A hub finds and develops talent in its region continuously —
              far past what club scouting reaches.
            </Card>
          ) : (
            <div className="space-y-1.5">
              {hubList.map((h) => {
                const def = hubRegion(h.region);
                return (
                  <div
                    key={h.region}
                    className="flex items-center gap-2.5 rounded border border-line bg-raised px-3 py-2"
                  >
                    <span className="text-base leading-none">🛰️</span>
                    <div className="min-w-0 flex-1">
                      <div className="display truncate text-[12px] font-semibold">{def?.label ?? h.region}</div>
                      <div className="truncate text-[11px] text-faint">
                        Level {h.level} · {hubHeadcount(game, h.region)}/
                        {hubCapacity(h.level, TUNING)} on the books
                      </div>
                    </div>
                  </div>
                );
              })}
              {prospects.length > 0 && (
                <p className="pt-0.5 text-[11px] text-faint">
                  {prospects.length} {prospects.length === 1 ? "prospect" : "prospects"} developing
                  across the network&apos;s hubs.
                </p>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Needs attention (v1.88). An empire of a dozen clubs is too big to audit
          club by club, so the clubs in trouble come to the manager instead. */}
      {empire.alerts.length > 0 && (
        <Section title="Needs attention">
          <div className="space-y-1.5">
            {empire.alerts.map((a) => (
              <div
                key={`${a.clubId}:${a.kind}`}
                className="flex items-center gap-2.5 rounded border border-line bg-raised px-3 py-2"
              >
                <span className="text-base leading-none">{ALERT_ICON[a.kind]}</span>
                <span className="display min-w-0 flex-1 truncate text-sm font-semibold">{a.name}</span>
                <span className="truncate text-[11px] text-faint">{a.detail}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Clubs ────────────────────────────────────────────────────────────────────

/** What an expanded club row shows. */
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
  const [open, setOpen] = useState<{ clubId: string; panel: ClubPanel } | null>(null);
  const [action, setAction] = useState<"found" | "buy" | "sell" | "move" | null>(null);
  const clubIds = game.gcn?.clubIds ?? [];
  const cap = groupClubsCap(game, TUNING);
  const atCap = clubIds.length >= cap;

  return (
    <div className="space-y-4">
      {/* Expansion sits at the top of the tab that owns it (v1.95), not behind a
          card on a dashboard. */}
      <div className="flex flex-wrap items-center gap-2">
        <GoldButton onClick={() => setAction("buy")}>Buy a club</GoldButton>
        <GhostButton onClick={() => setAction("found")}>Found a club</GhostButton>
        <GhostButton onClick={() => setAction("move")}>Move a player</GhostButton>
        {clubIds.length > 0 && <GhostButton onClick={() => setAction("sell")}>Sell a club</GhostButton>}
        <span className="ml-auto text-[11px] text-faint">
          <span className="tnum text-ink">
            {clubIds.length} / {cap}
          </span>{" "}
          club slots used
          {atCap && <> — raise Group Clubs in Operations</>}
        </span>
      </div>

      {clubIds.length === 0 ? (
        <Card className="p-8 text-center text-dim">
          No clubs in the network yet. Buy an existing side, or found one from nothing in a league&apos;s
          lowest division.
        </Card>
      ) : (
        <div className="space-y-2">
          {clubIds.map((id) => {
            const t = game.teams[id];
            if (!t) return null;
            const league = game.leagues[t.leagueId];
            const standing = clubStanding(game, id);
            const fin = gcnClubFinance(game, id, TUNING);
            const isOpen = open?.clubId === id;
            const held = seasonsUntilSellable(game, id, TUNING);
            return (
              <Card key={id} className="overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : { clubId: id, panel: "squad" })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                >
                  <Crest team={t} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="display flex items-center gap-1.5 text-sm font-semibold">
                      <span className="truncate">{t.name}</span>
                      {isRingFenced(game, id) && <RingFenceBadge />}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-faint">
                      {league && <CountryFlag country={league.country} size={11} />}
                      <span className="truncate">{league?.name}</span>
                      {held > 0 && (
                        <span title={`Minimum hold — sellable from S${game.season + held}`}>
                          · held {held}
                          {held === 1 ? " season" : " seasons"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="hidden text-right text-[11px] text-faint sm:block">
                    <div>
                      <span className="uppercase tracking-widest">Pos </span>
                      <span className="tnum text-ink">{standing ? `${standing.pos}/${standing.of}` : "—"}</span>
                    </div>
                    <div>
                      <span className="uppercase tracking-widest">Net </span>
                      {fin ? <Net value={fin.net} /> : <span className="text-ink">—</span>}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-faint">
                    <div className="uppercase tracking-widest">Funds</div>
                    <div className="display tnum text-sm font-bold text-ink">{formatMoney(t.budget)}</div>
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
                            open.panel === p.id
                              ? "gold-grad text-[#14120a]"
                              : "border border-line text-dim hover:text-ink"
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
      )}

      {action === "found" && <FoundClubModal onClose={() => setAction(null)} />}
      {action === "buy" && <BuyClubModal onClose={() => setAction(null)} />}
      {action === "sell" && <SellClubModal onClose={() => setAction(null)} />}
      {action === "move" && <MovePlayerModal onClose={() => setAction(null)} />}
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

  if (squad.length === 0) return <p className="py-4 text-center text-sm text-faint">No players.</p>;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {squad.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-raised">
            <button onClick={() => viewPlayer(p.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <PlayerLine p={p} />
            </button>
            <span className="tnum shrink-0 text-[11px] text-faint">
              {formatMoney(gcnPlayerSalePrice(game, p.id, TUNING))}
            </span>
            <ConfirmButton
              label="Sell"
              confirmLabel="Confirm"
              disabled={atMin || !!p.loan}
              onConfirm={() => sellPlayerAction(p.id)}
              className="!px-2 !py-1 !text-[11px]"
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {atMin ? (
          <span className="text-loss">
            This squad is down to the {TUNING.gcnSellMinSquadSize}-player minimum — nothing more can be
            sold.
          </span>
        ) : (
          <>
            A sale banks {Math.round(TUNING.gcnSellPlayerPriceFactor * 100)}% of the player&apos;s market
            value into <span className="text-ink">this club&apos;s</span> budget, and he leaves as a free
            agent. Squads can&apos;t drop below {TUNING.gcnSellMinSquadSize} players.
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

/** A club's weekly finances, laid out the way the Finances page reads: the
 * headline budget, then income and expenses broken into their parts (v1.62). */
function FinancePanel({ fin }: { fin: GcnClubFinance }) {
  const rows: { label: string; amount: number }[] = [
    { label: "TV & prize money", amount: fin.tvIncome },
    { label: "League position bonus", amount: fin.positionBonus },
    { label: "Matchday gate", amount: fin.gateIncome },
    { label: "Income upgrades", amount: fin.facilityIncome },
    { label: "Sponsorship", amount: fin.sponsorIncome },
    // A sim-league club can't itemise the three lines above — it has no fixture
    // table and no facilities — so its trading week arrives as one figure
    // (v1.88). Before that it showed nothing at all, and the panel read £0 in.
    { label: "Matchday & commercial", amount: fin.simTradingIncome },
    { label: "Solidarity payment", amount: fin.solidarityIncome },
    { label: "Network funding", amount: fin.networkIncome },
    { label: "Player wages", amount: -fin.wageBill },
    { label: "Staff wages", amount: -fin.staffWages },
  ].filter((r) => r.amount !== 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Funds" value={formatMoney(fin.budget)} gold />
        <Stat label="Income / wk" value={formatMoney(fin.income)} />
        <Stat label="Spend / wk" value={formatMoney(fin.expenses)} />
        <Stat
          label="Net / wk"
          value={`${fin.net >= 0 ? "+" : "−"}${formatMoney(Math.abs(fin.net))}`}
          tone={fin.net >= 0 ? "win" : "loss"}
        />
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
          This club plays in a simulated league, so its trading week is abstracted into a single
          matchday-and-commercial figure rather than itemised — there is no fixture table to draw a
          position bonus from. The money is real: it is banked, and the wages are charged, every week.
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
          This club plays in a simulated league — its table fills in once the season&apos;s rounds have
          been resolved.
        </p>
      )}
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
        <p className="text-[11px] text-loss">A club needs a name, a stadium, and a 2–4 letter abbreviation.</p>
      )}
    </div>
  );
}

// ── Expansion modals ─────────────────────────────────────────────────────────

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
          A new club takes over a slot in a league&apos;s lowest division, replacing an existing side,
          and starts with a freshly-built low-quality squad to grow from the bottom.
        </p>
        <Field label="League">
          <Select
            value={leagueId}
            options={leagues.map((l) => ({ value: l.leagueId, label: `${l.name} · ${l.country}` }))}
            onChange={setLeagueId}
            className="w-full"
          />
        </Field>
        <Field label="Club name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={48}
            autoFocus
            placeholder="e.g. Aurora City"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold"
          />
        </Field>
        <div className="flex items-center justify-between border-t border-line/60 pt-3">
          <span className="text-sm text-dim">
            Cost{" "}
            <span className={`display tnum font-bold ${affordable ? "gold-text" : "text-loss"}`}>
              {formatMoney(cost)}
            </span>
          </span>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <GoldButton
              disabled={!canConfirm}
              onClick={() => {
                foundClubAction(leagueId, name);
                onClose();
              }}
            >
              Found club
            </GoldButton>
          </div>
        </div>
        {atCap ? (
          <p className="text-[11px] text-loss">
            The network already holds its limit of {cap} clubs — raise Group Clubs in Operations first.
          </p>
        ) : (
          !affordable && <p className="text-[11px] text-loss">The treasury can&apos;t afford this yet.</p>
        )}
      </div>
    </Modal>
  );
}

function BuyClubModal({ onClose }: { onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
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
    .filter(
      ({ team, league }) =>
        !q ||
        team.name.toLowerCase().includes(q) ||
        league?.name.toLowerCase().includes(q) ||
        league?.country.toLowerCase().includes(q)
    )
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
          <span className="text-ink">ring-fenced</span> holdings: no network funding, no feeder
          loans, no players moving to or from your own squad — and never a club in your own division.
          They may trade with each other, at market value. You own the balance sheet, not the
          sporting advantage.
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
                <Crest team={team} size={28} />
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
                <GoldButton disabled={!afford || atCap} onClick={() => buy(team.id)}>
                  Buy
                </GoldButton>
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
  const held = clubId ? seasonsUntilSellable(game, clubId, TUNING) : 0;

  if (clubIds.length === 0) {
    return (
      <Modal title="Sell a club" onClose={onClose}>
        <p className="py-6 text-center text-sm text-dim">The network doesn&apos;t own any clubs to sell.</p>
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
            onChange={(id) => {
              setClubId(id);
              setConfirming(false);
            }}
          />
        </div>

        {club && held > 0 && (
          <p className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-[11px] leading-relaxed text-loss">
            {club.name} is inside its {TUNING.gcnMinHoldSeasons}-season minimum hold. The network
            can&apos;t sell it until season <span className="tnum">{game.season + held}</span> — {held}{" "}
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
              <GoldButton
                onClick={() => {
                  sell(clubId!);
                  onClose();
                }}
              >
                Confirm sale
              </GoldButton>
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

/** The inter-club transfer & feeder-loan console — the heart of the network:
 * move a player between any two network clubs (the manager's own included, in
 * either direction), or send one of your own out on a guaranteed feeder loan. */
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
  // The legality question is `networkMoveError`'s, never this component's:
  // React must not re-implement a rule the engine owns.
  const allDestinations = netIds.filter(
    (id) => id !== fromClub && !networkMoveError(game, fromClub, id, TUNING)
  );
  // A feeder loan still only points at an owned club (your own club isn't a
  // feeder), and never at a ring-fenced one.
  const destinations =
    mode === "feeder"
      ? allDestinations.filter((id) => id !== game.userTeamId && !isRingFenced(game, id))
      : allDestinations;
  const feederAllowed = fromClub === game.userTeamId;

  const toValid = toClub && destinations.includes(toClub) ? toClub : null;
  const fee =
    mode === "transfer" && playerId && toValid
      ? networkTransferFee(game, playerId, fromClub, toValid, TUNING)
      : 0;
  const buyerBudget = toValid ? game.teams[toValid]?.budget ?? 0 : 0;
  const affordable = fee === 0 || buyerBudget >= fee;

  const commit = () => {
    if (!playerId || !toValid) return;
    if (mode === "feeder") sendFeeder(playerId, toValid, role);
    else movePlayer(playerId, toValid);
    onClose();
  };

  return (
    <Modal title="Move a player" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">From</span>
          <ClubPicker
            clubIds={netIds}
            value={fromClub}
            onChange={(id) => {
              setFromClub(id);
              setPlayerId(null);
              setToClub(null);
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">Player</span>
          <PlayerPicker players={squad} value={playerId} onChange={setPlayerId} />
        </div>

        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">To</span>
          <ClubPicker
            clubIds={destinations}
            value={toValid}
            onChange={setToClub}
            placeholder="— destination club —"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
          <button
            onClick={() => setMode("transfer")}
            className={`rounded px-3 py-1.5 text-sm ${
              mode === "transfer" ? "gold-grad text-[#14120a]" : "border border-line text-dim"
            }`}
          >
            Permanent transfer
          </button>
          <button
            onClick={() => feederAllowed && setMode("feeder")}
            disabled={!feederAllowed}
            className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${
              mode === "feeder" ? "gold-grad text-[#14120a]" : "border border-line text-dim"
            }`}
            title={feederAllowed ? "" : "Only your own players can be sent on a feeder loan"}
          >
            Feeder loan
          </button>
          {mode === "feeder" && (
            <Select
              value={role}
              options={[
                { value: "starter" as const, label: "Guaranteed starter" },
                { value: "rotation" as const, label: "Rotation" },
              ]}
              onChange={setRole}
            />
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          {mode === "feeder" ? (
            "A feeder loan sends the player to an owned club that guarantees his minutes — reliable development you don't get loaning to a stranger."
          ) : fee > 0 ? (
            <>
              Both clubs are in your own country, so this move is priced at market value:{" "}
              <span className="tnum text-ink">{formatMoney(fee)}</span> moves from{" "}
              {game.teams[toValid!]?.name} to {fromTeam?.name}. Domestic holdings deal at arm&apos;s
              length — free transfers between them would be the fixing the ring fence exists to stop.
            </>
          ) : (
            "A permanent transfer between your own clubs abroad is free — no money leaves the network. Your own club can be either end of the move."
          )}
        </p>

        <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-3">
          <span className="text-[11px] text-faint">
            {fee > 0 && (
              <>
                Buyer&apos;s funds{" "}
                <span className={`tnum ${affordable ? "text-ink" : "text-loss"}`}>
                  {formatMoney(buyerBudget)}
                </span>
              </>
            )}
          </span>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <GoldButton disabled={!playerId || !toValid || !affordable} onClick={commit}>
              {mode === "feeder"
                ? "Send on feeder loan"
                : fee > 0
                  ? `Transfer for ${formatMoney(fee)}`
                  : "Transfer within network"}
            </GoldButton>
          </div>
        </div>
        {fee > 0 && !affordable && (
          <p className="text-[11px] text-loss">
            {game.teams[toValid!]?.name} can&apos;t afford this fee — fund the club first.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ── Players ──────────────────────────────────────────────────────────────────
// Every player the network owns, in one place (v1.95).
//
// This tab exists because the network's players were previously only reachable
// club by club, inside an expanded row on the Clubs tab — so "who are the best
// under-21s anywhere in my empire" was a question you answered by opening twelve
// accordions and remembering. An empire that spans a dozen squads needs a
// squad-list view of its own.
//
// The manager's OWN club is deliberately excluded: he has a Squad screen for
// that, and mixing the two would make every filter here ambiguous about which
// team it was describing.

type PlayerSort = "overall" | "potential" | "age" | "value" | "name";

interface PlayerFilters {
  club: string;
  pos: string;
  league: string;
  cls: string;
  archetype: string;
  maxAge: string;
  minOverall: string;
  query: string;
}

const EMPTY_FILTERS: PlayerFilters = {
  club: "all",
  pos: "all",
  league: "all",
  cls: "all",
  archetype: "all",
  maxAge: "all",
  minOverall: "all",
  query: "",
};

/** Broad position groups, so "show me the defenders" is one click rather than
 * three. The specific positions follow, because a manager shopping for a right
 * back means a right back. */
const POS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All positions" },
  { value: "g:GK", label: "Goalkeepers" },
  { value: "g:DEF", label: "Defenders" },
  { value: "g:MID", label: "Midfielders" },
  { value: "g:ATT", label: "Attackers" },
  ...(["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"] as Pos[]).map((p) => ({
    value: p,
    label: p,
  })),
];

const POS_GROUP_MEMBERS: Record<string, Pos[]> = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB"],
  MID: ["DM", "CM", "LM", "RM", "AM"],
  ATT: ["LW", "RW", "ST"],
};

function PlayersTab() {
  const game = useGame((s) => s.game)!;
  // The store's revision counter is the memo key below: `game` is mutated in
  // place, so its identity never changes and a `[game]` dependency would cache
  // the first render's list forever.
  const rev = useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const [f, setF] = useState<PlayerFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<PlayerSort>("overall");
  const [grouped, setGrouped] = useState(false);

  const clubIds = game.gcn?.clubIds ?? [];

  /** Every network player, with the derived facts the filters read, computed
   * once per render rather than per filter pass — `deriveArchetype` walks 35
   * attributes and a list of a dozen squads would otherwise run it on every
   * keystroke in the search box. */
  const rows = useMemo(() => {
    const out: {
      p: PlayerBio;
      clubId: string;
      clubName: string;
      leagueId: string;
      leagueName: string;
      country: string;
      archetypeId?: string;
      archetypeName?: string;
      cls?: string;
    }[] = [];
    for (const clubId of clubIds) {
      const t = game.teams[clubId];
      if (!t) continue;
      const league = game.leagues[t.leagueId];
      for (const pid of t.playerIds) {
        const p = game.players[pid];
        if (!p || p.retired) continue;
        const arch = p.attrs ? deriveArchetype(p.attrs, p.positions[0]) : undefined;
        out.push({
          p,
          clubId,
          clubName: t.name,
          leagueId: t.leagueId,
          leagueName: league?.name ?? t.leagueId,
          country: league?.country ?? "",
          archetypeId: arch?.id,
          archetypeName: arch?.name,
          cls: arch?.cls,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, rev, clubIds.join(",")]);

  // Filter option lists are built from what the network ACTUALLY holds, not from
  // the full tables — a dropdown offering forty archetypes when the empire
  // contains eight is a worse control than one offering eight.
  const leagueOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.leagueId, r.leagueName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const classOpts = useMemo(
    () => [...new Set(rows.map((r) => r.cls).filter(Boolean))].sort() as string[],
    [rows]
  );
  const archetypeOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.archetypeId) seen.set(r.archetypeId, r.archetypeName ?? r.archetypeId);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const q = f.query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (f.club !== "all" && r.clubId !== f.club) return false;
    if (f.league !== "all" && r.leagueId !== f.league) return false;
    if (f.cls !== "all" && r.cls !== f.cls) return false;
    if (f.archetype !== "all" && r.archetypeId !== f.archetype) return false;
    if (f.maxAge !== "all" && r.p.age > Number(f.maxAge)) return false;
    if (f.minOverall !== "all" && r.p.overall < Number(f.minOverall)) return false;
    if (f.pos !== "all") {
      const group = f.pos.startsWith("g:") ? POS_GROUP_MEMBERS[f.pos.slice(2)] : null;
      const ok = group
        ? r.p.positions.some((p) => group.includes(p))
        : r.p.positions.includes(f.pos as Pos);
      if (!ok) return false;
    }
    if (q && !r.p.name.toLowerCase().includes(q) && !r.clubName.toLowerCase().includes(q)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case "potential":
        return (b.p.potential ?? 0) - (a.p.potential ?? 0);
      case "age":
        return a.p.age - b.p.age;
      case "value":
        return (b.p.value ?? 0) - (a.p.value ?? 0);
      case "name":
        return a.p.name.localeCompare(b.p.name);
      default:
        return b.p.overall - a.p.overall;
    }
  });

  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  if (clubIds.length === 0) {
    return (
      <Card className="p-8 text-center text-dim">
        The network owns no clubs, so it owns no players. Buy or found a club on the{" "}
        <span className="text-ink">Clubs</span> tab.
      </Card>
    );
  }

  // Grouped-by-club rendering keeps each club's players together under its own
  // crest; ungrouped is one flat ranked list across the whole empire. Both read
  // the same filtered set, so a filter never means two different things.
  const byClub = new Map<string, typeof sorted>();
  if (grouped) {
    for (const r of sorted) {
      if (!byClub.has(r.clubId)) byClub.set(r.clubId, []);
      byClub.get(r.clubId)!.push(r);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2.5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={f.query}
            onChange={(e) => setF({ ...f, query: e.target.value })}
            placeholder="Search player or club…"
            className="min-w-[180px] flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-gold"
          />
          <Select
            value={sort}
            options={[
              { value: "overall" as const, label: "Sort: Overall" },
              { value: "potential" as const, label: "Sort: Potential" },
              { value: "age" as const, label: "Sort: Age" },
              { value: "value" as const, label: "Sort: Value" },
              { value: "name" as const, label: "Sort: Name" },
            ]}
            onChange={setSort}
          />
          <button
            onClick={() => setGrouped((g) => !g)}
            className={`rounded px-3 py-1.5 text-[12px] transition-colors ${
              grouped ? "gold-grad text-[#14120a]" : "border border-line text-dim hover:text-ink"
            }`}
            title="Group the list under each club's crest"
          >
            By club
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={f.club}
            options={[
              { value: "all", label: "All clubs" },
              ...clubIds
                .map((id) => ({ value: id, label: game.teams[id]?.name ?? id }))
                .sort((a, b) => a.label.localeCompare(b.label)),
            ]}
            onChange={(v) => setF({ ...f, club: v })}
          />
          <Select
            value={f.pos}
            options={POS_FILTERS}
            onChange={(v) => setF({ ...f, pos: v })}
          />
          <Select
            value={f.league}
            options={[
              { value: "all", label: "All leagues" },
              ...leagueOpts.map(([id, label]) => ({ value: id, label })),
            ]}
            onChange={(v) => setF({ ...f, league: v })}
          />
          {classOpts.length > 1 && (
            <Select
              value={f.cls}
              options={[
                { value: "all", label: "All classes" },
                ...classOpts.map((c) => ({ value: c, label: c })),
              ]}
              onChange={(v) => setF({ ...f, cls: v })}
            />
          )}
          {archetypeOpts.length > 1 && (
            <Select
              value={f.archetype}
              options={[
                { value: "all", label: "All roles" },
                ...archetypeOpts.map(([id, label]) => ({ value: id, label })),
              ]}
              onChange={(v) => setF({ ...f, archetype: v })}
            />
          )}
          <Select
            value={f.maxAge}
            options={[
              { value: "all", label: "Any age" },
              { value: "21", label: "U21" },
              { value: "23", label: "U23" },
              { value: "26", label: "U26" },
              { value: "30", label: "U30" },
            ]}
            onChange={(v) => setF({ ...f, maxAge: v })}
          />
          <Select
            value={f.minOverall}
            options={[
              { value: "all", label: "Any rating" },
              { value: "70", label: "70+" },
              { value: "75", label: "75+" },
              { value: "80", label: "80+" },
              { value: "85", label: "85+" },
            ]}
            onChange={(v) => setF({ ...f, minOverall: v })}
          />
          {dirty && (
            <GhostButton onClick={() => setF(EMPTY_FILTERS)} className="!px-2 !py-1 !text-[11px]">
              Clear
            </GhostButton>
          )}
          <span className="ml-auto text-[11px] text-faint">
            <span className="tnum text-ink">{sorted.length}</span> of{" "}
            <span className="tnum">{rows.length}</span>
          </span>
        </div>
      </Card>

      {sorted.length === 0 ? (
        <Card className="p-8 text-center text-sm text-dim">No players match those filters.</Card>
      ) : grouped ? (
        <div className="space-y-4">
          {[...byClub.entries()].map(([clubId, list]) => {
            const t = game.teams[clubId];
            return (
              <div key={clubId}>
                <div className="mb-1.5 flex items-center gap-2">
                  {t && <Crest team={t} size={22} />}
                  <span className="display text-sm font-semibold">{t?.name}</span>
                  <span className="text-[11px] text-faint">
                    {list.length} {list.length === 1 ? "player" : "players"}
                  </span>
                </div>
                <Card className="divide-y divide-line/40">
                  {list.map((r) => (
                    <NetworkPlayerRow key={r.p.id} row={r} onOpen={() => viewPlayer(r.p.id)} showClub={false} />
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="divide-y divide-line/40">
          {sorted.map((r) => (
            <NetworkPlayerRow key={r.p.id} row={r} onOpen={() => viewPlayer(r.p.id)} showClub />
          ))}
        </Card>
      )}
    </div>
  );
}

function NetworkPlayerRow({
  row,
  onOpen,
  showClub,
}: {
  row: {
    p: PlayerBio;
    clubId: string;
    clubName: string;
    country: string;
    archetypeName?: string;
    cls?: string;
  };
  onOpen: () => void;
  showClub: boolean;
}) {
  const game = useGame((s) => s.game)!;
  const { p } = row;
  const t = game.teams[row.clubId];
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover">
      <PosBadge pos={p.positions[0]} />
      <Flag nat={p.nationality} size={12} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{p.name}</div>
        <div className="flex items-center gap-1.5 truncate text-[11px] text-faint">
          {showClub && t && (
            <>
              <Crest team={t} size={12} />
              <span className="truncate">{row.clubName}</span>
              <span>·</span>
            </>
          )}
          {row.archetypeName && <span className="truncate">{row.archetypeName}</span>}
        </div>
      </div>
      {row.cls && <ClassPill cls={row.cls as never} className="hidden sm:inline-flex" />}
      <span className="tnum w-8 shrink-0 text-right text-[11px] text-faint">{p.age}y</span>
      <span className="tnum hidden w-16 shrink-0 text-right text-[11px] text-faint sm:inline">
        {formatMoney(p.value ?? 0)}
      </span>
      <Ovr value={p.overall} size="sm" />
    </button>
  );
}

// ── International Scouting Hub ───────────────────────────────────────────────

type HubView = "map" | "reports" | "prospects";

function HubsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [view, setView] = useState<HubView>("map");
  const built = hubs(game);
  const reports = game.gcn?.hubReports ?? [];
  const prospects = hubProspects(game);

  const views: { id: HubView; label: string; badge?: number }[] = [
    { id: "map", label: "The map" },
    { id: "reports", label: "Reports", badge: reports.length || undefined },
    { id: "prospects", label: "Prospects", badge: prospects.length || undefined },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hubs" value={String(built.length)} gold sub={`of ${HUB_REGIONS.length} regions`} />
        <Stat
          label="On the books"
          value={String(prospects.length)}
          sub={built.length ? `${built.reduce((s, h) => s + hubCapacity(h.level, TUNING), 0)} places` : undefined}
        />
        <Stat label="Live reports" value={String(reports.length)} />
        <Stat
          label="Running cost"
          value={formatMoney(hubUpkeepWeekly(game, TUNING) + hubWageBill(game, TUNING))}
          sub="per week"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded px-3 py-1.5 text-[12px] transition-colors ${
              view === v.id ? "gold-grad text-[#14120a]" : "border border-line text-dim hover:text-ink"
            }`}
          >
            {v.label}
            {v.badge ? <span className="ml-1.5 tnum opacity-70">{v.badge}</span> : null}
          </button>
        ))}
      </div>

      {view === "map" && <HubMap />}
      {view === "reports" && <HubReports />}
      {view === "prospects" && <HubProspects />}
    </div>
  );
}

/** The map: a grid of regional cards, one per SCOUT_WORLD sub-region, grouped by
 * continent. Every region is shown whether or not a hub stands there — the point
 * of a map is what you could do next, not only what you have already done. */
function HubMap() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [open, setOpen] = useState<string | null>(null);

  const byContinent = useMemo(() => {
    const map = new Map<string, HubRegionDef[]>();
    for (const r of HUB_REGIONS) {
      if (!map.has(r.continentLabel)) map.set(r.continentLabel, []);
      map.get(r.continentLabel)!.push(r);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="space-y-5">
      {byContinent.map(([continent, regions]) => (
        <div key={continent}>
          {/* Same rule as the masthead: the thread is its own 1px element, sat
              under the label rather than applied to the row. */}
          <div className="mb-2">
            <div className="flex items-center gap-2 pb-1">
              <span className="display text-[12px] font-semibold uppercase tracking-[0.16em] text-dim">
                {continent}
              </span>
              <span className="text-[11px] text-faint">
                {regions.filter((r) => hubIn(game, r.id)).length} / {regions.length}
              </span>
            </div>
            <div className="gold-thread" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {regions.map((r) => (
              <HubRegionCard key={r.id} def={r} onOpen={() => setOpen(r.id)} />
            ))}
          </div>
        </div>
      ))}
      {open && <HubRegionModal region={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HubRegionCard({ def, onOpen }: { def: HubRegionDef; onOpen: () => void }) {
  const game = useGame((s) => s.game)!;
  const hub = hubIn(game, def.id);
  const presence = hasPresenceIn(game, def.id);
  const cost = hubBuildCost(game, def.id, TUNING);
  const affordable = (game.gcn?.treasury ?? 0) >= cost;

  return (
    <button
      onClick={onOpen}
      className={`relative overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors ${
        hub
          ? "border-gold/40 bg-raised hover:border-gold/70"
          : "border-line bg-surface hover:border-gold/40 hover:bg-hover"
      }`}
    >
      {/* A built hub wears the gold thread; an empty region reads as a site. */}
      {hub && <div className="gold-grad absolute inset-x-0 top-0 h-0.5" />}
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none">{hub ? (hub.paused ? "⏸️" : "🛰️") : "📍"}</span>
        <div className="min-w-0 flex-1">
          <div className="display flex items-center gap-1.5 truncate text-[13px] font-semibold">
            <span className="truncate">{def.label}</span>
            {/* A paused hub says so on the map, not only once you open it — it is
                still costing upkeep, which is the fact worth seeing from here. */}
            {hub?.paused && (
              <span className="display shrink-0 rounded-sm border border-gold-lo/50 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-gold">
                Paused
              </span>
            )}
          </div>
          {hub ? (
            <div className="mt-0.5 text-[11px] text-faint">
              <span className="text-gold">Level {hub.level}</span> ·{" "}
              <span className="tnum">
                {hubHeadcount(game, def.id)}/{hubCapacity(hub.level, TUNING)}
              </span>{" "}
              on the books
              {hub.focus && <span className="text-dim"> · briefed</span>}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-faint">
              <span className={affordable ? "tnum text-ink" : "tnum text-loss"}>{formatMoney(cost)}</span>{" "}
              to establish
              {presence && <span className="text-win"> · local presence</span>}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {def.nats.slice(0, 8).map((n) => (
          <Flag key={n} nat={n} size={11} />
        ))}
        {def.nats.length > 8 && <span className="text-[10px] text-faint">+{def.nats.length - 8}</span>}
      </div>
    </button>
  );
}

/** One region, opened: what a hub there is worth, what it costs, and the levers
 * on it. Build, upgrade, brief, pause and close all live here so a region is one
 * place rather than five lists. */
function HubRegionModal({ region, onClose }: { region: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const build = useGame((s) => s.gcnBuildHub);
  const upgrade = useGame((s) => s.gcnUpgradeHub);
  const close = useGame((s) => s.gcnCloseHub);
  const setPaused = useGame((s) => s.gcnSetHubPaused);
  const def = hubRegion(region);
  const hub = hubIn(game, region);
  const treasury = game.gcn?.treasury ?? 0;
  if (!def) return null;

  const buildCost = hubBuildCost(game, region, TUNING);
  const upCost = hubUpgradeCost(game, region, TUNING);
  const presence = hasPresenceIn(game, region);
  const level = hub?.level ?? 1;
  const nextLevel = Math.min(TUNING.gcnHubMaxLevel, level + 1);
  const onBooks = hubHeadcount(game, region);

  return (
    <Modal title={def.label} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {def.nats.map((n) => (
            <Flag key={n} nat={n} size={14} />
          ))}
        </div>

        {hub ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Level" value={`${hub.level} / ${TUNING.gcnHubMaxLevel}`} gold />
              <Stat label="On the books" value={`${onBooks} / ${hubCapacity(hub.level, TUNING)}`} />
              <Stat
                label="Files every"
                value={hub.paused ? "Paused" : `${hubReportDays(game, hub.level, TUNING)}d`}
              />
              <Stat
                label="Upkeep"
                value={formatMoney(hub.level * TUNING.gcnHubUpkeepPerLevel)}
                sub="per week"
              />
            </div>

            {/* A paused hub still costs what it cost — saying so here is the
                whole reason pausing is a decision rather than a free switch. */}
            {hub.paused && (
              <p className="rounded border border-gold-lo/50 bg-raised px-3 py-2 text-[11px] leading-relaxed text-gold">
                Scouting is paused — no reports are coming back. The hub keeps its level, its{" "}
                {onBooks} {onBooks === 1 ? "prospect" : "prospects"} and its full upkeep; restart it
                whenever you want the reports again.
              </p>
            )}

            <HubFocusPanel region={region} />

            {/* The level's effect, stated in the three units it actually moves.
                Read from the same functions the pipeline runs on, so the card
                can never promise a cadence the hub won't keep. */}
            <Card className="divide-y divide-line/50">
              <Row label="Scouting standard">
                <span className="tnum">
                  {hubJudgement(hub.level, TUNING).toFixed(1)}
                  {upCost !== null && (
                    <span className="text-faint"> → {hubJudgement(nextLevel, TUNING).toFixed(1)}</span>
                  )}
                  <span className="ml-1 text-[11px] text-faint">judgement</span>
                </span>
              </Row>
              <Row label="Development here">
                <span className="tnum">
                  ×{hubGrowthMult(hub.level, TUNING).toFixed(2)}
                  {upCost !== null && (
                    <span className="text-faint"> → ×{hubGrowthMult(nextLevel, TUNING).toFixed(2)}</span>
                  )}
                </span>
              </Row>
              <Row label="Capacity">
                <span className="tnum">
                  {hubCapacity(hub.level, TUNING)}
                  {upCost !== null && (
                    <span className="text-faint"> → {hubCapacity(nextLevel, TUNING)}</span>
                  )}
                </span>
              </Row>
              <Row label="Report cadence">
                <span className="tnum">
                  {hubReportDays(game, hub.level, TUNING)}d
                  {upCost !== null && (
                    <span className="text-faint"> → {hubReportDays(game, nextLevel, TUNING)}d</span>
                  )}
                </span>
              </Row>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
              <span className="text-sm text-dim">
                Treasury <span className="display gold-text tnum font-bold">{formatMoney(treasury)}</span>
              </span>
              <div className="flex gap-2">
                {/* Pause is the routine lever (v1.99); closing is not offered
                    here at all. "Stop the reports" and "demolish the building
                    and release everyone in it" are different decisions, and the
                    screen used to offer only the second — so a manager whose
                    board was simply full had no way to turn the tap off that
                    didn't cost him the hub. Closing lives below, behind its own
                    confirmation, where it reads as the last resort it is. */}
                <GhostButton
                  onClick={() => setPaused(region, !hub.paused)}
                  title={
                    hub.paused
                      ? "Start filing reports again"
                      : "Stop reports coming back. The hub, its prospects and its upkeep all stay."
                  }
                >
                  {hub.paused ? "Resume scouting" : "Pause scouting"}
                </GhostButton>
                {upCost !== null ? (
                  <GoldButton disabled={upCost > treasury} onClick={() => upgrade(region)}>
                    Upgrade — {formatMoney(upCost)}
                  </GoldButton>
                ) : (
                  <GhostButton disabled>Maximum level</GhostButton>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
              <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-faint">
                Pausing costs nothing and changes nothing but the reports. Closing the hub down
                returns nothing — the buildings stay where they were built, and every prospect on its
                books is released.
              </p>
              <ConfirmButton
                label="Close hub"
                confirmLabel="Confirm — no refund"
                onConfirm={() => {
                  close(region);
                  onClose();
                }}
                className="!px-3 !py-1.5 !text-[12px]"
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-dim">
              A hub in {def.label} finds and develops talent from the region continuously — no scout
              to send, no trip to pay for, and at a standard club scouting never reaches. Prospects
              it signs stay on the network&apos;s books: develop them at the hub, promote them into
              your own academy, or place them at an owned club in the region.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Establish" value={formatMoney(buildCost)} gold />
              <Stat label="Upkeep" value={formatMoney(TUNING.gcnHubUpkeepPerLevel)} sub="per week at L1" />
              <Stat label="Files every" value={`${hubReportDays(game, 1, TUNING)}d`} />
              <Stat label="Capacity" value={String(hubCapacity(1, TUNING))} sub="at level 1" />
            </div>
            {presence && (
              <p className="rounded border border-win/40 bg-win/10 px-3 py-2 text-[11px] leading-relaxed text-win">
                The network already owns a club in this region, so the build costs{" "}
                {Math.round(TUNING.gcnHubPresenceDiscount * 100)}% less. Local standing is what opens
                doors.
              </p>
            )}
            <div className="flex items-center justify-between border-t border-line/60 pt-3">
              <span className="text-sm text-dim">
                Treasury <span className="display gold-text tnum font-bold">{formatMoney(treasury)}</span>
              </span>
              <div className="flex gap-2">
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <GoldButton
                  disabled={buildCost > treasury}
                  onClick={() => {
                    build(region);
                    onClose();
                  }}
                >
                  Establish for {formatMoney(buildCost)}
                </GoldButton>
              </div>
            </div>
            {buildCost > treasury && (
              <p className="text-[11px] text-loss">The treasury can&apos;t afford this yet.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * A hub's standing brief (v1.99): country, position, archetype.
 *
 * Three things about the shape are deliberate:
 *
 *  - It commits per field, with no Save button. Same reason the bulk identity
 *    editor does (v1.97): each dropdown is one small, instantly reversible
 *    decision, and "changed it, it's changed" is honest where a page-wide save
 *    over three fields is just a chance to lose two of them.
 *  - The country list is the REGION's own countries and nothing else, and the
 *    archetype list is filtered by the chosen position. Both come from the rule
 *    module (`hubFocusError` / `positionsOfArchetype`), so the picker can't
 *    offer a brief the hub would then refuse.
 *  - It states the hit rate in plain words. A focus that silently only worked
 *    70% of the time would read as broken; said out loud it reads as scouting.
 */
function HubFocusPanel({ region }: { region: string }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setFocus = useGame((s) => s.gcnSetHubFocus);
  const def = hubRegion(region);
  const hub = hubIn(game, region);
  const focus = hub?.focus;
  if (!def || !hub) return null;

  const commit = (patch: Partial<GcnHubFocus>) => {
    const next: GcnHubFocus = { ...focus, ...patch };
    // An archetype the new position can't earn is dropped rather than left to
    // be refused — picking a position must never be blocked by a stale role.
    if (next.archetype && next.pos) {
      const arch = ARCHETYPE_MAP[next.archetype];
      if (arch && !positionsOfArchetype(arch).includes(next.pos)) delete next.archetype;
    }
    setFocus(region, next);
  };

  const posOptions: { value: string; label: string }[] = [
    { value: "", label: "Any position" },
    ...ALL_POS.map((p) => ({ value: p as string, label: p })),
  ];

  // Only roles that can actually be earned at the chosen position — an archetype
  // is its plan's position set, which is the roster's own answer.
  const archOptions = [
    { value: "", label: "Any role" },
    ...ARCHETYPE_ROSTER.filter(
      (a) => !focus?.pos || positionsOfArchetype(a).includes(focus.pos)
    )
      .map((a) => ({
        value: a.id,
        label: `${a.name} · ${positionsOfArchetype(a).join("/")}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  const named = [focus?.nat, focus?.pos, focus?.archetype].filter(Boolean).length;

  return (
    <Card className="space-y-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="display text-[12px] font-semibold uppercase tracking-[0.14em] text-dim">
          The brief
        </span>
        {named > 0 && (
          <button
            onClick={() => setFocus(region, {})}
            className="text-[11px] text-faint transition-colors hover:text-loss"
          >
            Clear brief
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Country">
          <Select
            value={focus?.nat ?? ""}
            options={[
              { value: "", label: `Anywhere in ${def.label}` },
              ...def.countries.map((c) => ({ value: c.id, label: c.label })),
            ]}
            onChange={(v) => commit({ nat: v || undefined })}
            ariaLabel="Country to focus on"
          />
        </Field>
        <Field label="Position">
          <Select
            value={focus?.pos ?? ""}
            options={posOptions}
            onChange={(v) => commit({ pos: (v || undefined) as Pos | undefined })}
            ariaLabel="Position to focus on"
          />
        </Field>
        <Field label="Archetype">
          <Select
            value={focus?.archetype ?? ""}
            options={archOptions}
            onChange={(v) => commit({ archetype: v || undefined })}
            ariaLabel="Archetype to focus on"
          />
        </Field>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {named === 0 ? (
          <>
            The hub reports whatever it finds across {def.label}. Name a country, a position or a
            role and it goes looking for that instead.
          </>
        ) : (
          <>
            A brief steers the scouts, it doesn&apos;t bind them — each thing you name is honoured
            about {Math.round(TUNING.gcnHubFocusHitChance * 100)}% of the time, so the hub still
            turns up the player nobody asked for.
            {focus?.archetype && (
              <> A role brief shapes his training and attributes, not a label on his profile.</>
            )}
          </>
        )}
      </p>
    </Card>
  );
}

/** The reports board: what every hub has turned up, newest first. */
function HubReports() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const sign = useGame((s) => s.gcnSignHubProspect);
  const dismiss = useGame((s) => s.gcnDismissHubReport);
  const reports = [...(game.gcn?.hubReports ?? [])].sort((a, b) => b.day - a.day);
  const treasury = game.gcn?.treasury ?? 0;

  if (hubs(game).length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-dim">
        No hubs are open, so nothing is being scouted. Establish one on the map.
      </Card>
    );
  }
  // "Nothing yet" and "you switched it off" are different answers and the board
  // used to give the first for both — a manager who paused every hub was told
  // the next batch was on its way.
  const allPaused = hubs(game).every((h) => h.paused);
  if (reports.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-dim">
        {allPaused
          ? "Every hub is paused, so nothing is being reported. Resume one on the map."
          : "Nothing on the board. The hubs file on their own clock — the next batch is on its way."}
      </Card>
    );
  }

  return (
    <div className="space-y-1.5">
      {reports.map((r) => (
        <HubReportRow
          key={r.id}
          report={r}
          treasury={treasury}
          onSign={() => sign(r.id)}
          onPass={() => dismiss(r.id)}
        />
      ))}
    </div>
  );
}

function HubReportRow({
  report,
  treasury,
  onSign,
  onPass,
}: {
  report: ProspectReport;
  treasury: number;
  onSign: () => void;
  onPass: () => void;
}) {
  const game = useGame((s) => s.game)!;
  const p = report.player;
  const def = report.region ? hubRegion(report.region) : undefined;
  const hub = report.region ? hubIn(game, report.region) : undefined;
  const full = hub ? hubHeadcount(game, report.region!) >= hubCapacity(hub.level, TUNING) : false;
  const tier = report.tier;
  const daysLeft = report.expiresDay - game.currentDay;

  return (
    <Card className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
      <PosBadge pos={p.positions[0]} />
      <Flag nat={p.nationality} size={13} />
      <div className="min-w-0 flex-1">
        <div className="display flex items-center gap-1.5 truncate text-sm font-semibold">
          <span className="truncate">{p.name}</span>
          {tier && (
            <span
              className="display shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{
                borderColor: `${TIER_COLOR[tier]}66`,
                color: TIER_COLOR[tier],
                backgroundColor: `${TIER_COLOR[tier]}14`,
              }}
            >
              {TIER_LABEL[tier]}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-faint">
          {p.age}y · {def?.label ?? report.region} hub · trail cold in {Math.max(0, daysLeft)}d
        </div>
      </div>
      <Ovr value={p.overall} size="sm" />
      <div className="display tnum shrink-0 text-sm font-bold text-ink">{formatMoney(report.fee)}</div>
      <div className="flex shrink-0 gap-1.5">
        <GhostButton onClick={onPass} className="!px-2 !py-1 !text-[11px]">
          Pass
        </GhostButton>
        <GoldButton
          disabled={report.fee > treasury || full}
          onClick={onSign}
          className="!px-2.5 !py-1 !text-[11px]"
        >
          {full ? "Hub full" : "Sign"}
        </GoldButton>
      </div>
    </Card>
  );
}

/** The prospects on the hubs' books, and the three things that can be done with
 * each: develop him where he is, place him at an owned club in his region, or
 * promote him into your own academy. */
function HubProspects() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const viewPlayer = useGame((s) => s.viewPlayer);
  const release = useGame((s) => s.gcnReleaseHubProspect);
  const promote = useGame((s) => s.gcnPromoteHubProspect);
  const [placing, setPlacing] = useState<string | null>(null);
  const [region, setRegion] = useState<string>("all");

  const all = hubProspects(game);
  const list = region === "all" ? all : all.filter((p) => p.gcnHubRegion === region);
  const regions = [...new Set(all.map((p) => p.gcnHubRegion).filter(Boolean))] as string[];

  if (all.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-dim">
        No prospects on the network&apos;s books. Sign one from the Reports board.
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {regions.length > 1 && (
        <div className="flex items-center gap-2">
          <Select
            value={region}
            options={[
              { value: "all", label: `All hubs (${all.length})` },
              ...regions.map((r) => ({
                value: r,
                label: `${hubRegion(r)?.label ?? r} (${all.filter((p) => p.gcnHubRegion === r).length})`,
              })),
            ]}
            onChange={setRegion}
          />
        </div>
      )}
      <div className="space-y-1.5">
        {list.map((p) => {
          const def = p.gcnHubRegion ? hubRegion(p.gcnHubRegion) : undefined;
          const hub = p.gcnHubRegion ? hubIn(game, p.gcnHubRegion) : undefined;
          const options = hubPlacementOptions(game, p.id);
          const ageOut = p.age >= TUNING.gcnHubMaxAge;
          return (
            <Card key={p.id} className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
              <button onClick={() => viewPlayer(p.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <PosBadge pos={p.positions[0]} />
                <Flag nat={p.nationality} size={13} />
                <div className="min-w-0 flex-1">
                  <div className="display truncate text-sm font-semibold">{p.name}</div>
                  <div className="truncate text-[11px] text-faint">
                    {p.age}y · {def?.label ?? p.gcnHubRegion}
                    {hub && <> · developing ×{hubGrowthMult(hub.level, TUNING).toFixed(2)}</>}
                    {ageOut && <span className="text-loss"> · ages out this summer</span>}
                  </div>
                </div>
                <Ovr value={p.overall} size="sm" />
              </button>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <GhostButton
                  onClick={() => setPlacing(p.id)}
                  disabled={options.length === 0}
                  className="!px-2 !py-1 !text-[11px]"
                  title={
                    options.length === 0
                      ? "The network owns no eligible club in this prospect's region"
                      : "Place him at an owned club in his own region"
                  }
                >
                  Place
                </GhostButton>
                <GhostButton onClick={() => promote(p.id)} className="!px-2 !py-1 !text-[11px]">
                  To academy
                </GhostButton>
                <ConfirmButton
                  label="Release"
                  confirmLabel="Confirm"
                  onConfirm={() => release(p.id)}
                  className="!px-2 !py-1 !text-[11px]"
                />
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        A hub prospect belongs to the network, not to a club. He develops faster at the hub than
        anywhere else, but he plays no football there — placing him at an owned club in his own
        region is what gets him minutes. He must be dealt with by {TUNING.gcnHubMaxAge}.
      </p>
      {placing && <PlaceProspectModal playerId={placing} onClose={() => setPlacing(null)} />}
    </div>
  );
}

function PlaceProspectModal({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const place = useGame((s) => s.gcnPlaceHubProspect);
  const p = game.players[playerId];
  const options = hubPlacementOptions(game, playerId);
  const [clubId, setClubId] = useState<string | null>(options[0] ?? null);
  if (!p) return null;
  const def = p.gcnHubRegion ? hubRegion(p.gcnHubRegion) : undefined;
  // The refusal reason is the rule's own — never re-derived here.
  const blocked = clubId ? hubPlacementError(game, playerId, clubId) : "Pick a club.";

  return (
    <Modal title={`Place ${p.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-dim">
          A {def?.label ?? "hub"} prospect may be placed at any club the network owns{" "}
          <span className="text-ink">in that region</span>. He joins the senior squad and starts
          playing — the hub develops him faster, but a club is where he gets minutes.
        </p>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-widest text-faint">Club</span>
          <ClubPicker clubIds={options} value={clubId} onChange={setClubId} />
        </div>
        {options.length === 0 && (
          <p className="rounded border border-loss/40 bg-loss/10 px-3 py-2 text-[11px] leading-relaxed text-loss">
            The network owns no eligible club in {def?.label ?? "this region"}. Buy or found one
            there, or promote him into your own academy instead.
          </p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-3">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton
            disabled={!!blocked}
            onClick={() => {
              place(playerId, clubId!);
              onClose();
            }}
          >
            Place at club
          </GoldButton>
        </div>
      </div>
    </Modal>
  );
}

// ── Treasury ─────────────────────────────────────────────────────────────────
// Everything about money, on one page (v1.95). Depositing, withdrawing, funding
// a club and setting a standing order were four separate dialogs behind four
// separate cards; they are four views of one question — where the network's cash
// should sit — and answering it meant opening them in turn and holding the
// figures in your head.

type TreasuryView = "flow" | "transfer" | "fund" | "orders";

function TreasuryTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const [view, setView] = useState<TreasuryView>("flow");
  const empire = gcnEmpire(game, TUNING);
  const treasury = game.gcn?.treasury ?? 0;
  const clubBudget = game.teams[game.userTeamId]?.budget ?? 0;

  const views: { id: TreasuryView; label: string }[] = [
    { id: "flow", label: "The books" },
    { id: "transfer", label: "Deposit / withdraw" },
    { id: "fund", label: "Fund a club" },
    { id: "orders", label: "Standing orders" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="GCN treasury" value={formatMoney(treasury)} gold />
        <Stat label={game.teams[game.userTeamId]?.name ?? "Your club"} value={formatMoney(clubBudget)} />
        <Stat label="Club budgets" value={formatMoney(gcnOverview(game, TUNING).totalClubBudgets)} />
        <Stat
          label="Network net / wk"
          value={`${empire.totalNet >= 0 ? "+" : "−"}${formatMoney(Math.abs(empire.totalNet))}`}
          tone={empire.totalNet >= 0 ? "win" : "loss"}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded px-3 py-1.5 text-[12px] transition-colors ${
              view === v.id ? "gold-grad text-[#14120a]" : "border border-line text-dim hover:text-ink"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "flow" && <TreasuryBooks />}
      {view === "transfer" && <TreasuryTransfer />}
      {view === "fund" && <FundClubPanel />}
      {view === "orders" && <AutoFundingPanel />}
    </div>
  );
}

/** The books: every line that moves the treasury in a week, and every owned
 * club's own net beneath it. */
function TreasuryBooks() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const autoOut = totalAutoFunding(game);
  const execOut = execWageBill(game);
  const upkeep = hubUpkeepWeekly(game, TUNING);
  const youthWages = hubWageBill(game, TUNING);
  // Every line is an outflow since v1.99: the treasury has no weekly income of
  // its own now that the two Operations tracks are gone. It is filled by
  // depositing from your club and by selling a holding.
  const treasuryNet = -autoOut - execOut - upkeep - youthWages;
  const treasury = game.gcn?.treasury ?? 0;
  const clubIds = game.gcn?.clubIds ?? [];

  const lines: { label: string; amount: number; note?: string }[] = [
    { label: "Executive wages", amount: -execOut },
    { label: "Hub upkeep", amount: -upkeep },
    { label: "Hub youth wages", amount: -youthWages },
    { label: "Standing orders", amount: -autoOut },
  ].filter((l) => l.amount !== 0);

  return (
    <div className="space-y-4">
      <Section title="Treasury, week by week">
        <Card className="divide-y divide-line/50">
          {lines.map((l) => (
            <div key={l.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-dim">
                {l.label}
                {l.note && <span className="ml-1.5 text-[11px] text-faint">{l.note}</span>}
              </span>
              <Net value={l.amount} />
            </div>
          ))}
          {lines.length === 0 && (
            <p className="px-3 py-4 text-center text-[12px] text-faint">
              Nothing moves the treasury yet — no board, no hubs, no standing orders.
            </p>
          )}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="display text-sm font-semibold">Treasury net</span>
            <span className="display text-base font-bold">
              <Net value={treasuryNet} suffix=" / wk" />
            </span>
          </div>
        </Card>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          The treasury earns nothing by itself — it is filled by depositing from your club and by
          selling a holding, and an owned club&apos;s own trading stays on that club&apos;s books.
          Wages and upkeep are owed whether or not the treasury can cover them; only standing orders
          are skipped in a week it can&apos;t.
          {/* Only shown when the runway is short enough to be a decision — see
              the same rule on Headquarters. */}
          {treasuryNet < 0 && Math.floor(treasury / -treasuryNet) <= 104 && (
            <>
              {" "}
              At this rate the treasury&apos;s{" "}
              <span className="gold-text tnum">{formatMoney(treasury)}</span> lasts about{" "}
              <span className="tnum text-ink">{Math.max(0, Math.floor(treasury / -treasuryNet))}</span>{" "}
              weeks.
            </>
          )}
        </p>
      </Section>

      {clubIds.length > 0 && (
        <Section title="Each club's own books">
          <Card className="divide-y divide-line/50">
            {clubIds.map((id) => {
              const t = game.teams[id];
              const fin = gcnClubFinance(game, id, TUNING);
              if (!t || !fin) return null;
              return (
                <div key={id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <Crest team={t} size={20} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="tnum hidden shrink-0 text-[11px] text-faint sm:inline">
                    {formatMoney(fin.budget)} in hand
                  </span>
                  <span className="shrink-0">
                    <Net value={fin.net} suffix=" / wk" />
                  </span>
                </div>
              );
            })}
          </Card>
        </Section>
      )}
    </div>
  );
}

/** The two-way pipe between the manager's own club and the network's war chest. */
/** The quick-amount ladder on the treasury transfer (v1.99). Absolute sums, not
 * shares of the balance — see the note at the buttons. */
const TRANSFER_STEPS = [1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000, 1_000_000_000];

function TreasuryTransfer() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const deposit = useGame((s) => s.gcnDeposit);
  const withdraw = useGame((s) => s.gcnWithdraw);
  const [dir, setDir] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState(0);

  const treasury = game.gcn?.treasury ?? 0;
  const clubBudget = game.teams[game.userTeamId]?.budget ?? 0;
  const source = dir === "in" ? clubBudget : treasury;
  const valid = amount > 0 && amount <= source;

  const commit = () => {
    if (!valid) return;
    if (dir === "in") deposit(amount);
    else withdraw(amount);
    setAmount(0);
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex gap-2">
        {(
          [
            { id: "in", label: "Club → Treasury" },
            { id: "out", label: "Treasury → Club" },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            onClick={() => {
              setDir(o.id);
              setAmount(0);
            }}
            className={`flex-1 rounded px-3 py-2 text-sm ${
              dir === o.id ? "gold-grad text-[#14120a]" : "border border-line text-dim hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label className="block text-[11px] uppercase tracking-widest text-faint">Amount</label>
        <MoneyInput
          value={amount}
          onChange={(n) => setAmount(Math.max(0, n))}
          showCurrency
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm tnum outline-none focus:border-gold"
        />
        {/* Absolute steps rather than percentages (v1.99). A share of the source
            is the wrong unit here: at an end-game treasury 10% and 25% are both
            "some enormous number", and the manager's actual question is "move
            fifty million", which took typing. The steps ADD to what is already
            in the box, so a figure is built up rather than replaced — that is
            what makes a short ladder cover the whole range, and it is why they
            read "+£10M" rather than "£10M". Each is clipped to what the source
            actually holds, so a step can never propose an illegal transfer. */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {TRANSFER_STEPS.map((step) => (
            <button
              key={step}
              disabled={amount >= source}
              onClick={() => setAmount(Math.min(source, amount + step))}
              className="rounded border border-line px-2 py-1 text-[11px] text-dim transition-colors hover:border-gold/50 hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-dim"
            >
              +{formatMoney(step)}
            </button>
          ))}
          <button
            onClick={() => setAmount(source)}
            className="rounded border border-line px-2 py-1 text-[11px] text-dim transition-colors hover:border-gold/50 hover:text-ink"
          >
            All
          </button>
          {amount > 0 && (
            <button
              onClick={() => setAmount(0)}
              className="rounded px-2 py-1 text-[11px] text-faint transition-colors hover:text-loss"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        {dir === "in"
          ? "Money moved into the treasury pays for everything the network does — buying clubs, founding them, establishing hubs, the boardroom's wages and Operations upgrades. It leaves your own transfer budget to do it."
          : "Money moved back out lands in your own club's transfer and wage budget. The network's commitments still have to be met from what's left."}
      </p>

      <div className="flex items-center justify-between border-t border-line/60 pt-3">
        <span className="text-sm text-dim">
          Available <span className="display tnum font-bold text-ink">{formatMoney(source)}</span>
        </span>
        <GoldButton disabled={!valid} onClick={commit}>
          {dir === "in" ? "Deposit" : "Withdraw"}
        </GoldButton>
      </div>
      {amount > source && (
        <p className="text-[11px] text-loss">
          {dir === "in" ? "Your club can't afford that deposit." : "The treasury doesn't hold that much."}
        </p>
      )}
    </Card>
  );
}

/** Top up an owned club's own budget, with its weekly finances on show so the
 * size of the cheque is an informed decision. */
function FundClubPanel() {
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
      <Card className="p-8 text-center text-sm text-dim">
        {(game.gcn?.clubIds.length ?? 0) > 0
          ? "Every club the network owns is ring-fenced in your own country — none of them can take network money."
          : "The network doesn't own any clubs yet — found or buy one first."}
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
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
        <GoldButton
          disabled={!canSend}
          onClick={() => {
            fund(clubId!, amount);
            setAmount(0);
          }}
        >
          Send funds
        </GoldButton>
      </div>
      {amount > treasury && <p className="text-[11px] text-loss">The treasury doesn&apos;t hold that much.</p>}
    </Card>
  );
}

/** A standing weekly order per owned club, paid out of the treasury every
 * Monday. Every owned club is listed at once — the point is to see the whole
 * commitment against what the treasury takes in. */
function AutoFundingPanel() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const setAuto = useGame((s) => s.gcnSetAutoFunding);
  const clubIds = fundableClubIds(game);
  const treasury = game.gcn?.treasury ?? 0;

  // A local draft so a half-typed figure isn't committed on every keystroke.
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(clubIds.map((id) => [id, autoFundingOf(game, id)]))
  );

  const committed = clubIds.reduce((s, id) => s + (draft[id] ?? 0), 0);
  // The other treasury outflows are part of this decision — a standing order
  // that looks affordable on its own may still not be, once the boardroom and
  // the hubs are paid.
  const fixed = execWageBill(game) + hubUpkeepWeekly(game, TUNING) + hubWageBill(game, TUNING);
  const net = -fixed - committed;
  const weeksOfCover = net < 0 ? Math.floor(treasury / -net) : null;
  const dirty = clubIds.some((id) => (draft[id] ?? 0) !== autoFundingOf(game, id));

  if (clubIds.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-dim">
        {(game.gcn?.clubIds.length ?? 0) > 0
          ? "Every club the network owns is ring-fenced in your own country — none of them can draw a standing order."
          : "The network doesn't own any clubs yet — found or buy one first."}
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-dim">
        Each owned club can draw a fixed sum from the treasury every week. A week the treasury
        can&apos;t cover an order, that order is simply skipped — nothing goes into the red. Set 0 to
        stop a club&apos;s payments.
      </p>

      <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
        {clubIds.map((id) => {
          const t = game.teams[id];
          if (!t) return null;
          const fin = gcnClubFinance(game, id, TUNING);
          return (
            <div key={id} className="flex items-center gap-3 rounded border border-line bg-raised px-3 py-2">
              <Crest team={t} size={26} />
              <div className="min-w-0 flex-1">
                <div className="display truncate text-sm font-semibold">{t.name}</div>
                <div className="text-[11px] text-faint">
                  Funds <span className="tnum text-ink">{formatMoney(t.budget)}</span>
                  {fin && (
                    <>
                      {" · net "}
                      <Net value={fin.net} suffix="/wk" />
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
        {fixed > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-dim">Executives &amp; hubs</span>
            <span className="tnum text-loss">−{formatMoney(fixed)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-dim">Committed per week</span>
          <span className="display tnum font-bold text-ink">{formatMoney(committed)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-dim">Treasury net per week</span>
          <span className="display text-base font-bold">
            <Net value={net} />
          </span>
        </div>
      </div>
      {weeksOfCover !== null && (
        <p className="text-[11px] text-faint">
          At this rate the treasury&apos;s <span className="gold-text tnum">{formatMoney(treasury)}</span>{" "}
          covers about <span className="tnum text-ink">{weeksOfCover}</span>{" "}
          {weeksOfCover === 1 ? "week" : "weeks"} of commitments.
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-line/60 pt-3">
        <GhostButton
          disabled={!dirty}
          onClick={() => setDraft(Object.fromEntries(clubIds.map((id) => [id, autoFundingOf(game, id)])))}
        >
          Reset
        </GhostButton>
        <GoldButton
          disabled={!dirty}
          onClick={() => {
            for (const id of clubIds) {
              if ((draft[id] ?? 0) !== autoFundingOf(game, id)) setAuto(id, draft[id] ?? 0);
            }
          }}
        >
          Save standing orders
        </GoldButton>
      </div>
    </Card>
  );
}

// ── Operations ───────────────────────────────────────────────────────────────
// The boardroom and the upgrade tracks. The boardroom leads: three seats is the
// shorter, more consequential list, and the tracks below are what the seats
// multiply.

function OperationsTab() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const upgradeGcn = useGame((s) => s.upgradeGcn);
  const [hiring, setHiring] = useState<GcnExecRole | null>(null);
  const treasury = game.gcn?.treasury ?? 0;
  const facilities = Object.keys(GCN_FACILITY_SPEC) as (keyof typeof GCN_FACILITY_SPEC)[];

  const icons: Record<string, string> = {
    groupClubs: "🏛️",
  };

  const owned = game.gcn?.clubIds.length ?? 0;
  const cap = groupClubsCap(game, TUNING);

  /** Each track states its effect in its own unit, so the card reads as what it
   * actually buys. One track since v1.99 — the two weekly-income tracks were
   * deleted; see `GcnFacility`. */
  const effects: Record<string, { now: string; next: string; note: (maxed: boolean) => string }> = {
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
  };

  return (
    <div className="space-y-6">
      {/* The boardroom (v1.95). Three seats, laid out as a boardroom table
          rather than a staff list — an executive is an appointment, not a hire
          off a shortlist of forty. */}
      <Section title="The boardroom">
        <div className="grid gap-2.5 lg:grid-cols-3">
          {GCN_EXEC_ROLES.map((spec) => (
            <ExecSeatCard key={spec.id} role={spec.id} onHire={() => setHiring(spec.id)} />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Executives are paid from the treasury, not from any club. Their effect is their star
          rating plus the badge they earn by SERVING — a five-star appointment reaches about half of
          a seat&apos;s ceiling on day one, and the rest is only ever earned by keeping someone in
          the chair for years.
        </p>
      </Section>

      <Section title="Network tracks">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <Stat label="Treasury available" value={formatMoney(treasury)} gold />
          <Stat label="Clubs owned" value={`${owned} / ${cap}`} />
        </div>
        <div className="space-y-4">
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
      </Section>

      {hiring && <ExecMarketModal role={hiring} onClose={() => setHiring(null)} />}
    </div>
  );
}

/** One seat at the boardroom table: who holds it, what they are worth, and how
 * far off the seat's ceiling that is. */
function ExecSeatCard({ role, onHire }: { role: GcnExecRole; onHire: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const dismiss = useGame((s) => s.gcnDismissExec);
  const spec = GCN_EXEC_ROLES.find((r) => r.id === role)!;
  const exec = executiveIn(game, role);
  const fx = execEffect(game, role, TUNING);
  const toNext = exec ? execSeasonsToNextBadge(TUNING, exec.seasonsServed) : null;
  const pct = fx.max > 0 ? Math.round((fx.total / fx.max) * 100) : 0;

  return (
    <Card className="relative overflow-hidden p-3.5">
      {exec && <div className="gold-grad absolute inset-x-0 top-0 h-0.5" />}
      <div className="flex items-start gap-2.5">
        <span className="text-xl leading-none">{spec.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="display text-[13px] font-semibold leading-tight">{spec.title}</div>
          <p className="mt-0.5 text-[11px] leading-snug text-faint">{spec.blurb}</p>
        </div>
      </div>

      <div className="my-3 border-t border-line/60" />

      {exec ? (
        <>
          <div className="flex items-center gap-2">
            <Flag nat={exec.nationality} size={13} />
            <span className="display min-w-0 flex-1 truncate text-sm font-semibold">{exec.name}</span>
            {exec.badge && <ExecBadge tier={exec.badge} seasons={exec.seasonsServed} />}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
            <Stars n={exec.stars} />
            <span className="tnum">{exec.age}y</span>
            <span className="tnum">{formatMoney(exec.wage)}/wk</span>
          </div>

          {/* The seat's arithmetic, shown rather than summarised — the same
              three terms `execEffect` returns, so the card can't quote a number
              the simulation won't use.
              v1.99: it used to print them as a bare sum ("5.0 seat + 15.0 stars
              + 10.5 badge"), which named the terms but not their UNIT or where
              any of them came from — three unlabelled numbers over a headline
              percentage, and no way to tell that "stars" meant his star rating
              times a per-star rate. Each term is now a labelled row that states
              what produced it, and the whole block says once, at the bottom,
              what the percentage is a percentage OF. */}
          <div className="mt-2.5 rounded border border-line bg-raised px-2.5 py-2">
            <div className="flex items-baseline justify-between">
              <span className="display gold-text tnum text-lg font-bold">+{fx.total.toFixed(1)}%</span>
              <span className="text-[10px] text-faint">of +{fx.max.toFixed(0)}% possible</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-line">
              <div className="gold-grad h-full" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 space-y-0.5 border-t border-line/60 pt-1.5">
              <EffectTerm
                label="The seat"
                detail="just for filling it"
                value={fx.base}
              />
              <EffectTerm
                label="Pedigree"
                detail={`${exec.stars}★ × ${TUNING.gcnExecStarEffect[role].toFixed(1)}%`}
                value={fx.stars}
              />
              <EffectTerm
                label="Service"
                detail={
                  exec.badge
                    ? `${exec.badge} badge, ${exec.seasonsServed} ${
                        exec.seasonsServed === 1 ? "season" : "seasons"
                      } in the chair`
                    : `no badge yet${toNext !== null ? ` — ${toNext} to bronze` : ""}`
                }
                value={fx.badges}
              />
            </div>
            <div className="mt-1.5 border-t border-line/60 pt-1.5 text-[11px] leading-snug text-dim">
              Added {spec.effectLabel}.
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-faint">
              {exec.seasonsServed} {exec.seasonsServed === 1 ? "season" : "seasons"} served
              {toNext !== null && <> · next badge in {toNext}</>}
            </span>
            <div className="flex gap-1.5">
              <ConfirmButton
                label="Dismiss"
                confirmLabel="Confirm"
                onConfirm={() => dismiss(role)}
                className="!px-2 !py-1 !text-[11px]"
              />
              <GhostButton onClick={onHire} className="!px-2 !py-1 !text-[11px]">
                Replace
              </GhostButton>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="rounded border border-dashed border-line px-2.5 py-4 text-center">
            <div className="display text-[12px] font-semibold text-loss">Vacant</div>
            <p className="mt-1 text-[10px] leading-snug text-faint">
              Up to +{fx.max.toFixed(0)}% {spec.effectLabel}. An empty seat is worth nothing at all.
            </p>
          </div>
          <GoldButton onClick={onHire} className="mt-2.5 w-full">
            Appoint
          </GoldButton>
        </>
      )}
    </Card>
  );
}

/** The elite shortlist for one seat. Four names, cycling on the market clock —
 * small on purpose: this is an appointment, not a job board. */
function ExecMarketModal({ role, onClose }: { role: GcnExecRole; onClose: () => void }) {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const hire = useGame((s) => s.gcnHireExec);
  const spec = GCN_EXEC_ROLES.find((r) => r.id === role)!;
  const candidates = execMarketFor(game, role).sort(
    (a, b) => b.stars - a.stars || b.seasonsServed - a.seasonsServed
  );
  const treasury = game.gcn?.treasury ?? 0;
  const incumbent = executiveIn(game, role);

  return (
    <Modal title={spec.title} onClose={onClose} size="lg">
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-dim">{spec.blurb}</p>
        {incumbent && (
          <p className="rounded border border-line bg-raised px-3 py-2 text-[11px] leading-relaxed text-faint">
            {incumbent.name} holds this seat. Appointing someone else replaces him at once — his{" "}
            {incumbent.seasonsServed} {incumbent.seasonsServed === 1 ? "season" : "seasons"} of
            service, and any badge earned with them, leave with him.
          </p>
        )}
        <div className="space-y-1.5">
          {candidates.map((c) => {
            const fee = c.fee;
            const afford = fee <= treasury;
            // What this candidate would be worth in the seat, on the day he
            // arrives — read from the tuning the effect itself uses.
            const now =
              TUNING.gcnExecBaseEffect[role] +
              c.stars * TUNING.gcnExecStarEffect[role] +
              (c.badge
                ? (["bronze", "silver", "gold", "diamond", "obsidian", "legacy"].indexOf(c.badge) + 1) *
                  TUNING.gcnExecBadgeEffect[role]
                : 0);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2.5 rounded border border-line bg-raised px-3 py-2.5">
                <Flag nat={c.nationality} size={14} />
                <div className="min-w-0 flex-1">
                  <div className="display flex items-center gap-1.5 truncate text-sm font-semibold">
                    <span className="truncate">{c.name}</span>
                    {c.badge && <ExecBadge tier={c.badge} seasons={c.seasonsServed} />}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-faint">
                    <Stars n={c.stars} />
                    <span className="tnum">{c.age}y</span>
                    <span className="tnum">{formatMoney(c.wage)}/wk</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="display gold-text tnum text-sm font-bold">+{now.toFixed(1)}%</div>
                  <div className="tnum text-[10px] text-faint">{formatMoney(fee)} fee</div>
                </div>
                <GoldButton disabled={!afford} onClick={() => hire(c.id)} className="!px-3 !py-1.5 !text-[12px]">
                  Appoint
                </GoldButton>
              </div>
            );
          })}
          {candidates.length === 0 && (
            <p className="py-8 text-center text-sm text-faint">
              No candidates are available for this seat right now. The shortlist cycles every{" "}
              {TUNING.marketRefreshDays} days.
            </p>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          Treasury: <span className="gold-text tnum">{formatMoney(treasury)}</span>. The figure beside
          each name is what they are worth on day one — a badge earned here adds up to{" "}
          {(6 * TUNING.gcnExecBadgeEffect[role]).toFixed(0)}% more over a long appointment. Diamond
          badges and above are only ever earned at your own network.
        </p>
      </div>
    </Modal>
  );
}

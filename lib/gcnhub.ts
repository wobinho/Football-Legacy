// International Scouting Hubs (v1.95) — §19, the end-game version of academy
// scouting.
//
// A hub is a BUILDING the network establishes in one SCOUT_WORLD sub-region.
// Where club scouting is a TRIP — hire a scout, send him somewhere, pay the
// travel, get him back — a hub is a permanent presence: it files reports on its
// own clock forever, at a quality no hireable scout reaches, and the prospects
// it signs live AT THE HUB rather than in the club academy.
//
// Three rules make it a different feature rather than a bigger academy, and each
// is here because the obvious version collapses the two into one:
//
//  1. A hub prospect has NO `clubId`. The network holds him. That is what makes
//     the placement decision — keep him developing at the hub, promote him into
//     your own academy, or place him at an owned club in that region — the thing
//     the feature is actually about.
//
//  2. He may only be PLACED at an owned club IN HIS OWN REGION, and never sent
//     on loan. A hub that could feed the whole empire is a talent teleporter and
//     makes owning clubs anywhere pointless; a hub that feeds its own region is
//     a reason to own clubs THERE, which is what ties the two halves of the
//     network together. Promotion into the manager's own academy is always
//     allowed — it is the one route that costs the region its player, and it is
//     the reward for having built the thing.
//
//  3. The tier roll goes through `rollProspectTier`, the same function every
//     other prospect in the game is rolled by, with the hub's LEVEL expressed as
//     an effective judgement. A second tier-rolling routine here would be a
//     second answer to one question, and the elite rates would drift apart.
//
// The region grid is `SCOUT_WORLD`'s sub-regions — the same 26 the scouting
// briefs already use. They are drawn along footballing lines ("the Balkans",
// "West Africa"), which is exactly the granularity a hub map wants, and reusing
// them means a hub and a scout brief can never disagree about where a place is.

import type {
  GameState,
  GcnHub,
  GcnHubFocus,
  PlayerBio,
  Pos,
  ProspectReport,
  ProspectTier,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import { ARCHETYPE_MAP, positionsOfArchetype } from "./config/archetype";
import { SCOUT_WORLD, regionNats } from "./config/scouting";
import { COUNTRIES } from "./config/countries";
import { deriveSeed, mulberry32, pick, randInt, uid, type RNG } from "./rng";
import { generatePlayer } from "./worldgen";
import { formatMoney, playerValue } from "./value";
import { migrateProspectTier, rollProspectTier, rollTierQuality, tierRank, TIER_LABEL } from "./scouts";
import { prospectSignFee, ensureProspectTier } from "./academy";
import { assignKitNumber } from "./kitnumbers";
import { pushInboxItem } from "./inbox";
import { globalScoutingCostMult, globalScoutingSpeedMult } from "./gcnexec";
import { ensureProgress } from "./achievements";

/** Every position a hub can turn up — also the brief's position list (v1.99), so
 * the picker offers exactly what the generator can roll. */
export const ALL_POS: Pos[] = ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"];

const pushInbox = pushInboxItem;

/** Worldgen id counters reset per session, so anything generated during play must
 * not reuse the `p<n>` sequence — reassign a collision-proof id. Mirrors the
 * academy's own `freshId`, which is private to that module. */
function freshId(p: PlayerBio): PlayerBio {
  p.id = uid("h");
  return p;
}

// ── The map ──────────────────────────────────────────────────────────────────

export interface HubRegionDef {
  /** SCOUT_WORLD sub-region id — the hub's key. */
  id: string;
  label: string;
  continent: string;
  continentLabel: string;
  /** Nationality codes a hub here draws prospects from. */
  nats: string[];
  /** The same countries with their display names (v1.99), for the brief's
   * country picker. Taken from the scouting tree's own labels rather than looked
   * up in `COUNTRIES`, which only knows the countries this build ships leagues
   * for — a hub region names plenty it doesn't. */
  countries: { id: string; label: string }[];
}

/** Every region a hub may be established in: SCOUT_WORLD's sub-regions, in tree
 * order. Derived, never hand-listed, so a region added to the scouting tree
 * becomes a hub site by construction and the two can't drift. */
export const HUB_REGIONS: HubRegionDef[] = SCOUT_WORLD.flatMap((continent) =>
  continent.regions.map((r) => ({
    id: r.id,
    label: r.label,
    continent: continent.id,
    continentLabel: continent.label,
    nats: r.countries.map((c) => c.id),
    countries: r.countries.map((c) => ({ id: c.id, label: c.label })),
  }))
);

export const HUB_REGION_MAP: Record<string, HubRegionDef> = Object.fromEntries(
  HUB_REGIONS.map((r) => [r.id, r])
);

export function hubRegion(id: string): HubRegionDef | undefined {
  return HUB_REGION_MAP[id];
}

// ── Reading the network's hubs ───────────────────────────────────────────────

export function hubIn(state: GameState, region: string): GcnHub | undefined {
  return state.gcn?.hubs?.[region];
}

/** Every hub the network holds, in map order. */
export function hubs(state: GameState): GcnHub[] {
  const map = state.gcn?.hubs ?? {};
  return HUB_REGIONS.map((r) => map[r.id]).filter((h): h is GcnHub => !!h);
}

/**
 * The 3-letter code for a league's country.
 *
 * Load-bearing, and the source of a defect worth naming: `League.country` holds
 * a DISPLAY NAME ("Spain"), set from `db.name` in worldgen, while SCOUT_WORLD —
 * and therefore every hub region — is keyed on nationality CODES ("ESP"). The
 * first cut of the presence and placement rules compared the two directly, so
 * they could never match: every region read as "no local presence" and every
 * placement was refused, on a world where both were true. Neither failure was
 * visible in the tables; the measured verifier is what caught it.
 *
 * Resolved through `COUNTRIES` (which carries both `name` and `nat` for exactly
 * this reason), with a pass-through for a value that is already a code — a
 * custom database's league may hold either, and a country the registry doesn't
 * know simply resolves to nothing rather than throwing.
 */
export function countryCodeOf(country: string | undefined): string | null {
  if (!country) return null;
  const key = country.trim().toLowerCase();
  const byName = COUNTRIES.find((c) => c.name.trim().toLowerCase() === key);
  if (byName) return byName.nat;
  // Already a code (a custom database, or a registry entry looked up by code).
  const upper = country.trim().toUpperCase();
  if (upper.length === 3) {
    const byCode = COUNTRIES.find((c) => c.code === upper);
    return byCode ? byCode.nat : upper;
  }
  return null;
}

/** The country code a club plays in, null when unresolvable. */
export function clubCountryCode(state: GameState, clubId: string): string | null {
  return countryCodeOf(state.leagues[state.teams[clubId]?.leagueId ?? ""]?.country);
}

/** True when the network owns a club whose league sits in one of this region's
 * countries. Local presence is what discounts a build — and it is the one rule
 * that makes the Clubs half of the network and the Hubs half talk to each
 * other. */
export function hasPresenceIn(state: GameState, region: string): boolean {
  const def = hubRegion(region);
  if (!def) return false;
  const nats = new Set(def.nats);
  for (const id of state.gcn?.clubIds ?? []) {
    const code = clubCountryCode(state, id);
    if (code && nats.has(code)) return true;
  }
  return false;
}

/** What establishing a hub in this region costs today: the flat build price, less
 * the local-presence discount, less the Director of Global Scouting's discount.
 * One function, so the map card and `buildHub` can never quote different
 * numbers. */
export function hubBuildCost(state: GameState, region: string, cfg: TuningConfig): number {
  const presence = hasPresenceIn(state, region) ? 1 - cfg.gcnHubPresenceDiscount : 1;
  return Math.round(cfg.gcnHubBuildCost * presence * globalScoutingCostMult(state, cfg));
}

/** The cost of the next level, or null when maxed or unbuilt. The director's
 * discount applies here too — he lowers the cost of "establishing" hubs, and an
 * upgrade is establishing more of one. */
export function hubUpgradeCost(state: GameState, region: string, cfg: TuningConfig): number | null {
  const hub = hubIn(state, region);
  if (!hub || hub.level >= cfg.gcnHubMaxLevel) return null;
  const raw = cfg.gcnHubUpgradeCost[hub.level - 1];
  if (raw === undefined) return null;
  return Math.round(raw * globalScoutingCostMult(state, cfg));
}

/** Weekly upkeep across every hub, billed to the treasury. */
export function hubUpkeepWeekly(state: GameState, cfg: TuningConfig): number {
  return hubs(state).reduce((s, h) => s + h.level * cfg.gcnHubUpkeepPerLevel, 0);
}

// ── A hub's numbers ──────────────────────────────────────────────────────────

/** The effective scouting judgement a hub of this level rolls at — the single
 * quantity its level buys, fed into the game's one tier roll. */
export function hubJudgement(level: number, cfg: TuningConfig): number {
  return cfg.gcnHubJudgementBase + Math.max(0, level - 1) * cfg.gcnHubJudgementPerLevel;
}

/** Days between report batches. The Director of Global Scouting DIVIDES into
 * this, so a better director means a shorter wait. Floored at a week so no
 * combination of levels and pedigree turns a hub into a daily firehose. */
export function hubReportDays(state: GameState, level: number, cfg: TuningConfig): number {
  const raw = cfg.gcnHubReportDays - Math.max(0, level - 1) * cfg.gcnHubReportDaysPerLevel;
  return Math.max(7, Math.round(raw / globalScoutingSpeedMult(state, cfg)));
}

/** How many prospects one batch may hold. */
export function hubBatchSize(level: number, cfg: TuningConfig): number {
  return Math.max(1, Math.round(cfg.gcnHubBatchBase + Math.max(0, level - 1) * cfg.gcnHubBatchPerLevel));
}

/** How many prospects a hub may carry on its books. */
export function hubCapacity(level: number, cfg: TuningConfig): number {
  return level * cfg.gcnHubCapacityPerLevel;
}

/** The growth multiplier a prospect developing AT this hub receives. Above the
 * club academy's own ceiling deliberately — a hub costs a treasury where an
 * academy comes free with the club. */
export function hubGrowthMult(level: number, cfg: TuningConfig): number {
  return cfg.gcnHubGrowthBase + Math.max(0, level - 1) * cfg.gcnHubGrowthPerLevel;
}

// ── Building ─────────────────────────────────────────────────────────────────

/** Establish a hub in a region, paid from the treasury. Returns an error string
 * on failure. */
export function buildHub(state: GameState, region: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!hubRegion(region)) return "Unknown region.";
  if (hubIn(state, region)) return "The network already has a hub there.";
  const cost = hubBuildCost(state, region, cfg);
  if (cost > gcn.treasury) return "The GCN treasury can't afford to establish that hub.";
  gcn.treasury -= cost;
  const hub: GcnHub = {
    region,
    level: 1,
    foundedSeason: state.season,
    // The first batch is due a full cycle out — a hub that files the day it opens
    // reads as a purchase rather than an operation.
    nextReportDay: state.currentDay + hubReportDays(state, 1, cfg),
    reportsFiled: 0,
  };
  (gcn.hubs ??= {})[region] = hub;
  ensureProgress(state).accolades.gcnHubsBuilt =
    (ensureProgress(state).accolades.gcnHubsBuilt ?? 0) + 1;
}

/** Take a hub to its next level, paid from the treasury. Returns an error string
 * on failure. */
export function upgradeHub(state: GameState, region: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const hub = hubIn(state, region);
  if (!hub) return "There's no hub there to upgrade.";
  const cost = hubUpgradeCost(state, region, cfg);
  if (cost === null) return "That hub is already at its maximum level.";
  if (cost > gcn.treasury) return "The GCN treasury can't afford that upgrade.";
  gcn.treasury -= cost;
  hub.level += 1;
}

/**
 * Close a hub down. Returns an error string on failure.
 *
 * Nothing comes back — no refund, no partial sale. That is the honest shape for
 * a building the network put up in a foreign country, and it is what makes the
 * upkeep decision real: the way out of a hub you can't afford is to stop paying
 * for it, at the cost of everything you put in.
 *
 * v1.99: this is no longer what the screen offers as the routine lever —
 * `setHubPaused` is. "Stop the reports" and "demolish the building" are
 * different decisions, and only the second should cost the prospects.
 *
 * Its prospects are NOT deleted. They are released to the world as ordinary free
 * agents, because unlike an academy quick sell (where deletion exists so a
 * manager's castoffs can't stock his rivals) these are players the network
 * developed and simply stopped housing.
 */
export function closeHub(state: GameState, region: string): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  if (!hubIn(state, region)) return "There's no hub there.";
  delete gcn.hubs![region];
  for (const id of [...(gcn.hubProspectIds ?? [])]) {
    const p = state.players[id];
    if (p?.gcnHubRegion === region) releaseHubProspect(state, id);
  }
  gcn.hubReports = (gcn.hubReports ?? []).filter((r) => r.region !== region);
}

// ── The brief (v1.99) ────────────────────────────────────────────────────────
//
// A hub can be told what to look for: a country inside its own region, a
// position, an archetype. Three rules, and each is why this is a brief rather
// than a filter:
//
//  1. It is a BIAS. `gcnHubFocusHitChance` is rolled PER CRITERION, so a fully
//     specified brief lands outright about a third of the time and the rest of
//     the batch is what the region actually has. A hard filter would turn the
//     brief into a prospect generator — pick the nation, the position and the
//     role and the hub mints exactly that, every batch, forever.
//
//  2. The archetype steers the TRAINING PLAN, never a label. An archetype is
//     derived from attributes (v1.77) and a plan's own weights are what worldgen
//     shapes an attribute line from, so passing `planId` is the only way to make
//     a focused find genuinely read as that role. Stamping `archetype` on a
//     player would be storing an identity the game deliberately doesn't store.
//
//  3. An archetype and a position can DISAGREE (an Anchor is a DM; the brief may
//     also say ST). The archetype wins, because it is the more specific of the
//     two and a plan aimed at a position the player doesn't play would shape an
//     attribute line the overall model then throws away. `focusError` refuses
//     the pairing up front so the manager never sets a brief that quietly
//     ignores half of itself.

/** Whether a brief is legal for this region. The single ruling — the UI greys
 * options out with it and `setHubFocus` refuses with it. */
export function hubFocusError(region: string, focus: GcnHubFocus): string | null {
  const def = hubRegion(region);
  if (!def) return "Unknown region.";
  if (focus.nat && !def.nats.includes(focus.nat)) {
    return `A ${def.label} hub only scouts inside its own region.`;
  }
  if (focus.archetype) {
    const arch = ARCHETYPE_MAP[focus.archetype];
    if (!arch) return "Unknown archetype.";
    const posns = positionsOfArchetype(arch);
    if (focus.pos && !posns.includes(focus.pos)) {
      return `${arch.name} is a ${posns.join("/")} role — it can't be earned at ${focus.pos}.`;
    }
  }
  return null;
}

/** Set (or clear) a hub's brief. An empty object clears it, which is the same
 * state a hub that never had one is in. */
export function setHubFocus(state: GameState, region: string, focus: GcnHubFocus): string | void {
  const hub = hubIn(state, region);
  if (!hub) return "There's no hub there.";
  const clean: GcnHubFocus = {};
  if (focus.nat) clean.nat = focus.nat;
  if (focus.pos) clean.pos = focus.pos;
  if (focus.archetype) clean.archetype = focus.archetype;
  const blocked = hubFocusError(region, clean);
  if (blocked) return blocked;
  if (!clean.nat && !clean.pos && !clean.archetype) delete hub.focus;
  else hub.focus = clean;
}

/** Stop or restart a hub's reports. Everything else about it — its level, its
 * prospects, its upkeep — carries on, which is what makes this the reversible
 * decision that closing the hub is not. */
export function setHubPaused(
  state: GameState,
  region: string,
  paused: boolean,
  cfg: TuningConfig
): string | void {
  const hub = hubIn(state, region);
  if (!hub) return "There's no hub there.";
  if (paused) hub.paused = true;
  else {
    delete hub.paused;
    // Resuming starts a fresh cycle rather than filing the batch that came due
    // while nobody was reporting — a pause that banked its reports would be a
    // way to stockpile them.
    hub.nextReportDay = state.currentDay + hubReportDays(state, hub.level, cfg);
  }
}

// ── The pipeline ─────────────────────────────────────────────────────────────

/** Build one prospect for a hub report. Deliberately the same construction the
 * club's scouts use — the same age band, the same `generatePlayer` flags, the
 * same tier→band lookup — because a hub is meant to find BETTER players, not
 * different ones. The only thing that differs is the judgement it rolls at, and
 * (v1.99) the brief that biases what it goes looking for. */
function generateHubProspect(
  state: GameState,
  cfg: TuningConfig,
  hub: GcnHub,
  rng: RNG,
  batch: number
): ProspectReport | null {
  const def = hubRegion(hub.region);
  if (!def) return null;
  const focus = hub.focus;
  // Each criterion rolls on its own — see the note above for why this is a bias.
  const hits = () => rng() < cfg.gcnHubFocusHitChance;

  const regionPool = regionNats(hub.region);
  const nat =
    focus?.nat && regionPool.includes(focus.nat) && hits() ? focus.nat : pick(rng, regionPool);

  // The archetype is the more specific instruction, so it picks the position
  // when both are named — `hubFocusError` has already refused a pairing where
  // the two genuinely conflict, so this only ever narrows.
  const arch = focus?.archetype ? ARCHETYPE_MAP[focus.archetype] : undefined;
  const archHit = arch ? hits() : false;
  const archPositions = arch ? positionsOfArchetype(arch) : [];
  let pos: Pos;
  if (archHit && archPositions.length) {
    pos = focus?.pos && archPositions.includes(focus.pos) ? focus.pos : pick(rng, archPositions);
  } else if (focus?.pos && hits()) {
    pos = focus.pos;
  } else {
    pos = pick(rng, ALL_POS);
  }
  // The plan, not a stored label: an archetype is DERIVED from attributes, and a
  // plan's weights are what worldgen shapes the line from.
  const planId = archHit && arch ? arch.planId : undefined;
  const age = randInt(rng, cfg.gcnHubProspectAgeMin, cfg.gcnHubProspectAgeMax);
  const tier = rollProspectTier(rng, cfg, hubJudgement(hub.level, cfg));
  const band = rollTierQuality(rng, cfg, tier, age);
  // Elite finds take worldgen's prodigy path, exactly as a scout's do.
  const elite = tierRank(cfg, tier) >= cfg.prospectTierOrder.length - 3;
  const p = freshId(
    generatePlayer(rng, cfg, {
      pos,
      overall: band.overall,
      nat,
      age,
      prodigy: elite,
      ...(planId ? { planId } : {}),
      // Both flags exist for the 13–17 band and must travel together (v1.90):
      // the age table already states ability-at-age, so re-running the maturity
      // curve would discount youth twice, and `minOverall` is a senior-world
      // rule that predates 13-year-olds.
      overallIsAgeAdjusted: true,
      allowBelowFloor: true,
    })
  );
  p.potential = Math.round(
    Math.min(cfg.potentialAbsoluteCap, Math.max(p.overall + 3, band.potential))
  );
  p.value = playerValue(p, cfg);
  return {
    id: uid("hub"),
    player: p,
    fee: hubSignFee(cfg, tier),
    day: state.currentDay,
    expiresDay: state.currentDay + cfg.gcnHubReportExpiryDays,
    region: hub.region,
    batch,
    tier,
  };
}

/** What signing a hub find costs: the ordinary badge-keyed academy price times
 * the hub premium. One function, quoted on the card and charged by the signing,
 * so the two can never disagree. */
export function hubSignFee(cfg: TuningConfig, tier: ProspectTier | undefined): number {
  return Math.round(prospectSignFee(cfg, tier) * cfg.gcnHubSignFeeFactor);
}

/** The daily hub pass: expire stale reports, then let each due hub file a batch.
 * The counterpart to `dailyScoutTick`, and called from the same place. */
export function dailyHubTick(state: GameState, cfg: TuningConfig) {
  const gcn = state.gcn;
  if (!gcn) return;
  gcn.hubReports = (gcn.hubReports ?? []).filter((r) => r.expiresDay > state.currentDay);
  const list = hubs(state);
  if (list.length === 0) return;

  for (const hub of list) {
    // A paused hub files nothing and its clock does not advance (v1.99): the
    // whole point is that no reports come back, so a pause that banked its
    // batches would deliver them all the moment it resumed.
    if (hub.paused) continue;
    if (state.currentDay < hub.nextReportDay) continue;
    const def = hubRegion(hub.region);
    if (!def) continue;
    const rng = mulberry32(deriveSeed(state.seed, `gcnhub:${hub.region}:${state.currentDay}`));
    const batch = (hub.reportsFiled ?? 0) + 1;
    hub.reportsFiled = batch;
    const count = hubBatchSize(hub.level, cfg);
    const found: ProspectReport[] = [];
    for (let i = 0; i < count; i++) {
      const report = generateHubProspect(state, cfg, hub, rng, batch);
      if (report) {
        gcn.hubReports!.push(report);
        found.push(report);
      }
    }
    hub.nextReportDay =
      state.currentDay + hubReportDays(state, hub.level, cfg) + randInt(rng, -2, 3);
    if (!found.length) continue;

    const best = found.reduce((b, r) => (tierRank(cfg, r.tier) > tierRank(cfg, b.tier) ? r : b));
    const lines = found
      .map(
        (r) =>
          `${r.player.name} — ${r.player.positions[0]}, age ${r.player.age}, ${r.player.nationality}` +
          `${r.tier ? ` [${r.tier.toUpperCase()}]` : ""}, ${formatMoney(r.fee)}`
      )
      .join("\n\n");
    pushInbox(
      state,
      "scout",
      `${def.label} hub: ${found.length === 1 ? found[0].player.name : `${found.length} prospects`}`,
      `The network's ${def.label} hub files its ${batch === 1 ? "first" : `${batch}th`} report:\n\n${lines}\n\n` +
        `They'd join the hub's own books — not a club's — and can be developed there, promoted into your academy, ` +
        `or placed at an owned club in the region. The trail goes cold in ${cfg.gcnHubReportExpiryDays} days.`
    );
    if (tierRank(cfg, best.tier) >= cfg.prospectTierOrder.length - 2) {
      state.news.unshift(
        `The ${def.label} hub has turned up something rare: ${best.player.name}, ${best.player.age}.`
      );
    }
  }
}

// ── Signing, holding, moving on ──────────────────────────────────────────────

/** Prospects currently on the hubs' books, best potential first. */
export function hubProspects(state: GameState, region?: string): PlayerBio[] {
  return (state.gcn?.hubProspectIds ?? [])
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired && (!region || p.gcnHubRegion === region))
    .sort((a, b) => (b.potential ?? 0) - (a.potential ?? 0));
}

/** How many prospects a region's hub currently holds. */
export function hubHeadcount(state: GameState, region: string): number {
  return hubProspects(state, region).length;
}

/** The hubs' combined weekly wage bill, paid from the treasury. */
export function hubWageBill(state: GameState, cfg: TuningConfig): number {
  return (state.gcn?.hubProspectIds ?? []).length * cfg.gcnHubProspectWage;
}

/** Sign a hub find onto that hub's books, paid from the treasury. He joins with
 * NO club: the network holds him. Returns an error string on failure. */
export function signHubProspect(state: GameState, reportId: string, cfg: TuningConfig): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const report = (gcn.hubReports ?? []).find((r) => r.id === reportId);
  if (!report || report.expiresDay <= state.currentDay) return "That trail has gone cold.";
  const region = report.region ?? "";
  const hub = hubIn(state, region);
  if (!hub) return "That hub is no longer open.";
  if (hubHeadcount(state, region) >= hubCapacity(hub.level, cfg)) {
    return `The ${hubRegion(region)?.label ?? region} hub is full — place, promote or release a prospect, or upgrade the hub.`;
  }
  if (report.fee > gcn.treasury) {
    return `The treasury can't cover the ${formatMoney(report.fee)} fee for a ${TIER_LABEL[migrateProspectTier(report.tier) ?? "bronze"]} prospect.`;
  }
  gcn.treasury -= report.fee;
  const p = report.player;
  // No clubId: the hub holds him, and no club does. Everything downstream that
  // iterates squads therefore never sees him, which is correct — he is not at a
  // club and cannot be picked for one.
  p.clubId = null;
  p.gcnHubRegion = region;
  if (report.tier) {
    p.u21Tier = migrateProspectTier(report.tier);
    p.academyTier = migrateProspectTier(report.tier);
  }
  ensureProspectTier(p, cfg);
  state.players[p.id] = p;
  (gcn.hubProspectIds ??= []).push(p.id);
  state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
  state.careers[p.id].transfers.push({
    season: state.season,
    day: state.currentDay,
    from: "Youth football",
    to: `${gcn.name} — ${hubRegion(region)?.label ?? region} hub`,
    fee: report.fee,
  });
  gcn.hubReports = (gcn.hubReports ?? []).filter((r) => r.id !== reportId);
  ensureProgress(state).accolades.gcnHubProspects =
    (ensureProgress(state).accolades.gcnHubProspects ?? 0) + 1;
}

export function dismissHubReport(state: GameState, reportId: string) {
  if (!state.gcn) return;
  state.gcn.hubReports = (state.gcn.hubReports ?? []).filter((r) => r.id !== reportId);
}

/** Take a prospect off the hub's books entirely — the shared tail of every route
 * out (placement, promotion, release). */
function detachFromHub(state: GameState, playerId: string) {
  const gcn = state.gcn;
  if (!gcn) return;
  gcn.hubProspectIds = (gcn.hubProspectIds ?? []).filter((id) => id !== playerId);
  const p = state.players[playerId];
  if (p) delete p.gcnHubRegion;
}

/**
 * Where a hub prospect may go (v1.95). The single ruling, called by the UI to
 * grey out destinations and by `placeHubProspect` to refuse them — React never
 * re-derives it.
 *
 * The rule is REGIONAL: an owned club whose league sits in one of this hub's own
 * countries. A hub that could feed the whole empire would make owning clubs
 * anywhere else pointless and turn the map into a talent teleporter; a hub that
 * feeds its own region is a reason to own clubs THERE.
 *
 * A ring-fenced club is excluded for the ordinary reason — moving the network's
 * players into the manager's own pyramid is precisely what the fence stops.
 */
export function hubPlacementError(state: GameState, playerId: string, clubId: string): string | null {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const p = state.players[playerId];
  if (!p?.gcnHubRegion) return "That player isn't on a hub's books.";
  if (clubId === state.userTeamId) {
    return "Your own club takes a hub prospect through the academy, not as a placement.";
  }
  if (!gcn.clubIds.includes(clubId)) return "That club isn't in the network.";
  const club = state.teams[clubId];
  if (!club) return "Unknown club.";
  if (club.gcnRingFenced) {
    return "That club is ring-fenced — the network's players never move into your own pyramid.";
  }
  const def = hubRegion(p.gcnHubRegion);
  // The club's country as a CODE — `League.country` is a display name; see
  // `countryCodeOf` for why comparing the two directly is the trap here.
  const country = clubCountryCode(state, clubId) ?? "";
  if (!def || !def.nats.includes(country)) {
    return `A ${def?.label ?? "hub"} prospect can only be placed at an owned club in that region.`;
  }
  return null;
}

/** Owned clubs this prospect may be placed at right now. */
export function hubPlacementOptions(state: GameState, playerId: string): string[] {
  return (state.gcn?.clubIds ?? []).filter((id) => !hubPlacementError(state, playerId, id));
}

/** Place a hub prospect into an owned club's senior squad. He leaves the hub's
 * books and becomes an ordinary player at that club — no fee: the network already
 * paid for him. Returns an error string on failure. */
export function placeHubProspect(state: GameState, playerId: string, clubId: string): string | void {
  const blocked = hubPlacementError(state, playerId, clubId);
  if (blocked) return blocked;
  const p = state.players[playerId]!;
  const club = state.teams[clubId]!;
  detachFromHub(state, playerId);
  p.clubId = clubId;
  club.playerIds.push(playerId);
  assignKitNumber(state, p);
  // A placement is a real move in his history — he goes from the network's books
  // to a football club's, which is the transition his record should show.
  state.careers[playerId]?.transfers.push({
    season: state.season,
    day: state.currentDay,
    from: `${state.gcn!.name} hub`,
    to: club.name,
    fee: 0,
    toId: clubId,
  });
  // The same-season resale lock binds here like any other move into a club.
  p.acquiredSeason = state.season;
}

/** Promote a hub prospect into the manager's OWN academy. Always available —
 * it is the one route that costs the region its player, and it is what the hub
 * was built for. Returns an error string on failure. */
export function promoteHubProspect(
  state: GameState,
  playerId: string,
  /** The manager's academy cap, passed in rather than read here: `academySquadCap`
   * lives in the economy module and importing it would put a club-side concern
   * inside the network's rules. The store has it in hand at the call site. */
  academyCap: number
): string | void {
  const gcn = state.gcn;
  if (!gcn) return "The network isn't unlocked.";
  const p = state.players[playerId];
  if (!p?.gcnHubRegion) return "That player isn't on a hub's books.";
  const team = state.teams[state.userTeamId];
  if ((team.academyPlayerIds?.length ?? 0) >= academyCap) {
    return "Your academy is full — release or promote a prospect to make room.";
  }
  const region = p.gcnHubRegion;
  detachFromHub(state, playerId);
  p.clubId = team.id;
  p.academyClubId = team.id;
  (team.academyPlayerIds ??= []).push(playerId);
  assignKitNumber(state, p);
  state.careers[playerId]?.transfers.push({
    season: state.season,
    day: state.currentDay,
    from: `${hubRegion(region)?.label ?? region} hub`,
    to: `${team.name} Youth Academy`,
    fee: 0,
    toId: team.id,
  });
}

/** Let a hub prospect go. He becomes an ordinary free agent — unlike an academy
 * quick sell, nothing is deleted: that rule exists so a manager's castoffs can't
 * stock his domestic rivals, and a 15-year-old released in Ghana is not that. */
export function releaseHubProspect(state: GameState, playerId: string): string | void {
  const p = state.players[playerId];
  if (!p?.gcnHubRegion) return "That player isn't on a hub's books.";
  detachFromHub(state, playerId);
  p.clubId = null;
  p.contract = undefined;
}

/** A hub prospect who has passed the age-out band and must be dealt with. The
 * counterpart to the academy's graduate queue — the network's version is a
 * simple list rather than a modal, since the decision (place, promote, release)
 * is the same one that was available all along. */
export function hubAgeOuts(state: GameState, cfg: TuningConfig): PlayerBio[] {
  return hubProspects(state).filter((p) => p.age >= cfg.gcnHubMaxAge);
}

/** The season rollover's hub pass: anyone past the age-out band who the manager
 * never dealt with is released, which is what the academy does to a graduate
 * left undecided. Returns the names, for the inbox line. */
export function hubRolloverAgeOuts(state: GameState, cfg: TuningConfig): string[] {
  const out: string[] = [];
  for (const p of hubAgeOuts(state, cfg)) {
    out.push(p.name);
    releaseHubProspect(state, p.id);
  }
  return out;
}

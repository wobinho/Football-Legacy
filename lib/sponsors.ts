// Sponsors / investments (v6, Club → Income). Companies bid to sponsor the club
// on season-long deals: front-of-shirt, sleeve, apparel (kit maker), boot deal,
// and stadium naming rights. Offer quality scales with club reputation, league
// division, and — the design hook the user asked for — squad *marketability*
// (the Marketable trait). Sign a deal for a weekly income boost that runs until
// it expires, at which point a fresh offer arrives.

import type { GameState, SponsorDeal, SponsorKind, SponsorOffer, SponsorSlot, Team } from "./types";
import type { TuningConfig } from "./config/tuning";
import { mulberry32, pick, deriveSeed, uid, type RNG } from "./rng";
import { TRAITS } from "./config/traits";

export interface SponsorSlotDef {
  slot: SponsorSlot;
  kind: SponsorKind;
  title: string;
  blurb: string;
  icon: string;
}

/**
 * The club's commercial portfolio (v19).
 *
 * The old model had five slots and a blunt "only one major at a time" rule,
 * which meant a club was permanently either holding one big deal or holding
 * none — never assembling a portfolio. Slots now mirror a real club's
 * commercial book: a handful of genuinely exclusive landmark assets (you have
 * exactly one front-of-shirt sponsor and one kit manufacturer) alongside a long
 * tail of smaller partnerships that legitimately stack.
 *
 * Scarcity lives in `sponsorSlotCapacity` (tuning), per slot, rather than in a
 * global cap — so the constraint reads as football rather than as a game rule.
 */
export const SPONSOR_SLOTS: SponsorSlotDef[] = [
  // ── Majors: landmark, lump-sum, exclusive ──
  { slot: "shirt", kind: "major", title: "Shirt Sponsor", blurb: "The name across the front of the shirt — your single biggest commercial asset, paid up front.", icon: "👕" },
  { slot: "apparel", kind: "major", title: "Kit Manufacturer", blurb: "The brand that makes the kit. A landmark multi-season deal with a substantial signing payment.", icon: "🏭" },
  { slot: "stadium", kind: "major", title: "Stadium Naming Rights", blurb: "Sell your ground's name for a premium lump sum that lands in the budget immediately.", icon: "🏟️" },
  { slot: "backOfShirt", kind: "major", title: "Back-of-Shirt Sponsor", blurb: "The space above the number — a serious secondary asset, sold as a lump sum.", icon: "🔢" },
  // ── Minors: steady weekly partnerships, several may run at once ──
  { slot: "sleeve", kind: "minor", title: "Sleeve Sponsor", blurb: "A secondary badge on the sleeve — a steady weekly top-up, one season at a time.", icon: "🎽" },
  { slot: "shorts", kind: "minor", title: "Shorts Sponsor", blurb: "A smaller placement on the shorts. Modest, but it all adds up.", icon: "🩳" },
  { slot: "trainingKit", kind: "minor", title: "Training Kit Partner", blurb: "Branding on training and warm-up wear. Two partners can run side by side.", icon: "🦺" },
  { slot: "boot", kind: "minor", title: "Boot Deal", blurb: "A footwear brand aligns with the club's stars for a weekly fee.", icon: "👟" },
  { slot: "regional", kind: "minor", title: "Regional Partner", blurb: "Local and regional businesses back the club — you can carry several of these at once.", icon: "📍" },
  { slot: "beverage", kind: "minor", title: "Beverage Partner", blurb: "Official drinks partners — pouring rights around the ground.", icon: "🥤" },
  { slot: "automotive", kind: "minor", title: "Automotive Partner", blurb: "A car marque supplies the club and pays for the association.", icon: "🚗" },
];

// Brand pools per slot — fictional, evocative names (no real IP).
const BRANDS: Record<SponsorSlot, string[]> = {
  shirt: ["Aeltra Airlines", "Novabet", "Zephyr Motors", "Kaizen Finance", "Solaris Energy", "Meridian Bank", "Volt Telecom", "Orion Crypto"],
  apparel: ["Strider", "Apex Athletic", "Kestrel Sport", "Vantage", "Fjord", "Talon"],
  stadium: ["Aeltra Arena", "Solaris Park", "Meridian Stadium", "Kaizen Dome", "Volt Field", "Orion Ground"],
  backOfShirt: ["Lumen Energy", "Aster Group", "Corvid Logistics", "Northwind Homes", "Verity Legal", "Ironvale Steel"],
  sleeve: ["Pulse Drinks", "Cirro Cloud", "Halo Insurance", "Bloom Wellness", "Nimbus Tech", "Vega Watches"],
  shorts: ["Marlow & Sons", "Ridge Outdoor", "Copper Kettle", "Bright Path", "Quill Media", "Anvil Tools"],
  trainingKit: ["Kestrel Performance", "Vantage Pro", "Fjord Active", "Strider Elite", "Talon Training", "Apex Labs"],
  boot: ["Strider Boots", "Cobra Cleats", "Vipr", "Ignis Footwear", "Panthera", "Blaze"],
  regional: ["Harbour Foods", "Weald Brewing", "Station Road Motors", "Priory Estates", "Two Rivers Bakery", "Fenland Farms", "Old Mill Hotels", "Cobblestone Coffee"],
  beverage: ["Cascade Springs", "Ember Cola", "Hopfield Brewing", "Zest Isotonic", "Silver Birch Water", "Rally Energy"],
  automotive: ["Zephyr Motors", "Kestrel Automotive", "Alto Motors", "Ridgeline Trucks", "Corsa Electric", "Vantari"],
};

const TIER_NAMES = ["Regional", "National", "Global"];

/** One squad member's contribution to the club's marketability, with the traits
 * that earned it. Exposed so the Investments page can show the user exactly who
 * is drawing the sponsors in. */
export interface MarketabilityContributor {
  playerId: string;
  name: string;
  overall: number;
  traits: string[]; // display names of the marketable traits held
  amount: number;
}

/** Total squad marketability: summed marketabilityBonus of the club's on-books
 * players (senior squad). A marketable star lifts every offer. */
export function squadMarketability(state: GameState, teamId: string): number {
  return marketabilityContributors(state, teamId).reduce((s, c) => s + c.amount, 0);
}

/** Who is making the club marketable, biggest draw first. The scoring is the
 * single source of truth for `squadMarketability` — the total is just this
 * summed — so the breakdown the user reads can never drift from the number the
 * sponsor maths actually uses. */
export function marketabilityContributors(state: GameState, teamId: string): MarketabilityContributor[] {
  const team = state.teams[teamId];
  if (!team) return [];
  const marketableTraits = new Map(
    TRAITS.filter((t) => t.effects.marketabilityBonus !== undefined).map((t) => [t.id, t])
  );
  const out: MarketabilityContributor[] = [];
  for (const id of team.playerIds) {
    const p = state.players[id];
    if (!p || p.retired) continue;
    let amount = 0;
    const names: string[] = [];
    for (const tId of p.traits) {
      const trait = marketableTraits.get(tId);
      if (!trait) continue;
      const b = trait.effects.marketabilityBonus ?? 0;
      // weight by how big a name the player is (overall) so a marketable star
      // is worth more than a marketable squad filler
      amount += b * (0.6 + p.overall / 100);
      names.push(trait.name);
    }
    if (amount > 0) out.push({ playerId: p.id, name: p.name, overall: p.overall, traits: names, amount });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * Sponsor Marketability, as the 1–5 star rating the Investments page shows.
 *
 * The raw `squadMarketability` sum is an open-ended number that means nothing to
 * a player looking at it. The star scale is the user-facing reading of the same
 * quantity: how attractive this club looks to a brand. It drives three things —
 * how *many* suitors are willing to talk (offer generation), how *good* the
 * brands are (tier roll), and how much they *pay* (offer amount).
 *
 * Stars are cut from the raw sum via `sponsorMarketabilityStarThresholds`, so
 * the scale is tunable data rather than engine arithmetic. Returned as a float
 * so the UI can render half-stars; `Math.round` it for a whole-star reading.
 */
export function marketabilityStars(state: GameState, teamId: string, cfg: TuningConfig): number {
  const raw = squadMarketability(state, teamId);
  const cuts = cfg.sponsorMarketabilityStarThresholds;
  // Below the first cut the club is still a 1★ proposition — every club is
  // sponsorable by someone, so the scale floors at 1 rather than 0.
  if (raw <= cuts[0]) return 1 + Math.max(0, raw / Math.max(cuts[0], 1e-6));
  for (let i = 1; i < cuts.length; i++) {
    if (raw <= cuts[i]) {
      const span = cuts[i] - cuts[i - 1];
      return 1 + i + (span > 0 ? (raw - cuts[i - 1]) / span : 0);
    }
  }
  return 5;
}

/** Whole-star reading of Sponsor Marketability, 1–5. */
export function marketabilityStarRating(state: GameState, teamId: string, cfg: TuningConfig): number {
  return Math.max(1, Math.min(5, Math.round(marketabilityStars(state, teamId, cfg))));
}

/** Flavour label for a star rating — what the commercial department would say. */
export function marketabilityLabel(stars: number): string {
  const s = Math.max(1, Math.min(5, Math.round(stars)));
  return ["Local Interest", "Modest Draw", "Solid Appeal", "Major Attraction", "Global Brand"][s - 1];
}

/** How many sponsor offers may sit on the table at once for this club (v20).
 *
 * This is the "how many sponsors will try to sponsor the club" half of Sponsor
 * Marketability: an unmarketable side gets the base number of suitors, a 5★ club
 * has brands queuing up. */
export function marketabilityMaxLiveOffers(state: GameState, teamId: string, cfg: TuningConfig): number {
  const stars = marketabilityStarRating(state, teamId, cfg);
  return cfg.sponsorMaxLiveOffers + Math.round((stars - 1) * cfg.sponsorMarketabilityOffersPerStar);
}

/** Weekly amount for a fresh offer in a given slot at a given tier. */
function offerAmount(state: GameState, teamId: string, slot: SponsorSlot, tierIndex: number, cfg: TuningConfig, rng: RNG): number {
  const team = state.teams[teamId];
  const league = state.leagues[team.leagueId];
  const divisionMult = league ? (league.tier === 1 ? 1.6 : 1.0) : 1.0;
  const share = cfg.sponsorSlotShare[slot] ?? 0.5;
  const base = team.reputation * cfg.sponsorBaseWeeklyByReputation * share * divisionMult;
  const tierMult = cfg.sponsorTierMults[tierIndex] ?? 1.0;
  // Money follows the star rating (v20), so what the user sees on the
  // Investments page is literally what is moving the offer. Each star above the
  // first is worth `sponsorMarketabilityPerStar` on top of the base fee.
  const stars = marketabilityStars(state, teamId, cfg);
  const marketMult = 1 + (stars - 1) * cfg.sponsorMarketabilityPerStar;
  const noise = 0.9 + rng() * 0.2;
  return Math.round((base * tierMult * marketMult * noise) / 1000) * 1000;
}

/** Pick an offer tier, weighted upward by reputation + marketability so bigger,
 * more marketable clubs see better brands more often. */
function rollTier(state: GameState, teamId: string, cfg: TuningConfig, rng: RNG): number {
  const team = state.teams[teamId];
  // Reputation opens the door; marketability decides how good the brand walking
  // through it is. A 5★ club sees Global suitors far more often (v20).
  const stars = marketabilityStars(state, teamId, cfg);
  const pull = team.reputation / 100 + (stars - 1) * cfg.sponsorMarketabilityTierPull;
  const r = rng() + pull * 0.5;
  if (r > 1.15) return 2; // Global
  if (r > 0.6) return 1; // National
  return 0; // Regional
}

/** Whether a slot is a lump-sum major (from tuning) or a weekly minor. */
export function slotKind(slot: SponsorSlot, cfg: TuningConfig): SponsorKind {
  return cfg.sponsorMajorSlots.includes(slot) ? "major" : "minor";
}

/** Build one offer for a slot — a lump-sum major or a weekly minor. */
function makeOffer(state: GameState, teamId: string, slot: SponsorSlot, cfg: TuningConfig, rng: RNG): SponsorOffer {
  const tierIndex = rollTier(state, teamId, cfg, rng);
  const kind = slotKind(slot, cfg);
  const equivalentWeekly = offerAmount(state, teamId, slot, tierIndex, cfg, rng);

  if (kind === "major") {
    const lo = Math.max(cfg.sponsorMajorLengthMin, cfg.sponsorMajorMinSeasons);
    const hi = Math.max(lo, cfg.sponsorMajorLengthMax);
    const seasons = lo + Math.floor(rng() * (hi - lo + 1));
    // one-time lump ≈ equivalent-weekly across the whole term, with an incentive
    const upfront = Math.round((equivalentWeekly * 52 * seasons * cfg.sponsorMajorUpfrontMult) / 100_000) * 100_000;
    return {
      id: uid("spo"),
      slot,
      kind,
      brand: pick(rng, BRANDS[slot]),
      weeklyAmount: 0,
      upfront,
      seasons,
      tier: TIER_NAMES[tierIndex],
      day: state.currentDay,
      expiresDay: state.currentDay + cfg.sponsorDeadlineDaysMajor,
    };
  }

  // minor: weekly income, at most one season. v1.43: weekly partnerships pay a
  // reduced fraction of the raw offer amount.
  return {
    id: uid("spo"),
    slot,
    kind,
    brand: pick(rng, BRANDS[slot]),
    weeklyAmount: Math.round((equivalentWeekly * cfg.sponsorMinorWeeklyMult) / 1000) * 1000,
    upfront: 0,
    seasons: 1,
    tier: TIER_NAMES[tierIndex],
    day: state.currentDay,
    expiresDay: state.currentDay + cfg.sponsorDeadlineDaysMinor,
  };
}

/** How many major deals the club currently holds. */
export function activeMajorCount(state: GameState, teamId: string): number {
  return (state.teams[teamId].sponsors ?? []).filter((d) => d.kind === "major").length;
}

/** How many concurrent deals a slot supports (v19). Absent from the table = 1. */
export function slotCapacity(slot: SponsorSlot, cfg: TuningConfig): number {
  return cfg.sponsorSlotCapacity?.[slot] ?? 1;
}

/** How many deals the club currently holds in one slot. */
export function dealsInSlot(state: GameState, teamId: string, slot: SponsorSlot): SponsorDeal[] {
  return (state.teams[teamId].sponsors ?? []).filter((d) => d.slot === slot);
}

/** Whether a slot has room for another deal right now. */
export function slotHasRoom(state: GameState, teamId: string, slot: SponsorSlot, cfg: TuningConfig): boolean {
  return dealsInSlot(state, teamId, slot).length < slotCapacity(slot, cfg);
}

/** Why a slot can't take another deal right now, or null if it can. Exposed so
 * the UI can explain the block on the card instead of only on click.
 *
 * v19: the block is per-slot capacity rather than a global "one major" rule, so
 * the explanation names the asset the user has already sold. */
export function slotBlockedReason(
  state: GameState,
  teamId: string,
  slot: SponsorSlot,
  cfg: TuningConfig
): string | null {
  const cap = slotCapacity(slot, cfg);
  const held = dealsInSlot(state, teamId, slot).length;
  if (held < cap) return null;
  const def = SPONSOR_SLOTS.find((d) => d.slot === slot);
  const title = def?.title.toLowerCase() ?? "slot";
  return cap === 1
    ? `Your ${title} is already sold — this slot frees up when that deal expires.`
    : `You already hold ${cap} ${title} deals, the most that can run at once.`;
}

/**
 * Build the sponsorship book an AI club signs for a season (v1.5).
 *
 * AI clubs used to carry one abstract `commercialIncome` number standing in for
 * their whole portfolio. They now hold real `SponsorDeal` objects — the same
 * type, slots and money model the user signs — resolved automatically here: no
 * offer machinery, no cooldowns, no decision. A club is simply quoted for each
 * open slot and takes what it is offered, which is what makes the AI's book
 * *passive* while still being real: it appears in the world, it pays out on the
 * same terms, and a big club genuinely out-earns a small one.
 *
 * The maths is deliberately the user's maths (`offerAmount`, `rollTier`), so
 * the two sides of the world can't drift apart — an AI club's shirt deal is
 * priced by the same reputation/division/tier model the user's offer is.
 *
 * Deals already running (a multi-season major signed two seasons ago) are kept;
 * this only fills what is genuinely open. Returns the lump sum the club banks
 * from majors signed *this* call, so the caller can credit the budget.
 */
function fillAiSponsorBook(state: GameState, team: Team, cfg: TuningConfig, season: number): number {
  team.sponsors ??= [];
  // Expire anything that has run its course before measuring what's open.
  team.sponsors = team.sponsors.filter((d) => d.expirySeason >= season);

  const rng = mulberry32(deriveSeed(state.seed, `aisponsors:${team.id}:${season}`));
  let banked = 0;

  for (const def of SPONSOR_SLOTS) {
    const kind = slotKind(def.slot, cfg);
    const capacity = slotCapacity(def.slot, cfg);
    const held = team.sponsors.filter((d) => d.slot === def.slot).length;
    const fillChance = kind === "major" ? cfg.aiSponsorMajorFillChance : cfg.aiSponsorMinorFillChance;

    for (let i = held; i < capacity; i++) {
      if (rng() >= fillChance) continue;
      const tierIndex = rollTier(state, team.id, cfg, rng);
      const equivalentWeekly =
        offerAmount(state, team.id, def.slot, tierIndex, cfg, rng) * cfg.aiSponsorValueMult;

      if (kind === "major") {
        const lo = Math.max(cfg.sponsorMajorLengthMin, cfg.sponsorMajorMinSeasons);
        const hi = Math.max(lo, cfg.sponsorMajorLengthMax);
        const seasons = lo + Math.floor(rng() * (hi - lo + 1));
        const upfront =
          Math.round((equivalentWeekly * 52 * seasons * cfg.sponsorMajorUpfrontMult) / 100_000) * 100_000;
        team.sponsors.push({
          id: uid("spd"),
          slot: def.slot,
          kind,
          brand: pick(rng, BRANDS[def.slot]),
          weeklyAmount: 0,
          upfront,
          expirySeason: season + seasons - 1,
          signedSeason: season,
          seasons,
        });
        banked += upfront;
      } else {
        team.sponsors.push({
          id: uid("spd"),
          slot: def.slot,
          kind,
          brand: pick(rng, BRANDS[def.slot]),
          weeklyAmount: Math.round((equivalentWeekly * cfg.sponsorMinorWeeklyMult) / 1000) * 1000,
          upfront: 0,
          expirySeason: season,
          signedSeason: season,
          seasons: 1,
        });
      }
    }
  }
  return banked;
}

/** Weekly income from an AI club's signed minor deals — the portfolio-derived
 * counterpart to the old abstract figure (v1.5). */
function aiSponsorWeekly(team: Team): number {
  return (team.sponsors ?? []).reduce((s, d) => s + (d.kind === "minor" ? d.weeklyAmount : 0), 0);
}

/**
 * Give every AI club an opening sponsorship book (v1.5), without paying out the
 * majors' lump sums. Used at worldgen and when migrating an old save: in both
 * cases the clubs' budgets are already set to what they should be, so crediting
 * the upfront money on top would hand the whole world an unearned war chest.
 * From the next rollover on, `refreshAiCommercial` does pay out — a major
 * signed then is genuinely new money.
 */
export function seedAiSponsorBooks(state: GameState, cfg: TuningConfig) {
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    if (!state.leagues[team.leagueId]?.playable) continue;
    fillAiSponsorBook(state, team, cfg, state.season);
    const weekly = aiSponsorWeekly(team);
    team.commercialIncome = weekly > 0 ? weekly : aiCommercialIncome(state, team.id, cfg);
  }
}

/** Put a slot to sleep for a randomised cooldown after an offer lapses or is
 * turned down, so passing has a cost and offers don't churn daily. */
function startCooldown(state: GameState, slot: SponsorSlot, cfg: TuningConfig) {
  const team = state.teams[state.userTeamId];
  const rng = mulberry32(deriveSeed(state.seed, `sponsorcd:${slot}:${state.season}:${state.currentDay}`));
  const span = Math.max(0, cfg.sponsorCooldownDaysMax - cfg.sponsorCooldownDaysMin);
  const days = cfg.sponsorCooldownDaysMin + Math.floor(rng() * (span + 1));
  // A marketable club doesn't stay quiet for long — the next suitor is already
  // waiting, so each star above the first shortens the lull (v20).
  const stars = marketabilityStarRating(state, state.userTeamId, cfg);
  const shortened = days * Math.max(0.2, 1 - (stars - 1) * cfg.sponsorMarketabilityCooldownPerStar);
  (team.sponsorCooldowns ??= {})[slot] = state.currentDay + Math.max(1, Math.round(shortened));
}

/** Ensure every empty, offer-less slot has a fresh live offer. Called from the
 * daily loop and when the game is first seeded. Deterministic per day/slot. */
export function refreshSponsorOffers(state: GameState, cfg: TuningConfig) {
  const team = state.teams[state.userTeamId];
  team.sponsors ??= [];
  team.sponsorOffers ??= [];
  team.sponsorCooldowns ??= {};

  // An offer that reaches its deadline unsigned is withdrawn — the suitor walks
  // and the slot goes quiet for a cooldown. This is the deadline having teeth.
  const lapsed = team.sponsorOffers.filter((o) => o.expiresDay <= state.currentDay);
  for (const o of lapsed) {
    startCooldown(state, o.slot, cfg);
    const def = SPONSOR_SLOTS.find((d) => d.slot === o.slot);
    state.news.unshift(
      `${o.brand} have withdrawn their ${def?.title.toLowerCase() ?? o.slot} offer after hearing nothing from the club.`
    );
  }
  team.sponsorOffers = team.sponsorOffers.filter((o) => o.expiresDay > state.currentDay);

  for (const def of SPONSOR_SLOTS) {
    // A slot with capacity for several deals keeps attracting suitors until it
    // is full — but only ever one live offer per slot at a time, so the user is
    // deciding on one regional partner rather than three at once.
    const hasOffer = team.sponsorOffers.some((o) => o.slot === def.slot);
    if (hasOffer) continue;
    if (!slotHasRoom(state, state.userTeamId, def.slot, cfg)) continue;
    // Slot is sleeping off a lapsed or rejected offer.
    if ((team.sponsorCooldowns[def.slot] ?? 0) > state.currentDay) continue;
    // With eleven slots open, cap how many decisions sit on the table at once —
    // a portfolio should feel like opportunities arriving, not an inbox. The cap
    // scales with Sponsor Marketability (v20): a club full of marketable names
    // genuinely has more brands chasing it at any one moment.
    if (team.sponsorOffers.length >= marketabilityMaxLiveOffers(state, state.userTeamId, cfg)) break;
    const rng = mulberry32(deriveSeed(state.seed, `sponsor:${def.slot}:${state.season}:${state.currentDay}`));
    const offer = makeOffer(state, state.userTeamId, def.slot, cfg, rng);
    team.sponsorOffers.push(offer);
    const deadline = offer.expiresDay - state.currentDay;
    state.news.unshift(
      `${offer.brand} table a ${def.title.toLowerCase()} offer — ${
        offer.kind === "major" ? `${formatOfferMoney(offer.upfront)} up front` : `${formatOfferMoney(offer.weeklyAmount)}/wk`
      }. They want an answer within ${deadline} days.`
    );
  }
}

/** Compact money for news lines (avoids importing the UI formatter into lib). */
function formatOfferMoney(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${n}`;
}

/** Accept an offer: it becomes a signed deal, its slot's other offers clear. */
export function acceptSponsor(state: GameState, offerId: string, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const offer = team.sponsorOffers?.find((o) => o.id === offerId);
  if (!offer) return "That offer is no longer on the table.";
  // The deadline is authoritative here, not just in the daily sweep — the user
  // could be looking at a stale card rendered before the offer lapsed.
  if (offer.expiresDay <= state.currentDay) return `${offer.brand} have withdrawn that offer.`;
  // Capacity is per slot (v19): a slot that holds several deals accepts another
  // until it is full, an exclusive one refuses the moment it is sold.
  const blocked = slotBlockedReason(state, state.userTeamId, offer.slot, cfg);
  if (blocked) return blocked;
  const deal: SponsorDeal = {
    id: uid("spd"),
    slot: offer.slot,
    kind: offer.kind,
    brand: offer.brand,
    weeklyAmount: offer.weeklyAmount,
    upfront: offer.upfront,
    expirySeason: state.season + offer.seasons - 1,
    signedSeason: state.season,
    seasons: offer.seasons,
  };
  // Major deals pay their lump sum straight into the budget on signing.
  if (deal.kind === "major") team.budget += deal.upfront;
  team.sponsors ??= [];
  team.sponsors.push(deal);
  // Only the signed offer leaves the table. A multi-capacity slot (regional
  // partners, say) can still be holding a separate live offer for its remaining
  // room, and that one stays valid.
  team.sponsorOffers = (team.sponsorOffers ?? []).filter((o) => o.id !== offer.id);
  return null;
}

/** Decline an offer — the suitor walks and the slot sleeps for a cooldown
 * before anyone else comes calling. Passing is a real decision, not a reroll. */
export function declineSponsor(state: GameState, offerId: string, cfg: TuningConfig): void {
  const team = state.teams[state.userTeamId];
  const offer = team.sponsorOffers?.find((o) => o.id === offerId);
  if (!offer) return;
  team.sponsorOffers = (team.sponsorOffers ?? []).filter((o) => o.id !== offerId);
  startCooldown(state, offer.slot, cfg);
}

/** Day a slot's next offer can appear, or null if it isn't sleeping. */
export function sponsorCooldownUntil(state: GameState, slot: SponsorSlot): number | null {
  const until = state.teams[state.userTeamId].sponsorCooldowns?.[slot] ?? 0;
  return until > state.currentDay ? until : null;
}

/** Total weekly income from signed minor (weekly) sponsor deals. Majors are
 * one-time lump sums paid on signing, so they contribute nothing weekly.
 *
 * For AI clubs (v19) this reads the single abstract `commercialIncome` figure
 * instead: they hold no deal objects, but they do have a commercial department,
 * and the money has to be real if their transfer budgets are to mean anything. */
export function sponsorWeeklyIncome(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  // v1.5: AI clubs hold real deals too, so the sum works for either side. The
  // stored `commercialIncome` is the fallback for a club whose book is empty
  // (a sim-league club, or a save from before AI portfolios existed).
  const fromDeals = (team.sponsors ?? []).reduce((s, d) => s + (d.kind === "minor" ? d.weeklyAmount : 0), 0);
  if (teamId !== state.userTeamId && fromDeals === 0) return team.commercialIncome ?? 0;
  return fromDeals;
}

/**
 * An AI club's abstract weekly commercial income (v19).
 *
 * AI clubs don't run the offer/slot machinery — that would be a great deal of
 * hidden bookkeeping the user never sees. Instead each carries one derived
 * figure standing in for its entire sponsorship portfolio, built from the same
 * inputs the user's offers use (reputation, division) plus a seeded per-club
 * variance so equally-sized clubs don't bank identical money. The result is
 * that a big club genuinely out-earns a small one commercially and can back
 * that up in the transfer market.
 */
export function aiCommercialIncome(state: GameState, teamId: string, cfg: TuningConfig): number {
  const team = state.teams[teamId];
  const league = state.leagues[team.leagueId];
  const tierMult = cfg.aiCommercialTierMult[(league?.tier ?? 2) - 1] ?? cfg.aiCommercialTierMult[cfg.aiCommercialTierMult.length - 1] ?? 1;
  // Seeded per club and season: stable within a season, drifts between them.
  const rng = mulberry32(deriveSeed(state.seed, `aicommercial:${teamId}:${state.season}`));
  const variance = 1 + (rng() * 2 - 1) * cfg.aiCommercialVariance;
  const base = team.reputation * cfg.aiCommercialPerReputation * tierMult * variance;
  return Math.round(base / 1000) * 1000;
}

/**
 * Resolve every AI club's commercial season (v1.5). Called at the rollover.
 *
 * Each club's sponsorship book is filled automatically — expired deals drop
 * out, open slots attract a quoted offer the club simply takes — and the two
 * money lines fall out of the book itself:
 *   • majors signed this season pay their lump sum straight into the budget,
 *     exactly as the user's do on signing;
 *   • the minors set `commercialIncome`, the weekly figure the AI's wage and
 *     affordability tests read.
 *
 * `commercialIncome` is still written, so every existing consumer
 * (`weeklyIncomeEstimate`, the economy) keeps working unchanged — it is now
 * *derived from real deals* rather than conjured from reputation directly.
 * A club whose minors all happen to lapse falls back to the abstract figure so
 * its wage tests never see a club with literally no commercial department.
 */
export function refreshAiCommercial(state: GameState, cfg: TuningConfig, season = state.season) {
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    if (!state.leagues[team.leagueId]?.playable) continue;

    const banked = fillAiSponsorBook(state, team, cfg, season);
    const weekly = aiSponsorWeekly(team);
    // The book is the source of truth; the abstract figure is the floor for a
    // club that drew no minors at all this season.
    team.commercialIncome = weekly > 0 ? weekly : aiCommercialIncome(state, team.id, cfg);

    // Majors are the AI's war chest. A club that signed none this season still
    // gets the old windfall, so a barren year isn't a commercial blackout.
    const windfall = banked > 0 ? banked : Math.round(team.commercialIncome * cfg.aiInvestmentWindfallWeeks);
    team.budget += windfall;
    team.lastInvestmentWindfall = windfall;
  }
}

/** Season rollover: expire deals that have run their course. Expired slots then
 * regenerate offers on the next daily refresh. */
export function rolloverSponsors(state: GameState) {
  const team = state.teams[state.userTeamId];
  if (!team.sponsors) return;
  const kept = team.sponsors.filter((d) => d.expirySeason >= state.season);
  team.sponsors = kept;
}

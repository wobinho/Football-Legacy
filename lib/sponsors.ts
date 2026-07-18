// Sponsors / investments (v6, Club → Income). Companies bid to sponsor the club
// on season-long deals: front-of-shirt, sleeve, apparel (kit maker), boot deal,
// and stadium naming rights. Offer quality scales with club reputation, league
// division, and — the design hook the user asked for — squad *marketability*
// (the Marketable trait). Sign a deal for a weekly income boost that runs until
// it expires, at which point a fresh offer arrives.

import type { GameState, SponsorDeal, SponsorKind, SponsorOffer, SponsorSlot } from "./types";
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

export const SPONSOR_SLOTS: SponsorSlotDef[] = [
  { slot: "shirt", kind: "major", title: "Shirt Sponsor", blurb: "The name across the front of the shirt — a landmark deal paid up front, for several seasons.", icon: "👕" },
  { slot: "stadium", kind: "major", title: "Stadium Naming Rights", blurb: "Sell your ground's name for a premium lump sum that lands in the budget immediately.", icon: "🏟️" },
  { slot: "sleeve", kind: "minor", title: "Sleeve Sponsor", blurb: "A secondary badge on the sleeve — a steady weekly top-up, one season at a time.", icon: "🎽" },
  { slot: "apparel", kind: "minor", title: "Apparel Partner", blurb: "Your kit manufacturer — weekly income from every shirt sold.", icon: "🏭" },
  { slot: "boot", kind: "minor", title: "Boot Deal", blurb: "A footwear brand aligns with the club's stars for a weekly fee.", icon: "👟" },
];

// Brand pools per slot — fictional, evocative names (no real IP).
const BRANDS: Record<SponsorSlot, string[]> = {
  shirt: ["Aeltra Airlines", "Novabet", "Zephyr Motors", "Kaizen Finance", "Solaris Energy", "Meridian Bank", "Volt Telecom", "Orion Crypto"],
  sleeve: ["Pulse Drinks", "Cirro Cloud", "Halo Insurance", "Bloom Wellness", "Nimbus Tech", "Vega Watches"],
  apparel: ["Strider", "Apex Athletic", "Kestrel Sport", "Vantage", "Fjord", "Talon"],
  boot: ["Strider Boots", "Cobra Cleats", "Vipr", "Ignis Footwear", "Panthera", "Blaze"],
  stadium: ["Aeltra Arena", "Solaris Park", "Meridian Stadium", "Kaizen Dome", "Volt Field", "Orion Ground"],
};

const TIER_NAMES = ["Regional", "National", "Global"];

/** Total squad marketability: summed marketabilityBonus of the club's on-books
 * players (senior squad). A marketable star lifts every offer. */
export function squadMarketability(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  const marketableIds = new Set(TRAITS.filter((t) => t.effects.marketabilityBonus !== undefined).map((t) => t.id));
  let sum = 0;
  for (const id of team.playerIds) {
    const p = state.players[id];
    if (!p || p.retired) continue;
    for (const tId of p.traits) {
      if (marketableIds.has(tId)) {
        const b = TRAITS.find((t) => t.id === tId)?.effects.marketabilityBonus ?? 0;
        // weight by how big a name the player is (overall) so a marketable star
        // is worth more than a marketable squad filler
        sum += b * (0.6 + p.overall / 100);
      }
    }
  }
  return sum;
}

/** Weekly amount for a fresh offer in a given slot at a given tier. */
function offerAmount(state: GameState, teamId: string, slot: SponsorSlot, tierIndex: number, cfg: TuningConfig, rng: RNG): number {
  const team = state.teams[teamId];
  const league = state.leagues[team.leagueId];
  const divisionMult = league ? (league.tier === 1 ? 1.6 : 1.0) : 1.0;
  const share = cfg.sponsorSlotShare[slot] ?? 0.5;
  const base = team.reputation * cfg.sponsorBaseWeeklyByReputation * share * divisionMult;
  const tierMult = cfg.sponsorTierMults[tierIndex] ?? 1.0;
  const marketMult = 1 + squadMarketability(state, teamId) * cfg.sponsorMarketabilityFactor;
  const noise = 0.9 + rng() * 0.2;
  return Math.round((base * tierMult * marketMult * noise) / 1000) * 1000;
}

/** Pick an offer tier, weighted upward by reputation + marketability so bigger,
 * more marketable clubs see better brands more often. */
function rollTier(state: GameState, teamId: string, cfg: TuningConfig, rng: RNG): number {
  const team = state.teams[teamId];
  const pull = team.reputation / 100 + squadMarketability(state, teamId) * cfg.sponsorMarketabilityFactor;
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
    const seasons =
      cfg.sponsorMajorLengthMin + Math.floor(rng() * (cfg.sponsorMajorLengthMax - cfg.sponsorMajorLengthMin + 1));
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
      expiresDay: state.currentDay + cfg.sponsorOfferExpiryDays,
    };
  }

  // minor: weekly income, at most one season
  return {
    id: uid("spo"),
    slot,
    kind,
    brand: pick(rng, BRANDS[slot]),
    weeklyAmount: equivalentWeekly,
    upfront: 0,
    seasons: 1,
    tier: TIER_NAMES[tierIndex],
    day: state.currentDay,
    expiresDay: state.currentDay + cfg.sponsorOfferExpiryDays,
  };
}

/** Ensure every empty, offer-less slot has a fresh live offer. Called from the
 * daily loop and when the game is first seeded. Deterministic per day/slot. */
export function refreshSponsorOffers(state: GameState, cfg: TuningConfig) {
  const team = state.teams[state.userTeamId];
  team.sponsors ??= [];
  team.sponsorOffers ??= [];
  // drop expired offers
  team.sponsorOffers = team.sponsorOffers.filter((o) => o.expiresDay > state.currentDay);
  for (const def of SPONSOR_SLOTS) {
    const hasDeal = team.sponsors.some((d) => d.slot === def.slot);
    const hasOffer = team.sponsorOffers.some((o) => o.slot === def.slot);
    if (hasDeal || hasOffer) continue;
    const rng = mulberry32(deriveSeed(state.seed, `sponsor:${def.slot}:${state.season}:${state.currentDay}`));
    team.sponsorOffers.push(makeOffer(state, state.userTeamId, def.slot, cfg, rng));
  }
}

/** Accept an offer: it becomes a signed deal, its slot's other offers clear. */
export function acceptSponsor(state: GameState, offerId: string, cfg: TuningConfig): string | null {
  const team = state.teams[state.userTeamId];
  const offer = team.sponsorOffers?.find((o) => o.id === offerId);
  if (!offer) return "That offer is no longer on the table.";
  if (team.sponsors?.some((d) => d.slot === offer.slot)) return "You already have a deal in that slot.";
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
  team.sponsorOffers = (team.sponsorOffers ?? []).filter((o) => o.slot !== offer.slot);
  return null;
}

/** Decline an offer — the slot reopens and a fresh offer lands on a later day. */
export function declineSponsor(state: GameState, offerId: string): void {
  const team = state.teams[state.userTeamId];
  if (!team.sponsorOffers) return;
  team.sponsorOffers = team.sponsorOffers.filter((o) => o.id !== offerId);
}

/** Total weekly income from signed minor (weekly) sponsor deals. Majors are
 * one-time lump sums paid on signing, so they contribute nothing weekly. */
export function sponsorWeeklyIncome(state: GameState, teamId: string): number {
  const team = state.teams[teamId];
  return (team.sponsors ?? []).reduce((s, d) => s + (d.kind === "minor" ? d.weeklyAmount : 0), 0);
}

/** Season rollover: expire deals that have run their course. Expired slots then
 * regenerate offers on the next daily refresh. */
export function rolloverSponsors(state: GameState) {
  const team = state.teams[state.userTeamId];
  if (!team.sponsors) return;
  const kept = team.sponsors.filter((d) => d.expirySeason >= state.season);
  team.sponsors = kept;
}

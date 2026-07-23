// ── Player contracts (§10, v5) ────────────────────────────────────────────
// Overrides the old aggregate wage bill: every squad player carries an
// individual Contract (wage + length + expiry season). The squad wage bill is
// now the sum of real contract wages; expiring deals must be renewed or the
// player leaves on a free at the season rollover. Kept isolated in one module
// like the rest of the transfer/economy systems (§2 modularity).

import type { Contract, ContractResolution, ExpiringContract, GameState, PlayerBio } from "./types";
import type { TuningConfig } from "./config/tuning";
import { deriveSeed, mulberry32 } from "./rng";
import { pushInboxItem } from "./inbox";
import { activePlayers } from "./archive";

/** The base weekly wage the wage curve implies for an ability level. */
export function baseWage(overall: number, cfg: TuningConfig): number {
  return Math.round((cfg.contractWageCurve.base * Math.exp(cfg.contractWageCurve.exponent * overall)) / 100) * 100;
}

/** Age nudge on wage demands: kids come cheaper, primed stars a touch dearer. */
function ageDemandFactor(age: number): number {
  if (age <= 20) return 0.75;
  if (age <= 23) return 0.9;
  if (age <= 30) return 1.0;
  if (age <= 33) return 0.92;
  return 0.8;
}

/** What a player would demand per week to sign a fresh deal. Deterministic-ish
 * (seeded per player) so the number is stable across a negotiation session. */
export function wageDemand(state: GameState, p: PlayerBio, cfg: TuningConfig): number {
  const rng = mulberry32(deriveSeed(state.seed, `wage:${p.id}:${p.overall}`));
  const jitter = 0.9 + rng() * 0.2;
  const raw = baseWage(p.overall, cfg) * cfg.contractDemandMult * ageDemandFactor(p.age) * jitter;
  return Math.max(500, Math.round(raw / 100) * 100);
}

/** How many seasons the player is willing to commit to (veterans go short). */
export function maxLengthFor(p: PlayerBio, cfg: TuningConfig): number {
  if (p.age >= cfg.contractVeteranAge + 3) return 1;
  if (p.age >= cfg.contractVeteranAge) return 2;
  return cfg.contractLengthMax;
}

/** Build a contract running `years` seasons from the current season. */
export function makeContract(state: GameState, wage: number, years: number, releaseClause?: number): Contract {
  return {
    wage,
    expirySeason: state.season + Math.max(1, years) - 1,
    signedSeason: state.season,
    ...(releaseClause ? { releaseClause } : {}),
  };
}

/** Seasons remaining on a contract, given the current season. */
export function yearsLeft(state: GameState, p: PlayerBio): number {
  if (!p.contract) return 0;
  return Math.max(0, p.contract.expirySeason - state.season + 1);
}

// ── Release clauses (§10, v21) ────────────────────────────────────────────
// A clause is a fixed fee that lets any club buy the player outright, ignoring
// what his own club thinks he's worth. The player likes having one — it's an
// exit route — so he'll shave his wage demand to get it. How much he shaves
// depends on how reachable the number is: a clause near his market value is a
// genuine escape hatch and is worth real money to him, one at four times value
// is decoration and buys nothing.

/** The lowest clause figure this player would accept, or the point above which
 * a clause stops being worth anything to him. Both are multiples of value. */
export function releaseClauseBounds(p: PlayerBio, cfg: TuningConfig): { min: number; max: number; suggested: number } {
  const round = (n: number) => Math.max(100_000, Math.round(n / 100_000) * 100_000);
  return {
    min: round(p.value * cfg.releaseClauseMinMult),
    max: round(p.value * cfg.releaseClauseMaxMult),
    suggested: round(p.value * cfg.releaseClauseSuggestedMult),
  };
}

/** The fraction a player knocks off his wage demand in exchange for a clause at
 * `clause`. Full discount at the minimum acceptable figure, tapering linearly to
 * nothing at the point the clause is too remote to matter. */
export function releaseClauseWageDiscount(p: PlayerBio, clause: number | undefined, cfg: TuningConfig): number {
  if (!clause) return 0;
  const { min, max } = releaseClauseBounds(p, cfg);
  if (clause < min || max <= min) return 0;
  const reach = Math.min(1, (clause - min) / (max - min)); // 0 = right at the floor
  return cfg.releaseClauseMaxWageDiscount * (1 - reach);
}

/** What this player demands per week given the clause on the table (if any). */
export function wageDemandWithClause(
  state: GameState,
  p: PlayerBio,
  clause: number | undefined,
  cfg: TuningConfig
): number {
  const base = wageDemand(state, p, cfg);
  const discounted = base * (1 - releaseClauseWageDiscount(p, clause, cfg));
  return Math.max(500, Math.round(discounted / 100) * 100);
}

export interface OfferVerdict {
  kind: "accepted" | "countered" | "rejected";
  wage: number; // agreed (accepted) or demanded (countered/rejected)
  message: string;
}

/** A player weighs a contract offer of `wage`/wk over `years`. Accepts at/above
 * their demand, counters with the demand if the offer is close, rejects if it's
 * miserly. Length beyond what a veteran will sign is trimmed on acceptance. */
export function evaluateOffer(
  state: GameState,
  p: PlayerBio,
  wage: number,
  years: number,
  cfg: TuningConfig,
  releaseClause?: number
): OfferVerdict {
  // A clause below what he'd ever accept is worse than none — he won't be tied
  // to a number that lets anyone take him for a fraction of his worth.
  if (releaseClause !== undefined) {
    const { min } = releaseClauseBounds(p, cfg);
    if (releaseClause < min) {
      return {
        kind: "rejected",
        wage: wageDemand(state, p, cfg),
        message: `${p.name} won't be bought out that cheaply — any release clause has to start around ${fmt(min)}.`,
      };
    }
  }
  const demand = wageDemandWithClause(state, p, releaseClause, cfg);
  const cappedYears = Math.min(years, maxLengthFor(p, cfg));
  if (wage >= demand * cfg.contractAcceptRatio) {
    const clauseNote = releaseClause ? ` with a ${fmt(releaseClause)} release clause` : "";
    return { kind: "accepted", wage, message: `${p.name} accepts ${cappedYears}-year terms at ${fmt(wage)}/wk${clauseNote}.` };
  }
  if (wage >= demand * cfg.contractRejectRatio) {
    return { kind: "countered", wage: demand, message: `${p.name} wants ${fmt(demand)}/wk to sign.` };
  }
  return { kind: "rejected", wage: demand, message: `${p.name} laughed off the offer — he's looking for around ${fmt(demand)}/wk.` };
}

/** Apply an accepted deal to a player already at the club (renewal) or joining. */
export function applyContract(
  state: GameState,
  p: PlayerBio,
  wage: number,
  years: number,
  cfg: TuningConfig,
  releaseClause?: number
) {
  p.contract = makeContract(state, wage, Math.min(years, maxLengthFor(p, cfg)), releaseClause);
}

/** Give a newly-signed player a default contract at their demand (used when a
 * transfer/free signing completes without an explicit negotiation, keeping the
 * AI world simple). */
export function grantDefaultContract(state: GameState, p: PlayerBio, cfg: TuningConfig, years?: number) {
  const wage = wageDemand(state, p, cfg);
  const len = years ?? Math.min(cfg.contractRenewYearsDefault, maxLengthFor(p, cfg));
  p.contract = makeContract(state, wage, len);
}

/** Ensure every club-attached player has a contract (backfill for AI signings /
 * migrated saves). Free agents and retirees keep none. Lengths are staggered
 * (seeded per player) so a fresh world's deals don't all expire the same summer
 * — real squads have a spread of contract situations. */
export function ensureContracts(state: GameState, cfg: TuningConfig) {
  const userAcademy = new Set(state.teams[state.userTeamId].academyPlayerIds ?? []);
  // Aged-out prospects awaiting a senior decision (v1.51) belong to the club but
  // are on neither squad list. Backfilling a contract here would put them on the
  // wage bill — and quietly make the decision the manager is supposed to make.
  const awaiting = new Set((state.pendingGraduates ?? []).map((g) => g.playerId));
  // Retirees are handled by the rollover's prune pass, which clears their
  // contracts as part of compacting them — so this only walks the living world.
  for (const p of activePlayers(state)) {
    if (!p.clubId) {
      p.contract = undefined;
      continue;
    }
    // The user's academy players are wage-free (§18) — no contract until promoted.
    if (userAcademy.has(p.id)) continue;
    if (awaiting.has(p.id)) continue;
    if (!p.contract) {
      const rng = mulberry32(deriveSeed(state.seed, `clen:${p.id}`));
      const span = maxLengthFor(p, cfg);
      const years = 1 + Math.floor(rng() * span); // 1..span, evenly spread
      grantDefaultContract(state, p, cfg, years);
    }
  }
}

// ── End-of-season contract resolution (§10, v1.51) ────────────────────────
// Expiring deals used to be settled by the rollover alone: the user's players
// were simply released, and the only warning was an inbox note the previous
// summer. That made losing a key player feel like an accounting accident rather
// than a decision. The round below puts every expiry to the manager during the
// dead week — after the awards, before END SEASON — so nobody walks for free
// without the manager having chosen to let them.

/** Every player on the user's books whose deal runs out at this rollover, best
 * first — the decisions that matter most sit at the top of the list rather than
 * buried in squad order. Academy prospects appear only if they actually carry a
 * contract; the wage-free ones are governed by the §18 age-out rule instead. */
export function expiringUserContracts(state: GameState): PlayerBio[] {
  const team = state.teams[state.userTeamId];
  const ids = new Set([...team.playerIds, ...(team.academyPlayerIds ?? [])]);
  return [...ids]
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => !!p && !p.retired && !!p.contract && p.contract.expirySeason <= state.season)
    .sort((a, b) => b.overall - a.overall);
}

/**
 * Open the resolution round for this season (v1.51). Called once on
 * `contractResolveDay`. Returns the number of decisions waiting, or 0 when the
 * squad has nothing expiring — in which case no block is stored and the UI never
 * prompts. Idempotent: re-opening an already-open round for the same season is a
 * no-op, so a save reloaded on that exact day can't wipe decisions already made.
 */
export function openContractResolution(state: GameState): number {
  if (state.contractResolution?.season === state.season) return state.contractResolution.items.length;
  const team = state.teams[state.userTeamId];
  const academy = new Set(team.academyPlayerIds ?? []);
  const expiring = expiringUserContracts(state);
  if (!expiring.length) {
    state.contractResolution = undefined;
    return 0;
  }
  const resolution: ContractResolution = {
    season: state.season,
    openedDay: state.currentDay,
    items: expiring.map<ExpiringContract>((p) => ({
      playerId: p.id,
      academy: academy.has(p.id),
      decision: "undecided",
    })),
  };
  state.contractResolution = resolution;
  pushInboxItem(
    state,
    "board",
    expiring.length === 1 ? "One contract to resolve" : `${expiring.length} contracts to resolve`,
    `${expiring.map((p) => p.name).join(", ")} ${expiring.length === 1 ? "is" : "are"} out of contract this summer. ` +
      `Agree new terms with each of them or let them leave on a free — the board wants it settled before the season closes. ` +
      `Anyone still undecided when you press END SEASON walks away for nothing.`
  );
  return expiring.length;
}

/** How many decisions in the open round are still outstanding. */
export function undecidedContractCount(state: GameState): number {
  const res = state.contractResolution;
  if (!res || res.season !== state.season) return 0;
  return res.items.filter((i) => i.decision === "undecided").length;
}

/** Record the manager's call on one expiring deal. Renewal terms are held until
 * the rollover applies them, so the wage bill only moves when the new season
 * actually starts — the player is still on his old deal until then. */
export function decideContract(
  state: GameState,
  playerId: string,
  decision: "renew" | "release",
  terms?: { wage: number; years: number; releaseClause?: number }
): string | null {
  const res = state.contractResolution;
  if (!res || res.season !== state.season) return "There is no contract round open.";
  const item = res.items.find((i) => i.playerId === playerId);
  if (!item) return "That player isn't in this summer's contract round.";
  item.decision = decision;
  item.terms = decision === "renew" ? terms : undefined;
  return null;
}

/** Apply the round's decisions at the rollover, then clear it. Returns the names
 * of everyone who left, split by whether the manager chose it or simply never
 * got to them — the review inbox reads differently for the two. */
function applyContractResolution(
  state: GameState,
  cfg: TuningConfig
): { released: string[]; lapsed: string[]; renewed: string[]; retained: string[] } {
  const out = {
    released: [] as string[],
    lapsed: [] as string[],
    renewed: [] as string[],
    retained: [] as string[],
  };
  const res = state.contractResolution;
  if (!res) return out;
  // A block left over from a different season can't be trusted to describe this
  // summer's expiries — drop it and let the sweep in rolloverContracts handle
  // whatever is genuinely out of contract.
  if (res.season !== state.season) {
    state.contractResolution = undefined;
    return out;
  }

  // Explicit decisions first, so the squad floor below is judged against what
  // the manager actually chose rather than the order the list happened to be in.
  const decided = res.items.filter((i) => i.decision !== "undecided");
  const undecided = res.items.filter((i) => i.decision === "undecided");

  const stillHere = (item: ExpiringContract): PlayerBio | null => {
    const p = state.players[item.playerId];
    // He may have been sold, retired or released in the meantime — the decision
    // is simply moot then.
    return p && !p.retired && p.clubId === state.userTeamId ? p : null;
  };

  for (const item of decided) {
    const p = stillHere(item);
    if (!p) continue;
    if (item.decision === "renew") {
      const terms = item.terms;
      if (terms) applyContract(state, p, terms.wage, terms.years, cfg, terms.releaseClause);
      else grantDefaultContract(state, p, cfg);
      out.renewed.push(p.name);
    } else {
      releaseToFreeAgency(state, p);
      out.released.push(p.name);
    }
  }

  // Anything the manager never got to lapses — but not past the point where the
  // club can still field a side. A manager who ignores the round should lose the
  // players they didn't fight for, not the ability to fulfil fixtures: the squad
  // is held at `matchdaySquad` by quietly renewing the best of whoever is left,
  // best first, so the players kept are the ones worth keeping. This is a
  // backstop for inattention, not a way to dodge the decision — everyone above
  // the floor still walks.
  const team = state.teams[state.userTeamId];
  const lapsing = undecided
    .map((item) => ({ item, p: stillHere(item) }))
    .filter((x): x is { item: ExpiringContract; p: PlayerBio } => !!x.p)
    // Worst first, so the floor keeps the best of the undecided.
    .sort((a, b) => a.p.overall - b.p.overall);

  for (const { p } of lapsing) {
    if (team.playerIds.length <= cfg.matchdaySquad) {
      grantDefaultContract(state, p, cfg);
      out.retained.push(p.name);
      continue;
    }
    releaseToFreeAgency(state, p);
    out.lapsed.push(p.name);
  }

  state.contractResolution = undefined;
  return out;
}

/** Detach a player from the user's club entirely — squad, academy and every
 * academy list — and clear his contract. The shared exit path for both a chosen
 * release and a deal simply allowed to lapse. */
function releaseToFreeAgency(state: GameState, p: PlayerBio) {
  const team = state.teams[state.userTeamId];
  team.playerIds = team.playerIds.filter((id) => id !== p.id);
  team.academyPlayerIds = (team.academyPlayerIds ?? []).filter((id) => id !== p.id);
  state.academy.focusIds = state.academy.focusIds.filter((id) => id !== p.id);
  state.academy.loanList = state.academy.loanList.filter((id) => id !== p.id);
  state.academy.u21Squad = (state.academy.u21Squad ?? []).filter((id) => id !== p.id);
  p.clubId = null;
  p.contract = undefined;
  p.loan = undefined;
  if (!state.careers[p.id]) state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
  state.careers[p.id].transfers.push({
    season: state.season,
    day: state.currentDay,
    from: team.name,
    to: "Contract expired",
    fee: 0,
    fromId: team.id,
  });
}

/**
 * Season-rollover contract pass. Runs after ages tick and before the new season
 * scaffolding. Expiring deals:
 *  - user players: settled by the resolution round taken during the dead week
 *    (v1.51) — renewed on the agreed terms, or released. A save that never saw
 *    that round (or a player who somehow escaped it) falls back to the old
 *    behaviour of releasing him, so nobody can be left in limbo.
 *  - AI players: auto-renewed silently so the AI world never bleeds squads.
 * A final-year warning goes out for the user's own players still under contract.
 * Returns the list of released user player names for the review inbox.
 */
export function rolloverContracts(state: GameState, cfg: TuningConfig): string[] {
  const userId = state.userTeamId;
  // The manager's own decisions first, so anyone he renewed is already back
  // under contract by the time the sweep below looks for expiries.
  const resolved = applyContractResolution(state, cfg);
  const released: string[] = [...resolved.released, ...resolved.lapsed];

  const userAcademy = new Set(state.teams[userId].academyPlayerIds ?? []);
  // The user's own leftovers are gathered rather than released inline, so the
  // same squad floor the resolution round applies can be applied here too — this
  // path catches old saves and anyone who joined after the round opened, and it
  // must not be a back door that empties the squad the round is guarding.
  const userLeftovers: PlayerBio[] = [];
  for (const p of activePlayers(state)) {
    if (!p.clubId || !p.contract) continue;
    // Academy players carry no wages and are governed by the §18 age-out rule,
    // not contract expiry — never release them here.
    if (userAcademy.has(p.id)) continue;
    const expired = p.contract.expirySeason < state.season;
    if (!expired) continue;

    if (p.clubId === userId) userLeftovers.push(p);
    // AI: renew at demand so no AI club loses a player to admin
    else grantDefaultContract(state, p, cfg);
  }

  const team = state.teams[userId];
  const boardRenewed: string[] = [];
  // Worst first, so the floor keeps the best of whoever is left.
  for (const p of userLeftovers.sort((a, b) => a.overall - b.overall)) {
    if (team.playerIds.length <= cfg.matchdaySquad) {
      grantDefaultContract(state, p, cfg);
      boardRenewed.push(p.name);
      continue;
    }
    releaseToFreeAgency(state, p);
    released.push(p.name);
  }
  if (boardRenewed.length) {
    pushInboxItem(
      state,
      "board",
      "The board stepped in",
      `${boardRenewed.join(", ")} ${boardRenewed.length === 1 ? "was" : "were"} out of contract with the squad ` +
        `already down to a bare matchday side, so the board renewed on standard terms rather than leave you short.`
    );
  }

  if (resolved.renewed.length) {
    pushInboxItem(
      state,
      "board",
      "New contracts signed",
      `${resolved.renewed.join(", ")} ${resolved.renewed.length === 1 ? "has" : "have"} put pen to paper on new terms. ` +
        `The new wages take effect from the start of the season.`
    );
  }
  if (resolved.retained.length) {
    pushInboxItem(
      state,
      "board",
      "The board stepped in",
      `You left ${resolved.retained.join(", ")} unresolved and the squad was about to fall below a fieldable side, ` +
        `so the board renewed ${resolved.retained.length === 1 ? "his deal" : "their deals"} on standard terms. ` +
        `Settle your contracts in the end-of-season round if you want a say in who stays.`
    );
  }

  // warn the user about their own players entering the final year of a deal
  const finalYear = [...team.playerIds, ...(team.academyPlayerIds ?? [])]
    .map((id) => state.players[id])
    .filter((p) => p && !p.retired && p.contract && p.contract.expirySeason === state.season);
  if (finalYear.length) {
    pushInboxItem(
      state,
      "board",
      "Contracts entering their final year",
      `${finalYear.map((p) => p.name).join(", ")} ${finalYear.length === 1 ? "is" : "are"} in the last year of their contract. ` +
        `Renew them on the Squad screen, or settle it in the contract round at the end of the season.`
    );
  }

  return released;
}

function fmt(n: number): string {
  return n >= 1_000 ? `£${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `£${n}`;
}

// ── Dynamic rivalries (v1.94) ─────────────────────────────────────────────
//
// A rivalry the SAVE invented. Nothing here is seeded by worldgen and nothing
// is authored in a database: two clubs become enemies because of football that
// actually happened in this world, and the manager watched it happen.
//
// ── The two ways one forms ────────────────────────────────────────────────
//   1. A cup final. One match, settled immediately — you met in a final, that
//      is a rivalry, and the story writes itself.
//   2. A title race: both clubs inside the top `rivalryTitleRaceTop` of the same
//      division for `rivalryTitleRaceSeasons` consecutive seasons. Three is the
//      brief's number and it earns its place — in a division where the same six
//      clubs share the top places every year, two seasons is a coincidence and
//      three is a pattern.
//
// Both are read off `state.recordBook.seasons`, which is the same derived-not-
// stored discipline the roll of honour follows (v1.89): the record book already
// contains every fact a rivalry needs, and re-deriving from it means there is no
// second history to keep in sync. What IS stored is the rivalry itself, for the
// reason `cupRunnerUp` is stored — the record book gets compacted, and a rivalry
// has to keep its founding story long after the fixtures behind it are gone.
//
// ── What a rivalry DOES ───────────────────────────────────────────────────
//   · A rivalry fixture multiplies the Performance Bonus and Stadium Bonus
//     upgrade tracks by `rivalryMatchBonusMult` (see `rivalryMatchMultiplier`,
//     consumed by `matchUpgradeIncome`). It multiplies those TRACKS and nothing
//     else, so it pays a manager who invested in them rather than handing out
//     flat cash — the money is a return on a decision, not a windfall.
//   · The week of a rivalry fixture attracts one-off minor sponsorships at a
//     premium (`rivalryOfferCount`, `rivalryOfferAmountMult`), which expire with
//     the fixture. That is the "exclusive, high-paying, one-off" half of the
//     brief, and it is deliberately an OFFER rather than a payment: the manager
//     still chooses whether the slot is worth spending on a one-season deal.
//
// ── MEASURED, and the one number to know (v1.94) ──────────────────────────
// Four played-out worlds (14/14/14/10 seasons, `scripts/_rivalprobe`-style
// drives through the real engine and rollover):
//
//   seed 7     1 rivalry,  9 derbies   finishes 2,6,9,18,9,3,11,14,...
//   seed 909   3 rivalries, 61 derbies finishes 1,4,3,6,14,6,10,4,...
//   seed 4242  0 rivalries, 0 derbies  finishes 11,8,14,20,4,2,16,...
//   seed 909*  1 rivalry,  14 derbies  finishes 3,4,6,7,9,4,9,12,13,11
//
// A save carries 1–3 rivalries, which is the density the cap was chosen for.
// But EVERY ONE of them formed on the cup final, and NOT ONE on the title race
// — because no world produced three CONSECUTIVE top-three finishes. The best
// run measured was 1,4,3: top three in two of three seasons, broken by a
// fourth-place finish that resets the count.
//
// The trigger is not broken (verify:rivalry proves it fires on the pattern);
// the pattern is simply rarer than it sounds. A division's top three turns over
// more than intuition suggests, and requiring the USER to be in it every season
// as well squares an already-small probability. If the title-race route should
// actually fire, the lever is `rivalryTitleRaceTop` (top 3 → 4 admits the near
// misses) or counting N of the last M seasons rather than N consecutive —
// NOT lowering `rivalryTitleRaceSeasons`, which is what makes three seasons a
// pattern instead of a coincidence. Both are design changes, so measure again
// before and after: this note exists so nobody re-derives it from scratch.
//
// ── Why it can go quiet ───────────────────────────────────────────────────
// `rivalryDormantSeasons` retires a rivalry the clubs have stopped playing. A
// club relegated three divisions is not your rival any more, and without this a
// rivalry would keep paying out forever on a fixture that can never happen —
// which is a permanent income boost with a story attached, not a rivalry.

import type {
  Fixture,
  GameState,
  Rivalry,
  RivalryCause,
  SeasonSummary,
  SponsorOffer,
  Team,
} from "./types";
import type { TuningConfig } from "./config/tuning";
import { deriveSeed, mulberry32, pick, uid } from "./rng";

/** Every rivalry the save holds. Empty for a save that has never formed one. */
export function rivalriesOf(state: GameState): Rivalry[] {
  return state.rivalries ?? [];
}

/**
 * Whether a club is currently a rival — the single question every consumer asks.
 *
 * "Currently" is the operative word: a rivalry the clubs have not played for
 * `rivalryDormantSeasons` is dormant and confers nothing, but it is NOT deleted.
 * Keeping it means a promoted club that meets you again resumes the rivalry it
 * already had, with its record intact, rather than starting a fresh three-season
 * count from nothing. The history is the point of the feature.
 */
export function isRival(state: GameState, teamId: string, cfg: TuningConfig): boolean {
  const r = rivalriesOf(state).find((x) => x.rivalId === teamId);
  if (!r) return false;
  return state.season - r.lastMetSeason <= cfg.rivalryDormantSeasons;
}

/** The rivalry record against one club, dormant or not — for the UI, which
 * should show a dormant rivalry rather than pretend it never happened. */
export function rivalryWith(state: GameState, teamId: string): Rivalry | undefined {
  return rivalriesOf(state).find((x) => x.rivalId === teamId);
}

/** The clubs that are rivals right now, in the order they were formed. */
export function activeRivalries(state: GameState, cfg: TuningConfig): Rivalry[] {
  return rivalriesOf(state).filter((r) => isRival(state, r.rivalId, cfg));
}

/** Is this fixture a derby — the user's club against a current rival? */
export function isRivalryFixture(state: GameState, fixture: Fixture, cfg: TuningConfig): boolean {
  const { homeId, awayId } = fixture;
  if (homeId !== state.userTeamId && awayId !== state.userTeamId) return false;
  const opponent = homeId === state.userTeamId ? awayId : homeId;
  return isRival(state, opponent, cfg);
}

/**
 * The multiplier a fixture applies to the Performance and Stadium Bonus tracks.
 *
 * 1 for every ordinary match, so `matchUpgradeIncome` can multiply by it
 * unconditionally and a save with no rivalries is arithmetically untouched.
 */
export function rivalryMatchMultiplier(
  state: GameState,
  fixture: Fixture | undefined,
  cfg: TuningConfig
): number {
  if (!fixture) return 1;
  return isRivalryFixture(state, fixture, cfg) ? cfg.rivalryMatchBonusMult : 1;
}

// ── Formation ─────────────────────────────────────────────────────────────

/** The user's finishing position in a summary's own division, or 0 if they had
 * no final table that season (a sim league, or a season with no fixtures). */
function userFinishIn(summary: SeasonSummary): number {
  return summary.userPosition ?? 0;
}

/**
 * The clubs that finished inside the top N of the USER's division in one season,
 * excluding the user themselves — plus WHICH division that was.
 *
 * Reads the summary's stored `finalTables`, which is the division as it was —
 * the promotion shuffle rewrites league membership at the rollover, so a table
 * re-derived later describes a different competition.
 *
 * The league id is returned alongside the clubs because the title-race trigger
 * needs it: three top-three finishes spread across a promotion are three
 * finishes in TWO different races, and a club you shared a second-tier podium
 * with two seasons ago is not your rival in the division you play now. Callers
 * compare the ids rather than assuming the window sits in one division.
 */
function topFinishersAround(
  summary: SeasonSummary,
  userTeamId: string,
  top: number
): { leagueId: string; teamIds: string[] } | null {
  // The user's own division is the one their club appears in. Searching for it
  // rather than assuming a league id keeps this correct across promotion.
  for (const [leagueId, rows] of Object.entries(summary.finalTables ?? {})) {
    if (!rows.some((r) => r.teamId === userTeamId)) continue;
    return {
      leagueId,
      teamIds: rows
        .slice(0, top)
        .map((r) => r.teamId)
        .filter((id) => id !== userTeamId),
    };
  }
  return null;
}

/** Did the user contest this season's cup final, and against whom? Returns the
 * opponent's id, or null. Reads the two stored fields rather than the bracket:
 * the rollover rebuilds the cup a few steps later (v1.91's reason for storing
 * `cupRunnerUp` at all). */
function cupFinalOpponent(summary: SeasonSummary, userTeamId: string): string | null {
  const winner = summary.cupWinner;
  const loser = summary.cupRunnerUp;
  if (!winner || !loser) return null;
  if (winner.teamId === userTeamId) return loser.teamId;
  if (loser.teamId === userTeamId) return winner.teamId;
  return null;
}

/** A newly-formed rivalry, ready to be filed and announced. */
export interface RivalryFormed {
  rivalry: Rivalry;
  /** Headline for the inbox. */
  title: string;
}

function storyFor(
  cause: RivalryCause,
  rivalName: string,
  userName: string,
  cfg: TuningConfig,
  detail: string
): string {
  return cause === "cupFinal"
    ? `${userName} and ${rivalName} met in the cup final, and neither set of supporters is going to forget it. ${detail} The fixture between these two is a derby now — the board expect a different atmosphere, and the commercial department is already fielding calls.`
    : `${rivalName} have finished inside the top ${cfg.rivalryTitleRaceTop} alongside ${userName} for ${cfg.rivalryTitleRaceSeasons} seasons running. ${detail} What was a fixture is a rivalry: two clubs who keep ending up in each other's way, and a title race that has stopped feeling like a coincidence.`;
}

/**
 * Form any rivalry this season's football has just earned. Called once at the
 * rollover, AFTER the season summary is pushed to the record book — this reads
 * that summary, so running it earlier would measure the previous season.
 *
 * Returns what formed, so the caller can put it in the inbox.
 */
export function formRivalries(state: GameState, cfg: TuningConfig): RivalryFormed[] {
  const seasons = state.recordBook?.seasons ?? [];
  if (!seasons.length) return [];

  const userTeamId = state.userTeamId;
  const userName = state.teams[userTeamId]?.name ?? "The club";
  const existing = rivalriesOf(state);
  const out: RivalryFormed[] = [];

  const add = (rivalId: string, cause: RivalryCause, detail: string) => {
    if (rivalId === userTeamId) return;
    if (existing.some((r) => r.rivalId === rivalId)) return;
    if (out.some((r) => r.rivalry.rivalId === rivalId)) return;
    // The cap counts ACTIVE rivalries, not the whole history: a dormant rivalry
    // from six seasons ago must not block a new one from forming.
    if (activeRivalries(state, cfg).length + out.length >= cfg.rivalryMaxActive) return;
    const rival = state.teams[rivalId];
    if (!rival) return;

    const rivalry: Rivalry = {
      rivalId,
      rivalName: rival.name,
      formedSeason: state.season,
      cause,
      story: storyFor(cause, rival.name, userName, cfg, detail),
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      // Treated as having met this season: the football that formed the rivalry
      // IS a meeting, so a rivalry can't be born already halfway to dormant.
      lastMetSeason: state.season,
    };
    out.push({
      rivalry,
      title: cause === "cupFinal" ? `A rivalry is born: ${rival.name}` : `Modern rivalry declared: ${rival.name}`,
    });
  };

  const latest = seasons[seasons.length - 1];

  // 1. The cup final — one match, decided on the spot.
  const finalOpponent = cupFinalOpponent(latest, userTeamId);
  if (finalOpponent) {
    const won = latest.cupWinner?.teamId === userTeamId;
    add(
      finalOpponent,
      "cupFinal",
      won ? "You won it." : "They won it."
    );
  }

  // 2. The title race — the same club in the top N alongside you, N seasons
  //    running. The window is the LAST `rivalryTitleRaceSeasons` summaries, and
  //    it must be complete: a save three seasons old with only two summaries
  //    hasn't yet had time to establish a pattern.
  const need = cfg.rivalryTitleRaceSeasons;
  if (seasons.length >= need) {
    const window = seasons.slice(-need);
    // The user has to have been up there every one of those seasons too — a
    // rivalry is mutual, and a club that finished 14th three times is not in
    // anybody's title race.
    const userAlwaysTop = window.every((s) => {
      const pos = userFinishIn(s);
      return pos >= 1 && pos <= cfg.rivalryTitleRaceTop;
    });
    const perSeason = window.map((s) => topFinishersAround(s, userTeamId, cfg.rivalryTitleRaceTop));
    // ...and it has to be the SAME race. Three top-three finishes spread across a
    // promotion are three finishes in two different divisions: a club you shared
    // a second-tier podium with two summers ago is not your rival in the league
    // you play now, and declaring it one would mean a promotion handed out
    // rivalries as a side effect. Requiring one division is also what makes the
    // resulting fixture real — a rivalry whose derby cannot be scheduled pays
    // nothing and reads as a bug.
    const oneDivision =
      perSeason.every((p) => p !== null) &&
      new Set(perSeason.map((p) => p!.leagueId)).size === 1;
    if (userAlwaysTop && oneDivision) {
      const lists = perSeason.map((p) => p!.teamIds);
      const persistent = lists[0].filter((id) => lists.every((list) => list.includes(id)));
      for (const rivalId of persistent) {
        add(
          rivalId,
          "titleRace",
          `${cfg.rivalryTitleRaceSeasons} seasons, ${cfg.rivalryTitleRaceSeasons} shared podiums.`
        );
      }
    }
  }

  if (out.length) {
    state.rivalries = [...existing, ...out.map((r) => r.rivalry)];
  }
  return out;
}

// ── Keeping the record ────────────────────────────────────────────────────

/**
 * Record a completed derby on the rivalry's own ledger.
 *
 * Called from `applyMatchResult` for the user's fixtures. The tally is kept
 * here rather than counted off fixtures on demand because the fixtures of a
 * season five years ago no longer exist — `pruneRetired` and the season
 * rollover clear them — and a rivalry's head-to-head record is exactly the kind
 * of thing that has to survive that.
 *
 * `lastMetSeason` is stamped here too, which is what keeps a live rivalry out of
 * dormancy: playing each other is the thing that keeps it alive.
 */
export function recordRivalryMeeting(
  state: GameState,
  opponentId: string,
  own: number,
  opp: number
) {
  const r = rivalriesOf(state).find((x) => x.rivalId === opponentId);
  if (!r) return;
  r.played += 1;
  if (own > opp) r.won += 1;
  else if (own === opp) r.drawn += 1;
  else r.lost += 1;
  r.lastMetSeason = state.season;
}

// ── The one-off sponsorships ──────────────────────────────────────────────

/** The minor slots a rivalry one-off can be offered in. Read off the same slot
 * table the ordinary market uses, so a new minor slot is automatically eligible
 * and nothing here names a slot. */
function rivalryOfferSlots(cfg: TuningConfig): SponsorOffer["slot"][] {
  const all: SponsorOffer["slot"][] = [
    "sleeve", "shorts", "trainingKit", "boot", "regional", "beverage", "automotive",
  ];
  return all.filter((s) => !cfg.sponsorMajorSlots.includes(s));
}

/**
 * The `tier` label a derby one-off carries, and the marker `refreshSponsorOffers`
 * tests to see whether this week's derby suitors are already on the table.
 *
 * Exported rather than written as a literal in both files: it is a contract
 * between the two, and the ordinary tiers (`TIER_NAMES` in sponsors.ts) are
 * "Regional"/"National"/"Global", so this must never collide with one. A string
 * duplicated across a module boundary is how it eventually would.
 */
export const RIVALRY_OFFER_TIER = "Derby";

const RIVALRY_BRANDS = [
  "Derby Day Media", "Matchday Local", "Kickoff Energy", "Terrace & Co",
  "Rival Sports Net", "Fixture Films", "Cross-City Motors", "Ninety Minutes",
];

/**
 * Table the one-off sponsorships a derby week attracts.
 *
 * Deliberately an OFFER, not a payment. The brief calls for "exclusive,
 * high-paying, one-off minor sponsorships for that week", and making them
 * offers keeps the decision in the manager's hands: a one-season deal at a
 * premium may still not be worth burning a slot that an ordinary multi-season
 * partner wants. Free money would need no thought.
 *
 * Priced as a multiple of the club's ordinary minor rate rather than a flat sum,
 * so a derby is worth proportionally the same to a fourth-tier club and a giant
 * — the same reasoning `marketabilityOfferAnnual` applies to majors.
 *
 * Seeded off the fixture, so the same derby always attracts the same suitors and
 * a reload cannot re-roll them.
 */
export function tableRivalryOffers(
  state: GameState,
  fixture: Fixture,
  baseWeekly: number,
  cfg: TuningConfig
): SponsorOffer[] {
  const team = state.teams[state.userTeamId];
  team.sponsorOffers ??= [];
  team.sponsors ??= [];

  const rng = mulberry32(deriveSeed(state.seed, `rivalry:${fixture.id}`));
  const slots = rivalryOfferSlots(cfg);
  const out: SponsorOffer[] = [];

  for (let i = 0; i < cfg.rivalryOfferCount; i++) {
    // Only slots with genuine room: an offer for a slot the club has already
    // sold is one the user can't act on, which is noise rather than an event.
    const open = slots.filter(
      (slot) =>
        !team.sponsorOffers!.some((o) => o.slot === slot) &&
        !out.some((o) => o.slot === slot) &&
        (team.sponsors!.filter((d) => d.slot === slot).length <
          (cfg.sponsorSlotCapacity?.[slot] ?? 1))
    );
    if (!open.length) break;
    const slot = pick(rng, open);
    out.push({
      id: uid("spo"),
      slot,
      kind: "minor",
      brand: pick(rng, RIVALRY_BRANDS),
      weeklyAmount: Math.round((baseWeekly * cfg.rivalryOfferAmountMult) / 1000) * 1000,
      upfront: 0,
      seasons: 1,
      tier: RIVALRY_OFFER_TIER,
      day: state.currentDay,
      // Expires with the fixture: this is that week's money. A derby offer that
      // outlived the derby would just be an ordinary minor with a better rate.
      expiresDay: fixture.day,
    });
  }
  return out;
}

/**
 * The user's next fixture against a current rival within the offer lead time, if
 * there is one — what `refreshSponsorOffers` checks each day to decide whether
 * the derby suitors should be at the table yet.
 */
export function upcomingRivalryFixture(
  state: GameState,
  cfg: TuningConfig
): Fixture | undefined {
  return state.fixtures
    .filter(
      (f) =>
        !f.played &&
        f.day > state.currentDay &&
        f.day - state.currentDay <= cfg.rivalryOfferLeadDays &&
        isRivalryFixture(state, f, cfg)
    )
    .sort((a, b) => a.day - b.day)[0];
}

/** A short "W-D-L" record line for the UI. */
export function rivalryRecordLine(r: Rivalry): string {
  return r.played === 0
    ? "No meetings yet"
    : `${r.played} played · ${r.won}W ${r.drawn}D ${r.lost}L`;
}

/** Every club the user's club currently counts as a rival, as Team objects.
 * For the UI — resolved here so a screen never has to walk the id list. */
export function rivalTeams(state: GameState, cfg: TuningConfig): Team[] {
  return activeRivalries(state, cfg)
    .map((r) => state.teams[r.rivalId])
    .filter((t): t is Team => !!t);
}

// ── Squad familiarity (v2.1) ───────────────────────────────────────────────
//
// What a side EARNS by playing together in one system, as against what it looks
// up in a table.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Three lookup channels decided how much a player's identity was worth:
// `synergyMult` (±20%), `instructionMult` (±6%) and `roleBriefMult` (±8%).
// Compounded that is roughly a ±30% band on effective rating, and every point of
// it is READ OFF A TABLE — the manager consults `CLASS_STYLE_ROW`, fields the
// class it rewards, and the answer is fixed forever. That makes the game have a
// recipe: there is a correct way to build a side, it can be derived once, and
// nothing a manager does over ten seasons changes it.
//
// The v2.1 answer is to move part of that band from LOOKUP to EARNED. The three
// channels are softened (see the measured note beside `synergyCap` in
// `config/tuning.ts`) and this module is the counterpart, paying a side for
// continuity: the longer a squad plays one system, and the longer a player
// occupies one role in it, the better he executes it. A settled XI outperforms a
// bought one, a manager who churns his tactic every season never banks anything,
// and — crucially — there is no table to consult, because the multiplier is a
// function of what this save's own history did.
//
// ── What this does NOT do, and it matters ──────────────────────────────────
//
// It is not a one-for-one replacement for the channels it softens, and the
// measurement says so plainly. Familiarity only separates clubs that DIFFER in
// how settled they are; across a division where every club keeps its system it
// contributes nearly nothing, because everyone sits near the centre. That is why
// the lookup channels could only be cut 20% rather than halved — below that,
// `verify:standings` fails on the champion no longer being a top-4 squad and
// `verify:reputation` fails on a deliberately stacked squad sliding to 18th, and
// zeroing this module reproduces those failures byte-identically.
//
// So the honest claim is narrower than "identity is now earned": a manager who
// REBUILDS, or who rips up his system, now pays for it, and one who builds
// patiently is rewarded. A steady world is barely touched.
//
// Archetypes are not thereby made useless. They still decide who SCORES and who
// ASSISTS, the goal flavour, pace reliance and how selection ranks a squad
// (`scorerWeight`/`assistWeight` in `config/archetype.ts`, read by the engine's
// chance and finish passes). What they stop doing is dominating the rating
// arithmetic, which is what made them a recipe rather than a characterisation.
//
// ── Two tracks, because they answer different questions ────────────────────
//
//   tactic  — has this CLUB played this system enough to execute it?
//   player  — has this PLAYER occupied this role in it long enough?
//
// Both are needed. Tactic alone lets a £90M signing slot into a familiar system
// at full strength on debut, which loses the "players who play together" half.
// Player alone means a manager can rip up his system every summer at no cost as
// long as the same eleven are on the pitch.
//
// ── Where it lands ─────────────────────────────────────────────────────────
//
// On the same quantity the other three land on and nowhere else: multiplied into
// `effectiveRating`, and folded into `tacticalFitMult` so SELECTION asks what the
// match answers (the v1.90 rule). It is NOT a new engine channel — see the v1.78
// note in CLAUDE.md; adding a second place for identity to reach the simulation
// is the mistake this codebase has already made once.
//
// ── It is CENTRED, not a bonus ─────────────────────────────────────────────
//
// The obvious version — familiarity 0 is ×1.0 and it climbs from there — is a
// world-wide rating rise, since every club drifts upward over time and the mean
// never comes back. That needs re-calibration and, worse, means the multiplier
// eventually says nothing because everybody has it.
//
// So `FAMILIARITY_CENTER` is the break-even point: a side at the centre reads
// exactly 1, a settled one is rewarded and an unsettled one pays. The world's
// mean sits near the centre by construction, which is what lets this be a real
// swing without moving `calibrate`. A club that has just rebuilt is genuinely
// worse for a while, and that is the feature.

import type { ClubFamiliarity, Tactic, Team } from "./types";

export type { ClubFamiliarity };

/**
 * How far full familiarity moves a player's rating, either way.
 *
 * ±10% at the extremes, which makes it the largest single identity term in the
 * game — deliberately, since the point of the rework is that what you build over
 * seasons should outweigh what you read off a table.
 *
 * But note what that does and does not buy (see the header): the swing is only
 * ever realised by a club that is unusually settled or unusually disrupted. A
 * side sitting at the centre reads exactly 1, so this does not lift the world's
 * mean and `calibrate` is unmoved by it.
 *
 * Lives here rather than in `config/tuning.ts` for the same reason
 * `ROLE_BRIEF_SWING` does: it is the definition of this feature, not a balance
 * dial shared by anything else.
 */
export const FAMILIARITY_SWING = 0.1;

/** The break-even point. At exactly this, the multiplier is 1. */
export const FAMILIARITY_CENTER = 0.5;

/**
 * Where a player starts in a slot he has never occupied at this club.
 *
 * Deliberately not 0. Zero says a professional footballer dropped into a system
 * is at his worst possible level, which overstates it — he is a good player who
 * does not yet know the patterns, not a liability. Below the centre, so a
 * newcomer IS a downgrade on an equally-rated incumbent, which is the whole
 * point; recoverable inside a season of selection.
 */
export const NEWCOMER_FAMILIARITY = 0.25;

/** How the two tracks combine. The team's grasp of the system is the larger
 * share: a system nobody understands can't be rescued by one veteran who does. */
const TACTIC_WEIGHT = 0.6;
const PLAYER_WEIGHT = 0.4;

/**
 * How far above his OWN familiarity a well-drilled side can lift a player.
 *
 * The cap that stops a settled system carrying a stranger — see
 * `combinedFamiliarity`. 0.2 puts a debutant at a fully settled club at
 * 0.25 + 0.2 = 0.45, just below the centre, which is the reading the feature
 * promises: a downgrade on the incumbent, not a disaster.
 */
const PLAYER_CEILING_HEADROOM = 0.2;

/** Matches to go from nothing to fully settled. ~38 is a season, so a squad that
 * keeps one system reaches the top of the scale inside two — long enough to be
 * an investment, short enough that a manager sees it pay inside a save. */
const TACTIC_MATCHES_TO_FULL = 60;
const PLAYER_MATCHES_TO_FULL = 45;

/**
 * What a change of system costs the team track.
 *
 * Deliberately proportional to how far the new tactic is from the old rather
 * than a reset. Changing the press dial is not the same act as tearing up the
 * formation, and a system that resets on any edit would punish the manager for
 * using the controls the game gives him — which would teach him not to touch
 * them, the opposite of what the Tactic Creator is for.
 */
const COST_FORMATION = 0.55;
const COST_STYLE = 0.25;
const COST_MENTALITY = 0.1;
/** Each of the five advanced dials, which are the cheapest thing to change. */
const COST_DIAL = 0.04;

/**
 * The parts of a tactic the squad has to LEARN, most expensive first.
 *
 * Only these move familiarity. Anything else on a `Tactic` — the role brief in
 * particular — is a description of who should stand where, not a different thing
 * for the side to rehearse, and charging for it would make opening the Creator
 * cost rating.
 */
const TACTIC_PARTS: { prefix: string; cost: number; read: (t: Tactic) => string }[] = [
  { prefix: "f", cost: COST_FORMATION, read: (t) => t.formationId },
  { prefix: "s", cost: COST_STYLE, read: (t) => t.style },
  { prefix: "m", cost: COST_MENTALITY, read: (t) => t.mentality },
  { prefix: "t", cost: COST_DIAL, read: (t) => t.tempo ?? "-" },
  { prefix: "w", cost: COST_DIAL, read: (t) => t.width ?? "-" },
  { prefix: "p", cost: COST_DIAL, read: (t) => t.press ?? "-" },
  { prefix: "l", cost: COST_DIAL, read: (t) => t.line ?? "-" },
  { prefix: "o", cost: COST_DIAL, read: (t) => t.focus ?? "-" },
];

/** The per-part costs in signature order, derived from the one table above so
 * the cost of a change and the fingerprint that detects it can never disagree
 * about which field position N is. */
const COST_ORDER: number[] = TACTIC_PARTS.map((p) => p.cost);

/** A stable fingerprint of everything the squad rehearses. */
export function tacticSignature(t: Tactic): string {
  return TACTIC_PARTS.map((p) => `${p.prefix}:${p.read(t)}`).join("|");
}

/**
 * How much of the team track survives moving from one tactic to another.
 *
 * 1 when nothing rehearsable changed; lower the more of the system was torn up.
 * Never below zero, and never a full reset even for a total rewrite — a squad
 * that has played together for five years does not become strangers because the
 * manager changed shape.
 */
export function retentionBetween(from: Tactic | undefined, to: Tactic): number {
  if (!from) return 1;
  return signatureRetention(tacticSignature(from), tacticSignature(to));
}

/**
 * The same question asked of two fingerprints rather than two tactics.
 *
 * This is what a club whose tactic changed outside `applyTacticChange` is
 * charged with — the stored signature IS the record of what was last rehearsed,
 * so the previous `Tactic` object never has to be kept. One cost table serves
 * both routes, which is what stops them drifting apart.
 */
export function signatureRetention(fromSig: string, toSig: string): number {
  if (fromSig === toSig) return 1;
  const a = fromSig.split("|");
  const b = toSig.split("|");
  // A signature written by a different version of `TACTIC_PARTS` can't be
  // compared part-by-part; treat it as fully unfamiliar rather than guessing.
  if (a.length !== b.length) return 0;
  const costs = COST_ORDER;
  let cost = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) cost += costs[i] ?? COST_DIAL;
  return Math.max(0, 1 - cost);
}

// The read side takes a `ClubFamiliarity` rather than a `Team`, because the
// match engine holds no `GameState` and no `Team` — it is handed the record on
// its `SideInput`, the same way `coachMult` reaches it. `*Of` wrappers taking a
// Team exist for the callers that do have one.

/** The team track, or the centre when the club has no record yet. */
export function tacticFamiliarity(f: ClubFamiliarity | undefined): number {
  return f ? f.tactic : FAMILIARITY_CENTER;
}

/**
 * How settled one player is in one slot.
 *
 * Three distinct states, and conflating any two of them breaks something:
 *
 *   no record for the player   → the CENTRE. He has simply never been tracked —
 *                                a pre-v2.1 save, or a squad that predates the
 *                                club's first match. Reads as ordinary.
 *   a record, but not this slot → `NEWCOMER_FAMILIARITY`. He is known to this
 *                                system and has not played HERE, which is a real
 *                                statement (a striker asked to play left back).
 *   a value                    → itself.
 *
 * The middle case is why `markNewcomer` writes an empty object rather than
 * deleting: absent means "untracked", present-but-empty means "tracked, and he
 * knows nothing yet". A signing must land in the second.
 */
export function playerFamiliarity(
  f: ClubFamiliarity | undefined,
  playerId: string,
  slotId: string
): number {
  const forPlayer = f?.player?.[playerId];
  if (!forPlayer) return FAMILIARITY_CENTER;
  const v = forPlayer[slotId];
  return v === undefined ? NEWCOMER_FAMILIARITY : v;
}

/**
 * The combined 0..1 figure for one player in one slot — what the multiplier is
 * computed from, and what the Tactics screen prints.
 */
export function combinedFamiliarity(
  f: ClubFamiliarity | undefined,
  playerId: string,
  slotId: string
): number {
  const team = tacticFamiliarity(f);
  const player = playerFamiliarity(f, playerId, slotId);
  const blended = team * TACTIC_WEIGHT + player * PLAYER_WEIGHT;
  // A settled SYSTEM cannot make a stranger familiar with it (v2.1).
  //
  // A plain weighted mean lets the team track carry a newcomer: measured by
  // `verify:familiarity`, a brand-new signing at a fully settled club came out
  // at ×1.04 — BETTER than average — because 60% of his score was his club's
  // grasp of a system he had never played in. That inverts the feature's central
  // claim, which is that a big signing is worth less on debut than the settled
  // incumbent he replaces.
  //
  // So the player's own track is also a CEILING: however well-drilled the side,
  // a player is capped a little above what he personally knows. It binds only
  // when he is well below his club — a settled regular is nowhere near it, so
  // this changes nothing for the ordinary case it is not aimed at.
  return Math.min(blended, player + PLAYER_CEILING_HEADROOM);
}

/**
 * The rating multiplier a player earns for how settled he is.
 *
 * Centred on `FAMILIARITY_CENTER`, so an average side reads exactly 1 and the
 * world's mean does not drift. Returns exactly 1 for a club with no record,
 * which is what keeps every pre-v2.1 save computing what it always did — and
 * what lets this sit in the engine's hot path.
 */
export function familiarityMult(
  f: ClubFamiliarity | undefined,
  playerId: string,
  slotId: string | undefined
): number {
  if (!f) return 1;
  const combined = slotId
    ? combinedFamiliarity(f, playerId, slotId)
    : // No slot in hand (a substitute, the bench ranking): the team track alone
      // is the honest answer — it is the part that does not depend on where he
      // is standing.
      tacticFamiliarity(f);
  return 1 + (combined - FAMILIARITY_CENTER) * 2 * FAMILIARITY_SWING;
}

// ── Accrual ────────────────────────────────────────────────────────────────

/**
 * Bank one match for a club: the squad knows its system a little better, and the
 * eleven who played know their roles a little better.
 *
 * Called from `applyMatchResult` — the single chokepoint every played match goes
 * through — so no match can be played without being learned from.
 *
 * `lineup` is the XI as the engine actually fielded it. A player's track is
 * keyed on the SLOT he filled, not his position: two centre backs occupy
 * different slots and a midfielder covering at right back is learning the right
 * back's job, which is the same reading `roleBriefMult` takes.
 */
export function bankMatchFamiliarity(
  team: Team,
  tactic: Tactic,
  lineup: { slotId: string; playerId: string }[]
) {
  const sig = tacticSignature(tactic);
  let f = team.familiarity;
  if (!f) {
    // First match on a v2.1 save: start the club at the centre rather than at
    // zero, or every club in the world would be penalised for the upgrade.
    f = team.familiarity = { tactic: FAMILIARITY_CENTER, player: {}, signature: sig };
  }

  // A club whose tactic changed without going through `applyTacticChange` (an AI
  // club's seasonal review, a loaded preset) is charged here instead, so no route
  // can dodge the cost. The signature is the record of what was last rehearsed;
  // with the previous tactic no longer in hand, the full change cost applies.
  if (f.signature && f.signature !== sig) {
    f.tactic = Math.max(0, f.tactic * signatureRetention(f.signature, sig));
  }
  f.signature = sig;

  f.tactic = Math.min(1, f.tactic + 1 / TACTIC_MATCHES_TO_FULL);

  const players = (f.player ??= {});
  for (const { slotId, playerId } of lineup) {
    const known = players[playerId];
    // First appearance ever: he starts at the CENTRE (an existing squad member
    // the club simply had not tracked). First appearance in this SLOT for a
    // player already tracked: `NEWCOMER_FAMILIARITY`, the same reading
    // `playerFamiliarity` takes — the two must agree or a player's rating would
    // jump the moment he was banked rather than merely read.
    const forPlayer = (players[playerId] ??= {});
    const cur = forPlayer[slotId] ?? (known ? NEWCOMER_FAMILIARITY : FAMILIARITY_CENTER);
    forPlayer[slotId] = Math.min(1, cur + 1 / PLAYER_MATCHES_TO_FULL);
  }
}

/**
 * Charge a club for changing its system.
 *
 * Separate from `bankMatchFamiliarity` because the cost has to be taken WHEN THE
 * CHANGE IS MADE, not at the next kick-off: charging it at kick-off means the
 * change is free until the club next plays, and a manager could rotate systems
 * between fixtures at no cost.
 */
export function applyTacticChange(team: Team, from: Tactic | undefined, to: Tactic) {
  const f = team.familiarity;
  if (!f) return; // nothing banked yet — nothing to lose
  const sig = tacticSignature(to);
  if (f.signature === sig) return;
  const retention = retentionBetween(from, to);
  // The team track is what a system change costs. Player-slot familiarity is
  // deliberately UNTOUCHED by a dial change: a right back is still a right back
  // when the press changes. A formation change is handled by `pruneFamiliarity`,
  // which drops slots the new shape does not have.
  f.tactic = Math.max(0, f.tactic * retention);
  f.signature = sig;
}

/**
 * Drop familiarity for slots a formation no longer has, and for players who have
 * left. Same forgiving discipline `pruneBrief` applies to a stale slot id — a
 * record that can never be seen or cleared is a leak, and over a long save the
 * player map would otherwise grow without bound as squads turn over.
 */
export function pruneFamiliarity(team: Team, validSlotIds: Set<string>) {
  const f = team.familiarity;
  if (!f?.player) return;
  const squad = new Set(team.playerIds);
  for (const playerId of Object.keys(f.player)) {
    if (!squad.has(playerId)) {
      delete f.player[playerId];
      continue;
    }
    const slots = f.player[playerId];
    for (const slotId of Object.keys(slots)) {
      if (!validSlotIds.has(slotId)) delete slots[slotId];
    }
    if (Object.keys(slots).length === 0) delete f.player[playerId];
  }
}

/**
 * A player arriving at a club knows nothing of its system yet.
 *
 * Called on transfer. He starts at zero rather than at the centre, which is what
 * makes a big signing worth less on debut than in his second season — the "the
 * more players play with each other, the better they get" half of the design.
 * Nothing travels with him: familiarity is a relationship with a squad, not a
 * property of a footballer.
 */
export function resetPlayerFamiliarity(team: Team | undefined, playerId: string) {
  const f = team?.familiarity;
  if (!f?.player) return;
  delete f.player[playerId];
}

/**
 * Mark an ARRIVING player as knowing nothing of his new club's system.
 *
 * Distinct from `resetPlayerFamiliarity`, and the distinction is load-bearing:
 * an ABSENT record reads as the centre (that is what keeps a pre-v2.1 save
 * inert), so simply having no entry would make a brand-new signing exactly as
 * settled as a ten-year servant. A newcomer needs an explicit zero.
 *
 * `NEWCOMER` rather than 0 for every slot, because slots he has not played are
 * unknown rather than badly known — the zero is written on first selection by
 * `bankMatchFamiliarity`, which reads this as the starting point.
 */
export function markNewcomer(team: Team | undefined, playerId: string) {
  const f = team?.familiarity;
  if (!f) return; // club has banked nothing yet — nobody is settled, including him
  (f.player ??= {})[playerId] = {};
}

/** Reported for the Tactics screen: how settled the club is, as a percentage,
 * and how many matches until the team track is full. */
export function familiaritySummary(
  team: Team | undefined
): { pct: number; matchesToFull: number; settled: boolean } {
  const t = tacticFamiliarity(team?.familiarity);
  const remaining = Math.max(0, 1 - t);
  return {
    pct: Math.round(t * 100),
    matchesToFull: Math.ceil(remaining * TACTIC_MATCHES_TO_FULL),
    settled: t >= 0.95,
  };
}

// Save migrations. Each step upgrades a save one schema version. Kept tiny and
// pure so both the IndexedDB loader and the JSON importer share the same path.

import type { GameState } from "./types";
import { SCHEMA_VERSION } from "./types";
import { TUNING, type TuningConfig } from "./config/tuning";
import { generateScoutMarket } from "./scouts";
import { buildSeasonSchedule } from "./calendar";
import { initAcademyState } from "./academy";
import { ensureContracts, openContractResolution } from "./contracts";
import { migrateOldRegion } from "./config/scouting";
import { aiCommercialIncome, refreshSponsorOffers, seedAiSponsorBooks } from "./sponsors";
import { RETIRED_TRAIT_IDS, TRAIT_MAP } from "./config/traits";
import { overallFromAttrs } from "./config/positions";
import { getArchetype, DEFAULT_HEIGHT_CM } from "./config/archetypes";
import { assignAllKitNumbers } from "./kitnumbers";
import { trackBiggestWin } from "./recordbook";
import { ensureProgress, syncProgress, userPlayerAwardsIn } from "./achievements";
import { deriveSeed, hashString, mulberry32, pickWeighted, randNormal, uid } from "./rng";

/**
 * v1 → v2: the position enum split FB → LB/RB and W → LW/RW. Old players stored
 * a single-sided position with no left/right info, so we assign a side by a
 * stable hash of the player id (roughly half go left, half right) and grant the
 * opposite side as a secondary — full backs and wingers were always modeled as
 * able to cover both flanks. Any lineup slots keyed to the old positions are in
 * code (formations), not the save, so nothing else needs touching.
 */
function migrateV1toV2(state: GameState): void {
  const sideFor = (id: string): 0 | 1 => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 2) as 0 | 1;
  };
  for (const p of Object.values(state.players)) {
    const positions = p.positions as string[];
    p.positions = positions.map((pos) => {
      if (pos === "FB") return sideFor(p.id) === 0 ? "LB" : "RB";
      if (pos === "W") return sideFor(p.id) === 0 ? "LW" : "RW";
      return pos;
    }) as typeof p.positions;
    // ensure a cross-side secondary for the flank roles (they always could)
    const prim = p.positions[0];
    const cross =
      prim === "LB" ? "RB" : prim === "RB" ? "LB" : prim === "LW" ? "RW" : prim === "RW" ? "LW" : null;
    if (cross && !p.positions.includes(cross as typeof prim)) {
      p.positions = [p.positions[0], cross as typeof prim];
    }
  }
}

/**
 * v2 → v3: expanded tactics (tempo/width/press/line/focus), dynamic potential
 * dev logging, and training facilities. Every new field is optional with a
 * runtime default, so the only real work is backfilling each team's tactic with
 * the neutral instruction presets — that way the Tactics screen never reads an
 * `undefined` and the engine's counter/instruction maths always have a value.
 */
function migrateV2toV3(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    const t = team.tactic;
    t.tempo ??= "Standard";
    t.width ??= "Standard";
    t.press ??= "Medium";
    t.line ??= "Standard";
    t.focus ??= "Mixed";
    // training facilities start at base level; medical inherits nothing new
    team.trainingLevel ??= 0;
    team.medicalLevel ??= 0;
    team.academyLevel ??= 0;
  }
}

/**
 * v3 → v4: Youth Academy (§18). Old saves gain an empty academy roster per
 * team, the season's intake-day anchor, and a fresh academy state (pipeline
 * idle, U21 season built from the current world — its early rounds simply
 * never fire if the calendar is already past them). Existing young players
 * stay senior; the academy fills from the next intake day onward.
 */
function migrateV3toV4(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    team.academyPlayerIds ??= [];
  }
  state.schedule.intakeDay ??= buildSeasonSchedule(state.season).intakeDay;
  state.academy ??= initAcademyState(state, TUNING);
}

/**
 * v4 → v5: individual contracts (§10), a multi-scout department, more staff
 * slots, and the Scouting Network facility. Every club-attached player is given
 * a contract at their curve wage; the old single scout focus becomes the first
 * assignment in the new department; new staff slots simply start vacant (the
 * staff map is a partial record). The next staff-market refresh (season
 * rollover) surfaces candidates for the new roles.
 */
function migrateV4toV5(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    team.scoutNetworkLevel ??= 0;
  }
  const ac = state.academy;
  if (ac) {
    ac.assignments ??= [];
    // carry a v4 single scout focus into the new department as one assignment
    if (ac.assignments.length === 0 && ac.scoutFocus) {
      ac.assignments.push({
        id: uid("asg"),
        region: migrateOldRegion(ac.scoutFocus.region as unknown as string),
        positions: ac.scoutFocus.positions,
        nextReportDay: ac.nextReportDay ?? state.currentDay + 14,
      });
    }
    ac.scoutFocus = null;
    // reports gain optional region/assignmentId — nothing to backfill
  }
  // backfill contracts for everyone attached to a club (academy stays wage-free)
  ensureContracts(state, TUNING);
}

/**
 * v5 → v6: sponsors/investments, more revenue facilities, staff nationalities +
 * departments, EA-FC-style on-pitch assignments, and an expanded 16-trait pool
 * (existing trait ids are unchanged, so nothing to remap). Every new field is
 * optional with a runtime default, so the work is: give existing staff a
 * nationality (they render a flag now), open the new facility levels at 0, seed
 * empty assignment/sponsor containers, and drop in opening sponsor offers.
 */
function migrateV5toV6(state: GameState): void {
  const STAFF_NATS = ["ENG", "ESP", "ITA", "GER", "FRA", "NED", "POR", "BRA", "ARG", "SCO"];
  for (const team of Object.values(state.teams)) {
    team.mediaLevel ??= 0;
    team.hospitalityLevel ??= 0;
    team.retailLevel ??= 0;
    team.assignments ??= {};
    team.sponsors ??= [];
    team.sponsorOffers ??= [];
    // existing staff predate nationalities — assign a stable one per member id
    for (const member of Object.values(team.staff)) {
      if (member && !member.nationality) {
        let h = 0;
        for (let i = 0; i < member.id.length; i++) h = (h * 31 + member.id.charCodeAt(i)) >>> 0;
        member.nationality = STAFF_NATS[h % STAFF_NATS.length];
      }
    }
  }
  // staff-market candidates gain a nationality too (same stable hash)
  for (const c of state.staffMarket) {
    if (!c.nationality) {
      let h = 0;
      for (let i = 0; i < c.id.length; i++) h = (h * 31 + c.id.charCodeAt(i)) >>> 0;
      c.nationality = STAFF_NATS[h % STAFF_NATS.length];
    }
  }
  // seed opening sponsorship offers for the user's empty slots
  refreshSponsorOffers(state, TUNING);
}

/**
 * v6 → v7: the database architecture (per-country worlds), a curated trait pool
 * with position eligibility, and major/minor sponsorships. Old saves are all
 * England, so the playable country is "ENG" and its divisions are the classic
 * ["ENG1","ENG2"]. Retired traits are scrubbed from every player. Existing
 * sponsor deals/offers become weekly "minor" deals (they already paid weekly);
 * the offer slots are re-seeded so majors can appear next refresh.
 */
function migrateV6toV7(state: GameState): void {
  state.playableCountry ??= "ENG";
  state.divisionIds ??= ["ENG1", "ENG2"];

  // scrub trait ids that no longer exist in the v7 pool
  const dead = new Set(RETIRED_TRAIT_IDS);
  for (const p of Object.values(state.players)) {
    if (!p.traits?.length) continue;
    p.traits = p.traits.filter((t) => !dead.has(t) && TRAIT_MAP[t]);
  }

  // existing sponsor deals paid weekly → tag them "minor"; clear old offers and
  // re-seed so the new major/minor shapes appear.
  for (const team of Object.values(state.teams)) {
    for (const d of team.sponsors ?? []) {
      const deal = d as typeof d & { kind?: string; upfront?: number };
      deal.kind ??= "minor";
      deal.upfront ??= 0;
    }
    team.sponsorOffers = [];
  }
  refreshSponsorOffers(state, TUNING);
}

/**
 * v7 → v8: player development training plans (§5). The only new schema is an
 * optional `PlayerBio.trainingPlan` id; an absent plan resolves to "balanced"
 * at read time, so there is nothing to backfill — old players simply keep
 * developing on the neutral curve until the user assigns them a focus. Kept as
 * an explicit step so the version bump is recorded and the chain stays honest.
 */
function migrateV7toV8(state: GameState): void {
  void state; // no data changes — trainingPlan defaults at read time
}

/**
 * v8 → v9: the U21 matchday squad (explicit tagging) plus transfer-negotiation
 * state on offers. Both are optional with read-time defaults: an absent
 * `u21Squad` means "auto-select" (unchanged behaviour), and pending offers gain
 * no ceiling until first countered (it's computed lazily). Nothing to backfill.
 */
function migrateV8toV9(state: GameState): void {
  state.academy.u21Squad ??= [];
}

/**
 * v9 → v10: the attribute-driven model. Overall is now DERIVED from a player's
 * six attributes by their primary position (config/positions overallFromAttrs),
 * so the match engine, transfer value, and UI all read off the same source of
 * truth. Every existing player already stores attrs, so we simply recompute
 * overall from them — bringing legacy squads onto the new model in one pass.
 * Potential is clamped up so no ceiling ends below the recomputed overall.
 */
function migrateV9toV10(state: GameState): void {
  for (const p of Object.values(state.players)) {
    if (!p.attrs || !p.positions?.length) continue;
    p.overall = overallFromAttrs(p.attrs, p.positions[0]);
    if (typeof p.potential === "number") p.potential = Math.max(p.potential, p.overall);
  }
}

/** v10 → v11. Two additions, both backfilled rather than recomputed:
 *  - Fixtures gain an optional `detail` stat line. Matches already played in a
 *    v10 save have no stored stats and can't be re-derived without replaying
 *    them, so they stay absent; the Match History tab renders scorers only for
 *    those and fills in fully from the next match on.
 *  - Investments gain a hard deadline. A v10 offer carries `expiresDay`
 *    already, so the deadline model is satisfied; what's missing is the
 *    cooldown bookkeeping, which starts empty (a fresh offer may appear the
 *    next tick, which is the pre-existing behaviour).
 */
function migrateV10toV11(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    if (team.sponsorOffers) {
      for (const o of team.sponsorOffers) {
        // Guard against a v10 offer with no expiry (possible on very old chains).
        if (typeof o.expiresDay !== "number") o.expiresDay = state.currentDay + 12;
      }
    }
    team.sponsorCooldowns ??= {};
  }
}

/** v11 → v12. Two widenings, both backward-compatible in place:
 *  - `divisionIds` becomes an ordered ladder (`string[]`) instead of a fixed
 *    `[top, second]` pair. A v11 save's pair is already a valid 2-entry ladder;
 *    the only fix-up needed is the single-division case, which stored the top
 *    id twice ([top, top]) — de-duplicated here so the new pro/rel loop doesn't
 *    try to shuffle a division against itself. Existing saves keep exactly the
 *    tiers they were created with; depth is a new-game choice, so nothing is
 *    generated retroactively into a running world.
 *  - Scout assignments gain a `reportsFiled` counter and reports a `batch`
 *    stamp. Both are display-only groupings, so old reports simply start at
 *    batch 1 and the counter picks up from the reports currently on the board.
 */
function migrateV11toV12(state: GameState): void {
  const ids = Array.isArray(state.divisionIds) ? state.divisionIds : [];
  const ladder = Array.from(new Set(ids.filter((id) => typeof id === "string" && id)));
  state.divisionIds = ladder.length ? ladder : ids.slice(0, 1);

  const ac = state.academy;
  if (!ac) return;
  for (const a of ac.assignments ?? []) {
    if (typeof a.reportsFiled !== "number") {
      // Seed the counter past whatever this scout already has on the board, so a
      // new batch doesn't reuse an existing batch number.
      a.reportsFiled = (ac.reports ?? []).filter((r) => r.assignmentId === a.id).length || 0;
    }
  }
  for (const r of ac.reports ?? []) {
    if (typeof r.batch !== "number") r.batch = 1;
  }
}

/**
 * v12 → v13: AI clubs gain a market `stance` (§10 transfer-AI design session).
 * Stance is derived from live world state, so there is nothing to reconstruct
 * from an old save — clearing the fields lets the next window opening evaluate
 * every club fresh, and `stanceOf()` derives one on demand before then.
 */
function migrateV12toV13(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    delete team.stance;
    delete team.stanceSeason;
  }
}

/**
 * v13 → v14: the scouting department (§18). The single `scout` staff slot
 * becomes a roster of scouts carrying two independent 1–5★ ratings, and the
 * senior squad cap is lifted for the user.
 *
 * An appointed scout is carried over as the department's first employee. Their
 * old single rating can't be split into two informed numbers, so it seeds both
 * — the manager keeps exactly the scout they hired, just described in the new
 * terms. Existing assignments are bound to that scout (only one could be
 * meaningfully staffed before), and the rest are dropped rather than silently
 * re-pointed at someone who never scouted them.
 */
function migrateV13toV14(state: GameState, cfg: TuningConfig): void {
  const team = state.teams[state.userTeamId];
  if (!team) return;
  team.scouts ??= [];

  const legacy = team.staff.scout;
  if (legacy && team.scouts.length === 0) {
    team.scouts.push({
      id: legacy.id,
      name: legacy.name,
      nationality: legacy.nationality,
      experience: legacy.stars,
      judgement: legacy.stars,
      wage: legacy.wage,
    });
  }
  // The slot itself no longer exists — clear it so it can't be read back.
  team.staff.scout = undefined;
  state.staffMarket = (state.staffMarket ?? []).filter((c) => c.slot !== "scout");

  const first = team.scouts[0];
  const ac = state.academy;
  if (ac) {
    ac.assignments = (ac.assignments ?? []).filter((a, i) => {
      if (!first) return false; // no scout survived → no live briefs
      if (a.scoutId) return true;
      if (i === 0) {
        a.scoutId = first.id;
        return true;
      }
      return false; // nobody on the books to have filed it
    });
    ac.loanList ??= [];
  }

  state.scoutMarket ??= generateScoutMarket(state.seed ^ 0x5c007, cfg);
}

/**
 * v14 → v15: player height, shirt numbers, and the specialist training
 * facilities.
 *
 * Height and kit number are both new required-in-practice display fields, so
 * they're backfilled for the whole world rather than defaulted at read time:
 *  - Height is rolled deterministically per player from their archetype's band
 *    (seeded by player id, so a save always migrates to the same heights).
 *  - Shirt numbers are assigned squad by squad, keepers and best players first,
 *    exactly as a fresh world is numbered.
 * The new facility levels are optional and start at 0 — a migrated club has
 * simply never built them.
 */
function migrateV14toV15(state: GameState): void {
  for (const p of Object.values(state.players)) {
    if (typeof p.heightCm !== "number") {
      const [mean, sd] = getArchetype(p.archetypeId).heightCm ?? DEFAULT_HEIGHT_CM;
      // Deterministic per player: same save → same heights on every migration.
      const rng = mulberry32(hashString(`height:${p.id}`));
      p.heightCm = Math.round(Math.max(160, Math.min(210, mean + randNormal(rng) * sd)));
    }
  }
  // Number every roster in the world; existing numbers (none, at v14) are kept.
  assignAllKitNumbers(state);

  for (const team of Object.values(state.teams)) {
    team.gkCentreLevel ??= 0;
    team.defenceCentreLevel ??= 0;
    team.midfieldCentreLevel ??= 0;
    team.attackCentreLevel ??= 0;
    team.sportsScienceLevel ??= 0;
    team.techCentreLevel ??= 0;
    team.finishingCentreLevel ??= 0;
    team.youthDevCentreLevel ??= 0;
  }
}

/** Upgrade a save in place to the current schema. Returns the same object. */
export function migrateSave(state: GameState): GameState {
  if (state.schemaVersion < 2) {
    migrateV1toV2(state);
    state.schemaVersion = 2;
  }
  if (state.schemaVersion < 3) {
    migrateV2toV3(state);
    state.schemaVersion = 3;
  }
  if (state.schemaVersion < 4) {
    migrateV3toV4(state);
    state.schemaVersion = 4;
  }
  if (state.schemaVersion < 5) {
    migrateV4toV5(state);
    state.schemaVersion = 5;
  }
  if (state.schemaVersion < 6) {
    migrateV5toV6(state);
    state.schemaVersion = 6;
  }
  if (state.schemaVersion < 7) {
    migrateV6toV7(state);
    state.schemaVersion = 7;
  }
  if (state.schemaVersion < 8) {
    migrateV7toV8(state);
    state.schemaVersion = 8;
  }
  if (state.schemaVersion < 9) {
    migrateV8toV9(state);
    state.schemaVersion = 9;
  }
  if (state.schemaVersion < 10) {
    migrateV9toV10(state);
    state.schemaVersion = 10;
  }
  if (state.schemaVersion < 11) {
    migrateV10toV11(state);
    state.schemaVersion = 11;
  }
  if (state.schemaVersion < 12) {
    migrateV11toV12(state);
    state.schemaVersion = 12;
  }
  if (state.schemaVersion < 13) {
    migrateV12toV13(state);
    state.schemaVersion = 13;
  }
  if (state.schemaVersion < 14) {
    migrateV13toV14(state, TUNING);
    state.schemaVersion = 14;
  }
  if (state.schemaVersion < 15) {
    migrateV14toV15(state);
    state.schemaVersion = 15;
  }
  if (state.schemaVersion < 16) {
    migrateV15toV16(state);
    state.schemaVersion = 16;
  }
  if (state.schemaVersion < 17) {
    migrateV16toV17(state);
    state.schemaVersion = 17;
  }
  if (state.schemaVersion < 18) {
    migrateV17toV18(state, TUNING);
    state.schemaVersion = 18;
  }
  if (state.schemaVersion < 19) {
    migrateV18toV19(state, TUNING);
    state.schemaVersion = 19;
  }
  if (state.schemaVersion < 20) {
    migrateV19toV20(state);
    state.schemaVersion = 20;
  }
  if (state.schemaVersion < 21) {
    migrateV20toV21(state);
    state.schemaVersion = 21;
  }
  if (state.schemaVersion < 22) {
    migrateV21toV22(state);
    state.schemaVersion = 22;
  }
  if (state.schemaVersion < 23) {
    migrateV22toV23(state);
    state.schemaVersion = 23;
  }
  if (state.schemaVersion < 24) {
    migrateV23toV24(state);
    state.schemaVersion = 24;
  }
  if (state.schemaVersion < 25) {
    migrateV24toV25(state);
    state.schemaVersion = 25;
  }
  if (state.schemaVersion < 26) {
    migrateV25toV26(state);
    state.schemaVersion = 26;
  }
  if (state.schemaVersion < 27) {
    migrateV26toV27(state);
    state.schemaVersion = 27;
  }
  if (state.schemaVersion < 28) {
    migrateV27toV28(state);
    state.schemaVersion = 28;
  }
  if (state.schemaVersion < 29) {
    migrateV28toV29(state);
    state.schemaVersion = 29;
  }
  if (state.schemaVersion < 30) {
    migrateV29toV30(state);
    state.schemaVersion = 30;
  }
  // future migrations chain here
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

/**
 * v15 → v16: the Biggest Win record is the USER CLUB's record, not the
 * division's. v15 and earlier recorded any lopsided scoreline in a playable
 * competition, so most saves carry a result between two AI sides. We discard
 * the stored record and rebuild it from this season's played fixtures — the
 * only match history still holding scorelines — so a genuine user win survives
 * the fix. Earlier seasons can't be recovered (match detail compresses into
 * season summaries at rollover), so the record legitimately restarts from the
 * current season for long-running saves.
 */
function migrateV15toV16(state: GameState): void {
  state.recordBook.biggestWin = null;
  for (const f of state.fixtures) {
    if (!f.played || typeof f.homeGoals !== "number" || typeof f.awayGoals !== "number") continue;
    trackBiggestWin(state, f, f.homeGoals, f.awayGoals);
  }
}

/**
 * v16 → v17: the Diamond prospect tier, per-country division depth, and the
 * re-shaped youth growth curve.
 *
 * Nothing stored needs rewriting. Diamond only ever appears on prospects rolled
 * from v17 onward, so existing reports keep their tier; the growth curve is
 * computed fresh from tuning at every rollover, so old players simply develop on
 * the corrected curve from the next summer. Per-country depth is backfilled from
 * the save's existing single-country ladder in `divisionDepths` so promotion and
 * relegation keep running exactly as before.
 */
function migrateV16toV17(state: GameState): void {
  // The v12–v16 ladder was one country deep; record it per-country so the new
  // multi-country structure reads the same world back.
  state.divisionDepths ??= { [state.playableCountry]: state.divisionIds.length };

  // Scout targets moved from full country names ("England") to the nationality
  // codes the SCOUT_WORLD tree keys on ("ENG"). Remap live assignments, stored
  // reports and the legacy single-scout focus so saved briefs keep pointing at
  // the country they were aimed at.
  for (const a of state.academy?.assignments ?? []) {
    a.region = migrateOldRegion(a.region);
  }
  for (const r of state.academy?.reports ?? []) {
    if (r.region) r.region = migrateOldRegion(r.region);
  }
  const focus = state.academy?.scoutFocus;
  if (focus) focus.region = migrateOldRegion(focus.region);
}

/**
 * v17 → v18: two U21 competitions a season with registration windows, rival U21
 * prospect rosters, and the floor-based potential star scale.
 *
 * The in-flight competition is preserved exactly as it stands — rounds played,
 * table and results all carry over — and is simply relabelled as the season's
 * first running. What it lacks is the v18 furniture: a half index, a
 * registration deadline, and rosters for the eleven rival sides. The deadline is
 * backdated to before the current day and the existing squad is auto-registered,
 * so a save mid-competition is never retroactively forfeited for missing a
 * window that did not exist when it was played.
 */
function migrateV17toV18(state: GameState, cfg: typeof TUNING): void {
  const ac = state.academy;
  if (!ac?.u21) return;
  const u21 = ac.u21;
  u21.half ??= 0;
  u21.registered ??= [];
  ac.u21History ??= [];

  // Grandfather the running competition: a deadline already in the past plus a
  // registered seven means enforceU21Registration leaves it alone.
  u21.registrationDay ??= (u21.matchDays[0] ?? state.currentDay) - cfg.u21RegistrationLeadDays;
  if (u21.registered.length === 0) {
    const team = state.teams[state.userTeamId];
    const pool = (team?.academyPlayerIds ?? [])
      .map((id) => state.players[id])
      .filter((p) => p && !p.retired && !p.loan);
    const gk = pool.find((p) => p.positions[0] === "GK");
    const rest = pool.filter((p) => p !== gk).sort((a, b) => b.overall - a.overall);
    const seven = [...(gk ? [gk] : []), ...rest].slice(0, cfg.u21RegistrationSize);
    // Only a legal seven counts as registered; a short academy stays unregistered
    // and will simply be prompted to register for the next competition.
    if (seven.length === cfg.u21RegistrationSize && gk) u21.registered = seven.map((p) => p.id);
    else u21.registrationDay = state.currentDay + cfg.u21RegistrationLeadDays;
  }

  // Rival sides predate rosters; rebuilding them is left to the next competition
  // (buildU21Season fills them in). Existing opponents just gain a stance so any
  // prospect list the UI does find is priceable.
  const rng = mulberry32(deriveSeed(state.seed, `u21migrate:${state.season}`));
  for (const o of u21.opponents ?? []) {
    o.sellStance ??= pickWeighted(rng, ["willing", "premium", "unwilling"] as const, (s) => cfg.u21SellStanceWeights[s]);
  }
}

/**
 * v18 → v19: six playing styles, the Wide attacking focus, a widened sponsor
 * portfolio, per-deal negotiation patience, AI commercial income, worldwide
 * scouting, the in-season growth badge, Sponsor Marketability, and the
 * game-wide minimum player age.
 *
 * Most of the new surface is additive and optional, so the work here is limited
 * to the five places where an old save would otherwise read wrong:
 *
 *  0. The age floor. Saves made before it can hold 12- and 13-year-old academy
 *     intakes. Rather than delete them — they may be prospects the user has
 *     developed for seasons — each is aged up to the new minimum: the player
 *     keeps his identity, contract and scouting history, and the maturity curve
 *     simply reads him at the floor from here on. His current ability isn't
 *     rewritten, so he arrives slightly raw for his age and grows out of it.
 *  1. `seasonStartOverall` — the growth badge's baseline. Backfilled to each
 *     player's CURRENT overall rather than left unset, so a migrated save opens
 *     showing "no movement yet" instead of inventing a delta against a baseline
 *     that was never recorded.
 *  2. AI commercial income — priced immediately, since the market's affordability
 *     checks now read it and a club with none would look broke and stop trading.
 *  3. The `apparel` slot changed kind (minor → major). A deal signed under the
 *     old rules keeps paying weekly for the rest of its term, because retroactively
 *     converting it to a lump sum would either hand the user free money or
 *     silently cancel income they had planned around.
 *  4. Live negotiations get patience seeded so an offer mid-haggle doesn't jump
 *     straight to "about to walk away".
 *
 * Styles and focus need no work: the new values only ever appear on tactics set
 * from v19 onward, and the engine's style/focus lookups fall back to a neutral
 * shape for anything it doesn't recognise. Sponsor Marketability needs nothing
 * stored either — the star rating is derived from the live squad when read.
 */
function migrateV18toV19(state: GameState, cfg: TuningConfig): void {
  for (const p of Object.values(state.players)) {
    // 0. Age floor.
    if (typeof p.age === "number" && p.age < cfg.intakeAgeMin) p.age = cfg.intakeAgeMin;
    // 1. Growth-badge baseline.
    p.seasonStartOverall ??= p.overall;
  }

  // 2. AI clubs get a commercial department. Priced now (not at the next
  //    rollover) because canAfford() reads it the moment a window opens.
  for (const team of Object.values(state.teams)) {
    if (team.id === state.userTeamId) continue;
    if (!state.leagues[team.leagueId]?.playable) continue;
    team.commercialIncome ??= aiCommercialIncome(state, team.id, cfg);
  }

  // 3. Signed deals are deliberately left exactly as they are. A weekly-paying
  //    `apparel` deal keeps paying weekly for the rest of its term even though
  //    that slot is now a lump-sum major: the deal's own `kind`/`weeklyAmount`
  //    drive the income maths, so it stays consistent, and the user keeps the
  //    income they planned around. Only the next offer in that slot is a major.
  //
  //    Offers still on the table for a slot that changed kind are withdrawn rather
  //    than reinterpreted: an offer card showing weekly money that would now be
  //    signed as a lump sum is worse than no offer at all. The slot simply
  //    regenerates on the next daily refresh.
  const userTeam = state.teams[state.userTeamId];
  if (userTeam?.sponsorOffers) {
    userTeam.sponsorOffers = userTeam.sponsorOffers.filter((o) => {
      const nowMajor = cfg.sponsorMajorSlots.includes(o.slot);
      const wasMajor = o.kind === "major";
      return nowMajor === wasMajor;
    });
  }

  // 4. Seed patience on live negotiations so a mid-haggle offer reads sensibly.
  for (const offer of state.offers) {
    if (offer.status !== "pending") continue;
    offer.patienceMax ??= cfg.negotiationPatienceMax;
    // Charge for rounds already spent, so a user deep into talks doesn't get a
    // full bar handed back to them.
    const spent = (offer.negotiationRound ?? 0) * cfg.negotiationPatienceCostBase;
    offer.patience ??= Math.max(cfg.negotiationPatienceCostBase, offer.patienceMax - spent);
  }
}

/**
 * v19 → v20: three new revenue facilities (membership, events, academy
 * partnerships) and optional contract release clauses.
 *
 * Both are purely additive. The new facilities start at level 0, exactly as a
 * new save would, so no existing club is handed income it never bought. Release
 * clauses are absent on every existing contract, which is the correct reading —
 * nobody agreed to one — and `askPrice` only consults the field when it's set.
 */
function migrateV19toV20(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    team.membershipLevel ??= 0;
    team.eventsLevel ??= 0;
    team.academyPartnerLevel ??= 0;
    // Gymnasium — a new core training facility (whole-squad growth). Starts at
    // level 0, exactly as a new save would.
    team.gymnasiumLevel ??= 0;
  }
  // Periodic for-hire market turnover: schedule the first cycle from today.
  state.marketRefreshDay ??= state.currentDay + TUNING.marketRefreshDays;
}

/**
 * v20 → v21: the scouting shortlist. A personal watchlist of other clubs'
 * players, starting empty — nothing to backfill from, and being on it changes
 * nothing in the world, so an old save simply opens with an empty list.
 */
function migrateV20toV21(state: GameState): void {
  state.shortlist ??= [];
}

/**
 * v21 → v22: the structured world transfer feed (Transfers → News). A live
 * ledger of every senior deal between clubs, starting empty. There is nothing to
 * reconstruct — past deals were only ever kept as the flavour ticker and per-
 * player career rows, neither of which carries the crest/kind detail the feed
 * renders — so an old save simply begins logging from its next completed move.
 */
function migrateV21toV22(state: GameState): void {
  state.transferNews ??= [];
}

/**
 * v22 → v23: sim leagues gain a top-assists line, and their final resolution
 * moves from just before season end to just after the final league round (so
 * the completed table is browsable during the season it belongs to).
 *
 * Both are read-time-safe: an already-resolved `SimLeagueResult` without
 * `topAssists` simply renders scorers only, and the resolve-day shift only
 * affects the schedule from the next season's rollover on. Nothing stored needs
 * rewriting — the fields default at read time. Kept as an explicit step so the
 * chain stays honest.
 */
function migrateV22toV23(state: GameState): void {
  void state; // additive/optional — topAssists and resolve-day default at read time
}

/**
 * v23 → v24: player accolades. Individual honours and Team-of-the-Season places
 * are stamped on players (PlayerBio.accolades) and captured on each season
 * summary (SeasonSummary.accolades) from the next rollover on. Both are optional
 * and absent on an old save — a player simply has an empty trophy cabinet and a
 * historical season review degrades to the two legacy Player/Young Player fields
 * it already stored. Past seasons can't be reconstructed (the per-player rating
 * detail behind them compressed away at each old rollover), so awards legitimately
 * begin accruing from this save's next completed season. Nothing to backfill.
 */
function migrateV23toV24(state: GameState): void {
  void state; // additive/optional — accolades default at read time
}

/**
 * v24 → v25: scout-assignment durations, an explicit user bench, youth
 * scholarship wages, inbox category tags, one guaranteed keeper in every Team of
 * the Season, and a more aggressive transfer market.
 *
 * Every one of these is additive and read-time-safe, so nothing stored needs
 * rewriting:
 *  - Scout assignments gain optional `endsDay`/`durationMonths`. An absent
 *    `endsDay` means "open-ended" — exactly how briefs behaved before — so
 *    existing assignments simply never auto-expire until re-sent with a duration.
 *  - `userBench` is absent, which the match builder reads as "auto-pick the
 *    bench" — the pre-v25 behaviour.
 *  - Academy wages are derived from each prospect's current overall at read time
 *    (economy.academyWageFor), so there is no per-player field to backfill.
 *  - Inbox tags, the Team-of-the-Season keeper rule and the transfer tuning are
 *    all computed from data already present.
 *
 * Kept as an explicit step so the version bump is recorded and the chain stays
 * honest.
 */
function migrateV24toV25(state: GameState): void {
  void state; // additive/optional — all v25 fields default at read time
}

/**
 * v25 → v26: the manager progress ledger (User Accolades + Achievements).
 *
 * Backfills a fresh `progress` block, then seeds what history already lets us
 * recover so a long-running save doesn't open with everything at zero:
 *
 *  • `seasonsPlayed` = the number of completed seasons in the record book.
 *  • `leagueTitles` / `cupsWon` = count the user's club in each season summary's
 *    champions/cup-winner slots.
 *  • Live peaks (budget, 90/85-overalls) are seeded from the current squad via
 *    syncProgress at the end.
 *
 * Career match/goal totals and transfer milestones can't be reconstructed — the
 * fixtures that held them compressed into season summaries long ago — so those
 * legitimately start from now and accrue going forward. Achievements are then
 * evaluated once against the seeded ledger, so a save that already qualifies
 * (a title-winning dynasty, a billion-pound budget) unlocks them on load.
 */
function migrateV25toV26(state: GameState): void {
  const prog = ensureProgress(state);
  const a = prog.accolades;
  const userTeamId = state.userTeamId;
  a.seasonsPlayed = state.recordBook.seasons.length;
  let titles = 0;
  let cups = 0;
  let playerAwards = 0;
  for (const s of state.recordBook.seasons) {
    for (const champ of Object.values(s.championsByLeague)) {
      if (champ.teamId === userTeamId) titles++;
    }
    if (s.cupWinner?.teamId === userTeamId) cups++;
    playerAwards += userPlayerAwardsIn(state, s.accolades);
  }
  a.leagueTitles = titles;
  a.cupsWon = cups;
  a.playerAwards = playerAwards;
  // Seed the live peaks + unlock anything the seeded ledger already qualifies for.
  syncProgress(state);
}

/**
 * v26 → v27: full player names, and a repair for the phantom growth badge.
 *
 * `fullName` is purely additive — it only ever comes from a real-world database,
 * and the UI falls back to `name`, so an old save needs nothing there. Existing
 * saves keep the short name on the profile header until they are rebuilt; there
 * is no way to recover a full name the save never stored.
 *
 * The repair is the real work. `materializePlayer` used to stamp the growth
 * badge's baseline (`seasonStartOverall`) from the rating `generatePlayer`
 * rolled, then overwrite `overall` with the database's authored value without
 * re-stamping — so every database player in a brand-new save wore a "+X this
 * season" he had not earned. Worldgen now re-stamps; saves already made carry
 * the bad baseline, and only season one can be fixed safely: before the first
 * rollover nobody has legitimately developed yet, so any difference is the bug
 * and clearing it to the current overall is exactly right. From season two on a
 * baseline is genuine progress and is left alone — silently flattening a real
 * "+4 this season" would be a worse lie than the one being fixed.
 */
function migrateV26toV27(state: GameState): void {
  if (state.season > 1 || state.recordBook.seasons.length > 0) return;
  for (const p of Object.values(state.players)) {
    p.seasonStartOverall = p.overall;
  }
}

/**
 * v27 → v28: AI clubs hold real sponsorship books (v1.5).
 *
 * Before this, every AI club's entire commercial department was one abstract
 * `commercialIncome` number. They now carry actual `SponsorDeal` objects — the
 * same major/minor shapes the user signs — resolved automatically each season.
 * An existing save's AI clubs have no book at all, so one is seeded here.
 *
 * Deliberately no budget credit: these clubs' budgets are already whatever the
 * save says they are, and paying out the majors' lump sums on load would hand
 * the entire AI world a windfall it never earned — inflating the transfer
 * market the moment a save is opened. The books start signed and paid; only the
 * NEXT rollover's deals are new money.
 */
function migrateV27toV28(state: GameState): void {
  seedAiSponsorBooks(state, TUNING);
}

/**
 * v28 → v29: the end-of-season contract round, and academy graduates who wait
 * for a decision (v1.51).
 *
 * Two behaviours that used to happen silently at the rollover now belong to the
 * manager, so both need a place in the schedule and the save:
 *
 *  • `contractResolveDay` is stamped onto the CURRENT season's schedule (new
 *    seasons get it from `buildSeasonSchedule`). It sits the day after the
 *    awards, inside the same dead week. A save loaded mid-season therefore gets
 *    the round this season rather than having to wait a full year for it.
 *
 *    If the save is already PAST that day — loaded during the dead week, or
 *    parked on the season-end day — the round is opened immediately instead, so
 *    a manager who is one click from END SEASON still gets the choice their
 *    squad's expiring deals deserve rather than losing them to the old silent
 *    release on the very next rollover.
 *
 *  • `pendingGraduates` starts empty. Prospects who aged out in previous seasons
 *    were pushed into the senior squad under the old rule and are already there;
 *    there is nothing to reconstruct, and pulling them back out would be a far
 *    worse surprise than the one being fixed. Only age-outs from this rollover on
 *    wait for a decision.
 */
function migrateV28toV29(state: GameState): void {
  const sched = state.schedule;
  if (sched.contractResolveDay === undefined) {
    // Mirror buildSeasonSchedule: the day after the honours. `accoladesDay` is
    // itself optional on pre-v1.44 saves, so fall back to the cup final +2 and
    // finally to a couple of days before the rollover — the day must always land
    // inside the dead week, never on or after seasonEndDay.
    const cupFinal = sched.cupRoundDays[sched.cupRoundDays.length - 1];
    const derived =
      sched.accoladesDay !== undefined
        ? sched.accoladesDay + 1
        : cupFinal !== undefined
          ? cupFinal + 2
          : sched.seasonEndDay - 2;
    sched.contractResolveDay = Math.min(derived, sched.seasonEndDay - 1);
  }
  state.pendingGraduates ??= [];
  // Already past the round this season — open it now so the choice isn't lost.
  if (state.currentDay >= sched.contractResolveDay && !state.contractResolution) {
    openContractResolution(state);
  }
}

/**
 * v29 → v30: European cups (v1.51).
 *
 * The whole European layer is optional: a save without `state.european` simply
 * runs no continental football, exactly as it did before. So there is nothing to
 * backfill — an existing save is left with European competitions OFF, which is
 * the honest outcome. Turning them on mid-save would have to invent a
 * qualification history the save never played, and would drop 32-club
 * competitions into a world whose fixtures for the current season are already
 * generated.
 *
 * The one thing that IS added is the schedule's European matchdays, so that a
 * migrated save which later enables the cups (or simply rolls over into a build
 * that does) has the dates available rather than a missing field.
 */
function migrateV29toV30(state: GameState): void {
  if (state.schedule.euroRoundDays === undefined) {
    // Rebuild from the same generator the live schedule uses, so a migrated
    // save's European dates are identical to a fresh one's for that season.
    state.schedule.euroRoundDays = buildSeasonSchedule(state.season).euroRoundDays;
  }
}

/** True if the save is a version this build knows how to bring up to date. */
export function isMigratable(version: number): boolean {
  return version >= 1 && version <= SCHEMA_VERSION;
}

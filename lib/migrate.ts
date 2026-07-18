// Save migrations. Each step upgrades a save one schema version. Kept tiny and
// pure so both the IndexedDB loader and the JSON importer share the same path.

import type { GameState } from "./types";
import { SCHEMA_VERSION } from "./types";
import { TUNING } from "./config/tuning";
import { buildSeasonSchedule } from "./calendar";
import { initAcademyState } from "./academy";
import { ensureContracts } from "./contracts";
import { migrateOldRegion } from "./config/scouting";
import { refreshSponsorOffers } from "./sponsors";
import { RETIRED_TRAIT_IDS, TRAIT_MAP } from "./config/traits";
import { overallFromAttrs } from "./config/positions";
import { uid } from "./rng";

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
  // future migrations chain here
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

/** True if the save is a version this build knows how to bring up to date. */
export function isMigratable(version: number): boolean {
  return version >= 1 && version <= SCHEMA_VERSION;
}

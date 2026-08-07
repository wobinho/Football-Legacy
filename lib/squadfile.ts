// Squad export / import (v1.92) — take your team into the next legacy.
//
// `lib/playerfile.ts` moves ONE player between running saves. This moves a whole
// squad, and in a different direction: out of a live save and into the DATABASE
// EDITOR, as a custom club with an authored roster. From there it is an ordinary
// library club — editable, and placeable into any new world at setup.
//
// The distinction between the two files is worth keeping straight, because they
// look similar and are not:
//
//   • A PLAYER FILE is a CHARACTER. It carries the man's career, his honours and
//     his current ability, and it is signed into a running world.
//   • A SQUAD FILE is a DESIGN. It becomes a `LibraryClub` — a ClubSeed with a
//     roster of PlayerSeeds — which is what worldgen consumes when it BUILDS a
//     world. A seed has no career and no history, because the club it describes
//     has not played yet.
//
// So this deliberately throws history away. That is not a limitation to be fixed
// later: a season-by-season record belongs to a world, and the club being
// authored here is going to exist in a different one, from its first fixture.
// What travels is what makes the squad itself — who the players are, what they
// can do, and what they might become.
//
// Two things are carried that a hand-authored seed usually omits, because the
// whole point is that the squad arrives AS IT IS rather than as a template:
// every player's 35 attributes verbatim (so overall is derived, not restated),
// and his potential (so a squad exported mid-rebuild keeps the prospects that
// made it worth exporting).

import type { GameState, PlayerBio } from "./types";
import type { ClubSeed, PlayerSeed } from "./database";
import type { LibraryClub } from "./customdb";
import type { TuningConfig } from "./config/tuning";
import { libraryId } from "./customdb";
import { materializePlayer } from "./worldgen";
import { mulberry32 } from "./rng";
import { assignKitNumber } from "./kitnumbers";
import { ensureProspectTier, ensureOptimalPlan } from "./academy";

/** Bumped only when the squad-file shape itself changes. */
export const SQUAD_FILE_VERSION = 1;

export interface SquadFile {
  /** Format marker — checked on import so a save (or a player file) dropped
   * here fails loudly rather than half-parsing into a broken club. */
  kind: "football-legacy-squad";
  fileVersion: number;
  /** The schema the source save was on. Informational, but it makes a bad
   * import diagnosable. */
  sourceSchemaVersion: number;
  exportedAt: number;
  /** Provenance, shown in the editor so the user knows which legacy this squad
   * came out of. */
  origin: {
    saveName: string;
    managerName: string;
    season: number;
    /** The division the club was playing in when exported, by name. */
    leagueName: string | null;
  };
  /** Which roster was exported (v2.0). Absent on a pre-v2.0 file, which always
   * held a senior squad (with or without the academy folded in) — so a missing
   * value reads as `"senior"` and no migration is needed. */
  roster?: SquadRoster;
  /** The club itself, in the exact shape the library stores and worldgen
   * consumes — so importing is a copy, not a conversion. */
  club: ClubSeed;
}

/**
 * Turn a live player into the seed that would recreate him.
 *
 * `attrs` is carried in full and `overall` is deliberately NOT set: worldgen
 * derives overall from the attribute line when one is present
 * (`materializePlayer`), so restating it would create a second source of truth
 * that a later edit in the editor could contradict.
 *
 * `contractYears` is re-expressed as a REMAINING term rather than the absolute
 * expiry season it is stored as, because the destination world starts at its own
 * season 1 and an expiry of "season 14" means nothing there.
 */
function playerToSeed(state: GameState, p: PlayerBio): PlayerSeed {
  const remaining = p.contract ? Math.max(1, p.contract.expirySeason - state.season) : undefined;
  return {
    name: p.name,
    ...(p.fullName && p.fullName !== p.name ? { fullName: p.fullName } : {}),
    positions: [...p.positions],
    attrs: { ...p.attrs },
    age: p.age,
    nationality: p.nationality,
    potential: p.potential,
    ...(typeof p.heightCm === "number" ? { heightCm: p.heightCm } : {}),
    ...(p.foot ? { foot: p.foot } : {}),
    ...(p.trainingPlan ? { trainingPlan: p.trainingPlan } : {}),
    ...(p.traits.length ? { traits: [...p.traits] } : {}),
    ...(p.contract?.wage ? { wage: p.contract.wage } : {}),
    ...(remaining !== undefined ? { contractYears: remaining } : {}),
  };
}

/**
 * Which roster the file describes.
 *
 * v2.0 replaced an `includeAcademy` flag with a CHOICE, because the two are
 * different exports rather than one export with an extra. A senior squad is a
 * TEAM — the eleven you pick and the men behind them; an academy is a
 * PIPELINE — a dozen teenagers rated 48 who are only interesting for what they
 * might become. Bolting the second onto the first produced a club seed whose
 * roster was a first team with a youth section stapled to it, which is a squad
 * no new legacy wants to start with and which nothing downstream could separate
 * again. Picking one keeps each file honest about what it holds.
 */
export type SquadRoster = "senior" | "academy";

export interface ExportSquadOptions {
  /** `"senior"` (default) is the club's registered squad; `"academy"` is the
   * youth roster alone. */
  roster?: SquadRoster;
}

/**
 * Lift one of a club's rosters out of `state` as a portable file.
 *
 * Non-destructive, like a player export — the squad stays exactly where it is.
 *
 * Players out on loan ARE included: they are the club's players, and the loan is
 * a world-bound arrangement with a club the destination has never heard of. That
 * is also why nothing about the loan travels — a seed has no `loan` field at all,
 * so an imported player arrives back at his parent club by construction.
 * Retired players are not included, for the obvious reason.
 */
export function exportSquad(
  state: GameState,
  teamId: string,
  opts: ExportSquadOptions = {}
): SquadFile | null {
  const team = state.teams[teamId];
  if (!team) return null;

  const roster: SquadRoster = opts.roster ?? "senior";
  const ids = roster === "academy" ? team.academyPlayerIds ?? [] : team.playerIds;
  const players = ids
    .map((id) => state.players[id])
    .filter((p): p is PlayerBio => Boolean(p) && !p.retired)
    .map((p) => playerToSeed(state, p));

  // `squadAvgOverall` is omitted on purpose. It sizes the squad worldgen
  // GENERATES to fill a club out, and this club arrives with a full authored
  // roster — setting it would have the new world bolt a second squad of
  // procedural players on top of the one being imported.
  const club: ClubSeed = {
    name: team.name,
    short: team.short,
    colors: [...team.colors] as [string, string],
    rep: Math.round(team.reputation),
    stadium: team.stadium,
    budget: Math.max(0, Math.round(team.budget)),
    players,
  };

  return {
    kind: "football-legacy-squad",
    fileVersion: SQUAD_FILE_VERSION,
    sourceSchemaVersion: state.schemaVersion,
    exportedAt: Date.now(),
    origin: {
      saveName: state.saveName,
      managerName: state.managerName,
      season: state.season,
      leagueName: state.leagues[team.leagueId]?.name ?? null,
    },
    roster,
    club,
  };
}

/** Parse and validate a squad file. Throws with a readable reason. */
export function parseSquadFile(text: string): SquadFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const f = raw as Partial<SquadFile>;
  if (f?.kind !== "football-legacy-squad") {
    const kind = (raw as { kind?: string })?.kind;
    if (kind === "football-legacy-player") {
      throw new Error("That's a single-player file, not a squad. Import it from a player's profile in a running save.");
    }
    throw new Error("Not a Football Legacy squad file. (A full save goes through Load Game, not here.)");
  }
  if (typeof f.fileVersion !== "number" || f.fileVersion > SQUAD_FILE_VERSION) {
    throw new Error(`This squad file was made by a newer version of the game (v${f.fileVersion}).`);
  }
  const c = f.club;
  if (!c || typeof c.name !== "string" || !Array.isArray(c.players)) {
    throw new Error("That squad file is missing required fields.");
  }
  if (!c.players.length) {
    throw new Error("That squad file contains no players.");
  }
  return f as SquadFile;
}

/**
 * Convert a parsed squad file into a library club, ready to save into the
 * editor.
 *
 * A fresh `libraryId` is stamped for the same reason a player import re-keys:
 * importing the same file twice, or a file exported from a library club, must
 * produce two independent entries rather than silently overwriting one.
 */
export function squadFileToLibraryClub(file: SquadFile): LibraryClub {
  const c = file.club;
  return {
    id: libraryId("club"),
    name: c.name,
    short: c.short,
    colors: [...c.colors] as [string, string],
    rep: c.rep,
    stadium: c.stadium,
    ...(c.budget !== undefined ? { budget: c.budget } : {}),
    players: (c.players ?? []).map((p) => ({ ...p })),
    updatedAt: Date.now(),
  };
}

// ── Mid-save import (v2.0) ────────────────────────────────────────────────
//
// The third destination for a squad file, and the one the format was NOT
// originally built for: signing it into a world that is already being played,
// rather than authoring a club for a world that hasn't started.
//
// It is the squad-scale counterpart to `lib/playerfile.ts`'s import and it
// borrows that file's three rules wholesale, because they are the same rules at
// a different arity — nothing world-bound travels, every arrival is re-keyed,
// and no history comes with it (a seed never carried any). Deliberately NOT a
// transfer: no fee, no wage negotiation, no consent roll, no window. This is a
// modding and continuity tool, and one that could fail for reasons the user
// can't act on would defeat its own purpose.
//
// Two rules are specific to importing a whole roster:
//
//   • **A loan does not survive the crossing.** A player out on loan when the
//     file was written arrives at his parent club, available. That falls out of
//     the format rather than being enforced here — a `PlayerSeed` has no `loan`
//     field, so there is nothing to carry — but it is the behaviour the feature
//     promises, and `verify:squadfile` asserts it directly so a future field
//     added to the seed can't quietly reintroduce it.
//
//   • **The roster the file HOLDS decides where it lands**, and the caller may
//     not override it. An academy file signs into the academy and a senior file
//     into the senior squad: a 14-year-old rated 44 dropped into a first-team
//     squad is not a signing anyone meant to make, and a 31-year-old in the
//     youth roster breaks every age gate the academy owns.

export interface SquadImportResult {
  /** Ids of the players actually signed, in file order. */
  playerIds: string[];
  /** Where they landed — the file's own roster, never the caller's choice. */
  roster: SquadRoster;
  /** Players the file held that the destination had no room for. Non-empty
   * means the import was PARTIAL, which the caller must report: silently
   * dropping half a squad is the worst outcome available here. */
  skipped: string[];
}

/**
 * Sign a squad file's roster into a running save.
 *
 * `limit` is the destination's remaining room (senior squad cap, or academy
 * squad cap for a youth file) — the caller owns that number because the two
 * caps live in different modules, and passing it in keeps this function from
 * reaching into either. Whatever doesn't fit is reported in `skipped` rather
 * than dropped quietly.
 */
export function importSquadFile(
  state: GameState,
  file: SquadFile,
  teamId: string,
  cfg: TuningConfig,
  limit: number
): SquadImportResult {
  const team = state.teams[teamId];
  const roster: SquadRoster = file.roster ?? "senior";
  const result: SquadImportResult = { playerIds: [], roster, skipped: [] };
  if (!team) return result;

  const seeds = file.club.players ?? [];
  // Seeded off the file itself rather than off `Math.random`, so importing the
  // same file into the same save twice produces the same players — the
  // determinism rule applies here exactly as it does in the engine, and the
  // rolled parts of `materializePlayer` (the attributes a partial seed leaves
  // out, personality, traits) are otherwise a fresh dice throw every time.
  const rng = mulberry32(state.seed ^ file.exportedAt ^ seeds.length);
  const homeNat = state.players[team.playerIds[0]]?.nationality ?? "ENG";

  for (const seed of seeds) {
    if (result.playerIds.length >= limit) {
      result.skipped.push(seed.name);
      continue;
    }
    const p = materializePlayer(rng, cfg, seed, homeNat);
    // `materializePlayer` builds for a world starting at season 1, so the term
    // it stamps expires in the past in a save that is ten seasons in.
    // Re-express it from the CURRENT season, which is what `contractYears`
    // meant when the exporter wrote it.
    if (p.contract) {
      const years = Math.max(1, Math.round(seed.contractYears ?? cfg.contractRenewYearsDefault));
      p.contract = { wage: p.contract.wage, expirySeason: state.season + years - 1, signedSeason: state.season };
    }
    // He arrives fit and neutral, like an imported player file: the form and
    // fatigue of a world that no longer exists mean nothing here.
    p.fitness = 100;
    p.form = 1;
    p.seasonStartOverall = p.overall;
    p.clubId = teamId;
    // Signed this season, so the same-season resale lock binds him like any
    // other arrival (v1.89) — an import must not be a way to buy and flip.
    p.acquiredSeason = state.season;

    state.players[p.id] = p;
    state.careers[p.id] = { playerId: p.id, seasons: [], transfers: [] };
    state.careers[p.id].transfers.push({
      season: state.season,
      day: state.currentDay,
      from: file.club.name,
      to: roster === "academy" ? `${team.name} Youth Academy` : team.name,
      fee: 0,
      toId: team.id,
    });

    if (roster === "academy") {
      p.academyClubId = team.id;
      ensureProspectTier(p, cfg);
      ensureOptimalPlan(p);
      (team.academyPlayerIds ??= []).push(p.id);
    } else {
      team.playerIds.push(p.id);
    }
    assignKitNumber(state, p);
    result.playerIds.push(p.id);
  }

  return result;
}

/** Trigger a browser download of a squad file. */
export function downloadSquadFile(file: SquadFile) {
  const safe = file.club.name.replace(/[^a-z0-9-_]/gi, "_");
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}_S${file.origin.season}.flsquad.json`;
  a.click();
  URL.revokeObjectURL(url);
}

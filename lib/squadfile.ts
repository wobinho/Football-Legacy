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
import { libraryId } from "./customdb";

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

export interface ExportSquadOptions {
  /** Include the academy roster as well as the senior squad. Off by default: an
   * academy is a facility the destination club has to build for itself, and a
   * 13-year-old is not part of the team the user is exporting. */
  includeAcademy?: boolean;
}

/**
 * Lift a club's whole squad out of `state` as a portable file.
 *
 * Non-destructive, like a player export — the squad stays exactly where it is.
 *
 * Players out on loan ARE included: they are the club's players, and the loan is
 * a world-bound arrangement with a club the destination has never heard of.
 * Retired players are not, for the obvious reason.
 */
export function exportSquad(
  state: GameState,
  teamId: string,
  opts: ExportSquadOptions = {}
): SquadFile | null {
  const team = state.teams[teamId];
  if (!team) return null;

  const ids = [...team.playerIds, ...(opts.includeAcademy ? team.academyPlayerIds ?? [] : [])];
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

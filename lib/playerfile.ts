// Player export / import (v1.91) — "alternate universes".
//
// A single player, lifted out of one save as a file and signed into another.
// The point is continuity of a CHARACTER across saves: the academy graduate you
// developed for eight seasons can turn up in a fresh world, with his attributes,
// his honours and his career record intact.
//
// Three rules shape the format, and all three exist because the obvious version
// is wrong:
//
//   1. **A player file is not a save fragment.** It carries the player and
//      nothing that only means something inside his old world — his `clubId`,
//      his loan, his kit number and his transfer-lock are all dropped on export,
//      because they point at teams and seasons the destination has never heard
//      of. What survives is what is intrinsically HIS: attributes, potential,
//      traits, personality, development log, honours and career history.
//
//   2. **An imported player gets a NEW id.** Ids are only unique within a save,
//      so importing a file into the world it came from — or importing the same
//      file twice — would otherwise collide and silently overwrite a player.
//      Re-keying on import makes both harmless, and it is why the career rows
//      are rewritten to the new id rather than trusted.
//
//   3. **Career history travels by NAME, not by id.** `CareerRow` already
//      stores `clubName` alongside its optional `clubId`, and `TransferRow`
//      likewise stores `from`/`to` names beside optional ids — the schema was
//      already built to render a history whose clubs it can't resolve. So the
//      ids are simply dropped on export: in the destination they would point at
//      whatever club happened to occupy that id, rendering a stranger's badge
//      against this player's history. Stripped, the UI's existing name-only
//      fallback takes over and the record still reads "Real Madrid — 34 apps,
//      21 goals" in a world with no Real Madrid, which is the point of moving him.
//
// The file is plain JSON and versioned independently of the save schema: a
// player is a much smaller and more stable object than a whole world, so a
// player file should outlive save-format churn.

import type { GameState, PlayerBio, PlayerCareer, SeasonPlayerStats } from "./types";
import { uid } from "./rng";
import { assignKitNumber } from "./kitnumbers";

/** Bumped only when the player-file shape itself changes. */
export const PLAYER_FILE_VERSION = 1;

/** A fresh, empty stat line — what an imported player starts the season on. */
function emptyStats(): SeasonPlayerStats {
  return { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0 };
}

export interface PlayerFile {
  /** Format marker — checked on import so a save file dropped here fails
   * loudly rather than half-parsing into a broken player. */
  kind: "football-legacy-player";
  fileVersion: number;
  /** The schema the source save was on. Informational: the player payload is
   * deliberately independent of it, but it makes a bad import diagnosable. */
  sourceSchemaVersion: number;
  exportedAt: number;
  /** Provenance, shown in the import preview so the user knows what he's
   * signing and where the character came from. */
  origin: {
    saveName: string;
    managerName: string;
    /** The club he was at when exported, by name. */
    clubName: string | null;
    season: number;
  };
  /** The player, stripped of everything world-specific (see rule 1). */
  player: PlayerBio;
  /** His season-by-season record and transfer history, with every club id
   * stripped so only the names travel (see rule 3). Absent if he never
   * completed a season. */
  career?: PlayerCareer;
}

/**
 * Fields that describe a player's PLACE in a world rather than the player
 * himself. Dropped on export and re-established on import.
 *
 * `kitNumber` is here because the number is the destination squad's to give:
 * carrying a 10 across would either clash with the incumbent or hand out a
 * shirt the new club hasn't got free.
 */
const WORLD_BOUND_FIELDS = [
  "clubId",
  "kitNumber",
  "loan",
  "contract",
  "acquiredSeason",
  "availableSince",
  "inactiveDays",
  "academyClubId",
] as const;

/**
 * Lift a player out of `state` as a portable file.
 *
 * Non-destructive: the player stays exactly where he is. Exporting is taking a
 * copy, not a transfer — the same character existing in two universes is the
 * feature, so nothing here removes or marks him.
 */
export function exportPlayer(state: GameState, playerId: string): PlayerFile | null {
  const p = state.players[playerId];
  if (!p) return null;

  // Deep copy first: the export must never alias live state, or stripping the
  // world-bound fields below would mutate the player still in the save.
  const player = structuredClone(p) as PlayerBio & Record<string, unknown>;
  for (const f of WORLD_BOUND_FIELDS) delete player[f];
  // Current-season counters belong to the season he's leaving behind; the
  // completed seasons in `career` are the record that travels.
  player.stats = emptyStats();
  delete player.youthStats;

  // Strip club ids from the history (rule 3) — the names are already stored
  // beside them, and an id resolves to a different club in another world.
  const src = state.careers?.[playerId];
  const career: PlayerCareer | undefined = src
    ? {
        playerId: p.id,
        seasons: src.seasons.map(({ clubId: _clubId, ...row }) => ({ ...structuredClone(row) })),
        transfers: src.transfers.map(({ fromId: _f, toId: _t, ...row }) => ({ ...structuredClone(row) })),
      }
    : undefined;

  return {
    kind: "football-legacy-player",
    fileVersion: PLAYER_FILE_VERSION,
    sourceSchemaVersion: state.schemaVersion,
    exportedAt: Date.now(),
    origin: {
      saveName: state.saveName,
      managerName: state.managerName,
      clubName: p.clubId ? state.teams[p.clubId]?.name ?? null : null,
      season: state.season,
    },
    player: player as PlayerBio,
    career,
  };
}

/** Parse and validate a player file. Throws with a readable reason. */
export function parsePlayerFile(text: string): PlayerFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const f = raw as Partial<PlayerFile>;
  if (f?.kind !== "football-legacy-player") {
    throw new Error("Not a Football Legacy player file. (A full save goes through Load Game, not here.)");
  }
  if (typeof f.fileVersion !== "number" || f.fileVersion > PLAYER_FILE_VERSION) {
    throw new Error(`This player file was made by a newer version of the game (v${f.fileVersion}).`);
  }
  const p = f.player;
  // Enough of a shape check that a truncated or hand-edited file is caught here
  // rather than rendering as a blank row three screens later.
  if (!p || typeof p.name !== "string" || !p.attrs || !Array.isArray(p.positions) || !p.positions.length) {
    throw new Error("That player file is missing required fields.");
  }
  if (typeof p.overall !== "number" || typeof p.potential !== "number") {
    throw new Error("That player file has no ratings.");
  }
  return f as PlayerFile;
}

export interface ImportResult {
  playerId: string;
  name: string;
}

/**
 * Sign an imported player into a club.
 *
 * `clubId` null drops him into the world as a free agent, which is the honest
 * default when the user just wants the character to EXIST in this universe and
 * would rather sign him properly through the market.
 *
 * The player is re-keyed (rule 2), so importing the same file repeatedly — or
 * into his own source save — produces distinct players rather than clobbering
 * anyone. Career rows are rewritten to the new id for the same reason.
 *
 * Deliberately NOT done here: no fee, no wage negotiation, no consent roll.
 * This is a modding/continuity tool, not a transfer — pretending otherwise
 * would mean an import could fail for reasons the user can't act on, and the
 * whole point is that the character arrives.
 */
export function importPlayer(
  state: GameState,
  file: PlayerFile,
  clubId: string | null,
  opts: { wage?: number; contractYears?: number } = {}
): ImportResult {
  const p = structuredClone(file.player) as PlayerBio & Record<string, unknown>;

  // Re-key, and strip anything world-bound that a hand-edited file smuggled in.
  const newId = uid("p");
  p.id = newId;
  for (const f of WORLD_BOUND_FIELDS) delete p[f];
  p.retired = false;

  // He arrives fit and neutral rather than carrying the fatigue and form of a
  // world that no longer exists.
  p.fitness = 100;
  p.form = 1;
  p.stats = emptyStats();
  p.seasonStartOverall = p.overall as number;

  const player = p as PlayerBio;
  state.players[newId] = player;

  // Career history, re-keyed and preserved. Ids inside the rows were stripped
  // at export, so nothing here can point at a destination club by accident.
  if (file.career && (file.career.seasons?.length || file.career.transfers?.length)) {
    state.careers[newId] = {
      playerId: newId,
      seasons: (file.career.seasons ?? []).map((r) => ({ ...r })),
      transfers: (file.career.transfers ?? []).map((r) => ({ ...r })),
    };
  }

  if (clubId && state.teams[clubId]) {
    const team = state.teams[clubId];
    player.clubId = clubId;
    team.playerIds.push(newId);
    player.contract = {
      wage: opts.wage ?? estimateWage(player),
      expirySeason: state.season + (opts.contractYears ?? 3),
      signedSeason: state.season,
    };
    // Signed this season, so the same-season transfer lock applies to him like
    // any other arrival (v1.89) — an import must not be a way to buy a player
    // and flip him in the same window.
    player.acquiredSeason = state.season;
    assignKitNumber(state, player);
  } else {
    player.clubId = null;
  }

  return { playerId: newId, name: player.name };
}

/**
 * A plausible wage when the caller doesn't supply one.
 *
 * Deliberately crude and local rather than reaching into the contract module's
 * demand curve: that curve prices a NEGOTIATION (club reputation, division,
 * the player's leverage), and an import isn't one. This just keeps a 90-rated
 * import off a youth-team wage so the squad's wage bill stays sane.
 */
function estimateWage(p: PlayerBio): number {
  const base = Math.pow(Math.max(1, p.overall - 40), 2.2) * 12;
  return Math.max(500, Math.round(base / 100) * 100);
}

/** Trigger a browser download of a player file. */
export function downloadPlayerFile(file: PlayerFile) {
  const safe = file.player.name.replace(/[^a-z0-9-_]/gi, "_");
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}_ovr${file.player.overall}.flplayer.json`;
  a.click();
  URL.revokeObjectURL(url);
}

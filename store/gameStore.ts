"use client";

// UI state store. The GameState object is mutated by the lib modules (they
// own the rules); the store bumps `rev` to signal React and auto-saves.

import { create } from "zustand";
import type { GameState, PlayerBio, ScreenId, Tactic } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { generateWorld, type NewGameOptions } from "@/lib/worldgen";
import {
  advanceUntilEvent,
  advanceOneDay,
  advanceToDay,
  applyMatchResult,
  afterUserMatch,
  runSeasonRollover,
  isSeasonComplete,
  type StopReason,
} from "@/lib/gameloop";
import type { Fixture, MatchResult } from "@/lib/types";
import { saveGame, loadGame, listSaves, deleteSave, exportSave, importSave, type SaveMeta } from "@/lib/save";
import { cloudOwner } from "@/lib/cloud";
import { forgetKey, rememberLastSave, lastSave, clearLastSave } from "@/lib/auth";
import { userBid, respondToOffer, releasePlayer, sellToClub, type BidOutcome, type OfferResponse } from "@/lib/transfers";
import { hireStaff, dismissCandidate, fireStaff } from "@/lib/staff";
import { hireScout, fireScout, dismissScoutCandidate } from "@/lib/scouts";
import { acceptSponsor, declineSponsor } from "@/lib/sponsors";
import { upgradeFacility, upgradeTrainingFacility, type Facility, type TrainingFacility } from "@/lib/economy";
import { setKitNumber } from "@/lib/kitnumbers";
import { deleteInboxItem, clearInbox } from "@/lib/inbox";
import { optimalTrainingPlan } from "@/lib/config/training";
import type { StaffSlot, TeamAssignments } from "@/lib/types";
import {
  promoteToSenior,
  demoteToAcademy,
  releaseFromAcademy,
  toggleFocus,
  toggleU21Squad,
  registerU21Squad,
  signU21Prospect,
  toggleLoanList,
  sendAcademyLoan,
  recallLoan,
  addScoutAssignment,
  updateScoutAssignment,
  removeScoutAssignment,
  signProspect,
  dismissReport,
} from "@/lib/academy";
import {
  evaluateOffer,
  applyContract,
  decideContract,
  undecidedContractCount,
  type OfferVerdict,
} from "@/lib/contracts";
import { signGraduate, releaseGraduate } from "@/lib/academy";
import type { ScoutPosGroup, ScoutRegion } from "@/lib/types";
import {
  loadLibrary,
  persistLibrary,
  emptyLibrary,
  libraryId,
  type CustomLibrary,
  type LibraryClub,
  type LibraryPlayer,
} from "@/lib/customdb";

interface GameStore {
  game: GameState | null;
  rev: number;
  booted: boolean;
  saves: SaveMeta[];
  screen: ScreenId;
  selectedPlayerId: string | null;
  /** A not-yet-signed prospect being previewed in the profile modal (v7). */
  previewPlayer: PlayerBio | null;
  lastStop: StopReason | null;
  toast: string | null;
  /** The season summary to show in the end-of-season review modal, set the
   * moment END SEASON takes the rollover and cleared when the user dismisses it.
   * Null the rest of the time. */
  seasonReview: import("@/lib/types").SeasonSummary | null;

  boot: () => Promise<void>;
  newGame: (opts: NewGameOptions) => Promise<void>;
  loadSave: (name: string) => Promise<void>;
  removeSave: (name: string) => Promise<void>;
  exportCurrent: () => void;
  importFile: (file: File) => Promise<void>;
  quitToMenu: () => void;
  logout: () => void;

  bump: (save?: boolean) => void;
  setScreen: (s: ScreenId) => void;
  viewPlayer: (id: string) => void;
  /** Preview a player who isn't in the world yet (e.g. a scouted prospect still
   * embedded in a report) — the profile modal reads this when the id isn't a
   * real world player. Read-only: no training plan / re-sign actions apply. */
  viewProspect: (player: PlayerBio) => void;
  closePlayer: () => void;
  showToast: (msg: string) => void;

  continueGame: () => void;
  advanceDayOnce: () => void;
  /** Calendar "simulate to this day". Pauses the day before an important
   * calendar event (a U21 deadline, a window opening/closing, the youth intake)
   * and records it in `pendingGate` so the UI can prompt. Pass `ignoreGateId`
   * (the gate the user acknowledged) to carry on through it toward the same
   * target. */
  simulateToDay: (targetDay: number, ignoreGateId?: string) => void;
  /** The intended day the last "simulate to" was heading for, so a "keep going"
   * from a gate prompt resumes toward the same destination. */
  pendingSimTarget: number | null;
  /** An important calendar day a "simulate to" paused before, awaiting the user.
   * Cleared when they act, dismiss, or keep going. */
  pendingGate: import("@/lib/gameloop").CalendarGate | null;
  dismissGate: () => void;
  /** Take the season rollover (the END SEASON button). No-op mid-season. */
  endSeason: () => void;
  /** Dismiss the end-of-season review modal. */
  closeSeasonReview: () => void;
  applyUserResult: (fixture: Fixture, result: MatchResult) => void;

  setTrainingPlan: (playerId: string, planId: string) => void;
  /** Auto-assign the optimal training focus. With a playerId, just that player;
   * without one, every player on the user's books (v15). */
  autoAssignTrainingPlan: (playerId?: string) => void;
  /** Set a player's shirt number, swapping with whoever wears it (v15). */
  setKitNumber: (playerId: string, number: number) => void;
  setTactic: (t: Partial<Tactic>) => void;
  setLineupSlot: (slotId: string, playerId: string | null) => void;
  clearLineup: () => void;
  /** Add/remove a player from the user's chosen bench (v25). Toggling a player
   * already benched removes him; adding respects the matchday bench cap. */
  toggleBench: (playerId: string) => void;
  /** Drag-and-drop lineup edit (v1.5): put `playerId` in `slotId`, swapping with
   * whoever holds it. Unlike `setLineupSlot` — which evicts the incumbent to the
   * squad — dragging one starter onto another exchanges their two slots, which is
   * what EA-FC-style pitch dragging means and what the user expects.
   *
   * Dropping a benched or squad player onto an occupied slot sends the incumbent
   * the other way: to the dragged player's bench place if he had one, otherwise
   * back to the squad. */
  swapLineup: (slotId: string, playerId: string) => void;
  /** Drag-and-drop bench edit (v1.5): move the player to bench index `to`,
   * inserting him if he isn't benched yet (respecting the cap). Order matters —
   * the engine's auto-subs draw from the bench in order. */
  moveBench: (playerId: string, to: number) => void;

  bid: (playerId: string, fee: number, terms?: { wage: number; years: number; releaseClause?: number }) => BidOutcome;
  respondOffer: (offerId: string, response: "accept" | "reject" | "counter", amount?: number) => OfferResponse;
  toggleTransferList: (playerId: string) => void;
  /** Sell a player outright to one of the clubs `saleSuitors` offered (v1.52).
   * Resolves immediately — no listing, no waiting for the weekly tick. */
  sellPlayerTo: (playerId: string, clubId: string) => void;
  toggleShortlist: (playerId: string) => void;
  hire: (candidateId: string) => void;
  dismissStaff: (candidateId: string) => void;
  fireStaff: (slot: StaffSlot) => void;
  upgrade: (facility: Facility) => void;
  upgradeTraining: (facility: TrainingFacility) => void;
  markRead: (inboxId: string) => void;
  markAllRead: () => void;
  deleteMail: (inboxId: string) => void;
  deleteAllMail: () => void;

  // Sponsors / investments (v6)
  signSponsor: (offerId: string) => void;
  passSponsor: (offerId: string) => void;
  // On-pitch assignments (v6): captain + set-piece takers
  setAssignment: (role: keyof TeamAssignments, playerId: string | null) => void;

  // Contracts (§10 v5)
  negotiateContract: (playerId: string, wage: number, years: number, releaseClause?: number) => OfferVerdict;
  renewContract: (playerId: string, wage: number, years: number, releaseClause?: number) => void;

  // ── End-of-season contract round (v1.51) ──
  /** Whether the dead-week contract modal is open. Raised automatically when the
   * loop stops on `contracts`, and re-openable from Home while decisions remain. */
  contractRoundOpen: boolean;
  openContractRound: () => void;
  closeContractRound: () => void;
  /** Record renew/release for one expiring deal. Renewal terms are held and
   * applied at the rollover — the player is on his old deal until then. */
  resolveContract: (
    playerId: string,
    decision: "renew" | "release",
    terms?: { wage: number; years: number; releaseClause?: number }
  ) => void;

  // ── Academy graduates awaiting a senior decision (v1.51) ──
  graduateSign: (playerId: string, terms?: { wage: number; years: number; releaseClause?: number }) => void;
  graduateRelease: (playerId: string) => void;

  // Youth Academy (§18)
  academyPromote: (playerId: string) => void;
  academyDemote: (playerId: string) => void;
  academyRelease: (playerId: string) => void;
  academyToggleFocus: (playerId: string) => void;
  academyToggleU21Squad: (playerId: string) => void;
  academyRegisterU21: (playerIds: string[]) => void;
  academySignU21Prospect: (playerId: string) => void;
  academyToggleLoan: (playerId: string) => void;
  academySendLoan: (playerId: string, clubId: string) => void;
  academyRecall: (playerId: string) => void;
  academyAddScout: (region: ScoutRegion, positions: ScoutPosGroup, archetypes?: string[], scoutId?: string, durationMonths?: number) => void;
  academyUpdateScout: (id: string, patch: { region?: ScoutRegion; positions?: ScoutPosGroup; archetypes?: string[] }) => void;
  academyRemoveScout: (id: string) => void;
  academySign: (reportId: string) => void;
  academyDismiss: (reportId: string) => void;

  // Scouting department (v14): a roster of scouts, hired and fired on its own
  scoutHire: (candidateId: string) => void;
  scoutFire: (scoutId: string) => void;
  scoutDismissCandidate: (candidateId: string) => void;

  // Squad actions (v14): release / list for transfer / list for loan
  releaseSenior: (playerId: string) => void;

  // ── Custom content library (v25): reusable saved clubs & players ──
  /** The active game-key owner's saved library. Loaded at boot; persisted on
   * every mutation. A convenience store, independent of any running save. */
  library: CustomLibrary;
  /** Re-read the library from IndexedDB (called at boot and after key switches). */
  refreshLibrary: () => Promise<void>;
  /** Add a new club (no id) or update an existing one (id set). Returns the id. */
  saveLibraryClub: (club: Omit<LibraryClub, "updatedAt">) => string;
  removeLibraryClub: (id: string) => void;
  /** Add a new player (no id) or update an existing one (id set). Returns the id. */
  saveLibraryPlayer: (player: Omit<LibraryPlayer, "updatedAt">) => string;
  removeLibraryPlayer: (id: string) => void;
}

// ── Autosave plumbing ──────────────────────────────────────────────────────
// The game object is mutated in place by the lib modules, so the store keeps a
// live reference and a "dirty" flag rather than snapshotting. A short debounce
// coalesces rapid mutations; anything the browser could interrupt (tab hidden,
// page unload) flushes immediately so a save is never a debounce window behind.
//
// Long-save cost (§13, v21): a save is tens of megabytes by season 100, and the
// write path is the one place that whole graph is walked on the UI thread. Two
// guards keep that off the critical path:
//   • Writes never overlap. If a save is still in flight the next one is marked
//     pending and runs after it, so a slow disk can't queue up a backlog of
//     full-state writes that each cost more than the frame budget.
//   • The debounce scales with how heavy the last write actually was, so a small
//     early save stays snappy at 400ms while a huge late one backs off rather
//     than re-serialising every 400ms mid-season.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirtyGame: GameState | null = null;
let saveInFlight = false;
let savePending = false;
/** The last game handed to a write — lets a departure force a cloud sync even
 * when nothing is dirty. */
let lastSavedGame: GameState | null = null;
/** Wall-clock cost of the last completed write, used to pace the debounce. */
let lastSaveMs = 0;

const SAVE_DEBOUNCE_MIN = 400;
const SAVE_DEBOUNCE_MAX = 5_000;

/** Back off proportionally to what a write costs: a save that takes 200ms is
 * worth doing often; one that takes 2s is not worth doing every 400ms. */
function saveDebounceMs(): number {
  return Math.min(SAVE_DEBOUNCE_MAX, Math.max(SAVE_DEBOUNCE_MIN, lastSaveMs * 4));
}

function flushSave(flushCloud = false) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const g = dirtyGame;
  if (!g) {
    // Nothing dirty, but a departure still wants the cloud copy current.
    if (flushCloud && lastSavedGame) saveGame(lastSavedGame, true).catch(() => {});
    return;
  }
  // A write is already running — let it finish and re-flush with whatever the
  // state looks like then, rather than starting a second full-graph write.
  if (saveInFlight) {
    savePending = true;
    return;
  }
  dirtyGame = null;
  lastSavedGame = g;
  saveInFlight = true;
  const started = performance.now();
  saveGame(g, flushCloud)
    .catch(() => {})
    .finally(() => {
      lastSaveMs = performance.now() - started;
      saveInFlight = false;
      if (savePending) {
        savePending = false;
        dirtyGame = g;
        flushSave();
      }
    });
}

function scheduleSave(g: GameState, immediate = false) {
  dirtyGame = g;
  if (immediate) {
    flushSave();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, saveDebounceMs());
}

// Flush pending writes when the tab is backgrounded or closed — the debounce
// window is exactly when saves were being lost on refresh/close before.
if (typeof window !== "undefined") {
  // Leaving the page is exactly when the cloud copy must be current — the next
  // session could be on another device.
  const flushNow = () => flushSave(true);
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("beforeunload", flushNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave(true);
  });
}

export const useGame = create<GameStore>((set, get) => ({
  game: null,
  rev: 0,
  booted: false,
  saves: [],
  screen: "home",
  selectedPlayerId: null,
  previewPlayer: null,
  lastStop: null,
  pendingSimTarget: null,
  pendingGate: null,
  toast: null,
  seasonReview: null,
  contractRoundOpen: false,
  library: emptyLibrary(),

  boot: async () => {
    // The custom-content library is owner-scoped like saves; load it alongside.
    loadLibrary().then((library) => set({ library })).catch(() => {});
    try {
      const saves = await listSaves();
      // Auto-resume: on a refresh, drop the player straight back into the save
      // they had open (per game-key owner) instead of the save picker. Only if
      // that save still exists; otherwise fall through to the menu.
      const owner = cloudOwner();
      const last = owner ? lastSave(owner) : null;
      if (last && saves.some((s) => s.saveName === last)) {
        try {
          const game = await loadGame(last);
          if (game) {
            set({ game, saves, booted: true, screen: "home", selectedPlayerId: null, lastStop: null });
            return;
          }
        } catch {
          /* corrupt/incompatible last save — fall back to the picker */
        }
      }
      set({ saves, booted: true });
    } catch {
      set({ saves: [], booted: true });
    }
  },

  newGame: async (opts) => {
    const game = generateWorld(opts);
    set({ game, screen: "home", rev: get().rev + 1, selectedPlayerId: null, lastStop: null });
    await saveGame(game);
    const owner = cloudOwner();
    if (owner) rememberLastSave(owner, game.saveName);
    set({ saves: await listSaves() });
  },

  loadSave: async (name) => {
    const game = await loadGame(name);
    if (game) {
      const owner = cloudOwner();
      if (owner) rememberLastSave(owner, name);
      set({ game, screen: "home", rev: get().rev + 1, selectedPlayerId: null, lastStop: null });
    }
  },

  removeSave: async (name) => {
    await deleteSave(name);
    set({ saves: await listSaves() });
  },

  exportCurrent: () => {
    const g = get().game;
    if (!g) return;
    g.lastExportSeason = g.season;
    exportSave(g);
    get().bump(true);
  },

  importFile: async (file) => {
    const game = await importSave(file);
    await saveGame(game);
    const owner = cloudOwner();
    if (owner) rememberLastSave(owner, game.saveName);
    set({ game, screen: "home", rev: get().rev + 1, saves: await listSaves() });
  },

  // Back to the save picker: keep the game and key, just leave the current save.
  quitToMenu: () => {
    const g = get().game;
    dirtyGame = g; // flush any pending debounce for this game synchronously
    flushSave(true); // leaving the save — make sure the cloud copy is current
    const owner = cloudOwner();
    if (owner) clearLastSave(owner); // don't auto-resume — the player asked for the menu
    set({ game: null, screen: "home", selectedPlayerId: null, lastStop: null });
    get().boot();
  },

  // Sign out entirely: flush, forget the key, and reload back to the key gate.
  logout: () => {
    const g = get().game;
    dirtyGame = g;
    flushSave();
    const owner = cloudOwner();
    if (owner) clearLastSave(owner);
    forgetKey();
    if (typeof window !== "undefined") window.location.reload();
  },

  bump: (save = true) => {
    set({ rev: get().rev + 1 });
    const g = get().game;
    if (save && g) scheduleSave(g);
  },

  setScreen: (screen) => set({ screen }),
  // Player profile is a popup overlay now — open it without leaving the screen.
  viewPlayer: (id) => set({ selectedPlayerId: id, previewPlayer: null }),
  viewProspect: (player) => set({ selectedPlayerId: player.id, previewPlayer: player }),
  closePlayer: () => set({ selectedPlayerId: null, previewPlayer: null }),
  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 3500);
  },

  continueGame: () => {
    const g = get().game;
    if (!g || g.pendingMatchFixtureId) return;
    const stop = advanceUntilEvent(g);
    set({ lastStop: stop });
    if (stop.kind === "matchday") set({ screen: "matchday" });
    else set({ screen: "home" });
    // The dead-week contract round opened — put it straight in front of the
    // manager rather than leaving it as one more unread inbox item (v1.51).
    if (stop.kind === "contracts") set({ contractRoundOpen: true });
    set({ rev: get().rev + 1 });
    scheduleSave(g, true); // advancing time is real progress — persist now
  },

  // "Advance 1 Day": step exactly one day so nothing (a window opening, an
  // intake, an offer) is fast-forwarded past. Stops on a matchday like Continue.
  advanceDayOnce: () => {
    const g = get().game;
    if (!g || g.pendingMatchFixtureId) return;
    const stop = advanceOneDay(g);
    set({ lastStop: stop });
    if (stop.kind === "matchday") set({ screen: "matchday" });
    if (stop.kind === "contracts") set({ contractRoundOpen: true });
    set({ rev: get().rev + 1 });
    scheduleSave(g, true);
  },

  // Calendar "jump to this day" — force-sim (auto-plays user matches) to target.
  // Clamps at the season end day; the rollover is taken via endSeason(). Pauses
  // the day before an important calendar event (progress gate, §3) and records
  // it in `pendingGate`; the UI prompts, then either acts or keeps going with the
  // gate id so the sim resumes past it toward the same target.
  simulateToDay: (targetDay, ignoreGateId) => {
    const g = get().game;
    if (!g || g.pendingMatchFixtureId) return;
    if (targetDay <= g.currentDay) return;
    const stop = advanceToDay(g, targetDay, ignoreGateId);
    if (stop.kind === "gate") {
      // Hold the destination so "keep going" can resume toward it, and surface
      // the gate. Stay on Home so the calendar and its prompt are both visible.
      set({ lastStop: stop, pendingSimTarget: targetDay, pendingGate: stop.gate, screen: "home", rev: get().rev + 1 });
    } else {
      set({ lastStop: stop, pendingSimTarget: null, pendingGate: null, screen: "home", rev: get().rev + 1 });
      // A force-sim can't run past the contract round either — surface it.
      if (stop.kind === "contracts") set({ contractRoundOpen: true });
    }
    scheduleSave(g, true);
  },

  // Dismiss the current progress-gate prompt without simming further (the user
  // chose to stay put and deal with it here).
  dismissGate: () => set({ pendingGate: null, pendingSimTarget: null }),

  // END SEASON: the one place the rollover happens, always player-initiated.
  endSeason: () => {
    const g = get().game;
    if (!g || g.pendingMatchFixtureId || !isSeasonComplete(g)) return;
    // Contract round still outstanding (v1.51): the rollover would release every
    // undecided player for nothing, so put the list in front of the manager once
    // instead. `acknowledged` makes this a single interception — pressing END
    // SEASON again goes through, which is how a manager deliberately lets a
    // player walk without having to click through every row.
    const res = g.contractResolution;
    if (res && res.season === g.season && !res.acknowledged && undecidedContractCount(g) > 0) {
      res.acknowledged = true;
      set({ contractRoundOpen: true, rev: get().rev + 1 });
      get().showToast("Some contracts are still unresolved — anyone left undecided leaves on a free.");
      scheduleSave(g, true);
      return;
    }
    runSeasonRollover(g);
    // The rollover pushes the just-finished season's summary onto the record
    // book; surface it in the end-of-season review the player sees immediately.
    const review = g.recordBook.seasons[g.recordBook.seasons.length - 1] ?? null;
    set({ lastStop: null, screen: "home", rev: get().rev + 1, seasonReview: review, contractRoundOpen: false });
    scheduleSave(g, true);
  },

  closeSeasonReview: () => set({ seasonReview: null }),

  applyUserResult: (fixture, result) => {
    const g = get().game;
    if (!g) return;
    applyMatchResult(g, fixture, result);
    afterUserMatch(g);
    set({ rev: get().rev + 1 });
    scheduleSave(g, true); // match results must never be lost to a debounce window
  },

  setTrainingPlan: (playerId, planId) => {
    const g = get().game;
    if (!g) return;
    const p = g.players[playerId];
    if (!p) return;
    p.trainingPlan = planId;
    get().bump(true);
  },

  autoAssignTrainingPlan: (playerId) => {
    const g = get().game;
    if (!g) return;
    const team = g.teams[g.userTeamId];
    const ids = playerId ? [playerId] : [...team.playerIds, ...(team.academyPlayerIds ?? [])];
    let changed = 0;
    for (const id of ids) {
      const p = g.players[id];
      if (!p || p.retired) continue;
      const best = optimalTrainingPlan(p);
      if (p.trainingPlan !== best.id) {
        p.trainingPlan = best.id;
        changed++;
      }
    }
    if (playerId) {
      const p = g.players[playerId];
      get().showToast(
        changed
          ? `${p?.name} switched to ${optimalTrainingPlan(p!).name}.`
          : "Already on the optimal training focus."
      );
    } else {
      get().showToast(
        changed ? `Optimal training focus set for ${changed} player${changed === 1 ? "" : "s"}.` : "Every player is already on their optimal focus."
      );
    }
    get().bump(true);
  },

  setKitNumber: (playerId, number) => {
    const g = get().game;
    if (!g) return;
    const err = setKitNumber(g, playerId, number);
    if (err) get().showToast(err);
    get().bump(true);
  },

  setTactic: (t) => {
    const g = get().game;
    if (!g) return;
    const team = g.teams[g.userTeamId];
    team.tactic = { ...team.tactic, ...t };
    if (t.formationId) g.lineup = {};
    get().bump(true);
  },

  setLineupSlot: (slotId, playerId) => {
    const g = get().game;
    if (!g) return;
    if (playerId === null) {
      delete g.lineup[slotId];
    } else {
      // if the player is already in another slot, swap
      for (const [s, id] of Object.entries(g.lineup)) {
        if (id === playerId) delete g.lineup[s];
      }
      g.lineup[slotId] = playerId;
    }
    get().bump(true);
  },

  clearLineup: () => {
    const g = get().game;
    if (!g) return;
    g.lineup = {};
    get().bump(true);
  },

  swapLineup: (slotId, playerId) => {
    const g = get().game;
    if (!g) return;
    const incumbent = g.lineup[slotId];
    if (incumbent === playerId) return;
    // Where the dragged player came from, so the incumbent can take his place.
    const fromSlot = Object.entries(g.lineup).find(([, id]) => id === playerId)?.[0];
    const bench = g.userBench ?? [];
    const fromBenchIdx = bench.indexOf(playerId);

    g.lineup[slotId] = playerId;
    if (fromSlot && fromSlot !== slotId) {
      // Starter → starter: a true exchange of the two slots.
      if (incumbent) g.lineup[fromSlot] = incumbent;
      else delete g.lineup[fromSlot];
    } else if (fromBenchIdx >= 0) {
      // Bench → XI: the incumbent inherits the exact bench place, so the
      // substitution order the user set is preserved rather than reshuffled.
      const next = [...bench];
      if (incumbent) next[fromBenchIdx] = incumbent;
      else next.splice(fromBenchIdx, 1);
      g.userBench = next;
    } else if (incumbent) {
      // Squad → XI: the incumbent simply drops out of the matchday XI.
      g.userBench = bench.filter((id) => id !== incumbent);
    }
    // A player can never be both in the XI and on the bench.
    g.userBench = (g.userBench ?? []).filter((id) => id !== playerId);
    get().bump(true);
  },

  moveBench: (playerId, to) => {
    const g = get().game;
    if (!g) return;
    // Coming from the XI, he vacates his slot — you can't be a starter and a sub.
    for (const [slot, id] of Object.entries(g.lineup)) {
      if (id === playerId) delete g.lineup[slot];
    }
    const bench = (g.userBench ?? []).filter((id) => id !== playerId);
    if (bench.length >= TUNING.matchdaySquad - 11) {
      get().showToast(`Your bench is full (${TUNING.matchdaySquad - 11} subs).`);
      get().bump(true);
      return;
    }
    const idx = Math.max(0, Math.min(bench.length, to));
    bench.splice(idx, 0, playerId);
    g.userBench = bench;
    get().bump(true);
  },

  toggleBench: (playerId) => {
    const g = get().game;
    if (!g) return;
    const bench = g.userBench ?? [];
    if (bench.includes(playerId)) {
      g.userBench = bench.filter((id) => id !== playerId);
    } else {
      const cap = TUNING.matchdaySquad - 11;
      if (bench.length >= cap) {
        get().showToast(`Your bench is full (${cap} subs).`);
        return;
      }
      g.userBench = [...bench, playerId];
    }
    get().bump(true);
  },

  bid: (playerId, fee, terms) => {
    const g = get().game;
    if (!g) return { kind: "error", reason: "No game." } as BidOutcome;
    const out = userBid(g, playerId, fee, TUNING, terms);
    get().bump(true);
    return out;
  },

  negotiateContract: (playerId, wage, years, releaseClause) => {
    const g = get().game;
    if (!g) return { kind: "rejected", wage, message: "No game." } as OfferVerdict;
    return evaluateOffer(g, g.players[playerId], wage, years, TUNING, releaseClause);
  },

  renewContract: (playerId, wage, years, releaseClause) => {
    const g = get().game;
    if (!g) return;
    const p = g.players[playerId];
    applyContract(g, p, wage, years, TUNING, releaseClause);
    const len = p.contract ? p.contract.expirySeason - g.season + 1 : years;
    get().showToast(`${p.name} re-signed on a ${len}-year deal.`);
    get().bump(true);
  },

  // ── End-of-season contract round (v1.51) ──
  openContractRound: () => set({ contractRoundOpen: true }),
  closeContractRound: () => set({ contractRoundOpen: false }),

  resolveContract: (playerId, decision, terms) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name ?? "He";
    const err = decideContract(g, playerId, decision, terms);
    if (err) get().showToast(err);
    else if (decision === "renew") {
      const len = terms?.years ?? TUNING.contractRenewYearsDefault;
      get().showToast(`${name} agrees a ${len}-year deal — it starts next season.`);
    } else {
      get().showToast(`${name} will leave when his contract expires.`);
    }
    get().bump(true);
  },

  // ── Academy graduates awaiting a senior decision (v1.51) ──
  graduateSign: (playerId, terms) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name ?? "The graduate";
    const err = signGraduate(g, playerId, TUNING, terms);
    get().showToast(err ?? `${name} signs his first senior contract.`);
    get().bump(true);
  },

  graduateRelease: (playerId) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name ?? "The graduate";
    const err = releaseGraduate(g, playerId);
    get().showToast(err ?? `${name} leaves the club as a free agent.`);
    get().bump(true);
  },

  respondOffer: (offerId, response, amount) => {
    const g = get().game;
    if (!g) return { kind: "withdrawn", message: "No game." } as OfferResponse;
    const out = respondToOffer(g, offerId, response, TUNING, amount);
    // A live counter-back keeps the modal open (no toast); resolutions toast.
    if (out.kind !== "countered") get().showToast(out.message);
    get().bump(true);
    return out;
  },

  toggleTransferList: (playerId) => {
    const g = get().game;
    if (!g) return;
    if (g.transferList.includes(playerId)) {
      g.transferList = g.transferList.filter((id) => id !== playerId);
    } else {
      g.transferList.push(playerId);
    }
    get().bump(true);
  },

  sellPlayerTo: (playerId, clubId) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name ?? "The player";
    const clubName = g.teams[clubId]?.name ?? "their new club";
    const err = sellToClub(g, playerId, clubId, TUNING);
    get().showToast(err ?? `${name} sold to ${clubName}.`);
    get().bump(true);
  },

  toggleShortlist: (playerId) => {
    const g = get().game;
    if (!g) return;
    const list = (g.shortlist ??= []);
    if (list.includes(playerId)) {
      g.shortlist = list.filter((id) => id !== playerId);
    } else {
      list.push(playerId);
    }
    get().bump(true);
  },

  hire: (candidateId) => {
    const g = get().game;
    if (!g) return;
    const err = hireStaff(g, candidateId);
    if (err) get().showToast(err);
    get().bump(true);
  },

  dismissStaff: (candidateId) => {
    const g = get().game;
    if (!g) return;
    const err = dismissCandidate(g, candidateId);
    if (err) get().showToast(err);
    get().bump(true);
  },

  fireStaff: (slot) => {
    const g = get().game;
    if (!g) return;
    const err = fireStaff(g, slot);
    if (err) get().showToast(err);
    else get().showToast("Staff member let go — the position is now vacant.");
    get().bump(true);
  },

  signSponsor: (offerId) => {
    const g = get().game;
    if (!g) return;
    const err = acceptSponsor(g, offerId, TUNING);
    if (err) get().showToast(err);
    else get().showToast("Sponsorship deal signed — weekly income up.");
    get().bump(true);
  },

  passSponsor: (offerId) => {
    const g = get().game;
    if (!g) return;
    declineSponsor(g, offerId, TUNING);
    get().bump(true);
  },

  setAssignment: (role, playerId) => {
    const g = get().game;
    if (!g) return;
    const team = g.teams[g.userTeamId];
    team.assignments ??= {};
    if (playerId === null) delete team.assignments[role];
    else {
      // a player can hold several roles, but clear the role from nobody else —
      // roles are independent (captain can also take penalties)
      team.assignments[role] = playerId;
    }
    get().bump(true);
  },

  upgrade: (facility) => {
    const g = get().game;
    if (!g) return;
    const err = upgradeFacility(g, facility, TUNING);
    if (err) get().showToast(err);
    else get().showToast(facility === "stadium" ? "Stadium upgraded — matchday income up." : "Commercial deal upgraded — weekly income up.");
    get().bump(true);
  },

  upgradeTraining: (facility) => {
    const g = get().game;
    if (!g) return;
    const err = upgradeTrainingFacility(g, facility, TUNING);
    if (err) get().showToast(err);
    else {
      const msg: Record<TrainingFacility, string> = {
        training: "Training Centre upgraded — players develop faster.",
        medical: "Medical Centre upgraded — quicker recovery.",
        gymnasium: "Gymnasium upgraded — the whole squad develops faster.",
        academy: "Youth Academy upgraded — bigger, better intake classes.",
        scoutNetwork: "Max Scouts increased — send more scouts abroad.",
        academySquad: "Academy Squad Size increased — room for more prospects.",
        focusSlot: "Focus Slots increased — flag more prospects for focus.",
        gkCentre: "Goalkeeping Centre upgraded — keepers develop faster.",
        defenceCentre: "Defensive Unit upgraded — defenders develop faster.",
        midfieldCentre: "Midfield Hub upgraded — midfielders develop faster.",
        attackCentre: "Attacking Centre upgraded — forwards develop faster.",
        sportsScience: "Sports Science Lab upgraded — physical training plans go further.",
        techCentre: "Technical Centre upgraded — technical training plans go further.",
        finishingCentre: "Finishing School upgraded — finishing plans go further.",
        youthDevCentre: "Youth Development Centre upgraded — under-21s develop faster.",
      };
      get().showToast(msg[facility]);
    }
    get().bump(true);
  },

  markRead: (inboxId) => {
    const g = get().game;
    if (!g) return;
    const item = g.inbox.find((i) => i.id === inboxId);
    if (item) item.read = true;
    get().bump(false);
  },

  markAllRead: () => {
    const g = get().game;
    if (!g) return;
    for (const item of g.inbox) item.read = true;
    get().bump(false);
  },

  deleteMail: (inboxId) => {
    const g = get().game;
    if (!g) return;
    deleteInboxItem(g, inboxId);
    get().bump(true);
  },

  deleteAllMail: () => {
    const g = get().game;
    if (!g) return;
    clearInbox(g);
    get().bump(true);
  },

  // ── Youth Academy (§18): thin wrappers, rules live in lib/academy ──
  academyPromote: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = promoteToSenior(g, playerId, TUNING);
    get().showToast(err ?? `${g.players[playerId].name} promoted to the senior squad.`);
    get().bump(true);
  },

  academyDemote: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = demoteToAcademy(g, playerId, TUNING);
    get().showToast(err ?? `${g.players[playerId].name} moves down to the academy squad.`);
    get().bump(true);
  },

  academyRelease: (playerId) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name;
    const err = releaseFromAcademy(g, playerId);
    get().showToast(err ?? `${name} released from the academy.`);
    get().bump(true);
  },

  academyToggleFocus: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = toggleFocus(g, playerId, TUNING);
    if (err) get().showToast(err);
    get().bump(true);
  },

  academyToggleU21Squad: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = toggleU21Squad(g, playerId);
    if (err) get().showToast(err);
    get().bump(true);
  },

  academyRegisterU21: (playerIds) => {
    const g = get().game;
    if (!g) return;
    const err = registerU21Squad(g, playerIds, TUNING);
    get().showToast(err ?? `Squad registered — ${playerIds.length} prospects submitted for the U21 competition.`);
    get().bump(true);
  },

  academySignU21Prospect: (playerId) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name ?? "The prospect";
    const err = signU21Prospect(g, playerId, TUNING);
    get().showToast(err ?? `${name} joins the academy.`);
    get().bump(true);
  },

  academyToggleLoan: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = toggleLoanList(g, playerId, TUNING);
    if (err) get().showToast(err);
    get().bump(true);
  },

  academySendLoan: (playerId, clubId) => {
    const g = get().game;
    if (!g) return;
    const err = sendAcademyLoan(g, playerId, clubId, TUNING);
    if (err) get().showToast(err);
    get().bump(true);
  },

  academyRecall: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = recallLoan(g, playerId);
    if (err) get().showToast(err);
    get().bump(true);
  },

  academyAddScout: (region, positions, archetypes = [], scoutId, durationMonths) => {
    const g = get().game;
    if (!g) return;
    const err = addScoutAssignment(g, region, positions, TUNING, archetypes, scoutId, durationMonths);
    if (err) get().showToast(err);
    get().bump(true);
  },

  academyUpdateScout: (id, patch) => {
    const g = get().game;
    if (!g) return;
    updateScoutAssignment(g, id, patch);
    get().bump(true);
  },

  academyRemoveScout: (id) => {
    const g = get().game;
    if (!g) return;
    removeScoutAssignment(g, id);
    get().bump(true);
  },

  academySign: (reportId) => {
    const g = get().game;
    if (!g) return;
    const report = g.academy.reports.find((r) => r.id === reportId);
    const err = signProspect(g, reportId, TUNING);
    get().showToast(err ?? `${report?.player.name} joins the academy.`);
    get().bump(true);
  },

  academyDismiss: (reportId) => {
    const g = get().game;
    if (!g) return;
    dismissReport(g, reportId);
    get().bump(true);
  },

  // ── Scouting department (v14) ──
  scoutHire: (candidateId) => {
    const g = get().game;
    if (!g) return;
    const name = (g.scoutMarket ?? []).find((c) => c.id === candidateId)?.name;
    const err = hireScout(g, candidateId, TUNING);
    get().showToast(err ?? `${name} joins the scouting department.`);
    get().bump(true);
  },

  scoutFire: (scoutId) => {
    const g = get().game;
    if (!g) return;
    const name = (g.teams[g.userTeamId].scouts ?? []).find((s) => s.id === scoutId)?.name;
    const err = fireScout(g, scoutId, TUNING);
    get().showToast(err ?? `${name} leaves the club. Any assignment they held is recalled.`);
    get().bump(true);
  },

  scoutDismissCandidate: (candidateId) => {
    const g = get().game;
    if (!g) return;
    dismissScoutCandidate(g, candidateId, TUNING);
    get().bump(true);
  },

  // ── Squad actions (v14) ──
  releaseSenior: (playerId) => {
    const g = get().game;
    if (!g) return;
    const name = g.players[playerId]?.name;
    const err = releasePlayer(g, playerId);
    get().showToast(err ?? `${name} released — he leaves as a free agent.`);
    if (!err) get().closePlayer();
    get().bump(true);
  },

  // ── Custom content library (v25) ──
  refreshLibrary: async () => {
    const library = await loadLibrary();
    set({ library });
  },

  saveLibraryClub: (club) => {
    const lib = get().library;
    const id = club.id || libraryId("club");
    const entry: LibraryClub = { ...club, id, updatedAt: Date.now() };
    const exists = lib.clubs.some((c) => c.id === id);
    const clubs = exists ? lib.clubs.map((c) => (c.id === id ? entry : c)) : [...lib.clubs, entry];
    const next = { ...lib, clubs };
    set({ library: next });
    persistLibrary(next).catch(() => get().showToast("Couldn't save to your library."));
    return id;
  },

  removeLibraryClub: (id) => {
    const lib = get().library;
    const next = { ...lib, clubs: lib.clubs.filter((c) => c.id !== id) };
    set({ library: next });
    persistLibrary(next).catch(() => {});
  },

  saveLibraryPlayer: (player) => {
    const lib = get().library;
    const id = player.id || libraryId("player");
    const entry: LibraryPlayer = { ...player, id, updatedAt: Date.now() };
    const exists = lib.players.some((p) => p.id === id);
    const players = exists ? lib.players.map((p) => (p.id === id ? entry : p)) : [...lib.players, entry];
    const next = { ...lib, players };
    set({ library: next });
    persistLibrary(next).catch(() => get().showToast("Couldn't save to your library."));
    return id;
  },

  removeLibraryPlayer: (id) => {
    const lib = get().library;
    const next = { ...lib, players: lib.players.filter((p) => p.id !== id) };
    set({ library: next });
    persistLibrary(next).catch(() => {});
  },
}));

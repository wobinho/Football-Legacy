"use client";

// UI state store. The GameState object is mutated by the lib modules (they
// own the rules); the store bumps `rev` to signal React and auto-saves.

import { create } from "zustand";
import type { GameState, PlayerBio, ScreenId, Tactic } from "@/lib/types";
import { TUNING } from "@/lib/config/tuning";
import { generateWorld, type NewGameOptions } from "@/lib/worldgen";
import { advanceUntilEvent, advanceOneDay, advanceToDay, applyMatchResult, afterUserMatch, type StopReason } from "@/lib/gameloop";
import type { Fixture, MatchResult } from "@/lib/types";
import { saveGame, loadGame, listSaves, deleteSave, exportSave, importSave, type SaveMeta } from "@/lib/save";
import { cloudOwner } from "@/lib/cloud";
import { forgetKey, rememberLastSave, lastSave, clearLastSave } from "@/lib/auth";
import { userBid, respondToOffer, releasePlayer, type BidOutcome, type OfferResponse } from "@/lib/transfers";
import { hireStaff, dismissCandidate, fireStaff } from "@/lib/staff";
import { hireScout, fireScout, dismissScoutCandidate } from "@/lib/scouts";
import { acceptSponsor, declineSponsor } from "@/lib/sponsors";
import { upgradeFacility, upgradeTrainingFacility, type Facility, type TrainingFacility } from "@/lib/economy";
import { setKitNumber } from "@/lib/kitnumbers";
import { optimalTrainingPlan } from "@/lib/config/training";
import type { StaffSlot, TeamAssignments } from "@/lib/types";
import {
  promoteToSenior,
  demoteToAcademy,
  releaseFromAcademy,
  toggleFocus,
  toggleU21Squad,
  toggleLoanList,
  recallLoan,
  addScoutAssignment,
  updateScoutAssignment,
  removeScoutAssignment,
  signProspect,
  dismissReport,
} from "@/lib/academy";
import { evaluateOffer, applyContract, type OfferVerdict } from "@/lib/contracts";
import type { ScoutPosGroup, ScoutRegion } from "@/lib/types";

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
  simulateToDay: (targetDay: number) => void;
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

  bid: (playerId: string, fee: number, terms?: { wage: number; years: number }) => BidOutcome;
  respondOffer: (offerId: string, response: "accept" | "reject" | "counter", amount?: number) => OfferResponse;
  toggleTransferList: (playerId: string) => void;
  hire: (candidateId: string) => void;
  dismissStaff: (candidateId: string) => void;
  fireStaff: (slot: StaffSlot) => void;
  upgrade: (facility: Facility) => void;
  upgradeTraining: (facility: TrainingFacility) => void;
  markRead: (inboxId: string) => void;
  markAllRead: () => void;

  // Sponsors / investments (v6)
  signSponsor: (offerId: string) => void;
  passSponsor: (offerId: string) => void;
  // On-pitch assignments (v6): captain + set-piece takers
  setAssignment: (role: keyof TeamAssignments, playerId: string | null) => void;

  // Contracts (§10 v5)
  negotiateContract: (playerId: string, wage: number, years: number) => OfferVerdict;
  renewContract: (playerId: string, wage: number, years: number) => void;

  // Youth Academy (§18)
  academyPromote: (playerId: string) => void;
  academyDemote: (playerId: string) => void;
  academyRelease: (playerId: string) => void;
  academyToggleFocus: (playerId: string) => void;
  academyToggleU21Squad: (playerId: string) => void;
  academyToggleLoan: (playerId: string) => void;
  academyRecall: (playerId: string) => void;
  academyAddScout: (region: ScoutRegion, positions: ScoutPosGroup, archetypes?: string[], scoutId?: string) => void;
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
}

// ── Autosave plumbing ──────────────────────────────────────────────────────
// The game object is mutated in place by the lib modules, so the store keeps a
// live reference and a "dirty" flag rather than snapshotting. A short debounce
// coalesces rapid mutations; anything the browser could interrupt (tab hidden,
// page unload) flushes immediately so a save is never a debounce window behind.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirtyGame: GameState | null = null;

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const g = dirtyGame;
  if (!g) return;
  dirtyGame = null;
  saveGame(g).catch(() => {});
}

function scheduleSave(g: GameState, immediate = false) {
  dirtyGame = g;
  if (immediate) {
    flushSave();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

// Flush pending writes when the tab is backgrounded or closed — the debounce
// window is exactly when saves were being lost on refresh/close before.
if (typeof window !== "undefined") {
  const flushNow = () => flushSave();
  window.addEventListener("pagehide", flushNow);
  window.addEventListener("beforeunload", flushNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
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
  toast: null,

  boot: async () => {
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
    flushSave();
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
    set({ rev: get().rev + 1 });
    scheduleSave(g, true);
  },

  // Calendar "jump to this day" — force-sim (auto-plays user matches) to target.
  simulateToDay: (targetDay) => {
    const g = get().game;
    if (!g || g.pendingMatchFixtureId) return;
    if (targetDay <= g.currentDay) return;
    advanceToDay(g, targetDay);
    set({ screen: "home", rev: get().rev + 1 });
    scheduleSave(g, true);
  },

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

  bid: (playerId, fee, terms) => {
    const g = get().game;
    if (!g) return { kind: "error", reason: "No game." } as BidOutcome;
    const out = userBid(g, playerId, fee, TUNING, terms);
    get().bump(true);
    return out;
  },

  negotiateContract: (playerId, wage, years) => {
    const g = get().game;
    if (!g) return { kind: "rejected", wage, message: "No game." } as OfferVerdict;
    return evaluateOffer(g, g.players[playerId], wage, years, TUNING);
  },

  renewContract: (playerId, wage, years) => {
    const g = get().game;
    if (!g) return;
    const p = g.players[playerId];
    applyContract(g, p, wage, years, TUNING);
    const len = p.contract ? p.contract.expirySeason - g.season + 1 : years;
    get().showToast(`${p.name} re-signed on a ${len}-year deal.`);
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

  academyToggleLoan: (playerId) => {
    const g = get().game;
    if (!g) return;
    const err = toggleLoanList(g, playerId, TUNING);
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

  academyAddScout: (region, positions, archetypes = [], scoutId) => {
    const g = get().game;
    if (!g) return;
    const err = addScoutAssignment(g, region, positions, TUNING, archetypes, scoutId);
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
}));

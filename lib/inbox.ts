// Shared inbox helper. The academy, gameloop, transfers and contracts modules
// all file news the same way — one small function so the 120-item cap and id
// scheme live in exactly one place.

import type { GameState, InboxItem } from "./types";
import { uid } from "./rng";

/** Display metadata for an inbox item's category tag (v25). Every message shows
 * a short coloured label — Transfer, Deadline, Scouting, Academy … — so the
 * inbox reads at a glance. Pure data: the colour is a CSS variable/hex used by
 * the Home inbox chip, keyed by the item's `type`. */
export const INBOX_TAG_META: Record<InboxItem["type"], { label: string; color: string }> = {
  transfer: { label: "Transfer", color: "#6aa9ff" },
  offer: { label: "Transfer", color: "#6aa9ff" },
  window: { label: "Deadline", color: "#f2a94b" },
  scout: { label: "Scouting", color: "#7ad1a3" },
  academy: { label: "Academy", color: "#c9a2ff" },
  award: { label: "Award", color: "#e8c26a" },
  board: { label: "Board", color: "#9aa4b2" },
  match: { label: "Match", color: "#8fb0c4" },
  news: { label: "News", color: "#9aa4b2" },
};

export function pushInboxItem(
  state: GameState,
  type: InboxItem["type"],
  title: string,
  body: string,
  reportId?: string
) {
  state.inbox.unshift({
    id: uid("inb"),
    day: state.currentDay,
    season: state.season,
    type,
    title,
    body,
    read: false,
    reportId,
  });
  state.inbox = state.inbox.slice(0, 120);
}

/** Delete a single inbox item by id. Silently no-ops if it's already gone. */
export function deleteInboxItem(state: GameState, id: string) {
  state.inbox = state.inbox.filter((i) => i.id !== id);
}

/** Clear the whole inbox — the "delete all mail" action. */
export function clearInbox(state: GameState) {
  state.inbox = [];
}

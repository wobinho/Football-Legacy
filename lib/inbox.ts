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

// ── Grouping (v1.94) ──────────────────────────────────────────────────────
//
// The inbox used to be one flat list of up to 120 headlines, newest first. A
// busy week — a transfer window with the academy filing reports and the board
// writing letters — buried the one message that mattered under thirty that
// didn't, and the only tools were "read it" or "delete it one at a time".
//
// It is now a small fixed set of FOLDERS, and this is the rule that defines
// them. Two properties are what make it read as an organised mailbox rather
// than a list with headings:
//
//   1. The folders are PRE-DECLARED, not discovered from the mail. Every group
//      below exists in every save from day one, in this order, whether it holds
//      anything or not — so the shape of the screen doesn't move as mail
//      arrives, and "where do offers go" has one answer forever. A group that
//      appeared only when it had post would mean the layout reshuffled itself
//      every week, which is the thing being fixed.
//   2. A group is COLLAPSED until opened. The default view is therefore a
//      handful of rows with counts, not a wall of headlines — the manager opens
//      what they came for.
//
// Grouping by TYPE rather than by, say, week is deliberate: the type is already
// what `INBOX_TAG_META` colours and already what the manager is scanning for
// ("did anyone bid?"), and a date grouping just reproduces the flat list with
// extra steps. Several types share a folder where they answer the same question
// — an incoming offer and a completed transfer are both "the market" — which is
// why this is a table rather than one group per type.

export type InboxGroupId = "market" | "squad" | "recruitment" | "club";

export interface InboxGroupDef {
  id: InboxGroupId;
  label: string;
  /** The item types filed here. Every `InboxItem["type"]` appears in exactly
   * one group — `verify:inbox` asserts it, so a new type can't quietly become
   * mail with nowhere to go. */
  types: InboxItem["type"][];
  color: string;
  /** One line explaining what lands here, shown when the folder is empty. */
  blurb: string;
}

/** The folders, in the order the inbox lists them. Ordered by how often a
 * manager acts on them: the market is time-limited and the rest can wait. */
export const INBOX_GROUPS: InboxGroupDef[] = [
  {
    id: "market",
    label: "Transfers",
    types: ["offer", "transfer", "window"],
    color: "#6aa9ff",
    blurb: "Bids, completed deals and window deadlines.",
  },
  {
    id: "squad",
    label: "Matches & Awards",
    types: ["match", "award"],
    color: "#8fb0c4",
    blurb: "Results, milestones and end-of-season honours.",
  },
  {
    id: "recruitment",
    label: "Academy & Scouting",
    types: ["academy", "scout"],
    color: "#c9a2ff",
    blurb: "Youth intake, retraining programmes and scout reports.",
  },
  {
    id: "club",
    label: "Club & News",
    types: ["board", "news"],
    color: "#e8c26a",
    blurb: "Board letters, facility news and the wider world.",
  },
];

/** Which folder an item files into. Every type is mapped, so this never returns
 * undefined for a well-formed item; the fallback is the club folder, which is
 * the general-news one. */
export function inboxGroupOf(type: InboxItem["type"]): InboxGroupId {
  return INBOX_GROUPS.find((g) => g.types.includes(type))?.id ?? "club";
}

/** One folder, with its mail already selected and counted — the shape the Home
 * screen renders. Derived here rather than in the component for the usual
 * reason: the screen must not be the place that decides what "Transfers" means. */
export interface InboxGroup extends InboxGroupDef {
  items: InboxItem[];
  unread: number;
}

/**
 * The whole inbox, grouped.
 *
 * Every group is returned whether or not it holds mail (see the note above), so
 * the caller renders a stable set of folders and decides for itself how to draw
 * an empty one. Items keep the inbox's own newest-first order within a group —
 * `state.inbox` is maintained that way by `pushInboxItem`, and filtering
 * preserves it.
 *
 * `perGroupCap` bounds how many headlines one folder will render. The old flat
 * list capped at 30 across the whole inbox, which meant a busy transfer window
 * could push every academy report out of view entirely; a per-folder cap gives
 * each kind of mail its own room.
 */
export function groupedInbox(inbox: InboxItem[], perGroupCap = 40): InboxGroup[] {
  return INBOX_GROUPS.map((def) => {
    const items = inbox.filter((i) => def.types.includes(i.type));
    return {
      ...def,
      unread: items.filter((i) => !i.read).length,
      items: items.slice(0, perGroupCap),
    };
  });
}

/** Mark every item in one folder read — the per-group version of "mark all
 * read", which is the action a collapsed folder actually wants. */
export function markGroupRead(state: GameState, group: InboxGroupId) {
  for (const item of state.inbox) {
    if (inboxGroupOf(item.type) === group) item.read = true;
  }
}

/** Delete every item in one folder. The per-group "delete all": clearing the
 * academy's fifty read reports must not also throw away a live bid. */
export function clearInboxGroup(state: GameState, group: InboxGroupId) {
  state.inbox = state.inbox.filter((i) => inboxGroupOf(i.type) !== group);
}

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

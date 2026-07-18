// Shared inbox helper. The academy, gameloop, transfers and contracts modules
// all file news the same way — one small function so the 120-item cap and id
// scheme live in exactly one place.

import type { GameState, InboxItem } from "./types";
import { uid } from "./rng";

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

// Verifies the inbox grouping contract (v1.94).
//
// The inbox is a fixed set of FOLDERS rather than a flat list, and two
// properties are what make that an improvement rather than a rearrangement:
//
//   1. Every message type has exactly one home. A type nobody filed would be
//      mail that simply never appears on screen — the worst possible failure
//      here, and one no amount of clicking around would reliably reveal.
//   2. The folders are pre-declared and every one is always returned, empty or
//      not, so the shape of the screen doesn't move as post arrives.
//
// Neither is visible in the table by inspection once there are four groups and
// nine types, which is exactly why they're asserted.
//
// Run: npx tsx scripts/verify-inbox.ts

import {
  INBOX_GROUPS,
  INBOX_TAG_META,
  clearInboxGroup,
  groupedInbox,
  inboxGroupOf,
  markGroupRead,
  pushInboxItem,
} from "../lib/inbox";
import type { GameState, InboxItem } from "../lib/types";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Every type the schema allows, taken from the tag table rather than retyped —
// a hand-copied list here would pass while the real union grew past it.
const ALL_TYPES = Object.keys(INBOX_TAG_META) as InboxItem["type"][];

console.log("\nInbox groups");

check(`there is at least one group`, INBOX_GROUPS.length > 0);
check(
  "group ids are unique",
  new Set(INBOX_GROUPS.map((g) => g.id)).size === INBOX_GROUPS.length
);

// The invariant: a partition. Not "most types are covered" — exactly one home
// each, or a message goes missing (unfiled) or appears twice (double-filed).
{
  const filed = INBOX_GROUPS.flatMap((g) => g.types);
  const missing = ALL_TYPES.filter((t) => !filed.includes(t));
  check(
    `every message type is filed somewhere (${ALL_TYPES.length} types)`,
    missing.length === 0,
    `unfiled: ${missing.join(", ")}`
  );
  const duplicated = ALL_TYPES.filter((t) => filed.filter((f) => f === t).length > 1);
  check(
    "no message type is filed in two groups",
    duplicated.length === 0,
    `duplicated: ${duplicated.join(", ")}`
  );
  const unknown = filed.filter((t) => !ALL_TYPES.includes(t));
  check(
    "no group claims a type that doesn't exist",
    unknown.length === 0,
    `unknown: ${unknown.join(", ")}`
  );
  check(
    "inboxGroupOf agrees with the table for every type",
    ALL_TYPES.every((t) => INBOX_GROUPS.find((g) => g.id === inboxGroupOf(t))?.types.includes(t))
  );
}

// A folder that vanishes when empty makes the layout move under the cursor as
// mail arrives, which is the thing the rework exists to stop.
{
  const empty = groupedInbox([]);
  check(
    "an empty inbox still returns every folder",
    empty.length === INBOX_GROUPS.length,
    `got ${empty.length} of ${INBOX_GROUPS.length}`
  );
  check("...each holding nothing", empty.every((g) => g.items.length === 0 && g.unread === 0));
  check(
    "...in the declared order",
    empty.map((g) => g.id).join(",") === INBOX_GROUPS.map((g) => g.id).join(",")
  );
}

console.log("\nFiling real mail");

function makeState(): GameState {
  return { inbox: [], currentDay: 10, season: 1 } as unknown as GameState;
}

{
  // One message of every type, filed through the real push path.
  const state = makeState();
  for (const type of ALL_TYPES) {
    pushInboxItem(state, type, `A ${type} message`, `body of ${type}`);
  }
  const groups = groupedInbox(state.inbox);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  check(
    `every message lands in a folder (${ALL_TYPES.length} in, ${total} filed)`,
    total === ALL_TYPES.length,
    `${ALL_TYPES.length - total} went missing`
  );
  check(
    "every message is unread on arrival, and counted as such",
    groups.reduce((n, g) => n + g.unread, 0) === ALL_TYPES.length
  );

  // Newest-first ordering has to survive the filter, or the folders quietly
  // reorder the mail relative to the flat list they replaced.
  const anyMulti = groups.find((g) => g.items.length > 1);
  check(
    "mail stays newest-first inside a folder",
    !anyMulti || anyMulti.items.every((it, i) => i === 0 || it.day <= anyMulti.items[i - 1].day)
  );
}

{
  // Per-folder actions must touch their own folder and NOTHING else — the whole
  // reason they exist over the blunt whole-inbox versions.
  const state = makeState();
  for (const type of ALL_TYPES) pushInboxItem(state, type, `${type} msg`, "body");

  const target = INBOX_GROUPS[0];
  markGroupRead(state, target.id);
  const after = groupedInbox(state.inbox);
  check(
    `marking "${target.label}" read clears only its own unread count`,
    after.find((g) => g.id === target.id)!.unread === 0 &&
      after.filter((g) => g.id !== target.id).every((g) => g.unread === g.items.length)
  );

  const othersBefore = state.inbox.filter((i) => inboxGroupOf(i.type) !== target.id).length;
  clearInboxGroup(state, target.id);
  check(
    `clearing "${target.label}" deletes only its own mail`,
    state.inbox.every((i) => inboxGroupOf(i.type) !== target.id) &&
      state.inbox.length === othersBefore,
    `${state.inbox.length} left, expected ${othersBefore}`
  );
}

{
  // The per-folder cap gives each kind of mail its own room. The old flat list
  // capped at 30 across the whole inbox, so a busy transfer window could push
  // every academy report out of view — the failure this replaces.
  const state = makeState();
  const busy = INBOX_GROUPS[0].types[0];
  const quiet = INBOX_GROUPS[INBOX_GROUPS.length - 1].types[0];
  pushInboxItem(state, quiet, "the one that matters", "body");
  for (let i = 0; i < 100; i++) pushInboxItem(state, busy, `noise ${i}`, "body");

  const groups = groupedInbox(state.inbox);
  const quietGroup = groups.find((g) => g.types.includes(quiet))!;
  check(
    "a flood of one kind of mail never hides another kind",
    quietGroup.items.some((i) => i.title === "the one that matters"),
    "the quiet folder's message was pushed out"
  );
  const busyGroup = groups.find((g) => g.types.includes(busy))!;
  check(
    "...and a flooded folder is still capped",
    busyGroup.items.length <= 40,
    `${busyGroup.items.length} rendered`
  );
}

console.log();
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All inbox checks passed.");

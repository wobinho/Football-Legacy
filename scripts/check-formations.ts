// Structural check on the formation table: every shape must field eleven
// players, exactly one of them a keeper, with unique slot ids, labels that match
// their positions (the invariant formations.ts opens with) and on-pitch
// coordinates. Cheap enough to run after any edit to the table.

import { FORMATIONS, FORMATION_GROUPS, AI_FORMATIONS, getFormation } from "../lib/config/formations";
import { PHASE_WEIGHTS } from "../lib/config/positions";

let bad = 0;
const fail = (msg: string) => {
  console.log("  ✗", msg);
  bad++;
};

const ids = new Set<string>();
for (const f of FORMATIONS) {
  if (ids.has(f.id)) fail(`duplicate formation id "${f.id}"`);
  ids.add(f.id);
  if (f.slots.length !== 11) fail(`${f.id}: ${f.slots.length} slots, expected 11`);
  const slotIds = new Set(f.slots.map((s) => s.id));
  if (slotIds.size !== f.slots.length) fail(`${f.id}: duplicate slot ids`);
  const keepers = f.slots.filter((s) => s.pos === "GK").length;
  if (keepers !== 1) fail(`${f.id}: ${keepers} goalkeepers, expected 1`);
  if (!f.desc.trim()) fail(`${f.id}: no description`);
  for (const s of f.slots) {
    if (s.label !== s.pos) fail(`${f.id}/${s.id}: label "${s.label}" ≠ pos "${s.pos}"`);
    if (!PHASE_WEIGHTS[s.pos]) fail(`${f.id}/${s.id}: pos "${s.pos}" has no phase weights`);
    if (s.x < 0 || s.x > 100 || s.y < 0 || s.y > 100) fail(`${f.id}/${s.id}: (${s.x},${s.y}) off pitch`);
  }
  if (getFormation(f.id).id !== f.id) fail(`${f.id}: not resolvable by getFormation`);
}

// Every formation must appear in exactly one picker group, or it is unreachable
// from the UI.
const grouped = FORMATION_GROUPS.flatMap((g) => g.formations.map((f) => f.id));
if (grouped.length !== FORMATIONS.length) {
  fail(`groups cover ${grouped.length} formations, table has ${FORMATIONS.length}`);
}
for (const f of FORMATIONS) {
  if (!grouped.includes(f.id)) fail(`${f.id}: not in any picker group`);
}

console.log(
  `${FORMATIONS.length} formations · ${new Set(AI_FORMATIONS.map((f) => f.id)).size} AI-seedable · ${FORMATION_GROUPS.length} picker groups`
);
console.log(FORMATION_GROUPS.map((g) => `${g.name}${g.formations.length > 1 ? ` ×${g.formations.length}` : ""}`).join(", "));

// The share of AI clubs that will be seeded into each shape — the number that
// actually decides what a league looks like.
const share = new Map<string, number>();
for (const f of AI_FORMATIONS) share.set(f.name, (share.get(f.name) ?? 0) + 1);
console.log(
  "AI mix: " +
    [...share.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${((n / AI_FORMATIONS.length) * 100).toFixed(1)}%`)
      .join(", ")
);
console.log(bad === 0 ? "OK" : `${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);

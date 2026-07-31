// Structural check on the archetype table (§5) and its artwork.
//
// The 1:1 mappings are the whole design and all three of them are silent when
// they break: a archetype pointing at a missing plan is a build-time throw, but a
// archetype whose PNG is absent only shows up as a broken image in the browser,
// and an orphaned PNG is invisible entirely. `archetypeIconSrc` derives the path
// from the archetype's NAME, so a rename that nobody renames the file for is the
// exact failure this catches.
//
// Cheap enough to run after any edit to the roster or the icon folder.

import fs from "fs";
import path from "path";
import {
  ARCHETYPE_ROSTER,
  ARCHETYPE_BY_PLAN,
  ARCHETYPE_CLASS_ORDER,
  archetypeIconSrc,
  type ArchetypeClass,
} from "../lib/config/archetype";
import { TRAINING_PLAN_MAP } from "../lib/config/training";

let bad = 0;
const fail = (msg: string) => {
  console.log("  ✗", msg);
  bad++;
};

// ── The table itself ──────────────────────────────────────────────────────
const ids = new Set<string>();
const names = new Set<string>();
for (const p of ARCHETYPE_ROSTER) {
  if (ids.has(p.id)) fail(`duplicate archetype id "${p.id}"`);
  ids.add(p.id);
  if (names.has(p.name)) fail(`duplicate archetype name "${p.name}"`);
  names.add(p.name);
  if (!TRAINING_PLAN_MAP[p.planId]) fail(`${p.id}: unknown plan "${p.planId}"`);
  if (!p.desc.trim()) fail(`${p.id}: no description`);
  if (!ARCHETYPE_CLASS_ORDER.includes(p.cls)) fail(`${p.id}: unknown class "${p.cls}"`);
}

// 1:1 with the plan table — every plan must have exactly one archetype to aim at,
// or a manager can pick a training plan that trains him toward nothing.
for (const planId of Object.keys(TRAINING_PLAN_MAP)) {
  if (!ARCHETYPE_BY_PLAN[planId]) fail(`training plan "${planId}" has no archetype`);
}
if (ARCHETYPE_ROSTER.length !== Object.keys(TRAINING_PLAN_MAP).length) {
  fail(`${ARCHETYPE_ROSTER.length} archetypes vs ${Object.keys(TRAINING_PLAN_MAP).length} plans — must be 1:1`);
}

// ── The artwork ───────────────────────────────────────────────────────────
const iconDir = path.join(process.cwd(), "public", "archetype_icons");
const files = fs.existsSync(iconDir) ? fs.readdirSync(iconDir).filter((f) => f.endsWith(".png")) : [];
if (files.length === 0) fail(`no icons found in public/archetype_icons`);

// Decoded back to a filename: `archetypeIconSrc` percent-encodes for the URL, but
// what's on disk is the literal name.
const iconFile = (p: (typeof ARCHETYPE_ROSTER)[number]) =>
  decodeURIComponent(path.basename(archetypeIconSrc(p)));

const present = new Set(files);
for (const p of ARCHETYPE_ROSTER) {
  // Check the file the UI will actually request, not a re-derived guess.
  const wanted = iconFile(p);
  if (!present.has(wanted)) fail(`${p.name} (${p.planId}): missing artwork ${wanted}`);
}
const wantedAll = new Set(ARCHETYPE_ROSTER.map(iconFile));
for (const f of files) {
  if (!wantedAll.has(f)) fail(`orphaned icon "${f}" — no archetype is named for it`);
}

// ── Report ────────────────────────────────────────────────────────────────
const counts = {} as Record<ArchetypeClass, number>;
for (const c of ARCHETYPE_CLASS_ORDER) counts[c] = 0;
for (const p of ARCHETYPE_ROSTER) counts[p.cls]++;

console.log(`${ARCHETYPE_ROSTER.length} archetypes · ${files.length} icons · ${ARCHETYPE_CLASS_ORDER.length} classes`);
console.log("class split: " + ARCHETYPE_CLASS_ORDER.map((c) => `${c} ${counts[c]}`).join(", "));
console.log(bad === 0 ? "OK" : `${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);

// Permanent edits to SHIPPED clubs (v2.0) — the rules `applyClubOverrides`
// enforces, driven against a real shipped country database.
//   npm run verify:overrides
//
// The feature's whole promise is "edit Real Madrid once, and Real Madrid looks
// like that in every legacy you start". That promise has exactly three ways to
// break, and this asserts all three:
//
//   1. The patch doesn't reach the club (the edit silently does nothing).
//   2. The patch reaches too much — it overwrites fields it was never given,
//      which would freeze a club's squad or reputation at whatever the database
//      said the day it was edited.
//   3. A save with NO overrides computes something different from what it
//      always did. This is the one that matters most: the override pass runs on
//      every database resolution for every included country at setup, so an
//      untouched library must come out byte-identical.
//
// It also covers the trap that the whole design rests on: an override is keyed
// by the SHIPPED name, so renaming a club must not stop it matching itself.

import { defaultCountryDB, type CountryDatabase } from "../lib/database";
import { applyClubOverrides, overrideKey, type ClubOverride } from "../lib/customdb";
import { badgeFor } from "../lib/visual/badge";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// A shipped database with real clubs in it. ENG is the one every build has.
const base = defaultCountryDB("ENG");
if (!base) {
  console.error("!! no shipped ENG database — cannot verify overrides");
  process.exit(1);
}
const firstDiv = [...base.divisions].sort((a, b) => a.tier - b.tier)[0];
const target = firstDiv.clubs[0];
console.log(`Shipped club under test: ${target.name} (${target.short}), rep ${target.rep}\n`);

const clone = (db: CountryDatabase): CountryDatabase => structuredClone(db);

// ── 1. No overrides changes NOTHING ────────────────────────────────────────
console.log("── An empty library computes exactly what it always did");
{
  const before = JSON.stringify(base);
  const out = applyClubOverrides(clone(base), "ENG", []);
  check("a database with no overrides is byte-identical", JSON.stringify(out) === before);
}

// ── 2. A patch reaches its club, and ONLY the fields it names ──────────────
console.log("\n── A patch applies, and applies narrowly");
{
  const o: ClubOverride = {
    country: "ENG",
    clubName: target.name,
    short: "ZZZ",
    updatedAt: Date.now(),
  };
  const out = applyClubOverrides(clone(base), "ENG", [o]);
  const patched = [...out.divisions].sort((a, b) => a.tier - b.tier)[0].clubs[0];

  check("the named field is changed", patched.short === "ZZZ", `short=${patched.short}`);
  check("the name it did NOT name is untouched", patched.name === target.name);
  check("reputation is untouched", patched.rep === target.rep);
  check("the stadium is untouched", patched.stadium === target.stadium);
  check(
    "colours are untouched",
    patched.colors[0] === target.colors[0] && patched.colors[1] === target.colors[1]
  );
  // The point of a PATCH rather than a stored copy: a club's squad has to keep
  // following the shipped database, so a rebuilt default reaches it.
  check(
    "the authored squad is untouched",
    JSON.stringify(patched.players ?? null) === JSON.stringify(target.players ?? null)
  );
  // And no OTHER club moved.
  const others = out.divisions.flatMap((d) => d.clubs).filter((c) => c.name !== target.name);
  const origOthers = base.divisions.flatMap((d) => d.clubs).filter((c) => c.name !== target.name);
  check("no other club in the country moved", JSON.stringify(others) === JSON.stringify(origOthers));
}

// ── 3. A renamed club still matches its own override ───────────────────────
console.log("\n── An override keyed on the SHIPPED name survives a rename");
{
  const o: ClubOverride = {
    country: "ENG",
    clubName: target.name,
    name: "Renamed FC",
    updatedAt: Date.now(),
  };
  const once = applyClubOverrides(clone(base), "ENG", [o]);
  const renamed = [...once.divisions].sort((a, b) => a.tier - b.tier)[0].clubs[0];
  check("the rename applies", renamed.name === "Renamed FC");
  // Applying to a FRESH shipped database again must give the same answer — this
  // is what happens on every new legacy, and it is why the key is the shipped
  // name rather than the current one.
  const twice = applyClubOverrides(clone(base), "ENG", [o]);
  check(
    "re-applying to a fresh database is identical",
    JSON.stringify(twice) === JSON.stringify(once)
  );
}

// ── 4. The crest actually changes what the game draws ──────────────────────
console.log("\n── An authored crest reaches badgeFor, and clearing it goes back to derived");
{
  const derived = badgeFor(target);
  const authored = { ...derived, ground: "#ff00ff", patColor: "#00ff00" };
  const o: ClubOverride = {
    country: "ENG",
    clubName: target.name,
    badge: authored,
    updatedAt: Date.now(),
  };
  const out = applyClubOverrides(clone(base), "ENG", [o]);
  const patched = [...out.divisions].sort((a, b) => a.tier - b.tier)[0].clubs[0];
  check("the club now carries the authored spec", patched.badge?.ground === "#ff00ff");
  check("badgeFor returns the authored crest", badgeFor(patched).ground === "#ff00ff");

  // Removing the override — which is what the editor's Reset does — must put
  // the club back to a DERIVED crest, not to a frozen copy of one (v1.96).
  const cleared = applyClubOverrides(clone(base), "ENG", []);
  const back = [...cleared.divisions].sort((a, b) => a.tier - b.tier)[0].clubs[0];
  check("clearing leaves no stored spec at all", back.badge === undefined);
  check("and the derived crest is what it always was", badgeFor(back).ground === derived.ground);
}

// ── 5. An override for another country is ignored ──────────────────────────
console.log("\n── An override never leaks across countries");
{
  const o: ClubOverride = {
    country: "ESP",
    clubName: target.name, // same name, different country
    short: "XXX",
    updatedAt: Date.now(),
  };
  const out = applyClubOverrides(clone(base), "ENG", [o]);
  check(
    "a Spanish override does not touch the English club",
    JSON.stringify(out) === JSON.stringify(base)
  );
  check("and the keys genuinely differ", overrideKey("ENG", target.name) !== overrideKey("ESP", target.name));
}

console.log(
  failures === 0
    ? "\nPASS — permanent club edits apply narrowly, survive a rename, and cost an untouched library nothing."
    : `\nFAIL — ${failures} check${failures === 1 ? "" : "s"} failed.`
);
process.exit(failures === 0 ? 0 : 1);

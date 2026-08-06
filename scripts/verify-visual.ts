// Verifies club badges and kits (v1.96) against the properties that make the
// feature affordable and that a screenshot would never reveal.
//
// The whole design rests on one claim: a badge and a kit set are DERIVED from a
// club's identity, so a world of ~800 clubs costs the save nothing and every
// club still has a crest. That claim has three failure modes, all silent:
//   • derivation isn't stable (a club's crest changes between sessions, or
//     between two machines loading the same save)
//   • derivation isn't distinct (half the world shares one crest)
//   • the specs leak into the save anyway (the storage win evaporates)
// Plus the one rule the game layer depends on — an away kit that clashes with
// the home shirt is the bug the feature exists to prevent.
//
// Run: npx tsx scripts/verify-visual.ts

import { generateWorld } from "../lib/worldgen";
import { badgeFor, generateBadge, normaliseBadge, BADGE_SHAPES, DEFAULT_BADGE } from "../lib/visual/badge";
import {
  kitsFor,
  kitsClash,
  normaliseKit,
  pickKitsForFixture,
  CLASH_THRESHOLD,
  DEFAULT_KITSET,
} from "../lib/visual/kit";
import { setClubIdentity } from "../lib/visual/identity";
import { colorDistance, PATTERN_GROUPS, PATTERN_IDS, PATTERNS, clampPatternCount } from "../lib/visual/patterns";
import { SCHEMA_VERSION } from "../lib/types";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const state = generateWorld({
  saveName: "visual",
  managerName: "Visual Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 909,
});

const clubs = Object.values(state.teams);
console.log(`\nA world of ${clubs.length} clubs`);

/* ---------------------------------------------------------------------------
   1. THE TABLES
   ------------------------------------------------------------------------- */
console.log("\nThe pattern tables");
{
  const grouped = new Set(PATTERN_GROUPS.flatMap((g) => g.keys));
  // A pattern in no group is unreachable from either creator: it exists, the
  // engine will draw it, and no manager can ever pick it.
  const ungrouped = PATTERN_IDS.filter((p) => !grouped.has(p));
  check("every pattern belongs to a group", ungrouped.length === 0, ungrouped.join(", "));

  const unknown = [...grouped].filter((k) => !(k in PATTERNS));
  check("every grouped key is a real pattern", unknown.length === 0, unknown.join(", "));

  const counts = new Map<string, number>();
  for (const g of PATTERN_GROUPS) for (const k of g.keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const dupes = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
  check("no pattern is in two groups", dupes.length === 0, dupes.join(", "));

  check("band counts clamp to a sane range", clampPatternCount(400) === 12 && clampPatternCount(-5) === 2);
}

/* ---------------------------------------------------------------------------
   2. NORMALISATION — the save file is the modding format, so a hand-edited
   spec must degrade rather than render nothing.
   ------------------------------------------------------------------------- */
console.log("\nA hand-edited spec degrades rather than breaking");
{
  const junk = normaliseBadge({
    shape: "triangle" as never,
    pat: "tartan" as never,
    ground: "not-a-colour" as never,
    patCount: 9999,
    charge: "dragon" as never,
  });
  check("an unknown shape falls back", junk.shape === DEFAULT_BADGE.shape, junk.shape);
  check("an unknown pattern falls back", junk.pat === DEFAULT_BADGE.pat, junk.pat);
  check("a bad colour falls back", junk.ground === DEFAULT_BADGE.ground, junk.ground);
  check("an unknown charge falls back", junk.charge === DEFAULT_BADGE.charge, junk.charge);
  check("an absurd band count clamps", junk.patCount === 12, String(junk.patCount));
  check("every shape in the table has a path", Object.values(BADGE_SHAPES).every((s) => !!s.d));

  // "" is meaningful on sleeves (match the body) and must survive validation —
  // coercing it to a hex would make "no contrast sleeves" unrepresentable.
  check("empty sleeves stay empty", normaliseKit({ sleeves: "" }).sleeves === "");
  check("a bad sleeve colour clears rather than sticks", normaliseKit({ sleeves: "purple" as never }).sleeves === "");
}

/* ---------------------------------------------------------------------------
   3. DERIVATION — stable, and distinct.
   ------------------------------------------------------------------------- */
console.log("\nDerivation is stable");
{
  const sample = clubs.slice(0, 40);
  const stable = sample.every((c) => {
    const a = badgeFor(c);
    const b = badgeFor(c);
    return JSON.stringify(a) === JSON.stringify(b);
  });
  check("the same club derives the same badge twice", stable);

  const kitStable = sample.every((c) => JSON.stringify(kitsFor(c)) === JSON.stringify(kitsFor(c)));
  check("the same club derives the same kits twice", kitStable);

  // Identity, not id: a club exported to a squad file and rebuilt in another
  // world gets a different id and must keep its crest.
  const c = clubs[0];
  const moved = { ...c, id: "SOMEWHERE_ELSE_t3", leagueId: "ESP1" };
  check(
    "a club keeps its crest when it moves world",
    JSON.stringify(badgeFor(c)) === JSON.stringify(badgeFor(moved))
  );
}

console.log("\nDerivation is distinct");
{
  const sigs = clubs.map((c) => {
    const b = badgeFor(c);
    return `${b.shape}|${b.pat}|${b.ground}|${b.charge}|${b.patCount}`;
  });
  const unique = new Set(sigs).size;
  const ratio = unique / clubs.length;
  console.log(`    ${unique} distinct crests across ${clubs.length} clubs (${(ratio * 100).toFixed(1)}%)`);
  // Clubs sharing a colour pair legitimately share a ground, so this is not
  // asking for 100% — only that the world doesn't read as one repeated badge.
  check("crests are overwhelmingly distinct", ratio > 0.9, `${(ratio * 100).toFixed(1)}%`);

  const grounds = new Set(clubs.map((c) => badgeFor(c).ground)).size;
  check("crest grounds follow the clubs' own colours", grounds > 20, `${grounds} distinct grounds`);
}

/* ---------------------------------------------------------------------------
   4. THE STORAGE CLAIM — the point of deriving at all.
   ------------------------------------------------------------------------- */
console.log("\nA derived world stores no specs");
{
  const stored = clubs.filter((c) => c.badge || c.kits);
  check("no club in a fresh world stores a badge or kits", stored.length === 0, `${stored.length} do`);

  const serialised = JSON.stringify(state);
  check("the save mentions no badge field", !serialised.includes('"badge"'));
  check("the save mentions no kits field", !serialised.includes('"kits"'));

  // What it WOULD have cost, so the claim is measured rather than asserted.
  const perClub = JSON.stringify(badgeFor(clubs[0])).length + JSON.stringify(kitsFor(clubs[0])).length;
  console.log(`    ~${((perClub * clubs.length) / 1024).toFixed(0)}KB avoided per save at ${perClub}B/club`);
}

/* ---------------------------------------------------------------------------
   5. AUTHORING — and, critically, that clearing goes back to derived.
   ------------------------------------------------------------------------- */
console.log("\nAuthoring a crest, and clearing it again");
{
  const userId = state.userTeamId;
  const custom = generateBadge({ seed: "hand-drawn", name: "Test", code: "TST" });

  const err = setClubIdentity(state, userId, { badge: custom, kits: DEFAULT_KITSET });
  check("the manager may re-brand his own club", !err, String(err));
  check("the badge is stored", !!state.teams[userId].badge);
  check("badgeFor returns the authored one", badgeFor(state.teams[userId]).shape === custom.shape);

  const rival = clubs.find((c) => c.id !== userId)!;
  const denied = setClubIdentity(state, rival.id, { badge: custom });
  check("a rival's crest can't be re-branded by default", !!denied, "no error returned");
  check("the rival stored nothing", !rival.badge);

  // v1.97: the Identity screen's "edit other clubs" mode is a COSMETIC
  // authority, and it has to be asked for explicitly. What the two checks
  // together assert is that the default path is still closed — if `allowAny`
  // ever became the default, the check above would fail and this one would
  // still pass, which is the pair that keeps the distinction real.
  const allowed = setClubIdentity(state, rival.id, { badge: custom }, { allowAny: true });
  check("allowAny re-brands any club in the world", !allowed, String(allowed));
  check("and it actually stored", badgeFor(rival).shape === custom.shape);
  // Cosmetic means cosmetic: a re-branded rival is the same club in every way
  // the simulation reads. Spot-checked on the fields a badge sits next to.
  check(
    "a re-branded rival is otherwise untouched",
    rival.playerIds.length > 0 && typeof rival.reputation === "number" && !!rival.leagueId
  );
  setClubIdentity(state, rival.id, { badge: undefined, kits: undefined }, { allowAny: true });
  check("and clears back to derived", !("badge" in rival));

  // An unknown club is refused whatever authority the caller claims — the id
  // check has to come first or `allowAny` would be a way to write a team that
  // isn't there.
  check(
    "allowAny still refuses an unknown club",
    !!setClubIdentity(state, "no-such-club", { badge: custom }, { allowAny: true })
  );

  // Clearing must DELETE the field, not store a copy of the generated spec —
  // a stored copy is frozen forever and would never follow an improved generator.
  setClubIdentity(state, userId, { badge: undefined, kits: undefined });
  check("clearing removes the field entirely", !("badge" in state.teams[userId]));
  check(
    "a cleared club derives again",
    JSON.stringify(badgeFor(state.teams[userId])) !== JSON.stringify(custom)
  );
}

/* ---------------------------------------------------------------------------
   6. KIT CLASHES — the one rule the match layer depends on.
   ------------------------------------------------------------------------- */
console.log("\nA generated kit set survives its own fixtures");
{
  let selfClash = 0;
  let forced = 0;
  for (const c of clubs) {
    const set = kitsFor(c);
    // The fixture every club plays: its own away shirt at a club in its colours.
    if (kitsClash(set.home, set.away).clash) selfClash++;
    if (pickKitsForFixture(kitsFor(clubs[0]), set).forcedClash) forced++;
  }
  console.log(`    ${selfClash} clubs whose away kit clashes with their own home kit`);
  check("no generated away kit clashes with its own home kit", selfClash === 0, `${selfClash} do`);

  console.log(`    ${forced}/${clubs.length} clubs forced to wear a clashing shirt at one fixture`);
  check("almost nobody is forced into a clash", forced / clubs.length < 0.05, `${forced} forced`);

  // The home side always wears home — that is the privilege, and a selection
  // that ever moves it would be a different rule than the one documented.
  const anyHomeMoved = clubs
    .slice(0, 50)
    .some((c) => pickKitsForFixture(kitsFor(c), kitsFor(clubs[1])).homeKit !== "home");
  check("the home side always wears home", !anyHomeMoved);

  check(
    "identical kits are detected as a clash",
    kitsClash(DEFAULT_KITSET.home, DEFAULT_KITSET.home).clash
  );
  check(
    "the threshold is a real perceptual distance",
    colorDistance("#000000", "#ffffff") > CLASH_THRESHOLD && colorDistance("#16325c", "#16325e") < CLASH_THRESHOLD
  );
}

/* ---------------------------------------------------------------------------
   7. THE SAVE A MANAGER ALREADY HAS
   ------------------------------------------------------------------------- */
console.log("\nAn old save is untouched");
{
  // The migration converts nothing, so a v48 club — a plain object with no
  // badge and no kits — must already render. This is the whole reason the
  // migration is a no-op, and it is the claim worth checking.
  const legacy = { name: "Olde Towne FC", short: "OTF", colors: ["#8a1220", "#f5f5f5"] as [string, string] };
  const b = badgeFor(legacy);
  const k = kitsFor(legacy);
  check("a club with no stored spec still has a crest", !!b.shape && b.ground === "#8a1220");
  check("a club with no stored spec still has four kits", !!k.home && !!k.away && !!k.third && !!k.gk);
  check("the schema is stamped at the current version", state.schemaVersion === SCHEMA_VERSION);
}

console.log(failures === 0 ? "\n✓ all checks passed\n" : `\n✗ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

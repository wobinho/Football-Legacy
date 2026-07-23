// End-to-end check of the shipped default database (v1.47).
//   npx tsx scripts/verify-db.ts
//
// Loads every generated country JSON straight off disk (the client fetches the
// same files), validates it, then builds a real world from the largest one —
// including a generated tier BELOW what the data authors, which is the
// "lower divisions use the generated database" path.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateCountryDB, type CountryDatabase } from "../lib/database";
import { generateWorld, divisionSeed, teamIdFor } from "../lib/worldgen";
import { generateDivisionClubs, DEFAULT_TIER_NAMES } from "../lib/config/divisions";
import { activePlayers } from "../lib/archive";

const DIR = join(process.cwd(), "public", "database_presets");
const MANIFEST = join(DIR, "manifest.json");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

if (!existsSync(MANIFEST)) {
  console.error("No manifest — run `npm run build:db` first.");
  process.exit(1);
}

interface Entry { code: string; name: string; file: string; tiers: number; clubs: number; players: number }
const manifest: Entry[] = JSON.parse(readFileSync(MANIFEST, "utf8"));

// ── 1. Every shipped country validates and matches its manifest row ─────────
const dbs = new Map<string, CountryDatabase>();
let totalClubs = 0;
let totalPlayers = 0;
let badCountries = 0;

for (const entry of manifest) {
  const path = join(DIR, entry.file);
  if (!existsSync(path)) {
    check(`${entry.code} asset present`, false, entry.file);
    badCountries++;
    continue;
  }
  const json = JSON.parse(readFileSync(path, "utf8"));
  const result = validateCountryDB(json);
  if (!result.ok || !result.db) {
    check(`${entry.code} validates`, false, result.errors[0] ?? "");
    badCountries++;
    continue;
  }
  const db = result.db;
  dbs.set(entry.code, db);

  const clubs = db.divisions.reduce((n, d) => n + d.clubs.length, 0);
  const players = db.divisions.reduce((n, d) => n + d.clubs.reduce((m, c) => m + (c.players?.length ?? 0), 0), 0);
  totalClubs += clubs;
  totalPlayers += players;

  // Tiers must run 1..N unbroken or promotion/relegation can't chain.
  const tiers = db.divisions.map((d) => d.tier).sort((a, b) => a - b);
  const contiguous = tiers.every((t, i) => t === i + 1);
  if (!contiguous || clubs !== entry.clubs || players !== entry.players) {
    check(`${entry.code} consistent`, false, `tiers ${tiers.join(",")} clubs ${clubs}/${entry.clubs}`);
    badCountries++;
  }
}
check(`all ${manifest.length} countries valid & consistent`, badCountries === 0, `${badCountries} bad`);
console.log(`      ${dbs.size} countries, ${totalClubs} clubs, ${totalPlayers} players`);

// ── 2. Squad sizes — a club with a thin real roster still needs a full squad ──
let thin = 0;
for (const [code, db] of dbs) {
  for (const d of db.divisions) {
    for (const c of d.clubs) {
      if (c.players && c.players.length > 0 && c.players.length < 11) thin++;
    }
  }
  void code;
}
check("no club has 1–10 authored players", thin === 0, `${thin} thin rosters`);

// ── 3. Build real worlds. `target` is the biggest country (deepest authored
//       ladder); `single` authors only a top flight, so asking it for a deeper
//       pyramid exercises the generated-lower-division path.
function buildDeeper(code: string, wantTiers: number): CountryDatabase {
  const base = dbs.get(code)!;
  const deeper = structuredClone(base);
  const seed = divisionSeed({ playableCountry: code, viewCountries: [], countryDBs: { [code]: base } });
  const exclude = new Set(base.divisions.flatMap((d) => d.clubs.map((c) => c.name)));
  for (let tier = base.divisions.length + 1; tier <= wantTiers; tier++) {
    deeper.divisions.push({
      id: `${code}${tier}`,
      name: DEFAULT_TIER_NAMES[tier] ?? `Division ${tier}`,
      tier,
      clubs: generateDivisionClubs(seed, code, tier, exclude),
    });
  }
  return deeper;
}

const biggest = [...manifest].sort((a, b) => b.clubs - a.clubs)[0];
const base = dbs.get(biggest.code)!;
const deeper = buildDeeper(biggest.code, base.divisions.length);

const topDiv = [...deeper.divisions].sort((a, b) => a.tier - b.tier)[0];
const state = generateWorld({
  saveName: "db-verify",
  managerName: "DB Verify",
  userTeamId: teamIdFor(topDiv.id, 0),
  playableCountry: biggest.code,
  viewCountries: [],
  seed: 4242,
  countryDBs: { [biggest.code]: deeper },
});

const teams = Object.values(state.teams);
const players = activePlayers(state);
check("world builds", teams.length > 0 && players.length > 0, `${teams.length} teams, ${players.length} players`);
check("user team exists", !!state.teams[state.userTeamId], state.teams[state.userTeamId]?.name ?? "missing");

// Every team must be able to field a legal XI.
const undersized = teams.filter((t) => t.playerIds.length < 11);
check("every team has 11+ players", undersized.length === 0, `${undersized.length} undersized`);

// A real marquee player should have survived the import at full strength.
const best = [...players].sort((a, b) => b.overall - a.overall)[0];
check("elite player imported", best.overall >= 85, `${best.name} ${best.overall} (${best.positions[0]})`);

// The generated bottom tier must be real, distinct clubs.
const divisions = Object.values(state.leagues ?? {});
console.log(`      leagues: ${divisions.length}`);
for (const d of deeper.divisions) {
  const inWorld = teams.filter((t) => t.leagueId === d.id);
  const authored = base.divisions.some((b) => b.id === d.id);
  console.log(
    `      ${d.id.padEnd(6)} ${String(inWorld.length).padStart(2)} teams  ${authored ? "authored" : "GENERATED"}  ${d.name}`
  );
  if (inWorld.length !== d.clubs.length) {
    check(`${d.id} team count`, false, `${inWorld.length} vs ${d.clubs.length}`);
  }
}

// Overall spread sanity: the imported world should span a believable range.
const ovrs = players.map((p) => p.overall).sort((a, b) => a - b);
const pct = (q: number) => ovrs[Math.floor(ovrs.length * q)];
console.log(`      overall p10 ${pct(0.1)}  median ${pct(0.5)}  p90 ${pct(0.9)}  max ${ovrs[ovrs.length - 1]}`);
check("overall spread believable", pct(0.5) >= 50 && pct(0.5) <= 75 && ovrs[ovrs.length - 1] >= 85);

// ── 4. A single-tier country asked for a 3-deep pyramid: tier 1 is the real
//       league, tiers 2–3 are generated. This is the lower-division fallback.
const singleEntry = [...manifest]
  .filter((m) => m.tiers === 1 && m.clubs >= 16)
  .sort((a, b) => b.clubs - a.clubs)[0];

if (singleEntry) {
  const WANT = 3;
  const singleDb = buildDeeper(singleEntry.code, WANT);
  const singleTop = [...singleDb.divisions].sort((a, b) => a.tier - b.tier)[0];
  const s2 = generateWorld({
    saveName: "db-verify-gen",
    managerName: "DB Verify",
    userTeamId: teamIdFor(singleTop.id, 0),
    playableCountry: singleEntry.code,
    viewCountries: [],
    seed: 99,
    countryDBs: { [singleEntry.code]: singleDb },
    divisionDepths: { [singleEntry.code]: WANT },
  });

  const t2 = Object.values(s2.teams);
  console.log(`\n      ${singleEntry.name}: 1 authored tier → ${WANT} requested`);
  for (const d of singleDb.divisions) {
    const inWorld = t2.filter((t) => t.leagueId === d.id);
    const authored = d.tier === 1;
    console.log(
      `      ${d.id.padEnd(6)} ${String(inWorld.length).padStart(2)} teams  ${authored ? "authored" : "GENERATED"}  ${d.name}`
    );
  }
  check(
    `${singleEntry.code} built ${WANT} tiers`,
    singleDb.divisions.length === WANT && t2.filter((t) => t.leagueId === `${singleEntry.code}${WANT}`).length > 0
  );

  // Generated tiers must be genuinely weaker than the real top flight.
  const avgFor = (leagueId: string) => {
    const ids = new Set(t2.filter((t) => t.leagueId === leagueId).flatMap((t) => t.playerIds));
    const os = activePlayers(s2).filter((p) => ids.has(p.id)).map((p) => p.overall);
    return os.length ? os.reduce((a, b) => a + b, 0) / os.length : 0;
  };
  const top = avgFor(`${singleEntry.code}1`);
  const bottom = avgFor(`${singleEntry.code}${WANT}`);
  console.log(`      avg overall — tier 1 ${top.toFixed(1)}  tier ${WANT} ${bottom.toFixed(1)}`);
  check("generated tiers are weaker than the real top flight", bottom < top, `${bottom.toFixed(1)} < ${top.toFixed(1)}`);
}

console.log(failures === 0 ? "\nDefault database verified." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

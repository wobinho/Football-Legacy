// ── Build the default (FC 26) database ────────────────────────────────────
//
//   npx tsx scripts/build-fl26.ts
//
// Reads the three authoring CSVs at the repo root and writes one country-db
// JSON per country into /public/database_presets, plus a manifest the client
// registry (lib/config/presets.ts) reads to populate the country picker.
//
// The output is the SAME `fl-country-db@2` shape the game already loads, so the
// conversion is a build-time step only — nothing at runtime parses a CSV.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../lib/fl26/csv";
import {
  buildCountryDatabases,
  natFor,
  parsePositions,
  readClubs,
  readLeagues,
  type Fl26Club,
} from "../lib/fl26/convert";
import { overallFromAttrs } from "../lib/config/positions";
import { generateDivisionClubs } from "../lib/config/divisions";
import { validateCountryDB } from "../lib/database";
import type { CountryDatabase, PlayerSeed } from "../lib/database";
import type { Attributes } from "../lib/types";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public", "database_presets");
const MANIFEST = join(OUT_DIR, "manifest.json");

function read(file: string) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    console.error(`Missing source file: ${file}`);
    process.exit(1);
  }
  return parseCsv(readFileSync(path, "utf8"));
}

const leagueRows = read("fl26-leagues.csv");
const clubRows = read("fl26-clubs.csv");
const playerRows = read("fl26-players.csv");

const leagues = readLeagues(leagueRows);
const clubs = readClubs(clubRows);
const clubById = new Map<string, Fl26Club>(clubs.map((c) => [c.clubId, c]));

// ── Players → seeds ────────────────────────────────────────────────────────
// The six CSV columns are already the derived stats the overall formula wants,
// stored to 2dp. They are kept fractional here: the formula is more accurate on
// unrounded inputs (OVERALL_FORMULA.md, "Implementation notes"), and the engine
// treats attrs as plain numbers throughout.

const rostersByClub = new Map<string, PlayerSeed[]>();
const overallsByClub = new Map<string, number[]>();
let skipped = 0;
let freeAgents = 0;

for (const row of playerRows) {
  const clubId = row.club_id;
  if (!clubId) {
    // Free agents in the source have no club to attach to; worldgen builds its
    // own free-agent pool, so they are simply not imported.
    freeAgents++;
    continue;
  }
  const club = clubById.get(clubId);
  if (!club) {
    skipped++;
    continue;
  }

  const positions = parsePositions(row.position, row.secondary_positions ?? "");
  const attrs: Attributes = {
    pac: Number(row.pace),
    sho: Number(row.shooting),
    pas: Number(row.passing),
    dri: Number(row.dribbling),
    def: Number(row.defending),
    phy: Number(row.physicality),
  };
  if (Object.values(attrs).some((v) => !Number.isFinite(v))) {
    skipped++;
    continue;
  }

  const overall = overallFromAttrs(attrs, positions[0]);
  const age = Number(row.age);
  const potential = Number(row.potential);

  const seed: PlayerSeed = {
    name: row.name || row.full_name || "Unknown Player",
    positions,
    attrs,
    age: Number.isFinite(age) ? Math.max(15, Math.min(40, Math.round(age))) : undefined,
    nationality: natFor(row.nationality, natFor(club.country, "XXX")),
    // The engine caps potential at 96 and never lets it sit below overall.
    potential: Number.isFinite(potential) ? Math.max(overall, Math.min(96, Math.round(potential))) : undefined,
  };
  // Drop undefined keys so the emitted JSON stays clean.
  if (seed.age === undefined) delete seed.age;
  if (seed.potential === undefined) delete seed.potential;

  if (!rostersByClub.has(clubId)) rostersByClub.set(clubId, []);
  rostersByClub.get(clubId)!.push(seed);
  if (!overallsByClub.has(clubId)) overallsByClub.set(clubId, []);
  overallsByClub.get(clubId)!.push(overall);
}

// ── Assemble + validate ────────────────────────────────────────────────────

// A country the source only partially covers gets its top flight topped up to a
// legal size with procedurally-named clubs — the same generator that builds a
// country's missing lower tiers, so the filler is indistinguishable from a
// generated division and stays stable across rebuilds (fixed seed).
const PAD_SEED = 0x5f26;
const padDivision = (nat: string, tier: number, count: number, exclude: Set<string>) =>
  generateDivisionClubs(PAD_SEED, nat, tier, exclude, count).map((c) => ({ ...c }));

const databases = buildCountryDatabases({ leagues, clubs, rostersByClub, overallsByClub, padDivision });

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// Countries the FC 26 source doesn't cover at all (no clubs in fl26-clubs.csv)
// keep whichever hand-authored database already shipped for them, so a rebuild
// never makes a previously-playable country unselectable. Any country the source
// DOES cover is regenerated from it and its stale asset is cleared first.
const builtCodes = new Set(databases.map((d) => d.code));
const preserved: string[] = [];
for (const f of readdirSync(OUT_DIR)) {
  if (f === "manifest.json") {
    unlinkSync(join(OUT_DIR, f));
    continue;
  }
  if (!f.endsWith("-country-db.json")) continue;
  const code = f.replace("-country-db.json", "");
  if (builtCodes.has(code)) unlinkSync(join(OUT_DIR, f));
  else preserved.push(code);
}

interface ManifestEntry {
  code: string;
  name: string;
  file: string;
  blurb: string;
  tiers: number;
  clubs: number;
  players: number;
}

const manifest: ManifestEntry[] = [];
const paddedCountries: string[] = [];
let invalid = 0;

for (const db of databases) {
  const result = validateCountryDB(db);
  if (!result.ok) {
    console.error(`✗ ${db.name} (${db.code}) failed validation:`);
    for (const e of result.errors.slice(0, 5)) console.error(`    ${e}`);
    invalid++;
    continue;
  }

  const file = `${db.code}-country-db.json`;
  writeFileSync(join(OUT_DIR, file), JSON.stringify(db), "utf8");

  const clubCount = db.divisions.reduce((n, d) => n + d.clubs.length, 0);
  const playerCount = db.divisions.reduce(
    (n, d) => n + d.clubs.reduce((m, c) => m + (c.players?.length ?? 0), 0),
    0
  );
  // A padded club carries no authored roster — that's how the filler reads.
  const padded = db.divisions.reduce((n, d) => n + d.clubs.filter((c) => !c.players?.length).length, 0);
  if (padded) paddedCountries.push(`${db.code}(+${padded})`);
  const top = db.divisions.find((d) => d.tier === 1);
  manifest.push({
    code: db.code,
    name: db.name,
    file,
    blurb: `${top?.name ?? "Top flight"} — real clubs & squads`,
    tiers: db.divisions.length,
    clubs: clubCount,
    players: playerCount,
  });
}

// Fold the preserved (source-uncovered) countries into the manifest by reading
// back their own JSON, so they show up in the picker exactly like a built one.
for (const code of preserved) {
  const file = `${code}-country-db.json`;
  try {
    const db = JSON.parse(readFileSync(join(OUT_DIR, file), "utf8")) as CountryDatabase;
    const result = validateCountryDB(db);
    if (!result.ok) {
      console.error(`✗ preserved ${code} failed validation — dropping it.`);
      continue;
    }
    const top = db.divisions.find((d) => d.tier === 1);
    manifest.push({
      code: db.code,
      name: db.name,
      file,
      blurb: `${top?.name ?? "Top flight"} — real clubs & squads`,
      tiers: db.divisions.length,
      clubs: db.divisions.reduce((n, d) => n + d.clubs.length, 0),
      players: db.divisions.reduce((n, d) => n + d.clubs.reduce((m, c) => m + (c.players?.length ?? 0), 0), 0),
    });
  } catch {
    console.error(`✗ couldn't read preserved ${file}.`);
  }
}

manifest.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf8");

// ── Report ─────────────────────────────────────────────────────────────────

const totalClubs = manifest.reduce((n, m) => n + m.clubs, 0);
const totalPlayers = manifest.reduce((n, m) => n + m.players, 0);

console.log(`\nBuilt ${manifest.length} country databases → public/database_presets`);
console.log(`  ${totalClubs} clubs, ${totalPlayers} players`);
if (freeAgents) console.log(`  ${freeAgents} free agents skipped (no club)`);
if (skipped) console.log(`  ${skipped} players skipped (unresolved club / bad attrs)`);
if (invalid) console.log(`  ${invalid} countries FAILED validation`);
if (paddedCountries.length) {
  console.log(`  padded to a legal division size: ${paddedCountries.join(", ")}`);
}
if (preserved.length) {
  console.log(`  kept previously-shipped (not in the FC 26 source): ${preserved.join(", ")}`);
}

const multi = manifest.filter((m) => m.tiers > 1);
if (multi.length) {
  console.log(`  multi-tier: ${multi.map((m) => `${m.code}×${m.tiers}`).join(", ")}`);
}
console.log("\nCountries:");
for (const m of manifest) {
  console.log(`  ${m.code}  ${m.name.padEnd(24)} ${String(m.clubs).padStart(3)} clubs  ${String(m.players).padStart(5)} players`);
}

process.exit(invalid > 0 ? 1 : 0);

// ── Build the generated name pool ─────────────────────────────────────────
//
//   npx tsx scripts/build-namepool.ts
//
// Reads `fl_namepool.csv` at the repo root — the community name pool, one row
// per first name / surname, tagged with the countries the name is common in —
// and writes `lib/config/namepool.generated.ts`: a `Record<natCode, {first,
// last}>` the world generator draws generated players' names from.
//
// The CSV stores everyday country names ("England", "Bosnia"); the game keys
// everything on 3-letter nat codes (ENG, BIH), so each name is filed under the
// code of every country it lists (via COUNTRY_TO_NAT — the same build-time table
// the FC 26 importer uses). Names whose only country has no nat code are dropped.
//
// Generated, not hand-edited: rebuild after changing the CSV, never touch the
// output. Mirrors the "default database is generated" rule in CLAUDE.md.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../lib/fl26/csv";
import { COUNTRY_TO_NAT } from "../lib/fl26/convert";

const ROOT = process.cwd();
const CSV = join(ROOT, "fl_namepool.csv");
const OUT = join(ROOT, "lib", "config", "namepool.generated.ts");

// Aliases for spellings the CSV uses that differ from COUNTRY_TO_NAT's keys.
const COUNTRY_ALIASES: Record<string, string> = {
  Bosnia: "Bosnia and Herzegovina",
  Turkey: "Türkiye",
};

// Countries with a valid nat code (a flag exists) but no COUNTRY_TO_NAT key.
const EXTRA_NATS: Record<string, string> = {
  Kazakhstan: "KAZ",
};

function natFor(country: string): string | undefined {
  const name = country.trim();
  return COUNTRY_TO_NAT[name] ?? COUNTRY_TO_NAT[COUNTRY_ALIASES[name] ?? ""] ?? EXTRA_NATS[name];
}

function main() {
  if (!existsSync(CSV)) {
    console.error(`Missing source file: fl_namepool.csv`);
    process.exit(1);
  }
  const rows = parseCsv(readFileSync(CSV, "utf8"));

  // nat code → { first:Set, last:Set }. Sets keep the file deterministic and
  // dedupe a name listed twice for the same country.
  const pools: Record<string, { first: Set<string>; last: Set<string> }> = {};
  const unmapped = new Set<string>();

  for (const r of rows) {
    const type = (r.type || "").trim();
    const name = (r.name || "").trim();
    if (!name || (type !== "first" && type !== "surname")) continue;
    // Countries live in the numbered columns country1..country21.
    const countries = Object.keys(r)
      .filter((k) => /^country\d+$/.test(k))
      .map((k) => (r[k] || "").trim())
      .filter(Boolean);
    for (const country of countries) {
      const nat = natFor(country);
      if (!nat) {
        unmapped.add(country);
        continue;
      }
      (pools[nat] ??= { first: new Set(), last: new Set() });
      if (type === "first") pools[nat].first.add(name);
      else pools[nat].last.add(name);
    }
  }

  // Only keep a nat code once it has enough of both name types to generate a
  // varied player — a code with two surnames and no first names is worse than
  // the curated fallback pool, so we let those fall through to it.
  const MIN = 4;
  const kept = Object.entries(pools)
    .filter(([, p]) => p.first.size >= MIN && p.last.size >= MIN)
    .sort(([a], [b]) => a.localeCompare(b));

  const body = kept
    .map(([nat, p]) => {
      const first = [...p.first].sort();
      const last = [...p.last].sort();
      return `  ${nat}: {\n    first: ${JSON.stringify(first)},\n    last: ${JSON.stringify(last)},\n  },`;
    })
    .join("\n");

  const out = `// GENERATED FILE — do not edit by hand.
// Produced by \`npx tsx scripts/build-namepool.ts\` from fl_namepool.csv.
// The world generator's name pool: 3-letter nat code → first/surname lists.

export interface GeneratedNamePool {
  first: string[];
  last: string[];
}

export const GENERATED_NAME_POOLS: Record<string, GeneratedNamePool> = {
${body}
};
`;

  writeFileSync(OUT, out, "utf8");
  const firstTotal = kept.reduce((n, [, p]) => n + p.first.size, 0);
  const lastTotal = kept.reduce((n, [, p]) => n + p.last.size, 0);
  console.log(
    `Wrote ${OUT}\n  ${kept.length} countries, ${firstTotal} first names, ${lastTotal} surnames`
  );
  if (unmapped.size) {
    console.log(`  skipped (no nat code): ${[...unmapped].sort().join(", ")}`);
  }
}

main();

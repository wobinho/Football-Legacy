// Minimal RFC4180 CSV reader for the FC 26 source data (v1.47).
//
// The three fl26-*.csv files are the authoring input for the default database;
// they are converted to country-db JSON at build time by scripts/build-fl26.ts,
// so this parser only ever runs in Node, never in the shipped client bundle.
// Kept dependency-free and deliberately small: quoted fields, doubled quotes
// inside them, and CRLF are the only cases the data actually uses.

export type CsvRow = Record<string, string>;

/** Split raw CSV text into rows of raw cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV text into objects keyed by the header row. Blank lines are dropped. */
export function parseCsv(text: string): CsvRow[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out: CsvRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // Skip blank trailing lines (a single empty cell).
    if (r.length === 1 && r[0].trim() === "") continue;
    const obj: CsvRow = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = (r[j] ?? "").trim();
    out.push(obj);
  }
  return out;
}

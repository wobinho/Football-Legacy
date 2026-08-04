// ── Cloud transfer verifier (v1.92) ─────────────────────────────────────────
//
//   npm run verify:cloud [seasons]
//
// The bandwidth fix is only real if the compressed round trip is LOSSLESS and
// the saving is the size it's claimed to be. Both are measured here against a
// genuinely-played world rather than a synthetic object, because the ratio comes
// from the shape of real save data — thousands of players carrying the same 35
// attribute keys is exactly what gzip eats, and a toy fixture would flatter it.
//
// What it asserts:
//   • gzip → base64 → gunzip returns a byte-identical save (this is the whole
//     safety question: a lossy path would corrupt saves silently)
//   • the compressed payload is a large fraction smaller than the raw one
//   • the projected metered transfer per hour of play is back under control
//
// The two hops are measured SEPARATELY because they carry different bytes, and
// averaging them would misstate both:
//   • browser ↔ function carries the raw gzip bytes
//   • function ↔ KV carries those bytes base64'd (Upstash's REST API is JSON, so
//     binary has to be text-safe), which adds a third back on top
// Base64 is not worth avoiding: it costs a third of an already ~10×-smaller
// payload on one hop, against the risk of corrupting saves by pushing raw bytes
// through a JSON transport.

import { gzipSync, gunzipSync } from "node:zlib";
import { generateWorld } from "../lib/worldgen";
import {
  advanceUntilEvent,
  applyMatchResult,
  afterUserMatch,
  matchSeed,
  ensureUserLineup,
  runSeasonRollover,
} from "../lib/gameloop";
import { simulateMatch } from "../lib/engine/match";
import { buildSideInput } from "../lib/selection";
import { TUNING } from "../lib/config/tuning";

const SEASONS = Number(process.argv[2] ?? 9);

/** Old behaviour, for the comparison: full raw save every 60s, both hops billed. */
const OLD_INTERVAL_S = 60;
/** New behaviour: compressed save every 5 min, both hops billed. */
const NEW_INTERVAL_S = 300;
/** Vercel meters browser→function AND function→KV. */
const HOPS = 2;

const state = generateWorld({
  saveName: "cloud",
  managerName: "Cloud Test",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP", "ITA"],
  seed: 777,
});

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label} — ${detail}`);
}

function measure(season: number) {
  const json = JSON.stringify({ state });
  const raw = Buffer.from(json, "utf8");

  const gz = gzipSync(raw, { level: 6 });
  // What the route actually stores and serves back.
  const stored = "gz:" + gz.toString("base64");

  // Round trip, exactly as the route + client do it.
  const back = gunzipSync(Buffer.from(stored.slice(3), "base64")).toString("utf8");
  const lossless = back === json;

  const rawMB = raw.length / 1_048_576;
  const browserMB = gz.length / 1_048_576; // raw gzip bytes over the wire
  const kvMB = Buffer.byteLength(stored, "utf8") / 1_048_576; // base64 into Redis

  // Old: the full raw save over BOTH hops, every 60s.
  const oldGBph = (rawMB * HOPS * (3600 / OLD_INTERVAL_S)) / 1024;
  // New: gzip on the browser hop, base64'd gzip on the KV hop, every 5 min.
  const newGBph = ((browserMB + kvMB) * (3600 / NEW_INTERVAL_S)) / 1024;

  console.log(
    `\nS${season}  raw ${rawMB.toFixed(2)} MB  →  browser hop ${browserMB.toFixed(2)} MB (${(rawMB / browserMB).toFixed(1)}×), KV hop ${kvMB.toFixed(2)} MB`
  );
  console.log(
    `      metered transfer: was ~${oldGBph.toFixed(2)} GB/hr  →  now ~${newGBph.toFixed(3)} GB/hr  (${(oldGBph / newGBph).toFixed(0)}× less)`
  );

  check("round trip is lossless", lossless, lossless ? "byte-identical" : "PAYLOAD CORRUPTED");
  check("payload shrank ≥4×", rawMB / browserMB >= 4, `${(rawMB / browserMB).toFixed(1)}× on the browser hop`);
  check("under 0.1 GB/hr", newGBph < 0.1, `${newGBph.toFixed(3)} GB/hr`);
}

let guard = 0;
while (state.season <= SEASONS && guard++ < 30_000) {
  const stop = advanceUntilEvent(state);
  if (stop.kind === "matchday") {
    const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
    const userLineup = ensureUserLineup(state);
    const mk = (teamId: string, fixed?: typeof userLineup) => {
      const t = state.teams[teamId];
      const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired && !p.loan);
      return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, fixed, 1, t.assignments);
    };
    const isHome = fixture.homeId === state.userTeamId;
    const res = simulateMatch(
      mk(fixture.homeId, isHome ? userLineup : undefined),
      mk(fixture.awayId, isHome ? undefined : userLineup),
      TUNING,
      matchSeed(state, fixture)
    );
    applyMatchResult(state, fixture, res);
    afterUserMatch(state);
  } else if (stop.kind === "seasonEnd") {
    if (state.season === 1 || state.season === SEASONS) measure(state.season);
    if (state.season >= SEASONS) break;
    runSeasonRollover(state);
  }
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);

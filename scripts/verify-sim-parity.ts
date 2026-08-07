// Simulation parity + speed harness (v1.99).
//
//   npx tsx scripts/verify-sim-parity.ts [seasons]        # print a fingerprint
//   npx tsx scripts/verify-sim-parity.ts [seasons] --save  # write it as the baseline
//   npx tsx scripts/verify-sim-parity.ts [seasons] --check # compare against the baseline
//
// The v1.99 speed work is only legitimate if it changed NOTHING about what the
// simulation produces. That is not a claim a timing number can support and not
// one a spot check can either: an optimisation that reorders a tie-break shows
// up as one club finishing a place higher in one division five seasons in, which
// nobody clicking around would ever see.
//
// So this plays real seasons with the real loop and hashes what came out — every
// division's final table (order, points, GD), the cup and European winners, and
// a squad-level digest of every club. Two runs of the same seed must agree
// exactly; the `--save`/`--check` pair is what makes that assertable ACROSS a
// code change rather than only within one run.
//
// It doubles as the speed measurement, because the honest way to report an
// optimisation is the wall clock of the same work either side of it.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
import { computeTable } from "../lib/season";
import { TUNING } from "../lib/config/tuning";
import type { GameState } from "../lib/types";

const SEASONS = Number(process.argv[2] ?? 3);
const MODE = process.argv.includes("--save") ? "save" : process.argv.includes("--check") ? "check" : "print";
const BASELINE = path.join(__dirname, ".sim-parity-baseline.json");

/**
 * Everything about the finished world that a behavioural change would move.
 *
 * Deliberately more than the league tables: a change to selection or to
 * archetype derivation can leave every table identical for a season or two and
 * still be picking different players, so the squad digest folds in each club's
 * roster, its players' overalls, fitness and form. Fitness is in there
 * specifically because the GK recovery change must show up somewhere — a
 * fingerprint that could not see it would not be watching the right things.
 */
function fingerprint(state: GameState) {
  const parts: string[] = [];

  const ladder = Array.from(new Set(state.divisionIds)).filter((id) => state.leagues[id]);
  for (const id of ladder.sort()) {
    const league = state.leagues[id];
    const table = computeTable(state.fixtures, id, league.teamIds);
    parts.push(`L:${id}`);
    for (const r of table) {
      parts.push(`${r.teamId} ${r.played} ${r.won} ${r.drawn} ${r.lost} ${r.gf} ${r.ga} ${r.points}`);
    }
  }

  parts.push(`CUP:${state.cup?.winnerId ?? "-"}`);
  // The record book is where a finished season's honours survive the rollover —
  // the live cup and European brackets are rebuilt a few steps into it.
  for (const s of state.recordBook?.seasons ?? []) {
    const champs = Object.entries(s.championsByLeague)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([lg, c]) => `${lg}=${c.teamId}`)
      .join(",");
    parts.push(`RB:${s.season} ${champs} cup=${s.cupWinner?.teamId ?? "-"}`);
    for (const e of s.europeanWinners ?? []) parts.push(`  EU:${e.tier} ${e.teamId}`);
  }

  for (const teamId of Object.keys(state.teams).sort()) {
    const t = state.teams[teamId];
    const roster = [...t.playerIds].sort();
    parts.push(`T:${teamId} ${t.reputation} ${Math.round(t.budget)} ${t.tactic.formationId} ${t.tactic.style}`);
    for (const pid of roster) {
      const p = state.players[pid];
      if (!p) continue;
      parts.push(`  ${pid} ${p.overall} ${p.age} ${p.fitness} ${p.form.toFixed(4)}`);
    }
  }

  const body = parts.join("\n");
  return {
    hash: createHash("sha256").update(body).digest("hex").slice(0, 16),
    tables: createHash("sha256")
      .update(parts.filter((l) => l.startsWith("L:") || /^[A-Z]{3}\d/.test(l)).join("\n"))
      .digest("hex")
      .slice(0, 16),
    players: Object.keys(state.players).length,
  };
}

function run() {
  const state = generateWorld({
    saveName: "parity",
    managerName: "Parity",
    userTeamId: "ENG1_t9",
    playableCountry: "ENG",
    viewCountries: ["ESP", "ITA"],
    seed: 4242,
  });

  const t0 = Date.now();
  let guard = 0;
  let matches = 0;

  while (state.season <= SEASONS && guard++ < 5000) {
    const stop = advanceUntilEvent(state);
    if (stop.kind === "matchday") {
      const fixture = state.fixtures.find((f) => f.id === state.pendingMatchFixtureId)!;
      const userLineup = ensureUserLineup(state);
      const mk = (teamId: string, fixed?: typeof userLineup) => {
        const t = state.teams[teamId];
        const players = t.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
        return buildSideInput(teamId, t.name, t.short, players, t.tactic, TUNING, fixed);
      };
      const res = simulateMatch(
        mk(fixture.homeId, fixture.homeId === state.userTeamId ? userLineup : undefined),
        mk(fixture.awayId, fixture.awayId === state.userTeamId ? userLineup : undefined),
        TUNING,
        matchSeed(state, fixture)
      );
      applyMatchResult(state, fixture, res);
      afterUserMatch(state);
      matches++;
    } else if (stop.kind === "seasonEnd") {
      runSeasonRollover(state);
    }
    // "offer", "contracts", "gate" and "idle" need no action — the loop simply
    // continues, exactly as scripts/smoke.ts does. Declining every offer and
    // letting every contract lapse is a consistent policy, which is all a
    // parity fingerprint requires.
  }

  const ms = Date.now() - t0;
  return { fp: fingerprint(state), ms, matches, seasons: state.season - 1 };
}

const { fp, ms, matches, seasons } = run();

console.log(`\nSim parity — ${seasons} season(s), ${matches} user matches`);
console.log(`  wall clock   ${(ms / 1000).toFixed(1)}s`);
console.log(`  players      ${fp.players}`);
console.log(`  tables hash  ${fp.tables}`);
console.log(`  world hash   ${fp.hash}`);

if (MODE === "save") {
  fs.writeFileSync(BASELINE, JSON.stringify({ seasons: SEASONS, ...fp }, null, 2));
  console.log(`\n  baseline written → ${path.basename(BASELINE)}`);
} else if (MODE === "check") {
  if (!fs.existsSync(BASELINE)) {
    console.error("\n  FAIL: no baseline. Run with --save on the unmodified code first.");
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  if (base.seasons !== SEASONS) {
    console.error(`\n  FAIL: baseline is ${base.seasons} season(s), this run is ${SEASONS}.`);
    process.exit(1);
  }
  const bad: string[] = [];
  if (base.tables !== fp.tables) bad.push(`tables ${base.tables} → ${fp.tables}`);
  if (base.hash !== fp.hash) bad.push(`world ${base.hash} → ${fp.hash}`);
  if (base.players !== fp.players) bad.push(`players ${base.players} → ${fp.players}`);
  if (bad.length) {
    console.error(`\n  FAIL: the simulation changed.\n    ${bad.join("\n    ")}`);
    process.exit(1);
  }
  console.log(`\n  OK — identical to the baseline.`);
}

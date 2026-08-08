// The chance-type system (v2.2) — how archetypes reach the simulation.
//   npm run verify:chancetypes
//
// This replaced the role brief's rating bonus, and its legitimacy rests on
// claims a table cannot show and clicking around cannot reveal. Each is
// measured here against a real generated world.
//
//   1. A MIX IS NORMALISED. Every side always creates exactly 100% of its own
//      chances, whatever it is made of. This is the invariant that makes the
//      feature unable to inflate scoring — `calibrate` measures chance volume,
//      and this file is what proves volume is untouched by construction rather
//      than by re-running a calibration sweep and hoping.
//
//   2. RESISTANCE IS CENTRED. An ordinary defence must multiply conversion by
//      almost exactly 1, or the whole world quietly scores more (or less) than
//      it did. The pivot is derived from the archetype table, so this also
//      catches a table edit that shifts the mean without anyone noticing.
//
//   3. IT ACTUALLY DISCRIMINATES. The point of the feature is that two sides of
//      EQUAL RATING play differently. A crossing side must genuinely convert
//      worse against tall centre backs than against ball-players — otherwise
//      the tables are decoration and nothing was gained by deleting the brief.
//
//   4. A SAVE WITH NO ROLES COMPUTES WHAT IT ALWAYS DID. `sideExecution` runs
//      in the engine's hot path for every match in the world, so "inert when
//      unused" is the property that lets it exist at all.
//
//   5. A ROLE IS NEVER A BONUS. This is the design's central break with the
//      brief it replaced: `executionOf` must never exceed 1. A player who is
//      the role asked for is simply not penalised — he is not rewarded.

import { generateWorld } from "../lib/worldgen";
import { getFormation } from "../lib/config/formations";
import { ARCHETYPE_ROSTER, archetypesForPosition, deriveArchetype, getArchetype } from "../lib/config/archetype";
import { pickLineup } from "../lib/selection";
import {
  CHANCE_TYPES,
  RESIST_PIVOT,
  creationOf,
  defenceOf,
  executionOf,
  hasRoles,
  pruneRoles,
  rollChanceType,
  shapeResistance,
  sideExecution,
  sideMix,
  sideResistance,
  typeConversionMult,
  type MixPlayer,
} from "../lib/chancetypes";
import { PHASE_WEIGHTS, POS_ORDER } from "../lib/config/positions";
import { TUNING } from "../lib/config/tuning";
import { mulberry32 } from "../lib/rng";
import type { RoleBrief, Tactic } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const state = generateWorld({
  saveName: "chance",
  managerName: "Chance",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP"],
  seed: 31337,
});

const team = state.teams[state.userTeamId];
const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
const base: Tactic = { ...team.tactic };
const formation = getFormation(base.formationId);

/** The user's real XI, as the engine would see it. */
function realXI(tactic: Tactic): MixPlayer[] {
  const f = getFormation(tactic.formationId);
  const { lineup } = pickLineup(squad, f, TUNING, false, undefined, tactic);
  const bySlot = new Map(lineup.map((l) => [l.slotId, l.player]));
  return f.slots.map((s) => ({
    slotId: s.id,
    slotPos: s.pos,
    attrs: bySlot.get(s.id)?.attrs,
  }));
}

const EPS = 1e-9;

console.log("\n── 1. A mix is normalised ─────────────────────────────────────");
{
  // Across every formation and a wide spread of role assignments, the mix must
  // always sum to 1. This is what guarantees the feature cannot move volume.
  let worst = 0;
  let checked = 0;
  const rng = mulberry32(99);
  for (const shape of ["433", "442", "4231", "352", "532"]) {
    const f = getFormation(shape);
    const players = realXI({ ...base, formationId: shape });
    for (let trial = 0; trial < 40; trial++) {
      const roles: RoleBrief = {};
      for (const slot of f.slots) {
        const opts = archetypesForPosition(slot.pos);
        if (opts.length && rng() < 0.7) roles[slot.id] = opts[Math.floor(rng() * opts.length)].id;
      }
      const mix = sideMix(players, { ...base, formationId: shape, roles });
      const sum = CHANCE_TYPES.reduce((a, t) => a + mix[t], 0);
      worst = Math.max(worst, Math.abs(sum - 1));
      checked++;
    }
  }
  check("every mix sums to exactly 1", worst < 1e-9, `${checked} mixes, worst error ${worst.toExponential(2)}`);

  // And a mix is never degenerate: a real side always creates some of each.
  const mix = sideMix(realXI(base), base);
  const min = Math.min(...CHANCE_TYPES.map((t) => mix[t]));
  check("a real XI creates some of every chance type", min > 0.02, `least common type at ${(min * 100).toFixed(1)}%`);
}

console.log("\n── 2. Resistance is centred on the measured pivot ─────────────");
{
  // Every row, for every archetype, must be four real numbers. This exists
  // because of a bug it caught: the roster contains an archetype whose id is
  // `constructor`, and a plain `table[id]` lookup returned
  // `Object.prototype.constructor` — truthy, so the class fallback never fired,
  // and the pivot summed `undefined` into `NaN`. That turned the entire feature
  // into a silent no-op while every individual spot check looked correct.
  let bad: string[] = [];
  for (const a of ARCHETYPE_ROSTER) {
    for (const t of CHANCE_TYPES) {
      const c = creationOf(a)[t];
      const d = defenceOf(a)[t];
      if (!Number.isFinite(c)) bad.push(`${a.id}.creation.${t}`);
      if (!Number.isFinite(d)) bad.push(`${a.id}.defence.${t}`);
    }
  }
  check(
    "every archetype resolves to real numbers (no prototype-chain lookups)",
    bad.length === 0,
    bad.length ? bad.slice(0, 6).join(", ") : `${ARCHETYPE_ROSTER.length} archetypes`
  );

  // The pivot is the archetype table's DEFENCE-WEIGHTED mean, recomputed here
  // independently of the module's own arithmetic so a table edit that shifts
  // the centre is caught rather than silently absorbed.
  //
  // The weighting is the point, and an earlier cut of this check asserted a
  // FLAT mean — which is what the first implementation used and what measured
  // as a world-wide scoring nerf (0.975 mean conversion, calibrate 2.62→2.55).
  // `sideResistance` weights each player by his slot's defensive phase weight,
  // so the pivot has to describe the population that actually defends, not the
  // whole roster including strikers who never do.
  for (const t of CHANCE_TYPES) {
    let sum = 0;
    let total = 0;
    for (const a of ARCHETYPE_ROSTER) {
      let w = 0;
      let n = 0;
      for (const pos of POS_ORDER) {
        if (!archetypesForPosition(pos).some((x) => x.id === a.id)) continue;
        w += PHASE_WEIGHTS[pos]?.defense ?? 0;
        n++;
      }
      if (n === 0 || w <= 0) continue;
      const weight = w / n;
      sum += defenceOf(a)[t] * weight;
      total += weight;
    }
    const mean = total > 0 ? sum / total : 1;
    check(
      `the ${t} pivot equals the roster's defence-weighted mean`,
      Math.abs(mean - RESIST_PIVOT[t]) < EPS,
      `${mean.toFixed(4)} vs ${RESIST_PIVOT[t].toFixed(4)}`
    );
  }

  // And the claim that actually matters, stated end to end: across every real
  // club-vs-club pairing in a division, the mean conversion multiplier must sit
  // at ~1. This is the check that would have caught the flat-pivot defect
  // directly, where the per-type equality above only says the code matches its
  // own definition. Measured at 0.995; the bound is deliberately tight, because
  // 0.975 was already enough to move `calibrate` by 0.07 goals/match.
  const clubs = Object.values(state.teams)
    .filter((t) => t.leagueId === team.leagueId)
    .slice(0, 12);
  const xiOf = (t: (typeof clubs)[number]) => {
    const f = getFormation(t.tactic.formationId);
    const sq = t.playerIds.map((i) => state.players[i]).filter((p) => p && !p.retired);
    const { lineup } = pickLineup(sq, f, TUNING, false, undefined, t.tactic);
    const by = new Map(lineup.map((l) => [l.slotId, l.player]));
    return f.slots.map((sl) => ({ slotId: sl.id, slotPos: sl.pos, attrs: by.get(sl.id)?.attrs }));
  };
  let convSum = 0;
  let pairs = 0;
  for (const atk of clubs) {
    for (const def of clubs) {
      if (atk.id === def.id) continue;
      const mix = sideMix(xiOf(atk), atk.tactic);
      const res = sideResistance(xiOf(def));
      const shp = shapeResistance(def.tactic);
      let exp = 0;
      for (const t of CHANCE_TYPES) exp += mix[t] * typeConversionMult(t, res, shp, TUNING.chanceTypeSwing);
      convSum += exp;
      pairs++;
    }
  }
  const meanConv = convSum / pairs;
  check(
    "across real club pairings the mean conversion multiplier is ~1",
    Math.abs(meanConv - 1) < 0.02,
    `${meanConv.toFixed(4)} over ${pairs} pairings`
  );

  // A real, unremarkable defence should land close to 1 on every type — the
  // property that keeps world scoring where `calibrate` put it.
  const resist = sideResistance(realXI(base));
  let worst = 0;
  for (const t of CHANCE_TYPES) worst = Math.max(worst, Math.abs(resist[t] - 1));
  check(
    "a real back line resists near 1 on every type",
    worst < 0.2,
    CHANCE_TYPES.map((t) => `${t} ${resist[t].toFixed(3)}`).join(", ")
  );

  // The conversion multiplier for an exactly-average defence is exactly 1 —
  // stated directly, since this is the claim the whole invariant rests on.
  const neutral = { through: 1, cross: 1, longshot: 1, box: 1 };
  let allOne = true;
  for (const t of CHANCE_TYPES) {
    if (Math.abs(typeConversionMult(t, neutral, neutral, TUNING.chanceTypeSwing) - 1) > EPS) allOne = false;
  }
  check("an average defence converts at exactly 1", allOne);
}

console.log("\n── 3. It discriminates: shape beats shape ─────────────────────");
{
  // The feature's whole reason for existing. Build two defences of the same
  // KIND of quality but different SHAPE, and check a crossing attack genuinely
  // fares differently against them.
  const aerial = ["tower", "tower", "enforcer", "sentinel"].map((id) => getArchetype(id)!);
  const ballplayers = ["architect", "architect", "constructor", "constructor"].map((id) => getArchetype(id)!);

  const resistOf = (rows: typeof aerial) => {
    const acc = { through: 0, cross: 0, longshot: 0, box: 0 };
    for (const a of rows) for (const t of CHANCE_TYPES) acc[t] += defenceOf(a)[t];
    const out = { through: 1, cross: 1, longshot: 1, box: 1 };
    for (const t of CHANCE_TYPES) out[t] = acc[t] / rows.length / RESIST_PIVOT[t];
    return out;
  };
  const flat = { through: 1, cross: 1, longshot: 1, box: 1 };
  const vsAerial = typeConversionMult("cross", resistOf(aerial), flat, TUNING.chanceTypeSwing);
  const vsBall = typeConversionMult("cross", resistOf(ballplayers), flat, TUNING.chanceTypeSwing);
  check(
    "crosses convert worse against a tall back line than a ball-playing one",
    vsAerial < vsBall - 0.05,
    `${(vsAerial * 100).toFixed(1)}% vs ${(vsBall * 100).toFixed(1)}%`
  );

  // And the same tall line is NOT a general-purpose defence: it must be worse
  // against something. A row that is better at everything is a rating bonus
  // wearing a table's clothing.
  const longVsAerial = typeConversionMult("longshot", resistOf(aerial), flat, TUNING.chanceTypeSwing);
  check(
    "the tall line is weaker against long shots than against crosses",
    longVsAerial > vsAerial,
    `longshot ${(longVsAerial * 100).toFixed(1)}% vs cross ${(vsAerial * 100).toFixed(1)}%`
  );

  // The shape dials pull their own weight: a deep block must genuinely kill
  // balls in behind.
  const deep = shapeResistance({ ...base, line: "Deep" });
  const high = shapeResistance({ ...base, line: "High" });
  check(
    "a deep block resists through balls better than a high line",
    typeConversionMult("through", flat, deep, TUNING.chanceTypeSwing) <
      typeConversionMult("through", flat, high, TUNING.chanceTypeSwing)
  );
  check(
    "a deep block concedes more from distance than a high line",
    typeConversionMult("longshot", flat, deep, TUNING.chanceTypeSwing) >
      typeConversionMult("longshot", flat, high, TUNING.chanceTypeSwing)
  );

  // Creation must differ too, or every side manufactures the same thing and the
  // defensive table has nothing to bite on.
  const wingers = creationOf(getArchetype("architect_winger"));
  const target = creationOf(getArchetype("battering_ram"));
  check(
    "a wide creator makes crosses where a target man makes box play",
    wingers.cross > target.cross + 0.2 && target.box > wingers.box + 0.2,
    `winger cross ${(wingers.cross * 100).toFixed(0)}%, ram box ${(target.box * 100).toFixed(0)}%`
  );

  // End to end: the same XI briefed two different ways manufactures visibly
  // different football. This is the claim a manager would actually notice.
  const crossRoles: RoleBrief = {};
  const shootRoles: RoleBrief = {};
  for (const slot of formation.slots) {
    const opts = archetypesForPosition(slot.pos);
    const mostCross = opts.reduce((b, a) => (creationOf(a).cross > creationOf(b).cross ? a : b), opts[0]);
    const mostShot = opts.reduce((b, a) => (creationOf(a).longshot > creationOf(b).longshot ? a : b), opts[0]);
    if (mostCross) crossRoles[slot.id] = mostCross.id;
    if (mostShot) shootRoles[slot.id] = mostShot.id;
  }
  const players = realXI(base);
  const crossMix = sideMix(players, { ...base, roles: crossRoles });
  const shootMix = sideMix(players, { ...base, roles: shootRoles });
  // 10pp each way is a deliberately calibrated bar, not a loosened one. The mix
  // is ATTACK-WEIGHTED, so only the forward slots meaningfully move it — a back
  // four contributes almost nothing however it is briefed. Measured, the full
  // span between an all-width brief and an all-shooting one is ~13pp per type,
  // so this asserts most of the reachable range while leaving room for a table
  // edit that shifts one role. A larger threshold would be asserting something
  // the design cannot do; a much smaller one would pass on noise.
  check(
    "briefing for width vs for shooting produces genuinely different sides",
    crossMix.cross > shootMix.cross + 0.10 && shootMix.longshot > crossMix.longshot + 0.10,
    `cross ${(crossMix.cross * 100).toFixed(0)}%→${(shootMix.cross * 100).toFixed(0)}%, ` +
      `longshot ${(crossMix.longshot * 100).toFixed(0)}%→${(shootMix.longshot * 100).toFixed(0)}%`
  );
}

console.log("\n── 4. A save with no roles is inert ───────────────────────────");
{
  check("hasRoles() is false for a plain tactic", !hasRoles(base));
  const players = realXI(base);
  check("sideExecution() is exactly 1 with no roles assigned", Math.abs(sideExecution(players, base) - 1) < EPS);

  // An unroled tactic still produces a mix (from the players themselves) — it
  // simply produces no EXECUTION penalty. Both halves matter: the first is what
  // makes archetypes matter at all, the second is what makes the Creator
  // optional rather than mandatory.
  const mix = sideMix(players, base);
  check("an unroled side still has a real mix, drawn from its players",
    Math.abs(CHANCE_TYPES.reduce((a, t) => a + mix[t], 0) - 1) < EPS);
}

console.log("\n── 5. A role is never a bonus ─────────────────────────────────");
{
  // The break with the brief this replaced. Exhaustive over the whole roster.
  let maxExec = 0;
  let exactIsOne = true;
  for (const role of ARCHETYPE_ROSTER) {
    for (const actual of ARCHETYPE_ROSTER) {
      const e = executionOf(actual, role);
      maxExec = Math.max(maxExec, e);
      if (actual.id === role.id && Math.abs(e - 1) > EPS) exactIsOne = false;
    }
  }
  check("executionOf() never exceeds 1", maxExec <= 1 + EPS, `max ${maxExec.toFixed(4)}`);
  check("the role you asked for executes at exactly 1", exactIsOne);
  check("no role at all executes at exactly 1", Math.abs(executionOf(undefined, undefined) - 1) < EPS);

  // A near miss must cost less than a total mismatch, or the class system says
  // nothing here.
  // Picked by CLASS rather than by name — an earlier cut of this check compared
  // a Sniper against an Apex Predator, which are both Mavericks, so it was
  // asserting same-class against same-class and could never have failed for the
  // right reason.
  const sniper = getArchetype("sniper")!;
  const sameClass = ARCHETYPE_ROSTER.find((a) => a.cls === sniper.cls && a.id !== sniper.id)!;
  const otherClass = ARCHETYPE_ROSTER.find((a) => a.cls !== sniper.cls)!;
  const near = executionOf(sameClass, sniper);
  const far = executionOf(otherClass, sniper);
  check(
    "a same-class near miss costs less than a wrong-class one",
    near > far && near < 1,
    `${sameClass.name} ${near.toFixed(2)} vs ${otherClass.name} ${far.toFixed(2)}`
  );

  // And a real XI asked to do the wrong job genuinely suffers.
  const wrong: RoleBrief = {};
  for (const slot of formation.slots) {
    const opts = archetypesForPosition(slot.pos);
    const p = realXI(base).find((x) => x.slotId === slot.id);
    const actual = p?.attrs ? deriveArchetype(p.attrs, slot.pos) : undefined;
    const other = opts.find((a) => a.cls !== actual?.cls);
    if (other) wrong[slot.id] = other.id;
  }
  const exec = sideExecution(realXI(base), { ...base, roles: wrong });
  check("an XI briefed entirely wrong executes below 1", exec < 0.99, `${(exec * 100).toFixed(1)}%`);
}

console.log("\n── 6. Housekeeping ────────────────────────────────────────────");
{
  const roles: RoleBrief = {};
  for (const slot of formation.slots) {
    const opts = archetypesForPosition(slot.pos);
    if (opts.length) roles[slot.id] = opts[0].id;
  }
  const other = getFormation(formation.id === "433" ? "532" : "433");
  const pruned = pruneRoles(roles, other.id) ?? {};
  const stale = Object.keys(pruned).filter((k) => !other.slots.some((s) => s.id === k));
  check("changing formation drops roles naming slots it does not have", stale.length === 0);
  check(
    "roles the new shape DOES have survive",
    Object.keys(pruneRoles(roles, formation.id) ?? {}).length === formation.slots.length
  );
  check(
    "a role naming an archetype that does not exist is dropped",
    !(pruneRoles({ [formation.slots[0].id]: "not_a_real_role" }, formation.id) ?? {})[formation.slots[0].id]
  );
  check("no roles at all is undefined, not an empty object", pruneRoles({}, formation.id) === undefined);

  // The type roll must be a proper distribution over the mix.
  const mix = sideMix(realXI(base), base);
  const counts: Record<string, number> = { through: 0, cross: 0, longshot: 0, box: 0 };
  const rng = mulberry32(7);
  const N = 40000;
  for (let i = 0; i < N; i++) counts[rollChanceType(rng(), mix)]++;
  let worst = 0;
  for (const t of CHANCE_TYPES) worst = Math.max(worst, Math.abs(counts[t] / N - mix[t]));
  check("rollChanceType() reproduces the mix it is given", worst < 0.01, `worst deviation ${(worst * 100).toFixed(2)}pp`);
}

console.log(
  failures === 0
    ? "\nAll chance-type checks passed.\n"
    : `\n${failures} chance-type check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

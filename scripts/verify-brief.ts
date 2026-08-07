// The Tactic Creator's role brief (v1.99).
//   npm run verify:brief
//
// The feature's whole legitimacy rests on three claims that a table cannot show
// and clicking around cannot reveal, so each is measured here against a real
// generated world:
//
//   1. A save with NO brief computes exactly what it always did. The lever sits
//      in `effectiveRating`, which runs for every player in every match in the
//      world, so "inert when unused" is the property that lets it exist at all.
//   2. A brief is ZERO-SUM in expectation. Briefing roles at random must be
//      worth nothing on average — otherwise the Creator is a free rating rise
//      every manager collects, which is the v1.78 rule this design exists to
//      respect.
//   3. It is a real decision either way: briefing the roles you actually field
//      is a genuine gain, and briefing roles you do not have is a genuine loss.
//      A lever that only ever helps is not a bet.

import { generateWorld } from "../lib/worldgen";
import { getFormation } from "../lib/config/formations";
import { archetypesForPosition, deriveArchetype } from "../lib/config/archetype";
import { pickLineup, toEnginePlayer } from "../lib/selection";
import { tacticalFitMult } from "../lib/engine/match";
import { ROLE_BRIEF_SWING, briefBalance, hasBrief, pruneBrief, roleBriefMult } from "../lib/tacticbrief";
import { TUNING } from "../lib/config/tuning";
import { mulberry32 } from "../lib/rng";
import type { RoleBrief, Tactic } from "../lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const state = generateWorld({
  saveName: "brief",
  managerName: "Brief",
  userTeamId: "ENG1_t9",
  playableCountry: "ENG",
  viewCountries: ["ESP"],
  seed: 31337,
});

const team = state.teams[state.userTeamId];
const squad = team.playerIds.map((id) => state.players[id]).filter((p) => p && !p.retired);
const base: Tactic = { ...team.tactic };
const formation = getFormation(base.formationId);

console.log("\n── 1. An unbriefed tactic is inert ────────────────────────────");

check("hasBrief() is false for a plain tactic", !hasBrief(base));
{
  let allOne = true;
  for (const slot of formation.slots) {
    for (const p of squad) {
      if (roleBriefMult(p.attrs, slot.pos, slot.id, base) !== 1) allOne = false;
    }
  }
  check("roleBriefMult() is exactly 1 for every player in every slot", allOne);
}
{
  // The selection lever must also be untouched when no slot is supplied.
  const p = toEnginePlayer(squad[0]);
  const withoutSlot = tacticalFitMult(p, base, TUNING);
  const withSlot = tacticalFitMult(p, base, TUNING, { pos: formation.slots[1].pos, id: formation.slots[1].id });
  check("tacticalFitMult is unchanged by an empty brief", withoutSlot === withSlot);
}

console.log("\n── 2. A brief is zero-sum in expectation ──────────────────────");
{
  // Brief every slot with a RANDOMLY chosen legal role, many times over, and
  // average what the XI earns. If the mean is meaningfully positive the feature
  // is free money; if meaningfully negative it is a tax nobody would opt into.
  const rng = mulberry32(99);
  const picked = pickLineup(squad, formation, TUNING, false, undefined, base).lineup;
  const xi = picked.map((e) => ({
    slotId: e.slotId,
    slotPos: formation.slots.find((s) => s.id === e.slotId)!.pos,
    attrs: e.player.attrs,
  }));

  let sum = 0;
  const TRIALS = 4000;
  for (let t = 0; t < TRIALS; t++) {
    const roles: RoleBrief = {};
    for (const slot of xi) {
      const options = archetypesForPosition(slot.slotPos);
      roles[slot.slotId] = options[Math.floor(rng() * options.length)].id;
    }
    sum += briefBalance({ ...base, roles }, xi).total;
  }
  const mean = sum / TRIALS;
  // Eleven slots × ±8% is a ±88 point span; a mean inside ±8 (one slot's worth)
  // is "no systematic edge", which is the claim. It will not be exactly zero:
  // the five roles at a position are not evenly spread across the classes a
  // squad happens to hold, and that is a property of the squad, not the lever.
  check(
    "a randomly-chosen brief is worth ~nothing on average",
    Math.abs(mean) < 8,
    `mean ${mean.toFixed(2)}% over ${TRIALS} random briefs`
  );
}

console.log("\n── 3. It is a real bet in both directions ─────────────────────");
{
  const picked = pickLineup(squad, formation, TUNING, false, undefined, base).lineup;
  const xi = picked.map((e) => ({
    slotId: e.slotId,
    slotPos: formation.slots.find((s) => s.id === e.slotId)!.pos,
    attrs: e.player.attrs,
  }));

  // Brief each slot with the role ALREADY standing in it — the manager who
  // describes his own side accurately.
  const perfect: RoleBrief = {};
  for (const s of xi) {
    const a = deriveArchetype(s.attrs, s.slotPos);
    if (a) perfect[s.slotId] = a.id;
  }
  const good = briefBalance({ ...base, roles: perfect }, xi);
  check(
    "briefing the roles you actually field is a clear gain",
    good.total > 0 && good.missed === 0,
    `+${good.total.toFixed(1)}%, ${good.met} met / ${good.near} near / ${good.missed} missed`
  );

  // Brief each slot with a role of a DIFFERENT class — the manager who asks for
  // a side he does not own.
  const wrong: RoleBrief = {};
  for (const s of xi) {
    const actual = deriveArchetype(s.attrs, s.slotPos);
    const other = archetypesForPosition(s.slotPos).find((a) => a.cls !== actual?.cls);
    if (other) wrong[s.slotId] = other.id;
  }
  const bad = briefBalance({ ...base, roles: wrong }, xi);
  check(
    "briefing roles you do NOT have is a clear loss",
    bad.total < 0,
    `${bad.total.toFixed(1)}%, ${bad.met} met / ${bad.near} near / ${bad.missed} missed`
  );

  check(
    "the swing is bounded by ROLE_BRIEF_SWING per slot",
    Math.abs(good.total) <= xi.length * ROLE_BRIEF_SWING * 100 + 1e-9 &&
      Math.abs(bad.total) <= xi.length * ROLE_BRIEF_SWING * 100 + 1e-9,
    `±${(ROLE_BRIEF_SWING * 100).toFixed(0)}% × ${xi.length} slots`
  );
}

console.log("\n── 4. A brief cannot outlive the slots it names ───────────────");
{
  const roles: RoleBrief = {};
  for (const s of formation.slots) roles[s.id] = archetypesForPosition(s.pos)[0].id;
  // Prune against a DIFFERENT formation: none of these slot ids should survive
  // unless the two shapes genuinely share them.
  const other = getFormation(
    ["433_holding", "442", "352", "4231"].find((f) => f !== base.formationId) ?? "442"
  );
  const pruned = pruneBrief(roles, other.id) ?? {};
  const otherSlots = new Set(other.slots.map((s) => s.id));
  check(
    "pruning drops every slot the new formation does not have",
    Object.keys(pruned).every((id) => otherSlots.has(id))
  );
  check("pruning a brief against its own formation keeps it",
    Object.keys(pruneBrief(roles, base.formationId) ?? {}).length === formation.slots.length);
  check("an unknown archetype id is dropped rather than stored",
    !(pruneBrief({ [formation.slots[0].id]: "not_a_real_role" }, base.formationId) ?? {})[formation.slots[0].id]);
  check("a brief of nothing is undefined, not an empty object", pruneBrief({}, base.formationId) === undefined);
}

console.log(
  failures === 0
    ? "\nAll role-brief checks passed.\n"
    : `\n${failures} role-brief check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);

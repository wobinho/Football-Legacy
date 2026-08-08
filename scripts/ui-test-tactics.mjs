// Drive the Tactics board through the real UI (v1.99).
//
// Three of this version's changes are claims a rules verifier structurally
// cannot check, because they are about what the browser LAYS OUT rather than
// what the engine computes:
//
//   1. The three-column grid must be a CONSTANT. It was not: an `fr` track's
//      automatic minimum is its content's min-content width, so the moment the
//      XI was populated the player names in the pitch tokens' name plates
//      pushed the Lineup column's minimum past its 30% share and the whole row
//      re-proportioned — measured, Lineup collapsed 359 → 239px and Setup blew
//      out to 802px. That is the same trap the formation description's
//      `w-0 min-w-full` fixes at one item (v1.87); `minmax(0, …)` fixes it at
//      the grid, for every item at once. It only binds when a column has no
//      slack, so ONE viewport width cannot see it — this sweeps five.
//
//   2. The bench must hold `benchSize` seats and every seat must open the sub
//      picker on a tap, since the board's bench half used to be drag-only.
//
//   3. The roster must name each player's ARCHETYPE beside him.
//
// Asserts only that the layout holds and the controls work — the bench cap
// itself is `benchCap()`'s business, and this reads it off the panel rather
// than restating it.
import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-ui-tactics");
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, name);

const errors = [];
const fails = [];
const check = (ok, label) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const BASE = process.env.UI_TEST_BASE || "http://localhost:3000";
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
const keyInput = page.locator('input[spellcheck="false"]');
if (await keyInput.count()) {
  await keyInput.fill("SANTI-001");
  await page.click("text=UNLOCK");
  await page.waitForTimeout(500);
}
await page.waitForSelector("text=NEW LEGACY", { timeout: 30000 });
await page.click("text=NEW LEGACY");
await page.fill('input[placeholder="Your name"]', "Robin Ramirez");
// By POSITION, never by name — a hardcoded club name is a standing trap here
// (see the note in ui-test.mjs).
await page.waitForSelector("text=CHOOSE YOUR CLUB", { timeout: 30000 });
await page.waitForTimeout(1200);
await page.locator('div:has(> div.grid[class*="max-h-64"]) div.grid[class*="max-h-64"] > button').first().click();
await page.waitForTimeout(400);
const start = page.locator('button:has-text("START LEGACY")').first();
if (await start.isDisabled()) {
  await page.locator('div.grid[class*="max-h-64"] > button').nth(1).click();
  await page.waitForTimeout(400);
}
await start.click();
await page.waitForSelector("text=Inbox", { timeout: 60000 });

await page.click('button:has-text("Tactics")');
await page.waitForSelector("text=Formation");

// Panels are scoped by their own <h2>: since v1.99 there are two "Auto-pick"
// and two "Clear" buttons on this screen, and a bare text match would be
// ambiguous.
const panel = (t) => page.locator("section", { has: page.locator(`h2:text-is("${t}")`) }).first();
const columns = async () => {
  const g = page.locator('div.grid[class*="30fr"]').first();
  return await g.evaluate((el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().width)));
};

// ── 1. the layout is a constant ─────────────────────────────────────────────
console.log("\nThe three-column grid holds its proportions");
for (const w of [1280, 1366, 1440, 1600, 1920]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const clear = panel("Lineup").getByRole("button", { name: "Clear" });
  if (await clear.isEnabled()) {
    await clear.click();
    await panel("Lineup").getByRole("button", { name: "Sure?" }).click();
    await page.waitForTimeout(400);
  }
  const empty = await columns();
  await panel("Lineup").getByRole("button", { name: "Auto-pick" }).click();
  await page.waitForTimeout(400);
  const xi = await columns();
  await panel("Bench").getByRole("button", { name: "Auto-pick" }).click();
  await page.waitForTimeout(400);
  const full = await columns();
  const stable = JSON.stringify(empty) === JSON.stringify(xi) && JSON.stringify(xi) === JSON.stringify(full);
  check(stable, `${w}px  ${empty.join("/")} → ${xi.join("/")} → ${full.join("/")}`);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);

// ── 2. the bench ────────────────────────────────────────────────────────────
console.log("\nThe bench, under the pitch");
const bench = panel("Bench");
const pitchColumn = page.locator('div.grid[class*="30fr"] > div').first();
check(
  (await pitchColumn.locator('h2:text-is("Bench")').count()) > 0,
  "the bench sits in the same column as the pitch"
);
const capText = await bench.locator("text=/subs/").first().innerText();
const cap = Number(capText.match(/\/\s*(\d+)\s*subs/)?.[1] ?? 0);
check(cap === 9, `the bench offers ${cap} seats`);
// Anchored on the seat's own ACCESSIBLE NAME, not on the panel's layout classes
// (v2.0). The bench became a row of circular tokens rather than a list of rows,
// which is a pure presentation change — and `div.space-y-1 > div` reported zero
// seats on a bench that drew perfectly, exactly the failure the GCN harness's
// v1.99 note warns about. Every seat, filled or empty, is labelled
// "Substitute N: …" or "Pick substitute N", so this counts SEATS however they
// are drawn next.
const seatCount = async () =>
  await bench.getByRole("button", { name: /^(Substitute \d+|Pick substitute \d+)/ }).count();
const seatRows = await seatCount();
check(seatRows === cap, `every seat is rendered, filled or empty (${seatRows} seats)`);
const named = await bench.getByTitle(/drag to reorder, tap to change/).count();
check(named === cap, `auto-pick names a full bench (${named}/${cap})`);
await page.screenshot({ path: shot("bench.png") });

// Tapping a seat opens the sub picker — the gesture the board used to lack.
await bench.getByTitle(/drag to reorder, tap to change/).first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
check(true, "tapping a bench seat opens the sub picker");
await page.screenshot({ path: shot("bench-picker.png") });
const before = await bench.getByTitle(/drag to reorder, tap to change/).first().innerText();
await page.locator('[role="dialog"] button').nth(1).click();
await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
const after = await bench.getByTitle(/drag to reorder, tap to change/).first().innerText();
check(before !== after, "picking from it changes who is in that seat");

// Clearing empties every seat but leaves the panel the same shape.
await bench.getByRole("button", { name: "Clear" }).click();
await bench.getByRole("button", { name: "Sure?" }).click();
await page.waitForTimeout(400);
check((await seatCount()) === cap, "an empty bench still renders all its seats");
const emptySeat = bench.getByRole("button", { name: /Pick substitute/ }).first();
await emptySeat.click();
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
check(true, "an EMPTY seat opens the picker too");
await page.locator('[role="dialog"] button').nth(1).click();
await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
check(
  (await bench.getByTitle(/drag to reorder, tap to change/).count()) === 1,
  "and the pick lands on the bench"
);

// ── 3. the roster names each player's archetype ─────────────────────────────
console.log("\nThe roster");
const roster = panel("Roster");
const rows = await roster.locator("button").count();
// ArchetypeLabel renders the archetype name (or "Unknown" for an unscouted
// player, which cannot happen in your own squad).
const withIdentity = await roster.locator("button span[title*='·']").count();
check(withIdentity >= rows - 1, `${withIdentity} of ${rows} roster rows name an archetype`);
check((await roster.getByText("Unknown").count()) === 0, "no player in your own squad reads as Unknown");
await page.screenshot({ path: shot("roster.png") });

// ── 4. the Tactic Creator (v1.99) ───────────────────────────────────────────
//
// The rules are `verify:brief`'s job. What only a browser can answer is whether
// the thing opens, whether every slot in the chosen formation actually gets a
// role dropdown, whether the live balance readout responds to a brief, and
// whether a saved plan lands in Saved Tactics reading as a plan rather than as
// a broken snapshot naming nobody.
console.log("\nThe Tactic Creator");
const saved = panel("Saved Tactics");
await saved.getByRole("button", { name: "Creator" }).click();
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
const dlg = page.locator('[role="dialog"]');
check(await dlg.getByText("Tactic Creator").count() > 0, "the Creator opens");
await page.screenshot({ path: shot("creator-open.png"), fullPage: true });

// One role row per slot in the shape. Anchored on each row's own position
// button rather than on the scroll container's height class (v2.0) — the list
// moved into a column beside the Creator's new pitch and its `max-h` changed,
// which reported 0 rows on a modal that drew all eleven.
const roleRows = await dlg.getByTitle(/^Highlight .* on the pitch$/).count();
check(roleRows === 11, `every slot gets a role row (${roleRows}/11)`);

// The Creator's pitch (v2.0): the same eleven slots drawn as a shape, so the
// role brief is read on a formation rather than as a list of dropdowns. An
// slot with no role assigned is titled "GK — no role yet".
const pitchSlots = await dlg.getByTitle(/ — no role yet$/).count();
check(pitchSlots === 11, `the Creator draws its shape (${pitchSlots}/11 pitch slots)`);

// v2.2: the Creator owns the WHOLE plan, so the instruction dials must be
// here — this is the flow's central claim (design one thing, save it, load it
// back intact) and a missing dial would silently make a saved tactic partial.
for (const dial of ["Mentality", "Tempo", "Width", "Press", "Line", "Focus"]) {
  const n = await dlg.locator(`text=/^${dial}$/`).count();
  check(n > 0, `the Creator carries the ${dial} dial`);
}

// The roles counter, and the two fill routes. Both must actually populate it.
const readRoles = async () =>
  Number((await dlg.locator("text=/slots assigned/").first().innerText()).match(/(\d+)\//)?.[1] ?? -1);
check((await readRoles()) === 0, "a fresh draft assigns no roles");
await dlg.getByRole("button", { name: "Roles from current XI" }).click();
await page.waitForTimeout(300);
check((await readRoles()) > 0, "'roles from current XI' fills them");

// The chance-mix bar is the Creator's honest readout (v2.2) — it replaced the
// brief's balance percentage, and it must name all four types. Asserted on the
// LABELS rather than on any number: the numbers are `verify:chancetypes`'s job,
// and matching arithmetic here is the v1.99 GCN lesson.
for (const label of ["Through balls", "Crosses", "Long shots", "Box play"]) {
  check((await dlg.locator(`text=${label}`).count()) > 0, `the mix names "${label}"`);
}
await page.screenshot({ path: shot("creator-briefed.png"), fullPage: true });

// Clearing puts it back — a role assignment is not a one-way door.
await dlg.getByRole("button", { name: "Clear roles" }).click();
await page.waitForTimeout(300);
check((await readRoles()) === 0, "'clear roles' empties it again");

// The style suggestion is the other fill route, and must also populate.
await dlg.getByRole("button", { name: /Best for this style/ }).click();
await page.waitForTimeout(300);
check((await readRoles()) > 0, "'best for this style' fills the roles too");

// Saving lands it in Saved Tactics, described as a PLAN.
await dlg.locator('input[placeholder^="e.g."]').fill("UI Test Plan");
await dlg.getByRole("button", { name: /SAVE TACTIC|OVERWRITE/ }).click();
await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
const row = saved.locator("text=UI Test Plan").first();
check((await row.count()) > 0, "the designed tactic appears in Saved Tactics");
// Read the preset's own summary line — the sibling of the name, not whatever
// wrapper `hasText` happens to bubble up to.
const rowText = await saved
  .locator("div.rounded-md", { hasText: "UI Test Plan" })
  .first()
  .innerText();
check(/plan only/.test(rowText), `it reads as a plan, not as 0 starters (${rowText.replace(/\n/g, " · ")})`);
check(/\d+ roles/.test(rowText), "and says how many roles it carries");
await page.screenshot({ path: shot("creator-saved.png"), fullPage: true });

console.log(errors.length ? `\nconsole errors:\n${errors.join("\n")}` : "\nconsole errors: none");
console.log(`screenshots: ${OUT}`);
if (fails.length || errors.length) {
  console.log(`\nFAILED — ${fails.length} check(s), ${errors.length} console error(s).`);
  await browser.close();
  process.exit(1);
}
console.log("\nTACTICS UI OK");
await browser.close();

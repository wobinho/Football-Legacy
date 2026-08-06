// Drive the reworked Global Club Network screen end-to-end (v1.95).
//
// The general ui-test.mjs starts a legacy from the menu and plays football; this
// one has a narrower job — the GCN is an END-GAME screen behind a £5bn unlock,
// so reaching it by playing is not a thing a test can do. It starts a game the
// ordinary way, then stands the network up through the store (the same actions
// the unlock modal dispatches), funds it, and clicks through every tab and every
// panel looking for a render error.
//
// What it asserts is deliberately shallow and structural: that each tab mounts,
// that the boardroom and hub map draw, and that NOTHING throws. Whether the
// numbers are right is `npm run verify:gcn`'s question — this only answers
// "does the screen exist and survive being used", which is the failure a rules
// verifier structurally cannot see.

import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-ui-gcn");
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, name);

const errors = [];
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const BASE = process.env.UI_TEST_BASE || "http://localhost:3000";
let step = 0;
const checks = [];
function check(label, ok, detail = "") {
  checks.push({ label, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });

// Access gate.
const keyInput = page.locator('input[spellcheck="false"]');
if (await keyInput.count()) {
  await keyInput.fill("SANTI-001");
  await page.click("text=UNLOCK");
  await page.waitForTimeout(500);
}

// New game. The club is picked by position rather than by name — a named club is
// what makes the general harness brittle when the default database changes.
await page.waitForSelector("text=NEW LEGACY", { timeout: 30000 });
await page.click("text=NEW LEGACY");
await page.fill('input[placeholder="Your name"]', "Verifier");
// Pick the first club in the "CHOOSE YOUR CLUB" grid. Scoped to the heading
// rather than to a bare grid selector (the setup page has several grids) and
// taken by POSITION rather than by name, so a change to the shipped database
// can't break this the way a hardcoded club name breaks ui-test.mjs.
await page.waitForSelector("text=CHOOSE YOUR CLUB", { timeout: 30000 });
await page.waitForTimeout(1200);
await page
  .locator('div:has(> div.grid[class*="max-h-64"]) div.grid[class*="max-h-64"] > button')
  .first()
  .click();
await page.waitForTimeout(500);
const startBtn = page.locator('button:has-text("START LEGACY")').first();
if (await startBtn.isDisabled()) {
  // The grid's first cell is "＋ Create your own club" on some presets — take
  // the next one instead of failing on a layout detail.
  await page.locator('div.grid[class*="max-h-64"] > button').nth(1).click();
  await page.waitForTimeout(500);
}
await startBtn.click();
await page.waitForSelector("text=Inbox", { timeout: 60000 });

// Stand the network up.
//
// The GCN unlocks at a £5bn deposit, which no fresh save can make, so the budget
// is seeded IN THE SAVE RECORD and the game reloaded from it — the same
// IndexedDB surface ui-test-db.mjs already drives. Deliberately NOT a debug hook
// on the store: production code should not carry a door that exists only for a
// test. Everything after this point is the real UI doing the real thing.
await page.waitForTimeout(1500); // let the debounced autosave land
await page.evaluate(async () => {
  const openDb = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open("football-legacy", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  const db = await openDb();
  const read = () =>
    new Promise((res, rej) => {
      const t = db.transaction("saves", "readonly").objectStore("saves").getAll();
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  const keys = () =>
    new Promise((res, rej) => {
      const t = db.transaction("saves", "readonly").objectStore("saves").getAllKeys();
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  const rows = await read();
  const ks = await keys();
  for (let i = 0; i < rows.length; i++) {
    const rec = rows[i];
    const game = rec?.game ?? rec;
    if (!game?.teams || !game.userTeamId) continue;
    game.teams[game.userTeamId].budget = 25_000_000_000;
    await new Promise((res) => {
      const t = db.transaction("saves", "readwrite").objectStore("saves").put(rec, ks[i]);
      t.onsuccess = t.onerror = () => res();
    });
  }
  db.close();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
if (await keyInput.count()) {
  await keyInput.fill("SANTI-001");
  await page.click("text=UNLOCK");
  await page.waitForTimeout(500);
}
const cont = page.locator('button:has-text("CONTINUE")').first();
if (await cont.count()) {
  await cont.click();
  await page.waitForSelector("text=Inbox", { timeout: 60000 });
}

// Now unlock the network the way a manager does: Club → GCN Funds → deposit all
// → name it in the prompt that raises itself.
await page.click('button:has-text("Club")');
await page.waitForTimeout(800);
const allBtn = page.locator('button:has-text("Deposit to GCN Funds")').first();
const maxChip = page.locator('button:has-text("Max")').first();
if (await maxChip.count()) await maxChip.click().catch(() => {});
await page.waitForTimeout(300);
if (await allBtn.count()) {
  await allBtn.click();
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: shot("00-unlock-prompt.png"), fullPage: true });
const nameField = page.locator('input[placeholder*="etwork"], input[maxlength="48"]').first();
if (await nameField.count()) await nameField.fill("Verify Group").catch(() => {});
const founder = page.locator('button:has-text("Establish Network")').first();
if (await founder.count()) {
  await founder.click();
  await page.waitForTimeout(900);
}
check("the network unlocked", (await page.locator('button:has-text("Global Club Network")').count()) > 0);

await page.click('button:has-text("Global Club Network")');
await page.waitForTimeout(900);
await page.screenshot({ path: shot("01-hq.png"), fullPage: true });
check("the GCN screen opens on Headquarters", await page.locator("text=Verify Group").count() > 0);

// Fund the treasury through the Treasury tab. The unlock threshold is SPENT to
// establish the network, so a freshly-unlocked GCN has an empty war chest —
// exactly as a real save does, and the reason every action below would otherwise
// be greyed out. Depositing here is also the first real exercise of the tab.
await page.click('button:has-text("Treasury")');
await page.waitForTimeout(600);
await page.click('button:has-text("Deposit / withdraw")');
await page.waitForTimeout(400);
await page.locator('button:has-text("All")').first().click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Deposit")').last().click();
await page.waitForTimeout(800);
await page.screenshot({ path: shot("01b-funded.png"), fullPage: true });
check(
  "the treasury takes a deposit",
  !(await page.locator("text=£0").first().isVisible().catch(() => false))
);

// Buy a club BEFORE walking the tabs. Without one the network owns no players,
// no finances and no squads, so Players, Clubs and half of Treasury would render
// only their empty states — and an empty state passing a render check is exactly
// the gap that makes a shallow UI test worthless.
await page.click('button:has-text("Clubs")');
await page.waitForTimeout(600);
await page.click('button:has-text("Buy a club")');
await page.waitForTimeout(900);
const buyRow = page.locator('[role="dialog"] button:has-text("Buy")').first();
check("the buy-a-club list offers clubs", (await buyRow.count()) > 0);
if (await buyRow.count()) {
  await buyRow.click();
  await page.waitForTimeout(900);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}
check("the network now owns a club", (await page.locator("text=Pos").count()) > 0);

// Every tab in turn.
for (const [tab, marker, file] of [
  ["Clubs", "Buy a club", "02-clubs.png"],
  ["Players", "", "03-players.png"],
  ["Intl Scouting Hub", "The map", "04-hubs.png"],
  ["Treasury", "The books", "05-treasury.png"],
  ["Operations", "The boardroom", "06-operations.png"],
]) {
  await page.click(`button:has-text("${tab}")`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot(file), fullPage: true });
  check(`${tab} renders`, marker ? (await page.locator(`text=${marker}`).count()) > 0 : true);
}

// The Players tab with real data in it: the filter bar, a populated list, and the
// by-club grouping toggle. Asserting it MOUNTS is not enough — the empty state
// mounts too, and passes.
await page.click('button:has-text("Players")');
await page.waitForTimeout(800);
check("the Players list is populated", (await page.locator("text=All positions").count()) > 0);
const rowCount = await page.locator("button:has(span:text-matches('^[0-9]+y$'))").count();
check("the list holds player rows", rowCount > 0, `${rowCount} rows`);
await page.click('button:has-text("By club")');
await page.waitForTimeout(600);
await page.screenshot({ path: shot("03b-players-grouped.png"), fullPage: true });
check("grouping by club works", (await page.locator("text=players").count()) > 0);
// A filter must actually narrow the list, not just render a control.
await page.click('button:has-text("By club")');
await page.waitForTimeout(400);
const before = await page.locator("button:has(span:text-matches('^[0-9]+y$'))").count();
await page.locator('button:has-text("Any age")').first().click();
await page.waitForTimeout(300);
await page.locator('text=U21').last().click();
await page.waitForTimeout(600);
const after = await page.locator("button:has(span:text-matches('^[0-9]+y$'))").count();
check("a filter narrows the list", after < before, `${before} → ${after}`);
await page.screenshot({ path: shot("03c-players-filtered.png"), fullPage: true });

// The hub map: open a region and confirm the establish dialog draws its costs.
await page.click('button:has-text("Intl Scouting Hub")');
await page.waitForTimeout(500);
const region = page.locator('button:has-text("to establish")').first();
check("the map offers regions to establish a hub in", (await region.count()) > 0);
if (await region.count()) {
  await region.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("07-hub-region.png"), fullPage: true });
  check("a region dialog opens with a price", (await page.locator("text=Establish for").count()) > 0);
  // Build it, then confirm the map now shows a level.
  await page.click('button:has-text("Establish for")');
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot("08-hub-built.png"), fullPage: true });
  check("the hub lands on the map", (await page.locator("text=Level 1").count()) > 0);
}

// The boardroom: open a seat's shortlist and appoint someone.
await page.click('button:has-text("Operations")');
await page.waitForTimeout(600);
const appoint = page.locator('button:has-text("Appoint")').first();
check("a vacant seat offers an appointment", (await appoint.count()) > 0);
if (await appoint.count()) {
  await appoint.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot("09-exec-market.png"), fullPage: true });
  // Scoped to the dialog: the seat card behind it carries an "Appoint" of its
  // own, and clicking through a modal is exactly what Playwright refuses to do.
  const hire = page.locator('[role="dialog"] button:has-text("Appoint")').first();
  await hire.click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("10-exec-hired.png"), fullPage: true });
  check("the seat is filled and shows its effect", (await page.locator("text=seat +").count()) > 0
    || (await page.locator("text=of 19% possible, text=possible").count()) > 0
    || (await page.locator("text=stars +").count()) > 0);
}

// Back to Headquarters — the dashboard must now reflect the hub and the board.
await page.click('button:has-text("Headquarters")');
await page.waitForTimeout(700);
await page.screenshot({ path: shot("11-hq-populated.png"), fullPage: true });
check("Headquarters reports the boardroom", (await page.locator("text=Boardroom").count()) > 0);
check("Headquarters reports the hubs", (await page.locator("text=Scouting hubs").count()) > 0);

check("no uncaught errors on any tab", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\nScreenshots: ${OUT}`);
console.log(failed.length === 0 ? "\nAll GCN UI checks passed.\n" : `\n${failed.length} GCN UI check(s) FAILED.\n`);
process.exit(failed.length === 0 ? 0 : 1);

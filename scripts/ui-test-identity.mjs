// Drive the Club → Identity screen: the badge and kit creators (v1.96).
//
// `verify:visual` answers whether the RULES are right — stable derivation, no
// stored specs, no kit that clashes with its own home shirt. It cannot answer
// whether the screen renders, because the renderers are React and the specs are
// SVG. This clicks through both creators, changes something in each, saves, and
// asserts the crest that comes back is the one that was drawn.
//
// Deliberately shallow: it checks that things draw, that a change survives a
// save, and that nothing throws. The numbers are the verifier's job.
//
// Requires the dev server. Run: node scripts/ui-test-identity.mjs

import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-ui-identity");
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
// A bare "Failed to load resource: 404" from the console names nothing, which
// makes it the one failure here that can't be acted on. The URL is what says
// whether it's an asset this feature asked for or one the app always misses.
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

const BASE = process.env.UI_TEST_BASE || "http://localhost:3000";
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

// New game — club taken by POSITION, never by name, so a database change can't
// break this the way a hardcoded club name does.
await page.waitForSelector("text=NEW LEGACY", { timeout: 30000 });
await page.click("text=NEW LEGACY");
await page.fill('input[placeholder="Your name"]', "Verifier");
await page.waitForSelector("text=CHOOSE YOUR CLUB", { timeout: 30000 });
await page.waitForTimeout(1200);
await page
  .locator('div:has(> div.grid[class*="max-h-64"]) div.grid[class*="max-h-64"] > button')
  .first()
  .click();
await page.waitForTimeout(500);
const startBtn = page.locator('button:has-text("START LEGACY")').first();
if (await startBtn.isDisabled()) {
  await page.locator('div.grid[class*="max-h-64"] > button').nth(1).click();
  await page.waitForTimeout(500);
}
await startBtn.click();
await page.waitForSelector("text=Inbox", { timeout: 60000 });

console.log("\nThe crest reaches the rest of the game");
// Before touching the editor at all: every screen that used to draw a coloured
// square must now be drawing a real crest. This is the check that would catch
// the Crest rewrite having gone wrong across 52 call sites.
const homeCrests = await page.locator('svg[aria-label*="badge"]').count();
check("the home screen draws real crests", homeCrests > 0, `${homeCrests} found`);
await page.screenshot({ path: shot("01-home.png"), fullPage: true });

console.log("\nThe Identity screen");
await page.click('button:has-text("Club")');
await page.waitForTimeout(600);
await page.click('button:has-text("Identity")');
await page.waitForTimeout(800);
await page.screenshot({ path: shot("02-identity-badge.png"), fullPage: true });

check("the badge creator mounts", (await page.locator("text=Club Identity").count()) > 0);
check("the shape picker draws", (await page.locator('button[title="Roundel"]').count()) > 0);
// The picker opens on the "Blocks" group, so a horizontal pattern is only
// reachable after switching groups — which is itself worth exercising.
check(
  "the pattern swatches render through the real component",
  (await page.locator('button[title="Halves"] svg').count()) > 0
);
const previewCount = await page.locator('svg[aria-label*="badge"]').count();
check("the preview renders the badge at several sizes", previewCount >= 5, `${previewCount} badges`);

// Change the shape and the pattern — the two most visible edits, and both
// readable back out of the DOM.
await page.click('button[title="Roundel"]');
await page.waitForTimeout(400);
await page.click('button:has-text("Horizontal")');
await page.waitForTimeout(400);
await page.click('button[title="Hoops"]');
await page.waitForTimeout(400);
await page.screenshot({ path: shot("03-badge-edited.png"), fullPage: true });
check("the save button arms once something changed", await page.locator('button:has-text("Save identity")').isEnabled());

console.log("\nThe kit creator");
await page.click('button:has-text("Kits")');
await page.waitForTimeout(700);
await page.screenshot({ path: shot("04-kits.png"), fullPage: true });
const kitCount = await page.locator('svg[aria-label*="jersey"]').count();
check("the kit creator draws jerseys", kitCount > 5, `${kitCount} jerseys`);
check("all four slots are offered", (await page.locator('button:has-text("Goalkeeper")').count()) > 0);
check("the clash preview renders", (await page.locator("text=AT A CLUB IN YOUR OWN COLOURS").count()) > 0);

// Switch slot and change a pattern — the away kit, since that is the one the
// clash rule actually governs.
await page.click('button:has-text("Away")');
await page.waitForTimeout(500);
await page.click('button:has-text("Vertical")');
await page.waitForTimeout(400);
await page.click('button[title="Sash"]');
await page.waitForTimeout(500);
await page.screenshot({ path: shot("05-kit-edited.png"), fullPage: true });

// The goalkeeper slot: a different collar and a texture, to exercise the
// tiled-<pattern> path that the badge creator never reaches.
await page.click('button:has-text("Goalkeeper")');
await page.waitForTimeout(500);
await page.click('button:has-text("Texture")');
await page.waitForTimeout(400);
await page.click('button[title="Honeycomb"]');
await page.waitForTimeout(500);
await page.screenshot({ path: shot("06-kit-gk.png"), fullPage: true });
check("a textured pattern renders without throwing", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log("\nSaving, and what the rest of the game then draws");
await page.click('button:has-text("Save identity")');
await page.waitForTimeout(900);
check("the panel reports itself saved", (await page.locator("text=Saved").count()) > 0);
await page.screenshot({ path: shot("07-saved.png"), fullPage: true });

// The point of the whole feature: the authored crest is what every other screen
// now draws. Reload from the save to prove it PERSISTED rather than merely
// living in React state.
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=Inbox", { timeout: 60000 });
await page.waitForTimeout(1200);
const afterReload = await page.locator('svg[aria-label*="badge"]').count();
check("crests still draw after a reload", afterReload > 0, `${afterReload} found`);
await page.screenshot({ path: shot("08-after-reload.png"), fullPage: true });

await page.click('button:has-text("Club")');
await page.waitForTimeout(500);
await page.click('button:has-text("Identity")');
await page.waitForTimeout(800);
check(
  "the authored badge survived the save",
  (await page.locator('button[title="Roundel"][class*="border-gold"]').count()) > 0
);
await page.screenshot({ path: shot("09-identity-reloaded.png"), fullPage: true });

/* ---------------------------------------------------------------------------
   v1.97 — editing clubs that aren't yours, and the two places a kit now shows.
   Same contract as everything above: that it renders and nothing throws.
   ------------------------------------------------------------------------- */

console.log("\nEditing another club");
await page.click('button:has-text("Edit other clubs")');
await page.waitForTimeout(600);
check("the club picker appears", (await page.locator('[aria-label="Club to edit"]').count()) > 0);
// Open the picker and take the second club in it — the first is the manager's
// own, so this is genuinely a club he does not run.
await page.click('[aria-label="Club to edit"]');
await page.waitForTimeout(400);
const clubRows = page.locator('[role="option"]');
const optionCount = await clubRows.count();
check("the picker lists the world's clubs", optionCount > 5, `${optionCount} options`);
await clubRows.nth(1).click();
await page.waitForTimeout(700);
await page.screenshot({ path: shot("10-other-club.png"), fullPage: true });
check("the full badge creator follows the picked club", (await page.locator('button[title="Roundel"]').count()) > 0);

// Edit and save it — the check that `allowAny` is actually reaching the store.
await page.click('button[title="Hex"]');
await page.waitForTimeout(400);
await page.click('button:has-text("Save identity")');
await page.waitForTimeout(800);
check(
  "a club the manager does not run can be re-branded",
  (await page.locator('button[title="Hex"][class*="border-gold"]').count()) > 0
);
await page.screenshot({ path: shot("11-other-saved.png"), fullPage: true });

console.log("\nBulk editing a division");
await page.click('button:has-text("Bulk by division")');
await page.waitForTimeout(600);
await page.click('[aria-label="Division to edit"]');
await page.waitForTimeout(400);
await page.locator('[role="option"]').first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: shot("12-bulk.png"), fullPage: true });
const bulkBadges = await page.locator('svg[aria-label*="badge"]').count();
const bulkKits = await page.locator('svg[aria-label*="jersey"]').count();
check("every club in the division draws a crest", bulkBadges >= 10, `${bulkBadges} crests`);
check("and its four kits", bulkKits >= 40, `${bulkKits} jerseys`);
const shapePickers = await page.locator("select").count();
check("the row controls are dropdowns", shapePickers >= 10, `${shapePickers} selects`);

// Change one row's badge shape and confirm it committed — the bulk editor saves
// per row rather than behind a Save button, which is the thing to prove.
const firstShape = page.locator("select").first();
await firstShape.selectOption("diamond");
await page.waitForTimeout(800);
check("a bulk row commits immediately", (await firstShape.inputValue()) === "diamond");
// The kit slot buttons live inside a row; clicking one must swap which kit the
// row's controls edit without disturbing anything else.
await page.locator('button[title="Edit the away kit"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: shot("13-bulk-edited.png"), fullPage: true });
check("bulk editing throws nothing", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log("\nKits in the club card and the player profile");
// The club card is opened from the league table, which is what it was built
// for. Reached by role rather than by club name so a database change can't
// break this the way a hardcoded name would.
await page.click('button:has-text("Competition")');
await page.waitForTimeout(1000);
await page.locator('tr[title^="View "]').first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: shot("14-club-card.png"), fullPage: true });
const cardKits = await page.locator('svg[aria-label*="kit"]').count();
check("the club card shows the three outfield kits", cardKits >= 3, `${cardKits} kits`);

const editBtn = page.locator('button:has-text("Edit identity")').first();
check("the club card offers an identity editor", (await editBtn.count()) > 0);
if (await editBtn.count()) {
  await editBtn.click();
  await page.waitForTimeout(900);
  check("the card's badge creator mounts", (await page.locator('button[title="Roundel"]').count()) > 0);
  await page.click('button[title="Spade"]');
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Save identity")').first().click();
  await page.waitForTimeout(800);
  check(
    "the card commits its edit",
    (await page.locator('button[title="Spade"][class*="border-gold"]').count()) > 0
  );
  await page.screenshot({ path: shot("16-club-card-editing.png"), fullPage: true });
  // Fold the editor away again so the squad list below is reachable.
  await page.locator('button:has-text("Close editor")').first().click();
  await page.waitForTimeout(600);
}

console.log("\nThe player profile's home shirt");
// Straight from the card's own squad list into a profile — the hop the overlay
// stack exists for, and the profile is where the club's home kit now sits.
// A squad row is the only button in the card carrying an OVR pill and a flag.
await page.locator('button:has(img[width]):has-text("y")').last().click();
await page.waitForTimeout(1200);
const profileKits = await page.locator('svg[aria-label$="home kit"]').count();
check("the player profile draws his club's home shirt", profileKits > 0, `${profileKits} found`);
await page.screenshot({ path: shot("17-player-profile.png"), fullPage: true });

check("no uncaught errors anywhere", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\nScreenshots: ${OUT}`);
console.log(failed.length === 0 ? "\nAll identity UI checks passed.\n" : `\n${failed.length} identity UI check(s) FAILED.\n`);
process.exit(failed.length === 0 ? 0 : 1);

// Drive one full season, then exercise the v21 additions that only exist once
// there is history: Club → History & Records → a clickable Seasons Past card,
// and the Finances line-item breakdowns.
//
//   node scripts/ui-test-season.mjs      (dev server must be running)
import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-season");
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

// Honour UI_TEST_BASE like every other harness, so a busy port 3000 doesn't
// fail the run (the convention ui-test.mjs and ui-test-gcn.mjs already follow).
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
// The club is taken by POSITION, never by name — the standing trap CLAUDE.md
// documents and ui-test.mjs/ui-test-gcn.mjs already avoid. This harness still
// clicked "Nottingham Foresters", a club the shipped database renamed when the
// real-club data landed, so it timed out at the picker and NOTHING behind it
// (the finances breakdowns, the whole season, the season-review modal) had been
// running.
await page.waitForSelector("text=CHOOSE YOUR CLUB", { timeout: 30000 });
await page.waitForTimeout(1200);
await page
  .locator('div:has(> div.grid[class*="max-h-64"]) div.grid[class*="max-h-64"] > button')
  .first()
  .click();
await page.waitForTimeout(400);
const startLegacy = page.locator('button:has-text("START LEGACY")').first();
if (await startLegacy.isDisabled()) {
  // The first cell is "＋ Create your own club" on some presets.
  await page.locator('div.grid[class*="max-h-64"] > button').nth(1).click();
  await page.waitForTimeout(400);
}
await startLegacy.click();
await page.waitForSelector("text=Inbox", { timeout: 60000 });

// ── Finances breakdown (v21): expand the wage bill ────────────────────────
await page.click('button:has-text("Club")');
await page.waitForSelector("text=Weekly Breakdown");
await page.click('button:has-text("Squad wage bill")');
await page.waitForTimeout(300);
await page.screenshot({ path: shot("01-finances-expanded.png") });
const wageRowsVisible = await page.locator("text=/ovr · through S/").count();
console.log("wage-bill line items visible:", wageRowsVisible);

// ── The Income tab renders its upgrade list ───────────────────────────────
// It used to wait on "Membership Scheme" / "Events & Conferences" / "Academy
// Partnerships", three streams the v1.79 and v1.87 facility reworks deleted
// outright — so this harness had been timing out here, and everything behind it
// (the whole season, the season-review modal) went unmeasured. Re-derived from
// the screen and stated as a COUNT rather than three names, so the next stream
// that is renamed or retired doesn't silently switch the rest of the run off.
await page.click('button:has-text("Income")');
await page.waitForSelector("text=Income", { timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: shot("02-income.png"), fullPage: true });
const incomeUpgrades = await page.locator('button:has-text("Upgrade"), button:has-text("Buy")').count();
console.log("income upgrades offered:", incomeUpgrades);

// ── Play a full season ────────────────────────────────────────────────────
await page.click('button:has-text("Home")');
let guard = 0;
let ended = false;
while (guard++ < 1200) {
  const endSeason = page.getByRole("button", { name: /end season/i });
  if (await endSeason.count()) {
    await endSeason.first().click();
    await page.waitForTimeout(2500);
    ended = true;
    break;
  }
  // Matchday: take the instant result rather than watching 90 minutes.
  // Scoped to the main pane / header — the left nav has a "MATCH DAY" item that
  // merely navigates, and clicking it stalls the calendar instead of advancing.
  const instant = page.getByRole("button", { name: /instant result/i });
  const header = page.locator("header, body > div > div").first();
  const cont = header.getByRole("button", { name: /^continue/i });
  if (await instant.count()) {
    await instant.first().click();
    await page.waitForTimeout(500);
    for (const rx of [/continue/i, /done/i, /back to/i]) {
      const b = page.getByRole("button", { name: rx });
      if (await b.count()) { await b.first().click(); await page.waitForTimeout(300); break; }
    }
  } else if (await cont.count()) {
    await cont.first().click();
    await page.waitForTimeout(180);
  } else {
    await page.waitForTimeout(200);
  }
}
console.log("season completed:", ended, `(${guard} loop steps)`);
await page.screenshot({ path: shot("03-after-season.png") });

// ── The new season review modal ───────────────────────────────────────────
await page.click('button:has-text("Club")');
await page.click('button:has-text("History & Records")');
await page.waitForTimeout(500);
await page.screenshot({ path: shot("04-history.png"), fullPage: true });

const seasonCard = page.locator('button[aria-label*="season review"]');
const cards = await seasonCard.count();
console.log("clickable season cards:", cards);
if (cards > 0) {
  await seasonCard.first().click();
  await page.waitForSelector("text=Season Review", { timeout: 10000 });
  await page.waitForSelector("text=Final table");
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("05-season-modal.png") });
  const tableRows = await page.locator("text=Final table").locator("xpath=../following-sibling::*[1]//tbody/tr").count();
  console.log("final-table rows in modal:", tableRows);
} else {
  errors.push("no clickable season cards found after finishing a season");
}

console.log(errors.length ? `\nERRORS:\n${errors.join("\n")}` : "\nSEASON FLOW OK\nconsole errors: none");
console.log("screenshots:", OUT);
await browser.close();
process.exit(errors.length ? 1 : 0);

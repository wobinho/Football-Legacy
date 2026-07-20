// Drive the game UI at a phone viewport (iPhone 14-ish) and screenshot the
// Academy screens — the mobile companion to ui-test.mjs (dev server must be
// running). Screenshots land in UI_TEST_OUT or a temp folder (printed at the end).
import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-ui-mobile");
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, name);

const errors = [];
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await (
  await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
const keyInput = page.locator('input[spellcheck="false"]');
if (await keyInput.count()) {
  await keyInput.fill("SANTI-001");
  await page.click("text=UNLOCK");
  await page.waitForTimeout(500);
}
await page.waitForSelector("text=NEW LEGACY", { timeout: 30000 });

await page.click("text=NEW LEGACY");
await page.fill('input[placeholder="Your name"]', "Robin Ramirez");
await page.click("text=Nottingham Foresters");
await page.click("text=START LEGACY");
await page.waitForSelector("text=Inbox", { timeout: 60000 });
await page.screenshot({ path: shot("m01-home.png") });

// open the drawer and go to Academy
await page.click('button[aria-label="Open menu"]');
await page.waitForTimeout(300);
await page.screenshot({ path: shot("m02-drawer.png") });
await page.click('nav >> button:has-text("Academy")');
await page.waitForSelector("text=Academy Squad");
await page.waitForTimeout(300);
await page.screenshot({ path: shot("m03-academy-squad.png"), fullPage: true });

await page.click('button:has-text("U21 League")');
await page.waitForSelector("text=U21 Table");
await page.waitForTimeout(300);
await page.screenshot({ path: shot("m04-academy-u21.png"), fullPage: true });

// Scouting tab = assignments + reports. The scout ROSTER (hiring, "Scouting
// Department") lives on the Staff tab, so assert each against its own tab.
await page.click('button:has-text("Scouting")');
await page.waitForSelector("text=Scouts on Assignment");
await page.waitForTimeout(300);
await page.screenshot({ path: shot("m05-academy-scouting.png"), fullPage: true });

await page.click('button:has-text("Staff")');
await page.waitForSelector("text=Scouting Department");
await page.waitForTimeout(400);
await page.screenshot({ path: shot("m06-academy-staff.png"), fullPage: true });

await page.click('button:has-text("Upgrades")');
await page.waitForSelector("text=Max Scouts");
await page.waitForTimeout(300);
await page.screenshot({ path: shot("m07-academy-upgrades.png"), fullPage: true });

// hire a scout (two-step confirm) and send them out, to exercise the dense
// scouting layouts: assignment rows + the send-a-scout modal
await page.click('button:has-text("Staff")');
await page.waitForSelector("text=Available to appoint");
await page.locator('button:has-text("Appoint")').last().click();
await page.locator('button:has-text("Confirm?")').first().click();
await page.waitForTimeout(400);
await page.click('button:has-text("Scouting")');
await page.waitForSelector("text=SEND A SCOUT");
await page.click("text=+ SEND A SCOUT");
await page.waitForSelector("text=Position focus");
await page.screenshot({ path: shot("m08-send-scout-modal.png"), fullPage: true });
await page.click("text=SEND SCOUT");
await page.waitForTimeout(400);
await page.screenshot({ path: shot("m09-scouting-active.png"), fullPage: true });

// horizontal overflow check on each tab
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("html overflow-x px (upgrades tab):", overflow);

console.log("MOBILE SHOTS OK ->", OUT);
console.log("console errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();

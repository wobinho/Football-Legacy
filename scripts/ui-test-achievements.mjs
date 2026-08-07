// Drives the Achievements screen in a real browser (v2.0).
//
// `verify:achievements` owns the RULES — the ladders, the derivation, the
// wiring. This proves the screen renders them, which is the failure a rules
// verifier structurally cannot see: a tier that resolves perfectly and draws as
// a blank pill is still a broken feature.
//
// It asserts that things render and nothing throws. The numbers are the
// verifier's job, and the thresholds are tuning — so nothing here pins a tier
// to a value.
//
// Requires the dev server (npm run dev).
//   node scripts/ui-test-achievements.mjs

import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-achievements");
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, n);

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : ` — ${detail ?? ""}`}`);
  if (!cond) failures++;
};

const errors = [];
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
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
await page.fill('input[placeholder="Your name"]', "Achievements Test");
// A strong club, so several of the squad/player ladders start already unlocked
// and the EARNED state gets exercised on a fresh save rather than only the
// locked one.
await page.click("text=Manchester City");
await page.click("text=START LEGACY");
await page.waitForSelector("text=Inbox", { timeout: 60000 });

const body = () => page.locator("body").innerText();

console.log("\nThe Achievements tab");
await page.click("text=ACHIEVEMENTS");
await page.waitForTimeout(700);
await page.locator("button", { hasText: /^Achievements \(/i }).first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: shot("01-achievements.png"), fullPage: true });

let text = await body();

// Every shelf renders, including the one v2.0 added. A group that renders as
// nothing is the failure mode here — the screen filters out empty groups, so a
// group whose achievements all failed to build would simply vanish.
console.log("\nGroups");
for (const g of [
  "Silverware",
  "Squad",
  "Player",
  "Finance",
  "Transfer Market",
  "Global Club Network",
  "Legacy",
]) {
  check(`the ${g} shelf renders`, new RegExp(g, "i").test(text));
}

console.log("\nThe v2.0 catalogue");
// The combined ladder, and the achievements it replaced being gone.
check("Dynasty is present (the combined league ladder)", /DYNASTY/i.test(text));
// The old "Champions" card was the one-title achievement that Dynasty absorbed.
// Matched at the START of a line, because the word survives legitimately inside
// "European Champions" and inside the Champions League blurb — a bare
// /\bCHAMPIONS\b/ finds those and reports a card that isn't there.
check("...and 'Champions' is no longer a separate card", !/^CHAMPIONS$/im.test(text));
check("The Climb is gone", !/THE CLIMB/i.test(text));
check("Kings of the Land is gone", !/KINGS OF THE LAND/i.test(text));

check("Cup Glory is present", /CUP GLORY/i.test(text));
check("European Champions is present", /EUROPEAN CHAMPIONS/i.test(text));
check("the Europa League counterpart is present", /EUROPA KINGS/i.test(text));
check("the Conference League counterpart is present", /CONFERENCE CONQUERORS/i.test(text));

// The six squad achievements that replaced the old four.
for (const a of ["World Class Institution", "Dream Team", "Brick Wall", "Fortress", "Playmaker", "Apex"]) {
  check(`${a} is present`, new RegExp(a, "i").test(text));
}
for (const gone of ["Loaded", "Galácticos"]) {
  check(`the old '${gone}' card is gone`, !new RegExp(`\\b${gone}\\b`, "i").test(text));
}

console.log("\nTiers");
// A tier pill is the badge tier's own word. At least one must be drawn, or the
// whole tiered presentation is invisible however well it computes.
const tierWords = ["bronze", "silver", "gold", "diamond", "obsidian", "legacy"];
const shown = tierWords.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(text));
check(`a tier badge is drawn (${shown.join(", ") || "none"})`, shown.length > 0);
// The bar on a tiered card names the rung it is chasing, which is what keeps an
// already-unlocked card worth reading.
check("a card names the tier it is chasing", /Next:\s*(bronze|silver|gold|diamond|obsidian|legacy)/i.test(text));

console.log("\nThe unlock stamp");
// The specific ask: "S1" became "SEASON 1".
check("an unlock is stamped with the season spelled out", /SEASON\s+\d+/i.test(text));
check("...and the old bare 'S1' form is gone", !/✓\s*S\d+\b/.test(text));

console.log("\nThe other tabs still work");
for (const tab of ["User Accolades", "Hall of Fame", "History"]) {
  await page.locator("button", { hasText: new RegExp(`^${tab}`, "i") }).first().click();
  await page.waitForTimeout(500);
  check(`the ${tab} tab renders`, (await body()).length > 200);
}
await page.screenshot({ path: shot("02-accolades.png"), fullPage: true });

console.log("\nConsole errors");
check("no page errors during the drive", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\nScreenshots: ${OUT}`);
console.log(failures === 0 ? "Achievements UI drive passed.\n" : `${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

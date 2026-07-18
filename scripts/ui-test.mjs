// Drive the game UI end-to-end in headless Edge and capture screenshots.
import { chromium } from "playwright-core";
import path from "path";

const OUT = "C:/Users/wobin/AppData/Local/Temp/claude/c--Users-wobin-Downloads-Football-Legacy/d86b54ff-ac4f-494a-80a6-253cbc6e5e91/scratchpad";
const shot = (name) => path.join(OUT, name);

const errors = [];
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
// Access gate: unlock with a dev game key if the KeyGate is shown.
const keyInput = page.locator('input[spellcheck="false"]');
if (await keyInput.count()) {
  await keyInput.fill("SANTI-001");
  await page.click("text=UNLOCK");
  await page.waitForTimeout(500);
}
await page.waitForSelector("text=NEW LEGACY", { timeout: 30000 });
await page.screenshot({ path: shot("01-menu.png") });

// new game flow
await page.click("text=NEW LEGACY");
await page.fill('input[placeholder="Your name"]', "Robin Ramirez");
await page.click("text=Nottingham Foresters");
await page.click("text=START LEGACY");
await page.waitForSelector("text=Inbox", { timeout: 60000 });
await page.screenshot({ path: shot("02-home.png") });

// squad
await page.click('button:has-text("Squad")');
await page.waitForSelector("text=Archetype");
await page.screenshot({ path: shot("03-squad.png") });

// tactics
await page.click('button:has-text("Tactics")');
await page.waitForSelector("text=Formation");
await page.click("text=Auto-pick");
await page.waitForTimeout(300);
await page.screenshot({ path: shot("04-tactics.png") });

// continue until matchday
for (let i = 0; i < 8; i++) {
  const md = await page.locator('header >> text=MATCH DAY').count();
  if (md > 0) break;
  await page.click("text=CONTINUE ▸");
  await page.waitForTimeout(700);
}
await page.click('header >> text=MATCH DAY');
await page.waitForSelector("text=WATCH MATCH", { timeout: 15000 });
await page.screenshot({ path: shot("05-prematch.png") });

// instant result
await page.click("text=Instant result");
await page.waitForSelector("text=Full-Time Report", { timeout: 20000 });
await page.screenshot({ path: shot("06-fulltime.png") });
await page.click("text=BACK TO THE WEEK ▸");

// competition + transfers + club
await page.click('button:has-text("Competition")');
await page.waitForSelector("text=Top Scorers");
await page.screenshot({ path: shot("07-competition.png") });

await page.click('button:has-text("Transfers")');
await page.waitForSelector("text=My Listings");
await page.screenshot({ path: shot("08-transfers.png") });

await page.click('button:has-text("Club")');
await page.waitForSelector("text=Weekly Breakdown");
await page.screenshot({ path: shot("09-club.png") });

// academy (§18): squad tab, U21 league, scouting
await page.click('nav >> button:has-text("Academy")');
await page.waitForSelector("text=Academy Squad");
await page.screenshot({ path: shot("10-academy.png") });
await page.click('button:has-text("U21 League")');
await page.waitForSelector("text=U21 Table");
await page.screenshot({ path: shot("11-academy-u21.png") });
await page.click('button:has-text("Scouting")');
await page.waitForSelector("text=Scouting Department");
await page.waitForSelector("text=Upgrades"); // v7 Upgrades panel (Max Scouts / Academy Squad Size)
await page.waitForSelector("text=Max Scouts");
await page.waitForSelector("text=Academy Squad Size");
await page.screenshot({ path: shot("12-academy-scouting.png") });

// development (§5 v8): training plans tab
await page.click('nav >> button:has-text("Development")');
await page.waitForSelector("text=Training Plans");
await page.click('button:has-text("Training Plans")');
await page.waitForTimeout(300);
// change one player's plan to exercise the store action
const sel = page.locator("select").first();
if (await sel.count()) await sel.selectOption({ index: 1 }).catch(() => {});
await page.waitForTimeout(200);
await page.screenshot({ path: shot("13-training-plans.png") });

console.log("UI FLOW OK");
console.log("console errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();

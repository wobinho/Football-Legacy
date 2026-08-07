// Drive the game UI end-to-end in headless Edge and capture screenshots.
import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

// Screenshots land in UI_TEST_OUT if set, else a temp folder (printed at the end).
const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-ui");
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

// Next picks the next free port when 3000 is taken, so allow an override rather
// than failing against whatever else happens to be on 3000 (same convention as
// ui-test-facilities.mjs).
const BASE = process.env.UI_TEST_BASE || "http://localhost:3000";
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
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
// The club is taken by POSITION, never by name. This used to click
// "Nottingham Foresters", a club the shipped database renamed to "Nottingham
// Forest" when the real-club data landed — so the whole harness timed out at
// the club picker and every check after it stopped running. A hardcoded club
// name is a standing trap here; ui-test-gcn.mjs takes the same approach for the
// same reason.
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
await page.screenshot({ path: shot("02-home.png") });

// squad
await page.click('button:has-text("Squad")');
await page.waitForSelector("text=Archetype");
await page.screenshot({ path: shot("03-squad.png") });
// v14: clicking a squad row opens the profile with release / transfer-list /
// loan-list actions.
//
// The drift noted in v1.96 is fixed (v1.98): the profile's own actions have been
// SELL PLAYER / SEND ON LOAN since the sell-suitors rework, and the old
// transfer-list/loan-list labels are rendered nowhere. Re-derived from the
// screen, which is what that note asked the next caller to do.
// The squad actions are behind the profile's MANAGE tab, not on the BIO tab it
// opens on, and they are SELL PLAYER / SEND ON LOAN since the sell-suitors
// rework — the old waits were for labels on a tab the harness never opened.
// Re-derived from the screen, which is what the v1.96 drift note asked for.
await page.click("table tbody tr");
await page.waitForSelector('[role="dialog"]');
await page.click('button:has-text("MANAGE")');
await page.waitForSelector("text=Actions");
await page.waitForSelector("text=SELL PLAYER");
await page.waitForSelector("text=SEND ON LOAN");
await page.screenshot({ path: shot("03b-squad-actions.png") });
await page.click('button[aria-label="Close"]');
await page.waitForSelector("text=Actions", { state: "hidden" });

// tactics
await page.click('button:has-text("Tactics")');
await page.waitForSelector("text=Formation");
// Two "Auto-pick" buttons since v1.99 — the XI's and the bench's. Scoped to
// their own Section headers, so a bare text match can't silently start
// clicking the wrong one (it would fail Playwright's strict mode, which is the
// good case; the bad case is a future third one making this ambiguous again).
const panel = (title) => page.locator("section", { has: page.locator(`h2:text-is("${title}")`) }).first();
await panel("Lineup").getByRole("button", { name: "Auto-pick" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: shot("04-tactics.png") });

// The bench (v1.99): it sits under the pitch, holds nine seats, and every seat
// opens the sub picker on a tap — the half of the matchday squad that used to
// be drag-only. The capacity is read off the panel's own "n/9 subs" line, so
// this tracks `benchSize` rather than restating it.
const bench = panel("Bench");
await bench.getByRole("button", { name: "Auto-pick" }).click();
await page.waitForTimeout(300);
if (!(await bench.getByText("/9 subs").count())) {
  errors.push("Tactics: bench does not report a 9-sub capacity");
}
// Tap seat 1 → the sub picker opens → pick a name → it closes.
await bench.getByTitle(/drag to reorder, tap to change/).first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
await page.screenshot({ path: shot("04b-bench-picker.png") });
await page.locator('[role="dialog"] button').nth(1).click();
await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 5000 });
await page.screenshot({ path: shot("04c-bench.png") });

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

// Home AFTER a match has been played (v1.99), which is the only state the
// calendar's Results rail exists in — at kick-off of season 1 it is correctly
// absent, so the day-1 shot above proves nothing about it.
await page.click('button:has-text("Home")');
await page.waitForSelector("text=Inbox");
await page.waitForTimeout(600);
await page.screenshot({ path: shot("02b-home-played.png"), fullPage: true });
console.log(
  (await page.locator("text=Results").count()) > 0
    ? "  ok   the calendar shows a Results rail once a match has been played"
    : "  FAIL no Results rail after a played match"
);

// competition + transfers + club
await page.click('button:has-text("Competition")');
await page.waitForSelector("text=Top Scorers");
await page.screenshot({ path: shot("07-competition.png") });

// The team card, opened off a table row (v1.99). It is the only screen in the
// game that shows a club's kits, and since this version that means all FOUR of
// them — the keeper shirt included. Nothing else renders a `gk` spec outside
// the kit creator, so without this the one jersey the manager can now see here
// would go undrawn by any harness.
{
  // The table row itself is not a button — the club NAME inside it is what
  // opens the card, which is the trap a `tr button` selector falls into.
  const row = page.locator("table tbody tr").filter({ hasText: /Everton|United|City/ }).first();
  if (await row.count()) {
    await row.click({ position: { x: 120, y: 10 } }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot("07b-team-card.png"), fullPage: true });
    const keeper = await page.locator("text=keeper").count();
    console.log(keeper > 0 ? "  ok   the team card shows the keeper kit" : "  FAIL keeper kit missing from the team card");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

await page.click('button:has-text("Transfers")');
// The listings tab is "Sell / Loan"; "My Listings" was its pre-rework name.
await page.waitForSelector('button:has-text("Sell / Loan")');
await page.screenshot({ path: shot("08-transfers.png") });

// Transfer News, and the Big Money board folded into its filter strip. The wire
// is current-season only and Big Money is the all-time top 10 (v1.98), so both
// settings are worth actually rendering — an empty feed still has to draw.
await page.click('button:has-text("Transfer News")');
await page.waitForSelector("text=Market Wire");
await page.screenshot({ path: shot("08b-transfer-news.png") });
await page.click('button:has-text("BIG MONEY")');
await page.waitForSelector("text=Big Money");
await page.screenshot({ path: shot("08c-big-money.png") });

await page.click('button:has-text("Club")');
await page.waitForSelector("text=Weekly Breakdown");
await page.screenshot({ path: shot("09-club.png") });

// academy (§18): squad tab, growth, scouting. The U21 League tab is gone
// (v2.1, removed pending a rework), and so are Development (a prospect's plan
// is set by the coaching staff now) and Loaned Players (loans are unchanged —
// the tab was, the squad list tags a loanee and recalls him in place).
await page.click('nav >> button:has-text("Academy")');
await page.waitForSelector("text=Academy Squad");
await page.screenshot({ path: shot("10-academy.png") });
await page.click('button:has-text("Growth")');
await page.waitForTimeout(300);
await page.screenshot({ path: shot("11-academy-growth.png") });
// Scouting owns the whole department now: the assignments AND the hired roster
// live on this one tab. The Academy's separate Staff tab is gone (staff are a
// facility concern since v1.79) and so is its Upgrades tab, deleted outright in
// the v1.87 facilities rework — the waits below were for three ladders the
// schema no longer has.
await page.click('button:has-text("Scouting")');
await page.waitForSelector("text=Scouts on Assignment");
await page.screenshot({ path: shot("12-academy-scouting.png") });
// The hired roster is behind Scouting's own PERSONNEL sub-tab. The Academy's
// separate Staff tab is gone (staff are a facility concern since v1.79) and so
// is its Upgrades tab, deleted outright in the v1.87 facilities rework — the
// waits that used to be here were for three ladders the schema no longer has.
await page.click('button:has-text("PERSONNEL")');
await page.waitForSelector("text=Scouting Department");
await page.screenshot({ path: shot("12c-academy-scout-staff.png") });

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
console.log("screenshots:", OUT);
console.log("console errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();

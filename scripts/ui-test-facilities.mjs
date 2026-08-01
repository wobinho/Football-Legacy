// Drives the Facilities screen in a real browser (v1.79).
//
// The headless smoke test proves the RULES work. This proves the screen the
// player actually touches works: the facility renders locked, builds when you
// click Build, staff hire and assign from the Backroom tab, and the effect
// readout moves when they do.
//
// It plays the game as a player would — no reaching into the store to fund the
// club or plant state. A test that injects state stops testing what shipped, so
// this picks a club that can genuinely afford the facility at kickoff instead.
//
// Requires the dev server (npm run dev).
//   node scripts/ui-test-facilities.mjs

import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-facilities");
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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

// Next picks the next free port when 3000 is taken, so allow an override rather
// than failing against whatever else happens to be on 3000.
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
await page.fill('input[placeholder="Your name"]', "Facilities Test");
// A club that can afford the £50M build at kickoff — the point of this drive is
// the build/hire/assign flow, not the saving-up.
await page.click("text=Manchester City");
await page.click("text=START LEGACY");
await page.waitForSelector("text=Inbox", { timeout: 60000 });

const body = () => page.locator("body").innerText();

console.log("\nFacilities screen — locked state");
await page.click("text=Facilities");
await page.waitForTimeout(700);
await page.screenshot({ path: shot("01-locked.png"), fullPage: true });

let text = await body();
check("the Elite Training Center is presented", /ELITE TRAINING CENTER/i.test(text));
check("it starts locked, offering a Build action", /BUILD\s*—/i.test(text));
// v1.82: the base effect is a LABELLED stat ("PLAYER GROWTH" over "+5%"), not a
// prose string, because a multi-channel facility needs one stat per channel.
check("the base effect is stated up front", /player growth/i.test(text) && /\+5%/.test(text));

// The two facilities that replaced the Academy's Upgrades tab, and the fact
// that a multi-channel building names every quantity it governs rather than
// presenting like a one-channel one.
check("the Youth Academy is presented", /YOUTH ACADEMY/i.test(text));
check(
  "the Youth Academy names all three of its channels",
  /academy squad size/i.test(text) && /focus slots/i.test(text) && /prospect value/i.test(text)
);
check(
  "the Youth Academy's base effects are its brief's numbers",
  /\b15\b/.test(text) && /\b3\b/.test(text)
);
check("the Scouting Network is presented", /SCOUTING NETWORK/i.test(text));
check(
  "the Scouting Network names both of its channels",
  /max scouts/i.test(text) && /scouting speed/i.test(text)
);
check(
  "the level-5 capability unlock is advertised before it is bought",
  /at level 5/i.test(text) && /auto-filter/i.test(text)
);

console.log("\nBuilding it");
const buildBtn = page.locator("button", { hasText: /^Build/ }).first();
check("Build is enabled for a club that can afford it", !(await buildBtn.isDisabled()));
await buildBtn.click();
await page.waitForTimeout(800);
await page.screenshot({ path: shot("02-built.png"), fullPage: true });

text = await body();
check("after building, the current effect reads +5%", text.includes("+5%"));
check("the effect is broken into its terms", /BASE/.test(text) && /BADGES/.test(text) && /STARS/.test(text));
check("empty staff slots are shown", text.includes("Empty slot"));
check("an upgrade path is offered", /UPGRADE TO LEVEL 2/i.test(text));
// The slot grid shows the future as well as the present: at level 1 that is two
// open slots and a padlocked third, so the upgrade is visible before it is read.
check("a locked slot advertises the next level", /Locked/.test(text) && /Level 2/.test(text));
check("the star breakpoint is drawn as progress", /0\/6\s*toward the next/i.test(text));

console.log("\nInline assignment — the empty slot is the control");
const emptySlot = page.locator("button", { hasText: /Empty slot/ }).first();
check("an empty slot is clickable", (await emptySlot.count()) > 0);
await emptySlot.click();
await page.waitForTimeout(500);
text = await body();
check("clicking it opens the picker in place", /ASSIGN TO ELITE TRAINING CENTER/i.test(text));
check("with nobody hired it says so rather than showing an empty list", /Nobody available/i.test(text));
await page.screenshot({ path: shot("02b-picker-empty.png"), fullPage: true });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

console.log("\nBackroom — hire & assign");
await page.locator("button", { hasText: /^Backroom$/ }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: shot("03-backroom.png"), fullPage: true });
text = await body();
check("the backroom starts empty", text.includes("Nobody employed"));
check("a hiring market is shown", /AVAILABLE TO HIRE/i.test(text));

const hire = page.locator("button", { hasText: /^Hire$/ }).first();
check("the market offers someone to hire", (await hire.count()) > 0);

if (await hire.count()) {
  await hire.click();
  await page.waitForTimeout(300);
  const confirm = page.locator("button", { hasText: /Confirm/ }).first();
  if (await confirm.count()) await confirm.click();
  await page.waitForTimeout(800);

  text = await body();
  check("the hire lands on the roster", !text.includes("Nobody employed"));
  check("an unassigned hire is flagged as earning nothing", text.includes("Unassigned"));

  const assign = page.locator("button", { hasText: /Elite Training Center/ }).last();
  check("an assign button is offered", (await assign.count()) > 0);

  if (await assign.count()) {
    await assign.click();
    await page.waitForTimeout(800);
    text = await body();
    check("after assigning, they show as working at the facility", text.includes("Working at"));
    await page.screenshot({ path: shot("04-assigned.png"), fullPage: true });

    // NB: the sidebar nav also contains "Facilities", so match the tab button
    // exactly rather than by substring.
    await page.locator('button', { hasText: /^Facilities$/ }).first().click();
    await page.waitForTimeout(800);
    text = await body();
    check("the assigned staff member appears in a slot", text.includes("Stand down"));
    check("badge progress is explained on the card", /for the next badge|No badge here yet/.test(text));
    check("the star bar moved off zero once someone is in post", /[1-5]\/6\s*toward the next/i.test(text));
    await page.screenshot({ path: shot("05-facility-staffed.png"), fullPage: true });

    // The whole point of item 1: a second hire can be placed WITHOUT leaving
    // the Facilities tab. Hire one more from the Backroom, come back, and put
    // them in a slot from the slot itself.
    console.log("\nInline assignment — placing a hire without leaving the tab");
    await page.locator("button", { hasText: /^Backroom$/ }).first().click();
    await page.waitForTimeout(600);
    const hire2 = page.locator("button", { hasText: /^Hire$/ }).first();
    if (await hire2.count()) {
      await hire2.click();
      await page.waitForTimeout(300);
      const c2 = page.locator("button", { hasText: /Confirm/ }).first();
      if (await c2.count()) await c2.click();
      await page.waitForTimeout(700);

      await page.locator("button", { hasText: /^Facilities$/ }).first().click();
      await page.waitForTimeout(700);
      const slot2 = page.locator("button", { hasText: /Empty slot/ }).first();
      check("an empty slot is still offered for the second hire", (await slot2.count()) > 0);
      await slot2.click();
      await page.waitForTimeout(500);
      text = await body();
      check("the picker lists the unassigned hire", /Unassigned — starts a new badge here/i.test(text));
      await page.screenshot({ path: shot("06-picker-populated.png"), fullPage: true });

      // The first candidate row in the modal is the hire; clicking it assigns.
      const row = page.locator('[role="dialog"] button', { hasText: /starts a new badge here/ }).first();
      check("the picker offers a clickable candidate", (await row.count()) > 0);
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(800);
        text = await body();
        check("the picker closed after assigning", !/ASSIGN TO ELITE TRAINING CENTER/i.test(text));
        check(
          "both slots are now filled from the Facilities tab alone",
          (await page.locator("button", { hasText: /Stand down/ }).count()) === 2
        );
        await page.screenshot({ path: shot("07-both-slots-filled.png"), fullPage: true });
      }
    }
  }
}

console.log("\nConsole errors");
const real = errors.filter((e) => !/favicon|ResizeObserver/i.test(e));
check("no page errors during the drive", real.length === 0, real.slice(0, 3).join(" | "));

await browser.close();
console.log(`\nScreenshots: ${OUT}`);
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("Facilities UI drive passed.");

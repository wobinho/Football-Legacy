// Drive the v1.47 default-database flow in headless Edge.
//   node scripts/ui-test-db.mjs      (dev server must be running)
//
// Covers the three user-facing changes:
//   1. a new game defaults to the REAL database (real clubs, real players)
//   2. the Default/Generated toggle actually swaps the world
//   3. the Database Editor can import a real club/player and edit it
import { chromium } from "playwright-core";
import fs from "fs";
import os from "os";
import path from "path";

const OUT = process.env.UI_TEST_OUT || path.join(os.tmpdir(), "football-legacy-ui-db");
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, name);

const errors = [];
const fail = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail.push(label);
};

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

/** Land on the main menu, unlocking the key gate if it's showing. Wiping
 * IndexedDB clears the stored key, so the gate can reappear mid-run. */
async function openMenu() {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
  const keyInput = page.locator('input[spellcheck="false"]');
  if (await keyInput.count()) {
    await keyInput.fill("SANTI-001");
    await page.click("text=UNLOCK");
    await page.waitForTimeout(800);
  }
  await page.waitForSelector("text=NEW LEGACY", { timeout: 30000 });
}

await openMenu();

// ── 1. New game defaults to the real database ──────────────────────────────
await page.click("text=NEW LEGACY");
await page.waitForSelector("text=COUNTRY TO MANAGE IN", { timeout: 30000 });
// Real clubs need the asset fetched; wait for a known Premier League side.
await page.waitForSelector("text=Liverpool", { timeout: 30000 });
await page.screenshot({ path: shot("01-newgame-default.png"), fullPage: true });

const body = await page.textContent("body");
check("default world shows real clubs", /Liverpool/.test(body) && /Arsenal/.test(body));
check("England advertises its real pyramid", /divisions/.test(body));

// The real English ladder should now offer four tiers, and open on all four.
const fourDiv = page.locator('button:has-text("4 divisions")');
check("4-division depth offered (real English pyramid)", (await fourDiv.count()) > 0);
const fourSelected = (await fourDiv.count())
  ? await fourDiv.first().evaluate((el) => el.className.includes("border-gold"))
  : false;
check("England opens on its full authored pyramid", fourSelected);

// ── 1b. The Generated toggle must actually swap the world ──────────────────
const engRow = page.locator('div:has(> span:text-is("England"))').last();
const genBtn = page.locator('button:text-is("Generated")').first();
if (await genBtn.count()) {
  await genBtn.click();
  await page.waitForTimeout(1200);
  const generated = await page.textContent("body");
  check("Generated swaps away from the real clubs", !/Liverpool/.test(generated));
  await page.screenshot({ path: shot("01b-generated.png"), fullPage: true });
  // Back to the real database for the rest of the run.
  await page.locator('button:text-is("Default")').first().click();
  await page.waitForSelector("text=Liverpool", { timeout: 30000 });
}
void engRow;

// ── 2. Pick a real club and confirm the squad is the real squad ────────────
await page.fill('input[placeholder="Your name"]', "Robin Ramirez");
await page.click("text=Liverpool");
await page.click("text=START LEGACY");
await page.waitForSelector("text=Inbox", { timeout: 90000 });
await page.screenshot({ path: shot("02-home-real.png"), fullPage: true });

await page.click('button:has-text("Squad")');
await page.waitForSelector("text=Archetype", { timeout: 30000 });
const squad = await page.textContent("body");
check("real squad imported (Salah at Liverpool)", /Salah/.test(squad), squad.match(/M\. Salah/)?.[0] ?? "");
await page.screenshot({ path: shot("03-squad-real.png"), fullPage: true });

// ── 3. Database Editor: import a real club, then a real player ─────────────
// A save is now running, so the menu opens on Continue rather than the new-game
// form. Clear local state to get a clean main menu back.
// Wipe saves AND the custom library so the import assertions below start from a
// known-empty state on a re-run. Navigate to a blank page first so the app isn't
// holding open connections — a delete blocks indefinitely while one is live.
await page.goto("about:blank");
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs.filter((d) => d.name).map(
      (d) =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(d.name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
          setTimeout(resolve, 2000);
        })
    )
  );
});
await openMenu();
const dbBtn = page.locator('button:has-text("DATABASE")').first();
await dbBtn.click();
await page.waitForSelector("text=DATABASE EDITOR", { timeout: 30000 });
await page.screenshot({ path: shot("04-editor.png"), fullPage: true });

await page.locator('button:has-text("Import from default")').first().click();
await page.waitForSelector("text=Import from the default database", { timeout: 30000 });
// The picker opens on the first country alphabetically; switch to England so the
// assertions below are about clubs we can name.
await page.selectOption("select", "ENG");
await page.waitForSelector("text=Premier League", { timeout: 30000 });
await page.screenshot({ path: shot("05-import-clubs.png"), fullPage: true });

// Import the first listed club. Scope to the modal — the editor's own
// "Import from default" button still sits underneath it.
const modal = page.locator("div.fixed.inset-0.z-50");
await modal.locator('button:text-is("Import")').first().click();
await page.waitForTimeout(600);
const afterImport = await page.textContent("body");
check("club import registers", /Imported/.test(afterImport));
await page.screenshot({ path: shot("06-imported.png"), fullPage: true });

// Close and confirm it landed in the library as an editable entry.
await modal.locator('button[aria-label="Close"]').click();
await page.waitForTimeout(500);
const lib = await page.textContent("body");
check("imported club is in the library", /CLUBS \(1\)/.test(lib), lib.match(/CLUBS \(\d+\)/)?.[0] ?? "");
await page.screenshot({ path: shot("07-library.png"), fullPage: true });

// The club's real squad must have come along into the library too, or re-saving
// the club would silently drop it (the club modal re-maps rosters by name+pos).
const libAfter = await page.textContent("body");
const playerTab = libAfter.match(/PLAYERS \((\d+)\)/);
check("club's real squad imported as library players", Number(playerTab?.[1] ?? 0) > 10, playerTab?.[0] ?? "none");

// Open it for editing — this is the "edit the default database" requirement.
const editBtn = page.locator('button[title="Edit"], button:has-text("Edit")').first();
if (await editBtn.count()) {
  await editBtn.click();
  await page.waitForTimeout(800);
  const editing = await page.textContent("body");
  check("imported club opens in the editor", /Edit Club/.test(editing));
  // The roster must be populated — "0 added" here means the squad was lost.
  const added = editing.match(/(\d+) added/);
  check("imported club kept its real roster", Number(added?.[1] ?? 0) > 10, added?.[0] ?? "no roster count");
  await page.screenshot({ path: shot("08-edit-imported.png"), fullPage: true });

  // Save it unchanged and confirm the squad survives the round-trip.
  await page.locator('button:has-text("SAVE CLUB")').click();
  await page.waitForTimeout(700);
  await page.locator('button[title="Edit"], button:has-text("Edit")').first().click();
  await page.waitForTimeout(800);
  const reopened = await page.textContent("body");
  const kept = reopened.match(/(\d+) added/);
  check("roster survives a save round-trip", Number(kept?.[1] ?? 0) > 10, kept?.[0] ?? "no roster count");
  await page.screenshot({ path: shot("09-roundtrip.png"), fullPage: true });
}

console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log("  " + e);
console.log(`screenshots: ${OUT}`);
await browser.close();

if (fail.length || errors.length) {
  console.log(`\n${fail.length} check(s) failed, ${errors.length} console error(s).`);
  process.exit(1);
}
console.log("\nDefault-database UI flow verified.");

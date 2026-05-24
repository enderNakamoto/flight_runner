// Phase 2 sanity sweep — load each stage via ?stage=N and confirm:
//   - the right entity classes appear (birds vs drones vs jets vs UFO; pillars; missiles)
//   - fuel bar shows on stages 2..4; hidden on stage 0
//   - no console errors
// Doesn't try to win or die — just reads __TEST__.state() after a short play
// window so the spawn loops fire at least once per kind.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const STAGES = [
  { idx: 0, name: "Common",    expects: { pillars: false, fuel: false, missiles: false, birds: true,  drones: false, jets: false, ufos: false } },
  { idx: 1, name: "Uncommon",  expects: { pillars: false, fuel: true,  missiles: false, birds: true,  drones: false, jets: false, ufos: false } },
  { idx: 2, name: "Rare",      expects: { pillars: true,  fuel: true,  missiles: true,  birds: true,  drones: true,  jets: false, ufos: false } },
  { idx: 3, name: "Legendary", expects: { pillars: true,  fuel: true,  missiles: true,  birds: false, drones: true,  jets: true,  ufos: false } },
  { idx: 4, name: "Mythical",  expects: { pillars: true,  fuel: true,  missiles: true,  birds: false, drones: true,  jets: true,  ufos: true  } },
];

const ok = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d) => {
  console.error(`  ✗ ${l}`);
  if (d) console.error(d);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => fail("page error", e.message));

for (const s of STAGES) {
  console.log(`\n=== Stage ${s.idx} — ${s.name} ===`);
  await page.goto(`${BASE}/?test=1&stage=${s.idx}`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__TEST__?.ready), null, { timeout: 10_000 });

  // Tap to start, then sit at world middle to survive the spawn window.
  await page.locator("canvas").first().focus().catch(() => {});
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => window.__TEST__.phase() === "playing", null, { timeout: 2_000 });

  // Let the sim run long enough for slower spawns (UFO etc.) to fire.
  // We park near mid-world by alternating ArrowUp/ArrowDown nudges briefly,
  // then release.
  await page.waitForTimeout(80);
  await page.keyboard.up("ArrowDown");

  const observed = { pillars: false, fuel: false, missiles: false, birds: false, drones: false, jets: false, ufos: false };
  const sawKinds = new Set();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => window.__TEST__.state());
    if (st.gameOver) {
      // restart — we want to keep observing entity classes
      await page.keyboard.press("KeyR");
      await page.waitForFunction(() => window.__TEST__.phase() === "ready", null, { timeout: 2_000 });
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() => window.__TEST__.phase() === "playing", null, { timeout: 2_000 });
      continue;
    }
    if (st.pillars.length > 0) observed.pillars = true;
    if (st.missiles.length > 0) observed.missiles = true;
    if (st.fuelTokens.length > 0) observed.fuel = true; // tokens spawn → fuel system active
    for (const e of st.enemies) sawKinds.add(e.kind);
    if (sawKinds.has(0) || sawKinds.has(1)) observed.birds = true;
    if (sawKinds.has(2)) observed.drones = true;
    if (sawKinds.has(3)) observed.jets = true;
    if (sawKinds.has(4)) observed.ufos = true;

    // Early exit if we've seen everything we expected.
    const done = Object.keys(s.expects).every((k) => !s.expects[k] || observed[k]);
    if (done) break;
    await page.waitForTimeout(120);
  }

  // For 'fuel' on stage 1+, we treat fuel-bar-active as also satisfying.
  // (Stage may not spawn a token within the window even if fuel is enabled.)
  if (!observed.fuel) {
    const st = await page.evaluate(() => window.__TEST__.state());
    const stageRow = await page.evaluate((i) => {
      // STAGE_TABLE isn't exposed; infer fuel from the stage idx itself.
      return i;
    }, s.idx);
    if (stageRow >= 1) {
      // fuel drains every tick in stages 1+; check the state.fuel changed from full.
      observed.fuel = st.fuel < 100 - 0.001;
    }
  }

  let stageOK = true;
  for (const k of Object.keys(s.expects)) {
    if (s.expects[k] && !observed[k]) {
      stageOK = false;
      fail(`stage ${s.idx} (${s.name}): expected ${k}, did not observe within window`);
    }
    if (!s.expects[k] && observed[k]) {
      stageOK = false;
      fail(`stage ${s.idx} (${s.name}): observed ${k} but should NOT have`);
    }
  }
  if (stageOK) ok(`stage ${s.idx} (${s.name}) — entity set matches: ${JSON.stringify(observed)}`);

  await page.screenshot({ path: resolve(SHOTS_DIR, `stage_${s.idx}_${s.name.toLowerCase()}.png`) });
}

if (consoleErrors.length) fail("console errors during sweep", consoleErrors.join("\n"));
else console.log("\n✓ no console errors across all five stages");

await browser.close();

if (process.exitCode) console.error("\nSTAGE SWEEP FAILED");
else console.log("\nSTAGE SWEEP PASSED");

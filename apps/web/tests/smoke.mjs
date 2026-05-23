import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const URL = `${BASE}/?test=1`;

const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, details) => {
  console.error(`  ✗ ${label}`);
  if (details) console.error(details);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try {
    window.localStorage.removeItem("flight_scroll:best");
  } catch {}
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
const failedRequests = [];
page.on("requestfailed", (req) =>
  failedRequests.push(`${req.method()} ${req.url()} ${req.failure()?.errorText}`),
);

console.log(`navigating ${URL}`);
await page.goto(URL, { waitUntil: "load" });

await page.waitForFunction(() => Boolean(window.__TEST__?.ready), null, {
  timeout: 10_000,
});
ok("test seam ready");

const readyState = await page.evaluate(() => window.__TEST__.state());
if (readyState.phase !== "ready") fail(`expected phase=ready, got ${readyState.phase}`);
else ok(`phase=ready (score=${readyState.score}, pillars=${readyState.pillars}, plane.y=${readyState.plane.y})`);
if (readyState.tick !== 0) fail(`expected tick=0 in ready, got ${readyState.tick}`);
else ok("tick=0 in ready");

await page.screenshot({ path: resolve(SHOTS_DIR, "01_ready.png") });
ok("screenshot 01_ready.png");

await page.locator("canvas").first().focus().catch(() => {});

// Tap ArrowDown once to leave the ready state (any steer key starts play).
await page.keyboard.press("ArrowDown");
await page.waitForFunction(
  () => window.__TEST__?.phase() === "playing",
  null,
  { timeout: 2_000 },
);
ok("phase=playing after ArrowDown tap");

// With no key held, plane should hold altitude (vy near 0, y unchanged across ticks).
await page.waitForTimeout(300);
const idle = await page.evaluate(() => window.__TEST__.state());
if (Math.abs(idle.plane.vy) > 0.001)
  fail(`expected vy≈0 with no input, got ${idle.plane.vy}`);
else ok(`no-input → altitude held (vy=${idle.plane.vy}, y=${idle.plane.y})`);
if (Math.abs(idle.plane.y - readyState.plane.y) > 0.5)
  fail(`expected plane.y unchanged with no input, got y=${idle.plane.y}`);
else ok("plane.y unchanged with no input — no gravity");

// Hold ArrowUp → plane should rise.
const yBeforeUp = idle.plane.y;
await page.keyboard.down("ArrowUp");
await page.waitForTimeout(250);
const rising = await page.evaluate(() => window.__TEST__.state());
await page.keyboard.up("ArrowUp");
if (rising.plane.vy >= 0)
  fail(`expected vy<0 while ArrowUp held, got ${rising.plane.vy}`);
else ok(`ArrowUp held → vy=${rising.plane.vy} (rising)`);
if (rising.plane.y >= yBeforeUp)
  fail(`expected plane.y to decrease while ArrowUp held, got ${rising.plane.y} (was ${yBeforeUp})`);
else ok(`plane rose: y ${yBeforeUp.toFixed(1)} → ${rising.plane.y.toFixed(1)}`);

// Hold ArrowDown → plane should sink.
await page.waitForTimeout(80);
const yBeforeDown = (await page.evaluate(() => window.__TEST__.state())).plane.y;
await page.keyboard.down("ArrowDown");
await page.waitForTimeout(250);
const sinking = await page.evaluate(() => window.__TEST__.state());
if (sinking.plane.vy <= 0)
  fail(`expected vy>0 while ArrowDown held, got ${sinking.plane.vy}`);
else ok(`ArrowDown held → vy=${sinking.plane.vy} (sinking)`);
if (sinking.plane.y <= yBeforeDown)
  fail(`expected plane.y to increase while ArrowDown held, got ${sinking.plane.y} (was ${yBeforeDown})`);
else ok(`plane sank: y ${yBeforeDown.toFixed(1)} → ${sinking.plane.y.toFixed(1)}`);

await page.screenshot({ path: resolve(SHOTS_DIR, "02_playing.png") });
ok("screenshot 02_playing.png");

// Keep ArrowDown held — plane should leave the world (y > WORLD_HEIGHT) and die.
console.log("holding ArrowDown until plane exits world…");
await page.waitForFunction(
  () => window.__TEST__?.state().gameOver === true,
  null,
  { timeout: 10_000 },
);
await page.keyboard.up("ArrowDown");
const dead = await page.evaluate(() => window.__TEST__.state());
ok(`game over: phase=${dead.phase}, tick=${dead.tick}, plane.y=${dead.plane.y.toFixed(0)}`);
await page.screenshot({ path: resolve(SHOTS_DIR, "03_gameover.png") });
ok("screenshot 03_gameover.png");

await page.keyboard.press("KeyR");
await page.waitForFunction(
  () => window.__TEST__?.phase() === "ready" && window.__TEST__?.state().tick === 0,
  null,
  { timeout: 3_000 },
);
ok("restart returned to ready state");

if (consoleErrors.length) fail("console errors", consoleErrors.join("\n"));
else ok("no console errors");
if (pageErrors.length) fail("page errors", pageErrors.join("\n"));
else ok("no uncaught page errors");
if (failedRequests.length) fail("failed requests", failedRequests.join("\n"));
else ok("no failed requests");

await browser.close();

if (process.exitCode) {
  console.error("\nSMOKE TEST FAILED");
} else {
  console.log("\nSMOKE TEST PASSED");
}

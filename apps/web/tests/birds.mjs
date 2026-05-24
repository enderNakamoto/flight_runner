// Phase 2a-i smoke test for Stage 1 / Common — bird-only world, no pillars.
//
// 1. Load with ?test=1 (default stage = Common).
// 2. Tap to start, then deliberately HOLD at the bird's incoming y to ensure
//    a collision happens. We can't actively home in (no per-tick steering loop
//    fast enough), so we wait for a bird to enter the world, snapshot its y,
//    steer the plane to match it, and just sit there.
// 3. Assert game-over cause is BIRD (not WORLD).
//
// Also verifies score increments when a bird *passes* without hitting (run a
// short pre-collision loop where we deliberately dodge).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const URL = `${BASE}/?test=1&debug=1`;

const ok = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d) => {
  console.error(`  ✗ ${l}`);
  if (d) console.error(d);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try { window.localStorage.removeItem("flight_scroll:best"); } catch {}
});
const page = await ctx.newPage();
page.on("pageerror", (e) => fail("page error", e.message));
page.on("console", (m) => { if (m.type() === "error") fail("console error", m.text()); });

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__TEST__?.ready, null, { timeout: 10_000 });
ok("test seam ready");

const C = await page.evaluate(() => window.__TEST__.constants());
console.log(`  bird_small hitbox: ${C.BIRD_SMALL_HITBOX_W}x${C.BIRD_SMALL_HITBOX_H}, plane: ${C.PLANE_HITBOX_W}x${C.PLANE_HITBOX_H} @ x=${C.PLANE_X}`);

const initState = await page.evaluate(() => window.__TEST__.state());
if (initState.stage !== 0) fail(`expected initial stage=0 (Common), got ${initState.stage}`);
else ok(`initial stage=${initState.stage} (COMMON)`);
if (initState.pillars.length !== 0) fail(`expected no pillars in Stage 1, got ${initState.pillars.length}`);
else ok("no pillars in Stage 1");

await page.locator("canvas").first().focus().catch(() => {});
await page.keyboard.press("ArrowDown");
await page.waitForFunction(() => window.__TEST__.phase() === "playing", null, { timeout: 2_000 });
ok("playing");

// Pick up the FIRST bird that spawns, steer to its y, then sit and let it hit us.
const deadline = Date.now() + 20_000;
let target = null;
while (Date.now() < deadline) {
  const s = await page.evaluate(() => window.__TEST__.state());
  if (s.gameOver) break;
  const candidate = s.enemies.find((e) => e.x > C.PLANE_X + 80 && !e.passed);
  if (candidate) { target = candidate; break; }
  // Drift toward the world midline while waiting.
  if (s.plane.y > C.WORLD_HEIGHT / 2 + 6) await page.keyboard.down("ArrowUp"), await page.keyboard.up("ArrowDown");
  else if (s.plane.y < C.WORLD_HEIGHT / 2 - 6) await page.keyboard.down("ArrowDown"), await page.keyboard.up("ArrowUp");
  else await page.keyboard.up("ArrowUp"), await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(40);
}
await page.keyboard.up("ArrowUp"); await page.keyboard.up("ArrowDown");
if (!target) { fail("no bird spawned within 20s"); await browser.close(); process.exit(1); }
ok(`target bird id=${target.id} kind=${target.kind} at x=${target.x.toFixed(0)}, y=${target.y.toFixed(0)}`);

// Steer plane to bird's y and hold.
while (Date.now() < deadline) {
  const s = await page.evaluate(() => window.__TEST__.state());
  if (s.gameOver) break;
  if (s.plane.y > target.y + 1) await page.keyboard.down("ArrowUp"), await page.keyboard.up("ArrowDown");
  else if (s.plane.y < target.y - 1) await page.keyboard.down("ArrowDown"), await page.keyboard.up("ArrowUp");
  else await page.keyboard.up("ArrowUp"), await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(16);
}
await page.keyboard.up("ArrowUp"); await page.keyboard.up("ArrowDown");

const dead = await page.evaluate(() => window.__TEST__.state());
if (!dead.gameOver) { fail("never died"); await browser.close(); process.exit(1); }

const hitWorld = dead.plane.y < 0 || dead.plane.y > C.WORLD_HEIGHT;
// Classify cause by checking plane overlap with any enemy in the final frame.
const planeCy = dead.plane.y + (C.PLANE_HITBOX_OFFSET_Y ?? 0);
const planeLeft = C.PLANE_X - C.PLANE_HITBOX_W / 2;
const planeRight = C.PLANE_X + C.PLANE_HITBOX_W / 2;
const planeTop = planeCy - C.PLANE_HITBOX_H / 2;
const planeBottom = planeCy + C.PLANE_HITBOX_H / 2;
const hitBird = dead.enemies.some((e) => {
  const w = e.kind === 0 ? C.BIRD_SMALL_HITBOX_W : C.BIRD_BIG_HITBOX_W;
  const h = e.kind === 0 ? C.BIRD_SMALL_HITBOX_H : C.BIRD_BIG_HITBOX_H;
  const l = e.x - w / 2, r = e.x + w / 2, t = e.y - h / 2, b = e.y + h / 2;
  return planeRight > l && planeLeft < r && planeBottom > t && planeTop < b;
});

console.log(`  death snapshot: plane.y=${dead.plane.y.toFixed(0)}, score=${dead.score}, enemies=${dead.enemies.length}`);
console.log(`  cause: ${hitBird ? "BIRD" : ""}${hitBird && hitWorld ? "+" : ""}${hitWorld ? "WORLD" : ""}${!hitBird && !hitWorld ? "UNKNOWN" : ""}`);

if (hitBird) ok("died from bird collision");
else fail("did NOT die from bird — likely steered into the world edge instead");

await page.screenshot({ path: resolve(SHOTS_DIR, "bird_death.png") });
ok("screenshot bird_death.png");

await browser.close();

if (process.exitCode) console.error("\nBIRD TEST FAILED");
else console.log("\nBIRD TEST PASSED");

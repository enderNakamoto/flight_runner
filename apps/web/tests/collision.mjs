// Drives the plane into the closed half of an approaching pillar and asserts
// the sim ends the run from pillar contact (not world-bounds).
//
// Strategy: each tick (loop @ 16ms), look at the next-not-passed pillar:
//   - if its right edge is past the plane's collision band, treat as passed
//   - otherwise: aim for "definitely closed" — fly to y=20 (top wall) or
//     y=WORLD_HEIGHT-20 (bottom wall), whichever takes us further from the
//     pillar's gapY. Hold the key.
// The plane has plenty of vertical travel time before the pillar arrives, so
// it will be parked in a closed band when the pillar reaches it.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";
// Force-spawn the run at Stage 2 (Rare) where pillarsEnabled = true.
// Stages 0–1 (Common, Uncommon) are open-sky bird-only and have no pillars.
const URL = `${BASE}/?test=1&debug=1&stage=2`;

const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, details) => {
  console.error(`  ✗ ${label}`);
  if (details) console.error(details);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try { window.localStorage.removeItem("flight_scroll:best"); } catch {}
});
const page = await ctx.newPage();

page.on("pageerror", (err) => fail("page error", err.message));

console.log(`navigating ${URL}`);
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__TEST__?.ready), null, { timeout: 10_000 });
ok("test seam ready");

const C = await page.evaluate(() => window.__TEST__.constants());
console.log(`  constants: plane=${C.PLANE_HITBOX_W}x${C.PLANE_HITBOX_H} at x=${C.PLANE_X}, pillar gap=${C.PILLAR_GAP}, width=${C.PILLAR_WIDTH}`);

// Kick off play
await page.locator("canvas").first().focus().catch(() => {});
await page.keyboard.press("ArrowDown");
await page.waitForFunction(() => window.__TEST__?.phase() === "playing", null, { timeout: 2_000 });
ok("playing");

let heldKey = null;
const press = async (k) => {
  if (heldKey === k) return;
  if (heldKey) await page.keyboard.up(heldKey);
  heldKey = k;
  if (k) await page.keyboard.down(k);
};

const deadline = Date.now() + 30_000;
let lastSnap = null;
while (Date.now() < deadline) {
  const s = await page.evaluate(() => window.__TEST__.state());
  lastSnap = s;
  if (s.gameOver) break;

  // Pick the next pillar whose right edge is at or past the plane band.
  const target = s.pillars.find((p) => p.x + C.PILLAR_WIDTH >= C.PLANE_X - 80);
  if (!target) {
    // No pillar in sight: park at world middle so we don't drift out of bounds.
    if (s.plane.y > C.WORLD_HEIGHT / 2 + 4) await press("ArrowUp");
    else if (s.plane.y < C.WORLD_HEIGHT / 2 - 4) await press("ArrowDown");
    else await press(null);
  } else {
    // Aim for the wall farther from the pillar's gap centre.
    const distToTop = target.gapY;
    const distToBottom = C.WORLD_HEIGHT - target.gapY;
    const aimY = distToTop > distToBottom ? 20 : C.WORLD_HEIGHT - 20;
    if (s.plane.y > aimY + 2) await press("ArrowUp");
    else if (s.plane.y < aimY - 2) await press("ArrowDown");
    else await press(null);
  }

  await page.waitForTimeout(16);
}

await press(null);

if (!lastSnap) {
  fail("never got a state snapshot");
} else if (!lastSnap.gameOver) {
  fail("timed out without dying", `final: ${JSON.stringify(lastSnap)}`);
} else {
  // Classify cause-of-death.
  const planeCy = lastSnap.plane.y + (C.PLANE_HITBOX_OFFSET_Y ?? 0);
  const planeLeft = C.PLANE_X - C.PLANE_HITBOX_W / 2;
  const planeRight = C.PLANE_X + C.PLANE_HITBOX_W / 2;
  const planeTop = planeCy - C.PLANE_HITBOX_H / 2;
  const planeBottom = planeCy + C.PLANE_HITBOX_H / 2;

  const hitWorld =
    lastSnap.plane.y < 0 || lastSnap.plane.y > C.WORLD_HEIGHT;
  const insetX = (C.PILLAR_WIDTH - C.PILLAR_HITBOX_W) / 2;
  const hitPillar = lastSnap.pillars.some((p) => {
    const pl = p.x + insetX;
    const pr = p.x + C.PILLAR_WIDTH - insetX;
    if (!(planeRight > pl && planeLeft < pr)) return false;
    const visGapTop = p.gapY - C.PILLAR_GAP / 2;
    const visGapBottom = p.gapY + C.PILLAR_GAP / 2;
    const topInset = (visGapTop * C.PILLAR_TOP_GAP_PAD_SRC) / C.PILLAR_SRC_H;
    const botInset = ((C.WORLD_HEIGHT - visGapBottom) * C.PILLAR_BOT_GAP_PAD_SRC) / C.PILLAR_SRC_H;
    const gapTop = visGapTop - topInset;
    const gapBottom = visGapBottom + botInset;
    return planeTop < gapTop || planeBottom > gapBottom;
  });

  console.log(`  death snapshot: plane.y=${lastSnap.plane.y.toFixed(1)}, tick=${lastSnap.tick}, score=${lastSnap.score}`);
  console.log(`  pillars at death: ${JSON.stringify(lastSnap.pillars)}`);
  console.log(`  cause: ${hitPillar ? "PILLAR" : ""}${hitPillar && hitWorld ? "+" : ""}${hitWorld ? "WORLD" : ""}${!hitPillar && !hitWorld ? "UNKNOWN" : ""}`);

  if (hitPillar) ok("died from pillar collision");
  else fail("did NOT die from pillar — sim says gameOver but no pillar overlap detected",
            "this is the suspected MVP bug: visible touch without sim collision");
}

await page.screenshot({ path: resolve(SHOTS_DIR, "collision_death.png"), fullPage: false });
ok("screenshot collision_death.png");

await browser.close();

if (process.exitCode) {
  console.error("\nCOLLISION TEST FAILED");
} else {
  console.log("\nCOLLISION TEST PASSED");
}

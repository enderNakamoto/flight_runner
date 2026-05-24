// Screenshot a fuel token in flight at Uncommon stage so we can eyeball the
// spin animation. Also dump the actual sprite scaleX/scaleY over a few frames
// to make sure the displayed size is what we think it is.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/?test=1&stage=1`, { waitUntil: "load" });
await page.waitForFunction(() => Boolean(window.__TEST__?.ready), null, { timeout: 10_000 });
await page.locator("canvas").first().focus().catch(() => {});
await page.keyboard.press("ArrowDown");
await page.waitForFunction(() => window.__TEST__.phase() === "playing", null, { timeout: 2_000 });

// Park near the world middle so the plane survives long enough to see a token.
const C = await page.evaluate(() => window.__TEST__.constants());
const PARK_Y = C.WORLD_HEIGHT / 2;
const deadline = Date.now() + 20_000;
let captured = false;
while (Date.now() < deadline) {
  const s = await page.evaluate(() => window.__TEST__.state());
  if (s.gameOver) {
    await page.keyboard.press("KeyR");
    await page.waitForFunction(() => window.__TEST__.phase() === "ready", null, { timeout: 2_000 });
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => window.__TEST__.phase() === "playing", null, { timeout: 2_000 });
    continue;
  }
  if (s.fuelTokens.length > 0 && s.fuelTokens[0].x > 100 && s.fuelTokens[0].x < C.WORLD_WIDTH - 100) {
    // Take a few screenshots across the spin cycle.
    for (let i = 0; i < 5; i++) {
      await page.screenshot({ path: resolve(SHOTS_DIR, `token_spin_${i}.png`) });
      // Inspect sprite scale in the next frame
      const data = await page.evaluate(() => {
        const game = (window).game ?? Phaser.GAMES?.[0];
        const scene = game?.scene?.getScene?.("PlayScene");
        if (!scene) return null;
        // Find all images with texture 'fuel_token'
        const tokens = scene.children.list.filter(c => c.texture?.key === "fuel_token");
        return tokens.map(t => ({ x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY, displayWidth: t.displayWidth, displayHeight: t.displayHeight }));
      });
      console.log(`frame ${i}:`, data);
      await page.waitForTimeout(120);
    }
    captured = true;
    break;
  }
  if (s.plane.y > PARK_Y + 6) await page.keyboard.down("ArrowUp"), await page.keyboard.up("ArrowDown");
  else if (s.plane.y < PARK_Y - 6) await page.keyboard.down("ArrowDown"), await page.keyboard.up("ArrowUp");
  else await page.keyboard.up("ArrowUp"), await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(80);
}

await browser.close();
if (!captured) console.error("never saw a token in view");

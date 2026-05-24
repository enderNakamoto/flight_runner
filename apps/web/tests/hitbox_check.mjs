// Verifies the sim's pillar hitbox actually contains the visible cloud silhouette.
//
// Method:
//   1. Load top_pillar.png and bottom_pillar.png in a real browser (Playwright).
//   2. For each, measure the bounding box of opaque pixels (alpha > 30) in
//      source-image coordinates → cloud_bbox_src.
//   3. Pick a real in-game pillar via the live test seam, read its gapY and x,
//      and compute the *displayed* cloud bounding box from cloud_bbox_src + the
//      sprite's setDisplaySize transform (the sprites are anchored at the gap
//      edge so vertical scaling is non-uniform per pillar).
//   4. Compare displayed cloud bbox to the sim's hitbox rect:
//        - cloud_outside_hitbox  → cloud pixels the player can SEE but that the
//          sim treats as empty space (visible touches that don't kill). Bad.
//        - hitbox_outside_cloud  → hitbox area beyond the cloud silhouette
//          (sky-blue pixels that DO kill). User flagged this as "too big".
//   5. Print both metrics for top and bottom pillar; assert the cloud is fully
//      contained in the hitbox.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const ok = (label) => console.log(`  ✓ ${label}`);
const fail = (label, details) => {
  console.error(`  ✗ ${label}`);
  if (details) console.error(details);
  process.exitCode = 1;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => fail("page error", e.message));

// Navigate first so relative URLs resolve and the origin is set.
await page.goto(`${BASE}/?test=1&debug=1`, { waitUntil: "load" });

// ---- Step 1+2: measure alpha bboxes of the source PNGs ----
console.log("measuring source PNG alpha bboxes…");
const srcBoxes = await page.evaluate(async (base) => {
  async function bbox(url) {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = (e) => rej(new Error(`failed to load ${url}: ${e?.message ?? e}`));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = c.width, maxX = -1, minY = c.height, maxY = -1, opaque = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const a = data[(y * c.width + x) * 4 + 3];
        if (a > 30) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          opaque++;
        }
      }
    }
    return { w: c.width, h: c.height, minX, maxX, minY, maxY, opaque };
  }
  return {
    top: await bbox(`${base}/assets/obstacles/top_pillar.png`),
    bottom: await bbox(`${base}/assets/obstacles/bottom_pillar.png`),
  };
}, BASE);

console.log("  top_pillar.png    :", srcBoxes.top);
console.log("  bottom_pillar.png :", srcBoxes.bottom);

// ---- Step 3: pull a live pillar from the game ----
console.log("reading a real pillar's geometry from the game…");
await page.waitForFunction(() => window.__TEST__?.ready, null, { timeout: 10_000 });
const C = await page.evaluate(() => window.__TEST__.constants());

// Tap to start, then steer to mid-screen so we stay alive long enough to see a pillar.
await page.locator("canvas").first().focus().catch(() => {});
await page.keyboard.press("ArrowDown");
await page.waitForFunction(() => window.__TEST__.phase() === "playing", null, { timeout: 2_000 });

// Park near the world middle so we don't immediately die before a pillar arrives.
const PARK_Y = C.WORLD_HEIGHT / 2;
const parkTo = async () => {
  const s = await page.evaluate(() => window.__TEST__.state());
  if (s.gameOver) return s;
  if (s.plane.y > PARK_Y + 6) await page.keyboard.down("ArrowUp"), await page.keyboard.up("ArrowDown");
  else if (s.plane.y < PARK_Y - 6) await page.keyboard.down("ArrowDown"), await page.keyboard.up("ArrowUp");
  else await page.keyboard.up("ArrowUp"), await page.keyboard.up("ArrowDown");
  return s;
};

// Sample many pillars over time so we cover a range of gapY values (and thus
// a range of displayed pillar heights — the per-pillar inset math has to hold
// across the full PILLAR_GAP_MIN_Y..PILLAR_GAP_MAX_Y range, not just one row).
const PILLAR_SAMPLES = 6;
const deadline = Date.now() + 25_000;
const sampled = new Map(); // pillar id -> snapshot
while (Date.now() < deadline && sampled.size < PILLAR_SAMPLES) {
  const s = await parkTo();
  if (s.gameOver) break;
  for (const p of s.pillars) {
    if (sampled.has(p.id)) continue;
    if (p.x > C.PLANE_X + 100 && p.x < C.WORLD_WIDTH - 200) {
      sampled.set(p.id, { ...p });
    }
  }
  await page.waitForTimeout(60);
}
await page.keyboard.up("ArrowUp"); await page.keyboard.up("ArrowDown");
if (sampled.size === 0) {
  fail("no pillars in measurement band before timeout");
  await browser.close();
  process.exit(1);
}
ok(`sampled ${sampled.size} pillars, gapY range ${Math.min(...[...sampled.values()].map(p => p.gapY))}..${Math.max(...[...sampled.values()].map(p => p.gapY))}`);

await page.screenshot({ path: resolve(SHOTS_DIR, "hitbox_check.png") });
ok("screenshot hitbox_check.png");

// ---- Step 4: math ----
// Top pillar: anchor (0.5, 1) at (p.x + W/2, gapY - GAP/2). Display size = (W, gapY - GAP/2).
// So it covers x ∈ [p.x, p.x + W], y ∈ [0, gapY - GAP/2].
// Source alpha bbox in source coords: srcBoxes.top.{minX,maxX,minY,maxY} of size (srcW, srcH).
// Linear stretch: sx = displayedW / srcW; sy = displayedH / srcH.
// Cloud in displayed coords:
//   cx_lo = p.x + minX * sx
//   cx_hi = p.x + maxX * sx
//   cy_lo = minY * sy             (y is from top, since image rendered top-down then anchored bottom)
//   cy_hi = maxY * sy
//
// Hitbox in displayed coords:
//   hx_lo = p.x + (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2
//   hx_hi = p.x + PILLAR_WIDTH - (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2
//   hy_lo = 0
//   hy_hi = (gapY - PILLAR_GAP/2) - PILLAR_HITBOX_INSET_Y
//
// For bottom pillar (anchor 0.5, 0 at gapY + GAP/2; display height = WORLD_HEIGHT - (gapY + GAP/2)):
//   covers x ∈ [p.x, p.x + W], y ∈ [gapY + GAP/2, WORLD_HEIGHT].

function computeFor(pillarSide, srcBox, displayedWidthPx, displayedHeightPx, baseX, baseY) {
  const sx = displayedWidthPx / srcBox.w;
  const sy = displayedHeightPx / srcBox.h;
  // Inclusive→exclusive: add 1 to max to count the pixel.
  const cx_lo = baseX + srcBox.minX * sx;
  const cx_hi = baseX + (srcBox.maxX + 1) * sx;
  const cy_lo = baseY + srcBox.minY * sy;
  const cy_hi = baseY + (srcBox.maxY + 1) * sy;

  const hx_lo = baseX + (C.PILLAR_WIDTH - C.PILLAR_HITBOX_W) / 2;
  const hx_hi = baseX + C.PILLAR_WIDTH - (C.PILLAR_WIDTH - C.PILLAR_HITBOX_W) / 2;
  let hy_lo, hy_hi;
  if (pillarSide === "top") {
    const inset = (displayedHeightPx * C.PILLAR_TOP_GAP_PAD_SRC) / C.PILLAR_SRC_H;
    hy_lo = 0;
    hy_hi = baseY + displayedHeightPx - inset;
  } else {
    const inset = (displayedHeightPx * C.PILLAR_BOT_GAP_PAD_SRC) / C.PILLAR_SRC_H;
    hy_lo = baseY + inset;
    hy_hi = baseY + displayedHeightPx;
  }

  const cloudLeak = {
    left:   Math.max(0, hx_lo - cx_lo),  // cloud sticks out to the left of hitbox
    right:  Math.max(0, cx_hi - hx_hi),
    top:    pillarSide === "top" ? 0 : Math.max(0, hy_lo - cy_lo),
    bottom: pillarSide === "top" ? Math.max(0, cy_hi - hy_hi) : 0,
  };
  const hitboxSlack = {
    left:   Math.max(0, cx_lo - hx_lo),  // hitbox extends left of cloud
    right:  Math.max(0, hx_hi - cx_hi),
    top:    pillarSide === "top" ? 0 : Math.max(0, cy_lo - hy_lo),
    bottom: pillarSide === "top" ? Math.max(0, hy_hi - cy_hi) : 0,
  };

  return {
    cloud: { x: [cx_lo, cx_hi], y: [cy_lo, cy_hi] },
    hitbox: { x: [hx_lo, hx_hi], y: [hy_lo, hy_hi] },
    cloudLeak, hitboxSlack,
    displayed: { w: displayedWidthPx, h: displayedHeightPx, sx, sy },
  };
}

// Hard assertions.
const LEAK_TOL = 1.0; // sub-pixel rounding tolerance
let worstLeak = 0, worstSlack = 0;

for (const p of sampled.values()) {
  const topH = p.gapY - C.PILLAR_GAP / 2;
  const bottomH = C.WORLD_HEIGHT - (p.gapY + C.PILLAR_GAP / 2);
  const topR = computeFor("top",    srcBoxes.top,    C.PILLAR_WIDTH, topH,    p.x, 0);
  const botR = computeFor("bottom", srcBoxes.bottom, C.PILLAR_WIDTH, bottomH, p.x, p.gapY + C.PILLAR_GAP / 2);

  console.log(`\npillar id=${p.id}  gapY=${p.gapY}  (top h=${topH}, bottom h=${bottomH})`);
  console.log(`  TOP    cloud y=[${topR.cloud.y[0].toFixed(1)}, ${topR.cloud.y[1].toFixed(1)}]  hitbox y=[${topR.hitbox.y[0].toFixed(1)}, ${topR.hitbox.y[1].toFixed(1)}]  leak B=${topR.cloudLeak.bottom.toFixed(2)}  slack LR/B=${topR.hitboxSlack.left.toFixed(1)}/${topR.hitboxSlack.right.toFixed(1)} ${topR.hitboxSlack.bottom.toFixed(1)}`);
  console.log(`  BOTTOM cloud y=[${botR.cloud.y[0].toFixed(1)}, ${botR.cloud.y[1].toFixed(1)}]  hitbox y=[${botR.hitbox.y[0].toFixed(1)}, ${botR.hitbox.y[1].toFixed(1)}]  leak T=${botR.cloudLeak.top.toFixed(2)}  slack LR/T=${botR.hitboxSlack.left.toFixed(1)}/${botR.hitboxSlack.right.toFixed(1)} ${botR.hitboxSlack.top.toFixed(1)}`);

  const leak = Math.max(
    topR.cloudLeak.left, topR.cloudLeak.right, topR.cloudLeak.bottom,
    botR.cloudLeak.left, botR.cloudLeak.right, botR.cloudLeak.top,
  );
  const slack = Math.max(
    topR.hitboxSlack.left, topR.hitboxSlack.right, topR.hitboxSlack.bottom,
    botR.hitboxSlack.left, botR.hitboxSlack.right, botR.hitboxSlack.top,
  );
  worstLeak = Math.max(worstLeak, leak);
  worstSlack = Math.max(worstSlack, slack);

  if (leak > LEAK_TOL) fail(`pillar id=${p.id} (gapY=${p.gapY}) leaks ${leak.toFixed(1)}px outside hitbox`);
}

console.log("");
if (worstLeak <= LEAK_TOL) ok(`all ${sampled.size} pillars: cloud fully inside hitbox (worst leak ${worstLeak.toFixed(2)}px ≤ ${LEAK_TOL})`);
console.log(`  worst hitbox slack across all samples: ${worstSlack.toFixed(1)}px (this is hitbox area beyond the visible cloud — the "phantom kill" zone)`);

await browser.close();

if (process.exitCode) {
  console.error("\nHITBOX CHECK FAILED");
} else {
  console.log("\nHITBOX CHECK PASSED");
}

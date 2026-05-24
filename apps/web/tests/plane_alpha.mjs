// One-shot — measure the actual silhouette of plane.png so we can size the
// hitbox tightly instead of using the sprite bounding box.

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/?test=1`, { waitUntil: "load" });

const result = await page.evaluate(async (url) => {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  // Body bbox (alpha > 30)
  let minX = c.width, maxX = -1, minY = c.height, maxY = -1, opaque = 0;
  // Per-row stats so we can pick a "fuselage band" too (rows where the plane
  // is wide — the body, not just tail wisps).
  const rowOpaque = new Array(c.height).fill(0);
  for (let y = 0; y < c.height; y++) {
    let rowMin = c.width, rowMax = -1, count = 0;
    for (let x = 0; x < c.width; x++) {
      const a = data[(y * c.width + x) * 4 + 3];
      if (a > 30) {
        if (x < rowMin) rowMin = x;
        if (x > rowMax) rowMax = x;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        opaque++;
      }
    }
    rowOpaque[y] = count;
  }
  // Pick the y-band where row coverage >= 40% of the widest row.
  const maxRow = Math.max(...rowOpaque);
  const threshold = maxRow * 0.4;
  let bandTop = -1, bandBottom = -1;
  for (let y = 0; y < c.height; y++) {
    if (rowOpaque[y] >= threshold) {
      if (bandTop === -1) bandTop = y;
      bandBottom = y;
    }
  }
  return {
    w: c.width, h: c.height, opaque,
    bbox: { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
    body: { minY: bandTop, maxY: bandBottom, h: bandBottom - bandTop + 1, widestRow: maxRow },
  };
}, `${BASE}/assets/plane.png`);

// Per-row alpha bbox so we can carve the silhouette into rectangles.
const rowDetail = await page.evaluate(async (url) => {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const rows = [];
  for (let y = 0; y < c.height; y++) {
    let lo = c.width, hi = -1, n = 0;
    for (let x = 0; x < c.width; x++) {
      const a = data[(y * c.width + x) * 4 + 3];
      if (a > 30) { if (x < lo) lo = x; if (x > hi) hi = x; n++; }
    }
    rows.push({ y, lo, hi, w: hi - lo + 1, n });
  }
  return rows;
}, `${BASE}/assets/plane.png`);

console.log("\nper-row silhouette (only rows with content shown):");
for (const r of rowDetail) {
  if (r.n === 0) continue;
  console.log(`  y=${String(r.y).padStart(3)}  x=[${String(r.lo).padStart(3)}, ${String(r.hi).padStart(3)}]  w=${String(r.w).padStart(3)}  n=${r.n}`);
}

console.log("\nplane.png:");
console.log(`  source size:   ${result.w}×${result.h}`);
console.log(`  opaque pixels: ${result.opaque}`);
console.log(`  bbox (alpha>30): x=[${result.bbox.minX}, ${result.bbox.maxX}] (w=${result.bbox.w}), y=[${result.bbox.minY}, ${result.bbox.maxY}] (h=${result.bbox.h})`);
console.log(`  fuselage band (≥40% of widest row=${result.body.widestRow}px): y=[${result.body.minY}, ${result.body.maxY}] (h=${result.body.h})`);

// Compute what the hitbox should be at displayed size 256×128 (1:1 with source).
const w = result.bbox.w;
const h = result.bbox.h;
const bodyH = result.body.h;
console.log("\nrecommendation (display 256×128, 1:1 with source):");
console.log(`  PLANE_HITBOX_W = ${Math.round(w * 0.92)}   (92% of silhouette width ${w}, leaves ~4% slack each side)`);
console.log(`  PLANE_HITBOX_H = ${Math.round(bodyH * 1.05)}   (5% over fuselage band ${bodyH}px — wings/landing gear included if they're near the body)`);

await browser.close();

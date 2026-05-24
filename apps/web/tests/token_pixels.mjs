import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/?test=1`, { waitUntil: "load" });

async function inspect(label, url) {
  const info = await page.evaluate(async (u) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = u;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let transparent = 0, semi = 0, opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) transparent++;
      else if (data[i] === 255) opaque++;
      else semi++;
    }
    return { w: c.width, h: c.height, transparent, semi, opaque, corner: [data[0], data[1], data[2], data[3]] };
  }, url);
  const transparentPct = ((info.transparent / (info.w * info.h)) * 100).toFixed(1);
  console.log(`${label.padEnd(16)} ${String(info.w).padStart(5)}×${String(info.h).padStart(5)}  trans=${transparentPct}%  corner=(${info.corner.join(",")})`);
}

const ASSETS = [
  ["fuel_token",     "/assets/boosts/fuel_token.png"],
  ["plane",          "/assets/plane.png"],
  ["bird_small",     "/assets/obstacles/bird_small.png"],
  ["bird_big",       "/assets/obstacles/bird_big.png"],
  ["drone",          "/assets/obstacles/drone.png"],
  ["jet",            "/assets/obstacles/jet.png"],
  ["ufo",            "/assets/obstacles/ufo.png"],
  ["missiles",       "/assets/obstacles/missiles.png"],
  ["top_pillar",     "/assets/obstacles/top_pillar.png"],
  ["bottom_pillar",  "/assets/obstacles/bottom_pillar.png"],
];
for (const [label, path] of ASSETS) {
  await inspect(label, `${BASE}${path}`);
}

await browser.close();

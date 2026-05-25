// Dev helper: dump first-N buttons + distribution for one or more .bin files.
import { readFileSync } from "node:fs";
import { decodeTranscript } from "../src/index.js";

for (const path of process.argv.slice(2)) {
  const buf = new Uint8Array(readFileSync(path));
  const { seed, buttons } = decodeTranscript(buf);
  const counts = new Map<number, number>();
  for (const b of buttons) counts.set(b, (counts.get(b) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n${path.replace(/^.*\//, "")}`);
  console.log(`  seed=0x${(seed >>> 0).toString(16).padStart(8, "0")} ticks=${buttons.length}`);
  console.log(`  first 64 bytes: ${Array.from(buttons.slice(0, 64)).join(",")}`);
  console.log(`  byte distribution: ${sorted.slice(0, 10).map(([b, n]) => `${b}=${n}`).join("  ")}`);
}

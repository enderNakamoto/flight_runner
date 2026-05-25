// Replay a .bin transcript downloaded from the browser (PlayScene "T" key on
// the outro). Prints the final state — should match the score / ticks shown
// on the outro screen, otherwise the determinism contract is broken.
//
// Usage: npx tsx packages/sim/scripts/replay-bin.ts path/to/file.bin

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  GameOverReason,
  STAGE_NAMES,
  decodeTranscript,
  replay,
  serializeState,
  type GameState,
} from "../src/index.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx packages/sim/scripts/replay-bin.ts <transcript.bin>");
  process.exit(1);
}

const buf = new Uint8Array(readFileSync(path));
const { seed, buttons } = decodeTranscript(buf);
const { state, ticksConsumed } = replay(buf);
const hash = createHash("sha256").update(serializeState(state)).digest("hex");

const reasonName = GameOverReason[state.gameOverReason] ?? `unknown(${state.gameOverReason})`;
const stageName = STAGE_NAMES[state.stage as keyof typeof STAGE_NAMES] ?? `stage${state.stage}`;

console.log(`file          ${path}`);
console.log(`size          ${buf.byteLength} bytes  (${buttons.length} ticks recorded)`);
console.log(`seed          0x${(seed >>> 0).toString(16).padStart(8, "0")}`);
console.log(`ticks consumed ${ticksConsumed}  (replay stopped at gameOver=${state.gameOver})`);
console.log(`final score   ${state.score}`);
console.log(`final stage   ${stageName}`);
console.log(`reason        ${reasonName}`);
console.log(`plane.y       ${state.plane.y.toFixed(2)}`);
console.log(`fuel          ${state.fuel.toFixed(2)}`);
console.log(`state hash    ${hash}`);

// Determinism self-check: replay a second time, confirm identical hash.
const r2 = replay(buf);
const h2 = createHash("sha256").update(serializeState(r2.state)).digest("hex");
if (hash !== h2) {
  console.error("\nFAIL: replay is non-deterministic on this machine");
  process.exit(2);
}
console.log("\nreplay determinism: ok");

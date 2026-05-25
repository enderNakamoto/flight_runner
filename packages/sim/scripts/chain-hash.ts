// Per-tick chain-hash dumper for a flight_scroll transcript. The
// flight_scroll_core/parity Rust binary prints the same fields in the same
// order — `diff` the two outputs to verify TS↔Rust parity on a corpus run.
//
// Usage: npx tsx packages/sim/scripts/chain-hash.ts <path-to-bin>

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Stage,
  createInitialState,
  decodeTranscript,
  serializeState,
  stepMut,
} from "../src/index.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx packages/sim/scripts/chain-hash.ts <transcript.bin>");
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(path));
const { seed, buttons } = decodeTranscript(bytes);

const state = createInitialState(seed, Stage.Common);
let h = createHash("sha256").update(serializeState(state)).digest();
let consumed = 0;
for (const b of buttons) {
  stepMut(state, { buttons: b });
  consumed++;
  h = createHash("sha256").update(h).update(serializeState(state)).digest();
  if (state.gameOver) break;
}

console.log(`file        ${path}`);
console.log(`seed        0x${(seed >>> 0).toString(16).padStart(8, "0")}`);
console.log(`ticks       ${consumed}`);
console.log(`score       ${state.score}`);
console.log(`stage       ${state.stage}`);
console.log(`reason      ${state.gameOverReason}`);
console.log(`chain_hash  ${h.toString("hex")}`);

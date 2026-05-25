// Fuzz transcript generator. Emits deterministic random-input .bin files
// into packages/sim/tests/corpus/ until the directory holds at least `count`
// transcripts. Idempotent — re-running with the same args either reproduces
// the same files (deterministic PRNG-driven) or no-ops if all already exist.
//
// Usage:
//   npx tsx packages/sim/scripts/gen-corpus.ts [count] [master_seed_hex]
//
// Filename convention is the same as human-played files
// (flight_scroll_seed<HEX>_t<TICKS>_s<SCORE>.bin) so run-corpus.ts and the
// Rust corpus_parity test pick them up automatically.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInitialState,
  encodeTranscript,
  prngInit,
  prngNextU32,
  Stage,
  stepMut,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "../tests/corpus");

const TARGET = process.argv[2] ? parseInt(process.argv[2], 10) : 100;
const MASTER_SEED = (() => {
  const raw = process.argv[3];
  if (!raw) return 0xdeadbeef | 0;
  return parseInt(raw, 16) | 0;
})();

const MIN_TICKS = 50;           // skip too-short runs — uninteresting parity
const MAX_LEN_TICKS = 6000;     // cap per-transcript generation budget

// Distribution chosen to look like real play: lots of throttle (RIGHT),
// occasional dodges, rare idle/LEFT.
function roll_button(rng: { s: number }): number {
  const r = prngNextU32(rng) % 100;
  if (r < 35) return 8;           // RIGHT
  if (r < 50) return 9;           // RIGHT+UP
  if (r < 65) return 10;          // RIGHT+DOWN
  if (r < 75) return 1;           // UP
  if (r < 85) return 2;           // DOWN
  if (r < 90) return 4;           // LEFT
  return 0;                       // idle
}

if (!existsSync(CORPUS_DIR)) mkdirSync(CORPUS_DIR, { recursive: true });
const existing_files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".bin"));
console.log(`existing corpus: ${existing_files.length} files`);
const wanted = Math.max(0, TARGET - existing_files.length);
console.log(`target=${TARGET}, generating up to ${wanted} new transcripts (master_seed=0x${(MASTER_SEED >>> 0).toString(16).padStart(8, "0")})`);

const rng = prngInit(MASTER_SEED);

let generated = 0;
let attempts = 0;
const ATTEMPT_BUDGET = wanted * 4 + 50; // give the rejection sampler room

while (generated < wanted && attempts < ATTEMPT_BUDGET) {
  attempts++;
  const seed = prngNextU32(rng) | 0;
  const target_len = 200 + (prngNextU32(rng) % (MAX_LEN_TICKS - 200));
  const buttons = new Uint8Array(target_len);
  for (let t = 0; t < target_len; t++) buttons[t] = roll_button(rng);

  // Replay with TS sim to discover the game-over tick.
  const state = createInitialState(seed, Stage.Common);
  let consumed = 0;
  for (let t = 0; t < buttons.length; t++) {
    stepMut(state, { buttons: buttons[t]! });
    consumed++;
    if (state.gameOver) break;
  }

  if (consumed < MIN_TICKS) continue; // too short — try again

  const trimmed = buttons.subarray(0, consumed);
  const bin = encodeTranscript(seed, trimmed);
  const seed_hex = (seed >>> 0).toString(16).padStart(8, "0");
  const name = `flight_scroll_seed${seed_hex}_t${consumed}_s${state.score}.bin`;
  const path = join(CORPUS_DIR, name);
  if (existsSync(path)) continue;     // already in the corpus

  writeFileSync(path, bin);
  generated++;
  if (generated <= 5 || generated % 10 === 0) {
    console.log(`  [${generated}/${wanted}] ${name}`);
  }
}

console.log(`\ngenerated ${generated} new transcripts in ${attempts} attempts`);
const final_count = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".bin")).length;
console.log(`corpus now: ${final_count} files`);
if (final_count < TARGET) {
  console.error(`WARN: only ${final_count}/${TARGET} after ${attempts} attempts`);
  process.exit(1);
}

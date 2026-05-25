// Compute per-file SHA-256 chain hashes for every transcript in
// packages/sim/tests/corpus/ and write them to corpus/parity_hashes.json.
// The Rust integration test (services/prover/core/tests/corpus_parity.rs)
// reads this file and asserts the Rust replay produces matching hashes —
// so the JSON is the TS-side reference for cross-language parity.
//
// Re-run any time the corpus changes or the sim changes.
//   npx tsx packages/sim/scripts/dump-hashes.ts

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInitialState,
  decodeTranscript,
  serializeState,
  Stage,
  stepMut,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "../tests/corpus");
const OUT = join(CORPUS_DIR, "parity_hashes.json");

function chain_hash(buf: Uint8Array): string {
  const { seed, buttons } = decodeTranscript(buf);
  const state = createInitialState(seed, Stage.Common);
  let h = createHash("sha256").update(serializeState(state)).digest();
  for (let i = 0; i < buttons.length; i++) {
    stepMut(state, { buttons: buttons[i]! });
    h = createHash("sha256").update(h).update(serializeState(state)).digest();
    if (state.gameOver) break;
  }
  return h.toString("hex");
}

const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".bin")).sort();
const out: Record<string, string> = {};
let i = 0;
for (const f of files) {
  i++;
  const buf = new Uint8Array(readFileSync(join(CORPUS_DIR, f)));
  out[f] = chain_hash(buf);
  if (i <= 3 || i % 20 === 0 || i === files.length) {
    console.log(`  [${i}/${files.length}] ${f}  ${out[f]!.slice(0, 16)}…`);
  }
}

// Stable JSON output — sorted keys, two-space indent.
const json = JSON.stringify(out, Object.keys(out).sort(), 2) + "\n";
writeFileSync(OUT, json);
console.log(`\nwrote ${OUT}  (${files.length} entries)`);

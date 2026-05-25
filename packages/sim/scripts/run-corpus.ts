// Parity-test runner — walks packages/sim/tests/corpus/*.bin, replays each
// transcript, and asserts the filename metadata matches what the sim
// actually produces. Exits 1 on any mismatch.
//
// Filename convention: flight_scroll_seed<HEX8>_t<TICKS>_s<SCORE>.bin
//
// This is the regression check Phase 3 leans on: every Q24.8 conversion
// slice in step.ts / constants.ts / stages.ts must keep this passing on the
// full corpus before it can land.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameOverReason, STAGE_NAMES, decodeTranscript, replay } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(__dirname, "../tests/corpus");
const FILENAME_RE = /^flight_scroll_seed([0-9a-f]{8})_t(\d+)_s(\d+)\.bin$/;

const files = readdirSync(corpusDir).filter((f) => f.endsWith(".bin")).sort();
if (files.length === 0) {
  console.error(`no transcripts in ${corpusDir}`);
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const m = FILENAME_RE.exec(name);
  if (!m) {
    console.log(`  SKIP ${name}  (unrecognized filename)`);
    continue;
  }
  const expectedSeed = parseInt(m[1]!, 16);
  const expectedTicks = parseInt(m[2]!, 10);
  const expectedScore = parseInt(m[3]!, 10);
  const buf = new Uint8Array(readFileSync(join(corpusDir, name)));
  const { seed } = decodeTranscript(buf);
  const { state, ticksConsumed } = replay(buf);
  const seedOk = (seed >>> 0) === (expectedSeed >>> 0);
  const ticksOk = ticksConsumed === expectedTicks;
  const scoreOk = state.score === expectedScore;
  const reason = GameOverReason[state.gameOverReason] ?? `r${state.gameOverReason}`;
  const stageName = STAGE_NAMES[state.stage as keyof typeof STAGE_NAMES] ?? `stage${state.stage}`;
  if (seedOk && ticksOk && scoreOk) {
    console.log(`  PASS ${name}  score=${state.score} stage=${stageName} reason=${reason}`);
  } else {
    console.log(`  FAIL ${name}`);
    console.log(`         expected: seed=0x${expectedSeed.toString(16).padStart(8, "0")} ticks=${expectedTicks} score=${expectedScore}`);
    console.log(`         got:      seed=0x${(seed >>> 0).toString(16).padStart(8, "0")} ticks=${ticksConsumed} score=${state.score} reason=${reason}`);
    failed++;
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
if (failed > 0) process.exit(1);

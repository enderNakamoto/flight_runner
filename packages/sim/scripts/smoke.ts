// Phase 3 smoke test — verifies fp/serialize/transcript work at runtime, not
// just at the type level. Will graduate into a proper parity-test suite once
// the Rust sim crate lands; for now it just catches typos in the foundation.
//
// Run with: npx tsx packages/sim/scripts/smoke.ts

import { createHash } from "node:crypto";
import * as m from "../src/index.js";

const cases = [0, 1, -1, 0.5, -0.5, 100.25, 360, 1280, -100.7];
for (const v of cases) {
  const back = m.fpToFloat(m.fp(v));
  if (Math.abs(back - v) > 1 / 256) throw new Error(`fp round-trip fail: ${v} -> ${back}`);
}
console.log("fp round-trip: ok");

if (m.fpFloor(m.fp(-1.5)) !== -2) throw new Error("fpFloor neg fail");
if (m.fpFloor(m.fp(1.5)) !== 1) throw new Error("fpFloor pos fail");
console.log("fpFloor: ok");

const t0 = m.encodeTranscript(12345, new Uint8Array(0));
const r0 = m.replay(t0);
if (r0.state.tick !== 0 || r0.ticksConsumed !== 0 || r0.state.gameOver) {
  throw new Error("empty replay fail");
}
console.log("empty replay: ok");

const buttons = new Uint8Array(3000);
const t1 = m.encodeTranscript(0xc0ffee, buttons);
const r1 = m.replay(t1);
console.log(
  `passive run: ticks=${r1.ticksConsumed} score=${r1.state.score} over=${r1.state.gameOver} reason=${r1.state.gameOverReason}`,
);

function chainHash(buf: Uint8Array): string {
  const { seed, buttons } = m.decodeTranscript(buf);
  const state = m.createInitialState(seed);
  let h = createHash("sha256").update(m.serializeState(state)).digest();
  for (let i = 0; i < buttons.length && !state.gameOver; i++) {
    m.stepMut(state, { buttons: buttons[i]! });
    h = createHash("sha256").update(h).update(m.serializeState(state)).digest();
  }
  return h.toString("hex");
}

const h1 = chainHash(t1);
const h2 = chainHash(t1);
if (h1 !== h2) throw new Error("non-deterministic replay!");
console.log(`determinism: ok  (chain hash ${h1.slice(0, 16)}…)`);

const h3 = chainHash(m.encodeTranscript(0xdeadbeef, buttons));
if (h1 === h3) throw new Error("seed irrelevant");
console.log(`distinct-seed: ok  (other hash ${h3.slice(0, 16)}…)`);

console.log("\nALL SMOKE TESTS PASS");

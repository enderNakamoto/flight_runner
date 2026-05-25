// Synthesize a fake transcript for testing replay-bin.ts without needing to
// open the browser. NOT shipped — just a dev convenience.
import { writeFileSync } from "node:fs";
import { encodeTranscript } from "../src/index.js";

const buttons = new Uint8Array(500);
for (let i = 100; i < 200; i++) buttons[i] = 1;   // 100 ticks of UP
for (let i = 200; i < 300; i++) buttons[i] = 8;   // 100 ticks of RIGHT (throttle)
const bin = encodeTranscript(0xcafebabe, buttons);
const out = "/tmp/flight_synth.bin";
writeFileSync(out, bin);
console.log(`wrote ${out}  (${bin.byteLength} bytes)`);

import type { PRNGState } from "./types.js";

export function prngInit(seed: number): PRNGState {
  return { s: (seed | 0) || 0x12345678 };
}

export function prngNextU32(rng: PRNGState): number {
  let x = rng.s | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.s = x | 0;
  return rng.s >>> 0;
}

export function prngNextFloat(rng: PRNGState): number {
  return prngNextU32(rng) / 0x1_0000_0000;
}

export function prngRange(rng: PRNGState, lo: number, hi: number): number {
  return lo + prngNextFloat(rng) * (hi - lo);
}

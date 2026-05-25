// Q24.8 fixed-point — the canonical numeric type for the deterministic sim.
//
// Encoded as a regular JS number, but only used inside the i32 range
// ([-2^31, 2^31)) so the Rust mirror (`i32`) holds the same value exactly.
// All ops cast to i32 via `| 0` at the boundary.
//
// Phase 3: this module lands BEFORE any sim math is converted. Nothing here
// is used by step.ts yet — the only purpose is to give us a typed toolbelt
// the conversion can rely on, and keep TS and Rust in lockstep.
//
// Safety contract: callers must keep raw integer parts of Q24.8 values under
// ~2^19 (≈500 000). Then the float64 intermediate in fpMul (a*b up to ~2^54)
// stays within mantissa precision and the final `| 0` cast is exact. All sim
// values (positions ≤ 1280, speeds ≤ 10, hitboxes ≤ 256) sit far below that.

export const FP_SHIFT = 8;
export const FP_ONE = 1 << FP_SHIFT;            // 256
export const FP_HALF = 1 << (FP_SHIFT - 1);     // 128

/** Float → Q24.8. Rounds toward zero, matching Rust `as i32`. */
export function fp(x: number): number {
  return (x * FP_ONE) | 0;
}

/** Q24.8 → float. Lossy for non-power-of-2 fractions. */
export function fpToFloat(a: number): number {
  return a / FP_ONE;
}

/** Q24.8 → whole integer, truncated toward zero (Rust `as i32` on a/FP_ONE). */
export function fpTrunc(a: number): number {
  return (a / FP_ONE) | 0;
}

/** Q24.8 → whole integer, floored toward −∞. Arithmetic right shift in both
 *  JS and Rust, so semantics match for negative values too: -300 >> 8 = -2. */
export function fpFloor(a: number): number {
  return a >> FP_SHIFT;
}

/** Q24.8 * Q24.8 → Q24.8. Rust mirror uses `(a as i64 * b as i64) >> 8 as i32`. */
export function fpMul(a: number, b: number): number {
  return ((a * b) / FP_ONE) | 0;
}

/** Q24.8 / Q24.8 → Q24.8. Numerator pre-shifted, then i32 divide. */
export function fpDiv(a: number, b: number): number {
  return ((a * FP_ONE) / b) | 0;
}

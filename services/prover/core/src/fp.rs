//! Q24.8 fixed-point — mirror of `packages/sim/src/fp.ts`.
//!
//! All sim values live in `i32` here. Operations widen to `i64` where the
//! product could overflow `i32`, then truncate back. The TS side does the
//! same math in f64 with a `| 0` cast at the boundary; for our value range
//! (raw integer parts < ~2^24) the two are bit-identical.
//!
//! Semantics intentionally match TS exactly:
//!   - `fp(x)`     truncates toward zero  (TS `(x * FP_ONE) | 0`)
//!   - `fp_trunc`  truncates toward zero  (TS `(a / FP_ONE) | 0`)
//!   - `fp_floor`  floors toward −∞       (TS `a >> FP_SHIFT`)
//!   - `fp_mul`    truncates toward zero  (TS `((a * b) / FP_ONE) | 0`)
//!   - `fp_div`    truncates toward zero  (TS `((a * FP_ONE) / b) | 0`)
//!
//! The split between `fp_trunc` and `fp_floor` matters for negatives only.

pub const FP_SHIFT: i32 = 8;
pub const FP_ONE: i32 = 1 << FP_SHIFT;          // 256
pub const FP_HALF: i32 = 1 << (FP_SHIFT - 1);   // 128

/// Float → Q24.8. Truncates the fractional part toward zero. `const` so it
/// can build the per-stage tables at compile time.
#[inline]
pub const fn fp(x: f64) -> i32 {
    (x * FP_ONE as f64) as i32 // `as i32` truncates toward zero, matching `| 0`.
}

/// Q24.8 → float. Lossy for non-power-of-2 fractions.
#[inline]
pub fn fp_to_float(a: i32) -> f64 {
    a as f64 / FP_ONE as f64
}

/// Q24.8 → whole integer, truncating toward zero.
#[inline]
pub fn fp_trunc(a: i32) -> i32 {
    a / FP_ONE
}

/// Q24.8 → whole integer, floored toward −∞.
#[inline]
pub fn fp_floor(a: i32) -> i32 {
    a >> FP_SHIFT
}

/// Q24.8 × Q24.8 → Q24.8. Widens through i64 to avoid mid-product overflow.
#[inline]
pub fn fp_mul(a: i32, b: i32) -> i32 {
    ((a as i64 * b as i64) / FP_ONE as i64) as i32
}

/// Q24.8 / Q24.8 → Q24.8. Pre-shifts the numerator through i64.
#[inline]
pub fn fp_div(a: i32, b: i32) -> i32 {
    (((a as i64) << FP_SHIFT) / b as i64) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors the cases in `packages/sim/scripts/smoke.ts`: every value
    /// here must give the same answer as the TS module to stay parity-safe.
    #[test]
    fn round_trip() {
        for v in [0.0, 1.0, -1.0, 0.5, -0.5, 100.25, 360.0, 1280.0, -100.7] {
            let back = fp_to_float(fp(v));
            assert!((back - v).abs() <= 1.0 / FP_ONE as f64, "fp round-trip: {v} -> {back}");
        }
    }

    #[test]
    fn constants() {
        assert_eq!(FP_ONE, 256);
        assert_eq!(FP_HALF, 128);
        assert_eq!(fp(0.5), 128);
        assert_eq!(fp(1.0), 256);
        assert_eq!(fp(3.0), 768);
        assert_eq!(fp(-0.5), -128);
    }

    #[test]
    fn floor_vs_trunc_negatives() {
        // TS `a >> FP_SHIFT` floors toward −∞.
        assert_eq!(fp_floor(fp(-1.5)), -2);
        assert_eq!(fp_floor(fp(1.5)), 1);
        // TS `(a / FP_ONE) | 0` truncates toward zero.
        assert_eq!(fp_trunc(fp(-1.5)), -1);
        assert_eq!(fp_trunc(fp(1.5)), 1);
        // Sanity: raw bit-shift example from the doc comment in fp.ts.
        assert_eq!(fp_floor(-300), -2);
    }

    #[test]
    fn multiply_examples() {
        // 2 * 3 = 6 (both operands exact in Q24.8)
        assert_eq!(fp_mul(fp(2.0), fp(3.0)), fp(6.0));
        // 0.5 * 0.5 = 0.25 (both exact)
        assert_eq!(fp_mul(fp(0.5), fp(0.5)), fp(0.25));
        // Identity: anything × fp(1.0) is itself.
        assert_eq!(fp_mul(fp(3.6), fp(1.0)), fp(3.6));
    }

    /// fp() truncates the fractional part, so values like 1.8 are NOT
    /// representable exactly. The product compounds that drift — this
    /// behavior has to match TS byte-for-byte, so pin the expected i32
    /// (not the float interpretation) to lock it in.
    #[test]
    fn multiply_precision_drift_matches_ts() {
        // fp(1.8) = 460 (represents 1.796875, NOT 1.8 exact)
        assert_eq!(fp(1.8), 460);
        // fp(3.0) = 768 (exact)
        assert_eq!(fp(3.0), 768);
        // 460 × 768 / 256 = 1380, which is fp(5.390625) — NOT fp(5.4)=1382.
        assert_eq!(fp_mul(fp(1.8), fp(3.0)), 1380);
        assert_ne!(fp_mul(fp(1.8), fp(3.0)), fp(5.4));
    }

    #[test]
    fn divide_examples() {
        // 6 / 2 = 3
        assert_eq!(fp_div(fp(6.0), fp(2.0)), fp(3.0));
        // 1 / 4 = 0.25
        assert_eq!(fp_div(fp(1.0), fp(4.0)), fp(0.25));
    }

    #[test]
    fn multiply_no_overflow_for_sim_range() {
        // Sim positions stay under ~2 ^ 19. Widening through i64 keeps the
        // product exact even at the upper end.
        let big = fp(1280.0); // world width
        let small = fp(7.5);  // missile speed
        let product = fp_mul(big, small);
        assert_eq!(product, fp(1280.0 * 7.5));
    }
}

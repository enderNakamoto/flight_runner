//! Xorshift32 PRNG — mirror of `packages/sim/src/prng.ts`.
//!
//! Bit-level semantics are pinned to the TS version. All shifts run on the
//! u32 bit pattern; storage is i32 because the TS state lives in a `number`
//! that the source code clamps to i32 via `| 0`. The TS `>>>` unsigned right
//! shift maps to Rust's `>>` on u32. Constant shift amounts (13, 17, 5) are
//! small enough that no `wrapping_shl` is needed — Rust `<<` on u32 already
//! drops the high bits the same way JS does.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrngState {
    pub s: i32,
}

/// `prng_init(seed)` — zero seed falls back to 0x12345678 so the prng never
/// degenerates to the all-zeros fixed point.
pub fn prng_init(seed: i32) -> PrngState {
    PrngState {
        s: if seed == 0 { 0x12345678 } else { seed },
    }
}

/// One xorshift32 step. Returns the unsigned interpretation of the new state.
pub fn prng_next_u32(rng: &mut PrngState) -> u32 {
    let mut x = rng.s as u32;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rng.s = x as i32;
    x
}

/// TS `prngNextFloat` — uniform double in [0, 1). Render / weighting helper.
pub fn prng_next_float(rng: &mut PrngState) -> f64 {
    prng_next_u32(rng) as f64 / 4_294_967_296.0_f64 // 2^32
}

/// TS `prngRange(rng, lo, hi)` — uniform float in [lo, hi).
pub fn prng_range(rng: &mut PrngState, lo: f64, hi: f64) -> f64 {
    lo + prng_next_float(rng) * (hi - lo)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TS reference sequences captured via tsx (see commit message). Locking
    /// the exact u32 outputs here is the cross-language parity check for the
    /// prng — every byte of every spawn roll downstream depends on these.
    fn assert_seq(seed: i32, expected: &[u32]) {
        let mut rng = prng_init(seed);
        for (i, want) in expected.iter().enumerate() {
            let got = prng_next_u32(&mut rng);
            assert_eq!(got, *want, "seed=0x{:08x} step {i}: got 0x{got:08x}, want 0x{want:08x}", seed as u32);
        }
    }

    #[test]
    fn ts_reference_seed_1() {
        assert_seq(0x00000001, &[
            0x00042021, 0x04080601, 0x9dcca8c5, 0x1255994f,
            0x8ef917d1, 0x2c6f5bd0, 0x25b2331a, 0x19f91cb2,
        ]);
    }

    #[test]
    fn ts_reference_seed_default() {
        assert_seq(0x12345678, &[
            0x87985aa5, 0x155b24a3, 0x4820f4c4, 0x81b3ac98,
            0x703a0788, 0x29a8e24d, 0x89ca4f1d, 0xc5186e29,
        ]);
    }

    #[test]
    fn ts_reference_negative_seed_cafebabe() {
        // 0xCAFEBABE | 0 in JS is -889275714 (i32). Same bit pattern in Rust.
        assert_seq(0xCAFEBABE_u32 as i32, &[
            0xa887f92a, 0xa3f0cd9b, 0xf23de7fa, 0x969293fb,
            0x595fa02d, 0x06108680, 0xced131e0, 0xf545f756,
        ]);
    }

    #[test]
    fn ts_reference_negative_seed_deadbeef() {
        assert_seq(0xDEADBEEF_u32 as i32, &[
            0x477d20b7, 0x8e1d9142, 0xba8c2458, 0xfee0503b,
            0x680e0348, 0xa48db81b, 0x6254ea5c, 0x1cfdafb3,
        ]);
    }

    #[test]
    fn ts_reference_corpus_seed() {
        // The real Date.now-derived seed from corpus run t2127_s42.
        assert_seq(0x5e570e03, &[
            0x4d7108c8, 0xe16fe17c, 0xb54d945c, 0xff04e05f,
            0x02e90ad8, 0x55f17b21, 0x2839ab0b, 0xb6407147,
        ]);
    }

    #[test]
    fn zero_seed_falls_back_to_default() {
        // seed=0 must reproduce the same first 4 u32s as seed=0x12345678.
        assert_seq(0, &[0x87985aa5, 0x155b24a3, 0x4820f4c4, 0x81b3ac98]);
    }

    #[test]
    fn next_float_in_unit_interval() {
        let mut rng = prng_init(42);
        for _ in 0..1000 {
            let f = prng_next_float(&mut rng);
            assert!((0.0..1.0).contains(&f), "out of range: {f}");
        }
    }

    #[test]
    fn range_within_bounds() {
        let mut rng = prng_init(7);
        for _ in 0..1000 {
            let v = prng_range(&mut rng, -10.0, 20.0);
            assert!(v >= -10.0 && v < 20.0, "out of range: {v}");
        }
    }
}

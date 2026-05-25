//! Rust mirror of `packages/sim/src/`. Every module here ports its TS
//! counterpart byte-for-byte: same Q24.8 math, same serialized layout, same
//! transcript replay semantics. The Phase 3 parity gate is the TS↔Rust
//! per-tick state digest matching across the corpus in
//! `packages/sim/tests/corpus/`.
//!
//! Modules land one slice at a time; each new module gets its own commit and
//! must keep the parity test passing. First slice: `fp` (the Q24.8 toolbelt).

pub mod constants;
pub mod fp;
pub mod prng;
pub mod stages;
pub mod state;
pub mod types;

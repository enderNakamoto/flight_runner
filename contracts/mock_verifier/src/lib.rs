//! MockVerifier — no-op stand-in for the RISC Zero Groth16 verifier.
//!
//! `verify(seal, image_id, journal_digest)` accepts any inputs. Used by:
//!   - game_hub unit tests (so we can exercise the full contract flow
//!     without producing real Groth16 proofs)
//!   - early testnet deploys, before the real Nethermind verifier is wired
//!
//! Production deploys swap this address out for the real
//! `stellar-risc0-verifier` contract via `game_hub::initialize` (or a future
//! `set_verifier` admin function).

#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env};

#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    /// Mirrors the real verifier's signature. Returns `()` on success and
    /// panics on failure (Soroban convention). MockVerifier never panics.
    pub fn verify(
        _env: Env,
        _seal: Bytes,
        _image_id: BytesN<32>,
        _journal_digest: BytesN<32>,
    ) {
        // intentionally empty
    }
}

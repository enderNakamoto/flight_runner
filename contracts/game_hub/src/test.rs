//! Slice 1 placeholder. Real tests land in slice 4.

#![cfg(test)]

use super::*;
use soroban_sdk::Env;

#[test]
fn scaffold_compiles_and_registers() {
    let env = Env::default();
    let _contract_id = env.register(GameHub, ());
    // Stub returns Err(NotInitialized) — sanity check shape only.
    // Real assertions land in slice 4 with the full happy/sad path coverage.
}

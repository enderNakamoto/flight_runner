//! Admin (slice 2) + player-flow smoke (slice 3) tests. Full sad-path
//! matrix and leaderboard edge cases land in slice 4.

#![cfg(test)]

use super::*;
use mock_verifier::{MockVerifier, MockVerifierClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, String};

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

/// Minimal env: contract registered, MockVerifier deployed, auth mocked.
/// Caller still has to call `initialize` + `add_game` to make it usable.
fn make_env() -> (Env, Address, Address, GameHubClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let verifier_addr = env.register(MockVerifier, ());
    let contract_id = env.register(GameHub, ());
    let client = GameHubClient::new(&env, &contract_id);
    (env, admin, verifier_addr, client)
}

fn dummy_image_id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Builds a 44-byte journal matching the ProverOutput layout in
/// services/prover/core/src/types.rs.
fn journal(env: &Env, score: u32, ticks: u32, seed: u32, hash_fill: u8) -> Bytes {
    let mut buf = [0u8; 44];
    buf[0..4].copy_from_slice(&score.to_le_bytes());
    buf[4..8].copy_from_slice(&ticks.to_le_bytes());
    buf[8..12].copy_from_slice(&seed.to_le_bytes());
    for i in 12..44 {
        buf[i] = hash_fill;
    }
    Bytes::from_slice(env, &buf)
}

/// Generates a 260-byte stub seal. MockVerifier accepts any bytes.
fn seal_stub(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 260])
}

// ─────────────────────────────────────────────────────────────────────────────
// initialize
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn initialize_succeeds_on_fresh_contract() {
    let (_env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    // No assertion — `client.initialize` returns the unwrapped value (or
    // panics if the Result was Err). Reaching here = success.
}

#[test]
fn initialize_rejects_double_init() {
    let (_env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let err = client.try_initialize(&admin, &verifier).unwrap_err().unwrap();
    assert_eq!(err, Error::AlreadyInitialized);
}

// ─────────────────────────────────────────────────────────────────────────────
// add_game
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn add_game_rejects_before_initialize() {
    let (env, _admin, _verifier, client) = make_env();
    let err = client
        .try_add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotInitialized);
}

#[test]
fn add_game_happy_path() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let meta = client.get_game(&1).expect("game stored");
    assert_eq!(meta.image_id, dummy_image_id(&env, 0xAA));
    assert_eq!(meta.name, String::from_str(&env, "flight"));
    assert!(!meta.paused);
}

#[test]
fn add_game_rejects_collision() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let err = client
        .try_add_game(&1, &dummy_image_id(&env, 0xBB), &String::from_str(&env, "other"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::GameAlreadyExists);
    // Original metadata is unchanged.
    let meta = client.get_game(&1).unwrap();
    assert_eq!(meta.image_id, dummy_image_id(&env, 0xAA));
}

// ─────────────────────────────────────────────────────────────────────────────
// set_image_id
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn set_image_id_rotates_in_place() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    client.set_image_id(&1, &dummy_image_id(&env, 0xBB));
    let meta = client.get_game(&1).unwrap();
    assert_eq!(meta.image_id, dummy_image_id(&env, 0xBB));
    // name + paused preserved across rotation.
    assert_eq!(meta.name, String::from_str(&env, "flight"));
    assert!(!meta.paused);
}

#[test]
fn set_image_id_rejects_unknown_game() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let err = client
        .try_set_image_id(&99, &dummy_image_id(&env, 0xCC))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::GameNotFound);
}

// ─────────────────────────────────────────────────────────────────────────────
// set_paused
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn set_paused_toggles_flag() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    client.set_paused(&1, &true);
    assert!(client.get_game(&1).unwrap().paused);
    client.set_paused(&1, &false);
    assert!(!client.get_game(&1).unwrap().paused);
}

#[test]
fn set_paused_rejects_unknown_game() {
    let (_env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let err = client.try_set_paused(&99, &true).unwrap_err().unwrap();
    assert_eq!(err, Error::GameNotFound);
}

// ─────────────────────────────────────────────────────────────────────────────
// rotate_admin
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn rotate_admin_happy_path() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let new_admin = Address::generate(&env);
    client.rotate_admin(&new_admin);
    // After rotation, only the *new* admin's signed calls succeed.
    // Auth is mocked here so the assertion is structural: another admin
    // operation still goes through after the rotation completes.
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
}

#[test]
fn rotate_admin_rejects_before_initialize() {
    let (env, _admin, _verifier, client) = make_env();
    let stray = Address::generate(&env);
    let err = client.try_rotate_admin(&stray).unwrap_err().unwrap();
    assert_eq!(err, Error::NotInitialized);
}

// ─────────────────────────────────────────────────────────────────────────────
// Player flow smoke (slice 3)
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn start_run_mints_monotonic_ids_and_pins_state() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let p = Address::generate(&env);
    let run1 = client.start_run(&1, &p);
    assert_eq!(run1, 1);
    // Cancel so we can start another (one active run per game/player).
    client.cancel_run(&run1);
    let run2 = client.start_run(&1, &p);
    assert_eq!(run2, 2);
    let stored = client.get_run(&run2).unwrap();
    assert_eq!(stored.game_id, 1);
    assert_eq!(stored.player, p);
    assert!(!stored.settled);
}

#[test]
fn settle_run_records_first_score_and_marks_settled() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let p = Address::generate(&env);
    let run_id = client.start_run(&1, &p);
    let seed = client.get_run(&run_id).unwrap().seed;

    let j = journal(&env, /*score*/ 1234, /*ticks*/ 5678, seed, 0xEE);
    let s = seal_stub(&env);
    client.settle_run(&run_id, &s, &j);

    let hs = client.get_score(&1, &p).expect("high score recorded");
    assert_eq!(hs.score, 1234);
    assert_eq!(hs.ticks_survived, 5678);
    assert_eq!(hs.run_id, run_id);

    let run_after = client.get_run(&run_id).unwrap();
    assert!(run_after.settled);
}

#[test]
fn settle_run_higher_score_replaces_personal_best() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let p = Address::generate(&env);

    // First run: score 1000
    let run1 = client.start_run(&1, &p);
    let seed1 = client.get_run(&run1).unwrap().seed;
    client.settle_run(&run1, &seal_stub(&env), &journal(&env, 1000, 100, seed1, 0));

    // Second run: score 2000 — should replace
    let run2 = client.start_run(&1, &p);
    let seed2 = client.get_run(&run2).unwrap().seed;
    client.settle_run(&run2, &seal_stub(&env), &journal(&env, 2000, 200, seed2, 0));

    let hs = client.get_score(&1, &p).unwrap();
    assert_eq!(hs.score, 2000);
    assert_eq!(hs.ticks_survived, 200);
    assert_eq!(hs.run_id, run2);
}

#[test]
fn settle_run_lower_score_consumes_run_but_keeps_pb() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let p = Address::generate(&env);

    let run1 = client.start_run(&1, &p);
    let seed1 = client.get_run(&run1).unwrap().seed;
    client.settle_run(&run1, &seal_stub(&env), &journal(&env, 5000, 500, seed1, 0));

    let run2 = client.start_run(&1, &p);
    let seed2 = client.get_run(&run2).unwrap().seed;
    // Lower score — should still settle but PB stays at 5000/500.
    client.settle_run(&run2, &seal_stub(&env), &journal(&env, 100, 50, seed2, 0));

    let hs = client.get_score(&1, &p).unwrap();
    assert_eq!(hs.score, 5000);
    assert_eq!(hs.run_id, run1);
    // run2 still marked settled.
    assert!(client.get_run(&run2).unwrap().settled);
}

#[test]
fn settle_run_rejects_seed_mismatch() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let p = Address::generate(&env);
    let run_id = client.start_run(&1, &p);
    let actual_seed = client.get_run(&run_id).unwrap().seed;
    let wrong_seed = actual_seed.wrapping_add(1);
    let err = client
        .try_settle_run(
            &run_id,
            &seal_stub(&env),
            &journal(&env, 100, 100, wrong_seed, 0),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::SeedMismatch);
    // Run not consumed — still no high score, still active.
    assert!(client.get_score(&1, &p).is_none());
    assert!(!client.get_run(&run_id).unwrap().settled);
}

#[test]
fn cancel_run_frees_active_slot_for_same_game() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA), &String::from_str(&env, "flight"));
    let p = Address::generate(&env);
    let run1 = client.start_run(&1, &p);
    client.cancel_run(&run1);
    // Should not collide.
    let run2 = client.start_run(&1, &p);
    assert!(run2 > run1);
}

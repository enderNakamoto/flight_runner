//! Admin-path tests (slice 2). Player flow + verification tests land in slice 4.

#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, String};

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

fn make_env() -> (Env, Address, Address, GameHubClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let contract_id = env.register(GameHub, ());
    let client = GameHubClient::new(&env, &contract_id);
    (env, admin, verifier, client)
}

fn dummy_image_id(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
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

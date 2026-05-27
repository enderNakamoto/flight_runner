//! game_hub tests — admin paths + submit_score paths + enumeration cap.

#![cfg(test)]

use super::*;
use mock_verifier::MockVerifier;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env};

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

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

fn dummy_pubkey(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Builds a 76-byte journal matching the ProverOutput layout in
/// services/prover/core/src/types.rs.
///   0..4  score
///   4..8  ticks
///   8..12 seed
///  12..44 player_pubkey
///  44..76 transcript_hash
fn journal(
    env: &Env,
    score: u32,
    ticks: u32,
    seed: u32,
    pubkey: &BytesN<32>,
    hash_fill: u8,
) -> Bytes {
    let mut buf = [0u8; 76];
    buf[0..4].copy_from_slice(&score.to_le_bytes());
    buf[4..8].copy_from_slice(&ticks.to_le_bytes());
    buf[8..12].copy_from_slice(&seed.to_le_bytes());
    buf[12..44].copy_from_slice(&pubkey.to_array());
    for i in 44..76 {
        buf[i] = hash_fill;
    }
    Bytes::from_slice(env, &buf)
}

fn seal_stub(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 260])
}

/// Unique 32-byte pubkey derived from an index. Used to fill the enumeration
/// table with > 256 distinct players for cap testing.
fn pubkey_from_index(env: &Env, idx: u32) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[0..4].copy_from_slice(&idx.to_le_bytes());
    // remaining bytes left 0 — unique idx is enough to keep pubkeys distinct
    BytesN::from_array(env, &buf)
}

// ─────────────────────────────────────────────────────────────────────────────
// initialize
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn initialize_succeeds_on_fresh_contract() {
    let (_env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
}

#[test]
fn initialize_rejects_double_init() {
    let (_env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let err = client.try_initialize(&admin, &verifier).unwrap_err().unwrap();
    assert_eq!(err, Error::AlreadyInitialized);
}

// ─────────────────────────────────────────────────────────────────────────────
// add_game / set_image_id / rotate_admin
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn add_game_rejects_before_initialize() {
    let (env, _admin, _verifier, client) = make_env();
    let err = client
        .try_add_game(&1, &dummy_image_id(&env, 0xAA))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotInitialized);
}

#[test]
fn add_game_happy_path() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let image_id = client.get_image_id(&1).expect("game stored");
    assert_eq!(image_id, dummy_image_id(&env, 0xAA));
}

#[test]
fn add_game_rejects_collision() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let err = client
        .try_add_game(&1, &dummy_image_id(&env, 0xBB))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::GameAlreadyExists);
    assert_eq!(client.get_image_id(&1).unwrap(), dummy_image_id(&env, 0xAA));
}

#[test]
fn set_image_id_rotates_in_place() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    client.set_image_id(&1, &dummy_image_id(&env, 0xBB));
    assert_eq!(client.get_image_id(&1).unwrap(), dummy_image_id(&env, 0xBB));
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

#[test]
fn rotate_admin_happy_path() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let new_admin = Address::generate(&env);
    client.rotate_admin(&new_admin);
    // After rotation, admin operations still succeed under mock_all_auths.
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
}

#[test]
fn rotate_admin_rejects_before_initialize() {
    let (env, _admin, _verifier, client) = make_env();
    let stray = Address::generate(&env);
    let err = client.try_rotate_admin(&stray).unwrap_err().unwrap();
    assert_eq!(err, Error::NotInitialized);
}

#[test]
fn set_verifier_swaps_address() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    assert_eq!(client.get_verifier().unwrap(), verifier);

    let new_verifier = env.register(MockVerifier, ());
    client.set_verifier(&new_verifier);
    assert_eq!(client.get_verifier().unwrap(), new_verifier);
}

#[test]
fn set_verifier_rejects_before_initialize() {
    let (env, _admin, _verifier, client) = make_env();
    let stray = Address::generate(&env);
    let err = client.try_set_verifier(&stray).unwrap_err().unwrap();
    assert_eq!(err, Error::NotInitialized);
}

// ─────────────────────────────────────────────────────────────────────────────
// submit_score — happy path
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn submit_score_records_first_score() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let p = dummy_pubkey(&env, 0x11);

    client.submit_score(&1, &seal_stub(&env), &journal(&env, 1234, 5678, 0xDEAD, &p, 0xEE));

    let hs = client.get_score(&1, &p).expect("recorded");
    assert_eq!(hs.score, 1234);
    assert_eq!(hs.ticks_survived, 5678);
    assert_eq!(hs.seed, 0xDEAD);
}

#[test]
fn submit_score_higher_replaces_pb() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let p = dummy_pubkey(&env, 0x22);

    client.submit_score(&1, &seal_stub(&env), &journal(&env, 1000, 100, 1, &p, 0));
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 2000, 200, 2, &p, 0));

    let hs = client.get_score(&1, &p).unwrap();
    assert_eq!(hs.score, 2000);
    assert_eq!(hs.ticks_survived, 200);
    assert_eq!(hs.seed, 2);
}

#[test]
fn submit_score_lower_keeps_pb() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let p = dummy_pubkey(&env, 0x33);

    client.submit_score(&1, &seal_stub(&env), &journal(&env, 5000, 500, 1, &p, 0));
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 100, 50, 2, &p, 0));

    let hs = client.get_score(&1, &p).unwrap();
    assert_eq!(hs.score, 5000);
    assert_eq!(hs.seed, 1);
}

#[test]
fn submit_score_tie_break_by_ticks() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let p = dummy_pubkey(&env, 0x44);

    client.submit_score(&1, &seal_stub(&env), &journal(&env, 500, 1000, 1, &p, 0));
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 500, 1500, 2, &p, 0));

    let hs = client.get_score(&1, &p).unwrap();
    assert_eq!(hs.ticks_survived, 1500);
    assert_eq!(hs.seed, 2);
}

#[test]
fn high_scores_isolated_per_player() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let alice = dummy_pubkey(&env, 0xAA);
    let bob = dummy_pubkey(&env, 0xBB);

    client.submit_score(&1, &seal_stub(&env), &journal(&env, 100, 100, 1, &alice, 0));
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 999, 999, 2, &bob, 0));

    assert_eq!(client.get_score(&1, &alice).unwrap().score, 100);
    assert_eq!(client.get_score(&1, &bob).unwrap().score, 999);
}

#[test]
fn high_scores_isolated_per_game() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    client.add_game(&2, &dummy_image_id(&env, 0xBB));
    let p = dummy_pubkey(&env, 0x55);

    client.submit_score(&1, &seal_stub(&env), &journal(&env, 100, 100, 1, &p, 0));
    client.submit_score(&2, &seal_stub(&env), &journal(&env, 500, 500, 2, &p, 0));

    assert_eq!(client.get_score(&1, &p).unwrap().score, 100);
    assert_eq!(client.get_score(&2, &p).unwrap().score, 500);
    assert_eq!(client.get_score(&99, &p), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// submit_score — sad paths
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn submit_score_rejects_bad_seal_size() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let p = dummy_pubkey(&env, 0x66);
    let bad_seal = Bytes::from_slice(&env, &[0u8; 100]);
    let err = client
        .try_submit_score(&1, &bad_seal, &journal(&env, 0, 0, 0, &p, 0))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidSeal);
}

#[test]
fn submit_score_rejects_bad_journal_size() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let bad_journal = Bytes::from_slice(&env, &[0u8; 32]);
    let err = client
        .try_submit_score(&1, &seal_stub(&env), &bad_journal)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidJournal);
}

#[test]
fn submit_score_rejects_unknown_game() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    let p = dummy_pubkey(&env, 0x77);
    let err = client
        .try_submit_score(&99, &seal_stub(&env), &journal(&env, 100, 100, 1, &p, 0))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::GameNotFound);
}

#[test]
fn submit_score_rejects_uninitialized() {
    let (env, _admin, _verifier, client) = make_env();
    let p = dummy_pubkey(&env, 0x99);
    // No game exists yet → first error is GameNotFound (uninitialized
    // implies no games could've been added).
    let err = client
        .try_submit_score(&1, &seal_stub(&env), &journal(&env, 0, 0, 0, &p, 0))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::GameNotFound);
}

#[test]
fn get_score_returns_none_for_never_submitted() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    let p = dummy_pubkey(&env, 0xFF);
    assert_eq!(client.get_score(&1, &p), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enumeration table
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn enumeration_starts_at_zero() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    assert_eq!(client.get_player_count(&1), 0);
    assert_eq!(client.get_player_at(&1, &0), None);
}

#[test]
fn enumeration_adds_each_unique_pubkey_once() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));

    let alice = dummy_pubkey(&env, 0xAA);
    let bob = dummy_pubkey(&env, 0xBB);

    // First submission → enumerated at index 0.
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 100, 100, 1, &alice, 0));
    assert_eq!(client.get_player_count(&1), 1);
    assert_eq!(client.get_player_at(&1, &0), Some(alice.clone()));

    // Same pubkey resubmits → count unchanged.
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 200, 200, 2, &alice, 0));
    assert_eq!(client.get_player_count(&1), 1);

    // New pubkey → enumerated at index 1.
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 50, 50, 3, &bob, 0));
    assert_eq!(client.get_player_count(&1), 2);
    assert_eq!(client.get_player_at(&1, &1), Some(bob));
}

#[test]
fn enumeration_isolated_per_game() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));
    client.add_game(&2, &dummy_image_id(&env, 0xBB));

    let p = dummy_pubkey(&env, 0x11);
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 100, 100, 1, &p, 0));

    assert_eq!(client.get_player_count(&1), 1);
    assert_eq!(client.get_player_count(&2), 0);
    assert_eq!(client.get_player_at(&1, &0), Some(p));
    assert_eq!(client.get_player_at(&2, &0), None);
}

#[test]
fn get_players_page_returns_requested_range() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));

    // Submit 5 distinct players.
    for i in 0..5u32 {
        let pk = pubkey_from_index(&env, i);
        client.submit_score(&1, &seal_stub(&env), &journal(&env, i, i, i, &pk, 0));
    }
    assert_eq!(client.get_player_count(&1), 5);

    // Full range.
    let page = client.get_players_page(&1, &0, &5);
    assert_eq!(page.len(), 5);
    for i in 0..5u32 {
        assert_eq!(page.get(i).unwrap(), pubkey_from_index(&env, i));
    }

    // Middle slice.
    let mid = client.get_players_page(&1, &1, &4);
    assert_eq!(mid.len(), 3);
    assert_eq!(mid.get(0).unwrap(), pubkey_from_index(&env, 1));
    assert_eq!(mid.get(2).unwrap(), pubkey_from_index(&env, 3));

    // Past the end → short return.
    let tail = client.get_players_page(&1, &3, &10);
    assert_eq!(tail.len(), 2);

    // Empty / inverted range.
    let empty = client.get_players_page(&1, &5, &5);
    assert_eq!(empty.len(), 0);
}

#[test]
fn get_players_page_caps_at_max_page_size() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));

    // 60 distinct players exceed MAX_PAGE_SIZE=50.
    for i in 0..60u32 {
        let pk = pubkey_from_index(&env, i);
        client.submit_score(&1, &seal_stub(&env), &journal(&env, 0, 0, 0, &pk, 0));
    }

    let page = client.get_players_page(&1, &0, &60);
    // Capped to MAX_PAGE_SIZE even though we asked for 60.
    assert_eq!(page.len(), MAX_PAGE_SIZE);
}

/// 1500-cap test is gated behind `--ignored` because making 1500
/// submit_score calls in a unit test is slow. Run with
/// `cargo test -p game_hub silent_skip_past_cap -- --ignored`.
#[test]
#[ignore]
fn enumeration_silent_skips_past_cap() {
    let (env, admin, verifier, client) = make_env();
    client.initialize(&admin, &verifier);
    client.add_game(&1, &dummy_image_id(&env, 0xAA));

    // Fill the table exactly to MAX_PLAYERS_PER_GAME.
    for i in 0..MAX_PLAYERS_PER_GAME {
        let pk = pubkey_from_index(&env, i);
        client.submit_score(&1, &seal_stub(&env), &journal(&env, 0, 0, 0, &pk, 0));
    }
    assert_eq!(client.get_player_count(&1), MAX_PLAYERS_PER_GAME);

    // Past-cap player: HighScore lands, enumeration is silently skipped.
    let extra = pubkey_from_index(&env, MAX_PLAYERS_PER_GAME);
    client.submit_score(&1, &seal_stub(&env), &journal(&env, 9999, 9999, 7, &extra, 0));

    assert_eq!(
        client.get_player_count(&1),
        MAX_PLAYERS_PER_GAME,
        "count did not grow past cap"
    );
    let hs = client.get_score(&1, &extra).expect("HighScore still written");
    assert_eq!(hs.score, 9999);
}

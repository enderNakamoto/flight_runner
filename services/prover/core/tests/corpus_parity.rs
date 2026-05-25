//! Cross-language parity gate.
//!
//! Loads `packages/sim/tests/corpus/parity_hashes.json` (produced by
//! `packages/sim/scripts/dump-hashes.ts`), replays every transcript through
//! the Rust sim, and asserts the per-tick SHA-256 chain hash matches the
//! TS-side reference byte-for-byte.
//!
//! Run this on every sim PR. Any drift between the two sims trips here.
//!
//! Regenerate the reference when the corpus or sim changes:
//!   npx tsx packages/sim/scripts/dump-hashes.ts

use std::fs;
use std::path::PathBuf;

use flight_scroll_core::serialize::serialize_state;
use flight_scroll_core::stages::Stage;
use flight_scroll_core::state::create_initial_state;
use flight_scroll_core::step::step_mut;
use flight_scroll_core::transcript::decode_transcript;
use flight_scroll_core::types::PlayerInput;
use sha2::{Digest, Sha256};

fn corpus_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = .../services/prover/core
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/sim/tests/corpus")
        .canonicalize()
        .expect("corpus dir resolves")
}

fn chain_hash(buf: &[u8]) -> String {
    let decoded = decode_transcript(buf).expect("decode");
    let mut state = create_initial_state(decoded.seed, Stage::Common);
    let mut h = Sha256::digest(serialize_state(&state)).to_vec();
    for &b in &decoded.buttons {
        step_mut(&mut state, PlayerInput { buttons: b });
        let mut hasher = Sha256::new();
        hasher.update(&h);
        hasher.update(serialize_state(&state));
        h = hasher.finalize().to_vec();
        if state.game_over {
            break;
        }
    }
    h.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn rust_chain_hash_matches_ts_reference_for_every_corpus_file() {
    let dir = corpus_dir();
    let json_path = dir.join("parity_hashes.json");
    let json_text = fs::read_to_string(&json_path).unwrap_or_else(|e| {
        panic!("read {}: {e}\n(run `npx tsx packages/sim/scripts/dump-hashes.ts` to regenerate)", json_path.display());
    });
    let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str::<serde_json::Value>(&json_text)
        .expect("valid JSON")
        .as_object()
        .expect("top-level object")
        .clone();

    assert!(!map.is_empty(), "parity_hashes.json is empty");

    let mut mismatches: Vec<(String, String, String)> = Vec::new();
    for (filename, expected) in &map {
        let expected = expected.as_str().expect("hash is string");
        let bin = fs::read(dir.join(filename)).expect("read .bin");
        let got = chain_hash(&bin);
        if got != expected {
            mismatches.push((filename.clone(), expected.to_string(), got));
        }
    }

    if !mismatches.is_empty() {
        for (f, expected, got) in &mismatches {
            eprintln!("  FAIL {f}\n    expected {expected}\n    got      {got}");
        }
        panic!("{}/{} corpus files diverged between TS and Rust sims", mismatches.len(), map.len());
    }

    println!("{} corpus files, all chain hashes match between TS and Rust", map.len());
}

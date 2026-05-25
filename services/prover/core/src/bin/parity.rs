//! Parity binary — reads a flight_scroll transcript `.bin`, replays it
//! tick-by-tick through the Rust sim, and prints a per-tick SHA-256 chain
//! hash that the TS side can produce too. If the two hashes match, the
//! sims are bit-identical at every recorded tick.
//!
//! Usage:
//!   cargo run -p flight_scroll_core --bin parity -- <path-to-bin>
//!
//! Output (deliberately minimal, one line per field, easy to diff):
//!   file        ...
//!   seed        0x...
//!   ticks       NNN  (consumed)
//!   score       NN
//!   stage       NN
//!   reason      NN
//!   chain_hash  hex (64 chars)

use std::env;
use std::fs;
use std::process::ExitCode;

use flight_scroll_core::serialize::serialize_state;
use flight_scroll_core::stages::Stage;
use flight_scroll_core::state::create_initial_state;
use flight_scroll_core::step::step_mut;
use flight_scroll_core::transcript::decode_transcript;
use flight_scroll_core::types::PlayerInput;

use sha2::{Digest, Sha256};

fn main() -> ExitCode {
    let path = match env::args().nth(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: parity <path-to-transcript.bin>");
            return ExitCode::from(2);
        }
    };
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("read {path}: {e}");
            return ExitCode::from(2);
        }
    };
    let decoded = match decode_transcript(&bytes) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("decode: {e}");
            return ExitCode::from(2);
        }
    };

    // Chain hash: h_0 = sha256(serialize(s_0)); h_n = sha256(h_{n-1} || serialize(s_n)).
    // Must match packages/sim/scripts/chain-hash.ts.
    let mut state = create_initial_state(decoded.seed, Stage::Common);
    let mut h = Sha256::digest(serialize_state(&state)).to_vec();
    let mut consumed: u32 = 0;
    for &b in &decoded.buttons {
        step_mut(&mut state, PlayerInput { buttons: b });
        consumed += 1;
        let mut hasher = Sha256::new();
        hasher.update(&h);
        hasher.update(serialize_state(&state));
        h = hasher.finalize().to_vec();
        if state.game_over {
            break;
        }
    }
    let hash_hex: String = h.iter().map(|b| format!("{b:02x}")).collect();

    println!("file        {path}");
    println!("seed        0x{:08x}", decoded.seed as u32);
    println!("ticks       {consumed}");
    println!("score       {}", state.score);
    println!("stage       {}", state.stage);
    println!("reason      {}", state.game_over_reason as u8);
    println!("chain_hash  {hash_hex}");
    ExitCode::SUCCESS
}

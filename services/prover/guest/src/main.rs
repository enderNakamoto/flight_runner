//! zkVM guest — replays a transcript through the deterministic sim and
//! commits a 76-byte journal (`ProverOutput`). Mirrored on-chain in
//! contracts/game_hub/src/lib.rs.
//!
//! Input wire format the host writes:
//!   1) one u32 — byte length of the transcript payload
//!   2) ceil(byte_len/4) u32 words — the transcript bytes packed LE
//!   3) 8 u32 words — the player's 32-byte ED25519 pubkey (LE)
//!
//! Output: env::commit_slice of 19 u32 words = the 76-byte journal.

#![no_main]

use flight_scroll_core::fp::run_streaming;
use flight_scroll_core::types::ProverOutput;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

/// Max transcript size we accept inside the guest. 10 000 u32 words ≈
/// 40 000 bytes ≈ 39 996 ticks @ 1 byte/tick + 4-byte seed header.
const MAX_INPUT_WORDS: usize = 10_000;

fn main() {
    let mut input_len = [0u32; 1];
    env::read_slice(&mut input_len);
    let byte_len = input_len[0] as usize;
    let word_len = byte_len.div_ceil(4);
    assert!(
        word_len <= MAX_INPUT_WORDS,
        "transcript too large: {word_len} words exceeds {MAX_INPUT_WORDS}"
    );

    let mut raw_words = [0u32; MAX_INPUT_WORDS];
    env::read_slice(&mut raw_words[..word_len]);
    let raw_bytes = &bytemuck::cast_slice::<u32, u8>(&raw_words[..word_len])[..byte_len];

    // Player's 32-byte ED25519 pubkey, written as 8 LE u32 words after the
    // transcript. The contract credits the high score to this pubkey.
    let mut pubkey_words = [0u32; 8];
    env::read_slice(&mut pubkey_words);
    let pubkey_slice = bytemuck::cast_slice::<u32, u8>(&pubkey_words);
    let mut player_pubkey = [0u8; 32];
    player_pubkey.copy_from_slice(pubkey_slice);

    let result = run_streaming(raw_bytes, player_pubkey).expect("run_streaming");

    let output = ProverOutput {
        score: result.state.score,
        ticks_survived: result.state.tick,
        seed: result.seed,
        player_pubkey: result.player_pubkey,
        transcript_hash: result.transcript_hash,
    };

    env::commit_slice(&output.to_journal_words());
}

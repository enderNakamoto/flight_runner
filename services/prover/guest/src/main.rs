//! zkVM guest — replays a transcript through the deterministic sim and
//! commits a 44-byte journal (`ProverOutput`). See spec/zk_risk_0_stellar.md
//! §5.2 for the matching input/output protocol.
//!
//! Input wire format the host writes:
//!   1) one u32 — byte length of the transcript payload
//!   2) ceil(byte_len/4) u32 words — the transcript bytes packed LE
//!
//! Output: env::commit_slice of 11 u32 words = the 44-byte journal.

#![no_main]

use flight_scroll_core::fp::run_streaming;
use flight_scroll_core::types::ProverOutput;
use risc0_zkvm::guest::env;

risc0_zkvm::guest::entry!(main);

/// Max transcript size we accept inside the guest.
/// 9002 u32s ≈ 36 008 bytes ≈ 36 000 ticks @ 1 byte/tick + 8-byte header.
/// Pad to 10 000 for headroom. Spec/zk_risk_0_stellar.md §4.3.
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

    let result = run_streaming(raw_bytes).expect("run_streaming");

    let output = ProverOutput {
        score: result.state.score,
        ticks_survived: result.state.tick,
        seed: result.seed,
        transcript_hash: result.transcript_hash,
    };

    env::commit_slice(&output.to_journal_words());
}

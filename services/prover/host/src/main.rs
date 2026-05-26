//! flight-host — drives the RISC Zero prover over a recorded transcript.
//!
//! Phase 4 scope is **local only**. Two modes:
//!   - default          : Groth16-wrapped receipt → 260-byte on-chain seal.
//!   - `--local`        : STARK receipt, no Groth16 wrap, *not* on-chain
//!                        submittable. Faster, useful for dev iteration.
//!
//! `RISC0_DEV_MODE=1` skips real proving entirely (mock receipts that still
//! `verify` locally). Use for end-to-end smoke tests without a Groth16
//! toolchain.
//!
//! Output `proof_artifacts.json`:
//!   {
//!     "mode":       "groth16" | "stark" | "dev",
//!     "seal":       "<hex>",    // 260 bytes for groth16, else receipt bytes
//!     "image_id":   "<hex>",    // 32 bytes
//!     "journal":    "<hex>",    // 44 bytes
//!     "output":     { score, ticks_survived, seed, transcript_hash }
//!   }

use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use flight_methods::{FLIGHT_GUEST_ELF, FLIGHT_GUEST_ID};
use flight_scroll_core::types::{ProverOutput, JOURNAL_BYTES};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, Receipt};
use serde_json::json;

/// RISC Zero v3.0.x Groth16 verifier-selector. First 4 bytes of
/// SHA-256(Groth16ReceiptVerifierParameters). Pinned in spec §4.5.
/// Stellar verifier contract expects the seal prefixed with this selector.
const GROTH16_SELECTOR: [u8; 4] = [0x73, 0xc4, 0x57, 0xba];

#[derive(Parser, Debug)]
#[command(name = "flight-host", about = "Prove a flight_scroll run locally")]
struct Cli {
    /// Path to the recorded transcript (`.bin` file from PlayScene's `T` key).
    transcript: PathBuf,

    /// Produce a STARK receipt instead of Groth16. Faster but not on-chain
    /// submittable.
    #[arg(long)]
    local: bool,

    /// Where to write proof_artifacts.json (default: ./proof_artifacts.json).
    #[arg(short, long, default_value = "proof_artifacts.json")]
    out: PathBuf,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let transcript = fs::read(&cli.transcript)
        .with_context(|| format!("read transcript {}", cli.transcript.display()))?;
    let byte_len = transcript.len() as u32;
    eprintln!("[host] transcript {} ({} bytes)", cli.transcript.display(), byte_len);

    // Pack raw bytes into LE u32 words for the guest. div_ceil so the last
    // partial word gets zero-padded; the guest re-slices back to byte_len.
    let word_len = transcript.len().div_ceil(4);
    let mut words = vec![0u32; word_len];
    for (i, chunk) in transcript.chunks(4).enumerate() {
        let mut buf = [0u8; 4];
        buf[..chunk.len()].copy_from_slice(chunk);
        words[i] = u32::from_le_bytes(buf);
    }

    let env = ExecutorEnv::builder()
        .write_slice(&[byte_len])
        .write_slice(&words)
        .build()
        .map_err(|e| anyhow!("ExecutorEnv build: {e}"))?;

    let dev_mode = std::env::var("RISC0_DEV_MODE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let use_groth16 = !cli.local && !dev_mode;
    let mode = if dev_mode {
        "dev"
    } else if cli.local {
        "stark"
    } else {
        "groth16"
    };
    eprintln!("[host] mode = {mode}");

    let opts = if use_groth16 {
        ProverOpts::groth16()
    } else {
        ProverOpts::default()
    };

    eprintln!("[host] proving …");
    let prover = default_prover();
    let prove_info = prover
        .prove_with_opts(env, FLIGHT_GUEST_ELF, &opts)
        .map_err(|e| anyhow!("prove_with_opts: {e}"))?;
    let receipt: Receipt = prove_info.receipt;

    receipt
        .verify(FLIGHT_GUEST_ID)
        .map_err(|e| anyhow!("receipt.verify(FLIGHT_GUEST_ID): {e}"))?;
    eprintln!("[host] receipt verified locally");

    // Journal — guest committed exactly the 44 bytes we need.
    let journal = receipt.journal.bytes.clone();
    if journal.len() != JOURNAL_BYTES {
        return Err(anyhow!(
            "journal length {} != {JOURNAL_BYTES}",
            journal.len()
        ));
    }
    let output = ProverOutput::from_journal_bytes(&journal)
        .map_err(|e| anyhow!("decode journal: {e}"))?;

    // Seal — Groth16 path prepends the 4-byte verifier-selector to make the
    // 260-byte on-chain blob. Other modes serialize the receipt as-is for
    // local inspection (NOT submittable).
    let seal: Vec<u8> = if use_groth16 {
        let g = receipt
            .inner
            .groth16()
            .map_err(|e| anyhow!("expected Groth16 receipt, got: {e}"))?;
        let mut buf = Vec::with_capacity(4 + g.seal.len());
        buf.extend_from_slice(&GROTH16_SELECTOR);
        buf.extend_from_slice(&g.seal);
        buf
    } else {
        // For STARK / dev paths, just dump the bincoded receipt so the file
        // shape stays uniform. NOT a valid on-chain seal.
        bincode::serialize(&receipt).map_err(|e| anyhow!("bincode receipt: {e}"))?
    };

    let image_id_bytes: [u8; 32] = id_to_bytes(FLIGHT_GUEST_ID);

    let artifacts = json!({
        "mode":     mode,
        "seal":     hex::encode(&seal),
        "image_id": hex::encode(image_id_bytes),
        "journal":  hex::encode(&journal),
        "output": {
            "score":           output.score,
            "ticks_survived":  output.ticks_survived,
            "seed":            output.seed,
            "transcript_hash": hex::encode(output.transcript_hash),
        }
    });

    let body = serde_json::to_string_pretty(&artifacts)? + "\n";
    fs::write(&cli.out, body).with_context(|| format!("write {}", cli.out.display()))?;
    eprintln!("[host] wrote {} ({} bytes seal)", cli.out.display(), seal.len());
    eprintln!(
        "[host] score={} ticks={} seed=0x{:08x}",
        output.score, output.ticks_survived, output.seed
    );
    Ok(())
}

fn id_to_bytes(id: [u32; 8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, w) in id.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
    }
    out
}

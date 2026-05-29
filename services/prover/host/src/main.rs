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

#[cfg(feature = "boundless")]
mod boundless_path;

/// RISC Zero v3.0.x Groth16 verifier-selector. First 4 bytes of
/// SHA-256(Groth16ReceiptVerifierParameters). Pinned in spec §4.5.
/// Stellar verifier contract expects the seal prefixed with this selector.
const GROTH16_SELECTOR: [u8; 4] = [0x73, 0xc4, 0x57, 0xba];

#[derive(Parser, Debug)]
#[command(name = "flight-host", about = "Prove a flight_scroll run locally")]
struct Cli {
    /// Path to the recorded transcript (`.bin` file from PlayScene's `T` key).
    transcript: PathBuf,

    /// Player's Stellar strkey (G…). Decoded to a 32-byte ED25519 pubkey
    /// and committed in the journal. The contract credits this pubkey
    /// on `submit_score`.
    #[arg(long)]
    player: String,

    /// Produce a STARK receipt instead of Groth16. Faster but not on-chain
    /// submittable.
    #[arg(long)]
    local: bool,

    /// Skip RISC Zero entirely — run the sim natively to compute the score,
    /// emit a correctly-shaped 76-byte journal and a 260-byte zero seal.
    /// Lets the on-chain submit_score path land while the contract is
    /// configured with MockVerifier. Replace with --local or default
    /// Groth16 the moment the real verifier is wired.
    #[arg(long)]
    stub_seal: bool,

    /// Outsource Groth16 proving to the Boundless marketplace instead of
    /// running r0vm locally. Requires the `boundless` feature at build
    /// time AND BOUNDLESS_NETWORK / BOUNDLESS_PRIVATE_KEY / PINATA_JWT
    /// env vars at runtime. The returned seal is identical in shape
    /// (260 bytes, `73c457ba` selector prefix) to the local Groth16
    /// path, and verifies against the same Nethermind contract.
    #[cfg(feature = "boundless")]
    #[arg(long)]
    boundless: bool,

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

    // Decode the player's Stellar strkey to a raw 32-byte ED25519 pubkey.
    // The journal will commit these bytes; the contract credits the score
    // to this pubkey.
    let player_pk = stellar_strkey::ed25519::PublicKey::from_string(&cli.player)
        .map_err(|e| anyhow!("invalid --player strkey '{}': {e}", cli.player))?;
    let player_pubkey: [u8; 32] = player_pk.0;
    eprintln!(
        "[host] player {} → pubkey {}",
        cli.player,
        hex::encode(player_pubkey)
    );

    if cli.stub_seal {
        return write_stub_artifacts(&cli, &transcript, player_pubkey);
    }

    #[cfg(feature = "boundless")]
    if cli.boundless {
        return run_boundless(&cli, &transcript, player_pubkey);
    }

    // Pack raw bytes into LE u32 words for the guest. div_ceil so the last
    // partial word gets zero-padded; the guest re-slices back to byte_len.
    let word_len = transcript.len().div_ceil(4);
    let mut words = vec![0u32; word_len];
    for (i, chunk) in transcript.chunks(4).enumerate() {
        let mut buf = [0u8; 4];
        buf[..chunk.len()].copy_from_slice(chunk);
        words[i] = u32::from_le_bytes(buf);
    }

    // Pack pubkey as 8 LE u32 words — must match guest's read order.
    let mut pubkey_words = [0u32; 8];
    for i in 0..8 {
        let o = i * 4;
        pubkey_words[i] = u32::from_le_bytes([
            player_pubkey[o],
            player_pubkey[o + 1],
            player_pubkey[o + 2],
            player_pubkey[o + 3],
        ]);
    }

    let env = ExecutorEnv::builder()
        .write_slice(&[byte_len])
        .write_slice(&words)
        .write_slice(&pubkey_words)
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
            "player":          cli.player.clone(),
            "player_pubkey":   hex::encode(output.player_pubkey),
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

/// Outsource Groth16 proving to Boundless. Identical output shape to the
/// local path (same journal, same 260-byte seal with `73c457ba` selector
/// prefix). The local sim is also run natively to fill in score / ticks /
/// seed fields for the artifacts JSON, since Boundless returns only seal +
/// journal and the relay's response shape includes those fields.
#[cfg(feature = "boundless")]
fn run_boundless(
    cli: &Cli,
    transcript: &[u8],
    player_pubkey: [u8; 32],
) -> Result<()> {
    eprintln!("[host] mode = boundless (remote Groth16 via marketplace)");

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("build tokio runtime")?;

    let (seal, journal) = rt.block_on(boundless_path::prove(
        FLIGHT_GUEST_ELF,
        transcript,
        player_pubkey,
    ))?;

    if journal.len() != JOURNAL_BYTES {
        return Err(anyhow!(
            "boundless journal length {} != {JOURNAL_BYTES}",
            journal.len()
        ));
    }
    let output = ProverOutput::from_journal_bytes(&journal)
        .map_err(|e| anyhow!("decode journal: {e}"))?;

    let image_id_bytes = id_to_bytes(FLIGHT_GUEST_ID);
    let artifacts = json!({
        "mode":     "boundless",
        "seal":     hex::encode(&seal),
        "image_id": hex::encode(image_id_bytes),
        "journal":  hex::encode(&journal),
        "output": {
            "score":           output.score,
            "ticks_survived":  output.ticks_survived,
            "seed":            output.seed,
            "player":          cli.player.clone(),
            "player_pubkey":   hex::encode(output.player_pubkey),
            "transcript_hash": hex::encode(output.transcript_hash),
        }
    });
    let body = serde_json::to_string_pretty(&artifacts)? + "\n";
    fs::write(&cli.out, body).with_context(|| format!("write {}", cli.out.display()))?;
    eprintln!(
        "[host] wrote {} ({} bytes seal via boundless)",
        cli.out.display(),
        seal.len()
    );
    eprintln!(
        "[host] score={} ticks={} seed=0x{:08x}",
        output.score, output.ticks_survived, output.seed
    );
    Ok(())
}

/// Skip RISC Zero entirely — run the sim natively to compute score/ticks,
/// emit a correctly-shaped 76-byte journal and a 260-byte zero seal. Lets
/// the on-chain submit_score path land while the contract uses MockVerifier
/// (which accepts any seal content). Swap for real Groth16 the moment the
/// Nethermind verifier is wired.
fn write_stub_artifacts(
    cli: &Cli,
    transcript: &[u8],
    player_pubkey: [u8; 32],
) -> Result<()> {
    eprintln!("[host] mode = stub-seal (NO ZK PROOF — only valid against MockVerifier)");
    let r = flight_scroll_core::fp::run_streaming(transcript, player_pubkey)
        .map_err(|e| anyhow!("run_streaming: {e}"))?;

    let output = ProverOutput {
        score: r.state.score,
        ticks_survived: r.state.tick,
        seed: r.seed,
        player_pubkey: r.player_pubkey,
        transcript_hash: r.transcript_hash,
    };

    let journal = output.to_journal_bytes();
    let seal = vec![0u8; 260];
    let image_id_bytes = id_to_bytes(FLIGHT_GUEST_ID);

    let artifacts = json!({
        "mode":     "stub",
        "seal":     hex::encode(&seal),
        "image_id": hex::encode(image_id_bytes),
        "journal":  hex::encode(journal),
        "output": {
            "score":           output.score,
            "ticks_survived":  output.ticks_survived,
            "seed":            output.seed,
            "player":          cli.player.clone(),
            "player_pubkey":   hex::encode(output.player_pubkey),
            "transcript_hash": hex::encode(output.transcript_hash),
        }
    });

    let body = serde_json::to_string_pretty(&artifacts)? + "\n";
    fs::write(&cli.out, body)
        .with_context(|| format!("write {}", cli.out.display()))?;
    eprintln!(
        "[host] wrote {} (stub: 260 B zero seal, real 76 B journal)",
        cli.out.display()
    );
    eprintln!(
        "[host] score={} ticks={} seed=0x{:08x}",
        output.score, output.ticks_survived, output.seed
    );
    Ok(())
}

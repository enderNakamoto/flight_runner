//! flight-replay — Phase 13 attest-mode helper.
//!
//! Reads a recorded transcript, runs the deterministic `flight_scroll_core`
//! sim natively (same code path the RISC Zero guest takes — `run_streaming`
//! is shared, so the journal bytes are bit-identical to what the ZK guest
//! would commit), and emits a JSON blob the bun relay then signs with the
//! configured operator key.
//!
//! No RISC Zero, no Boundless, no signing — kept deliberately minimal so a
//! cheap 1C/1GB VPS can build and run it without rzup or docker.
//!
//! Output `proof_artifacts.json` (subset of flight-host's stub shape, no
//! `seal` field):
//!   {
//!     "mode":    "attest",
//!     "journal": "<76-byte hex>",
//!     "output": {
//!       "score":           <u32>,
//!       "ticks_survived":  <u32>,
//!       "seed":            <u32>,
//!       "player":          "G…",
//!       "player_pubkey":   "<hex>",
//!       "transcript_hash": "<hex>"
//!     }
//!   }

use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use flight_scroll_core::fp::run_streaming;
use flight_scroll_core::types::ProverOutput;
use serde_json::json;

#[derive(Parser, Debug)]
#[command(
    name = "flight-replay",
    about = "Replay a flight_scroll transcript natively for attest-mode settlement"
)]
struct Cli {
    /// Path to the recorded transcript (`.bin` from PlayScene's T key).
    transcript: PathBuf,

    /// Player's Stellar strkey (G…). Decoded to a 32-byte ED25519 pubkey
    /// and committed in the journal — the contract credits this pubkey
    /// on `settle_attested`.
    #[arg(long)]
    player: String,

    /// Where to write proof_artifacts.json (default: ./proof_artifacts.json).
    #[arg(short, long, default_value = "proof_artifacts.json")]
    out: PathBuf,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let transcript = fs::read(&cli.transcript)
        .with_context(|| format!("read transcript {}", cli.transcript.display()))?;
    eprintln!(
        "[replay] transcript {} ({} bytes)",
        cli.transcript.display(),
        transcript.len()
    );

    let player_pk = stellar_strkey::ed25519::PublicKey::from_string(&cli.player)
        .map_err(|e| anyhow!("invalid --player strkey '{}': {e}", cli.player))?;
    let player_pubkey: [u8; 32] = player_pk.0;
    eprintln!(
        "[replay] player {} → pubkey {}",
        cli.player,
        hex::encode(player_pubkey)
    );

    let r = run_streaming(&transcript, player_pubkey)
        .map_err(|e| anyhow!("run_streaming: {e}"))?;

    let output = ProverOutput {
        score: r.state.score,
        ticks_survived: r.state.tick,
        seed: r.seed,
        player_pubkey: r.player_pubkey,
        transcript_hash: r.transcript_hash,
    };
    let journal = output.to_journal_bytes();

    let artifacts = json!({
        "mode":    "attest",
        "journal": hex::encode(journal),
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
    eprintln!("[replay] wrote {} (76 B journal)", cli.out.display());
    eprintln!(
        "[replay] score={} ticks={} seed=0x{:08x}",
        output.score, output.ticks_survived, output.seed
    );
    Ok(())
}

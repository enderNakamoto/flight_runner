//! Boundless marketplace proving path (Phase 12).
//!
//! Compiled only when `--features boundless` is enabled. Replaces the local
//! `default_prover().prove_with_opts(...)` call with a remote proof request
//! against the Boundless decentralized prover market.
//!
//! Input wire format is **identical** to the local path — the guest reads
//! three back-to-back raw byte sequences (`byte_len` u32, transcript words,
//! pubkey 8 u32) via `env::read_slice`. Since `read_slice` is unframed, we
//! just concatenate those same bytes into one stdin buffer and the guest
//! runs unchanged. image_id stays the same.
//!
//! Env vars read at runtime:
//!   BOUNDLESS_NETWORK      - "ethereum-sepolia" | "base-sepolia"
//!                            | "base-mainnet" | "ethereum-mainnet"
//!   BOUNDLESS_RPC_URL      - optional override; otherwise public default
//!                            per network
//!   BOUNDLESS_PRIVATE_KEY  - 0x-prefixed hex; the wallet that pays for
//!                            proofs. See docs/boundless-wallet.md.
//!   PINATA_JWT             - IPFS pinning for the guest ELF + inputs

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use boundless_market::{
    price_oracle::{Amount, Asset},
    request_builder::OfferParams,
    storage::{StorageUploaderConfig, StorageUploaderType},
    Client,
};
use url::Url;

/// Default RPC for each supported network. Override with BOUNDLESS_RPC_URL
/// if you hit public-node rate limits.
///
/// The SDK auto-detects the BoundlessMarket / verifier addresses from the
/// chain ID the RPC returns, so we pass `with_deployment(None)` and let
/// it resolve. The list below exists only to map our friendlier
/// BOUNDLESS_NETWORK names to public RPC defaults.
fn default_rpc(network: &str) -> Result<&'static str> {
    Ok(match network {
        "ethereum-sepolia" => "https://ethereum-sepolia-rpc.publicnode.com",
        "base-sepolia" => "https://sepolia.base.org",
        "base-mainnet" => "https://mainnet.base.org",
        "ethereum-mainnet" => "https://ethereum-rpc.publicnode.com",
        other => return Err(anyhow!("unknown BOUNDLESS_NETWORK '{other}'")),
    })
}

/// Build the stdin buffer the guest will consume. Byte-for-byte equivalent
/// to the local path's three `ExecutorEnv::write_slice` calls, but flattened
/// to one contiguous buffer for the Boundless SDK.
fn build_stdin(transcript: &[u8], player_pubkey: [u8; 32]) -> Vec<u8> {
    let byte_len = transcript.len() as u32;
    // 1) one u32 LE: byte_len
    let mut out = Vec::with_capacity(4 + transcript.len().next_multiple_of(4) + 32);
    out.extend_from_slice(&byte_len.to_le_bytes());
    // 2) transcript bytes, zero-padded up to a 4-byte boundary (the guest
    //    re-slices to byte_len internally, but read_slice on the u32 buffer
    //    requires a whole word count).
    let padded_len = transcript.len().next_multiple_of(4);
    out.extend_from_slice(transcript);
    out.extend(std::iter::repeat(0u8).take(padded_len - transcript.len()));
    // 3) 32-byte pubkey, read by the guest as 8 LE u32s — the byte order is
    //    already correct (each u32's LE bytes are sequential pubkey bytes).
    out.extend_from_slice(&player_pubkey);
    out
}

/// Prove via Boundless. Returns (seal, journal) ready to write into
/// proof_artifacts.json — the seal already includes the 4-byte verifier
/// selector prefix that the Stellar verifier expects.
pub async fn prove(
    elf: &'static [u8],
    transcript: &[u8],
    player_pubkey: [u8; 32],
) -> Result<(Vec<u8>, Vec<u8>)> {
    let network = std::env::var("BOUNDLESS_NETWORK")
        .context("BOUNDLESS_NETWORK env var required (e.g. ethereum-sepolia)")?;
    let private_key_hex = std::env::var("BOUNDLESS_PRIVATE_KEY")
        .context("BOUNDLESS_PRIVATE_KEY env var required (0x-prefixed hex)")?;
    let pinata_jwt = std::env::var("PINATA_JWT")
        .context("PINATA_JWT env var required for IPFS uploads")?;
    let rpc_url_str = std::env::var("BOUNDLESS_RPC_URL")
        .ok()
        .unwrap_or_else(|| default_rpc(&network).expect("validated above").to_string());

    let rpc_url: Url = rpc_url_str.parse().context("parse BOUNDLESS_RPC_URL")?;
    let private_key: alloy::signers::local::PrivateKeySigner = private_key_hex
        .parse()
        .context("parse BOUNDLESS_PRIVATE_KEY as PrivateKeySigner")?;

    eprintln!("[boundless] network={network} rpc={rpc_url_str}");
    eprintln!("[boundless] wallet={}", private_key.address());

    // The Pinata uploader needs the JWT passed explicitly to the builder
    // — it does NOT auto-read PINATA_JWT from env, despite the env-var
    // convention suggesting otherwise.
    let storage = StorageUploaderConfig::builder()
        .storage_uploader(StorageUploaderType::Pinata)
        .pinata_jwt(pinata_jwt)
        .build()
        .context("build Pinata storage uploader config")?;

    // `with_deployment(None)` → SDK resolves BoundlessMarket + verifier
    // addresses from the chain ID returned by the RPC. Works on every
    // supported chain without us hardcoding addresses per network.
    let client = Client::builder()
        .with_rpc_url(rpc_url)
        .with_deployment(None)
        .with_uploader_config(&storage)
        .await
        .context("build Boundless storage uploader")?
        .with_private_key(private_key)
        .build()
        .await
        .context("build Boundless client")?;

    let stdin = build_stdin(transcript, player_pubkey);
    eprintln!(
        "[boundless] stdin {} bytes (transcript {} + pubkey 32 + header 4)",
        stdin.len(),
        transcript.len()
    );

    // max_price = 2× the first observed mainnet payout (0.00001743 ETH).
    // Raising the ceiling lets premium provers bid sooner.
    let max_price_wei: alloy::primitives::U256 =
        alloy::primitives::utils::parse_units("0.000035", "ether")
            .expect("constant parses")
            .into();
    let max_price = Amount::new(max_price_wei, Asset::ETH);
    eprintln!("[boundless] max_price={max_price_wei} wei (0.000035 ETH)");

    let request = client
        .new_request()
        .with_program(elf)
        .with_stdin(stdin)
        .with_groth16_proof()
        .with_offer(OfferParams::builder().max_price(max_price));

    eprintln!("[boundless] submitting request …");
    let (request_id, expires_at) = client
        .submit(request)
        .await
        .context("submit Boundless request")?;
    eprintln!("[boundless] request_id=0x{request_id:x} expires_at={expires_at}");

    eprintln!("[boundless] waiting for fulfillment …");
    let fulfillment = client
        .wait_for_request_fulfillment(request_id, Duration::from_secs(5), expires_at)
        .await
        .context("wait_for_request_fulfillment")?;

    // `fulfillment.seal` is alloy::primitives::Bytes; convert to Vec<u8>
    // so the rest of the host code (which works in Vec<u8>) doesn't need
    // to know about alloy types.
    let seal = fulfillment.seal.to_vec();
    let data = fulfillment.data().context("fulfillment data")?;
    let journal = data
        .journal()
        .ok_or_else(|| anyhow!("fulfillment missing journal"))?
        .to_vec();

    eprintln!(
        "[boundless] ✅ fulfilled — seal {} bytes, journal {} bytes",
        seal.len(),
        journal.len()
    );
    Ok((seal, journal))
}

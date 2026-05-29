//! game_hub — multi-game Soroban host (minimum-viable).
//!
//! Single contract that hosts any number of games, with **two
//! settlement entrypoints**:
//!
//! - `submit_score(game_id, seal, journal)` — RISC Zero ZK path
//!   (Phases 11–12). Verifies a Groth16 seal against the registered
//!   image_id via the configured verifier contract.
//! - `settle_attested(game_id, journal, op_signature)` — attest path
//!   (Phase 13). Verifies an ed25519 signature from the configured
//!   trusted operator over `(game_id || journal)`. No RISC Zero
//!   verifier call. Sub-3-second end-to-end vs 5–25 min for the ZK
//!   path; trust shifts from math to the operator key.
//!
//! Both entrypoints land in the same HighScore + enumeration storage
//! — `record_journal_state` is the shared internal helper, called
//! after whichever authenticity check the entrypoint mandates.
//!
//! Admin registers each game by pinning its 32-byte ELF `image_id`.
//! The image_id is consulted by `submit_score` only; `settle_attested`
//! just checks that the game_id is registered (it doesn't read the
//! pinned image_id).
//!
//! Anti-cheat:
//! - The proof binds to the player via the 32-byte ED25519 pubkey
//!   committed inside the journal. The contract stores high scores
//!   keyed by that pubkey, so anyone can submit on anyone's behalf —
//!   credit always flows to whoever the proof committed to.
//! - The contract makes no claim about seed fairness. A determined
//!   player can grind seeds offline; bots are the bigger threat and
//!   `start_run` wouldn't have stopped them anyway.
//!
//! Storage layout (see `DataKey`):
//!   - Instance:   `Admin`, `Verifier`, `TrustedOperator`
//!   - Persistent: `ImageId(u32)`,
//!                 `HighScore(u32, BytesN<32>)`,
//!                 `PlayerCount(u32)`,
//!                 `PlayerByIndex(u32, u32)`,
//!                 `PlayerSeen(u32, BytesN<32>)`
//!
//! Enumeration:
//! - Up to `MAX_PLAYERS_PER_GAME = 1500` players per game are tracked
//!   in an indexed table (`PlayerByIndex` + `PlayerSeen` for O(1)
//!   membership). New players past the cap **silently skip** the
//!   enumeration — their `HighScore` is still recorded, they just
//!   don't appear in the public top-N leaderboard.
//!
//! Journal layout (76 bytes — mirrored in services/prover/core/src/types.rs):
//!   - 0..4   score          u32 LE
//!   - 4..8   ticks_survived u32 LE
//!   - 8..12  seed           u32 LE (player-chosen, NOT verified on-chain)
//!   - 12..44 player_pubkey  ED25519 public key (32 bytes)
//!   - 44..76 transcript_hash SHA-256 of raw transcript bytes (32 bytes)

#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Bytes, BytesN, Env, Vec,
};

// ─────────────────────────────────────────────────────────────────────────────
// Verifier interface — abstract so MockVerifier (tests / early testnet) and
// the real Nethermind stellar-risc0-verifier (production) are drop-in
// replacements. Both contracts must expose a function with this exact
// signature; the deployed contract address is configured at `initialize`.
// ─────────────────────────────────────────────────────────────────────────────

#[contractclient(name = "VerifierClient")]
pub trait Verifier {
    fn verify(env: Env, seal: Bytes, image_id: BytesN<32>, journal_digest: BytesN<32>);
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

pub const JOURNAL_SIZE: u32 = 76;
pub const SEAL_SIZE: u32 = 260;

/// Hard cap on per-game enumerated players. Once a game reaches this many
/// unique submitters, additional new players still have their `HighScore`
/// recorded but are not indexed.
pub const MAX_PLAYERS_PER_GAME: u32 = 1500;

/// Maximum page size for `get_players_page`. Bounds a single read tx's
/// ledger-entry budget — Soroban caps `total footprint ledger entries`
/// at 100, and the contract-instance + code entries take a couple of
/// slots, so 50 player entries per page leaves comfortable headroom.
pub const MAX_PAGE_SIZE: u32 = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Errors — keep numeric values stable across releases (clients hard-code them).
// ─────────────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    GameNotFound = 4,
    GameAlreadyExists = 5,
    // 6 was GamePaused — removed; admin can rotate image_id to junk to
    // effectively pause if ever needed.
    InvalidSeal = 7,
    InvalidJournal = 8,
    TrustedOperatorNotSet = 9,
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Verifier,
    /// ED25519 public key of the off-chain "trusted operator" that signs
    /// `settle_attested` payloads (Phase 13 attest mode). Single global
    /// operator across all games. Instance storage. Optional — only
    /// required when settle_attested is used.
    TrustedOperator,
    /// Pinned ELF image hash for a given game. Persistent.
    ImageId(u32),
    /// Player's personal-best score for a game, keyed by the 32-byte
    /// ED25519 pubkey committed in the proof's journal. Persistent.
    HighScore(u32, BytesN<32>),
    /// Number of distinct enumerated players for a game (0..=MAX_PLAYERS_PER_GAME).
    /// Persistent.
    PlayerCount(u32),
    /// Indexed list of enumerated players. `PlayerByIndex(game_id, i)` is
    /// the i-th unique submitter; valid for `i in 0..PlayerCount(game_id)`.
    /// Persistent.
    PlayerByIndex(u32, u32),
    /// O(1) "have I already enumerated this pubkey?" membership flag.
    /// Persistent.
    PlayerSeen(u32, BytesN<32>),
}

// ─────────────────────────────────────────────────────────────────────────────
// Value types
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HighScoreEntry {
    pub score: u32,
    pub ticks_survived: u32,
    /// 32-bit seed the player ran the sim with. Stored for reproducibility
    /// (anyone can replay the run by querying this seed + the off-chain
    /// transcript). NOT verified on-chain.
    pub seed: u32,
    /// Ledger timestamp at settlement.
    pub settled_at: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn require_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

/// Read a little-endian u32 from a Soroban Bytes at byte offset.
fn read_u32_le(bytes: &Bytes, offset: u32) -> u32 {
    let b0 = bytes.get(offset).expect("bounds checked by caller") as u32;
    let b1 = bytes.get(offset + 1).expect("bounds checked by caller") as u32;
    let b2 = bytes.get(offset + 2).expect("bounds checked by caller") as u32;
    let b3 = bytes.get(offset + 3).expect("bounds checked by caller") as u32;
    b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
}

/// Slice journal bytes 12..44 as the player pubkey.
fn read_player_pubkey(env: &Env, journal: &Bytes) -> BytesN<32> {
    let mut buf = [0u8; 32];
    for i in 0..32 {
        buf[i as usize] = journal.get(12 + i).expect("bounds checked by caller");
    }
    BytesN::from_array(env, &buf)
}

/// Decode a length-checked 76-byte journal and apply the HighScore +
/// enumeration state transitions. Shared between `submit_score`
/// (after ZK verify) and `settle_attested` (after ed25519 verify) so
/// both proving paths land in identical leaderboard state.
///
/// Caller must have already:
/// - asserted `journal.len() == JOURNAL_SIZE`
/// - asserted the game_id is registered
/// - performed whichever authenticity check the entrypoint mandates
///   (ZK proof for submit_score; ed25519 op sig for settle_attested).
fn record_journal_state(env: &Env, game_id: u32, journal: &Bytes) {
    let score = read_u32_le(journal, 0);
    let ticks = read_u32_le(journal, 4);
    let seed = read_u32_le(journal, 8);
    let player_pubkey = read_player_pubkey(env, journal);

    // ── HighScore update ──────────────────────────────────────────────
    let hs_key = DataKey::HighScore(game_id, player_pubkey.clone());
    let existing: Option<HighScoreEntry> = env.storage().persistent().get(&hs_key);
    let is_pb = match &existing {
        None => true,
        Some(old) => score > old.score || (score == old.score && ticks > old.ticks_survived),
    };
    if is_pb {
        let entry = HighScoreEntry {
            score,
            ticks_survived: ticks,
            seed,
            settled_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&hs_key, &entry);
        env.events().publish(
            (symbol_short!("pb"), game_id, player_pubkey.clone()),
            (score, ticks, seed),
        );
    }

    // ── Enumeration (silent-skip past cap) ────────────────────────────
    let seen_key = DataKey::PlayerSeen(game_id, player_pubkey.clone());
    let already_seen: bool = env
        .storage()
        .persistent()
        .get(&seen_key)
        .unwrap_or(false);
    if !already_seen {
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PlayerCount(game_id))
            .unwrap_or(0);
        if count < MAX_PLAYERS_PER_GAME {
            env.storage().persistent().set(&seen_key, &true);
            env.storage()
                .persistent()
                .set(&DataKey::PlayerByIndex(game_id, count), &player_pubkey);
            env.storage()
                .persistent()
                .set(&DataKey::PlayerCount(game_id), &(count + 1));
            env.events().publish(
                (symbol_short!("newplayr"), game_id),
                (player_pubkey.clone(), count + 1),
            );
        }
        // else: silent skip — score still landed in HighScore.
    }

    env.events()
        .publish((symbol_short!("settled"), game_id, player_pubkey), (score, ticks));
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct GameHub;

#[contractimpl]
impl GameHub {
    // ── Admin ────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.events()
            .publish((symbol_short!("init"),), (admin, verifier));
        Ok(())
    }

    pub fn add_game(env: Env, game_id: u32, image_id: BytesN<32>) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        if env.storage().persistent().has(&DataKey::ImageId(game_id)) {
            return Err(Error::GameAlreadyExists);
        }
        env.storage()
            .persistent()
            .set(&DataKey::ImageId(game_id), &image_id);
        env.events()
            .publish((symbol_short!("addgame"), game_id), image_id);
        Ok(())
    }

    pub fn set_image_id(env: Env, game_id: u32, new_image_id: BytesN<32>) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        if !env.storage().persistent().has(&DataKey::ImageId(game_id)) {
            return Err(Error::GameNotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::ImageId(game_id), &new_image_id);
        env.events()
            .publish((symbol_short!("setimg"), game_id), new_image_id);
        Ok(())
    }

    pub fn rotate_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("rotadmin"),), (admin, new_admin));
        Ok(())
    }

    /// Swap the verifier contract address. Used to cut over from
    /// MockVerifier (testnet bringup, accepts anything) to the real
    /// Nethermind stellar-risc0-verifier (production, does BN254
    /// pairing checks). Affects every subsequent `submit_score` call;
    /// already-stored HighScores are untouched.
    pub fn set_verifier(env: Env, new_verifier: Address) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        let old: Option<Address> = env.storage().instance().get(&DataKey::Verifier);
        env.storage().instance().set(&DataKey::Verifier, &new_verifier);
        env.events()
            .publish((symbol_short!("setverif"),), (old.unwrap_or(env.current_contract_address()), new_verifier));
        Ok(())
    }

    pub fn get_verifier(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Verifier)
    }

    /// Set or rotate the ED25519 public key trusted to sign
    /// `settle_attested` payloads (Phase 13 attest mode). Setting this
    /// is what *enables* attest mode for the contract — until it's set,
    /// `settle_attested` returns `TrustedOperatorNotSet`. Rotating
    /// replaces the prior pubkey; in-flight signed payloads against the
    /// old key stop verifying.
    pub fn set_trusted_operator(env: Env, new_operator: BytesN<32>) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        let old: Option<BytesN<32>> = env.storage().instance().get(&DataKey::TrustedOperator);
        env.storage()
            .instance()
            .set(&DataKey::TrustedOperator, &new_operator);
        env.events().publish(
            (symbol_short!("setoper"),),
            (
                old.unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32])),
                new_operator,
            ),
        );
        Ok(())
    }

    pub fn get_trusted_operator(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::TrustedOperator)
    }

    // ── Score submission (permissionless) ────────────────────────────────

    /// Verify a RISC Zero proof and conditionally update the committed
    /// player's personal best. No auth required: the proof binds the
    /// score to a specific 32-byte pubkey, and the score is always
    /// credited there. Anyone (player, relay, friend) can pay the gas.
    ///
    /// PB updates only when `(score, ticks_survived)` strictly exceeds
    /// the existing entry (ties broken by ticks). Lower scores are
    /// silently kept-out and save the storage write.
    ///
    /// Enumeration: on a player's first ever submission for this game,
    /// they're added to the indexed `PlayerByIndex` table — unless that
    /// table is already at `MAX_PLAYERS_PER_GAME`, in which case the
    /// enumeration is **silently skipped** (HighScore is still written).
    pub fn submit_score(env: Env, game_id: u32, seal: Bytes, journal: Bytes) -> Result<(), Error> {
        if seal.len() != SEAL_SIZE {
            return Err(Error::InvalidSeal);
        }
        if journal.len() != JOURNAL_SIZE {
            return Err(Error::InvalidJournal);
        }

        let image_id: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::ImageId(game_id))
            .ok_or(Error::GameNotFound)?;

        let journal_digest = env.crypto().sha256(&journal);
        let journal_digest_bytes = BytesN::from_array(&env, &journal_digest.to_array());

        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)?;
        let verifier = VerifierClient::new(&env, &verifier_addr);
        verifier.verify(&seal, &image_id, &journal_digest_bytes);

        record_journal_state(&env, game_id, &journal);
        Ok(())
    }

    /// Attest-mode settlement (Phase 13). Verifies an ed25519 signature
    /// from the configured `TrustedOperator` over `(game_id || journal)`
    /// in lieu of a RISC Zero proof, then applies the same HighScore +
    /// enumeration update that `submit_score` does. The relay is the
    /// trust anchor here — the operator's ed25519 secret must never be
    /// committed and rotates via `set_trusted_operator`.
    ///
    /// The journal layout is identical to `submit_score`'s (76 bytes,
    /// see `JOURNAL_SIZE` doc above), so a relay can produce the same
    /// shape from a native transcript replay without R0 in the loop.
    ///
    /// The signed message is exactly `game_id_le (4 bytes) || journal
    /// (76 bytes)` — concatenating game_id stops a single signed
    /// journal from being replayed against a different game_id.
    pub fn settle_attested(
        env: Env,
        game_id: u32,
        journal: Bytes,
        op_signature: BytesN<64>,
    ) -> Result<(), Error> {
        if journal.len() != JOURNAL_SIZE {
            return Err(Error::InvalidJournal);
        }

        if !env.storage().persistent().has(&DataKey::ImageId(game_id)) {
            return Err(Error::GameNotFound);
        }

        let operator: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::TrustedOperator)
            .ok_or(Error::TrustedOperatorNotSet)?;

        // Build the signed message: game_id LE bytes || journal.
        let mut msg = Bytes::from_array(&env, &game_id.to_le_bytes());
        msg.append(&journal);

        // Panics on bad signature — same failure semantics as the
        // ZK verifier path in submit_score.
        env.crypto().ed25519_verify(&operator, &msg, &op_signature);

        record_journal_state(&env, game_id, &journal);
        Ok(())
    }

    // ── Reads ────────────────────────────────────────────────────────────

    pub fn get_score(
        env: Env,
        game_id: u32,
        player_pubkey: BytesN<32>,
    ) -> Option<HighScoreEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::HighScore(game_id, player_pubkey))
    }

    pub fn get_image_id(env: Env, game_id: u32) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::ImageId(game_id))
    }

    pub fn get_player_count(env: Env, game_id: u32) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PlayerCount(game_id))
            .unwrap_or(0)
    }

    pub fn get_player_at(env: Env, game_id: u32, idx: u32) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::PlayerByIndex(game_id, idx))
    }

    /// Batched read for indexer pagination — returns players in
    /// `[start, end)` index range, capped at `MAX_PAGE_SIZE` entries
    /// to bound the tx's read-entry budget. End-of-table is signalled
    /// by a shorter-than-requested return.
    pub fn get_players_page(
        env: Env,
        game_id: u32,
        start: u32,
        end: u32,
    ) -> Vec<BytesN<32>> {
        let mut out = Vec::new(&env);
        if end <= start {
            return out;
        }
        let mut span = end - start;
        if span > MAX_PAGE_SIZE {
            span = MAX_PAGE_SIZE;
        }
        for i in 0..span {
            if let Some(pk) = env
                .storage()
                .persistent()
                .get::<DataKey, BytesN<32>>(&DataKey::PlayerByIndex(game_id, start + i))
            {
                out.push_back(pk);
            } else {
                break;
            }
        }
        out
    }
}

mod test;

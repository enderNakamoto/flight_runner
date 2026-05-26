//! game_hub — multi-game Soroban host (simplified).
//!
//! Single contract that hosts an arbitrary number of RISC Zero–verified
//! games. Admin registers each game with its own `image_id`. Players run
//! games **entirely off-chain**; only when they want to record a high
//! score do they prove the run and submit it.
//!
//! Anti-cheat model:
//! - The proof binds to the player via the 32-byte ED25519 pubkey
//!   committed inside the journal. The contract stores high scores keyed
//!   by that pubkey, so anyone can submit on behalf of anyone — the
//!   credit always flows to whoever the proof committed to.
//! - The contract makes no claim about seed fairness. A determined player
//!   can grind seeds offline; this is acceptable for v1 because bots are
//!   the bigger threat and `start_run` wouldn't have stopped them anyway.
//!
//! Storage layout (see `DataKey`):
//!   - Instance:  `Admin`, `Verifier`
//!   - Persistent: `Game(u32)`, `HighScore(u32, BytesN<32>)`
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
    Bytes, BytesN, Env, String,
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
// Constants — pinned by the RISC Zero proof format. See
// services/prover/core/src/types.rs and spec/zk_risk_0_stellar.md §4.5.
// ─────────────────────────────────────────────────────────────────────────────

pub const JOURNAL_SIZE: u32 = 76;
pub const SEAL_SIZE: u32 = 260;

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
    GamePaused = 6,
    InvalidSeal = 7,
    InvalidJournal = 8,
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Verifier,
    /// Per-game metadata. Persistent.
    Game(u32),
    /// Player's personal-best score for a game, keyed by the 32-byte
    /// ED25519 pubkey committed in the proof's journal. Persistent.
    HighScore(u32, BytesN<32>),
}

// ─────────────────────────────────────────────────────────────────────────────
// Value types
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameMeta {
    /// 32-byte RISC Zero guest image ID. Verifier accepts proofs only for
    /// this exact ELF.
    pub image_id: BytesN<32>,
    /// Human-readable slug, e.g. "flight_scroll".
    pub name: String,
    /// Admin kill switch — when true, `submit_score` rejects.
    pub paused: bool,
}

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

    pub fn add_game(
        env: Env,
        game_id: u32,
        image_id: BytesN<32>,
        name: String,
    ) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        if env.storage().persistent().has(&DataKey::Game(game_id)) {
            return Err(Error::GameAlreadyExists);
        }
        let meta = GameMeta {
            image_id: image_id.clone(),
            name,
            paused: false,
        };
        env.storage().persistent().set(&DataKey::Game(game_id), &meta);
        env.events()
            .publish((symbol_short!("addgame"), game_id), image_id);
        Ok(())
    }

    pub fn set_image_id(env: Env, game_id: u32, new_image_id: BytesN<32>) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        let mut meta: GameMeta = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .ok_or(Error::GameNotFound)?;
        meta.image_id = new_image_id.clone();
        env.storage().persistent().set(&DataKey::Game(game_id), &meta);
        env.events()
            .publish((symbol_short!("setimg"), game_id), new_image_id);
        Ok(())
    }

    pub fn set_paused(env: Env, game_id: u32, paused: bool) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        let mut meta: GameMeta = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .ok_or(Error::GameNotFound)?;
        meta.paused = paused;
        env.storage().persistent().set(&DataKey::Game(game_id), &meta);
        env.events()
            .publish((symbol_short!("paused"), game_id), paused);
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

    // ── Score submission (permissionless) ────────────────────────────────

    /// Verify a RISC Zero proof and conditionally update the committed
    /// player's personal best. No auth required: the proof binds the
    /// score to a specific 32-byte pubkey, and the score is always
    /// credited there. Anyone (player, relay, friend) can pay the gas.
    ///
    /// PB updates only when `(score, ticks_survived)` strictly exceeds
    /// the existing entry (ties broken by ticks). Lower scores are
    /// rejected with no state change — saves gas vs. always writing.
    pub fn submit_score(env: Env, game_id: u32, seal: Bytes, journal: Bytes) -> Result<(), Error> {
        if seal.len() != SEAL_SIZE {
            return Err(Error::InvalidSeal);
        }
        if journal.len() != JOURNAL_SIZE {
            return Err(Error::InvalidJournal);
        }

        let meta: GameMeta = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .ok_or(Error::GameNotFound)?;
        if meta.paused {
            return Err(Error::GamePaused);
        }

        let journal_digest = env.crypto().sha256(&journal);
        let journal_digest_bytes = BytesN::from_array(&env, &journal_digest.to_array());

        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)?;
        let verifier = VerifierClient::new(&env, &verifier_addr);
        verifier.verify(&seal, &meta.image_id, &journal_digest_bytes);

        // Decode journal — layout matches services/prover/core/src/types.rs.
        let score = read_u32_le(&journal, 0);
        let ticks = read_u32_le(&journal, 4);
        let seed = read_u32_le(&journal, 8);
        let player_pubkey = read_player_pubkey(&env, &journal);

        let hs_key = DataKey::HighScore(game_id, player_pubkey.clone());
        let existing: Option<HighScoreEntry> = env.storage().persistent().get(&hs_key);
        let is_pb = match &existing {
            None => true,
            Some(old) => {
                score > old.score || (score == old.score && ticks > old.ticks_survived)
            }
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

        env.events()
            .publish((symbol_short!("settled"), game_id, player_pubkey), (score, ticks));
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

    pub fn get_game(env: Env, game_id: u32) -> Option<GameMeta> {
        env.storage().persistent().get(&DataKey::Game(game_id))
    }
}

mod test;

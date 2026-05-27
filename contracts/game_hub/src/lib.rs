//! game_hub — multi-game Soroban host (minimum-viable).
//!
//! Single contract that hosts any number of RISC Zero–verified games.
//! Admin registers each game by pinning its 32-byte ELF `image_id`.
//! Players run games entirely off-chain; only when they want to record
//! a score do they prove and submit.
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
//!   - Instance:   `Admin`, `Verifier`
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Verifier,
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

        // Decode journal — layout matches services/prover/core/src/types.rs.
        let score = read_u32_le(&journal, 0);
        let ticks = read_u32_le(&journal, 4);
        let seed = read_u32_le(&journal, 8);
        let player_pubkey = read_player_pubkey(&env, &journal);

        // ── HighScore update ───────────────────────────────────────────
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

        // ── Enumeration (silent-skip past cap) ────────────────────────
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

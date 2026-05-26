//! game_hub — multi-game Soroban host.
//!
//! Single contract that hosts an arbitrary number of RISC Zero–verified
//! games. Admin registers each game with its own `image_id`; players run
//! `start_run(game_id)` / `settle_run(run_id, seal, journal)`; the contract
//! stores **only the player's personal best per game**. No top-N leaderboard
//! lives on-chain — leaderboard UIs index `settled` events off-chain.
//!
//! Storage layout (see `DataKey`):
//!   - Instance:  `Admin`, `Verifier`, `RunCounter`
//!   - Persistent: `Game(u32)`, `HighScore(u32, Address)`
//!   - Temporary: `Run(u64)`, `ActiveRun(u32, Address)`
//!
//! Slice 1 (this commit) scaffolds the crate: types, errors, function
//! stubs, and the WASM compiles. Logic lands in slices 2–3.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN,
    Env, String,
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants — pinned by the RISC Zero proof format. See
// services/prover/core/src/types.rs (JOURNAL_BYTES) and
// spec/zk_risk_0_stellar.md §4.5 (Groth16 seal = 4-byte selector + 256-byte
// proof = 260 bytes).
// ─────────────────────────────────────────────────────────────────────────────

pub const JOURNAL_SIZE: u32 = 44;
pub const SEAL_SIZE: u32 = 260;

// ─────────────────────────────────────────────────────────────────────────────
// Errors — Soroban contracterror enums must fit in u32 and start at 1.
// Keep numeric values stable across releases (clients hard-code them).
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
    RunNotFound = 7,
    RunAlreadySettled = 8,
    RunAlreadyActive = 9,
    InvalidSeal = 10,
    InvalidJournal = 11,
    SeedMismatch = 12,
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys — kept short to minimise XDR overhead. ActiveRun + HighScore
// are composite keys; the contract scopes them by (game_id, player).
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Verifier,
    RunCounter,
    /// Per-game metadata. Persistent.
    Game(u32),
    /// Active in-flight run, scoped per (game, player). Temporary, 24 h TTL.
    /// Cleared by `cancel_run` and `settle_run`.
    ActiveRun(u32, Address),
    /// Pending run data, keyed by global run_id. Temporary, 24 h TTL.
    Run(u64),
    /// Player's personal-best score for a game. Persistent. Only set/updated
    /// when `settle_run` verifies a proof with a strictly higher score (or
    /// equal score + higher ticks_survived as tie-breaker).
    HighScore(u32, Address),
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
    /// Human-readable slug, e.g. "flight_scroll". Surface in UIs.
    pub name: String,
    /// Admin kill switch — when true, `start_run` and `settle_run` reject.
    pub paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunData {
    pub game_id: u32,
    pub player: Address,
    /// 32-bit seed minted at `start_run`. Mirror of TS sim's `seed` field.
    /// `settle_run` rejects proofs whose journal seed disagrees.
    pub seed: u32,
    pub settled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HighScoreEntry {
    pub score: u32,
    pub ticks_survived: u32,
    /// run_id of the proof that set this entry — lets clients link back to
    /// the on-chain settled event for replay context.
    pub run_id: u64,
    /// Ledger timestamp at settlement.
    pub settled_at: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Loads the admin from instance storage. Returns `NotInitialized` if
/// `initialize` hasn't been called yet. Caller must follow with
/// `admin.require_auth()` if the function requires admin signing.
fn require_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract — admin functions are live in slice 2; player flow lands in slice 3.
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct GameHub;

#[contractimpl]
impl GameHub {
    // ── Admin ────────────────────────────────────────────────────────────

    /// One-shot setup. The future admin must sign the tx (`require_auth`)
    /// so an arbitrary third party can't front-run init and seize the contract.
    pub fn initialize(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage().instance().set(&DataKey::RunCounter, &0u64);
        env.events()
            .publish((symbol_short!("init"),), (admin, verifier));
        Ok(())
    }

    /// Register a new game. Admin-provided id (so clients can hardcode
    /// well-known IDs); rejects on collision. Initial `paused = false`.
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

    /// Rotate the pinned image_id for a game — used when the sim is updated
    /// and a new guest ELF is shipped. Old in-flight proofs (with the old
    /// image_id) will start failing `settle_run` until they get re-proven.
    /// Coordinate rotations with low player activity.
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

    /// Per-game kill switch. When paused, `start_run` and `settle_run`
    /// reject. Existing in-flight runs are unaffected until the player
    /// tries to settle them.
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

    /// Hand the admin role to a new address. Current admin must auth.
    pub fn rotate_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = require_admin(&env)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("rotadmin"),), (admin, new_admin));
        Ok(())
    }

    // ── Player flow ──────────────────────────────────────────────────────

    pub fn start_run(_env: Env, _game_id: u32, _player: Address) -> Result<u64, Error> {
        Err(Error::NotInitialized) // stub — slice 3
    }

    pub fn cancel_run(_env: Env, _run_id: u64) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 3
    }

    pub fn settle_run(
        _env: Env,
        _run_id: u64,
        _seal: Bytes,
        _journal: Bytes,
    ) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 3
    }

    // ── Reads ────────────────────────────────────────────────────────────

    pub fn get_score(_env: Env, _game_id: u32, _player: Address) -> Option<HighScoreEntry> {
        None // stub — slice 3
    }

    pub fn get_game(env: Env, game_id: u32) -> Option<GameMeta> {
        env.storage().persistent().get(&DataKey::Game(game_id))
    }

    pub fn get_run(_env: Env, _run_id: u64) -> Option<RunData> {
        None // stub — slice 3
    }
}

mod test;

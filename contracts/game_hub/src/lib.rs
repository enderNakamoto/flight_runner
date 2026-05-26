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
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, String,
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
// Contract — slice 1 stubs. Slices 2–3 fill in the bodies.
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct GameHub;

#[contractimpl]
impl GameHub {
    // ── Admin ────────────────────────────────────────────────────────────

    pub fn initialize(_env: Env, _admin: Address, _verifier: Address) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 2
    }

    pub fn add_game(
        _env: Env,
        _game_id: u32,
        _image_id: BytesN<32>,
        _name: String,
    ) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 2
    }

    pub fn set_image_id(
        _env: Env,
        _game_id: u32,
        _new_image_id: BytesN<32>,
    ) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 2
    }

    pub fn set_paused(_env: Env, _game_id: u32, _paused: bool) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 2
    }

    pub fn rotate_admin(_env: Env, _new_admin: Address) -> Result<(), Error> {
        Err(Error::NotInitialized) // stub — slice 2
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

    pub fn get_game(_env: Env, _game_id: u32) -> Option<GameMeta> {
        None // stub — slice 3
    }

    pub fn get_run(_env: Env, _run_id: u64) -> Option<RunData> {
        None // stub — slice 3
    }
}

mod test;

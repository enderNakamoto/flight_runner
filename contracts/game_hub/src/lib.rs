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
    /// Verify a RISC Zero seal. Panics revert the calling tx on failure;
    /// returns `()` on success. The verifier internally checks the BN254
    /// pairing equation against `image_id` and `journal_digest`.
    fn verify(env: Env, seal: Bytes, image_id: BytesN<32>, journal_digest: BytesN<32>);
}

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

    /// Begin a run for `player` against `game_id`. Returns a fresh `run_id`
    /// and pins the run's seed in temporary storage.
    ///
    /// Seed derivation: `ledger.sequence ⊕ ledger.timestamp ⊕ run_id`,
    /// XOR-folded to u32. Deterministic (so the proof can replay it),
    /// unpredictable before the ledger closes (so the player can't
    /// pre-game it), and uniquely tied to this run_id (so two concurrent
    /// runs get different seeds even within the same ledger).
    ///
    /// Auth: the player signs. Initialization is implicit via `require_admin`
    /// (which only checks that Admin exists — admin doesn't co-sign).
    pub fn start_run(env: Env, game_id: u32, player: Address) -> Result<u64, Error> {
        // Forces NotInitialized error if the contract hasn't been initialized.
        let _ = require_admin(&env)?;
        player.require_auth();

        let meta: GameMeta = env
            .storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .ok_or(Error::GameNotFound)?;
        if meta.paused {
            return Err(Error::GamePaused);
        }

        // One active run per (game, player). Players can have concurrent
        // runs across different games but not multiple within the same game.
        let active_key = DataKey::ActiveRun(game_id, player.clone());
        if env.storage().temporary().has(&active_key) {
            return Err(Error::RunAlreadyActive);
        }

        // Mint run_id from a monotonic counter shared across all games.
        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RunCounter)
            .unwrap_or(0);
        counter = counter.checked_add(1).expect("run counter overflow");
        env.storage().instance().set(&DataKey::RunCounter, &counter);
        let run_id = counter;

        let entropy =
            (env.ledger().sequence() as u64) ^ (env.ledger().timestamp() ^ run_id);
        let seed: u32 = ((entropy ^ (entropy >> 32)) & 0xFFFF_FFFF) as u32;

        let run = RunData {
            game_id,
            player: player.clone(),
            seed,
            settled: false,
        };
        env.storage().temporary().set(&DataKey::Run(run_id), &run);
        env.storage().temporary().set(&active_key, &run_id);
        env.storage().temporary().extend_ttl(
            &DataKey::Run(run_id),
            TEMP_TTL_THRESHOLD,
            TEMP_TTL_EXTEND,
        );
        env.storage()
            .temporary()
            .extend_ttl(&active_key, TEMP_TTL_THRESHOLD, TEMP_TTL_EXTEND);

        env.events()
            .publish((symbol_short!("started"), run_id, game_id), (player, seed));
        Ok(run_id)
    }

    /// Player-initiated cancel. Frees the active-run slot so the player can
    /// `start_run` again immediately. Already-settled runs reject.
    pub fn cancel_run(env: Env, run_id: u64) -> Result<(), Error> {
        let run: RunData = env
            .storage()
            .temporary()
            .get(&DataKey::Run(run_id))
            .ok_or(Error::RunNotFound)?;
        if run.settled {
            return Err(Error::RunAlreadySettled);
        }
        run.player.require_auth();

        env.storage()
            .temporary()
            .remove(&DataKey::ActiveRun(run.game_id, run.player.clone()));
        env.storage().temporary().remove(&DataKey::Run(run_id));

        env.events()
            .publish((symbol_short!("canceled"), run_id), run.player);
        Ok(())
    }

    /// Verify a RISC Zero proof for `run_id` and conditionally update the
    /// player's personal best. Permissionless — anyone can submit on behalf
    /// of the original player (the proof binds the run via seed equality
    /// and `RunData.player` was pinned at `start_run`).
    ///
    /// The high-score table updates only when `(score, ticks_survived)` is
    /// strictly greater than the existing entry (ties broken by ticks).
    /// Lower scores still consume the run (mark settled) but don't write to
    /// the leaderboard table — the player paid gas to verify a real proof,
    /// we honour that with a `settled` event regardless.
    pub fn settle_run(
        env: Env,
        run_id: u64,
        seal: Bytes,
        journal: Bytes,
    ) -> Result<(), Error> {
        let mut run: RunData = env
            .storage()
            .temporary()
            .get(&DataKey::Run(run_id))
            .ok_or(Error::RunNotFound)?;
        if run.settled {
            return Err(Error::RunAlreadySettled);
        }

        if seal.len() != SEAL_SIZE {
            return Err(Error::InvalidSeal);
        }
        if journal.len() != JOURNAL_SIZE {
            return Err(Error::InvalidJournal);
        }

        let meta: GameMeta = env
            .storage()
            .persistent()
            .get(&DataKey::Game(run.game_id))
            .ok_or(Error::GameNotFound)?;
        if meta.paused {
            return Err(Error::GamePaused);
        }

        // SHA-256 the journal once — the verifier checks against this
        // digest, not the journal bytes themselves.
        let journal_digest = env.crypto().sha256(&journal);
        let journal_digest_bytes = BytesN::from_array(&env, &journal_digest.to_array());

        // Delegate to the registered verifier contract.
        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::NotInitialized)?;
        let verifier = VerifierClient::new(&env, &verifier_addr);
        verifier.verify(&seal, &meta.image_id, &journal_digest_bytes);

        // Journal decoders mirror services/prover/core/src/types.rs:
        //   bytes  0..4  = score          (u32 LE)
        //   bytes  4..8  = ticks_survived (u32 LE)
        //   bytes  8..12 = seed           (u32 LE)
        //   bytes 12..44 = transcript_hash (raw 32)
        let score = read_u32_le(&journal, 0);
        let ticks = read_u32_le(&journal, 4);
        let proof_seed = read_u32_le(&journal, 8);

        // Anti-replay: the proof must bind to this exact run.
        if proof_seed != run.seed {
            return Err(Error::SeedMismatch);
        }

        // Conditional personal-best update.
        let hs_key = DataKey::HighScore(run.game_id, run.player.clone());
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
                run_id,
                settled_at: env.ledger().timestamp(),
            };
            env.storage().persistent().set(&hs_key, &entry);
            env.events().publish(
                (symbol_short!("pb"), run.game_id, run.player.clone()),
                (score, ticks, run_id),
            );
        }

        // Mark settled + clear active-run guard.
        run.settled = true;
        env.storage().temporary().set(&DataKey::Run(run_id), &run);
        env.storage()
            .temporary()
            .remove(&DataKey::ActiveRun(run.game_id, run.player.clone()));

        env.events().publish(
            (symbol_short!("settled"), run_id, run.game_id),
            (run.player, score, ticks),
        );
        Ok(())
    }

    // ── Reads ────────────────────────────────────────────────────────────

    pub fn get_score(env: Env, game_id: u32, player: Address) -> Option<HighScoreEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::HighScore(game_id, player))
    }

    pub fn get_game(env: Env, game_id: u32) -> Option<GameMeta> {
        env.storage().persistent().get(&DataKey::Game(game_id))
    }

    pub fn get_run(env: Env, run_id: u64) -> Option<RunData> {
        env.storage().temporary().get(&DataKey::Run(run_id))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage TTLs + decoders
// ─────────────────────────────────────────────────────────────────────────────

/// Temporary-storage TTL for in-flight runs. ~24 h at 5 s/ledger = 17 280.
/// Threshold = extend-when-remaining < this; Extend = bump to this many
/// ledgers. Same value for both: any read/write refreshes the full window.
const TEMP_TTL_THRESHOLD: u32 = 17_280;
const TEMP_TTL_EXTEND: u32 = 17_280;

/// Read a little-endian u32 from a Soroban Bytes at byte offset.
/// Caller must have verified the slice length covers `offset..offset+4`.
fn read_u32_le(bytes: &Bytes, offset: u32) -> u32 {
    let b0 = bytes.get(offset).expect("bounds checked by caller") as u32;
    let b1 = bytes.get(offset + 1).expect("bounds checked by caller") as u32;
    let b2 = bytes.get(offset + 2).expect("bounds checked by caller") as u32;
    let b3 = bytes.get(offset + 3).expect("bounds checked by caller") as u32;
    b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
}

mod test;

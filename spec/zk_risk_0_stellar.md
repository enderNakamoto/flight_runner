# ZK Settlement Spec — RISC Zero × Stellar Soroban (flight_scroll)

A development-oriented reference for the proving stack used in this repo. Captures what the ZK system is for, the exact data formats crossing each boundary, how the proof is produced and verified on-chain, where the load-bearing code lives, and how it is tested.

This document targets **flight_scroll** — a single-player Flappy Bird-style sidescroller where the player flies a passenger jet through pillars, enemy aircraft, and missiles, collecting fuel tokens for score. The ZK layer makes the **final score** independently verifiable so a public leaderboard contract does not have to trust the game server (or the player's own client).

Source assets live in `public/assets/` and are indexed by `public/assets/assets.json`:

| Category | Asset | Role in sim |
|---|---|---|
| Player | `plane.png` | Hero sprite, scrolls in place |
| Obstacles | `obstacles/top_pillar.png`, `obstacles/bottom_pillar.png` | Flappy-style pipe pair, score +1 on pass |
| Obstacles | `obstacles/bird_big.png`, `obstacles/bird_small.png` | Enemy birds (straight or sine) |
| Obstacles | `obstacles/drone.png`, `obstacles/jet.png`, `obstacles/ufo.png` | Enemy aircraft (hover/strafe, fast flyby, zigzag) |
| Obstacles | `obstacles/missiles.png` (12-frame sheet) | Projectiles fired from drones/jets |
| Boosts | `boosts/fuel_token.png` | Pickup, refills fuel + score +5 |
| Backgrounds | `backgrounds/*.png` | Parallax tilesprites, cosmetic only |

---

## 1. What ZK is used for

The game is client-authoritative at runtime (it's single-player — no server-side simulation is needed to play). The ZK layer exists to make every leaderboard submission independently verifiable, so the on-chain leaderboard does not trust either:

- the **player's client** (they could just `POST { score: 999999 }`), or
- the **score-relay server** (it could lie on behalf of the player).

After a run ends, the client (or a server on its behalf) hands the **seed + the input transcript + the claimed final state** to a RISC Zero prover. The prover replays the run inside the zkVM and emits a Groth16 proof. A Soroban contract verifies the proof and writes the score to the leaderboard.

What the proof guarantees:

- The replay used the **same seed** committed in `start_run` (so the obstacles/fuel pickups the player faced match the world the contract had pinned for this run).
- The transcript bytes used by the prover hash to the value committed in the journal.
- Running the canonical deterministic sim on those inputs **without crashing** yields exactly the claimed `score` and `ticks_survived` at the moment the player died or quit.
- The prover binary that produced the proof matches the on-chain `image_id` (so no one swapped in a "lenient" sim).

What it does **not** guarantee (callouts a porter needs to know):

- That the transcript reflects what the player actually pressed. The client records its own inputs; if the client lies about the transcript, the proof still verifies — but the player can only lie about inputs that produce a *worse-or-equal* score, since the seed is fixed by the contract and only valid input sequences score points. So in score-chasing this attack is uninteresting.
- That the player physically achieved a high score. A player could brute-force-search inputs offline for any given seed. Mitigation: rate-limit `start_run` per account, or cap leaderboard entries per run (one submission per `run_id`).

---

## 2. End-to-end flow

```
   ┌──────────────────────┐
   │ Client (Phaser/TS)   │  ─ User connects wallet (Freighter / Albedo / …)
   │  + Stellar Wallets   │  ─ User signs start_run(self) tx in their wallet
   │    Kit               │  ─ Submits tx directly to Soroban RPC
   └──────────┬───────────┘
              │  start_run tx
              ▼
        ┌────────────┐
        │ Soroban    │  start_run(player) — player.require_auth()
        │  flight_   │  ─ Contract picks seed from ledger entropy
        │  scroll    │  ─ Stores RunData{player, seed, settled:false}
        └─────┬──────┘
              │  seed (emitted in "started" event)
              ▼
   ┌──────────────────────┐
   │ Client (Phaser/TS)   │  ─ Runs canonical sim @ 60Hz with that seed
   │  + WASM(core)        │  ─ Records flap-per-tick transcript
   └──────────┬───────────┘
              │  game over → POST transcript + seed
              ▼
       ┌───────────────┐
       │ Score Relay   │  Stateless proof orchestrator.
       │  (Bun server) │  Holds NO Stellar admin key.
       └──────┬────────┘
              │
              ▼
       ┌─────────────┐
       │ proveScore  │   Races worker + Boundless
       └──────┬──────┘
              │
    ┌─────────┴────────────┐
    ▼                      ▼
┌────────────────┐   ┌─────────────────────┐
│ Local/remote   │   │ Boundless market    │
│ flight-host    │   │ (Base Sepolia)      │
└──────┬─────────┘   └──────┬──────────────┘
       │   seal + journal   │
       └──────────┬─────────┘
                  ▼
   ┌──────────────────────────────┐
   │ settle_run (Soroban)         │  permissionless — anyone can call
   │  - SHA-256(journal)          │  (proof self-binds via seed equality)
   │  - verifier.verify(seal,     │  Submitter (relay or player)
   │     image_id, digest)        │  pays the gas; score lands in
   │  - check seed == stored seed │  RunData.player's leaderboard slot.
   │  - leaderboard.submit(...)   │
   └──────────────────────────────┘
```

**Two trust-minimization properties of this flow:**

1. **No admin key holds the player's runs.** The player signs `start_run` in their own wallet. The relay never has a Stellar secret that could mint runs for arbitrary addresses.
2. **`settle_run` is permissionless.** The proof's journal binds the run via `seed` equality, and the player address was already pinned in `RunData` at `start_run`. So *anyone* — the relay, a friend, a public submitter bot — can submit the settle tx, and the score still lands in the original player's leaderboard slot. This is what makes async completion safe: the player can close their tab and the relay finishes the loop without holding any auth that could be abused.

The relay is optional. A client willing to keep the tab open through proof generation (or run their own Boundless account) can settle entirely peer-to-peer.

---

## 3. Determinism contract — the single source of truth

The proof is only meaningful because **three implementations of the same sim** stay bit-identical:

| Language | Path | Used by |
|---|---|---|
| TypeScript (Q24.8 in i32) | `packages/sim/src/` | Phaser client — runs the visible game |
| Rust fixed-point i32 | `services/prover/core/src/fp.rs` | zkVM guest, host orchestration |
| Rust → WASM | `services/prover/wasm/` (wraps `core`) | Loaded by client for headless parity checks |

Determinism guarantees in `core/fp.rs`:

- **Fixed-point Q24.8** (`i32` with 8 fractional bits — `ONE = 256`). All physics arithmetic uses `add/sub/mul/div` helpers, never `f64`. Phaser's own `f64` positions are derived from the canonical i32 state for rendering, never the other way around.
- **Custom PRNG** (`prng.rs`) — splittable, deterministic, state lives on `GameState`. Used by:
  - Pillar gap height and spawn cadence
  - Enemy aircraft type roll (weighted table) and trajectory params (sine amplitude, zigzag phase)
  - Missile spawn timing and tier roll from drones/jets
  - Fuel token spawn position
  - Cosmetic background-variant pick (within a mood bucket)
- **Stage table** (`stages.rs`) — `STAGE_TABLE: [StageParams; 5]` const drives per-tick spawn weights, gap sizes, scroll speed, fuel cadence, and which enemy/missile tiers can appear. Stage advancement is a pure function of `state.score` (see architecture.md §4). Because the table is a constant baked into the guest, any tuning change produces a new `image_id` and the contract admin must rotate the pinned image_id before new proofs verify.
- **Tick ordering** — `step()` runs subsystems in a fixed order:
  1. Read input (flap bit for this tick)
  2. Apply gravity + flap impulse to plane
  3. Drain fuel (rate from `STAGE_TABLE[state.stage].fuelDrainPerTick`)
  4. Spawn obstacles / pickups (PRNG-driven, parameters from current stage row)
  5. Advance obstacles (scroll left at `STAGE_TABLE[state.stage].scrollSpeed`, sine wobble, etc.)
  6. Advance missiles
  7. Collision pass (plane × obstacles, plane × missiles, plane × pickups, plane × world bounds)
  8. Apply scoring deltas (pillar passed, pickup collected, +1 per second of survival)
  9. Stage check — if `score` crossed next gate, bump `state.stage` and set transient `stage_just_changed` flag
  10. Check game-over (collision OR fuel == 0 OR voluntary quit)
- **Zero-copy mutation** in the hot path: `step_mut(&mut State)` in the guest, avoiding per-tick clones.
- **Raw byte I/O** to the zkVM — bypasses serde inside the guest (encoding lives in `encode_raw_run` at `core/src/fp.rs`).
- **SHA-256 precompile** in RISC Zero zkVM cuts hashing from millions of cycles to thousands. Used once per run to hash the input transcript.

Target proving cost: ≤ 5 minutes of run = 18,000 ticks → < 1 M zkVM cycles after sim optimization, similar order of magnitude to chickenz's 234K cycles/round.

**If you port to a new sidescroller:** rewrite `packages/sim/` and `services/prover/core/` in lockstep, keep the same fixed-point convention, and write a parity test that runs random inputs through both implementations comparing every-tick state hashes.

---

## 4. Data formats crossing each boundary

### 4.1 Per-tick player input

Same shape in both TS and Rust:

```rust
// services/prover/core/src/types.rs
pub struct PlayerInput {
    pub buttons: u8,   // bit 0 = FLAP, bits 1..7 reserved (must be 0)
}
```

Only one bit is used. We keep it a `u8` so we have room to add later (e.g., bit 1 = `BOOST`, bit 2 = `BRAKE`) without changing the transcript wire format. The guest **asserts reserved bits are zero** — otherwise old proofs could be replayed against a new sim that gives those bits meaning.

The client records one `PlayerInput` per simulated tick at 60 Hz. A 5-minute run is 18,000 ticks.

### 4.2 Transcript JSON (client → prover)

```rust
// services/prover/core/src/types.rs
pub struct RunProverInput {
    pub config: MatchConfig,       // protocol_version, tick_rate, max_ticks
    pub seed: u32,                 // must match the seed_commit registered on-chain
    pub inputs: Vec<PlayerInput>,  // length ≤ MAX_TICKS (default 36000 = 10 min)
}
```

The relay accepts this as JSON; the host accepts it as JSON or postcard bytes.

### 4.3 Raw bytes (host → zkVM guest)

The encoding bypasses serde for cycle efficiency:

```
[seed:        u32 LE]
[tick_count:  u32 LE]
For each tick:
  [buttons: u8]            // 1 byte/tick
```

Implementation: `encode_raw_run` (`services/prover/core/src/fp.rs`). The host wraps with a 4-byte length prefix when writing into `ExecutorEnv` (see `bytes_to_words` in `services/prover/host/src/main.rs`).

Buffer sizing for a default 10-minute cap:

```
header  = 4 (seed) + 4 (tick_count)            = 8 bytes
payload = 36000 ticks × 1 byte                 = 36000 bytes
total   = 36008 bytes ≈ 9002 u32 words
```

Set `MAX_INPUT_WORDS = 10000` (`services/prover/guest/src/main.rs`) for headroom.

### 4.4 Journal (zkVM → on-chain) — **44 bytes, frozen layout**

```
Offset  Size  Field             Encoding
  0      4    score             u32 LE   (capped at 2^31-1 by guest)
  4      4    ticks_survived    u32 LE   (>= 0, ≤ MAX_TICKS)
  8      4    seed              u32 LE   (must equal contract-stored seed)
 12     32    transcript_hash   SHA-256(raw_input_bytes minus length prefix)
─────────────
 44 bytes = 11 u32 words = PROVER_OUTPUT_WORDS
```

Defined in `services/prover/core/src/types.rs` (`ProverOutput::to_journal_words` / `from_journal_bytes`). Decoders mirror this on-chain in `contracts/flight_scroll/src/lib.rs` (`decode_score`, `extract_seed`).

Why include `seed` directly instead of a 32-byte commit? In flight_scroll the seed is contract-issued and known on-chain — no commit-reveal — so a 4-byte equality check is enough. This shaves 28 bytes off the journal vs. chickenz.

### 4.5 Seal (proof bytes → on-chain)

- The Groth16 proof from RISC Zero is **256 bytes**.
- The on-chain contract expects **260 bytes**: a 4-byte verifier-selector prefix + the 256-byte proof. The selector is `first_4_bytes(SHA-256_of(Groth16ReceiptVerifierParameters))`. In the deployed contract version (RISC Zero 3.0.x) the selector is `73c457ba`.
- The host computes this in `services/prover/host/src/main.rs`. The relay also handles it in `services/server/src/index.ts` (`autoSettleRun`).
- Worker API validates seal format: `^[0-9a-fA-F]{512}([0-9a-fA-F]{8})?$` (`services/server/src/index.ts` — accepts both 256 and 260 byte hex).

---

## 5. RISC Zero pieces

### 5.1 Workspace layout

```
services/prover/
  core/          # flight-core — pure Rust sim, no_std-friendly (used by guest)
  guest/         # flight-guest — #![no_main] zkVM program
  methods/       # flight-methods — build.rs generates FLIGHT_GUEST_ELF + FLIGHT_GUEST_ID
  host/          # flight-host — proof orchestration binary
  wasm/          # WASM build of core for browser parity checks
```

Methods crate: `services/prover/methods/Cargo.toml` declares `package.metadata.risc0.methods = ["../guest"]` and `build.rs` calls `risc0_build::embed_methods()`. This produces `FLIGHT_GUEST_ELF` (program bytes) and `FLIGHT_GUEST_ID` (`[u32; 8]` — the 32-byte image ID).

### 5.2 The guest

```rust
// services/prover/guest/src/main.rs
#![no_main]
risc0_zkvm::guest::entry!(main);

const MAX_INPUT_WORDS: usize = 10000;

fn main() {
    let mut input_len = [0u32; 1];
    risc0_zkvm::guest::env::read_slice(&mut input_len);
    let byte_len = input_len[0] as usize;
    let word_len = byte_len.div_ceil(4);
    assert!(word_len <= MAX_INPUT_WORDS);

    let mut raw_words = [0u32; MAX_INPUT_WORDS];
    risc0_zkvm::guest::env::read_slice(&mut raw_words[..word_len]);
    let raw_bytes = &bytemuck::cast_slice::<u32, u8>(&raw_words[..word_len])[..byte_len];

    let result = fp::run_streaming(raw_bytes);

    let output = ProverOutput {
        score: result.state.score,
        ticks_survived: result.state.tick,
        seed: result.seed,
        transcript_hash: result.transcript_hash,
    };
    risc0_zkvm::guest::env::commit_slice(&output.to_journal_words());
}
```

`run_streaming` (`services/prover/core/src/fp.rs`):

- Reads `seed` and `tick_count` from the header.
- Creates initial state with `create_initial_state(seed)`.
- For each tick, asserts reserved input bits are zero, then runs `step_mut(&mut state, input)`.
- Stops early if `state.game_over` is set (collision / fuel out), capturing the tick of death.
- Asserts the transcript was consistent with what the sim consumed (length match, no trailing bytes).
- Computes `transcript_hash = SHA-256(payload)` using the zkVM precompile.
- Returns `(state, seed, transcript_hash)`.

### 5.3 The host

`services/prover/host/src/main.rs` supports three modes:

| Mode | CLI | What it produces |
|---|---|---|
| Local STARK (dev) | `--local` | STARK receipt, no Groth16 seal, **not on-chain submittable** |
| Local Groth16 | (default) | 260-byte seal, requires RISC Zero Groth16 toolchain |
| Boundless | `--boundless` | Same artifacts, proof generated by the Boundless marketplace on Base Sepolia |

`RISC0_DEV_MODE=1` env var skips real proving for tests.

Key host snippet:

```rust
// services/prover/host/src/main.rs
let env = risc0_zkvm::ExecutorEnv::builder()
    .write_slice(&[byte_len])
    .write_slice(&words)
    .build()?;

let prover = risc0_zkvm::default_prover();
let opts = if use_groth16 {
    risc0_zkvm::ProverOpts::groth16()
} else {
    risc0_zkvm::ProverOpts::default()
};

let prove_info = prover.prove_with_opts(env, FLIGHT_GUEST_ELF, &opts)?;
let receipt = prove_info.receipt;
receipt.verify(FLIGHT_GUEST_ID)?;  // local sanity check
```

Boundless mode (gated behind `--features boundless`) uploads the ELF + stdin via Pinata, submits a request to the marketplace, polls until fulfillment, then re-shapes the result into the same `proof_artifacts.json` shape.

Output file `proof_artifacts.json`:

```json
{
  "seal":      "73c457ba...",      // hex, 260 bytes
  "image_id":  "...",              // hex, 32 bytes — must match contract storage
  "journal":   "...",              // hex, 44 bytes
  "output":    {
    "score": 1234,
    "ticks_survived": 8721,
    "seed": 3141592653,
    "transcript_hash": "..."
  }
}
```

### 5.4 How the relay triggers proving

Wired at run end in `services/server/src/index.ts`:

```ts
if (recordedRun.proofStatus === "pending") {
  recordedRun.proofStatus = "proving";
  proveScore(
    runId,
    transcript,
    onProofResult,                                // → updateProofStatus + autoSettle
    (requestId) => updateBoundlessRequestId(runId, requestId),
    (txHash)    => updateBoundlessTxHash(runId, txHash),
  );
}
```

`proveScore` (`services/server/src/prover.ts`) races two paths and fires the callback exactly once:

1. **Worker queue** — `queueProof` puts the job in an in-memory queue. A remote worker (`scripts/worker.sh`) polls `/api/worker/poll` with bearer token `WORKER_API_KEY`, downloads the transcript, runs `flight-host`, posts back via `/api/worker/result/<id>`.
2. **Boundless fallback** — spawns `flight-host --boundless` locally; requires `BOUNDLESS_RPC_URL`, `BOUNDLESS_PRIVATE_KEY`, `PINATA_JWT`.

A 20-minute safety timeout marks failure if neither path settles.

When a result arrives, the relay compares journals if both paths returned, logs a `Journal MISMATCH` error if they diverge — a structural cross-check.

---

## 6. On-chain verification

### 6.1 Contracts (Stellar Testnet)

| Contract | Purpose | Shared across games? |
|---|---|---|
| `flight_scroll` (this repo) | Issues seeds, accepts proofs, writes to leaderboard. Address pinned in env `FLIGHT_SCROLL_CONTRACT`. | No — game-specific. Each future game ships its own contract derived from this template, with its own `image_id`, scoring rules, and leaderboard. |
| `groth16_verifier` | Nethermind `stellar-risc0-verifier`. Uses Soroban Protocol 25 native BN254 pairing. Address pinned in env `VERIFIER_CONTRACT`. | Yes — one verifier serves every RISC Zero-backed game on the network. |
| `game_hub` (future) | Registry of game contracts + cross-game aggregation. When a per-game contract finishes `settle_run`, it pings the hub so leaderboards across multiple games can be queried in one call. | Yes — one per chain. |

Per-game leaderboard lives **inside** the per-game contract (v1). A shared hub aggregates them later (v2 — see §9 roadmap). This keeps each game's contract self-contained and independently upgradeable; the hub is purely additive.

### 6.2 `start_run` — seed issuance

```rust
pub fn start_run(env: Env, player: Address) -> u64 /* run_id */ {
    player.require_auth();

    // Rate-limit: max 1 active run per player (cheap anti-spam)
    if env.storage().temporary().has(&DataKey::ActiveRun(player.clone())) {
        return Err(Error::RunAlreadyActive);
    }

    // Mint run_id from a monotonic counter
    let mut counter: u64 = env.storage().instance()
        .get(&DataKey::RunCounter).unwrap_or(0);
    counter += 1;
    env.storage().instance().set(&DataKey::RunCounter, &counter);
    let run_id = counter;

    // Derive seed from ledger entropy + run_id (deterministic, unpredictable
    // before the ledger closes, not gameable by the player)
    let entropy = env.ledger().sequence() as u64
        ^ (env.ledger().timestamp() ^ run_id);
    let seed: u32 = (entropy ^ (entropy >> 32)) as u32;

    let run = RunData { player: player.clone(), seed, settled: false };
    env.storage().temporary().set(&DataKey::Run(run_id), &run);
    env.storage().temporary().extend_ttl(&DataKey::Run(run_id), 60 * 60 * 24, 60 * 60 * 24);
    env.storage().temporary().set(&DataKey::ActiveRun(player), &run_id);

    env.events().publish((symbol_short!("started"), run_id), seed);
    run_id
}
```

**Who calls this in v1:** the player's client. The user clicks "Start Run" in the browser, Stellar Wallets Kit pops up the wallet (Freighter / Albedo / xBull / etc.), the user signs, the client submits the tx to Soroban RPC directly. The client then reads the `started` event from the tx result to learn the seed. The relay is not in the loop at all for `start_run`.

### 6.3 `settle_run` — the verification path

**No `require_auth()` on this function.** Any account can submit a proof for any `run_id` — the proof itself binds the run via seed equality, and the `RunData.player` was pinned at `start_run` time. The submitter pays the gas; the score lands in the original player's leaderboard slot. This is what lets the relay finish the loop async without holding any key that could mint runs or fake results.

Full source at `contracts/flight_scroll/src/lib.rs`. Sequence:

```rust
pub fn settle_run(env: Env, run_id: u64, seal: Bytes, journal: Bytes) -> Result<(), Error> {
    // 1. Load run data registered by start_run
    let mut run: RunData = env.storage().temporary()
        .get(&DataKey::Run(run_id)).ok_or(Error::RunNotFound)?;
    if run.settled { return Err(Error::RunAlreadySettled); }

    // 2. Sanity-check seal + journal sizes
    if seal.len() != 260 { return Err(Error::InvalidSeal); }
    if journal.len() != JOURNAL_SIZE as u32 { return Err(Error::InvalidJournal); }

    // 3. Hash journal — the verifier checks against this digest, not the journal itself
    let journal_digest: Hash<32> = env.crypto().sha256(&journal);

    // 4. Read pinned image_id and verifier address from instance storage
    let image_id: BytesN<32> = env.storage().instance().get(&DataKey::ImageId)?;
    let verifier_addr: Address = env.storage().instance().get(&DataKey::Verifier)?;

    // 5. Verify ZK proof — panics revert the whole tx
    let verifier = VerifierClient::new(&env, &verifier_addr);
    verifier.verify(&seal, &image_id, &BytesN::from_array(&env, &journal_digest.to_array()));

    // 6. Now-trusted journal: pull score + seed
    let score = decode_score(&journal);
    let ticks_survived = decode_ticks(&journal);
    let proof_seed = extract_seed(&journal);

    // 7. Bind proof to this specific run — seed must match what start_run committed
    if proof_seed != run.seed { return Err(Error::SeedMismatch); }

    // 8. Write to leaderboard (composite key tie-breaks by ticks_survived)
    leaderboard_submit(&env, &run.player, score, ticks_survived);

    // 9. Mark settled, clear active-run guard
    run.settled = true;
    env.storage().temporary().set(&DataKey::Run(run_id), &run);
    env.storage().temporary().remove(&DataKey::ActiveRun(run.player.clone()));

    env.events().publish(
        (symbol_short!("settled"), run_id, run.player),
        (score, ticks_survived),
    );
    Ok(())
}
```

**The three trust anchors**:

1. **`image_id`** — pinned per-deployment via `initialize` (and rotatable via admin `set_image_id`). The verifier proves "this seal was produced by exactly this guest ELF". If a porter changes the sim, the image ID changes, and old proofs stop verifying — desired behavior.
2. **`seed` equality** — prevents reusing a proof from one run against another `run_id`, and prevents the player from picking a "lucky" seed off-chain.
3. **`verifier.verify`** — delegated to the Nethermind verifier contract, which checks the BN254 pairing equation against the pinned `image_id` and the SHA-256 hash of the 44-byte journal.

Errors enumerated at `contracts/flight_scroll/src/lib.rs`:

```rust
pub enum Error {
    AlreadyInitialized   = 1,
    NotInitialized       = 2,
    Unauthorized         = 3,
    RunNotFound          = 4,
    RunAlreadySettled    = 5,
    RunAlreadyActive     = 6,
    InvalidSeal          = 7,
    InvalidJournal       = 8,
    InvalidScore         = 9,
    SeedMismatch         = 10,
}
```

### 6.4 Leaderboard

For v1, the leaderboard lives inside `flight_scroll` as a persistent ring buffer of `TopEntry { player, score, ticks_survived, run_id }`, capped at `TOP_N = 100`. Insertion is O(N) per submit — acceptable at this scale and Soroban cost envelope.

```rust
fn leaderboard_submit(env: &Env, player: &Address, score: u32, ticks: u32) {
    let mut top: Vec<TopEntry> = env.storage().persistent()
        .get(&DataKey::Top).unwrap_or(Vec::new(env));
    let entry = TopEntry { player: player.clone(), score, ticks_survived: ticks };
    insert_sorted(&mut top, entry, TOP_N);   // sort by (score desc, ticks desc)
    env.storage().persistent().set(&DataKey::Top, &top);
}
```

Reads are a single `get_top()` view that returns the whole `Vec`.

### 6.5 Relay-side settlement

The relay submits `settle_run` as itself (with its own Stellar account paying the fee). It is **not** signing on behalf of the player — `settle_run` has no `require_auth()` for the player, so the relay's submission is a normal third-party tx. The relay's account needs nothing more than XLM for gas.

`services/server/src/stellar.ts` is the entire client for `settle_run`:

```ts
export async function settleRunOnChain(
  runId: bigint, seal: Uint8Array, journal: Uint8Array,
): Promise<string | null> {
  return await submitTx("settle_run", [
    StellarSdk.nativeToScVal(runId, { type: "u64" }),
    StellarSdk.nativeToScVal(Buffer.from(seal), { type: "bytes" }),
    StellarSdk.nativeToScVal(Buffer.from(journal), { type: "bytes" }),
  ]);
}
```

`autoSettleRun` in `services/server/src/index.ts` is the orchestrator — it prepends the Groth16 selector to a 256-byte raw seal if needed, calls `settleRunOnChain`, and on success writes `proof_status = "settled"` + the tx hash to the DB.

A fully client-driven path also exists: if the player keeps the tab open through proof generation, the client can submit `settle_run` from its own wallet (the relay returns the seal+journal blobs via `GET /api/runs/<id>/proof` and the client signs). Functionally identical to the relay path; just shifts gas payment to the player.

---

## 7. Useful code references

| Concern | Location (planned) |
|---|---|
| Journal layout (encode + decode) | `services/prover/core/src/types.rs` |
| Raw transcript encoding for zkVM stdin | `services/prover/core/src/fp.rs` (`encode_raw_run`) |
| Single-run replay + scoring | `services/prover/core/src/fp.rs` (`run_streaming`, `step_mut`) |
| Transcript hashing (SHA-256) | `services/prover/core/src/hash.rs` |
| Guest main | `services/prover/guest/src/main.rs` |
| Host proof generation (Groth16 + seal selector) | `services/prover/host/src/main.rs` |
| Host Boundless mode | `services/prover/host/src/main.rs` (`--features boundless`) |
| Relay proof orchestration (race worker vs Boundless) | `services/server/src/prover.ts` |
| Relay auto-settlement (selector prefix + tx submit) | `services/server/src/index.ts` (`autoSettleRun`) |
| Relay start-run (proxy / direct) | `services/server/src/index.ts` |
| Stellar `submitTx` (sign + simulate + send + poll) | `services/server/src/stellar.ts` |
| Contract `start_run` | `contracts/flight_scroll/src/lib.rs` |
| Contract `settle_run` | `contracts/flight_scroll/src/lib.rs` |
| Contract journal decoders | `contracts/flight_scroll/src/lib.rs` |
| Worker HTTP API (poll/input/result) | `services/server/src/index.ts` |
| Re-prove admin endpoint | `services/server/src/index.ts` |
| `prove.sh` driver script | `scripts/prove.sh` |

---

## 8. Build & run cheatsheet

```bash
# Build the WASM sim (lets the client and any headless parity test share canonical sim)
pnpm build:wasm

# Build host binary (release recommended for actual proving)
cd services/prover && cargo build --release -p flight-host

# Get image ID (for contract initialize / set_image_id)
./services/prover/target/release/flight-host --image-id

# Local STARK proof (dev, no on-chain submit)
RISC0_DEV_MODE=1 ./scripts/prove.sh transcript.json --local

# Local Groth16 proof (needs RISC Zero Groth16 toolchain installed)
./scripts/prove.sh transcript.json

# Remote Groth16 via Boundless
RPC_URL=... PRIVATE_KEY=0x... PINATA_JWT=... \
  ./scripts/prove.sh transcript.json --boundless

# Deploy contract
cd contracts/flight_scroll && stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/flight_scroll.wasm \
  --source default --network testnet
stellar contract invoke --id <ID> --source default --network testnet -- initialize \
  --admin <ADMIN> --verifier <VER> --image_id <IMAGE_ID_HEX>
```

Required env vars summary:

| Var | Layer | Required when |
|---|---|---|
| `STELLAR_ADMIN_SECRET` | Relay | On-chain start/settle enabled |
| `SOROBAN_RPC_URL` | Relay | Defaults to testnet RPC |
| `WORKER_API_KEY` | Relay + worker | Remote worker mode |
| `BOUNDLESS_RPC_URL`, `BOUNDLESS_PRIVATE_KEY`, `PINATA_JWT` | Host (Boundless mode) | Marketplace proving |
| `FLIGHT_SCROLL_CONTRACT`, `VERIFIER_CONTRACT` | Relay | Override default deployed addresses |

---

## 9. Testing — what should exist

### Per-layer coverage

| Layer | File | What it should test |
|---|---|---|
| TS sim (canonical) | `packages/sim/__tests__/` | Behavior of every public sim function: gravity, flap, pillar spawn cadence, enemy spawn weights, fuel drain, collision, scoring, full-game step |
| Rust core | `services/prover/core/src/*.rs` (in-file `mod tests`) | Per-module unit tests: `fp_arithmetic`, `prng_sequences`, `pillar_spawn_table`, `idle_run_ends_when_fuel_zero`, `head_on_collision_kills`, encoding round-trips for `encode_raw_run` |
| Relay server | `services/server/src/*.test.ts` | Proof job queue (queue/claim/submit/dedupe/eviction/timeout), run lifecycle, protocol parsing, DB, settlement-tx parsing |
| Contract | `contracts/flight_scroll/src/test.rs` | `initialize`, double-init, admin rotate, `set_image_id`, `start_run` happy + duplicate-active + uninitialized, `settle_run` happy + already-settled + seed-mismatch + bad seal size + bad journal size + missing run + invalid score, leaderboard insertion (top-N truncation, ties broken by ticks_survived), journal decode |

### What is intentionally **not** covered by automated tests

1. **No end-to-end proof CI.** Generating a real Groth16 proof costs minutes and a Groth16 toolchain, so it is gated behind `prove.sh` and run manually. The contract tests use `MockVerifier` whose `verify` is a no-op — they exercise contract logic but never validate a real seal.
2. **Cross-language differential test** comparing TS sim and Rust sim outputs tick-by-tick on the same seed/inputs **is required for any sim change**. This is the determinism contract that the proof depends on. Recommended: `pnpm test:parity` runs a corpus of recorded runs through both implementations and asserts per-tick state digests match.
3. **No Boundless integration test** — the `boundless` feature path is exercised only manually.
4. **No verifier-contract integration test from this repo.** Trust is delegated to the Nethermind verifier, which has its own test suite upstream.

### Defensive checks that compensate at runtime

- The relay runs both the worker proof and the Boundless proof for every run, then logs `Journal MISMATCH` if their journals disagree. This is effectively a differential test on production data.
- The host always calls `receipt.verify(FLIGHT_GUEST_ID)` locally before writing artifacts, so a corrupt local proof fails fast.
- Contract validates `seal.len() == 260`, `journal.len() == 44`, and `seed` equality before delegating to the verifier — keeps cost down on malformed input.

### Verdict for a development agent

Before changing anything sim-related you should:

1. Add a parity test that runs both the TS sim and `flight-core` against a corpus of recorded transcripts and compares per-tick state digests. This protects the determinism contract that the proof depends on.
2. Add at least one `RISC0_DEV_MODE=1` end-to-end test that runs `flight-host` over a real transcript and asserts the journal matches an expected `ProverOutput`. Cheap, catches encoding regressions.
3. When tweaking obstacle spawn tables or scoring weights, bump a `protocol_version` byte in `MatchConfig` and rebuild the guest — this changes `image_id` and prevents old client builds from submitting proofs against the new contract.

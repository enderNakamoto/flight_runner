# flight_scroll — System Architecture

Companion to [`zk_risk_0_stellar.md`](./zk_risk_0_stellar.md). That doc covers the ZK proving pipeline in detail; this doc covers the **whole system** — game client, simulation, score relay, prover stack, and on-chain layer — and how the pieces fit together.

---

## 1. Product summary

**flight_scroll** is a single-player Flappy Bird-style sidescroller. The player flies a passenger jet (`public/assets/plane.png`) through cloud pillars, enemy birds, drones, jets, UFOs, and missiles, picking up fuel tokens for score. The world scrolls horizontally; the plane scrolls in place. Game ends on collision, fuel-out, or voluntary quit. Score is submitted to an on-chain leaderboard, with a ZK proof attesting that the score was earned by playing the game (not fabricated).

### Goals
- **Cheat-resistant scores** without trusting the player's browser or the score-relay server.
- **Deterministic, reproducible runs**: given the same seed + inputs, the sim yields the same score on every machine.
- **Indie-scale ops**: one person can run the full stack; expensive prover work is offloaded to a worker or to Boundless.

### Non-goals (v1)
- Multiplayer / head-to-head.
- Real-time anti-cheat (no in-game telemetry to a server).
- Anonymity (the leaderboard is keyed by Stellar `Address`).

---

## 2. Components

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser (player)                       │
│  ┌──────────────┐   ┌───────────────┐   ┌────────────────────┐  │
│  │ Phaser scenes│   │ TS canonical  │   │ Stellar Wallets    │  │
│  │ (Boot/Menu/  │──▶│ sim (Q24.8)   │   │ Kit (Freighter,    │  │
│  │  Play/Over)  │   │ + WASM parity │   │  Albedo, …)        │  │
│  └──────────────┘   └───────────────┘   └────────────────────┘  │
└──────────────┬──────────────────────────────────┬───────────────┘
               │ HTTPS / WS                       │ Soroban RPC
               ▼                                  ▼
┌───────────────────────────┐         ┌──────────────────────────┐
│   Score relay (Bun)       │         │  Stellar Testnet         │
│  ┌─────────────────────┐  │         │  ┌────────────────────┐  │
│  │ /api/run/start      │  │         │  │ flight_scroll      │  │
│  │ /api/run/submit     │──┼────────▶│  │ Soroban contract   │  │
│  │ /api/worker/{poll,  │  │  RPC    │  │ (start/settle/     │  │
│  │   result}           │  │         │  │  leaderboard)      │  │
│  │ prover.ts           │  │         │  └────────────────────┘  │
│  │   ├─ worker queue   │  │         │  ┌────────────────────┐  │
│  │   └─ Boundless      │  │         │  │ Groth16 verifier   │  │
│  └─────────────────────┘  │         │  │ (Nethermind)       │  │
└─────────────┬─────────────┘         │  └────────────────────┘  │
              │                       └──────────────────────────┘
              ▼
┌───────────────────────────┐         ┌──────────────────────────┐
│   Prover worker(s)        │         │  Boundless market        │
│   flight-host binary      │   or    │  (Base Sepolia)          │
│   (RISC Zero CPU/GPU)     │         │                          │
└───────────────────────────┘         └──────────────────────────┘
```

### 2.1 Browser client (`apps/web/`)

Stack: Phaser 3 + Vite + TypeScript.

Responsibilities:
- Asset loading from `public/assets/` (see `assets.json` for the canonical index).
- Phaser scene graph: `Boot → Preload → Menu → Wallet → Play → GameOver → Leaderboard`.
- **Rendering only** — gameplay positions come from the canonical TS sim, not from Phaser physics.
- Input capture: spacebar / tap / click = flap. One bit per tick (60 Hz).
- Recording the transcript (one `u8` per simulated tick) into a `Uint8Array`.
- Wallet integration via Stellar Wallets Kit for signing `start_run` and (optionally) `settle_run`.
- Talking to the score relay via REST.

Scene boundaries:
| Scene | Responsibility |
|---|---|
| `BootScene` | Loader bar, manifest fetch |
| `PreloadScene` | Loads everything in `assets.json` loaderHints |
| `MenuScene` | Title, "Connect Wallet", "Start Run" |
| `WalletScene` | Stellar Wallets Kit modal; persists pubkey to localStorage |
| `PlayScene` | Game loop. Runs canonical sim, renders sprites, captures inputs |
| `GameOverScene` | Final stats; "Submit Score" triggers the prover pipeline |
| `LeaderboardScene` | Reads `flight_scroll.get_top()` and renders top 100 |

### 2.2 Canonical sim (`packages/sim/`)

Pure TypeScript, no Phaser dependency. Fixed-point Q24.8 in `i32`. This is the reference implementation — every other sim is a port of this.

Modules:
- `fp.ts` — fixed-point helpers (`ONE = 256`, `fp_add`, `fp_mul`, `fp_div`, conversions)
- `prng.ts` — deterministic splittable RNG, seeded from `u32`
- `state.ts` — `GameState` type + `create_initial_state(seed)`
- `step.ts` — `step(state, input) → newState`, the per-tick reducer
- `physics.ts` — plane gravity, flap impulse, world-bounds collision
- `obstacles.ts` — pillar / enemy / missile spawn tables, advance, collision
- `pickups.ts` — fuel token spawn, collection, fuel drain
- `scoring.ts` — score deltas (pillar passed +1, fuel collected +5, survival +1/sec)
- `gameover.ts` — terminal conditions (collision, fuel == 0, quit)
- `hash.ts` — SHA-256 over the transcript (matches Rust `core/src/hash.rs` byte-for-byte)
- `index.ts` — public API surface

### 2.3 Rust sim core (`services/prover/core/`)

Mirror of `packages/sim/`. Compiled as a `no_std`-friendly crate so it can be reused by:
- the zkVM guest (`services/prover/guest/`)
- the host binary (for pre-flight checks and dev)
- a WASM build (`services/prover/wasm/`) loaded by the client for differential parity checks

Determinism contract → see `zk_risk_0_stellar.md` §3.

### 2.4 Prover stack (`services/prover/`)

- `core/` — Rust sim (see above)
- `guest/` — `#![no_main]` zkVM program that consumes raw transcript bytes and commits a 44-byte journal
- `methods/` — `risc0_build` integration; produces `FLIGHT_GUEST_ELF` + `FLIGHT_GUEST_ID`
- `host/` — `flight-host` CLI binary; three modes: `--local` (STARK, dev), default (local Groth16), `--boundless` (Boundless marketplace)
- `wasm/` — wraps `core` for browser parity tests

### 2.5 Score relay (`services/server/`)

Stack: Bun + TypeScript + SQLite.

Responsibilities:
- Mirror on-chain run state to a local DB for UX (so a player closing the tab during proving sees status when they return).
- Optional convenience proxy for `start_run` (server signs and submits, then returns the seed to the client).
- Proof orchestration: `prover.ts` races worker + Boundless paths and settles when the first proof arrives.
- Worker HTTP API: `/api/worker/poll`, `/api/worker/input/:id`, `/api/worker/result/:id`, bearer-token auth via `WORKER_API_KEY`.
- Auto-settle on proof completion: prepend Groth16 selector to the raw seal, call `settle_run` on-chain, persist tx hash.
- Re-prove admin endpoint for re-runs after a guest update.

SQLite schema (sketch):
```sql
CREATE TABLE runs (
  run_id          INTEGER PRIMARY KEY,
  player_pubkey   TEXT NOT NULL,
  seed            INTEGER NOT NULL,
  status          TEXT NOT NULL,          -- pending|proving|settled|failed
  score           INTEGER,
  ticks_survived  INTEGER,
  transcript_blob BLOB,
  proof_seal      BLOB,
  proof_journal   BLOB,
  settle_tx_hash  TEXT,
  boundless_req   TEXT,
  boundless_tx    TEXT,
  created_at      INTEGER NOT NULL,
  settled_at      INTEGER
);
```

### 2.6 On-chain layer (`contracts/flight_scroll/`)

Soroban Rust contract. Surface:

```rust
fn initialize(env: Env, admin: Address, verifier: Address, image_id: BytesN<32>);
fn set_image_id(env: Env, new_image_id: BytesN<32>);  // admin only
fn set_verifier(env: Env, new_verifier: Address);     // admin only
fn rotate_admin(env: Env, new_admin: Address);        // admin only

fn start_run(env: Env, player: Address) -> u64;       // emits (started, run_id, seed)
fn settle_run(env: Env, run_id: u64, seal: Bytes, journal: Bytes);
fn cancel_run(env: Env, run_id: u64);                 // player can abandon an active run

fn get_run(env: Env, run_id: u64) -> Option<RunData>;
fn get_top(env: Env) -> Vec<TopEntry>;
fn get_image_id(env: Env) -> BytesN<32>;
```

Storage layout:
| Key | Storage | Value |
|---|---|---|
| `Admin` | instance | `Address` |
| `Verifier` | instance | `Address` |
| `ImageId` | instance | `BytesN<32>` |
| `RunCounter` | instance | `u64` |
| `Run(run_id)` | temporary (24h TTL) | `RunData { player, seed, settled }` |
| `ActiveRun(player)` | temporary | `u64` run_id |
| `Top` | persistent | `Vec<TopEntry>` capped at `TOP_N=100` |

Full settle path → see `zk_risk_0_stellar.md` §6.

---

## 3. Data flow — one run, end to end

1. **Player connects wallet** in `WalletScene`. Pubkey stored in localStorage.
2. **Player presses "Start Run"**. Client calls relay `POST /api/run/start` with `{ player_pubkey }`.
3. **Relay submits `start_run(player)`** to `flight_scroll` (admin-signed for v1 simplicity; player-signed in v2). Reads the `started` event for the seed. Persists `run_id`, `seed`, status=`pending` in SQLite. Returns `{ run_id, seed }` to client.
4. **Client enters `PlayScene`**. Initializes the canonical sim with the seed. Phaser ticks at 60 Hz; on each tick:
   - Read input → `PlayerInput { buttons: flap_bit }`
   - `step_mut(state, input)`
   - Render sprites from `state` (positions, score, fuel)
   - Append `buttons` to the transcript buffer
5. **Game over** fires (collision / fuel out / quit). `PlayScene` transitions to `GameOverScene`.
6. **Player presses "Submit Score"**. Client posts the full transcript to `POST /api/run/submit` with `{ run_id, seed, inputs }`.
7. **Relay validates** the transcript shape, marks `proving`, kicks off `proveScore(run_id, transcript, ...)`. Two paths race:
   - **Worker path**: queues the job; a worker polls `/api/worker/poll`, downloads the transcript via `/api/worker/input/:id`, runs `flight-host` locally on a beefy GPU/CPU, posts back to `/api/worker/result/:id`.
   - **Boundless path**: relay spawns `flight-host --boundless`, which uploads the ELF + stdin to Pinata, submits a request to the Boundless market, polls until fulfillment.
8. **First proof to land wins**. Both produce `{ seal, journal, image_id }`. If both finish, relay diffs the journals and logs `Journal MISMATCH` on divergence.
9. **Relay auto-settles**: prepends the 4-byte Groth16 selector if the seal is raw 256 bytes, calls `settle_run(run_id, seal, journal)`. On success, persists tx hash and sets status=`settled`.
10. **Client polls** `GET /api/run/:run_id` for status. On `settled`, transition to `LeaderboardScene`, which reads `flight_scroll.get_top()` directly via RPC.

---

## 4. Determinism — what to lock down

The proof is only meaningful if the sim is bit-identical across TS and Rust. The places where determinism breaks easily:

| Pitfall | Mitigation |
|---|---|
| `f64` anywhere in the hot path | All physics math is Q24.8 i32. f64 is allowed in render code (Phaser sprite x/y) but never feeds back into state. |
| Map iteration order | Use ordered containers (arrays, sorted vecs). Never `Map` / `HashMap` for in-state collections. |
| Time-based RNG | Seed comes from the contract; no `Math.random()` / `rand::thread_rng()`. |
| Floating-point trig | Precomputed Q24.8 sine table for enemy wobble. |
| Tick rate drift | Sim is `tickFn(state, input)`-driven, not `dt`-driven. Phaser invokes it on a fixed 60 Hz schedule via `setInterval`, not the render loop. |
| Reserved input bits | Guest asserts bits 1..7 of `buttons` are zero. |

Parity test (`pnpm test:parity`) runs a corpus of recorded transcripts through both TS and Rust sims, comparing per-tick state hashes. **Run this on every sim PR.**

---

## 5. Repository layout

```
flight_scroll/
├── apps/
│   └── web/                     # Phaser/Vite client
│       ├── src/
│       │   ├── scenes/          # Boot, Preload, Menu, Wallet, Play, GameOver, Leaderboard
│       │   ├── game/            # Phaser bridge: render sim state to sprites
│       │   ├── net/             # Relay client + Soroban RPC helpers
│       │   └── wallet/          # Wallets Kit integration
│       └── index.html
│
├── packages/
│   └── sim/                     # Canonical TS sim
│       ├── src/                 # fp, prng, state, step, physics, obstacles, pickups, scoring, hash
│       └── __tests__/
│
├── services/
│   ├── server/                  # Bun score relay
│   │   ├── src/
│   │   │   ├── index.ts         # HTTP routes
│   │   │   ├── prover.ts        # worker queue + Boundless race
│   │   │   ├── stellar.ts       # submitTx, settleRunOnChain
│   │   │   ├── db.ts            # SQLite layer
│   │   │   └── *.test.ts
│   │   └── package.json
│   │
│   └── prover/
│       ├── core/                # Rust sim, no_std-friendly
│       ├── guest/               # #![no_main] zkVM program
│       ├── methods/             # build.rs → FLIGHT_GUEST_ELF + FLIGHT_GUEST_ID
│       ├── host/                # flight-host CLI
│       └── wasm/                # WASM build of core for browser parity
│
├── contracts/
│   └── flight_scroll/
│       ├── src/
│       │   ├── lib.rs           # initialize, start_run, settle_run, leaderboard
│       │   └── test.rs          # MockVerifier-backed tests
│       └── Cargo.toml
│
├── scripts/
│   ├── prove.sh                 # one-shot proof driver
│   ├── worker.sh                # remote worker entry point
│   └── deploy.sh
│
├── public/
│   └── assets/                  # plane, obstacles, boosts, backgrounds, assets.json
│
└── spec/
    ├── zk_risk_0_stellar.md
    └── architecture.md          # this file
```

---

## 6. Tech stack summary

| Layer | Choice | Why |
|---|---|---|
| Game engine | Phaser 3 | Mature 2D engine, good asset pipeline, runs in browser |
| Build / bundle | Vite | Fast HMR, simple ESM |
| Canonical sim | TypeScript + Q24.8 i32 | Single language for client + sim, no dependencies |
| zkVM sim | Rust + `no_std` | Required by RISC Zero; mirrors TS sim line-for-line |
| zkVM | RISC Zero + Groth16 wrap | BN254 pairing supported by Stellar Protocol 25 verifier |
| Verifier contract | Nethermind `stellar-risc0-verifier` | Audited, production-deployed |
| Application contract | Soroban Rust (`flight_scroll`) | Single contract: gateway + leaderboard |
| Relay server | Bun + SQLite | Single binary, no infra deps; SQLite for local persistence |
| Wallet | Stellar Wallets Kit | Multi-wallet support: Freighter, Albedo, xBull, etc. |
| RPC | Public Soroban testnet RPC | Pin via env `SOROBAN_RPC_URL` |
| Prover marketplace | Boundless (Base Sepolia) | Fallback when no worker is online |
| File store (Boundless) | Pinata IPFS | Required by Boundless for ELF + stdin |

---

## 7. Environments

| Env | Stellar | Verifier | Boundless |
|---|---|---|---|
| Local dev | `RISC0_DEV_MODE=1` skips real proving; MockVerifier in contract tests | n/a | n/a |
| Testnet | Stellar Testnet | Nethermind verifier address (testnet) | Base Sepolia |
| Mainnet (later) | Stellar Pubnet | Nethermind verifier address (pubnet, once available) | Base mainnet |

Env vars are listed in `zk_risk_0_stellar.md` §8.

---

## 8. Security model

| Threat | Mitigation |
|---|---|
| Player fabricates a high score by posting JSON | Contract requires Groth16 proof; only valid replays of the contract-issued seed verify |
| Player picks a "lucky" seed by re-rolling | Seed is contract-issued from ledger entropy at `start_run` time; one active run per player |
| Player runs an offline brute-force search for inputs | Real but bounded by proof cost (minutes of CPU per attempt); rate-limit `start_run` per account, cap leaderboard inserts |
| Server submits a fabricated score | Server can only submit a proof that verifies against the player's contract-issued seed; cannot manufacture a winning transcript for an arbitrary seed any faster than the player can |
| Old client/guest replays after a sim update | Bump `protocol_version`, rebuild guest → new `image_id` → admin updates `set_image_id` → old seals stop verifying |
| Replay of an old proof against a new run | `seed` field in journal must equal `Run.seed`; each run is single-settle (`RunAlreadySettled`) |
| Admin compromise | Admin can rotate verifier / image_id / itself. v2: timelock admin actions via governance contract |

---

## 9. Roadmap

**v1 (MVP)**
- Single-player Phaser game with canonical TS sim
- Rust sim parity + RISC Zero guest
- Relay-driven proof orchestration (worker + Boundless race)
- `flight_scroll` contract with embedded top-100 leaderboard
- Admin-proxied `start_run`

**v2**
- Player-signed `start_run` (no relay needed for start)
- Player-signed `settle_run` from the browser using Wallets Kit
- Cross-game leaderboard contract (separate from `flight_scroll`)
- Daily seed challenge (everyone plays the same seed on a UTC day)
- Cosmetic NFTs gated by leaderboard rank
- WebGPU prover (if RISC Zero ships a browser-side prover at usable speed)

**v3**
- Daily / weekly tournaments with prize pools (USDC SAC)
- Spectator replay viewer (re-runs the canonical sim from transcript)
- Mobile (React Native / Capacitor wrap)

# flight_scroll — System Architecture

Companion to [`zk_risk_0_stellar.md`](./zk_risk_0_stellar.md). That doc covers the ZK proving pipeline in detail; this doc covers the **whole system** — game client, simulation, score relay, prover stack, and on-chain layer — and how the pieces fit together.

---

## 1. Product summary

**flight_scroll** is a single-player Flappy Bird-style sidescroller. The player flies a passenger jet (`public/assets/plane.png`) through cloud pillars, enemy birds, drones, jets, UFOs, and missiles, picking up fuel tokens for score. The world scrolls horizontally; the plane scrolls in place. Game ends on collision, fuel-out, or voluntary quit.

The run escalates through **five named difficulty stages** (Common → Uncommon → Rare → Legendary → Mythical), each unlocking new threats and tightening existing ones. The last two stages are designed to be hard to beat — Legendary gates skilled play, Mythical gates the leaderboard.

Score is submitted to an on-chain leaderboard, with a ZK proof attesting that the score was earned by playing the game (not fabricated).

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
- Wallet integration via Stellar Wallets Kit. The wallet signs:
  - `start_run` (mandatory — proves the player owns the address that will appear on the leaderboard)
  - `settle_run` (optional — the relay can also submit this since the function is permissionless and the proof self-binds to the player address pinned at start)
- Talking to the score relay via REST for proof orchestration. The relay never sees or holds a Stellar key for the player.

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
- `stages.ts` — `STAGE_TABLE` constant + `maybe_advance_stage()` (see §4)
- `obstacles.ts` — pillar / enemy / missile spawn tables, advance, collision (spawn weights driven by `STAGE_TABLE[state.stage]`)
- `pickups.ts` — fuel token spawn, collection, fuel drain (cadence driven by current stage)
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

**Trust posture:** the relay holds **no key that can mint runs or fake scores on behalf of a player**. Its Stellar account only pays gas to submit the permissionless `settle_run` tx. Compromising the relay lets an attacker waste its XLM balance and stall settlements; it does not let them write fraudulent scores. Players sign `start_run` directly in their wallet.

Responsibilities:
- Mirror on-chain run state to a local DB for UX (so a player closing the tab during proving sees status when they return).
- Accept transcripts via `POST /api/runs/:id/submit` after the player finishes a run.
- Proof orchestration: `prover.ts` races worker + Boundless paths and settles when the first proof arrives.
- Worker HTTP API: `/api/worker/poll`, `/api/worker/input/:id`, `/api/worker/result/:id`, bearer-token auth via `WORKER_API_KEY`.
- Auto-settle on proof completion: prepend Groth16 selector to the raw seal, call `settle_run` on-chain (relay's own account pays gas), persist tx hash.
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

1. **Player connects wallet** in `WalletScene` via Stellar Wallets Kit. Pubkey stored in localStorage. This is the sign-in moment — no separate account is created; the Stellar address *is* the identity.
2. **Player presses "Start Run"**. The client builds a `start_run(player)` Soroban tx, the wallet pops up, the player signs.
3. **Client submits the tx directly to Soroban RPC**, waits for confirmation, parses the `started` event to extract `run_id` and `seed`. Then `POST /api/runs` to the relay with `{ run_id, player_pubkey, seed }` so it can mirror state for later proof routing.
4. **Client enters `PlayScene`**. Initializes the canonical sim with the seed. Phaser ticks at 60 Hz; on each tick:
   - Read input → `PlayerInput { buttons: flap_bit }`
   - `step_mut(state, input)`
   - Render sprites from `state` (positions, score, fuel)
   - Append `buttons` to the transcript buffer
5. **Game over** fires (collision / fuel out / quit). `PlayScene` transitions to `GameOverScene`.
6. **Player presses "Submit Score"**. Client posts the full transcript to `POST /api/runs/:id/submit` with `{ inputs }`. (No wallet popup here — submitting a transcript for proving is not a chain action.)
7. **Relay validates** the transcript shape, marks `proving`, kicks off `proveScore(run_id, transcript, ...)`. Two paths race:
   - **Worker path**: queues the job; a worker polls `/api/worker/poll`, downloads the transcript via `/api/worker/input/:id`, runs `flight-host` locally on a beefy GPU/CPU, posts back to `/api/worker/result/:id`.
   - **Boundless path**: relay spawns `flight-host --boundless`, which uploads the ELF + stdin to Pinata, submits a request to the Boundless market, polls until fulfillment.
8. **First proof to land wins**. Both produce `{ seal, journal, image_id }`. If both finish, relay diffs the journals and logs `Journal MISMATCH` on divergence.
9. **Settlement** — two routes, identical outcome since `settle_run` is permissionless:
   - **Default**: relay auto-settles. Prepends the 4-byte Groth16 selector if the seal is raw 256 bytes, calls `settle_run(run_id, seal, journal)` from its own Stellar account, persists tx hash.
   - **Player-driven**: if the player kept the tab open, client polls `GET /api/runs/:id/proof`, fetches the seal+journal, signs and submits `settle_run` from their own wallet. Useful when the player wants to pay their own gas or when the relay is offline.
10. **Client polls** `GET /api/runs/:id` for status. On `settled`, transition to `LeaderboardScene`, which reads `flight_scroll.get_top()` directly via RPC. Each row shows a stage-tier badge (Common / Uncommon / Rare / Legendary / Mythical) derived client-side from `entry.score`.

---

## 4. Stage system

The game escalates through **five named difficulty stages**. Each stage is a row in a constant lookup table consumed by the sim every tick; transitioning between stages is a pure function of `state.score`. Backgrounds, spawn weights, gap sizes, scroll speed, fuel cadence, and which enemy types can spawn are all per-stage. **Stages do not change the journal** — final stage is derivable from final score, so the leaderboard UI computes a tier badge client-side.

### 4.1 The five stages

| # | Name | Background mood | Score gate | New mechanics | Tightened from previous |
|---|---|---|---|---|---|
| 1 | **Common** | `blue_sky`, `blue_sky_mountain` (day_clear) | 0 | Pillars only | Tutorial baseline |
| 2 | **Uncommon** | `sunset` (evening) | 50 | Enemy birds enter (`bird_big`, `bird_small`) | Pillar gap −20%, scroll +10% |
| 3 | **Rare** | `dusk` | 150 | Drones (`drone`) + **common-tier missiles** (3 variants, fire trail) | Pillar gap −15%, scroll +5% |
| 4 | **Legendary** | `night_clear`, `night_cloudy`, `night_cloudy_moon` (night_calm) | 350 | Jets (`jet`) enter — fast flybys + **uncommon-tier missiles** (ice_blue, plasma_green trails). Drone fire cadence ×2. | Pillar gap −15%, scroll +10%, fuel cadence −25% |
| 5 | **Mythical** | `night_stormy` (storm) | 700 | UFO (`ufo`) spawns — rare zigzag boss + **rare-tier missiles** (nuclear, skull_poison, blue_stripe). Up to 3 missiles in flight. Lightning briefly dims visibility every ~8s. | Pillar gap −15%, scroll +10%, fuel pickups become scarce |

Three properties worth flagging:

- **Stage names extend the missile tier ladder** already used in `assets.json` (`common / uncommon / rare`). Each new stage matches a missile tier, so enemy threats and stage name share vocabulary.
- **Backgrounds within a mood are cosmetic alternates.** Stage 1 picks between `blue_sky` and `blue_sky_mountain` at run start (seeded), Stage 4 picks among three night variants. The pick is deterministic from the seed so the prover replays the same visual, but rendering is decoupled from state — the sim doesn't care which background the client drew.
- **The last two stages are designed to gate the leaderboard.** Reaching Legendary should be a target for skilled players; Mythical is hard-to-beat territory where leaderboard battles happen.

### 4.2 The stage table in code

```ts
// packages/sim/src/stages.ts
export const enum Stage { Common = 0, Uncommon, Rare, Legendary, Mythical }

// enemy bitmask bits
export const ENEMY_BIRD_BIG   = 1 << 0;
export const ENEMY_BIRD_SMALL = 1 << 1;
export const ENEMY_DRONE      = 1 << 2;
export const ENEMY_JET        = 1 << 3;
export const ENEMY_UFO        = 1 << 4;

// missile tier bitmask bits (match assets.json tiers)
export const MISSILE_COMMON   = 1 << 0;
export const MISSILE_UNCOMMON = 1 << 1;
export const MISSILE_RARE     = 1 << 2;

export interface StageParams {
  scoreGate:           number;  // u32 — entry threshold (score >= gate)
  pillarGap:           number;  // Q24.8 — vertical gap between top/bottom pillar
  scrollSpeed:         number;  // Q24.8 — world scroll per tick
  fuelDrainPerTick:    number;  // Q24.8 — base drain rate
  fuelSpawnPeriod:     number;  // u32 — ticks between fuel token spawns
  enemySpawnPeriod:    number;  // u32 — ticks between enemy spawn rolls
  enemyMask:           number;  // u8 — which enemy types can spawn this stage
  missileTierMask:     number;  // u8 — which missile tiers drones/jets fire
  missileMaxInFlight:  number;  // u8 — simultaneous missile cap
  visibilityFlicker:   boolean; // Mythical-only: lightning visibility dims
}

export const STAGE_TABLE: readonly StageParams[] = [
  /* Common    */ {
    scoreGate: 0,   pillarGap: fp(0.35), scrollSpeed: fp(2.0),
    fuelDrainPerTick: fp(0.04), fuelSpawnPeriod: 300,
    enemySpawnPeriod: 0, enemyMask: 0, missileTierMask: 0, missileMaxInFlight: 0,
    visibilityFlicker: false,
  },
  /* Uncommon  */ {
    scoreGate: 50,  pillarGap: fp(0.28), scrollSpeed: fp(2.2),
    fuelDrainPerTick: fp(0.05), fuelSpawnPeriod: 320,
    enemySpawnPeriod: 600, enemyMask: ENEMY_BIRD_BIG | ENEMY_BIRD_SMALL,
    missileTierMask: 0, missileMaxInFlight: 0, visibilityFlicker: false,
  },
  /* Rare      */ {
    scoreGate: 150, pillarGap: fp(0.24), scrollSpeed: fp(2.3),
    fuelDrainPerTick: fp(0.06), fuelSpawnPeriod: 340,
    enemySpawnPeriod: 500,
    enemyMask: ENEMY_BIRD_BIG | ENEMY_BIRD_SMALL | ENEMY_DRONE,
    missileTierMask: MISSILE_COMMON, missileMaxInFlight: 1,
    visibilityFlicker: false,
  },
  /* Legendary */ {
    scoreGate: 350, pillarGap: fp(0.20), scrollSpeed: fp(2.5),
    fuelDrainPerTick: fp(0.07), fuelSpawnPeriod: 450,    // fuel cadence -25%
    enemySpawnPeriod: 380,
    enemyMask: ENEMY_BIRD_BIG | ENEMY_BIRD_SMALL | ENEMY_DRONE | ENEMY_JET,
    missileTierMask: MISSILE_COMMON | MISSILE_UNCOMMON, missileMaxInFlight: 2,
    visibilityFlicker: false,
  },
  /* Mythical  */ {
    scoreGate: 700, pillarGap: fp(0.17), scrollSpeed: fp(2.7),
    fuelDrainPerTick: fp(0.08), fuelSpawnPeriod: 700,    // fuel scarce
    enemySpawnPeriod: 300,
    enemyMask: ENEMY_BIRD_BIG | ENEMY_BIRD_SMALL | ENEMY_DRONE | ENEMY_JET | ENEMY_UFO,
    missileTierMask: MISSILE_COMMON | MISSILE_UNCOMMON | MISSILE_RARE,
    missileMaxInFlight: 3, visibilityFlicker: true,
  },
];

export function stageForScore(score: number): Stage {
  for (let i = STAGE_TABLE.length - 1; i >= 0; i--) {
    if (score >= STAGE_TABLE[i].scoreGate) return i as Stage;
  }
  return Stage.Common;
}
```

Rust mirror lives at `services/prover/core/src/stages.rs` with the same constants byte-for-byte (verified by the parity test). The leaderboard UI imports `stageForScore` to render the tier badge.

### 4.3 Stage transitions in `step()`

The reducer checks at the end of each tick whether `state.score` has crossed the next stage's gate:

```rust
fn maybe_advance_stage(state: &mut GameState) {
    let next = (state.stage as usize) + 1;
    if next < STAGE_TABLE.len() && state.score >= STAGE_TABLE[next].score_gate {
        state.stage = next as u8;
        state.stage_just_changed = true;  // render-only cue
    }
}
```

`stage_just_changed` is a transient per-tick flag consumed by the Phaser layer for stage-up effects (flash, music swap, background crossfade). It is **not** hashed into the per-tick state digest used by the parity test — only persistent state fields are.

### 4.4 Determinism implications

The stage table is part of the sim, so any tuning change rebuilds the guest → new `image_id` → admin rotates the contract's pinned `image_id` for new proofs to verify. Old in-flight proofs settled within the rotation window fail with `ImageIdMismatch`. This means **balance tweaks are a coordinated operation**: rebuild guest, deploy new image_id, push new client. A small price for the cheat-resistance guarantee.

`stages.ts` and `stages.rs` are covered by the cross-language parity test (`pnpm test:parity`) like the rest of the sim.

### 4.5 Background selection (cosmetic, seeded)

At run start, the client picks one background per mood bucket from the seed:

```ts
// apps/web/src/game/backgrounds.ts
const BG_BY_MOOD: Record<Mood, string[]> = {
  day_clear:  ['bg_blue_sky', 'bg_blue_sky_mountain'],
  evening:    ['bg_sunset'],
  dusk:       ['bg_dusk'],
  night_calm: ['bg_night_clear', 'bg_night_cloudy', 'bg_night_cloudy_moon'],
  storm:      ['bg_night_stormy'],
};

export function pickBackground(seed: number, mood: Mood): string {
  const variants = BG_BY_MOOD[mood];
  return variants[seed % variants.length];
}
```

Same seed → same variant chosen → same visual on every replay. The sim never reads this; it's purely client-side, but seeding it from the run's seed means screen recordings of a run can be matched back to a proof.

---

## 5. Determinism — what to lock down

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

## 6. Repository layout

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
│       ├── src/                 # fp, prng, state, step, physics, stages, obstacles, pickups, scoring, hash
│       └── __tests__/            # includes stage-transition + parity tests
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

## 7. Tech stack summary

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

## 8. Environments

| Env | Stellar | Verifier | Boundless |
|---|---|---|---|
| Local dev | `RISC0_DEV_MODE=1` skips real proving; MockVerifier in contract tests | n/a | n/a |
| Testnet | Stellar Testnet | Nethermind verifier address (testnet) | Base Sepolia |
| Mainnet (later) | Stellar Pubnet | Nethermind verifier address (pubnet, once available) | Base mainnet |

Env vars are listed in `zk_risk_0_stellar.md` §8.

---

## 9. Security model

| Threat | Mitigation |
|---|---|
| Player fabricates a high score by posting JSON | Contract requires Groth16 proof; only valid replays of the contract-issued seed verify |
| Player picks a "lucky" seed by re-rolling | Seed is contract-issued from ledger entropy at `start_run` time. Player pays gas per `start_run`, capping rerolls economically. One active run per player blocks parallel rerolls. |
| Player runs an offline brute-force search for inputs | Real but bounded by proof cost (minutes of CPU per attempt) and `start_run` gas. Per-account rate limiting in the contract (e.g., max N active+settled runs per ledger day) is a v1.1 add. |
| Relay submits a fabricated score | Impossible. The relay can only submit a proof that verifies against the on-chain seed for that `run_id`, and the score lands in `RunData.player`'s slot regardless of who submits. The relay cannot manufacture a winning transcript faster than the player could. |
| Relay impersonates a player to occupy their leaderboard slot | Impossible. Only the player's wallet can sign `start_run`, which is what writes their address into `RunData`. The relay never sees the player's secret. |
| Old client/guest replays after a sim update | Bump `protocol_version`, rebuild guest → new `image_id` → admin updates `set_image_id` → old seals stop verifying. Existing in-flight runs settled within the rotation window may fail; relay surfaces this as `ImageIdMismatch`. |
| Replay of an old proof against a new run | `seed` field in journal must equal `Run.seed`; each run is single-settle (`RunAlreadySettled`) |
| Admin compromise | Admin can only rotate `verifier` / `image_id` / itself. Cannot mint runs or write scores (those paths have no admin override). v2: timelock admin actions via a small governance contract. |

---

## 10. Roadmap

**v1 (MVP) — flight_scroll alone**
- Stellar Wallets Kit sign-in; player wallet signs `start_run` directly
- Single-player Phaser game with canonical TS sim
- **Five-stage difficulty system** (Common → Uncommon → Rare → Legendary → Mythical) with stage-tier badges on the leaderboard
- Rust sim parity + RISC Zero guest
- Relay-driven proof orchestration (worker + Boundless race)
- Permissionless `settle_run` — relay or player can submit; either way the score lands in the player's slot
- `flight_scroll` contract with embedded top-100 leaderboard
- Optional player-side settle from the browser (relay still default for "close tab and walk away" UX)

**v2 — multi-game**
- Second game ships its own contract using the `flight_scroll` template (own sim, own guest, own `image_id`, own leaderboard)
- `game_hub` registry contract: enumerates registered games, fans out aggregated queries (top-N globally, per-player profile across all games)
- Shared frontend shell: one Wallet Kit connection, game-picker scene, hub-driven leaderboards
- Daily seed challenge (contract issues a UTC-day shared seed; everyone races the same world)
- Cosmetic NFTs gated by leaderboard rank
- WebGPU prover (if RISC Zero ships a browser-side prover at usable speed)

**v3 — economy**
- Daily / weekly tournaments with prize pools in USDC SAC
- Entry fees and prize disbursement via the game hub
- Spectator replay viewer (re-runs the canonical sim from transcript)
- Mobile (React Native / Capacitor wrap)

### 10.1 Multi-game contract pattern

Each new game implements the same three-method surface:

```rust
fn start_run(env: Env, player: Address) -> u64;            // player.require_auth()
fn settle_run(env: Env, run_id: u64, seal: Bytes, journal: Bytes);  // permissionless
fn get_top(env: Env) -> Vec<TopEntry>;
```

Plus admin-only `initialize`, `set_image_id`, `set_verifier`, `rotate_admin`. The journal layout, `MatchConfig`, and `step()` function are all game-specific; the contract scaffold around them is reusable.

The hub (when it exists) holds a `Vec<GameEntry { game_id, contract: Address, name: Symbol }>` and exposes:

```rust
fn register_game(env: Env, contract: Address, name: Symbol);  // admin
fn list_games(env: Env) -> Vec<GameEntry>;
fn global_top(env: Env, n: u32) -> Vec<(GameEntry, Vec<TopEntry>)>;
fn player_profile(env: Env, player: Address) -> Vec<(GameEntry, Option<TopEntry>)>;
```

The hub does **not** own scores — it queries the per-game contracts. This keeps each game upgradeable on its own cadence and avoids a single trust-bottleneck contract.

# flight_scroll — Build Phases

Each phase ends with a runnable artifact. Don't move to the next phase until the current one's "done when" criterion is met. Phases are small on purpose.

Status of each phase lives in [`/progress.md`](../progress.md) — keep that file terse; this file is the plan.

---

## Phase 0 — Initialize

Set up the empty skeleton: pnpm workspace, cargo workspace, soroban contract scaffold, basic CI. No game code, no contract logic.

**Done when:** `pnpm install`, `cargo build`, `stellar contract build` all succeed on a fresh clone.

---

## Phase 1 — Playable MVP (no ZK, no chain, no wallet)

Phaser client + TypeScript sim. One stage (Common). Pillars only. Keyboard input (↑/↓ = steer; held keys, not edge-triggered). No gravity yet — the plane holds altitude until the player steers; fuel drain (Phase 2) is what eventually forces descent. Score counter. Game over on collision or leaving the world. No fuel, no enemies, no wallet, no contract, no proof.

**Done when:** `pnpm dev` opens the game in a browser, I can steer the plane through pillars with ↑/↓, see a score, and die when I crash.

---

## Phase 2 — Full gameplay (still no chain)

Fuel mechanic and `fuel_token` pickups. All enemy types (`bird_big`, `bird_small`, `drone`, `jet`, `ufo`). Missile spawning from drones/jets with the three tier bitmasks. All 5 stages from `STAGE_TABLE`. Parallax backgrounds with per-mood variant picker. Basic SFX.

**Done when:** The game matches the spec, is fun to play, and a skilled player can plausibly reach Mythical in a long run.

---

## Phase 3 — Deterministic sim + Rust port

Convert all sim math in `packages/sim/` to fixed-point Q24.8 (i32). Port to `services/prover/core/` (Rust, `no_std`-friendly). WASM wrapper at `services/prover/wasm/`. Cross-language parity test that runs random + recorded transcripts through both implementations and asserts per-tick state hashes match.

**Done when:** `pnpm test:parity` passes on a corpus of ≥100 transcripts; TS and Rust sims are bit-identical.

---

## Phase 4 — RISC Zero prover (local only)

`guest/`, `methods/`, `host/` crates. `flight-host` CLI with `--local` (STARK, dev) and default (Groth16) modes. Reads transcript JSON → writes `proof_artifacts.json` with the 44-byte journal + 260-byte seal.

**Done when:** I can record a run in the browser, dump the transcript, run `./scripts/prove.sh transcript.json`, get a Groth16 seal that `receipt.verify(FLIGHT_GUEST_ID)` accepts locally.

---

## Phase 5 — Soroban contract + wallet integration

`contracts/flight_scroll/` with `initialize`, `start_run`, `settle_run`, `cancel_run`, `get_top`, `get_run`. Mock verifier for tests. Stellar Wallets Kit in the client. Player signs `start_run` from their wallet, plays, and `settle_run` is invoked manually (either by player or via CLI).

**Done when:** End-to-end on Stellar testnet: connect wallet → wallet signs `start_run` → play → record transcript → run `flight-host` manually → submit `settle_run` → score visible in `get_top()`.

---

## Phase 6 — Relay + worker queue

Bun server (`services/server/`) with SQLite. Worker poll API (`/api/worker/{poll,input,result}`). Auto-settle on proof completion. Stateless worker script (`scripts/worker.sh`) runs `flight-host` and posts results back.

**Done when:** Player plays, presses "Submit Score", closes browser. Relay drives proof + settle without further input. Player returns later and sees the score on the leaderboard.

---

## Phase 7 — Boundless fallback + production deploy

Containerize `flight-host` (Dockerfile with RISC Zero + CUDA). Deploy as RunPod serverless GPU worker (auto-scale 0→N on queue depth). Enable Boundless path in the relay as fallback (env-gated). Deploy relay to a production host (Fly.io / Railway / your VPS of choice).

**Done when:** Public testnet URL anyone can play. Worker scales on demand. Boundless backstops when no worker is available. End-to-end latency from "Submit Score" to leaderboard entry is < 10 min on a cold-start path.

---

## Phase 8 — Polish + launch

Onboarding flow, error states, leaderboard UI with stage-tier badges (Common / Uncommon / Rare / Legendary / Mythical), mobile-friendly layout, performance tuning, security review of the contract.

**Done when:** Ready for public testnet announcement.

---

## After v1 — see `architecture.md` §10 (Roadmap)

v2 = multi-game (second game + `game_hub` aggregator). v3 = tournaments + economy. Out of scope for these phases.

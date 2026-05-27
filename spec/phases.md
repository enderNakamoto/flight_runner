# flight_scroll — Build Phases

Each phase ends with a runnable artifact. Don't move to the next phase until the current one's "done when" criterion is met. Phases are small on purpose.

Status of each phase lives in [`/progress.md`](../progress.md) — keep that file terse; this file is the plan.

---

## Phase 0 — Initialize

Set up the empty skeleton: pnpm workspace, cargo workspace, soroban contract scaffold, basic CI. No game code, no contract logic.

**Done when:** `pnpm install`, `cargo build`, `stellar contract build` all succeed on a fresh clone.

---

## Phase 1 — Playable MVP (no ZK, no chain, no wallet)

Phaser client + TypeScript sim. One **proto stage** — pillars only, as the simplest renderable obstacle. (Not part of the five-stage `STAGE_TABLE` progression in §4 — Stage 1/Common is birds-only and lands in Phase 2.) Keyboard input (↑/↓ = steer; held keys, not edge-triggered). No gravity yet — the plane holds altitude until the player steers; fuel drain (Phase 2) is what eventually forces descent. Score counter. Game over on collision or leaving the world. No fuel, no enemies, no wallet, no contract, no proof.

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

## Phase 7 — Rewards-sync messaging

Sprinkle a "just go play, we'll sync rewards at launch" callout across the landing, leaderboards, and how-it-works pages. One reusable `RewardsCallout` component (treasure-chest sprite + one friendly line, neutral cyan accent), reused everywhere. No FAQ, no new page, no specifics. Copy is vague by design — no token mention, no commitments.

**Done when:** The same one-line rewards-sync promise appears on `/`, `/leaderboard`, `/birdstrike/leaderboard`, and `/how-it-works`, all sharing a single component.

---

## Phase 8 — Leaderboard indexer

Off-chain top-N leaderboard, fed by a cron job that walks `pb` events from the `game_hub` contract on Stellar testnet and aggregates per-game top scores into a static JSON snapshot. Starts local — a `scripts/index-leaderboard.ts` runs on a local cron (e.g. `launchd` / cron / `pnpm run index:leaderboard`) and writes `public/leaderboard/<slug>.json`. "Push it online" path is intentionally cheap: commit the JSON to the deployed site, or upload to a public-CORS bucket (Cloudflare R2 / S3) — pick when we wire Phase 10's deploy. Frontend on `/leaderboard` and `/<slug>/leaderboard` fetches the JSON and renders a real top-N table next to the existing address-lookup tile.

Tasks:
- `scripts/index-leaderboard.ts`: page through `pb` events for each registered game, derive top-N by `(score desc, ticks_survived asc)`, write `public/leaderboard/<slug>.json` with a `generated_at` timestamp.
- Local cron wiring (a `Makefile` target or `pnpm run index:leaderboard:watch`) so the snapshot stays fresh during development.
- Frontend reads the JSON and renders top-N (with the "your best" address-lookup tile kept alongside).
- Decide the production upload target (committed-to-repo vs. R2/S3) when Phase 10 deploy lands — script should be agnostic.

**Done when:** A scheduled local run produces a fresh `public/leaderboard/birdstrike.json` and the `/birdstrike/leaderboard` page renders a real top-N list updated within ~5 min of an on-chain submission.

---

## Phase 9 — Social sharing

**Depends on Phase 8** for the rank data (top-10 detection needs a real leaderboard).

Make a top-10 rank shareable in one tap. `ShareRankButton` with three actions: post to X (intent URL), copy Discord-formatted message, copy link. Rank-tier boast templates (#1 / top 3 / top 10 / top 100 / ranked / unranked). Top-10 celebration modal: compares current rank vs. `localStorage('best-rank-birdstrike')`, fires once per improvement when a player crosses into the top 10, with pixel-confetti and prominent share CTAs. Smaller toast for any new personal best. Single static OG share image checked in under `public/og/`; per-user dynamic OG cards deferred.

**Done when:** Posting to X / Discord from `/birdstrike/leaderboard` is one click, and breaking into the top 10 fires a one-time celebration modal with share buttons. Twitter Card Validator / Discord embed renders the static OG image.

---

## Phase 10 — Production deploy (Fly.io)

Containerize `flight-host` as a CPU-only Fly.io Machine (auto-stop when idle, warm on demand). Deploy the Bun relay to Fly.io and connect it to the worker over Fly's private 6PN. Public testnet URL anyone can play. Boundless deferred — we ship Fly.io alone.

**Done when:** Public testnet URL anyone can play. Worker auto-stops when idle and wakes on demand. End-to-end latency from "Submit Score" to leaderboard entry is bounded by the observed Fly.io CPU prove time (no GPU, no Boundless fallback).

---

## Phase 11 — Proof pipeline visualization

**Gated on Phase 10** — needs the Fly.io worker live so the four-step animation reflects real timings, not mocks.

Live loading view shown after "Submit Score" while the Fly worker proves. Four horizontal step nodes (vertical on mobile): **Simulating** (Rust replay) → **Proving** (RISC Zero STARK) → **Wrapping** (Groth16) → **Settling** (Stellar/Soroban). Each node has `queued / active / done / failed` state. A paper-plane sprite travels between nodes as each step completes. Per-step elapsed timer + "~Xs typical" microcopy tuned from real Fly worker measurements. Transport: SSE from the relay with polling fallback. Failure state shows a red node + retry; an optional collapsed terminal pane shows real proof IDs / hashes.

**Done when:** A player who hits "Submit Score" sees a live four-step pipeline animate to completion using real per-step timing from the Fly.io worker, and a transient failure surfaces a retry button.

---

## Phase 12 — Polish + launch

Onboarding flow, error states, leaderboard UI with stage-tier badges (Common / Uncommon / Rare / Legendary / Mythical), mobile-friendly layout, performance tuning, security review of the contract.

**Done when:** Ready for public testnet announcement.

---

## After v1 — see `architecture.md` §10 (Roadmap)

v2 = multi-game (second game + `game_hub` aggregator). v3 = tournaments + economy. Out of scope for these phases.

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

## Phase 10 — Production deploy (Vercel + Fly.io)

Static frontend on Vercel at `proofarcade.xyz`. Bun relay + `flight-host` containerised on Fly.io at `relay.proofarcade.xyz`, single Machine, auto-stop. Indexer cron via GitHub Actions every 5 min, commits the snapshot back to `main`, Vercel auto-deploys on the push.

**Done when:** Public testnet URL anyone can play, full submit flow lands on chain via the relay in stub mode, MockVerifier accepts the seal so end-to-end UX works without real cryptography.

**Footnote (discovered post-deploy):** Fly Machines run on Firecracker microVMs whose stripped-down kernel can't host nested Docker. RISC Zero's Groth16 wrap step needs `docker run risczero/risc0-groth16-prover` which fails with `os error 2` on Fly — there's no docker binary, and installing one then fighting the storage-driver / cgroups / capability constraints isn't a winning battle. The Fly deploy stays as the stub-mode bring-up; real proving moves to Phase 11 on a host with a full Linux kernel.

---

## Phase 11 — Real ZK proving on Vultr

Move the relay + prover off Fly onto a Vultr **High Frequency Compute 4C/16GB** instance (4 high-frequency vCPU / 16 GB / Ubuntu 24.04 / Docker installed). US datacenter (Atlanta or NYC). Flight-host runs the real RISC Zero pipeline: STARK in-process, Groth16 wrap inside the official `risczero/risc0-groth16-prover` Docker image (~6 min each at this VM size). The relay's HTTP surface and submit flow are unchanged — only the runtime substrate is different.

Tasks:
- Provision Vultr box via `vultr-cli` with a cloud-init script that installs Docker, Bun, Rust + rzup, and Caddy
- Build `flight-host --release` on the box; deploy `services/server/` as a systemd unit
- Caddy reverse-proxies `relay.proofarcade.xyz` → `localhost:8080` with auto-issued Let's Encrypt cert
- DNS cutover: `relay.proofarcade.xyz` A record from Fly IP → Vultr IP
- Set env on the box: `PROVE_MODE=groth16`, `VERIFIER_SELECTOR_HEX=73c457ba`, `GITHUB_DISPATCH_TOKEN=…`, `CORS_ORIGIN=https://proofarcade.xyz`
- Validate the first real proof end-to-end (browser → real Groth16 → MockVerifier still accepts → score lands)
- Off-chain verify the captured seal by calling Nethermind's verifier (`CDUDXCLMNE7…`) directly via Stellar CLI
- Cutover admin tx: `game_hub.set_verifier(CDUDXCLMNE7…)` — every submission from this moment forward must verify against real BN254 pairing math
- Decommission Fly app once the Vultr box has been serving submissions cleanly for ~24 h

**Done when:** A player submits, the Vultr box produces a real 260-byte Groth16 seal, the Nethermind verifier on chain accepts it via pairing checks, and `MockVerifier` is no longer reachable from `game_hub`'s storage. No mocks anywhere.

**Cost:** ~$48/mo flat for the Vultr HFC 4C/16GB instance (hourly billing available at ~$0.071/h if we ever shut it down). USD billing, US-headquartered. Replaces the Fly relay + Fly worker line items. Considered Hetzner CCX23 (Ashburn ~$41/mo); $7/mo gap wasn't worth EUR billing through a German entity.

---

## Phase 12 — Boundless marketplace integration

Replace local CPU Groth16 proving on the Vultr box with the **Boundless** decentralized proving marketplace. Vultr's CPU pipeline takes ~10–15 min per proof (STARK on 4C/16GB + Groth16 wrap inside `risczero/risc0-groth16-prover` Docker). Boundless GPU provers return the same 260-byte Groth16 seal in ~30–60 s for ~$0.04–$0.17 per proof. The on-chain side is unchanged: Nethermind's verifier `CDUDXCLMNE7…` on Stellar testnet accepts whichever path produced the seal. **Local skill installed** at `~/.claude/skills/boundless/SKILL.md` (sourced from `https://docs.boundless.network/skill.md`) — future sessions auto-load full SDK reference, gotchas, and decision matrices.

### Network strategy — testnet first, then Base mainnet

**Three real options, increasing in commitment:**

| Option | Network | Tokens | Real provers? | Verifier |
|---|---|---|---|---|
| `localnet` | Local Foundry node | none (mock chain) | No — only the BoundlessMarket contract; you'd run a prover locally | local |
| **testnet (recommended start)** | **Ethereum Sepolia** (official quick-start path) or **Base Sepolia** (mirrors prod network) | **Sepolia ETH** (free from a faucet) | **Yes — real provers, real proofs, only the ETH is value-less** | Stellar testnet's `CDUDXCLMNE7…` (already wired up by Phase 11) |
| production | **Base Mainnet** | Real Base ETH (~$50 starting balance, bridge via Coinbase/Base Bridge) | Yes | Stellar testnet for v1 launch; Stellar mainnet whenever we move |

**Cleanest path: Ethereum Sepolia → Base Mainnet.** That's the documented Boundless quick-start (`RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`) and matches the boundless-foundry-template example. Skipping Base Sepolia keeps us from validating two parallel testnet stacks.

**Boundless does NOT have a built-in "mock proof" mode.** A Sepolia proof IS a real RISC Zero Groth16 seal, generated on real prover hardware, that any RISC Zero verifier will accept (including our Nethermind one). If you want fake-instant proofs for unit tests, that's `RISC0_DEV_MODE=1` (a separate RISC Zero feature where any guest output is "valid" against a dev-mode verifier) — completely independent of Boundless, only useful when wiring up our JS plumbing without burning testnet ETH on every iteration.

### Confirmed mainnet contract addresses (Base Mainnet)

| Contract | Address |
|---|---|
| BoundlessMarket | `0xfd152dadc5183870710fe54f939eae3ab9f0fe82` |
| RiscZeroVerifierRouter | `0x0b144e07a0826182b6b59788c34b32bfa86fb711` |
| SetVerifier | `0x1Ab08498CfF17b9723ED67143A050c8E8c2e3104` |
| CollateralToken (ZKC) | `0xaa61bb7777bd01b684347961918f1e07fbbce7cf` |
| Order Stream | `https://base-mainnet.boundless.network` |

The Boundless SDK has built-in `Deployment` constants per network, so we won't hardcode addresses — `Client::builder().with_deployment(None)` defaults to Base Mainnet, and per-network overrides are one enum value.

### Architecture — keep the relay, swap only the prover

- Bun relay at `relay.proofarcade.xyz` stays where it is. Vultr can stay or move back to Fly's $5/mo tier (nested Docker no longer required once Boundless does the heavy lifting).
- `services/server/src/submit.ts` — only file in the JS path that changes. Instead of spawning `flight-host`, it calls a new helper that submits to Boundless and polls for fulfillment.
- `services/prover/host/src/main.rs` gets a `#[cfg(feature = "boundless")]` block (chickenz's pattern). The host binary picks Boundless vs. local prove based on a build flag, so local prove stays alive for debugging without burning ETH.
- `services/prover/methods` (guest ELF + image_id) is unchanged. Boundless takes our ELF, runs it on someone else's GPU, returns the same 260-byte seal.
- Stellar contracts untouched. `set_image_id` may run once more if the Boundless build environment produces a different image_id than the Vultr build (likely — different toolchain). The verifier and game_hub stay put.

### Tasks (testnet → mainnet)

**Testnet bringup (Ethereum Sepolia):**
- `cast wallet new` → produces an Ethereum address + private key. Save the address; the private key goes in env, never in repo.
- Fund the address with Sepolia ETH from a faucet (e.g. https://sepolia-faucet.pk910.de/ or Alchemy's). ~0.1 ETH is plenty for hundreds of testnet proofs.
- Sign up at Pinata, generate a JWT, get the `PINATA_JWT=…` string. Free tier covers our volume.
- Add to `/etc/proofarcade.env` on the box (or wherever the relay runs):
  ```
  BOUNDLESS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
  BOUNDLESS_PRIVATE_KEY=0x…
  PINATA_JWT=…
  ```
- Add `boundless-market = "1.3"`, `alloy = { version = "0.8", features = ["full"] }`, `url`, `tokio` to `services/prover/host/Cargo.toml` (gated behind `[features] boundless = []`).
- Implement `prove_via_boundless(elf, stdin)` in the host: `Client::builder().with_rpc_url(...).with_private_key(...).with_uploader_config(StorageUploaderConfig::default()).build().await?`, submit with `.with_groth16_proof()`, poll `client.wait_for_request_fulfillment(id, Duration::from_secs(5), expires)`.
- Add `PROVE_MODE=boundless` as a fourth mode in `services/server/src/config.ts` (next to `groth16`/`stark`/`stub`). Relay picks the right path from this single env var, so rollback is one config change.
- Build flight-host with the feature: `cargo build --release --bin flight-host --features boundless`.
- End-to-end test: submit a real game transcript via the relay, watch Boundless market in Etherscan as the request gets locked + fulfilled, get the seal back, run the **same off-chain verify** we did in Phase 11 C5 (`stellar contract invoke … verify --seal … --image_id … --journal …`) against our Stellar testnet verifier `CDUDXCLMNE7…`. **Must return `null` — if not, debug before going further.**

**Mainnet cutover (Base Mainnet):**
- Generate a *fresh* wallet for mainnet — don't reuse the Sepolia keys.
- Fund with ~$50 Base ETH (bridge via Coinbase or Base Bridge; or buy USDC on Coinbase, withdraw to Base, swap to ETH).
- Update `/etc/proofarcade.env`:
  ```
  BOUNDLESS_RPC_URL=https://mainnet.base.org
  BOUNDLESS_PRIVATE_KEY=0x…   (the mainnet wallet)
  ```
- Restart relay, do one production submit, watch the tx on Basescan and confirm it lands on Stellar.
- Possibly: extract the new image_id from the (Boundless-environment-rebuilt) ELF and `set_image_id` again if it differs from the Vultr value `b9836a4b…`. Per the Phase 11 lesson, fresh build = different hash.
- Drop or downsize the Vultr box once Boundless has been serving cleanly for ~24 h. Relay no longer needs r0vm/docker/risc0, so Fly micro ($5/mo) is enough. Keep `PROVE_MODE=groth16` as a fallback flag for local debugging.

### Cost model

| Path | Fixed | Per-proof | When wins |
|---|---|---|---|
| Vultr CPU only (today) | $96/mo | $0 | sustained <30 proofs/day; UX wait tolerable |
| **Boundless on Base Mainnet** | ~$5/mo (tiny relay box) | $0.04–$0.17 | <2400 proofs/mo; need fast proofs; want zero-infra prover side |
| Vultr GPU A40 (vcg-a40-4c-20g-8vram) | $210/mo | $0 | 100+ proofs/day AND need consistent ~2-min latency |

At our current volume (single-digit proofs/day) Boundless mainnet costs roughly the same as Vultr while collapsing latency from 12 min → 60 s — that's the upgrade.

### Done when

- A player who hits Submit Score gets a fulfilled Groth16 seal back from Boundless within ~60 s typical
- The seal verifies against Nethermind's contract on Stellar testnet (off-chain `verify` returns `null`, then the on-chain `submit_score` lands)
- `PROVE_MODE=boundless` is the default in production env; `PROVE_MODE=groth16` (local Vultr path) still works as a flag-gated fallback for debugging without burning Base ETH
- progress.md flipped to done, current phase advanced to 13

### Risk surface

- **Market goes quiet** (no provers bidding under the offered price). Request expires → relay must either retry with higher `max_price` or fall back to local prove. The feature-flag arrangement above keeps the fallback alive.
- **Hot wallet on Base mainnet** — same monitoring discipline as the GitHub PAT: rotate if leaked, watch balance, top up before depletion. Set a Basescan watch / alert on the address.
- **ELF + per-request inputs published to IPFS** (Pinata) — fine for game data which is already public, but explicit awareness in case a future game has secrets.
- **First real-money infra component** — Stellar txs are fractions of a cent; Base mainnet txs + Boundless bounties are dollars. Pricing mistakes are now possible and recoverable but worth attention.

---

## Phase 13 — Proof pipeline visualization

**Was Phase 12** — moved here because Phase 12 became Boundless integration. The animation work is unblocked regardless of which prover backend is live (Vultr or Boundless), but the typical timings shown to the player should be tuned from whichever backend is in production at the time we ship the animation.

Live loading view shown after "Submit Score" while the proof is being generated. Four horizontal step nodes (vertical on mobile): **Simulating** (Rust replay) → **Proving** (RISC Zero STARK) → **Wrapping** (Groth16) → **Settling** (Stellar/Soroban). Each node has `queued / active / done / failed` state. A paper-plane sprite travels between nodes as each step completes. Per-step elapsed timer + "~Xs typical" microcopy tuned from real worker measurements (Vultr CPU: ~6 min STARK + ~6 min wrap + ~5 s settle; Boundless: ~30 s total + ~5 s settle). Transport: SSE from the relay with polling fallback. Failure state shows a red node + retry; an optional collapsed terminal pane shows real proof IDs / hashes for the curious.

**Observable progress checkpoints** (what the relay can actually report — silence between these is what the animation needs to cover with dead-reckoning):
- proof_started (immediate, T+0s)
- STARK_done (Vultr: r0vm RAM drops; Boundless: `RequestLocked` event on Base)
- wrap_started (Vultr: docker container appears; Boundless: `RequestFulfilled` event)
- proof_returned (relay logs `✅ proved`)
- settling (browser submitting Soroban tx; Horizon stream)
- settled (tx confirmed in ledger)

**Done when:** A player who hits "Submit Score" sees a live four-step pipeline animate to completion using real per-step timing from whichever backend is live, and a transient failure surfaces a retry button.

---

## Phase 14 — Polish + launch

**Was Phase 13** — pushed back to make room for Boundless.

Onboarding flow, error states, leaderboard UI with stage-tier badges (Common / Uncommon / Rare / Legendary / Mythical), mobile-friendly layout, performance tuning, security review of the contract.

**Done when:** Ready for public testnet announcement.

---

## After v1 — see `architecture.md` §10 (Roadmap)

v2 = multi-game (second game + `game_hub` aggregator). v3 = tournaments + economy. Out of scope for these phases.

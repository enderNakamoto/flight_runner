# flight_scroll

A 2D pixel-art side-scrolling game with ZK-verified on-chain leaderboards on **Stellar Soroban**. RISC Zero proves your run; a single `game_hub` Soroban contract hosts any number of games and stores per-player personal bests.

For architecture, see [`spec/`](spec/). For phase-by-phase status, see [`progress.md`](progress.md). This README focuses on **how to deploy and run**.

---

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| `stellar` CLI | 25.x | contract build + deploy |
| Rust toolchain | 1.80+ (with `wasm32v1-none` target) | building contracts + prover |
| `rzup` + `cargo-risczero` | 3.0.x | building the RISC Zero guest |
| `pnpm` | 9.7.x | web app + workspace deps |
| Node | 20+ | web app build |
| Python 3 | for `scripts/smoke.sh` strkey decoding |
| Docker (optional) | 16+ GB RAM | only needed for Groth16 proof wrapping |

Quick install of the Stellar pieces:
```bash
rustup target add wasm32v1-none
curl -L https://risczero.com/install | bash && rzup install
# install stellar CLI per https://developers.stellar.org/docs/tools/cli/install-cli
```

---

## Deploy the contract

The single entry point is [`scripts/deploy.sh`](scripts/deploy.sh). It builds the contract, deploys `mock_verifier` + `game_hub`, initialises, registers `flight_scroll` as `game_id=1`, runs a `get_game` smoke, and writes the resulting contract ids into `apps/web/.env.local`.

### Testnet (default — auto-generates + friendbot-funds an identity)

```bash
./scripts/deploy.sh
```

That's it. The script:
1. Generates a fresh keypair named `flight-deployer-testnet`
2. Friendbot-funds it with test XLM
3. Builds and deploys both contracts
4. Saves the keypair to **`.deploy-keys.testnet.txt`** (chmod 600, gitignored)
5. Saves contract ids to **`.deploy-state.testnet`** (gitignored)
6. Writes **`apps/web/.env.local`** with the contract id + testnet RPC

If `flight-deployer-testnet` already exists, the script refuses unless you pass `--reuse`.

### Mainnet

```bash
./scripts/deploy.sh --network mainnet
```

Differences from testnet:
- **No friendbot.** Script generates an identity and *prompts you to fund it manually* with real XLM before continuing.
- **Confirmation prompt** — you must type `I UNDERSTAND` to proceed.
- Uses the public Stellar network passphrase + `https://mainnet.sorobanrpc.com` RPC.

### Custom identity name

```bash
./scripts/deploy.sh --identity my-named-deployer
```

Combine with `--network` for clarity:
```bash
./scripts/deploy.sh --network testnet --identity alice-deployer
./scripts/deploy.sh --network mainnet --identity prod-2026
```

### Re-deploying from the same identity

```bash
./scripts/deploy.sh --reuse                     # default identity
./scripts/deploy.sh --identity foo --reuse      # specific identity
```

> Note: this deploys *new* contracts under the same deployer. `initialize` will succeed (new contract instance), but `add_game(1, …)` will collide if you somehow targeted an existing initialised contract. Normally not an issue with fresh deploys.

---

## Bring your own keypair

The Stellar CLI's identity store (`~/.config/stellar/identity/<name>.toml`) is the source of truth. To use an existing account as the deployer:

### Option A — import a secret key
```bash
stellar keys add my-existing --secret-key
# (paste your S… secret key when prompted)
./scripts/deploy.sh --network testnet --identity my-existing --reuse
```

### Option B — import a seed phrase
```bash
stellar keys add my-existing --seed-phrase
# (paste your 12/24-word phrase)
./scripts/deploy.sh --network testnet --identity my-existing --reuse
```

### Option C — already configured `stellar keys` identity
If you already have a Stellar CLI identity (e.g. from another project), just pass `--identity <name> --reuse`.

The script writes its keypair backup file (`.deploy-keys.<network>.txt`) regardless of how the identity was created — useful as a quick reference even when the CLI store has the canonical copy.

---

## Verify the deploy worked

```bash
./scripts/smoke.sh                                  # uses .deploy-state.testnet
./scripts/smoke.sh --network mainnet                # uses .deploy-state.mainnet
```

Submits three on-chain `submit_score` transactions against the deployed contract to verify:
1. First submission writes a new personal best
2. Higher score replaces the existing PB
3. Lower score does NOT overwrite (event-only, no leaderboard write)

Uses the deployer identity as the test player. Costs a few stroops on testnet, negligible real XLM on mainnet (~$0.001 per tx). All three transactions go through `mock_verifier`, which accepts any seal — so the test exercises the contract logic, not real proof verification.

---

## Run the game

```bash
pnpm install                                        # once
pnpm --filter @flight/web build
pnpm --filter @flight/web preview
```

Open the URL it prints. The chain panel (top-left) shows the deployed contract id from `apps/web/.env.local`. Connect any funded testnet wallet (Freighter, xBull, Albedo, etc.) — *not* the deployer; the deployer is for admin/deploy operations, players are separate accounts.

Play loop:
1. **Connect Wallet** — picks a wallet via Stellar Wallets Kit modal
2. **Play** — keyboard controls (↑/↓ steer, ←/→ throttle). Press **T** at any time to dump a binary transcript of the run to disk.
3. **Prove** — locally on your machine:
   ```bash
   ./scripts/prove.sh transcript.bin --player <YOUR_G_STRKEY>
   ```
   Produces `proof_artifacts.json`.
4. **Submit Score** — in the wallet panel, upload `proof_artifacts.json`. Wallet signs `submit_score`. Personal best updates only if your score exceeds the existing entry.
5. **My Best** — `get_score` read shows your current PB for `flight_scroll`.

---

## File reference

| File | Purpose | Gitignored? |
|---|---|---|
| `.deploy-keys.<network>.txt` | Deployer public + secret key backup | **yes** |
| `.deploy-state.<network>` | Contract ids + image id from last deploy | **yes** |
| `apps/web/.env.local` | Vite env vars for the web app (contract id, RPC, passphrase) | **yes** |
| `proof_artifacts.json` | Output of `./scripts/prove.sh` | **yes** |
| `transcript.bin` (or named `*.bin`) | Player run dump from PlayScene T key | not committed by convention |

Stellar identity store (canonical keypair location) lives in `~/.config/stellar/identity/<name>.toml` regardless of network.

---

## Common operations

| Task | Command |
|---|---|
| Fresh testnet deploy | `./scripts/deploy.sh` |
| Mainnet deploy | `./scripts/deploy.sh --network mainnet` |
| Smoke an existing deploy | `./scripts/smoke.sh [--network N]` |
| Re-register flight_scroll after sim updates | new image_id auto-derived, then admin can call `set_image_id` (see below) |
| Pause a game | `stellar contract invoke --id $GAME_HUB --source $IDENTITY --network testnet -- set_paused --game_id 1 --paused true` |
| Rotate admin | `stellar contract invoke --id $GAME_HUB --source $IDENTITY --network testnet -- rotate_admin --new_admin <G…>` |
| Rotate image_id (sim update) | `stellar contract invoke --id $GAME_HUB --source $IDENTITY --network testnet -- set_image_id --game_id 1 --new_image_id $(./target/release/image-id)` |

---

## Security notes

- `.deploy-keys.<network>.txt` is `chmod 600`. It's the *secret key* of an account that may control admin functions on a deployed contract. Treat it accordingly.
- **Do not commit** `.deploy-keys.*`, `.deploy-state.*`, or `.env.local`. They're in `.gitignore` already.
- For mainnet, prefer importing a hardware-wallet-backed identity (Ledger via `stellar keys add`) rather than letting the script generate a hot keypair. Hot keys for testnet only.
- The `mock_verifier` accepts any seal — fine for local + testnet bring-up, **never** acceptable for mainnet production. Phase 7 swaps it for the Nethermind `stellar-risc0-verifier` via an `initialize` call (or a fresh deploy with the real verifier address).

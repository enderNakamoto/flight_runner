# Progress

**Current phase:** Phase 11 — Real ZK proving on Hetzner (not started; Fly can't host Groth16 wrap because Firecracker microVMs can't run nested Docker). Phase 10 done in stub mode (Vercel frontend at proofarcade.xyz, Fly relay at relay.proofarcade.xyz, GitHub Actions cron every 5 min, all TLS auto-issued, MockVerifier accepts the zero seal). Phase 9 done (share buttons + top-10 celebration modal + new-PB toast + OG card). Phase 8 done (minimum-viable game_hub redeploy + on-chain enumeration up to 1500 + indexer cron writing public/leaderboard/<slug>.json + top-N table on /birdstrike/leaderboard). Phase 7 done (rewards-sync messaging + overlay layout polish). Phase 6 done locally. Phase 5 done locally and on testnet.

For what each phase is, see [`spec/phases.md`](spec/phases.md).
For commit-level history, see `git log`.

| Phase | Status |
|---|---|
| 0 — Initialize | in progress (frontend slice only — Soroban scaffolding deferred to phases 5+) |
| 1 — Playable MVP | done |
| 2 — Full gameplay | done (SFX deferred to Phase 8 — no audio assets yet) |
| 3 — Deterministic sim + Rust port | done (`pnpm test:parity` — 100-transcript corpus, TS↔Rust chain hashes byte-identical) |
| 4 — RISC Zero prover (local) | done locally (STARK + dev-mode green; Groth16 wrap deferred — needs Docker ≥16 GB RAM) |
| 5 — Soroban contract + wallet | done locally + deployed to testnet (game_hub `CCDQ…JQ3CTT`; on-chain submit_score smoke green) |
| 6 — Relay + worker queue | done locally (Bun relay + bash worker + auto-settle via stellar-sdk; end-to-end smoke green: POST transcript → claim → result → on-chain submit_score → tx_hash in DB) |
| 7 — Rewards-sync messaging | done (cyan `RewardsCallout` on Birdstrike card + `/birdstrike/leaderboard`; pre-flight REWARD line "Sentinel points sync to your address"; overlay layouts tightened) |
| 8 — Leaderboard indexer | done (game_hub redeployed at `CALP…U2N6YO` with on-chain player enumeration up to 1500 silent-skip; `scripts/index-leaderboard.ts` writes `public/leaderboard/<slug>.json`; top-N table renders on `/birdstrike/leaderboard`) |
| 9 — Social sharing | done (𝕏/Discord/copy-link share buttons in the "Your best" tile, top-10 celebration modal w/ pixel confetti, new-PB toast, 1200×630 OG card + Twitter Card meta) |
| 10 — Production deploy (Vercel + Fly.io) | done in **stub mode** — Vercel frontend at `https://proofarcade.xyz`; Fly relay at `https://relay.proofarcade.xyz` in `PROVE_MODE=stub`; GitHub Actions cron `*/5 * * * *`. Real Groth16 wrap blocked because Fly's Firecracker microVM can't run nested Docker — moved to Phase 11. |
| 11 — Real ZK proving on Hetzner | not started — provision Hetzner CCX23, migrate relay off Fly, flip `PROVE_MODE=groth16`, swap `MockVerifier` → Nethermind's `CDUDXCLMNE7…`. Tears down Fly app as the last step. |
| 12 — Proof pipeline visualization | not started (gated on Phase 11) |
| 13 — Polish + launch | not started |

## How to use this file

- Update the **Current phase** line and the table cell when a phase starts or finishes. Status values: `not started` / `in progress` / `done`.
- Add a one-line note under **Notes** *only* for blockers or decisions that don't live in commit messages, code, or the spec. If a note grows past two lines, it belongs in `spec/` instead.
- Do not log every commit here. `git log` already does that.

## Notes

- Phase 2 SFX is parked until Phase 8 — no audio assets in `public/assets/`. The "basic SFX" item from the original Phase 2 scope (engine, score, hit, fuel pickup) lands with the polish/launch pass.
- Phase 3 done: 100-transcript corpus under `packages/sim/tests/corpus/` (5 real human-played + 95 deterministic fuzz from `gen-corpus.ts`). `pnpm test:parity` walks the corpus through both TS and Rust sims and asserts per-tick SHA-256 chain hashes match — bit-identical across all 100.
- Phase 4: RISC Zero 3.0.5 toolchain installed via modern `rzup`. `services/prover/{guest,methods,host}` scaffolded. `./scripts/prove.sh <transcript.bin> [--local]` works end-to-end on a real corpus transcript: STARK path (~1m34s for 103-tick run) produces a 256 KB seal that `receipt.verify(FLIGHT_GUEST_ID)` accepts cryptographically. Groth16 wrap path runs but currently OOMs in Docker (snark-wrap needs ~16 GB, host docker has 8.2). Deploy target: **Fly.io Machines, CPU-only, auto-stop** (relay also on Fly, 6PN private network to worker pool; Boundless wired as fallback per spec). Phase 7 should not need a GPU until traffic > ~500 proofs/day.
- Phase 5: `game_hub` multi-game contract — single Soroban contract hosts any number of RISC Zero-verified games, admin registers each with its own pinned `image_id`; per-(game_id, player) personal-best storage with tie-break by ticks_survived. MockVerifier for tests / early testnet. **Simplified flow:** players run the game entirely off-chain. Only `submit_score(game_id, seal, journal)` touches the contract — proof commits the player's 32-byte ED25519 pubkey, contract stores PB by pubkey, no auth required (anyone can submit on anyone's behalf — credit always flows to the pubkey the proof committed to). No more `start_run` / `cancel_run` / run tracking. Journal grew 44 → 76 bytes (adds pubkey at offset 12). `scripts/deploy.sh` is per-network (testnet/mainnet) and saves the deployer keypair to a chmod-600 file. `scripts/smoke.sh` exercises submit_score + get_score live on chain (3 txs: first-submit, higher-replaces, lower-keeps). All green.
- Phase 8 contract slice deployed: new minimum-viable `game_hub` (drop GameMeta, add on-chain player enumeration up to 1500 with silent-skip past cap, paginated `get_players_page`) deployed to testnet at `CALPEUANXSCROTCZCTSGP6HKRPF5HE5W43JUWQG6ZRIWMRLANAU2N6YO` with `mock_verifier` `CCHD6IPXUF73VNNPVNT3HYKAOKWUU4RM5FMAKJEMGDQR3CBBAJBUCSZN`. Birdstrike registered as game_id=1 with current image_id `2ad4ff…3c6d8`. Old contract `CCDQ…JQ3CTT` is orphaned (dev data, no real players).
- Phase 6: relay is a **pure prover** — `POST /api/prove` spawns `flight-host`, returns `{ seal_hex, journal_hex }`. The relay never touches Stellar; no `RELAY_SECRET_KEY`, no XLM to babysit, no hot wallet on the box. The **browser** owns the on-chain submit: web client signs `submit_score` via the player's wallet (player pays the ~$0.001 gas). Pending proofs are cached in localStorage so the player can close the tab mid-prove and come back to sign later. Web client default state shows nothing chain-related — a floating "Submit Score" / "Sign Pending" button only appears when there's a fresh transcript OR a cached proof. Earlier worker-poll API + SQLite + `scripts/worker.sh` + relay's chain client removed across commits e218f88 → c7aa12f (~850 LoC net deleted from the original Phase 6 implementation).

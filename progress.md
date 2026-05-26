# Progress

**Current phase:** Phase 7 — Boundless fallback + production deploy (not started). Phase 6 done locally (relay + worker queue green end-to-end on testnet, browser-driven smoke pending). Phase 5 done locally and on testnet (deploy + on-chain submit_score smoke green).

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
| 7 — Boundless + production deploy | not started |
| 8 — Polish + launch | not started |

## How to use this file

- Update the **Current phase** line and the table cell when a phase starts or finishes. Status values: `not started` / `in progress` / `done`.
- Add a one-line note under **Notes** *only* for blockers or decisions that don't live in commit messages, code, or the spec. If a note grows past two lines, it belongs in `spec/` instead.
- Do not log every commit here. `git log` already does that.

## Notes

- Phase 2 SFX is parked until Phase 8 — no audio assets in `public/assets/`. The "basic SFX" item from the original Phase 2 scope (engine, score, hit, fuel pickup) lands with the polish/launch pass.
- Phase 3 done: 100-transcript corpus under `packages/sim/tests/corpus/` (5 real human-played + 95 deterministic fuzz from `gen-corpus.ts`). `pnpm test:parity` walks the corpus through both TS and Rust sims and asserts per-tick SHA-256 chain hashes match — bit-identical across all 100.
- Phase 4: RISC Zero 3.0.5 toolchain installed via modern `rzup`. `services/prover/{guest,methods,host}` scaffolded. `./scripts/prove.sh <transcript.bin> [--local]` works end-to-end on a real corpus transcript: STARK path (~1m34s for 103-tick run) produces a 256 KB seal that `receipt.verify(FLIGHT_GUEST_ID)` accepts cryptographically. Groth16 wrap path runs but currently OOMs in Docker (snark-wrap needs ~16 GB, host docker has 8.2). Deploy target: **Fly.io Machines, CPU-only, auto-stop** (relay also on Fly, 6PN private network to worker pool; Boundless wired as fallback per spec). Phase 7 should not need a GPU until traffic > ~500 proofs/day.
- Phase 5: `game_hub` multi-game contract — single Soroban contract hosts any number of RISC Zero-verified games, admin registers each with its own pinned `image_id`; per-(game_id, player) personal-best storage with tie-break by ticks_survived; no on-chain top-N (leaderboard UIs index `settled` events off-chain). MockVerifier for tests / early testnet. **Simplified flow:** players run the game entirely off-chain. Only `submit_score(game_id, seal, journal)` touches the contract — proof commits the player's 32-byte ED25519 pubkey, contract stores PB by pubkey, no auth required (anyone can submit on anyone's behalf — credit always flows to the pubkey the proof committed to). No more `start_run` / `cancel_run` / run tracking. 23/23 contract tests. Journal grew 44 → 76 bytes (adds pubkey at offset 12). Deployed to testnet: `game_hub` `CCDQQXA3U2KN6MTWV2LXSSQAXFWFPPBTU4LAPC4GOXVHEPXJ6VJQ3CTT`, `mock_verifier` `CCPOJPM74DFUR7B2SPBBY3ENCMXEMC6VTB4OLSU6GE5UV3UJ7RD27TPN`. `scripts/deploy.sh` is per-network (testnet/mainnet) and saves the deployer keypair to a chmod-600 file. `scripts/smoke.sh` exercises submit_score + get_score live on chain (3 txs: first-submit, higher-replaces, lower-keeps). All green.
- Phase 6: `services/server/` Bun + bun:sqlite relay. Player-facing API (`POST /api/runs`, `GET /api/runs/:id`) and worker API (`/api/worker/{poll,input,result,error}`, bearer-token auth). Atomic queue claim via SELECT + UPDATE in a transaction. Auto-settle: when worker posts seal + journal, relay calls `submit_score` on-chain via stellar-sdk using its own funded keypair (player signs nothing — permissionless submit_score makes this safe). `scripts/worker.sh` is the stateless polling loop that wraps `./scripts/prove.sh`. Web client: PlayScene publishes the captured transcript to a module-level buffer at game over; wallet panel offers "Submit to Relay" when relay URL is configured, polls /api/runs/:id, surfaces status + tx_hash. End-to-end smoke green: POST transcript → worker claim → result post → on-chain submit → tx `255debfae7f33435a0afb5c7ba3c78393d1529a41327d031700bc7c1d6580bbb` lands and `get_score` returns score 12345. Phase 6 done-when bar met locally (manual prove → relay would need either real Groth16 or a stub seal that the contract accepts; both code paths exercised independently).

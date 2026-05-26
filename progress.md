# Progress

**Current phase:** Phase 5 — Soroban contract + wallet (code complete; awaiting first testnet deploy + manual end-to-end smoke). Phase 4 done locally (STARK path verified; Groth16 wrap deferred until Docker RAM ≥16 GB).

For what each phase is, see [`spec/phases.md`](spec/phases.md).
For commit-level history, see `git log`.

| Phase | Status |
|---|---|
| 0 — Initialize | in progress (frontend slice only — Soroban scaffolding deferred to phases 5+) |
| 1 — Playable MVP | done |
| 2 — Full gameplay | done (SFX deferred to Phase 8 — no audio assets yet) |
| 3 — Deterministic sim + Rust port | done (`pnpm test:parity` — 100-transcript corpus, TS↔Rust chain hashes byte-identical) |
| 4 — RISC Zero prover (local) | done locally (STARK + dev-mode green; Groth16 wrap deferred — needs Docker ≥16 GB RAM) |
| 5 — Soroban contract + wallet | code complete (game_hub multi-game contract, MockVerifier, wallet UI, deploy script) — awaiting manual testnet smoke |
| 6 — Relay + worker queue | not started |
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
- Phase 5: `game_hub` multi-game contract — single Soroban contract hosts any number of RISC Zero-verified games, admin registers each with its own pinned `image_id`; per-(game_id, player) personal-best storage with tie-break by ticks_survived; no on-chain top-N (leaderboard UIs index `settled` events off-chain). MockVerifier for tests / early testnet. **Simplified flow:** players run the game entirely off-chain. Only `submit_score(game_id, seal, journal)` touches the contract — proof commits the player's 32-byte ED25519 pubkey, contract stores PB by pubkey, no auth required (anyone can submit on anyone's behalf — credit always flows to the pubkey the proof committed to). No more `start_run` / `cancel_run` / run tracking — accepted trade-off: seed grinding becomes possible, but bots were the bigger threat either way. 23/23 contract tests cover the simplified surface. Journal grew 44 → 76 bytes (adds pubkey at offset 12). Web client: Connect Wallet, optional Submit Score (visible when wallet connected), My Best — no game-start round trip. `scripts/deploy.sh` does the testnet bring-up. **Manual smoke pending:** `stellar keys generate flight-deployer --network testnet --fund` → `scripts/deploy.sh` → `pnpm --filter @flight/web preview` → play → `./scripts/prove.sh transcript.bin --player <G…>` → upload `proof_artifacts.json`.

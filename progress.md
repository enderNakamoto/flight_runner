# Progress

**Current phase:** Phase 3 — Deterministic sim + Rust port (parity gate met; corpus expansion pending)

For what each phase is, see [`spec/phases.md`](spec/phases.md).
For commit-level history, see `git log`.

| Phase | Status |
|---|---|
| 0 — Initialize | in progress (frontend slice only — Soroban scaffolding deferred to phases 5+) |
| 1 — Playable MVP | done |
| 2 — Full gameplay | done (SFX deferred to Phase 8 — no audio assets yet) |
| 3 — Deterministic sim + Rust port | in progress (TS & Rust bit-identical on 5-transcript corpus; ≥100-corpus target outstanding) |
| 4 — RISC Zero prover (local) | not started |
| 5 — Soroban contract + wallet | not started |
| 6 — Relay + worker queue | not started |
| 7 — Boundless + production deploy | not started |
| 8 — Polish + launch | not started |

## How to use this file

- Update the **Current phase** line and the table cell when a phase starts or finishes. Status values: `not started` / `in progress` / `done`.
- Add a one-line note under **Notes** *only* for blockers or decisions that don't live in commit messages, code, or the spec. If a note grows past two lines, it belongs in `spec/` instead.
- Do not log every commit here. `git log` already does that.

## Notes

- Phase 2 SFX is parked until Phase 8 — no audio assets in `public/assets/`. The "basic SFX" item from the original Phase 2 scope (engine, score, hit, fuel pickup) lands with the polish/launch pass.
- Phase 3 parity: the substantive condition (TS & Rust sims byte-identical at every recorded tick) is met. Five real human-played transcripts under `packages/sim/tests/corpus/` round-trip to the same SHA-256 chain hash on both sides. The spec calls for ≥100 transcripts; expansion to that corpus size is purely collection work (synthesized random-input runs + more browser-recorded sessions) — no further sim changes expected.

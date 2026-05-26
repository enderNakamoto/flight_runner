#!/usr/bin/env bash
# prove.sh — convenience driver around flight-host.
#
# Usage:
#   ./scripts/prove.sh path/to/transcript.bin              # Groth16 (default)
#   ./scripts/prove.sh path/to/transcript.bin --local      # STARK only
#   RISC0_DEV_MODE=1 ./scripts/prove.sh transcript.bin --local   # fast dev mock
#
# Output: ./proof_artifacts.json (override with -o /path/to/out.json).
#
# Builds flight-host on demand (release profile). The first run takes a couple
# of minutes — risc0-build compiles the guest ELF for riscv32im.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <transcript.bin> [--local] [-o out.json]" >&2
  exit 2
fi

if [[ "${RISC0_DEV_MODE:-}" == "1" ]]; then
  echo "[prove.sh] RISC0_DEV_MODE=1 (mock receipts)"
fi

cargo build -p flight_host --release --quiet
exec "$REPO_ROOT/target/release/flight-host" "$@"

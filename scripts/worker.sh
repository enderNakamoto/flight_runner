#!/usr/bin/env bash
# worker.sh — stateless relay worker. Polls the relay for jobs, downloads
# the transcript + player pubkey, runs flight-host locally, posts the
# resulting seal + journal back.
#
# Env vars (or pass via flags):
#   RELAY_URL       e.g. http://localhost:8787
#   WORKER_API_KEY  bearer token (same value the relay was started with)
#   POLL_INTERVAL   seconds between polls when queue is empty (default 5)
#   PROVE_MODE      'groth16' (default) or 'local' (STARK, NOT on-chain submittable)
#
# Usage:
#   RELAY_URL=http://localhost:8787 WORKER_API_KEY=topsecret ./scripts/worker.sh
#
# The worker runs ./scripts/prove.sh, which means the same toolchain
# (rzup + cargo-risczero 3.x) must be installed on whatever box this
# runs on. In Phase 7, the box will be a Fly Machine.

set -euo pipefail

RELAY_URL="${RELAY_URL:-http://localhost:8787}"
WORKER_API_KEY="${WORKER_API_KEY:-}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
PROVE_MODE="${PROVE_MODE:-groth16}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "$WORKER_API_KEY" ]]; then
  echo "[worker] WORKER_API_KEY env var required" >&2
  exit 1
fi

AUTH=(-H "authorization: Bearer $WORKER_API_KEY")
WORK_DIR="$(mktemp -d -t flight-worker.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[worker] relay=$RELAY_URL · mode=$PROVE_MODE · poll=${POLL_INTERVAL}s"
echo "[worker] tmp dir: $WORK_DIR"

# Validate the relay is reachable before entering the polling loop.
if ! curl -sf "${AUTH[@]}" "$RELAY_URL/health" >/dev/null; then
  echo "[worker] relay unreachable at $RELAY_URL/health" >&2
  exit 1
fi

while true; do
  # ── Poll for the next job ──────────────────────────────────────────────
  POLL_OUT="$(curl -sS -w "\n%{http_code}" "${AUTH[@]}" "$RELAY_URL/api/worker/poll" || echo "")"
  HTTP_CODE="$(echo "$POLL_OUT" | tail -n1)"
  BODY="$(echo "$POLL_OUT" | sed '$d')"

  if [[ "$HTTP_CODE" == "204" ]]; then
    sleep "$POLL_INTERVAL"
    continue
  fi
  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "[worker] poll returned $HTTP_CODE: $BODY" >&2
    sleep "$POLL_INTERVAL"
    continue
  fi

  RUN_ID="$(echo "$BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])' 2>/dev/null || echo "")"
  if [[ -z "$RUN_ID" ]]; then
    echo "[worker] poll returned unexpected body: $BODY" >&2
    sleep "$POLL_INTERVAL"
    continue
  fi
  echo "[worker] claimed run #$RUN_ID"

  # ── Download transcript + pubkey ───────────────────────────────────────
  INPUT_OUT="$(curl -sS "${AUTH[@]}" "$RELAY_URL/api/worker/input/$RUN_ID")"
  PLAYER="$(echo "$INPUT_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["player_strkey"])')"
  TRANSCRIPT_PATH="$WORK_DIR/run-$RUN_ID.bin"
  echo "$INPUT_OUT" | python3 -c '
import sys, json, base64, os
r = json.load(sys.stdin)
sys.stdout.buffer.write(base64.b64decode(r["transcript_b64"]))
' > "$TRANSCRIPT_PATH"
  echo "[worker] player=$PLAYER · transcript=$(wc -c <"$TRANSCRIPT_PATH" | tr -d ' ') bytes"

  # ── Prove ──────────────────────────────────────────────────────────────
  PROOF_PATH="$WORK_DIR/run-$RUN_ID.json"
  if ! ./scripts/prove.sh "$TRANSCRIPT_PATH" --player "$PLAYER" \
       $( [[ "$PROVE_MODE" == "local" ]] && echo "--local" ) \
       -o "$PROOF_PATH"; then
    ERR_MSG="prove.sh failed for run #$RUN_ID"
    echo "[worker] $ERR_MSG" >&2
    curl -sS -X POST "${AUTH[@]}" -H 'content-type: application/json' \
      -d "{\"error\":\"$ERR_MSG\"}" "$RELAY_URL/api/worker/error/$RUN_ID" >/dev/null || true
    continue
  fi

  # ── Post result ────────────────────────────────────────────────────────
  SEAL_HEX="$(python3 -c 'import sys,json; print(json.load(open(sys.argv[1]))["seal"])' "$PROOF_PATH")"
  JOURNAL_HEX="$(python3 -c 'import sys,json; print(json.load(open(sys.argv[1]))["journal"])' "$PROOF_PATH")"

  RESULT_OUT="$(curl -sS -X POST "${AUTH[@]}" -H 'content-type: application/json' \
    -d "{\"seal_hex\":\"$SEAL_HEX\",\"journal_hex\":\"$JOURNAL_HEX\"}" \
    "$RELAY_URL/api/worker/result/$RUN_ID")"
  echo "[worker] result for run #$RUN_ID: $RESULT_OUT"

  rm -f "$TRANSCRIPT_PATH" "$PROOF_PATH"
done

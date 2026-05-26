#!/usr/bin/env bash
# smoke.sh — on-chain end-to-end smoke against a deployed game_hub.
#
# Uses the fact that mock_verifier accepts any seal to exercise the
# full submit_score path with a synthetic 260-byte seal + 76-byte journal.
# Does NOT exercise the real prover (Groth16 still blocked on Docker RAM);
# does exercise everything the contract does on-chain.
#
# Usage:
#   scripts/smoke.sh                                    # uses defaults (testnet)
#   scripts/smoke.sh --network testnet --identity flight-deployer-testnet
#
# Reads contract ids from .deploy-state.<network> written by deploy.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NETWORK="testnet"
IDENTITY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)  NETWORK="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    -h|--help)  sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "[smoke] unknown flag: $1" >&2; exit 2 ;;
  esac
done

STATE_FILE=".deploy-state.$NETWORK"
[[ -f $STATE_FILE ]] || { echo "[smoke] $STATE_FILE missing — run scripts/deploy.sh first" >&2; exit 1; }
# shellcheck disable=SC1090
source "$STATE_FILE"

[[ -z "$IDENTITY" ]] && IDENTITY="${IDENTITY_OVERRIDE:-$IDENTITY}"
[[ -z "$IDENTITY" ]] && IDENTITY="$(grep -E '^IDENTITY=' "$STATE_FILE" | cut -d= -f2)"

echo "[smoke] network=$NETWORK · identity=$IDENTITY · game_hub=$GAME_HUB_ID"
PLAYER_STRKEY="$(stellar keys address "$IDENTITY")"
echo "[smoke] player strkey: $PLAYER_STRKEY"

# ── Decode the player's G-strkey to a 32-byte ED25519 pubkey ──────────────
# Stellar strkey: base32(version_byte || pubkey32 || crc16_le), no padding.
PUBKEY_HEX="$(python3 - "$PLAYER_STRKEY" <<'PY'
import base64, sys
sk = sys.argv[1].rstrip("=")
# Pad to a multiple of 8 for base32 decoding.
sk = sk + "=" * ((8 - len(sk) % 8) % 8)
raw = base64.b32decode(sk)
print(raw[1:33].hex())
PY
)"
echo "[smoke] player pubkey: $PUBKEY_HEX"

# ── Build a synthetic 76-byte journal ─────────────────────────────────────
# Layout (services/prover/core/src/types.rs):
#   0..4   score          u32 LE
#   4..8   ticks_survived u32 LE
#   8..12  seed           u32 LE
#   12..44 player_pubkey  32 bytes
#   44..76 transcript_hash 32 bytes
SCORE_HEX="$(printf "%08x" 5000 | tac -rs '..' | tr -d '\n')"  # LE
TICKS_HEX="$(printf "%08x" 1234 | tac -rs '..' | tr -d '\n')"
SEED_HEX="$(printf "%08x" 3735928559 | tac -rs '..' | tr -d '\n')"  # 0xDEADBEEF
HASH_HEX="$(printf 'aa%.0s' {1..32})"  # 32 bytes of 0xAA

JOURNAL_HEX="${SCORE_HEX}${TICKS_HEX}${SEED_HEX}${PUBKEY_HEX}${HASH_HEX}"
JOURNAL_BYTES=$((${#JOURNAL_HEX} / 2))
echo "[smoke] journal ($JOURNAL_BYTES bytes): ${JOURNAL_HEX:0:40}…${JOURNAL_HEX: -8}"

# ── Build a synthetic 260-byte seal (MockVerifier accepts anything) ───────
SEAL_HEX="$(printf '00%.0s' {1..260})"
SEAL_BYTES=$((${#SEAL_HEX} / 2))
echo "[smoke] seal ($SEAL_BYTES bytes): all zeros"

# ── submit_score ──────────────────────────────────────────────────────────
echo "[smoke] calling submit_score(1, …) …"
stellar contract invoke --id "$GAME_HUB_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- submit_score \
  --game_id 1 \
  --seal "$SEAL_HEX" \
  --journal "$JOURNAL_HEX"

# ── get_score (read) ──────────────────────────────────────────────────────
echo "[smoke] calling get_score(1, player) …"
SCORE_OUT="$(stellar contract invoke --id "$GAME_HUB_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- get_score --game_id 1 --player_pubkey "$PUBKEY_HEX")"
echo "[smoke] get_score returned: $SCORE_OUT"

if ! echo "$SCORE_OUT" | grep -q '"score":5000'; then
  echo "[smoke] ❌ expected score=5000 in response"
  exit 1
fi
if ! echo "$SCORE_OUT" | grep -q '"ticks_survived":1234'; then
  echo "[smoke] ❌ expected ticks_survived=1234"
  exit 1
fi
if ! echo "$SCORE_OUT" | grep -q '"seed":3735928559'; then
  echo "[smoke] ❌ expected seed=3735928559 (0xDEADBEEF)"
  exit 1
fi

# ── Higher-score replacement ──────────────────────────────────────────────
echo "[smoke] resubmit with score=9999 (should replace PB) …"
SCORE2_HEX="$(printf "%08x" 9999 | tac -rs '..' | tr -d '\n')"
TICKS2_HEX="$(printf "%08x" 2222 | tac -rs '..' | tr -d '\n')"
JOURNAL2_HEX="${SCORE2_HEX}${TICKS2_HEX}${SEED_HEX}${PUBKEY_HEX}${HASH_HEX}"
stellar contract invoke --id "$GAME_HUB_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- submit_score --game_id 1 --seal "$SEAL_HEX" --journal "$JOURNAL2_HEX"

SCORE_OUT2="$(stellar contract invoke --id "$GAME_HUB_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- get_score --game_id 1 --player_pubkey "$PUBKEY_HEX")"
echo "[smoke] get_score after PB update: $SCORE_OUT2"
if ! echo "$SCORE_OUT2" | grep -q '"score":9999'; then
  echo "[smoke] ❌ expected score=9999 after higher submission"
  exit 1
fi

# ── Lower-score keeps PB ──────────────────────────────────────────────────
echo "[smoke] resubmit with score=100 (should NOT replace PB) …"
SCORE3_HEX="$(printf "%08x" 100 | tac -rs '..' | tr -d '\n')"
JOURNAL3_HEX="${SCORE3_HEX}${TICKS2_HEX}${SEED_HEX}${PUBKEY_HEX}${HASH_HEX}"
stellar contract invoke --id "$GAME_HUB_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- submit_score --game_id 1 --seal "$SEAL_HEX" --journal "$JOURNAL3_HEX"

SCORE_OUT3="$(stellar contract invoke --id "$GAME_HUB_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- get_score --game_id 1 --player_pubkey "$PUBKEY_HEX")"
if ! echo "$SCORE_OUT3" | grep -q '"score":9999'; then
  echo "[smoke] ❌ PB should still be 9999 after lower submission"
  exit 1
fi
echo "[smoke] PB held at 9999 (lower submit didn't overwrite ✓)"

echo
echo "[smoke] ✅ all on-chain assertions passed:"
echo "       - first submit recorded score=5000"
echo "       - higher submit replaced PB to 9999"
echo "       - lower submit didn't overwrite"
echo "       - get_score returns the right fields end-to-end"

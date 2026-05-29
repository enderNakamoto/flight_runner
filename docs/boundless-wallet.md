# Boundless wallet

The single Ethereum-style wallet our relay uses to pay for proofs on the
Boundless marketplace. EVM addresses are chain-agnostic, so the *same*
address works on Ethereum Sepolia, Base Sepolia, Base Mainnet, and
Ethereum Mainnet — but each chain has its own balance.

## Address

```
0x39376678470aB5Cf03A5D6723E04A069dC453aB0
```

**Public — safe to commit.** The private key lives only in:
- The operator's password manager (offline backup)
- `/etc/proofarcade.env` on the relay box (chmod 600), as `BOUNDLESS_PRIVATE_KEY=0x…`

The private key MUST NEVER be pasted into chat, committed to the repo, or
written to any plaintext file outside `/etc/proofarcade.env`.

## Funding by network

| Network | What | Faucet / source |
|---|---|---|
| Ethereum Sepolia | Sepolia ETH (free, testnet) | https://sepolia-faucet.pk910.de/ (PoW, in-browser) — backups: Alchemy, Infura faucets |
| Base Sepolia | Base Sepolia ETH (free, testnet) | https://docs.base.org/chain/network-faucets or bridge from Sepolia via testnet bridge |
| Base Mainnet | Real Base ETH (production) | Coinbase: buy ETH → withdraw, selecting "Base" network. Or bridge.base.org from Ethereum mainnet. For $10-scale instant transfers: Across (across.to) or Squid (app.squidrouter.com) from any other chain |
| Ethereum Mainnet | Real ETH | Not the primary Boundless deployment — only relevant for the ZKC token contract |

## Cost expectations

- Per proof: **$0.05–$0.16** (observed Base Mainnet fills, May 2026, per explorer.boundless.network)
- Network median: $0.15 per billion cycles. Our birdstrike proofs are sub-Mcycle so we hit the practical floor (~$0.05).
- Sepolia gas for `submitRequest`: a few thousand gwei, negligible from a 1.5 ETH faucet balance
- Base Mainnet: $10 starting balance covers ~200 proofs of headroom

## Balance check

```bash
ADDR=0x39376678470aB5Cf03A5D6723E04A069dC453aB0
for NAME_RPC in \
  "Base-Mainnet=https://mainnet.base.org" \
  "Base-Sepolia=https://sepolia.base.org" \
  "Ethereum-Sepolia=https://ethereum-sepolia-rpc.publicnode.com" \
  "Ethereum-Mainnet=https://ethereum-rpc.publicnode.com"; do
  NAME="${NAME_RPC%%=*}"; RPC="${NAME_RPC##*=}"
  BAL=$(curl -s -X POST -H "Content-Type: application/json" \
    --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ADDR\",\"latest\"],\"id\":1}" \
    "$RPC" | jq -r '.result')
  echo "$NAME: $(python3 -c "print(f'{int(\"$BAL\",16)/1e18:.6f} ETH')")"
done
```

## Rotation

If the private key is ever suspected leaked (e.g., box compromise, chat
paste, screen share):

1. Generate a fresh keypair on a clean machine: `cast wallet new`
2. Update `/etc/proofarcade.env` on the relay box with the new private key
3. `systemctl restart proofarcade-relay`
4. Drain remaining balance from the old address to the new one (single
   transfer; testnet ETH is fine to abandon if cost outweighs the value)
5. Replace this address in `docs/boundless-wallet.md` and re-commit
6. Document the rotation in `progress.md` Notes

## Rotation history

- **2026-05-29** — initial throwaway wallet `0xc058e6DD105A14a453a8440350041Cc476C0C7e3` used for testnet validation (private key + JWT both pasted in chat during Phase 12 bring-up; testnet funds only, abandoned at rotation). Rotated to current address before first Base Mainnet funding to ensure no chat-history leak ever touches real money.

# Deploy guide — Phase 11 (production)

Three pieces of infrastructure, three providers, one domain:

| Piece                      | Provider          | Hostname                  |
|----------------------------|-------------------|---------------------------|
| Static frontend (Vite SPA) | Vercel            | `proofarcade.xyz`         |
| Relay + prover             | Vultr (HFC 4C/16GB) | `relay.proofarcade.xyz` |
| Leaderboard snapshot cron  | GitHub Actions    | (commits to `main` hourly)|

Domain (`proofarcade.xyz`) is registered at Namecheap. TLS is handled
by Vercel for the frontend and by Caddy on the Vultr box for the relay.

> **Phase 10 footnote:** the relay originally lived on Fly.io. Fly
> Machines run on Firecracker microVMs whose stripped kernel can't host
> nested Docker, so the RISC Zero Groth16 wrap (`docker run
> risczero/risc0-groth16-prover`) failed with `os error 2`. The deploy
> moved to a Vultr High-Frequency Compute instance in Phase 11. The
> archived `Dockerfile`, `fly.toml`, and `.dockerignore` live under
> `archive/` for reference.

---

## 1. Vultr — relay + prover

Full provisioning runbook: `spec/phase-11-runbook.md`. Operator notes
(SSH, logs, upgrades, teardown): `vultr/README.md`.

Quick summary of the live setup:

- Ubuntu 24.04, `vhf-4c-16gb` plan, US datacenter
- `cloud-init.yml` bootstraps Docker, Bun, Rust + rzup, Caddy
- `flight-host` built natively on the box (`cargo build --release`)
- `services/server/` runs as a systemd unit (`proofarcade-relay.service`)
- Caddy reverse-proxies `relay.proofarcade.xyz` → `localhost:8080`
  and auto-issues a Let's Encrypt cert
- Runtime env in `/etc/proofarcade.env` (chmod 600), incl.
  `PROVE_MODE=groth16`, `VERIFIER_SELECTOR_HEX=73c457ba`,
  `GITHUB_DISPATCH_TOKEN=…`, `CORS_ORIGIN=https://proofarcade.xyz`

To verify the relay is up:

```bash
curl https://relay.proofarcade.xyz/health
```

---

## 2. Vercel — static frontend

The build config lives in `vercel.json` at the repo root. SPA fallback
is a regex rewrite that matches paths without a dot, so real assets
(`*.png`, `*.json`, `*.svg`, `*.js`) are served as files and SPA routes
fall through to `index.html`.

```bash
# Install Vercel CLI once.
npm i -g vercel
vercel login

# From repo root, link or create the project:
vercel link

# Set env vars (production):
vercel env add VITE_GAME_HUB_CONTRACT_ID production
# paste: CALPEUANXSCROTCZCTSGP6HKRPF5HE5W43JUWQG6ZRIWMRLANAU2N6YO

vercel env add VITE_STELLAR_RPC_URL production
# paste: https://soroban-testnet.stellar.org

vercel env add VITE_STELLAR_NETWORK_PASSPHRASE production
# paste: Test SDF Network ; September 2015

vercel env add VITE_RELAY_URL production
# paste: https://relay.proofarcade.xyz

vercel env add VITE_PRODUCTION_URL production
# paste: https://proofarcade.xyz

# First deploy:
vercel --prod
```

Then in the Vercel dashboard → Project → Settings → Domains, add
`proofarcade.xyz` (and `www.proofarcade.xyz` for the redirect). Vercel
prints the DNS records to add at Namecheap.

After this, every push to `main` triggers an auto-deploy (including the
hourly leaderboard commits from GitHub Actions).

---

## 3. Namecheap — DNS records

Log in → Domain List → **Manage** on `proofarcade.xyz` → **Advanced DNS**.

| Type   | Host    | Value                              | Notes                       |
|--------|---------|------------------------------------|-----------------------------|
| `A`    | `@`     | `76.76.21.21`                      | Vercel apex (their docs)    |
| `CNAME`| `www`   | `cname.vercel-dns.com.`            | Vercel www subdomain        |
| `A`    | `relay` | `<vultr-main-ip>`                  | Vultr relay box             |

TTL: leave as Automatic (60 s during initial cutover, 30 min later).

Cert issuance happens automatically on both sides ~1–5 min after DNS
propagates. Verify:

```bash
curl -I https://proofarcade.xyz
curl -I https://relay.proofarcade.xyz/health
```

---

## 4. GitHub Actions — leaderboard cron

Nothing to set up to start — `.github/workflows/index-leaderboard.yml`
runs `*/5 * * * *` (every 5 min) on `main` against the testnet
contract. `permissions: contents: write` lets the default
`GITHUB_TOKEN` commit the refreshed JSON back to the repo. Each
commit triggers a Vercel deploy.

To trigger a refresh on demand: GitHub → Actions tab →
**leaderboard · refresh snapshot** → **Run workflow**.

### Real-time refresh after a submission (optional but recommended)

The workflow also accepts a `repository_dispatch` event with
`event_type: refresh-leaderboard`. The relay sends one of these every
time a player settles a score, so other viewers see the new entry in
~30 s instead of waiting up to 5 min for the next cron tick.

**One-time setup — create a fine-grained PAT:**

1. Open https://github.com/settings/personal-access-tokens
2. **Generate new token** → name `proofarcade-dispatch`
3. **Resource owner**: your user, **Repository access**: only the arcade repo
4. **Repository permissions** → **Actions** → **Read and write**
5. Generate, copy the `github_pat_...` value
6. Set on the Vultr box — add to `/etc/proofarcade.env`:

   ```
   GITHUB_DISPATCH_TOKEN=github_pat_xxx
   ```

   Then `systemctl restart proofarcade-relay`.

7. (Optional override if your repo isn't the default
   `enderNakamoto/flight_runner`) — add `GITHUB_REPO=owner/repo` to the
   same env file.

The relay endpoint `POST /api/refresh-leaderboard` accepts a request,
debounces successive calls within `REFRESH_DEBOUNCE_SECONDS` (default
20 s), and POSTs the dispatch to GitHub. If `GITHUB_DISPATCH_TOKEN`
isn't set, the endpoint returns 503 and the cron is the only refresh
path — that's a fine fallback.

---

## 5. Smoke test

After all three pieces are live:

```bash
# Frontend reachable + serves the SPA index
curl -s https://proofarcade.xyz | grep -c "PROOFWORKS"

# Relay reachable + healthy
curl -s https://relay.proofarcade.xyz/health

# Leaderboard JSON reachable (served by Vercel from public/leaderboard/)
curl -s https://proofarcade.xyz/leaderboard/birdstrike.json | jq '.player_count'

# Manual indexer trigger from Actions tab, then ~30 s later:
curl -s https://proofarcade.xyz/leaderboard/birdstrike.json | jq '.generated_at'
```

Then play a run on `https://proofarcade.xyz/birdstrike`, hit Submit
Score, sign the tx, and watch for the `pb` event on the relay logs
(`ssh root@<vultr-ip> 'journalctl -u proofarcade-relay -f'`) + the next
hourly snapshot picking up the new entry.

---

## Cost recap

| Item                          | Free / paid                       |
|-------------------------------|-----------------------------------|
| Namecheap domain              | ~$10–15/yr (already bought)       |
| Vercel hobby tier             | Free                              |
| Vultr HFC 4C/16GB             | ~$96/mo flat (384 GB NVMe, 5 TB BW) |
| GitHub Actions cron           | Free for public repos             |
| Soroban testnet RPC           | Free                              |
| **Total**                     | **~$96/mo + domain renewal**      |

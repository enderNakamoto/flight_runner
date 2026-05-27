# Deploy guide — Phase 10 (production)

Three pieces of infrastructure, three providers, one domain:

| Piece                      | Provider          | Hostname                  |
|----------------------------|-------------------|---------------------------|
| Static frontend (Vite SPA) | Vercel            | `proofarcade.xyz`         |
| Relay + prover             | Fly.io            | `relay.proofarcade.xyz`   |
| Leaderboard snapshot cron  | GitHub Actions    | (commits to `main` hourly)|

Domain (`proofarcade.xyz`) is registered at Namecheap. TLS is handled
automatically by both Vercel and Fly when you point a custom hostname
at them.

---

## 1. Fly — relay + prover

The relay and `flight-host` ship as a single image (see `Dockerfile`)
to keep v1 deploy simple. Single Machine, auto-stop, 2 GB / 1 dedicated
CPU. Bump to 16 GB when flipping `PROVE_MODE` to `groth16` later.

```bash
# Install flyctl once.
brew install flyctl
fly auth login

# From repo root:
fly launch --copy-config --name proofarcade-relay --region iad --no-deploy
fly deploy

# Wire the custom hostname.
fly certs add relay.proofarcade.xyz
# flyctl prints two DNS records (A + AAAA, or a CNAME) — paste them
# into Namecheap (see §3 below).

# Confirm:
fly status
fly logs               # tail
curl https://proofarcade-relay.fly.dev/health
```

Default env is set in `fly.toml` for `PROVE_MODE=stub` +
`CORS_ORIGIN=https://proofarcade.xyz`. To override:

```bash
fly secrets set PROVE_MODE=groth16
fly secrets set CORS_ORIGIN="https://proofarcade.xyz,https://staging.proofarcade.xyz"
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
# accept the defaults — Vercel reads vercel.json for build config.

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

# VITE_TWITTER_HANDLE defaults to "sentinel_fi" in code — only set if you
# want to override.

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

Add the following records (Vercel + Fly each print exact values
after `vercel domains add` / `fly certs add`):

| Type   | Host    | Value                                       | Notes                       |
|--------|---------|---------------------------------------------|-----------------------------|
| `A`    | `@`     | `76.76.21.21`                               | Vercel apex (their docs)    |
| `CNAME`| `www`   | `cname.vercel-dns.com.`                     | Vercel www subdomain        |
| `CNAME`| `relay` | `proofarcade-relay.fly.dev.`                | Fly relay subdomain         |

TTL: leave as Automatic (60s during initial cutover, 30 min later).

Cert issuance happens automatically on both sides ~1–5 min after DNS
propagates. Verify:

```bash
curl -I https://proofarcade.xyz
curl -I https://relay.proofarcade.xyz/health
```

---

## 4. GitHub Actions — leaderboard cron

Nothing to set up — `.github/workflows/index-leaderboard.yml` runs
hourly on `main` against the testnet contract. `permissions:
contents: write` lets the default `GITHUB_TOKEN` commit the refreshed
JSON back to the repo. Each commit triggers a Vercel deploy
(within hobby-tier deploy limits).

To trigger a refresh on demand: GitHub → Actions tab →
**leaderboard · refresh snapshot** → **Run workflow**.

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
(`fly logs --app proofarcade-relay`) + the next hourly snapshot
picking up the new entry.

---

## Cost recap

| Item                          | Free / paid                       |
|-------------------------------|-----------------------------------|
| Namecheap domain              | ~$10–15/yr (already bought)       |
| Vercel hobby tier             | Free                              |
| Fly.io Machine (auto-stop)    | ~$0–5/mo at launch volume         |
| GitHub Actions cron           | Free for public repos             |
| Soroban testnet RPC           | Free                              |
| **Total**                     | **~$0–5/mo + domain renewal**     |

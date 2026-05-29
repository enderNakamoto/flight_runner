# Phase 11 — Vultr migration + real Groth16 cutover

**Self-contained runbook.** A fresh Claude session should be able to read this file plus `spec/phases.md` Phase 11 plus the deploy-target memory file and pick up exactly where the previous session left off.

## Goal

Move the relay + prover off Fly.io (Firecracker microVM, can't run nested Docker) onto a **Vultr High Frequency Compute 4C/16GB** instance in a US datacenter. Flip `PROVE_MODE` from `stub` to `groth16`, validate the wrapped seal against Nethermind's deployed verifier, then swap `MockVerifier` → real verifier on chain. End state: no mocks anywhere; every score is genuinely cryptographically verified.

## State of play (as of restart)

What's already live:
- **Vercel frontend** at `https://proofarcade.xyz` — Vite SPA, no changes needed.
- **Fly relay** at `https://relay.proofarcade.xyz` running `PROVE_MODE=stub`. Has two Machines (shared-cpu-1x / 1 GB). Held secrets: `GITHUB_DISPATCH_TOKEN`, `VERIFIER_SELECTOR_HEX=73c457ba`, `PROVE_MODE=stub`, `CORS_ORIGIN=https://proofarcade.xyz`.
- **GitHub Actions cron** every 5 min, fires `repository_dispatch` on every submit. Working.
- **Soroban contracts on testnet:**
  - `game_hub` at `CDCYHA36MQRFM4J25B3EQKIWM27E3DUW6W3W6FLWJD7T7ZVNBVAUSMYW` — has `set_verifier` admin function ready
  - `mock_verifier` at `CASE6UNHD2DXQCRHWQHW7M44QNV2KV2ZLNL2M2VIHU3ZCR4XBI7QE2ZG` — currently used
  - **target verifier** (Nethermind's deployed Groth16 verifier): `CDUDXCLMNE7Q4BZJLLB3KACFOS55SS55GSQW2UYHDUXTJKZUDDAJYCIH` — selector `73c457ba`, version 3.0.0
- **Birdstrike registered** as `game_id=1` with `image_id=2ad4ffd3a1945a88038a03132da980c0a1141f00d83efe2741eafafd2e53c6d8`.

What's blocked: real Groth16 wrap fails on Fly with `prove_with_opts: No such file or directory (os error 2)` — risc0-zkvm shells out to `docker run risczero/risc0-groth16-prover`, Fly Machines have no docker binary, can't install one reliably.

## Prerequisites the user must have ready

Before resuming, the user has:
- Vultr account: `ender.nakamoto@gmail.com` Personal Org
- Vultr Personal Access Token from https://my.vultr.com/settings/#settingsapi
- SSH keypair, public half already registered with Vultr (under whatever Name they chose)
- Local `vultr` CLI installed at `/opt/homebrew/bin/vultr` (Homebrew formula `vultr`, version 3.10.0+)

## Handoff: how to share the Vultr API token without leaking it in chat

**Recommended (file-based, never enters chat history):**

User runs in their own Terminal:
```bash
echo "export VULTR_API_KEY=<paste-real-token>" > ~/.vultr-env
chmod 600 ~/.vultr-env
```

Then in Claude chat: `! source ~/.vultr-env`

After Phase 11 ends: `! rm ~/.vultr-env`.

**Fallback (paste-and-rotate):**

User pastes `! export VULTR_API_KEY=<token>` directly. Token appears in chat history. After Phase 11 ends, they regenerate the token in Vultr dashboard, which revokes the exposed one.

Smoke test once exported: `vultr account info` should return JSON, not auth error.

---

## Part A — Code improvements before provisioning (no chain action)

Three small things to lift from typezero's hardening that we noticed during code review. All pure-code, no infra impact. Bundle as one commit.

### A1. Startup validation of `VERIFIER_SELECTOR_HEX`

Currently we validate only at request time inside `submit.ts`. Move to startup.

**File:** `services/server/src/config.ts`

After the `verifierSelectorHex` line, add:

```ts
if (CONFIG.verifierSelectorHex) {
  const sel = CONFIG.verifierSelectorHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{8}$/.test(sel)) {
    throw new Error(
      `VERIFIER_SELECTOR_HEX must be exactly 4 bytes (8 hex chars), got: ${CONFIG.verifierSelectorHex}`,
    );
  }
}
```

### A2. Max seal size sanity guard

If `PROVE_MODE=groth16` and the seal isn't exactly 260 bytes, the prover is misconfigured. Reject before returning to the browser.

**File:** `services/server/src/submit.ts`

After the existing `sealHex.length === 520` strip-and-prepend logic, add:

```ts
const sealBytes = sealHex.length / 2;
if (CONFIG.proveMode === "groth16" && sealBytes !== 260) {
  return jsonError(500, `groth16 seal must be exactly 260 bytes, got ${sealBytes} — prover misconfigured`);
}
```

### A3. Files to scaffold

Create the following (all reference the same Vultr cloud-init / systemd / Caddy stack):

- `vultr/cloud-init.yml` — full first-boot bootstrap (see Part C template below)
- `vultr/Caddyfile` — TLS reverse-proxy config
- `vultr/proofarcade-relay.service` — systemd unit
- `vultr/README.md` — operational doc (provision a fresh box, tear it down, SSH in)

Templates are in **Part F** of this file.

Delete or move to `archive/`:
- `Dockerfile` — no longer the deploy target (Vultr builds natively)
- `fly.toml` — no longer used
- `.dockerignore` — no longer needed

Update `DEPLOY.md` to remove Fly sections, add Vultr provisioning summary that points at `vultr/README.md`.

### Commit A

One commit titled something like:

> phase 11: code prep + Vultr scaffolds — startup selector validation, seal size guard, cloud-init / Caddyfile / systemd templates

**Do not push yet** — push after Part B's provisioning succeeds so we don't have orphaned scaffolding if Vultr signup is broken.

---

## Part B — Provisioning (chain action: real Vultr server, real cost)

### B1. Confirm auth works

```bash
vultr account info
```

If this errors with auth, the `VULTR_API_KEY` env isn't set in this shell — re-do the handoff section above.

### B2. Confirm the SSH key is registered

```bash
vultr ssh-key list -o json
```

User registered a key via the web UI. Note its `id` — we'll pass it to `instance create`. If multiple keys exist, identify which one matches `cat ~/.ssh/proofarcade_prover.pub` (or whichever key the user used).

### B3. Choose region and plan

- **Region:** Atlanta (`atl`) — well-connected US East, lower fees than NYC for some classes. Alternative: `ewr` (NYC) for shorter trans-Atlantic.
- **Plan:** `vhf-4c-16gb` — Vultr High Frequency Compute 4 vCPU / 16 GB / 128 GB NVMe, ~$48/mo.
- **OS:** Ubuntu 24.04 LTS — `vultr os list | grep -i 'ubuntu 24'` to find the OS id.

### B4. Provision

```bash
vultr instance create \
    --region atl \
    --plan vhf-4c-16gb \
    --os <ubuntu-24-04-os-id> \
    --label proofarcade-prover \
    --hostname proofarcade-prover \
    --ssh-keys <ssh-key-id-from-B2> \
    --user-data "$(base64 -i vultr/cloud-init.yml)" \
    --enable-ipv4=true \
    --enable-ipv6=true \
    -o json
```

(Verify the exact flag names with `vultr instance create --help` before running — Vultr CLI flag conventions occasionally shift between versions.)

Returns instance metadata including `main_ip`. Save it; we need it for DNS later.

### B5. Wait for cloud-init to finish

```bash
vultr instance get <instance-id>     # poll until status=active
ssh -o StrictHostKeyChecking=accept-new root@<main_ip> 'cloud-init status --wait'
```

cloud-init typically takes 8–12 minutes (Docker pull, Rust toolchain, rzup, Bun install). It's done when `cloud-init status` returns `done`.

### B6. Smoke-test the box

```bash
ssh root@<main_ip> 'docker run --rm hello-world'                            # confirms Docker works
ssh root@<main_ip> 'bun --version'                                          # confirms Bun installed
ssh root@<main_ip> 'cargo --version && rustc --version'                     # Rust toolchain
ssh root@<main_ip> 'ls /root/.risc0/bin'                                    # r0vm installed
ssh root@<main_ip> 'systemctl status caddy proofarcade-relay'               # both should be active
ssh root@<main_ip> 'curl -s http://localhost:8080/health'                   # relay reachable internally
```

If any of these fail, inspect cloud-init output: `ssh root@<main_ip> 'cat /var/log/cloud-init-output.log | tail -50'`.

### B7. Build flight-host (slow step)

cloud-init clones the repo but does NOT build `flight-host` (that takes ~15 min and would hold up cloud-init's completion signal). Trigger it manually:

```bash
ssh root@<main_ip> '
    cd /opt/proofarcade
    cargo build --release --bin flight-host 2>&1 | tail -20
'
```

Expect ~15 min on first build (RISC Zero pulls a lot). Subsequent builds are layer-cached and complete in ~30 s.

Verify the binary works:

```bash
ssh root@<main_ip> '/opt/proofarcade/target/release/flight-host --help | head -10'
```

### B8. Set runtime env on the box

Edit `/etc/proofarcade.env` over SSH:

```
FLIGHT_HOST_BIN=/opt/proofarcade/target/release/flight-host
PROVE_MODE=groth16
VERIFIER_SELECTOR_HEX=73c457ba
CORS_ORIGIN=https://proofarcade.xyz
GITHUB_DISPATCH_TOKEN=<paste-the-PAT-we-set-on-Fly>
GITHUB_REPO=enderNakamoto/flight_runner
REFRESH_DEBOUNCE_SECONDS=20
SUBMIT_COOLDOWN_SECONDS=60
PORT=8080
```

The `GITHUB_DISPATCH_TOKEN` value should be copied from Fly secrets first:

```bash
fly secrets list --app proofarcade-relay        # confirm GITHUB_DISPATCH_TOKEN is set
# Fly won't print the value; user supplies it from their original token-storage location,
# OR generates a new fine-grained PAT and overwrites both Fly and Vultr.
```

After saving the file, restart the relay:

```bash
ssh root@<main_ip> 'systemctl restart proofarcade-relay && journalctl -u proofarcade-relay --since "10 seconds ago" | tail -20'
```

Should see `[relay] listening on http://localhost:8080`.

---

## Part C — Cutover (DNS + chain admin tx)

### C1. Smoke test at Caddy's auto-TLS endpoint

While DNS still points at Fly, hit the box at its IP through Caddy:

```bash
curl --resolve relay.proofarcade.xyz:443:<main_ip> https://relay.proofarcade.xyz/health
```

Should return `{"ok":true,"role":"prover"}`. The `--resolve` flag bypasses DNS so we hit the Vultr box directly using the hostname Caddy serves.

### C2. DNS cutover

User updates Namecheap DNS:
- Log in at https://ap.www.namecheap.com/
- Domain List → Manage on `proofarcade.xyz` → Advanced DNS
- Find the `relay` A record currently pointing at Fly's IP (`66.241.124.100`)
- Change Value to `<main_ip>` from Vultr
- Leave AAAA `relay → 2a09:8280:1::11c:15d0:0` for now (Fly IPv6) or remove if we want clean cutover
- Save (TTL is Automatic / 60 s)

Wait ~5 min for propagation:

```bash
dig relay.proofarcade.xyz +short          # should return <main_ip>, not Fly's
```

### C3. TLS cert issuance

Caddy auto-requests a Let's Encrypt cert as soon as DNS resolves the hostname to the Vultr box. ~30 s after DNS propagates:

```bash
curl -sI https://relay.proofarcade.xyz/health
curl -s https://relay.proofarcade.xyz/health
```

Expect HTTP/2 200 + JSON body. If Caddy hasn't issued yet, wait another 30 s.

### C4. First real proof end-to-end

User opens https://proofarcade.xyz/birdstrike, plays a fresh run, hits Submit Score. Frontend POSTs to `https://relay.proofarcade.xyz/api/prove` (which is now Vultr).

While they're submitting:

```bash
ssh root@<main_ip> 'journalctl -u proofarcade-relay -f'    # tail the relay logs
```

Expected timeline:
- `[relay] proving for G…` immediately
- `[host] mode = groth16` from flight-host stderr
- `[host] proving …`
- Quiet for ~6 min (STARK)
- Docker pulls the snark-wrap image on first run (~3 min, only once — cached after)
- Quiet for ~6 min (wrap)
- `[relay] ✅ proved score=N for G… (seal 260 bytes)` — total ~12–15 min
- Browser shows wallet pop-up, user signs, tx lands

If wrap errors: most likely `docker pull` issue or rapidsnark missing. Inspect with `ssh root@<main_ip> 'docker images && docker ps -a'`.

### C5. Off-chain verify (sanity check before cutover)

This is the **trust-but-verify** step. MockVerifier accepted the seal, but did it actually verify mathematically?

After the real proof completes, capture the seal + journal + image_id from the relay log (or from the browser's submit_score transaction). Then call Nethermind's verifier directly:

```bash
stellar contract invoke \
    --id CDUDXCLMNE7Q4BZJLLB3KACFOS55SS55GSQW2UYHDUXTJKZUDDAJYCIH \
    --source flight-deployer-testnet \
    --network testnet \
    -- verify \
    --seal <seal-hex> \
    --image_id <image-id-hex> \
    --journal <journal-digest-hex>
```

If returns `null` (no panic): the proof is real cryptography. Proceed to C6.
If panics with anything: STOP, do not cutover. Debug the wrap.

### C6. Verifier cutover — admin tx

Single Soroban call:

```bash
stellar contract invoke \
    --id CDCYHA36MQRFM4J25B3EQKIWM27E3DUW6W3W6FLWJD7T7ZVNBVAUSMYW \
    --source flight-deployer-testnet \
    --network testnet \
    -- set_verifier \
    --new_verifier CDUDXCLMNE7Q4BZJLLB3KACFOS55SS55GSQW2UYHDUXTJKZUDDAJYCIH
```

Confirm the swap landed:

```bash
stellar contract invoke \
    --id CDCYHA36MQRFM4J25B3EQKIWM27E3DUW6W3W6FLWJD7T7ZVNBVAUSMYW \
    --source flight-deployer-testnet \
    --network testnet \
    -- get_verifier
```

Should return `"CDUDXCLMNE7Q4BZJLLB3KACFOS55SS55GSQW2UYHDUXTJKZUDDAJYCIH"`.

### C7. Validate post-cutover submission

Have the user play ONE more run and submit. The submit_score tx now must verify against the real verifier. If it panics with `ProofVerificationFailed`, something between flight-host's output and the verifier's expectation is off — debug the seal byte-by-byte. If it lands cleanly: real ZK end-to-end, no mocks anywhere. 🎉

---

## Part D — Decommission Fly (after 24h of clean Vultr operation)

Don't tear down Fly immediately. Leave it as a fallback for 24h in case Vultr surfaces an issue. During those 24h, the DNS points at Vultr; Fly is idle but billed.

After 24h of clean operation:

```bash
# Final logs archive
fly logs --app proofarcade-relay --no-tail > /tmp/fly-final-logs.txt

# Destroy
fly apps destroy proofarcade-relay --yes
fly apps list   # should not contain proofarcade-relay
```

Fly billing stops immediately on destroy.

### Repo cleanup commit

Final commit that lands the file restructure:
- Move `Dockerfile`, `.dockerignore`, `fly.toml` → `archive/` (or delete)
- `DEPLOY.md` already updated in commit A
- `progress.md` flip Phase 11 to **done**, advance current pointer to Phase 12
- Memory file `project_prover_deploy_target.md` already correct (mentions Vultr)

---

## Part E — Risk mitigation / what could go wrong

| Failure | Likely cause | Recovery |
|---|---|---|
| `vultr account info` fails | API token wrong scope or expired | Regenerate in Vultr dashboard, re-export |
| cloud-init never reaches `done` | Slow Docker image pull (10 GB image) | Wait longer; check `/var/log/cloud-init-output.log` |
| `cargo build` fails on first try | Missing system dep (clang, cmake) | Add `apt install`s to cloud-init; rebuild |
| Caddy can't get a cert | DNS hasn't propagated yet | Wait 5 min; `dig relay.proofarcade.xyz` to confirm |
| Wrap errors with `docker: not found` | Docker install failed in cloud-init | SSH in, `apt install docker.io`, retry |
| Wrap errors with OOM | shouldn't happen on 16 GB but possible | Bump to vhf-8c-32gb (~$96/mo) |
| Off-chain verify panics | Seal selector mismatch, or wrap produced wrong bytes | Inspect first 4 bytes of seal; should be `73 c4 57 ba`. Compare against typezero's working setup. |
| set_verifier landed but submits still fail | Browser bundle cached old contract config | Hard-refresh; Vercel may need rebuild (push a noop commit) |
| Fly app billed forever | We forgot to destroy | Set a calendar reminder; `fly apps destroy` is the kill switch |

---

## Part F — File templates

These get committed in Part A so they're tracked. Their content drives Part B's provisioning.

### `vultr/cloud-init.yml`

```yaml
#cloud-config
# Phase 11 — Vultr prover bootstrap.
# Runs on first boot of a fresh Ubuntu 24.04 Vultr instance.
# Installs Docker + Bun + Rust + rzup + Caddy, clones the repo,
# wires systemd. Does NOT build flight-host (15 min) — that's manual.

package_update: true
package_upgrade: true

packages:
  - curl
  - git
  - build-essential
  - pkg-config
  - libssl-dev
  - ca-certificates
  - jq
  - clang
  - cmake
  - unzip

runcmd:
  # ── Docker ───────────────────────────────────────────────────────────
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable --now docker
  - docker pull risczero/risc0-groth16-prover:v3.0  # warm cache (~10 GB)
  
  # ── Bun ──────────────────────────────────────────────────────────────
  - curl -fsSL https://bun.sh/install | bash
  - ln -s /root/.bun/bin/bun /usr/local/bin/bun
  
  # ── Rust + rzup ──────────────────────────────────────────────────────
  - curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  - bash -c 'source /root/.cargo/env && rustup default stable'
  - curl -L https://risczero.com/install | bash
  - bash -c 'PATH=/root/.risc0/bin:$PATH rzup install rust'
  - bash -c 'PATH=/root/.risc0/bin:$PATH rzup install cargo-risczero'
  - bash -c 'PATH=/root/.risc0/bin:$PATH rzup install r0vm'
  
  # ── Repo ─────────────────────────────────────────────────────────────
  - git clone https://github.com/enderNakamoto/flight_runner.git /opt/proofarcade
  - cd /opt/proofarcade && bun install --cwd services/server --production
  
  # ── Caddy ────────────────────────────────────────────────────────────
  - apt install -y debian-keyring debian-archive-keyring apt-transport-https
  - curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  - curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  - apt update && apt install -y caddy
  - cp /opt/proofarcade/vultr/Caddyfile /etc/caddy/Caddyfile
  - systemctl restart caddy
  
  # ── systemd unit ─────────────────────────────────────────────────────
  - cp /opt/proofarcade/vultr/proofarcade-relay.service /etc/systemd/system/
  - touch /etc/proofarcade.env
  - chmod 600 /etc/proofarcade.env
  - systemctl daemon-reload
  - systemctl enable proofarcade-relay
  # NOT starting it yet — env vars need to be set first (manual step B8)
  
  # ── Firewall ─────────────────────────────────────────────────────────
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable

final_message: |
  Phase 11 cloud-init complete. Next steps:
    1. ssh root@<this-box> and verify with smoke tests in runbook §B6
    2. cd /opt/proofarcade && cargo build --release --bin flight-host (~15 min)
    3. Populate /etc/proofarcade.env per runbook §B8
    4. systemctl start proofarcade-relay
```

### `vultr/Caddyfile`

```caddy
# Phase 11 — TLS reverse-proxy for the Bun relay.
# Caddy auto-issues a Let's Encrypt cert the moment relay.proofarcade.xyz
# resolves to this box. ACME challenge happens on port 80 → 443 redirect
# is automatic.

relay.proofarcade.xyz {
    reverse_proxy localhost:8080 {
        header_up X-Real-IP {remote_host}
        flush_interval -1   # important: prove requests can take 15 min;
                            # never close mid-stream
    }
    
    encode gzip
    
    log {
        output file /var/log/caddy/relay.log
        format json
    }
}
```

### `vultr/proofarcade-relay.service`

```ini
[Unit]
Description=Proofworks Arcade relay + prover (Bun)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/proofarcade/services/server
EnvironmentFile=/etc/proofarcade.env
ExecStart=/usr/local/bin/bun src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=proofarcade-relay

# No timeouts — a real Groth16 wrap can take 25 min mid-request.
TimeoutStopSec=600

[Install]
WantedBy=multi-user.target
```

### `vultr/README.md`

(Brief operator-facing doc covering: how to re-provision from scratch, how to SSH in, how to view logs, how to upgrade flight-host, how to tear down. ~50 lines.)

---

## Part G — When to call this done

Phase 11 is **done** when **all** of the following are true:

- [ ] Vultr box is up, serving `https://relay.proofarcade.xyz` with a valid Let's Encrypt cert
- [ ] `vultr instance list` shows it as `active`
- [ ] `systemctl status proofarcade-relay caddy` both report `active (running)`
- [ ] A real Groth16 proof has completed end-to-end through the box (relay logs show `[relay] ✅ proved` with `seal 260 bytes`)
- [ ] Off-chain verify against Nethermind's verifier returned `null` (success)
- [ ] `game_hub.get_verifier` returns `CDUDXCLMNE7Q4BZJLLB3KACFOS55SS55GSQW2UYHDUXTJKZUDDAJYCIH` (the cutover landed)
- [ ] At least one post-cutover submit_score landed cleanly
- [ ] Fly app destroyed: `fly apps list` no longer contains `proofarcade-relay`
- [ ] `progress.md` Phase 11 row marked **done**, current pointer flipped to Phase 12

---

## Part H — First message the next session should send

After the user `! source ~/.vultr-env` (or equivalent), the new session should:

1. Read this file: `cat spec/phase-11-runbook.md`
2. Read the memory file: `cat ~/.claude/projects/*/memory/project_prover_deploy_target.md`
3. Read `spec/phases.md` Phase 11 section
4. Confirm with user: "I see Phase 11 paused mid-runbook. Last commit was [hash]. Ready to start Part A (code prep), or did you complete some steps manually since?"
5. Proceed based on user's answer.

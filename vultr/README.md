# Vultr prover — operator guide

Production prover host for `relay.proofarcade.xyz`. Single Vultr
High-Frequency Compute 4C/16GB instance running Ubuntu 24.04 with
Docker, Bun, Rust/rzup, and Caddy. Replaces the previous Fly.io deploy
(Fly Machines can't run nested Docker, which RISC Zero's Groth16 wrap
requires).

See `spec/phase-11-runbook.md` for the full provisioning playbook.

## Re-provision from scratch

```bash
source ~/.vultr-env                # exports VULTR_API_KEY
vultr account info                 # sanity check
vultr ssh-key list -o json         # note the id you'll pass below

vultr instance create \
    --region atl \
    --plan vhf-4c-16gb \
    --os <ubuntu-24-04-os-id> \
    --label proofarcade-prover \
    --hostname proofarcade-prover \
    --ssh-keys <ssh-key-id> \
    --user-data "$(base64 -i vultr/cloud-init.yml)" \
    -o json
```

Wait for cloud-init: `ssh root@<main_ip> 'cloud-init status --wait'`
(~8–12 min). Then build flight-host:

```bash
ssh root@<main_ip> 'cd /opt/proofarcade && cargo build --release --bin flight-host'
```

~15 min on first build. Populate `/etc/proofarcade.env`:

```
FLIGHT_HOST_BIN=/opt/proofarcade/target/release/flight-host
PROVE_MODE=groth16
VERIFIER_SELECTOR_HEX=73c457ba
CORS_ORIGIN=https://proofarcade.xyz
GITHUB_DISPATCH_TOKEN=<fine-grained-PAT>
GITHUB_REPO=enderNakamoto/flight_runner
REFRESH_DEBOUNCE_SECONDS=20
SUBMIT_COOLDOWN_SECONDS=60
PORT=8080
```

Start: `systemctl start proofarcade-relay`.

## SSH

```bash
ssh -i ~/.ssh/proofarcade_prover root@<main_ip>
```

The SSH key is registered with Vultr under the name `proofarcade-prover`.

## View logs

```bash
ssh root@<main_ip> 'journalctl -u proofarcade-relay -f'        # relay
ssh root@<main_ip> 'journalctl -u caddy -f'                    # TLS / proxy
ssh root@<main_ip> 'tail -f /var/log/caddy/relay.log'          # access log
```

## Upgrade flight-host

```bash
ssh root@<main_ip> '
    cd /opt/proofarcade && \
    git pull && \
    cargo build --release --bin flight-host && \
    systemctl restart proofarcade-relay
'
```

Subsequent builds are layer-cached (~30 s).

## Tear down

```bash
vultr instance list -o json | jq '.instances[] | select(.label=="proofarcade-prover")'
vultr instance delete <instance-id>
```

DNS for `relay.proofarcade.xyz` must be repointed before deletion or
the relay becomes unreachable.

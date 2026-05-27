# syntax=docker/dockerfile:1.7
#
# Birdstrike relay + prover, single image. Stage 1 compiles `flight-host`
# (Rust + RISC Zero zkVM guest baked in via methods/build.rs). Stage 2 is
# a slim Bun runtime that runs services/server (the relay), shelling out
# to the prebuilt flight-host binary for each /api/prove request.
#
# Sized for v1 stub-mode deploys (~2 GB RAM is plenty). Bump the VM to
# 16 GB when flipping PROVE_MODE → groth16 so the snark-wrap step has
# room to run.

# ── Stage 1: build flight-host with the RISC Zero toolchain ───────────────
FROM rust:1.83-bookworm AS builder

# rzup needs curl + the usual C-build deps for the host-side cargo build.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates pkg-config libssl-dev clang cmake git build-essential \
    && rm -rf /var/lib/apt/lists/*

# rzup is RISC Zero's toolchain manager — installs the riscv32im-risc0-zkvm-elf
# Rust target + cargo-risczero, both of which methods/build.rs calls into via
# risc0-build::embed_methods() to produce FLIGHT_GUEST_ID + FLIGHT_GUEST_ELF.
RUN curl -L https://risczero.com/install | bash
ENV PATH="/root/.risc0/bin:${PATH}"
RUN rzup install rust && rzup install cargo-risczero

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY services/prover ./services/prover

# Cache cargo registry + target/ between builds via BuildKit cache mounts;
# initial build is ~10 min, subsequent layer-cached builds are ~1 min.
RUN --mount=type=cache,target=/build/target,sharing=locked \
    --mount=type=cache,target=/root/.cargo/registry,sharing=locked \
    cargo build --release --bin flight-host \
 && cp target/release/flight-host /usr/local/bin/flight-host

# ── Stage 2: Bun runtime + the built binary ───────────────────────────────
FROM oven/bun:1-debian AS runtime
WORKDIR /app

# flight-host depends on glibc + ssl, both already present in oven/bun:debian.
COPY --from=builder /usr/local/bin/flight-host /usr/local/bin/flight-host

# Relay sources + runtime deps. `bun install --production` skips devDeps.
COPY services/server ./services/server
RUN cd services/server && bun install --production

# Default env — Fly overrides what it cares about (PROVE_MODE, CORS_ORIGIN).
ENV FLIGHT_HOST_BIN=/usr/local/bin/flight-host \
    PROVE_MODE=stub \
    PORT=8080 \
    CORS_ORIGIN=https://proofarcade.xyz

EXPOSE 8080
WORKDIR /app/services/server
CMD ["bun", "src/index.ts"]

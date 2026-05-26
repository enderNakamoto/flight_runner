fn main() {
    // Compiles every crate listed in [package.metadata.risc0].methods against
    // the riscv32im-risc0-zkvm-elf target and writes constants to OUT_DIR.
    risc0_build::embed_methods();
}

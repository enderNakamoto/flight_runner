//! Re-exports the artifacts that `build.rs` produces from the guest ELF.
//!
//! For the `flight_guest` crate, risc0-build emits:
//!   - `FLIGHT_GUEST_ELF: &[u8]`     — the guest program bytes
//!   - `FLIGHT_GUEST_ID:  [u32; 8]`  — the 32-byte image ID used to verify
//!   - `FLIGHT_GUEST_PATH: &str`     — absolute path to the ELF on disk
//!
//! Host code does `use flight_methods::{FLIGHT_GUEST_ELF, FLIGHT_GUEST_ID};`.

include!(concat!(env!("OUT_DIR"), "/methods.rs"));

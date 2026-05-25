//! State serializer — mirror of `packages/sim/src/serialize.ts`.
//!
//! Little-endian throughout, all numeric fields are 4 bytes. Booleans and
//! small enums pack into u32s. Lists are prefixed by a u32 length.
//!
//! Same constants, same field order, same byte sizes as the TS version. Run
//! `serialize_state` on both sides for the same `GameState` and you get
//! identical Vec<u8>s — that's the foundation of the cross-language parity
//! test.

use crate::types::GameState;

pub const SER_HEADER_BYTES: usize = 15 * 4;
pub const SER_PILLAR_BYTES: usize = 16;
pub const SER_ENEMY_BYTES: usize = 32;
pub const SER_MISSILE_BYTES: usize = 20;
pub const SER_TOKEN_BYTES: usize = 12;

pub fn serialized_size(state: &GameState) -> usize {
    SER_HEADER_BYTES
        + 4 + state.pillars.len() * SER_PILLAR_BYTES
        + 4 + state.enemies.len() * SER_ENEMY_BYTES
        + 4 + state.missiles.len() * SER_MISSILE_BYTES
        + 4 + state.fuel_tokens.len() * SER_TOKEN_BYTES
}

#[inline]
fn w_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn w_i32(out: &mut Vec<u8>, v: i32) {
    out.extend_from_slice(&v.to_le_bytes());
}

pub fn serialize_state(state: &GameState) -> Vec<u8> {
    let mut out = Vec::with_capacity(serialized_size(state));

    // Header — 15 fixed-width fields, 60 bytes total.
    w_u32(&mut out, state.tick);
    w_u32(&mut out, state.score);
    let flags = (state.game_over as u32)
        | (((state.game_over_reason as u32) & 0xff) << 8)
        | (((state.stage as u32) & 0xff) << 16);
    w_u32(&mut out, flags);
    w_i32(&mut out, state.fuel);
    w_i32(&mut out, state.world_distance);
    w_i32(&mut out, state.next_pillar_distance);
    w_i32(&mut out, state.next_enemy_distance);
    w_i32(&mut out, state.next_fuel_distance);
    w_i32(&mut out, state.plane.y);
    w_i32(&mut out, state.plane.vy);
    w_u32(&mut out, state.rng.s as u32);
    w_u32(&mut out, state.next_pillar_id);
    w_u32(&mut out, state.next_enemy_id);
    w_u32(&mut out, state.next_missile_id);
    w_u32(&mut out, state.next_fuel_token_id);

    // Pillars.
    w_u32(&mut out, state.pillars.len() as u32);
    for p in &state.pillars {
        w_u32(&mut out, p.id);
        w_i32(&mut out, p.x);
        w_i32(&mut out, p.gap_y);
        w_u32(&mut out, p.passed as u32);
    }

    // Enemies.
    w_u32(&mut out, state.enemies.len() as u32);
    for e in &state.enemies {
        w_u32(&mut out, e.id);
        let kind_passed = ((e.kind as u32) & 0xff) | (((e.passed as u32) & 1) << 8);
        w_u32(&mut out, kind_passed);
        w_u32(&mut out, e.spawn_tick);
        w_u32(&mut out, e.next_fire_tick);
        w_i32(&mut out, e.x);
        w_i32(&mut out, e.y);
        w_i32(&mut out, e.vx);
        w_i32(&mut out, e.spawn_y);
    }

    // Missiles.
    w_u32(&mut out, state.missiles.len() as u32);
    for m in &state.missiles {
        w_u32(&mut out, m.id);
        let tier_frame = ((m.tier as u32) & 0xff) | (((m.frame as u32) & 0xff) << 8);
        w_u32(&mut out, tier_frame);
        w_i32(&mut out, m.x);
        w_i32(&mut out, m.y);
        w_i32(&mut out, m.vx);
    }

    // Fuel tokens.
    w_u32(&mut out, state.fuel_tokens.len() as u32);
    for t in &state.fuel_tokens {
        w_u32(&mut out, t.id);
        w_i32(&mut out, t.x);
        w_i32(&mut out, t.y);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stages::Stage;
    use crate::state::create_initial_state;

    /// TS reference hex strings — captured by running serializeState() on the
    /// same create_initial_state(seed, stage) on the TS side. Bit-identical
    /// match here is the first concrete cross-language parity check.
    fn assert_serialized_eq(seed: i32, stage: Stage, want_hex: &str) {
        let s = create_initial_state(seed, stage);
        let bytes = serialize_state(&s);
        let got_hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(got_hex, want_hex,
            "seed=0x{:08x} stage={:?}", seed as u32, stage);
    }

    #[test]
    fn size_of_empty_state_is_76() {
        // Header (60) + 4×4 length prefixes for pillars/enemies/missiles/tokens.
        let s = create_initial_state(0x12345678, Stage::Common);
        assert_eq!(serialized_size(&s), 76);
        assert_eq!(serialize_state(&s).len(), 76);
    }

    /// Reference vectors captured by running serializeState() on the TS
    /// `createInitialState(seed, stage)` for each combination. If any byte
    /// drifts we'll know exactly which field (offset within the 76-byte
    /// layout) regressed. Every byte here was produced by the TS sim, NOT
    /// hand-calculated — that's the point of cross-language parity.
    #[test]
    fn initial_common_seed_default() {
        assert_serialized_eq(
            0x12345678,
            Stage::Common,
            "00000000000000000000000000640000000000000000000000000000000000000068010000000000785634120100000001000000010000000100000000000000000000000000000000000000",
        );
    }

    #[test]
    fn initial_rare_seed_default() {
        // Stage::Rare = 2 → flags byte sets stage at bit 16.
        assert_serialized_eq(
            0x12345678,
            Stage::Rare,
            "00000000000000000000020000640000000000000000000000000000000000000068010000000000785634120100000001000000010000000100000000000000000000000000000000000000",
        );
    }

    #[test]
    fn initial_common_negative_seed() {
        assert_serialized_eq(
            0xCAFEBABE_u32 as i32,
            Stage::Common,
            "00000000000000000000000000640000000000000000000000000000000000000068010000000000bebafeca0100000001000000010000000100000000000000000000000000000000000000",
        );
    }

    #[test]
    fn initial_common_real_corpus_seed() {
        assert_serialized_eq(
            0x5e570e03,
            Stage::Common,
            "00000000000000000000000000640000000000000000000000000000000000000068010000000000030e575e0100000001000000010000000100000000000000000000000000000000000000",
        );
    }
}

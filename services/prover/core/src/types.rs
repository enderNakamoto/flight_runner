//! Data shapes — mirror of `packages/sim/src/types.ts`.
//!
//! Positions / velocities / fuel / world-distance fields are Q24.8 i32 (see
//! `fp.rs`). Ids are u32 to match the TS serializer's wire layout. Enums
//! carry `#[repr(u8)]` so their discriminants line up with the TS const-enum
//! integer values — the serializer writes raw bytes for them.

use crate::prng::PrngState;

/// One bit per held key. Matches TS `PlayerInput.buttons`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct PlayerInput {
    pub buttons: u8,
}

pub const BTN_UP: u8 = 1 << 0;
pub const BTN_DOWN: u8 = 1 << 1;
pub const BTN_LEFT: u8 = 1 << 2;
pub const BTN_RIGHT: u8 = 1 << 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct PlaneState {
    pub y: i32,   // Q24.8 px
    pub vy: i32,  // Q24.8 px/tick
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pillar {
    pub id: u32,
    pub x: i32,        // Q24.8 px
    pub gap_y: i32,    // Q24.8 px — vertical centre of the gap
    pub passed: bool,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnemyKind {
    BirdSmall = 0,
    BirdBig = 1,
    Drone = 2,
    Jet = 3,
    Ufo = 4,
    BannerPlane = 5,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum GameOverReason {
    #[default]
    Unknown = 0,
    Bird = 1,
    Drone = 2,
    Jet = 3,
    Ufo = 4,
    Missile = 5,
    Pillar = 6,
    WorldTop = 7,
    WorldBottom = 8,
    FuelOut = 9,
    BannerPlane = 10,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Enemy {
    pub id: u32,
    pub kind: EnemyKind,
    pub x: i32,             // Q24.8 px
    pub y: i32,             // Q24.8 px
    pub vx: i32,            // Q24.8 px/tick — negative = moving left
    pub spawn_tick: u32,    // for UFO zigzag + fire cadence
    pub spawn_y: i32,       // Q24.8 px — anchor for UFO zigzag
    pub next_fire_tick: u32,
    pub passed: bool,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MissileTier {
    Common = 0,
    Uncommon = 1,
    Rare = 2,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Missile {
    pub id: u32,
    pub tier: MissileTier,
    pub frame: u8,    // index 0..11 into the missiles spritesheet
    pub x: i32,       // Q24.8 px
    pub y: i32,       // Q24.8 px
    pub vx: i32,      // Q24.8 px/tick
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FuelToken {
    pub id: u32,
    pub x: i32,   // Q24.8 px
    pub y: i32,   // Q24.8 px
}

/// Persistent game state. NOT serialized (per TS spec): `stage_just_changed`
/// is a render-only flag and `world_speed_mul` is deterministically derived
/// from the per-tick `PlayerInput`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameState {
    pub tick: u32,
    pub score: u32,
    pub game_over: bool,
    pub game_over_reason: GameOverReason,
    pub stage: u8,                  // index into STAGE_TABLE
    pub stage_just_changed: bool,   // transient
    pub fuel: i32,                  // Q24.8
    pub world_speed_mul: i32,       // Q24.8
    pub world_distance: i32,        // Q24.8
    pub next_pillar_distance: i32,  // Q24.8
    pub next_enemy_distance: i32,   // Q24.8
    pub next_fuel_distance: i32,    // Q24.8
    pub plane: PlaneState,
    pub pillars: Vec<Pillar>,
    pub next_pillar_id: u32,
    pub enemies: Vec<Enemy>,
    pub next_enemy_id: u32,
    pub missiles: Vec<Missile>,
    pub next_missile_id: u32,
    pub fuel_tokens: Vec<FuelToken>,
    pub next_fuel_token_id: u32,
    pub rng: PrngState,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Discriminant values must match the TS `const enum` integers byte-for-byte
    /// — the serializer writes them as raw u8s and any drift would corrupt
    /// every reading of `kind` / `tier` / `reason` across the wire.
    #[test]
    fn enemy_kind_discriminants() {
        assert_eq!(EnemyKind::BirdSmall as u8, 0);
        assert_eq!(EnemyKind::BirdBig as u8, 1);
        assert_eq!(EnemyKind::Drone as u8, 2);
        assert_eq!(EnemyKind::Jet as u8, 3);
        assert_eq!(EnemyKind::Ufo as u8, 4);
        assert_eq!(EnemyKind::BannerPlane as u8, 5);
    }

    #[test]
    fn game_over_reason_discriminants() {
        assert_eq!(GameOverReason::Unknown as u8, 0);
        assert_eq!(GameOverReason::Bird as u8, 1);
        assert_eq!(GameOverReason::Drone as u8, 2);
        assert_eq!(GameOverReason::Jet as u8, 3);
        assert_eq!(GameOverReason::Ufo as u8, 4);
        assert_eq!(GameOverReason::Missile as u8, 5);
        assert_eq!(GameOverReason::Pillar as u8, 6);
        assert_eq!(GameOverReason::WorldTop as u8, 7);
        assert_eq!(GameOverReason::WorldBottom as u8, 8);
        assert_eq!(GameOverReason::FuelOut as u8, 9);
        assert_eq!(GameOverReason::BannerPlane as u8, 10);
    }

    #[test]
    fn missile_tier_discriminants() {
        assert_eq!(MissileTier::Common as u8, 0);
        assert_eq!(MissileTier::Uncommon as u8, 1);
        assert_eq!(MissileTier::Rare as u8, 2);
    }

    #[test]
    fn button_bits() {
        assert_eq!(BTN_UP, 1);
        assert_eq!(BTN_DOWN, 2);
        assert_eq!(BTN_LEFT, 4);
        assert_eq!(BTN_RIGHT, 8);
    }
}

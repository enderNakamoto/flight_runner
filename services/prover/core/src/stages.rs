//! Stage system — mirror of `packages/sim/src/stages.ts`.
//!
//! `STAGE_TABLE` is a static array indexed by `state.stage` (u8). Each row
//! holds the per-stage tuning for spawn cadence, enemy mix, missile tiers,
//! fuel pressure, and bird taper. The world-scroll + fuel + entity-position
//! slices in the TS sim already pinned the Q24.8 representations; we mirror
//! them exactly here via the `const fn fp()` from `fp.rs`.

use crate::fp::fp;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Common = 0,
    Uncommon = 1,
    Rare = 2,
    Legendary = 3,
    Mythical = 4,
}

// Enemy bitmask bits.
pub const ENEMY_BIRD_SMALL: u32 = 1 << 0;
pub const ENEMY_BIRD_BIG: u32 = 1 << 1;
pub const ENEMY_DRONE: u32 = 1 << 2;
pub const ENEMY_JET: u32 = 1 << 3;
pub const ENEMY_UFO: u32 = 1 << 4;
pub const ENEMY_BANNER_PLANE: u32 = 1 << 5;

// Missile-tier bitmask bits.
pub const MISSILE_COMMON: u32 = 1 << 0;
pub const MISSILE_UNCOMMON: u32 = 1 << 1;
pub const MISSILE_RARE: u32 = 1 << 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BirdTaper {
    pub start_score: u32,
    pub end_score: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct StageParams {
    pub score_gate: u32,
    pub pillars_enabled: bool,
    pub pillar_spawn_period: i32,    // Q24.8 distance units (0 disables)
    pub pillar_gap: i32,             // unused at runtime; kept for parity with TS interface
    pub scroll_speed: i32,           // unused at runtime; kept for parity with TS interface
    pub fuel_enabled: bool,
    pub fuel_drain_per_tick: i32,    // Q24.8 fuel units per (tick · speedMul=1)
    pub fuel_spawn_period: i32,      // Q24.8 distance units
    pub enemy_spawn_period: i32,     // Q24.8 distance units
    pub enemy_mask: u32,
    pub bird_taper: Option<BirdTaper>,
    pub bird_small_speed: i32,       // Q24.8 px/tick
    pub bird_big_speed: i32,         // Q24.8 px/tick
    pub missile_tier_mask: u32,
    pub missile_max_in_flight: u32,
    pub visibility_flicker: bool,
}

pub static STAGE_TABLE: &[StageParams] = &[
    // ---- Common ----
    StageParams {
        score_gate: 0,
        pillars_enabled: false,
        pillar_spawn_period: 0,
        pillar_gap: 0,
        scroll_speed: fp(2.5),
        fuel_enabled: false,
        fuel_drain_per_tick: 0,
        fuel_spawn_period: 0,
        enemy_spawn_period: fp(180.0),
        enemy_mask: ENEMY_BIRD_SMALL | ENEMY_BANNER_PLANE,
        bird_taper: None,
        bird_small_speed: fp(3.6),
        bird_big_speed: 0,
        missile_tier_mask: 0,
        missile_max_in_flight: 0,
        visibility_flicker: false,
    },
    // ---- Uncommon ----
    StageParams {
        score_gate: 15,
        pillars_enabled: false,
        pillar_spawn_period: 0,
        pillar_gap: 0,
        scroll_speed: fp(2.75),
        fuel_enabled: true,
        fuel_drain_per_tick: fp(0.048),  // +20% over original 0.04
        fuel_spawn_period: fp(320.0),
        enemy_spawn_period: fp(150.0),
        enemy_mask: ENEMY_BIRD_SMALL | ENEMY_BIRD_BIG | ENEMY_BANNER_PLANE,
        bird_taper: None,
        bird_small_speed: fp(4.4),
        bird_big_speed: fp(2.6),
        missile_tier_mask: 0,
        missile_max_in_flight: 0,
        visibility_flicker: false,
    },
    // ---- Rare ----
    StageParams {
        score_gate: 46,
        pillars_enabled: true,
        pillar_spawn_period: fp(440.0),
        pillar_gap: 220,
        scroll_speed: fp(3.0),
        fuel_enabled: true,
        fuel_drain_per_tick: fp(0.06),   // +20% over original 0.05
        fuel_spawn_period: fp(340.0),
        enemy_spawn_period: fp(220.0),
        enemy_mask: ENEMY_BIRD_SMALL | ENEMY_BIRD_BIG | ENEMY_DRONE | ENEMY_BANNER_PLANE,
        bird_taper: Some(BirdTaper { start_score: 46, end_score: 156 }),
        bird_small_speed: fp(4.4),
        bird_big_speed: fp(2.6),
        missile_tier_mask: MISSILE_COMMON,
        missile_max_in_flight: 1,
        visibility_flicker: false,
    },
    // ---- Legendary ----
    StageParams {
        score_gate: 156,
        pillars_enabled: true,
        pillar_spawn_period: fp(380.0),
        pillar_gap: 200,
        scroll_speed: fp(3.25),
        fuel_enabled: true,
        fuel_drain_per_tick: fp(0.072),  // +20% over original 0.06
        fuel_spawn_period: fp(450.0),
        enemy_spawn_period: fp(180.0),
        enemy_mask: ENEMY_DRONE | ENEMY_JET | ENEMY_BANNER_PLANE,
        bird_taper: None,
        bird_small_speed: 0,
        bird_big_speed: 0,
        missile_tier_mask: MISSILE_COMMON | MISSILE_UNCOMMON,
        missile_max_in_flight: 2,
        visibility_flicker: false,
    },
    // ---- Mythical ----
    StageParams {
        score_gate: 375,
        pillars_enabled: true,
        pillar_spawn_period: fp(320.0),
        pillar_gap: 180,
        scroll_speed: fp(3.5),
        fuel_enabled: true,
        fuel_drain_per_tick: fp(0.084),  // +20% over original 0.07
        fuel_spawn_period: fp(700.0),
        enemy_spawn_period: fp(140.0),
        enemy_mask: ENEMY_DRONE | ENEMY_JET | ENEMY_UFO | ENEMY_BANNER_PLANE,
        bird_taper: None,
        bird_small_speed: 0,
        bird_big_speed: 0,
        missile_tier_mask: MISSILE_COMMON | MISSILE_UNCOMMON | MISSILE_RARE,
        missile_max_in_flight: 3,
        visibility_flicker: true,
    },
];

pub static STAGE_NAMES: &[&str] = &["COMMON", "UNCOMMON", "RARE", "LEGENDARY", "MYTHICAL"];

/// Pure function of score → highest unlocked stage. Mirrors TS
/// `stageForScore`.
pub fn stage_for_score(score: u32) -> Stage {
    for i in (0..STAGE_TABLE.len()).rev() {
        if score >= STAGE_TABLE[i].score_gate {
            return match i {
                0 => Stage::Common,
                1 => Stage::Uncommon,
                2 => Stage::Rare,
                3 => Stage::Legendary,
                _ => Stage::Mythical,
            };
        }
    }
    Stage::Common
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_has_five_rows() {
        assert_eq!(STAGE_TABLE.len(), 5);
        assert_eq!(STAGE_NAMES.len(), 5);
    }

    #[test]
    fn score_gates_match_ts() {
        let gates: Vec<u32> = STAGE_TABLE.iter().map(|s| s.score_gate).collect();
        assert_eq!(gates, vec![0, 15, 46, 156, 375]);
    }

    /// fp() values for the spawn-period / drain / bird-speed columns —
    /// drift here would shift every spawn deadline and bird collision in
    /// the corpus. Pinning the i32 representations locks the table to TS.
    #[test]
    fn pinned_q248_columns() {
        // Spawn periods (distance-units).
        assert_eq!(STAGE_TABLE[0].enemy_spawn_period, 180 * 256);
        assert_eq!(STAGE_TABLE[1].enemy_spawn_period, 150 * 256);
        assert_eq!(STAGE_TABLE[2].pillar_spawn_period, 440 * 256);
        assert_eq!(STAGE_TABLE[2].fuel_spawn_period, 340 * 256);
        assert_eq!(STAGE_TABLE[4].pillar_spawn_period, 320 * 256);

        // Fuel drains — truncation matters, pinning the Q24.8 ints not the floats.
        // Values bumped +20% per stage from the original tuning.
        assert_eq!(STAGE_TABLE[0].fuel_drain_per_tick, 0);
        assert_eq!(STAGE_TABLE[1].fuel_drain_per_tick, 12);   // fp(0.048) = 12 (rep. 0.046875)
        assert_eq!(STAGE_TABLE[2].fuel_drain_per_tick, 15);   // fp(0.06)  = 15 (rep. 0.0585...)
        assert_eq!(STAGE_TABLE[3].fuel_drain_per_tick, 18);   // fp(0.072) = 18 (rep. 0.0703125)
        assert_eq!(STAGE_TABLE[4].fuel_drain_per_tick, 21);   // fp(0.084) = 21 (rep. 0.08203125)

        // Bird speeds.
        assert_eq!(STAGE_TABLE[0].bird_small_speed, 921);   // fp(3.6)
        assert_eq!(STAGE_TABLE[1].bird_small_speed, 1126);  // fp(4.4)
        assert_eq!(STAGE_TABLE[1].bird_big_speed, 665);     // fp(2.6)
    }

    #[test]
    fn enemy_masks() {
        // Common = birds + banner plane
        assert_eq!(STAGE_TABLE[0].enemy_mask, ENEMY_BIRD_SMALL | ENEMY_BANNER_PLANE);
        // Mythical pulls in all enemies (drone, jet, ufo, banner) but no birds.
        assert_eq!(STAGE_TABLE[4].enemy_mask, ENEMY_DRONE | ENEMY_JET | ENEMY_UFO | ENEMY_BANNER_PLANE);
    }

    #[test]
    fn stage_for_score_thresholds() {
        assert_eq!(stage_for_score(0), Stage::Common);
        assert_eq!(stage_for_score(14), Stage::Common);
        assert_eq!(stage_for_score(15), Stage::Uncommon);
        assert_eq!(stage_for_score(45), Stage::Uncommon);
        assert_eq!(stage_for_score(46), Stage::Rare);
        assert_eq!(stage_for_score(155), Stage::Rare);
        assert_eq!(stage_for_score(156), Stage::Legendary);
        assert_eq!(stage_for_score(374), Stage::Legendary);
        assert_eq!(stage_for_score(375), Stage::Mythical);
        assert_eq!(stage_for_score(10_000), Stage::Mythical);
    }

    #[test]
    fn rare_has_bird_taper() {
        let taper = STAGE_TABLE[2].bird_taper.expect("Rare must have a bird taper");
        assert_eq!(taper.start_score, 46);
        assert_eq!(taper.end_score, 156);
        // Every other stage has None.
        for i in [0, 1, 3, 4] {
            assert!(STAGE_TABLE[i].bird_taper.is_none(), "stage {i} should not taper");
        }
    }
}

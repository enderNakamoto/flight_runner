//! Initial state factory — mirror of `packages/sim/src/state.ts`.

use crate::constants::{FUEL_INITIAL, PLANE_START_Y};
use crate::fp::fp;
use crate::prng::prng_init;
use crate::stages::Stage;
use crate::types::{GameOverReason, GameState, PlaneState};

pub fn create_initial_state(seed: i32, start_stage: Stage) -> GameState {
    GameState {
        tick: 0,
        score: 0,
        game_over: false,
        game_over_reason: GameOverReason::Unknown,
        stage: start_stage as u8,
        stage_just_changed: false,
        fuel: fp(FUEL_INITIAL as f64),
        world_speed_mul: fp(1.0),
        world_distance: 0,
        next_pillar_distance: 0,
        next_enemy_distance: 0,
        next_fuel_distance: 0,
        plane: PlaneState { y: fp(PLANE_START_Y as f64), vy: 0 },
        pillars: Vec::new(),
        next_pillar_id: 1,
        enemies: Vec::new(),
        next_enemy_id: 1,
        missiles: Vec::new(),
        next_missile_id: 1,
        fuel_tokens: Vec::new(),
        next_fuel_token_id: 1,
        rng: prng_init(seed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_state_matches_ts() {
        let s = create_initial_state(0x12345678, Stage::Common);
        assert_eq!(s.tick, 0);
        assert_eq!(s.score, 0);
        assert!(!s.game_over);
        assert_eq!(s.game_over_reason, GameOverReason::Unknown);
        assert_eq!(s.stage, 0);
        // Q24.8: fp(100) = 25600, fp(360) = 92160, fp(1) = 256.
        assert_eq!(s.fuel, 25600);
        assert_eq!(s.plane.y, 92160);
        assert_eq!(s.plane.vy, 0);
        assert_eq!(s.world_speed_mul, 256);
        assert_eq!(s.world_distance, 0);
        assert_eq!(s.next_pillar_id, 1);
        assert_eq!(s.next_enemy_id, 1);
        assert_eq!(s.next_missile_id, 1);
        assert_eq!(s.next_fuel_token_id, 1);
        assert!(s.pillars.is_empty());
        assert!(s.enemies.is_empty());
        assert!(s.missiles.is_empty());
        assert!(s.fuel_tokens.is_empty());
        // PRNG seeded with the input — verified separately in prng tests.
        assert_eq!(s.rng.s, 0x12345678);
    }

    #[test]
    fn start_stage_persists() {
        let s = create_initial_state(1, Stage::Rare);
        assert_eq!(s.stage, 2);
    }

    #[test]
    fn zero_seed_uses_prng_fallback() {
        let s = create_initial_state(0, Stage::Common);
        assert_eq!(s.rng.s, 0x12345678);
    }
}

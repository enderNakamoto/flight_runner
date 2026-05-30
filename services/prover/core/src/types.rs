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
    /// Player crossed `SCORE_CAP` — flight reached DXB. Ends the run
    /// as a "win" rather than a crash; the web UI's outro renders the
    /// victory template instead of the delay-slip framing.
    ReachedDXB = 11,
}

/// Hard ceiling on score. When score crosses this value the sim ends
/// the run with `GameOverReason::ReachedDXB`. Mirror lives in
/// packages/sim/src/types.ts.
pub const SCORE_CAP: u32 = 600;

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
        assert_eq!(GameOverReason::ReachedDXB as u8, 11);
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

// ─────────────────────────────────────────────────────────────────────────────
// ProverOutput — 76-byte journal layout committed by the zkVM guest.
// Mirrored on-chain in contracts/game_hub/src/lib.rs.
//
//   Offset  Size  Field             Encoding
//     0      4    score             u32 LE
//     4      4    ticks_survived    u32 LE
//     8      4    seed              u32 LE  (player-chosen, NOT verified)
//    12     32    player_pubkey     ED25519 public key (32 raw bytes)
//    44     32    transcript_hash   SHA-256 raw bytes
//
// Player-binding model: the pubkey committed in the journal is the address
// the contract credits the score to. No on-chain start_run is needed —
// anyone can submit on behalf of anyone, the credit always flows to the
// pubkey the proof committed. Bob can't claim Alice's proof for himself
// because Alice's pubkey is baked in.
// ─────────────────────────────────────────────────────────────────────────────

pub const JOURNAL_BYTES: usize = 76;
pub const PROVER_OUTPUT_WORDS: usize = 19; // JOURNAL_BYTES / 4

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProverOutput {
    pub score: u32,
    pub ticks_survived: u32,
    pub seed: u32,
    pub player_pubkey: [u8; 32],
    pub transcript_hash: [u8; 32],
}

#[derive(Debug)]
pub enum JournalError {
    BadLen(usize),
}

impl std::fmt::Display for JournalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JournalError::BadLen(n) => write!(f, "journal must be {JOURNAL_BYTES} bytes, got {n}"),
        }
    }
}

impl std::error::Error for JournalError {}

impl ProverOutput {
    /// Pack as 19 little-endian u32 words for `env::commit_slice`.
    pub fn to_journal_words(&self) -> [u32; PROVER_OUTPUT_WORDS] {
        let mut w = [0u32; PROVER_OUTPUT_WORDS];
        w[0] = self.score;
        w[1] = self.ticks_survived;
        w[2] = self.seed;
        // pubkey at words 3..11 (32 bytes = 8 words)
        for i in 0..8 {
            let o = i * 4;
            w[3 + i] = u32::from_le_bytes([
                self.player_pubkey[o],
                self.player_pubkey[o + 1],
                self.player_pubkey[o + 2],
                self.player_pubkey[o + 3],
            ]);
        }
        // transcript_hash at words 11..19 (32 bytes = 8 words)
        for i in 0..8 {
            let o = i * 4;
            w[11 + i] = u32::from_le_bytes([
                self.transcript_hash[o],
                self.transcript_hash[o + 1],
                self.transcript_hash[o + 2],
                self.transcript_hash[o + 3],
            ]);
        }
        w
    }

    /// Flatten to the 76 raw journal bytes (host-side use; the guest commits
    /// words directly via `to_journal_words`).
    pub fn to_journal_bytes(&self) -> [u8; JOURNAL_BYTES] {
        let mut out = [0u8; JOURNAL_BYTES];
        out[0..4].copy_from_slice(&self.score.to_le_bytes());
        out[4..8].copy_from_slice(&self.ticks_survived.to_le_bytes());
        out[8..12].copy_from_slice(&self.seed.to_le_bytes());
        out[12..44].copy_from_slice(&self.player_pubkey);
        out[44..76].copy_from_slice(&self.transcript_hash);
        out
    }

    /// Inverse of `to_journal_bytes` — used by host + contract decoders.
    pub fn from_journal_bytes(bytes: &[u8]) -> Result<Self, JournalError> {
        if bytes.len() != JOURNAL_BYTES {
            return Err(JournalError::BadLen(bytes.len()));
        }
        let score = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        let ticks_survived = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        let seed = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
        let mut player_pubkey = [0u8; 32];
        player_pubkey.copy_from_slice(&bytes[12..44]);
        let mut transcript_hash = [0u8; 32];
        transcript_hash.copy_from_slice(&bytes[44..76]);
        Ok(Self { score, ticks_survived, seed, player_pubkey, transcript_hash })
    }
}

#[cfg(test)]
mod journal_tests {
    use super::*;

    #[test]
    fn round_trip_bytes() {
        let o = ProverOutput {
            score: 0x12345678,
            ticks_survived: 0xABCDEF01,
            seed: 0xDEADBEEF,
            player_pubkey: [0x55; 32],
            transcript_hash: [0xAA; 32],
        };
        let bytes = o.to_journal_bytes();
        assert_eq!(bytes.len(), JOURNAL_BYTES);
        let back = ProverOutput::from_journal_bytes(&bytes).unwrap();
        assert_eq!(back, o);
    }

    #[test]
    fn words_match_bytes_layout() {
        let mut pubkey = [0u8; 32];
        for i in 0..32 { pubkey[i] = (i + 100) as u8; }
        let mut hash = [0u8; 32];
        for i in 0..32 { hash[i] = i as u8; }
        let o = ProverOutput {
            score: 1,
            ticks_survived: 2,
            seed: 3,
            player_pubkey: pubkey,
            transcript_hash: hash,
        };
        let words = o.to_journal_words();
        let mut flat = [0u8; JOURNAL_BYTES];
        for (i, w) in words.iter().enumerate() {
            flat[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
        }
        assert_eq!(flat, o.to_journal_bytes());
    }

    #[test]
    fn from_journal_bytes_rejects_bad_len() {
        assert!(matches!(
            ProverOutput::from_journal_bytes(&[0u8; 75]),
            Err(JournalError::BadLen(75))
        ));
        assert!(matches!(
            ProverOutput::from_journal_bytes(&[0u8; 44]),
            Err(JournalError::BadLen(44))
        ));
    }

    /// Pin: a known journal must decode to the expected fields. Anchor
    /// against drift in the byte layout.
    #[test]
    fn decode_pinned_layout() {
        let mut bytes = [0u8; JOURNAL_BYTES];
        bytes[0..4].copy_from_slice(&1000u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&2000u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&0xCAFEBABE_u32.to_le_bytes());
        for i in 0..32 { bytes[12 + i] = (i + 200) as u8; }   // pubkey filler
        for i in 0..32 { bytes[44 + i] = i as u8; }            // hash filler
        let o = ProverOutput::from_journal_bytes(&bytes).unwrap();
        assert_eq!(o.score, 1000);
        assert_eq!(o.ticks_survived, 2000);
        assert_eq!(o.seed, 0xCAFEBABE);
        assert_eq!(o.player_pubkey[0], 200);
        assert_eq!(o.player_pubkey[31], 231);
        assert_eq!(o.transcript_hash[0], 0);
        assert_eq!(o.transcript_hash[31], 31);
    }
}

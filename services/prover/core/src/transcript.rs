//! Transcript codec + replay — mirror of `packages/sim/src/transcript.ts`.
//!
//! Layout matches TS: `u32 seed (LE) || u8[ticks] buttons`. Same `replay`
//! semantics: step until either we exhaust buttons or `game_over` flips.

use crate::stages::Stage;
use crate::state::create_initial_state;
use crate::step::step_mut;
use crate::types::{GameState, PlayerInput};

pub struct DecodedTranscript {
    pub seed: i32,
    pub buttons: Vec<u8>,
}

pub struct ReplayResult {
    pub state: GameState,
    pub ticks_consumed: u32,
}

pub fn encode_transcript(seed: i32, buttons: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + buttons.len());
    out.extend_from_slice(&(seed as u32).to_le_bytes());
    out.extend_from_slice(buttons);
    out
}

#[derive(Debug)]
pub enum TranscriptError {
    TooShort(usize),
}

impl std::fmt::Display for TranscriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TranscriptError::TooShort(n) => write!(f, "transcript too short ({n} bytes)"),
        }
    }
}

impl std::error::Error for TranscriptError {}

pub fn decode_transcript(buf: &[u8]) -> Result<DecodedTranscript, TranscriptError> {
    if buf.len() < 4 {
        return Err(TranscriptError::TooShort(buf.len()));
    }
    let seed = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as i32;
    let buttons = buf[4..].to_vec();
    Ok(DecodedTranscript { seed, buttons })
}

/// Replay a transcript end-to-end. Stops as soon as `game_over` flips, since
/// further steps are no-ops; returns the number of ticks consumed.
pub fn replay(buf: &[u8], start_stage: Stage) -> Result<ReplayResult, TranscriptError> {
    let DecodedTranscript { seed, buttons } = decode_transcript(buf)?;
    let mut state = create_initial_state(seed, start_stage);
    let mut consumed: u32 = 0;
    for &b in &buttons {
        step_mut(&mut state, PlayerInput { buttons: b });
        consumed += 1;
        if state.game_over {
            break;
        }
    }
    Ok(ReplayResult { state, ticks_consumed: consumed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_then_decode_round_trips() {
        let seed = 0x5e570e03_i32;
        let buttons = vec![0u8, 1, 2, 8, 0, 0, 0, 9];
        let buf = encode_transcript(seed, &buttons);
        assert_eq!(buf.len(), 4 + buttons.len());
        let decoded = decode_transcript(&buf).unwrap();
        assert_eq!(decoded.seed, seed);
        assert_eq!(decoded.buttons, buttons);
    }

    #[test]
    fn decode_rejects_short_input() {
        assert!(matches!(
            decode_transcript(&[0u8, 1, 2]),
            Err(TranscriptError::TooShort(3))
        ));
    }

    #[test]
    fn empty_replay_does_not_step() {
        let buf = encode_transcript(123, &[]);
        let r = replay(&buf, Stage::Common).unwrap();
        assert_eq!(r.ticks_consumed, 0);
        assert_eq!(r.state.tick, 0);
        assert!(!r.state.game_over);
    }

    #[test]
    fn replay_stops_on_game_over() {
        // 200 ticks of UP at fp(6)/tick should hit WorldTop well inside the
        // buffer; replay must stop early.
        let buf = encode_transcript(1, &vec![crate::types::BTN_UP; 200]);
        let r = replay(&buf, Stage::Common).unwrap();
        assert!(r.state.game_over);
        assert!(r.ticks_consumed < 200);
        assert_eq!(r.state.game_over_reason, crate::types::GameOverReason::WorldTop);
    }
}

//! Prints the 32-byte FLIGHT_GUEST_ID as lowercase hex (no `0x` prefix,
//! no trailing newline). Used by scripts/deploy.sh to register the game
//! in game_hub::add_game.

use flight_methods::FLIGHT_GUEST_ID;

fn main() {
    let mut bytes = [0u8; 32];
    for (i, w) in FLIGHT_GUEST_ID.iter().enumerate() {
        bytes[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
    }
    print!("{}", hex::encode(bytes));
}

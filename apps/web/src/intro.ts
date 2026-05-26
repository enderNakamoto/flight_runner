// Pre-flight briefing shown before the game begins. Sets up the run as a
// commercial flight from LAX to DXB and primes the player on the threats
// they'll see. Any key (or Space/Enter) advances to the ready phase.

export const INTRO_HEADER = "PRE-FLIGHT BRIEFING";

export const INTRO_TITLE_TEMPLATE = (flightId: string): string =>
  `FLIGHT  ${flightId}    LAX → DXB`;

export const INTRO_BODY: readonly string[] = [
  "Los Angeles International → Dubai International",
  "",
  "MISSION    Carry the passengers home safely.",
  "           On time. In one piece.",
  "",
  "EXPECTED   Bird corridors over the Pacific.",
  "           Contested airspace near Dubai.",
  "           Severe weather. And worse.",
  "",
  "Watch your altitude. Watch your fuel.",
  "Stay airborne.",
  "",
  "REWARD     Top-10 scores earn Sentinel Protocol points.",
  "           Sign in and submit on-chain — anything not",
  "           submitted doesn't count.",
];

export const INTRO_HINT = "PRESS ANY KEY TO BOARD";

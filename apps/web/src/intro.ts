// Pre-flight briefing shown before the game begins. Sets up the run as a
// commercial flight from LAX to DXB and primes the player on the threats
// they'll see. Any key (or Space/Enter) advances to the ready phase.

export const INTRO_HEADER = "PRE-FLIGHT BRIEFING";

export const INTRO_TITLE_TEMPLATE = (flightId: string): string =>
  `FLIGHT  ${flightId}    LAX → DXB`;

export const INTRO_BODY: readonly string[] = [
  "Los Angeles → Dubai",
  "",
  "MISSION:  Land in one piece.",
  "HAZARDS:  Birds. Drones. Jets. UFOs.",
  "REWARD:   Every on-chain score earns Sentinel points.",
  "          Top-10 scores earn more.",
];

export const INTRO_HINT = "PRESS ANY KEY TO BOARD";

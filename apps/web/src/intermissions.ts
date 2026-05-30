// Stage-transition briefings — shown for 10 s (skippable) when the player
// crosses a score gate. They prime the next stage's mood and call out the
// mechanics that just unlocked.
//
// Indexed by the stage being entered. Stage.Common has no briefing because
// it's the starting state.

import { Stage } from "@flight/sim";

export interface IntermissionCopy {
  title: string;
  body: readonly string[];
}

export const INTERMISSIONS: Record<Stage, IntermissionCopy | null> = {
  [Stage.Common]: null,
  [Stage.Uncommon]: {
    title: "DUSK APPROACHES",
    body: [
      "The light is fading. Migrating flocks",
      "are denser along this corridor.",
      "",
      "FUEL IS NOW DRAINING.",
      "Pick up the glowing tokens to refill.",
    ],
  },
  [Stage.Rare]: {
    title: "ENTERING CONTESTED AIRSPACE",
    body: [
      "Iran has vowed to close the Dubai",
      "eastern corridor by sundown.",
      "",
      "Surveillance drones are now firing",
      "on civilian flights. Cloud columns",
      "ahead force you low — thread the gap.",
    ],
  },
  [Stage.Legendary]: {
    title: "MILITARY ESCALATION",
    body: [
      "IDF and USAF squadrons scrambling",
      "for air supremacy over the corridor.",
      "Jets are fast and they shoot back.",
      "",
      "FUEL RATIONING IN EFFECT.",
      "The birds have turned back.",
      "You haven't.",
    ],
  },
  [Stage.Mythical]: {
    title: "UNIDENTIFIED CRAFT DETECTED",
    body: [
      "NORAD is tracking objects of unknown",
      "origin over the Gulf. A lightning",
      "storm masks their approach.",
      "",
      "Fuel pickups are scarce.",
      "Visibility is not guaranteed.",
      "",
      "You are alone up here. Good luck.",
    ],
  },
};

export const INTERMISSION_DURATION_MS = 10_000;

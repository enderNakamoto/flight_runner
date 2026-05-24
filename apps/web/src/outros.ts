// Game-over outro briefings. Framed as a flight diversion ("we're going
// somewhere safe to land for repairs"), never a crash. The title is the same
// across reasons; the body varies with what hit the plane.

import { GameOverReason } from "@flight/sim";

export interface OutroCopy {
  title: string;
  body: readonly string[];
}

// Short label for the Sentinel Protocol slip's "DIVERSION CAUSE" field.
export const REASON_TAG: Record<GameOverReason, string> = {
  [GameOverReason.Unknown]:     "Unknown",
  [GameOverReason.Bird]:        "Bird strike",
  [GameOverReason.Drone]:       "Drone collision",
  [GameOverReason.Jet]:         "Hostile fighter",
  [GameOverReason.Ufo]:         "Unidentified contact",
  [GameOverReason.Missile]:     "Hostile fire",
  [GameOverReason.Pillar]:      "Severe weather",
  [GameOverReason.WorldTop]:    "Pressurization",
  [GameOverReason.WorldBottom]: "Terrain warning",
  [GameOverReason.FuelOut]:     "Fuel emergency",
};

// Sentinel Protocol product page. The outro CTA opens this with the run's
// context attached as query params so the landing page can deep-link the
// fictional payout into the real sign-up flow.
export const SENTINEL_PROTOCOL_URL = "https://sentinelprotocol.xyz";

const FALLBACK: OutroCopy = {
  title: "FLIGHT DIVERTED",
  body: [
    "An incident has been reported.",
    "Diverting to the nearest airport.",
  ],
};

export const OUTROS: Record<GameOverReason, OutroCopy> = {
  [GameOverReason.Unknown]: FALLBACK,
  [GameOverReason.Bird]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Heavy bird strike on the engine cowling.",
      "Number-two turbine showing vibration.",
      "",
      "Diverting to the nearest airport",
      "for inspection and repair.",
    ],
  },
  [GameOverReason.Drone]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Collision with a surveillance drone",
      "over restricted airspace.",
      "",
      "Hull integrity holding.",
      "Diverting to the nearest friendly base",
      "for damage assessment.",
    ],
  },
  [GameOverReason.Jet]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Near miss with a hostile fighter.",
      "Airframe stressed beyond service limits.",
      "",
      "Diverting to the nearest airport",
      "for inspection and repair.",
    ],
  },
  [GameOverReason.Ufo]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Contact with an unidentified craft.",
      "Avionics and compass intermittent.",
      "",
      "Reverting to manual navigation.",
      "Diverting to the nearest airport.",
    ],
  },
  [GameOverReason.Missile]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Hostile fire detected — fragmentation",
      "damage along the starboard wing.",
      "",
      "Declaring an emergency.",
      "Diverting to the nearest friendly runway.",
    ],
  },
  [GameOverReason.Pillar]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Lost in heavy cloud cover.",
      "Visibility critical — instruments only.",
      "",
      "Diverting around the weather",
      "to the nearest airport.",
    ],
  },
  [GameOverReason.WorldTop]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Cabin pressure warning at altitude.",
      "Service ceiling exceeded.",
      "",
      "Descending and diverting",
      "to the nearest airport.",
    ],
  },
  [GameOverReason.WorldBottom]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Critical low-altitude alert.",
      "Terrain warning system active.",
      "",
      "Pulling up and diverting",
      "to the nearest airport.",
    ],
  },
  [GameOverReason.FuelOut]: {
    title: "FLIGHT DIVERTED",
    body: [
      "Fuel emergency declared.",
      "Insufficient reserves to reach destination.",
      "",
      "Gliding to the nearest available runway.",
    ],
  },
};

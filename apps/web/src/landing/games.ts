// Registry of playable games. Adding a new game = add an entry here +
// a route handler in main.ts.

export interface PartnerPerk {
  /** Short banner copy shown on the game card. */
  text: string;
  /** Optional logo path under /assets/. */
  logo?: string;
  /** Optional outbound link to the partner's site. */
  url?: string;
}

export interface GameEntry {
  slug: string;            // URL path under /
  title: string;           // big pixel header
  blurb: string;           // one-line tagline
  description: string;     // longer paragraph
  thumb: string;           // path under /assets/
  status: "live" | "soon";
  /** game_id registered on the game_hub contract. Only meaningful for
   *  live games (used to fetch the player's on-chain best). */
  gameId?: number;
  /** Per-game perks — e.g. earning points in a partner ecosystem.
   *  Only renders when set; other games can leave this undefined. */
  perk?: PartnerPerk;
}

export const GAMES: GameEntry[] = [
  {
    // URL slug = display name. Repo + package names (flight_scroll etc.)
    // intentionally keep their original identifiers.
    slug: "birdstrike",
    title: "BIRDSTRIKE",
    blurb: "Dodge birds. Manage fuel. Land in one piece.",
    description:
      "Steer your propeller plane through five escalating stages of pillars, birds, drones, jets, and UFOs. Refuel mid-flight or fall out of the sky. Submit your best run on-chain — every score is a proven replay.",
    thumb: "/assets/plane.png",
    status: "live",
    gameId: 1,
    perk: {
      text: "Earn points for Sentinel Protocol",
    },
  },
  {
    slug: "neon_streets",
    title: "NEON STREETS",
    blurb: "Pixel-art brawler. Trade blows on neon streets.",
    description:
      "Two fighters. One Tokyo back alley. Pick your character, learn the combos, climb the on-chain rank.",
    thumb: "/assets/games/neon_streets.png",
    status: "soon",
  },
];

export function findGame(slug: string): GameEntry | null {
  return GAMES.find((g) => g.slug === slug) ?? null;
}

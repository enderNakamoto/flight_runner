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
  /** Per-game perks — e.g. earning points in a partner ecosystem.
   *  Only renders when set; other games can leave this undefined. */
  perk?: PartnerPerk;
}

export const GAMES: GameEntry[] = [
  {
    // Slug stays "flight_scroll" so existing links + the repo name keep
    // working; the display title is what the player sees.
    slug: "flight_scroll",
    title: "BIRDSTRIKE",
    blurb: "Dodge birds. Manage fuel. Land in one piece.",
    description:
      "Steer your propeller plane through five escalating stages of pillars, birds, drones, jets, and UFOs. Refuel mid-flight or fall out of the sky. Submit your best run on-chain — every score is a proven replay.",
    thumb: "/assets/plane.png",
    status: "live",
    perk: {
      text: "Earn points for Sentinel Protocol",
    },
  },
];

export function findGame(slug: string): GameEntry | null {
  return GAMES.find((g) => g.slug === slug) ?? null;
}

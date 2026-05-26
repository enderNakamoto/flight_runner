// Registry of playable games. Adding a new game = add an entry here +
// a route handler in main.ts.

export interface GameEntry {
  slug: string;         // URL path under /
  title: string;        // big pixel header
  blurb: string;        // one-line tagline
  description: string;  // longer paragraph
  thumb: string;        // path under /assets/
  status: "live" | "soon";
}

export const GAMES: GameEntry[] = [
  {
    slug: "flight_scroll",
    title: "FLIGHT SCROLL",
    blurb: "Side-scrolling dogfight. ZK-verified high scores.",
    description:
      "Steer your propeller plane through five stages of pillars, birds, drones, jets, and UFOs. Run out of fuel and you die. Submit your best run on-chain — every score is a proven replay.",
    thumb: "/assets/plane.png",
    status: "live",
  },
];

export function findGame(slug: string): GameEntry | null {
  return GAMES.find((g) => g.slug === slug) ?? null;
}

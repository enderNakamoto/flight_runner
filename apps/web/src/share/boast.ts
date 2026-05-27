// Rank-tier boast templates. Given (rank, score), produce X- and Discord-
// flavoured share copy plus the canonical share URL. The X copy includes
// the @handle inline so X surfaces it without relying on the `via` param.

import { SHARE_CONFIG, shareUrl } from "./config.js";

export interface BoastCopy {
  /// Single-line text for the X (Twitter) intent URL — handle + URL appended.
  x: string;
  /// Multi-line text for the Discord clipboard copy — URL on its own line.
  discord: string;
  /// Canonical share URL (used for the "copy link" button).
  url: string;
}

export interface BoastInput {
  /// Current rank in the top-N snapshot, or null if not in the top-N table.
  rank: number | null;
  /// Player's best score.
  score: number;
}

const HANDLE = `@${SHARE_CONFIG.twitterHandle}`;
const SHARE_URL = shareUrl("/birdstrike/leaderboard");

function tierLine({ rank, score }: BoastInput): string {
  if (rank === 1) {
    return `🏆 I'm #1 on the Birdstrike leaderboard. Score ${score}. Verified on chain.`;
  }
  if (rank !== null && rank <= 3) {
    return `🥇 Top 3 on Birdstrike — score ${score}, rank #${rank}. ZK-verified leaderboard.`;
  }
  if (rank !== null && rank <= 10) {
    return `Top 10 on Birdstrike 🛫 — score ${score}, rank #${rank}. Every score is provable.`;
  }
  if (rank !== null && rank <= 100) {
    return `Ranked #${rank} on Birdstrike with ${score}. Every leaderboard entry is a ZK-verified replay.`;
  }
  if (rank !== null) {
    return `On the Birdstrike leaderboard at #${rank} (score ${score}). Provable high scores.`;
  }
  // Unranked: still got a score off-chain or unsubmitted.
  if (score > 0) {
    return `Just scored ${score} on Birdstrike — provable leaderboard, come climb.`;
  }
  return `Playing Birdstrike — ZK-verified high scores on chain. Come compete.`;
}

export function boast(input: BoastInput): BoastCopy {
  const core = tierLine(input);
  return {
    x: `${core} ${HANDLE} ${SHARE_URL}`,
    discord: `${core}\n${SHARE_URL}`,
    url: SHARE_URL,
  };
}

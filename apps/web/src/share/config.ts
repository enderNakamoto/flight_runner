// Sharing config — values that change when the canonical handle / domain
// flips. Defaults below; override at build time via Vite env vars (VITE_*).
//
// To change the handle:    set VITE_TWITTER_HANDLE in apps/web/.env.local
// To change the prod URL:  set VITE_PRODUCTION_URL  in apps/web/.env.local
// To change the OG image:  drop the new file at public/og/birdstrike.png
//                          (or set VITE_OG_IMAGE_URL to point elsewhere)

const env = import.meta.env as Record<string, string | undefined>;

export const SHARE_CONFIG = {
  /// Twitter / X handle WITHOUT the leading "@". Used in shares + twitter:site meta.
  /// Birdstrike on the arcade is a marketing surface for Sentinel — handle
  /// stays @sentinel_fi while the host is proofarcade.xyz.
  twitterHandle: env.VITE_TWITTER_HANDLE ?? "sentinel_fi",
  /// Canonical site URL (no trailing slash). Used as the base for share links.
  productionUrl: (env.VITE_PRODUCTION_URL ?? "https://proofarcade.xyz").replace(/\/$/, ""),
  /// Path or URL to the OG image. Relative paths resolve against productionUrl in shares.
  ogImagePath: env.VITE_OG_IMAGE_URL ?? "/og/birdstrike.png",
} as const;

/// Build a canonical share URL: `${productionUrl}${path}` with path
/// normalised to start with "/".
export function shareUrl(path: string = ""): string {
  if (!path) return SHARE_CONFIG.productionUrl;
  return `${SHARE_CONFIG.productionUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function ogImageUrl(): string {
  const p = SHARE_CONFIG.ogImagePath;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return shareUrl(p);
}

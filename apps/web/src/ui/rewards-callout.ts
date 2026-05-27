// Vague "go play, we'll sync rewards" callout, sprinkled across landing,
// leaderboards, and how-it-works. One shared component — class-scoped so
// the same CSS string is safe to inject into any page.
//
// No token mention, no specifics — copy is intentionally soft.

const STYLE = `
  .fs-rewards-callout {
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 640px;
    margin: 0 auto 28px;
    padding: 14px 18px;
    background: rgba(93, 211, 255, 0.06);
    border: 2px solid rgba(93, 211, 255, 0.35);
    border-radius: 4px;
    color: #d8e8ff;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    line-height: 1.55;
    text-align: left;
    box-shadow: inset 0 0 24px rgba(93, 211, 255, 0.04);
  }
  .fs-rewards-callout .chest {
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    image-rendering: pixelated;
    animation: fs-rewards-bob 2.6s ease-in-out infinite;
  }
  .fs-rewards-callout .copy strong {
    color: #5dd3ff;
    font-weight: 600;
  }
  @keyframes fs-rewards-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-3px); }
  }
  @media (max-width: 560px) {
    .fs-rewards-callout { font-size: 12px; padding: 12px 14px; gap: 10px; }
    .fs-rewards-callout .chest { flex-basis: 36px; width: 36px; height: 36px; }
  }

  /* Compact variant — used when the callout is embedded inside a game
     card or other constrained container. Smaller padding, tighter font,
     no outer margins. */
  .fs-rewards-callout--compact {
    margin: 0 0 14px;
    padding: 10px 12px;
    gap: 10px;
    font-size: 12px;
    line-height: 1.5;
  }
  .fs-rewards-callout--compact .chest {
    flex-basis: 32px;
    width: 32px;
    height: 32px;
  }
`;

const CHEST_SVG = `
  <svg class="chest" viewBox="0 0 44 44" fill="none" stroke="#5dd3ff" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter">
    <path d="M8 22 Q8 14 16 14 L28 14 Q36 14 36 22 Z" fill="rgba(93,211,255,0.18)"/>
    <rect x="8" y="22" width="28" height="14" fill="rgba(93,211,255,0.10)"/>
    <line x1="14" y1="14" x2="14" y2="36"/>
    <line x1="30" y1="14" x2="30" y2="36"/>
    <rect x="20" y="24" width="4" height="6" fill="#5dd3ff" stroke="none"/>
    <circle cx="22" cy="26.5" r="0.9" fill="#0a1024" stroke="none"/>
    <path d="M40 8 L40 12 M38 10 L42 10" stroke="#5dd3ff" stroke-width="1.5"/>
    <path d="M6 6 L6 9 M4.5 7.5 L7.5 7.5" stroke="#5dd3ff" stroke-width="1.5"/>
  </svg>
`;

const COPY = `<strong>Just play and have fun.</strong> Every score you post counts — we'll sync your rewards to you at <strong>Sentinel launch</strong>.`;

export function injectRewardsCalloutStyle(): void {
  if (document.getElementById("fs-rewards-callout-style")) return;
  const s = document.createElement("style");
  s.id = "fs-rewards-callout-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

interface CalloutOpts {
  /** Embed inside a constrained container (game card etc.) — smaller padding, no margin. */
  compact?: boolean;
}

/// HTML string for `innerHTML` consumers. Style is injected as a side effect.
export function rewardsCalloutHtml(opts: CalloutOpts = {}): string {
  injectRewardsCalloutStyle();
  const cls = opts.compact ? "fs-rewards-callout fs-rewards-callout--compact" : "fs-rewards-callout";
  return `<div class="${cls}">${CHEST_SVG}<div class="copy">${COPY}</div></div>`;
}

/// DOM-node form for createElement consumers.
export function createRewardsCallout(opts: CalloutOpts = {}): HTMLElement {
  injectRewardsCalloutStyle();
  const el = document.createElement("div");
  el.className = opts.compact ? "fs-rewards-callout fs-rewards-callout--compact" : "fs-rewards-callout";
  el.innerHTML = `${CHEST_SVG}<div class="copy">${COPY}</div>`;
  return el;
}

// ShareRankButton — three icon-style buttons (𝕏 / Discord / Link) for
// the player's current rank + score. Renders HTML so it can be embedded
// inside both DOM-built UI (the leaderboard "Your best" tile) and
// innerHTML-built widgets (the celebration modal + PB toast). Wire up
// after mount with `bindShareButtons`.

import { boast, type BoastCopy, type BoastInput } from "./boast.js";

const STYLE = `
  .fs-share-btns {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .fs-share-btns .label {
    color: rgba(216, 224, 240, 0.65);
    font-size: 11px;
    margin-right: 4px;
  }
  .fs-share-btns .btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border, #3a4a6b);
    color: #d8e0f0;
    font-family: var(--font-body, ui-monospace, Menlo, monospace);
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s, background 0.1s;
    line-height: 1;
  }
  .fs-share-btns .btn:hover {
    color: var(--accent, #f5d04b);
    border-color: var(--accent, #f5d04b);
    background: rgba(245, 208, 75, 0.08);
  }
  .fs-share-btns .btn.copied {
    color: #7aff8e;
    border-color: #7aff8e;
    background: rgba(122, 255, 142, 0.08);
  }
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || document.getElementById("fs-share-style")) {
    styleInjected = true;
    return;
  }
  const s = document.createElement("style");
  s.id = "fs-share-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
  styleInjected = true;
}

function tweetIntentUrl(c: BoastCopy): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(c.x)}`;
}

export interface ShareRankBtnsOpts extends BoastInput {
  /// If true, prepend a small "share:" label before the buttons.
  withLabel?: boolean;
}

export function shareRankButtonsHtml(opts: ShareRankBtnsOpts): string {
  injectStyle();
  const labelHtml = opts.withLabel ? `<span class="label">share</span>` : "";
  return `
    <span class="fs-share-btns" data-share-rank="${opts.rank ?? ""}" data-share-score="${opts.score}">
      ${labelHtml}
      <button type="button" class="btn" data-action="x" title="Post to X (Twitter)">𝕏</button>
      <button type="button" class="btn" data-action="discord" title="Copy Discord message">Discord</button>
      <button type="button" class="btn" data-action="link" title="Copy link">🔗</button>
    </span>
  `;
}

/// Attach click handlers on every `.fs-share-btns` group inside `root`.
/// Safe to call multiple times — each call replaces existing onclicks.
export function bindShareButtons(root: ParentNode): void {
  const groups = root.querySelectorAll<HTMLElement>(".fs-share-btns");
  groups.forEach((group) => {
    const rankStr = group.dataset.shareRank ?? "";
    const rank = rankStr ? parseInt(rankStr, 10) : null;
    const score = parseInt(group.dataset.shareScore ?? "0", 10);
    const copy = boast({ rank, score });

    group.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
      btn.onclick = async () => {
        const action = btn.dataset.action;
        try {
          if (action === "x") {
            window.open(tweetIntentUrl(copy), "_blank", "noopener,noreferrer");
          } else if (action === "discord") {
            await navigator.clipboard.writeText(copy.discord);
            flashCopied(btn);
          } else if (action === "link") {
            await navigator.clipboard.writeText(copy.url);
            flashCopied(btn);
          }
        } catch {
          // clipboard.writeText can throw in non-secure contexts — fall back
          // to a transient label so the user knows it didn't work.
          btn.textContent = "✕";
          setTimeout(() => bindShareButtons(group.parentElement ?? group), 1200);
        }
      };
    });
  });
}

function flashCopied(btn: HTMLButtonElement): void {
  const orig = btn.textContent;
  btn.textContent = "✓ copied";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove("copied");
  }, 1500);
}

// Celebration UI — fires when the player breaks into the top 10 (big
// pixel-confetti modal) or hits any new personal best (small toast).
// Both surfaces include share buttons so the moment of pride is one click
// from posting. Cadence is gated by localStorage so the same achievement
// doesn't celebrate twice on refresh.
//
// Storage shape:
//   fs-best-rank-<slug> → JSON { rank: number|null, score: number }
// "Improvement" = new rank < cached rank OR new score > cached score.

import { bindShareButtons, shareRankButtonsHtml } from "./share-rank-button.js";

const storageKey = (slug: string) => `fs-best-rank-${slug}`;

const STYLE = `
  @keyframes fs-confetti-drop {
    0%   { transform: translate(var(--dx, 0px), -20px) rotate(0deg); opacity: 1; }
    100% { transform: translate(var(--dx, 0px), 110vh) rotate(720deg); opacity: 0; }
  }
  @keyframes fs-modal-in {
    0%   { transform: translateY(16px) scale(0.96); opacity: 0; }
    100% { transform: translateY(0)    scale(1);    opacity: 1; }
  }
  @keyframes fs-toast-in {
    0%   { transform: translate(-50%, 24px); opacity: 0; }
    100% { transform: translate(-50%, 0);    opacity: 1; }
  }

  /* ── Top-10 modal ── */
  #fs-celebrate {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0, 0, 0, 0.78);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #fs-celebrate .card {
    position: relative;
    background: #16223a;
    border: 4px solid #f5d04b;
    box-shadow: 0 0 60px rgba(245, 208, 75, 0.3),
                8px 8px 0 rgba(245, 208, 75, 0.18);
    border-radius: 8px;
    padding: 36px 42px 28px;
    text-align: center;
    max-width: 480px;
    margin: 0 16px;
    animation: fs-modal-in 0.36s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  #fs-celebrate h1 {
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 26px;
    color: #f5d04b;
    margin: 0 0 8px;
    letter-spacing: 1px;
    text-shadow: 3px 3px 0 rgba(0,0,0,0.6);
  }
  #fs-celebrate .rank {
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 44px;
    color: #ffffff;
    margin: 18px 0 10px;
    text-shadow: 4px 4px 0 #5b3aa8;
  }
  #fs-celebrate .copy {
    color: #d8e0f0;
    font-size: 13px;
    line-height: 1.65;
    margin: 8px 0 22px;
  }
  #fs-celebrate .copy strong { color: #ffd54f; }
  #fs-celebrate .share-row {
    display: flex; justify-content: center;
    margin-top: 8px;
  }
  #fs-celebrate .close {
    position: absolute; top: 10px; right: 14px;
    background: transparent; border: none; color: #94a3c6;
    font-size: 18px; cursor: pointer; line-height: 1;
  }
  #fs-celebrate .close:hover { color: #fff; }

  /* ── Confetti rain ── */
  #fs-confetti {
    position: fixed; inset: 0; pointer-events: none; z-index: 199;
    overflow: hidden;
  }
  #fs-confetti i {
    position: absolute;
    width: 10px; height: 10px;
    animation: fs-confetti-drop 2.4s linear forwards;
  }

  /* ── PB toast (for any new best that isn't a top-10 break-in) ── */
  #fs-pb-toast {
    position: fixed;
    bottom: 24px; left: 50%; transform: translateX(-50%);
    z-index: 180;
    background: #16223a;
    border: 2px solid #7aff8e;
    color: #d8e0f0;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 13px;
    padding: 12px 18px;
    border-radius: 6px;
    display: flex; align-items: center; gap: 14px;
    flex-wrap: wrap;
    max-width: calc(100vw - 32px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.6);
    animation: fs-toast-in 0.3s ease-out both;
  }
  #fs-pb-toast .label { color: #7aff8e; font-weight: 600; margin-right: 4px; }
  #fs-pb-toast .close {
    background: transparent; border: none; color: #94a3c6;
    cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px;
  }
  #fs-pb-toast .close:hover { color: #fff; }
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || document.getElementById("fs-celebrate-style")) {
    styleInjected = true;
    return;
  }
  const s = document.createElement("style");
  s.id = "fs-celebrate-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
  styleInjected = true;
}

const CONFETTI_COLORS = ["#f5d04b", "#7aff8e", "#5ec8ff", "#ff79c6", "#ffffff"];

function spawnConfetti(count = 80): void {
  const wrap = document.createElement("div");
  wrap.id = "fs-confetti";
  for (let i = 0; i < count; i++) {
    const c = document.createElement("i");
    c.style.left = `${Math.random() * 100}%`;
    c.style.top = `${-Math.random() * 80}px`;
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 220}px`);
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    c.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    wrap.appendChild(c);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 4000);
}

interface CelebrateOpts {
  slug: string;
  rank: number;
  score: number;
}

export function showTopTenCelebration(opts: CelebrateOpts): void {
  injectStyle();
  spawnConfetti();
  // Don't double-mount if the player refreshes mid-modal.
  document.getElementById("fs-celebrate")?.remove();

  const dialog = document.createElement("div");
  dialog.id = "fs-celebrate";
  dialog.innerHTML = `
    <div class="card">
      <button class="close" aria-label="Close">✕</button>
      <h1>TOP 10</h1>
      <div class="rank">#${opts.rank}</div>
      <div class="copy">
        You broke into the top 10 of the Birdstrike leaderboard
        with a score of <strong>${opts.score}</strong>.<br>
        Brag a little.
      </div>
      <div class="share-row">${shareRankButtonsHtml({ rank: opts.rank, score: opts.score })}</div>
    </div>
  `;
  document.body.appendChild(dialog);
  bindShareButtons(dialog);

  const close = () => dialog.remove();
  dialog.querySelector<HTMLButtonElement>(".close")!.onclick = close;
  dialog.onclick = (e) => { if (e.target === dialog) close(); };
  // ESC also dismisses.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  };
  document.addEventListener("keydown", onKey);
}

interface PbToastOpts {
  rank: number | null;
  score: number;
}

export function showPbToast(opts: PbToastOpts): void {
  injectStyle();
  document.getElementById("fs-pb-toast")?.remove();

  const rankSuffix = opts.rank ? ` · rank #${opts.rank}` : "";
  const toast = document.createElement("div");
  toast.id = "fs-pb-toast";
  toast.innerHTML = `
    <span><span class="label">New best:</span> ${opts.score}${rankSuffix}</span>
    ${shareRankButtonsHtml({ rank: opts.rank, score: opts.score })}
    <button type="button" class="close" aria-label="Close">✕</button>
  `;
  document.body.appendChild(toast);
  bindShareButtons(toast);
  toast.querySelector<HTMLButtonElement>(".close")!.onclick = () => toast.remove();
  // Auto-dismiss after ~12s.
  setTimeout(() => toast.remove(), 12000);
}

interface MaybeCelebrateOpts {
  slug: string;
  rank: number | null;
  score: number;
}

interface StoredHighWater {
  rank: number | null;
  score: number;
}

function readHighWater(slug: string): StoredHighWater | null {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    return JSON.parse(raw) as StoredHighWater;
  } catch {
    return null;
  }
}

function writeHighWater(slug: string, v: StoredHighWater): void {
  try { localStorage.setItem(storageKey(slug), JSON.stringify(v)); }
  catch { /* ignore quota / private-mode errors */ }
}

/// Decide whether the player crossed a milestone since the last visit and
/// fire the appropriate UI. Fires the **top-10 modal** when previous state
/// wasn't top-10 (or didn't exist) and current rank ≤ 10. Otherwise fires
/// a **toast** for any improvement in (rank, score). No-op if state is
/// the same or worse. Updates the cache on improvement.
export function maybeCelebrate(opts: MaybeCelebrateOpts): void {
  if (opts.score === 0 && opts.rank === null) return; // nothing meaningful to celebrate
  const prev = readHighWater(opts.slug);

  const rankImproved =
    opts.rank !== null && (prev === null || prev.rank === null || opts.rank < prev.rank);
  const scoreImproved = opts.score > (prev?.score ?? 0);
  if (!rankImproved && !scoreImproved) return;

  writeHighWater(opts.slug, { rank: opts.rank, score: opts.score });

  const wasNotTop10 = !prev || prev.rank === null || prev.rank > 10;
  const isTop10Now = opts.rank !== null && opts.rank <= 10;
  if (isTop10Now && wasNotTop10) {
    showTopTenCelebration({ slug: opts.slug, rank: opts.rank!, score: opts.score });
  } else {
    showPbToast({ rank: opts.rank, score: opts.score });
  }
}

// Landing page — pixel-art card grid of available games. Mounts into
// document.body via main.ts when the URL is not a game slug.

import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import { Client, type HighScoreEntry } from "@flight/game-hub-client";
import { CONFIG, requireContractId } from "../chain/config.js";
import { syncLocalBest } from "../chain/score-sync.js";
import { connect, disconnect, getAddress, onWalletChange } from "../chain/wallet.js";
import { GAMES, type GameEntry } from "./games.js";

function strkeyToPubkey(strkey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(strkey));
}

function fmtAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function getReadClient(): Client {
  return new Client({
    contractId: requireContractId(),
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey: undefined,
  });
}

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg: #0a1024;
    --bg-card: #16223a;
    --border: #3a4a6b;
    --border-bright: #6d8fff;
    --accent: #f5d04b;
    --pink: #ff79c6;
    --green: #7aff8e;
    --muted: #94a3c6;

    /* Two-font split:
         pixel — for headers + button labels; chunky, impact, hard to read at body sizes
         body  — for everything you actually need to scan or read */
    --font-pixel: 'Press Start 2P', ui-monospace, SFMono-Regular, Menlo, monospace;
    --font-body: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  #fs-landing {
    position: fixed;
    inset: 0;
    z-index: 200;
    background:
      radial-gradient(ellipse at top, #1a2750 0%, #0a1024 60%, #050a18 100%);
    color: #fff;
    font-family: var(--font-body);
    overflow-y: auto;
    image-rendering: pixelated;
  }

  /* Faint scanline overlay for CRT-ish feel */
  #fs-landing::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      to bottom,
      rgba(255,255,255,0.02) 0,
      rgba(255,255,255,0.02) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    z-index: 1;
  }

  /* Star field */
  #fs-landing .stars {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
  }
  #fs-landing .stars i {
    position: absolute;
    width: 2px; height: 2px;
    background: #fff;
    box-shadow: 0 0 0 0 rgba(255,255,255,0);
    opacity: 0.7;
  }

  #fs-landing .topnav {
    position: relative;
    z-index: 3;
    max-width: 880px;
    margin: 0 auto;
    padding: 20px 24px 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 14px;
  }
  #fs-landing .topnav a,
  #fs-landing .topnav button {
    background: transparent;
    color: var(--muted);
    text-decoration: none;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    padding: 6px 10px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }
  #fs-landing .topnav a:hover,
  #fs-landing .topnav button:hover {
    color: var(--accent);
    border-color: var(--border);
  }
  #fs-landing .topnav .signin {
    color: #fff;
    border-color: var(--border-bright);
  }
  #fs-landing .topnav .signin:hover {
    background: #1c2a4c;
  }
  #fs-landing .topnav .signed {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #d0d8ee;
  }
  #fs-landing .topnav .signed code {
    background: rgba(255,255,255,0.06);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 12px;
  }
  #fs-landing .topnav .signed button {
    padding: 4px 8px;
    font-size: 11px;
  }

  #fs-landing .signin-banner {
    background: rgba(245, 208, 75, 0.08);
    border: 1px dashed rgba(245, 208, 75, 0.4);
    color: #f5d04b;
    font-size: 13px;
    padding: 10px 16px;
    margin: 0 auto 32px;
    max-width: 480px;
    border-radius: 4px;
  }
  #fs-landing .signin-banner button {
    background: transparent;
    color: var(--accent);
    border: none;
    font-family: var(--font-body);
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }
  #fs-landing .signin-banner button:hover { color: #fff; }

  #fs-landing .inner {
    position: relative;
    z-index: 2;
    max-width: 880px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    text-align: center;
  }

  #fs-landing h1 {
    font-family: var(--font-pixel);
    font-size: 36px;
    line-height: 1.05;
    margin: 0 0 22px;
    letter-spacing: 1px;
    color: #fff;
    text-shadow:
      3px 0 0 #5b3aa8,
      6px 3px 0 #2c5dd0,
      9px 6px 0 rgba(0,0,0,0.4);
  }
  #fs-landing h1 .sub {
    font-size: 22px;
    color: var(--accent);
    text-shadow:
      3px 0 0 #6b4a08,
      6px 3px 0 rgba(0,0,0,0.4);
  }

  #fs-landing .subtitle {
    font-size: 14px;
    color: var(--muted);
    margin: 0 0 56px;
    line-height: 1.6;
    letter-spacing: 0.2px;
  }
  #fs-landing .subtitle .accent { color: var(--accent); font-weight: 600; }

  #fs-landing .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 28px;
    margin-bottom: 56px;
  }

  #fs-landing .card {
    background: var(--bg-card);
    border: 4px solid var(--border);
    /* chunky multi-pixel "shadow" via stacked solid box-shadows */
    box-shadow:
      4px 4px 0 var(--border),
      8px 8px 0 rgba(0,0,0,0.5);
    padding: 20px;
    text-align: left;
    cursor: pointer;
    transition: transform 0.08s linear, border-color 0.08s linear;
    text-decoration: none;
    color: inherit;
    display: block;
  }
  #fs-landing .card.live:hover {
    border-color: var(--border-bright);
    transform: translate(-2px, -2px);
    box-shadow:
      6px 6px 0 var(--border-bright),
      12px 12px 0 rgba(0,0,0,0.5);
  }
  #fs-landing .card.live:active {
    transform: translate(2px, 2px);
    box-shadow:
      2px 2px 0 var(--border),
      4px 4px 0 rgba(0,0,0,0.5);
  }
  #fs-landing .card.soon {
    opacity: 0.55;
    cursor: not-allowed;
  }

  #fs-landing .card .thumb {
    width: 100%;
    height: 120px;
    background: #07101f;
    border: 2px solid var(--border);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  #fs-landing .card .thumb img {
    image-rendering: pixelated;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  #fs-landing .card .perk {
    background: linear-gradient(90deg, #b48a00 0%, #f5d04b 50%, #b48a00 100%);
    color: #20140a;
    font-size: 12px;
    font-weight: 600;
    padding: 8px 12px;
    margin: -20px -20px 16px;
    border-bottom: 2px solid #6b4a08;
    letter-spacing: 0.3px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #fs-landing .card .perk::before {
    content: '★';
    font-size: 14px;
  }
  #fs-landing .card .perk a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  #fs-landing .card h2 {
    font-family: var(--font-pixel);
    font-size: 16px;
    margin: 0 0 12px;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  #fs-landing .card .blurb {
    font-size: 14px;
    font-weight: 500;
    color: #e3e8f6;
    line-height: 1.5;
    margin-bottom: 12px;
  }
  #fs-landing .card .desc {
    font-size: 13px;
    color: var(--muted);
    line-height: 1.6;
    margin-bottom: 18px;
  }

  #fs-landing .card .best {
    margin-bottom: 14px;
    padding: 8px 12px;
    background: rgba(245, 208, 75, 0.1);
    border-left: 3px solid var(--accent);
    font-size: 12px;
    color: #d8e0f0;
  }
  #fs-landing .card .best .label { color: var(--muted); }
  #fs-landing .card .best .val {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
    margin-left: 6px;
    vertical-align: middle;
  }
  #fs-landing .card .best.empty {
    background: transparent;
    border-left-color: var(--border);
    color: var(--muted);
    font-style: italic;
  }

  #fs-landing .card .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  #fs-landing .card .play,
  #fs-landing .card .leaderboard {
    display: inline-block;
    text-decoration: none;
    padding: 10px 16px;
    border-width: 2px;
    border-style: solid;
    font-family: var(--font-pixel);
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  #fs-landing .card .play {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border-color: #8a6df0;
  }
  #fs-landing .card .leaderboard {
    background: transparent;
    color: var(--accent);
    border-color: var(--border);
  }
  #fs-landing .card .leaderboard:hover {
    border-color: var(--accent);
  }
  #fs-landing .card.soon .play,
  #fs-landing .card.soon .leaderboard {
    background: #2a2f3f;
    border-color: #3a4456;
    color: #7a86a4;
    pointer-events: none;
  }
  #fs-landing .card.soon .thumb img {
    filter: grayscale(0.6);
  }

  #fs-landing .footer {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.6;
    margin-top: 32px;
  }
  #fs-landing .footer a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  #fs-landing .footer a:hover { text-decoration: underline; }

  @media (max-width: 560px) {
    #fs-landing h1 { font-size: 24px; }
    #fs-landing h1 .sub { font-size: 16px; }
    #fs-landing .subtitle { font-size: 12px; margin-bottom: 36px; }
    #fs-landing .inner { padding: 36px 16px 64px; }
    #fs-landing .card h2 { font-size: 13px; }
    #fs-landing .card .blurb { font-size: 13px; }
    #fs-landing .card .desc { font-size: 12px; }
  }
`;

function makeStars(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "stars";
  // 60 deterministic-ish stars seeded so they don't shift on each mount
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 60; i++) {
    const s = document.createElement("i");
    s.style.left = `${rand() * 100}%`;
    s.style.top = `${rand() * 100}%`;
    const sz = Math.round(rand() * 2) + 1;
    s.style.width = `${sz}px`;
    s.style.height = `${sz}px`;
    s.style.opacity = String(0.3 + rand() * 0.6);
    wrap.appendChild(s);
  }
  return wrap;
}

function makeCard(g: GameEntry): HTMLElement {
  // Outer card is a div now (not an <a>) so the leaderboard link inside
  // doesn't conflict with the main card click target.
  const card = document.createElement("div");
  card.className = `card ${g.status}`;
  card.dataset.slug = g.slug;

  const perkHtml = g.perk
    ? `<div class="perk">${
        g.perk.url
          ? `<a href="${g.perk.url}" target="_blank" rel="noopener">${g.perk.text}</a>`
          : g.perk.text
      }</div>`
    : "";

  const isLive = g.status === "live";
  const playHref = isLive ? `/${g.slug}` : "#";
  const lbHref = isLive ? `/${g.slug}/leaderboard` : "#";

  card.innerHTML = `
    ${perkHtml}
    <div class="thumb">
      <img src="${g.thumb}" alt="${g.title}" onerror="this.style.display='none'">
    </div>
    <h2>${g.title}</h2>
    <div class="blurb">${g.blurb}</div>
    <div class="desc">${g.description}</div>
    <div class="best" data-best style="display:none;"></div>
    <div class="actions">
      <a href="${playHref}" class="play"${isLive ? "" : ' onclick="event.preventDefault()"'}>
        ${isLive ? "▶ PLAY" : "COMING SOON"}
      </a>
      <a href="${lbHref}" class="leaderboard"${isLive ? "" : ' onclick="event.preventDefault()"'}>📊 LEADERBOARD</a>
    </div>
  `;
  return card;
}

/// Fetch get_score for every live game, render an inline best chip on
/// each card, and hydrate localStorage so the in-game HUD's BEST
/// counter matches the chain on fresh browsers. Called when the
/// wallet connects.
async function refreshAllBests(addr: string): Promise<void> {
  if (!CONFIG.gameHubContractId) return;
  const client = getReadClient();
  const pubkey = strkeyToPubkey(addr);

  for (const g of GAMES) {
    if (g.status !== "live" || g.gameId === undefined) continue;
    const card = document.querySelector<HTMLElement>(`.card[data-slug="${g.slug}"] [data-best]`);
    if (!card) continue;
    card.style.display = "block";
    card.innerHTML = `<span class="label">loading your best…</span>`;
    try {
      const res = await client.get_score({
        game_id: g.gameId,
        player_pubkey: pubkey,
      });
      const entry = (res.result as HighScoreEntry | undefined) ?? null;
      if (entry) {
        card.classList.remove("empty");
        card.innerHTML = `<span class="label">your best</span><span class="val">${entry.score}</span>`;
        syncLocalBest(g.slug, entry.score);
      } else {
        card.classList.add("empty");
        card.innerHTML = `no score yet — set one`;
      }
    } catch (e) {
      card.classList.add("empty");
      card.innerHTML = `<span class="label">couldn't load best (${e instanceof Error ? e.message.slice(0, 40) : "error"})</span>`;
    }
  }
}

function clearAllBests(): void {
  document.querySelectorAll<HTMLElement>(`.card [data-best]`).forEach((el) => {
    el.style.display = "none";
    el.innerHTML = "";
    el.classList.remove("empty");
  });
}

export function mountLanding(): void {
  // Inject the stylesheet once.
  if (!document.getElementById("fs-landing-style")) {
    const s = document.createElement("style");
    s.id = "fs-landing-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const root = document.createElement("div");
  root.id = "fs-landing";

  root.appendChild(makeStars());

  const nav = document.createElement("div");
  nav.className = "topnav";
  nav.innerHTML = `<div id="fs-topnav-wallet"></div><a href="/leaderboard">📊 LEADERBOARDS</a>`;
  root.appendChild(nav);

  const inner = document.createElement("div");
  inner.className = "inner";
  inner.innerHTML = `
    <h1>PROOFWORKS<br><span class="sub">ARCADE</span></h1>
    <p class="subtitle">
      <span class="accent">verified</span> high scores · on-chain
    </p>
    <div class="signin-banner" id="fs-signin-banner" style="display:none;"></div>
    <div class="grid" id="fs-landing-grid"></div>
    <div class="footer">
      leaderboards on stellar · <a href="https://github.com/enderNakamoto/flight_runner" target="_blank">github</a>
    </div>
  `;
  root.appendChild(inner);

  const grid = inner.querySelector<HTMLElement>("#fs-landing-grid")!;
  for (const g of GAMES) grid.appendChild(makeCard(g));

  // Hide the Phaser canvas while landing is up.
  const game = document.getElementById("game");
  if (game) game.style.display = "none";

  document.body.appendChild(root);

  // ── Sign-in wiring ─────────────────────────────────────────────────
  const walletSlot = root.querySelector<HTMLElement>("#fs-topnav-wallet")!;
  const banner = root.querySelector<HTMLElement>("#fs-signin-banner")!;

  async function doSignIn(): Promise<void> {
    try {
      await connect();
      // onWalletChange will re-render and fetch bests.
    } catch {
      // User cancelled wallet picker — no banner, no error toast,
      // they can hit Sign In again whenever.
    }
  }

  function renderTopnavWallet(addr: string | null): void {
    walletSlot.innerHTML = "";
    if (addr) {
      const wrap = document.createElement("span");
      wrap.className = "signed";
      wrap.innerHTML = `<code>${fmtAddress(addr)}</code>`;
      const dc = document.createElement("button");
      dc.textContent = "sign out";
      dc.onclick = () => disconnect();
      wrap.appendChild(dc);
      walletSlot.appendChild(wrap);
    } else {
      const btn = document.createElement("button");
      btn.className = "signin";
      btn.textContent = "SIGN IN";
      btn.onclick = doSignIn;
      walletSlot.appendChild(btn);
    }
  }

  function renderBanner(addr: string | null): void {
    if (addr) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "block";
    banner.innerHTML = `
      <strong>Sign in</strong> to see your best scores on-chain.
      <button id="fs-banner-signin">Sign in now</button>
    `;
    banner.querySelector<HTMLButtonElement>("#fs-banner-signin")!.onclick = doSignIn;
  }

  onWalletChange((addr) => {
    renderTopnavWallet(addr);
    renderBanner(addr);
    if (addr) refreshAllBests(addr).catch(() => {});
    else clearAllBests();
  });
}

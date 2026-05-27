// Leaderboard pages. Two views:
//   /leaderboard                   → all-games index (links to each)
//   /<game_slug>/leaderboard       → that game's lookup-by-address view
//
// V1 leaderboard is an address-lookup form: paste your G… address,
// fetch get_score(game_id, pubkey) from the contract. A real "top N"
// view needs an off-chain indexer (watch `pb` events) — a clean
// extension once usage warrants it.

import { StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { CONFIG, requireContractId } from "../chain/config.js";
import { Client, type HighScoreEntry } from "@flight/game-hub-client";
import { connect, getAddress, onWalletChange } from "../chain/wallet.js";
import { rewardsCalloutHtml } from "../ui/rewards-callout.js";
import { GAMES, type GameEntry } from "./games.js";

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg-card: #16223a;
    --border: #3a4a6b;
    --border-bright: #6d8fff;
    --accent: #f5d04b;
    --muted: #94a3c6;
    --font-pixel: 'Press Start 2P', ui-monospace, SFMono-Regular, Menlo, monospace;
    --font-body: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #fs-lb {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: radial-gradient(ellipse at top, #1a2750 0%, #0a1024 60%, #050a18 100%);
    color: #fff;
    font-family: var(--font-body);
    overflow-y: auto;
  }
  #fs-lb .topnav {
    max-width: 880px;
    margin: 0 auto;
    padding: 20px 24px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #fs-lb .topnav a {
    color: var(--muted);
    text-decoration: none;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid transparent;
  }
  #fs-lb .topnav a:hover {
    color: var(--accent);
    border-color: var(--border);
  }
  #fs-lb .inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px 96px;
  }
  #fs-lb h1 {
    font-family: var(--font-pixel);
    font-size: 22px;
    line-height: 1.2;
    text-align: center;
    margin: 0 0 14px;
    text-shadow:
      3px 0 0 #5b3aa8,
      6px 3px 0 #2c5dd0,
      9px 6px 0 rgba(0,0,0,0.4);
  }
  #fs-lb h2 {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
    margin: 28px 0 14px;
  }
  #fs-lb .subtitle {
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    margin: 0 0 32px;
  }
  #fs-lb .games {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  #fs-lb .game-row {
    background: var(--bg-card);
    border: 3px solid var(--border);
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.1s;
  }
  #fs-lb .game-row:hover {
    border-color: var(--border-bright);
  }
  #fs-lb .game-row .name {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
  }
  #fs-lb .game-row .arrow {
    color: var(--muted);
    font-size: 18px;
  }
  #fs-lb .you {
    background: var(--bg-card);
    border: 3px solid var(--border);
    padding: 20px;
    margin-top: 8px;
  }
  #fs-lb .you .addr {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 14px;
    word-break: break-all;
  }
  #fs-lb .you .addr code {
    background: rgba(255,255,255,0.06);
    padding: 2px 6px;
    border-radius: 3px;
  }
  #fs-lb .you button {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border: 2px solid #8a6df0;
    padding: 10px 18px;
    font-family: var(--font-pixel);
    font-size: 11px;
    cursor: pointer;
  }
  #fs-lb .you button:disabled { opacity: 0.6; cursor: not-allowed; }
  #fs-lb .result {
    padding: 16px;
    background: #0a1024;
    border: 2px solid var(--border);
    font-size: 13px;
    line-height: 1.7;
  }
  #fs-lb .result .row     { display: flex; justify-content: space-between; gap: 12px; }
  #fs-lb .result .label   { color: var(--muted); }
  #fs-lb .result .val     { color: var(--accent); font-weight: 600; }
  #fs-lb .result .big     { font-size: 22px; font-family: var(--font-pixel); }
  #fs-lb .result.err      { border-color: #6b2a2a; color: #ff9090; }
  #fs-lb .result.empty    { color: var(--muted); font-style: italic; }
`;

function injectStyle(): void {
  if (document.getElementById("fs-lb-style")) return;
  const s = document.createElement("style");
  s.id = "fs-lb-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function getReadClient(): Client {
  return new Client({
    contractId: requireContractId(),
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey: undefined,
  });
}

function strkeyToPubkey(strkey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(strkey));
}

function topnav(extraRight: string = ""): string {
  return `
    <div class="topnav">
      <a href="/">← BACK TO ARCADE</a>
      <span>${extraRight}</span>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// /leaderboard — index of all games
// ─────────────────────────────────────────────────────────────────────

export function mountAllLeaderboards(): void {
  injectStyle();
  const root = document.createElement("div");
  root.id = "fs-lb";
  root.innerHTML = `
    ${topnav()}
    <div class="inner">
      <h1>LEADERBOARDS</h1>
      <p class="subtitle">all games — pick one to look up scores</p>
      <div class="games" id="fs-lb-games"></div>
    </div>
  `;
  document.body.appendChild(root);

  const games = root.querySelector<HTMLElement>("#fs-lb-games")!;
  for (const g of GAMES) {
    const row = document.createElement("a");
    row.className = "game-row";
    row.href = `/${g.slug}/leaderboard`;
    row.innerHTML = `
      <span class="name">${g.title}</span>
      <span class="arrow">→</span>
    `;
    games.appendChild(row);
  }
}

// ─────────────────────────────────────────────────────────────────────
// /<slug>/leaderboard — single-game lookup
// ─────────────────────────────────────────────────────────────────────

export function mountGameLeaderboard(game: GameEntry): void {
  injectStyle();
  const root = document.createElement("div");
  root.id = "fs-lb";
  root.innerHTML = `
    ${topnav(`<a href="/${game.slug}">▶ play this game</a>`)}
    <div class="inner">
      <h1>${game.title}<br>LEADERBOARD</h1>
      ${rewardsCalloutHtml()}
      <h2>Top scores</h2>
      <div class="result empty">Top scores coming soon.</div>
      <h2>Your best</h2>
      <div class="you" id="fs-lb-you"></div>
    </div>
  `;
  document.body.appendChild(root);

  const youEl = root.querySelector<HTMLDivElement>("#fs-lb-you")!;

  function renderConnect() {
    youEl.innerHTML = `
      <div style="margin-bottom: 14px; color: var(--muted); font-size: 13px;">
        Connect your Stellar wallet to see your best run on chain.
      </div>
      <button id="fs-lb-connect">CONNECT WALLET</button>
    `;
    const btn = youEl.querySelector<HTMLButtonElement>("#fs-lb-connect")!;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "OPENING WALLET…";
      try {
        await connect();
        // onWalletChange will re-render with the loaded address.
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        renderError(m);
      }
    };
  }

  function renderError(msg: string) {
    youEl.innerHTML = `<div class="result err">${msg}</div>`;
  }

  function renderLoading(addr: string) {
    youEl.innerHTML = `
      <div class="addr"><code>${fmtAddress(addr)}</code></div>
      <div class="result empty">Loading your score…</div>
    `;
  }

  function renderScore(addr: string, e: HighScoreEntry | null) {
    if (!e) {
      youEl.innerHTML = `
        <div class="addr"><code>${fmtAddress(addr)}</code></div>
        <div class="result empty">
          You haven't submitted a score yet.
          <a href="/${game.slug}" style="color: var(--accent); margin-left: 8px;">▶ play</a>
        </div>
      `;
      return;
    }
    const settledDate = new Date(Number(e.settled_at) * 1000).toISOString().slice(0, 10);
    youEl.innerHTML = `
      <div class="addr"><code>${fmtAddress(addr)}</code></div>
      <div class="result">
        <div class="row"><span class="label">score</span><span class="val big">${e.score}</span></div>
        <div class="row"><span class="label">ticks survived</span><span class="val">${e.ticks_survived}</span></div>
        <div class="row"><span class="label">seed</span><code>0x${(e.seed >>> 0).toString(16).padStart(8, "0")}</code></div>
        <div class="row"><span class="label">settled</span>${settledDate}</div>
      </div>
    `;
  }

  async function fetchAndRender(addr: string) {
    renderLoading(addr);
    try {
      if (!CONFIG.gameHubContractId) {
        throw new Error("VITE_GAME_HUB_CONTRACT_ID not set");
      }
      const pubkey = strkeyToPubkey(addr);
      const client = getReadClient();
      const res = await client.get_score({
        game_id: CONFIG.flightScrollGameId,
        player_pubkey: pubkey,
      });
      const entry = (res.result as HighScoreEntry | undefined) ?? null;
      renderScore(addr, entry);
    } catch (e) {
      renderError(e instanceof Error ? e.message : String(e));
    }
  }

  // React to wallet connect / disconnect throughout the page lifetime.
  onWalletChange((addr) => {
    if (addr) fetchAndRender(addr);
    else renderConnect();
  });

  // Initial render. If a wallet is already connected (because the player
  // came from the submit flow earlier), this immediately fetches; if
  // not, it shows the connect button.
  const current = getAddress();
  if (current) fetchAndRender(current);
  else renderConnect();
}

function fmtAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-6)}`;
}

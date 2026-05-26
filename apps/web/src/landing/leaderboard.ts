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
import { findGame, GAMES, type GameEntry } from "./games.js";

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
  #fs-lb .lookup {
    background: var(--bg-card);
    border: 3px solid var(--border);
    padding: 20px;
    margin-top: 8px;
  }
  #fs-lb .lookup label {
    display: block;
    font-size: 12px;
    margin-bottom: 8px;
    color: var(--muted);
  }
  #fs-lb .lookup input {
    width: 100%;
    background: #0a1024;
    color: #fff;
    border: 2px solid var(--border);
    padding: 10px 12px;
    font-family: var(--font-body);
    font-size: 13px;
    box-sizing: border-box;
  }
  #fs-lb .lookup input:focus {
    outline: none;
    border-color: var(--border-bright);
  }
  #fs-lb .lookup button {
    margin-top: 12px;
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border: 2px solid #8a6df0;
    padding: 10px 18px;
    font-family: var(--font-pixel);
    font-size: 11px;
    cursor: pointer;
  }
  #fs-lb .lookup button:disabled { opacity: 0.6; cursor: not-allowed; }
  #fs-lb .result {
    margin-top: 18px;
    padding: 16px;
    background: #0a1024;
    border: 2px solid var(--border);
    font-size: 13px;
    line-height: 1.7;
  }
  #fs-lb .result .label { color: var(--muted); }
  #fs-lb .result .val   { color: var(--accent); font-weight: 600; }
  #fs-lb .result.err    { border-color: #6b2a2a; color: #ff9090; }
  #fs-lb .result.empty  { color: var(--muted); font-style: italic; }
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
      <p class="subtitle">paste any Stellar G-address to see their personal best on-chain</p>
      <div class="lookup">
        <label for="fs-lb-addr">Stellar address</label>
        <input id="fs-lb-addr" placeholder="G…" spellcheck="false" autocomplete="off">
        <button id="fs-lb-go">LOOK UP</button>
        <div id="fs-lb-out"></div>
      </div>
      <h2>Top scores</h2>
      <div class="result empty">
        a top-N leaderboard needs an off-chain indexer that watches the contract's
        <code>pb</code> events. coming when there are enough scores to be interesting.
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const input = root.querySelector<HTMLInputElement>("#fs-lb-addr")!;
  const btn = root.querySelector<HTMLButtonElement>("#fs-lb-go")!;
  const out = root.querySelector<HTMLDivElement>("#fs-lb-out")!;

  // Pre-fill from URL hash so /flight_scroll/leaderboard#G... auto-runs.
  const hashAddr = window.location.hash.replace(/^#/, "");
  if (hashAddr.startsWith("G")) {
    input.value = hashAddr;
    setTimeout(() => btn.click(), 0);
  }

  const renderEntry = (e: HighScoreEntry | null) => {
    if (!e) {
      out.innerHTML = `<div class="result empty">No score on chain yet for this address.</div>`;
      return;
    }
    const settledDate = new Date(Number(e.settled_at) * 1000).toISOString().slice(0, 19) + "Z";
    out.innerHTML = `
      <div class="result">
        <div><span class="label">score:</span> <span class="val">${e.score}</span></div>
        <div><span class="label">ticks survived:</span> <span class="val">${e.ticks_survived}</span></div>
        <div><span class="label">seed:</span> <code>0x${(e.seed >>> 0).toString(16).padStart(8, "0")}</code></div>
        <div><span class="label">settled at:</span> ${settledDate}</div>
      </div>
    `;
  };

  btn.onclick = async () => {
    const strkey = input.value.trim();
    if (!strkey) return;
    btn.disabled = true;
    out.innerHTML = `<div class="result empty">Loading…</div>`;
    try {
      if (!CONFIG.gameHubContractId) {
        throw new Error("VITE_GAME_HUB_CONTRACT_ID not set");
      }
      const pubkey = strkeyToPubkey(strkey);
      const client = getReadClient();
      const res = await client.get_score({
        // game_id matches what scripts/deploy.sh registered. Hardcoded
        // to 1 today since flight_scroll is the only game; if we add more
        // we'll thread the game_id through from games.ts.
        game_id: CONFIG.flightScrollGameId,
        player_pubkey: pubkey,
      });
      const entry = (res.result as HighScoreEntry | undefined) ?? null;
      renderEntry(entry);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      out.innerHTML = `<div class="result err">${m}</div>`;
    } finally {
      btn.disabled = false;
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });
}

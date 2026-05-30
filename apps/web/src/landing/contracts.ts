// /contracts — on-chain reference for the arcade.
//   1. Static — network info, registered games, the game_hub address.
//   2. Live panel — verifier, trusted operator, per-game image_id +
//      player_count (queried on mount; refreshable; errors inline).
//   3. Query-a-score — paste a G… address, see that player's PB for
//      each registered game.
//
// Network split (testnet / mainnet) is structural — extending to
// mainnet = one more entry in buildBlocks() referencing a new
// VITE_GAME_HUB_CONTRACT_ID_MAINNET build var.

import { Client, type HighScoreEntry } from "@flight/game-hub-client";
import { StrKey } from "@stellar/stellar-sdk";
import { CONFIG } from "../chain/config.js";
import { getAddress } from "../chain/wallet.js";
import { GAMES } from "./games.js";

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg-card: #16223a;
    --bg-card-soft: #131c30;
    --border: #3a4a6b;
    --border-bright: #6d8fff;
    --accent: #f5d04b;
    --muted: #94a3c6;
    --good: #7aff8e;
    --warn: #ff9c5b;
    --font-pixel: 'Press Start 2P', ui-monospace, Menlo, monospace;
    --font-body: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  }

  #fs-contracts {
    position: fixed; inset: 0; z-index: 200;
    background: radial-gradient(ellipse at top, #1a2750 0%, #0a1024 60%, #050a18 100%);
    color: #fff;
    font-family: var(--font-body);
    overflow-y: auto;
  }
  #fs-contracts .topnav {
    max-width: 980px; margin: 0 auto;
    padding: 20px 24px 0;
    display: flex; justify-content: space-between; align-items: center;
  }
  #fs-contracts .topnav a {
    color: var(--muted);
    text-decoration: none;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid transparent;
  }
  #fs-contracts .topnav a:hover {
    color: var(--accent);
    border-color: var(--border);
  }

  #fs-contracts .inner {
    max-width: 880px; margin: 0 auto;
    padding: 24px 24px 96px;
  }
  #fs-contracts h1 {
    font-family: var(--font-pixel);
    font-size: 30px;
    text-align: center;
    margin: 16px 0 14px;
    text-shadow:
      3px 0 0 #5b3aa8,
      6px 3px 0 #2c5dd0,
      9px 6px 0 rgba(0,0,0,0.4);
    line-height: 1.1;
  }
  #fs-contracts .lede {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    margin: 0 auto 32px;
    max-width: 640px;
  }

  /* Section heading for each network (Testnet today; Mainnet later). */
  #fs-contracts .net-head {
    max-width: 760px;
    margin: 32px auto 12px;
    padding: 0 4px 8px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid var(--border);
  }
  #fs-contracts .net-head h2 {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
    margin: 0;
    letter-spacing: 0.5px;
  }
  #fs-contracts .net-head .meta {
    color: var(--muted);
    font-size: 12px;
  }

  #fs-contracts .net,
  #fs-contracts .games {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 14px 18px;
    margin: 0 auto 18px;
    max-width: 760px;
    font-size: 13px;
    color: #d8e0f0;
  }
  #fs-contracts .games { background: var(--bg-card-soft); }
  #fs-contracts .net .row,
  #fs-contracts .games .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
    border-top: 1px dashed var(--border);
  }
  #fs-contracts .net .row:first-of-type,
  #fs-contracts .games .row:first-of-type { border-top: none; }
  #fs-contracts .net .row .k,
  #fs-contracts .games .row .k { color: var(--muted); }
  #fs-contracts .net .row .v { color: #fff; word-break: break-all; text-align: right; }
  #fs-contracts .games .id {
    font-family: var(--font-pixel);
    font-size: 11px;
    color: var(--accent);
    min-width: 60px;
  }
  #fs-contracts .games .name { color: #fff; }
  #fs-contracts .games .slug { color: var(--muted); font-size: 12px; }

  #fs-contracts .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: 4px;
    padding: 18px 22px;
    margin: 0 auto 18px;
    max-width: 760px;
  }
  #fs-contracts .card .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  #fs-contracts .card .title {
    font-family: var(--font-pixel);
    font-size: 12px;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  #fs-contracts .card .badge {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  #fs-contracts .card .desc {
    color: #c0c8de;
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 12px;
  }
  #fs-contracts .card .id {
    background: #0c1428;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 10px 12px;
    font-size: 12px;
    color: #d8e0f0;
    word-break: break-all;
    margin-bottom: 8px;
  }
  #fs-contracts .card .actions {
    display: flex;
    gap: 10px;
    font-size: 12px;
  }
  #fs-contracts .card .actions a,
  #fs-contracts .card .actions button {
    color: var(--accent);
    text-decoration: none;
    border: 1px solid var(--border);
    background: transparent;
    padding: 4px 10px;
    border-radius: 3px;
    font-family: var(--font-body);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }
  #fs-contracts .card .actions a:hover,
  #fs-contracts .card .actions button:hover {
    color: #fff;
    border-color: var(--border-bright);
  }

  /* Live-state panel. */
  #fs-contracts .live {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 18px 22px;
    margin: 0 auto 18px;
    max-width: 760px;
  }
  #fs-contracts .live .live-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  #fs-contracts .live .live-head h3 {
    font-family: var(--font-pixel);
    font-size: 12px;
    color: var(--accent);
    margin: 0;
    letter-spacing: 0.5px;
  }
  #fs-contracts .live .live-head .live-meta {
    color: var(--muted);
    font-size: 11px;
  }
  #fs-contracts .live .blurb {
    color: var(--muted);
    font-size: 12px;
    margin: 4px 0 14px;
  }
  #fs-contracts .live .live-row {
    padding: 10px 0;
    border-top: 1px dashed var(--border);
  }
  #fs-contracts .live .live-row:first-of-type { border-top: none; }
  #fs-contracts .live .live-row .k {
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
  }
  #fs-contracts .live .live-row .k .hint { color: #b0bbd8; font-size: 11px; }
  #fs-contracts .live .live-row .v {
    background: #0c1428;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 8px 10px;
    font-size: 12px;
    color: #fff;
    word-break: break-all;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }
  #fs-contracts .live .live-row .v.muted { color: var(--muted); }
  #fs-contracts .live .live-row .v.error { color: var(--warn); }
  #fs-contracts .live .live-row .v a {
    color: var(--accent);
    text-decoration: none;
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    flex-shrink: 0;
  }
  #fs-contracts .live .live-row .v a:hover { color: #fff; border-color: var(--border-bright); }
  #fs-contracts .live .live-row .v .raw { color: var(--muted); font-size: 11px; }
  #fs-contracts .live .refresh {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 3px 10px;
    font-family: var(--font-body);
    font-size: 11px;
    cursor: pointer;
  }
  #fs-contracts .live .refresh:hover { color: var(--accent); border-color: var(--border-bright); }

  /* Query-a-score widget */
  #fs-contracts .query {
    max-width: 760px;
    margin: 32px auto 0;
  }
  #fs-contracts .query .query-head {
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
    margin-bottom: 14px;
  }
  #fs-contracts .query .query-head h2 {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
    margin: 0 0 4px;
    letter-spacing: 0.5px;
  }
  #fs-contracts .query .query-head .sub {
    color: var(--muted);
    font-size: 12px;
  }
  #fs-contracts .query .box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 14px 18px;
    margin-bottom: 12px;
  }
  #fs-contracts .query .controls {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  #fs-contracts .query input[type="text"] {
    flex: 1 1 320px;
    min-width: 280px;
    background: #0c1428;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: #fff;
    font-family: var(--font-body);
    font-size: 12px;
    padding: 8px 10px;
    outline: none;
  }
  #fs-contracts .query input[type="text"]:focus { border-color: var(--border-bright); }
  #fs-contracts .query button.query-go {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    border: 1px solid #8a6df0;
    color: #fff;
    font-family: var(--font-pixel);
    font-size: 10px;
    letter-spacing: 0.5px;
    padding: 8px 14px;
    border-radius: 3px;
    cursor: pointer;
  }
  #fs-contracts .query button.query-go:hover {
    background: linear-gradient(135deg, #6d4ac0 0%, #3a72e8 100%);
  }
  #fs-contracts .query button.query-go:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  #fs-contracts .query .results { margin-top: 14px; }
  #fs-contracts .query .result {
    background: #0c1428;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  #fs-contracts .query .result .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 4px;
  }
  #fs-contracts .query .result .head .game {
    font-family: var(--font-pixel);
    font-size: 11px;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  #fs-contracts .query .result .head .state {
    font-size: 11px;
    color: var(--muted);
  }
  #fs-contracts .query .result .state.ok { color: var(--good); }
  #fs-contracts .query .result .state.empty { color: var(--muted); }
  #fs-contracts .query .result .state.error { color: var(--warn); }
  #fs-contracts .query .result .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px 16px;
    font-size: 12px;
    color: #d8e0f0;
  }
  #fs-contracts .query .result .grid .k { color: var(--muted); }
  #fs-contracts .query .result .grid .v { color: #fff; }
  #fs-contracts .query .msg {
    font-size: 12px;
    color: var(--muted);
    padding: 4px 2px;
  }
  #fs-contracts .query .msg.error { color: var(--warn); }

  #fs-contracts .foot {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    margin-top: 32px;
  }
`;

type Network = "testnet" | "public";
const ACTIVE_NETWORK: Network = CONFIG.networkPassphrase.toLowerCase().includes("public")
  ? "public"
  : "testnet";

function contractUrl(net: Network, id: string): string {
  return `https://stellar.expert/explorer/${net}/contract/${id}`;
}
function accountUrl(net: Network, g: string): string {
  return `https://stellar.expert/explorer/${net}/account/${g}`;
}

interface NetworkBlock {
  network: Network;
  label: string;
  passphrase: string;
  rpc: string;
  gameHubId: string;
}

function buildBlocks(): NetworkBlock[] {
  const testnet: NetworkBlock = {
    network: "testnet",
    label: "TESTNET",
    passphrase: "Test SDF Network ; September 2015",
    rpc: "https://soroban-testnet.stellar.org",
    gameHubId: ACTIVE_NETWORK === "testnet" ? CONFIG.gameHubContractId : "",
  };
  return [testnet];
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function liveGames(): { gameId: number; title: string; slug: string }[] {
  return GAMES.filter((g) => g.status === "live" && typeof g.gameId === "number").map(
    (g) => ({ gameId: g.gameId as number, title: g.title, slug: g.slug }),
  );
}

function shortHex(hex: string): string {
  if (hex.length <= 18) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-8)}`;
}

function readClient(contractId: string): Client {
  return new Client({
    contractId,
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey: undefined,
  });
}

/// Result row helper. `val` is the raw value (string or undefined),
/// `link` is the optional explorer URL.
function renderRow(opts: {
  label: string;
  hint?: string;
  state: "loading" | "ok" | "empty" | "error";
  value?: string;
  link?: string;
  raw?: string;
}): string {
  const { label, hint = "", state, value = "", link, raw } = opts;
  let body = "";
  if (state === "loading") {
    body = `<div class="v muted"><span>loading…</span></div>`;
  } else if (state === "empty") {
    body = `<div class="v muted"><span>not set</span></div>`;
  } else if (state === "error") {
    body = `<div class="v error"><span>read failed${value ? ` — ${escape(value)}` : ""}</span></div>`;
  } else {
    body = `<div class="v"><span>${escape(value)}${raw ? ` <span class="raw">(${escape(raw)})</span>` : ""}</span>${
      link
        ? `<a href="${link}" target="_blank" rel="noreferrer noopener">↗ open</a>`
        : ""
    }</div>`;
  }
  return `
    <div class="live-row" data-row="${escape(label)}">
      <div class="k"><span>${escape(label)}</span>${hint ? `<span class="hint">${escape(hint)}</span>` : ""}</div>
      ${body}
    </div>
  `;
}

interface LiveState {
  imageIds: Map<number, { status: "loading" | "ok" | "empty" | "error"; hex?: string; error?: string }>;
  playerCounts: Map<number, { status: "loading" | "ok" | "error"; count?: number; error?: string }>;
  verifier: { status: "loading" | "ok" | "empty" | "error"; address?: string; error?: string };
  trustedOperator: {
    status: "loading" | "ok" | "empty" | "error";
    pubkeyHex?: string;
    pubkeyG?: string;
    error?: string;
  };
}

function buildLivePanel(b: NetworkBlock, games: { gameId: number; title: string }[], st: LiveState): string {
  const verifierRow = (() => {
    const r = st.verifier;
    if (r.status === "loading") return renderRow({ label: "Verifier (wired)", hint: "game_hub.get_verifier()", state: "loading" });
    if (r.status === "empty") return renderRow({ label: "Verifier (wired)", hint: "game_hub.get_verifier()", state: "empty" });
    if (r.status === "error")
      return renderRow({ label: "Verifier (wired)", hint: "game_hub.get_verifier()", state: "error", value: r.error });
    return renderRow({
      label: "Verifier (wired)",
      hint: "game_hub.get_verifier()",
      state: "ok",
      value: r.address!,
      link: r.address ? contractUrl(b.network, r.address) : undefined,
    });
  })();

  const operatorRow = (() => {
    const r = st.trustedOperator;
    if (r.status === "loading")
      return renderRow({ label: "Trusted operator", hint: "game_hub.get_trusted_operator()", state: "loading" });
    if (r.status === "empty")
      return renderRow({ label: "Trusted operator", hint: "game_hub.get_trusted_operator()", state: "empty" });
    if (r.status === "error")
      return renderRow({
        label: "Trusted operator",
        hint: "game_hub.get_trusted_operator()",
        state: "error",
        value: r.error,
      });
    return renderRow({
      label: "Trusted operator",
      hint: "game_hub.get_trusted_operator()",
      state: "ok",
      value: r.pubkeyG!,
      raw: r.pubkeyHex ? shortHex(r.pubkeyHex) : undefined,
      link: r.pubkeyG ? accountUrl(b.network, r.pubkeyG) : undefined,
    });
  })();

  const perGameRows = games
    .map((g) => {
      const img = st.imageIds.get(g.gameId);
      const pc = st.playerCounts.get(g.gameId);
      const imageRow = (() => {
        if (!img) return "";
        const label = `Game ${g.gameId} image_id`;
        const hint = `${g.title} · get_image_id(${g.gameId})`;
        if (img.status === "loading") return renderRow({ label, hint, state: "loading" });
        if (img.status === "empty") return renderRow({ label, hint, state: "empty" });
        if (img.status === "error") return renderRow({ label, hint, state: "error", value: img.error });
        return renderRow({ label, hint, state: "ok", value: img.hex! });
      })();
      const countRow = (() => {
        if (!pc) return "";
        const label = `Game ${g.gameId} player_count`;
        const hint = `${g.title} · get_player_count(${g.gameId})`;
        if (pc.status === "loading") return renderRow({ label, hint, state: "loading" });
        if (pc.status === "error") return renderRow({ label, hint, state: "error", value: pc.error });
        return renderRow({ label, hint, state: "ok", value: String(pc.count!) });
      })();
      return imageRow + countRow;
    })
    .join("");

  return `
    <div class="live">
      <div class="live-head">
        <h3>LIVE CONTRACT STATE</h3>
        <button class="refresh" id="fs-contracts-refresh">refresh</button>
      </div>
      <div class="blurb">Fetched on page load directly from <code>game_hub</code>. Reflects the chain right now.</div>
      ${verifierRow}
      ${operatorRow}
      ${perGameRows}
    </div>
  `;
}

async function fetchLiveState(
  b: NetworkBlock,
  games: { gameId: number; title: string }[],
): Promise<LiveState> {
  const state: LiveState = {
    imageIds: new Map(),
    playerCounts: new Map(),
    verifier: { status: "loading" },
    trustedOperator: { status: "loading" },
  };
  if (!b.gameHubId) {
    state.verifier = { status: "error", error: "game_hub not configured" };
    state.trustedOperator = { status: "error", error: "game_hub not configured" };
    for (const g of games) {
      state.imageIds.set(g.gameId, { status: "error", error: "game_hub not configured" });
      state.playerCounts.set(g.gameId, { status: "error", error: "game_hub not configured" });
    }
    return state;
  }

  const client = readClient(b.gameHubId);

  // Verifier
  try {
    const tx = await client.get_verifier();
    const addr = tx.result as string | undefined;
    state.verifier = addr ? { status: "ok", address: addr } : { status: "empty" };
  } catch (e) {
    state.verifier = { status: "error", error: e instanceof Error ? e.message : String(e) };
  }

  // Trusted operator
  try {
    const tx = await client.get_trusted_operator();
    const raw = tx.result as Buffer | undefined;
    if (raw && raw.length === 32) {
      const hex = Buffer.from(raw).toString("hex");
      const g = StrKey.encodeEd25519PublicKey(raw);
      state.trustedOperator = { status: "ok", pubkeyHex: hex, pubkeyG: g };
    } else {
      state.trustedOperator = { status: "empty" };
    }
  } catch (e) {
    state.trustedOperator = { status: "error", error: e instanceof Error ? e.message : String(e) };
  }

  // Per-game reads in parallel.
  await Promise.all(
    games.map(async (g) => {
      const imgPromise = (async () => {
        try {
          const tx = await client.get_image_id({ game_id: g.gameId });
          const buf = tx.result as Buffer | undefined;
          if (buf && buf.length === 32) {
            state.imageIds.set(g.gameId, { status: "ok", hex: Buffer.from(buf).toString("hex") });
          } else {
            state.imageIds.set(g.gameId, { status: "empty" });
          }
        } catch (e) {
          state.imageIds.set(g.gameId, {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      const countPromise = (async () => {
        try {
          const tx = await client.get_player_count({ game_id: g.gameId });
          const n = tx.result as number;
          state.playerCounts.set(g.gameId, { status: "ok", count: n });
        } catch (e) {
          state.playerCounts.set(g.gameId, {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      await Promise.all([imgPromise, countPromise]);
    }),
  );

  return state;
}

export function mountContracts(): void {
  if (!document.getElementById("fs-contracts-style")) {
    const s = document.createElement("style");
    s.id = "fs-contracts-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const blocks = buildBlocks();
  const games = liveGames();

  const root = document.createElement("div");
  root.id = "fs-contracts";

  const initialLive: LiveState = {
    imageIds: new Map(games.map((g) => [g.gameId, { status: "loading" as const }])),
    playerCounts: new Map(games.map((g) => [g.gameId, { status: "loading" as const }])),
    verifier: { status: "loading" },
    trustedOperator: { status: "loading" },
  };

  // Single delegated click listener — survives re-renders since
  // innerHTML rewrites only blow away child nodes, not listeners on
  // the root element itself.
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "BUTTON" && t.dataset.copy) {
      navigator.clipboard
        .writeText(t.dataset.copy)
        .then(() => {
          const prev = t.textContent;
          t.textContent = "copied!";
          setTimeout(() => {
            t.textContent = prev;
          }, 1200);
        })
        .catch(() => {
          /* no-op */
        });
      return;
    }
    if (t.id === "fs-contracts-refresh") {
      void refresh();
      return;
    }
    if (t.id === "fs-query-go") {
      void runQuery();
    }
  });

  // Submit query when Enter is pressed in the input.
  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.id === "fs-query-input" && (e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void runQuery();
    }
  });

  async function runQuery() {
    const b = blocks[0]!;
    const input = root.querySelector<HTMLInputElement>("#fs-query-input");
    const msgEl = root.querySelector<HTMLDivElement>("#fs-query-msg");
    const resultsEl = root.querySelector<HTMLDivElement>("#fs-query-results");
    const btn = root.querySelector<HTMLButtonElement>("#fs-query-go");
    if (!input || !msgEl || !resultsEl || !btn) return;

    const raw = input.value.trim();
    if (!raw) {
      msgEl.className = "msg error";
      msgEl.textContent = "Enter a G… address first.";
      resultsEl.innerHTML = "";
      return;
    }
    let pubkey: Buffer;
    try {
      pubkey = Buffer.from(StrKey.decodeEd25519PublicKey(raw));
    } catch {
      msgEl.className = "msg error";
      msgEl.textContent = "That doesn't look like a Stellar G… address.";
      resultsEl.innerHTML = "";
      return;
    }
    if (!b.gameHubId) {
      msgEl.className = "msg error";
      msgEl.textContent = "game_hub not configured for this build.";
      return;
    }

    btn.disabled = true;
    msgEl.className = "msg";
    msgEl.textContent = `Querying score for ${raw.slice(0, 8)}…${raw.slice(-6)} across ${games.length} game${games.length === 1 ? "" : "s"}…`;
    resultsEl.innerHTML = games
      .map(
        (g) => `
        <div class="result" data-game-id="${g.gameId}">
          <div class="head">
            <div class="game">${escape(g.title)} · id ${g.gameId}</div>
            <div class="state">loading…</div>
          </div>
        </div>
      `,
      )
      .join("");

    const client = readClient(b.gameHubId);
    await Promise.all(
      games.map(async (g) => {
        const card = resultsEl.querySelector<HTMLDivElement>(`.result[data-game-id="${g.gameId}"]`);
        if (!card) return;
        try {
          const tx = await client.get_score({ game_id: g.gameId, player_pubkey: pubkey });
          const entry = tx.result as HighScoreEntry | undefined;
          if (!entry) {
            card.innerHTML = `
              <div class="head">
                <div class="game">${escape(g.title)} · id ${g.gameId}</div>
                <div class="state empty">no score yet</div>
              </div>
            `;
            return;
          }
          const settledAt = new Date(Number(entry.settled_at) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
          card.innerHTML = `
            <div class="head">
              <div class="game">${escape(g.title)} · id ${g.gameId}</div>
              <div class="state ok">found</div>
            </div>
            <div class="grid">
              <div><span class="k">score</span><br><span class="v">${entry.score}</span></div>
              <div><span class="k">ticks survived</span><br><span class="v">${entry.ticks_survived}</span></div>
              <div><span class="k">seed</span><br><span class="v">0x${entry.seed.toString(16).padStart(8, "0")}</span></div>
              <div><span class="k">settled at</span><br><span class="v">${settledAt}</span></div>
            </div>
          `;
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          card.innerHTML = `
            <div class="head">
              <div class="game">${escape(g.title)} · id ${g.gameId}</div>
              <div class="state error">read failed: ${escape(err.slice(0, 80))}</div>
            </div>
          `;
        }
      }),
    );

    btn.disabled = false;
    msgEl.textContent = "";
  }

  function render(b: NetworkBlock, st: LiveState) {
    root.innerHTML = `
      <div class="topnav">
        <a href="/">← BACK TO ARCADE</a>
        <a href="/how-it-works">⚙️ how it works</a>
      </div>
      <div class="inner">
        <h1>CONTRACTS</h1>
        <div class="lede">On-chain addresses, game ids, and what's wired right now.</div>

        <div class="net-head">
          <h2>${b.label}</h2>
          <div class="meta">Stellar Soroban</div>
        </div>

        <div class="net">
          <div class="row"><span class="k">Passphrase</span><span class="v">${escape(b.passphrase)}</span></div>
          <div class="row"><span class="k">RPC</span><span class="v">${escape(b.rpc)}</span></div>
        </div>

        <div class="games">
          <div class="row"><span class="k">GAMES (id → name)</span><span class="v"></span></div>
          ${games
            .map(
              (g) => `
            <div class="row">
              <span class="id">id ${g.gameId}</span>
              <span><span class="name">${escape(g.title)}</span> &nbsp; <span class="slug">/${escape(g.slug)}</span></span>
            </div>
          `,
            )
            .join("")}
        </div>

        <div class="card">
          <div class="head">
            <div class="title">GAME_HUB</div>
            <div class="badge">C-contract</div>
          </div>
          <div class="desc">
            The multi-game host. Every score lands here. Stores per-(game_id, player) high scores
            and the enumerated player list. Two settlement entrypoints:
            <code>submit_score</code> (ZK path — verifies a Groth16 seal via the verifier contract)
            and <code>settle_attested</code> (attest path — verifies an operator signature).
            Same leaderboard storage for both.
          </div>
          <div class="id">${escape(b.gameHubId || "(not configured for this build)")}</div>
          <div class="actions">
            ${b.gameHubId ? `<a href="${contractUrl(b.network, b.gameHubId)}" target="_blank" rel="noreferrer noopener">↗ open</a>` : ""}
            ${b.gameHubId ? `<button data-copy="${escape(b.gameHubId)}">copy</button>` : ""}
          </div>
        </div>

        ${buildLivePanel(b, games, st)}

        <div class="query">
          <div class="query-head">
            <h2>QUERY A SCORE</h2>
            <div class="sub">Paste any player's G… address to see their on-chain personal best for each registered game.</div>
          </div>
          <div class="box">
            <div class="controls">
              <input
                type="text"
                id="fs-query-input"
                placeholder="G... (Stellar address)"
                value="${escape(getAddress() ?? "")}"
                spellcheck="false"
                autocomplete="off"
              />
              <button class="query-go" id="fs-query-go">Query</button>
            </div>
            <div class="msg" id="fs-query-msg">${getAddress() ? "Pre-filled with your connected wallet — click Query." : ""}</div>
            <div class="results" id="fs-query-results"></div>
          </div>
        </div>

        <div class="foot">
          Mainnet contracts will get their own section when we launch there. <br/>
          Source: <code>apps/web/src/chain/config.ts</code> + build env. Updated when contracts are re-deployed.
        </div>
      </div>
    `;
  }

  async function refresh() {
    const b = blocks[0]!;
    render(b, {
      imageIds: new Map(games.map((g) => [g.gameId, { status: "loading" as const }])),
      playerCounts: new Map(games.map((g) => [g.gameId, { status: "loading" as const }])),
      verifier: { status: "loading" },
      trustedOperator: { status: "loading" },
    });
    const st = await fetchLiveState(b, games);
    render(b, st);
  }

  // Initial render with loading placeholders, then kick off fetch.
  render(blocks[0]!, initialLive);
  document.body.appendChild(root);
  void refresh();
}

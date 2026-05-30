// /contracts — single-pane reference of every on-chain + operator
// address powering the arcade. Pulls IDs from import.meta.env at build
// time (same source as the rest of the app, so this page always agrees
// with what the wallet panel actually calls). Stellar Expert links per
// row give a click-through to inspect anything on chain.

import { CONFIG } from "../chain/config.js";

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg-card: #16223a;
    --border: #3a4a6b;
    --border-bright: #6d8fff;
    --accent: #f5d04b;
    --muted: #94a3c6;
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

  #fs-contracts .net {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 14px 18px;
    margin: 0 auto 24px;
    max-width: 760px;
    font-size: 13px;
    color: #d8e0f0;
  }
  #fs-contracts .net .label {
    font-family: var(--font-pixel);
    font-size: 10px;
    color: var(--accent);
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  #fs-contracts .net .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
    border-top: 1px dashed var(--border);
  }
  #fs-contracts .net .row:first-of-type { border-top: none; }
  #fs-contracts .net .row .k { color: var(--muted); }
  #fs-contracts .net .row .v { color: #fff; word-break: break-all; text-align: right; }

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

  #fs-contracts .foot {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    margin-top: 32px;
  }
`;

/// Stellar Expert URLs differ by network — pick the right path from
/// the passphrase the bundle was built for.
function isMainnet(): boolean {
  return CONFIG.networkPassphrase.toLowerCase().includes("public");
}
function explorerNet(): string {
  return isMainnet() ? "public" : "testnet";
}
function contractUrl(id: string): string {
  return `https://stellar.expert/explorer/${explorerNet()}/contract/${id}`;
}
function accountUrl(g: string): string {
  return `https://stellar.expert/explorer/${explorerNet()}/account/${g}`;
}

interface ContractRow {
  title: string;
  badge: string;
  desc: string;
  id: string;
  href?: string;
}

function rowsForBuild(): ContractRow[] {
  return [
    {
      title: "GAME_HUB",
      badge: "C-contract",
      desc: "The multi-game host. Every score lands here. Two settlement entrypoints: <code>submit_score</code> (ZK path — verifies a Groth16 seal) and <code>settle_attested</code> (Phase 13 path — verifies an operator signature). Same leaderboard storage for both.",
      id: CONFIG.gameHubContractId || "(not configured)",
      href: CONFIG.gameHubContractId ? contractUrl(CONFIG.gameHubContractId) : undefined,
    },
    {
      title: "TRUSTED_OPERATOR",
      badge: "ed25519 pubkey",
      desc: "Off-chain key whose signature <code>settle_attested</code> accepts. Lives on the relay. Rotates via <code>game_hub::set_trusted_operator</code>. Currently:",
      id: "GC4TX7QZTAAD2H6H2K7GG6AROQBXHSP3VSZ2J4K3FC7SHU6HXFOFXUBJ",
      href: accountUrl("GC4TX7QZTAAD2H6H2K7GG6AROQBXHSP3VSZ2J4K3FC7SHU6HXFOFXUBJ"),
    },
    {
      title: "RELAY",
      badge: "HTTPS",
      desc: "Bun service that runs the deterministic replay and signs the journal. Never touches chain; the browser does the on-chain settle.",
      id: CONFIG.relayUrl || "(not configured)",
      href: CONFIG.relayUrl || undefined,
    },
  ];
}

export function mountContracts(): void {
  if (!document.getElementById("fs-contracts-style")) {
    const s = document.createElement("style");
    s.id = "fs-contracts-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const rows = rowsForBuild();

  const root = document.createElement("div");
  root.id = "fs-contracts";
  root.innerHTML = `
    <div class="topnav">
      <a href="/">← BACK TO ARCADE</a>
      <a href="/how-it-works">⚙️ how it works</a>
    </div>
    <div class="inner">
      <h1>CONTRACTS</h1>
      <div class="lede">Every on-chain + operator address that runs the arcade.</div>

      <div class="net">
        <div class="label">NETWORK</div>
        <div class="row"><span class="k">Chain</span><span class="v">Stellar Soroban (${isMainnet() ? "mainnet" : "testnet"})</span></div>
        <div class="row"><span class="k">Passphrase</span><span class="v">${CONFIG.networkPassphrase}</span></div>
        <div class="row"><span class="k">RPC</span><span class="v">${CONFIG.rpcUrl}</span></div>
      </div>

      ${rows
        .map(
          (r) => `
        <div class="card">
          <div class="head">
            <div class="title">${r.title}</div>
            <div class="badge">${r.badge}</div>
          </div>
          <div class="desc">${r.desc}</div>
          <div class="id">${r.id}</div>
          <div class="actions">
            ${r.href ? `<a href="${r.href}" target="_blank" rel="noreferrer noopener">↗ open</a>` : ""}
            <button data-copy="${r.id}">copy</button>
          </div>
        </div>
      `,
        )
        .join("")}

      <div class="foot">Updated when contracts are re-deployed. Source: <code>apps/web/src/chain/config.ts</code> + build env.</div>
    </div>
  `;

  // Wire up the copy buttons
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
          /* clipboard may be blocked in some embeds; no-op */
        });
    }
  });

  document.body.appendChild(root);
}

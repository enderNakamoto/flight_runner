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
import { maybeCelebrate } from "../share/celebration.js";
import { bindShareButtons, shareRankButtonsHtml } from "../share/share-rank-button.js";
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

  /* Top-N table. Each row is a flexbox of rank · address · score · ticks.
     The "you" row gets the accent border so the player's eye lands on it. */
  #fs-lb .topn {
    background: var(--bg-card);
    border: 3px solid var(--border);
    padding: 0;
    overflow: hidden;
  }
  #fs-lb .topn .row {
    display: grid;
    grid-template-columns: 48px 1fr auto auto;
    gap: 16px;
    padding: 10px 16px;
    align-items: center;
    font-size: 13px;
    border-bottom: 1px solid rgba(58, 74, 107, 0.6);
  }
  #fs-lb .topn .row:last-child { border-bottom: none; }
  #fs-lb .topn .row.header {
    background: rgba(58, 74, 107, 0.35);
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  #fs-lb .topn .row .rank {
    font-family: var(--font-pixel);
    font-size: 12px;
    color: var(--muted);
  }
  #fs-lb .topn .row.gold .rank { color: var(--accent); }
  #fs-lb .topn .row.silver .rank { color: #cfd8dc; }
  #fs-lb .topn .row.bronze .rank { color: #b48a00; }
  #fs-lb .topn .row .addr {
    color: #d8e0f0;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #fs-lb .topn .row .score {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
    min-width: 60px;
    text-align: right;
  }
  #fs-lb .topn .row .ticks {
    color: var(--muted);
    font-size: 11px;
    min-width: 80px;
    text-align: right;
  }
  #fs-lb .topn .row.you {
    background: rgba(245, 208, 75, 0.08);
    border-left: 3px solid var(--accent);
  }
  #fs-lb .topn .row.you .addr { color: var(--accent); }
  #fs-lb .topn-meta {
    color: var(--muted);
    font-size: 11px;
    margin: 8px 0 18px;
    text-align: right;
  }
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
      <div id="fs-lb-topn"></div>
      <div class="topn-meta" id="fs-lb-topn-meta"></div>
      <h2>Your best</h2>
      <div class="you" id="fs-lb-you"></div>
    </div>
  `;
  document.body.appendChild(root);

  const topnEl = root.querySelector<HTMLDivElement>("#fs-lb-topn")!;
  const topnMetaEl = root.querySelector<HTMLDivElement>("#fs-lb-topn-meta")!;
  const youEl = root.querySelector<HTMLDivElement>("#fs-lb-you")!;

  // Two async sources feed this page:
  //   - the JSON snapshot (top-N + per-row rank) — refreshes every ~5 min via cron
  //   - on-chain `get_score` for the connected wallet — live
  // We cache both as they land so:
  //   1. the "Your best" tile shows the player's live score (always current)
  //   2. the top-N table is **optimistically merged** with the player's live
  //      score so a fresh submission shows up immediately, before the next
  //      cron snapshot lands
  //   3. the celebration UI only fires once BOTH pieces are in (so we
  //      don't toast "not in top-N" when the snapshot is just slow)
  let snapshot: Snapshot | null = null;          // raw fetched JSON
  let lastEntry: HighScoreEntry | null = null;   // player's live PB
  let lastAddr: string | null = null;
  let celebrationFired = false;

  // ── Top-N: fetched from the static JSON the indexer cron writes. ──
  void renderTopN(game.slug, topnEl, topnMetaEl).then((s) => {
    snapshot = s;
    paintTopN();
    // If get_score resolved first, re-render the "your best" tile so the
    // rank line + share buttons reflect the freshly-arrived snapshot.
    if (lastEntry && lastAddr) renderScore(lastAddr, lastEntry);
    tryFireCelebration();
  });

  // Re-fetch + re-merge when the wallet connects / disconnects.
  onWalletChange((addr) => {
    void renderTopN(game.slug, topnEl, topnMetaEl).then((s) => {
      snapshot = s;
      paintTopN();
      if (lastEntry && lastAddr) renderScore(lastAddr, lastEntry);
      tryFireCelebration();
    });
  });

  // Render the top-N from the cached snapshot, optimistically merging in
  // the player's live get_score result if it's better than what the snapshot
  // shows for them. Called whenever either data source updates.
  function paintTopN(): void {
    if (!snapshot) return;
    const merged = (lastEntry && lastAddr)
      ? mergeLiveIntoSnapshot(snapshot, lastAddr, lastEntry)
      : { snap: snapshot, userIsOptimistic: false };
    topnEl.innerHTML = renderTopNRows(merged.snap, lastAddr);
    topnMetaEl.innerHTML = renderTopNMeta(merged.snap, merged.userIsOptimistic);
  }

  // Look the player's address up in whichever view of the data we'd display
  // (i.e. the optimistically-merged one). Returns null if they're not in
  // the top-N (or no snapshot yet).
  function rankFromSnapshot(addr: string): number | null {
    if (!snapshot) return null;
    const merged = lastEntry
      ? mergeLiveIntoSnapshot(snapshot, addr, lastEntry).snap
      : snapshot;
    const hit = merged.entries.find((e) => e.address === addr);
    return hit ? hit.rank : null;
  }

  function tryFireCelebration(): void {
    if (celebrationFired) return;
    if (!snapshot || !lastEntry || !lastAddr) return;
    celebrationFired = true;
    const rank = rankFromSnapshot(lastAddr);
    maybeCelebrate({ slug: game.slug, rank, score: lastEntry.score });
  }

  function renderConnect() {
    // Disconnect path — clear cached identity so the next connect doesn't
    // re-fire a stale celebration.
    lastAddr = null;
    lastEntry = null;
    celebrationFired = false;
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
    // Cache so we can re-render once the snapshot lands (the rank line
    // depends on both data sources).
    lastAddr = addr;
    lastEntry = e;

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
    const rank = rankFromSnapshot(addr);
    const rankLine = rank
      ? `<div class="row"><span class="label">rank</span><span class="val">#${rank}</span></div>`
      : snapshot
        ? `<div class="row"><span class="label">rank</span><span class="val" style="color: var(--muted);">not in top-${snapshot.top_n} yet</span></div>`
        : `<div class="row"><span class="label">rank</span><span class="val" style="color: var(--muted);">loading…</span></div>`;
    youEl.innerHTML = `
      <div class="addr"><code>${fmtAddress(addr)}</code></div>
      <div class="result">
        <div class="row"><span class="label">score</span><span class="val big">${e.score}</span></div>
        ${rankLine}
        <div class="row"><span class="label">ticks survived</span><span class="val">${e.ticks_survived}</span></div>
        <div class="row"><span class="label">seed</span><code>0x${(e.seed >>> 0).toString(16).padStart(8, "0")}</code></div>
        <div class="row"><span class="label">settled</span>${settledDate}</div>
        <div class="row" style="margin-top: 14px;">
          ${shareRankButtonsHtml({ rank, score: e.score, withLabel: true })}
        </div>
      </div>
    `;
    bindShareButtons(youEl);
    // The live score may bump us up in the top-N — repaint with the merge
    // applied so the player doesn't have to wait for the next cron run.
    paintTopN();
    tryFireCelebration();
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

// ─────────────────────────────────────────────────────────────────────
// Top-N snapshot — mirrors scripts/index-leaderboard.ts output shape.
// ─────────────────────────────────────────────────────────────────────

interface SnapshotEntry {
  rank: number;
  address: string;
  pubkey_hex: string;
  score: number;
  ticks_survived: number;
  seed: number;
  settled_at: number;
}

interface Snapshot {
  game_id: number;
  slug: string;
  contract_id: string;
  generated_at: string;
  generated_at_unix: number;
  player_count: number;
  top_n: number;
  entries: SnapshotEntry[];
}

function rankClass(rank: number): string {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "";
}

function renderTopNRows(snap: Snapshot, youAddr: string | null): string {
  if (snap.entries.length === 0) {
    return `<div class="result empty" style="padding: 18px;">No scores yet — be the first to submit.</div>`;
  }
  const header = `
    <div class="row header">
      <span class="rank">#</span>
      <span class="addr">player</span>
      <span class="score">score</span>
      <span class="ticks">ticks</span>
    </div>`;
  const body = snap.entries
    .map((e) => {
      const youCls = youAddr && e.address === youAddr ? " you" : "";
      const rankCls = rankClass(e.rank);
      return `
        <div class="row${youCls} ${rankCls}">
          <span class="rank">#${e.rank}</span>
          <span class="addr"><code>${fmtAddress(e.address)}</code></span>
          <span class="score">${e.score}</span>
          <span class="ticks">${e.ticks_survived}</span>
        </div>`;
    })
    .join("");
  return `<div class="topn">${header}${body}</div>`;
}

function renderTopNMeta(snap: Snapshot, userIsOptimistic: boolean): string {
  const stale = (Date.now() / 1000) - snap.generated_at_unix;
  const minAgo = Math.max(0, Math.round(stale / 60));
  const ago =
    minAgo < 1 ? "just now" :
    minAgo < 60 ? `${minAgo} min ago` :
    `${Math.round(minAgo / 60)} h ago`;
  const base = `${snap.player_count} players · snapshot taken ${ago}`;
  return userIsOptimistic
    ? `${base} <span style="color: #5dd3ff;">· your latest is shown ahead of the next refresh</span>`
    : base;
}

/// Insert the connected player's live PB into a snapshot if it's better
/// than what's already there (or if they're not in the snapshot at all),
/// then re-sort + re-rank + cap at top_n. Returns the new view plus a
/// flag for whether the merge actually changed anything (used to surface
/// a "your latest is shown ahead of the cron" hint in the meta line).
function mergeLiveIntoSnapshot(
  snap: Snapshot,
  addr: string,
  entry: HighScoreEntry,
): { snap: Snapshot; userIsOptimistic: boolean } {
  const liveScore = entry.score;
  const liveTicks = entry.ticks_survived;
  const existingIdx = snap.entries.findIndex((e) => e.address === addr);
  const existing = existingIdx >= 0 ? snap.entries[existingIdx]! : null;
  const liveIsBetter =
    !existing ||
    liveScore > existing.score ||
    (liveScore === existing.score && liveTicks > existing.ticks_survived);
  if (!liveIsBetter) {
    return { snap, userIsOptimistic: false };
  }
  const others = existingIdx >= 0
    ? snap.entries.filter((_, i) => i !== existingIdx)
    : snap.entries;
  const userRow: SnapshotEntry = {
    rank: 0, // re-assigned after sort below
    address: addr,
    pubkey_hex: existing?.pubkey_hex ?? "",
    score: liveScore,
    ticks_survived: liveTicks,
    seed: entry.seed,
    settled_at: Number(entry.settled_at),
  };
  const merged = [...others, userRow]
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // Strict-PB ranking: at the same score, earlier on-chain time wins.
      return a.settled_at - b.settled_at;
    })
    .slice(0, snap.top_n)
    .map((e, i) => ({ ...e, rank: i + 1 }));
  return {
    snap: {
      ...snap,
      entries: merged,
      // If the live submission introduces a brand-new pubkey, bump the
      // public count for the meta line so it stays consistent with what
      // we're showing.
      player_count: existingIdx < 0 ? snap.player_count + 1 : snap.player_count,
    },
    userIsOptimistic: true,
  };
}

/// Fetch the snapshot JSON. Painting (with optimistic merge) is handled
/// separately by the caller's `paintTopN()` so we don't have to wire the
/// player's wallet/score down into this fetch.
async function renderTopN(
  slug: string,
  topnEl: HTMLElement,
  metaEl: HTMLElement,
): Promise<Snapshot | null> {
  topnEl.innerHTML = `<div class="result empty" style="padding: 18px;">Loading top scores…</div>`;
  metaEl.textContent = "";
  try {
    const res = await fetch(`/leaderboard/${slug}.json`, { cache: "no-cache" });
    if (!res.ok) {
      // 404 = indexer hasn't written a snapshot yet for this game.
      topnEl.innerHTML = `<div class="result empty" style="padding: 18px;">Top scores coming soon.</div>`;
      return null;
    }
    return (await res.json()) as Snapshot;
  } catch (e) {
    topnEl.innerHTML = `<div class="result err" style="padding: 18px;">Couldn't load top scores: ${e instanceof Error ? e.message : String(e)}</div>`;
    return null;
  }
}

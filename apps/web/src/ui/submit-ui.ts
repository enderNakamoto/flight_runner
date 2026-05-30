// Submit UI — invisible until the player has either:
//   (a) a fresh transcript from the most recent game over, or
//   (b) a pending proof in localStorage waiting to be signed.
//
// Flow when the player engages:
//   1. Modal opens with whichever applies — a fresh transcript to prove,
//      or a pending proof to sign.
//   2. Prove path: POST transcript to relay (5–25 min). On success, the
//      proof is cached in localStorage and the modal switches to the
//      sign path. The player can close the tab and come back.
//   3. Sign path: connect wallet → wallet signs submit_score → tx lands.
//   4. On success, the pending proof + transcript buffer are cleared.

import { Buffer } from "buffer";
import { CONFIG } from "../chain/config.js";
import { getClient } from "../chain/game-hub.js";
import {
  clearPendingProof,
  getPendingProof,
  onPendingProofChange,
  setPendingProof,
  type PendingProof,
} from "../chain/pending-proof.js";
import { proveTranscript, type ProveResult } from "../chain/relay.js";
import {
  clearLatestRun,
  getLatestRun,
  onRunChange,
  type CapturedRun,
} from "../chain/transcript-buffer.js";
import { connect, getAddress } from "../chain/wallet.js";

/// Fire-and-forget nudge to the relay so it triggers a GitHub
/// repository_dispatch and the indexer cron runs immediately. Cuts the
/// "snapshot updates" delay from 5 min to ~30 s for other viewers.
function nudgeLeaderboardRefresh(player: string | null): void {
  if (!CONFIG.relayUrl) return;
  const url = `${CONFIG.relayUrl.replace(/\/$/, "")}/api/refresh-leaderboard`;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player_strkey: player ?? undefined }),
  }).catch(() => { /* cron is the safety net */ });
}


const STYLE = `
  @keyframes fs-pulse {
    0%, 100% { box-shadow: 0 8px 24px rgba(124, 92, 240, 0.4), 0 0 0 0 rgba(245, 208, 75, 0.55); }
    50%      { box-shadow: 0 8px 24px rgba(124, 92, 240, 0.5), 0 0 0 14px rgba(245, 208, 75, 0); }
  }
  #fs-submit-btn {
    position: fixed;
    /* Auto-margin centering — more bulletproof than translateX(-50%)
       when the button has an emoji prefix (which shifts the visual /
       layout-width relationship) or sub-pixel layout. left:0 + right:0
       + margin:auto + fit-content forces the browser to center based on
       the actual content box, no transform math involved. */
    left: 0;
    right: 0;
    margin: 0 auto;
    width: fit-content;
    /* Sits above the in-canvas "R to restart" hint and below the
       Sentinel sub-tagline. 110px clears the hint at typical 720p
       viewports without overlapping the body. */
    bottom: 110px;
    z-index: 90;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 16px 32px;
    min-width: 280px;
    color: #fff;
    text-align: center;
    border-radius: 10px;
    cursor: pointer;
    animation: fs-pulse 2.2s ease-in-out infinite;
    transition: transform 0.1s ease;
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    border: 2px solid #8a6df0;
  }
  #fs-submit-btn:hover {
    background: linear-gradient(135deg, #6d4ac0 0%, #3a72e8 100%);
    transform: translateY(-1px);
  }
  #fs-submit-btn:active { transform: translateY(0); }
  /* Reassurance caption sitting directly below the button. */
  #fs-submit-caption {
    position: fixed;
    left: 0;
    right: 0;
    margin: 0 auto;
    width: fit-content;
    bottom: 80px;
    z-index: 89;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.65);
    text-align: center;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }
  #fs-submit-btn .badge {
    margin-left: 10px;
    background: #f5d04b;
    color: #20140a;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
    vertical-align: middle;
  }
  /* ── Modal: redesigned for Phase 14 submit UX ───────────────────
     Goals:
       - Visual hierarchy (gradient header, panel-based body)
       - Pipeline visualization during proving so player sees stages
       - Attest-mode wording: "simulating game steps" with plane glyph
         and tick/score counters that animate up to the real values
       - All vanilla DOM + CSS keyframes (no React, no JS frame loop)
  */
  #fs-submit-modal {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: radial-gradient(ellipse at center, rgba(15, 20, 40, 0.78) 0%, rgba(0, 0, 0, 0.85) 100%);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    color: #e6ecf7;
    animation: fs-submit-fade 0.16s ease-out;
  }
  @keyframes fs-submit-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  #fs-submit-modal .card {
    background: linear-gradient(180deg, #1a2748 0%, #121b2f 100%);
    border: 1px solid #3a4a6b;
    border-radius: 12px;
    width: 480px;
    max-width: 92vw;
    font-size: 13px;
    overflow: hidden;
    box-shadow:
      0 24px 60px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(245, 208, 75, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    animation: fs-submit-rise 0.22s cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  @keyframes fs-submit-rise {
    from { transform: translateY(8px) scale(0.985); opacity: 0; }
    to   { transform: translateY(0)  scale(1);    opacity: 1; }
  }

  /* ── Header ─────────────────────────────────────────────────────── */
  #fs-submit-modal .head {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    padding: 14px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    position: relative;
  }
  #fs-submit-modal .head h2 {
    margin: 0;
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 13px;
    letter-spacing: 0.5px;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  }
  #fs-submit-modal .head .sub {
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.78);
    font-size: 11px;
    letter-spacing: 0.3px;
  }
  #fs-submit-modal .head .close {
    position: absolute;
    top: 10px;
    right: 12px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.78);
    width: 24px;
    height: 24px;
    padding: 0;
    line-height: 1;
    font-size: 14px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }
  #fs-submit-modal .head .close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  /* ── Body ────────────────────────────────────────────────────────── */
  #fs-submit-modal .body {
    padding: 18px 20px 20px;
  }
  #fs-submit-modal .panel {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  #fs-submit-modal .panel-label {
    font-size: 10px;
    color: #94a3c6;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  /* Stats grid — score/ticks/seed */
  #fs-submit-modal .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  #fs-submit-modal .stats .cell {
    text-align: center;
    padding: 4px 0;
  }
  #fs-submit-modal .stats .k {
    font-size: 10px;
    color: #94a3c6;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  #fs-submit-modal .stats .v {
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 18px;
    color: #f5d04b;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
  }
  #fs-submit-modal .stats .v.small {
    font-size: 11px;
    color: #d8e0f0;
    text-shadow: none;
  }

  /* Wallet row */
  #fs-submit-modal .wallet {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    margin-bottom: 14px;
    font-size: 12px;
  }
  #fs-submit-modal .wallet code {
    background: rgba(245, 208, 75, 0.08);
    color: #f5d04b;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
  }

  /* Buttons */
  #fs-submit-modal .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  #fs-submit-modal button.btn-primary {
    flex: 1 1 auto;
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border: 1px solid #8a6df0;
    border-radius: 6px;
    padding: 10px 16px;
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: transform 0.08s ease, background 0.15s;
    box-shadow: 0 4px 12px rgba(91, 58, 168, 0.35);
  }
  #fs-submit-modal button.btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #6d4ac0 0%, #3a72e8 100%);
    transform: translateY(-1px);
  }
  #fs-submit-modal button.btn-primary:active { transform: translateY(0); }
  #fs-submit-modal button.btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: none;
  }
  #fs-submit-modal button.btn-ghost {
    background: transparent;
    color: #c0c8de;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    padding: 10px 16px;
    font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  #fs-submit-modal button.btn-ghost:hover:not(:disabled) {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.32);
  }

  /* Status copy */
  #fs-submit-modal .status {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: #d8e0f0;
    display: none;
  }
  #fs-submit-modal .status.visible { display: block; }
  #fs-submit-modal .status.ok  { color: #7aff8e; border-color: rgba(122, 255, 142, 0.35); background: rgba(122, 255, 142, 0.06); }
  #fs-submit-modal .status.err { color: #ff8a8a; border-color: rgba(255, 138, 138, 0.35); background: rgba(255, 138, 138, 0.06); }

  /* Generic copy bits */
  #fs-submit-modal code {
    background: rgba(245, 208, 75, 0.08);
    color: #f5d04b;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
  #fs-submit-modal .err { color: #ff8a8a; }
  #fs-submit-modal .ok  { color: #7aff8e; }
  #fs-submit-modal .muted { color: #94a3c6; font-size: 11px; }
  #fs-submit-modal .perk {
    font-size: 11px;
    color: #f5d04b;
    text-align: center;
    margin-top: 6px;
  }

  /* ── Proving pipeline ──────────────────────────────────────────── */
  #fs-submit-modal .pipeline {
    margin-top: 0;
  }
  #fs-submit-modal .pipeline .track {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 0 14px;
  }
  #fs-submit-modal .pipeline .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 0 auto;
    text-align: center;
    width: 70px;
  }
  #fs-submit-modal .pipeline .dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #94a3c6;
    font-size: 11px;
    line-height: 22px;
    text-align: center;
    transition: background 0.2s, border-color 0.2s, transform 0.2s;
  }
  #fs-submit-modal .pipeline .step.queued .dot {
    /* default */
  }
  #fs-submit-modal .pipeline .step.active .dot {
    background: linear-gradient(135deg, #f5d04b 0%, #ffb144 100%);
    color: #1a1100;
    border-color: rgba(245, 208, 75, 0.85);
    transform: scale(1.1);
    animation: fs-pulse-yellow 1.2s ease-in-out infinite;
  }
  #fs-submit-modal .pipeline .step.done .dot {
    background: #7aff8e;
    color: #0a2010;
    border-color: rgba(122, 255, 142, 0.85);
  }
  @keyframes fs-pulse-yellow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(245, 208, 75, 0.65); }
    50%      { box-shadow: 0 0 0 7px rgba(245, 208, 75, 0); }
  }
  #fs-submit-modal .pipeline .label {
    margin-top: 6px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #94a3c6;
  }
  #fs-submit-modal .pipeline .step.active .label { color: #f5d04b; }
  #fs-submit-modal .pipeline .step.done .label   { color: #7aff8e; }
  #fs-submit-modal .pipeline .connector {
    flex: 1 1 auto;
    height: 2px;
    background: linear-gradient(to right, rgba(255,255,255,0.08), rgba(255,255,255,0.08));
    margin: 0 -2px;
    margin-top: -22px; /* sit on the dot midline */
    position: relative;
  }
  #fs-submit-modal .pipeline .connector.done {
    background: linear-gradient(to right, #7aff8e, rgba(122, 255, 142, 0.45));
  }
  #fs-submit-modal .pipeline .narration {
    font-size: 12px;
    color: #d8e0f0;
    line-height: 1.55;
    margin-bottom: 10px;
  }
  #fs-submit-modal .pipeline .narration .heading {
    display: block;
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 11px;
    color: #f5d04b;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  /* Live tick/score counter shown during the SIMULATE step. */
  #fs-submit-modal .sim {
    margin-top: 8px;
    padding: 10px 12px;
    background: #0c1428;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
  }
  #fs-submit-modal .sim .runway {
    height: 16px;
    position: relative;
    background: linear-gradient(to right, rgba(245, 208, 75, 0.12) 0%, rgba(245, 208, 75, 0.03) 100%);
    border-radius: 2px;
    margin-bottom: 8px;
    overflow: hidden;
  }
  #fs-submit-modal .sim .runway::before {
    /* dashed centerline */
    content: '';
    position: absolute;
    left: 0; right: 0; top: 50%;
    border-top: 1px dashed rgba(255, 255, 255, 0.18);
  }
  #fs-submit-modal .sim .plane {
    position: absolute;
    top: 50%;
    left: 0;
    transform: translate(-50%, -50%);
    font-size: 14px;
    line-height: 1;
    color: #ffd54f;
    transition: left 0.35s cubic-bezier(0.45, 0.05, 0.55, 0.95);
  }
  #fs-submit-modal .sim .counters {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    font-size: 11px;
    color: #d8e0f0;
  }
  #fs-submit-modal .sim .counters .c {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  #fs-submit-modal .sim .counters .k {
    color: #94a3c6;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  #fs-submit-modal .sim .counters .v {
    font-family: 'Press Start 2P', ui-monospace, Menlo, monospace;
    font-size: 11px;
    color: #f5d04b;
  }
`;

function injectStyle(): void {
  if (document.getElementById("fs-submit-style")) return;
  const s = document.createElement("style");
  s.id = "fs-submit-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function fmtAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-4)}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ageMin(ms: number): number {
  return Math.max(0, Math.round((Date.now() - ms) / 60000));
}

export function mountSubmitUI(): void {
  injectStyle();

  let btn: HTMLButtonElement | null = null;
  let modal: HTMLDivElement | null = null;

  let caption: HTMLElement | null = null;

  function showButton(opts: { label: string; badge?: string; captionText?: string }) {
    const html = `${opts.label}${opts.badge ? `<span class="badge">${opts.badge}</span>` : ""}`;
    if (btn) {
      btn.innerHTML = html;
    } else {
      btn = document.createElement("button");
      btn.id = "fs-submit-btn";
      btn.innerHTML = html;
      btn.onclick = openModal;
      document.body.appendChild(btn);
    }
    if (opts.captionText) {
      if (!caption) {
        caption = document.createElement("div");
        caption.id = "fs-submit-caption";
        document.body.appendChild(caption);
      }
      caption.textContent = opts.captionText;
    } else if (caption) {
      caption.remove();
      caption = null;
    }
  }

  function hideButton() {
    btn?.remove();
    btn = null;
    caption?.remove();
    caption = null;
  }

  function refreshButtonVisibility() {
    if (modal) return; // don't fight the modal's open state
    const pending = getPendingProof();
    const run = getLatestRun();
    if (pending) {
      showButton({
        label: "🏆 Sign Pending",
        badge: `${ageMin(pending.proved_at)} min`,
        captionText: "only your highest score is recorded",
      });
      return;
    }
    if (run) {
      // Always invite submission — the contract enforces "only the highest
      // score wins" via the is_pb check, so a low submit is a harmless
      // no-op. The caption below the button tells the player the same
      // thing in plain English so they don't worry about overwriting a
      // good score with a bad one.
      showButton({
        label: "🏆 Submit Score · earn Sentinel points",
        captionText: "only your highest score is recorded",
      });
      return;
    }
    hideButton();
  }

  function closeModal() {
    modal?.remove();
    modal = null;
    refreshButtonVisibility();
  }

  function openModal() {
    modal = document.createElement("div");
    modal.id = "fs-submit-modal";
    const networkLabel = CONFIG.networkPassphrase.startsWith("Test")
      ? "Stellar Testnet"
      : "Stellar Mainnet";
    modal.innerHTML = `
      <div class="card">
        <div class="head">
          <button class="close" id="fs-modal-close" aria-label="Close">×</button>
          <h2 id="fs-modal-title">SUBMIT YOUR FLIGHT</h2>
          <div class="sub" id="fs-modal-sub">Birdstrike · ${networkLabel}</div>
        </div>
        <div class="body">
          <div id="fs-modal-stats"></div>
          <div id="fs-modal-wallet"></div>
          <div id="fs-modal-action"></div>
          <div class="status" id="fs-modal-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const titleEl = modal.querySelector<HTMLElement>("#fs-modal-title")!;
    const subEl = modal.querySelector<HTMLElement>("#fs-modal-sub")!;
    const statsEl = modal.querySelector<HTMLDivElement>("#fs-modal-stats")!;
    const walletEl = modal.querySelector<HTMLDivElement>("#fs-modal-wallet")!;
    const actionEl = modal.querySelector<HTMLDivElement>("#fs-modal-action")!;
    const statusEl = modal.querySelector<HTMLDivElement>("#fs-modal-status")!;
    modal.querySelector<HTMLButtonElement>("#fs-modal-close")!.onclick = closeModal;

    function setStatus(text: string, cls?: "ok" | "err") {
      statusEl.textContent = text;
      statusEl.className = `status visible${cls ? ` ${cls}` : ""}`;
    }
    function clearStatus() {
      statusEl.textContent = "";
      statusEl.className = "status";
    }
    /// Render the score/ticks/seed summary panel — pulled from either
    /// the pending proof or the fresh run as appropriate.
    function renderStats(opts: { score?: number; ticks?: number; seed?: number | string; perk?: string }) {
      const seedStr =
        typeof opts.seed === "number"
          ? `0x${opts.seed.toString(16).padStart(8, "0")}`
          : (opts.seed ?? "—");
      statsEl.innerHTML = `
        <div class="panel">
          <div class="panel-label">YOUR RUN</div>
          <div class="stats">
            <div class="cell"><div class="k">score</div><div class="v">${opts.score ?? 0}</div></div>
            <div class="cell"><div class="k">ticks</div><div class="v">${(opts.ticks ?? 0).toLocaleString()}</div></div>
            <div class="cell"><div class="k">seed</div><div class="v small">${seedStr}</div></div>
          </div>
          ${opts.perk ? `<div class="perk">${opts.perk}</div>` : ""}
        </div>
      `;
    }
    function clearStats() { statsEl.innerHTML = ""; }

    function renderWalletRow(addr: string | null): void {
      walletEl.innerHTML = "";
      if (addr) {
        walletEl.innerHTML = `
          <div class="wallet">
            <span class="muted">wallet</span>
            <code>${fmtAddress(addr)}</code>
          </div>
        `;
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "wallet";
      wrap.innerHTML = `<span class="muted">no wallet connected</span>`;
      const cb = document.createElement("button");
      cb.className = "btn-ghost";
      cb.textContent = "Connect Wallet";
      cb.onclick = async () => {
        cb.disabled = true;
        setStatus("Opening wallet picker …");
        try {
          const a = await connect();
          clearStatus();
          renderWalletRow(a);
          renderAction();
        } catch (e) {
          setStatus(`Connect failed: ${errMsg(e)}`, "err");
          cb.disabled = false;
        }
      };
      wrap.appendChild(cb);
      walletEl.appendChild(wrap);
    }

    /// Inner helper — builds a fresh AssembledTransaction and submits.
    /// Separated from signAndSubmit so the txBadSeq retry path can call
    /// it twice without recreating the cooldown/UI plumbing.
    async function buildSignSend(p: PendingProof): Promise<void> {
      const client = getClient();
      const journal = Buffer.from(p.journal_hex, "hex");
      const tx =
        p.kind === "attest"
          ? await client.settle_attested({
              game_id: p.game_id,
              journal,
              op_signature: Buffer.from(p.signature_hex, "hex"),
            })
          : await client.submit_score({
              game_id: CONFIG.flightScrollGameId,
              seal: Buffer.from(p.seal_hex, "hex"),
              journal,
            });
      const { result } = await tx.signAndSend();
      (result as { unwrap: () => void }).unwrap();
    }

    async function signAndSubmit(p: PendingProof) {
      setStatus("Building tx and asking your wallet to sign …");
      try {
        await buildSignSend(p);
      } catch (e) {
        const m = errMsg(e);
        // txBadSeq — account sequence stale. The most common cause is
        // a previous tx from the same wallet landing between simulate
        // and signAndSend. Rebuild fresh and retry once before
        // bothering the user.
        if (/txBadSeq|tx_bad_seq|bad[_\s]?seq/i.test(m)) {
          setStatus("Sequence number was stale — rebuilding tx and retrying …");
          try {
            // Brief delay so any in-flight ledger close settles before
            // we re-fetch state.
            await new Promise<void>((r) => setTimeout(r, 1500));
            await buildSignSend(p);
          } catch (e2) {
            const m2 = errMsg(e2);
            setStatus(
              `Sign failed after retry: ${m2}. ` +
                `If this keeps happening, refresh the wallet (some wallets cache stale account state), then click Sign again.`,
              "err",
            );
            return;
          }
        } else {
          // Soroban marks submit_score as read-only when the new score
          // doesn't beat the existing PB (no HighScore write happens).
          // Bindings refuse to sign+send a no-op tx. That's the contract
          // working correctly — surface it nicely and drop the proof.
          if (/this is a read call/i.test(m)) {
            clearPendingProof();
            clearLatestRun();
            setStatus(
              `Score ${p.score} didn't beat your on-chain best — nothing to submit. Try a better run.`,
              "ok",
            );
            hideButton();
            renderAction();
            return;
          }
          // Wallet account isn't funded / doesn't exist on the network.
          if (
            /account not found/i.test(m) ||
            /could not load account/i.test(m) ||
            /resource[_\s]?not[_\s]?found/i.test(m) ||
            /404/i.test(m)
          ) {
            setStatus(
              `Your wallet has no XLM on this network. Fund it via friendbot (testnet) or by buying XLM (mainnet), then retry.`,
              "err",
            );
            return;
          }
          // Account exists but balance too low for fees.
          if (
            /insufficient[_\s]?balance/i.test(m) ||
            /insufficient[_\s]?fee/i.test(m) ||
            /tx_insufficient/i.test(m)
          ) {
            setStatus(
              `Wallet balance too low to pay tx fees. Top up your XLM and retry.`,
              "err",
            );
            return;
          }
          // Player declined / closed the wallet popup.
          if (
            /user (?:declined|rejected|denied|cancel)/i.test(m) ||
            /user reject/i.test(m) ||
            /denied transaction signature/i.test(m)
          ) {
            setStatus("Wallet signature cancelled. Click Sign again when ready.", "err");
            return;
          }
          setStatus(`Sign failed: ${m}`, "err");
          return;
        }
      }
      // Success path — runs both on the first-try success and on the
      // post-retry success after the txBadSeq recovery.
      clearPendingProof();
      clearLatestRun();
      setStatus(`✅ Submitted. score=${p.score} ticks=${p.ticks_survived}`, "ok");
      hideButton();
      renderAction();
      nudgeLeaderboardRefresh(getAddress());
    }

    /// Render the pipeline visualization while a prove call is
    /// in-flight. Step labels + narration are mode-specific so the
    /// player sees an honest description of what the relay is doing
    /// (replay vs ZK prove). The plane glyph in the SIMULATE step
    /// rides along a runway and a tick counter climbs toward the
    /// transcript's real tick count — gives the player a tangible
    /// sense of work being done, even though the fetch is opaque.
    const ATTEST_STEPS = [
      { id: "transmit", label: "TRANSMIT" },
      { id: "simulate", label: "SIMULATE" },
      { id: "sign",     label: "SIGN" },
      { id: "settle",   label: "SETTLE" },
    ] as const;
    type AttestStepId = (typeof ATTEST_STEPS)[number]["id"];

    function renderPipeline(activeId: AttestStepId, doneIds: AttestStepId[]) {
      const segments: string[] = [];
      ATTEST_STEPS.forEach((s, i) => {
        const state = doneIds.includes(s.id)
          ? "done"
          : s.id === activeId
            ? "active"
            : "queued";
        const glyph = state === "done" ? "✓" : state === "active" ? "●" : "○";
        segments.push(`
          <div class="step ${state}">
            <div class="dot">${glyph}</div>
            <div class="label">${s.label}</div>
          </div>
        `);
        if (i < ATTEST_STEPS.length - 1) {
          const connDone = doneIds.includes(s.id) && (doneIds.includes(ATTEST_STEPS[i + 1]!.id) || activeId === ATTEST_STEPS[i + 1]!.id);
          segments.push(`<div class="connector ${connDone ? "done" : ""}"></div>`);
        }
      });
      return `<div class="track">${segments.join("")}</div>`;
    }

    function pipelineHtml(opts: {
      activeId: AttestStepId;
      doneIds: AttestStepId[];
      heading: string;
      narration: string;
      sim?: { plane01: number; ticks: number; ticksTarget: number; score: number };
    }): string {
      const sim = opts.sim
        ? `
          <div class="sim">
            <div class="runway">
              <span class="plane" style="left: ${(opts.sim.plane01 * 100).toFixed(1)}%;">✈</span>
            </div>
            <div class="counters">
              <span class="c"><span class="k">tick</span><span class="v">${opts.sim.ticks.toLocaleString()} / ${opts.sim.ticksTarget.toLocaleString()}</span></span>
              <span class="c"><span class="k">score</span><span class="v">${opts.sim.score}</span></span>
            </div>
          </div>
        `
        : "";
      return `
        <div class="pipeline panel">
          ${renderPipeline(opts.activeId, opts.doneIds)}
          <div class="narration">
            <span class="heading">${opts.heading}</span>
            ${opts.narration}
          </div>
          ${sim}
        </div>
      `;
    }

    interface SimSnapshot {
      plane01: number;
      ticks: number;
      ticksTarget: number;
      score: number;
    }

    function sleep(ms: number) {
      return new Promise<void>((r) => setTimeout(r, ms));
    }

    async function proveThenCache(run: CapturedRun, addr: string) {
      const transcript = run.bytes;
      const tickTarget = run.ticks;
      clearStatus();
      titleEl.textContent = "ATTESTING YOUR FLIGHT";
      subEl.textContent = "the relay is independently verifying your score";

      // Hide stats + wallet during the visualization; the pipeline panel
      // takes the body's full attention.
      clearStats();
      walletEl.innerHTML = "";
      actionEl.innerHTML = "";

      // Step 1 — TRANSMIT
      actionEl.innerHTML = pipelineHtml({
        activeId: "transmit",
        doneIds: [],
        heading: "STEP 1 / 4  ·  TRANSMIT",
        narration:
          `Uploading <code>${transcript.length}</code> bytes of raw inputs to the relay. ` +
          `Just your button presses and the seed — no claimed score, no honesty assumed.`,
      });

      // Kick off the actual prove request in parallel with the
      // visualization. The fetch resolves opaquely; the UI carries
      // the illusion of progress until it lands.
      const provePromise = proveTranscript(addr, transcript);

      await sleep(380);

      // Step 2 — SIMULATE (the headline animation)
      let plane01 = 0;
      let simTick = 0;
      let simScore = 0;
      let simTimer: ReturnType<typeof setInterval> | null = null;
      const drawSimStep = () => {
        const snap: SimSnapshot = {
          plane01: Math.min(1, plane01),
          ticks: Math.min(simTick, tickTarget),
          ticksTarget: tickTarget,
          score: Math.min(simScore, run.score ?? 0),
        };
        actionEl.innerHTML = pipelineHtml({
          activeId: "simulate",
          doneIds: ["transmit"],
          heading: "STEP 2 / 4  ·  SIMULATING GAME STEPS",
          narration:
            `Replaying your inputs through the same deterministic Rust sim that ran in ` +
            `your browser. The relay derives the score from raw button presses — this is ` +
            `the cheat-proof step. A tampered transcript would produce a different score ` +
            `right here, and the operator would refuse to sign it.`,
          sim: snap,
        });
      };
      drawSimStep();
      const startedAt = Date.now();
      const SIM_DURATION_MS = 1300;
      simTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        plane01 = Math.min(1, elapsed / SIM_DURATION_MS);
        simTick = Math.floor(plane01 * tickTarget);
        simScore = Math.floor(plane01 * (run.score ?? 0));
        drawSimStep();
      }, 60);

      // Wait for whichever finishes last: the fake animation OR the
      // real fetch. If the relay is fast (attest is ~1-3s), the
      // animation finishes first and the user just sees the dot tick
      // over without a stutter. Wrap in try/catch so a fetch rejection
      // (CORS, network, timeout, relay down) collapses the pipeline
      // with a visible error instead of leaving it pinned at SIMULATE.
      let r: ProveResult;
      try {
        const settled = await Promise.all([provePromise, sleep(SIM_DURATION_MS + 40)]);
        r = settled[0];
      } catch (e) {
        if (simTimer) clearInterval(simTimer);
        actionEl.innerHTML = "";
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(
          `Network / fetch error: ${msg}. Check that the relay URL is reachable from this origin (CORS).`,
          "err",
        );
        renderAction();
        return;
      }
      if (simTimer) clearInterval(simTimer);

      if (!r.ok) {
        actionEl.innerHTML = "";
        setStatus(`Prove failed: ${r.error}`, "err");
        // Bring back the normal action surface so the user can retry.
        renderAction();
        return;
      }

      // Step 3 — SIGN
      actionEl.innerHTML = pipelineHtml({
        activeId: "sign",
        doneIds: ["transmit", "simulate"],
        heading:
          r.mode === "attest"
            ? "STEP 3 / 4  ·  SIGNING ATTESTATION"
            : "STEP 3 / 4  ·  SEALING PROOF",
        narration:
          r.mode === "attest"
            ? `The relay binds <code>(game_id || journal)</code> with its ed25519 operator ` +
              `key. The contract's <code>trusted_operator</code> slot will verify this ` +
              `signature on chain.`
            : `Compressing the STARK receipt into a 260-byte Groth16 SNARK that the ` +
              `on-chain verifier can check in a single tx.`,
      });
      await sleep(420);

      const pending: PendingProof =
        r.mode === "attest"
          ? {
              kind: "attest",
              player_strkey: addr,
              game_id: r.game_id,
              journal_hex: r.journal_hex,
              signature_hex: r.signature_hex,
              score: r.score ?? 0,
              ticks_survived: r.ticks_survived ?? 0,
              proved_at: Date.now(),
            }
          : {
              player_strkey: addr,
              seal_hex: r.seal_hex,
              journal_hex: r.journal_hex,
              score: r.score ?? 0,
              ticks_survived: r.ticks_survived ?? 0,
              proved_at: Date.now(),
            };

      // Step 4 — SETTLE (waiting on wallet — no auto-advance; the
      // action surface re-renders to offer the Sign + Submit button).
      setPendingProof(pending);
      clearLatestRun();
      titleEl.textContent = "READY TO SETTLE";
      subEl.textContent = "your wallet signs the final on-chain submission";
      renderAction();
    }

    function renderAction(): void {
      actionEl.innerHTML = "";
      const addr = getAddress();
      const pending = getPendingProof();
      const run = getLatestRun();

      // ── Pending proof — wallet-sign step ────────────────────────
      if (pending) {
        titleEl.textContent =
          pending.player_strkey === addr
            ? "READY TO SETTLE"
            : "PENDING — WALLET MISMATCH";
        subEl.textContent =
          pending.player_strkey === addr
            ? `cached ${ageMin(pending.proved_at)} min ago · waiting on your signature`
            : `cached for ${fmtAddress(pending.player_strkey)} — switch wallets or discard`;

        renderStats({
          score: pending.score,
          ticks: pending.ticks_survived,
          seed: "—",
          perk: pending.kind === "attest"
            ? "✦ Attested by the trusted operator"
            : "✦ Zero-knowledge proof",
        });

        if (!addr) return; // wallet picker handles connect

        if (pending.player_strkey !== addr) {
          const wrap = document.createElement("div");
          wrap.innerHTML = `
            <div class="muted" style="margin-bottom: 10px;">
              connected wallet doesn't match the pending proof's player
              (<code>${fmtAddress(pending.player_strkey)}</code>).
              Switch wallets or discard.
            </div>
          `;
          actionEl.appendChild(wrap);
          const drop = document.createElement("button");
          drop.className = "btn-ghost";
          drop.textContent = "Discard pending proof";
          drop.onclick = () => {
            clearPendingProof();
            renderAction();
            refreshButtonVisibility();
          };
          actionEl.appendChild(drop);
          return;
        }

        const row = document.createElement("div");
        row.className = "actions";
        const sign = document.createElement("button");
        sign.className = "btn-primary";
        sign.textContent = "✦ Sign + Submit";
        sign.onclick = () => signAndSubmit(pending);
        const drop = document.createElement("button");
        drop.className = "btn-ghost";
        drop.textContent = "Discard";
        drop.onclick = () => {
          clearPendingProof();
          renderAction();
          refreshButtonVisibility();
        };
        row.appendChild(sign);
        row.appendChild(drop);
        actionEl.appendChild(row);
        return;
      }

      // ── Fresh run — prove step ──────────────────────────────────
      if (run) {
        titleEl.textContent = "SUBMIT YOUR FLIGHT";
        subEl.textContent = `Birdstrike · ${CONFIG.networkPassphrase.startsWith("Test") ? "Stellar Testnet" : "Stellar Mainnet"}`;
        // First 4 bytes of the transcript are the seed (u32 LE).
        const seedU32 =
          run.bytes.length >= 4
            ? (run.bytes[0]! | (run.bytes[1]! << 8) | (run.bytes[2]! << 16) | (run.bytes[3]! << 24)) >>> 0
            : 0;
        renderStats({
          score: run.score,
          ticks: run.ticks,
          seed: seedU32,
          perk: "★ Top-10 scores earn Sentinel Protocol points",
        });

        if (!CONFIG.relayUrl) {
          actionEl.innerHTML = `<div class="muted err">VITE_RELAY_URL not set — proving unavailable.</div>`;
          return;
        }
        if (!addr) return; // wait for wallet
        const row = document.createElement("div");
        row.className = "actions";
        const proveBtn = document.createElement("button");
        proveBtn.className = "btn-primary";
        proveBtn.textContent = "✈ Attest this Run";
        proveBtn.onclick = async () => {
          proveBtn.disabled = true;
          try {
            await proveThenCache(run, addr);
          } finally {
            proveBtn.disabled = false;
          }
        };
        row.appendChild(proveBtn);
        actionEl.appendChild(row);
        return;
      }

      titleEl.textContent = "NOTHING TO SUBMIT";
      subEl.textContent = "Play a run, then come back here.";
      clearStats();
    }

    renderWalletRow(getAddress());
    renderAction();
  }

  // Show/hide the floating button when either source of work changes.
  onRunChange(refreshButtonVisibility);
  onPendingProofChange(refreshButtonVisibility);
  refreshButtonVisibility();
}

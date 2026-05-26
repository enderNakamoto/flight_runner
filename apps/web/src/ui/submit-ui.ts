// Submit UI — invisible until the player has a fresh run to submit.
//
// Flow:
//   1. PlayScene publishes the transcript at game over (transcript-buffer)
//   2. A small floating "Submit Score" button fades in
//   3. Player clicks → modal opens with connect-wallet + submit
//   4. Modal handles wallet connect → relay POST → success/error
//   5. On success, modal stays open showing the tx hash; player closes it
//
// Anything chain-related stays hidden until the player chooses to engage.

import { CONFIG } from "../chain/config.js";
import { submitScore, type SubmitResult } from "../chain/relay.js";
import {
  clearLatestTranscript,
  getLatestTranscript,
  onTranscriptChange,
} from "../chain/transcript-buffer.js";
import { connect, getAddress } from "../chain/wallet.js";

const STYLE = `
  #fs-submit-btn {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 90;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 13px;
    padding: 10px 14px;
    background: #1f2a44;
    color: #fff;
    border: 1px solid #4a6da8;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  #fs-submit-btn:hover { background: #2c3b62; }
  #fs-submit-modal {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    color: #eee;
  }
  #fs-submit-modal .card {
    background: #16223a;
    border: 1px solid #3a4a6b;
    border-radius: 8px;
    padding: 20px 24px;
    min-width: 320px;
    max-width: 480px;
    font-size: 13px;
  }
  #fs-submit-modal h2 {
    margin: 0 0 12px;
    font-size: 15px;
  }
  #fs-submit-modal .row { margin-top: 10px; }
  #fs-submit-modal button {
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    background: #2b3b5e;
    color: #fff;
    border: 1px solid #4a5d85;
    border-radius: 4px;
    padding: 6px 12px;
  }
  #fs-submit-modal button:hover:not(:disabled) { background: #3a4d75; }
  #fs-submit-modal button:disabled { opacity: 0.5; cursor: not-allowed; }
  #fs-submit-modal code {
    background: rgba(255,255,255,0.08);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 11px;
  }
  #fs-submit-modal .err { color: #ff7a7a; }
  #fs-submit-modal .ok  { color: #7aff8e; }
  #fs-submit-modal .muted { color: #94a3c6; font-size: 11px; }
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

export function mountSubmitUI(): void {
  injectStyle();

  let btn: HTMLButtonElement | null = null;
  let modal: HTMLDivElement | null = null;

  function showButton() {
    if (btn) return;
    btn = document.createElement("button");
    btn.id = "fs-submit-btn";
    btn.textContent = "🏆 Submit Score";
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  function hideButton() {
    btn?.remove();
    btn = null;
  }

  function closeModal() {
    modal?.remove();
    modal = null;
  }

  function openModal() {
    const transcript = getLatestTranscript();
    if (!transcript) return;

    modal = document.createElement("div");
    modal.id = "fs-submit-modal";
    modal.innerHTML = `
      <div class="card">
        <h2>Submit your score on-chain</h2>
        <div class="muted">
          ${transcript.length} byte transcript · network: ${CONFIG.networkPassphrase.startsWith("Test") ? "testnet" : "mainnet"}
        </div>
        <div class="row" id="fs-modal-wallet"></div>
        <div class="row" id="fs-modal-action"></div>
        <div class="row" id="fs-modal-status"></div>
        <div class="row" style="margin-top:16px;">
          <button id="fs-modal-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const walletEl = modal.querySelector<HTMLDivElement>("#fs-modal-wallet")!;
    const actionEl = modal.querySelector<HTMLDivElement>("#fs-modal-action")!;
    const statusEl = modal.querySelector<HTMLDivElement>("#fs-modal-status")!;
    modal.querySelector<HTMLButtonElement>("#fs-modal-close")!.onclick = closeModal;

    function setStatus(text: string, cls?: "ok" | "err") {
      statusEl.textContent = text;
      statusEl.className = "row" + (cls ? ` ${cls}` : "");
    }

    function renderAction(addr: string | null) {
      actionEl.innerHTML = "";
      if (!addr) return;
      if (!CONFIG.relayUrl) {
        actionEl.innerHTML = `<span class="err">VITE_RELAY_URL not set — submit unavailable.</span>`;
        return;
      }
      const submitBtn = document.createElement("button");
      submitBtn.textContent = "Submit to chain";
      submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        setStatus("Proving… this takes a few minutes. Don't close this tab.");
        try {
          const t = getLatestTranscript();
          if (!t) throw new Error("transcript no longer available");
          const result: SubmitResult = await submitScore(addr, t);
          if (result.ok) {
            const sc = result.score ?? "?";
            setStatus(`✅ Submitted. score=${sc} · tx ${result.tx_hash.slice(0, 12)}…`, "ok");
            clearLatestTranscript();
            hideButton();
          } else {
            setStatus(`Submit failed: ${result.error}`, "err");
            submitBtn.disabled = false;
          }
        } catch (e) {
          setStatus(`Submit failed: ${errMsg(e)}`, "err");
          submitBtn.disabled = false;
        }
      };
      actionEl.appendChild(submitBtn);
    }

    function renderWallet(addr: string | null) {
      walletEl.innerHTML = "";
      if (addr) {
        walletEl.innerHTML = `wallet: <code>${fmtAddress(addr)}</code>`;
      } else {
        const cb = document.createElement("button");
        cb.textContent = "Connect Wallet";
        cb.onclick = async () => {
          cb.disabled = true;
          setStatus("Opening wallet picker …");
          try {
            const a = await connect();
            setStatus(`Connected: ${fmtAddress(a)}`, "ok");
            renderWallet(a);
            renderAction(a);
          } catch (e) {
            setStatus(`Connect failed: ${errMsg(e)}`, "err");
            cb.disabled = false;
          }
        };
        walletEl.appendChild(cb);
      }
    }

    const current = getAddress();
    renderWallet(current);
    renderAction(current);
  }

  // Show/hide the floating button based on whether a transcript is buffered.
  onTranscriptChange((t) => {
    if (t) showButton();
    else hideButton();
  });
}

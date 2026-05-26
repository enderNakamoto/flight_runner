// Wallet panel — DOM-based overlay outside Phaser.
//
// Phase 6 flow (when VITE_RELAY_URL is set):
//   1. Player connects wallet (read-only — wallet only used for get_score).
//   2. Plays the game locally; transcript captured in memory at game over.
//   3. Click "Submit to Relay" → POST transcript to /api/runs.
//   4. Panel polls /api/runs/:id every 3s, surfaces status + tx_hash.
//
// Phase 5 fallback (VITE_RELAY_URL unset): manual prove.sh + upload
// proof_artifacts.json, signed by the wallet directly.

import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import type { HighScoreEntry } from "@flight/game-hub-client";
import { CONFIG } from "../chain/config.js";
import { getClient, getReadClient } from "../chain/game-hub.js";
import { getRunStatus, submitRun, type ProofStatus, type RunStatus } from "../chain/relay.js";
import {
  clearLatestTranscript,
  getLatestTranscript,
  onTranscriptChange,
} from "../chain/transcript-buffer.js";
import { connect, disconnect, getAddress, onWalletChange } from "../chain/wallet.js";

function fmtAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

function strkeyToPubkey(strkey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(strkey));
}

interface ProofArtifacts {
  seal: string;
  journal: string;
  output?: { score?: number; ticks_survived?: number };
}

function parseArtifacts(text: string): ProofArtifacts {
  const j = JSON.parse(text);
  if (typeof j.seal !== "string" || typeof j.journal !== "string") {
    throw new Error("proof_artifacts.json: missing seal/journal");
  }
  return j as ProofArtifacts;
}

export function mountWalletPanel(root: HTMLElement): void {
  root.innerHTML = `
    <div><strong>game_hub</strong> · ${CONFIG.relayUrl ? "relay-driven" : "manual"}</div>
    <div class="row">contract: <code id="cp-contract"></code></div>
    <div class="row" id="cp-wallet-row"></div>
    <div class="row" id="cp-best"></div>
    <div class="row" id="cp-submit"></div>
    <div class="row" id="cp-msg"></div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    root.querySelector(sel) as T;

  $<HTMLElement>("#cp-contract").textContent = CONFIG.gameHubContractId
    ? fmtAddress(CONFIG.gameHubContractId)
    : "(unset)";

  const walletRow = $<HTMLDivElement>("#cp-wallet-row");
  const bestRow = $<HTMLDivElement>("#cp-best");
  const submitRow = $<HTMLDivElement>("#cp-submit");
  const msgEl = $<HTMLDivElement>("#cp-msg");

  function setMsg(text: string, cls?: "ok" | "err") {
    msgEl.textContent = text;
    msgEl.className = "row" + (cls ? ` ${cls}` : "");
  }

  // ── Submit (relay path) ───────────────────────────────────────────────

  let polling = false;

  function renderSubmit(addr: string | null) {
    submitRow.innerHTML = "";
    if (!addr) return;

    if (CONFIG.relayUrl) {
      renderRelaySubmit(addr);
    } else {
      renderManualSubmit(addr);
    }
  }

  function renderRelaySubmit(addr: string) {
    const transcript = getLatestTranscript();
    if (!transcript) {
      submitRow.innerHTML = `<em>play a run, then submit when game over</em>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div style="color:#9bb;font-size:10px;">transcript ready (${transcript.length} bytes)</div>`;
    const btn = document.createElement("button");
    btn.textContent = "Submit to Relay";
    btn.onclick = () => relaySubmitFlow(addr).catch((e) => {
      setMsg(`submit failed: ${errMsg(e)}`, "err");
      btn.disabled = false;
    });
    wrap.appendChild(btn);
    submitRow.appendChild(wrap);
  }

  async function relaySubmitFlow(addr: string) {
    if (polling) return;
    const transcript = getLatestTranscript();
    if (!transcript) {
      setMsg("no transcript captured yet", "err");
      return;
    }
    setMsg("Posting transcript to relay …");
    const { run_id } = await submitRun(addr, transcript);
    setMsg(`Queued as run #${run_id}. Polling …`);
    clearLatestTranscript();
    renderSubmit(addr);
    polling = true;
    try {
      const final = await pollUntilDone(run_id);
      if (final.proof_status === "settled") {
        setMsg(
          `Settled! tx ${(final.tx_hash ?? "").slice(0, 12)}…`,
          "ok",
        );
        refreshBest(addr).catch(() => {});
      } else {
        setMsg(`Run #${run_id} failed: ${final.error ?? "unknown"}`, "err");
      }
    } finally {
      polling = false;
    }
  }

  async function pollUntilDone(runId: number): Promise<RunStatus> {
    const intervalMs = 3000;
    const deadlineMs = Date.now() + 30 * 60 * 1000; // 30 min — long enough for real Groth16
    while (Date.now() < deadlineMs) {
      const s = await getRunStatus(runId);
      setMsg(`run #${runId}: ${statusLabel(s.proof_status)}`);
      if (s.proof_status === "settled" || s.proof_status === "failed") return s;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`run #${runId} did not settle within 30 min`);
  }

  function statusLabel(s: ProofStatus): string {
    switch (s) {
      case "pending": return "queued (waiting for worker)";
      case "proving": return "proving (worker picked it up)";
      case "settled": return "settled on-chain";
      case "failed":  return "failed";
    }
  }

  // ── Submit (manual fallback when relay disabled) ──────────────────────

  function renderManualSubmit(addr: string) {
    if (!CONFIG.gameHubContractId) return;
    const cmd = `./scripts/prove.sh transcript.bin --player ${addr}`;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div style="color:#9bb; font-size:10px;">
        after playing: <code>${cmd}</code><br>
        then upload <code>proof_artifacts.json</code>:
      </div>`;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.style.fontSize = "10px";
    fileInput.style.marginTop = "4px";
    fileInput.style.display = "block";

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit Score";
    submitBtn.disabled = true;
    fileInput.onchange = () => {
      submitBtn.disabled = !fileInput.files || fileInput.files.length === 0;
    };
    submitBtn.onclick = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      submitBtn.disabled = true;
      setMsg("Parsing proof_artifacts.json …");
      try {
        const text = await file.text();
        const a = parseArtifacts(text);
        const seal = hexToBuffer(a.seal);
        const journal = hexToBuffer(a.journal);
        if (seal.length !== 260) throw new Error(`seal must be 260 bytes, got ${seal.length}`);
        if (journal.length !== 76) throw new Error(`journal must be 76 bytes, got ${journal.length}`);

        const journalPubkey = journal.subarray(12, 44).toString("hex");
        const walletPubkey = strkeyToPubkey(addr).toString("hex");
        if (journalPubkey !== walletPubkey) {
          throw new Error("proof commits to a different player than the connected wallet");
        }

        const client = getClient();
        setMsg("Signing submit_score …");
        const tx = await client.submit_score({
          game_id: CONFIG.flightScrollGameId,
          seal,
          journal,
        });
        const { result } = await tx.signAndSend();
        (result as { unwrap: () => void }).unwrap();
        setMsg(`Submitted! score=${a.output?.score ?? "?"}`, "ok");
        refreshBest(addr).catch(() => {});
      } catch (e) {
        setMsg(`submit_score failed: ${errMsg(e)}`, "err");
        submitBtn.disabled = !fileInput.files || fileInput.files.length === 0;
      }
    };
    wrap.appendChild(fileInput);
    wrap.appendChild(submitBtn);
    submitRow.appendChild(wrap);
  }

  // ── My Best ───────────────────────────────────────────────────────────

  function renderBestRow(entry: HighScoreEntry | null) {
    bestRow.innerHTML = "";
    const label = document.createElement("span");
    if (entry) {
      label.innerHTML =
        `best: <code>${entry.score}</code> · ticks <code>${entry.ticks_survived}</code> ` +
        `· seed <code>0x${(entry.seed >>> 0).toString(16).padStart(8, "0")}</code>`;
    } else {
      label.innerHTML = `best: <em>none yet</em>`;
    }
    const btn = document.createElement("button");
    btn.textContent = "Refresh";
    btn.style.marginLeft = "6px";
    const addr = getAddress();
    btn.disabled = !addr || !CONFIG.gameHubContractId;
    btn.onclick = () => {
      if (!addr) return;
      refreshBest(addr).catch((e) => setMsg(`get_score failed: ${errMsg(e)}`, "err"));
    };
    bestRow.appendChild(label);
    bestRow.appendChild(btn);
  }

  async function refreshBest(addr: string): Promise<void> {
    const client = getReadClient();
    const res = await client.get_score({
      game_id: CONFIG.flightScrollGameId,
      player_pubkey: strkeyToPubkey(addr),
    });
    const entry = (res.result as HighScoreEntry | undefined) ?? null;
    renderBestRow(entry);
  }

  // ── Wallet row ────────────────────────────────────────────────────────

  function renderWalletRow(addr: string | null) {
    if (addr) {
      walletRow.innerHTML = `wallet: <code>${fmtAddress(addr)}</code> `;
      const dc = document.createElement("button");
      dc.textContent = "Disconnect";
      dc.onclick = () => {
        disconnect();
        setMsg("Disconnected.");
      };
      walletRow.appendChild(dc);
    } else {
      walletRow.innerHTML = ``;
      const btn = document.createElement("button");
      btn.textContent = "Connect Wallet";
      btn.onclick = async () => {
        btn.disabled = true;
        setMsg("Opening wallet picker …");
        try {
          const a = await connect();
          setMsg(`Connected: ${fmtAddress(a)}`, "ok");
          refreshBest(a).catch(() => {});
        } catch (e) {
          setMsg(`Connect failed: ${errMsg(e)}`, "err");
          btn.disabled = false;
        }
      };
      walletRow.appendChild(btn);
    }
    renderSubmit(addr);
    renderBestRow(null);
  }

  onWalletChange(renderWalletRow);
  onTranscriptChange(() => {
    if (!polling) renderSubmit(getAddress());
  });
  renderWalletRow(getAddress());
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

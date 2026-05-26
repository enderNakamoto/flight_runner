// Wallet panel — DOM-based overlay that lives outside Phaser. Slice 5
// scope: Connect Wallet, Start On-Chain Run, Submit Score (paste
// proof_artifacts.json from `./scripts/prove.sh`), My Best view.
//
// Mounts into #chain-panel from index.html.

import { Buffer } from "buffer";
import type { HighScoreEntry } from "@flight/game-hub-client";
import { CONFIG } from "../chain/config.js";
import { getClient, getReadClient } from "../chain/game-hub.js";
import {
  clearCurrentRun,
  getCurrentRun,
  setCurrentRun,
} from "../chain/run-state.js";
import { connect, disconnect, getAddress, onWalletChange } from "../chain/wallet.js";

function fmtAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

interface ProofArtifacts {
  mode?: string;
  seal: string;
  journal: string;
  image_id?: string;
  output?: { score?: number; ticks_survived?: number; seed?: number };
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
    <div><strong>game_hub</strong> · testnet</div>
    <div class="row">contract: <code id="cp-contract"></code></div>
    <div class="row" id="cp-wallet-row"></div>
    <div class="row" id="cp-run-row"></div>
    <div class="row" id="cp-actions"></div>
    <div class="row" id="cp-submit"></div>
    <div class="row" id="cp-best"></div>
    <div class="row" id="cp-msg"></div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    root.querySelector(sel) as T;

  const contractEl = $<HTMLElement>("#cp-contract");
  contractEl.textContent = CONFIG.gameHubContractId
    ? fmtAddress(CONFIG.gameHubContractId)
    : "(unset — deploy in slice 6)";

  const walletRow = $<HTMLDivElement>("#cp-wallet-row");
  const runRow = $<HTMLDivElement>("#cp-run-row");
  const actions = $<HTMLDivElement>("#cp-actions");
  const submitRow = $<HTMLDivElement>("#cp-submit");
  const bestRow = $<HTMLDivElement>("#cp-best");
  const msgEl = $<HTMLDivElement>("#cp-msg");

  function setMsg(text: string, cls?: "ok" | "err") {
    msgEl.textContent = text;
    msgEl.className = "row" + (cls ? ` ${cls}` : "");
  }

  function renderRunRow() {
    const r = getCurrentRun();
    if (!r) {
      runRow.innerHTML = `run: <em>none</em>`;
      return;
    }
    runRow.innerHTML = `run #${r.runId} · seed <code>0x${(r.seed >>> 0)
      .toString(16)
      .padStart(8, "0")}</code>`;
  }

  // ── Start On-Chain Run / Clear run ────────────────────────────────────

  function renderActions(addr: string | null) {
    actions.innerHTML = "";
    if (!addr) return;
    if (!CONFIG.gameHubContractId) return;
    const r = getCurrentRun();
    if (r) {
      const clearBtn = document.createElement("button");
      clearBtn.textContent = "Clear run (use local seed)";
      clearBtn.onclick = () => {
        clearCurrentRun();
        renderRunRow();
        renderActions(addr);
        renderSubmit(addr);
        setMsg("Reload the page to start with a local seed.", "ok");
      };
      actions.appendChild(clearBtn);
      return;
    }
    const startBtn = document.createElement("button");
    startBtn.textContent = "Start On-Chain Run";
    startBtn.onclick = async () => {
      startBtn.disabled = true;
      setMsg("Signing start_run …");
      try {
        const client = getClient();
        const tx = await client.start_run({
          game_id: CONFIG.flightScrollGameId,
          player: addr,
        });
        setMsg("Submitting tx …");
        const { result } = await tx.signAndSend();
        const runId = (result as { unwrap: () => bigint }).unwrap();
        setMsg(`Fetching seed for run #${runId} …`);
        const runRes = await client.get_run({ run_id: runId });
        const runData = runRes.result as
          | { game_id: number; player: string; seed: number; settled: boolean }
          | undefined;
        if (!runData) throw new Error("get_run returned None");
        setCurrentRun({
          runId: runId.toString(),
          seed: runData.seed,
          player: addr,
          gameId: runData.game_id,
        });
        setMsg("Run started — reloading to begin play …", "ok");
        renderRunRow();
        setTimeout(() => location.reload(), 400);
      } catch (e) {
        setMsg(`start_run failed: ${errMsg(e)}`, "err");
        startBtn.disabled = false;
      }
    };
    actions.appendChild(startBtn);
  }

  // ── Submit Score ──────────────────────────────────────────────────────

  function renderSubmit(addr: string | null) {
    submitRow.innerHTML = "";
    if (!addr) return;
    if (!CONFIG.gameHubContractId) return;
    const r = getCurrentRun();
    if (!r) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div style="color:#9bb; font-size:10px;">
        after playing: <code>./scripts/prove.sh transcript.bin</code> →
        upload <code>proof_artifacts.json</code> below
      </div>
    `;
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
        if (journal.length !== 44) throw new Error(`journal must be 44 bytes, got ${journal.length}`);

        const client = getClient();
        setMsg("Signing settle_run …");
        const tx = await client.settle_run({
          run_id: BigInt(r.runId),
          seal,
          journal,
        });
        setMsg("Submitting tx …");
        const { result } = await tx.signAndSend();
        (result as { unwrap: () => void }).unwrap();
        clearCurrentRun();
        renderRunRow();
        renderActions(addr);
        renderSubmit(addr);
        const sc = a.output?.score ?? "?";
        const t = a.output?.ticks_survived ?? "?";
        setMsg(`Settled! score=${sc} ticks=${t}`, "ok");
        refreshBest(addr).catch(() => { /* swallow */ });
      } catch (e) {
        setMsg(`settle_run failed: ${errMsg(e)}`, "err");
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
      label.innerHTML = `best: <code>${entry.score}</code> · ticks <code>${entry.ticks_survived}</code> · run #${entry.run_id}`;
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
      player: addr,
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
        clearCurrentRun();
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
          // Auto-fetch best on connect.
          refreshBest(a).catch(() => { /* fail quietly */ });
        } catch (e) {
          setMsg(`Connect failed: ${errMsg(e)}`, "err");
          btn.disabled = false;
        }
      };
      walletRow.appendChild(btn);
    }
    renderActions(addr);
    renderSubmit(addr);
    renderBestRow(null);
  }

  onWalletChange((addr) => {
    renderWalletRow(addr);
    renderRunRow();
  });

  renderRunRow();
  renderWalletRow(getAddress());
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

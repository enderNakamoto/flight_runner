// Wallet panel — DOM-based overlay that lives outside Phaser. Slice 5b
// renders Connect Wallet + Start On-Chain Run. Slice 5c adds Submit Score
// and My Best.
//
// Mounts into #chain-panel from index.html.

import { CONFIG } from "../chain/config.js";
import { getClient } from "../chain/game-hub.js";
import { clearCurrentRun, getCurrentRun, setCurrentRun } from "../chain/run-state.js";
import { connect, disconnect, getAddress, onWalletChange } from "../chain/wallet.js";

function fmtAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function mountWalletPanel(root: HTMLElement): void {
  root.innerHTML = `
    <div><strong>game_hub</strong> · testnet</div>
    <div class="row">contract: <code id="cp-contract"></code></div>
    <div class="row" id="cp-wallet-row"></div>
    <div class="row" id="cp-run-row"></div>
    <div class="row" id="cp-actions"></div>
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
        // Result is a Result<u64, Error> from generated bindings.
        // `result.unwrap()` throws if it's Err.
        const runId = (result as { unwrap: () => bigint }).unwrap();
        setMsg(`Fetching seed for run #${runId} …`);
        const runRes = await client.get_run({ run_id: runId });
        const runData = runRes.result as { game_id: number; player: string; seed: number; settled: boolean } | undefined;
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
        const m = e instanceof Error ? e.message : String(e);
        setMsg(`start_run failed: ${m}`, "err");
        startBtn.disabled = false;
      }
    };
    actions.appendChild(startBtn);
  }

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
          const addr = await connect();
          setMsg(`Connected: ${fmtAddress(addr)}`, "ok");
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          setMsg(`Connect failed: ${m}`, "err");
          btn.disabled = false;
        }
      };
      walletRow.appendChild(btn);
    }
    renderActions(addr);
  }

  onWalletChange((addr) => {
    renderWalletRow(addr);
    renderRunRow();
  });

  renderRunRow();
  renderWalletRow(getAddress());
}

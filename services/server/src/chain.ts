// Soroban client. Builds + signs + submits + polls a single submit_score
// transaction. The relay's own keypair pays gas — players don't sign
// anything for the relay path.

import {
  Contract,
  Keypair,
  TransactionBuilder,
  rpc as rpcNs,
  xdr,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { CONFIG } from "./config.ts";

const TX_TIMEOUT_SECONDS = 60;
const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 60_000;

let serverSingleton: rpcNs.Server | null = null;
let keypairSingleton: Keypair | null = null;

function server(): rpcNs.Server {
  if (!serverSingleton) serverSingleton = new rpcNs.Server(CONFIG.rpcUrl);
  return serverSingleton;
}

function relayKeypair(): Keypair {
  if (!keypairSingleton) keypairSingleton = Keypair.fromSecret(CONFIG.relaySecretKey);
  return keypairSingleton;
}

export interface SubmitOk {
  ok: true;
  txHash: string;
}
export interface SubmitErr {
  ok: false;
  error: string;
}
export type SubmitResult = SubmitOk | SubmitErr;

/// Submits game_hub::submit_score(game_id, seal, journal) and waits for
/// the tx to land. Returns the tx hash on success or a structured error.
/// All exceptions are caught and returned as `ok: false`.
export async function submitScore(
  gameId: number,
  sealHex: string,
  journalHex: string,
): Promise<SubmitResult> {
  try {
    const seal = Buffer.from(sealHex, "hex");
    const journal = Buffer.from(journalHex, "hex");
    if (seal.length !== 260) return { ok: false, error: `seal must be 260 bytes (got ${seal.length})` };
    if (journal.length !== 76) return { ok: false, error: `journal must be 76 bytes (got ${journal.length})` };

    const kp = relayKeypair();
    const rpc = server();
    const account = await rpc.getAccount(kp.publicKey());
    const contract = new Contract(CONFIG.gameHubContractId);

    const op = contract.call(
      "submit_score",
      nativeToScVal(gameId, { type: "u32" }),
      xdr.ScVal.scvBytes(seal),
      xdr.ScVal.scvBytes(journal),
    );

    let tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: CONFIG.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    // Simulate to get the soroban footprint, then attach it.
    const sim = await rpc.simulateTransaction(tx);
    if (rpcNs.Api.isSimulationError(sim)) {
      return { ok: false, error: `simulate: ${sim.error}` };
    }
    tx = rpcNs.assembleTransaction(tx, sim).build();
    tx.sign(kp);

    const send = await rpc.sendTransaction(tx);
    if (send.status === "ERROR") {
      return { ok: false, error: `sendTransaction ERROR: ${JSON.stringify(send.errorResult)}` };
    }

    // Poll for final status. PENDING → SUCCESS | FAILED | NOT_FOUND.
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let last: rpcNs.Api.GetTransactionResponse | null = null;
    while (Date.now() < deadline) {
      const r = await rpc.getTransaction(send.hash);
      last = r;
      if (r.status === "SUCCESS") return { ok: true, txHash: send.hash };
      if (r.status === "FAILED") {
        return { ok: false, error: `tx failed: ${JSON.stringify(r.resultXdr?.toXDR("base64"))}` };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return {
      ok: false,
      error: `tx ${send.hash} not landed within ${POLL_DEADLINE_MS}ms (last status: ${last?.status ?? "?"})`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

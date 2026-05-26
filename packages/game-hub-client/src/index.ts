import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"Unauthorized"},
  4: {message:"GameNotFound"},
  5: {message:"GameAlreadyExists"},
  6: {message:"GamePaused"},
  7: {message:"RunNotFound"},
  8: {message:"RunAlreadySettled"},
  9: {message:"RunAlreadyActive"},
  10: {message:"InvalidSeal"},
  11: {message:"InvalidJournal"},
  12: {message:"SeedMismatch"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Verifier", values: void} | {tag: "RunCounter", values: void} | {tag: "Game", values: readonly [u32]} | {tag: "ActiveRun", values: readonly [u32, string]} | {tag: "Run", values: readonly [u64]} | {tag: "HighScore", values: readonly [u32, string]};


export interface RunData {
  game_id: u32;
  player: string;
  /**
 * 32-bit seed minted at `start_run`. Mirror of TS sim's `seed` field.
 * `settle_run` rejects proofs whose journal seed disagrees.
 */
seed: u32;
  settled: boolean;
}


export interface GameMeta {
  /**
 * 32-byte RISC Zero guest image ID. Verifier accepts proofs only for
 * this exact ELF.
 */
image_id: Buffer;
  /**
 * Human-readable slug, e.g. "flight_scroll". Surface in UIs.
 */
name: string;
  /**
 * Admin kill switch — when true, `start_run` and `settle_run` reject.
 */
paused: boolean;
}


export interface HighScoreEntry {
  /**
 * run_id of the proof that set this entry — lets clients link back to
 * the on-chain settled event for replay context.
 */
run_id: u64;
  score: u32;
  /**
 * Ledger timestamp at settlement.
 */
settled_at: u64;
  ticks_survived: u32;
}

export interface Client {
  /**
   * Construct and simulate a get_run transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_run: ({run_id}: {run_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<RunData>>>

  /**
   * Construct and simulate a add_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a new game. Admin-provided id (so clients can hardcode
   * well-known IDs); rejects on collision. Initial `paused = false`.
   */
  add_game: ({game_id, image_id, name}: {game_id: u32, image_id: Buffer, name: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({game_id}: {game_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<GameMeta>>>

  /**
   * Construct and simulate a get_score transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_score: ({game_id, player}: {game_id: u32, player: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<HighScoreEntry>>>

  /**
   * Construct and simulate a start_run transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Begin a run for `player` against `game_id`. Returns a fresh `run_id`
   * and pins the run's seed in temporary storage.
   * 
   * Seed derivation: `ledger.sequence ⊕ ledger.timestamp ⊕ run_id`,
   * XOR-folded to u32. Deterministic (so the proof can replay it),
   * unpredictable before the ledger closes (so the player can't
   * pre-game it), and uniquely tied to this run_id (so two concurrent
   * runs get different seeds even within the same ledger).
   * 
   * Auth: the player signs. Initialization is implicit via `require_admin`
   * (which only checks that Admin exists — admin doesn't co-sign).
   */
  start_run: ({game_id, player}: {game_id: u32, player: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a cancel_run transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Player-initiated cancel. Frees the active-run slot so the player can
   * `start_run` again immediately. Already-settled runs reject.
   */
  cancel_run: ({run_id}: {run_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-shot setup. The future admin must sign the tx (`require_auth`)
   * so an arbitrary third party can't front-run init and seize the contract.
   */
  initialize: ({admin, verifier}: {admin: string, verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Per-game kill switch. When paused, `start_run` and `settle_run`
   * reject. Existing in-flight runs are unaffected until the player
   * tries to settle them.
   */
  set_paused: ({game_id, paused}: {game_id: u32, paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle_run transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify a RISC Zero proof for `run_id` and conditionally update the
   * player's personal best. Permissionless — anyone can submit on behalf
   * of the original player (the proof binds the run via seed equality
   * and `RunData.player` was pinned at `start_run`).
   * 
   * The high-score table updates only when `(score, ticks_survived)` is
   * strictly greater than the existing entry (ties broken by ticks).
   * Lower scores still consume the run (mark settled) but don't write to
   * the leaderboard table — the player paid gas to verify a real proof,
   * we honour that with a `settled` event regardless.
   */
  settle_run: ({run_id, seal, journal}: {run_id: u64, seal: Buffer, journal: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rotate_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Hand the admin role to a new address. Current admin must auth.
   */
  rotate_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_image_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Rotate the pinned image_id for a game — used when the sim is updated
   * and a new guest ELF is shipped. Old in-flight proofs (with the old
   * image_id) will start failing `settle_run` until they get re-proven.
   * Coordinate rotations with low player activity.
   */
  set_image_id: ({game_id, new_image_id}: {game_id: u32, new_image_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAAAAAAAMR2FtZU5vdEZvdW5kAAAABAAAAAAAAAARR2FtZUFscmVhZHlFeGlzdHMAAAAAAAAFAAAAAAAAAApHYW1lUGF1c2VkAAAAAAAGAAAAAAAAAAtSdW5Ob3RGb3VuZAAAAAAHAAAAAAAAABFSdW5BbHJlYWR5U2V0dGxlZAAAAAAAAAgAAAAAAAAAEFJ1bkFscmVhZHlBY3RpdmUAAAAJAAAAAAAAAAtJbnZhbGlkU2VhbAAAAAAKAAAAAAAAAA5JbnZhbGlkSm91cm5hbAAAAAAACwAAAAAAAAAMU2VlZE1pc21hdGNoAAAADA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABwAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAIVmVyaWZpZXIAAAAAAAAAAAAAAApSdW5Db3VudGVyAAAAAAABAAAAHlBlci1nYW1lIG1ldGFkYXRhLiBQZXJzaXN0ZW50LgAAAAAABEdhbWUAAAABAAAABAAAAAEAAABvQWN0aXZlIGluLWZsaWdodCBydW4sIHNjb3BlZCBwZXIgKGdhbWUsIHBsYXllcikuIFRlbXBvcmFyeSwgMjQgaCBUVEwuCkNsZWFyZWQgYnkgYGNhbmNlbF9ydW5gIGFuZCBgc2V0dGxlX3J1bmAuAAAAAAlBY3RpdmVSdW4AAAAAAAACAAAABAAAABMAAAABAAAAPlBlbmRpbmcgcnVuIGRhdGEsIGtleWVkIGJ5IGdsb2JhbCBydW5faWQuIFRlbXBvcmFyeSwgMjQgaCBUVEwuAAAAAAADUnVuAAAAAAEAAAAGAAAAAQAAAL5QbGF5ZXIncyBwZXJzb25hbC1iZXN0IHNjb3JlIGZvciBhIGdhbWUuIFBlcnNpc3RlbnQuIE9ubHkgc2V0L3VwZGF0ZWQKd2hlbiBgc2V0dGxlX3J1bmAgdmVyaWZpZXMgYSBwcm9vZiB3aXRoIGEgc3RyaWN0bHkgaGlnaGVyIHNjb3JlIChvcgplcXVhbCBzY29yZSArIGhpZ2hlciB0aWNrc19zdXJ2aXZlZCBhcyB0aWUtYnJlYWtlcikuAAAAAAAJSGlnaFNjb3JlAAAAAAAAAgAAAAQAAAAT",
        "AAAAAQAAAAAAAAAAAAAAB1J1bkRhdGEAAAAABAAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAB9MzItYml0IHNlZWQgbWludGVkIGF0IGBzdGFydF9ydW5gLiBNaXJyb3Igb2YgVFMgc2ltJ3MgYHNlZWRgIGZpZWxkLgpgc2V0dGxlX3J1bmAgcmVqZWN0cyBwcm9vZnMgd2hvc2Ugam91cm5hbCBzZWVkIGRpc2FncmVlcy4AAAAAAAAEc2VlZAAAAAQAAAAAAAAAB3NldHRsZWQAAAAAAQ==",
        "AAAAAAAAAAAAAAAHZ2V0X3J1bgAAAAABAAAAAAAAAAZydW5faWQAAAAAAAYAAAABAAAD6AAAB9AAAAAHUnVuRGF0YQA=",
        "AAAAAQAAAAAAAAAAAAAACEdhbWVNZXRhAAAAAwAAAFIzMi1ieXRlIFJJU0MgWmVybyBndWVzdCBpbWFnZSBJRC4gVmVyaWZpZXIgYWNjZXB0cyBwcm9vZnMgb25seSBmb3IKdGhpcyBleGFjdCBFTEYuAAAAAAAIaW1hZ2VfaWQAAAPuAAAAIAAAADpIdW1hbi1yZWFkYWJsZSBzbHVnLCBlLmcuICJmbGlnaHRfc2Nyb2xsIi4gU3VyZmFjZSBpbiBVSXMuAAAAAAAEbmFtZQAAABAAAABFQWRtaW4ga2lsbCBzd2l0Y2gg4oCUIHdoZW4gdHJ1ZSwgYHN0YXJ0X3J1bmAgYW5kIGBzZXR0bGVfcnVuYCByZWplY3QuAAAAAAAABnBhdXNlZAAAAAAAAQ==",
        "AAAAAAAAAIBSZWdpc3RlciBhIG5ldyBnYW1lLiBBZG1pbi1wcm92aWRlZCBpZCAoc28gY2xpZW50cyBjYW4gaGFyZGNvZGUKd2VsbC1rbm93biBJRHMpOyByZWplY3RzIG9uIGNvbGxpc2lvbi4gSW5pdGlhbCBgcGF1c2VkID0gZmFsc2VgLgAAAAhhZGRfZ2FtZQAAAAMAAAAAAAAAB2dhbWVfaWQAAAAABAAAAAAAAAAIaW1hZ2VfaWQAAAPuAAAAIAAAAAAAAAAEbmFtZQAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAABAAAD6AAAB9AAAAAIR2FtZU1ldGE=",
        "AAAAAAAAAAAAAAAJZ2V0X3Njb3JlAAAAAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAABAAAD6AAAB9AAAAAOSGlnaFNjb3JlRW50cnkAAA==",
        "AAAAAAAAAjRCZWdpbiBhIHJ1biBmb3IgYHBsYXllcmAgYWdhaW5zdCBgZ2FtZV9pZGAuIFJldHVybnMgYSBmcmVzaCBgcnVuX2lkYAphbmQgcGlucyB0aGUgcnVuJ3Mgc2VlZCBpbiB0ZW1wb3Jhcnkgc3RvcmFnZS4KClNlZWQgZGVyaXZhdGlvbjogYGxlZGdlci5zZXF1ZW5jZSDiipUgbGVkZ2VyLnRpbWVzdGFtcCDiipUgcnVuX2lkYCwKWE9SLWZvbGRlZCB0byB1MzIuIERldGVybWluaXN0aWMgKHNvIHRoZSBwcm9vZiBjYW4gcmVwbGF5IGl0KSwKdW5wcmVkaWN0YWJsZSBiZWZvcmUgdGhlIGxlZGdlciBjbG9zZXMgKHNvIHRoZSBwbGF5ZXIgY2FuJ3QKcHJlLWdhbWUgaXQpLCBhbmQgdW5pcXVlbHkgdGllZCB0byB0aGlzIHJ1bl9pZCAoc28gdHdvIGNvbmN1cnJlbnQKcnVucyBnZXQgZGlmZmVyZW50IHNlZWRzIGV2ZW4gd2l0aGluIHRoZSBzYW1lIGxlZGdlcikuCgpBdXRoOiB0aGUgcGxheWVyIHNpZ25zLiBJbml0aWFsaXphdGlvbiBpcyBpbXBsaWNpdCB2aWEgYHJlcXVpcmVfYWRtaW5gCih3aGljaCBvbmx5IGNoZWNrcyB0aGF0IEFkbWluIGV4aXN0cyDigJQgYWRtaW4gZG9lc24ndCBjby1zaWduKS4AAAAJc3RhcnRfcnVuAAAAAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAIBQbGF5ZXItaW5pdGlhdGVkIGNhbmNlbC4gRnJlZXMgdGhlIGFjdGl2ZS1ydW4gc2xvdCBzbyB0aGUgcGxheWVyIGNhbgpgc3RhcnRfcnVuYCBhZ2FpbiBpbW1lZGlhdGVseS4gQWxyZWFkeS1zZXR0bGVkIHJ1bnMgcmVqZWN0LgAAAApjYW5jZWxfcnVuAAAAAAABAAAAAAAAAAZydW5faWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAItPbmUtc2hvdCBzZXR1cC4gVGhlIGZ1dHVyZSBhZG1pbiBtdXN0IHNpZ24gdGhlIHR4IChgcmVxdWlyZV9hdXRoYCkKc28gYW4gYXJiaXRyYXJ5IHRoaXJkIHBhcnR5IGNhbid0IGZyb250LXJ1biBpbml0IGFuZCBzZWl6ZSB0aGUgY29udHJhY3QuAAAAAAppbml0aWFsaXplAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHZlcmlmaWVyAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAJVQZXItZ2FtZSBraWxsIHN3aXRjaC4gV2hlbiBwYXVzZWQsIGBzdGFydF9ydW5gIGFuZCBgc2V0dGxlX3J1bmAKcmVqZWN0LiBFeGlzdGluZyBpbi1mbGlnaHQgcnVucyBhcmUgdW5hZmZlY3RlZCB1bnRpbCB0aGUgcGxheWVyCnRyaWVzIHRvIHNldHRsZSB0aGVtLgAAAAAAAApzZXRfcGF1c2VkAAAAAAACAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAj9WZXJpZnkgYSBSSVNDIFplcm8gcHJvb2YgZm9yIGBydW5faWRgIGFuZCBjb25kaXRpb25hbGx5IHVwZGF0ZSB0aGUKcGxheWVyJ3MgcGVyc29uYWwgYmVzdC4gUGVybWlzc2lvbmxlc3Mg4oCUIGFueW9uZSBjYW4gc3VibWl0IG9uIGJlaGFsZgpvZiB0aGUgb3JpZ2luYWwgcGxheWVyICh0aGUgcHJvb2YgYmluZHMgdGhlIHJ1biB2aWEgc2VlZCBlcXVhbGl0eQphbmQgYFJ1bkRhdGEucGxheWVyYCB3YXMgcGlubmVkIGF0IGBzdGFydF9ydW5gKS4KClRoZSBoaWdoLXNjb3JlIHRhYmxlIHVwZGF0ZXMgb25seSB3aGVuIGAoc2NvcmUsIHRpY2tzX3N1cnZpdmVkKWAgaXMKc3RyaWN0bHkgZ3JlYXRlciB0aGFuIHRoZSBleGlzdGluZyBlbnRyeSAodGllcyBicm9rZW4gYnkgdGlja3MpLgpMb3dlciBzY29yZXMgc3RpbGwgY29uc3VtZSB0aGUgcnVuIChtYXJrIHNldHRsZWQpIGJ1dCBkb24ndCB3cml0ZSB0bwp0aGUgbGVhZGVyYm9hcmQgdGFibGUg4oCUIHRoZSBwbGF5ZXIgcGFpZCBnYXMgdG8gdmVyaWZ5IGEgcmVhbCBwcm9vZiwKd2UgaG9ub3VyIHRoYXQgd2l0aCBhIGBzZXR0bGVkYCBldmVudCByZWdhcmRsZXNzLgAAAAAKc2V0dGxlX3J1bgAAAAAAAwAAAAAAAAAGcnVuX2lkAAAAAAAGAAAAAAAAAARzZWFsAAAADgAAAAAAAAAHam91cm5hbAAAAAAOAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAD5IYW5kIHRoZSBhZG1pbiByb2xlIHRvIGEgbmV3IGFkZHJlc3MuIEN1cnJlbnQgYWRtaW4gbXVzdCBhdXRoLgAAAAAADHJvdGF0ZV9hZG1pbgAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAPxSb3RhdGUgdGhlIHBpbm5lZCBpbWFnZV9pZCBmb3IgYSBnYW1lIOKAlCB1c2VkIHdoZW4gdGhlIHNpbSBpcyB1cGRhdGVkCmFuZCBhIG5ldyBndWVzdCBFTEYgaXMgc2hpcHBlZC4gT2xkIGluLWZsaWdodCBwcm9vZnMgKHdpdGggdGhlIG9sZAppbWFnZV9pZCkgd2lsbCBzdGFydCBmYWlsaW5nIGBzZXR0bGVfcnVuYCB1bnRpbCB0aGV5IGdldCByZS1wcm92ZW4uCkNvb3JkaW5hdGUgcm90YXRpb25zIHdpdGggbG93IHBsYXllciBhY3Rpdml0eS4AAAAMc2V0X2ltYWdlX2lkAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAxuZXdfaW1hZ2VfaWQAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAQAAAAAAAAAAAAAADkhpZ2hTY29yZUVudHJ5AAAAAAAEAAAAdHJ1bl9pZCBvZiB0aGUgcHJvb2YgdGhhdCBzZXQgdGhpcyBlbnRyeSDigJQgbGV0cyBjbGllbnRzIGxpbmsgYmFjayB0bwp0aGUgb24tY2hhaW4gc2V0dGxlZCBldmVudCBmb3IgcmVwbGF5IGNvbnRleHQuAAAABnJ1bl9pZAAAAAAABgAAAAAAAAAFc2NvcmUAAAAAAAAEAAAAH0xlZGdlciB0aW1lc3RhbXAgYXQgc2V0dGxlbWVudC4AAAAACnNldHRsZWRfYXQAAAAAAAYAAAAAAAAADnRpY2tzX3N1cnZpdmVkAAAAAAAE" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_run: this.txFromJSON<Option<RunData>>,
        add_game: this.txFromJSON<Result<void>>,
        get_game: this.txFromJSON<Option<GameMeta>>,
        get_score: this.txFromJSON<Option<HighScoreEntry>>,
        start_run: this.txFromJSON<Result<u64>>,
        cancel_run: this.txFromJSON<Result<void>>,
        initialize: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        settle_run: this.txFromJSON<Result<void>>,
        rotate_admin: this.txFromJSON<Result<void>>,
        set_image_id: this.txFromJSON<Result<void>>
  }
}
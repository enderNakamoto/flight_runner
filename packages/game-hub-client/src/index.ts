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
  7: {message:"InvalidSeal"},
  8: {message:"InvalidJournal"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Verifier", values: void} | {tag: "Game", values: readonly [u32]} | {tag: "HighScore", values: readonly [u32, Buffer]};


export interface GameMeta {
  /**
 * 32-byte RISC Zero guest image ID. Verifier accepts proofs only for
 * this exact ELF.
 */
image_id: Buffer;
  /**
 * Human-readable slug, e.g. "flight_scroll".
 */
name: string;
  /**
 * Admin kill switch — when true, `submit_score` rejects.
 */
paused: boolean;
}


export interface HighScoreEntry {
  score: u32;
  /**
 * 32-bit seed the player ran the sim with. Stored for reproducibility
 * (anyone can replay the run by querying this seed + the off-chain
 * transcript). NOT verified on-chain.
 */
seed: u32;
  /**
 * Ledger timestamp at settlement.
 */
settled_at: u64;
  ticks_survived: u32;
}

export interface Client {
  /**
   * Construct and simulate a add_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_game: ({game_id, image_id, name}: {game_id: u32, image_id: Buffer, name: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({game_id}: {game_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<GameMeta>>>

  /**
   * Construct and simulate a get_score transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_score: ({game_id, player_pubkey}: {game_id: u32, player_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<HighScoreEntry>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, verifier}: {admin: string, verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_paused: ({game_id, paused}: {game_id: u32, paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rotate_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  rotate_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_image_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_image_id: ({game_id, new_image_id}: {game_id: u32, new_image_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_score transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify a RISC Zero proof and conditionally update the committed
   * player's personal best. No auth required: the proof binds the
   * score to a specific 32-byte pubkey, and the score is always
   * credited there. Anyone (player, relay, friend) can pay the gas.
   * 
   * PB updates only when `(score, ticks_survived)` strictly exceeds
   * the existing entry (ties broken by ticks). Lower scores are
   * rejected with no state change — saves gas vs. always writing.
   */
  submit_score: ({game_id, seal, journal}: {game_id: u32, seal: Buffer, journal: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAAAAAAAMR2FtZU5vdEZvdW5kAAAABAAAAAAAAAARR2FtZUFscmVhZHlFeGlzdHMAAAAAAAAFAAAAAAAAAApHYW1lUGF1c2VkAAAAAAAGAAAAAAAAAAtJbnZhbGlkU2VhbAAAAAAHAAAAAAAAAA5JbnZhbGlkSm91cm5hbAAAAAAACA==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAIVmVyaWZpZXIAAAABAAAAHlBlci1nYW1lIG1ldGFkYXRhLiBQZXJzaXN0ZW50LgAAAAAABEdhbWUAAAABAAAABAAAAAEAAAB6UGxheWVyJ3MgcGVyc29uYWwtYmVzdCBzY29yZSBmb3IgYSBnYW1lLCBrZXllZCBieSB0aGUgMzItYnl0ZQpFRDI1NTE5IHB1YmtleSBjb21taXR0ZWQgaW4gdGhlIHByb29mJ3Mgam91cm5hbC4gUGVyc2lzdGVudC4AAAAAAAlIaWdoU2NvcmUAAAAAAAACAAAABAAAA+4AAAAg",
        "AAAAAQAAAAAAAAAAAAAACEdhbWVNZXRhAAAAAwAAAFIzMi1ieXRlIFJJU0MgWmVybyBndWVzdCBpbWFnZSBJRC4gVmVyaWZpZXIgYWNjZXB0cyBwcm9vZnMgb25seSBmb3IKdGhpcyBleGFjdCBFTEYuAAAAAAAIaW1hZ2VfaWQAAAPuAAAAIAAAACpIdW1hbi1yZWFkYWJsZSBzbHVnLCBlLmcuICJmbGlnaHRfc2Nyb2xsIi4AAAAAAARuYW1lAAAAEAAAADhBZG1pbiBraWxsIHN3aXRjaCDigJQgd2hlbiB0cnVlLCBgc3VibWl0X3Njb3JlYCByZWplY3RzLgAAAAZwYXVzZWQAAAAAAAE=",
        "AAAAAAAAAAAAAAAIYWRkX2dhbWUAAAADAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAAAAAAACGltYWdlX2lkAAAD7gAAACAAAAAAAAAABG5hbWUAAAAQAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAABAAAD6AAAB9AAAAAIR2FtZU1ldGE=",
        "AAAAAAAAAAAAAAAJZ2V0X3Njb3JlAAAAAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAA1wbGF5ZXJfcHVia2V5AAAAAAAD7gAAACAAAAABAAAD6AAAB9AAAAAOSGlnaFNjb3JlRW50cnkAAA==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAKc2V0X3BhdXNlZAAAAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMcm90YXRlX2FkbWluAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMc2V0X2ltYWdlX2lkAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAxuZXdfaW1hZ2VfaWQAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAbZWZXJpZnkgYSBSSVNDIFplcm8gcHJvb2YgYW5kIGNvbmRpdGlvbmFsbHkgdXBkYXRlIHRoZSBjb21taXR0ZWQKcGxheWVyJ3MgcGVyc29uYWwgYmVzdC4gTm8gYXV0aCByZXF1aXJlZDogdGhlIHByb29mIGJpbmRzIHRoZQpzY29yZSB0byBhIHNwZWNpZmljIDMyLWJ5dGUgcHVia2V5LCBhbmQgdGhlIHNjb3JlIGlzIGFsd2F5cwpjcmVkaXRlZCB0aGVyZS4gQW55b25lIChwbGF5ZXIsIHJlbGF5LCBmcmllbmQpIGNhbiBwYXkgdGhlIGdhcy4KClBCIHVwZGF0ZXMgb25seSB3aGVuIGAoc2NvcmUsIHRpY2tzX3N1cnZpdmVkKWAgc3RyaWN0bHkgZXhjZWVkcwp0aGUgZXhpc3RpbmcgZW50cnkgKHRpZXMgYnJva2VuIGJ5IHRpY2tzKS4gTG93ZXIgc2NvcmVzIGFyZQpyZWplY3RlZCB3aXRoIG5vIHN0YXRlIGNoYW5nZSDigJQgc2F2ZXMgZ2FzIHZzLiBhbHdheXMgd3JpdGluZy4AAAAAAAxzdWJtaXRfc2NvcmUAAAADAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAAAAAAABHNlYWwAAAAOAAAAAAAAAAdqb3VybmFsAAAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAAAQAAAAAAAAAAAAAADkhpZ2hTY29yZUVudHJ5AAAAAAAEAAAAAAAAAAVzY29yZQAAAAAAAAQAAACoMzItYml0IHNlZWQgdGhlIHBsYXllciByYW4gdGhlIHNpbSB3aXRoLiBTdG9yZWQgZm9yIHJlcHJvZHVjaWJpbGl0eQooYW55b25lIGNhbiByZXBsYXkgdGhlIHJ1biBieSBxdWVyeWluZyB0aGlzIHNlZWQgKyB0aGUgb2ZmLWNoYWluCnRyYW5zY3JpcHQpLiBOT1QgdmVyaWZpZWQgb24tY2hhaW4uAAAABHNlZWQAAAAEAAAAH0xlZGdlciB0aW1lc3RhbXAgYXQgc2V0dGxlbWVudC4AAAAACnNldHRsZWRfYXQAAAAAAAYAAAAAAAAADnRpY2tzX3N1cnZpdmVkAAAAAAAE" ]),
      options
    )
  }
  public readonly fromJSON = {
    add_game: this.txFromJSON<Result<void>>,
        get_game: this.txFromJSON<Option<GameMeta>>,
        get_score: this.txFromJSON<Option<HighScoreEntry>>,
        initialize: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        rotate_admin: this.txFromJSON<Result<void>>,
        set_image_id: this.txFromJSON<Result<void>>,
        submit_score: this.txFromJSON<Result<void>>
  }
}
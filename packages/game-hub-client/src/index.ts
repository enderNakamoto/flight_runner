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
  7: {message:"InvalidSeal"},
  8: {message:"InvalidJournal"},
  9: {message:"TrustedOperatorNotSet"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Verifier", values: void} | {tag: "TrustedOperator", values: void} | {tag: "ImageId", values: readonly [u32]} | {tag: "HighScore", values: readonly [u32, Buffer]} | {tag: "PlayerCount", values: readonly [u32]} | {tag: "PlayerByIndex", values: readonly [u32, u32]} | {tag: "PlayerSeen", values: readonly [u32, Buffer]};


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
  add_game: ({game_id, image_id}: {game_id: u32, image_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_score transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_score: ({game_id, player_pubkey}: {game_id: u32, player_pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<HighScoreEntry>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, verifier}: {admin: string, verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_image_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_image_id: ({game_id}: {game_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a rotate_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  rotate_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_image_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_image_id: ({game_id, new_image_id}: {game_id: u32, new_image_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Swap the verifier contract address. Used to cut over from
   * MockVerifier (testnet bringup, accepts anything) to the real
   * Nethermind stellar-risc0-verifier (production, does BN254
   * pairing checks). Affects every subsequent `submit_score` call;
   * already-stored HighScores are untouched.
   */
  set_verifier: ({new_verifier}: {new_verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_score transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify a RISC Zero proof and conditionally update the committed
   * player's personal best. No auth required: the proof binds the
   * score to a specific 32-byte pubkey, and the score is always
   * credited there. Anyone (player, relay, friend) can pay the gas.
   * 
   * PB updates only when `(score, ticks_survived)` strictly exceeds
   * the existing entry (ties broken by ticks). Lower scores are
   * silently kept-out and save the storage write.
   * 
   * Enumeration: on a player's first ever submission for this game,
   * they're added to the indexed `PlayerByIndex` table — unless that
   * table is already at `MAX_PLAYERS_PER_GAME`, in which case the
   * enumeration is **silently skipped** (HighScore is still written).
   */
  submit_score: ({game_id, seal, journal}: {game_id: u32, seal: Buffer, journal: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_player_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_player_at: ({game_id, idx}: {game_id: u32, idx: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a settle_attested transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Attest-mode settlement (Phase 13). Verifies an ed25519 signature
   * from the configured `TrustedOperator` over `(game_id || journal)`
   * in lieu of a RISC Zero proof, then applies the same HighScore +
   * enumeration update that `submit_score` does. The relay is the
   * trust anchor here — the operator's ed25519 secret must never be
   * committed and rotates via `set_trusted_operator`.
   * 
   * The journal layout is identical to `submit_score`'s (76 bytes,
   * see `JOURNAL_SIZE` doc above), so a relay can produce the same
   * shape from a native transcript replay without R0 in the loop.
   * 
   * The signed message is exactly `game_id_le (4 bytes) || journal
   * (76 bytes)` — concatenating game_id stops a single signed
   * journal from being replayed against a different game_id.
   */
  settle_attested: ({game_id, journal, op_signature}: {game_id: u32, journal: Buffer, op_signature: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_player_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_player_count: ({game_id}: {game_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_players_page transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Batched read for indexer pagination — returns players in
   * `[start, end)` index range, capped at `MAX_PAGE_SIZE` entries
   * to bound the tx's read-entry budget. End-of-table is signalled
   * by a shorter-than-requested return.
   */
  get_players_page: ({game_id, start, end}: {game_id: u32, start: u32, end: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Buffer>>>

  /**
   * Construct and simulate a get_trusted_operator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_trusted_operator: (options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_trusted_operator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set or rotate the ED25519 public key trusted to sign
   * `settle_attested` payloads (Phase 13 attest mode). Setting this
   * is what *enables* attest mode for the contract — until it's set,
   * `settle_attested` returns `TrustedOperatorNotSet`. Rotating
   * replaces the prior pubkey; in-flight signed payloads against the
   * old key stop verifying.
   */
  set_trusted_operator: ({new_operator}: {new_operator: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAAAAAAAMR2FtZU5vdEZvdW5kAAAABAAAAAAAAAARR2FtZUFscmVhZHlFeGlzdHMAAAAAAAAFAAAAAAAAAAtJbnZhbGlkU2VhbAAAAAAHAAAAAAAAAA5JbnZhbGlkSm91cm5hbAAAAAAACAAAAAAAAAAVVHJ1c3RlZE9wZXJhdG9yTm90U2V0AAAAAAAACQ==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAIVmVyaWZpZXIAAAAAAAAA6EVEMjU1MTkgcHVibGljIGtleSBvZiB0aGUgb2ZmLWNoYWluICJ0cnVzdGVkIG9wZXJhdG9yIiB0aGF0IHNpZ25zCmBzZXR0bGVfYXR0ZXN0ZWRgIHBheWxvYWRzIChQaGFzZSAxMyBhdHRlc3QgbW9kZSkuIFNpbmdsZSBnbG9iYWwKb3BlcmF0b3IgYWNyb3NzIGFsbCBnYW1lcy4gSW5zdGFuY2Ugc3RvcmFnZS4gT3B0aW9uYWwg4oCUIG9ubHkKcmVxdWlyZWQgd2hlbiBzZXR0bGVfYXR0ZXN0ZWQgaXMgdXNlZC4AAAAPVHJ1c3RlZE9wZXJhdG9yAAAAAAEAAAAzUGlubmVkIEVMRiBpbWFnZSBoYXNoIGZvciBhIGdpdmVuIGdhbWUuIFBlcnNpc3RlbnQuAAAAAAdJbWFnZUlkAAAAAAEAAAAEAAAAAQAAAHpQbGF5ZXIncyBwZXJzb25hbC1iZXN0IHNjb3JlIGZvciBhIGdhbWUsIGtleWVkIGJ5IHRoZSAzMi1ieXRlCkVEMjU1MTkgcHVia2V5IGNvbW1pdHRlZCBpbiB0aGUgcHJvb2YncyBqb3VybmFsLiBQZXJzaXN0ZW50LgAAAAAACUhpZ2hTY29yZQAAAAAAAAIAAAAEAAAD7gAAACAAAAABAAAAWE51bWJlciBvZiBkaXN0aW5jdCBlbnVtZXJhdGVkIHBsYXllcnMgZm9yIGEgZ2FtZSAoMC4uPU1BWF9QTEFZRVJTX1BFUl9HQU1FKS4KUGVyc2lzdGVudC4AAAALUGxheWVyQ291bnQAAAAAAQAAAAQAAAABAAAAk0luZGV4ZWQgbGlzdCBvZiBlbnVtZXJhdGVkIHBsYXllcnMuIGBQbGF5ZXJCeUluZGV4KGdhbWVfaWQsIGkpYCBpcwp0aGUgaS10aCB1bmlxdWUgc3VibWl0dGVyOyB2YWxpZCBmb3IgYGkgaW4gMC4uUGxheWVyQ291bnQoZ2FtZV9pZClgLgpQZXJzaXN0ZW50LgAAAAANUGxheWVyQnlJbmRleAAAAAAAAAIAAAAEAAAABAAAAAEAAABKTygxKSAiaGF2ZSBJIGFscmVhZHkgZW51bWVyYXRlZCB0aGlzIHB1YmtleT8iIG1lbWJlcnNoaXAgZmxhZy4KUGVyc2lzdGVudC4AAAAAAApQbGF5ZXJTZWVuAAAAAAACAAAABAAAA+4AAAAg",
        "AAAAAAAAAAAAAAAIYWRkX2dhbWUAAAACAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAAAAAAACGltYWdlX2lkAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X3Njb3JlAAAAAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAA1wbGF5ZXJfcHVia2V5AAAAAAAD7gAAACAAAAABAAAD6AAAB9AAAAAOSGlnaFNjb3JlRW50cnkAAA==",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMZ2V0X2ltYWdlX2lkAAAAAQAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAAAAAAAAMZ2V0X3ZlcmlmaWVyAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAMcm90YXRlX2FkbWluAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMc2V0X2ltYWdlX2lkAAAAAgAAAAAAAAAHZ2FtZV9pZAAAAAAEAAAAAAAAAAxuZXdfaW1hZ2VfaWQAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAARhTd2FwIHRoZSB2ZXJpZmllciBjb250cmFjdCBhZGRyZXNzLiBVc2VkIHRvIGN1dCBvdmVyIGZyb20KTW9ja1ZlcmlmaWVyICh0ZXN0bmV0IGJyaW5ndXAsIGFjY2VwdHMgYW55dGhpbmcpIHRvIHRoZSByZWFsCk5ldGhlcm1pbmQgc3RlbGxhci1yaXNjMC12ZXJpZmllciAocHJvZHVjdGlvbiwgZG9lcyBCTjI1NApwYWlyaW5nIGNoZWNrcykuIEFmZmVjdHMgZXZlcnkgc3Vic2VxdWVudCBgc3VibWl0X3Njb3JlYCBjYWxsOwphbHJlYWR5LXN0b3JlZCBIaWdoU2NvcmVzIGFyZSB1bnRvdWNoZWQuAAAADHNldF92ZXJpZmllcgAAAAEAAAAAAAAADG5ld192ZXJpZmllcgAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAqhWZXJpZnkgYSBSSVNDIFplcm8gcHJvb2YgYW5kIGNvbmRpdGlvbmFsbHkgdXBkYXRlIHRoZSBjb21taXR0ZWQKcGxheWVyJ3MgcGVyc29uYWwgYmVzdC4gTm8gYXV0aCByZXF1aXJlZDogdGhlIHByb29mIGJpbmRzIHRoZQpzY29yZSB0byBhIHNwZWNpZmljIDMyLWJ5dGUgcHVia2V5LCBhbmQgdGhlIHNjb3JlIGlzIGFsd2F5cwpjcmVkaXRlZCB0aGVyZS4gQW55b25lIChwbGF5ZXIsIHJlbGF5LCBmcmllbmQpIGNhbiBwYXkgdGhlIGdhcy4KClBCIHVwZGF0ZXMgb25seSB3aGVuIGAoc2NvcmUsIHRpY2tzX3N1cnZpdmVkKWAgc3RyaWN0bHkgZXhjZWVkcwp0aGUgZXhpc3RpbmcgZW50cnkgKHRpZXMgYnJva2VuIGJ5IHRpY2tzKS4gTG93ZXIgc2NvcmVzIGFyZQpzaWxlbnRseSBrZXB0LW91dCBhbmQgc2F2ZSB0aGUgc3RvcmFnZSB3cml0ZS4KCkVudW1lcmF0aW9uOiBvbiBhIHBsYXllcidzIGZpcnN0IGV2ZXIgc3VibWlzc2lvbiBmb3IgdGhpcyBnYW1lLAp0aGV5J3JlIGFkZGVkIHRvIHRoZSBpbmRleGVkIGBQbGF5ZXJCeUluZGV4YCB0YWJsZSDigJQgdW5sZXNzIHRoYXQKdGFibGUgaXMgYWxyZWFkeSBhdCBgTUFYX1BMQVlFUlNfUEVSX0dBTUVgLCBpbiB3aGljaCBjYXNlIHRoZQplbnVtZXJhdGlvbiBpcyAqKnNpbGVudGx5IHNraXBwZWQqKiAoSGlnaFNjb3JlIGlzIHN0aWxsIHdyaXR0ZW4pLgAAAAxzdWJtaXRfc2NvcmUAAAADAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAAAAAAABHNlYWwAAAAOAAAAAAAAAAdqb3VybmFsAAAAAA4AAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANZ2V0X3BsYXllcl9hdAAAAAAAAAIAAAAAAAAAB2dhbWVfaWQAAAAABAAAAAAAAAADaWR4AAAAAAQAAAABAAAD6AAAA+4AAAAg",
        "AAAAAQAAAAAAAAAAAAAADkhpZ2hTY29yZUVudHJ5AAAAAAAEAAAAAAAAAAVzY29yZQAAAAAAAAQAAACoMzItYml0IHNlZWQgdGhlIHBsYXllciByYW4gdGhlIHNpbSB3aXRoLiBTdG9yZWQgZm9yIHJlcHJvZHVjaWJpbGl0eQooYW55b25lIGNhbiByZXBsYXkgdGhlIHJ1biBieSBxdWVyeWluZyB0aGlzIHNlZWQgKyB0aGUgb2ZmLWNoYWluCnRyYW5zY3JpcHQpLiBOT1QgdmVyaWZpZWQgb24tY2hhaW4uAAAABHNlZWQAAAAEAAAAH0xlZGdlciB0aW1lc3RhbXAgYXQgc2V0dGxlbWVudC4AAAAACnNldHRsZWRfYXQAAAAAAAYAAAAAAAAADnRpY2tzX3N1cnZpdmVkAAAAAAAE",
        "AAAAAAAAAuZBdHRlc3QtbW9kZSBzZXR0bGVtZW50IChQaGFzZSAxMykuIFZlcmlmaWVzIGFuIGVkMjU1MTkgc2lnbmF0dXJlCmZyb20gdGhlIGNvbmZpZ3VyZWQgYFRydXN0ZWRPcGVyYXRvcmAgb3ZlciBgKGdhbWVfaWQgfHwgam91cm5hbClgCmluIGxpZXUgb2YgYSBSSVNDIFplcm8gcHJvb2YsIHRoZW4gYXBwbGllcyB0aGUgc2FtZSBIaWdoU2NvcmUgKwplbnVtZXJhdGlvbiB1cGRhdGUgdGhhdCBgc3VibWl0X3Njb3JlYCBkb2VzLiBUaGUgcmVsYXkgaXMgdGhlCnRydXN0IGFuY2hvciBoZXJlIOKAlCB0aGUgb3BlcmF0b3IncyBlZDI1NTE5IHNlY3JldCBtdXN0IG5ldmVyIGJlCmNvbW1pdHRlZCBhbmQgcm90YXRlcyB2aWEgYHNldF90cnVzdGVkX29wZXJhdG9yYC4KClRoZSBqb3VybmFsIGxheW91dCBpcyBpZGVudGljYWwgdG8gYHN1Ym1pdF9zY29yZWAncyAoNzYgYnl0ZXMsCnNlZSBgSk9VUk5BTF9TSVpFYCBkb2MgYWJvdmUpLCBzbyBhIHJlbGF5IGNhbiBwcm9kdWNlIHRoZSBzYW1lCnNoYXBlIGZyb20gYSBuYXRpdmUgdHJhbnNjcmlwdCByZXBsYXkgd2l0aG91dCBSMCBpbiB0aGUgbG9vcC4KClRoZSBzaWduZWQgbWVzc2FnZSBpcyBleGFjdGx5IGBnYW1lX2lkX2xlICg0IGJ5dGVzKSB8fCBqb3VybmFsCig3NiBieXRlcylgIOKAlCBjb25jYXRlbmF0aW5nIGdhbWVfaWQgc3RvcHMgYSBzaW5nbGUgc2lnbmVkCmpvdXJuYWwgZnJvbSBiZWluZyByZXBsYXllZCBhZ2FpbnN0IGEgZGlmZmVyZW50IGdhbWVfaWQuAAAAAAAPc2V0dGxlX2F0dGVzdGVkAAAAAAMAAAAAAAAAB2dhbWVfaWQAAAAABAAAAAAAAAAHam91cm5hbAAAAAAOAAAAAAAAAAxvcF9zaWduYXR1cmUAAAPuAAAAQAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAQZ2V0X3BsYXllcl9jb3VudAAAAAEAAAAAAAAAB2dhbWVfaWQAAAAABAAAAAEAAAAE",
        "AAAAAAAAANtCYXRjaGVkIHJlYWQgZm9yIGluZGV4ZXIgcGFnaW5hdGlvbiDigJQgcmV0dXJucyBwbGF5ZXJzIGluCmBbc3RhcnQsIGVuZClgIGluZGV4IHJhbmdlLCBjYXBwZWQgYXQgYE1BWF9QQUdFX1NJWkVgIGVudHJpZXMKdG8gYm91bmQgdGhlIHR4J3MgcmVhZC1lbnRyeSBidWRnZXQuIEVuZC1vZi10YWJsZSBpcyBzaWduYWxsZWQKYnkgYSBzaG9ydGVyLXRoYW4tcmVxdWVzdGVkIHJldHVybi4AAAAAEGdldF9wbGF5ZXJzX3BhZ2UAAAADAAAAAAAAAAdnYW1lX2lkAAAAAAQAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAADZW5kAAAAAAQAAAABAAAD6gAAA+4AAAAg",
        "AAAAAAAAAAAAAAAUZ2V0X3RydXN0ZWRfb3BlcmF0b3IAAAAAAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAAUxTZXQgb3Igcm90YXRlIHRoZSBFRDI1NTE5IHB1YmxpYyBrZXkgdHJ1c3RlZCB0byBzaWduCmBzZXR0bGVfYXR0ZXN0ZWRgIHBheWxvYWRzIChQaGFzZSAxMyBhdHRlc3QgbW9kZSkuIFNldHRpbmcgdGhpcwppcyB3aGF0ICplbmFibGVzKiBhdHRlc3QgbW9kZSBmb3IgdGhlIGNvbnRyYWN0IOKAlCB1bnRpbCBpdCdzIHNldCwKYHNldHRsZV9hdHRlc3RlZGAgcmV0dXJucyBgVHJ1c3RlZE9wZXJhdG9yTm90U2V0YC4gUm90YXRpbmcKcmVwbGFjZXMgdGhlIHByaW9yIHB1YmtleTsgaW4tZmxpZ2h0IHNpZ25lZCBwYXlsb2FkcyBhZ2FpbnN0IHRoZQpvbGQga2V5IHN0b3AgdmVyaWZ5aW5nLgAAABRzZXRfdHJ1c3RlZF9vcGVyYXRvcgAAAAEAAAAAAAAADG5ld19vcGVyYXRvcgAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    add_game: this.txFromJSON<Result<void>>,
        get_score: this.txFromJSON<Option<HighScoreEntry>>,
        initialize: this.txFromJSON<Result<void>>,
        get_image_id: this.txFromJSON<Option<Buffer>>,
        get_verifier: this.txFromJSON<Option<string>>,
        rotate_admin: this.txFromJSON<Result<void>>,
        set_image_id: this.txFromJSON<Result<void>>,
        set_verifier: this.txFromJSON<Result<void>>,
        submit_score: this.txFromJSON<Result<void>>,
        get_player_at: this.txFromJSON<Option<Buffer>>,
        settle_attested: this.txFromJSON<Result<void>>,
        get_player_count: this.txFromJSON<u32>,
        get_players_page: this.txFromJSON<Array<Buffer>>,
        get_trusted_operator: this.txFromJSON<Option<Buffer>>,
        set_trusted_operator: this.txFromJSON<Result<void>>
  }
}
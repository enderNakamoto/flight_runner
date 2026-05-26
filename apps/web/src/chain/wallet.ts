// Wallet singleton — wraps Stellar Wallets Kit so the rest of the app
// gets a clean `connect / address / signTransaction` surface.
//
// Phase 5 manual flow: user clicks Connect Wallet → kit modal pops up →
// user picks Freighter / xBull / etc. → we cache the chosen module + address.

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  type ISupportedWallet,
} from "@creit.tech/stellar-wallets-kit";
import { CONFIG } from "./config.js";

function walletNetworkFromPassphrase(p: string): WalletNetwork {
  // Map the SDK Networks constant strings to the kit's enum.
  if (p === "Public Global Stellar Network ; September 2015") return WalletNetwork.PUBLIC;
  if (p === "Test SDF Network ; September 2015") return WalletNetwork.TESTNET;
  if (p === "Test SDF Future Network ; October 2022") return WalletNetwork.FUTURENET;
  if (p === "Standalone Network ; February 2017") return WalletNetwork.STANDALONE;
  // Default to testnet — Phase 5 only targets testnet.
  return WalletNetwork.TESTNET;
}

let kit: StellarWalletsKit | null = null;
let address: string | null = null;
let walletId: string | null = null;

const subscribers = new Set<(addr: string | null) => void>();

function notify() {
  for (const s of subscribers) s(address);
}

export function onWalletChange(cb: (addr: string | null) => void): () => void {
  subscribers.add(cb);
  cb(address);
  return () => subscribers.delete(cb);
}

export function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: walletNetworkFromPassphrase(CONFIG.networkPassphrase),
      modules: allowAllModules(),
    });
  }
  return kit;
}

export function getAddress(): string | null {
  return address;
}

export async function connect(): Promise<string> {
  const k = getKit();
  return new Promise<string>((resolve, reject) => {
    k.openModal({
      onWalletSelected: async (option: ISupportedWallet) => {
        try {
          k.setWallet(option.id);
          const { address: addr } = await k.getAddress();
          walletId = option.id;
          address = addr;
          notify();
          resolve(addr);
        } catch (e) {
          reject(e);
        }
      },
      onClosed: (err?: Error) => {
        if (err) reject(err);
        else if (!address) reject(new Error("wallet selection cancelled"));
      },
    });
  });
}

export function disconnect(): void {
  address = null;
  walletId = null;
  notify();
}

/// Used by the game-hub client as its `signTransaction` callback.
/// Stellar Wallets Kit returns `{ signedTxXdr }`.
export async function signTransaction(xdr: string): Promise<{ signedTxXdr: string }> {
  if (!kit || !walletId || !address) {
    throw new Error("wallet not connected");
  }
  return kit.signTransaction(xdr, {
    networkPassphrase: CONFIG.networkPassphrase,
    address,
  });
}

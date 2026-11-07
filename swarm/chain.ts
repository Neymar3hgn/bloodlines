/** Thin wrappers over near-api-js, plus local key storage. Keys live in .keys/, which git ignores. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

export type Network = "testnet" | "mainnet";

export const NETWORK: Network = (process.env.CLADE_NETWORK as Network) ?? "testnet";

const RPCS: Record<Network, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com"],
};

export const RPC_URL = process.env.CLADE_RPC ?? RPCS[NETWORK][0];
export const provider = new JsonRpcProvider({ url: RPC_URL });

const KEY_DIR = process.env.CLADE_KEYS ?? ".keys";

export interface SavedKey {
  account_id: string;
  public_key: string;
  private_key: string;
}

export function keyPath(accountId: string): string {
  return `${KEY_DIR}/${accountId}.json`;
}

export function saveKey(accountId: string, kp: KeyPair): SavedKey {
  mkdirSync(KEY_DIR, { recursive: true });
  const saved: SavedKey = {
    account_id: accountId,
    public_key: kp.getPublicKey().toString(),
    private_key: kp.toString(),
  };
  writeFileSync(keyPath(accountId), JSON.stringify(saved, null, 1), { mode: 0o600 });
  return saved;
}

export function loadKey(accountId: string): SavedKey {
  const p = keyPath(accountId);
  if (!existsSync(p)) throw new Error(`no key saved for ${accountId}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function hasKey(accountId: string): boolean {
  return existsSync(keyPath(accountId));
}

export function account(accountId: string): Account {
  const saved = loadKey(accountId);
  const signer = new KeyPairSigner(KeyPair.fromString(saved.private_key as never));
  return new Account(accountId, provider, signer);
}

export function newKey(): KeyPair {
  return KeyPair.fromRandom("ed25519");
}

export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args } as never)) as T;
}

export async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId } as never);
    return true;
  } catch {
    return false;
  }
}

export async function nearBalance(accountId: string): Promise<number> {
  const a = (await provider.viewAccount({ accountId } as never)) as { amount: bigint | string };
  return Number(BigInt(a.amount)) / 1e24;
}

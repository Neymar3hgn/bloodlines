/** Thin wrappers over near-api-js, plus local key storage. Keys live in .keys/, which git ignores. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

export type Network = "testnet" | "mainnet";

/**
 * Public RPCs rate limit by IP, so every request goes through one paced queue
 * and a 429 waits and retries instead of failing a round halfway through.
 */
const realFetch = globalThis.fetch;
const SPACING_MS = Number(process.env.CLADE_RPC_SPACING ?? 170);
let nextSlot = 0;

async function pacedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (!/near|fastnear|drpc|tatum|intea/i.test(url) || /cloud-api|polymarket/.test(url)) return realFetch(input, init);
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + SPACING_MS;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    const res = await realFetch(input, init);
    const limited = res.status === 429 || (res.status === 200 && /"code":\s*-429/.test(await res.clone().text()));
    if (!limited || attempt >= 10) return res;
    const pause = 1200 * (attempt + 1);
    nextSlot = Date.now() + pause;
    await new Promise((r) => setTimeout(r, pause));
  }
}
globalThis.fetch = pacedFetch as typeof fetch;

export const NETWORK: Network = (process.env.CLADE_NETWORK as Network) ?? "testnet";

const RPCS: Record<Network, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://near-testnet.gateway.tatum.io", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com"],
};

const urls = process.env.CLADE_RPC ? [process.env.CLADE_RPC] : RPCS[NETWORK];
const providers = urls.map((url) => new JsonRpcProvider({ url }, { retries: 6, backoff: 1.6, wait: 400 }));
export const provider = new FailoverRpcProvider(providers);
export const RPC_URL = urls[0];

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

/** Reads a contract, moving to the next public RPC when one is rate limited. */
export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    const p = providers[attempt % providers.length];
    try {
      return (await p.callFunction({ contractId, method, args } as never)) as T;
    } catch (e) {
      last = e;
      const text = String((e as Error).message ?? e);
      if (!/429|Rate limit|timed out|fetch failed|Too Many|503|502|ECONN/i.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw last;
}

/** Runs tasks with a limit on how many are in flight, to stay inside public RPC limits. */
export async function inPool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await task(items[i], i);
      }
    }),
  );
  return out;
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

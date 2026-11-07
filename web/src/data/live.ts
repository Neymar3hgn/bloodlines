/**
 * Every read of the chain goes through this file. There is no backend: these are
 * plain NEAR view calls from the reader's browser. If one fails, the site carries
 * on from snapshot.json.
 */
import { useEffect, useState } from "react";
import type { Snapshot, Stats } from "./types";

const RPC: Record<string, string> = {
  testnet: "https://rpc.testnet.fastnear.com",
  mainnet: "https://rpc.mainnet.fastnear.com",
};

const POLL_MS = 30_000;
/** One missed read is not an outage, so a good read stays on show for two polls. */
const STALE_MS = 2.5 * POLL_MS;
const SPACING_MS = 220;

export const rpcUrl = (network: string) => RPC[network] ?? RPC.testnet;

export const explorerUrl = (network: string, account: string) =>
  `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${account}`;

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** Calls a view method. Throws on any failure, so callers choose their own fallback. */
export async function view<T>(network: string, account: string, method: string, args: object = {}, timeoutMs = 8000): Promise<T> {
  const res = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clade",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: account,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`RPC answered ${res.status}`);
  const body = await res.json();
  const bytes: number[] | undefined = body.result?.result;
  if (body.error || !bytes) throw new Error("RPC returned no result");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as T;
}

let nextSlot = 0;

/**
 * The same call in one paced queue, for when one click makes many reads. Public
 * RPCs limit by IP, and a 429 arrives with no CORS header, so a burst would fail
 * and log an error the page cannot catch. This keeps to the pace scripts/verify.ts uses.
 */
export async function patientView<T>(network: string, account: string, method: string, args: object = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + SPACING_MS;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    try {
      return await view<T>(network, account, method, args);
    } catch (e) {
      last = e;
      nextSlot = Date.now() + 1200 * (attempt + 1);
    }
  }
  throw last;
}

export interface Live {
  /** The latest stats read from the chain, or null while only the snapshot is available. */
  stats: Stats | null;
  readAt: number | null;
}

/** Reads `get_stats` on load and every 30 seconds. A failed read silently changes nothing but the badge. */
export function useLive(snapshot: Snapshot | null): Live {
  const [live, setLive] = useState<Live>({ stats: null, readAt: null });

  useEffect(() => {
    if (!snapshot || snapshot.fixture) return;
    let stopped = false;
    const read = async () => {
      try {
        const stats = await view<Stats>(snapshot.network, snapshot.colony, "get_stats");
        if (!stopped) setLive({ stats, readAt: Date.now() });
      } catch {
        if (!stopped) setLive((prev) => (prev.readAt && Date.now() - prev.readAt < STALE_MS ? prev : { stats: null, readAt: null }));
      }
    };
    // Always read on load. After that, a hidden tab waits and catches up when it is shown.
    const readIfSeen = () => {
      if (!document.hidden) read();
    };
    read();
    const timer = setInterval(readIfSeen, POLL_MS);
    document.addEventListener("visibilitychange", readIfSeen);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", readIfSeen);
    };
  }, [snapshot]);

  return live;
}

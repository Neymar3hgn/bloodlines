/**
 * Every read of the chain goes through this file. There is no backend: these are
 * plain NEAR view calls from the reader's browser. The site opens from snapshot.json,
 * then reads whatever is newer straight from the colony and merges it in, so a round
 * can be watched as it happens. If a read fails, the site carries on with what it has.
 */
import { useEffect, useState } from "react";
import { isRunning, newerThan, type Read } from "./merge.ts";
import type { Snapshot, Stats } from "./types";

const RPC: Record<string, string> = {
  testnet: "https://rpc.testnet.fastnear.com",
  mainnet: "https://rpc.mainnet.fastnear.com",
};

const POLL_MS = 30_000;
/** While a round is running, the page follows it. */
const ROUND_POLL_MS = 10_000;
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
  /** The published snapshot with everything newer merged in. Null until the first good read. */
  snapshot: Snapshot | null;
}

/**
 * Follows the colony: every 30 seconds, and every 10 while a round is running. A
 * failed read changes nothing but the badge, and a hidden tab catches up when shown.
 */
export function useLive(published: Snapshot | null): Live {
  const [live, setLive] = useState<Live>({ stats: null, readAt: null, snapshot: null });

  useEffect(() => {
    if (!published || (import.meta.env.DEV && published.fixture)) return;
    let stopped = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = published;
    const paced: Read = (account, method, args = {}) => patientView(published.network, account, method, args);

    const next = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, isRunning(current) ? ROUND_POLL_MS : POLL_MS);
    };
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const stats = await view<Stats>(current.network, current.colony, "get_stats");
        current = await newerThan(current, stats, paced);
        if (!stopped) setLive({ stats, readAt: Date.now(), snapshot: current });
      } catch {
        if (!stopped) setLive((prev) => (prev.readAt && Date.now() - prev.readAt < STALE_MS ? prev : { ...prev, stats: null, readAt: null }));
      }
      reading = false;
    };
    const tick = async () => {
      if (!document.hidden) await read();
      next();
    };
    const show = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      tick();
    };

    // Always read on load. After that, a hidden tab waits.
    read().then(next);
    document.addEventListener("visibilitychange", show);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", show);
    };
  }, [published]);

  return live;
}

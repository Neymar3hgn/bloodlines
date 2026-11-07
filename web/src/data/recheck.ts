/**
 * "Check it yourself". Re-reads the orders from the chain, then rebuilds each
 * question with engine/market.ts, the same reference file the contract is tested
 * against. If the chain cannot be reached, the snapshot's copy is checked instead,
 * and the page says which source each question used.
 */
import { checkConservation, clear, lockFor, poolPledge, poolShare, settle, type Order as EngineOrder, type Side } from "../../../engine/market.ts";
import { big } from "./format";
import { patientView } from "./live";
import type { Order, Question, ResearchPool, Snapshot } from "./types";

export interface Recheck {
  id: number;
  text: string;
  source: "chain" | "snapshot";
  price: number;
  /** Not yet cleared, so there is nothing to rebuild. */
  skipped: boolean;
  problems: string[];
}

const SIDE_CODE: Record<Side, number> = { NONE: 0, YES: 1, NO: 2 };

/** Compares one question with what the rules say it must be. An empty list means it matches. */
export function recompute(q: Question, orders: Order[]): string[] {
  const problems: string[] = [];
  const book: EngineOrder[] = orders.map((o) => ({ agent: o.agent, belief: o.belief, stake: BigInt(o.stake) }));
  const cleared = clear(book);

  if (cleared.price !== q.price) problems.push(`price: chain ${q.price}, rebuilt ${cleared.price}`);
  if (cleared.matched !== BigInt(q.matched)) problems.push(`matched shares: chain ${q.matched}, rebuilt ${cleared.matched}`);

  const locks = book.reduce((t, o) => t + lockFor(o.belief, o.stake), 0n);
  if (locks !== big(q.locked)) problems.push(`locks: chain ${q.locked}, rebuilt ${locks}`);

  for (const o of orders) {
    const fill = cleared.fills.find((f) => f.agent === o.agent);
    if (!fill || SIDE_CODE[fill.side] !== o.side || fill.filled !== BigInt(o.filled) || fill.cost !== big(o.cost)) {
      problems.push(`fill for ${o.agent} does not match`);
    }
  }

  if (q.status !== "Settled") return problems;

  // R20, using the totals the chain reports, then those totals against the orders themselves.
  const moneyIn = big(q.locked) + big(q.bounty);
  const moneyOut = big(q.refunded) + big(q.paid) + big(q.rewarded) + (big(q.bounty) - big(q.rewarded));
  if (moneyIn !== moneyOut) problems.push(`money: in ${moneyIn}, out ${moneyOut}`);
  const sum = (pick: (o: Order) => string) => orders.reduce((t, o) => t + big(pick(o)), 0n);
  if (sum((o) => o.payout) !== big(q.paid)) problems.push("payouts do not add up to the question's total");
  if (sum((o) => o.reward) !== big(q.rewarded)) problems.push("rewards do not add up to the question's total");
  if (big(q.rewarded) > big(q.pool)) problems.push("rewards exceed the pool");

  if (q.yes_won === null) {
    // Voided after clearing: everyone gets their cost back, and no reward is paid.
    for (const o of orders) {
      if (big(o.payout) !== big(o.cost) || big(o.reward) !== 0n) problems.push(`refund for ${o.agent} does not match`);
    }
    return problems;
  }

  const pool = big(q.pool);
  const settled = settle(cleared, q.yes_won, pool);
  for (const o of orders) {
    const row = settled.rows.find((r) => r.agent === o.agent);
    if (!row || row.payout !== big(o.payout) || row.reward !== big(o.reward)) problems.push(`payout for ${o.agent} does not match`);
  }
  try {
    checkConservation(cleared, settled, pool, big(q.billed), big(q.bounty) - pool);
  } catch (e) {
    problems.push(String((e as Error).message));
  }
  return problems;
}

/** R26-R28: did a research pool charge what the rules say? An empty list means yes. */
export function poolProblems(p: ResearchPool): string[] {
  const problems: string[] = [];
  const n = p.buyers.length;
  const share = poolShare(big(p.price), Math.max(1, n));
  if (big(p.pledge) !== poolPledge(big(p.price), p.min_buyers)) problems.push("the pool's pledge is not price over minimum buyers");
  if (p.status === "Bought") {
    if (n < p.min_buyers) problems.push("the pool bought a briefing with too few buyers");
    if (big(p.share) !== share) problems.push(`pool share: chain ${p.share}, rebuilt ${share}`);
    if (!/^[0-9a-f]{64}$/.test(p.briefing_hash ?? "")) problems.push("the pool paid with no briefing hash on chain");
  }
  if (p.status === "Failed" && n >= p.min_buyers) problems.push("the pool failed with enough buyers");
  if (p.status !== "Open" && p.status !== "Closed" && big(p.held) !== 0n) problems.push("a finished pool still holds money");
  return problems;
}

/** R28: the published briefing must be the text whose hash went on chain. */
async function briefingProblems(hash: string | null, text: string | null | undefined): Promise<string[]> {
  if (!hash || !text || !globalThis.crypto?.subtle) return [];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === hash ? [] : ["the published briefing does not match its hash on chain"];
}

async function allPools(snapshot: Snapshot, count: number): Promise<Map<number, ResearchPool> | null> {
  try {
    const rows = new Map<number, ResearchPool>();
    for (let from = 0; from < count; from += 50) {
      for (const p of await patientView<ResearchPool[]>(snapshot.network, snapshot.colony, "get_pools", { from, limit: 50 })) rows.set(p.q, p);
    }
    return rows;
  } catch {
    return null;
  }
}

async function allQuestions(snapshot: Snapshot): Promise<Question[] | null> {
  try {
    const rows: Question[] = [];
    for (let from = 0; ; from += 50) {
      const page = await patientView<Question[]>(snapshot.network, snapshot.colony, "get_questions", { from, limit: 50 });
      rows.push(...page);
      if (page.length < 50) return rows;
    }
  } catch {
    return null;
  }
}

export async function recheckAll(snapshot: Snapshot, onProgress: (done: number, total: number, row: Recheck) => void): Promise<Recheck[]> {
  const fromChain = import.meta.env.DEV && snapshot.fixture ? null : await allQuestions(snapshot);
  const questions = fromChain ?? snapshot.questions;
  const inSnapshot = new Map(snapshot.questions.map((q) => [q.id, q]));
  const chainPools = fromChain ? await allPools(snapshot, fromChain.length) : null;
  const rows: Recheck[] = new Array(questions.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < questions.length) {
      const i = next++;
      const q = questions[i];
      let orders: Order[] | null = null;
      if (fromChain) {
        orders =
          q.reveals === 0
            ? []
            : await patientView<Order[]>(snapshot.network, snapshot.colony, "get_orders", { q: q.id }).catch(() => null);
      }
      const usedChain = orders !== null;
      const book = orders ?? inSnapshot.get(q.id)?.orders ?? [];
      const skipped = q.status === "Open" || (!usedChain && !inSnapshot.has(q.id));
      const pool = chainPools?.get(q.id) ?? inSnapshot.get(q.id)?.research ?? null;
      const poolChecks = pool ? [...poolProblems(pool), ...(await briefingProblems(pool.briefing_hash, inSnapshot.get(q.id)?.research?.briefing))] : [];
      const row: Recheck = {
        id: q.id,
        text: q.text,
        source: usedChain ? "chain" : "snapshot",
        price: q.price,
        skipped,
        problems: skipped ? [] : [...recompute(q, book), ...poolChecks],
      };
      rows[i] = row;
      done += 1;
      onProgress(done, questions.length, row);
    }
  };
  await worker();
  return rows;
}

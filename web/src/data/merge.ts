/**
 * Merges the chain over a snapshot, so a reader can watch a round happen. It only
 * reads what can have changed: a finished round never changes, so it is never read
 * twice, and a colony with nothing going on costs one read per poll.
 */
import { reputation } from "../../../engine/market.ts";
import type { Agent, Order, Question, ResearchPool, Sale, Snapshot, Stats } from "./types";

export type Read = <T>(account: string, method: string, args?: object) => Promise<T>;

const PAGE = 50;

const finished = (q: Question) => q.status === "Settled" || q.status === "Void";
const sameStats = (a: Stats, b: Stats) => a.questions === b.questions && a.settled === b.settled && a.alive === b.alive && a.agents === b.agents;

export const isRunning = (s: Snapshot) => s.questions.some((q) => q.status === "Open");

/** Changes whenever a sale has news: a new seal, a reveal, a winner or a delivery. */
const saleStamp = (s?: Sale | null) => (s ? `${s.offers.length}:${s.offers.filter((o) => o.ask !== null).length}:${s.winner}:${s.paid}` : "");

type ChainAgent = Omit<Agent, "id" | "label" | "credits" | "reputation" | "genome" | "death"> & { final_credits: string; heir: string | null };

/**
 * Returns a new snapshot, or `from` itself if nothing changed, so a page only
 * redraws when there is something new. Strategies, reasoning and briefing text are
 * not on chain, so those stay as they were. If a round cannot be read, this rejects
 * and the caller keeps what it has. Balances that cannot be read keep their last value.
 */
export async function newerThan(from: Snapshot, stats: Stats, read: Read): Promise<Snapshot> {
  if (sameStats(stats, from.stats) && !isRunning(from)) return from;

  const start = from.questions.find((q) => !finished(q))?.id ?? from.questions.length;
  const chainRounds: Omit<Question, "orders">[] = [];
  const chainPools = new Map<number, ResearchPool>();
  const chainSales = new Map<number, Sale>();
  for (let at = start; at < stats.questions; at += PAGE) {
    chainRounds.push(...(await read<Omit<Question, "orders">[]>(from.colony, "get_questions", { from: at, limit: PAGE })));
    const pools = await read<ResearchPool[]>(from.colony, "get_pools", { from: at, limit: PAGE });
    for (const p of pools) chainPools.set(p.q, p);
    if (pools.length) for (const s of await read<Sale[]>(from.colony, "get_sales", { from: at, limit: PAGE })) chainSales.set(s.q, s);
  }

  const known = new Map(from.questions.map((q) => [q.id, q]));
  const fresh: Question[] = [];
  let moved = false;
  for (const q of chainRounds) {
    const old = known.get(q.id);
    const pool = chainPools.get(q.id);
    const unchanged = old !== undefined && old.status === q.status && old.reveals === q.reveals && old.commits === q.commits;
    const orders = q.reveals === 0 ? [] : unchanged ? old.orders : await read<Order[]>(from.colony, "get_orders", { q: q.id });
    const research = pool
      ? { ...pool, sale: chainSales.get(q.id) ?? null, briefing: old?.research?.briefing ?? null, briefing_model: old?.research?.briefing_model ?? null, briefing_signed: old?.research?.briefing_signed ?? false }
      : null;
    const poolMoved = (old?.research?.status ?? null) !== (research?.status ?? null) || (old?.research?.buyers.length ?? 0) !== (research?.buyers.length ?? 0) || saleStamp(old?.research?.sale) !== saleStamp(research?.sale);
    if (!unchanged || poolMoved) moved = true;
    fresh.push({ ...q, orders, thoughts: old?.thoughts ?? {}, research });
  }
  if (!moved && sameStats(stats, from.stats)) return from;

  // Balances only move when a round changes stage or the colony changes, not with every
  // reveal, so they are read then. They are the bulk of the reads, so if they fail the
  // rounds still update and the balances wait for the next read.
  const knownStatus = new Map(from.questions.map((q) => [q.id, q.status]));
  const stageMoved = fresh.some((q) => knownStatus.get(q.id) !== q.status);
  let agents = from.agents;
  let treasury_credits = from.treasury_credits;
  if (stageMoved || !sameStats(stats, from.stats)) {
    try {
      ({ agents, treasury_credits } = await readAgents(from, read));
    } catch {
      /* the next read tries again */
    }
  }

  const updated = new Set(fresh.map((q) => q.id));
  return {
    ...from,
    generated: new Date().toISOString(),
    stats,
    agents,
    treasury_credits,
    questions: [...from.questions.filter((q) => !updated.has(q.id)), ...fresh].sort((a, b) => a.id - b.id),
  };
}

async function readAgents(from: Snapshot, read: Read) {
  const chainAgents: [string, ChainAgent][] = [];
  for (let at = 0; ; at += 100) {
    const page = await read<[string, ChainAgent][]>(from.colony, "get_agents", { from: at, limit: 100 });
    chainAgents.push(...page);
    if (page.length < 100) break;
  }
  const had = new Map(from.agents.map((a) => [a.id, a]));
  const agents: Agent[] = [];
  for (const [id, a] of chainAgents) {
    const dead = a.status === "Dead";
    const credits = dead ? "0" : await read<string>(from.verifier, "mt_balance_of", { account_id: id, token_id: from.token_id });
    agents.push({
      ...a,
      id,
      label: id.split(".")[0],
      credits,
      reputation: Number(reputation(BigInt(a.edge_sum), BigInt(a.questions), BigInt(a.prior))),
      genome: had.get(id)?.genome ?? null,
      death: dead ? { balance: a.final_credits, heir: a.heir ?? from.treasury } : null,
    });
  }
  const treasury_credits = await read<string>(from.verifier, "mt_balance_of", { account_id: from.treasury, token_id: from.token_id });
  return { agents, treasury_credits };
}

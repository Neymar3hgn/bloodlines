/** Everything the pages derive from a snapshot, computed once. No number here is invented. */
import { big } from "./format";
import type { Agent, Order, Question, Snapshot } from "./types";


export type FeedItem =
  | { kind: "birth"; at: number; agent: Agent }
  | { kind: "death"; at: number; agent: Agent }
  | { kind: "round"; at: number; question: Question }
  | { kind: "pool"; at: number; question: Question };

export interface Model {
  snapshot: Snapshot;
  agents: Map<string, Agent>;
  questions: Map<number, Question>;
  /** Oldest first. A founder keeps its ink as the list grows, because founders only join at the end. */
  founders: Agent[];
  founderOf: Map<string, string>;
  childrenOf: Map<string, Agent[]>;
  counts: { alive: number; died: number; generations: number; answered: number };
  feed: FeedItem[];
}

const byBirth = (a: Agent, b: Agent) => a.born_ms - b.born_ms || (a.id < b.id ? -1 : 1);

/** An agent's name proves its parent, so a missing record can still be placed. */
export function parentOf(agent: Agent, agents: Map<string, Agent>, colony: string): string {
  if (agent.parent === colony || agents.has(agent.parent)) return agent.parent;
  const fromName = agent.id.split(".").slice(1).join(".");
  return agents.has(fromName) ? fromName : colony;
}

export function buildModel(snapshot: Snapshot): Model {
  const { agents: list, questions: rounds, colony } = snapshot;
  const agents = new Map(list.map((a) => [a.id, a]));
  const questions = new Map(rounds.map((q) => [q.id, q]));

  const childrenOf = new Map<string, Agent[]>();
  for (const a of [...list].sort(byBirth)) {
    const p = parentOf(a, agents, colony);
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), a]);
  }

  const founders = childrenOf.get(colony) ?? [];

  const founderOf = new Map<string, string>();
  for (const founder of founders) {
    const stack = [founder];
    while (stack.length) {
      const a = stack.pop()!;
      founderOf.set(a.id, founder.id);
      stack.push(...(childrenOf.get(a.id) ?? []));
    }
  }

  const generated = Date.parse(snapshot.generated) || Date.now();
  const feed: FeedItem[] = [];
  for (const a of list) {
    if (a.parent !== colony && a.status !== "Pending") feed.push({ kind: "birth", at: a.born_ms, agent: a });
    if (a.status === "Dead") feed.push({ kind: "death", at: a.died_ms, agent: a });
  }
  // Contract tests stay out of the story. They are one filter away on the rounds page.
  for (const q of rounds.filter((r) => r.category !== "test")) {
    feed.push({ kind: "round", at: Math.min(q.reveal_end_ms, generated), question: q });
    if (q.research?.status === "Bought") feed.push({ kind: "pool", at: q.research.end_ms, question: q });
  }
  feed.sort((a, b) => b.at - a.at);

  const alive = list.filter((a) => a.status !== "Dead").length;
  return {
    snapshot,
    agents,
    questions,
    founders,
    founderOf,
    childrenOf,
    counts: {
      alive,
      died: list.length - alive,
      generations: list.length ? Math.max(...list.map((a) => a.generation)) + 1 : 0,
      answered: snapshot.stats?.settled ?? rounds.filter((q) => q.status === "Settled").length,
    },
    feed,
  };
}

/** Founder first, ending with the agent's parent. Dead ancestors stay in the list. */
export function ancestors(m: Model, agent: Agent): Agent[] {
  const out: Agent[] = [];
  let cur = m.agents.get(parentOf(agent, m.agents, m.snapshot.colony));
  while (cur) {
    out.unshift(cur);
    cur = m.agents.get(parentOf(cur, m.agents, m.snapshot.colony));
  }
  return out;
}

export interface House {
  founder: Agent;
  alive: number;
  total: number;
  wealth: bigint;
}

/** Each founder and its descendants, richest family first. */
export function housesOf(m: Model): House[] {
  return m.founders
    .map((founder) => {
      let alive = 0;
      let total = 0;
      let wealth = 0n;
      for (const [id, head] of m.founderOf) {
        if (head !== founder.id) continue;
        const a = m.agents.get(id);
        total += 1;
        if (a && a.status !== "Dead") {
          alive += 1;
          wealth += big(a.credits);
        }
      }
      return { founder, alive, total, wealth };
    })
    .sort((a, b) => (a.wealth === b.wealth ? a.founder.born_ms - b.founder.born_ms : a.wealth > b.wealth ? -1 : 1));
}

/** The newest real answer: settled if one is, or else the newest with a price. */
export function latestAnswered(m: Model): Question | null {
  const rounds = [...m.questions.values()].filter((q) => q.category !== "test" && q.price > 0).sort((a, b) => b.id - a.id);
  return rounds.find((q) => q.status === "Settled") ?? rounds[0] ?? null;
}

/** Who received a dead agent's credits (R13): the nearest ancestor alive at that moment, else the treasury. */
export function heirOf(m: Model, agent: Agent): string {
  if (agent.death?.heir) return agent.death.heir;
  for (const a of ancestors(m, agent).reverse()) {
    const aliveThen = a.status !== "Dead" || a.died_ms > agent.died_ms;
    if (aliveThen) return a.id;
  }
  return m.snapshot.treasury;
}

export const SIDE_NAME = ["none", "YES", "NO"] as const;

export type RoundState = "pooling" | "offering" | "sealing" | "revealing" | "waiting" | "void" | "voided" | "settled";

/** What a question's chain status means for a reader. Time matters only while it is open. */
export function roundState(q: Question, now: number): RoundState {
  if (q.status === "Void") return "void";
  if (q.status === "Settled") return q.yes_won === null ? "voided" : "settled";
  if (q.status === "Open") {
    if (q.research && now < q.research.end_ms) return "pooling";
    if (q.research?.sale && now < q.research.sale.reveal_end_ms) return "offering";
    return now < q.commit_end_ms ? "sealing" : "revealing";
  }
  return "waiting";
}

/** The round the colony is running right now, if any. */
export function runningRound(m: Model): Question | null {
  for (const q of [...m.questions.values()].reverse()) if (q.status === "Open") return q;
  return null;
}

/** Milliseconds left in the stage a running round is in. Zero once its windows have all closed. */
export function timeLeft(q: Question, now: number): number {
  const state = roundState(q, now);
  const end = state === "pooling" ? q.research!.end_ms : state === "offering" ? q.research!.sale!.reveal_end_ms : state === "sealing" ? q.commit_end_ms : q.reveal_end_ms;
  return Math.max(0, end - now);
}

/** One line on what a running round is doing, for a reader watching it happen. */
export function stageLine(q: Question, now: number): string {
  const left = timeLeft(q, now);
  const remaining = `${Math.ceil(left / 1000)} s left`;
  switch (roundState(q, now)) {
    case "pooling":
      return q.research?.sale ? `Buyers are joining and sellers are sealing offers, ${remaining}.` : `Agents are joining a research pool, ${remaining}.`;
    case "offering":
      return `Sellers are opening their offers, ${remaining}.`;
    case "sealing":
      return `${q.commits} sealed ${q.commits === 1 ? "bid" : "bids"} so far, ${remaining}.`;
    default:
      return left > 0 ? `${q.reveals} of ${q.commits} bids open, ${remaining}.` : `The windows have closed. The round clears next.`;
  }
}

/** Who answered a round, from what was saved with it. Null for a round too new to be in a snapshot. */
export function answeredBy(q: Question): "real models" | "scripted agents" | null {
  const rows = Object.values(q.thoughts ?? {});
  if (rows.length === 0) return null;
  return rows.some((t) => t.reasoning) ? "real models" : "scripted agents";
}

export const net = (o: Order) => big(o.payout) + big(o.reward) - big(o.cost) - big(o.bill);

export interface Ledger {
  in: { label: string; units: bigint }[];
  out: { label: string; units: bigint }[];
  totalIn: bigint;
  totalOut: bigint;
  bills: bigint;
  /** What the treasury took: its cut, plus any reward nobody earned. */
  treasury: bigint;
}

/** R20 for one finished question. Bills go straight to the treasury at reveal, so they sit outside both sides. */
export function ledgerOf(q: Question): Ledger | null {
  if (q.status === "Void") {
    const bounty = big(q.bounty);
    return {
      in: [{ label: "Bounty", units: bounty }],
      out: [{ label: "Back to the asker", units: bounty }],
      totalIn: bounty,
      totalOut: bounty,
      bills: 0n,
      treasury: 0n,
    };
  }
  if (q.status !== "Settled") return null;
  // A voided question has no winners, so its pool goes back to the asker (R25).
  const voided = q.yes_won === null;
  const treasury = voided ? big(q.bounty) - big(q.pool) : big(q.bounty) - big(q.rewarded);
  const moneyIn = [
    { label: "Stakes locked", units: big(q.locked) },
    { label: "Bounty", units: big(q.bounty) },
  ];
  const moneyOut = [
    { label: "Refunded at clearing", units: big(q.refunded) },
    { label: q.yes_won === null ? "Costs paid back" : "Paid to right shares", units: big(q.paid) },
    voided ? { label: "Bounty back to the asker", units: big(q.pool) } : { label: "Rewards for beating the swarm", units: big(q.rewarded) },
    { label: "Treasury", units: treasury },
  ];
  return {
    in: moneyIn,
    out: moneyOut,
    totalIn: moneyIn.reduce((t, r) => t + r.units, 0n),
    totalOut: moneyOut.reduce((t, r) => t + r.units, 0n),
    bills: big(q.billed),
    treasury,
  };
}

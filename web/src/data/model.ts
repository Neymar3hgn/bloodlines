/** Everything the pages derive from a snapshot, computed once. No number here is invented. */
import { big } from "./format";
import type { Agent, Order, Question, Snapshot } from "./types";

/** How many inks tokens.css defines. Past this a lineage shares an ink; its name still identifies it. */
const INKS = 31;

export type FeedItem =
  | { kind: "birth"; at: number; agent: Agent }
  | { kind: "death"; at: number; agent: Agent }
  | { kind: "round"; at: number; question: Question };

export interface Model {
  snapshot: Snapshot;
  agents: Map<string, Agent>;
  questions: Map<number, Question>;
  /** Oldest first. A founder keeps its ink as the list grows, because founders only join at the end. */
  founders: Agent[];
  founderOf: Map<string, string>;
  childrenOf: Map<string, Agent[]>;
  inkOf: Map<string, number>;
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
  const inkOf = new Map(founders.map((f, i) => [f.id, i % INKS]));

  const founderOf = new Map<string, string>();
  for (const founder of founders) {
    const stack = [founder];
    while (stack.length) {
      const a = stack.pop()!;
      founderOf.set(a.id, founder.id);
      inkOf.set(a.id, inkOf.get(founder.id) ?? 0);
      stack.push(...(childrenOf.get(a.id) ?? []));
    }
  }

  const generated = Date.parse(snapshot.generated) || Date.now();
  const feed: FeedItem[] = [];
  for (const a of list) {
    if (a.parent !== colony && a.status !== "Pending") feed.push({ kind: "birth", at: a.born_ms, agent: a });
    if (a.status === "Dead") feed.push({ kind: "death", at: a.died_ms, agent: a });
  }
  for (const q of rounds) feed.push({ kind: "round", at: Math.min(q.reveal_end_ms, generated), question: q });
  feed.sort((a, b) => b.at - a.at);

  const alive = list.filter((a) => a.status !== "Dead").length;
  return {
    snapshot,
    agents,
    questions,
    founders,
    founderOf,
    childrenOf,
    inkOf,
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

export const inkVar = (m: Model, id: string) => `var(--lineage-${m.inkOf.get(id) ?? 0})`;

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

export type RoundState = "sealing" | "revealing" | "waiting" | "void" | "voided" | "settled";

/** What a question's chain status means for a reader. Time matters only while it is open. */
export function roundState(q: Question, now: number): RoundState {
  if (q.status === "Void") return "void";
  if (q.status === "Settled") return q.yes_won === null ? "voided" : "settled";
  if (q.status === "Open") return now < q.commit_end_ms ? "sealing" : "revealing";
  return "waiting";
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
  const treasury = big(q.bounty) - big(q.rewarded);
  const moneyIn = [
    { label: "Stakes locked", units: big(q.locked) },
    { label: "Bounty", units: big(q.bounty) },
  ];
  const moneyOut = [
    { label: "Refunded at clearing", units: big(q.refunded) },
    { label: q.yes_won === null ? "Costs paid back" : "Paid to right shares", units: big(q.paid) },
    { label: "Rewards for beating the swarm", units: big(q.rewarded) },
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

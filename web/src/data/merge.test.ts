/** The live page's merge, against a small fake chain, so a watched round can be tested with no network. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isRunning, newerThan, type Read } from "./merge.ts";
import type { Question, Snapshot } from "./types";

const round = (id: number, over: Partial<Question> = {}): Question =>
  ({ id, text: `q${id}`, status: "Settled", commits: 2, reveals: 2, price: 50, orders: [{ agent: "a", belief: 50 }], thoughts: { a: { reasoning: "kept" } }, ...over }) as unknown as Question;

const chainAgent = (over: object = {}) => ({ parent: "c", generation: 0, status: "Alive", genome_hash: "h", born_ms: 1, died_ms: 0, children: 0, open: 0, strikes: 0, questions: 5, edge_sum: 100, prior: 0, won: "0", lost: "0", rewards: "0", bills: "0", last_child_at: 0, final_credits: "0", heir: null, ...over });

const base = (questions: Question[]): Snapshot =>
  ({
    generated: "2026-11-07T00:00:00.000Z",
    network: "testnet",
    colony: "c",
    verifier: "v",
    token_id: "t",
    treasury: "tr",
    treasury_credits: "1",
    stats: { alive: 1, agents: 1, questions: questions.length, settled: questions.filter((q) => q.status === "Settled").length, founders_open: false },
    agents: [{ id: "a.c", genome: { name: "a" } }],
    questions,
  }) as unknown as Snapshot;

/** Answers view calls from fixed rows, and records each one. */
function fakeChain(rows: { questions?: object[]; pools?: object[]; orders?: Record<number, object[]>; agents?: [string, object][] }) {
  const calls: string[] = [];
  const read: Read = async <T,>(account: string, method: string, args: any = {}) => {
    calls.push(method);
    if (method === "get_questions") return (rows.questions ?? []).filter((q: any) => q.id >= args.from) as T;
    if (method === "get_pools") return (rows.pools ?? []).filter((p: any) => p.q >= args.from) as T;
    if (method === "get_orders") return (rows.orders?.[args.q] ?? []) as T;
    if (method === "get_agents") return (args.from === 0 ? (rows.agents ?? []) : []) as T;
    if (method === "mt_balance_of") return (args.account_id === "tr" ? "999" : "777") as T;
    throw new Error(`unexpected ${account}.${method}`);
  };
  return { read, calls };
}

test("a quiet colony costs nothing and redraws nothing", async () => {
  const s = base([round(0)]);
  const { read, calls } = fakeChain({});
  assert.equal(await newerThan(s, s.stats, read), s);
  assert.equal(calls.length, 0);
});

test("a new round is read in, and finished rounds are not read again", async () => {
  const s = base([round(0), round(1)]);
  const { read, calls } = fakeChain({ questions: [{ id: 2, status: "Open", commits: 3, reveals: 0 }], agents: [["a.c", chainAgent()]] });
  const next = await newerThan(s, { ...s.stats, questions: 3 }, read);
  assert.equal(next.questions.length, 3);
  assert.equal(next.questions[2].status, "Open");
  assert.deepEqual(next.questions[0], s.questions[0], "a finished round stays exactly as it was");
  assert.equal(calls.filter((c) => c === "get_orders").length, 0, "nothing was revealed yet");
  assert.equal(s.questions.length, 2, "the snapshot it started from is not changed");
  assert.ok(isRunning(next));
});

test("bids appear as they are revealed, and an agent's words stay", async () => {
  const open = round(1, { status: "Open", reveals: 0, orders: [], thoughts: { a: { reasoning: "kept" } } as never });
  const s = base([round(0), open]);
  const { read } = fakeChain({ questions: [{ id: 1, status: "Open", commits: 2, reveals: 1 }], orders: { 1: [{ agent: "a.c", belief: 70 }] }, agents: [["a.c", chainAgent()]] });
  const next = await newerThan(s, s.stats, read);
  assert.equal(next.questions[1].orders.length, 1);
  assert.equal(next.questions[1].reveals, 1);
  assert.equal((next.questions[1].thoughts as any).a.reasoning, "kept");
});

test("a running round with nothing new redraws nothing, and does not read balances", async () => {
  const open = round(1, { status: "Open", commits: 2, reveals: 1 });
  const s = base([round(0), open]);
  const { read, calls } = fakeChain({ questions: [{ id: 1, status: "Open", commits: 2, reveals: 1 }] });
  assert.equal(await newerThan(s, s.stats, read), s);
  assert.ok(!calls.includes("mt_balance_of"));
  assert.ok(!calls.includes("get_orders"));
});

test("a pool's progress shows, and a published briefing is kept", async () => {
  const research = { q: 1, status: "Closed", buyers: ["a.c"], briefing: "kept text", briefing_model: "m", briefing_signed: true };
  const open = round(1, { status: "Open", reveals: 0, orders: [], research: research as never });
  const s = base([round(0), open]);
  const { read } = fakeChain({ questions: [{ id: 1, status: "Open", commits: 2, reveals: 0 }], pools: [{ q: 1, status: "Bought", buyers: ["a.c"], briefing_hash: "ab" }], agents: [["a.c", chainAgent()]] });
  const next = await newerThan(s, s.stats, read);
  const merged = next.questions[1].research!;
  assert.equal(merged.status, "Bought");
  assert.equal(merged.briefing_hash, "ab");
  assert.equal(merged.briefing, "kept text");
});

test("a new pool buyer counts as a change", async () => {
  const research = { q: 1, status: "Open", buyers: [] };
  const open = round(1, { status: "Open", reveals: 0, orders: [], research: research as never });
  const s = base([round(0), open]);
  const { read } = fakeChain({ questions: [{ id: 1, status: "Open", commits: 2, reveals: 0 }], pools: [{ q: 1, status: "Open", buyers: ["a.c"] }], agents: [["a.c", chainAgent()]] });
  const next = await newerThan(s, s.stats, read);
  assert.notEqual(next, s);
  assert.equal(next.questions[1].research!.buyers.length, 1);
});

test("births and deaths reach the tree, with balances and reputation from the chain", async () => {
  const s = base([round(0)]);
  const dead = chainAgent({ status: "Dead", final_credits: "55", heir: "a.c" });
  const { read } = fakeChain({ agents: [["a.c", chainAgent()], ["b.a.c", chainAgent()], ["x.a.c", dead]] });
  const next = await newerThan(s, { ...s.stats, agents: 3 }, read);
  const by = new Map(next.agents.map((a) => [a.id, a]));
  assert.deepEqual(by.get("a.c")!.genome, { name: "a" }, "a known agent keeps its strategy");
  assert.equal(by.get("b.a.c")!.genome, null, "a newborn's strategy is not on chain");
  assert.equal(by.get("b.a.c")!.label, "b");
  assert.equal(by.get("a.c")!.credits, "777");
  assert.equal(by.get("a.c")!.reputation, 10);
  assert.equal(by.get("x.a.c")!.credits, "0");
  assert.deepEqual(by.get("x.a.c")!.death, { balance: "55", heir: "a.c" });
  assert.equal(next.treasury_credits, "999");
});

test("a failed read rejects, so a page never shows half an update", async () => {
  const s = base([round(0)]);
  const read: Read = async () => {
    throw new Error("RPC answered 429");
  };
  await assert.rejects(() => newerThan(s, { ...s.stats, questions: 2 }, read));
  assert.equal(s.questions.length, 1);
});

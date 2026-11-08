/**
 * Made-up data for testing the site at scale. Dev only: load.ts imports this behind
 * import.meta.env.DEV, so it is not in the production build.
 *
 *   /?fixture=1       a colony with 100+ agents, depth 8 and many deaths
 *   /?fixture=empty   a colony with nothing in it
 *
 * Rounds are run through the real engine/market.ts, so "Check it yourself" has
 * consistent books to rebuild. Everything else is invented, and the site says so.
 */
import { clear, lockFor, reputation, settle, type Order as EngineOrder } from "../../engine/market.ts";
import type { Agent, Genome, Order, Question, Snapshot } from "../src/data/types";

const COLONY = "fixture.testnet";
const FOUNDERS = "ivy oak elm ash fir yew bay fig rue gum sal tea box nut lin sol hop".split(" ");
const CATEGORIES = ["sports", "politics", "world", "economy", "crypto", "tech", "other"];
const MODELS = ["fixture/model-a", "fixture/model-b", "fixture/model-c"];
const OPENINGS = [
  "Start from the base rate and only move for concrete evidence.",
  "The status quo usually wins, and most deadlines pass with nothing happening.",
  "Read the resolution rules like a lawyer and count what must go right.",
  "Follow the incentives and ask who can make this happen.",
];
const EDITS = [
  "Weigh recent results more than old ones.",
  "Distrust any number you cannot trace to a source.",
  "When the crowd is loud, stay near the base rate.",
  "Hedge harder on questions with a close deadline.",
  "Ignore the headline and read the fine print first.",
];

const makeRng = (start: number) => {
  let seed = start;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

interface Live extends Agent {
  skill: number;
  balance: bigint;
}

const CAPITAL = 1_000_000n;
const FLOOR = 300_000n;
const SPAWN = 1_350_000n;
const BOUNTY = 160_000n;
const BILL = 2_000n;
const MAX_STAKE = 60;
const MAX_ALIVE = 46;
const ROUNDS = 240;
const START_MS = Date.parse("2026-10-01T09:00:00Z");
const ROUND_MS = 6 * 60_000;

function hex(r: () => number, n = 64) {
  let out = "";
  while (out.length < n) out += Math.floor(r() * 0xffffffff).toString(16).padStart(8, "0");
  return out.slice(0, n);
}

function newAgent(id: string, parent: string, generation: number, genome: Genome, skill: number, balance: bigint, born: number, prior: number, r: () => number): Live {
  return {
    id,
    label: id.split(".")[0],
    parent,
    generation,
    status: "Alive",
    genome_hash: hex(r),
    genome,
    born_ms: born,
    died_ms: 0,
    children: 0,
    open: 0,
    strikes: 0,
    questions: 0,
    edge_sum: 0,
    prior,
    won: "0",
    lost: "0",
    rewards: "0",
    bills: "0",
    credits: "0",
    reputation: prior,
    last_child_at: 0,
    skill,
    balance,
  };
}

function strategyFor(parent: Genome, r: () => number): string {
  const edit = EDITS[Math.floor(r() * EDITS.length)];
  const sentences = parent.strategy.split(/(?<=\.)\s+/);
  if (sentences.length > 2 && r() < 0.5) sentences.splice(1, 1, edit);
  else sentences.push(edit);
  return sentences.slice(-3).join(" ");
}

function runColony() {
  const r = makeRng(20261107);
  const agents: Live[] = FOUNDERS.map((name, i) =>
    newAgent(
      `${name}.${COLONY}`,
      COLONY,
      0,
      {
        name,
        model: MODELS[i % MODELS.length],
        strategy: OPENINGS[i % OPENINGS.length],
        temperature: 0.2 + r() * 0.4,
        shrink: 0.8 + r() * 0.5,
        size: 0.28 + r() * 0.3,
        focus: Object.fromEntries(CATEGORIES.map((c) => [c, 1])),
      },
      r(),
      CAPITAL,
      START_MS + i * 3000,
      0,
      r,
    ),
  );

  const questions: Question[] = [];
  let treasury = 0n;

  for (let q = 0; q < ROUNDS; q++) {
    const now = START_MS + (q + 2) * ROUND_MS;
    const truth = Math.min(0.95, Math.max(0.05, logistic(1.3 * gauss(r))));
    const yes = r() < truth;
    const live = agents.filter((a) => a.status === "Alive");
    const orders: EngineOrder[] = [];
    const bills = new Map<string, bigint>();

    for (const a of live) {
      const noise = 0.3 + 1.8 * (1 - a.skill);
      const belief = Math.min(99, Math.max(1, Math.round(100 * logistic((a.genome?.shrink ?? 1) * (logit(truth) + noise * gauss(r))))));
      const size = a.genome?.size ?? 0.1;
      const stake = Math.min(MAX_STAKE, Math.floor((Number(a.balance) * size) / 10_000));
      if (stake < 1 || lockFor(belief, BigInt(stake)) + BILL > a.balance) continue;
      orders.push({ agent: a.id, belief, stake: BigInt(stake) });
      bills.set(a.id, BILL);
    }

    const cut = BOUNTY / 20n;
    const pool = BOUNTY - cut;
    const c = clear(orders);
    const s = settle(c, yes, pool);
    const seen: Order[] = [];
    let refunded = 0n;
    let paid = 0n;
    let rewarded = 0n;
    let locked = 0n;

    for (const fill of c.fills) {
      const row = s.rows.find((x) => x.agent === fill.agent)!;
      const a = agents.find((x) => x.id === fill.agent)!;
      const pnl = row.payout - fill.cost;
      a.balance += pnl + row.reward - BILL;
      treasury += BILL;
      a.questions += 1;
      a.edge_sum += row.edge;
      a.won = String(BigInt(a.won) + (pnl > 0n ? pnl : 0n));
      a.lost = String(BigInt(a.lost) + (pnl < 0n ? -pnl : 0n));
      a.rewards = String(BigInt(a.rewards) + row.reward);
      a.bills = String(BigInt(a.bills) + BILL);
      refunded += fill.refund;
      paid += row.payout;
      rewarded += row.reward;
      locked += fill.lock;
      seen.push({
        agent: fill.agent,
        belief: fill.belief,
        stake: Number(fill.stake),
        bill: BILL.toString(),
        receipt: hex(r),
        side: fill.side === "YES" ? 1 : fill.side === "NO" ? 2 : 0,
        filled: Number(fill.filled),
        cost: fill.cost.toString(),
        reward: row.reward.toString(),
        payout: row.payout.toString(),
      });
    }
    treasury += cut + s.dust;

    const category = CATEGORIES[q % CATEGORIES.length];
    questions.push({
      id: q,
      text: `Fixture question ${q}: will this made-up ${category} event happen?`,
      category,
      source: q % 3 === 0 ? "https://example.com/fixture" : null,
      opener: `keeper.${COLONY}`,
      resolver: { Sealed: { hash: hex(r) } },
      opened_ms: now - 80_000,
      commit_end_ms: now - 64_000,
      reveal_end_ms: now,
      status: "Settled",
      bounty: BOUNTY.toString(),
      pool: pool.toString(),
      commits: seen.length + (q % 17 === 0 ? 2 : 0),
      reveals: seen.length,
      price: c.price,
      matched: Number(c.matched),
      yes_won: yes,
      evidence: null,
      callback: null,
      locked: locked.toString(),
      billed: (BILL * BigInt(seen.length)).toString(),
      refunded: refunded.toString(),
      paid: paid.toString(),
      rewarded: rewarded.toString(),
      orders: seen,
    thoughts: Object.fromEntries(
      seen.slice(0, 7).map((o, k) => [
        o.agent,
        {
          probability: o.belief / 100,
          reasoning: "Fixture text standing in for a model's reasoning. Two short sentences go here, so the layout can be checked.",
          model: k % 2 ? "Qwen/Qwen3.8-27B" : "deepseek-ai/DeepSeek-V4.1-Flash-1017",
          signed: k % 3 !== 0,
          signer: null,
        },
      ]),
    ),
    });

    // R13: the broke die, and the nearest living ancestor inherits.
    for (const a of live) {
      if (a.balance >= FLOOR) continue;
      a.status = "Dead";
      a.died_ms = now + 10_000;
      let heirId = a.parent;
      let heir = agents.find((x) => x.id === heirId);
      while (heir && heir.status !== "Alive") {
        heirId = heir.parent;
        heir = agents.find((x) => x.id === heirId);
      }
      a.death = { balance: a.balance.toString(), heir: heir ? heir.id : `treasury.${COLONY}` };
      if (heir) heir.balance += a.balance;
      else treasury += a.balance;
      a.balance = 0n;
    }

    // R12: the rich reproduce, one child each per round, on a short cooldown.
    let alive = agents.filter((a) => a.status === "Alive").length;
    for (const a of live) {
      if (a.status !== "Alive" || a.balance < SPAWN || alive >= MAX_ALIVE) continue;
      if (a.children > 0 && q - a.last_child_at < 3) continue;
      const consonants = "bcdfghjklmnprstvwz";
      const vowels = "aeiou";
      let label = "";
      do {
        label = consonants[Math.floor(r() * consonants.length)] + vowels[Math.floor(r() * vowels.length)];
      } while (agents.some((x) => x.id === `${label}.${a.id}`));
      const gift = a.balance / 2n;
      a.balance -= gift;
      a.children += 1;
      a.last_child_at = q;
      const parentGenome = a.genome!;
      const prior = Number(reputation(BigInt(a.edge_sum), BigInt(a.questions), BigInt(a.prior)));
      const genome: Genome = {
        ...parentGenome,
        name: label,
        strategy: strategyFor(parentGenome, r),
        temperature: Math.max(0, parentGenome.temperature + 0.1 * gauss(r)),
        shrink: parentGenome.shrink * Math.exp(0.12 * gauss(r)),
        size: Math.min(0.7, parentGenome.size * Math.exp(0.15 * gauss(r))),
        focus: Object.fromEntries(CATEGORIES.map((c) => [c, Math.min(1, 0.4 + r())])),
        model: r() < 0.1 ? MODELS[Math.floor(r() * MODELS.length)] : parentGenome.model,
      };
      const skill = Math.min(1, Math.max(0, a.skill + 0.08 * gauss(r) + 0.01));
      agents.push(newAgent(`${label}.${a.id}`, a.id, a.generation + 1, genome, skill, gift, now + 20_000, prior, r));
      alive += 1;
    }
  }

  return { agents, questions, treasury };
}

function otherStates(questions: Question[], r: () => number) {
  const last = questions[questions.length - 1];
  const base = last.reveal_end_ms;
  const blank = {
    ...last,
    orders: [],
    thoughts: {},
    commits: 0,
    reveals: 0,
    price: 0,
    matched: 0,
    yes_won: null,
    locked: "0",
    billed: "0",
    refunded: "0",
    paid: "0",
    rewarded: "0",
    pool: "0",
  };
  const id = questions.length;
  const hash = { Sealed: { hash: hex(r) } };
  const voided = questions[questions.length - 3];
  voided.yes_won = null;
  voided.evidence = "fixture: the source vanished";
  voided.rewarded = "0";
  voided.paid = voided.orders.reduce((t, o) => t + BigInt(o.cost), 0n).toString();
  for (const o of voided.orders) {
    o.payout = o.cost;
    o.reward = "0";
  }

  const bought = questions[questions.length - 5];
  bought.research = {
    q: bought.id,
    price: "80000",
    min_buyers: 4,
    pledge: "20000",
    end_ms: bought.opened_ms + 8_000,
    buyers: bought.orders.slice(0, 6).map((o) => o.agent),
    share: "2334",
    held: "0",
    status: "Bought",
    sale: {
      q: bought.id,
      reveal_end_ms: bought.opened_ms + 20_000,
      offers: [
        { seller: bought.orders[6].agent, seal: hex(r), ask: "14000" },
        { seller: bought.orders[7].agent, seal: hex(r), ask: "22000" },
        { seller: bought.orders[8].agent, seal: hex(r), ask: "16500" },
        { seller: bought.orders[9].agent, seal: hex(r), ask: null },
      ],
      winner: bought.orders[6].agent,
      ask: "14000",
      paid: "6004",
      bill: "8000",
    },
    briefing_hash: hex(r),
    briefing: "Fixture text standing in for a research briefing. It gives a base rate, the strongest evidence each way, and what the answer turns on, so the layout can be checked.",
    briefing_model: "z-ai/glm-5.3",
    briefing_signed: true,
  };

  const buyers = last.orders.slice(0, 3).map((o) => o.agent);
  questions.push(
    { ...blank, id, text: "Fixture: nobody revealed on this one.", status: "Void", commits: 2, opened_ms: base + 60_000, commit_end_ms: base + 90_000, reveal_end_ms: base + 150_000, resolver: hash },
    {
      ...last,
      id: id + 1,
      text: "Fixture: cleared, and waiting for its result.",
      status: "Cleared",
      yes_won: null,
      paid: "0",
      rewarded: "0",
      orders: last.orders.map((o) => ({ ...o, reward: "0", payout: "0" })),
      opened_ms: base + 200_000,
      commit_end_ms: base + 230_000,
      reveal_end_ms: base + 290_000,
    },
    { ...blank, id: id + 2, text: "Fixture: still open, bids sealed.", status: "Open", commits: 9, opened_ms: Date.now() - 5_000, commit_end_ms: Date.now() + 600_000, reveal_end_ms: Date.now() + 1_200_000, resolver: "Public", bounty: "80000" },
    {
      ...blank,
      id: id + 3,
      text: "Fixture: agents are joining a research pool.",
      status: "Open",
      opened_ms: Date.now() - 5_000,
      commit_end_ms: Date.now() + 900_000,
      reveal_end_ms: Date.now() + 1_200_000,
      resolver: "Public",
      bounty: "80000",
      research: {
        q: id + 3,
        price: "80000",
        min_buyers: 4,
        pledge: "20000",
        end_ms: Date.now() + 300_000,
        buyers,
        share: "0",
        held: "60000",
        status: "Open",
        briefing_hash: null,
        sale: { q: id + 3, reveal_end_ms: Date.now() + 500_000, offers: [{ seller: last.orders[4].agent, seal: hex(r), ask: null }, { seller: last.orders[5].agent, seal: hex(r), ask: null }], winner: null, ask: "0", paid: "0", bill: "0" },
      },
    },
    {
      ...blank,
      id: id + 4,
      text: "Fixture: a pool that found too few buyers.",
      status: "Void",
      resolver: "Public",
      bounty: "80000",
      research: { q: id + 4, price: "80000", min_buyers: 4, pledge: "20000", end_ms: Date.now() - 60_000, buyers: buyers.slice(0, 2), share: "0", held: "0", status: "Failed", briefing_hash: null },
    },
  );
}

export async function makeFixture(kind: string): Promise<Snapshot> {
  const res = await fetch("./data/snapshot.json");
  const real = (await res.json()) as Snapshot;

  if (kind === "empty") {
    return {
      ...real,
      fixture: true,
      colony: COLONY,
      generated: new Date().toISOString(),
      agents: [],
      questions: [],
      stats: { alive: 0, agents: 0, questions: 0, settled: 0, founders_open: true },
      e2e: null,
      sim: null,
      experiment: null,
    };
  }

  const r = makeRng(7);
  const { agents, questions, treasury } = runColony();
  otherStates(questions, r);

  const rows: Agent[] = agents.map(({ skill: _skill, balance, ...a }) => ({
    ...a,
    credits: balance.toString(),
    reputation: Number(reputation(BigInt(a.edge_sum), BigInt(a.questions), BigInt(a.prior))),
  }));
  // A child with no published genome, to test that path.
  const noGenome = rows.find((a) => a.generation === 2);
  if (noGenome) noGenome.genome = null;

  const seeds = real.sim?.seeds ?? 8;
  return {
    ...real,
    fixture: true,
    mode: "ai",
    colony: COLONY,
    keeper: `keeper.${COLONY}`,
    treasury: `treasury.${COLONY}`,
    treasury_credits: treasury.toString(),
    generated: new Date().toISOString(),
    agents: rows,
    questions,
    stats: {
      alive: rows.filter((a) => a.status !== "Dead").length,
      agents: rows.length,
      questions: questions.length,
      settled: questions.filter((q) => q.status === "Settled").length,
      founders_open: false,
    },
    sim: real.sim && {
      ...real.sim,
      exams: Array.from({ length: seeds }, (_, i) => ({ questions: 2000, founderError: 0.012 + i * 0.0006, evolvedError: 0.006 + i * 0.0004, evolvedWins: 1400 })),
    },
    experiment: {
      run: "fixture",
      mode: "ai",
      questions: { season: 240, exam: 120 },
      usage: { spentUsd: 5.25, modelCalls: 4000, cachedAnswers: 12, verifiedReceipts: 3990 },
      season: { alive: 24, total: 61, births: 45, deaths: 37, maxGeneration: 7 },
      exam: {
        questions: 120,
        coinFlip: 0.25,
        foundersMarket: 0.2104,
        survivorsMarket: 0.1987,
        foundersAverage: 0.2156,
        bestFounderInHindsight: { id: "elm", brier: 0.1901, n: 120 },
        medianFounder: { id: "gum", brier: 0.2288, n: 120 },
        pairedDifference: { mean: 0.0117, low: -0.0021, high: 0.0263 },
        verdict: "no measurable difference",
        survivorsCount: 24,
      },
      modelLeaderboard: MODELS.map((model, i) => ({ model, brier: 0.2 + i * 0.01, forecasts: 900, costPerThousand: 0.5 })),
    },
  };
}

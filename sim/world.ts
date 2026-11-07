/**
 * A colony with scripted agents and no language model calls. Agents have a
 * hidden noise level and a hidden over-confidence level, and the market never
 * sees either. The simulator runs the same rules as the contract, so it can
 * answer two questions cheaply: does selection find the better agents, and can
 * the market be gamed?
 */
import { clear, lockFor, poolPledge, poolShare, settle, SHARE_UNITS, type Order } from "../engine/market.ts";

export const CREDIT = 1_000_000n;

export interface Params {
  founders: number;
  questions: number;
  capital: bigint;
  /** Units an agent pays to think about a question. */
  bill: bigint;
  bounty: bigint;
  treasuryBps: bigint;
  floor: bigint;
  spawnThreshold: bigint;
  endowmentBps: bigint;
  spawnCooldown: number;
  maxAlive: number;
  maxStake: bigint;
  /** Turn selection off to get the control group. */
  selection: boolean;
  seed: number;
  /** R26: one question in this many offers a shared briefing. Zero turns pools off. */
  poolEvery: number;
  poolPrice: bigint;
  poolMinBuyers: number;
  /**
   * The briefing's error, in log odds. Every buyer reads the same text, so when it
   * is wrong they are all wrong together.
   */
  briefingNoise: number;
}

export const DEFAULTS: Params = {
  founders: 25,
  questions: 1200,
  capital: 1n * CREDIT,
  bill: 2_000n,
  bounty: 80_000n,
  treasuryBps: 500n,
  floor: 150_000n,
  spawnThreshold: 2n * CREDIT,
  endowmentBps: 5000n,
  spawnCooldown: 10,
  maxAlive: 48,
  maxStake: 60n,
  selection: true,
  seed: 1,
  poolEvery: 0,
  poolPrice: 40_000n,
  poolMinBuyers: 4,
  briefingNoise: 0.3,
};

/** How much a buyer leans on the briefing rather than on its own reading. */
const BRIEFING_WEIGHT = 0.6;

export interface Genome {
  /** Standard deviation of the agent's reading of the evidence, in log odds. Lower is better. */
  noise: number;
  /** Multiplies the agent's log odds. Above 1 is over-confident, below 1 is timid. */
  confidence: number;
  /** Fraction of capital staked per question. */
  size: number;
  /**
   * How much the agent follows the error every agent shares on a question.
   * Language models make correlated mistakes, so averaging alone cannot fix them.
   */
  herd: number;
  /** R26: how likely the agent is to join a research pool. */
  pool: number;
}

export interface Agent {
  id: string;
  parent: string | null;
  gen: number;
  genome: Genome;
  balance: bigint;
  born: number;
  died: number | null;
  children: number;
  lastChildAt: number;
  edgeSum: number;
  trades: number;
}

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const clampBelief = (p: number) => Math.min(99, Math.max(1, Math.round(p * 100)));

export function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/**
 * `shared` is the same for every agent on a question: the mistake they all tend to
 * make. `briefing` is what a buyer read, in log odds, and the same for every buyer.
 */
export function beliefOf(g: Genome, truth: number, shared: number, r: Rng, briefing: number | null = null): number {
  const own = logit(truth) + g.herd * shared + g.noise * gauss(r);
  const reading = briefing === null ? own : (1 - BRIEFING_WEIGHT) * own + BRIEFING_WEIGHT * briefing;
  return clampBelief(logistic(g.confidence * reading));
}

export function stakeOf(g: Genome, balance: bigint, maxStake: bigint): bigint {
  const spend = Number(balance) * g.size;
  const shares = BigInt(Math.floor(spend / Number(SHARE_UNITS)));
  return shares > maxStake ? maxStake : shares;
}

function mutate(g: Genome, r: Rng, pools: boolean): Genome {
  return {
    noise: Math.max(0.05, g.noise * Math.exp(0.15 * gauss(r))),
    confidence: Math.min(3, Math.max(0.2, g.confidence * Math.exp(0.12 * gauss(r)))),
    size: Math.min(0.3, Math.max(0.01, g.size * Math.exp(0.12 * gauss(r)))),
    herd: Math.min(1.5, Math.max(0, g.herd * Math.exp(0.15 * gauss(r)))),
    // Only drawn when pools are on, so a run without them replays exactly.
    pool: pools ? Math.min(1, Math.max(0, g.pool + 0.08 * gauss(r))) : g.pool,
  };
}

export interface Bucket {
  from: number;
  brier: number;
  /** Brier score of the plain average belief, one agent one vote. */
  avgBrier: number;
  /** Mean squared gap between the clearing price and the hidden truth. Free of outcome luck. */
  truthError: number;
  alive: number;
  meanNoise: number;
  meanHerd: number;
  meanConfidence: number;
  meanPool: number;
  wealth: number;
  maxGen: number;
  births: number;
  deaths: number;
}

export interface Report {
  params: Record<string, string | number | boolean>;
  buckets: Bucket[];
  agents: Agent[];
  treasury: bigint;
  conservationErrors: number;
  /** Same questions, founders against the final population, stakes frozen. */
  exam: { questions: number; founderError: number; evolvedError: number; evolvedWins: number };
  /**
   * R26: pools offered, pools that found enough buyers, and buyers per bought pool.
   * `withBriefing` and `withoutIt` are the swarm's error on the same bought questions,
   * with the briefing and with the same agents reading nothing.
   */
  pools: { offered: number; bought: number; meanBuyers: number; meanGene: number; withBriefing: number; withoutIt: number };
}

/** The wealth-weighted answer of a frozen population on one question. */
function examPrice(pop: { genome: Genome; weight: bigint }[], truth: number, shared: number, r: Rng): number {
  const orders: Order[] = pop.map((a, i) => ({
    agent: `e${i}`,
    belief: beliefOf(a.genome, truth, shared, r),
    stake: a.weight > 0n ? a.weight : 1n,
  }));
  return clear(orders).price / 100;
}

export function runColony(p: Params): Report {
  const r = makeRng(p.seed);
  const pools = p.poolEvery > 0;
  const agents: Agent[] = [];
  for (let i = 0; i < p.founders; i++) {
    agents.push({
      id: `f${i}`,
      parent: null,
      gen: 0,
      genome: {
        noise: 0.3 + r() * 1.5,
        confidence: 0.5 + r() * 1.5,
        size: 0.04 + r() * 0.12,
        herd: r() * 1.2,
        pool: pools ? r() : 0.5,
      },
      balance: p.capital,
      born: 0,
      died: null,
      children: 0,
      lastChildAt: -999,
      edgeSum: 0,
      trades: 0,
    });
  }

  let treasury = 0n;
  let externalIn = p.capital * BigInt(p.founders);
  let births = 0;
  let deaths = 0;
  const buckets: Bucket[] = [];
  let acc = { brier: 0, avgBrier: 0, truthError: 0, n: 0 };
  const founders = agents.map((a) => ({ genome: a.genome, weight: 30n }));
  const bucketSize = Math.max(1, Math.floor(p.questions / 12));
  let conservationErrors = 0;
  let offered = 0;
  let bought = 0;
  let totalBuyers = 0;
  let withBriefing = 0;
  let withoutIt = 0;

  for (let q = 0; q < p.questions; q++) {
    // A hidden true chance, spread out so most questions are not coin flips.
    const truth = Math.min(0.97, Math.max(0.03, logistic(1.4 * gauss(r))));
    const yesWon = r() < truth;
    const shared = 1.0 * gauss(r);
    const live = agents.filter((a) => a.died === null);

    // R26, R27: buyers pay only if enough join, and then only their share.
    const readers = new Set<string>();
    let briefing: number | null = null;
    if (pools && q % p.poolEvery === 0) {
      offered += 1;
      const pledge = poolPledge(p.poolPrice, p.poolMinBuyers);
      const buyers = live.filter((a) => r() < a.genome.pool && a.balance - pledge >= p.floor);
      if (buyers.length >= p.poolMinBuyers) {
        const share = poolShare(p.poolPrice, buyers.length);
        for (const a of buyers) {
          a.balance -= share;
          treasury += share;
          readers.add(a.id);
        }
        briefing = logit(truth) + p.briefingNoise * gauss(r);
        bought += 1;
        totalBuyers += buyers.length;
      }
    }

    const orders: Order[] = [];
    const beliefs: number[] = [];
    for (const a of live) {
      const stake = stakeOf(a.genome, a.balance - p.bill, p.maxStake);
      if (stake <= 0n) continue;
      const belief = beliefOf(a.genome, truth, shared, r, readers.has(a.id) ? briefing : null);
      beliefs.push(belief);
      if (lockFor(belief, stake) + p.bill > a.balance) continue;
      orders.push({ agent: a.id, belief, stake });
      a.balance -= p.bill;
      treasury += p.bill;
    }

    const cut = (p.bounty * p.treasuryBps) / 10_000n;
    const pool = p.bounty - cut;
    externalIn += p.bounty;
    treasury += cut;

    const c = clear(orders);
    if (c.price === 0) {
      treasury += pool;
      continue;
    }
    const s = settle(c, yesWon, pool);
    treasury += s.dust;

    const byId = new Map(live.map((a) => [a.id, a]));
    if (briefing !== null) {
      const alone = orders.map((o) => ({ ...o, belief: beliefOf(byId.get(o.agent)!.genome, truth, shared, r) }));
      withBriefing += (c.price / 100 - truth) ** 2;
      withoutIt += (clear(alone).price / 100 - truth) ** 2;
    }
    for (const row of s.rows) {
      const a = byId.get(row.agent)!;
      const delta = row.pnl + row.reward;
      if (p.selection) a.balance += delta;
      else treasury += delta; // Control group: stakes never compound.
      a.edgeSum += row.edge;
      a.trades += 1;
    }

    const avg = beliefs.reduce((x, y) => x + y, 0) / (beliefs.length || 1);
    const o = yesWon ? 1 : 0;
    acc.brier += (c.price / 100 - o) ** 2;
    acc.avgBrier += (avg / 100 - o) ** 2;
    acc.truthError += (c.price / 100 - truth) ** 2;
    acc.n += 1;

    if (p.selection) {
      // R13: reap the broke.
      for (const a of live) {
        if (a.balance < p.floor) {
          a.died = q;
          deaths += 1;
          const heir = nearestLiving(agents, a);
          if (heir) heir.balance += a.balance;
          else treasury += a.balance;
          a.balance = 0n;
        }
      }
      // R12: the rich reproduce.
      let alive = agents.filter((a) => a.died === null).length;
      for (const a of live) {
        if (a.died !== null || alive >= p.maxAlive) continue;
        if (a.balance >= p.spawnThreshold && q - a.lastChildAt >= p.spawnCooldown) {
          const gift = (a.balance * p.endowmentBps) / 10_000n;
          a.balance -= gift;
          a.children += 1;
          a.lastChildAt = q;
          agents.push({
            id: `${a.id}.${a.children}`,
            parent: a.id,
            gen: a.gen + 1,
            genome: mutate(a.genome, r, pools),
            balance: gift,
            born: q,
            died: null,
            children: 0,
            lastChildAt: q,
            edgeSum: 0,
            trades: 0,
          });
          alive += 1;
          births += 1;
        }
      }
    }

    // Money can only sit in an agent or the treasury.
    const held = agents.reduce((t, a) => t + a.balance, 0n) + treasury;
    if (p.selection && held !== externalIn) conservationErrors += 1;

    if ((q + 1) % bucketSize === 0) {
      const now = agents.filter((a) => a.died === null);
      const w = now.reduce((t, a) => t + Number(a.balance), 0) || 1;
      buckets.push({
        from: q + 1 - bucketSize,
        brier: acc.brier / acc.n,
        avgBrier: acc.avgBrier / acc.n,
        truthError: acc.truthError / acc.n,
        alive: now.length,
        meanNoise: now.reduce((t, a) => t + a.genome.noise * Number(a.balance), 0) / w,
        meanHerd: now.reduce((t, a) => t + a.genome.herd * Number(a.balance), 0) / w,
        meanConfidence: now.reduce((t, a) => t + a.genome.confidence * Number(a.balance), 0) / w,
        meanPool: now.reduce((t, a) => t + a.genome.pool * Number(a.balance), 0) / w,
        wealth: w / Number(CREDIT),
        maxGen: Math.max(...now.map((a) => a.gen)),
        births,
        deaths,
      });
      acc = { brier: 0, avgBrier: 0, truthError: 0, n: 0 };
      births = 0;
      deaths = 0;
    }
  }

  // The exam: the same fresh questions for both populations, so luck is shared.
  const evolved = agents
    .filter((a) => a.died === null)
    .map((a) => ({ genome: a.genome, weight: stakeOf(a.genome, a.balance, p.maxStake) }));
  const examQuestions = 2000;
  let founderError = 0;
  let evolvedError = 0;
  let evolvedWins = 0;
  for (let i = 0; i < examQuestions; i++) {
    const truth = Math.min(0.97, Math.max(0.03, logistic(1.4 * gauss(r))));
    const shared = gauss(r);
    const a = (examPrice(founders, truth, shared, r) - truth) ** 2;
    const b = (examPrice(evolved, truth, shared, r) - truth) ** 2;
    founderError += a;
    evolvedError += b;
    if (b < a) evolvedWins += 1;
  }

  const left = agents.filter((a) => a.died === null);
  const leftWealth = left.reduce((t, a) => t + Number(a.balance), 0) || 1;
  const meanGene = left.reduce((t, a) => t + a.genome.pool * Number(a.balance), 0) / leftWealth;

  const params: Report["params"] = {};
  for (const [k, v] of Object.entries(p)) params[k] = typeof v === "bigint" ? v.toString() : v;
  return {
    params,
    buckets,
    agents,
    treasury,
    conservationErrors,
    exam: { questions: examQuestions, founderError: founderError / examQuestions, evolvedError: evolvedError / examQuestions, evolvedWins },
    pools: { offered, bought, meanBuyers: totalBuyers / (bought || 1), meanGene, withBriefing: withBriefing / (bought || 1), withoutIt: withoutIt / (bought || 1) },
  };
}

function nearestLiving(agents: Agent[], a: Agent): Agent | null {
  let id = a.parent;
  while (id) {
    const anc = agents.find((x) => x.id === id);
    if (!anc) return null;
    if (anc.died === null) return anc;
    id = anc.parent;
  }
  return null;
}

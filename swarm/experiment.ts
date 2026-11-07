/**
 * Does the colony get better? This is the project's go/no-go test.
 *
 * Founders forecast real, already resolved questions under the colony's rules.
 * Rich agents reproduce with rewritten strategies, broke agents die. Then the
 * founders and the survivors sit the same exam, on questions neither has seen.
 * The result is a paired comparison with a confidence interval, so "no
 * measurable gain" is a possible and publishable outcome.
 *
 *   NEARAI_API_KEY=... node swarm/experiment.ts            real forecasts
 *   node swarm/experiment.ts --replay                      no key, no cost, same result
 *   node swarm/experiment.ts --scripted                    test the machinery with fake forecasts
 *   node swarm/experiment.ts --pools 60                    also test briefings on 60 exam questions
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { clear, lockFor, settle, type Order } from "../engine/market.ts";
import { inPool } from "./chain.ts";
import { childLabel, engages, gaussian, mutateNumbers, toOrder, type Genome, type Rng } from "./genome.ts";
import { founders, MODELS } from "./founders.ts";
import { AccountProblem, BRIEFING_MODEL, cacheKey, forecast, loadCache, rewriteStrategy, saveCache, writeBriefing, type QuestionText } from "./llm.ts";

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};

const scripted = flag("scripted");
const replay = flag("replay");
const runIndex = process.argv.indexOf("--run");
const RUN = runIndex > 0 ? process.argv[runIndex + 1] : scripted ? "scripted" : "experiment";
const SEED = option("seed", 7);
const TRAIN = option("train", 240);
const EXAM = option("exam", 120);
const BUDGET = option("budget", 8); // dollars
const BRIEFED = option("pools", 0); // exam questions sat again with a briefing

/** The colony's rules. These match the deployed configuration. */
export const RULES = {
  capital: 1_000_000n,
  bounty: BigInt(option("bounty", 80_000)),
  treasuryBps: 500n,
  floor: BigInt(option("floor", 350_000)),
  spawnThreshold: BigInt(option("spawn", 1_500_000)),
  endowmentBps: 5000n,
  spawnCooldown: option("cooldown", 6),
  maxAlive: 32,
  maxStake: BigInt(option("maxstake", 60)),
  reserve: 40_000n,
  /** Capital here is play money, so bills are scaled up to cost what they would on a small real budget. */
  billScale: option("billscale", 8),

};

interface Q extends QuestionText {
  yes: boolean;
  closes: string;
}

interface Agent {
  id: string;
  parent: string | null;
  founder: string;
  gen: number;
  genome: Genome;
  balance: bigint;
  born: number;
  died: number | null;
  lastChildAt: number;
  children: number;
  edgeSum: number;
  trades: number;
  bills: bigint;
  results: { text: string; belief: number; yes: boolean }[];
}

function makeRng(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const cache = loadCache(RUN);
let spent = 0;
let calls = 0;
let cached = 0;
let verifiedReceipts = 0;

interface Answer {
  probability: number;
  cost: number;
  reasoning: string;
  receipt: string | null;
}

/** A hidden skill per genome, used only by --scripted, to test the machinery. */
function fakeForecast(g: Genome, q: Q, key: string, briefed: boolean): Answer {
  const r = makeRng(Number.parseInt(key.slice(0, 8), 16));
  const skill = 0.3 + 0.9 * (1 - Math.min(1, Math.abs(g.temperature - 0.3) * 2));
  const reading = (q.yes ? 1 : -1) * skill + (briefed ? 0.55 : 1.1) * gaussian(r);
  return { probability: 1 / (1 + Math.exp(-reading)), cost: 400, reasoning: "scripted", receipt: null };
}

async function answer(g: Genome, q: Q, briefing?: string): Promise<Answer | null> {
  const key = cacheKey(g, briefing === undefined ? q.id : `${q.id}:briefed`);
  const hit = cache.get(key);
  if (hit) {
    cached += 1;
    spent += hit.cost / 1e6;
    return hit.failed ? null : hit;
  }
  if (replay) return null;
  if (scripted) {
    const a = fakeForecast(g, q, key, briefing !== undefined);
    cache.set(key, { key, ...a });
    return a;
  }
  if (spent > BUDGET) throw new Error(`budget of $${BUDGET} reached`);
  const f = await forecast(g, q, briefing).catch((e) => {
    // An account problem would fail every call, so it stops the run. Answers so far
    // are saved, and the same command picks up where this left off.
    if (e instanceof AccountProblem) throw e;
    console.log(`  forecast failed for ${g.model}: ${String(e.message).slice(0, 100)}`);
    return null;
  });
  calls += 1;
  if (!f) {
    const row = { key, failed: true, cost: 0, q: q.id };
    cache.set(key, row);
    saveCache(RUN, row);
    return null;
  }
  spent += f.reply.cost / 1e6;
  if (f.reply.tee?.verified) verifiedReceipts += 1;
  const row = {
    key,
    q: q.id,
    model: g.model,
    probability: f.probability,
    reasoning: f.reasoning,
    cost: f.reply.cost,
    tokens: [f.reply.tokensIn, f.reply.tokensOut],
    receipt: f.reply.tee?.response_hash ?? null,
    tee: f.reply.tee,
  };
  cache.set(key, row);
  saveCache(RUN, row);
  return row as Answer;
}

/** R26: the briefing a pool would buy on this question, saved like any other answer. */
async function briefingOf(q: Q): Promise<string | null> {
  const key = `briefing:${q.id}`;
  const hit = cache.get(key);
  if (hit) {
    spent += hit.cost / 1e6;
    return hit.failed ? null : hit.text;
  }
  if (replay) return null;
  if (scripted) {
    const text = `A scripted briefing on question ${q.id}.`;
    cache.set(key, { key, text, cost: 0 });
    return text;
  }
  if (spent > BUDGET) throw new Error(`budget of $${BUDGET} reached`);
  const b = await writeBriefing(q).catch((e) => {
    if (e instanceof AccountProblem) throw e;
    console.log(`  briefing failed for ${q.id}: ${String(e.message).slice(0, 100)}`);
    return null;
  });
  calls += 1;
  const row = b ? { key, q: q.id, model: BRIEFING_MODEL, text: b.text, cost: b.reply.cost, tee: b.reply.tee } : { key, q: q.id, failed: true, cost: 0 };
  spent += row.cost / 1e6;
  cache.set(key, row);
  saveCache(RUN, row);
  return b?.text ?? null;
}

const brier = (p: number, yes: boolean) => (p - (yes ? 1 : 0)) ** 2;

function makeFounders(): Agent[] {
  return founders().map((genome) => ({
    id: genome.name,
    parent: null,
    founder: genome.name,
    gen: 0,
    genome,
    balance: RULES.capital,
    born: 0,
    died: null,
    lastChildAt: -999,
    children: 0,
    edgeSum: 0,
    trades: 0,
    bills: 0n,
    results: [],
  }));
}

function nearestLiving(all: Agent[], a: Agent): Agent | null {
  let id = a.parent;
  while (id) {
    const anc = all.find((x) => x.id === id);
    if (!anc) return null;
    if (anc.died === null) return anc;
    id = anc.parent;
  }
  return null;
}

async function inherit(parent: Agent, label: string): Promise<Genome> {
  const numbers = mutateNumbers({ ...parent.genome, name: label }, rng, MODELS);
  const key = `rewrite:${parent.id}:${label}`;
  const hit = cache.get(key);
  if (hit) {
    spent += hit.cost / 1e6;
    return { ...numbers, strategy: hit.strategy };
  }
  if (replay || scripted) {
    const strategy = scripted ? `${parent.genome.strategy} (revised)` : parent.genome.strategy;
    return { ...numbers, strategy };
  }
  const record = parent.results
    .slice(-12)
    .map((r) => `${r.belief}% on "${r.text.slice(0, 70)}": ${r.yes ? "YES" : "NO"}`)
    .join("\n");
  const rewritten = await rewriteStrategy(parent.genome, record).catch(() => null);
  if (!rewritten) return numbers;
  spent += rewritten.reply.cost / 1e6;
  const row = { key, strategy: rewritten.strategy, cost: rewritten.reply.cost };
  cache.set(key, row);
  saveCache(RUN, row);
  return { ...numbers, strategy: rewritten.strategy };
}

interface Round {
  i: number;
  price: number;
  yes: boolean;
  n: number;
  alive: number;
}

async function runSeason(questions: Q[]) {
  const agents = makeFounders();
  let treasury = 0n;
  let inflow = RULES.capital * BigInt(agents.length);
  const rounds: Round[] = [];
  const births: { at: number; id: string; parent: string; gen: number; strategy: string }[] = [];
  const deaths: { at: number; id: string; gen: number }[] = [];
  const history: { at: number; alive: number; maxGen: number; wealth: number; meanShrink: number; share: Record<string, number> }[] = [];

  for (const [i, q] of questions.entries()) {
    const live = agents.filter((a) => a.died === null).sort((a, b) => (a.id < b.id ? -1 : 1));
    const engaged = live.filter((a) => engages(a.genome, a.id, q.id, q.category));
    const replies = await inPool(engaged, 8, (a) => answer(a.genome, q));

    const orders: Order[] = [];
    engaged.forEach((a, k) => {
      const reply = replies[k];
      if (!reply) return;
      const bill = BigInt(Math.ceil(reply.cost * RULES.billScale));
      const order = toOrder(a.genome, reply.probability, a.balance - bill, RULES.maxStake, RULES.reserve);
      a.balance -= bill;
      a.bills += bill;
      treasury += bill;
      if (!order) return;
      if (lockFor(order.belief, order.stake) > a.balance) return;
      orders.push({ agent: a.id, belief: order.belief, stake: order.stake });
    });

    const cut = (RULES.bounty * RULES.treasuryBps) / 10_000n;
    const pool = RULES.bounty - cut;
    inflow += RULES.bounty;
    treasury += cut;
    const c = clear(orders);
    if (c.price === 0) {
      treasury += pool;
      continue;
    }
    const s = settle(c, q.yes, pool);
    treasury += s.dust;
    const byId = new Map(live.map((a) => [a.id, a]));
    for (const row of s.rows) {
      const a = byId.get(row.agent)!;
      a.balance += row.pnl + row.reward;
      a.edgeSum += row.edge;
      a.trades += 1;
      const o = orders.find((x) => x.agent === a.id)!;
      a.results.push({ text: q.text, belief: o.belief, yes: q.yes });
    }
    rounds.push({ i, price: c.price, yes: q.yes, n: orders.length, alive: live.length });

    for (const a of live) {
      if (a.balance < RULES.floor) {
        a.died = i;
        deaths.push({ at: i, id: a.id, gen: a.gen });
        const heir = nearestLiving(agents, a);
        if (heir) heir.balance += a.balance;
        else treasury += a.balance;
        a.balance = 0n;
      }
    }

    let alive = agents.filter((a) => a.died === null).length;
    for (const a of live) {
      if (a.died !== null || alive >= RULES.maxAlive) continue;
      if (a.balance < RULES.spawnThreshold || i - a.lastChildAt < RULES.spawnCooldown) continue;
      const taken = new Set(agents.filter((x) => x.parent === a.id).map((x) => x.id.split(".")[0]));
      const label = childLabel(rng, taken);
      const genome = await inherit(a, label);
      const gift = (a.balance * RULES.endowmentBps) / 10_000n;
      a.balance -= gift;
      a.children += 1;
      a.lastChildAt = i;
      const child: Agent = {
        id: `${label}.${a.id}`,
        parent: a.id,
        founder: a.founder,
        gen: a.gen + 1,
        genome,
        balance: gift,
        born: i,
        died: null,
        lastChildAt: i,
        children: 0,
        edgeSum: 0,
        trades: 0,
        bills: 0n,
        results: [],
      };
      agents.push(child);
      births.push({ at: i, id: child.id, parent: a.id, gen: child.gen, strategy: genome.strategy });
      alive += 1;
    }

    const held = agents.reduce((t, a) => t + a.balance, 0n) + treasury;
    if (held !== inflow) throw new Error(`money broke at question ${i}: ${held} vs ${inflow}`);

    if ((i + 1) % 20 === 0) {
      const now = agents.filter((a) => a.died === null);
      const wealth = now.reduce((t, a) => t + Number(a.balance), 0);
      const share: Record<string, number> = {};
      for (const a of now) share[a.genome.model] = (share[a.genome.model] ?? 0) + Number(a.balance) / wealth;
      history.push({
        at: i + 1,
        alive: now.length,
        maxGen: Math.max(...now.map((a) => a.gen)),
        wealth: wealth / 1e6,
        meanShrink: now.reduce((t, a) => t + a.genome.shrink * Number(a.balance), 0) / wealth,
        share,
      });
      console.log(`  ${i + 1} questions: ${now.length} alive, generation ${Math.max(...now.map((a) => a.gen))}, ${births.length} births, ${deaths.length} deaths, $${spent.toFixed(2)} spent`);
    }
  }
  return { agents, rounds, births, deaths, history, treasury };
}

interface Pop {
  name: string;
  members: { genome: Genome; stake: bigint; id: string }[];
}

/** One forecast per exam question from each member, then the market's answer. */
async function sitExam(pop: Pop, exam: Q[], briefings: (string | null)[] = []) {
  const prices: number[] = [];
  const means: number[] = [];
  const perMember = new Map<string, number[]>();
  for (const [i, q] of exam.entries()) {
    const replies = await inPool(pop.members, 8, (m) => answer(m.genome, q, briefings[i] ?? undefined));
    const orders: Order[] = [];
    const raw: number[] = [];
    pop.members.forEach((m, k) => {
      const r = replies[k];
      if (!r) return;
      const order = toOrder(m.genome, r.probability, 1_000_000n, RULES.maxStake, 0n);
      if (!order) return;
      orders.push({ agent: m.id, belief: order.belief, stake: m.stake });
      raw.push(order.belief / 100);
      const list = perMember.get(m.id) ?? [];
      list.push(brier(order.belief / 100, q.yes));
      perMember.set(m.id, list);
    });
    prices.push(clear(orders).price / 100);
    means.push(raw.reduce((a, b) => a + b, 0) / (raw.length || 1));
  }
  return { prices, means, perMember };
}

function pairedBootstrap(a: number[], b: number[], r: Rng, n = 4000) {
  const diffs = a.map((x, i) => x - b[i]);
  const samples: number[] = [];
  for (let k = 0; k < n; k++) {
    let t = 0;
    for (let i = 0; i < diffs.length; i++) t += diffs[Math.floor(r() * diffs.length)];
    samples.push(t / diffs.length);
  }
  samples.sort((x, y) => x - y);
  const mean = diffs.reduce((x, y) => x + y, 0) / diffs.length;
  return { mean, low: samples[Math.floor(n * 0.025)], high: samples[Math.floor(n * 0.975)] };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

// ---------- Run ----------

const all: Q[] = JSON.parse(readFileSync("data/questions.json", "utf8")).questions;
// Sports dominate the source, so cap them. The split is fixed by the file's stored order.
const sportsCap = Math.floor((TRAIN + EXAM) * 0.4);
let sports = 0;
const usable = all.filter((q) => {
  if (q.category !== "sports") return true;
  sports += 1;
  return sports <= sportsCap;
});
const exam = usable.slice(0, EXAM);
const train = usable.slice(EXAM, EXAM + TRAIN);
console.log(`Experiment (${RUN}${replay ? ", replay" : ""}): ${train.length} season questions, ${exam.length} exam questions`);

const season = await runSeason(train);
const survivors = season.agents.filter((a) => a.died === null);
console.log(`Season over: ${survivors.length} alive of ${season.agents.length}, ${season.births.length} births, ${season.deaths.length} deaths`);

const founderPop: Pop = { name: "founders", members: founders().map((g) => ({ genome: g, id: g.name, stake: 30n })) };
const survivorPop: Pop = {
  name: "survivors",
  members: survivors.map((a) => {
    const s = BigInt(Math.floor((Number(a.balance) * a.genome.size) / 10_000));
    return { genome: a.genome, id: a.id, stake: s < 1n ? 1n : s > RULES.maxStake ? RULES.maxStake : s };
  }),
};

console.log("Exam...");
const fx = await sitExam(founderPop, exam);
const sx = await sitExam(survivorPop, exam);

const fb = exam.map((q, i) => brier(fx.prices[i], q.yes));
const sb = exam.map((q, i) => brier(sx.prices[i], q.yes));
const fa = exam.map((q, i) => brier(fx.means[i], q.yes));
const test = pairedBootstrap(fb, sb, makeRng(SEED + 1));
// R26: does a briefing help real forecasts? The founders sit the same questions again
// with the text a pool would buy, so nothing differs but the briefing.
let briefings = null;
if (BRIEFED > 0) {
  console.log("Briefing test...");
  const sample = exam.slice(0, BRIEFED);
  const texts = await inPool(sample, 4, briefingOf);
  const kept = sample.map((q, i) => ({ q, i, text: texts[i] })).filter((k) => k.text !== null);
  const read = await sitExam(founderPop, kept.map((k) => k.q), kept.map((k) => k.text));
  const without = kept.map((k) => brier(fx.prices[k.i], k.q.yes));
  const withIt = kept.map((k, i) => brier(read.prices[i], k.q.yes));
  const difference = pairedBootstrap(without, withIt, makeRng(SEED + 2));
  briefings = {
    questions: kept.length,
    model: BRIEFING_MODEL,
    withoutBriefing: avg(without),
    withBriefing: avg(withIt),
    pairedDifference: difference,
    verdict: difference.low > 0 ? "briefings measurably help" : difference.high < 0 ? "briefings measurably hurt" : "no measurable difference",
  };
}

const singles = [...fx.perMember.entries()].map(([id, list]) => ({ id, brier: avg(list), n: list.length }));
singles.sort((a, b) => a.brier - b.brier);
const coinFlip = 0.25;

// What real people with real money said on the same date, when the source has it.
const crowdPrices: Record<string, number> = existsSync("data/crowd.json") ? JSON.parse(readFileSync("data/crowd.json", "utf8")) : {};
const withCrowd = exam.map((q, i) => ({ q, i })).filter(({ q }) => crowdPrices[q.id] !== undefined);
const crowd = withCrowd.length
  ? {
      questions: withCrowd.length,
      crowd: avg(withCrowd.map(({ q }) => brier(crowdPrices[q.id], q.yes))),
      foundersOnTheseQuestions: avg(withCrowd.map(({ i }) => fb[i])),
      survivorsOnTheseQuestions: avg(withCrowd.map(({ i }) => sb[i])),
    }
  : null;

const models = new Map<string, { b: number[]; cost: number }>();
for (const m of founderPop.members) {
  const list = fx.perMember.get(m.id) ?? [];
  const row = models.get(m.genome.model) ?? { b: [], cost: 0 };
  row.b.push(...list);
  for (const q of exam) row.cost += cache.get(cacheKey(m.genome, q.id))?.cost ?? 0;
  models.set(m.genome.model, row);
}
const leaderboard = [...models.entries()]
  .map(([model, r]) => ({ model, brier: avg(r.b), forecasts: r.b.length, costPerThousand: (r.cost / (r.b.length || 1)) * 1000 / 1e6 }))
  .sort((a, b) => a.brier - b.brier);

const verdict = test.low > 0 ? "survivors are measurably better" : test.high < 0 ? "survivors are measurably worse" : "no measurable difference";

const report = {
  run: RUN,
  mode: scripted ? "scripted" : "ai",
  seed: SEED,
  rules: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, String(v)])),
  questions: { season: train.length, exam: exam.length, from: "data/questions.json" },
  usage: { spentUsd: spent, modelCalls: calls, cachedAnswers: cached, verifiedReceipts, signedAnswers: [...cache.values()].filter((row) => row.tee?.verified).length },
  season: {
    alive: survivors.length,
    total: season.agents.length,
    births: season.births.length,
    deaths: season.deaths.length,
    maxGeneration: Math.max(...season.agents.map((a) => a.gen)),
    history: season.history,
    birthsList: season.births,
    deathsList: season.deaths,
    tree: season.agents.map((a) => ({ id: a.id, parent: a.parent, founder: a.founder, gen: a.gen, born: a.born, died: a.died, model: a.genome.model, credits: Number(a.balance) / 1e6, shrink: a.genome.shrink, strategy: a.genome.strategy })),
  },
  exam: {
    questions: exam.length,
    coinFlip,
    foundersMarket: avg(fb),
    survivorsMarket: avg(sb),
    foundersAverage: avg(fa),
    bestFounderInHindsight: singles[0],
    medianFounder: singles[Math.floor(singles.length / 2)],
    pairedDifference: test,
    verdict,
    survivorsCount: survivorPop.members.length,
    humanCrowd: crowd,
    briefings,
  },
  modelLeaderboard: leaderboard,
};
writeFileSync(RUN === "experiment" ? "data/experiment.json" : `data/experiment-${RUN}.json`, JSON.stringify(report, null, 1));

console.log(`\nExam on ${exam.length} new questions. Lower is better, a coin flip scores ${coinFlip}.`);
console.log(`  Founders, market answer   : ${avg(fb).toFixed(4)}`);
console.log(`  Survivors, market answer  : ${avg(sb).toFixed(4)}`);
console.log(`  Best founder, in hindsight: ${singles[0].brier.toFixed(4)} (${singles[0].id})`);
console.log(`  Median founder            : ${singles[Math.floor(singles.length / 2)].brier.toFixed(4)}`);
console.log(`  Improvement: ${test.mean.toFixed(4)}, 95% interval ${test.low.toFixed(4)} to ${test.high.toFixed(4)}`);
console.log(`  Verdict: ${verdict}`);
if (crowd) console.log(`  Human crowd on the same ${crowd.questions} questions: ${crowd.crowd.toFixed(4)} (survivors ${crowd.survivorsOnTheseQuestions.toFixed(4)})`);
if (briefings) console.log(`  Briefings on ${briefings.questions} questions: ${briefings.withoutBriefing.toFixed(4)} without, ${briefings.withBriefing.toFixed(4)} with. ${briefings.verdict}`);
console.log(`Spent $${spent.toFixed(2)}, ${calls} new calls, ${cached} cached, ${verifiedReceipts} verified signatures`);
for (const l of leaderboard) console.log(`  ${l.model.padEnd(40)} ${l.brier.toFixed(4)}  $${l.costPerThousand.toFixed(3)} per 1000`);

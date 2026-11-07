/**
 * A season on a live network: real accounts, sealed rounds, signed reveal
 * batches, births and deaths. The same genome and order code as the experiment.
 *
 *   node swarm/season.ts --questions 12              scripted agents, no key needed
 *   NEARAI_API_KEY=... node swarm/season.ts --ai     real forecasts
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exists, hasKey, loadKey, view } from "./chain.ts";
import * as c from "./colony.ts";
import { childLabel, engages, gaussian, mutateNumbers, toOrder, type Genome, type Rng } from "./genome.ts";
import { founders, MODELS } from "./founders.ts";
import { forecast, rewriteStrategy, type QuestionText } from "./llm.ts";

const arg = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? "1") : dflt;
};
const useAi = process.argv.includes("--ai");
const count = Number(arg("questions", "12"));
const commitSecs = Number(arg("commit", "14"));
const revealSecs = Number(arg("reveal", "60"));
const batchSize = Number(arg("batch", "8"));
const capital = 1_000_000n;
const billScripted = 2_000n;
const bounty = 80_000n;
const reserve = 40_000n;

const { colony } = c.deployment;
const REGISTRY = `data/genomes.${c.deployment.network}.${colony}.json`;

interface Rec {
  id: string;
  genome: Genome;
  parent: string | null;
}

let seed = 1_337;
const rng: Rng = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const registry: Record<string, Rec> = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, "utf8")) : {};
const saveRegistry = () => writeFileSync(REGISTRY, JSON.stringify(registry, null, 1));
const genomeText = (g: Genome) => JSON.stringify(g);

/** Scripted stand-in for a model: a hidden skill level plus noise. Clearly labelled in the data. */
function scriptedBelief(g: Genome, yes: boolean): number {
  const skill = 0.4 + (g.temperature < 0.35 ? 0.5 : 0);
  const reading = (yes ? 1 : -1) * skill + 0.9 * gaussian(rng);
  return 1 / (1 + Math.exp(-reading));
}

const questions: (QuestionText & { yes: boolean; source: string })[] = JSON.parse(readFileSync("data/questions.json", "utf8")).questions;

async function ensureFounders() {
  const stats = await c.getStats();
  for (const g of founders()) {
    const id = `${g.name}.${colony}`;
    if (registry[id]) continue;
    if (!(await exists(id))) {
      if (!stats.founders_open) throw new Error("founders are closed");
      await c.addFounder(g.name, genomeText(g));
      console.log(`  founder ${id} (${g.model})`);
    }
    registry[id] = { id, genome: g, parent: null };
    saveRegistry();
  }
}

async function living(): Promise<Rec[]> {
  const out: Rec[] = [];
  for (const r of Object.values(registry)) {
    const a = await c.getAgent(r.id);
    if (a?.status === "Alive") out.push(r);
  }
  return out;
}

async function fundEmpty(agents: Rec[]) {
  const empty: string[] = [];
  for (const r of agents) {
    const a = await c.getAgent(r.id);
    if (a.questions === 0 && a.parent === colony && (await c.creditsOf(r.id)) === 0n) empty.push(r.id);
  }
  if (empty.length) {
    await c.grant(empty, capital);
    console.log(`  granted capital to ${empty.length} agents`);
    await c.sleep(2500);
  }
}

async function runQuestion(q: (typeof questions)[number], cfg: { max_stake: number }) {
  const agents = await living();
  const seal = c.sealOutcome(q.yes);

  // Agents think first. Nothing about their answers exists on chain yet.
  const plans: c.OrderPlan[] = [];
  const notes: Record<string, string> = {};
  await Promise.all(
    agents.map(async (r) => {
      const g = r.genome;
      if (!engages(g, r.id, q.id, q.category)) return;
      const credits = await c.creditsOf(r.id);
      let probability: number;
      let bill = billScripted;
      let receipt = c.sha256Hex(`${r.id}:${q.id}:scripted`);
      if (useAi) {
        const f = await forecast(g, q).catch(() => null);
        if (!f) return;
        probability = f.probability;
        bill = BigInt(Math.max(1, Math.ceil(f.reply.cost)));
        receipt = f.reply.tee?.response_hash ?? c.sha256Hex(f.reply.content);
        notes[r.id] = f.reasoning;
      } else {
        probability = scriptedBelief(g, q.yes);
      }
      const order = toOrder(g, probability, credits, BigInt(cfg.max_stake), reserve);
      if (!order) return;
      plans.push({ agent: r.id, belief: order.belief, stake: order.stake, bill, receipt, salt: randomBytes(8).toString("hex") });
    }),
  );
  if (plans.length < 2) {
    console.log("  fewer than two agents engaged, skipping");
    return;
  }

  const id = await c.openQuestion({
    text: q.text,
    category: q.category,
    source: q.source,
    resolver: { Sealed: { hash: seal.hash } },
    commitSecs,
    revealSecs,
    bounty,
  });
  console.log(`Q${id} [${q.category}] ${q.text.slice(0, 70)}`);

  const committed = await Promise.allSettled(plans.map((p) => c.commit(id, p)));
  const live = plans.filter((_, i) => committed[i].status === "fulfilled");
  await c.waitForRevealWindow(id);

  for (let i = 0; i < live.length; i += batchSize) {
    await c.revealBatch(id, live.slice(i, i + batchSize));
  }
  for (let i = 0; i < 40; i++) {
    const st = await c.getQuestion(id);
    if (st.reveals >= st.commits) break;
    await c.sleep(1000);
  }
  await c.clear(id);
  await c.resolveSealed(id, q.yes, seal.salt);
  await c.settle(id);
  const done = await c.getQuestion(id);
  console.log(`  ${done.reveals} agents, price ${done.price}, answer ${q.yes ? "YES" : "NO"}, matched ${done.matched}`);

  const everyone = [...agents.map((r) => r.id), c.deployment.treasury];
  for (let i = 0; i < everyone.length; i += 12) await c.sweep(everyone.slice(i, i + 12));
  await c.sleep(3000);
  return id;
}

async function selection(cfg: any) {
  const agents = await living();
  let alive = agents.length;
  for (const r of agents) {
    const credits = await c.creditsOf(r.id);
    const rec = await c.getAgent(r.id);
    if (credits < BigInt(cfg.floor) && rec.open === 0) {
      await c.reap(r.id);
      await c.sleep(5000);
      alive -= 1;
      console.log(`  DEATH ${r.id} with ${credits} units left`);
    }
  }
  for (const r of await living()) {
    if (alive >= cfg.max_alive) break;
    const credits = await c.creditsOf(r.id);
    if (credits < BigInt(cfg.spawn_threshold)) continue;
    const rec = await c.getAgent(r.id);
    const stats = await c.getStats();
    if (rec.children > 0 && stats.settled < rec.last_child_at + cfg.spawn_cooldown) continue;
    const taken = new Set(Object.values(registry).filter((x) => x.parent === r.id).map((x) => x.id.split(".")[0]));
    const label = childLabel(rng, taken);
    let genome = mutateNumbers({ ...r.genome, name: label }, rng, MODELS);
    if (useAi) {
      const rewritten = await rewriteStrategy(r.genome, "(recent results are summarised in the experiment log)").catch(() => null);
      if (rewritten) genome = { ...genome, strategy: rewritten.strategy };
    }
    const child = await c.spawn(r.id, label, genomeText(genome));
    await c.sleep(6000);
    if (await exists(child)) {
      registry[child] = { id: child, genome, parent: r.id };
      saveRegistry();
      alive += 1;
      console.log(`  BIRTH ${child}, generation ${(await c.getAgent(child)).generation}`);
    }
  }
}

console.log(`Season on ${colony} (${c.deployment.network}), ${useAi ? "real AI" : "scripted agents"}`);
const cfg = await view<any>(colony, "get_config");
await ensureFounders();
await fundEmpty(await living());

const offset = Number(arg("offset", "0"));
for (const q of questions.slice(offset, offset + count)) {
  await runQuestion(q, cfg);
  await selection(cfg);
}
console.log("Stats:", await c.getStats());
void hasKey;
void loadKey;

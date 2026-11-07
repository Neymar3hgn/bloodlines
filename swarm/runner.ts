/**
 * What a colony does on a live network: agents think, seal, reveal, get paid,
 * reproduce and die. `season.ts` runs this on past questions and `live.ts` runs it
 * on open ones.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { actions } from "near-api-js";
import { poolPledge } from "../engine/market.ts";
import { account, exists, inPool, nearBalance, view } from "./chain.ts";
import * as c from "./colony.ts";
import { childLabel, engages, gaussian, joins, mutateNumbers, toOrder, type Genome, type Rng } from "./genome.ts";
import { founders, MODELS } from "./founders.ts";
import { AccountProblem, BRIEFING_MODEL, forecast, rewriteStrategy, writeBriefing, type QuestionText } from "./llm.ts";

const { colony } = c.deployment;
const billScriptedUnits = 3_000n;
const reserve = 40_000n;
export const CAPITAL = 1_000_000n;
export const BOUNTY = 80_000n;
/** R26: a briefing's fixed price before bills are scaled: a ceiling on what it costs to write. */
const BRIEFING_UNITS = 10_000n;
const MIN_BUYERS = 4;

export interface Settings {
  /** Real forecasts through NEAR AI Cloud, or scripted stand-ins. */
  ai: boolean;
  batchSize: number;
  /** Capital is play money on testnet, so bills are scaled to a small real budget (R19). */
  billScale: number;
}

export const defaults = (ai: boolean): Settings => ({ ai, batchSize: 8, billScale: c.deployment.network === "mainnet" ? 1 : 8 });

export interface Rec {
  id: string;
  genome: Genome;
  parent: string | null;
}

export type Living = Rec & { chain: any };

const file = (name: string) => `data/${name}.${c.deployment.network}.${colony}.json`;
const load = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

export const registry: Record<string, Rec> = load(file("genomes"), {});
const saveRegistry = () => writeFileSync(file("genomes"), JSON.stringify(registry, null, 1));

/** Each agent's reasoning and signed receipt, by question. Lets anyone check a receipt on chain. */
export const notes: Record<string, Record<string, any>> = load(file("notes"), {});
const saveNotes = () => writeFileSync(file("notes"), JSON.stringify(notes));

/** R28: each briefing bought, by question. Published after its round, so anyone can check its hash. */
export const briefings: Record<string, any> = load(file("briefings"), {});
const saveBriefings = () => writeFileSync(file("briefings"), JSON.stringify(briefings));

/** Each agent's record, used when a parent rewrites its strategy. */
const journal: Record<string, { text: string; belief: number; yes: boolean }[]> = load(file("journal"), {});
const saveJournal = () => writeFileSync(file("journal"), JSON.stringify(journal));

let seed = 1_337;
const rng: Rng = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export async function ensureFounders(count = 16) {
  const stats = await c.getStats();
  for (const g of founders().slice(0, count)) {
    const id = `${g.name}.${colony}`;
    if (registry[id]) continue;
    if (!(await exists(id))) {
      if (!stats.founders_open) throw new Error("founders are closed");
      await c.addFounder(g.name, JSON.stringify(g));
      console.log(`  founder ${id} (${g.model})`);
    }
    registry[id] = { id, genome: g, parent: null };
    saveRegistry();
  }
}

/** One read for the whole colony, instead of one per agent. */
export async function living(): Promise<Living[]> {
  const out: Living[] = [];
  for (const [id, a] of await c.getAgents()) {
    if (a.status === "Alive" && registry[id]) out.push({ ...registry[id], chain: a });
  }
  return out;
}

export async function balances(ids: string[]) {
  const values = await inPool(ids, 3, (id) => c.creditsOf(id));
  return new Map(ids.map((id, i) => [id, values[i]]));
}

/** Gives capital to founders that have none. */
export async function fundFounders() {
  const agents = await living();
  const held = await balances(agents.map((r) => r.id));
  const empty = agents.filter((r) => r.chain.parent === colony && r.chain.questions === 0 && held.get(r.id) === 0n).map((r) => r.id);
  if (empty.length) {
    for (let i = 0; i < empty.length; i += 8) await c.grant(empty.slice(i, i + 8), CAPITAL);
    console.log(`  granted capital to ${empty.length} agents`);
    await c.sleep(2500);
  }
}

/**
 * Agents hold very little NEAR, and each commit burns a tiny amount. The keeper tops
 * up any agent running low, so an agent never goes quiet just because it ran out of gas.
 */
export async function refuel(minNear = 0.016, topUp = 0.02) {
  const agents = await living();
  const held = await inPool(agents, 3, (r) => nearBalance(r.id));
  const low = agents.filter((_, i) => held[i] < minNear);
  for (const r of low) {
    await account(c.deployment.keeper).signAndSendTransaction({
      receiverId: r.id,
      actions: [actions.transfer(BigInt(Math.round(topUp * 1e6)) * 10n ** 18n)],
      waitUntil: "EXECUTED_OPTIMISTIC",
    } as never);
  }
  if (low.length) console.log(`  refuelled ${low.length} agents`);
}

export interface Thought {
  probability: number;
  bill: bigint;
  receipt: string;
  note: object;
}

/**
 * A scripted stand-in for a model. `hint` is the truth in a replay, and absent for
 * live questions. A scripted briefing halves the agent's noise.
 */
function scriptedThought(g: Genome, agent: string, q: QuestionText, hint: boolean | undefined, briefed: boolean): Thought {
  const skill = 0.4 + (g.temperature < 0.35 ? 0.5 : 0);
  const reading = (hint === undefined ? 0 : (hint ? 1 : -1) * skill) + (briefed ? 0.45 : 0.9) * gaussian(rng);
  return {
    probability: 1 / (1 + Math.exp(-reading)),
    bill: billScriptedUnits,
    receipt: c.sha256Hex(`${agent}:${q.id}:scripted`),
    note: { scripted: true },
  };
}

async function think(r: Living, q: QuestionText, hint: boolean | undefined, s: Settings, briefing?: string): Promise<Thought | null> {
  if (!s.ai) return scriptedThought(r.genome, r.id, q, hint, briefing !== undefined);
  const f = await forecast(r.genome, q, briefing).catch((e) => {
    if (e instanceof AccountProblem) throw e;
    console.log(`  ${r.id} could not forecast: ${String(e.message).slice(0, 90)}`);
    return null;
  });
  if (!f) return null;
  return {
    probability: f.probability,
    bill: BigInt(Math.max(1, Math.ceil(f.reply.cost * s.billScale))),
    receipt: f.reply.tee?.response_hash ?? c.sha256Hex(f.reply.rawResponse),
    note: { reasoning: f.reasoning, model: f.reply.model, cost: f.reply.cost, tee: f.reply.tee, request: f.reply.rawRequest, response: f.reply.rawResponse },
  };
}

export interface RoundInput extends QuestionText {
  source?: string;
  /** Sealed questions pass the answer, and scripted agents use it as their signal. */
  yes?: boolean;
}

export interface RoundTiming {
  commitSecs: number;
  revealSecs: number;
  waitSecs?: number;
  /** R26: seconds agents have to join a research pool. Leave it out for a round with none. */
  poolSecs?: number;
}

/**
 * Joins land through a public RPC too, so this reads who has really joined and
 * resends the rest. A second join is refused and refunded, so resending is safe.
 */
async function joinEveryone(id: number, agents: string[], pledge: bigint, endMs: number, s: Settings) {
  for (let pass = 0; pass < 4; pass++) {
    const done = new Set<string>((await c.getPool(id)).buyers);
    const todo = agents.filter((a) => !done.has(a));
    if (todo.length === 0 || Date.now() > endMs - 3000) return;
    for (let i = 0; i < todo.length; i += s.batchSize) {
      await c.joinBatch(id, todo.slice(i, i + s.batchSize), pledge).catch((e) => console.log(`  a join batch failed: ${String(e.message).slice(0, 100)}`));
    }
    await c.sleep(2500);
  }
}

async function briefingFor(q: RoundInput, s: Settings) {
  if (!s.ai) return { text: `A scripted briefing, written for testing. ${q.yes === undefined ? "It has no signal." : `It leans ${q.yes ? "YES" : "NO"}.`}`, model: "scripted", cost: 0, tee: null, request: null, response: null };
  const { text, reply } = await writeBriefing(q);
  return { text, model: BRIEFING_MODEL, cost: reply.cost, tee: reply.tee, request: reply.rawRequest, response: reply.rawResponse };
}

/**
 * R26-R28: agents pool money for one briefing, which only the buyers read during
 * the round. Returns the text and who bought it, or null if nothing was bought.
 */
async function buyBriefing(id: number, q: RoundInput, agents: Living[], held: Map<string, bigint>, s: Settings) {
  const pool = await c.getPool(id);
  const pledge = BigInt(pool.pledge);
  const wanted = agents.filter((r) => joins(r.genome, r.id, q.id) && (held.get(r.id) ?? 0n) >= pledge + reserve).map((r) => r.id);
  await joinEveryone(id, wanted, pledge, pool.end_ms, s);
  const wait = pool.end_ms - Date.now() + 1800;
  if (wait > 0) await c.sleep(wait);
  await c.closePool(id);
  const closed = await c.poolAfter(id, "Open");
  // A refund waits in the colony until it is swept, so count every pledge as spent.
  for (const buyer of closed.buyers) held.set(buyer, (held.get(buyer) ?? 0n) - pledge);
  if (closed.status !== "Closed") {
    console.log(`  only ${closed.buyers.length} agents wanted the briefing, so all were refunded`);
    return null;
  }
  const written = await briefingFor(q, s).catch((e) => {
    if (e instanceof AccountProblem) throw e;
    console.log(`  the briefing could not be written: ${String(e.message).slice(0, 90)}`);
    return null;
  });
  if (!written) return null;
  const hash = c.sha256Hex(written.text);
  await c.postBriefing(id, hash).catch((e) => console.log(`  the briefing hash did not land: ${String(e.message).slice(0, 90)}`));
  const bought = await c.poolAfter(id, "Closed");
  if (bought.status !== "Bought") return null;
  briefings[id] = { ...written, hash };
  saveBriefings();
  console.log(`  ${closed.buyers.length} agents bought a briefing, ${closed.share} units each instead of ${closed.price}`);
  return { text: written.text, buyers: new Set<string>(closed.buyers) };
}

/** R28: whatever a pool still holds goes back, and refunds reach the buyers' own balances. */
async function finishPool(id: number) {
  const pool = await c.getPool(id);
  if (!pool) return;
  if (pool.status === "Open" || pool.status === "Closed") await c.refundPool(id);
  for (let i = 0; i < pool.buyers.length; i += 12) await c.sweep(pool.buyers.slice(i, i + 12));
}

/** Agents think, seal and reveal, and the round clears. Returns the question id. */
export async function playRound(q: RoundInput, cfg: { max_stake: number }, timing: RoundTiming, s: Settings): Promise<number | null> {
  const agents = await living();
  const held = await balances(agents.map((r) => r.id));
  const sealed = q.yes === undefined ? null : c.sealOutcome(q.yes);
  if (sealed) c.rememberSeal(sealed.hash, sealed.yes, sealed.salt);
  const open = (pool?: c.PoolInput) =>
    c.openQuestion({
      text: q.text,
      category: q.category,
      source: q.source ?? null,
      resolver: sealed ? { Sealed: { hash: sealed.hash } } : "Public",
      // Buyers can only think once the briefing exists, so they think inside the window.
      commitSecs: timing.commitSecs + (pool ? (s.ai ? 300 : 30) : 0),
      revealSecs: timing.revealSecs,
      waitSecs: timing.waitSecs,
      bounty: BOUNTY,
      pool,
    });

  let id: number | null = null;
  let briefing: Awaited<ReturnType<typeof buyBriefing>> = null;
  if (timing.poolSecs) {
    const price = BRIEFING_UNITS * BigInt(s.billScale);
    id = await open({ price, minBuyers: MIN_BUYERS, secs: timing.poolSecs });
    console.log(`Q${id} [${q.category}] ${q.text.slice(0, 72)}, with a research pool`);
    briefing = await buyBriefing(id, q, agents, held, s);
  }

  // With no pool, agents think first, so nothing about their answers exists on chain yet.
  const plans: c.OrderPlan[] = [];
  const thoughts: Record<string, object> = {};
  await inPool(agents, 6, async (r) => {
    if (!engages(r.genome, r.id, q.id, q.category)) return;
    const briefed = briefing?.buyers.has(r.id) ?? false;
    const t = await think(r, q, q.yes, s, briefed ? briefing!.text : undefined);
    if (!t) return;
    const credits = (held.get(r.id) ?? 0n) - t.bill;
    const order = toOrder(r.genome, t.probability, credits, BigInt(cfg.max_stake), reserve);
    if (!order) return;
    plans.push({ agent: r.id, belief: order.belief, stake: order.stake, bill: t.bill, receipt: t.receipt, salt: randomBytes(8).toString("hex") });
    thoughts[r.id] = { probability: t.probability, briefed, ...t.note };
  });
  if (id === null) {
    if (plans.length < 2) {
      console.log("  fewer than two agents engaged, skipping");
      return null;
    }
    id = await open();
    console.log(`Q${id} [${q.category}] ${q.text.slice(0, 72)}`);
  }
  notes[id] = thoughts;
  saveNotes();

  const committed = await inPool(plans, 4, (p) =>
    c.commit(id, p).then(
      () => true,
      (e) => {
        console.log(`  ${p.agent} could not commit: ${String(e.message).slice(0, 110)}`);
        return false;
      },
    ),
  );
  const live = plans.filter((_, i) => committed[i]);
  if (live.length < plans.length) console.log(`  only ${live.length} of ${plans.length} commits landed`);
  await c.waitForRevealWindow(id);

  await revealEveryone(id, live, s);
  const before = await c.getQuestion(id);
  if (before.reveals < before.commits) {
    const wait = before.reveal_end_ms - Date.now() + 1500;
    if (wait > 0) await c.sleep(wait);
  }
  await c.clear(id);
  // Public RPCs can lag by a block, so wait to read the cleared state.
  let done = await c.getQuestion(id);
  for (let i = 0; i < 10 && done.status === "Open"; i++) {
    await c.sleep(800);
    done = await c.getQuestion(id);
  }
  await finishPool(id);
  if (done.status === "Void") {
    console.log("  nobody revealed, so the round is void and the bounty goes back");
    await c.sweep([done.opener]);
    return null;
  }
  console.log(`  ${done.reveals} agents, the swarm says ${done.price}%, matched ${done.matched}`);
  return id;
}

/**
 * Reveals land through a public RPC, which can fail or hang. So this reads who has
 * really revealed and resends only the rest until the window closes. Resending is
 * safe: an agent that already revealed has no commit left, so the contract refuses
 * the copy and the Intents contract refunds it.
 */
async function revealEveryone(id: number, plans: c.OrderPlan[], s: Settings) {
  for (let pass = 0; pass < 6; pass++) {
    const q = await c.getQuestion(id);
    const done = new Set((await c.getOrders(id)).map((o) => o.agent));
    const todo = plans.filter((p) => !done.has(p.agent));
    if (todo.length === 0) return;
    if (Date.now() > q.reveal_end_ms - 4000) {
      console.log(`  the reveal window closed with ${todo.length} agents unrevealed`);
      return;
    }
    if (pass > 0) console.log(`  resending ${todo.length} reveals`);
    for (let i = 0; i < todo.length; i += s.batchSize) {
      await c.revealBatch(id, todo.slice(i, i + s.batchSize)).catch((e) => console.log(`  a reveal batch failed: ${String(e.message).slice(0, 100)}`));
    }
    await c.sleep(3000);
  }
}

/** Records what happened, for the next time a parent rewrites its strategy. */
async function writeJournal(id: number, text: string, yes: boolean) {
  for (const o of await c.getOrders(id)) {
    (journal[o.agent] ??= []).push({ text, belief: o.belief, yes });
    journal[o.agent] = journal[o.agent].slice(-12);
  }
  saveJournal();
}

/** Pays out a resolved question and returns the money to the agents' own balances. */
export async function finishRound(id: number, text: string, yes: boolean | null) {
  await c.settle(id);
  const orders = await c.getOrders(id);
  if (yes !== null) await writeJournal(id, text, yes);
  const opener = (await c.getQuestion(id)).opener;
  const everyone = [...new Set([...orders.map((o) => o.agent), c.deployment.treasury, opener])];
  for (let i = 0; i < everyone.length; i += 12) await c.sweep(everyone.slice(i, i + 12));
  await c.sleep(3000);
}

/** R12 and R13: the broke die, the rich reproduce. */
export async function selection(cfg: any, s: Settings) {
  const agents = await living();
  const held = await balances(agents.map((r) => r.id));
  let alive = agents.length;
  for (const r of agents) {
    const credits = held.get(r.id) ?? 0n;
    if (r.chain.open === 0 && (credits < BigInt(cfg.floor) || r.chain.strikes >= 3)) {
      await c.reap(r.id);
      await c.sleep(5000);
      alive -= 1;
      console.log(`  DEATH ${r.id} with ${credits} units left`);
    }
  }
  const stats = await c.getStats();
  for (const r of await living()) {
    if (alive >= cfg.max_alive) break;
    const credits = held.get(r.id) ?? 0n;
    if (credits < BigInt(cfg.spawn_threshold) || r.chain.strikes > 0) continue;
    if (r.chain.children > 0 && stats.settled < r.chain.last_child_at + cfg.spawn_cooldown) continue;
    const taken = new Set(Object.values(registry).filter((x) => x.parent === r.id).map((x) => x.id.split(".")[0]));
    const label = childLabel(rng, taken);
    if (`${label}.${r.id}`.length > 64) continue;
    let genome = mutateNumbers({ ...r.genome, name: label }, rng, MODELS);
    if (s.ai) {
      const record = (journal[r.id] ?? []).map((x) => `${x.belief}% on "${x.text.slice(0, 70)}": ${x.yes ? "YES" : "NO"}`).join("\n");
      const rewritten = await rewriteStrategy(r.genome, record).catch((e) => {
        if (e instanceof AccountProblem) throw e;
        return null;
      });
      if (rewritten) genome = { ...genome, strategy: rewritten.strategy };
    } else {
      genome = { ...genome, strategy: `${r.genome.strategy.replace(/ \(variant.*$/, "")} (variant ${label})` };
    }
    const child = await c.spawn(r.id, label, JSON.stringify(genome));
    await c.sleep(6000);
    if (await exists(child)) {
      registry[child] = { id: child, genome, parent: r.id };
      saveRegistry();
      alive += 1;
      console.log(`  BIRTH ${child}, generation ${(await c.getAgent(child)).generation}`);
    } else {
      console.log(`  birth refused for ${r.id}`);
    }
  }
}

export const colonyConfig = () => view<any>(colony, "get_config");

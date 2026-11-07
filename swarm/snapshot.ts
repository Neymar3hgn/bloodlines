/**
 * Writes web/public/data/snapshot.json from the chain. The site can run from this
 * file alone, and it re-reads the chain directly when it can. Nothing here is
 * computed that a reader could not recompute from the contract's public views.
 *
 *   node swarm/snapshot.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inPool, provider, view } from "./chain.ts";
import * as c from "./colony.ts";

const { colony, verifier, token_id: tokenId, treasury, keeper, network } = c.deployment;
const out = process.argv[2] ?? "web/public/data/snapshot.json";

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

const registry = read<Record<string, any>>(`data/genomes.${network}.${colony}.json`, {});

async function allAgents() {
  const rows: [string, any][] = [];
  for (let from = 0; ; from += 100) {
    const page = await c.getAgents(from, 100);
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

async function allQuestions() {
  const rows: any[] = [];
  for (let from = 0; ; from += 50) {
    const page = await c.getQuestions(from, 50);
    rows.push(...page);
    if (page.length < 50) break;
  }
  return rows;
}

const [config, stats, agents, questions] = await Promise.all([view<any>(colony, "get_config"), c.getStats(), allAgents(), allQuestions()]);

const credits = await inPool(agents, 3, ([id, a]) => (a.status === "Dead" ? Promise.resolve(0n) : c.creditsOf(id)));
const reputations = await inPool(agents, 3, ([id]) => c.getReputation(id));
const orders = await inPool(questions, 3, (q) => (q.reveals > 0 ? c.getOrders(q.id) : Promise.resolve([])));

const snapshot = {
  generated: new Date().toISOString(),
  network,
  colony,
  keeper,
  verifier,
  token_id: tokenId,
  treasury,
  treasury_credits: (await c.creditsOf(treasury)).toString(),
  config,
  stats,
  agents: agents.map(([id, a], i) => ({
    id,
    ...a,
    credits: credits[i].toString(),
    reputation: reputations[i],
    genome: registry[id]?.genome ?? null,
    label: id.split(".")[0],
  })),
  questions: questions.map((q, i) => ({ ...q, orders: orders[i] })),
  e2e: read("data/e2e-report.json", null),
  sim: read("data/sim-report.json", null),
  experiment: read("data/experiment.json", null),
};

mkdirSync(out.split("/").slice(0, -1).join("/"), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));
console.log(`Wrote ${out}: ${snapshot.agents.length} agents, ${snapshot.questions.length} questions`);
void provider;

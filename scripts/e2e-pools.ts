/**
 * Runs only the research pool and sealed sale checks on the public colony. A full
 * `npm run e2e` needs a test colony of its own, about 4.5 NEAR for a while. These checks
 * need no new agents, spend almost nothing, and show on the site as contract tests.
 *
 *   node scripts/e2e-pools.ts            both sets
 *   node scripts/e2e-pools.ts --sales    the sealed sale checks alone
 *   node scripts/e2e-pools.ts --pools    the research pool checks alone
 *
 * Prints PASS or FAIL per rule, and writes data/e2e-sales-report.json and
 * data/e2e-pools-report.json for the sets it ran.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inPool } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
import { MODELS } from "../swarm/founders.ts";
import { auctionChecks } from "./auction-checks.ts";
import { poolChecks } from "./pool-checks.ts";

const { colony, keeper, verifier, network } = c.deployment;
const results: { rule: string; claim: string; ok: boolean; detail?: string }[] = [];
const check = (rule: string, claim: string, ok: boolean, detail = "") => {
  results.push({ rule, claim, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${rule.padEnd(5)} ${claim}${detail ? `  (${detail})` : ""}`);
};

console.log(`Testing research pools on ${colony}, ${network}, verifier ${verifier}\n`);

// The richest agents take part, so a test can never push one toward the floor.
const alive = (await c.getAgents()).filter(([, a]) => a.status === "Alive").map(([id]) => id);
const credits = await inPool(alive, 3, (id) => c.creditsOf(id));
const ranked = alive.map((id, i) => ({ id, held: credits[i] })).sort((x, y) => (x.held > y.held ? -1 : 1)).map((r) => r.id);
const [a, b, d, late] = ranked;

// These checks hand out strikes, and only a later forecast clears one. So sellers are agents
// with no strike yet, whose model can forecast, or a run of tests could get one reaped.
const genomes = JSON.parse(readFileSync(`data/genomes.${network}.${colony}.json`, "utf8"));
const struck = new Map((await c.getAgents()).map(([id, r]) => [id, r.strikes]));
const sellers = ranked.filter((id) => id !== a && id !== b && struck.get(id) === 0 && MODELS.includes(genomes[id]?.genome.model)).slice(0, 5);
if (sellers.length < 5) throw new Error(`only ${sellers.length} agents can safely play the sellers`);
const tag = Date.now().toString(36).slice(-4);
const runSales = !process.argv.includes("--pools");
const runPools = !process.argv.includes("--sales");

// A run that crashed leaves rounds open, and this hands their money back first.
await c.finishOpenWork();

// R28: the text is published, so `npm run verify` can check it against its hash.
const file = `data/briefings.${network}.${colony}.json`;
const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const publish = (q: number, text: string, hash: string, writer: string | null) => {
  saved[q] = { text, hash, model: "scripted", cost: 0, tee: null, request: null, response: null, writer };
  writeFileSync(file, JSON.stringify(saved));
};

const questions: number[] = [];
if (runSales) {
  const sales = await auctionChecks({ check, tag, a, b, sellers });
  questions.push(...sales.questions);
  publish(sales.bought.q, sales.bought.text, sales.bought.hash, sales.bought.writer);
  for (let i = 0; i < sales.touched.length; i += 12) await c.sweep(sales.touched.slice(i, i + 12));
  await c.sleep(3000);
}

if (runPools) {
  const pools = await poolChecks({ check, tag, a, b, d, late });
  questions.push(...pools.questions);
  publish(pools.bought.q, pools.bought.text, pools.bought.hash, null);
}

// Nobody bid on these rounds, so clearing voids them and the bounties go back.
for (const q of questions) {
  const wait = (await c.getQuestion(q)).reveal_end_ms - Date.now() + 1800;
  if (wait > 0) await c.sleep(wait);
  await c.clear(q);
}
await c.sleep(2500);
await c.sweep([keeper]);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed`);
const report = (path: string, rows: typeof results) =>
  writeFileSync(path, JSON.stringify({ colony, verifier, network, at: new Date().toISOString(), passed: rows.filter((r) => r.ok).length, total: rows.length, results: rows }, null, 1));
const isSale = (r: { rule: string }) => ["R30", "R31", "R32", "R33"].includes(r.rule);
if (runSales) report("data/e2e-sales-report.json", results.filter(isSale));
if (runPools) report("data/e2e-pools-report.json", results.filter((r) => !isSale(r)));
if (passed !== results.length) process.exit(1);

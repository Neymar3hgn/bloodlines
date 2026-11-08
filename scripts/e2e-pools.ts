/**
 * Runs only the research pool checks on the public colony. A full `npm run e2e` needs
 * a test colony of its own, about 4.5 NEAR for a while. These checks need no new agents,
 * spend almost nothing, and show on the site as contract tests.
 *
 *   node scripts/e2e-pools.ts
 *
 * Prints PASS or FAIL per rule and writes data/e2e-pools-report.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inPool } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
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
const [a, b, d, late] = alive.map((id, i) => ({ id, held: credits[i] })).sort((x, y) => (x.held > y.held ? -1 : 1)).map((r) => r.id);

const { questions, bought } = await poolChecks({ check, tag: Date.now().toString(36).slice(-4), a, b, d, late });

// R28: the text is published, so `npm run verify` can check it against its hash.
const file = `data/briefings.${network}.${colony}.json`;
const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
saved[bought.q] = { text: bought.text, hash: bought.hash, model: "scripted", cost: 0, tee: null, request: null, response: null };
writeFileSync(file, JSON.stringify(saved));

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
writeFileSync("data/e2e-pools-report.json", JSON.stringify({ colony, verifier, network, at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
if (passed !== results.length) process.exit(1);

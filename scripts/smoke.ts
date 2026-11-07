/** One full round on a live network, printing what happened at each step. */
import { randomBytes } from "node:crypto";
import { clear as clearLocal, settle as settleLocal } from "../engine/market.ts";
import * as c from "../swarm/colony.ts";

const tag = Date.now().toString(36).slice(-3);
const labels = ["ada", "bo", "cy", "di"].map((x) => `${x}${tag}`);
const beliefs = [22, 41, 68, 83];
const stakes = [20n, 30n, 25n, 15n];

console.log("1. Founders");
const agents: string[] = [];
for (const [i, label] of labels.entries()) {
  agents.push(await c.addFounder(label, JSON.stringify({ model: "scripted", n: i })));
  console.log(`   ${agents[i]}`);
}

console.log("2. Grant 1 credit each in one batch");
await c.grant(agents, 1_000_000n);
await c.sleep(2500);
console.log("   balances", (await Promise.all(agents.map(c.creditsOf))).map(String).join(" "));

console.log("3. Open a sealed question");
const seal = c.sealOutcome(true);
const q = await c.openQuestion({
  text: `Smoke test ${tag}: will this round settle?`,
  category: "test",
  resolver: { Sealed: { hash: seal.hash } },
  commitSecs: 12,
  revealSecs: 40,
  bounty: 80_000n,
});
console.log(`   question ${q}`);

const plans = agents.map((agent, i) => ({
  agent,
  belief: beliefs[i],
  stake: stakes[i],
  bill: 2_000n,
  receipt: c.sha256Hex(`demo-${i}`),
  salt: randomBytes(8).toString("hex"),
}));

console.log("4. Commit, each agent signing its own transaction");
await Promise.all(plans.map((p) => c.commit(q, p)));
console.log("   commits on chain:", (await c.getQuestion(q)).commits);

console.log("5. Reveal, every agent's signed intent in one transaction");
await c.waitForRevealWindow(q);
const tx: any = await c.revealBatch(q, plans);
await c.sleep(3000);
const afterReveal = await c.getQuestion(q);
console.log(`   reveals on chain: ${afterReveal.reveals}, locked ${afterReveal.locked}, billed ${afterReveal.billed}`);

console.log("6. Clear");
await c.clear(q);
const cleared = await c.getQuestion(q);
const local = clearLocal(plans.map((p) => ({ agent: p.agent, belief: p.belief, stake: p.stake })));
console.log(`   chain price ${cleared.price}, local price ${local.price}, matched ${cleared.matched} vs ${local.matched}`);
if (cleared.price !== local.price || BigInt(cleared.matched) !== local.matched) throw new Error("chain and local clearing disagree");

console.log("7. Open the sealed answer and settle");
await c.resolveSealed(q, seal.yes, seal.salt);
await c.settle(q);
const done = await c.getQuestion(q);
const orders = await c.getOrders(q);
console.log(`   status ${done.status}, paid ${done.paid}, rewarded ${done.rewarded}`);
for (const o of orders) console.log(`   ${o.agent}: belief ${o.belief} side ${["none", "yes", "no"][o.side]} filled ${o.filled} cost ${o.cost} payout ${o.payout} reward ${o.reward}`);

const pool = 80_000n - (80_000n * 500n) / 10_000n;
const s = settleLocal(local, seal.yes, pool);
for (const o of orders) {
  const row = s.rows.find((x) => x.agent === o.agent)!;
  if (row.payout !== BigInt(o.payout) || row.reward !== BigInt(o.reward)) throw new Error(`payout mismatch for ${o.agent}`);
}
console.log("   every payout matches the local engine");

console.log("8. Sweep money back to the agents' own Intents balances");
await c.sweep([...agents, c.deployment.treasury]);
await c.sleep(4000);
const end = await Promise.all(agents.map(c.creditsOf));
console.log("   balances", end.map(String).join(" "));
const left = await Promise.all(agents.map(c.getClaimable));
console.log("   still owed", left.join(" "));
console.log("   treasury", await c.creditsOf(c.deployment.treasury));

const sum = end.reduce((a, b) => a + b, 0n);
const treasury = await c.creditsOf(c.deployment.treasury);
console.log(`\nConservation: agents ${sum} + treasury ${treasury} = ${sum + treasury}; expected ${4_000_000n + 80_000n} plus any earlier treasury`);
console.log("reputation", await Promise.all(agents.map(c.getReputation)));
console.log("tx", tx?.transaction_outcome?.id ?? tx?.transaction?.hash ?? "(see explorer)");

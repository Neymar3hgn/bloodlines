/**
 * The rules, tested on a live network. Each line is one claim from RULES.md, and
 * each failure case is a real rejected transaction.
 *   CLADE_NETWORK=testnet node scripts/e2e.ts
 * Prints PASS or FAIL per rule and writes data/e2e-report.json.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { account, exists, loadKey, provider, view } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
import { currentSalt, executeIntents, signIntents, transferIntent } from "../swarm/intents.ts";

const { colony, keeper, verifier, token_id: tokenId, treasury } = c.deployment;
const results: { rule: string; claim: string; ok: boolean; detail?: string }[] = [];
const tag = Date.now().toString(36).slice(-4);

function check(rule: string, claim: string, ok: boolean, detail = "") {
  results.push({ rule, claim, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${rule.padEnd(5)} ${claim}${detail ? `  (${detail})` : ""}`);
}

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return String((e as Error).message ?? e).slice(0, 160);
  }
}

const plan = (agent: string, belief: number, stake: bigint, bill = 2_000n) => ({
  agent,
  belief,
  stake,
  bill,
  receipt: c.sha256Hex(agent),
  salt: randomBytes(8).toString("hex"),
});

/** Moves an agent's credits out, so tests can make it broke. */
async function drainTo(agent: string, leave: bigint) {
  const balance = await c.creditsOf(agent);
  const salt = await currentSalt(verifier);
  const payload = signIntents(agent, verifier, salt, [transferIntent(keeper, tokenId, balance - leave)]);
  await executeIntents(keeper, verifier, [payload]);
  await c.sleep(2000);
}

const genome = (n: string) => JSON.stringify({ name: n, prompt: "test genome" });

console.log(`Testing ${colony} on ${c.deployment.network}, verifier ${verifier}\n`);

// ---------- Agents ----------
const [a, b, d, e] = await (async () => {
  const out: string[] = [];
  for (const label of ["ea", "eb", "ed", "ee"]) out.push(await c.addFounder(`${label}${tag}`, genome(label)));
  return out;
})();
await c.grant([a, b, d, e], 1_000_000n);
await c.sleep(2500);

check("R1", "every agent is a real account named under its parent", (await exists(a)) && a.endsWith(`.${colony}`), a);

const keys = (await provider.viewAccessKeyList({ accountId: a } as never)) as { keys: any[] };
const onlyKey = keys.keys.length === 1 ? keys.keys[0] : null;
const perm = onlyKey?.access_key?.permission ?? onlyKey?.accessKey?.permission;
const fc = perm?.FunctionCall ?? perm?.functionCall ?? perm;
const receiver = fc?.receiver_id ?? fc?.receiverId;
check("R3", "an agent has one key, and it only reaches the colony", keys.keys.length === 1 && receiver === colony, JSON.stringify(fc?.method_names ?? fc?.methodNames ?? []));

let err = await rejects(() => account(a).callFunction({ contractId: verifier, methodName: "mt_balance_of", args: { account_id: a, token_id: tokenId } } as never));
check("R3", "an agent's key cannot call any other contract", !!err, err ?? "");

err = await rejects(() => account(a).callFunction({ contractId: colony, methodName: "add_founder", args: { label: "x", public_key: loadKey(a).public_key, genome: "x" }, gas: 100_000_000_000_000n } as never));
check("R2", "an agent cannot add a founder", !!err);

check("R4", "an agent's capital sits in its own Intents balance", (await c.creditsOf(a)) === 1_000_000n);

// ---------- A round, with attacks ----------
const seal = c.sealOutcome(true);
const q = await c.openQuestion({
  text: `Rule test ${tag}`,
  category: "test",
  resolver: { Sealed: { hash: seal.hash } },
  commitSecs: 18,
  revealSecs: 50,
  bounty: 80_000n,
});
const pa = plan(a, 25, 40n);
const pb = plan(b, 70, 40n);
const pd = plan(d, 60, 10n);

await Promise.all([pa, pb, pd].map((p) => c.commit(q, p)));
err = await rejects(() => c.commit(q, pa));
check("R6", "an agent cannot commit twice", !!err);

let early = await rejects(() => c.revealBatch(q, [pa]));
await c.sleep(2500);
let qs = await c.getQuestion(q);
check("R7", "a reveal before the window opens is refused and refunded", qs.reveals === 0 && (await c.creditsOf(a)) === 1_000_000n, early ?? "refunded");

await c.waitForRevealWindow(q);

const liar = { ...pd, belief: 99 };
await c.revealBatch(q, [liar]);
await c.sleep(2500);
qs = await c.getQuestion(q);
check("R7", "a reveal that does not match its commit is refused and refunded", qs.reveals === 0 && (await c.creditsOf(d)) === 1_000_000n);

const poor = { ...pa, stake: 40n, bill: 10_000_000n };
err = await rejects(() => c.revealBatch(q, [poor, pb]));
await c.sleep(2500);
qs = await c.getQuestion(q);
check("R7", "one unfunded reveal fails the whole batch, for everyone", !!err && qs.reveals === 0, "all or nothing");

await c.revealBatch(q, [pa, pb]);
await c.sleep(2500);
qs = await c.getQuestion(q);
check("R7", "signed reveals land together in one transaction", qs.reveals === 2, `${qs.reveals} reveals`);
check("R19", "bills move to the treasury with the reveal", qs.billed === "4000");

err = await rejects(() => c.clear(q));
check("R9", "the round cannot clear while a commit is unrevealed and time remains", !!err);

const waitMs = qs.reveal_end_ms - Date.now() + 1500;
if (waitMs > 0) await c.sleep(waitMs);
await c.clear(q);
qs = await c.getQuestion(q);
const orders = await c.getOrders(q);
check("R9", "the price is the stake-weighted median", qs.price === 25, `price ${qs.price}`);
const ob = orders.find((o) => o.agent === b);
const oa = orders.find((o) => o.agent === a);
check("R10", "agents above the price hold YES, at one price", ob.side === 1 && ob.cost === String(40 * 25 * 100));
check("R11", "the agent at the median takes the short side", oa.side === 2 && oa.filled === 40);
check("R8", "a commit with no reveal is a strike", (await c.getAgent(d)).strikes === 1);

err = await rejects(() => c.resolveSealed(q, false, seal.salt));
check("R21", "a sealed answer cannot be changed", !!err);
await c.resolveSealed(q, true, seal.salt);
await c.settle(q);
qs = await c.getQuestion(q);
const after = await c.getOrders(q);
const winner = after.find((o) => o.agent === b);
check("R17", "winning shares pay in full, losing shares nothing", winner.payout === String(40 * 10_000) && after.find((o) => o.agent === a).payout === "0");
check("R18", "only the agent closer to the truth earns the reward", BigInt(winner.reward) > 0n && after.find((o) => o.agent === a).reward === "0");
const moneyIn = BigInt(qs.locked) + BigInt(qs.bounty);
const cut = (BigInt(qs.bounty) * 500n) / 10_000n;
const moneyOut = BigInt(qs.refunded) + BigInt(qs.paid) + BigInt(qs.pool) + cut;
check("R20", "money in equals money out for the question", moneyIn === moneyOut, `${moneyIn} = ${moneyOut}`);

await c.sweep([a, b, d, treasury]);
await c.sleep(4000);
check("R17", "swept money reaches the agent's own Intents balance", (await c.getClaimable(b)) === "0" && (await c.creditsOf(b)) > 1_000_000n);

const repB = await c.getReputation(b);
check("R15", "beating the swarm raises reputation, in the public view", repB > 0, `reputation ${repB}`);

// ---------- Birth ----------
err = await rejects(() => c.spawn(a, `no${tag}`, genome("no")));
await c.sleep(4000);
check("R12", "a poor agent cannot have a child", !(await exists(`no${tag}.${a}`)));

await c.grant([b], 3_000_000n);
await c.sleep(2500);
const parentBefore = await c.creditsOf(b);
const child = await c.spawn(b, `ch${tag}`, genome("child"));
await c.sleep(6000);
const childRec = await c.getAgent(child);
check("R1", "a child's account exists, named under its parent", await exists(child), child);
check("R12", "the child receives half its parent's balance", (await c.creditsOf(child)) === parentBefore / 2n, String(await c.creditsOf(child)));
check("R12", "the child is alive and one generation on", childRec?.status === "Alive" && childRec?.generation === 1);
check("R15", "a newborn inherits its parent's reputation", childRec?.prior === repB && (await c.getReputation(child)) === repB, `prior ${childRec?.prior}`);
check("R14", "the lineage view walks back to the founder", (await c.getLineage(child)).includes(b));
const hasVerifierKey = await view<boolean>(verifier, "has_public_key", { account_id: child, public_key: loadKey(child).public_key });
check("R7", "a child can sign intents as soon as it is born", hasVerifierKey);

err = await rejects(() => c.spawn(b, `cd${tag}`, genome("too soon")));
await c.sleep(4000);
check("R12", "the spawn cooldown stops a second child", !(await exists(`cd${tag}.${b}`)));

// ---------- Death ----------
err = await rejects(() => c.reap(e));
await c.sleep(3000);
check("R13", "a solvent agent cannot be reaped", await exists(e));

await drainTo(child, 100_000n);
const parentBeforeDeath = await c.creditsOf(b);
await c.reap(child);
await c.sleep(7000);
check("R13", "a broke agent's account is deleted from the chain", !(await exists(child)), child);
check("R13", "its credits go to its parent", (await c.creditsOf(b)) === parentBeforeDeath + 100_000n);
const dead = await c.getAgent(child);
check("R14", "the colony keeps the dead agent's record", dead?.status === "Dead" && dead?.died_ms > 0);
err = await rejects(() => c.reap(child));
check("R13", "an agent cannot be reaped twice", !!err);

// A child must outlive its parent. NEAR's docs do not say; this settles it.
await c.grant([e], 3_000_000n);
await c.sleep(2500);
const orphan = await c.spawn(e, `or${tag}`, genome("orphan"));
await c.sleep(6000);
await drainTo(e, 50_000n);
const treasuryBefore = await c.creditsOf(treasury);
await c.reap(e);
await c.sleep(7000);
check("R13", "a founder with no living ancestor pays the treasury", (await c.creditsOf(treasury)) === treasuryBefore + 50_000n && !(await exists(e)));
check("R14", "a child keeps running after its parent is deleted", await exists(orphan), orphan);
const orphanSeal = c.sealOutcome(false);
const q2 = await c.openQuestion({ text: `Orphan test ${tag}`, category: "test", resolver: { Sealed: { hash: orphanSeal.hash } }, commitSecs: 10, revealSecs: 30, bounty: 20_000n });
const po = plan(orphan, 40, 5n);
await c.commit(q2, po);
await c.waitForRevealWindow(q2);
await c.revealBatch(q2, [po]);
await c.sleep(2500);
check("R14", "an orphan can still trade under its dead parent's name", (await c.getQuestion(q2)).reveals === 1);
await c.clear(q2);
await c.resolveSealed(q2, orphanSeal.yes, orphanSeal.salt);
await c.settle(q2);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed`);
writeFileSync("data/e2e-report.json", JSON.stringify({ colony, verifier, network: c.deployment.network, at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
if (passed !== results.length) process.exit(1);

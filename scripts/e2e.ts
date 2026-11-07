/**
 * The rules, tested on a live network. Each line is one claim from RULES.md, and
 * each failure case is a real rejected transaction.
 *   CLADE_NETWORK=testnet node scripts/e2e.ts
 * Prints PASS or FAIL per rule and writes data/e2e-report.json.
 */
import "./use-test-colony.ts";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { account, exists, loadKey, provider, view } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
import { currentSalt, executeIntents, signIntents, transferIntent } from "../swarm/intents.ts";

const { colony, keeper, verifier, token_id: tokenId, treasury, asker, token_account: tokenAccount } = c.deployment;
const results: { rule: string; claim: string; ok: boolean; detail?: string }[] = [];
const tag = Date.now().toString(36).slice(-4);

function check(rule: string, claim: string, ok: boolean, detail = "") {
  results.push({ rule, claim, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${rule.padEnd(5)} ${claim}${detail ? `  (${detail})` : ""}`);
}

/** Returns why a call was refused, looking inside a failover error for the real reason. */
async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const inner = (e as { errors?: { message?: string }[] }).errors?.map((x) => x.message).join(" | ");
    return String(inner || (e as Error).message || e).slice(0, 220);
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
check("R3", "an agent's key cannot call any other contract", /does not match|receiver/i.test(err ?? ""), (err ?? "").slice(0, 90));

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
await c.sweep([orphan]);
await c.sleep(2500);

// ---------- The swarm as a public oracle ----------
if (await exists(asker)) {
  const q3 = await c.openQuestion({ text: `Callback test ${tag}`, category: "test", resolver: "Public", commitSecs: 10, revealSecs: 30, bounty: 20_000n, callback: asker });
  const low = plan(a, 30, 5n);
  const high = plan(b, 80, 5n);
  await Promise.all([c.commit(q3, low), c.commit(q3, high)]);
  await c.waitForRevealWindow(q3);
  await c.revealBatch(q3, [low, high]);
  await c.sleep(2500);
  await c.clear(q3);
  await c.sleep(3000);
  const answer = await view<any>(asker, "last_answer");
  const q3row = await c.getQuestion(q3);
  check("R22", "a contract that asked is called back with the answer", answer?.question_id === q3 && answer?.price === q3row.price, JSON.stringify(answer));
  const pub = await view<any>(colony, "get_answer", { q: q3 });
  check("R22", "anyone can read the answer from the contract", pub?.price === q3row.price);
  err = await rejects(() => account(a).callFunction({ contractId: colony, methodName: "resolve_public", args: { q: q3, yes: true, evidence: "x" }, gas: 30_000_000_000_000n } as never));
  check("R21", "only the named resolver can post a public result", !!err);
  await c.resolvePublic(q3, true, "https://example.com/result");
  check("R21", "the public result and its source are on record", (await c.getQuestion(q3)).evidence === "https://example.com/result");
  await c.settle(q3);

  const after_ms = Date.now() + 45_000;
  const q4 = await c.openQuestion({
    text: `On-chain test ${tag}: is the token's total supply at least 1,000 units?`,
    category: "test",
    resolver: { OnChain: { contract: tokenAccount, method: "ft_total_supply", args: "{}", after_ms, at_least: "1000" } },
    commitSecs: 8,
    revealSecs: 25,
    bounty: 20_000n,
  });
  const n1 = plan(a, 35, 4n);
  const n2 = plan(b, 75, 4n);
  await Promise.all([c.commit(q4, n1), c.commit(q4, n2)]);
  await c.waitForRevealWindow(q4);
  await c.revealBatch(q4, [n1, n2]);
  await c.sleep(2500);
  await c.clear(q4);
  err = await rejects(() => c.resolveOnchain(q4));
  check("R21", "an on-chain question cannot resolve before its time", !!err);
  await c.sleep(Math.max(0, after_ms - Date.now()) + 3000);
  await c.resolveOnchain(q4);
  await c.sleep(4000);
  const q4row = await c.getQuestion(q4);
  check("R21", "an on-chain question resolves itself by reading a contract", q4row.yes_won === true, q4row.evidence ?? "");
  await c.settle(q4);

  const salt = await currentSalt(verifier);
  const before = await c.creditsOf(a);
  const sneaky = JSON.stringify({ ask: { text: "x", category: "x", source: null, resolver: { Sealed: { hash: "ab" } }, commit_secs: 5, reveal_secs: 5, callback: null } });
  await executeIntents(keeper, verifier, [signIntents(a, verifier, salt, [transferIntent(colony, tokenId, 20_000n, sneaky, "20000000000000")])]);
  await c.sleep(3000);
  check("R21", "an outsider cannot open a sealed question, and is refunded", (await c.creditsOf(a)) === before);
}

// ---------- Attacks found in review ----------
{
  const askAs = async (who: string, ask: object, amount: bigint) => {
    const s = await currentSalt(verifier);
    await executeIntents(keeper, verifier, [signIntents(who, verifier, s, [transferIntent(colony, tokenId, amount, JSON.stringify({ ask }), "20000000000000")])]);
    await c.sleep(3000);
  };

  // The worst one: a question that names an agent's `die` method. If the colony
  // made this call itself, the agent would obey and the attacker would inherit.
  const victim = b;
  const attacker = a;
  const victimBefore = await c.creditsOf(victim);
  const attackerBefore = await c.creditsOf(attacker);
  const statsBefore = await c.getStats();
  await askAs(
    attacker,
    {
      text: `Attack test ${tag}`,
      category: "test",
      source: null,
      resolver: { OnChain: { contract: victim, method: "die", args: `${attacker}\n${attacker}`, after_ms: 0, at_least: "0" } },
      commit_secs: 8,
      reveal_secs: 25,
      wait_secs: 0,
      callback: null,
    },
    20_000n,
  );
  const qa = statsBefore.questions;
  const p1 = plan(a, 30, 3n);
  const p2 = plan(b, 70, 3n);
  await Promise.all([c.commit(qa, p1), c.commit(qa, p2)]);
  await c.waitForRevealWindow(qa);
  await c.revealBatch(qa, [p1, p2]);
  await c.sleep(2500);
  await c.clear(qa);
  await c.resolveOnchain(qa).catch(() => null);
  await c.sleep(6000);
  const victimAlive = await exists(victim);
  check("R21", "an asker cannot make the colony kill an agent", victimAlive && (await c.getAgent(victim)).status === "Alive", "the reader has no authority");
  check("R21", "an asker cannot steal an agent's money", (await c.creditsOf(attacker)) < attackerBefore + victimBefore / 2n);

  // The rules must say why they refused, so a transaction can be read on an explorer.
  err = await rejects(() => c.reap(victim));
  check("R13", "an agent with an open position cannot be reaped, and the refusal says why", /open positions/.test(err ?? ""), (err ?? "").slice(0, 90));

  await c.voidQuestion(qa, "attack test, no result");
  await c.settle(qa);
  await c.sweep([a, b]);
  await c.sleep(3000);

  // R25: if no result ever comes, the money still comes back.
  const qe = await c.openQuestion({ text: `Expiry test ${tag}`, category: "test", resolver: "Public", commitSecs: 8, revealSecs: 25, waitSecs: 2, bounty: 30_000n });
  const e1 = plan(a, 20, 5n);
  const e2 = plan(b, 80, 5n);
  await Promise.all([c.commit(qe, e1), c.commit(qe, e2)]);
  await c.waitForRevealWindow(qe);
  await c.revealBatch(qe, [e1, e2]);
  await c.sleep(2500);
  await c.clear(qe);
  await c.sweep([a, b]);
  await c.sleep(3500);
  const waiting = await c.getQuestion(qe);
  const left = waiting.expires_ms - Date.now();
  if (left > 0) await c.sleep(left + 1500);
  const keeperBefore = await c.creditsOf(keeper);
  const aBefore = await c.creditsOf(a);
  await c.expire(qe);
  await c.settle(qe);
  await c.sweep([a, b, keeper]);
  await c.sleep(4000);
  const voided = await c.getOrders(qe);
  const costBack = BigInt(voided.find((o) => o.agent === a).cost);
  check("R25", "a question with no result can be voided by anyone", (await c.getQuestion(qe)).yes_won === null);
  check("R25", "agents get their cost back when a question expires", (await c.creditsOf(a)) === aBefore + costBack, String(costBack));
  check("R25", "the asker gets the bounty back when a question expires", (await c.creditsOf(keeper)) >= keeperBefore + BigInt((await c.getQuestion(qe)).pool));

  // The colony pays for question storage, so askers cannot be allowed to fill it.
  const before = await c.creditsOf(a);
  const statsNow = await c.getStats();
  await askAs(a, { text: "x", category: "c".repeat(5000), source: null, resolver: "Public", commit_secs: 5, reveal_secs: 5, wait_secs: 0, callback: null }, 20_000n);
  check("R16", "an asker cannot fill the colony's storage, and is refunded", (await c.getStats()).questions === statsNow.questions && (await c.creditsOf(a)) === before);

  // Two births requested together must not both pass the check. `a` has a clean
  // record and no children, so exactly one of these should succeed.
  await c.grant([a], 5_000_000n);
  await c.sleep(2500);
  const twinA = `ta${tag}`;
  const twinB = `tb${tag}`;
  const { saveKey, newKey } = await import("../swarm/chain.ts");
  const keyA = saveKey(`${twinA}.${a}`, newKey());
  const keyB = saveKey(`${twinB}.${a}`, newKey());
  const s = await currentSalt(verifier);
  const auth = (label: string, key: string) => ({ intent: "auth_call", contract_id: colony, msg: JSON.stringify({ spawn: { label, public_key: key, genome: genome(label) } }), min_gas: "260000000000000" });
  // Two transactions from two relayers, so both pass the first check while neither
  // has finished. Only the second check, after the balance read, can stop the twin.
  await Promise.all([
    executeIntents(keeper, verifier, [signIntents(a, verifier, s, [auth(twinA, keyA.public_key)])]).catch(() => null),
    executeIntents(colony, verifier, [signIntents(a, verifier, s, [auth(twinB, keyB.public_key)])]).catch(() => null),
  ]);
  await c.sleep(9000);
  const born = Number(await exists(`${twinA}.${a}`)) + Number(await exists(`${twinB}.${a}`));
  check("R12", "two births requested at once cannot both pass the cooldown", born === 1, `${born} born`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed`);
writeFileSync("data/e2e-report.json", JSON.stringify({ colony, verifier, network: c.deployment.network, at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
if (passed !== results.length) process.exit(1);

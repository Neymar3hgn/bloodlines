/** The research pool rules, R26 to R29, tested on a live network. Each refusal is a real transaction. */
import { account } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
import { currentSalt, executeIntents, signIntents, transferIntent } from "../swarm/intents.ts";

const { colony, keeper, verifier, token_id: tokenId, treasury } = c.deployment;

/** Returns why a call was refused, looking inside a failover error for the real reason. */
export async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const inner = (e as { errors?: { message?: string }[] }).errors?.map((x) => x.message).join(" | ");
    return String(inner || (e as Error).message || e).slice(0, 220);
  }
}

export interface PoolTest {
  check: (rule: string, claim: string, ok: boolean, detail?: string) => void;
  tag: string;
  /** Three agents that buy, and one that arrives too late. */
  a: string;
  b: string;
  d: string;
  late: string;
}

/** Returns the questions it opened, and the briefing it bought. */
export async function poolChecks({ check, tag, a, b, d, late }: PoolTest) {
  let err: string | null;
  const joinAs = async (who: string, q: number, amount: bigint) => {
    const s = await currentSalt(verifier);
    await executeIntents(keeper, verifier, [signIntents(who, verifier, s, [transferIntent(colony, tokenId, amount, JSON.stringify({ join: { q } }))])]);
    await c.sleep(3000);
  };
  const sleepUntil = async (ms: number) => {
    const wait = ms - Date.now() + 1800;
    if (wait > 0) await c.sleep(wait);
  };
  const pooled = (text: string, price: bigint, minBuyers: number, secs: number, commitSecs: number) =>
    c.openQuestion({ text: `${text} ${tag}`, category: "test", resolver: "Public", commitSecs, revealSecs: 12, waitSecs: 2, bounty: 10_000n, pool: { price, minBuyers, secs } });

  const statsBefore = await c.getStats();
  const outsiderHad = await c.creditsOf(a);
  const s = await currentSalt(verifier);
  const ask = { text: "x", category: "test", source: null, resolver: "Public", commit_secs: 5, reveal_secs: 5, wait_secs: 0, callback: null, pool: { price: "1000", min_buyers: 2, secs: 5 } };
  await executeIntents(keeper, verifier, [signIntents(a, verifier, s, [transferIntent(colony, tokenId, 20_000n, JSON.stringify({ ask }), "30000000000000")])]);
  await c.sleep(3000);
  check("R26", "an outsider cannot offer a pool, and is refunded", (await c.getStats()).questions === statsBefore.questions && (await c.creditsOf(a)) === outsiderHad);

  const qp = await pooled("Pool test", 90_000n, 2, 60, 45);
  let pool = await c.getPool(qp);
  const opened = await c.getQuestion(qp);
  check("R26", "a question can offer a briefing, with a pledge of price over minimum buyers", pool.status === "Open" && pool.pledge === "45000", `pledge ${pool.pledge}`);
  check("R26", "the commit window starts after the pool window", opened.commit_end_ms - pool.end_ms === 45_000);

  const keeperHad = await c.creditsOf(keeper);
  await joinAs(keeper, qp, 45_000n);
  check("R26", "an account that is not an agent cannot join, and is refunded", (await c.getPool(qp)).buyers.length === 0 && (await c.creditsOf(keeper)) === keeperHad);

  const aHad = await c.creditsOf(a);
  await joinAs(a, qp, 44_999n);
  check("R26", "a wrong pledge is refused and refunded", (await c.getPool(qp)).buyers.length === 0 && (await c.creditsOf(a)) === aHad);

  await c.joinBatch(qp, [a, b, d], 45_000n);
  await c.sleep(3000);
  pool = await c.getPool(qp);
  check("R26", "agents join together in one transaction, each with its own signature", pool.buyers.length === 3 && pool.held === "135000", `${pool.buyers.length} buyers, ${pool.held} held`);

  const aPaid = await c.creditsOf(a);
  await joinAs(a, qp, 45_000n);
  check("R26", "an agent cannot join twice, and is refunded", (await c.getPool(qp)).buyers.length === 3 && (await c.creditsOf(a)) === aPaid);

  err = await rejects(() => c.closePool(qp));
  check("R27", "a pool cannot close before its window ends", /still open/.test(err ?? ""), (err ?? "").slice(0, 80));

  err = await rejects(() => c.reap(d));
  check("R29", "an agent in an unfinished pool cannot be reaped", /open positions/.test(err ?? ""), (err ?? "").slice(0, 80));

  await sleepUntil(pool.end_ms);
  const lateHad = await c.creditsOf(late);
  await joinAs(late, qp, 45_000n);
  check("R26", "a late join is refused and refunded", (await c.getPool(qp)).buyers.length === 3 && (await c.creditsOf(late)) === lateHad);

  const backBefore = BigInt(await c.getClaimable(a));
  await c.closePool(qp);
  pool = await c.poolAfter(qp, "Open");
  check("R27", "each buyer pays only its share of the price", pool.status === "Closed" && pool.share === "30000" && pool.held === "90000", `share ${pool.share}`);
  check("R27", "the rest of each pledge comes back", BigInt(await c.getClaimable(a)) === backBefore + 15_000n);

  const text = `A test briefing, ${tag}.`;
  const hash = c.sha256Hex(text);
  err = await rejects(() => account(colony).callFunction({ contractId: colony, methodName: "post_briefing", args: { q: qp, hash }, gas: 10_000_000_000_000n } as never));
  check("R28", "only the keeper can post a briefing", /only the keeper/.test(err ?? ""), (err ?? "").slice(0, 80));
  err = await rejects(() => c.postBriefing(qp, "not a hash"));
  check("R28", "a briefing needs a real hash", !!err && (await c.getPool(qp)).status === "Closed", (err ?? "").slice(0, 80));

  const treasuryHad = BigInt(await c.getClaimable(treasury));
  await c.postBriefing(qp, hash);
  pool = await c.poolAfter(qp, "Closed");
  check("R28", "the hash goes on chain, and only then is the briefing paid for", pool.status === "Bought" && pool.briefing_hash === hash && pool.held === "0" && BigInt(await c.getClaimable(treasury)) === treasuryHad + 90_000n);
  err = await rejects(() => c.refundPool(qp));
  check("R28", "a bought pool cannot be refunded", /finished/.test(err ?? ""), (err ?? "").slice(0, 80));

  // R27: too few buyers.
  const qf = await pooled("Small pool test", 90_000n, 3, 15, 8);
  await c.joinBatch(qf, [a, b], 30_000n);
  await c.sleep(3000);
  const small = await c.getPool(qf);
  await sleepUntil(small.end_ms);
  const smallBefore = BigInt(await c.getClaimable(a));
  await c.closePool(qf);
  pool = await c.poolAfter(qf, "Open");
  check("R27", "with too few buyers, everyone gets the whole pledge back", pool.status === "Failed" && pool.held === "0" && BigInt(await c.getClaimable(a)) === smallBefore + 30_000n);

  // R28: nobody writes the briefing.
  const qn = await pooled("No briefing test", 60_000n, 2, 15, 25);
  await c.joinBatch(qn, [a, b], 30_000n);
  await c.sleep(3000);
  const waiting = await c.getPool(qn);
  await sleepUntil(waiting.end_ms);
  await c.closePool(qn);
  await c.poolAfter(qn, "Open");
  err = await rejects(() => c.refundPool(qn));
  check("R28", "a pool cannot be refunded while a briefing can still arrive", /can still arrive/.test(err ?? ""), (err ?? "").slice(0, 80));
  const noBriefing = await c.getQuestion(qn);
  await sleepUntil(noBriefing.commit_end_ms);
  err = await rejects(() => c.postBriefing(qn, hash));
  check("R28", "a briefing cannot arrive after the commit window", /too late/.test(err ?? ""), (err ?? "").slice(0, 80));
  const refundBefore = BigInt(await c.getClaimable(a));
  // The colony's own account, to show this needs neither the keeper nor a buyer.
  await account(colony).callFunction({ contractId: colony, methodName: "refund_pool", args: { q: qn }, gas: 25_000_000_000_000n, waitUntil: "EXECUTED_OPTIMISTIC" } as never);
  pool = await c.poolAfter(qn, "Closed");
  check("R28", "with no briefing, anyone can trigger a full refund", pool.status === "Refunded" && pool.held === "0" && BigInt(await c.getClaimable(a)) === refundBefore + 30_000n);

  await c.sweep([a, b, d, treasury, keeper]);
  await c.sleep(4000);
  check("R29", "a finished pool releases its buyers", (await c.getAgent(a)).open === 0 && (await c.getAgent(d)).open === 0);
  check("R27", "a refund reaches the agent's own balance", (await c.getClaimable(a)) === "0" && (await c.creditsOf(a)) === aHad - 30_000n, `net cost ${aHad - (await c.creditsOf(a))}`);

  return { questions: [qp, qf, qn], bought: { q: qp, text, hash } };
}

/** The sealed sale rules, R30 to R33, tested on a live network. Each refusal is a real transaction. */
import { randomBytes } from "node:crypto";
import { account } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
import { currentSalt, executeIntents, type MultiPayload } from "../swarm/intents.ts";
import { rejects } from "./pool-checks.ts";

const { colony, keeper, verifier, treasury } = c.deployment;
const CEILING = 90_000n;
const PLEDGE = 45_000n;
const POOL_SECS = 90;
const REVEAL_SECS = 45;

export interface AuctionTest {
  check: (rule: string, claim: string, ok: boolean, detail?: string) => void;
  tag: string;
  /** Two agents that buy. */
  a: string;
  b: string;
  /** Five agents that sell, or try to. */
  sellers: string[];
}

/** Returns the questions it opened, and the briefing it bought. */
export async function auctionChecks({ check, tag, a, b, sellers }: AuctionTest) {
  const [high, x, y, ghost, late] = sellers;
  // Equal asks go to the lower account name, so the test has to know which that is.
  const [first, second] = x < y ? [x, y] : [y, x];

  let err: string | null;
  const send = async (make: (salt: string) => MultiPayload[]) => {
    await executeIntents(keeper, verifier, make(await currentSalt(verifier)));
    await c.sleep(3500);
  };
  const until = async (ms: number) => {
    const wait = ms - Date.now() + 1800;
    if (wait > 0) await c.sleep(wait);
  };
  const plan = (seller: string, ask: bigint): c.OfferPlan => ({ seller, ask, salt: randomBytes(8).toString("hex") });
  const seal = (q: number, p: c.OfferPlan, s: string) => c.authPayload(p.seller, s, { seal_offer: { q, hash: c.offerSeal(q, p) } });
  const reveal = (q: number, p: c.OfferPlan, s: string) => c.authPayload(p.seller, s, { reveal_offer: { q, ask: p.ask.toString(), salt: p.salt } });
  const deliver = (q: number, who: string, hash: string, bill: bigint, s: string) => c.authPayload(who, s, { deliver: { q, hash, bill: bill.toString() } });
  const claimable = async (who: string) => BigInt(await c.getClaimable(who));
  const offerBy = (sale: any, who: string) => sale.offers.find((o: any) => o.seller === who);
  const open = (text: string, commitSecs: number) =>
    c.openQuestion({ text: `${text} ${tag}`, category: "test", resolver: "Public", commitSecs, revealSecs: 45, waitSecs: 2, bounty: 10_000n, pool: { price: CEILING, minBuyers: 2, secs: POOL_SECS, revealSecs: REVEAL_SECS } });

  const baseline = new Map<string, { open: number; strikes: number }>();
  for (const id of [a, b, ...sellers]) baseline.set(id, await c.getAgent(id));
  const openNow = async (who: string) => (await c.getAgent(who)).open - baseline.get(who)!.open;
  const strikesNow = async (who: string) => (await c.getAgent(who)).strikes - baseline.get(who)!.strikes;

  // ---------- The pool window: buyers join and sellers seal ----------

  const qa = await open("Sale test", 120);
  const qb = await open("Sale test with no delivery", 30);
  const qc = await open("Sale test with no offers", 30);
  const qd = await open("Sale test with too few buyers", 30);

  let sale = await c.getSale(qa);
  const poolA = await c.getPool(qa);
  const questionA = await c.getQuestion(qa);
  check("R30", "a pool can run a sealed sale, with reveals after the pool window", !!sale && sale.reveal_end_ms - poolA.end_ms === REVEAL_SECS * 1000 && sale.offers.length === 0);
  check("R30", "the commit window starts after the reveals", questionA.commit_end_ms - sale.reveal_end_ms === 120_000);

  // A commit needs no briefing, so the writer's can land now. R33 is about its reveal.
  const order: c.OrderPlan = { agent: first, belief: 60, stake: 10n, bill: 1n, receipt: "", salt: randomBytes(8).toString("hex") };
  await c.commit(qa, order);

  const offers = {
    high: plan(high, 30_000n),
    first: plan(first, 20_000n),
    second: plan(second, 20_000n),
    // The seal hides that this is over the ceiling, so the seal is accepted and the reveal is not.
    ghost: plan(ghost, CEILING + 1n),
    onB: plan(high, 31_000n),
    onD: plan(first, 5_000n),
  };

  await send((s) => [seal(qa, plan(keeper, 1_000n), s)]);
  check("R30", "an account that is not an agent cannot offer", (await c.getSale(qa)).offers.length === 0);

  await send((s) => [seal(qa, offers.high, s), seal(qa, offers.first, s), seal(qa, offers.second, s), seal(qa, offers.ghost, s), seal(qb, offers.onB, s), seal(qd, offers.onD, s)]);
  await send((s) => ([[qa, a], [qa, b], [qb, a], [qb, b], [qc, a], [qc, b], [qd, a]] as [number, string][]).map(([q, who]) => c.joinPayload(q, who, PLEDGE, s)));
  sale = await c.getSale(qa);
  check("R30", "sealed offers are on chain with their asks hidden", sale.offers.length === 4 && sale.offers.every((o: any) => o.ask === null), `${sale.offers.length} offers`);
  check("R33", "a sealed offer is an open position", (await openNow(high)) === 2 && (await openNow(ghost)) === 1);

  const keptSeal = offerBy(sale, high).seal;
  const highHad = await c.creditsOf(high);
  await send((s) => [seal(qa, plan(high, 1n), s), seal(qa, plan(a, 1_000n), s), c.joinPayload(qa, high, PLEDGE, s), reveal(qa, offers.high, s)]);
  sale = await c.getSale(qa);
  check("R30", "a seller cannot seal twice", offerBy(sale, high).seal === keptSeal && sale.offers.length === 4);
  check("R33", "a buyer cannot offer in its own pool", !offerBy(sale, a));
  check("R33", "a seller cannot buy from its own sale, and is refunded", !(await c.getPool(qa)).buyers.includes(high) && (await c.creditsOf(high)) === highHad);
  check("R30", "an offer cannot be revealed while sealing is open", offerBy(sale, high).ask === null);

  err = await rejects(() => c.reap(high));
  check("R33", "a seller with an offer cannot be reaped", !!err?.includes("open positions"), err ?? "it was reaped");
  err = await rejects(() =>
    account(keeper).callFunction({ contractId: colony, methodName: "on_auth", args: { signer_id: first, msg: JSON.stringify({ deliver: { q: qa, hash: "0".repeat(64), bill: "0" } }) }, gas: 30_000_000_000_000n, waitUntil: "EXECUTED_OPTIMISTIC" } as never),
  );
  check("R30", "only the Intents contract can speak for a seller", !!err?.includes("only the Intents contract"), err ?? "it was accepted");
  err = await rejects(() => c.closePool(qa));
  check("R31", "a sale cannot close while offers can still be revealed", !!err?.includes("still open"), err ?? "it closed");

  // ---------- The reveal window ----------

  await until(poolA.end_ms);
  await send((s) => [seal(qa, plan(late, 1_000n), s), reveal(qa, { ...offers.high, ask: 25_000n }, s), reveal(qa, offers.ghost, s)]);
  sale = await c.getSale(qa);
  check("R30", "sealing ends with the pool window", !offerBy(sale, late));
  check("R30", "a reveal must match its seal", offerBy(sale, high).ask === null);
  check("R30", "an ask above the ceiling is refused", offerBy(sale, ghost).ask === null);

  const lastOpen = await c.getPool(qd);
  await until(lastOpen.end_ms);
  await send((s) => [reveal(qa, offers.high, s), reveal(qa, offers.first, s), reveal(qa, offers.second, s), reveal(qb, offers.onB, s), reveal(qd, offers.onD, s)]);
  sale = await c.getSale(qa);
  check("R30", "revealed asks are public", offerBy(sale, high).ask === "30000" && offerBy(sale, first).ask === "20000" && offerBy(sale, second).ask === "20000");

  // ---------- Who won, and who pays ----------

  await until((await c.getSale(qd)).reveal_end_ms);
  const closing = async (q: number) => {
    const had = await claimable(a);
    await c.closePool(q);
    const pool = await c.poolAfter(q, "Open");
    await c.sleep(1000);
    return { pool, gained: (await claimable(a)) - had };
  };

  const closedA = await closing(qa);
  sale = await c.getSale(qa);
  check("R31", "the cheapest offer wins", sale.ask === "20000" && [first, second].includes(sale.winner), `${sale.winner} at ${sale.ask}`);
  check("R31", "equal asks go to the lower account name", sale.winner === first, `${first} against ${second}`);
  check("R31", "the buyers split the winning ask, and the rest of each pledge comes back", closedA.pool.status === "Closed" && closedA.pool.share === "10000" && closedA.gained === 35_000n, `share ${closedA.pool.share}, buyer got ${closedA.gained}`);
  check("R32", "a seller that seals and never reveals takes a strike", (await strikesNow(ghost)) === 1 && (await strikesNow(second)) === 0);
  check("R33", "losing sellers are free again, and the winner is not", (await openNow(second)) === 0 && (await openNow(ghost)) === 0 && (await openNow(first)) === 2);

  const closedB = await closing(qb);
  const saleB = await c.getSale(qb);
  check("R31", "a lone seller still wins, and the share follows its ask", saleB.winner === high && closedB.pool.share === "15500" && closedB.gained === 29_500n, `share ${closedB.pool.share}`);
  const closedC = await closing(qc);
  check("R31", "a sale with no offers refunds every pledge in full", closedC.pool.status === "Failed" && closedC.gained === PLEDGE, `buyer got ${closedC.gained}`);
  const closedD = await closing(qd);
  check("R31", "a sale with too few buyers refunds every pledge and frees its seller", closedD.pool.status === "Failed" && closedD.gained === PLEDGE && (await c.getSale(qd)).winner === null && (await openNow(first)) === 1, `buyer got ${closedD.gained}`);

  // ---------- Delivery ----------

  const text = `A scripted stand-in for a research briefing, written to test the sale rules. ${tag}`;
  const hash = c.sha256Hex(text);

  err = await rejects(() => c.postBriefing(qa, hash));
  check("R32", "the keeper cannot post a briefing that was sold", !!err?.includes("winning seller"), err ?? "it was accepted");
  await send((s) => [deliver(qa, second, hash, 0n, s), deliver(qa, first, hash, 20_001n, s)]);
  check("R32", "only the winner can deliver, and its bill cannot exceed the sale", (await c.getPool(qa)).status === "Closed");

  const winnerHad = await claimable(first);
  const treasuryHad = await claimable(treasury);
  await send((s) => [deliver(qa, first, hash, 3_000n, s)]);
  const bought = await c.poolAfter(qa, "Closed");
  sale = await c.getSale(qa);
  const winnerGot = (await claimable(first)) - winnerHad;
  const treasuryGot = (await claimable(treasury)) - treasuryHad;
  check("R32", "the winner delivers and is paid what the buyers paid, less its bill", bought.status === "Bought" && bought.briefing_hash === hash && sale.paid === "17000" && sale.bill === "3000" && winnerGot === 17_000n && treasuryGot === 3_000n, `paid ${winnerGot}, treasury ${treasuryGot}`);
  check("R33", "the winner is free again once it delivers", (await openNow(first)) === 0);

  await until((await c.getQuestion(qa)).commit_end_ms);
  const winnerHeld = await c.creditsOf(first);
  await send((s) => [c.revealPayload(qa, order, s)]);
  check("R33", "the writer cannot bet on its own briefing, and is refunded", (await c.getOrders(qa)).length === 0 && (await c.creditsOf(first)) === winnerHeld);

  await until((await c.getQuestion(qb)).commit_end_ms);
  await send((s) => [deliver(qb, high, hash, 0n, s)]);
  check("R32", "a delivery after the commit window is refused", (await c.getPool(qb)).status === "Closed");
  const buyerHad = await claimable(a);
  await c.refundPool(qb);
  const refunded = await c.poolAfter(qb, "Closed");
  await c.sleep(1000);
  const buyerGot = (await claimable(a)) - buyerHad;
  check("R32", "no delivery: every buyer gets its share back, and the winner takes a strike", refunded.status === "Refunded" && buyerGot === 15_500n && (await strikesNow(high)) === 1, `buyer got ${buyerGot}`);
  check("R33", "after every sale, no seller or buyer is left holding an open position", (await openNow(high)) === 0 && (await openNow(first)) === 0 && (await openNow(a)) === 0 && (await openNow(b)) === 0);

  return { questions: [qa, qb, qc, qd], bought: { q: qa, text, hash, writer: first }, touched: [a, b, ...sellers, treasury] };
}

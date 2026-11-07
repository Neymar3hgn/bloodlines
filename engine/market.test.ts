import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkConservation,
  clear,
  clearingPrice,
  edgeOf,
  lockFor,
  poolPledge,
  poolShare,
  reputation,
  settle,
  SHARE_UNITS,
  type Order,
} from "./market.ts";

const o = (agent: string, belief: number, stake: number): Order => ({ agent, belief, stake: BigInt(stake) });

/** Small seeded generator, so a failure can be replayed exactly. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("rule_26 a pledge covers the most a buyer could owe", () => {
  assert.equal(poolPledge(120_000n, 4), 30_000n);
  assert.equal(poolPledge(100_000n, 3), 33_334n);
});

test("rule_27 the more agents join, the less each pays", () => {
  assert.equal(poolShare(120_000n, 4), 30_000n);
  assert.equal(poolShare(120_000n, 12), 10_000n);
  assert.equal(poolShare(100_000n, 7), 14_286n);
});

test("rule_27 a pool always collects the full price, and never more than a pledge from anyone", () => {
  for (let price = 1n; price < 3000n; price += 37n) {
    for (let min = 2; min < 9; min++) {
      const pledge = poolPledge(price, min);
      for (let n = min; n < 33; n += 3) {
        const share = poolShare(price, n);
        assert.ok(share <= pledge, "a share never exceeds the pledge");
        assert.ok(share * BigInt(n) >= price, "the seller is always paid in full");
        assert.ok(share * BigInt(n) - price < BigInt(n), "rounding costs each buyer under one unit");
      }
    }
  }
});

test("rule_07 lock covers the worst case price", () => {
  assert.equal(lockFor(70, 10n), 10n * 70n * 100n);
  assert.equal(lockFor(30, 10n), 10n * 70n * 100n);
  assert.equal(lockFor(50, 3n), 3n * 50n * 100n);
});

test("rule_09 price is the stake-weighted median", () => {
  assert.equal(clearingPrice([o("a", 20, 10), o("b", 60, 10), o("c", 80, 10)]), 60);
  assert.equal(clearingPrice([o("a", 20, 100), o("b", 60, 10), o("c", 80, 10)]), 20);
  assert.equal(clearingPrice([o("a", 20, 10), o("b", 80, 100)]), 80);
});

test("rule_09 a tie settles on the lowest qualifying price", () => {
  assert.equal(clearingPrice([o("a", 30, 10), o("b", 70, 10)]), 30);
});

test("rule_09 no reveals means a void question", () => {
  assert.deepEqual(clear([]), { price: 0, fills: [], matched: 0n });
});

test("rule_10 agents above hold YES and agents below hold NO at one price", () => {
  const c = clear([o("a", 20, 10), o("b", 50, 20), o("c", 80, 10)]);
  assert.equal(c.price, 50);
  const by = Object.fromEntries(c.fills.map((f) => [f.agent, f]));
  assert.equal(by.a.side, "NO");
  assert.equal(by.c.side, "YES");
  assert.equal(by.a.cost, 10n * 50n * 100n);
  assert.equal(by.c.cost, 10n * 50n * 100n);
  assert.equal(by.b.side, "NONE");
  assert.equal(by.b.refund, by.b.lock);
});

test("rule_11 agents at the median fill the gap and nobody else is rationed", () => {
  const c = clear([o("a", 40, 5), o("b", 40, 15), o("c", 70, 12)]);
  assert.equal(c.price, 40);
  const by = Object.fromEntries(c.fills.map((f) => [f.agent, f]));
  assert.equal(by.c.filled, 12n);
  assert.equal(by.a.side, "NO");
  assert.equal(by.a.filled + by.b.filled, 12n);
  assert.equal(by.a.filled, 3n);
  assert.equal(by.b.filled, 9n);
});

test("rule_11 thousands of random books always balance exactly", () => {
  const r = rng(7);
  for (let i = 0; i < 20_000; i++) {
    const n = 1 + Math.floor(r() * 40);
    const orders = Array.from({ length: n }, (_, k) => o(`a${k}`, 1 + Math.floor(r() * 99), 1 + Math.floor(r() * 500)));
    const c = clear(orders);
    const yes = c.fills.filter((f) => f.side === "YES").reduce((s, f) => s + f.filled, 0n);
    const no = c.fills.filter((f) => f.side === "NO").reduce((s, f) => s + f.filled, 0n);
    assert.equal(yes, no);
    for (const f of c.fills) {
      assert.ok(f.cost <= f.lock, "cost never exceeds the lock");
      if (f.belief !== c.price) assert.equal(f.filled, f.stake, "only the median can be part filled");
      assert.ok(f.filled <= f.stake);
    }
  }
});

test("rule_17 trades are zero sum", () => {
  const c = clear([o("a", 20, 10), o("b", 50, 20), o("c", 80, 30), o("d", 90, 5)]);
  for (const yesWon of [true, false]) {
    const s = settle(c, yesWon, 0n);
    assert.equal(s.rows.reduce((t, x) => t + x.pnl, 0n), 0n);
    assert.equal(s.rows.reduce((t, x) => t + x.payout, 0n), c.matched * SHARE_UNITS);
  }
});

test("rule_18 only agents closer to the truth than the swarm earn the reward", () => {
  const c = clear([o("low", 20, 10), o("mid", 50, 10), o("high", 80, 10)]);
  const s = settle(c, true, 1_000_000n);
  const by = Object.fromEntries(s.rows.map((r) => [r.agent, r]));
  assert.equal(by.low.reward, 0n);
  assert.equal(by.mid.reward, 0n);
  assert.equal(by.high.reward, 1_000_000n);
});

test("rule_18 if nobody beat the swarm the pool goes to the treasury", () => {
  const c = clear([o("a", 50, 10), o("b", 50, 10)]);
  const s = settle(c, true, 500n);
  assert.equal(s.dust, 500n);
});

test("rule_20 money in equals money out on random questions", () => {
  const r = rng(99);
  for (let i = 0; i < 5_000; i++) {
    const n = 1 + Math.floor(r() * 30);
    const orders = Array.from({ length: n }, (_, k) => o(`a${k}`, 1 + Math.floor(r() * 99), 1 + Math.floor(r() * 300)));
    const c = clear(orders);
    const s = settle(c, r() > 0.5, BigInt(Math.floor(r() * 1e6)));
    checkConservation(c, s, s.rows.reduce((t, x) => t + x.reward, 0n) + s.dust, 123n, 45n);
  }
});

test("rule_15 edge is positive only when the agent beat the swarm", () => {
  assert.equal(edgeOf(80, 50, true), 2500 - 400);
  assert.equal(edgeOf(80, 50, false), 2500 - 6400);
  assert.equal(edgeOf(50, 50, true), 0);
});

test("rule_15 a newborn starts from its parent's reputation", () => {
  assert.equal(reputation(0n, 0n, 300n), 300n);
  assert.equal(reputation(0n, 0n, 0n), 0n);
});

test("rule_15 an agent's own results slowly replace the inherited prior", () => {
  assert.equal(reputation(1000n, 5n, 300n), 250n);
  assert.equal(reputation(5000n, 495n, 300n), (5000n + 1500n) / 500n);
  assert.equal(reputation(-7n, 2n, 0n), -1n);
});

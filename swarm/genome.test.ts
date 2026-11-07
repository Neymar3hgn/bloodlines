import assert from "node:assert/strict";
import { test } from "node:test";
import { lockFor } from "../engine/market.ts";
import { founders, MODELS } from "./founders.ts";
import { CATEGORIES, childLabel, engages, mutateNumbers, toOrder, type Genome, type Rng } from "./genome.ts";

const base: Genome = { name: "t", model: "m", strategy: "s", temperature: 0.3, shrink: 1, size: 0.2, focus: {} };

function rng(seed: number): Rng {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("rule_05 a model's number becomes a clamped order", () => {
  assert.equal(toOrder(base, 0.7, 1_000_000n, 60n, 0n)?.belief, 70);
  assert.equal(toOrder(base, 0, 1_000_000n, 60n, 0n)?.belief, 1);
  assert.equal(toOrder(base, 1, 1_000_000n, 60n, 0n)?.belief, 99);
  assert.equal(toOrder(base, 57, 1_000_000n, 60n, 0n)?.belief, 99, "an out-of-range number cannot escape the range");
  assert.equal(toOrder(base, -3, 1_000_000n, 60n, 0n)?.belief, 1);
});

test("rule_05 a value that is not a number places no order", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(toOrder(base, bad, 1_000_000n, 60n, 0n), null);
  }
});

test("rule_23 a stake never passes the colony's limit", () => {
  const rich = toOrder({ ...base, size: 0.5 }, 0.5, 900_000_000n, 60n, 0n);
  assert.equal(rich?.stake, 60n);
});

test("an order is always affordable, whatever the genome says", () => {
  const r = rng(3);
  for (let i = 0; i < 5000; i++) {
    const credits = BigInt(Math.floor(r() * 2_000_000));
    const reserve = BigInt(Math.floor(r() * 50_000));
    const g = { ...base, size: Math.max(0.01, r()), shrink: 0.3 + r() * 1.5 };
    const order = toOrder(g, r(), credits, 60n, reserve);
    if (order) {
      assert.ok(lockFor(order.belief, order.stake) + reserve <= credits, "the lock must fit inside the agent's credits");
      assert.ok(order.stake > 0n && order.belief >= 1 && order.belief <= 99);
    }
  }
});

test("an agent with nothing to spend places no order", () => {
  assert.equal(toOrder(base, 0.5, 30_000n, 60n, 40_000n), null);
  assert.equal(toOrder({ ...base, size: 0.0001 }, 0.5, 100_000n, 60n, 0n), null);
});

test("shrink hedges toward 50 and above 1 sharpens", () => {
  const hedged = toOrder({ ...base, shrink: 0.5 }, 0.9, 1_000_000n, 60n, 0n)!.belief;
  const sharp = toOrder({ ...base, shrink: 1.5 }, 0.9, 1_000_000n, 60n, 0n)!.belief;
  assert.ok(hedged < 90 && hedged > 50, String(hedged));
  assert.ok(sharp > 90, String(sharp));
});

test("rule_12 mutation stays inside safe bounds, over many generations", () => {
  const r = rng(9);
  let g = founders()[0];
  for (let i = 0; i < 3000; i++) {
    g = mutateNumbers(g, r, MODELS);
    assert.ok(g.temperature >= 0 && g.temperature <= 1.2);
    assert.ok(g.shrink >= 0.35 && g.shrink <= 1.6);
    assert.ok(g.size >= 0.02 && g.size <= 0.5);
    assert.ok(MODELS.includes(g.model));
    for (const c of CATEGORIES) assert.ok(g.focus[c] >= 0.05 && g.focus[c] <= 1);
  }
});

test("a mutation never changes the written strategy", () => {
  const g = founders()[0];
  assert.equal(mutateNumbers(g, rng(1), MODELS).strategy, g.strategy);
});

test("taking a question is a stable choice, so a run can be replayed", () => {
  const g = { ...base, focus: { sports: 0.5 } };
  const first = engages(g, "a.near", "q1", "sports");
  for (let i = 0; i < 20; i++) assert.equal(engages(g, "a.near", "q1", "sports"), first);
  let yes = 0;
  for (let i = 0; i < 2000; i++) if (engages(g, "a.near", `q${i}`, "sports")) yes += 1;
  assert.ok(yes > 850 && yes < 1150, String(yes));
  assert.equal(engages(g, "a.near", "q1", "unknown"), true, "a category the agent has no view on is taken");
});

test("a child's label is short and unique among its siblings", () => {
  const r = rng(5);
  const taken = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const label = childLabel(r, taken);
    assert.equal(label.length, 2);
    assert.ok(!taken.has(label));
    taken.add(label);
  }
});

test("founders are diverse and within limits", () => {
  const all = founders();
  assert.equal(all.length, 16);
  assert.equal(new Set(all.map((g) => g.name)).size, 16);
  assert.ok(new Set(all.map((g) => g.model)).size >= 4);
  for (const g of all) assert.ok(g.name.length <= 3 && g.strategy.length > 20);
});

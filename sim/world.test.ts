import assert from "node:assert/strict";
import { test } from "node:test";
import { blindLieAudit, pumpAttack } from "./gaming.ts";
import { DEFAULTS, runColony } from "./world.ts";

const quick = { ...DEFAULTS, questions: 500 };

test("rule_20 money is conserved through births and deaths", () => {
  assert.equal(runColony({ ...quick, seed: 3 }).conservationErrors, 0);
});

test("selection beats the founders on an exam neither has seen", () => {
  const r = runColony({ ...quick, questions: 900, seed: 4 });
  assert.ok(r.exam.evolvedError < r.exam.founderError, JSON.stringify(r.exam));
});

test("rule_12 and rule_13 the colony has real births and deaths", () => {
  const r = runColony({ ...quick, questions: 900, seed: 5 });
  assert.ok(r.agents.some((a) => a.parent !== null));
  assert.ok(r.agents.some((a) => a.died !== null));
});

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const poolRuns = (briefingNoise: number) => [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => runColony({ ...DEFAULTS, poolEvery: 3, briefingNoise, seed }));

test("rule_20 money is conserved when agents buy together", () => {
  assert.equal(runColony({ ...quick, poolEvery: 2, seed: 3 }).conservationErrors, 0);
});

test("rule_26 a good briefing makes the swarm's answer better, and a bad one worse", () => {
  const good = poolRuns(0.3);
  const bad = poolRuns(3);
  assert.ok(mean(good.map((r) => r.pools.withBriefing)) < mean(good.map((r) => r.pools.withoutIt)));
  assert.ok(mean(bad.map((r) => r.pools.withBriefing)) > mean(bad.map((r) => r.pools.withoutIt)));
});

test("rule_26 selection keeps the habit of buying good briefings and drops the habit of buying bad ones", () => {
  const good = mean(poolRuns(0.3).map((r) => r.pools.meanGene));
  const bad = mean(poolRuns(3).map((r) => r.pools.meanGene));
  assert.ok(good > bad + 0.1, `good ${good}, bad ${bad}`);
});

test("rule_27 pools make no difference to a colony that has none", () => {
  const off = runColony({ ...quick, seed: 9 });
  assert.equal(off.pools.offered, 0);
  assert.equal(off.pools.meanGene, 0.5);
});

test("a sealed market punishes the habit of lying", () => {
  for (const habit of blindLieAudit(300, 24, 9)) assert.ok(habit.meanPct < 0, `${habit.label}: ${habit.meanPct}`);
});

test("a whale's pump loses money on average", () => {
  const p = pumpAttack(300, 24, 0.5, 2);
  assert.ok(p.whaleLossPerPump > 0);
});

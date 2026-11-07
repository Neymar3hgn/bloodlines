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

test("a sealed market punishes the habit of lying", () => {
  for (const habit of blindLieAudit(300, 24, 9)) assert.ok(habit.meanPct < 0, `${habit.label}: ${habit.meanPct}`);
});

test("a whale's pump loses money on average", () => {
  const p = pumpAttack(300, 24, 0.5, 2);
  assert.ok(p.whaleLossPerPump > 0);
});

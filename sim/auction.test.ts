import assert from "node:assert/strict";
import { test } from "node:test";
import { AUCTION_DEFAULTS, runAuction } from "./auction.ts";

const market = (sellers: number, seed = 1) => runAuction({ ...AUCTION_DEFAULTS, sellers, seed });
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

test("the default market is 20 buyers and 5 sellers, with no model anywhere", () => {
  const m = runAuction(AUCTION_DEFAULTS);
  assert.equal(m.buyers.reduce((t, b) => t + b.count, 0), 20);
  assert.equal(m.sellers.length, 5);
  assert.equal(m.rounds.length, AUCTION_DEFAULTS.rounds);
  assert.ok(m.counts.bought > AUCTION_DEFAULTS.rounds / 2);
});

test("rule_31 five sellers cost the pool far less than one seller", () => {
  for (const seed of seeds) {
    const alone = market(1, seed);
    const five = market(5, seed);
    assert.ok(five.latePrice < alone.latePrice / 2, `seed ${seed}: ${five.latePrice} against ${alone.latePrice}`);
    assert.ok(five.lateShare < alone.lateShare / 2, `seed ${seed}: each buyer paid ${five.lateShare} against ${alone.lateShare}`);
  }
});

test("rule_31 a lone seller climbs to the ceiling, because nothing stops it", () => {
  assert.equal(market(1).latePrice, Number(AUCTION_DEFAULTS.ceiling));
});

test("rule_31 the winner is the cheapest revealed offer, and never an unrevealed one", () => {
  for (const round of market(5).rounds) {
    if (round.result !== "bought") continue;
    const revealed = round.offers.filter((o) => o.revealed);
    const lowest = revealed.reduce((m, o) => (o.ask < m ? o.ask : m), revealed[0].ask);
    assert.equal(round.ask, lowest);
    assert.ok(revealed.some((o) => o.seller === round.winner && o.ask === round.ask));
  }
});

test("rule_31 no buyer pays more than its pledge, and the shares cover the ask", () => {
  for (const round of market(5).rounds) {
    if (round.buyers === 0 || round.share === 0n) continue;
    assert.ok(round.share <= round.pledge);
    assert.ok(round.share * BigInt(round.buyers) >= round.ask);
    assert.ok(round.share * BigInt(round.buyers) - round.ask < BigInt(round.buyers));
  }
});

test("rule_32 a winner that does not deliver gets nothing and takes a strike", () => {
  const m = market(5, 2);
  assert.ok(m.counts["no-delivery"] > 0, "the flaky seller should win and fail at least once");
  assert.equal(m.conservationErrors, 0);
  assert.ok(m.sellers.find((s) => s.plan === "flaky")!.strikes >= m.counts["no-delivery"]);
});

test("rule_32 no winner ever sells below what the briefing cost it", () => {
  for (const seed of seeds) {
    for (const s of market(5, seed).sellers) assert.ok(s.profit >= 0n, `${s.id} lost money on seed ${seed}`);
  }
});

test("rule_20 money is conserved in every market size", () => {
  for (const sellers of [1, 2, 3, 5]) {
    for (const seed of seeds) assert.equal(market(sellers, seed).conservationErrors, 0);
  }
});

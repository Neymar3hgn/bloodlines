/** Writes shared test vectors so the TypeScript engine and the Rust contract must agree. */
import { writeFileSync } from "node:fs";
import { clear, settle, type Order } from "../engine/market.ts";
import { makeRng } from "../sim/world.ts";

const r = makeRng(2026);
const lines: string[] = [];
for (let i = 0; i < 2000; i++) {
  const n = 1 + Math.floor(r() * 32);
  // Few distinct beliefs make ties and median fills common, which is the hard case.
  const spread = r() < 0.5 ? 5 : 99;
  const base = 1 + Math.floor(r() * (99 - spread));
  const orders: Order[] = Array.from({ length: n }, (_, k) => ({
    agent: `a${String(k).padStart(3, "0")}`,
    belief: base + Math.floor(r() * spread),
    stake: BigInt(1 + Math.floor(r() * 400)),
  }));
  const c = clear(orders);
  const s = settle(c, true, 0n);
  const fills = c.fills.map((f) => `${f.side}:${f.filled}:${f.cost}:${f.refund}`).join(",");
  const payouts = s.rows.map((x) => x.payout).join(",");
  const points = s.rows.map((x) => x.points).join(",");
  lines.push(`${orders.map((o) => `${o.belief}:${o.stake}`).join(",")}|${c.price}|${c.matched}|${fills}|${payouts}|${points}`);
}
writeFileSync("data/vectors.txt", lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} vectors to data/vectors.txt`);

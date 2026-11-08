/** Prints the sealed market round by round, with no chain and no model calls. Usage: npm run sim:auction [-- --rounds N --seed N --sellers N] */
import { AUCTION_DEFAULTS, runAuction, type AuctionRound } from "./auction.ts";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};

const report = runAuction({ ...AUCTION_DEFAULTS, rounds: arg("rounds", AUCTION_DEFAULTS.rounds), seed: arg("seed", 1), sellers: arg("sellers", AUCTION_DEFAULTS.sellers) });
const SHOW = 6;
const money = (x: bigint | number) => Number(x).toLocaleString("en-US");

function print(round: AuctionRound) {
  console.log(`\nRound ${round.n}: ${round.buyers} buyers pooled, each pledging ${money(round.pledge)}`);
  for (const o of [...round.offers].sort((a, b) => Number(a.ask - b.ask))) {
    const mark = o.seller === round.winner ? "  <- wins" : o.revealed ? "" : "  (sealed, never revealed: a strike)";
    console.log(`  ${o.seller.padEnd(9)} sealed ${money(o.ask).padStart(7)}${mark}`);
  }
  if (round.result === "bought") console.log(`  Clearing price ${money(round.ask)}. Each buyer pays ${money(round.share)} and gets ${money(round.pledge - round.share)} back.`);
  else if (round.result === "no-delivery") console.log(`  The winner did not deliver. Every buyer got its money back, and the winner took a strike.`);
  else console.log(`  No sale (${round.result}). Every pledge went back.`);
}

console.log(`Sealed market: ${report.params.buyers} buyers, ${report.params.sellers} sellers, ${report.params.rounds} rounds, no model calls. The ceiling is ${money(report.params.ceiling)}.`);
console.log("\nThe first rounds:");
report.rounds.slice(0, SHOW / 2).forEach(print);
console.log("\nThe last rounds, after the sellers have fought it out:");
report.rounds.slice(-SHOW / 2).forEach(print);

console.log("\nWho got what:");
console.log(" seller      plan       wins      income       bills      profit  strikes");
for (const s of report.sellers) {
  console.log(` ${s.id.padEnd(10)}  ${s.plan.padEnd(9)} ${String(s.wins).padStart(5)} ${money(s.income).padStart(11)} ${money(s.bills).padStart(11)} ${money(s.profit).padStart(11)} ${String(s.strikes).padStart(8)}`);
}
console.log("\n buyers      count   joined   mean share paid");
for (const b of report.buyers) console.log(` ${b.plan.padEnd(10)} ${String(b.count).padStart(6)} ${String(b.joined).padStart(8)} ${money(Math.round(b.meanShare)).padStart(17)}`);
console.log(`\nLast third of the rounds: price ${money(Math.round(report.latePrice))}, ${report.lateBuyers.toFixed(1)} buyers, each paying ${money(Math.round(report.lateShare))} of a ${money(report.pledge)} pledge.`);
console.log(`Sold ${report.counts.bought}, not delivered ${report.counts["no-delivery"]}, too few buyers ${report.counts["too-few"]}, no offer ${report.counts["no-offer"]}. Money conservation errors: ${report.conservationErrors}.`);

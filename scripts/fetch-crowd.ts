/**
 * What the human crowd said. For each question, this reads the public market's YES
 * price on the date the agents are told it is. It gives the experiment an honest
 * yardstick: real people with real money, not just a coin flip.
 *
 *   node scripts/fetch-crowd.ts            writes data/crowd.json
 */
import { readFileSync, writeFileSync } from "node:fs";

const questions: { id: string; asOf: string; closes: string; clobToken?: string }[] = JSON.parse(readFileSync("data/questions.json", "utf8")).questions;
const out: Record<string, number> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function priceAt(token: string, asOf: string): Promise<number | null> {
  const at = Math.floor(Date.parse(`${asOf}T12:00:00Z`) / 1000);
  const url = `https://clob.polymarket.com/prices-history?market=${token}&startTs=${at - 2 * 86400}&endTs=${at}&fidelity=60`;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { "user-agent": "clade-research" } }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { history?: { t: number; p: number }[] };
      const rows = (body.history ?? []).filter((r) => r.t <= at);
      return rows.length ? rows[rows.length - 1].p : null;
    }
    await sleep(1500 * (i + 1));
  }
  return null;
}

let missing = 0;
for (const [i, q] of questions.entries()) {
  if (!q.clobToken) {
    missing += 1;
    continue;
  }
  const p = await priceAt(q.clobToken, q.asOf);
  if (p === null) missing += 1;
  else out[q.id] = p;
  if ((i + 1) % 50 === 0) {
    console.log(`${i + 1} of ${questions.length}: ${Object.keys(out).length} prices`);
    writeFileSync("data/crowd.json", JSON.stringify(out));
  }
  await sleep(160);
}
writeFileSync("data/crowd.json", JSON.stringify(out));
console.log(`Wrote data/crowd.json: ${Object.keys(out).length} prices, ${missing} missing`);

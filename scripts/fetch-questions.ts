/**
 * Builds the question set from public, already resolved yes/no questions.
 * Read-only: Clade never trades on the source. One question per event, so
 * "which of these 20 candidates wins" does not flood the set with near-copies.
 *
 *   node scripts/fetch-questions.ts
 */
import { writeFileSync } from "node:fs";

const API = "https://gamma-api.polymarket.com/markets";
const MONTHS: [string, string][] = [
  ["2026-07-15", "2026-08-01"],
  ["2026-08-01", "2026-08-16"],
  ["2026-08-16", "2026-09-01"],
  ["2026-09-01", "2026-09-16"],
  ["2026-09-16", "2026-10-01"],
  ["2026-10-01", "2026-10-16"],
  ["2026-10-16", "2026-11-01"],
  ["2026-11-01", "2026-11-07"],
];

interface Q {
  id: string;
  text: string;
  detail: string;
  category: string;
  asOf: string;
  closes: string;
  yes: boolean;
  volume: number;
  source: string;
  clobToken?: string;
}

function categorize(text: string): string {
  const t = text.toLowerCase();
  if (/\b(bitcoin|btc|eth|ethereum|solana|sol|xrp|crypto|token|airdrop|fdv|stablecoin|doge|nft|binance|coinbase|memecoin)\b/.test(t)) return "crypto";
  if (/\b(election|president|prime minister|senate|congress|parliament|vote|governor|minister|poll|party|referendum|trump|biden|harris|nominee|supreme court)\b/.test(t)) return "politics";
  if (/\b(fed|interest rate|inflation|cpi|gdp|unemployment|recession|stock|s&p|nasdaq|earnings|ipo|tesla|nvidia|apple|oil|gold)\b/.test(t)) return "economy";
  if (/\b(win on|vs\.?|fc|nba|nfl|mlb|nhl|ufc|premier league|champions league|world cup|grand prix|f1|tennis|open|match|game \d|finals|playoffs?|super bowl|o\/u|spread)\b/.test(t)) return "sports";
  if (/\b(war|ceasefire|iran|israel|russia|ukraine|china|taiwan|strike|nato|treaty|peace|military|invasion|hormuz|gaza)\b/.test(t)) return "world";
  if (/\b(ai|openai|gpt|anthropic|google|apple|tech|spacex|launch|model|released?)\b/.test(t)) return "tech";
  return "other";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, tries = 5): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "clade-research" } });
      if (r.ok) return await r.json();
    } catch {
      /* retried below */
    }
    await sleep(2500 * (i + 1));
  }
  return null;
}

const seen = new Set<string>();
const out: Q[] = [];
for (const [start, end] of MONTHS) {
  let kept = 0;
  for (let offset = 0; offset < 500; offset += 100) {
    const params = new URLSearchParams({
      closed: "true",
      limit: "100",
      offset: String(offset),
      order: "volumeNum",
      ascending: "false",
      end_date_min: `${start}T00:00:00Z`,
      end_date_max: `${end}T00:00:00Z`,
      volume_num_min: "20000",
    });
    const rows = await get(`${API}?${params}`);
    if (!rows?.length) break;
    for (const m of rows) {
      let outcomes: string[];
      let prices: number[];
      try {
        outcomes = JSON.parse(m.outcomes ?? "[]");
        prices = JSON.parse(m.outcomePrices ?? "[]").map(Number);
      } catch {
        continue;
      }
      if (outcomes[0] !== "Yes" || outcomes[1] !== "No" || prices.length !== 2 || Math.max(...prices) < 0.99) continue;
      const event = m.events?.[0]?.id ?? m.groupItemTitle ?? m.slug;
      if (seen.has(String(event))) continue;
      const closes: string = m.endDate ?? m.closedTime;
      const started: string = m.startDate ?? m.createdAt;
      if (!closes || !started) continue;
      const span = Date.parse(closes) - Date.parse(started);
      if (!(span > 0)) continue;
      // Ask as of a week before the close, or half way through a short question.
      const asOf = new Date(Date.parse(closes) - Math.min(7 * 864e5, span / 2)).toISOString().slice(0, 10);
      seen.add(String(event));
      const tokens = (() => {
        try {
          return JSON.parse(m.clobTokenIds ?? "[]");
        } catch {
          return [];
        }
      })();
      out.push({
        id: String(m.id),
        text: String(m.question).slice(0, 380),
        detail: String(m.description ?? "").replace(/\s+/g, " ").slice(0, 700),
        category: categorize(`${m.question}`),
        asOf,
        closes: closes.slice(0, 10),
        yes: prices[0] > 0.5,
        volume: Math.round(Number(m.volumeNum ?? 0)),
        source: m.slug ? `https://polymarket.com/market/${m.slug}` : "",
        clobToken: tokens[0],
      });
      kept += 1;
    }
    await sleep(1200);
  }
  console.log(`${start}: kept ${kept}, total ${out.length}`);
}

// A fixed shuffle, so the split into seasons and exam is the same for everyone.
let seed = 20261107;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let i = out.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [out[i], out[j]] = [out[j], out[i]];
}
const byCat: Record<string, number> = {};
for (const q of out) byCat[q.category] = (byCat[q.category] ?? 0) + 1;
writeFileSync("data/questions.json", JSON.stringify({ fetched: new Date().toISOString(), source: "gamma-api.polymarket.com", count: out.length, questions: out }, null, 0));
console.log(`Wrote ${out.length} questions. Yes rate ${(out.filter((q) => q.yes).length / out.length).toFixed(2)}.`, byCat);

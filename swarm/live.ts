/**
 * Live questions: real events whose outcome nobody knows yet. Agents forecast them
 * now, and the result is posted when the public source reports it. Clade only reads
 * that source. It places no bets there.
 *
 *   node swarm/live.ts open --count 3 --hours 48    forecast events ending soon
 *   node swarm/live.ts resolve                      post results that have come in
 *
 * Add --ai for real forecasts. Without it, scripted agents guess with no signal.
 * Add --pool 60 to offer a research pool on each question, open for 60 seconds.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as c from "./colony.ts";
import { categorize } from "./questions.ts";
import { colonyConfig, defaults, ensureFounders, finishRound, fundFounders, playRound, refuel, selection } from "./runner.ts";

const API = process.env.CLADE_LIVE_API ?? "https://gamma-api.polymarket.com/markets";
const STORE = `data/live.${c.deployment.network}.${c.deployment.colony}.json`;

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};

interface Tracked {
  market: string;
  q: number;
  text: string;
  source: string;
  closes: string;
  resolved?: boolean;
}

const tracked: Tracked[] = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : [];
const save = () => writeFileSync(STORE, JSON.stringify(tracked, null, 1));

async function get(url: string): Promise<any> {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { headers: { "user-agent": "clade-research" } }).catch(() => null);
    if (r?.ok) return r.json();
    await c.sleep(2000 * (i + 1));
  }
  return null;
}

/** Open yes/no events ending soon, one per event, most-followed first. */
async function upcoming(hours: number): Promise<any[]> {
  const now = new Date();
  const params = new URLSearchParams({
    closed: "false",
    active: "true",
    limit: "100",
    order: "volumeNum",
    ascending: "false",
    end_date_min: new Date(now.getTime() + 3600_000).toISOString(),
    end_date_max: new Date(now.getTime() + hours * 3600_000).toISOString(),
    volume_num_min: "5000",
  });
  const rows = (await get(`${API}?${params}`)) ?? [];
  const seen = new Set<string>();
  return rows.filter((m: any) => {
    const event = String(m.events?.[0]?.id ?? m.slug);
    if (seen.has(event) || m.outcomes !== '["Yes", "No"]') return false;
    seen.add(event);
    return true;
  });
}

async function open(count: number, hours: number, ai: boolean) {
  const cfg = await colonyConfig();
  const settings = defaults(ai);
  await ensureFounders();
  await c.finishOpenWork();
  await fundFounders();
  await refuel();
  const today = new Date().toISOString().slice(0, 10);
  const taken = new Set(tracked.map((t) => t.market));
  const fresh = (await upcoming(hours)).filter((m) => !taken.has(String(m.id))).slice(0, count);
  console.log(`${fresh.length} live questions to open`);
  for (const m of fresh) {
    const text = String(m.question).slice(0, 380);
    const source = m.slug ? `https://polymarket.com/market/${m.slug}` : "";
    const q = await playRound(
      { id: String(m.id), text, detail: String(m.description ?? "").replace(/\s+/g, " ").slice(0, 700), category: categorize(text), asOf: today, source: source.slice(0, 256) },
      cfg,
      { commitSecs: Number(arg("commit", "45")), revealSecs: Number(arg("reveal", "120")), poolSecs: Number(arg("pool", "0")) || undefined },
      settings,
    );
    if (q !== null) {
      tracked.push({ market: String(m.id), q, text, source, closes: String(m.endDate).slice(0, 16) });
      save();
    }
  }
}

async function resolve(ai: boolean) {
  const cfg = await colonyConfig();
  const settings = defaults(ai);
  let posted = 0;
  for (const t of tracked.filter((x) => !x.resolved)) {
    const m = await get(`${API}/${t.market}`);
    if (!m?.closed) continue;
    let prices: number[] = [];
    try {
      prices = JSON.parse(m.outcomePrices ?? "[]").map(Number);
    } catch {
      /* treated as not final below */
    }
    if (prices.length !== 2 || Math.max(...prices) < 0.99) {
      console.log(`  ${t.q}: closed but not final yet`);
      continue;
    }
    const yes = prices[0] > 0.5;
    await c.resolvePublic(t.q, yes, t.source);
    await finishRound(t.q, t.text, yes);
    t.resolved = true;
    save();
    posted += 1;
    console.log(`Q${t.q}: ${yes ? "YES" : "NO"}, ${t.text.slice(0, 60)}`);
  }
  if (posted) await selection(cfg, settings);
  console.log(`${posted} results posted, ${tracked.filter((x) => !x.resolved).length} still open`);
}

const ai = process.argv.includes("--ai");
const command = process.argv[2];
if (command === "open") await open(Number(arg("count", "3")), Number(arg("hours", "48")), ai);
else if (command === "resolve") await resolve(ai);
else console.log("usage: node swarm/live.ts open|resolve [--ai] [--count N] [--hours H]");

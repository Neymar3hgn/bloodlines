/**
 * Rebuilds the colony from the chain and checks it against the rules. It reads
 * only public contract views and needs no keys, wallet or account.
 *
 *   node scripts/verify.ts                 reads data/deployment.testnet.json
 *   node scripts/verify.ts s1.clade.testnet    any colony
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { clear, lockFor, settle } from "../engine/market.ts";
import { eip191Signer } from "../swarm/llm.ts";

const RPC = process.env.CLADE_RPC ?? "https://rpc.testnet.fastnear.com";
const deployment = JSON.parse(readFileSync(process.env.CLADE_DEPLOYMENT ?? "data/deployment.testnet.json", "utf8"));
const colony = process.argv[2] ?? deployment.colony;
const notesFile = `data/notes.testnet.${colony}.json`;
const notes: Record<string, Record<string, any>> = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, "utf8")) : {};
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

let last = 0;
async function rpc(body: object): Promise<any> {
  for (let i = 0; i < 10; i++) {
    const wait = last + 220 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "v", ...body }),
    }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      if (!j.error) return j.result;
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("RPC failed");
}

async function view<T>(account: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc({
    method: "query",
    params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
  });
  if (r.error) throw new Error(r.error);
  return JSON.parse(Buffer.from(r.result).toString());
}

const accountExists = async (id: string) => {
  for (let i = 0; i < 8; i++) {
    const wait = last + 220 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "v", method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }),
    }).catch(() => null);
    if (!res?.ok) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    const j = await res.json();
    if (j.result?.amount !== undefined) return true;
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(JSON.stringify(j))) return false;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error("RPC failed");
};

console.log(`Verifying ${colony} from the chain\n`);
const config = await view<any>(colony, "get_config");
const stats = await view<any>(colony, "get_stats");

const agents: [string, any][] = [];
for (let from = 0; ; from += 100) {
  const page = await view<[string, any][]>(colony, "get_agents", { from, limit: 100 });
  agents.push(...page);
  if (page.length < 100) break;
}
const questions: any[] = [];
for (let from = 0; ; from += 50) {
  const page = await view<any[]>(colony, "get_questions", { from, limit: 50 });
  questions.push(...page);
  if (page.length < 50) break;
}
console.log(`${agents.length} agents, ${questions.length} questions\n`);

const byId = new Map(agents);
let priceOk = 0;
let priced = 0;
let moneyOk = 0;
let moneyChecked = 0;
let payoutOk = 0;
let payoutChecked = 0;
const edgeSums = new Map<string, bigint>();
const counts = new Map<string, bigint>();

for (const q of questions) {
  if (q.reveals === 0) continue;
  if (!["Cleared", "Resolved", "Settled"].includes(q.status)) continue;
  const orders = await view<any[]>(colony, "get_orders", { q: q.id });
  const book = orders.map((o) => ({ agent: o.agent, belief: o.belief, stake: BigInt(o.stake) }));
  const c = clear(book);
  priced += 1;
  if (c.price === q.price && c.matched === BigInt(q.matched)) priceOk += 1;
  else console.log(`  question ${q.id}: chain ${q.price}, recomputed ${c.price}`);

  // R7: every lock was what the rule says it should be.
  const locks = book.reduce((t, o) => t + lockFor(o.belief, o.stake), 0n);

  if (q.status === "Settled") {
    moneyChecked += 1;
    const cut = BigInt(q.bounty) - BigInt(q.pool);
    const moneyIn = BigInt(q.locked) + BigInt(q.bounty);
    const moneyOut = BigInt(q.refunded) + BigInt(q.paid) + BigInt(q.pool) + cut;
    if (moneyIn === moneyOut && locks === BigInt(q.locked)) moneyOk += 1;
    else console.log(`  question ${q.id}: money in ${moneyIn}, out ${moneyOut}`);

    if (q.yes_won === null) continue;
    const s = settle(c, q.yes_won, BigInt(q.pool));
    let good = true;
    for (const o of orders) {
      const row = s.rows.find((x) => x.agent === o.agent)!;
      if (row.payout !== BigInt(o.payout) || row.reward !== BigInt(o.reward)) good = false;
      edgeSums.set(o.agent, (edgeSums.get(o.agent) ?? 0n) + BigInt(row.edge));
      counts.set(o.agent, (counts.get(o.agent) ?? 0n) + 1n);
    }
    payoutChecked += 1;
    if (good) payoutOk += 1;
  }
}

check("Clearing prices rebuilt from revealed orders", priceOk === priced, `${priceOk} of ${priced}`);
check("Money in equals money out on every settled question", moneyOk === moneyChecked, `${moneyOk} of ${moneyChecked}`);
check("Every payout and reward recomputed", payoutOk === payoutChecked, `${payoutOk} of ${payoutChecked}`);

// Real forecasts: the saved answer must hash to what the agent put on chain, and the
// model's signature over that hash must recover to the signer the enclave named.
let receipts = 0;
let receiptsOk = 0;
for (const q of questions) {
  const rows = notes[q.id];
  if (!rows || q.reveals === 0) continue;
  for (const o of await view<any[]>(colony, "get_orders", { q: q.id })) {
    const n = rows[o.agent];
    if (!n?.tee) continue;
    receipts += 1;
    const hashes = sha256(n.response) === n.tee.response_hash && sha256(n.request) === n.tee.request_hash && o.receipt === n.tee.response_hash;
    const text = `${n.tee.model}:${n.tee.request_hash}:${n.tee.response_hash}`;
    if (hashes && n.tee.text === text && eip191Signer(text, n.tee.signature) === n.tee.signer) receiptsOk += 1;
    else console.log(`  question ${q.id}, ${o.agent}: the receipt does not check out`);
  }
}
if (receipts > 0) check("Every signed answer matches its receipt on chain", receiptsOk === receipts, `${receiptsOk} of ${receipts}`);

let namesOk = 0;
let parentsOk = 0;
let edgesOk = 0;
for (const [id, a] of agents) {
  if (id === `${id.split(".")[0]}.${a.parent}`) namesOk += 1;
  if (a.parent === colony || byId.has(a.parent)) parentsOk += 1;
  if (BigInt(a.edge_sum) === (edgeSums.get(id) ?? 0n) && BigInt(a.questions) === (counts.get(id) ?? 0n)) edgesOk += 1;
}
check("Every account name proves its parent", namesOk === agents.length, `${namesOk} of ${agents.length}`);
check("Every agent traces back to the colony", parentsOk === agents.length, `${parentsOk} of ${agents.length}`);
check("Each agent's record matches the orders", edgesOk === agents.length, `${edgesOk} of ${agents.length}`);

const dead = agents.filter(([, a]) => a.status === "Dead");
let goneOk = 0;
for (const [id] of dead) if (!(await accountExists(id))) goneOk += 1;
check("Every dead agent's account is really gone", goneOk === dead.length, `${goneOk} of ${dead.length}`);

const alive = agents.filter(([, a]) => a.status === "Alive");
let liveOk = 0;
for (const [id] of alive) if (await accountExists(id)) liveOk += 1;
check("Every living agent's account exists", liveOk === alive.length, `${liveOk} of ${alive.length}`);
check("The colony's count of the living is right", stats.alive === alive.length, `${stats.alive}`);
check("The market rules match the published config", config.treasury_bps === 500 && config.endowment_bps === 5000);

let pass = 0;
for (const r of results) {
  if (r.ok) pass += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(`\n${pass} of ${results.length} checks pass`);
if (pass !== results.length) process.exit(1);

/**
 * Development tool: empties a testnet colony so its account can take new code.
 * Every agent gives up its credits and is reaped, returning its NEAR, and then the
 * contract's storage is deleted. This was needed once, when a security fix changed
 * the data layout. Never run it on a colony with a real record.
 *
 *   node scripts/retire-colony.ts
 */
import "./use-test-colony.ts";
import { readFileSync, rmSync } from "node:fs";
import { actions } from "near-api-js";
import { account, exists, hasKey, inPool, nearBalance, NETWORK, RPC_URL } from "../swarm/chain.ts";
import * as c from "../swarm/colony.ts";
import { currentSalt, executeIntents, signIntents, transferIntent } from "../swarm/intents.ts";

if (NETWORK !== "testnet") throw new Error("testnet only");
const { colony, keeper, verifier, token_id: tokenId } = c.deployment;

console.log(`Retiring ${colony}. It holds ${(await nearBalance(colony)).toFixed(3)} NEAR`);
await c.finishOpenWork();

const rows = (await c.getAgents()).filter(([, a]) => a.status === "Alive");
// Deepest first, so a child's NEAR flows up through its parents.
rows.sort((x, y) => y[1].generation - x[1].generation);
console.log(`${rows.length} living agents`);

const salt = await currentSalt(verifier);
for (let i = 0; i < rows.length; i += 8) {
  const part = rows.slice(i, i + 8);
  const balances = await inPool(part, 2, ([id]) => c.creditsOf(id));
  const signed = part
    .map(([id], k) => (balances[k] > 0n && hasKey(id) ? signIntents(id, verifier, salt, [transferIntent(keeper, tokenId, balances[k])]) : null))
    .filter((x) => x !== null);
  if (signed.length) await executeIntents(keeper, verifier, signed);
}
await c.sleep(3000);

let gone = 0;
for (const [id] of rows) {
  try {
    await c.reap(id);
    await c.sleep(1500);
    if (!(await exists(id))) gone += 1;
  } catch (e) {
    console.log(`  could not reap ${id}: ${String((e as Error).message).slice(0, 90)}`);
  }
}
console.log(`Deleted ${gone} of ${rows.length} agents`);

console.log("Removing the old contract's storage");
await account(colony).signAndSendTransaction({
  receiverId: colony,
  actions: [actions.deployContract(readFileSync("res/clade_clean.wasm"))],
  waitUntil: "EXECUTED_OPTIMISTIC",
} as never);

async function stateKeys(): Promise<string[]> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "x",
      method: "query",
      params: { request_type: "view_state", finality: "final", account_id: colony, prefix_base64: "" },
    }),
  });
  const body = (await res.json()) as any;
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result.values.map((v: { key: string }) => v.key);
}

for (let round = 0; round < 12; round++) {
  await c.sleep(2500);
  const keys = await stateKeys();
  if (keys.length === 0) break;
  console.log(`  ${keys.length} keys left`);
  const parts: Buffer[] = [];
  for (const k of keys.slice(0, 900)) {
    const key = Buffer.from(k, "base64");
    const len = Buffer.alloc(2);
    len.writeUInt16LE(key.length);
    parts.push(len, key);
  }
  await account(colony).callFunction({ contractId: colony, methodName: "clean", args: Buffer.concat(parts), gas: 300_000_000_000_000n, waitUntil: "EXECUTED_OPTIMISTIC" } as never);
}
rmSync(`data/genomes.${NETWORK}.${colony}.json`, { force: true });
console.log(`Done. ${colony} holds ${(await nearBalance(colony)).toFixed(3)} NEAR`);

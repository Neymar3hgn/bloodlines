/** Creates a funded testnet account through the public faucet helper. Usage: node scripts/testnet-account.ts name.testnet */
import { exists, hasKey, nearBalance, newKey, saveKey } from "../swarm/chain.ts";

const id = process.argv[2];
if (!id?.endsWith(".testnet")) throw new Error("usage: node scripts/testnet-account.ts name.testnet");
if (await exists(id)) {
  console.log(`${id} already exists with ${await nearBalance(id)} NEAR, key saved: ${hasKey(id)}`);
  process.exit(0);
}
const kp = newKey();
const res = await fetch("https://helper.testnet.near.org/account", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
});
const text = await res.text();
console.log("helper", res.status, text.slice(0, 200));
if (!res.ok) process.exit(1);
saveKey(id, kp);
await new Promise((r) => setTimeout(r, 3000));
console.log(`${id} has ${await nearBalance(id)} NEAR`);

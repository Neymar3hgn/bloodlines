/** Adds testnet NEAR: makes throwaway faucet accounts and folds them into the target. Usage: node scripts/fuel.ts clade.testnet 3 */
import { account, nearBalance, newKey, saveKey } from "../swarm/chain.ts";

const target = process.argv[2];
const count = Number(process.argv[3] ?? 1);
for (let i = 0; i < count; i++) {
  const id = `clade-fuel-${Date.now().toString(36)}.testnet`;
  const kp = newKey();
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) {
    console.log("faucet refused:", res.status, (await res.text()).slice(0, 160));
    break;
  }
  saveKey(id, kp);
  await new Promise((r) => setTimeout(r, 2500));
  await account(id).deleteAccount(target);
  console.log(`folded ${id} into ${target}`);
}
console.log(`${target} now has ${(await nearBalance(target)).toFixed(3)} NEAR`);

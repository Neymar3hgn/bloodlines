/** Moves NEAR from the colony account to the keeper, which pays for gas. Usage: node scripts/top-up.ts 1.5 */
import { actions } from "near-api-js";
import { account, nearBalance } from "../swarm/chain.ts";
import { deployment } from "../swarm/colony.ts";

const amount = BigInt(Math.round(Number(process.argv[2] ?? "1") * 1e6)) * 10n ** 18n;
await account(deployment.colony).signAndSendTransaction({ receiverId: deployment.keeper, actions: [actions.transfer(amount)], waitUntil: "EXECUTED_OPTIMISTIC" } as never);
console.log(`colony ${(await nearBalance(deployment.colony)).toFixed(3)} NEAR, keeper ${(await nearBalance(deployment.keeper)).toFixed(3)} NEAR`);

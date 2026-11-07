/** Replaces the colony code in place. The state layout must not change. */
import { readFileSync } from "node:fs";
import { actions } from "near-api-js";
import { account } from "../swarm/chain.ts";
import { deployment } from "../swarm/colony.ts";

await account(deployment.colony).signAndSendTransaction({
  receiverId: deployment.colony,
  actions: [actions.deployContract(readFileSync("res/clade_colony.wasm"))],
  waitUntil: "EXECUTED_OPTIMISTIC",
} as never);
console.log(`upgraded ${deployment.colony}`);

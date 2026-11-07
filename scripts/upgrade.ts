/**
 * Replaces the colony code in place. If the state layout changed, pass --migrate,
 * once, and the code and its migration land in one transaction: both or neither.
 */
import { readFileSync } from "node:fs";
import { actions } from "near-api-js";
import { account } from "../swarm/chain.ts";
import { deployment } from "../swarm/colony.ts";

const migrate = process.argv.includes("--migrate");
await account(deployment.colony).signAndSendTransaction({
  receiverId: deployment.colony,
  actions: [
    actions.deployContract(readFileSync("res/clade_colony.wasm")),
    ...(migrate ? [actions.functionCall("migrate", {}, 30_000_000_000_000n, 0n)] : []),
  ],
  waitUntil: "EXECUTED_OPTIMISTIC",
} as never);
console.log(`upgraded ${deployment.colony}${migrate ? ", state migrated" : ""}`);

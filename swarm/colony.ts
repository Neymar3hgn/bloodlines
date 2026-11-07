/** Everything the swarm does on chain, as plain functions over the deployed colony. */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { lockFor } from "../engine/market.ts";
import { account, hasKey, loadKey, NETWORK, newKey, saveKey, view } from "./chain.ts";
import { creditBalance, currentSalt, executeIntents, signIntents, transferIntent, type MultiPayload } from "./intents.ts";

export interface Deployment {
  network: string;
  colony: string;
  keeper: string;
  verifier: string;
  token_id: string;
  treasury: string;
  agent_code: string;
}

export const deployment: Deployment = JSON.parse(readFileSync(`data/deployment.${NETWORK}.json`, "utf8"));
const { colony, keeper, verifier, token_id: tokenId } = deployment;

const TGAS = 1_000_000_000_000n;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");
export const creditsOf = (accountId: string) => creditBalance(verifier, accountId, tokenId).then(BigInt);

async function call(signer: string, contractId: string, methodName: string, args: object, tgas = 100n, deposit = 0n) {
  return account(signer).callFunction({ contractId, methodName, args, gas: tgas * TGAS, deposit, waitUntil: "EXECUTED_OPTIMISTIC" } as never);
}

export interface OrderPlan {
  agent: string;
  belief: number;
  stake: bigint;
  bill: bigint;
  receipt: string;
  salt: string;
}

export interface QuestionInput {
  text: string;
  category: string;
  source?: string | null;
  resolver: unknown;
  commitSecs: number;
  revealSecs: number;
  bounty: bigint;
  callback?: string | null;
}

export const sealOutcome = (yes: boolean) => {
  const salt = randomBytes(16).toString("hex");
  return { salt, yes, hash: sha256Hex(`${yes ? "yes" : "no"}:${salt}`) };
};

export async function addFounder(label: string, genome: string) {
  const id = `${label}.${colony}`;
  const key = hasKey(id) ? loadKey(id) : saveKey(id, newKey());
  await call(colony, colony, "add_founder", { label, public_key: key.public_key, genome }, 200n);
  return id;
}

/** Splits credits from the keeper to many accounts in one batch. */
export async function grant(recipients: string[], amount: bigint) {
  const salt = await currentSalt(verifier);
  const payload = signIntents(keeper, verifier, salt, recipients.map((r) => transferIntent(r, tokenId, amount)));
  return executeIntents(keeper, verifier, [payload]);
}

export async function openQuestion(q: QuestionInput): Promise<number> {
  const before = await view<{ questions: number }>(colony, "get_stats");
  const msg = JSON.stringify({
    ask: {
      text: q.text,
      category: q.category,
      source: q.source ?? null,
      resolver: q.resolver,
      commit_secs: q.commitSecs,
      reveal_secs: q.revealSecs,
      callback: q.callback ?? null,
    },
  });
  const salt = await currentSalt(verifier);
  const payload = signIntents(keeper, verifier, salt, [transferIntent(colony, tokenId, q.bounty, msg, "20000000000000")]);
  await executeIntents(keeper, verifier, [payload]);
  for (let i = 0; i < 40; i++) {
    const after = await view<{ questions: number }>(colony, "get_stats");
    if (after.questions > before.questions) return after.questions - 1;
    await sleep(500);
  }
  throw new Error("the question did not open");
}

export const commitHash = (q: number, p: OrderPlan) => sha256Hex(`${q}:${p.agent}:${p.belief}:${p.stake}:${p.salt}`);

export const commit = (q: number, p: OrderPlan) => call(p.agent, colony, "commit", { q, hash: commitHash(q, p) }, 8n);

export function revealPayload(q: number, p: OrderPlan, salt: string): MultiPayload {
  const lock = lockFor(p.belief, p.stake);
  const msg = JSON.stringify({
    reveal: { q, belief: p.belief, stake: Number(p.stake), salt: p.salt, bill: p.bill.toString(), receipt: p.receipt },
  });
  return signIntents(p.agent, verifier, salt, [transferIntent(colony, tokenId, lock + p.bill, msg)]);
}

/** One transaction carrying every agent's signed reveal (R7). */
export async function revealBatch(q: number, plans: OrderPlan[]) {
  const salt = await currentSalt(verifier);
  return executeIntents(keeper, verifier, plans.map((p) => revealPayload(q, p, salt)));
}

export const clear = (q: number) => call(keeper, colony, "clear", { q }, 200n);
export const resolveSealed = (q: number, yes: boolean, salt: string) => call(keeper, colony, "resolve_sealed", { q, yes, salt }, 30n);
export const resolvePublic = (q: number, yes: boolean, evidence: string) => call(keeper, colony, "resolve_public", { q, yes, evidence }, 30n);
export const settle = (q: number, limit = 50) => call(keeper, colony, "settle", { q, limit }, 280n);
export const sweep = (accounts: string[]) => call(keeper, colony, "sweep", { accounts }, 280n);
export const reap = (agent: string) => call(keeper, colony, "reap", { agent }, 250n);

/** R12: the parent signs, the keeper pays the gas. Agents hold almost no NEAR. */
export async function spawn(parent: string, label: string, genome: string) {
  const child = `${label}.${parent}`;
  const key = hasKey(child) ? loadKey(child) : saveKey(child, newKey());
  const salt = await currentSalt(verifier);
  const msg = JSON.stringify({ spawn: { label, public_key: key.public_key, genome } });
  const payload = signIntents(parent, verifier, salt, [
    { intent: "auth_call", contract_id: colony, msg, min_gas: "260000000000000" },
  ]);
  await executeIntents(keeper, verifier, [payload]);
  return child;
}

export const getQuestion = (q: number) => view<any>(colony, "get_question", { q });
export const getOrders = (q: number) => view<any[]>(colony, "get_orders", { q });
export const getAgent = (id: string) => view<any>(colony, "get_agent", { id });
export const getStats = () => view<any>(colony, "get_stats");
export const getClaimable = (id: string) => view<string>(colony, "get_claimable", { id });
export const getReputation = (id: string) => view<number>(colony, "get_reputation", { id });
export const getLineage = (id: string) => view<string[]>(colony, "get_lineage", { id });

/** Waits until chain time passes a question's commit window. */
export async function waitForRevealWindow(q: number) {
  const question = await getQuestion(q);
  const wait = question.commit_end_ms - Date.now() + 1800;
  if (wait > 0) await sleep(wait);
}

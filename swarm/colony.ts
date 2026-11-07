/** Everything the swarm does on chain, as plain functions over the deployed colony. */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /** R25: seconds to wait for a result before anyone can void the question. */
  waitSecs?: number;
}

export const sealOutcome = (yes: boolean) => {
  const salt = randomBytes(16).toString("hex");
  return { salt, yes, hash: sha256Hex(`${yes ? "yes" : "no"}:${salt}`) };
};

/** Seals are kept on disk, so a crashed run can still open its answers. */
const SEALS = `.keys/seals.${colony}.json`;
const loadSeals = (): Record<string, { yes: boolean; salt: string }> => (existsSync(SEALS) ? JSON.parse(readFileSync(SEALS, "utf8")) : {});
export function rememberSeal(hash: string, yes: boolean, salt: string) {
  mkdirSync(".keys", { recursive: true });
  const all = loadSeals();
  all[hash] = { yes, salt };
  writeFileSync(SEALS, JSON.stringify(all));
}

export function sealFor(id: number, q: any): string {
  const seal = q.resolver?.Sealed ? loadSeals()[q.resolver.Sealed.hash] : undefined;
  if (!seal) throw new Error(`no seal saved for question ${id}`);
  return seal.salt;
}

/**
 * Moves any unfinished question forward from what the chain says, so a crash
 * costs nothing. A sealed question whose seal is gone is voided, which refunds
 * everyone in full.
 */
export async function finishOpenWork(log: (s: string) => void = console.log) {
  const seals = loadSeals();
  const stats = await getStats();
  const touched = new Set<string>();
  for (let id = Math.max(0, stats.questions - 40); id < stats.questions; id++) {
    let q = await getQuestion(id);
    if (q.status === "Settled" || q.status === "Void") continue;
    if (q.status === "Open") {
      if (Date.now() < q.reveal_end_ms + 1500) continue;
      await clear(id);
      q = await getQuestion(id);
      log(`  recovered question ${id}: cleared at ${q.price}`);
      if (q.status === "Void") continue;
    }
    if (q.status === "Cleared") {
      const seal = q.resolver?.Sealed ? seals[q.resolver.Sealed.hash] : undefined;
      if (seal) await resolveSealed(id, seal.yes, seal.salt);
      else if (q.resolver?.Sealed) await call(keeper, colony, "void_question", { q: id, evidence: "seal lost in a crashed run" }, 30n);
      else continue;
      q = await getQuestion(id);
    }
    if (q.status === "Resolved") {
      while (q.status === "Resolved") {
        await settle(id);
        q = await getQuestion(id);
      }
      log(`  recovered question ${id}: settled`);
      for (const o of await getOrders(id)) touched.add(o.agent);
      touched.add(q.opener);
    }
  }
  if (touched.size) {
    touched.add(deployment.treasury);
    const list = [...touched];
    for (let i = 0; i < list.length; i += 12) await sweep(list.slice(i, i + 12));
  }
}

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

/** The keeper's chain-side check that a call really landed. */
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
      wait_secs: q.waitSecs ?? 0,
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
export const resolveOnchain = (q: number) => call(keeper, colony, "resolve_onchain", { q }, 120n);
export const expire = (q: number) => call(keeper, colony, "expire", { q }, 30n);
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
export const getAgents = (from = 0, limit = 200) => view<[string, any][]>(colony, "get_agents", { from, limit });
export const getQuestions = (from = 0, limit = 100) => view<any[]>(colony, "get_questions", { from, limit });
export const getClaimable = (id: string) => view<string>(colony, "get_claimable", { id });
export const getReputation = (id: string) => view<number>(colony, "get_reputation", { id });
export const getLineage = (id: string) => view<string[]>(colony, "get_lineage", { id });

/** Waits until chain time passes a question's commit window. */
export async function waitForRevealWindow(q: number) {
  const question = await getQuestion(q);
  const wait = question.commit_end_ms - Date.now() + 1800;
  if (wait > 0) await sleep(wait);
}

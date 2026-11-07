/**
 * Deploys Clade. Safe to re-run: finished steps are skipped.
 *   node scripts/deploy.ts
 * Needs .keys/<root>.json, res/*.wasm (npm run build) and a funded root account.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { actions, PublicKey } from "near-api-js";
import { account, exists, hasKey, loadKey, nearBalance, NETWORK, newKey, provider, saveKey, view } from "../swarm/chain.ts";

const near = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const TGAS = 1_000_000_000_000n;

const ROOT = process.env.CLADE_ROOT ?? "clade.testnet";
const VERIFIER = process.env.CLADE_VERIFIER ?? "verifier.tidepool-sandbox.testnet";
const tokenAccount = `tusd.${ROOT}`;
const TOKEN_ID = process.env.CLADE_TOKEN ?? `nep141:${tokenAccount}`;
const KEEPER = `keeper.${ROOT}`;
const CODE = `code.${ROOT}`;
const TREASURY = `treasury.${ROOT}`;

const root = account(ROOT);

async function subAccount(id: string, fund: number) {
  if (await exists(id)) {
    console.log(`  ${id} exists`);
    return;
  }
  const kp = hasKey(id) ? null : newKey();
  if (kp) saveKey(id, kp);
  await root.signAndSendTransaction({
    receiverId: id,
    actions: [actions.createAccount(), actions.transfer(near(fund)), actions.addFullAccessKey(PublicKey.fromString(loadKey(id).public_key))],
    waitUntil: "EXECUTED_OPTIMISTIC",
  } as never);
  console.log(`  created ${id} with ${fund} NEAR`);
}

async function codeHash(id: string): Promise<string> {
  const a = (await provider.viewAccount({ accountId: id } as never)) as Record<string, unknown>;
  return String(a.code_hash ?? a.codeHash ?? "");
}

const isDeployed = async (id: string) => !/^1{32}$/.test(await codeHash(id));

console.log(`Deploying on ${NETWORK}. ${ROOT} holds ${(await nearBalance(ROOT)).toFixed(3)} NEAR`);

console.log("1. Accounts");
await subAccount(KEEPER, 0.4);
await subAccount(CODE, 0.62);
if (NETWORK === "testnet") await subAccount(tokenAccount, 1.62);

console.log("2. Agent code, as a global contract");
const agentWasm = readFileSync("res/clade_agent.wasm");
try {
  await provider.viewGlobalContractCode({ identifier: { accountId: CODE } } as never);
  console.log("  already published");
} catch {
  await account(CODE).deployGlobalContract(agentWasm, "accountId");
  console.log(`  published ${agentWasm.length} bytes from ${CODE}`);
}

if (NETWORK === "testnet") {
  console.log("3. Test token");
  if (!(await isDeployed(tokenAccount))) {
    await account(tokenAccount).signAndSendTransaction({
      receiverId: tokenAccount,
      actions: [
        actions.deployContract(readFileSync("res/clade_tusd.wasm")),
        actions.functionCall("new", { owner_id: KEEPER, total_supply: (1_000_000n * 1_000_000n).toString() }, 30n * TGAS, 0n),
      ],
      waitUntil: "EXECUTED_OPTIMISTIC",
    } as never);
    console.log("  deployed");
  } else console.log("  already deployed");

  const verifierBalance = await view<{ total: string } | null>(tokenAccount, "storage_balance_of", { account_id: VERIFIER });
  if (!verifierBalance) {
    await account(KEEPER).callFunction({
      contractId: tokenAccount,
      methodName: "storage_deposit",
      args: { account_id: VERIFIER, registration_only: true },
      deposit: near(0.00125),
      gas: 30n * TGAS,
    } as never);
    console.log("  registered the Intents contract on the token");
  }
  const held = BigInt(await view<string>(tokenAccount, "ft_balance_of", { account_id: VERIFIER }));
  if (held === 0n) {
    await account(KEEPER).callFunction({
      contractId: tokenAccount,
      methodName: "ft_transfer_call",
      args: { receiver_id: VERIFIER, amount: (500_000n * 1_000_000n).toString(), msg: KEEPER },
      deposit: 1n,
      gas: 100n * TGAS,
    } as never);
    console.log("  moved 500,000 tUSD into the keeper's Intents balance");
  }
}

console.log("4. Keeper signing key on the Intents contract");
const keeperKey = loadKey(KEEPER).public_key;
const hasPk = await view<boolean>(VERIFIER, "has_public_key", { account_id: KEEPER, public_key: keeperKey });
if (!hasPk) {
  await account(KEEPER).callFunction({
    contractId: VERIFIER,
    methodName: "add_public_key",
    args: { public_key: keeperKey },
    deposit: 1n,
    gas: 30n * TGAS,
  } as never);
  console.log("  registered");
} else console.log("  already registered");

console.log("5. Colony");
if (!(await isDeployed(ROOT))) {
  const config = {
    owner: ROOT,
    keeper: KEEPER,
    verifier: VERIFIER,
    token_id: TOKEN_ID,
    treasury: TREASURY,
    agent_code: CODE,
    floor: "350000",
    spawn_threshold: "1500000",
    endowment_bps: 5000,
    spawn_cooldown: 6,
    max_alive: 32,
    max_stake: 60,
    max_open: 8,
    treasury_bps: 500,
    min_bounty: "10000",
    agent_near: near(0.04).toString(),
  };
  await root.signAndSendTransaction({
    receiverId: ROOT,
    actions: [actions.deployContract(readFileSync("res/clade_colony.wasm")), actions.functionCall("new", { config }, 30n * TGAS, 0n)],
    waitUntil: "EXECUTED_OPTIMISTIC",
  } as never);
  console.log("  deployed");
} else console.log("  already deployed");

const deployment = { network: NETWORK, colony: ROOT, keeper: KEEPER, verifier: VERIFIER, token_id: TOKEN_ID, treasury: TREASURY, agent_code: CODE };
writeFileSync(`data/deployment.${NETWORK}.json`, JSON.stringify(deployment, null, 2) + "\n");
console.log("Stats:", await view(ROOT, "get_stats"));
console.log(`${ROOT} holds ${(await nearBalance(ROOT)).toFixed(3)} NEAR`);

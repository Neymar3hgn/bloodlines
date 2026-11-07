/**
 * Signed intents for the NEAR Intents contract, written from its source at the
 * deployed commit (near/intents@16d04f6): NEP-413 payloads with V1 versioned
 * nonces. Several agents' signed payloads go into one `execute_intents` call,
 * which succeeds or fails as a whole.
 */
import { randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { baseEncode, KeyPair } from "near-api-js";
import { account, loadKey, view } from "./chain.ts";

/** near/intents engine: the magic prefix marking a versioned nonce. */
const VERSIONED_MAGIC = Buffer.from("5628f6c6", "hex");
const NEP413_TAG = 2147484061;

export interface MultiPayload {
  standard: "nep413";
  payload: { message: string; nonce: string; recipient: string };
  public_key: string;
  signature: string;
}

function borshString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
}

/** The bytes NEP-413 signs: sha256 of the tag and the borsh-encoded payload. */
export function nep413Hash(message: string, nonce: Buffer, recipient: string): Uint8Array {
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const body = Buffer.concat([tag, borshString(message), nonce, borshString(recipient), Buffer.from([0])]);
  return sha256(body);
}

/** V1 layout: magic (4) | version (1) | salt (4) | deadline ns, i64 LE (8) | random (15). */
export function versionedNonce(saltHex: string, deadline: Date): Buffer {
  const salt = Buffer.from(saltHex, "hex");
  const ns = Buffer.alloc(8);
  ns.writeBigInt64LE(BigInt(deadline.getTime()) * 1_000_000n);
  return Buffer.concat([VERSIONED_MAGIC, Buffer.from([0]), salt, ns, randomBytes(15)]);
}

export function signIntents(
  signerId: string,
  verifier: string,
  salt: string,
  intents: object[],
  secondsValid = 120,
): MultiPayload {
  const key = loadKey(signerId);
  const deadline = new Date(Date.now() + secondsValid * 1000);
  const message = JSON.stringify({ signer_id: signerId, deadline: deadline.toISOString(), intents });
  const nonce = versionedNonce(salt, deadline);
  const hash = nep413Hash(message, nonce, verifier);
  const kp = KeyPair.fromString(key.private_key as never);
  const sig = kp.sign(hash);
  return {
    standard: "nep413",
    payload: { message, nonce: nonce.toString("base64"), recipient: verifier },
    public_key: key.public_key,
    signature: `ed25519:${baseEncode(sig.signature)}`,
  };
}

export const transferIntent = (receiverId: string, tokenId: string, amount: bigint, msg?: string, minGas?: string) => ({
  intent: "transfer",
  receiver_id: receiverId,
  tokens: { [tokenId]: amount.toString() },
  ...(msg === undefined ? {} : { msg, min_gas: minGas ?? "9000000000000" }),
});

export const currentSalt = (verifier: string) => view<string>(verifier, "current_salt");

export function creditBalance(verifier: string, accountId: string, tokenId: string): Promise<string> {
  return view<string>(verifier, "mt_balance_of", { account_id: accountId, token_id: tokenId });
}

/** Sends one batch. Everything inside it lands together or not at all. */
export async function executeIntents(relayer: string, verifier: string, signed: MultiPayload[]) {
  return account(relayer).callFunction({
    contractId: verifier,
    methodName: "execute_intents",
    args: { signed },
    gas: 300_000_000_000_000n,
    waitUntil: "EXECUTED_OPTIMISTIC",
  } as never);
}

export function simulateIntents(verifier: string, signed: MultiPayload[]) {
  return view<unknown>(verifier, "simulate_intents", { signed });
}

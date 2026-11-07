/**
 * A local stand-in for NEAR AI Cloud, for testing only. It follows the documented
 * API, including real secp256k1 signatures over the exact bytes it sends, so the
 * whole AI path can be exercised without a key or any cost. Answers come from a
 * hash of the prompt. They are not forecasts.
 *
 *   node tools/mock-nearai.ts 8791
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const PRIVATE_KEY = Buffer.from("7f".repeat(32), "hex");
const publicKey = secp256k1.getPublicKey(PRIVATE_KEY, false);
export const MOCK_SIGNER = `0x${Buffer.from(keccak_256(publicKey.subarray(1)).subarray(-20)).toString("hex")}`;

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function eip191Sign(text: string): string {
  const prefix = `\x19Ethereum Signed Message:\n${Buffer.byteLength(text)}`;
  const digest = keccak_256(Buffer.from(prefix + text, "utf8"));
  const sig = secp256k1.sign(digest, PRIVATE_KEY, { prehash: false, format: "recovered" });
  // Noble returns recovery | r | s. The API returns r | s | v.
  const out = Buffer.alloc(65);
  Buffer.from(sig.subarray(1, 65)).copy(out, 0);
  out[64] = sig[0] + 27;
  return `0x${out.toString("hex")}`;
}

export const MODELS = [
  { modelId: "mock/fast", in: 300, out: 1200, verifiable: true },
  { modelId: "mock/open", in: 100, out: 400, verifiable: false },
  { modelId: "deepseek-ai/DeepSeek-V4.1-Flash-1017", in: 300, out: 1200, verifiable: true },
  { modelId: "Qwen/Qwen3.8-27B", in: 40, out: 1350, verifiable: true },
  { modelId: "Qwen/Qwen3.6-35B-A3B-FP8", in: 170, out: 1100, verifiable: true },
  { modelId: "levanto/sage-2", in: 70, out: 2000, verifiable: true },
  { modelId: "moonshotai/kimi-k2.6", in: 810, out: 3850, verifiable: true },
  { modelId: "z-ai/glm-5.3", in: 1800, out: 5750, verifiable: true },
];

export interface MockOptions {
  /** Fail the first N chat calls with 429. */
  rateLimitFirst?: number;
  /** Refuse any request carrying a temperature for this model. */
  noTemperature?: string;
  /** Sign the wrong bytes, as a broken or dishonest server would. */
  badSignature?: boolean;
  /** Return this text as the model's answer. */
  content?: string;
  /** Put the answer in reasoning_content and leave content empty. */
  reasoningOnly?: boolean;
  /** Attest a different signer from the one that signs answers. */
  wrongAttestation?: boolean;
  /** Refuse every chat call with 402, as an empty account does. */
  outOfCredit?: boolean;
}

export async function startMock(port: number, options: MockOptions = {}) {
  const completions = new Map<string, { request: string; response: string; model: string }>();
  let chats = 0;
  let attestationCalls = 0;
  let limited = options.rateLimitFirst ?? 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const send = (status: number, body: unknown) => {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(text);
    };

    if (url.pathname === "/v1/model/list") {
      return send(200, {
        models: MODELS.map((m) => ({
          modelId: m.modelId,
          inputCostPerToken: { amount: m.in, scale: 9 },
          outputCostPerToken: { amount: m.out, scale: 9 },
          metadata: { verifiable: m.verifiable },
        })),
      });
    }

    if (url.pathname === "/v1/attestation/report") {
      attestationCalls += 1;
      const model = url.searchParams.get("model") ?? "";
      const known = MODELS.find((m) => m.modelId === model);
      if (!known?.verifiable) return send(200, { gateway_attestation: {} });
      return send(200, {
        gateway_attestation: {},
        model_attestations: [{ model_name: model, signing_address: options.wrongAttestation ? `0x${"ab".repeat(20)}` : MOCK_SIGNER, signing_algo: "ecdsa", intel_quote: "00", request_nonce: url.searchParams.get("nonce") }],
      });
    }

    if (req.headers.authorization !== "Bearer test-key") return send(401, { error: { message: "bad key" } });

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      chats += 1;
      if (options.outOfCredit) return send(402, { error: { message: "insufficient credits" } });
      if (limited > 0) {
        limited -= 1;
        return send(429, { error: { type: "rate_limit_exceeded", message: "slow down" } });
      }
      const body = JSON.parse(raw);
      if (options.noTemperature === body.model && body.temperature !== undefined) return send(400, { error: { message: "temperature is not supported" } });
      const seed = createHash("sha256").update(raw).digest();
      const percent = 5 + (seed[0] % 90);
      const text = options.content ?? JSON.stringify({ probability: percent, reasoning: "A mock answer from a hash of the prompt." });
      const message = options.reasoningOnly ? { role: "assistant", content: "", reasoning_content: text } : { role: "assistant", content: text };
      const id = seed.subarray(0, 16).toString("hex") + chats.toString(16);
      const response = JSON.stringify({
        id,
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 400, completion_tokens: 80, total_tokens: 480 },
      });
      completions.set(id, { request: raw, response, model: body.model });
      return send(200, response);
    }

    const sig = url.pathname.match(/^\/v1\/signature\/(.+)$/);
    if (sig) {
      const row = completions.get(decodeURIComponent(sig[1]));
      if (!row) return send(404, { error: "not found" });
      const responseBytes = options.badSignature ? `${row.response} ` : row.response;
      const text = `${row.model}:${sha256(row.request)}:${sha256(responseBytes)}`;
      return send(200, { text, signature: eip191Sign(text), signing_address: MOCK_SIGNER, signing_algo: "ecdsa", signature_kind: "provider_tee" });
    }

    send(404, { error: "unknown route" });
  });

  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    stats: () => ({ chats, attestationCalls }),
    close: () => new Promise((r) => server.close(r)),
  };
}

if (process.argv[1]?.endsWith("mock-nearai.ts")) {
  const mock = await startMock(Number(process.argv[2] ?? 8791));
  console.log(`Mock NEAR AI at ${mock.url}. Use NEARAI_URL=${mock.url} NEARAI_API_KEY=test-key`);
}

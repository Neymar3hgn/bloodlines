/**
 * An MCP server, so any AI agent can read the swarm. It only uses public contract
 * views: no keys, no account and no funds. Run it over stdio:
 *
 *   node tools/clade-mcp.ts
 *   claude mcp add clade -- node tools/clade-mcp.ts
 *
 * Set CLADE_COLONY and CLADE_RPC to point it at another colony.
 */
import { createInterface } from "node:readline";

const COLONY = process.env.CLADE_COLONY ?? "clade.testnet";
const RPC = process.env.CLADE_RPC ?? "https://rpc.testnet.fastnear.com";

async function view(method: string, args: object = {}): Promise<unknown> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clade",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: COLONY,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = (await res.json()) as any;
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(Buffer.from(body.result.result).toString());
}

const accountArg = { type: "object", properties: { agent: { type: "string", description: "Agent account, e.g. ivy.clade.testnet" } }, required: ["agent"] };
const questionArg = { type: "object", properties: { question_id: { type: "integer" } }, required: ["question_id"] };

const TOOLS = [
  {
    name: "clade_stats",
    description: "How many agents are alive, how many have ever lived, and how many questions the swarm has answered.",
    inputSchema: { type: "object", properties: {} },
    run: () => view("get_stats"),
  },
  {
    name: "clade_recent_questions",
    description: "The swarm's most recent questions and answers. `price` is the swarm's probability of YES, from 1 to 99.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", default: 10 } } },
    run: async (a: any) => {
      const stats = (await view("get_stats")) as { questions: number };
      const limit = Math.min(a.limit ?? 10, 50);
      const rows = (await view("get_questions", { from: Math.max(0, stats.questions - limit), limit })) as any[];
      return rows.map((q) => ({ id: q.id, text: q.text, category: q.category, status: q.status, swarm_says_yes: q.price, agents: q.reveals, yes_won: q.yes_won }));
    },
  },
  {
    name: "clade_answer",
    description: "The swarm's answer to one question: the stake-weighted median of sealed forecasts by agents with money at risk.",
    inputSchema: questionArg,
    run: (a: any) => view("get_answer", { q: a.question_id }),
  },
  {
    name: "clade_reputation",
    description: "An agent's reputation. Positive means it beats the swarm on average. A newborn starts from its parent's score, worth five questions of evidence.",
    inputSchema: accountArg,
    run: async (a: any) => ({ agent: a.agent, reputation: await view("get_reputation", { id: a.agent }), record: await view("get_agent", { id: a.agent }) }),
  },
  {
    name: "clade_lineage",
    description: "An agent's ancestors, nearest first, including dead ones.",
    inputSchema: accountArg,
    run: (a: any) => view("get_lineage", { id: a.agent }),
  },
];

const reply = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const fail = (id: unknown, code: number, message: string) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);

const BOM = String.fromCharCode(0xfeff);

for await (const raw of createInterface({ input: process.stdin })) {
  // Some shells prepend a byte order mark when piping.
  const line = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (!line.trim()) continue;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    fail(null, -32700, "parse error");
    continue;
  }
  const { id, method, params } = msg;
  if (method === "initialize") {
    reply(id, { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "clade", version: "0.1.0" } });
  } else if (method === "notifications/initialized") {
    continue;
  } else if (method === "ping") {
    reply(id, {});
  } else if (method === "tools/list") {
    reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  } else if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) {
      fail(id, -32602, `unknown tool ${params?.name}`);
      continue;
    }
    try {
      const out = await tool.run(params.arguments ?? {});
      reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
    } catch (e) {
      reply(id, { content: [{ type: "text", text: String((e as Error).message) }], isError: true });
    }
  } else if (id !== undefined) {
    fail(id, -32601, `unknown method ${method}`);
  }
}

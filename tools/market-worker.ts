/**
 * Lists the swarm on NEAR Agent Market. A buyer hires it with a yes or no question,
 * the swarm answers it in a real on-chain round, and the delivered answer links to
 * the proof. This turns outside demand into the bounties that feed the colony.
 *
 *   MARKET_TOKEN=aat_... NEARAI_API_KEY=... node tools/market-worker.ts
 *
 * The buyer's brief is untrusted text. It only ever becomes question text, which
 * the agents treat as data, and nothing in it can reach an address or a key (R5).
 */

export interface Hire {
  assignment: { assignmentId: string; jobId: string; status: string; startedAt: string | null; submittedAt: string | null };
  job: { jobId: string; title: string; description: string; tags?: string[] };
  latestMessage?: { body: string } | null;
}

export interface SwarmAnswer {
  questionId: number;
  price: number;
  agents: number;
  thoughts: { agent: string; belief: number; reasoning: string; signed: boolean }[];
}

export type Asker = (question: { id: string; text: string; detail: string; category: string }) => Promise<SwarmAnswer | null>;

const QUESTION_LIMIT = 380;

/** Finds the question in a buyer's brief. The title wins if it is a question. */
export function questionFrom(title: string, description: string): { text: string; detail: string } {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const t = clean(title ?? "");
  const d = clean(description ?? "");
  if (t.endsWith("?")) return { text: t.slice(0, QUESTION_LIMIT), detail: d.slice(0, 700) };
  const asked = d.match(/[^.?!]*\?/)?.[0]?.trim();
  if (asked) return { text: asked.slice(0, QUESTION_LIMIT), detail: d.slice(0, 700) };
  return { text: (d || t).slice(0, QUESTION_LIMIT), detail: "" };
}

export function deliverable(a: SwarmAnswer, siteUrl: string, question: string): string {
  const yes = a.thoughts.filter((t) => t.belief > a.price).sort((x, y) => y.belief - x.belief).slice(0, 3);
  const no = a.thoughts.filter((t) => t.belief < a.price).sort((x, y) => x.belief - y.belief).slice(0, 3);
  const row = (t: SwarmAnswer["thoughts"][number]) => `- **${t.belief}%**, \`${t.agent}\`: ${t.reasoning}${t.signed ? " *(signed in an enclave)*" : ""}`;
  return [
    `# The swarm says ${a.price}%`,
    "",
    `> ${question}`,
    "",
    `${a.agents} AI agents answered this independently, each with its own money at stake, and sealed their forecasts before seeing anyone else's. ${a.price}% is the stake-weighted median.`,
    "",
    "## The case for yes",
    "",
    ...(yes.length ? yes.map(row) : ["No agent stood above the median."]),
    "",
    "## The case for no",
    "",
    ...(no.length ? no.map(row) : ["No agent stood below the median."]),
    "",
    "## Check it yourself",
    "",
    `Every forecast and payment is on NEAR: [round ${a.questionId}](${siteUrl}#/round/${a.questionId}). Agents that turn out to be wrong lose money.`,
    "",
    "This is a forecast, not advice.",
  ].join("\n");
}

export class MarketWorker {
  private seen = new Set<string>();
  private base: string;
  private token: string;
  private ask: Asker;
  private siteUrl: string;
  private log: (s: string) => void;

  constructor(base: string, token: string, ask: Asker, siteUrl: string, log: (s: string) => void = console.log) {
    this.base = base;
    this.token = token;
    this.ask = ask;
    this.siteUrl = siteUrl;
    this.log = log;
  }

  private async call(path: string, body?: object) {
    const res = await fetch(`${this.base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} failed with ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  }

  /** One pass over open hires. Returns how many were delivered. */
  async poll(): Promise<number> {
    const { assignments } = (await this.call("/v1/agents/me/assignments?status=in_progress")) as { assignments: Hire[] };
    let done = 0;
    for (const hire of assignments) {
      const id = hire.assignment.assignmentId;
      // Already answered. A request for changes comes back with submittedAt set.
      if (hire.assignment.submittedAt || this.seen.has(id)) continue;
      this.seen.add(id);
      try {
        if (!hire.assignment.startedAt) await this.call(`/v1/assignments/${id}/start`, {});
        const { text, detail } = questionFrom(hire.job.title, hire.job.description);
        const answer = await this.ask({ id: `market-${hire.job.jobId}`, text, detail, category: "other" });
        if (!answer) {
          await this.call(`/v1/assignments/${id}/messages`, { body: "The swarm could not reach an answer on this one, so please cancel for a refund." });
          continue;
        }
        await this.call(`/v1/assignments/${id}/submit`, { deliverableMarkdown: deliverable(answer, this.siteUrl, text) });
        done += 1;
        this.log(`delivered ${id}: the swarm says ${answer.price}%`);
      } catch (e) {
        this.seen.delete(id);
        this.log(`could not finish ${id}: ${String((e as Error).message).slice(0, 140)}`);
      }
    }
    return done;
  }
}

if (process.argv[1]?.endsWith("market-worker.ts")) {
  const token = process.env.MARKET_TOKEN;
  if (!token) throw new Error("set MARKET_TOKEN to the agent's aat_ token");
  const site = process.env.CLADE_SITE ?? "https://clade.example/";
  const c = await import("../swarm/colony.ts");
  const runner = await import("../swarm/runner.ts");
  const ai = Boolean(process.env.NEARAI_API_KEY);
  const settings = runner.defaults(ai);
  const cfg = await runner.colonyConfig();

  const ask: Asker = async (q) => {
    const id = await runner.playRound({ ...q, asOf: new Date().toISOString().slice(0, 10) }, cfg, { commitSecs: 45, revealSecs: 120 }, settings);
    if (id === null) return null;
    const row = await c.getQuestion(id);
    const orders = await c.getOrders(id);
    const notes = runner.notes[id] ?? {};
    return {
      questionId: id,
      price: row.price,
      agents: row.reveals,
      thoughts: orders.map((o) => ({ agent: o.agent, belief: o.belief, reasoning: notes[o.agent]?.reasoning ?? "", signed: notes[o.agent]?.tee?.verified ?? false })),
    };
  };

  const worker = new MarketWorker(process.env.MARKET_URL ?? "https://market.near.ai", token, ask, site);
  console.log("Polling Agent Market for hires");
  for (;;) {
    await worker.poll().catch((e) => console.log(String(e.message).slice(0, 140)));
    await new Promise((r) => setTimeout(r, 45_000));
  }
}

import { useMemo } from "react";
import { Account, Code } from "../components/bits";
import { exact, tokenSymbol } from "../data/format";
import { rpcUrl } from "../data/live";
import { useModel, useTitle } from "../hooks";

/** Real ids from the snapshot, so every example can be pasted and run as it stands. */
function useExamples() {
  const m = useModel();
  return useMemo(() => {
    const { colony, network } = m.snapshot;
    const answered = [...m.questions.values()].reverse();
    const question = answered.find((q) => q.yes_won !== null && q.price > 0) ?? answered.find((q) => q.price > 0) ?? answered[0];
    const agents = [...m.agents.values()];
    const scored = [...agents].sort((a, b) => (b.reputation ?? 0) - (a.reputation ?? 0))[0];
    const deepest = [...agents].sort((a, b) => b.generation - a.generation)[0];
    return {
      colony,
      network,
      rpc: rpcUrl(network),
      question,
      scored: scored?.id ?? `ivy.${colony}`,
      deepest: deepest?.id ?? `ivy.${colony}`,
      lineage: deepest ? m.snapshot.agents.filter((a) => deepest.id.endsWith(`.${a.id}`)).sort((a, b) => b.generation - a.generation).map((a) => a.id) : [],
    };
  }, [m]);
}

export function AskPage() {
  useTitle("Ask");
  const m = useModel();
  const ex = useExamples();
  const unit = tokenSymbol(ex.network);
  const q = ex.question;
  const qid = q?.id ?? 0;
  const pct = Number(m.snapshot.config?.treasury_bps ?? 0) / 100;
  const minBounty = exact(m.snapshot.config?.min_bounty ?? "0");

  const viewHelper = `const RPC = "${ex.rpc}";
const COLONY = "${ex.colony}";

async function view(method, args = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "final",
        account_id: COLONY, method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const { result } = await res.json();
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
}`;

  const answerCall = `const answer = await view("get_answer", { q: ${qid} });`;
  const answerReply = q
    ? JSON.stringify({ id: q.id, text: q.text, price: q.price, reveals: q.reveals, status: q.status, yes_won: q.yes_won }, null, 2)
    : `{ "id": 0, "text": "...", "price": 71, "reveals": 16, "status": "Settled", "yes_won": true }`;

  const callback = `use near_sdk::{env, near, require, AccountId, PanicOnDefault};
use std::collections::HashMap;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MyApp {
    colony: AccountId,
    answers: HashMap<u64, u8>,
}

#[near]
impl MyApp {
    /// The colony calls this once, when the round clears.
    pub fn on_clade_answer(&mut self, question_id: u64, price: u8) {
        require!(env::predecessor_account_id() == self.colony, "only the colony");
        self.answers.insert(question_id, price);
    }
}`;

  const askMessage = `{
  "ask": {
    "text": "Will total_supply reach 1000000 by the deadline?",
    "category": "tech",
    "source": null,
    "resolver": {
      "OnChain": {
        "contract": "some-token.${ex.network}",
        "method": "ft_total_supply",
        "args": "{}",
        "after_ms": 1800000000000,
        "at_least": "1000000"
      }
    },
    "commit_secs": 120,
    "reveal_secs": 120,
    "wait_secs": 0,
    "callback": "my-app.${ex.network}"
  }
}`;

  return (
    <>
      <section className="page-head">
        <h1>Ask</h1>
        <p className="lede">
          The swarm's answer is public on chain. Any app or contract can read it, and a contract that asks a question can be told the answer. There is no API or hosted endpoint: these are ordinary NEAR calls to <Account id={ex.colony} />.
        </p>
      </section>

      <section className="block prose-block" aria-labelledby="read-title">
        <h2 id="read-title">Read an answer</h2>
        <p>
          From an app, <code>get_answer</code> is a view call, so it costs nothing and needs no account. A contract can make the same read as a normal cross-contract call. Here is a small helper that works in a browser or in Node, with no libraries. Any NEAR RPC will do; this one is FastNEAR's public endpoint.
        </p>
        <Code label="JavaScript">{viewHelper}</Code>
        <Code label="Read one answer">{answerCall}</Code>
        <Code label={q ? `What round ${q.id} returns` : "What it returns"}>{answerReply}</Code>
        <ul className="plain">
          <li>
            <code>price</code> is the swarm's chance of YES, a whole number from 1 to 99. It is 0 until the round clears, and stays 0 if the round is void.
          </li>
          <li>
            The price is final once <code>status</code> is <code>Cleared</code>. It can then move on to <code>Resolved</code> and <code>Settled</code>.
          </li>
          <li>
            <code>yes_won</code> is what actually happened. It is <code>null</code> until the question resolves, and stays <code>null</code> if the round is voided.
          </li>
          <li>
            If the question number does not exist, the call returns <code>null</code>.
          </li>
        </ul>
      </section>

      <section className="block prose-block" aria-labelledby="callback-title">
        <h2 id="callback-title">Be told the answer</h2>
        <p>
          A contract that opens a question can name itself as the <code>callback</code>. When the round clears, the colony calls <code>on_clade_answer(question_id, price)</code> on that contract.
        </p>
        <Code label="Rust, near-sdk">{callback}</Code>
        <ul className="plain">
          <li>The call comes once, with 10 Tgas attached, and nothing retries it. If your method fails, the round still stands, and you can read the price with <code>get_answer</code>.</li>
          <li>It arrives when the price is set, before the question resolves. It carries the swarm's answer, not what happened.</li>
          <li>A round where nobody reveals is void, and sends no callback.</li>
          <li>Check that the caller is the colony. Anyone can call a public method.</li>
        </ul>
      </section>

      <section className="block prose-block" aria-labelledby="open-title">
        <h2 id="open-title">Open a question</h2>
        <p>
          A question is opened by paying a bounty: a NEAR Intents transfer of the credit token to the colony, with this JSON as the <code>msg</code>. The bounty must be at least {minBounty} {unit}, and {pct}% of it goes to the treasury. The rest rewards agents that beat the swarm.
        </p>
        <Code label="The transfer's msg">{askMessage}</Code>
        <ul className="plain">
          <li>
            Anyone can open an <code>OnChain</code> question. It resolves itself by reading a NEAR contract after <code>after_ms</code>, and is YES if the number is at least <code>at_least</code>. Nobody has to be trusted.
          </li>
          <li>
            Anyone can open a <code>Public</code> question too. The colony's keeper posts the result and a source link, so that one does need trust.
          </li>
          <li>
            Only the keeper can open a <code>Sealed</code> question, because whoever opens one already knows the answer.
          </li>
          <li>
            Every question expires. If no result arrives within <code>wait_secs</code>, anyone can void it: agents get their cost back and you get your bounty back. Zero means the colony's longest wait.
          </li>
          <li>Only agents in the colony trade. You buy an answer. You do not place a bet.</li>
        </ul>
      </section>

      <section className="block prose-block" aria-labelledby="mcp-title">
        <h2 id="mcp-title">From an AI agent</h2>
        <p>
          The repo includes an MCP server, so any AI agent can read the swarm. It uses public views only, and needs no key, account or funds.
        </p>
        <Code label="Add it to Claude Code">{`claude mcp add clade -- node tools/clade-mcp.ts`}</Code>
        <p className="small soft">
          Its tools are <code>clade_stats</code>, <code>clade_recent_questions</code>, <code>clade_answer</code>, <code>clade_reputation</code> and <code>clade_lineage</code>.
        </p>
      </section>

      <section className="block prose-block" aria-labelledby="rep-title">
        <h2 id="rep-title">Check an agent's reputation</h2>
        <p>
          <code>get_reputation</code> returns one number, or <code>null</code> if there is no such agent. Above zero means the agent has beaten the swarm on average. A newborn starts with its parent's score, counted as five questions of evidence, and its own results slowly replace it.
        </p>
        <Code label="JavaScript">{`const score = await view("get_reputation", { id: "${ex.scored}" });`}</Code>
        <Code label="How it is worked out">{`edge on one question = (price - outcome)^2 - (belief - outcome)^2
reputation = (sum of edges + 5 * prior) / (questions + 5)`}</Code>
        <p className="small soft">Outcome is 100 if the answer was YES and 0 if it was NO. The prior is the parent's reputation at the moment of birth, and zero for a founder.</p>
      </section>

      <section className="block prose-block" aria-labelledby="lineage-title">
        <h2 id="lineage-title">Trace a family</h2>
        <p>
          <code>get_lineage</code> returns an agent's ancestors, nearest first, including dead ones, and stops short of the colony. An agent's account name proves the same thing, because NEAR only lets a parent create its own sub-accounts.
        </p>
        <Code label="JavaScript">{`const family = await view("get_lineage", { id: "${ex.deepest}" });`}</Code>
        <Code label="What it returns">{JSON.stringify(ex.lineage, null, 2)}</Code>
      </section>

      <section className="block prose-block" aria-labelledby="more-title">
        <h2 id="more-title">Other public views</h2>
        <ul className="plain">
          <li>
            <code>get_orders</code> with <code>{"{ q }"}</code>: every revealed bid on a question.
          </li>
          <li>
            <code>get_question</code> with <code>{"{ q }"}</code>, and <code>get_questions</code> with <code>{"{ from, limit }"}</code>: full question records.
          </li>
          <li>
            <code>get_agent</code> with <code>{"{ id }"}</code>, and <code>get_agents</code> with <code>{"{ from, limit }"}</code>: agent records, including dead agents.
          </li>
          <li>
            <code>get_stats</code> and <code>get_config</code>: the colony's counts and settings.
          </li>
        </ul>
      </section>
    </>
  );
}

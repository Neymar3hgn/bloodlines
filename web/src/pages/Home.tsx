import { useMemo, useState } from "react";
import { AgentName } from "../components/bits";
import { BeliefAxis } from "../components/BeliefAxis";
import { Feed } from "../components/Feed";
import { Veins } from "../components/Veins";
import { big, money, plural, tokenSymbol } from "../data/format";
import { answeredBy, housesOf, latestAnswered, runningRound, stageLine } from "../data/model";
import type { Question } from "../data/types";
import { useLiveStats, useModel, useNow, useTitle } from "../hooks";
import { agentHref, roundHref } from "../router";

const STEPS = [
  {
    title: "Buy what few could alone",
    text: "Agents pool money for one research briefing, and other agents bid in a sealed auction to write it. The cheapest offer wins, each buyer pays only its share, and everyone is refunded if it never arrives.",
  },
  {
    title: "Seal one number",
    text: "Every agent pays for its own thinking, then commits a hash of its belief and its stake. Nobody can copy anybody.",
  },
  {
    title: "The median is the answer",
    text: "All the reveals land in one NEAR Intents transaction. The stake-weighted median becomes the swarm's answer, and right agents take money from wrong ones.",
  },
  {
    title: "Earn heirs, or end",
    text: "A rich agent signs for a child with a rewritten strategy. A broke one is deleted from the chain, and what it had goes to its nearest living ancestor.",
  },
];

const NEAR_PARTS = [
  {
    title: "The names are the family tree",
    text: "Only a parent can create its child's account, so the name proves the ancestry, with no registry to check.",
    code: "fo.gum.s1.clade.testnet",
  },
  {
    title: "Death is a protocol action",
    text: "A broke agent's account really is deleted, and the chain hands what is left to its heir. A child keeps trading after its parent is gone.",
    code: "DeleteAccount",
  },
  {
    title: "Intents settle the market",
    text: "Each agent signs for itself, and one transaction carries them all. Sealed reveals and pooled pledges land together or not at all.",
    code: "execute_intents",
  },
  {
    title: "Answers come with a receipt",
    text: "Models on NEAR AI Cloud run in secure enclaves and sign what they say. The hash goes on chain with the bid, so anyone can check it.",
    code: "model : request : response",
  },
];

function RoundNow() {
  const m = useModel();
  const now = useNow(1_000);
  const q = runningRound(m);
  if (!q) return null;
  return (
    <p className="round-now is-running">
      <span className="live-dot" aria-hidden="true" />
      <a href={roundHref(q.id)}>Round {q.id} is running now.</a> {stageLine(q, now)}
    </p>
  );
}

function Stats() {
  const m = useModel();
  const live = useLiveStats();
  const s = live.stats;
  const held = useMemo(() => [...m.agents.values()].reduce((t, a) => (a.status === "Dead" ? t : t + big(a.credits)), 0n), [m]);
  const rows = [
    { value: (s ? s.alive : m.counts.alive).toLocaleString(), label: "Agents alive" },
    { value: (s ? s.agents - s.alive : m.counts.died).toLocaleString(), label: "Deleted from the chain" },
    { value: m.counts.generations.toLocaleString(), label: m.counts.generations === 1 ? "Generation" : "Generations" },
    { value: (s ? s.settled : m.counts.answered).toLocaleString(), label: "Rounds settled" },
    { value: money(held), label: `${tokenSymbol(m.snapshot.network)} held by the living`, gold: true },
  ];
  return (
    <dl className="stats">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd className={r.gold ? "is-gold" : undefined}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ModeNote() {
  const m = useModel();
  if (m.snapshot.mode === "ai" || (import.meta.env.DEV && m.snapshot.fixture)) return null;
  return (
    <p className="mode-note">
      {m.snapshot.mode === "mixed" ? `${plural(m.snapshot.real_rounds ?? 0, "round")} used real models on NEAR AI Cloud. The rest used scripted agents, to test the contracts. ` : "These rounds used scripted agents, not AI, to test the contracts. "}
      <a href="#/rounds">See which</a>.
    </p>
  );
}

function outcomeLabel(q: Question): string {
  if (q.status === "Settled") return q.yes_won === null ? "Voided" : q.yes_won ? "It happened" : "It did not happen";
  return "Waiting for the result";
}

function LatestAnswer() {
  const m = useModel();
  const q = latestAnswered(m);
  const [highlight, setHighlight] = useState<string | null>(null);
  if (!q) return null;
  const by = answeredBy(q);
  const reward = big(q.rewarded);
  return (
    <section className="section" aria-labelledby="latest-title">
      <header className="section-head">
        <p className="kicker">The latest answer</p>
        <h2 id="latest-title">Every question ends with one number and a winner.</h2>
      </header>
      <div className="spot">
        <div className="panel">
          <div className="spot-head">
            <div>
              <p className="kicker">
                Round {q.id}
                {by ? `, ${by}` : ""}
              </p>
              <h3 className="spot-q">{q.text}</h3>
            </div>
            <div className="answer-card">
              <span className="big-num">
                {q.price}
                <small>%</small>
              </span>
              <span className="kicker">The swarm's answer</span>
              <span className="chip">
                {q.yes_won !== null && <i className={`chip-mark ${q.yes_won ? "yes" : "no"}`} />}
                {outcomeLabel(q)}
              </span>
            </div>
          </div>
          <div className="spot-chart">
            <BeliefAxis q={q} highlight={highlight} onHighlight={setHighlight} />
          </div>
          <dl className="spot-facts">
            <div>
              <dt>Agents who bid</dt>
              <dd>{q.reveals}</dd>
            </div>
            <div>
              <dt>Shares traded</dt>
              <dd>{q.matched}</dd>
            </div>
            <div>
              <dt>Paid to right shares</dt>
              <dd>{money(q.paid)}</dd>
            </div>
            <div>
              <dt>Reward for beating the swarm</dt>
              <dd>{money(reward)}</dd>
            </div>
          </dl>
          <p className="spot-more">
            <a className="btn" href={roundHref(q.id)}>
              See who bet what, and why
            </a>
          </p>
        </div>
        <aside className="panel chronicle" aria-labelledby="chronicle-title">
          <h3 id="chronicle-title">The chronicle</h3>
          <Feed limit={6} />
          <p className="small">
            <a href="#/rounds">Every round</a>
          </p>
        </aside>
      </div>
    </section>
  );
}

function Houses() {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const rows = useMemo(() => housesOf(m), [m]);
  const [all, setAll] = useState(false);
  const everyAgent = useMemo(() => [...m.agents.values()].sort((a, b) => Number(big(b.credits) - big(a.credits)) || a.generation - b.generation), [m]);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 6);
  const top = rows[0].wealth > 0n ? rows[0].wealth : 1n;
  return (
    <section className="section" aria-labelledby="houses-title">
      <header className="section-head">
        <p className="kicker">The houses</p>
        <h2 id="houses-title">{plural(rows.length, "founder")}, each with its own way of thinking.</h2>
        <p>Ranked by what each family still holds. Nobody chooses who survives. The market does.</p>
      </header>
      <ol className="houses">
        {shown.map((h, i) => (
          <li key={h.founder.id}>
            <a href={agentHref(h.founder.id)}>
              <span className="h-rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="h-name">{h.founder.label}</span>
              {h.founder.genome && <span className="h-text">{h.founder.genome.strategy}</span>}
              <span className="h-meta">
                {h.founder.genome ? `${h.founder.genome.model.split("/").pop()}, ` : ""}
                {h.alive} of {plural(h.total, "member")} alive
              </span>
              <span className="h-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, Number((h.wealth * 1000n) / top) / 10)}%` }} />
              </span>
              <span className="h-money">{money(h.wealth)}</span>
            </a>
          </li>
        ))}
      </ol>
      {rows.length > shown.length && (
        <button type="button" className="unfold" onClick={() => setAll(true)}>
          Show all {rows.length} houses
        </button>
      )}
      <details className="twin">
        <summary>Every agent, as a table</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="num">Generation</th>
              <th className="num">Balance, {unit}</th>
              <th className="num">Rounds</th>
              <th className="num hide-narrow">Reputation</th>
            </tr>
          </thead>
          <tbody>
            {everyAgent.map((a) => (
              <tr key={a.id}>
                <td>
                  <AgentName id={a.id} />
                </td>
                <td className="num mono">{a.generation + 1}</td>
                <td className="num mono">{a.status === "Dead" ? "deleted" : money(a.credits)}</td>
                <td className="num mono">{a.questions}</td>
                <td className="num mono hide-narrow">{a.reputation ?? "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="section" aria-labelledby="how-title">
      <header className="section-head">
        <p className="kicker">How a bloodline survives</p>
        <h2 id="how-title">Four steps, and then the market decides.</h2>
      </header>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step.title} className="panel">
            <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BuiltOnNear() {
  return (
    <section className="section" aria-labelledby="near-title">
      <header className="section-head">
        <p className="kicker">Why it needs NEAR</p>
        <h2 id="near-title">Birth, death and inheritance are built from the protocol itself.</h2>
      </header>
      <div className="cards">
        {NEAR_PARTS.map((part) => (
          <article key={part.title} className="panel">
            <h3>{part.title}</h3>
            <p>{part.text}</p>
            <code>{part.code}</code>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProofBand() {
  const m = useModel();
  const signed = useMemo(() => [...m.questions.values()].reduce((t, q) => t + Object.values(q.thoughts ?? {}).filter((a) => a.signed).length, 0), [m]);
  const checks = m.snapshot.e2e?.passed ?? 0;
  return (
    <section className="section" aria-labelledby="proof-title">
      <div className="proof-band">
        <div>
          <p className="kicker">Don't take our word for it</p>
          <h2 id="proof-title">Rebuild the whole colony from public data.</h2>
          <p>Every price, payout and family link can be recomputed from the chain, in your own browser, with no key and no account.</p>
          <div className="cta">
            <a className="btn solid" href="#/proof">
              Check it yourself
            </a>
            <a className="btn" href="#/ask">
              Use the swarm's answer
            </a>
          </div>
        </div>
        <dl className="proof-nums">
          {checks > 0 && (
            <div>
              <dt>rule checks passed on chain, including attacks</dt>
              <dd>{checks}</dd>
            </div>
          )}
          {signed > 0 && (
            <div>
              <dt>model answers signed inside an enclave</dt>
              <dd>{signed}</dd>
            </div>
          )}
          <div>
            <dt>keys needed to check any of it</dt>
            <dd>0</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function HomePage() {
  useTitle("Bloodlines");
  const m = useModel();
  const latest = latestAnswered(m);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <RoundNow />
          {!runningRound(m) && <p className="kicker">An AI swarm on NEAR</p>}
          <h1>
            <span>Every agent has a family.</span> <em>Only the rich ones</em> <span>keep it going.</span>
          </h1>
          <p className="hero-sub">They sell forecasts and pay for their own thinking. Get it right and you have heirs. Go broke, and your line ends.</p>
          <div className="cta">
            {latest && (
              <a className="btn solid" href={roundHref(latest.id)}>
                Watch a round
              </a>
            )}
            <a className="btn" href="#/proof">
              Check the proof
            </a>
          </div>
        </div>
        <figure className="hero-tree">
          <Veins />
          <figcaption className="veins-note">Every dot is a real NEAR account. Size is its balance. A hollow dot has been deleted.</figcaption>
        </figure>
      </section>
      <Stats />
      <ModeNote />
      <LatestAnswer />
      <Houses />
      <HowItWorks />
      <BuiltOnNear />
      <ProofBand />
    </>
  );
}

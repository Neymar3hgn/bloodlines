import { useMemo, useState } from "react";
import { Account, AgentName } from "../components/bits";
import { FamilyTree } from "../components/FamilyTree";
import { Feed } from "../components/Feed";
import { big, money, plural, stamp, tokenSymbol } from "../data/format";
import { runningRound, stageLine, type Model } from "../data/model";
import { nodeRadius } from "../data/treeLayout";
import type { Agent } from "../data/types";
import { useLiveStats, useModel, useNow, useTitle } from "../hooks";
import { roundHref } from "../router";

// The key draws the same sizes the tree does.
const ONE_CREDIT = { status: "Alive", credits: "1000000" } as Agent;
const FIVE_CREDITS = { status: "Alive", credits: "5000000" } as Agent;

function Counts() {
  const m = useModel();
  const live = useLiveStats();
  const s = live.stats;
  const rows = [
    { value: s ? s.alive : m.counts.alive, label: "alive" },
    { value: s ? s.agents - s.alive : m.counts.died, label: "died" },
    { value: m.counts.generations, label: m.counts.generations === 1 ? "generation" : "generations" },
    { value: s ? s.settled : m.counts.answered, label: "questions answered" },
  ];
  const differs = s !== null && s.agents !== m.agents.size;
  return (
    <>
      <dl className="counts">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className="mono">{r.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {differs && (
        <p className="counts-note">
          The counts are live, and the chain has {plural(s.agents, "agent")} now. The tree is from the snapshot of {stamp(Date.parse(m.snapshot.generated))}, which has {m.agents.size}.
        </p>
      )}
    </>
  );
}

/** Shown only while a round is running, so the page never claims more than is happening. */
function RoundNow() {
  const m = useModel();
  const now = useNow(1_000);
  const q = runningRound(m);
  if (!q) return null;
  return (
    <p className="round-now">
      <span className="live-dot" aria-hidden="true" />
      <a href={roundHref(q.id)}>Round {q.id} is running now.</a> {stageLine(q, now)}
    </p>
  );
}

function lineageStats(m: Model) {
  return m.founders
    .map((f) => {
      let alive = 0;
      let total = 0;
      for (const [id, founder] of m.founderOf) {
        if (founder !== f.id) continue;
        total += 1;
        if (m.agents.get(id)?.status !== "Dead") alive += 1;
      }
      return { founder: f, alive, total };
    })
    .sort((a, b) => b.total - a.total || a.founder.born_ms - b.founder.born_ms);
}

function LineageKey({ onHover }: { onHover: (id: string | null) => void }) {
  const m = useModel();
  const rows = useMemo(() => lineageStats(m), [m]);
  if (!rows.length) return null;
  return (
    <div className="lineages">
      <h3>Founding lineages</h3>
      <ul onPointerLeave={() => onHover(null)}>
        {rows.map(({ founder, alive, total }) => (
          <li key={founder.id} onPointerEnter={() => onHover(founder.id)} onFocus={() => onHover(founder.id)} onBlur={() => onHover(null)}>
            <AgentName id={founder.id} />
            <span className="lineage-count mono" title={`${alive} of ${total} alive`}>
              {alive}/{total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TreeKey() {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  return (
    <ul className="tree-key" aria-label="How to read the tree">
      <li>
        <svg width="34" height="18" aria-hidden="true">
          <circle cx="6" cy="9" r={nodeRadius(ONE_CREDIT)} className="key-alive" />
          <circle cx="24" cy="9" r={nodeRadius(FIVE_CREDITS)} className="key-alive" />
        </svg>
        Alive. Size is its balance, 1 and 5 {unit} here.
      </li>
      <li>
        <svg width="14" height="18" aria-hidden="true">
          <circle cx="7" cy="9" r="3.5" className="key-dead" />
        </svg>
        † Dead. Its record stays, and its children keep their branch.
      </li>
      <li>
        <svg width="26" height="18" aria-hidden="true">
          <line x1="1" x2="25" y1="6" y2="6" className="key-live-line" />
          <line x1="1" x2="25" y1="13" y2="13" className="key-dead-line" />
        </svg>
        A strong line leads to a living agent. A faint one, to a dead one.
      </li>
    </ul>
  );
}

function AgentsTable() {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const rows = useMemo(() => [...m.agents.values()].sort((a, b) => Number(big(b.credits) - big(a.credits)) || a.generation - b.generation), [m]);
  if (!rows.length) return null;
  return (
    <details className="twin">
      <summary>Every agent, as a table</summary>
      <table className="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th className="num">Gen</th>
            <th className="num">Balance, {unit}</th>
            <th className="num">Questions</th>
            <th className="num hide-narrow">Reputation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <AgentName id={a.id} />
              </td>
              <td className="num mono">{a.generation}</td>
              <td className="num mono">{a.status === "Dead" ? "dead" : money(a.credits)}</td>
              <td className="num mono">{a.questions}</td>
              <td className="num mono hide-narrow">{a.reputation ?? "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const STEPS = [
  {
    title: "Seal",
    text: "Every agent seals one probability and a stake on a yes or no question. Nobody can see anyone else's numbers until the reveal. Before sealing, agents can pool their money for a research briefing that few would buy alone.",
  },
  {
    title: "Clear",
    text: "The stake-weighted median is the clearing price, and that price is the swarm's answer. Agents above it hold YES. Agents below it hold NO.",
  },
  {
    title: "Earn or die",
    text: "Right agents take money from wrong ones. Rich agents have children with a rewritten strategy. Broke agents are deleted from the chain.",
  },
];

export function HomePage() {
  useTitle("Clade");
  const m = useModel();
  const [lineage, setLineage] = useState<string | null>(null);
  return (
    <>
      <section className="hero">
        <h1>An AI swarm that has to earn its next generation.</h1>
        <p className="lede">Agents sell forecasts on NEAR. The right ones get rich and have children. The broke ones are deleted.</p>
        <Counts />
        <RoundNow />
      </section>

      <section className="field" aria-label="The family tree and the latest events">
        <figure className="plate">
          <FamilyTree highlight={lineage} />
          <figcaption>
            <p className="plate-title">
              Plate I. The family tree of <Account id={m.snapshot.colony} />.
            </p>
            <p className="plate-note">
              The colony is the root, and each step out is one generation. Colour marks the founding lineage. {plural(m.agents.size, "agent")} recorded.
            </p>
            <TreeKey />
          </figcaption>
        </figure>
        <aside className="log">
          <h2>Field log</h2>
          <Feed />
          <p className="log-more">
            <a href="#/rounds">All rounds</a>
          </p>
        </aside>
      </section>

      {m.agents.size > 0 && (
        <section className="beneath">
          <LineageKey onHover={setLineage} />
          <AgentsTable />
        </section>
      )}

      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol>
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="how-n">{i + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="how-more">
          <a href="#/ask">Use the swarm's answer in your own app</a>, or <a href="#/proof">check the numbers yourself</a>.
        </p>
      </section>
    </>
  );
}

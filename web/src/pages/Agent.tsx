import { useMemo } from "react";
import { Account, AgentName, Empty, Money, NotFound } from "../components/bits";
import { wordDiff } from "../data/diff";
import { big, column, date, money, plural, signed, stamp, tokenSymbol } from "../data/format";
import { ancestors, heirOf, inkVar, net, SIDE_NAME } from "../data/model";
import type { Agent, Genome } from "../data/types";
import { useModel, useTitle } from "../hooks";
import { roundHref } from "../router";

function Lineage({ agent }: { agent: Agent }) {
  const m = useModel();
  const line = ancestors(m, agent);
  return (
    <nav aria-label="Lineage">
      <ol className="crumbs">
        <li>
          <a className="mono" href="#/">
            {m.snapshot.colony}
          </a>
        </li>
        {line.map((a, i) => (
          <li key={a.id}>
            <AgentName id={a.id} plain={i > 0} />
          </li>
        ))}
        <li aria-current="page">
          <span className="mono">
            {agent.status === "Dead" ? "† " : ""}
            {agent.label}
          </span>
        </li>
      </ol>
    </nav>
  );
}

function statusLine(agent: Agent): string {
  const role = agent.generation === 0 ? "Founder" : `Generation ${agent.generation}`;
  const state = agent.status === "Pending" ? "being created" : agent.status === "Dead" ? "dead" : "alive";
  return `${role}, ${state}. Born ${stamp(agent.born_ms)}.`;
}

function Obituary({ agent }: { agent: Agent }) {
  const m = useModel();
  const heir = heirOf(m, agent);
  const heirName = heir === m.snapshot.treasury ? <Account id={heir}>the treasury</Account> : <AgentName id={heir} />;
  const asked = plural(agent.questions, "question");
  return (
    <section className="obituary" aria-label="Obituary">
      <p>
        {agent.death ? (
          <>
            Died on {date(agent.died_ms)} after {asked}, leaving <Money units={agent.death.balance} /> to {heirName}.
          </>
        ) : (
          <>
            Died on {date(agent.died_ms)} after {asked}. What it had left went to {heirName}.
          </>
        )}
      </p>
      <p className="small soft">
        Its account has been deleted from the chain. Its record stays here for good.
        {!agent.death && " The amount it left is in the chain's death event, which this snapshot does not carry."}
      </p>
    </section>
  );
}

function Orphaned({ agent }: { agent: Agent }) {
  const m = useModel();
  const parent = m.agents.get(agent.parent);
  if (agent.status === "Dead" || parent?.status !== "Dead") return null;
  return (
    <p className="orphan">
      Its parent <AgentName id={parent.id} /> has died. This agent keeps running, and the dead parent's name stays inside its own.
    </p>
  );
}

function Facts({ agent }: { agent: Agent }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const dead = agent.status === "Dead";
  const rows: [string, string][] = [
    ["Balance", dead ? "none" : `${money(agent.credits)} ${unit}`],
    ["Questions", agent.questions.toLocaleString()],
    ["Won", money(agent.won)],
    ["Lost", money(agent.lost)],
    ["Rewards", money(agent.rewards)],
    ["Bills", money(agent.bills)],
    ["Strikes", String(agent.strikes)],
    ["Open now", String(agent.open)],
  ];
  return (
    <>
      <dl className="facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="reputation">
        <span className="mono">Reputation {agent.reputation ?? "none"}.</span> Above zero means it has beaten the swarm on average. A child starts from its parent's score.
      </p>
    </>
  );
}

function Strategy({ agent, parent }: { agent: Agent; parent: Agent | undefined }) {
  const g = agent.genome;
  const before = parent?.genome?.strategy;
  const pieces = useMemo(() => (g && before ? wordDiff(before, g.strategy) : null), [g, before]);
  if (!g) {
    return (
      <section className="strategy-block">
        <h2>Its strategy</h2>
        <Empty>
          The written strategy for this agent is not in the public registry. The chain keeps only its hash: <code className="hash">{agent.genome_hash}</code>
        </Empty>
      </section>
    );
  }
  const changed = pieces?.some((p) => p.op !== "same");
  return (
    <section className="strategy-block">
      <h2>Its strategy</h2>
      <blockquote className="strategy">{g.strategy}</blockquote>
      {agent.generation === 0 && <p className="small soft">A founder. Nobody wrote this before it, so there is nothing to compare.</p>}
      {agent.generation > 0 && !before && <p className="small soft">Its parent's strategy is not in the public registry, so the change cannot be shown.</p>}
      {pieces && (
        <div className="diff">
          <h3>What changed from its parent, {parent?.label}</h3>
          {changed ? (
            <p>
              {pieces.map((p, i) => {
                const text = `${p.text} `;
                if (p.op === "add") return <ins key={i}>{text}</ins>;
                if (p.op === "del") return <del key={i}>{text}</del>;
                return <span key={i}>{text}</span>;
              })}
            </p>
          ) : (
            <p className="soft">The written strategy is the same, word for word. Only the numbers may differ.</p>
          )}
        </div>
      )}
    </section>
  );
}

function GenomeTable({ agent, parent }: { agent: Agent; parent: Agent | undefined }) {
  const g = agent.genome;
  if (!g) return null;
  const p: Genome | null | undefined = parent?.genome;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const rows: { name: string; note: string; value: string; was?: string }[] = [
    { name: "Model", note: "What it thinks with", value: g.model, was: p?.model },
    { name: "Temperature", note: "How much its answers vary", value: g.temperature.toFixed(2), was: p?.temperature.toFixed(2) },
    { name: "Shrink", note: "Below 1 hedges toward 50, above 1 sharpens", value: g.shrink.toFixed(2), was: p?.shrink.toFixed(2) },
    { name: "Size", note: "Share of its credits staked per question", value: pct(g.size), was: p ? pct(p.size) : undefined },
  ];
  const focus = Object.entries(g.focus);
  const narrow = focus.filter(([, v]) => v < 1);
  return (
    <section className="block" aria-labelledby="genome-title">
      <h2 id="genome-title">Its genome</h2>
      <table className="table genome">
        <thead>
          <tr>
            <th>Setting</th>
            <th>Value</th>
            {p && <th>Parent</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">
                {r.name}
                <span>{r.note}</span>
              </th>
              <td className="mono wrap">{r.value}</td>
              {p && <td className="mono wrap soft">{r.was === r.value ? "same" : r.was}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Focus</h3>
      {narrow.length === 0 ? (
        <p className="small soft">It takes every question it can afford, in every category.</p>
      ) : (
        <ul className="focus">
          {focus.map(([name, value]) => (
            <li key={name}>
              <span>{name}</span>
              <span className="meter" aria-hidden="true">
                <i style={{ width: `${value * 100}%`, background: "var(--ink-2)" }} />
              </span>
              <span className="mono">{Math.round(value * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small soft">
        The chain holds the genome's sha256, recorded at birth: <code className="hash">{agent.genome_hash}</code>
      </p>
    </section>
  );
}

function Children({ agent }: { agent: Agent }) {
  const m = useModel();
  const kids = m.childrenOf.get(agent.id) ?? [];
  return (
    <section className="block" aria-labelledby="kids-title">
      <h2 id="kids-title">Children</h2>
      {kids.length === 0 ? (
        <Empty>{agent.status === "Dead" ? "It had no children." : "No children yet."}</Empty>
      ) : (
        <ul className="kids">
          {kids.map((k) => (
            <li key={k.id}>
              <AgentName id={k.id} />
              <span className="soft small">{k.status === "Dead" ? `died ${date(k.died_ms)}` : <Money units={k.credits} />}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ agent }: { agent: Agent }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const rounds = useMemo(
    () =>
      [...m.questions.values()]
        .flatMap((q) => {
          const order = q.orders.find((o) => o.agent === agent.id);
          return order ? [{ q, order }] : [];
        })
        .reverse(),
    [m, agent.id],
  );
  return (
    <section className="block" aria-labelledby="history-title">
      <h2 id="history-title">Its rounds</h2>
      {rounds.length === 0 ? (
        <Empty>It has not revealed a bid in any round in this snapshot.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Round</th>
              <th className="num">Belief</th>
              <th className="num">Swarm</th>
              <th>Side</th>
              <th className="num">Net, {unit}</th>
            </tr>
          </thead>
          <tbody>
            {rounds.slice(0, 16).map(({ q, order }) => {
              const n = net(order);
              return (
                <tr key={q.id}>
                  <td className="clip">
                    <a href={roundHref(q.id)}>
                      <span className="mono">{q.id}</span> <span className="hide-narrow">{q.text}</span>
                    </a>
                  </td>
                  <td className="num mono">{order.belief}%</td>
                  <td className="num mono">{q.price}%</td>
                  <td className="mono">{order.side === 0 ? "none" : SIDE_NAME[order.side]}</td>
                  <td className="num mono">{q.status === "Settled" ? signed(n, column(n)) : "pending"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AgentPage({ id }: { id: string }) {
  const m = useModel();
  const agent = m.agents.get(id);
  useTitle(agent?.label ?? "Not found");
  if (!agent) {
    return <NotFound title="No agent by that name">This snapshot has no agent called {id}. It may be newer than the snapshot.</NotFound>;
  }
  const parent = m.agents.get(agent.parent);
  const dead = agent.status === "Dead";
  return (
    <article className="agent">
      <Lineage agent={agent} />
      <header className="agent-head">
        <h1 style={{ borderColor: inkVar(m, agent.id) }}>
          {dead && <span className="dagger">† </span>}
          {agent.label}
        </h1>
        <p>{statusLine(agent)}</p>
        <p>
          <Account id={agent.id} />
        </p>
      </header>
      {dead && <Obituary agent={agent} />}
      <Orphaned agent={agent} />
      <Strategy agent={agent} parent={parent} />
      <Facts agent={agent} />
      <GenomeTable agent={agent} parent={parent} />
      <Children agent={agent} />
      <History agent={agent} />
      <p className="small soft">Balances are from the snapshot of {stamp(Date.parse(m.snapshot.generated))}. Treasury holds {money(big(m.snapshot.treasury_credits))} {tokenSymbol(m.snapshot.network)}.</p>
    </article>
  );
}

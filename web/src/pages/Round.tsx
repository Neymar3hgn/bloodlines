import { useMemo, useState } from "react";
import { BeliefAxis } from "../components/BeliefAxis";
import { Account, AgentName, Empty, NotFound } from "../components/bits";
import { big, clock, column, date, exact, money, plural, signed, six, span, tokenSymbol } from "../data/format";
import { ledgerOf, net, roundState, SIDE_NAME, stageLine, type RoundState } from "../data/model";
import type { Order, Question } from "../data/types";
import { useModel, useNow, useTitle } from "../hooks";
import { roundHref } from "../router";

function headline(q: Question, state: RoundState): string {
  switch (state) {
    case "pooling":
      return "Agents are buying research.";
    case "sealing":
      return "The bids are sealed.";
    case "revealing":
      return "The bids are opening.";
    case "void":
      return "No answer.";
    default:
      return `The swarm says ${q.price}%.`;
  }
}

function story(q: Question, state: RoundState): string {
  const who = plural(q.reveals, "agent");
  const traded = q.matched > 0 ? `${plural(q.matched, "share")} changed hands.` : "No shares traded, because nobody was on the other side.";
  switch (state) {
    case "pooling":
      return `Before anyone seals a bid, agents can pool their money for a research briefing. Bidding opens when the pool closes.`;
    case "sealing":
      return `${plural(q.commits, "agent")} ${q.commits === 1 ? "has" : "have"} committed so far. Nobody can see a number until the commit window closes.`;
    case "revealing":
      return `${q.reveals} of ${plural(q.commits, "bid")} opened so far. The price is set when the window closes.`;
    case "void":
      return `Nobody revealed a bid, so there is no answer. The bounty went back to the asker.`;
    case "voided":
      return `${who} revealed and the round cleared. Then it was voided${q.evidence ? `: ${q.evidence}` : ""}. Every agent got its cost back.`;
    case "waiting":
      return `${who} revealed. ${traded} The result is not in yet.`;
    default:
      if (q.matched === 0) return `${who} revealed. ${traded} ${q.yes_won ? "It happened." : "It did not happen."}`;
      return `${who} revealed. ${traded} ${q.yes_won ? "It happened, so YES holders were right." : "It did not happen, so NO holders were right."}`;
  }
}

/** R26-R29: what agents bought together, what each paid, and the text once it can be published. */
function ResearchPoolSection({ q, now }: { q: Question; now: number }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const pool = q.research;
  if (!pool) return null;
  const n = pool.buyers.length;
  const alone = `${money(pool.price)} ${unit}`;
  const each = `${money(pool.share)} ${unit}`;
  const story: Record<typeof pool.status, string> = {
    Open:
      now < pool.end_ms
        ? `${n} of the ${pool.min_buyers} agents needed have joined so far. Each pledges ${money(pool.pledge)} ${unit}, the most it could owe. The more agents join, the less each pays.`
        : `${plural(n, "agent")} joined, and the pool is about to close.`,
    Closed: `${plural(n, "agent")} joined, so each owes ${each}. That money is held until the briefing's hash is on chain. If it does not arrive before the commit window closes, every buyer gets its money back.`,
    Bought: `${plural(n, "agent")} split one briefing. Alone, it would have cost any of them ${alone}. Together, each paid ${each}, and got the rest of its pledge back.`,
    Failed: `Only ${n} of the ${pool.min_buyers} agents needed joined, so nobody bought the briefing and every pledge went back.`,
    Refunded: `No briefing arrived in time, so every buyer got its money back.`,
  };
  return (
    <section className="block" aria-labelledby="pool-title">
      <h2 id="pool-title">The research they bought together</h2>
      <p>{story[pool.status]}</p>
      {n > 0 && (
        <ul className="buyers" aria-label="Agents in this pool">
          {pool.buyers.map((id) => (
            <li key={id}>
              <AgentName id={id} />
            </li>
          ))}
        </ul>
      )}
      {pool.status === "Bought" && (
        <>
          {pool.briefing ? (
            <blockquote className="briefing">{pool.briefing}</blockquote>
          ) : (
            <p className="small soft">Only the buyers read it during the round. The text is published afterwards.</p>
          )}
          <p className="small soft">
            {pool.briefing_model && pool.briefing_model !== "scripted" ? `Written by ${pool.briefing_model}${pool.briefing_signed ? ", signed inside a secure enclave" : ""}. ` : ""}
            {pool.briefing_model === "scripted" ? "A scripted stand-in, written to test the contracts. " : ""}
            Its hash went on chain before the agents committed: <code className="hash">{pool.briefing_hash}</code>
          </p>
        </>
      )}
    </section>
  );
}

function SealSection({ q }: { q: Question }) {
  const commitSecs = q.commit_end_ms - q.opened_ms;
  const revealSecs = q.reveal_end_ms - q.commit_end_ms;
  const missed = Math.max(0, q.commits - q.reveals);
  const resolver = q.resolver;
  return (
    <section className="block" aria-labelledby="seal-title">
      <h2 id="seal-title">Sealed until the reveal</h2>
      <ol className="windows">
        <li>
          <span className="w-time mono">{clock(q.opened_ms)}</span>
          <strong>Commit window, {span(commitSecs)}</strong>
          <span>
            {plural(q.commits, "agent")} posted a hash and nothing else: <code>sha256(question : agent : belief : stake : salt)</code>. Nobody could copy a forecast.
          </span>
        </li>
        <li>
          <span className="w-time mono">{clock(q.commit_end_ms)}</span>
          <strong>Reveal window, {span(revealSecs)}</strong>
          <span>
            {q.reveals} of {q.commits} opened their bid and locked the money. The contract rejects any bid that does not match its hash.
            {missed === 1 && " 1 agent did not reveal, and took a strike."}
            {missed > 1 && ` ${missed} agents did not reveal, and each took a strike.`}
          </span>
        </li>
        <li>
          <span className="w-time mono">then</span>
          <strong>{typeof resolver === "object" && "Sealed" in resolver ? "The sealed answer" : "The result"}</strong>
          {typeof resolver === "object" && "Sealed" in resolver && (
            <span>
              The answer's hash was published when the question opened, before anyone bid, so it could not be changed afterwards: <code className="hash">{resolver.Sealed.hash}</code>
            </span>
          )}
          {typeof resolver === "object" && "OnChain" in resolver && (
            <span>
              The colony reads <span className="mono">{resolver.OnChain.contract}</span>, method <span className="mono">{resolver.OnChain.method}</span>. Nobody has to be trusted.
            </span>
          )}
          {resolver === "Public" && <span>A named resolver posts the result and a source link.</span>}
          {q.evidence && <span>Evidence on chain: {q.evidence}</span>}
        </li>
      </ol>
      <p className="small soft">
        Opened on {date(q.opened_ms)} by <Account id={q.opener} />.
        {q.source && (
          <>
            {" "}
            <a href={q.source} target="_blank" rel="noreferrer">
              Question source
            </a>
            , read only.
          </>
        )}
      </p>
    </section>
  );
}

function WhoGotWhat({ q, highlight, onHighlight }: { q: Question; highlight: string | null; onHighlight: (a: string | null) => void }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const rows = useMemo(() => [...q.orders].sort((a, b) => b.belief - a.belief || b.stake - a.stake), [q.orders]);
  const total = (pick: (o: Order) => string) => rows.reduce((t, o) => t + big(pick(o)), 0n);
  const netAll = rows.reduce((t, o) => t + net(o), 0n);
  const voided = q.status === "Settled" && q.yes_won === null;
  // Until settlement nobody has been paid, so a net figure would only show the cost.
  const settled = q.status === "Settled";
  return (
    <section className="block" aria-labelledby="who-title">
      <h2 id="who-title">Who got what</h2>
      <p className="small soft">
        Amounts are in {unit}. Paid is the price of the shares it held. {voided ? "Back is its cost returned." : "Won is what those shares paid."} Bill is the cost of its thinking.
      </p>
      <table className="table ledger-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th className="num">Belief</th>
            <th>Side</th>
            <th className="num">Filled</th>
            <th className="num">Paid</th>
            <th className="num">{voided ? "Back" : "Won"}</th>
            <th className="num">Reward</th>
            <th className="num">Bill</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const n = net(o);
            return (
              <tr key={o.agent} className={highlight === o.agent ? "is-on" : undefined} onPointerEnter={() => onHighlight(o.agent)} onPointerLeave={() => onHighlight(null)}>
                <td data-label="Agent">
                  <AgentName id={o.agent} />
                  {q.research?.status === "Bought" && q.research.buyers.includes(o.agent) && <span className="tag">briefed</span>}
                </td>
                <td className="num mono" data-label="Belief">{o.belief}%</td>
                <td className="mono" data-label="Side">{o.side === 0 ? "none" : SIDE_NAME[o.side]}</td>
                <td className="num mono" data-label="Filled">{o.filled} of {o.stake}</td>
                <td className="num mono" data-label="Paid">{column(o.cost)}</td>
                <td className="num mono" data-label={voided ? "Back" : "Won"}>{column(o.payout)}</td>
                <td className="num mono" data-label="Reward">{column(o.reward)}</td>
                <td className="num mono" data-label="Bill">{column(o.bill)}</td>
                <td className="num mono net" data-label="Net">{settled ? signed(n, column(n)) : "pending"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All agents</th>
            <td />
            <td />
            <td className="num mono" data-label="Filled">{q.orders.reduce((t, o) => t + o.filled, 0)}</td>
            <td className="num mono" data-label="Paid">{column(total((o) => o.cost))}</td>
            <td className="num mono" data-label={voided ? "Back" : "Won"}>{column(total((o) => o.payout))}</td>
            <td className="num mono" data-label="Reward">{column(total((o) => o.reward))}</td>
            <td className="num mono" data-label="Bill">{column(total((o) => o.bill))}</td>
            <td className="num mono net" data-label="Net">{settled ? signed(netAll, column(netAll)) : "pending"}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/** The reasoning behind the number. Only real model answers have any. */
function WhatTheyThought({ q, highlight, onHighlight }: { q: Question; highlight: string | null; onHighlight: (a: string | null) => void }) {
  const beliefs = useMemo(() => new Map(q.orders.map((o) => [o.agent, o.belief])), [q.orders]);
  const rows = useMemo(
    () =>
      Object.entries(q.thoughts ?? {})
        .filter(([, t]) => t.reasoning)
        .sort(([a], [b]) => (beliefs.get(b) ?? 0) - (beliefs.get(a) ?? 0)),
    [q.thoughts, beliefs],
  );
  if (rows.length === 0) return null;
  const signed = rows.filter(([, t]) => t.signed).length;
  return (
    <section className="block" aria-labelledby="why-title">
      <h2 id="why-title">Why they think so</h2>
      <p className="small soft">
        Each agent's own reasoning, sealed with its forecast. {signed === rows.length ? "Every answer" : `${signed} of ${rows.length} answers`} here {signed === 1 ? "was" : "were"} signed by the model inside a secure enclave, and the hash of each one is on chain.
      </p>
      <ul className="thoughts">
        {rows.map(([agent, t]) => (
          <li key={agent} className={highlight === agent ? "is-on" : undefined} onPointerEnter={() => onHighlight(agent)} onPointerLeave={() => onHighlight(null)}>
            <span className="thought-who">
              <AgentName id={agent} />
              <span className="mono">{beliefs.get(agent) ?? Math.round(t.probability * 100)}%</span>
            </span>
            <p>{t.reasoning}</p>
            {t.model && (
              <span className="thought-model mono">
                {t.model.split("/").pop()}
                {t.signed ? ", signed" : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MoneyBalance({ q }: { q: Question }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const ledger = ledgerOf(q);
  if (!ledger) {
    return (
      <section className="block" aria-labelledby="money-title">
        <h2 id="money-title">The money</h2>
        <Empty>The round is not finished, so the money has not all moved yet.</Empty>
      </section>
    );
  }
  const balanced = ledger.totalIn === ledger.totalOut;
  const cut = big(q.bounty) - big(q.pool);
  const left = big(q.pool) - big(q.rewarded);
  return (
    <section className="block" aria-labelledby="money-title">
      <h2 id="money-title">The money</h2>
      <div className="ledger">
        <table>
          <caption>Money in, {unit}</caption>
          <tbody>
            {ledger.in.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="mono">{six(r.units)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total in</th>
              <td className="mono">{six(ledger.totalIn)}</td>
            </tr>
          </tfoot>
        </table>
        <span className={`ledger-eq${balanced ? "" : " is-off"}`} aria-hidden="true">
          {balanced ? "=" : "≠"}
        </span>
        <table>
          <caption>Money out, {unit}</caption>
          <tbody>
            {ledger.out.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="mono">{six(r.units)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total out</th>
              <td className="mono">{six(ledger.totalOut)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={balanced ? "verdict is-ok" : "verdict is-bad"}>
        <span aria-hidden="true">{balanced ? "✓" : "✕"}</span> {balanced ? "Money in equals money out, to the last unit." : "Money in does not equal money out for this question."}
      </p>
      {q.status === "Settled" && (
        <p className="small soft">
          The treasury took its {exact(cut)} cut of the bounty
          {q.yes_won === null
            ? `, and the other ${exact(left)} of the bounty went back to the asker`
            : left > 0n
              ? `, plus ${exact(left)} of reward that ${big(q.rewarded) === 0n ? "nobody earned" : "was left by rounding down"}`
              : ""}
          . Bills of {exact(ledger.bills)} went straight to the treasury at the reveal, so they sit outside both columns.
        </p>
      )}
    </section>
  );
}

function RoundNav({ id }: { id: number }) {
  const m = useModel();
  const before = m.questions.has(id - 1);
  const after = m.questions.has(id + 1);
  return (
    <nav className="pager" aria-label="Other rounds">
      {before ? <a href={roundHref(id - 1)}>Round {id - 1}</a> : <span />}
      <a href="#/rounds">All rounds</a>
      {after ? <a href={roundHref(id + 1)}>Round {id + 1}</a> : <span />}
    </nav>
  );
}

export function RoundPage({ id }: { id: number }) {
  const m = useModel();
  const q = m.questions.get(id);
  const now = useNow(q?.status === "Open" ? 1_000 : 30_000);
  useTitle(q ? `Round ${id}` : "Not found");
  const [highlight, setHighlight] = useState<string | null>(null);

  if (!q) {
    return <NotFound title={`No round ${id}`}>This snapshot has no round with that number. It may be newer than the snapshot.</NotFound>;
  }

  const state = roundState(q, now);
  return (
    <>
      <section className="page-head round-head">
        <p className="eyebrow">
          Round {q.id}, {q.category === "test" ? "contract test" : q.category}
        </p>
        <h1>{q.text}</h1>
        <p className="answer">
          <strong>{headline(q, state)}</strong>
          {state === "settled" && <span> {q.yes_won ? "It happened." : "It did not happen."}</span>}
          {state === "voided" && <span> Voided.</span>}
          {state === "waiting" && <span> Waiting for the result.</span>}
        </p>
        <p className="lede">{story(q, state)}</p>
        {q.status === "Open" && (
          <p className="round-now">
            <span className="live-dot" aria-hidden="true" />
            {stageLine(q, now)}
          </p>
        )}
      </section>

      <section className="block round-figure" aria-label="Every agent's belief on this question">
        {q.orders.length > 0 ? (
          <>
            <BeliefAxis q={q} highlight={highlight} onHighlight={setHighlight} />
            <p className="fig-note">
              One dot per agent, placed at its belief and sized by its stake. Colour is its founding lineage. An agent exactly on the line takes the short side, and only as much as closes the gap between YES and NO.
            </p>
          </>
        ) : (
          <Empty>{q.status === "Open" ? "No bids have been revealed yet." : "No bids were revealed, so there is nothing to plot."}</Empty>
        )}
      </section>

      <ResearchPoolSection q={q} now={now} />
      <WhatTheyThought q={q} highlight={highlight} onHighlight={setHighlight} />
      <SealSection q={q} />
      {q.orders.length > 0 && <WhoGotWhat q={q} highlight={highlight} onHighlight={setHighlight} />}
      <MoneyBalance q={q} />
      <RoundNav id={q.id} />
    </>
  );
}

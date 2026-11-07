import { useMemo, useState } from "react";
import { Empty } from "../components/bits";
import { Dumbbell, SignedBars } from "../components/charts";
import { column, plural, stamp, tokenSymbol } from "../data/format";
import { recheckAll, type Recheck } from "../data/recheck";
import { RULE_NAMES } from "../data/rules";
import type { E2eResult, Experiment, Sim, SimExam } from "../data/types";
import { useModel, useTitle } from "../hooks";
import { roundHref } from "../router";

const SHARE_UNITS = 10_000;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

type Check = { state: "idle" } | { state: "running"; done: number; total: number } | { state: "done"; rows: Recheck[] };

function CheckItYourself() {
  const m = useModel();
  const [check, setCheck] = useState<Check>({ state: "idle" });

  const run = async () => {
    setCheck({ state: "running", done: 0, total: m.questions.size });
    const rows = await recheckAll(m.snapshot, (done, total) => setCheck({ state: "running", done, total }));
    setCheck({ state: "done", rows });
  };

  const rows = check.state === "done" ? check.rows : [];
  const checked = rows.filter((r) => !r.skipped);
  const passed = checked.filter((r) => r.problems.length === 0);
  const fromChain = checked.filter((r) => r.source === "chain").length;
  const skipped = rows.length - checked.length;
  const allGood = passed.length === checked.length;

  return (
    <section className="block check" aria-labelledby="check-title">
      <h2 id="check-title">Check it yourself</h2>
      <p>
        This button re-reads every question's orders from the chain, from your own browser. It then rebuilds the price, every fill, every payout, every research pool and the money balance with <code>engine/market.ts</code>,
        the same reference file the contract is tested against. Your browser does the sums.
      </p>
      <button type="button" className="primary" onClick={run} disabled={check.state === "running"}>
        {check.state === "running" ? `Checking ${check.done} of ${check.total}` : check.state === "done" ? "Check again" : "Check it yourself"}
      </button>

      {check.state === "done" && checked.length === 0 && <Empty>There are no cleared questions to check yet.</Empty>}

      {check.state === "done" && checked.length > 0 && (
        <div aria-live="polite">
          <p className={`verdict big ${allGood ? "is-ok" : "is-bad"}`}>
            <span aria-hidden="true">{allGood ? "✓" : "✕"}</span> {passed.length} of {plural(checked.length, "question")} recomputed
          </p>
          <p className="small soft">
            {import.meta.env.DEV && m.snapshot.fixture
              ? "Checked against the fixture, not the chain."
              : fromChain === checked.length
                ? "Every order came straight from the chain."
                : fromChain === 0
                  ? "The chain could not be reached, so this checked the snapshot's copy of the orders."
                  : `${fromChain} read from the chain, ${checked.length - fromChain} from the snapshot because the chain did not answer.`}
            {skipped > 0 && ` Skipped ${plural(skipped, "open question")}, because there is nothing to rebuild until it clears.`}
          </p>
          <details className="twin" open={!allGood}>
            <summary>Question by question</summary>
            <ul className="recheck">
              {rows.map((r) => (
                <li key={r.id} className={r.problems.length ? "is-bad" : undefined}>
                  <span aria-hidden="true">{r.skipped ? "·" : r.problems.length ? "✕" : "✓"}</span>
                  <a href={roundHref(r.id)}>
                    <span className="mono">{r.id}</span> {r.text}
                  </a>
                  <span className="mono soft">{r.skipped ? "open" : r.price > 0 ? `${r.price}%` : "void"}</span>
                  {r.problems.length > 0 && (
                    <ul>
                      {r.problems.map((p, i) => (
                        <li key={`${i}-${p}`}>{p}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}

function RuleTests() {
  const { e2e } = useModel().snapshot;
  const groups = useMemo(() => {
    const byRule = new Map<string, E2eResult[]>();
    for (const r of e2e?.results ?? []) byRule.set(r.rule, [...(byRule.get(r.rule) ?? []), r]);
    return [...byRule.entries()].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)));
  }, [e2e]);

  return (
    <section className="block" aria-labelledby="rules-title">
      <h2 id="rules-title">Rule by rule, on the live chain</h2>
      {!e2e || !e2e.results?.length ? (
        <Empty>The end-to-end report has not been published yet.</Empty>
      ) : (
        <>
          <p>
            {e2e.passed} of {plural(e2e.total, "check")} passed against the deployed contracts{e2e.network ? ` on ${e2e.network}` : ""}
            {e2e.at ? `, ${stamp(Date.parse(e2e.at))}` : ""}. Some of these try to break a rule and confirm the chain refuses.
          </p>
          <div className="rules">
            {groups.map(([rule, results]) => (
              <section key={rule}>
                <h3>
                  <span className="mono">{rule}</span> {RULE_NAMES[rule] ?? ""}
                </h3>
                <ul>
                  {results.map((r, i) => (
                    <li key={`${i}-${r.claim}`} className={r.ok ? undefined : "is-bad"}>
                      <span className="tick" aria-label={r.ok ? "passed" : "failed"}>
                        {r.ok ? "✓" : "✕"}
                      </span>
                      <span>
                        {r.claim}
                        {r.detail && <span className="detail mono">{r.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function examsOf(sim: Sim): SimExam[] {
  const raw = sim.exams ?? sim.exam;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function ExamBlock({ sim }: { sim: Sim }) {
  const exams = examsOf(sim);
  const summary = sim.summary;
  const caveat = "The agents here are scripted, with skill built in, so this shows the rules can find skill. It does not show that real models have it.";

  if (exams.length) {
    const founders = mean(exams.map((e) => e.founderError));
    const survivors = mean(exams.map((e) => e.evolvedError));
    const won = exams.filter((e) => e.evolvedError < e.founderError).length;
    return (
      <div className="audit">
        <h3>The exam</h3>
        <p>
          In this simulation, founders and survivors answered the same {exams[0].questions.toLocaleString()} new questions. The founders' error was {founders.toFixed(4)} and the survivors' was {survivors.toFixed(4)}
          , {(100 * (1 - survivors / founders)).toFixed(1)}% lower. Survivors won {won} of {plural(exams.length, "seed")}. {caveat}
        </p>
        <Dumbbell
          rows={exams.map((e, i) => ({ label: `Seed ${i + 1}`, from: e.founderError, to: e.evolvedError }))}
          fromLabel="Founders"
          toLabel="Survivors"
          caption={`Founders' error against survivors' error for each of ${exams.length} seeds. Lower is better.`}
        />
      </div>
    );
  }

  if (!summary?.selection?.length) {
    return (
      <div className="audit">
        <h3>The exam</h3>
        <Empty>The exam has not been published yet.</Empty>
      </div>
    );
  }

  const early = mean(summary.selection.map((s) => s.earlyTruth));
  const late = mean(summary.selection.map((s) => s.lateTruth));
  const control = mean(summary.control.map((s) => s.lateTruth));
  const questions = sim.colony?.params?.questions;
  return (
    <div className="audit">
      <h3>The exam</h3>
      <p>
        In this simulation, the swarm's error against the hidden true chance went from {early.toFixed(4)} in the first third of each run to {late.toFixed(4)} in the last third
        {questions ? ` of ${Number(questions).toLocaleString()} questions` : ""}. A control group with no births or deaths ended at {control.toFixed(4)}. Error fell in {summary.improved} of {plural(sim.seeds, "seed")}, and{" "}
        {summary.beatControl} beat their control. {caveat}
      </p>
      <Dumbbell
        rows={summary.selection.map((s, i) => ({ label: `Seed ${i + 1}`, from: s.earlyTruth, to: s.lateTruth, reference: summary.control[i]?.lateTruth }))}
        fromLabel="First third"
        toLabel="Last third"
        referenceLabel="Control, last third"
        caption={`Error against the hidden truth for each of ${sim.seeds} seeds, first third against last third, with the control group. Lower is better.`}
      />
      <p className="small soft">
        This is the measure the report holds. The direct exam, with founders and survivors sitting the same questions, is printed by the simulator but is not in the report yet, so it is not shown here.
      </p>
    </div>
  );
}

function LyingAudit({ sim }: { sim: Sim }) {
  const { lies, habits } = sim;
  if (!lies) return null;
  const lost = (habits ?? []).filter((h) => h.meanPct < 0).length;
  return (
    <div className="audit">
      <h3>The lying audit</h3>
      <p>
        In this simulation, an agent tried every possible lie on {lies.trials.toLocaleString()} order books of {lies.crowd} agents. Some lie beat the truth in {lies.lieWins.toLocaleString()} of them, but the best lie gained only{" "}
        {lies.meanBestGainPct.toFixed(2)}% of stake on average, and it needs sight of every sealed bid. A typical lie changed the result by {lies.meanRandomLiePct.toFixed(2)}% of stake.
      </p>
      {habits && habits.length > 0 && (
        <>
          <p className="small soft">
            Bids are sealed, so a real liar can only keep a fixed habit. Against telling the truth, {lost} of {habits.length} habits lost money:
          </p>
          <SignedBars rows={habits.map((h) => ({ label: h.label, value: h.meanPct }))} unit="%" />
        </>
      )}
    </div>
  );
}

function WhaleAudit({ sim }: { sim: Sim }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const pumps = sim.pumps;
  if (!pumps?.length) return null;
  const big = pumps[pumps.length - 1];
  return (
    <div className="audit">
      <h3>The whale audit</h3>
      <p>
        In this simulation, a whale seals 99 on questions whose true chance is low. It can move the answer, and it pays for that: with {(big.share * 100).toFixed(0)}% of the crowd's stake it pushes the answer to {big.pumpedPriceError.toFixed(1)} points from the truth and loses money on{" "}
        {(big.losingPumps * 100).toFixed(0)}% of pumps. The audit ignores the stake cap in R23, so a real agent is weaker than this whale.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Whale size</th>
            <th className="num">Error before</th>
            <th className="num">Error after</th>
            <th className="num">Loss per pump, {unit}</th>
            <th className="num">Pumps that lose</th>
          </tr>
        </thead>
        <tbody>
          {pumps.map((p) => (
            <tr key={p.share}>
              <td>{(p.share * 100).toFixed(0)}% of the crowd</td>
              <td className="num mono">{p.honestPriceError.toFixed(2)}</td>
              <td className="num mono">{p.pumpedPriceError.toFixed(2)}</td>
              <td className="num mono">{column(Math.round(p.whaleLossPerPump * SHARE_UNITS))}</td>
              <td className="num mono">{(p.losingPumps * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small soft">Error is the gap between the answer and the true chance, in percentage points.</p>
    </div>
  );
}

function PoolAudit({ sim }: { sim: Sim }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const pools = sim.pools;
  if (!pools?.cases.length) return null;
  const good = pools.cases[0];
  const bad = pools.cases[pools.cases.length - 1];
  return (
    <div className="audit">
      <h3>The research pool audit</h3>
      <p>
        In this simulation, one question in {pools.every} offered a shared briefing for {column(pools.price)} {unit}, and colonies differed only in how good the briefings were. Every buyer reads the same text, so a wrong briefing misleads them all together. On the questions where a pool bought one, a good briefing cut the swarm's error by{" "}
        {(100 * (1 - good.withBriefing / good.withoutIt)).toFixed(0)}%, and a misleading one multiplied it by {(bad.withBriefing / bad.withoutIt).toFixed(1)}. Selection noticed: the habit of buying started near 0.5 and ended at {good.gene.toFixed(2)} with good briefings and {bad.gene.toFixed(2)} with misleading ones.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Briefings</th>
            <th className="num">Habit at the end</th>
            <th className="num">Buyers</th>
            <th className="num">Error with it</th>
            <th className="num">Without it</th>
          </tr>
        </thead>
        <tbody>
          {pools.cases.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td className="num mono">{c.gene.toFixed(2)}</td>
              <td className="num mono">{c.buyers.toFixed(1)}</td>
              <td className="num mono">{c.withBriefing.toFixed(4)}</td>
              <td className="num mono">{c.withoutIt.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small soft">Over {plural(pools.seeds, "seed")}. Even with good briefings the habit drifts down a little, so buying is not a free win. Scripted agents here have skill built in, so this shows the rules can sort good research from bad. It does not show that a real briefing helps.</p>
    </div>
  );
}

function SimSection() {
  const { sim } = useModel().snapshot;
  return (
    <section className="block" aria-labelledby="sim-title">
      <h2 id="sim-title">The simulator</h2>
      {!sim ? (
        <Empty>The simulator report has not been published yet.</Empty>
      ) : (
        <>
          <p>
            These results come from <code>sim/</code>, which runs the same rules with scripted agents and no model calls. They are simulations, not results from the chain{sim.seeds ? `, over ${plural(sim.seeds, "seed")}` : ""}.
          </p>
          <ExamBlock sim={sim} />
          <LyingAudit sim={sim} />
          <WhaleAudit sim={sim} />
          <PoolAudit sim={sim} />
        </>
      )}
    </section>
  );
}

function ExperimentView({ e }: { e: Experiment }) {
  const exam = e.exam;
  const n = (v: number | undefined, d = 4) => (typeof v === "number" ? v.toFixed(d) : "none");
  const diff = exam?.pairedDifference;
  const scripted = e.mode !== "ai";
  const rows: [string, string][] = [
    ["Founders, the swarm's answer", n(exam?.foundersMarket)],
    ["Survivors, the swarm's answer", n(exam?.survivorsMarket)],
    ["Founders, plain average", n(exam?.foundersAverage)],
    ["A coin flip", n(exam?.coinFlip)],
  ];
  if (exam?.bestFounderInHindsight) rows.push([`Best founder in hindsight, ${exam.bestFounderInHindsight.id}`, n(exam.bestFounderInHindsight.brier)]);
  if (exam?.medianFounder) rows.push([`Median founder, ${exam.medianFounder.id}`, n(exam.medianFounder.brier)]);
  const crowd = exam?.humanCrowd;
  return (
    <>
      {scripted && <p className="banner inline">This run used scripted forecasts. It tests the machinery, not AI.</p>}
      {exam?.verdict && (
        <p className="verdict big">
          The verdict: {exam.verdict}.
        </p>
      )}
      <p>
        {e.questions?.season ? `${plural(e.questions.season, "season question")}, then ` : ""}
        {exam?.questions ? `${plural(exam.questions, "exam question")} neither group had seen. ` : ""}
        {diff ? `The survivors' improvement was ${n(diff.mean)}, with a 95% interval from ${n(diff.low)} to ${n(diff.high)}. ` : ""}
        Scores are Brier scores. Lower is better.
      </p>
      <table className="table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="num mono">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {crowd && (
        <p>
          For scale: on the {crowd.questions} of these questions a public market had priced by the same date, people with real money scored {n(crowd.crowd)}. The survivors scored {n(crowd.survivorsOnTheseQuestions)} on those same questions.
        </p>
      )}
      {exam?.briefings && (
        <p>
          Do briefings help? On {plural(exam.briefings.questions, "question")} here, the founders answered again with a briefing from {exam.briefings.model}, and nothing else changed. The swarm's answer scored {n(exam.briefings.withoutBriefing)} without it and {n(exam.briefings.withBriefing)} with it. The difference was {n(exam.briefings.pairedDifference.mean)}, with a 95% interval from {n(exam.briefings.pairedDifference.low)} to {n(exam.briefings.pairedDifference.high)}: {exam.briefings.verdict}.
        </p>
      )}
      {e.season && (
        <p className="small soft">
          The season ended with {e.season.alive ?? "?"} of {e.season.total ?? "?"} agents alive, after {e.season.births ?? "?"} births and {e.season.deaths ?? "?"} deaths.
          {e.usage?.spentUsd !== undefined && ` It cost $${e.usage.spentUsd.toFixed(2)} in model calls.`}
        </p>
      )}
      {e.modelLeaderboard && e.modelLeaderboard.length > 0 && (
        <details className="twin">
          <summary>By model</summary>
          <table className="table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Brier</th>
                <th className="num">Forecasts</th>
                <th className="num">Per 1,000</th>
              </tr>
            </thead>
            <tbody>
              {e.modelLeaderboard.map((row) => (
                <tr key={row.model}>
                  <td className="mono wrap">{row.model}</td>
                  <td className="num mono">{row.brier.toFixed(4)}</td>
                  <td className="num mono">{row.forecasts.toLocaleString()}</td>
                  <td className="num mono">${row.costPerThousand.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

function ExperimentSection() {
  const { experiment } = useModel().snapshot;
  return (
    <section className="block" aria-labelledby="experiment-title">
      <h2 id="experiment-title">The experiment</h2>
      {experiment ? (
        <ExperimentView e={experiment} />
      ) : (
        <p>The experiment has not been published yet. Founders and survivors will sit the same exam on questions neither has seen, with real forecasts. No measurable difference is a possible result, and it would be published too.</p>
      )}
    </section>
  );
}

export function ProofPage() {
  useTitle("Proof");
  return (
    <>
      <section className="page-head">
        <h1>Proof</h1>
        <p className="lede">Every number on this site comes from the chain or from a report you can rebuild. This page shows the checks, and lets you run one.</p>
      </section>
      <CheckItYourself />
      <RuleTests />
      <SimSection />
      <ExperimentSection />
    </>
  );
}

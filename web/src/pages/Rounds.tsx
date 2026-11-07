import { useMemo, useState } from "react";
import { Empty } from "../components/bits";
import { MiniAxis } from "../components/charts";
import { plural, stamp } from "../data/format";
import { answeredBy, roundState } from "../data/model";
import type { Question } from "../data/types";
import { useModel, useNow, useTitle } from "../hooks";
import { roundHref } from "../router";

const PAGE = 40;

function outcome(q: Question, now: number): string {
  const state = roundState(q, now);
  if (state === "settled") return q.yes_won ? "YES" : "NO";
  if (state === "void") return "Void";
  if (state === "voided") return "Voided";
  if (state === "waiting") return "Waiting";
  return "Open";
}

export function RoundsPage() {
  useTitle("Rounds");
  const m = useModel();
  const now = useNow(30_000);
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => [...m.questions.values()].sort((a, b) => b.id - a.id), [m]);
  const categories = useMemo(() => [...new Set(all.map((q) => q.category))].sort(), [all]);
  const matching = category === "all" ? all : all.filter((q) => q.category === category);
  const shown = matching.slice(0, limit);

  return (
    <>
      <section className="page-head">
        <h1>Rounds</h1>
        <p className="lede">Each round is one yes or no question. Agents seal a forecast and a stake, and the median is the swarm's answer.</p>
      </section>

      {all.length === 0 ? (
        <Empty>No rounds have been run yet.</Empty>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="filters" role="group" aria-label="Filter by category">
              {["all", ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={c === category}
                  onClick={() => {
                    setCategory(c);
                    setLimit(PAGE);
                  }}
                >
                  {c === "test" ? "contract tests" : c}
                </button>
              ))}
            </div>
          )}
          <ol className="rounds">
            {shown.map((q) => (
              <li key={q.id}>
                <a href={roundHref(q.id)}>
                  <span className="r-id mono">{q.id}</span>
                  <span className="r-text">{q.text}</span>
                  <span className="r-meta">
                    {q.category === "test" ? "contract test" : q.category}, {plural(q.reveals, "agent")}
                    {answeredBy(q) === "real models" ? ", real models" : ""}
                    {q.research?.status === "Bought" ? `, ${q.research.buyers.length} shared a briefing` : ""}, {stamp(q.opened_ms)}
                  </span>
                  <span className="r-axis">
                    <MiniAxis q={q} />
                  </span>
                  <span className="r-price mono">{q.price > 0 ? `${q.price}%` : "none"}</span>
                  <span className="r-result mono">{outcome(q, now)}</span>
                </a>
              </li>
            ))}
          </ol>
          {matching.length > limit && (
            <button type="button" className="unfold rounds-more" onClick={() => setLimit(limit + PAGE)}>
              Show {Math.min(PAGE, matching.length - limit)} more of {matching.length}
            </button>
          )}
          <p className="legend-line">
            Each line runs from 0 to 100. The tick is the swarm's answer. The dot is what happened.
          </p>
        </>
      )}
    </>
  );
}

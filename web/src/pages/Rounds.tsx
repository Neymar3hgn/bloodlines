import { useMemo, useState } from "react";
import { Empty } from "../components/bits";
import { MiniAxis } from "../components/charts";
import { plural, stamp } from "../data/format";
import { answeredBy, roundState } from "../data/model";
import type { Question } from "../data/types";
import { useModel, useNow, useTitle } from "../hooks";
import { roundHref } from "../router";

const PAGE = 40;

type Source = "all" | "real" | "scripted" | "tests";

/** Contract tests are kept apart, so the list reads as the colony's own history. */
const SOURCES: { id: Source; label: string; match: (q: Question) => boolean }[] = [
  { id: "all", label: "All rounds", match: (q) => q.category !== "test" },
  { id: "real", label: "Real models", match: (q) => answeredBy(q) === "real models" },
  { id: "scripted", label: "Scripted", match: (q) => q.category !== "test" && answeredBy(q) === "scripted agents" },
  { id: "tests", label: "Contract tests", match: (q) => q.category === "test" },
];

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
  const [source, setSource] = useState<Source>("all");
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => [...m.questions.values()].sort((a, b) => b.id - a.id), [m]);
  const available = useMemo(() => SOURCES.filter((s) => s.id === "all" || all.some(s.match)), [all]);
  const matching = all.filter(SOURCES.find((s) => s.id === source)!.match);
  const shown = matching.slice(0, limit);

  return (
    <>
      <section className="page-head">

        <p className="kicker">The record</p>
        <h1 style={{ marginTop: "0.7rem" }}>Every round, on chain.</h1>
        <p className="lede">Each round is one yes or no question. Agents seal a forecast and a stake, and the median is the swarm's answer.</p>
      </section>

      {all.length === 0 ? (
        <Empty>No rounds have been run yet.</Empty>
      ) : (
        <>
          {available.length > 1 && (
            <div className="filters" role="group" aria-label="Filter rounds">
              {available.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={s.id === source}
                  onClick={() => {
                    setSource(s.id);
                    setLimit(PAGE);
                  }}
                >
                  {s.label}
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
                  <span className={`r-price${q.price > 0 ? "" : " is-none"}`}>{q.price > 0 ? `${q.price}%` : "none"}</span>
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

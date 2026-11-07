/**
 * The round explained in one picture: a 0 to 100 axis, one dot per agent, and the
 * line where the swarm settled. The reader can step back to how the chain saw the
 * round before the reveal, when it held nothing but hashes.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Tip } from "./bits";
import { column, plural, tokenSymbol } from "../data/format";
import { inkVar, SIDE_NAME } from "../data/model";
import type { Order, Question } from "../data/types";
import { nearest, prefersReducedMotion, useModel, useWidth } from "../hooks";
import { agentHref } from "../router";

interface Dot {
  order: Order;
  x: number;
  y: number;
  r: number;
  sealedX: number;
}

const SIDE_PAD = 14;
const TOP = 58;
const BOTTOM = 52;
const GAP = 1.6;

/** Area follows stake. Sizes are shared by every round, so rounds can be compared. */
function dotRadius(stake: number, width: number) {
  const r = Math.min(20, Math.max(4.5, 2.9 * Math.sqrt(stake)));
  return width < 520 ? r * 0.8 : r;
}

/** Piles dots on the axis: each drops to the lowest spot that touches nothing. */
function pile(orders: Order[], width: number) {
  const span = width - 2 * SIDE_PAD;
  const xOf = (belief: number) => SIDE_PAD + (span * belief) / 100;
  const sorted = [...orders].sort((a, b) => a.belief - b.belief || b.stake - a.stake);
  const placed: { x: number; h: number; r: number; order: Order }[] = [];

  for (const order of sorted) {
    const x = xOf(order.belief);
    const r = dotRadius(order.stake, width);
    const near = placed.filter((p) => Math.abs(p.x - x) < p.r + r + GAP);
    const clears = (h: number) => near.every((p) => (p.x - x) ** 2 + (p.h - h) ** 2 >= (p.r + r + GAP) ** 2 - 0.01);
    const spots = [r, ...near.map((p) => p.h + Math.sqrt(Math.max(0, (p.r + r + GAP) ** 2 - (p.x - x) ** 2)))].sort((a, b) => a - b);
    placed.push({ x, r, order, h: spots.find(clears) ?? r });
  }

  const tallest = Math.max(72, ...placed.map((p) => p.h + p.r));
  const baseline = TOP + tallest + 8;
  const dots: Dot[] = placed.map((p, i) => ({
    order: p.order,
    x: p.x,
    y: baseline - p.h,
    r: p.r,
    sealedX: SIDE_PAD + (span * (i + 0.5)) / placed.length,
  }));
  return { dots, baseline, height: baseline + BOTTOM, xOf };
}

function SideLabels({ q, xOf, left, right }: { q: Question; xOf: (b: number) => number; left: string; right: string }) {
  const x = xOf(q.price);
  const leftRoom = x - SIDE_PAD;
  const rightRoom = xOf(100) - x;
  return (
    <g className="ba-sides">
      {leftRoom > 64 && (
        <text x={x - 8} y={44} textAnchor="end">
          {leftRoom > 112 ? `← ${left}` : "← NO"}
        </text>
      )}
      {rightRoom > 64 && (
        <text x={x + 8} y={44}>
          {rightRoom > 112 ? `${right} →` : "YES →"}
        </text>
      )}
    </g>
  );
}

export function BeliefAxis({
  q,
  highlight,
  onHighlight,
}: {
  q: Question;
  highlight: string | null;
  onHighlight: (agent: string | null) => void;
}) {
  const m = useModel();
  const [box, width] = useWidth<HTMLDivElement>();
  const unit = tokenSymbol(m.snapshot.network);
  const cleared = q.price > 0;
  const [sealed, setSealed] = useState(() => !prefersReducedMotion());
  const [pinned, setPinned] = useState<string | null>(null);
  const touched = useRef(false);

  // The round opens on the page the way it opened on chain, once.
  useEffect(() => {
    const timer = setTimeout(() => setSealed(false), 900);
    return () => clearTimeout(timer);
  }, []);

  const shape = useMemo(() => (width ? pile(q.orders, width) : null), [q.orders, width]);
  if (!q.orders.length) return <div ref={box} />;
  if (!shape) return <div ref={box} className="ba" style={{ minHeight: 240 }} />;

  const { dots, baseline, height, xOf } = shape;
  const activeAgent = highlight ?? pinned;
  const active = dots.find((d) => d.order.agent === activeAgent);
  const priceX = xOf(q.price);
  const yesBand = q.yes_won === true;
  const noBand = q.yes_won === false;
  const flagRight = q.price < 60;
  const shares = (side: number) => q.orders.filter((o) => o.side === side).reduce((t, o) => t + o.filled, 0);

  const pick = (e: PointerEvent<SVGSVGElement>, limit: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = nearest(dots, e.clientX - rect.left, e.clientY - rect.top, limit);
    return hit?.order.agent ?? null;
  };

  return (
    <div ref={box} className="ba">
      <div className="ba-switch" role="group" aria-label="Show the round">
        <button type="button" aria-pressed={sealed} onClick={() => setSealed(true)}>
          Sealed
        </button>
        <button type="button" aria-pressed={!sealed} onClick={() => setSealed(false)}>
          Revealed
        </button>
      </div>

      <svg
        className={`ba-svg${sealed ? " is-sealed" : ""}${activeAgent ? " has-active" : ""}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={cleared ? `Beliefs of ${plural(q.orders.length, "agent")}. The swarm says ${q.price} percent.` : `Beliefs of ${plural(q.orders.length, "agent")}.`}
        onPointerDown={(e) => (touched.current = e.pointerType === "touch")}
        onPointerMove={(e) => {
          if (e.pointerType !== "touch") onHighlight(pick(e, 22));
        }}
        onPointerLeave={() => onHighlight(null)}
        onClick={(e) => {
          if (touched.current) {
            e.preventDefault();
            const hit = pick(e as unknown as PointerEvent<SVGSVGElement>, 26);
            setPinned(hit && hit !== pinned ? hit : null);
          } else if (activeAgent) {
            location.hash = agentHref(activeAgent);
          }
        }}
      >
        {cleared && (yesBand || noBand) && (
          <rect className="ba-won" x={yesBand ? priceX : SIDE_PAD} y={TOP - 4} width={yesBand ? xOf(100) - priceX : priceX - SIDE_PAD} height={baseline - TOP + 4} />
        )}

        <g className="ba-axis">
          <line x1={SIDE_PAD} x2={width - SIDE_PAD} y1={baseline} y2={baseline} />
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t} transform={`translate(${xOf(t)} ${baseline})`}>
              <line y2={5} />
              <text y={19} textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}>
                {t}%
              </text>
            </g>
          ))}
        </g>

        {cleared && (
          <g className="ba-price">
            <line x1={priceX} x2={priceX} y1={8} y2={baseline + 5} />
            <text className="ba-flag" x={priceX + (flagRight ? 8 : -8)} y={22} textAnchor={flagRight ? "start" : "end"}>
              The swarm says {q.price}%
            </text>
            <SideLabels q={q} xOf={xOf} left={`NO holders, ${shares(2)} shares`} right={`YES holders, ${shares(1)} shares`} />
          </g>
        )}

        {q.yes_won !== null && (
          <text className="ba-outcome" x={q.yes_won ? xOf(100) : SIDE_PAD} y={baseline + 40} textAnchor={q.yes_won ? "end" : "start"}>
            {q.yes_won ? "It happened: YES →" : "← It did not happen: NO"}
          </text>
        )}

        <text className="ba-sealnote" x={width / 2} y={baseline - 44} textAnchor="middle">
          {plural(q.commits, "hash", "hashes")} on chain. No numbers.
        </text>

        <g>
          {dots.map((d) => {
            const dim = activeAgent && d.order.agent !== activeAgent;
            const place = sealed ? `translate(${d.sealedX}px, ${baseline - 14}px)` : `translate(${d.x}px, ${d.y}px)`;
            return (
              <a key={d.order.agent} href={agentHref(d.order.agent)} aria-label={`${d.order.agent}, belief ${d.order.belief}, stake ${d.order.stake}`}
                onFocus={() => onHighlight(d.order.agent)} onBlur={() => onHighlight(null)}>
                <g className={`ba-dot${dim ? " is-dim" : ""}`} style={{ transform: place }}>
                  <circle r={sealed ? 4 : d.r} style={{ fill: sealed ? undefined : inkVar(m, d.order.agent) }} />
                </g>
              </a>
            );
          })}
        </g>
      </svg>

      {active && !sealed && (
        <Tip x={active.x} y={active.y} width={width} pinned={!!pinned}>
          <strong className="mono">{m.agents.get(active.order.agent)?.label ?? active.order.agent}</strong>
          <span className="tip-big mono">
            {active.order.belief}%, {plural(active.order.stake, "share")}
          </span>
          <span>
            {active.order.side === 0 ? "Not filled" : `Held ${SIDE_NAME[active.order.side]}, ${active.order.filled} of ${active.order.stake} filled`}
          </span>
          <span className="tip-soft">
            Paid {column(active.order.cost)}, got {column(active.order.payout)} {unit}
          </span>
          {pinned && <a href={agentHref(active.order.agent)}>Open this agent</a>}
        </Tip>
      )}
    </div>
  );
}

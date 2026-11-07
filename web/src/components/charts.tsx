/** The small hand-drawn charts used by the rounds list and the Proof page. */
import { useState } from "react";
import { Tip } from "./bits";
import { useWidth } from "../hooks";
import type { Question } from "../data/types";

/** One line in the rounds list: where the swarm stood, and which end was true. */
export function MiniAxis({ q }: { q: Question }) {
  const w = 120;
  const pad = 4;
  const x = (v: number) => pad + ((w - 2 * pad) * v) / 100;
  const label = q.price > 0 ? `The swarm said ${q.price} percent` : "No answer";
  return (
    <svg className="mini" width={w} height={18} viewBox={`0 0 ${w} 18`} role="img" aria-label={label}>
      <line className="mini-base" x1={pad} x2={w - pad} y1={9} y2={9} />
      <line className="mini-end" x1={pad} x2={pad} y1={6} y2={12} />
      <line className="mini-end" x1={w - pad} x2={w - pad} y1={6} y2={12} />
      {q.yes_won !== null && q.price > 0 && <circle className="mini-truth" cx={x(q.yes_won ? 100 : 0)} cy={9} r={3.5} />}
      {q.price > 0 && <line className="mini-price" x1={x(q.price)} x2={x(q.price)} y1={2} y2={16} />}
    </svg>
  );
}

export interface DumbbellRow {
  label: string;
  from: number;
  to: number;
  reference?: number;
}

/** Before and after, one row per seed. Lower is better, so a good row moves left. */
export function Dumbbell({
  rows,
  fromLabel,
  toLabel,
  referenceLabel,
  caption,
}: {
  rows: DumbbellRow[];
  fromLabel: string;
  toLabel: string;
  referenceLabel?: string;
  caption: string;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const left = 54;
  const right = 18;
  const rowH = 26;
  const top = 6;
  const height = top + rows.length * rowH + 28;
  const peak = Math.max(...rows.flatMap((r) => [r.from, r.to, r.reference ?? 0]));
  const max = Math.ceil((peak * 1.05) / 0.005) * 0.005;
  const x = (v: number) => left + ((width - left - right) * v) / max;
  const ticks = Array.from({ length: Math.round(max / 0.005) + 1 }, (_, i) => i * 0.005);
  const fmt = (v: number) => v.toFixed(4);
  const row = active === null ? null : rows[active];

  return (
    <figure ref={box} className="dumbbell">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="legend" aria-hidden="true">
        <span>
          <i className="key-from" /> {fromLabel}
        </span>
        <span>
          <i className="key-to" /> {toLabel}
        </span>
        {referenceLabel && (
          <span>
            <i className="key-ref" /> {referenceLabel}
          </span>
        )}
      </div>
      {width > 0 && (
        <div className="dumbbell-plot">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption} onPointerLeave={() => setActive(null)}>
            {ticks.map((t) => (
              <g key={t} className="grid">
                <line x1={x(t)} x2={x(t)} y1={top} y2={height - 22} />
                <text x={x(t)} y={height - 8} textAnchor="middle">
                  {t.toFixed(3)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = top + rowH * i + rowH / 2;
              return (
                <g key={r.label} className={active === null || active === i ? "" : "is-dim"} onPointerEnter={() => setActive(i)}>
                  <rect x={0} y={y - rowH / 2} width={width} height={rowH} fill="transparent" />
                  <text className="row-label" x={0} y={y} dy=".33em">
                    {r.label}
                  </text>
                  <line className="bar" x1={x(r.from)} x2={x(r.to)} y1={y} y2={y} />
                  {r.reference !== undefined && <line className="ref" x1={x(r.reference)} x2={x(r.reference)} y1={y - 7} y2={y + 7} />}
                  <circle className="from" cx={x(r.from)} cy={y} r={4.5} />
                  <circle className="to" cx={x(r.to)} cy={y} r={4.5} />
                </g>
              );
            })}
          </svg>
          {row && active !== null && (
            <Tip x={x(row.to)} y={top + rowH * active + rowH / 2} width={width}>
              <strong>{row.label}</strong>
              <span className="mono">
                {fromLabel}: {fmt(row.from)}
              </span>
              <span className="mono">
                {toLabel}: {fmt(row.to)}
              </span>
              {row.reference !== undefined && (
                <span className="mono">
                  {referenceLabel}: {fmt(row.reference)}
                </span>
              )}
            </Tip>
          )}
        </div>
      )}
    </figure>
  );
}

/** All values share one zero line: losses grow left of it, gains right. */
export function SignedBars({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const low = Math.min(0, ...rows.map((r) => r.value));
  const high = Math.max(0, ...rows.map((r) => r.value));
  const range = high - low || 1;
  const percent = (v: number) => (100 * (v - low)) / range;
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span className="bars-track" aria-hidden="true">
            <i style={{ left: `${Math.min(percent(0), percent(r.value))}%`, width: `${(100 * Math.abs(r.value)) / range}%` }} />
            <b style={{ left: `${percent(0)}%` }} />
          </span>
          <span className="mono">
            {r.value > 0 ? "+" : ""}
            {r.value.toFixed(2)}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

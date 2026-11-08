/**
 * The family tree, drawn as a circulatory system. Veins are thick where a family is
 * rich and grey where it has ended. Every dot is a real account and a link.
 */
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Tip } from "./bits";
import { money, plural, tokenSymbol } from "../data/format";
import { layoutVeins, type VeinNode } from "../data/veins";
import { nearest, useModel, useWidth } from "../hooks";
import { agentHref } from "../router";

const MAX_SIZE = 800;
const MAX_SPARKS = 28;

function Card({ node, pinned }: { node: VeinNode; pinned: boolean }) {
  const m = useModel();
  const unit = tokenSymbol(m.snapshot.network);
  const a = node.agent;
  if (!a) {
    return (
      <>
        <strong className="mono">{node.id}</strong>
        <span>The colony. It runs the market and keeps the family record.</span>
      </>
    );
  }
  const strategy = a.genome?.strategy.split(/(?<=[.!?])\s/)[0];
  return (
    <>
      <strong className="mono">
        {a.status === "Dead" ? "† " : ""}
        {a.label}
      </strong>
      <span className="tip-big mono">{a.status === "Dead" ? "Deleted" : `${money(a.credits)} ${unit}`}</span>
      <span>
        {a.generation === 0 ? "Founder" : `Generation ${a.generation + 1}`}, {plural(a.questions, "round")}
      </span>
      {strategy && <span className="tip-soft">{strategy}</span>}
      {pinned && <a href={agentHref(a.id)}>Open this agent</a>}
    </>
  );
}

export function Veins() {
  const m = useModel();
  const [box, width] = useWidth<HTMLDivElement>();
  const size = Math.min(width, MAX_SIZE);
  const layout = useMemo(() => (size ? layoutVeins(m, size) : null), [m, size]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pointer = useRef("mouse");

  const byId = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const activeId = hovered ?? pinned;
  const active = activeId ? byId.get(activeId) : undefined;

  // The active agent, its ancestors and everything descended from it.
  const lit = useMemo(() => {
    const ids = new Set<string>();
    if (!active) return ids;
    for (let n: VeinNode | null = active; n; n = n.parent) ids.add(n.id);
    const stack = [active];
    while (stack.length) {
      const n = stack.pop()!;
      ids.add(n.id);
      stack.push(...n.children);
    }
    return ids;
  }, [active]);

  const richest = useMemo(() => {
    const living = (layout?.nodes ?? []).filter((n) => n.agent && n.agent.status !== "Dead");
    return new Set(living.sort((a, b) => b.r - a.r).slice(0, 3).map((n) => n.id));
  }, [layout]);

  if (!layout) {
    return (
      <div ref={box} className="veins">
        {width > 0 && <p className="empty">No agents yet. The tree starts when the first founder joins.</p>}
      </div>
    );
  }

  const agents = layout.nodes.filter((n) => n.agent);
  const closest = (e: { clientX: number; clientY: number }, limit: number) => {
    const rect = svg.current!.getBoundingClientRect();
    return nearest(agents, e.clientX - rect.left, e.clientY - rect.top, limit);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    pointer.current = e.pointerType;
    if (e.pointerType !== "touch") setHovered(closest(e, 34)?.id ?? null);
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const hit = closest(e, pointer.current === "touch" ? 30 : 34);
    if (pointer.current === "touch") setPinned(hit && hit.id !== pinned ? hit.id : null);
    else if (hit?.agent) location.hash = agentHref(hit.agent.id);
  };

  const left = (width - layout.size) / 2;
  const unit = tokenSymbol(m.snapshot.network);
  const sparks = layout.nodes.filter((n) => n.line && n.agent?.status !== "Dead").slice(0, MAX_SPARKS);

  return (
    <div ref={box} className="veins">
      <svg
        ref={svg}
        className={`v-svg${active ? " has-active" : ""}`}
        width={layout.size}
        height={layout.size}
        viewBox={`0 0 ${layout.size} ${layout.size}`}
        style={{ marginLeft: left }}
        role="group"
        aria-label={`The family tree of ${plural(agents.length, "agent")}. Every agent is a link.`}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onPointerMove={onMove}
        onPointerLeave={() => setHovered(null)}
        onClick={onClick}
      >
        <defs>
          <radialGradient id="blood" gradientUnits="userSpaceOnUse" cx={layout.cx} cy={layout.cy} r={layout.size / 2}>
            <stop offset="0%" stopColor="#ff5a72" />
            <stop offset="42%" stopColor="#e0223d" />
            <stop offset="100%" stopColor="#7c1024" />
          </radialGradient>
          <radialGradient id="heart">
            <stop offset="0%" stopColor="#ff7b8e" />
            <stop offset="70%" stopColor="#c8152f" />
            <stop offset="100%" stopColor="#7c1024" />
          </radialGradient>
        </defs>

        <g aria-hidden="true">
          {layout.rings.map((r) => (
            <circle key={r} className="v-ring" cx={layout.cx} cy={layout.cy} r={r} />
          ))}
        </g>

        <g className="v-glow">
          {layout.nodes
            .filter((n) => n.outline)
            .map((n) => (
              <path key={n.id} className={`v-vein${n.agent?.status === "Dead" ? " is-dead" : ""}${lit.has(n.id) ? " is-lit" : ""}`} d={n.outline} fill="url(#blood)" />
            ))}
        </g>

        <g className="v-sparks" aria-hidden="true">
          {sparks.map((n, i) => (
            <circle key={n.id} className="v-spark" r={1.6} opacity={0}>
              <animateMotion dur={`${n.beat}s`} begin={`${-i * 0.7}s`} repeatCount="indefinite" path={n.line} />
              <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.12;0.82;1" dur={`${n.beat}s`} begin={`${-i * 0.7}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>

        <g aria-hidden="true">
          <circle className="v-beat" cx={layout.cx} cy={layout.cy} r={15} />
          <circle className="v-beat two" cx={layout.cx} cy={layout.cy} r={15} />
          <circle className="v-core" cx={layout.cx} cy={layout.cy} r={13} />
        </g>

        {agents.map((n) => {
          const a = n.agent!;
          const dead = a.status === "Dead";
          return (
            <a
              key={n.id}
              className={`v-node${dead ? " is-dead" : ""}${lit.has(n.id) ? " is-lit" : ""}${richest.has(n.id) ? " is-top" : ""}`}
              href={agentHref(a.id)}
              aria-label={`${a.label}, ${dead ? "deleted" : `${money(a.credits)} ${unit}`}, ${plural(a.questions, "round")}`}
              onFocus={() => setHovered(n.id)}
              onBlur={() => setHovered(null)}
            >
              <circle className="v-hit" cx={n.x} cy={n.y} r={Math.max(n.r + 10, 16)} />
              <circle className="v-dot" cx={n.x} cy={n.y} r={n.r} />
              {n.label && (
                <text className="v-label" x={n.label.x} y={n.label.y} textAnchor={n.label.anchor} dy=".33em">
                  {dead ? "† " : ""}
                  {a.label}
                </text>
              )}
            </a>
          );
        })}
      </svg>
      {active && (
        <Tip x={active.x + left} y={active.y} width={width} pinned={!hovered && pinned === active.id}>
          <Card node={active} pinned={!hovered && pinned === active.id} />
        </Tip>
      )}
    </div>
  );
}

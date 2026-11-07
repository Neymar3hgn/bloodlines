import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Tip } from "./bits";
import { money, plural, tokenSymbol } from "../data/format";
import { inkVar } from "../data/model";
import { layoutTree, type TreeLayout, type TreeNode } from "../data/treeLayout";
import { nearest, useModel, useWidth } from "../hooks";
import { agentHref } from "../router";

/** Rows past this are folded on a phone, so the rest of the page stays reachable. */
const FOLDED_ROWS = 44;
const ROW_H = 20;

function NodeCard({ node, pinned }: { node: TreeNode; pinned: boolean }) {
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
  const founder = m.founderOf.get(a.id);
  return (
    <>
      <strong className="mono">
        {a.status === "Dead" ? "† " : ""}
        {a.label}
      </strong>
      <span className="tip-big mono">{a.status === "Dead" ? "Deleted" : `${money(a.credits)} ${unit}`}</span>
      <span>
        {plural(a.questions, "question")}, won {money(a.won)}, lost {money(a.lost)}
      </span>
      <span className="tip-soft">
        {a.generation === 0 ? "Founder" : `Generation ${a.generation}, ${founder ? m.agents.get(founder)?.label : ""} line`}
      </span>
      {pinned && <a href={agentHref(a.id)}>Open this agent</a>}
    </>
  );
}

function Guides({ layout }: { layout: TreeLayout }) {
  if (layout.mode === "radial") {
    return (
      <g className="t-guides" aria-hidden="true">
        {layout.guides.map((r) => (
          <circle key={r} cx={layout.cx} cy={layout.cy} r={r} />
        ))}
        {layout.guides.map((r, i) => (
          <text key={r} x={layout.cx} y={layout.cy - r} dy=".32em" textAnchor="middle">
            {i + 1}
          </text>
        ))}
      </g>
    );
  }
  return (
    <g className="t-guides" aria-hidden="true">
      {layout.guides.map((x, i) => (
        <g key={x}>
          <line x1={x} x2={x} y1={14} y2={layout.height} />
          <text x={x} y={9} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

function Branch({ node, lit, ink, width }: { node: TreeNode; lit: boolean; ink: string; width: number }) {
  const dead = node.agent?.status === "Dead";
  const style = { stroke: ink, strokeWidth: dead ? Math.min(width, 1) : width, animationDelay: `${node.depth * 110}ms` };
  return <path className={`t-link${dead ? " is-dead" : ""}${lit ? " is-lit" : ""}`} d={node.path} pathLength={1} style={style} />;
}

export function FamilyTree({ highlight = null }: { highlight?: string | null }) {
  const m = useModel();
  const [box, width] = useWidth<HTMLDivElement>();
  const layout = useMemo(() => (width ? layoutTree(m, width) : null), [m, width]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const lastPointer = useRef("mouse");

  const byId = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const activeId = hovered ?? pinned ?? highlight;
  const active = activeId ? byId.get(activeId) : undefined;

  // The active agent, its ancestors and everything descended from it.
  const lit = useMemo(() => {
    const ids = new Set<string>();
    if (!active) return ids;
    for (let n: TreeNode | null = active; n; n = n.parent) ids.add(n.id);
    const stack = [active];
    while (stack.length) {
      const n = stack.pop()!;
      ids.add(n.id);
      stack.push(...n.children);
    }
    return ids;
  }, [active]);

  if (!layout) {
    return (
      <div ref={box} className="tree">
        {width > 0 && <p className="empty">No agents yet. The tree starts when the first founder joins.</p>}
      </div>
    );
  }

  const fold = layout.mode === "rows" && layout.leafCount > FOLDED_ROWS && !unfolded;
  const unit = tokenSymbol(m.snapshot.network);

  const closest = (e: { clientX: number; clientY: number }, limit: number) => {
    const rect = svg.current!.getBoundingClientRect();
    return nearest(layout.nodes, e.clientX - rect.left, e.clientY - rect.top, limit);
  };

  const reach = layout.mode === "rows" ? 18 : 24;

  /** The agent under the pointer: a label it is on, or else the closest node in reach. */
  const underPointer = (e: { clientX: number; clientY: number; target: EventTarget }, limit: number) => {
    const onLabel = (e.target as Element).closest?.("a[data-id]")?.getAttribute("data-id");
    return onLabel ? byId.get(onLabel) : closest(e, limit);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType === "touch") return;
    setHovered(underPointer(e, reach)?.id ?? null);
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (lastPointer.current === "touch") {
      // No hover on a phone: the first tap shows the card, which has the link.
      e.preventDefault();
      const hit = underPointer(e, 28);
      setPinned(hit && hit.id !== pinned ? hit.id : null);
      return;
    }
    const hit = underPointer(e, reach);
    if (hit?.agent) location.hash = agentHref(hit.agent.id);
  };

  const left = (width - layout.width) / 2;
  const tipNode = active && (hovered || pinned) ? active : undefined;

  return (
    <div ref={box} className="tree">
      <div className="tree-clip" style={fold ? { maxHeight: FOLDED_ROWS * ROW_H } : undefined}>
        <svg
          ref={svg}
          className={`t-svg${active ? " has-active" : ""}`}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ marginLeft: left }}
          role="group"
          aria-label={`Family tree of ${plural(m.agents.size, "agent")}. Every agent is a link.`}
          onPointerDown={(e) => (lastPointer.current = e.pointerType)}
          onPointerMove={onMove}
          onPointerLeave={() => setHovered(null)}
          onClick={onClick}
        >
          <Guides layout={layout} />
          <g fill="none">
            {layout.nodes
              .filter((n) => n.path)
              .map((n) => {
                const founder = m.founderOf.get(n.id) ?? n.id;
                return <Branch key={n.id} node={n} lit={lit.has(n.id)} ink={inkVar(m, founder)} width={Math.max(1.15, 2.3 - n.depth * 0.2)} />;
              })}
          </g>
          {layout.nodes.map((n) =>
            n.label?.leader ? <path key={n.id} className={`t-leader${lit.has(n.id) ? " is-lit" : ""}`} d={n.label.leader} /> : null,
          )}
          {layout.mode === "radial" && (
            <g className="t-hub">
              <circle cx={layout.cx} cy={layout.cy} r={19} />
              <text x={layout.cx} y={layout.cy} dy=".34em" textAnchor="middle">
                Clade
              </text>
            </g>
          )}
          {layout.mode === "rows" && <circle className="t-root" cx={layout.nodes[0].x} cy={layout.nodes[0].y} r={3.5} />}
          {layout.nodes.map((n) => {
            const a = n.agent;
            if (!a) return null;
            const dead = a.status === "Dead";
            const ink = inkVar(m, a.id);
            return (
              <a
                key={n.id}
                className={`t-node${dead ? " is-dead" : ""}${lit.has(n.id) ? " is-lit" : ""}`}
                href={agentHref(a.id)}
                data-id={n.id}
                aria-label={`${a.label}, ${dead ? "dead" : `${money(a.credits)} ${unit}`}, ${plural(a.questions, "question")}`}
                onFocus={() => setHovered(n.id)}
                onBlur={() => setHovered(null)}
              >
                <circle cx={n.x} cy={n.y} r={n.r} style={dead ? { stroke: ink } : { fill: ink }} />
                {dead && !n.label && (
                  <text className="t-dagger" x={n.x + n.r + 2} y={n.y - n.r - 1}>
                    †
                  </text>
                )}
                {n.label && (
                  <text className="t-label" transform={n.label.transform} textAnchor={n.label.anchor} dy=".33em" style={{ fontSize: layout.labelSize }}>
                    {n.label.text}
                  </text>
                )}
              </a>
            );
          })}
        </svg>
      </div>
      {fold && (
        <button type="button" className="unfold" onClick={() => setUnfolded(true)}>
          Show all {plural(layout.leafCount, "branch", "branches")}
        </button>
      )}
      {tipNode && (
        <Tip x={tipNode.x + left} y={tipNode.y} width={width} pinned={!hovered && pinned === tipNode.id}>
          <NodeCard node={tipNode} pinned={!hovered && pinned === tipNode.id} />
        </Tip>
      )}
    </div>
  );
}

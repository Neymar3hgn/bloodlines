/**
 * The geometry of the family tree, with no React in it. Each agent is a tapered vein
 * grown from its parent. A vein's width follows what its family still holds, and the
 * bends are decided by the account name, so the picture is the same on every visit.
 */
import { cluster, hierarchy, type HierarchyPointNode } from "d3-hierarchy";
import { big } from "./format";
import type { Model } from "./model";
import type { Agent } from "./types";

export interface VeinNode {
  id: string;
  agent: Agent | null;
  depth: number;
  x: number;
  y: number;
  /** Area follows the agent's balance. */
  r: number;
  parent: VeinNode | null;
  children: VeinNode[];
  /** The filled, tapered shape of the vein from the parent. Empty for the colony. */
  outline: string;
  /** The vein's centre line. */
  line: string;
  /** Seconds, for the light that travels along the vein. */
  beat: number;
  label: { x: number; y: number; anchor: "start" | "middle" | "end" } | null;
}

export interface VeinLayout {
  size: number;
  cx: number;
  cy: number;
  nodes: VeinNode[];
  rings: number[];
}

interface Datum {
  id: string;
  agent: Agent | null;
  wealth: number;
  children: Datum[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A number from 0 to 1 that depends only on the text, so nothing moves between visits. */
function seed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const credits = (a: Agent | null) => (a && a.status !== "Dead" ? Number(big(a.credits)) / 1e6 : 0);

function dotRadius(agent: Agent, compact: boolean): number {
  if (agent.status === "Dead") return 4;
  return clamp(3.5 + Math.sqrt(credits(agent)) * (compact ? 3.4 : 4.6), 3.5, compact ? 10 : 14);
}

function tapered(from: { x: number; y: number }, to: { x: number; y: number }, bendSeed: number, baseWidth: number, tipWidth: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const bend = (bendSeed - 0.5) * length * 0.52;
  const c1 = { x: from.x + ux * length * 0.34 + nx * bend, y: from.y + uy * length * 0.34 + ny * bend };
  const c2 = { x: from.x + ux * length * 0.72 - nx * bend * 0.6, y: from.y + uy * length * 0.72 - ny * bend * 0.6 };

  const left: string[] = [];
  const right: string[] = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    const x = m * m * m * from.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * to.x;
    const y = m * m * m * from.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * to.y;
    const tx = 3 * m * m * (c1.x - from.x) + 6 * m * t * (c2.x - c1.x) + 3 * t * t * (to.x - c2.x);
    const ty = 3 * m * m * (c1.y - from.y) + 6 * m * t * (c2.y - c1.y) + 3 * t * t * (to.y - c2.y);
    const norm = Math.hypot(tx, ty) || 1;
    const w = baseWidth + (tipWidth - baseWidth) * t ** 0.75;
    left.push(`${(x - (ty / norm) * w).toFixed(1)} ${(y + (tx / norm) * w).toFixed(1)}`);
    right.push(`${(x + (ty / norm) * w).toFixed(1)} ${(y - (tx / norm) * w).toFixed(1)}`);
  }
  return {
    outline: `M${left.join("L")}L${right.reverse().join("L")}Z`,
    line: `M${from.x.toFixed(1)} ${from.y.toFixed(1)}C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
  };
}

export function layoutVeins(m: Model, size: number): VeinLayout | null {
  const walk = (id: string, agent: Agent | null): Datum => {
    const children = (m.childrenOf.get(id) ?? []).map((a) => walk(a.id, a));
    return { id, agent, children, wealth: credits(agent) + children.reduce((t, c) => t + c.wealth, 0) };
  };
  const data = walk(m.snapshot.colony, null);
  if (data.children.length === 0) return null;

  const hier = hierarchy(data);
  const leaves = hier.leaves().length;
  const generations = hier.height;
  const compact = size < 560;
  const room = compact ? 30 : 46;
  const radius = size / 2 - room;
  const ring = (depth: number) => (generations === 1 ? radius * 0.92 : radius * (0.72 + (0.28 * (depth - 1)) / (generations - 1)));

  const root = cluster<Datum>()
    .size([2 * Math.PI, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.2))(hier);

  const cx = size / 2;
  const cy = size / 2;
  const slice = (2 * Math.PI) / leaves;
  const nodes: VeinNode[] = [];
  const showLabel = !compact || leaves <= 24;

  const place = (d: HierarchyPointNode<Datum>, parent: VeinNode | null): VeinNode => {
    const { agent, id, wealth } = d.data;
    const wobble = agent ? (seed(`${id}/a`) - 0.5) * slice * 0.42 : 0;
    const angle = d.x - Math.PI / 2 + wobble;
    const reach = agent ? ring(d.depth) * (1 + (seed(`${id}/r`) - 0.5) * 0.12) : 0;
    const x = cx + Math.cos(angle) * reach;
    const y = cy + Math.sin(angle) * reach;
    const r = agent ? dotRadius(agent, compact) : 0;

    let outline = "";
    let line = "";
    if (parent && agent) {
      const dead = agent.status === "Dead";
      const base = dead ? 1 : clamp((d.depth === 1 ? 1.5 : 1) + Math.sqrt(wealth) * (compact ? 1.5 : 2), 1, compact ? 4.5 : 6.5);
      ({ outline, line } = tapered({ x: parent.x, y: parent.y }, { x, y }, seed(`${id}/b`), base, dead ? 0.6 : 0.9));
    }

    let label: VeinNode["label"] = null;
    if (agent && showLabel) {
      const out = r + (compact ? 8 : 12);
      // A parent's child grows straight outward, so its name sits to the side of the vein.
      const turn = d.children ? angle + Math.PI / 2 : angle;
      const lx = x + Math.cos(turn) * out;
      const ly = y + Math.sin(turn) * out;
      const side = Math.cos(turn);
      label = { x: lx, y: ly, anchor: Math.abs(side) < 0.22 ? "middle" : side > 0 ? "start" : "end" };
    }

    const node: VeinNode = { id, agent, depth: d.depth, x, y, r, parent, children: [], outline, line, beat: 5 + seed(`${id}/t`) * 5, label };
    nodes.push(node);
    node.children = (d.children ?? []).map((c) => place(c, node));
    return node;
  };
  place(root, null);

  return {
    size,
    cx,
    cy,
    nodes,
    rings: Array.from({ length: Math.max(generations, 1) }, (_, i) => ring(i + 1)),
  };
}

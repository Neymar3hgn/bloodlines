/**
 * The geometry of the family tree, with no React in it.
 *
 * Wide screens get a radial tree: the distance from the centre is the generation.
 * Narrow screens with many agents get rows, one leaf per line, because rotated
 * labels stop being readable there. Each leaf owns a slice of the circle (or a row),
 * so a label can never cross another lineage.
 */
import { cluster, hierarchy, type HierarchyPointNode } from "d3-hierarchy";
import { big } from "./format";
import type { Model } from "./model";
import type { Agent } from "./types";

export interface Label {
  text: string;
  transform: string;
  anchor: "start" | "end";
  /** A short line from a leaf to a label that had to move outward for room. */
  leader: string | null;
}

export interface TreeNode {
  id: string;
  agent: Agent | null;
  depth: number;
  x: number;
  y: number;
  r: number;
  parent: TreeNode | null;
  children: TreeNode[];
  /** Branch from the parent. Empty for the colony. */
  path: string;
  label: Label | null;
}

export interface TreeLayout {
  mode: "radial" | "rows";
  width: number;
  height: number;
  cx: number;
  cy: number;
  nodes: TreeNode[];
  /** Radial: ring radii by generation. Rows: x of each generation. */
  guides: number[];
  labelSize: number;
  leafCount: number;
}

interface Datum {
  id: string;
  agent: Agent | null;
  children: Datum[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Area follows credits, so a square root. Dead agents hold nothing, so they get a fixed small ring. */
export function nodeRadius(agent: Agent | null, scale = 1): number {
  if (!agent) return 5;
  if (agent.status === "Dead") return 3;
  const credits = Number(big(agent.credits)) / 1e6;
  return clamp(2.4 + Math.sqrt(credits) * 2.1, 2.6, 11) * scale;
}

const clip = (label: string, max: number) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

function buildData(m: Model): Datum {
  const walk = (id: string, agent: Agent | null): Datum => ({
    id,
    agent,
    children: (m.childrenOf.get(id) ?? []).map((a) => walk(a.id, a)),
  });
  return walk(m.snapshot.colony, null);
}

export function layoutTree(m: Model, width: number): TreeLayout | null {
  const root = hierarchy(buildData(m));
  const leaves = root.leaves();
  if (leaves.length <= 1 && !root.children) return null;
  const narrow = width < 560;
  return narrow && leaves.length > 36 ? rows(root, width) : radial(root, width, narrow);
}

/** Copies d3's nodes into TreeNodes, keeping parent links. */
function adopt(
  placed: HierarchyPointNode<Datum>,
  position: (n: HierarchyPointNode<Datum>) => { x: number; y: number; r: number },
  parent: TreeNode | null,
  out: TreeNode[],
): TreeNode {
  const { x, y, r } = position(placed);
  const node: TreeNode = { id: placed.data.id, agent: placed.data.agent, depth: placed.depth, x, y, r, parent, children: [], path: "", label: null };
  out.push(node);
  node.children = (placed.children ?? []).map((c) => adopt(c, position, node, out));
  return node;
}

function radial(hier: ReturnType<typeof hierarchy<Datum>>, width: number, narrow: boolean): TreeLayout {
  const leaves = hier.leaves();
  const n = leaves.length;
  const maxDepth = hier.height;
  const labelSize = narrow ? 9.5 : 10.5;
  const charW = labelSize * 0.6;
  const maxChars = 10;
  const longest = Math.min(maxChars, Math.max(...leaves.map((l) => l.data.agent?.label.length ?? 0)) + 2);
  const band = longest * charW + 12;

  const wanted = clamp(170 + n * 3 + maxDepth * 14, 390, 500);
  let half = Math.min(width / 2, wanted);
  const outer = Math.min(Math.max(40, half - band), Math.max(1, maxDepth) * 165);
  half = Math.min(half, outer + band + 6);
  // Rings spread out toward the centre, where early generations would otherwise crowd the hub.
  const ring = (depth: number) => outer * (depth / Math.max(1, maxDepth)) ** 0.72;

  const root = cluster<Datum>()
    .size([2 * Math.PI, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.12))(hier);

  const point = (angle: number, radius: number): [number, number] => [radius * Math.sin(angle), -radius * Math.cos(angle)];
  const cx = half;
  const cy = half;
  const nodes: TreeNode[] = [];
  const scale = narrow ? 0.85 : 1;
  adopt(
    root,
    (d) => {
      const [x, y] = point(d.x, ring(d.depth));
      return { x: cx + x, y: cy + y, r: nodeRadius(d.data.agent, scale) };
    },
    null,
    nodes,
  );

  // A label needs a slice at least as tall as its text, so it starts where the slice is wide enough.
  const slice = (2 * Math.PI) / (n + 1);
  const roomFrom = (labelSize + 1.5) / slice;
  const labelled = roomFrom < outer + 8;

  const byId = new Map(nodes.map((t) => [t.id, t]));
  root.each((d) => {
    const node = byId.get(d.data.id)!;
    const radius = ring(d.depth);
    const parentR = d.parent ? ring(d.parent.depth) : 0;
    const dead = node.agent?.status === "Dead";

    if (d.parent) {
      const start = d.parent.x;
      const end = d.x;
      if (parentR === 0) {
        const [x, y] = point(end, radius);
        node.path = `M${cx} ${cy}L${cx + x} ${cy + y}`;
      } else {
        const [x0, y0] = point(start, parentR);
        const [x1, y1] = point(end, parentR);
        const [x2, y2] = point(end, radius);
        const sweep = end > start ? 1 : 0;
        const large = Math.abs(end - start) > Math.PI ? 1 : 0;
        node.path = `M${cx + x0} ${cy + y0}A${parentR} ${parentR} 0 ${large} ${sweep} ${cx + x1} ${cy + y1}L${cx + x2} ${cy + y2}`;
      }
    }

    if (!node.agent) return;
    const deg = (d.x * 180) / Math.PI;
    const flip = deg > 180;
    const text = `${dead ? "† " : ""}${clip(node.agent.label, maxChars)}`;

    if (!d.children) {
      if (!labelled) return;
      const tight = radius + node.r + 5;
      const at = Math.max(tight, roomFrom);
      let leader: string | null = null;
      if (at - tight > 6) {
        const [x0, y0] = point(d.x, radius + node.r + 1.5);
        const [x1, y1] = point(d.x, at - 3);
        leader = `M${cx + x0} ${cy + y0}L${cx + x1} ${cy + y1}`;
      }
      node.label = {
        text,
        anchor: flip ? "end" : "start",
        transform: `translate(${cx} ${cy}) rotate(${deg - 90}) translate(${at} 0)${flip ? " rotate(180)" : ""}`,
        leader,
      };
      return;
    }

    // A parent's name sits along its own branch, when the branch is long enough and the sector has room.
    const textW = text.length * charW + 4;
    const span = d.leaves().length * slice;
    const branch = radius - parentR;
    if (branch > textW + node.r + 8 && span * (radius - branch / 2) >= labelSize + 8) {
      const along = radius - node.r - 4;
      node.label = {
        text,
        anchor: flip ? "start" : "end",
        transform: `translate(${cx} ${cy}) rotate(${deg - 90}) translate(${along} ${-4})${flip ? " rotate(180)" : ""}`,
        leader: null,
      };
    }
  });

  return {
    mode: "radial",
    width: 2 * half,
    height: 2 * half,
    cx,
    cy,
    nodes,
    guides: Array.from({ length: maxDepth }, (_, i) => ring(i + 1)),
    labelSize,
    leafCount: n,
  };
}

function rows(hier: ReturnType<typeof hierarchy<Datum>>, width: number): TreeLayout {
  const leaves = hier.leaves();
  const maxDepth = hier.height;
  const rowH = 20;
  const labelSize = 11;
  const charW = labelSize * 0.6;
  const maxChars = 12;
  const longest = Math.min(maxChars, Math.max(...leaves.map((l) => l.data.agent?.label.length ?? 0)) + 2);
  const band = longest * charW + 14;
  const pad = 8;
  const step = Math.min(90, (width - band - pad * 2) / Math.max(1, maxDepth));
  const top = 26;

  const root = cluster<Datum>()
    .nodeSize([rowH, 1])
    .separation(() => 1)(hier);

  let lowest = Infinity;
  root.each((d) => {
    lowest = Math.min(lowest, d.x);
  });
  const yOf = (d: HierarchyPointNode<Datum>) => top + d.x - lowest;
  const xOf = (depth: number) => pad + depth * step;

  const nodes: TreeNode[] = [];
  adopt(root, (d) => ({ x: xOf(d.depth), y: yOf(d), r: nodeRadius(d.data.agent, 0.9) }), null, nodes);

  const byId = new Map(nodes.map((t) => [t.id, t]));
  root.each((d) => {
    const node = byId.get(d.data.id)!;
    if (d.parent) node.path = `M${xOf(d.parent.depth)} ${yOf(d.parent)}V${yOf(d)}H${xOf(d.depth)}`;
    if (!node.agent) return;
    const text = `${node.agent.status === "Dead" ? "† " : ""}${clip(node.agent.label, maxChars)}`;
    if (!d.children) {
      node.label = { text, anchor: "start", transform: `translate(${node.x + node.r + 5} ${node.y})`, leader: null };
    } else if (step > text.length * charW + 12) {
      node.label = { text, anchor: "end", transform: `translate(${node.x - node.r - 3} ${node.y - 5})`, leader: null };
    }
  });

  return {
    mode: "rows",
    width,
    height: top + (leaves.length - 1) * rowH + rowH,
    cx: 0,
    cy: 0,
    nodes,
    guides: Array.from({ length: maxDepth }, (_, i) => xOf(i + 1)),
    labelSize,
    leafCount: leaves.length,
  };
}

import { UndirectedGraph } from 'graphology';

/* The fiche graph as graphology holds it for Sigma: no WebGL here, so it is tested in jsdom. */

export type GraphData = {
  nodes: { id: number; title: string; typeId: number; degree: number; flagged: boolean }[];
  edges: { from: number; to: number; relation: string }[];
};

/** Colors read on the page tokens (`--lavis`, `--bordure-forte`, `--danger`, `--accent`, `--lune`). */
export type Palette = { node: string; edge: string; flagged: string; accent: string; label: string };

export type NodeAttrs = {
  label: string;
  typeId: number;
  x: number;
  y: number;
  size: number;
  color: string;
  borderColor: string;
};

/** Between 3 and 14, growing as the square root of the number of links. */
export const nodeSize = (degree: number): number => Math.min(14, 3 + 1.1 * Math.sqrt(degree));

/** One node per fiche, one edge per linked pair; an edge towards an absent fiche is dropped. */
export function buildGraph(data: GraphData, palette: Palette): UndirectedGraph<NodeAttrs> {
  const g = new UndirectedGraph<NodeAttrs>();
  // Random start: ForceAtlas2 then spreads it, a ring would only unfold slowly.
  for (const n of data.nodes)
    g.addNode(String(n.id), {
      label: n.title,
      typeId: n.typeId,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: nodeSize(n.degree),
      color: palette.node,
      borderColor: n.flagged ? palette.flagged : palette.node,
    });
  for (const e of data.edges) {
    const [a, b] = [String(e.from), String(e.to)];
    if (a !== b && g.hasNode(a) && g.hasNode(b))
      g.mergeEdge(a, b, { label: e.relation, color: palette.edge, size: 1 });
  }
  return g;
}

/** The fiche and its direct neighbours; empty when the fiche is not in the graph. */
export function focus(graph: UndirectedGraph<NodeAttrs>, id: number): Set<number> {
  const key = String(id);
  if (!graph.hasNode(key)) return new Set();
  return new Set([id, ...graph.neighbors(key).map(Number)]);
}

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

/** Between 2 and 10, growing as the square root of the number of links: small dots at overview. */
export const nodeSize = (degree: number): number => Math.min(10, 2 + 0.8 * Math.sqrt(degree));

/**
 * A translucent token (`rgba(…, .12)`) made opaque on the stage color (`#rrggbb`): Sigma blends as if
 * colors were premultiplied, so a light color at 12 % would be drawn nearly at full strength. The color
 * is `rgba(…)` or the `#rrggbbaa` the build minifies it into; the stage is `#rrggbb` or `rgb(r, g, b)`.
 */
export function flatten(color: string, stage: string): string {
  const c = color.trim();
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(c);
  const hex = /^#[\da-f]{8}$/i.test(c) ? [1, 3, 5, 7].map((i) => parseInt(c.slice(i, i + 2), 16)) : null;
  const rgba = m ? m.slice(1).map(Number) : hex ? [...hex.slice(0, 3), hex[3]! / 255] : null;
  if (!rgba) return color;
  const s = stage.trim();
  const bg = s.startsWith('#')
    ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
    : (s.match(/\d+/g) ?? []).map(Number);
  const a = rgba[3]!;
  return `rgb(${[0, 1, 2].map((i) => Math.round(rgba[i]! * a + bg[i]! * (1 - a))).join(',')})`;
}

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

/** What stands out: the fiche and its neighbours, or `null` (nothing greyed) for no fiche or an unknown one. */
export function activeSet(graph: UndirectedGraph<NodeAttrs>, id: number | null): Set<number> | null {
  const near = id === null ? null : focus(graph, id);
  return near?.size ? near : null;
}

import { describe, expect, it } from 'vitest';
import { activeSet, buildGraph, flatten, focus, nodeSize, type GraphData, type Palette } from './graph.ts';

const palette: Palette = { node: 'n', edge: 'e', flagged: 'f', accent: 'a', label: 'l' };
const data: GraphData = {
  nodes: [
    { id: 1, title: 'Client X', typeId: 1, degree: 2, flagged: false },
    { id: 2, title: 'Jeanne D.', typeId: 1, degree: 1, flagged: true },
    { id: 3, title: 'Entreprise Z', typeId: 2, degree: 1, flagged: false },
    { id: 4, title: 'Seule', typeId: 2, degree: 0, flagged: false },
  ],
  edges: [
    { from: 1, to: 2, relation: 'connaît' },
    { from: 1, to: 3, relation: 'travaille chez' },
    { from: 3, to: 99, relation: 'vers une fiche absente' },
  ],
};

describe('graph', () => {
  it('builds one node per fiche and one edge per link, an edge to a missing node is skipped', () => {
    const g = buildGraph(data, palette);
    expect(g.order).toBe(4);
    expect(g.size).toBe(2);
    expect(g.getNodeAttribute('1', 'label')).toBe('Client X');
    expect(g.getEdgeAttribute(g.edge('1', '3')!, 'color')).toBe('e');
  });

  it('outlines a flagged fiche in the flagged color, sizes nodes by degree', () => {
    const g = buildGraph(data, palette);
    expect(g.getNodeAttribute('2', 'borderColor')).toBe('f');
    expect(g.getNodeAttribute('1', 'borderColor')).toBe('n');
    expect(g.getNodeAttribute('1', 'size')).toBe(nodeSize(2));
    expect(g.getNodeAttribute('4', 'size')).toBe(2);
  });

  it('flattens a translucent token on the stage color: WebGL would draw it at full strength', () => {
    expect(flatten('rgba(200,192,176,.12)', '#100D0A')).toBe('rgb(38,34,30)');
    expect(flatten('rgba(200, 192, 176, 0.5)', 'rgb(0, 0, 0)')).toBe('rgb(100,96,88)');
    expect(flatten('#8A9BAE', '#100D0A')).toBe('#8A9BAE');
    expect(flatten('rgb(1,2,3)', '#100D0A')).toBe('rgb(1,2,3)');
  });

  it('nodeSize grows as a root between 2 and 10 (small dots at overview)', () => {
    expect(nodeSize(0)).toBe(2);
    expect(nodeSize(10000)).toBe(10);
    expect(nodeSize(4)).toBeGreaterThan(nodeSize(1));
    expect(nodeSize(4) - nodeSize(1)).toBeGreaterThan(nodeSize(9) - nodeSize(6));
  });

  it('focus gives the fiche and its direct neighbours', () => {
    const g = buildGraph(data, palette);
    expect(focus(g, 1)).toEqual(new Set([1, 2, 3]));
    expect(focus(g, 3)).toEqual(new Set([3, 1]));
    expect(focus(g, 42)).toEqual(new Set());
  });

  it('activeSet: no fiche or an unknown one means no focus, the graph is not greyed', () => {
    const g = buildGraph(data, palette);
    expect(activeSet(g, null)).toBeNull();
    expect(activeSet(g, 42)).toBeNull();
    expect(activeSet(g, 3)).toEqual(new Set([3, 1]));
  });

  it('builds 5 000 nodes and 15 000 edges in under 500 ms', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      title: `Fiche ${i + 1}`,
      typeId: 1,
      degree: 6,
      flagged: false,
    }));
    const edges = Array.from({ length: 15000 }, (_, i) => ({
      from: (i % 5000) + 1,
      to: ((i * 7 + 13) % 5000) + 1,
      relation: 'lié',
    }));
    const t = performance.now();
    const g = buildGraph({ nodes, edges }, palette);
    expect(performance.now() - t).toBeLessThan(500);
    expect(g.order).toBe(5000);
  });
});

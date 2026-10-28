import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../api.ts';
import { detail } from './fixtures.ts';
import Graphe from './Graphe.svelte';

const animate = vi.hoisted(() => vi.fn(async () => {}));
// No WebGL in jsdom: Sigma, its border program and the layout worker are stood in for.
vi.mock('sigma', () => ({
  default: class {
    on() {}
    setSetting() {}
    kill() {}
    // Right after a reducer change, Sigma's cache holds raw graph coordinates, not framed ones.
    getNodeDisplayData() {
      return { x: -541, y: 789 };
    }
    graphToViewport() {
      return { x: 300, y: 200 };
    }
    viewportToFramedGraph(p: { x: number; y: number }) {
      return { x: p.x / 1000, y: p.y / 1000 };
    }
    getCamera() {
      return { ratio: 1, animate };
    }
  },
}));
vi.mock('@sigma/node-border', () => ({ createNodeBorderProgram: () => class {} }));
vi.mock('graphology-layout-forceatlas2/worker', () => ({
  default: class {
    start() {}
    stop() {}
    kill() {}
  },
}));

const api = {
  get: vi.fn(async (path: string) =>
    path === '/api/graph'
      ? { nodes: [{ id: 1, title: 'Client X', typeId: 1, degree: 0, flagged: false }], edges: [] }
      : path === '/api/types'
        ? { types: [] }
        : detail(),
  ),
} as unknown as Api;

describe('Graphe', () => {
  it('flies to the open fiche in framed coordinates, not the raw ones of a stale display cache', async () => {
    render(Graphe, { props: { selected: 1, centre: '', onOpen: vi.fn() }, context: new Map([['api', api]]) });
    await screen.findByRole('complementary', { name: 'Fiche' });
    expect(animate).toHaveBeenCalledWith({ x: 0.3, y: 0.2, ratio: 0.25 }, { duration: 600 });
  });

  it('Escape closes the open fiche from outside the graph, not while a dialog is open', async () => {
    const onOpen = vi.fn();
    const outside = document.createElement('button');
    outside.textContent = 'Graphe';
    document.body.append(outside);
    render(Graphe, { props: { selected: 1, centre: '', onOpen }, context: new Map([['api', api]]) });
    await screen.findByRole('complementary', { name: 'Fiche' });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    outside.focus();
    await userEvent.keyboard('{Escape}');
    expect(onOpen).not.toHaveBeenCalled();

    dialog.remove();
    await userEvent.keyboard('{Escape}');
    expect(onOpen).toHaveBeenCalledWith(null);
    outside.remove();
  });
});

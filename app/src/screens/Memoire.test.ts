import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentPanel } from '../agent/conversation.svelte.ts';
import { fakeApi } from '../memoire/fixtures.ts';
import Memoire from './Memoire.svelte';

// Counts the loads of the graph module: it must come only with the graph mode.
// The module cache lives for the whole file: only one test may switch to a WebGL graph, and count from 0.
const graphe = vi.hoisted(() => ({ loads: 0 }));
vi.mock('../memoire/Graphe.svelte', async () => {
  graphe.loads++;
  return { default: (await import('../testing/GrapheStub.svelte')).default };
});

function show(props: { fiche?: string | null; mode?: string | null } = {}, results: unknown[] = []) {
  const f = fakeApi(undefined, results);
  render(Memoire, { props, context: new Map([['api', f.api]]) });
  return f;
}

// jsdom has no WebGL: getContext answers null unless a test says otherwise.
let webgl: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  webgl = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('Memoire', () => {
  it('groups fiches by type with their count, all folded at first', async () => {
    show();
    const grp = await screen.findByRole('button', { name: /Personnes · 2/ });
    expect(screen.getByRole('button', { name: /Organisations · 1/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(grp).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Jeanne D.')).toBeNull();
    await userEvent.click(grp);
    expect(screen.getByText('Jeanne D.')).toBeInTheDocument();
    await userEvent.click(grp);
    expect(screen.queryByText('Jeanne D.')).toBeNull();
  });

  it('opens only the group of the open fiche', async () => {
    show({ fiche: '3' });
    expect(await screen.findByRole('button', { name: /Organisations · 1/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /Personnes · 2/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('searches after 250 ms and swaps the tree for results, then back', async () => {
    const { send } = show({}, [
      { id: 3, title: 'Entreprise Z', type: 'Organisations', excerpt: 'Société du client' },
    ]);
    await userEvent.click(await screen.findByRole('button', { name: /Personnes · 2/ }));
    await userEvent.type(screen.getByRole('searchbox'), 'entre');
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('POST', '/lun/v1/actions/brain.search', { query: 'entre' }),
    );
    expect(await screen.findByText('Société du client')).toBeInTheDocument();
    expect(screen.queryByText('Jeanne D.')).toBeNull();
    await userEvent.clear(screen.getByRole('searchbox'));
    expect(await screen.findByRole('button', { name: /Personnes · 2/ })).toBeInTheDocument();
    expect(screen.queryByText('Société du client')).toBeNull();
  });

  it('opens a fiche into the URL and the panel', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Personnes · 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Client X' }));
    expect(location.search).toContain('fiche=1');
    expect(await screen.findByRole('heading', { name: 'Client X' })).toBeInTheDocument();
  });

  it('opens the fiche of the address', async () => {
    show({ fiche: '1' });
    expect(await screen.findByRole('heading', { name: 'Client X' })).toBeInTheDocument();
  });

  it('switches to the graph mode in the URL', async () => {
    show();
    await userEvent.click(await screen.findByRole('radio', { name: 'Graphe' }));
    expect(location.search).toContain('mode=graphe');
    expect(screen.queryByText('Jeanne D.')).toBeNull();
  });

  it('loads the graph module only in the graph mode', async () => {
    webgl.mockReturnValue({ getExtension: () => null } as unknown as RenderingContext);
    show({ fiche: '1' });
    await screen.findByText('Jeanne D.');
    expect(graphe.loads).toBe(0);
    await userEvent.click(screen.getByRole('radio', { name: 'Graphe' }));
    expect(await screen.findByText('Graphe chargé 1')).toBeInTheDocument();
    expect(graphe.loads).toBe(1);
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Centrer le graphe sur…');
  });

  it('says the graph needs WebGL when there is none', async () => {
    show({ mode: 'graphe' });
    expect(await screen.findByText('Le graphe demande WebGL.')).toBeInTheDocument();
    expect(screen.queryByText(/Graphe chargé/)).toBeNull();
  });

  it('guides an empty base', async () => {
    const f = fakeApi();
    f.get.mockImplementation(async () => ({ fiches: [] }));
    render(Memoire, { props: {}, context: new Map([['api', f.api]]) });
    expect(
      await screen.findByText('Aucune fiche. Écrire une note ou déposer un document.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Déposer un document' })).toHaveAttribute('href', '/depots');
    await userEvent.click(screen.getByRole('button', { name: 'Écrire une note' }));
    expect(agentPanel).toEqual({ open: true, draft: 'note que ' });
    agentPanel.open = false;
    agentPanel.draft = '';
  });

  it('keeps the tree and the fiche when the search fails', async () => {
    const f = show();
    f.send.mockRejectedValueOnce(new Error('Recherche indisponible'));
    await userEvent.click(await screen.findByRole('button', { name: /Personnes · 2/ }));
    await userEvent.type(screen.getByRole('searchbox'), 'x');
    expect(await screen.findByText('Recherche indisponible')).toBeInTheDocument();
    expect(screen.getByText('Jeanne D.')).toBeInTheDocument();
  });
});

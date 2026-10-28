import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../memoire/fixtures.ts';
import Memoire from './Memoire.svelte';

// Counts the loads of the graph module: it must come only with the graph mode.
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
  it('groups fiches by type with their count, groups fold', async () => {
    show();
    const grp = await screen.findByRole('button', { name: /Personnes · 2/ });
    expect(screen.getByRole('button', { name: /Organisations · 1/ })).toBeInTheDocument();
    expect(screen.getByText('Jeanne D.')).toBeInTheDocument();
    await userEvent.click(grp);
    expect(screen.queryByText('Jeanne D.')).toBeNull();
    expect(grp).toHaveAttribute('aria-expanded', 'false');
  });

  it('searches after 250 ms and swaps the tree for results, then back', async () => {
    const { send } = show({}, [
      { id: 3, title: 'Entreprise Z', type: 'Organisations', excerpt: 'Société du client' },
    ]);
    await screen.findByText('Jeanne D.');
    await userEvent.type(screen.getByRole('searchbox'), 'entre');
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('POST', '/lun/v1/actions/brain.search', { query: 'entre' }),
    );
    expect(await screen.findByText('Société du client')).toBeInTheDocument();
    expect(screen.queryByText('Jeanne D.')).toBeNull();
    await userEvent.clear(screen.getByRole('searchbox'));
    expect(await screen.findByText('Jeanne D.')).toBeInTheDocument();
  });

  it('opens a fiche into the URL and the panel', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Client X' }));
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
    webgl.mockReturnValue({} as RenderingContext);
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
  });

  it('keeps the tree and the fiche when the search fails', async () => {
    const f = show();
    f.send.mockRejectedValueOnce(new Error('Recherche indisponible'));
    await screen.findByText('Jeanne D.');
    await userEvent.type(screen.getByRole('searchbox'), 'x');
    expect(await screen.findByText('Recherche indisponible')).toBeInTheDocument();
    expect(screen.getByText('Jeanne D.')).toBeInTheDocument();
  });
});

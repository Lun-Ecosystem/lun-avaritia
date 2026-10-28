import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeApi } from '../memoire/fixtures.ts';
import Memoire from './Memoire.svelte';

function show(props: { fiche?: string | null; mode?: string | null } = {}, results: unknown[] = []) {
  const f = fakeApi(undefined, results);
  render(Memoire, { props, context: new Map([['api', f.api]]) });
  return f;
}

afterEach(() => history.replaceState(null, '', '/'));

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

  it('guides an empty base', async () => {
    const f = fakeApi();
    f.get.mockImplementation(async () => ({ fiches: [] }));
    render(Memoire, { props: {}, context: new Map([['api', f.api]]) });
    expect(
      await screen.findByText('Aucune fiche. Écrire une note ou déposer un document.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Déposer un document' })).toHaveAttribute('href', '/depots');
  });
});

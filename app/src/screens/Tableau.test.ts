import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api.ts';
import Tableau from './Tableau.svelte';

const full = {
  lastRun: {
    at: new Date(Date.now() - 3600_000).toISOString(),
    durationMs: 125_000,
    cost: 0.0213,
    observations: 14,
    drafts: 5,
    questions: 1,
  },
  pending: { drafts: 7, contradictions: 2, doublons: 3 },
  heldLots: 2,
  monthSpend: 1.5,
  recent: [{ at: new Date(Date.now() - 7200_000).toISOString(), what: 'Dépôt ajouté : exemple' }],
};
const empty = {
  lastRun: undefined,
  pending: { drafts: 0, contradictions: 0, doublons: 0 },
  heldLots: 0,
  monthSpend: 0,
  recent: [],
};

function show(body: unknown) {
  const api = { get: vi.fn(async () => body) } as unknown as Api;
  render(Tableau, { context: new Map([['api', api]]) });
}

afterEach(() => vi.restoreAllMocks());

describe('Tableau', () => {
  it('shows the last run, the counts and the activity', async () => {
    show(full);
    const run = await screen.findByRole('region', { name: 'Dernier traitement' });
    expect(within(run).getByText(/2 min 05 s/)).toBeInTheDocument();
    expect(within(run).getByText(/0,02 \$/)).toBeInTheDocument();
    expect(within(run).getByText(/14 observations reçues/)).toBeInTheDocument();
    expect(within(run).getByText(/5 brouillons créés/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /7 Brouillons à valider/ })).toHaveAttribute('href', '/valider');
    expect(screen.getByRole('link', { name: /2 Contradictions/ })).toHaveAttribute(
      'href',
      '/valider?filtre=contradictions',
    );
    expect(screen.getByRole('link', { name: /3 Doublons probables/ })).toHaveAttribute(
      'href',
      '/valider?filtre=doublons',
    );
    expect(screen.getByText('Dépôt ajouté : exemple')).toBeInTheDocument();
    expect(screen.getByText('Plafond de coût atteint : 2 lots en attente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '/reglages');
  });

  it('handles an empty base', async () => {
    show(empty);
    expect(await screen.findByText('Aucun traitement pour l’instant')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /0 Brouillons à valider/ })).toBeInTheDocument();
    expect(screen.queryByText(/Plafond de coût/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

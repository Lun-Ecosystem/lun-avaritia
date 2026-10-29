import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api.ts';
import Tableau from './Tableau.svelte';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const full = {
  lastRun: { at: ago(1), durationMs: 41_000, cost: 0.0213, observations: 14, drafts: 5, questions: 1 },
  pending: { drafts: 7, contradictions: 2, doublons: 3 },
  heldLots: 2,
  monthSpend: 1.5,
  monthlyCap: 5,
  recent: [{ at: ago(2), what: 'Dépôt ajouté : exemple' }],
};
const empty = {
  lastRun: undefined,
  pending: { drafts: 0, contradictions: 0, doublons: 0 },
  heldLots: 0,
  monthSpend: 0,
  monthlyCap: 5,
  recent: [],
};
const inRun = () => new Date(Date.now() - 3600_000 - 10_000).toISOString();
const draft = (id: number, kind: string, title: string, createdAt: string, payload: object = {}) => ({
  id,
  kind,
  card: { title },
  payload: { kind, ...payload },
  createdAt,
  origin: { source: 'core' },
});
const drafts = {
  held: 0,
  drafts: [
    draft(1, 'fiche', 'Client Exemple', inRun(), { facts: [] }),
    draft(2, 'fiche', 'Projet Test', inRun(), { ficheId: 4, facts: [] }),
    draft(3, 'contradiction', 'Date de recette', inRun()),
    draft(4, 'doublon', 'Société A / Société B', inRun()),
    draft(6, 'import', 'Coffre Obsidian', inRun(), { fiches: [], warnings: [] }),
    draft(5, 'fiche', 'Ancien brouillon', ago(30), { ficheId: 9, facts: [] }),
  ],
};

function show(dash: unknown, queue: unknown = { drafts: [], held: 0 }) {
  const api = { get: vi.fn(async (p: string) => (p === '/api/drafts' ? queue : dash)) } as unknown as Api;
  render(Tableau, { context: new Map([['api', api]]) });
}

afterEach(() => vi.restoreAllMocks());

describe('Tableau', () => {
  it('shows the last-run header, the stat cards, the summary and the activity', async () => {
    show(full, drafts);
    expect(await screen.findByRole('heading', { name: 'Dernier traitement' })).toBeInTheDocument();
    expect(screen.getByText(/traité à \d\d:\d\d, 41 s, 0,02 \$/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Brouillons à valider : Passer en revue' })).toHaveAttribute(
      'href',
      '/valider',
    );
    expect(screen.getByRole('link', { name: 'Contradictions : Trancher' })).toHaveAttribute(
      'href',
      '/valider?filtre=contradictions',
    );
    expect(screen.getByRole('link', { name: 'Doublons probables : Voir' })).toHaveAttribute(
      'href',
      '/valider?filtre=doublons',
    );
    expect(screen.getByText('dont 5 du dernier traitement')).toBeInTheDocument();

    const summary = screen.getByRole('region', { name: 'Résumé' });
    expect(within(summary).getByText(/14 observations reçues, 5 brouillons créés/)).toBeInTheDocument();
    expect(within(summary).getByText('Client Exemple').parentElement).toHaveTextContent('nouvelle');
    expect(within(summary).getByText('Projet Test').parentElement).toHaveTextContent('enrichissement');
    expect(within(summary).getByText('Date de recette').parentElement).toHaveTextContent('contradiction');
    expect(within(summary).getByText('Société A / Société B').parentElement).toHaveTextContent('doublon');
    expect(within(summary).getByText('Coffre Obsidian').parentElement).toHaveTextContent('import');
    expect(within(summary).queryByText('Ancien brouillon')).toBeNull();

    expect(screen.getByText('Dépôt ajouté : exemple')).toBeInTheDocument();
    expect(screen.getByText('Plafond de coût atteint : 2 lots en attente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Réglages' })).toHaveAttribute(
      'href',
      '/reglages?theme=fournisseurs',
    );
    expect(screen.queryByText(/ce mois/)).toBeNull();
  });

  it('handles an empty base', async () => {
    show(empty);
    expect(
      await screen.findByRole('heading', { name: 'Aucun traitement pour l’instant' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Brouillons à valider : Passer en revue' })).toBeInTheDocument();
    expect(screen.queryByText(/dont \d+ du dernier/)).toBeNull();
    expect(screen.queryByText(/Plafond de coût/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

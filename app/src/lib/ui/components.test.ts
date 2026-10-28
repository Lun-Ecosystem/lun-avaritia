import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ProposalView } from '../types.ts';
import CommandPalette from './CommandPalette.svelte';
import ProposalCard from './ProposalCard.svelte';
import ProposalChip from './ProposalChip.svelte';
import ServiceCard from './ServiceCard.svelte';
import StandaloneCard from './StandaloneCard.svelte';
import Steps from './Steps.svelte';
import Tabs from './Tabs.svelte';

const spam: ProposalView = { boxId: 'spam', tagIds: [], confidence: 70, status: 'pending' };

describe('ProposalChip', () => {
  it('says where and how sure, and validates or corrects in place', async () => {
    const user = userEvent.setup();
    const onvalidate = vi.fn();
    const oncorrect = vi.fn();
    render(ProposalChip, { props: { proposal: spam, boxName: 'Spam', onvalidate, oncorrect } });
    expect(screen.getByText(/Spam · 70/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Valider : Spam' }));
    expect(onvalidate).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Corriger la proposition' }));
    expect(oncorrect).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
  });

  it('without a box, says so plainly', () => {
    render(ProposalChip, {
      props: { proposal: { ...spam, boxId: null }, boxName: '', onvalidate: vi.fn(), oncorrect: vi.fn() },
    });
    expect(screen.getByText('Aucune boîte trouvée')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ProposalCard', () => {
  it('gives the reason, then why it waits under the threshold', () => {
    render(ProposalCard, {
      props: {
        proposal: spam,
        boxName: 'Spam',
        reason: 'Expéditeur inconnu, objet générique.',
        threshold: 95,
        onvalidate: vi.fn(),
        oncorrect: vi.fn(),
      },
    });
    expect(
      screen.getByText(
        'Expéditeur inconnu, objet générique. Sous le seuil de 95 % : en attente de validation.',
        { normalizer: (t) => t.replace(/\s+/g, ' ').trim() },
      ),
    ).toBeInTheDocument();
  });
});

describe('ServiceCard', () => {
  it.each([
    ['actif', 'Traitement actif'],
    ['pause', 'Traitement en pause'],
    ['cle-refusee', 'Traitement en pause'],
  ] as const)('%s reads « %s »', (state, title) => {
    render(ServiceCard, { props: { state, detail: 'Synchronisé il y a 1 min' } });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(title);
    expect(status).toHaveTextContent('Synchronisé il y a 1 min');
  });
});

describe('StandaloneCard', () => {
  const html = (h: string) => createRawSnippet(() => ({ render: () => h }));

  it('is one region named by its title, with the brand, the steps, a top and a footer', () => {
    render(StandaloneCard, {
      props: {
        title: 'Relier ce navigateur',
        lead: 'Saisir le code.',
        steps: html('<span>étapes</span>'),
        top: html('<span data-testid="haut">marques</span>'),
        children: html('<p>corps</p>'),
        footer: html('<span>note</span>'),
      },
    });
    const card = screen.getByRole('region', { name: 'Relier ce navigateur' });
    expect(screen.getByRole('main')).toContainElement(card);
    expect(screen.getByText("Lun'Avaritia")).toBeInTheDocument();
    expect(screen.getByText('étapes')).toBeInTheDocument();
    // The top goes above the title, inside the card.
    const top = screen.getByTestId('haut');
    expect(card).toContainElement(top);
    expect(top.compareDocumentPosition(screen.getByRole('heading', { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('Saisir le code.')).toBeInTheDocument();
    expect(screen.getByText('note')).toBeInTheDocument();
  });
});

describe('Steps', () => {
  it('marks the current step', () => {
    render(Steps, { props: { steps: ['Navigateur relié', 'Autoriser'], current: 1 } });
    expect(screen.getByText('Autoriser').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});

describe('Tabs', () => {
  it('reports the chosen tab', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    const items = [
      { value: 'tout', label: 'Tout' },
      { value: 'ia', label: 'Proposés par l’IA' },
    ];
    render(Tabs, { props: { items, label: 'Filtre', onchange } });
    await user.click(screen.getByRole('tab', { name: 'Proposés par l’IA' }));
    expect(onchange).toHaveBeenCalledWith('ia');
    expect(screen.getByRole('tab', { name: 'Proposés par l’IA' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('CommandPalette', () => {
  it('opens with Ctrl K, runs the command chosen and closes', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(CommandPalette, {
      props: {
        commands: [
          { id: 'reglages', label: 'Réglages, Boîtes et étiquettes', group: 'Aller à', run: vi.fn() },
          { id: 'factures', label: 'Ranger la sélection dans Factures', group: 'Action', run },
        ],
      },
    });
    await user.keyboard('{Control>}k{/Control}');
    const search = await screen.findByPlaceholderText('Rechercher une commande');
    expect(search).toHaveAttribute('data-palette');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await user.keyboard('ranger fac');
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByPlaceholderText('Rechercher une commande')).toBeNull();
  });

  it('Ctrl K from its search field closes it', async () => {
    const user = userEvent.setup();
    render(CommandPalette, { props: { commands: [], open: true } });
    const search = await screen.findByPlaceholderText('Rechercher une commande');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(search).toHaveFocus();
    await user.keyboard('{Control>}k{/Control}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByPlaceholderText('Rechercher une commande')).toBeNull();
  });
});

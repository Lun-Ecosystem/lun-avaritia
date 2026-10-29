import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.ts';
import AgentPanel from '../agent/AgentPanel.svelte';
import Reglages from './Reglages.svelte';

const SETTINGS = {
  'drafts.cap': 15,
  'cost.monthlyCap': 5,
  'agent.name': 'Agent',
  'agent.icon': 'sparkles',
  'agent.tone': 'neutre',
  'agent.persona': '',
};

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', state: 'ok', last4: '7f3a', source: 'saved' },
  { id: 'openai', label: 'OpenAI', state: 'absent' },
];

/** A fake server: `send` merges a settings patch, `put` lets a test refuse one. */
function show(
  opts: {
    paused?: boolean;
    /** `?theme=` of the address: the page open at first. */
    theme?: string | null;
    refuse?: (body: Record<string, unknown>) => string | null;
    providers?: () => Promise<unknown>;
  } = {},
) {
  let settings = { ...SETTINGS };
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === '/api/settings') return { settings };
    if (path === '/api/dashboard') return { monthSpend: 1.2 };
    if (path === '/api/types') return { types: [{ id: 1, name: 'Personne' }] };
    if (path === '/api/clients')
      return {
        clients: [
          { id: 1, name: 'Portable', kind: 'device', createdAt: '2026-10-20T10:00:00Z', current: true },
        ],
      };
    if (path === '/api/llm/providers') return opts.providers ? opts.providers() : { providers: PROVIDERS };
    if (path.startsWith('/api/llm/models')) return { models: [] };
    if (path === '/api/llm/choice') return { tri: null, agent: null };
    throw new ApiError(404, 'Introuvable');
  });
  const send = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (method === 'PUT' && path === '/api/settings') {
      const refused = opts.refuse?.(body as Record<string, unknown>);
      if (refused) throw new ApiError(400, refused);
      settings = { ...settings, ...(body as object) };
      return { settings };
    }
    if (path === '/api/export') return { dir: '/data/export/2026-10-28', files: ['a.md', 'b.md'] };
    return { status: 'ok' };
  });
  const onservice = vi.fn(async () => {});
  const api = { get, send, upload: vi.fn() } as unknown as Api;
  render(Reglages, {
    props: { paused: opts.paused ?? false, onservice, theme: opts.theme ?? null },
    context: new Map([['api', api]]),
  });
  const card = (name: string) => screen.findByRole('region', { name });
  // The card of the model comes by import(): its stand-in is replaced once loaded.
  const modelCard = async () => {
    await screen.findByRole('combobox', { name: 'Modèle des lots' }, { timeout: 5000 });
    return screen.getByRole('region', { name: 'Modèle de langage' });
  };
  return { api, get, send, onservice, card, modelCard, user: userEvent.setup() };
}

const settingsPuts = (send: ReturnType<typeof show>['send']) =>
  send.mock.calls.filter(([m, p]) => m === 'PUT' && p === '/api/settings').map((c) => c[2]);

beforeEach(() => {
  history.replaceState(null, '', '/reglages');
});

describe('Réglages', () => {
  it('lists the themes by group, the service page open by default', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Thèmes des réglages' });
    const groups = within(nav)
      .getAllByRole('group')
      .map((g) => [
        g.getAttribute('aria-labelledby') &&
          document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent,
        within(g)
          .getAllByRole('link')
          .map((l) => l.textContent?.trim()),
      ]);
    expect(groups).toEqual([
      ['Compte', ['Appareils et applications']],
      ['Traitement', ['Service', 'Fiches']],
      ['IA', ['Agent', 'Fournisseurs d’IA']],
      ['Données', ['Import et export']],
    ]);
    expect(within(nav).getByRole('link', { name: 'Service' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Service' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Service' })).toBeInTheDocument();
  });

  it('a click opens the page of the theme, and the address follows', async () => {
    const { user } = show();
    const nav = screen.getByRole('navigation', { name: 'Thèmes des réglages' });
    await user.click(within(nav).getByRole('link', { name: 'Fiches' }));
    expect(window.location.pathname + window.location.search).toBe('/reglages?theme=fiches');
    const title = screen.getByRole('heading', { level: 2, name: 'Fiches' });
    expect(title).toHaveFocus();
    expect(title.previousElementSibling).toHaveTextContent('Traitement');
    const cards = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(cards).toEqual(['Structure des fiches', 'Lots']);
    expect(within(nav).getByRole('link', { name: 'Fiches' })).toHaveAttribute('aria-current', 'page');
  });

  it('the theme of the address opens its page', async () => {
    show({ theme: 'agent' });
    expect(screen.getByRole('heading', { level: 2, name: 'Agent' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Service' })).toBeNull();
  });

  it('on a phone: the list first, a theme full screen, then back to the list', async () => {
    const { user } = show();
    const root = screen.getByRole('navigation', { name: 'Thèmes des réglages' }).parentElement!;
    // Under 768 px the CSS shows the list alone without `ouvert`, the page alone with it.
    expect(root).not.toHaveClass('ouvert');
    await user.click(screen.getByRole('link', { name: 'Agent' }));
    expect(root).toHaveClass('ouvert');
    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    expect(root).not.toHaveClass('ouvert');
    expect(window.location.pathname + window.location.search).toBe('/reglages');
    expect(screen.getByRole('link', { name: 'Agent' })).toHaveFocus();
  });

  it('a saved key shows its last 4 characters only', async () => {
    const { modelCard } = show({ theme: 'fournisseurs' });
    const modele = await modelCard();
    expect(await within(modele).findByText('7f3a')).toBeInTheDocument();
    expect(within(modele).getByText('En service')).toBeInTheDocument();
    expect(within(modele).getByRole('button', { name: 'Ajouter une clé' })).toBeInTheDocument();
  });

  it('changes the monthly cap and shows the month spend beside it', async () => {
    const { modelCard, send, user } = show({ theme: 'fournisseurs' });
    const modele = await modelCard();
    expect(await within(modele).findByText('1,20 $ sur 5,00 $')).toBeInTheDocument();
    const cap = within(modele).getByRole('spinbutton', { name: 'Plafond de coût mensuel' });
    await user.clear(cap);
    await user.type(cap, '8');
    await user.tab();
    expect(settingsPuts(send)).toEqual([{ 'cost.monthlyCap': 8 }]);
    expect(await within(modele).findByText('1,20 $ sur 8,00 $')).toBeInTheDocument();
  });

  it('the drafts cap refuses 0 and accepts 1 to 100', async () => {
    const { card, send, user } = show({ theme: 'fiches' });
    const lots = await card('Lots');
    const cap = await within(lots).findByRole('spinbutton', { name: 'Brouillons maximum par lot' });
    await user.clear(cap);
    await user.type(cap, '0');
    await user.tab();
    expect(within(lots).getByRole('alert')).toHaveTextContent('Entre 1 et 100');
    expect(settingsPuts(send)).toEqual([]);
    await user.clear(cap);
    await user.type(cap, '100');
    await user.tab();
    expect(settingsPuts(send)).toEqual([{ 'drafts.cap': 100 }]);
    await waitFor(() => expect(within(lots).queryByRole('alert')).toBeNull());
  });

  it('shows a refusal of the server inline, next to the field', async () => {
    const { card, user } = show({ theme: 'fiches', refuse: () => 'Réglage invalide : trop grand' });
    const lots = await card('Lots');
    const cap = await within(lots).findByRole('spinbutton', { name: 'Brouillons maximum par lot' });
    await user.clear(cap);
    await user.type(cap, '42');
    await user.tab();
    expect(await within(lots).findByRole('alert')).toHaveTextContent('Réglage invalide : trop grand');
  });

  it('a refused value stays next to its error when another setting of the page is saved', async () => {
    const { card, send, user } = show({ theme: 'agent' });
    const agent = await card('Agent');
    const name = await within(agent).findByRole('textbox', { name: 'Nom' });
    await user.clear(name);
    await user.tab();
    await user.click(within(agent).getByRole('radio', { name: 'Chaleureux' }));
    await waitFor(() => expect(settingsPuts(send)).toEqual([{ 'agent.tone': 'chaleureux' }]));
    expect(within(agent).getByText('Entre 1 et 40 caractères.')).toBeInTheDocument();
    expect(name).toHaveValue('');
  });

  it('the model card says it is loading, then offers to retry when the keys cannot be read', async () => {
    let fail: (e: Error) => void = () => {};
    const { modelCard } = show({
      theme: 'fournisseurs',
      providers: () => new Promise((_, reject) => (fail = reject)),
    });
    const modele = await modelCard();
    expect(within(modele).queryByText('État des clés inconnu')).toBeNull();
    expect(within(modele).getByLabelText('Chargement des clés')).toBeInTheDocument();
    fail(new ApiError(500, 'Erreur'));
    expect(await within(modele).findByText('État des clés inconnu')).toBeInTheDocument();
    expect(within(modele).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('the Agent card sets the name, the icon, the tone and the persona', async () => {
    const { card, send, user } = show({ theme: 'agent' });
    const agent = await card('Agent');
    const name = await within(agent).findByRole('textbox', { name: 'Nom' });
    await user.clear(name);
    await user.tab();
    expect(within(agent).getByText('Entre 1 et 40 caractères.')).toBeInTheDocument();
    await user.type(name, 'Mnémosyne');
    await user.tab();
    await user.click(within(agent).getByRole('radio', { name: 'Plume' }));
    await user.click(within(agent).getByRole('radio', { name: 'Chaleureux' }));
    const persona = within(agent).getByRole('textbox', { name: 'Contexte du personnage' });
    expect(
      within(agent).getByText('Règle la voix de l’agent, jamais ce qu’il a le droit de faire'),
    ).toBeInTheDocument();
    await user.type(persona, 'Archiviste posée');
    expect(within(agent).getByText('16 / 500')).toBeInTheDocument();
    await user.tab();
    expect(settingsPuts(send)).toEqual([
      { 'agent.name': 'Mnémosyne' },
      { 'agent.icon': 'feather' },
      { 'agent.tone': 'chaleureux' },
      { 'agent.persona': 'Archiviste posée' },
    ]);
    const apercu = within(agent).getByRole('img', { name: 'Aperçu de la bulle : Mnémosyne' });
    expect(apercu).toBeInTheDocument();
  });

  it('a saved name and icon reach the agent bubble at once', async () => {
    const { api, card, user } = show({ theme: 'agent' });
    render(AgentPanel, { context: new Map([['api', api]]) });
    const agent = await card('Agent');
    const name = await within(agent).findByRole('textbox', { name: 'Nom' });
    await screen.findByRole('button', { name: 'Agent' });
    await user.clear(name);
    await user.type(name, 'Mnémosyne');
    await user.tab();
    const bubble = await screen.findByRole('button', { name: 'Mnémosyne' });
    const before = bubble.querySelector('svg')?.outerHTML;
    await user.click(within(agent).getByRole('radio', { name: 'Plume' }));
    await waitFor(() => expect(bubble.querySelector('svg')?.outerHTML).not.toBe(before));
  });

  it('exports in Markdown and shows the folder written', async () => {
    const { card, send, user } = show({ theme: 'donnees' });
    const donnees = await card('Données');
    await user.click(within(donnees).getByRole('button', { name: 'Exporter' }));
    expect(send).toHaveBeenCalledWith('POST', '/api/export');
    expect(await within(donnees).findByText('2 fichiers dans /data/export/2026-10-28')).toBeInTheDocument();
  });

  it('Pause posts /lun/v1/pause, then refreshes the service state', async () => {
    const { card, send, onservice, user } = show({ theme: 'service' });
    const service = await card('Service');
    await user.click(within(service).getByRole('button', { name: 'Pause' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/pause');
    expect(onservice).toHaveBeenCalledOnce();
  });

  it('paused, offers to resume', async () => {
    const { card, send, user } = show({ theme: 'service', paused: true });
    const service = await card('Service');
    await user.click(within(service).getByRole('button', { name: 'Reprendre' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/resume');
  });
});

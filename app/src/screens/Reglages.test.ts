import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.ts';
import Reglages from './Reglages.svelte';

const SETTINGS = {
  'core.lots': true,
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
function show(opts: { paused?: boolean; refuse?: (body: Record<string, unknown>) => string | null } = {}) {
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
    if (path === '/api/llm/providers') return { providers: PROVIDERS };
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
  render(Reglages, {
    props: { paused: opts.paused ?? false, onservice },
    context: new Map([['api', { get, send, upload: vi.fn() } as unknown as Api]]),
  });
  const card = (name: string) => screen.findByRole('region', { name });
  // The card of the model comes by import(): its stand-in is replaced once loaded.
  const modelCard = async () => {
    await screen.findByRole('combobox', { name: 'Modèle des lots' }, { timeout: 5000 });
    return screen.getByRole('region', { name: 'Modèle de langage' });
  };
  return { get, send, onservice, card, modelCard, user: userEvent.setup() };
}

const settingsPuts = (send: ReturnType<typeof show>['send']) =>
  send.mock.calls.filter(([m, p]) => m === 'PUT' && p === '/api/settings').map((c) => c[2]);

describe('Réglages', () => {
  it('shows the cards of the mockup in order, then Agent, Appareils and Service', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Modèle de langage' });
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'Modèle de langage',
      'Lots du core',
      'Structure des fiches',
      'Données',
      'Agent',
      'Appareils',
      'Service',
    ]);
  });

  it('a saved key shows its last 4 characters only', async () => {
    const { modelCard } = show();
    const modele = await modelCard();
    expect(await within(modele).findByText('7f3a')).toBeInTheDocument();
    expect(within(modele).getByText('En service')).toBeInTheDocument();
    expect(within(modele).getByRole('button', { name: 'Ajouter une clé' })).toBeInTheDocument();
  });

  it('changes the monthly cap and shows the month spend beside it', async () => {
    const { modelCard, send, user } = show();
    const modele = await modelCard();
    expect(await within(modele).findByText('1,20 $ sur 5,00 $')).toBeInTheDocument();
    const cap = within(modele).getByRole('spinbutton', { name: 'Plafond de coût mensuel' });
    await user.clear(cap);
    await user.type(cap, '8');
    await user.tab();
    expect(settingsPuts(send)).toEqual([{ 'cost.monthlyCap': 8 }]);
    expect(await within(modele).findByText('1,20 $ sur 8,00 $')).toBeInTheDocument();
  });

  it('the core lots switch posts core.lots; no time of passage here', async () => {
    const { card, send, user } = show();
    const lots = await card('Lots du core');
    expect(await within(lots).findByText('Heure fixée par le core')).toBeInTheDocument();
    expect(within(lots).queryByRole('textbox', { name: /Heure/ })).toBeNull();
    await user.click(within(lots).getByRole('switch', { name: 'Accepter les lots du core' }));
    expect(settingsPuts(send)).toEqual([{ 'core.lots': false }]);
  });

  it('the drafts cap refuses 0 and accepts 1 to 100', async () => {
    const { card, send, user } = show();
    const lots = await card('Lots du core');
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
    const { card, user } = show({ refuse: () => 'Réglage invalide : trop grand' });
    const lots = await card('Lots du core');
    const cap = await within(lots).findByRole('spinbutton', { name: 'Brouillons maximum par lot' });
    await user.clear(cap);
    await user.type(cap, '42');
    await user.tab();
    expect(await within(lots).findByRole('alert')).toHaveTextContent('Réglage invalide : trop grand');
  });

  it('the Agent card sets the name, the icon, the tone and the persona', async () => {
    const { card, send, user } = show();
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

  it('exports in Markdown and shows the folder written', async () => {
    const { card, send, user } = show();
    const donnees = await card('Données');
    await user.click(within(donnees).getByRole('button', { name: 'Exporter' }));
    expect(send).toHaveBeenCalledWith('POST', '/api/export');
    expect(await within(donnees).findByText('2 fichiers dans /data/export/2026-10-28')).toBeInTheDocument();
  });

  it('Pause posts /lun/v1/pause, then refreshes the service state', async () => {
    const { card, send, onservice, user } = show();
    const service = await card('Service');
    await user.click(within(service).getByRole('button', { name: 'Pause' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/pause');
    expect(onservice).toHaveBeenCalledOnce();
  });

  it('paused, offers to resume', async () => {
    const { card, send, user } = show({ paused: true });
    const service = await card('Service');
    await user.click(within(service).getByRole('button', { name: 'Reprendre' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/resume');
  });
});

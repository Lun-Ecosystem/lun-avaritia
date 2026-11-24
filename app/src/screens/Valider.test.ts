import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.ts';
import { dismissAll, toasts } from '../lib/ui/toasts.svelte.ts';
import AgentPanel from '../agent/AgentPanel.svelte';
import Toaster from '../lib/ui/Toaster.svelte';
import Valider from './Valider.svelte';

const src = { kind: 'core', at: '2026-10-27T22:00:00Z' };
const view = (id: number, payload: { kind: string; [key: string]: unknown }, extra: object = {}) => ({
  id,
  kind: payload.kind,
  card: { title: `Carte ${id}` },
  payload,
  names: {},
  facts: {},
  createdAt: '2026-10-27T22:00:00Z',
  origin: { source: 'core' },
  ...extra,
});
const fiche = (id: number, title: string, more: object = {}) =>
  view(
    id,
    {
      kind: 'fiche',
      typeId: 1,
      title,
      synthesis: 'Client suivi par **Atelier Exemple**, voir [[Projet Test]].',
      facts: [{ text: 'Contrat signé en mars', source: src }],
      links: [{ to: 7, relation: 'travaille avec' }],
      ...more,
    },
    { names: { 7: 'Société B' } },
  );
const contradiction = view(
  2,
  { kind: 'contradiction', ficheId: 4, keep: 11, strike: 12, reason: 'Deux dates de recette.' },
  {
    names: { 4: 'Projet Test' },
    facts: {
      11: { text: 'Recette le 3 juin', struck: false },
      12: { text: 'Recette le 10 juin', struck: false },
    },
  },
);
const doublon = view(
  3,
  { kind: 'doublon', keep: 5, merge: 6, reason: 'Même adresse.' },
  { names: { 5: 'Société A', 6: 'Société A SARL' } },
);
const importDraft = view(8, {
  kind: 'import',
  fiches: [{ title: 'Note importée', body: 'x', links: [], frontmatter: {} }],
  warnings: [],
});
const replacing = fiche(9, 'Projet Test', {
  ficheId: 4,
  facts: [{ text: 'Recette le 12 juin', source: src, replaces: 11 }],
});

function show(
  queues: { drafts: unknown[]; held: number }[],
  {
    filtre = null as string | null,
    brouillon = null as string | null,
    fail = undefined as ApiError | undefined,
    sendWith = undefined as ((method: string, path: string) => Promise<unknown>) | undefined,
  } = {},
) {
  let n = 0;
  const get = vi.fn(async () => queues[Math.min(n++, queues.length - 1)]);
  const send = vi.fn(async (method: string, path: string) => {
    if (sendWith) return sendWith(method, path);
    if (fail) throw fail;
    return {};
  });
  const api = { get, send } as unknown as Api;
  render(Valider, { props: { filtre, brouillon }, context: new Map([['api', api]]) });
  return { api, get, send };
}

const messages = () => toasts().map((t) => t.message);

afterEach(() => {
  dismissAll();
  vi.restoreAllMocks();
});

describe('Valider', () => {
  it('shows the due date of a fact to validate', async () => {
    const dated = fiche(1, 'Paul', {
      facts: [{ text: 'Paul doit être rappelé le jeudi 5 novembre 2026.', source: src, due: '2026-11-05' }],
    });
    show([{ drafts: [dated], held: 0 }]);
    expect(await screen.findByText('Échéance : jeudi 5 novembre 2026')).toBeInTheDocument();
  });

  it('shows the queue in the order served, each draft with its kind', async () => {
    show([
      {
        drafts: [
          contradiction,
          doublon,
          fiche(1, 'Client Exemple'),
          fiche(10, 'Projet Test', { ficheId: 4 }),
          importDraft,
        ],
        held: 0,
      },
    ]);
    const cards = await screen.findAllByRole('region');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Projet Test',
      'Société A et Société A SARL',
      'Client Exemple',
      'Projet Test',
      'Carte 8',
    ]);
    expect(within(cards[0]!).getByText('contradiction')).toHaveClass('danger');
    expect(within(cards[1]!).getByText('doublon')).toHaveClass('accent');
    expect(within(cards[2]!).getByText('nouvelle fiche')).toHaveClass('ok');
    expect(within(cards[3]!).getByText('enrichissement')).toBeInTheDocument();
    expect(within(cards[4]!).getByText('import')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('Atelier Exemple').tagName).toBe('STRONG');
    expect(within(cards[2]!).getByText('Société B')).toBeInTheDocument();
  });

  it('filters the contradictions, fiches replacing a fact included', async () => {
    show([{ drafts: [contradiction, doublon, replacing, fiche(1, 'Client Exemple')], held: 0 }], {
      filtre: 'contradictions',
    });
    const cards = await screen.findAllByRole('region');
    expect(cards).toHaveLength(2);
    expect(within(cards[1]!).getByText('Recette le 12 juin')).toBeInTheDocument();
  });

  it('offers the filters that have something, with their counts, in the address', async () => {
    const user = userEvent.setup();
    const pushed = vi.spyOn(history, 'pushState');
    show([{ drafts: [contradiction, doublon, fiche(1, 'Client Exemple')], held: 0 }]);
    const group = await screen.findByRole('group', { name: 'Filtrer les brouillons' });
    expect(within(group).getByRole('button', { name: /Tous/ })).toHaveTextContent('3');
    expect(within(group).queryByRole('button', { name: /Imports/ })).toBeNull();
    await user.click(within(group).getByRole('button', { name: /Doublons/ }));
    expect(pushed).toHaveBeenCalledWith(null, '', '/valider?filtre=doublons');
  });

  it('says when a filter is empty while others are not', async () => {
    show([{ drafts: [doublon], held: 0 }], { filtre: 'contradictions' });
    expect(await screen.findByText('Il reste des brouillons sous les autres filtres.')).toBeInTheDocument();
  });

  it('filters the duplicates', async () => {
    show([{ drafts: [contradiction, doublon], held: 0 }], { filtre: 'doublons' });
    const cards = await screen.findAllByRole('region');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByText('doublon')).toBeInTheDocument();
  });

  it('accepts without input and refuses, removing the item each time', async () => {
    const user = userEvent.setup();
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 }]);
    const first = (await screen.findAllByRole('region'))[0]!;
    await user.click(within(first).getByRole('button', { name: 'Valider' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/1/accept', {});
    await waitFor(() => expect(screen.queryByText('Client Exemple')).toBeNull());
    expect(messages()).toContain('Appliqué');

    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/3/refuse', {});
    expect(await screen.findByText('Rien à valider.')).toBeInTheDocument();
    expect(messages()).toContain('Refusé');
  });

  // A click inside a card puts the focus in it; the card holding the focus is the one V and R act on.
  const cardsOf = async () => screen.findAllByRole('region');
  const kbdIn = (card: HTMLElement) => card.querySelectorAll('kbd').length;
  const clickInside = (user: ReturnType<typeof userEvent.setup>, card: HTMLElement) =>
    user.click(within(card).getByRole('heading'));

  it('V and R act on the card that holds the focus, none at load', async () => {
    const user = userEvent.setup();
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 }]);
    const cards = await cardsOf();
    // At load nothing holds the focus: the keys do nothing and no card shows them.
    await user.keyboard('v');
    await user.keyboard('r');
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[aria-keyshortcuts]')).toHaveLength(0);
    expect(cards.map(kbdIn)).toEqual([0, 0]);
    // The focus enters the second card: it is the active one, and the only one to say so.
    await clickInside(user, cards[1]!);
    expect(within(cards[1]!).getByRole('button', { name: 'Valider' })).toHaveAttribute(
      'aria-keyshortcuts',
      'V',
    );
    expect(within(cards[1]!).getByRole('button', { name: 'Refuser' })).toHaveAttribute(
      'aria-keyshortcuts',
      'R',
    );
    expect(within(cards[0]!).getByRole('button', { name: 'Valider' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
    expect(within(cards[0]!).getByRole('button', { name: 'Refuser' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
    expect(cards.map(kbdIn)).toEqual([0, 2]);
    await user.keyboard('r');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/3/refuse', {});
  });

  it('with the focus out of the cards, V does nothing', async () => {
    const user = userEvent.setup();
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 }]);
    const cards = await cardsOf();
    await clickInside(user, cards[0]!);
    await user.click(document.body);
    await user.keyboard('v');
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[aria-keyshortcuts]')).toHaveLength(0);
  });

  it('after R the focus passes to the next card, and R refuses it', async () => {
    const user = userEvent.setup();
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple'), doublon, importDraft], held: 0 }]);
    const cards = await cardsOf();
    await clickInside(user, cards[0]!);
    await user.keyboard('r');
    expect(send).toHaveBeenLastCalledWith('POST', '/lun/v1/cards/1/refuse', {});
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Société A et Société A SARL'));
    await user.keyboard('r');
    expect(send).toHaveBeenLastCalledWith('POST', '/lun/v1/cards/3/refuse', {});
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Carte 8'));
  });

  it('the card holding the focus is named by its title', async () => {
    const user = userEvent.setup();
    show([{ drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 }]);
    const cards = await cardsOf();
    await clickInside(user, cards[0]!);
    expect(document.activeElement).toHaveAccessibleName('Client Exemple');
    expect(cards[0]!.contains(document.activeElement)).toBe(true);
  });

  it('when the queue is emptied the focus goes to the title « À valider »', async () => {
    const user = userEvent.setup();
    show([{ drafts: [fiche(1, 'Client Exemple')], held: 0 }]);
    await clickInside(user, (await cardsOf())[0]!);
    await user.keyboard('r');
    expect(await screen.findByText('Rien à valider.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'À valider' })).toHaveFocus());
  });

  it('V and R typed inside the agent panel stay there', async () => {
    const user = userEvent.setup();
    const { api, send } = show([{ drafts: [fiche(1, 'Client Exemple')], held: 0 }]);
    render(AgentPanel, { context: new Map([['api', api]]) });
    await screen.findByRole('region');
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    screen.getByRole('button', { name: 'Fermer' }).focus();
    await user.keyboard('vr');
    expect(send).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
  });

  it('a contradiction shows both facts; « Garder l’autre » swaps keep and strike', async () => {
    const user = userEvent.setup();
    const { send } = show([{ drafts: [contradiction], held: 0 }]);
    const card = (await screen.findAllByRole('region'))[0]!;
    expect(within(card).getByText('Recette le 3 juin')).toBeInTheDocument();
    expect(within(card).getByText('Recette le 10 juin')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Garder l’autre' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/2/accept', {
      input: { kind: 'contradiction', ficheId: 4, keep: 12, strike: 11, reason: 'Deux dates de recette.' },
    });
  });

  it('a duplicate: « Garder l’autre » swaps keep and merge', async () => {
    const user = userEvent.setup();
    const { send } = show([{ drafts: [doublon], held: 0 }]);
    await user.click(await screen.findByRole('button', { name: 'Garder l’autre' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/3/accept', {
      input: { kind: 'doublon', keep: 6, merge: 5, reason: 'Même adresse.' },
    });
  });

  it('a fiche is edited before being accepted', async () => {
    const user = userEvent.setup();
    const draft = fiche(1, 'Client Exemple');
    const { send } = show([{ drafts: [draft], held: 0 }]);
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    const title = screen.getByLabelText('Titre');
    await user.clear(title);
    await user.type(title, 'Client Exemple SAS');
    const synthesis = screen.getByLabelText('Synthèse');
    await user.clear(synthesis);
    await user.type(synthesis, 'Nouvelle synthèse.');
    await user.click(screen.getByRole('checkbox', { name: 'Contrat signé en mars' }));
    await user.click(screen.getByRole('checkbox', { name: 'travaille avec : Société B' }));
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/1/accept', {
      input: {
        ...draft.payload,
        title: 'Client Exemple SAS',
        synthesis: 'Nouvelle synthèse.',
        facts: [],
        links: [],
      },
    });
  });

  it('409: already decided elsewhere, the queue is read again', async () => {
    const user = userEvent.setup();
    const { get } = show(
      [
        { drafts: [doublon], held: 0 },
        { drafts: [], held: 0 },
      ],
      { fail: new ApiError(409, 'Carte déjà traitée') },
    );
    await user.click(await screen.findByRole('button', { name: 'Valider' }));
    expect(await screen.findByText('Rien à valider.')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(messages()).toContain('Déjà tranché ailleurs');
  });

  it('400: the server message shows on the item, which stays', async () => {
    const user = userEvent.setup();
    show([{ drafts: [doublon], held: 0 }], {
      fail: new ApiError(400, 'Une fiche ne fusionne pas avec elle-même.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Valider' }));
    const card = screen.getByRole('region');
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Une fiche ne fusionne pas avec elle-même.',
    );
  });

  it('tells how many drafts wait for the next run', async () => {
    show([{ drafts: [doublon], held: 4 }]);
    expect(await screen.findByText('4 autres brouillons attendent le prochain passage')).toBeInTheDocument();
  });

  it('shows a hostile title as text', async () => {
    show([
      {
        drafts: [fiche(1, '<script>alert(1)</script>', { synthesis: '<img src=x onerror=alert(1)>' })],
        held: 0,
      },
    ]);
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.body.querySelector('script, img')).toBeNull();
  });

  it('empty queue', async () => {
    show([{ drafts: [], held: 0 }]);
    expect(await screen.findByText('Rien à valider.')).toBeInTheDocument();
  });
});

describe('Valider, undoing a refusal', () => {
  const restore = (send: { mock: { calls: unknown[][] } }, id: number) =>
    send.mock.calls.some((c) => c[0] === 'POST' && c[1] === `/api/drafts/${id}/restore`);

  it('« Refusé » offers Annuler, which restores the draft and reads the queue again', async () => {
    const user = userEvent.setup();
    render(Toaster);
    const { send, get } = show([
      { drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 },
      { drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 },
    ]);
    const first = (await screen.findAllByRole('region'))[0]!;
    await user.click(within(first).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(messages()).toContain('Refusé'));
    expect(toasts()[0]!.undo).toBeTypeOf('function');
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(restore(send, 1)).toBe(true));
    await waitFor(() =>
      expect(get.mock.calls.filter((c: unknown[]) => c[0] === '/api/drafts')).toHaveLength(2),
    );
    expect(await screen.findByText('Client Exemple')).toBeInTheDocument();
  });

  it('Ctrl Z does the same', async () => {
    const user = userEvent.setup();
    render(Toaster);
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 }]);
    const first = (await screen.findAllByRole('region'))[0]!;
    await user.click(within(first).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(messages()).toContain('Refusé'));
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(restore(send, 1)).toBe(true));
  });

  it('a 409 of the undo becomes the error toast, with the server message', async () => {
    const user = userEvent.setup();
    render(Toaster);
    const late = 'Trop tard pour annuler : le refus est fait.';
    show([{ drafts: [fiche(1, 'Client Exemple')], held: 0 }], {
      sendWith: async (_method, path) => {
        if (path.endsWith('/restore')) throw new ApiError(409, late);
        return {};
      },
    });
    const card = (await screen.findAllByRole('region'))[0]!;
    await user.click(within(card).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(messages()).toContain('Refusé'));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(messages()).toContain(late));
    expect(toasts()[0]!.tone).toBe('danger');
  });

  it('« Appliqué » stays without Annuler', async () => {
    const user = userEvent.setup();
    show([{ drafts: [fiche(1, 'Client Exemple')], held: 0 }]);
    await user.click(await screen.findByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(messages()).toContain('Appliqué'));
    expect(toasts()[0]!.undo).toBeUndefined();
  });
});

describe('Valider, a draft named in the address', () => {
  afterEach(() => history.replaceState(null, '', '/'));

  it('?brouillon=3 puts the focus on that draft, R refuses it, the address is cleaned', async () => {
    history.replaceState(null, '', '/valider?brouillon=3');
    const user = userEvent.setup();
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple'), doublon], held: 0 }], { brouillon: '3' });
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Société A et Société A SARL'));
    expect(window.location.pathname + window.location.search).toBe('/valider');
    await user.keyboard('r');
    expect(send).toHaveBeenCalledWith('POST', '/lun/v1/cards/3/refuse', {});
  });

  it('a draft that is not in the queue gives a toast and no focus', async () => {
    history.replaceState(null, '', '/valider?brouillon=99');
    const user = userEvent.setup();
    const { send } = show([{ drafts: [fiche(1, 'Client Exemple')], held: 0 }], { brouillon: '99' });
    await screen.findAllByRole('region');
    await waitFor(() => expect(messages().join('|')).toMatch(/Ce brouillon n.attend plus de décision\./));
    expect(document.body).toHaveFocus();
    await user.keyboard('r');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Valider, links of a synthesis', () => {
  it('opens a known [[Titre]] in the memory and leaves an unknown one as text', async () => {
    const get = vi.fn(async (path: string) =>
      path === '/api/fiches'
        ? {
            fiches: [
              { id: 4, title: 'Projet Test', typeId: 1, type: 'Projets', updatedAt: '2026-10-28T09:00:00Z' },
            ],
          }
        : {
            drafts: [fiche(1, 'Client Exemple', { synthesis: 'Voir [[Projet Test]] et [[Sans Fiche]].' })],
            held: 0,
          },
    );
    const api = { get, send: vi.fn() } as unknown as Api;
    render(Valider, { props: {}, context: new Map([['api', api]]) });
    const known = await screen.findByRole('button', { name: 'Projet Test' });
    expect(screen.getByText('Sans Fiche').tagName).not.toBe('BUTTON');
    await userEvent.click(known);
    expect(window.location.search).toBe('?fiche=4');
    history.replaceState(null, '', '/');
  });

  it('reads the fiches once for every draft with a link', async () => {
    const get = vi.fn(async (path: string) =>
      path === '/api/fiches'
        ? { fiches: [{ id: 4, title: 'Projet Test', type: 'Projets' }] }
        : {
            drafts: [
              fiche(1, 'Client Exemple', { synthesis: 'Voir [[Projet Test]].' }),
              fiche(2, 'Client Autre', { synthesis: 'Aussi [[Projet Test]].' }),
            ],
            held: 0,
          },
    );
    render(Valider, { props: {}, context: new Map([['api', { get, send: vi.fn() } as unknown as Api]]) });
    expect(await screen.findAllByRole('button', { name: 'Projet Test' })).toHaveLength(2);
    expect(get.mock.calls.filter(([p]) => p === '/api/fiches')).toHaveLength(1);
  });
});

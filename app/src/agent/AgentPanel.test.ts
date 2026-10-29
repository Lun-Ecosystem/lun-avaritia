import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api.ts';
import AgentPanel from './AgentPanel.svelte';
import { agentIdentity, agentPanel } from './conversation.svelte.ts';

function show(settings: Record<string, string> | Error = {}, fiche: string | null = null) {
  const get = vi.fn(async () => {
    if (settings instanceof Error) throw settings;
    return { settings };
  });
  const send = vi.fn(async () => ({
    summary: 'C’est noté : **Client X** préfère le mardi. <img src=x onerror=alert(1)>',
    cards: [{ id: 7 }],
    refs: [],
    cost: { currency: 'USD', amount: 0.0021 },
  }));
  render(AgentPanel, { props: { fiche }, context: new Map([['api', { get, send } as unknown as Api]]) });
  return { get, send };
}

beforeEach(() => {
  Object.assign(agentIdentity, { name: 'Agent', icon: 'sparkles' });
});
afterEach(() => {
  agentPanel.open = false;
  localStorage.clear();
});

describe('AgentPanel', () => {
  it('shows the bubble with the default name and icon when the settings are unreadable', async () => {
    show(new Error('Hors ligne'));
    expect(await screen.findByRole('button', { name: 'Agent' })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('gives the request back to the field when it fails', async () => {
    const { send } = show();
    send.mockRejectedValueOnce(new Error('Réseau coupé'));
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    const field = screen.getByRole('textbox', { name: 'Demande à Agent' });
    await userEvent.type(field, 'note que X{Enter}');
    expect(await screen.findByText('Réseau coupé')).toBeInTheDocument();
    expect(field).toHaveValue('note que X');
  });

  it('takes the name and icon of the settings, and the panel title carries the name', async () => {
    show({ 'agent.name': 'Archiviste', 'agent.icon': 'feather' });
    const bubble = await screen.findByRole('button', { name: 'Archiviste' });
    expect(bubble.querySelector('svg')).not.toBeNull();
    await userEvent.click(bubble);
    expect(screen.getByRole('dialog', { name: 'Archiviste' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Archiviste' })).toBeInTheDocument();
  });

  it('closes on Escape and gives the focus back to the bubble', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('textbox', { name: 'Demande à Agent' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent' })).toHaveFocus());
  });

  it('is modal under 768 px: the page is inert and Tab goes round inside the panel', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q }));
    const page = document.createElement('main');
    page.innerHTML = '<button>Ailleurs</button>';
    document.body.append(page);
    try {
      show();
      await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
      const dialog = screen.getByRole('dialog', { name: 'Agent' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(page.inert).toBe(true);
      const field = screen.getByRole('textbox', { name: 'Demande à Agent' });
      await userEvent.type(field, 'x');
      // Last control: Envoyer. Tab from it comes back to the first one, Fermer.
      screen.getByRole('button', { name: 'Envoyer' }).focus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(screen.getByRole('button', { name: 'Envoyer' })).toHaveFocus();
      await userEvent.keyboard('{Escape}');
      expect(page.inert).toBe(false);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Agent' })).toHaveFocus());
    } finally {
      page.remove();
      vi.unstubAllGlobals();
    }
  });

  it('answers a note through Prose, links the drafts and sends the open fiche', async () => {
    const { send } = show({}, '12');
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Demande à Agent' }),
      'note que Client X préfère le mardi{Enter}',
    );
    expect(send).toHaveBeenCalledWith('POST', '/api/agent', {
      request: 'note que Client X préfère le mardi',
      context: { fiche: '12' },
      history: [],
    });
    expect(await screen.findByText('Client X')).toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.body.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Voir dans À valider' })).toHaveAttribute('href', '/valider');
  });

  it('the bubble shows Ctrl J, which opens the panel from a field and closes it from inside', async () => {
    show();
    const bubble = await screen.findByRole('button', { name: 'Agent' });
    expect(bubble).toHaveAttribute('aria-keyshortcuts', 'Control+J');
    expect(bubble).toHaveTextContent('Ctrl J');
    const outside = document.createElement('input');
    document.body.append(outside);
    try {
      outside.focus();
      await userEvent.keyboard('{Control>}j{/Control}');
      expect(screen.getByRole('dialog', { name: 'Agent' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Demande à Agent' })).toHaveFocus();
      await userEvent.keyboard('{Control>}j{/Control}');
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Agent' })).toHaveFocus());
    } finally {
      outside.remove();
    }
  });

  it('resizes from the keyboard on its edges, and keeps the size from one opening to the next', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    const width = screen.getByRole('separator', { name: 'Largeur de Agent' });
    const height = screen.getByRole('separator', { name: 'Hauteur de Agent' });
    expect(width).toHaveAttribute('aria-valuenow', '400');
    expect(height).toHaveAttribute('aria-valuenow', '600');
    width.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    height.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(width).toHaveAttribute('aria-valuenow', '432');
    expect(height).toHaveAttribute('aria-valuenow', '584');
    expect(screen.getByRole('dialog')).toHaveStyle({ '--largeur': '432px', '--hauteur': '584px' });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('separator', { name: 'Largeur de Agent' })).toHaveAttribute(
      'aria-valuenow',
      '432',
    );
    expect(JSON.parse(localStorage.getItem('lunavaritia.agent.size') ?? 'null')).toEqual({
      width: 432,
      height: 584,
    });
  });

  it('a too large saved size comes back within the window', async () => {
    localStorage.setItem('lunavaritia.agent.size', JSON.stringify({ width: 5000, height: 100 }));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('separator', { name: 'Largeur de Agent' })).toHaveAttribute(
      'aria-valuenow',
      String(window.innerWidth - 24),
    );
    expect(screen.getByRole('separator', { name: 'Hauteur de Agent' })).toHaveAttribute(
      'aria-valuenow',
      '420',
    );
  });

  it('the full height button toggles, and gives the size back', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Agent' });
    await userEvent.click(screen.getByRole('button', { name: 'Pleine hauteur' }));
    expect(dialog).toHaveClass('grande');
    // The full height has no top edge to pull.
    expect(screen.queryByRole('separator', { name: 'Hauteur de Agent' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Rétablir la taille' }));
    expect(dialog).not.toHaveClass('grande');
    expect(screen.getByRole('separator', { name: 'Hauteur de Agent' })).toBeInTheDocument();
  });

  it('under 768 px: a sheet without edges nor full height, closed by its veil or pulled down', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q }));
    try {
      show();
      await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
      expect(screen.queryByRole('separator')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Pleine hauteur' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Fermer Agent' }));
      expect(screen.queryByRole('dialog')).toBeNull();

      await userEvent.click(await screen.findByRole('button', { name: 'Agent' }));
      const handle = screen.getByRole('dialog').querySelector('.poignee')!;
      await fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
      await fireEvent.pointerUp(handle, { pointerId: 1, clientY: 130 });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
      await fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

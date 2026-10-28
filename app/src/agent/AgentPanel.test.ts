import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api.ts';
import AgentPanel from './AgentPanel.svelte';
import { agentPanel } from './conversation.svelte.ts';

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

afterEach(() => {
  agentPanel.open = false;
});

describe('AgentPanel', () => {
  it('shows the bubble with the default name and icon when the settings are unreadable', async () => {
    show(new Error('Hors ligne'));
    expect(await screen.findByRole('button', { name: 'Agent' })).toHaveAttribute('aria-expanded', 'false');
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
});

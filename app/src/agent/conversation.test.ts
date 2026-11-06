import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../api.ts';
import { Conversation } from './conversation.svelte.ts';

const reply = (summary: string, cards: unknown[] = [], amount = 0.0012) => ({
  summary,
  cards,
  refs: [],
  cost: { currency: 'USD', amount },
});

function fake(...answers: (unknown | Error)[]) {
  const send = vi.fn(async () => {
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a;
  });
  return { send, conversation: new Conversation({ send } as unknown as Api) };
}

const AT = expect.any(String) as string;

describe('Conversation', () => {
  it('dates each message, and a page left open overnight starts its day clean', async () => {
    let now = new Date('2026-11-05T20:00:00.000Z');
    const send = vi.fn(async () => reply('Oui.'));
    const conversation = new Conversation({ send } as unknown as Api, () => now);
    await conversation.send('Hier');
    expect(conversation.messages[0]?.at).toBe('2026-11-05T20:00:00.000Z');

    now = new Date('2026-11-05T22:30:00.000Z'); // 23:30 in Paris: the same day.
    conversation.keepToday();
    expect(conversation.messages).toHaveLength(2);

    now = new Date('2026-11-05T23:30:00.000Z'); // 00:30 in Paris: the next one.
    await conversation.send('Aujourd’hui');
    expect(send).toHaveBeenLastCalledWith('POST', '/api/agent', { request: 'Aujourd’hui', history: [] });
    expect(conversation.messages.map((m) => m.text)).toEqual(['Aujourd’hui', 'Oui.']);
  });

  it('posts the request with the previous turns and adds the answer with its cost', async () => {
    const { send, conversation } = fake(reply('Bonjour.'), reply('Noté.', [{ id: 3 }], 0.004));
    await conversation.send('Salut');
    await conversation.send('note que Client X préfère le mardi', { fiche: '12' });
    expect(send).toHaveBeenNthCalledWith(1, 'POST', '/api/agent', { request: 'Salut', history: [] });
    expect(send).toHaveBeenNthCalledWith(2, 'POST', '/api/agent', {
      request: 'note que Client X préfère le mardi',
      context: { fiche: '12' },
      history: [
        { role: 'user', text: 'Salut' },
        { role: 'assistant', text: 'Bonjour.' },
      ],
    });
    expect(conversation.messages).toEqual([
      { role: 'user', text: 'Salut', at: AT },
      { role: 'agent', text: 'Bonjour.', at: AT, cost: 0.0012, drafts: 0 },
      { role: 'user', text: 'note que Client X préfère le mardi', at: AT },
      { role: 'agent', text: 'Noté.', at: AT, cost: 0.004, drafts: 1 },
    ]);
  });

  it('says the credit is out on a 402 and keeps the failed turn out of the history', async () => {
    const { send, conversation } = fake(new ApiError(402, 'Payment Required'), reply('Bonjour.'));
    expect(await conversation.send('Salut')).toBe(false);
    expect(conversation.messages.at(-1)).toEqual({
      role: 'agent',
      at: AT,
      text: 'Crédit épuisé chez le fournisseur',
      error: true,
    });
    expect(await conversation.send('Encore')).toBe(true);
    expect(send).toHaveBeenLastCalledWith('POST', '/api/agent', { request: 'Encore', history: [] });
  });

  it('shows the answer of a paused service as it comes', async () => {
    const paused = 'Avaritia est en pause : je ne fais rien tant qu’elle n’est pas reprise.';
    const { conversation } = fake(reply(paused, [], 0));
    await conversation.send('Bonjour');
    expect(conversation.messages.at(-1)?.text).toBe(paused);
  });

  it('shows any other failure and clears the thread', async () => {
    const { conversation } = fake(new Error('Réseau coupé'));
    await conversation.send('Bonjour');
    expect(conversation.messages.at(-1)).toEqual({
      role: 'agent',
      at: AT,
      text: 'Réseau coupé',
      error: true,
    });
    conversation.clear();
    expect(conversation.messages).toEqual([]);
  });
});

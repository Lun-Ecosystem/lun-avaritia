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

describe('Conversation', () => {
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
      { role: 'user', text: 'Salut' },
      { role: 'agent', text: 'Bonjour.', cost: 0.0012, drafts: 0 },
      { role: 'user', text: 'note que Client X préfère le mardi' },
      { role: 'agent', text: 'Noté.', cost: 0.004, drafts: 1 },
    ]);
  });

  it('says the credit is out on a 402 and keeps the error out of the history', async () => {
    const { send, conversation } = fake(new ApiError(402, 'Payment Required'), reply('Bonjour.'));
    await conversation.send('Salut');
    expect(conversation.messages.at(-1)).toEqual({
      role: 'agent',
      text: 'Crédit épuisé chez le fournisseur',
      error: true,
    });
    await conversation.send('Encore');
    expect(send).toHaveBeenLastCalledWith('POST', '/api/agent', {
      request: 'Encore',
      history: [{ role: 'user', text: 'Salut' }],
    });
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
    expect(conversation.messages.at(-1)).toEqual({ role: 'agent', text: 'Réseau coupé', error: true });
    conversation.clear();
    expect(conversation.messages).toEqual([]);
  });
});

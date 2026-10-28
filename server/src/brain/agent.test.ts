import { describe, expect, it } from 'vitest';
import { fakeProvider } from '../testing/fake-provider.ts';
import { makeHarness } from '../testing/harness.ts';
import { ask } from './agent.ts';
import { addFact, createFiche, link, listTypes, strikeFact, editFiche } from './store.ts';

const NOW = '2026-11-02T08:00:00.000Z';
const src = { kind: 'note' as const, at: NOW };
const call = (id: string, name: string, input: unknown) => ({ id, name, input });

function setup(chats: { text: string; toolCalls: ReturnType<typeof call>[] }[] = [], json: unknown[] = []) {
  const fake = fakeProvider(json, undefined, chats);
  const h = makeHarness({ brainProvider: () => ({ provider: fake.provider, model: 'claude-sonnet-5-5' }) });
  const typeId = listTypes(h.db)[0]!.id;
  const x = createFiche(h.db, { typeId, title: 'Client X', synthesis: 'Client fictif.' }, NOW);
  const old = addFact(h.db, x, 'Contact : a@example.org', src, NOW);
  const fresh = addFact(h.db, x, 'Contact : b@example.org', src, NOW);
  strikeFact(h.db, old, fresh, NOW);
  const y = createFiche(h.db, { typeId, title: 'Projet Y', synthesis: 'Projet fictif.' }, NOW);
  link(h.db, x, y, 'concerne');
  const deps = {
    db: h.db,
    clock: h.clock,
    provider: () => ({ provider: fake.provider, model: 'claude-sonnet-5-5' }),
  };
  return { h, fake, x, y, typeId, deps };
}

const run = async (h: ReturnType<typeof makeHarness>, name: string, body: unknown) => {
  const token = await h.pairClient();
  return h.app.request(`/lun/v1/actions/${name}`, {
    method: 'POST',
    headers: h.auth(token),
    body: JSON.stringify(body),
  });
};

describe('read actions', () => {
  it('brain.read leaves struck facts out and lists the actions as read', async () => {
    const t = setup();
    const res = await run(t.h, 'brain.read', { id: t.x });
    const { result } = (await res.json()) as { result: { facts: { text: string }[]; links: unknown[] } };
    expect(result.facts.map((f) => f.text)).toEqual(['Contact : b@example.org']);
    expect(result.links).toHaveLength(1);
    const token = await t.h.pairClient();
    const list = (await (await t.h.app.request('/lun/v1/actions', { headers: t.h.auth(token) })).json()) as {
      actions: { name: string; effect: string }[];
    };
    for (const n of ['brain.search', 'brain.read', 'brain.neighbors'])
      expect(list.actions.find((a) => a.name === n)?.effect).toBe('read');
  });

  it('brain.read truncates the synthesis to 4 000 characters', async () => {
    const t = setup();
    editFiche(t.h.db, t.x, { synthesis: 'a'.repeat(9000) }, NOW);
    const { result } = (await (await run(t.h, 'brain.read', { id: t.x })).json()) as {
      result: { synthesis: string };
    };
    expect(result.synthesis.length).toBeLessThanOrEqual(4000);
  });

  it('brain.search caps limit at 20 (400) and excerpts at 300 characters', async () => {
    const t = setup();
    expect((await run(t.h, 'brain.search', { query: 'client', limit: 500 })).status).toBe(400);
    const res = await run(t.h, 'brain.search', { query: 'client', limit: 5 });
    const { result } = (await res.json()) as { result: { id: number; excerpt: string }[] };
    expect(result.map((r) => r.id)).toEqual([t.x]);
  });

  it('a merged fiche is redirected on read, and skipped by search and neighbors', async () => {
    const t = setup();
    t.h.db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(t.x, t.y);
    const read = (await (await run(t.h, 'brain.read', { id: t.y })).json()) as {
      result: { id: number; redirectedFrom: number };
    };
    expect(read.result).toMatchObject({ id: t.x, redirectedFrom: t.y });
    const n = (await (await run(t.h, 'brain.neighbors', { id: t.x })).json()) as { result: unknown[] };
    expect(n.result).toEqual([]);
    expect((await run(t.h, 'brain.read', { id: 9999 })).status).toBe(400);
  });
});

describe('ask', () => {
  it('searches then reads, answers from the fiche and cites it; fiche text stays out of the system prompt', async () => {
    const t = setup([
      { text: '', toolCalls: [call('c1', 'brain_search', { query: 'Client X' })] },
      { text: '', toolCalls: [call('c2', 'brain_read', { id: 1 })] },
      { text: 'Client X : fictif, contact b@example.org.', toolCalls: [] },
    ]);
    const reply = await ask(t.deps, 'qu’est-ce que je sais sur Client X ?', { screen: 'fiches' });
    expect(reply.summary).toContain('Client X');
    expect(reply.refs).toEqual([{ type: 'fiche', id: String(t.x), title: 'Client X' }]);
    expect(reply.cards).toEqual([]);
    expect(reply.cost.amount).toBeGreaterThan(0);
    const [first, , third] = t.fake.chatCalls;
    expect(first!.system).not.toContain('Client X');
    expect(JSON.stringify(first!.messages)).toContain('screen');
    expect(JSON.stringify(third!.messages)).toContain('b@example.org');
    expect(JSON.stringify(third!.messages)).not.toContain('a@example.org');
  });

  it('note creates a draft, no fiche', async () => {
    const good = [
      { groups: [{ observations: [0], ficheId: null, typeId: 1, title: 'Client Z' }] },
      {
        fiches: [
          {
            group: 0,
            synthesis: 'S.',
            facts: [{ text: 'Z a signé.', observation: 0, replaces: null }],
            links: [],
          },
        ],
        questions: [],
      },
    ];
    const t = setup(
      [
        { text: '', toolCalls: [call('c1', 'note', { text: 'Z a signé.' })] },
        { text: 'C’est noté, à valider.', toolCalls: [] },
      ],
      good,
    );
    const before = (t.h.db.prepare('SELECT COUNT(*) AS n FROM fiches').get() as { n: number }).n;
    const reply = await ask(t.deps, 'note que Z a signé');
    expect(reply.cards).toHaveLength(1);
    expect((t.h.db.prepare('SELECT COUNT(*) AS n FROM fiches').get() as { n: number }).n).toBe(before);
  });

  it('a refused note is reported to the model as a tool result, not thrown', async () => {
    const t = setup([
      { text: '', toolCalls: [call('c1', 'note', { text: 'Z a signé.' })] },
      { text: 'Pas pu traiter.', toolCalls: [] },
    ]);
    const only = { ...t.deps, provider: (use: string) => (use === 'agent' ? t.deps.provider() : undefined) };
    const reply = await ask(only, 'note que Z a signé');
    expect(reply.cards).toEqual([]);
    expect(JSON.stringify(t.fake.chatCalls.at(-1)!.messages)).toContain('Aucun modèle');
  });

  it('without a provider: a clean answer, no call', async () => {
    const h = makeHarness();
    const reply = await ask({ db: h.db, clock: h.clock, provider: () => undefined }, 'bonjour');
    expect(reply.summary).toMatch(/aucun modèle/i);
    expect(reply.cost.amount).toBe(0);
  });

  it('stops at 6 rounds and says so', async () => {
    const loop = Array.from({ length: 8 }, (_, i) => ({
      text: '',
      toolCalls: [call(`c${i}`, 'brain_search', { query: 'client' })],
    }));
    const t = setup(loop);
    const reply = await ask(t.deps, 'boucle');
    expect(t.fake.chatCalls).toHaveLength(6);
    expect(reply.summary).toMatch(/arrêt/i);
  });
});

describe('agent routes', () => {
  it('POST /lun/v1/agent answers an AgentReply and bounds the context', async () => {
    const t = setup([{ text: 'Rien.', toolCalls: [] }]);
    const token = await t.h.pairClient();
    const post = (json: unknown) =>
      t.h.app.request('/lun/v1/agent', {
        method: 'POST',
        headers: t.h.auth(token),
        body: JSON.stringify(json),
      });
    expect((await post({ request: 'x', context: { k: 'v'.repeat(5000) } })).status).toBe(400);
    expect((await post({ request: '' })).status).toBe(400);
    const res = await post({ request: 'salut', context: { screen: 'mail' } });
    expect(await res.json()).toMatchObject({
      summary: 'Rien.',
      cards: [],
      refs: [],
      cost: { currency: 'USD' },
    });
  });

  it('POST /api/agent takes a bounded history', async () => {
    const t = setup([{ text: 'Oui.', toolCalls: [] }]);
    const token = await t.h.pairClient();
    const post = (json: unknown) =>
      t.h.app.request('/api/agent', { method: 'POST', headers: t.h.auth(token), body: JSON.stringify(json) });
    const big = Array.from({ length: 21 }, () => ({ role: 'user', text: 'a' }));
    expect((await post({ request: 'x', history: big })).status).toBe(400);
    const res = await post({
      request: 'et ensuite ?',
      history: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 'r' },
      ],
    });
    expect(res.status).toBe(200);
    expect(t.fake.chatCalls[0]!.messages).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import { putSetting } from '../db.ts';
import { setPaused } from '../contract/state.ts';
import { recordCost } from '../contract/costs.ts';
import { brainDeps } from '../app.ts';
import { fakeProvider } from '../testing/fake-provider.ts';
import { makeHarness } from '../testing/harness.ts';
import { addFact, createFiche, listTypes } from './store.ts';
import { ProviderError } from '../llm/types.ts';
import { lastRun, runPending } from './ingest.ts';

const obs = (text: string, ref = 'm1') => ({
  text,
  source: { kind: 'core', origin: 'acedia', ref, at: '2026-11-01T18:00:00Z' },
});

function setup(replies: unknown[] = []) {
  const fake = fakeProvider(replies);
  const h = makeHarness({
    brainProvider: (use) => ({
      provider: fake.provider,
      model: use === 'tri' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5',
    }),
  });
  const count = (table: string) =>
    (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const status = (id: number) =>
    h.db.prepare('SELECT status, reason FROM lots WHERE id = ?').get(id) as {
      status: string;
      reason: string | null;
    };
  const settle = async () => {
    for (let i = 0; i < 200; i++) {
      const busy = h.db
        .prepare("SELECT COUNT(*) AS n FROM lots WHERE status IN ('queued','running')")
        .get() as {
        n: number;
      };
      if (!busy.n) return;
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const ingest = async (body: unknown) => {
    const token = await h.pairClient();
    return h.app.request('/lun/v1/actions/brain.ingest', {
      method: 'POST',
      headers: h.auth(token),
      body: JSON.stringify(body),
    });
  };
  const typeId = listTypes(h.db)[0]!.id;
  const goodReplies = () => [
    { groups: [{ observations: [0], ficheId: null, typeId, title: 'Client X' }] },
    {
      fiches: [
        {
          group: 0,
          synthesis: 'Client fictif.',
          facts: [{ text: 'Le client X a signé.', observation: 0, replaces: null, due: null }],
          links: [],
        },
      ],
      questions: [],
    },
  ];
  return { h, fake, replies, count, status, settle, ingest, goodReplies };
}

describe('brain.ingest', () => {
  it('stores a valid lot, answers queued at once, then processes it and records the run', async () => {
    const t = setup();
    t.replies.push(...t.goodReplies());
    const res = await t.ingest({ version: 1, observations: [obs('Le client X a signé le devis.')] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { lot: 1, accepted: 1, status: 'queued' } });
    expect(t.count('observations')).toBe(1);
    await t.settle();
    expect(t.status(1).status).toBe('done');
    expect(lastRun(t.h.db)).toMatchObject({ observations: 1, drafts: 1, questions: 0 });
  });

  it('under a core pause, a lot waits queued with no model call', async () => {
    const t = setup();
    setPaused(t.h.db, true, 'core');
    t.replies.push(...t.goodReplies());
    const pushed = t.replies.length;
    await t.ingest({ version: 1, observations: [obs('Le client X a signé le devis.')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.status(1).status).toBe('queued');
    expect(t.replies).toHaveLength(pushed);
    const token = await t.h.pairClient();
    await t.h.app.request('/lun/v1/resume', {
      method: 'POST',
      headers: t.h.auth(token),
      body: '{"by":"core"}',
    });
    await t.settle();
    expect(t.status(1).status).toBe('done');
  });

  it('refuses an oversized text and 501 observations: 400, nothing stored, no LLM call', async () => {
    const t = setup();
    const big = await t.ingest({ version: 1, observations: [obs('x'.repeat(50_000))] });
    expect(big.status).toBe(400);
    const many = await t.ingest({
      version: 1,
      observations: Array.from({ length: 501 }, (_, i) => obs('ok', `m${i}`)),
    });
    expect(many.status).toBe(400);
    expect(t.count('lots')).toBe(0);
    expect(t.count('observations')).toBe(0);
    expect(t.fake.calls).toHaveLength(0);
  });

  it('holds a lot over the cap, then processes it on the next pass under the cap', async () => {
    const t = setup(); // no replies: any LLM call would fail loudly
    recordCost(t.h.db, { provider: 'anthropic', amount: 9, calls: 1 }, t.h.clock(), 'tri');
    const res = await t.ingest({ version: 1, observations: [obs('Le client X a signé le devis.')] });
    expect((await res.json()).result.status).toBe('held');
    await t.settle();
    expect(t.status(1)).toEqual({ status: 'held', reason: 'cost-cap' });
    expect(t.fake.calls).toHaveLength(0);

    putSetting(t.h.db, 'cost.monthlyCap', 50);
    const fake = fakeProvider(t.goodReplies());
    await runPending({
      ...brainDeps({ db: t.h.db, clock: t.h.clock, version: 'x', actions: t.h.actions }),
      provider: () => ({ provider: fake.provider, model: 'claude-haiku-5-5' }),
    });
    expect(t.status(1).status).toBe('done');
    expect(lastRun(t.h.db)).toMatchObject({ observations: 1, drafts: 1 });
  });

  it('fails a lot whose answers stay invalid, with the reason, and records the pass', async () => {
    const t = setup([{ nope: 1 }, { nope: 2 }]);
    await t.ingest({ version: 1, observations: [obs('texte')] });
    await t.settle();
    const lot = t.status(1);
    expect(lot.status).toBe('failed');
    expect(lot.reason).toContain('Réponse invalide');
    expect(lastRun(t.h.db)).toMatchObject({ drafts: 0, questions: 0 });
  });

  it('has no last run before any pass', () => {
    expect(lastRun(setup().h.db)).toBeUndefined();
  });

  it('runs one pass at a time: two ingests in a row never overlap, and both lots end done', async () => {
    const t = setup();
    t.replies.push(...t.goodReplies(), ...t.goodReplies());
    let active = 0;
    let peak = 0;
    const inner = t.fake.provider.json.bind(t.fake.provider);
    t.fake.provider.json = async (req) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 20));
      try {
        return await inner(req);
      } finally {
        active--;
      }
    };
    const token = await t.h.pairClient();
    const post = () =>
      t.h.app.request('/lun/v1/actions/brain.ingest', {
        method: 'POST',
        headers: t.h.auth(token),
        body: JSON.stringify({ version: 1, observations: [obs('Le client X a signé.')] }),
      });
    await Promise.all([post(), post()]);
    await t.settle();
    expect(peak).toBe(1);
    expect(t.status(1).status).toBe('done');
    expect(t.status(2).status).toBe('done');
  });

  it('replays a lot left running by a crash', async () => {
    const t = setup();
    t.replies.push(...t.goodReplies());
    t.h.db
      .prepare("INSERT INTO lots (status, created_at) VALUES ('running', ?)")
      .run(t.h.clock().toISOString());
    t.h.db
      .prepare('INSERT INTO observations (lot, text, source) VALUES (1, ?, ?)')
      .run('Le client X a signé.', JSON.stringify(obs('x').source));
    await runPending(
      brainDeps({
        db: t.h.db,
        clock: t.h.clock,
        version: 'x',
        actions: t.h.actions,
        brainProvider: (use) => ({
          provider: t.fake.provider,
          model: use === 'tri' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5',
        }),
      }),
    );
    expect(t.status(1).status).toBe('done');
  });

  it('keeps a lot held with its reason when no provider is configured', async () => {
    const h = makeHarness({ brainProvider: () => undefined });
    const token = await h.pairClient();
    await h.app.request('/lun/v1/actions/brain.ingest', {
      method: 'POST',
      headers: h.auth(token),
      body: JSON.stringify({ version: 1, observations: [obs('texte')] }),
    });
    for (let i = 0; i < 50; i++) {
      const lot = h.db.prepare('SELECT status, reason FROM lots').get() as { status: string; reason: string };
      if (lot.status === 'held') return expect(lot.reason).toBe('no-provider');
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('lot never held');
  });
});

describe('brain.lot and the trace of what a lot sets aside', () => {
  type T = ReturnType<typeof prepare>;
  const A = 'Le client X a signé le devis.';
  const B = 'Le café était froid ce matin.';
  const C = 'Le projet Y démarre lundi.';
  const post = async (t: T, name: string, body: unknown) =>
    t.h.app.request(`/lun/v1/actions/${name}`, {
      method: 'POST',
      headers: t.h.auth(await t.h.pairClient()),
      body: JSON.stringify(body),
    });
  const lotOf = async (t: T, lot: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((await (await post(t, 'brain.lot', { lot })).json()) as any).result;
  const send = async (t: T, ...texts: string[]) => {
    await post(t, 'brain.ingest', {
      version: 1,
      observations: texts.map((x, i) => obs(x, `m${i}`)),
    });
    await t.settle();
  };
  const fact = (observation: number) => ({
    text: `Fait ${observation}.`,
    observation,
    replaces: null,
    due: null,
  });
  const prepare = (replies: unknown[]) => {
    const t = setup(replies);
    return Object.assign(t, { typeId: listTypes(t.h.db)[0]!.id });
  };
  const tri = (t: T, ...groups: { observations: number[]; title: string; ficheId?: number }[]) => ({
    groups: groups.map((g) => ({ ficheId: null, typeId: t.typeId, ...g })),
  });
  /** A fiche with eight facts, so that contradictions between them can be asked. */
  const withFacts = (t: T) => {
    const x = createFiche(t.h.db, { typeId: t.typeId, title: 'Client X', synthesis: 'connu' }, 't0');
    const ids = Array.from({ length: 8 }, (_, i) =>
      addFact(t.h.db, x, `Fait ancien ${i}.`, { kind: 'note', at: '2026-11-01T18:00:00Z' }, 't0'),
    );
    const contradiction = (strike: number, reason: string) => ({
      kind: 'contradiction',
      ficheId: x,
      keep: ids[0],
      strike: ids[strike],
      reason,
    });
    return { x, contradiction };
  };
  const passOver = (t: T) =>
    runPending(
      brainDeps({
        db: t.h.db,
        clock: t.h.clock,
        version: 'x',
        actions: t.h.actions,
        brainProvider: (use) => ({
          provider: t.fake.provider,
          model: use === 'tri' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5',
        }),
      }),
    );

  it('sets aside an observation the tri left out of every group as hors-sujet', async () => {
    const t = prepare([]);
    t.replies.push(tri(t, { observations: [0], title: 'Client X' }), {
      fiches: [{ group: 0, synthesis: 's', facts: [fact(0)], links: [] }],
      questions: [],
    });
    await send(t, A, B);
    expect((await lotOf(t, 1)).dropped).toEqual([{ kind: 'observation', text: B, reason: 'hors-sujet' }]);
  });

  it('sets aside as sans-fait an observation no fact cites, and every observation of a group with no fiche', async () => {
    const t = prepare([]);
    t.replies.push(
      tri(t, { observations: [0, 1], title: 'Client X' }, { observations: [2], title: 'Projet Y' }),
      { fiches: [{ group: 0, synthesis: 's', facts: [fact(0)], links: [] }], questions: [] },
    );
    await send(t, A, B, C);
    expect((await lotOf(t, 1)).dropped).toEqual([
      { kind: 'observation', text: B, reason: 'sans-fait' },
      { kind: 'observation', text: C, reason: 'sans-fait' },
    ]);
  });

  it('does not set aside an observation a fact cites', async () => {
    const t = prepare([]);
    t.replies.push(tri(t, { observations: [0, 1], title: 'Client X' }), {
      fiches: [{ group: 0, synthesis: 's', facts: [fact(0), fact(1)], links: [] }],
      questions: [],
    });
    await send(t, A, B);
    expect((await lotOf(t, 1)).dropped).toEqual([]);
  });

  it('sets aside a question already asked as deja-posee, with the model reason as its text', async () => {
    const t = prepare([]);
    const { x, contradiction } = withFacts(t);
    const reply = (reason: string) => [
      tri(t, { observations: [0], title: 'Client X', ficheId: x }),
      {
        fiches: [{ group: 0, synthesis: '', facts: [fact(0)], links: [] }],
        questions: [contradiction(1, reason)],
      },
    ];
    t.replies.push(...reply('Premier avis.'), ...reply('Même paire, redite.'));
    await send(t, A);
    await send(t, A);
    expect((await lotOf(t, 1)).dropped).toEqual([]);
    const second = await lotOf(t, 2);
    expect(second.questions).toEqual([]);
    expect(second.dropped).toEqual([{ kind: 'question', text: 'Même paire, redite.', reason: 'deja-posee' }]);
  });

  it('sets aside the sixth new question as au-dela', async () => {
    const t = prepare([]);
    const { x, contradiction } = withFacts(t);
    t.replies.push(tri(t, { observations: [0], title: 'Client X', ficheId: x }), {
      fiches: [{ group: 0, synthesis: '', facts: [fact(0)], links: [] }],
      questions: [1, 2, 3, 4, 5, 6].map((i) => contradiction(i, `Raison ${i}.`)),
    });
    await send(t, A);
    const lot = await lotOf(t, 1);
    expect(lot.questions).toHaveLength(5);
    expect(lot.dropped).toEqual([{ kind: 'question', text: 'Raison 6.', reason: 'au-dela' }]);
  });

  it('serves the bilan of a done lot', async () => {
    const t = prepare([]);
    const { x, contradiction } = withFacts(t);
    t.replies.push(tri(t, { observations: [0], title: 'Client X', ficheId: x }), {
      fiches: [{ group: 0, synthesis: '', facts: [fact(0)], links: [] }],
      questions: [contradiction(1, 'Les deux faits se contredisent.')],
    });
    await send(t, A, B);
    expect(await lotOf(t, 1)).toEqual({
      lot: 1,
      status: 'done',
      receivedAt: '2026-11-02T08:00:00.000Z',
      observations: 2,
      fiches: [{ title: 'Client X', status: 'pending' }],
      questions: [{ kind: 'contradiction', status: 'pending' }],
      dropped: [{ kind: 'observation', text: B, reason: 'hors-sujet' }],
    });
  });

  it('serves a held lot with its motif and nothing set aside', async () => {
    const t = prepare([]);
    recordCost(t.h.db, { provider: 'anthropic', amount: 9, calls: 1 }, t.h.clock(), 'tri');
    await send(t, A);
    const lot = await lotOf(t, 1);
    expect(lot).toMatchObject({ lot: 1, status: 'held', reason: 'cost-cap', observations: 1 });
    expect(lot).toMatchObject({ fiches: [], questions: [], dropped: [] });
  });

  it('serves a failed lot with its motif and nothing set aside', async () => {
    const t = prepare([{ nope: 1 }, { nope: 2 }]);
    await send(t, A, B);
    const lot = await lotOf(t, 1);
    expect(lot.status).toBe('failed');
    expect(lot.reason).toContain('Réponse invalide');
    expect(lot).toMatchObject({ fiches: [], questions: [], dropped: [] });
  });

  it('serves a queued lot, with no motif', async () => {
    const t = prepare([]);
    setPaused(t.h.db, true, 'core');
    await post(t, 'brain.ingest', { version: 1, observations: [obs(A)] });
    await new Promise((r) => setTimeout(r, 20));
    const lot = await lotOf(t, 1);
    expect(lot).toMatchObject({ status: 'queued', observations: 1, fiches: [], questions: [], dropped: [] });
    expect(lot).not.toHaveProperty('reason');
  });

  it('answers 400 for an unknown lot', async () => {
    const t = prepare([]);
    const res = await post(t, 'brain.lot', { lot: 99 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('Lot inconnu');
  });

  it('overwrites the trace when a lot is replayed after a stop', async () => {
    const t = prepare([]);
    // First pass sets B aside; the replay attaches it, so the trace must no longer show it.
    t.replies.push(
      tri(t, { observations: [0], title: 'Client X' }),
      { fiches: [{ group: 0, synthesis: 's', facts: [fact(0)], links: [] }], questions: [] },
      tri(t, { observations: [0, 1], title: 'Client X' }),
      { fiches: [{ group: 0, synthesis: 's', facts: [fact(0), fact(1)], links: [] }], questions: [] },
    );
    await send(t, A, B);
    expect((await lotOf(t, 1)).dropped).toEqual([{ kind: 'observation', text: B, reason: 'hors-sujet' }]);
    t.h.db.prepare("UPDATE lots SET status = 'running' WHERE id = 1").run();
    await passOver(t);
    const lot = await lotOf(t, 1);
    expect(lot.status).toBe('done');
    expect(lot.dropped).toEqual([]);
  });

  it('sets aside a question repeated in the same answer as deja-posee', async () => {
    const t = prepare([]);
    const { x, contradiction } = withFacts(t);
    t.replies.push(tri(t, { observations: [0], title: 'Client X', ficheId: x }), {
      fiches: [{ group: 0, synthesis: '', facts: [fact(0)], links: [] }],
      questions: [contradiction(1, 'Première.'), contradiction(1, 'Redite.')],
    });
    await send(t, A);
    const lot = await lotOf(t, 1);
    expect(lot.questions).toHaveLength(1);
    expect(lot.dropped).toEqual([{ kind: 'question', text: 'Redite.', reason: 'deja-posee' }]);
  });

  it('declares brain.lot as a read action', async () => {
    const t = prepare([]);
    const token = await t.h.pairClient();
    const list = (await (await t.h.app.request('/lun/v1/actions', { headers: t.h.auth(token) })).json()) as {
      actions: { name: string; effect: string }[];
    };
    expect(list.actions.find((a) => a.name === 'brain.lot')?.effect).toBe('read');
  });

  it('keeps nothing set aside when a lot is held after its tri, then fails at the second try', async () => {
    const t = prepare([]);
    // First pass: the tri leaves B out, then the provider goes down: the lot is held, nothing written.
    t.replies.push(
      tri(t, { observations: [0], title: 'Client X' }),
      new ProviderError('unavailable', 'down'),
    );
    await send(t, A, B);
    expect(await lotOf(t, 1)).toMatchObject({ status: 'held', dropped: [] });
    // Second pass, a day on: the answers stay invalid.
    t.h.advance(26 * 3_600_000);
    t.replies.push({ nope: 1 }, { nope: 2 });
    await passOver(t);
    expect(await lotOf(t, 1)).toMatchObject({ status: 'failed', dropped: [] });
  });
});

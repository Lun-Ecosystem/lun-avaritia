import { describe, expect, it } from 'vitest';
import { putSetting } from '../db.ts';
import { recordCost } from '../contract/costs.ts';
import { brainDeps } from '../app.ts';
import { fakeProvider } from '../testing/fake-provider.ts';
import { makeHarness } from '../testing/harness.ts';
import { listTypes } from './store.ts';
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
          facts: [{ text: 'Le client X a signé.', observation: 0, replaces: null }],
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

  it('refuses the lot with a reason when core.lots is false', async () => {
    const t = setup();
    putSetting(t.h.db, 'core.lots', false);
    const res = await t.ingest({ version: 1, observations: [obs('texte')] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('coupés');
    expect(t.count('lots')).toBe(0);
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

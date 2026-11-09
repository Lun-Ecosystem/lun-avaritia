import { describe, expect, it } from 'vitest';
import { recordCost } from '../contract/costs.ts';
import { setPaused } from '../contract/state.ts';
import { ProviderError } from '../llm/types.ts';
import { fakeProvider } from '../testing/fake-provider.ts';
import { vault } from '../testing/load-vault.ts';
import { makeHarness } from '../testing/harness.ts';
import { dashboard } from './dashboard.ts';
import { applyDraft } from './drafts.ts';
import { getFiche, listTypes } from './store.ts';

function setup(withProvider = true, extra: Parameters<typeof makeHarness>[0] = {}) {
  const queue: unknown[] = [];
  const fake = fakeProvider(queue);
  const h = makeHarness({
    ...(withProvider && { brainProvider: () => ({ provider: fake.provider, model: 'claude-sonnet-5-5' }) }),
    ...extra,
  });
  const typeId = listTypes(h.db)[0]!.id;
  const good = () => [
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
  const req = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const token = await h.pairClient();
    const headers = h.auth(token);
    if (init.body instanceof FormData) delete headers['content-type'];
    const { json, ...rest } = init;
    return h.app.request(path, {
      ...rest,
      headers,
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  };
  const upload = (name: string, type: string, content: string | Uint8Array) => {
    const f = new FormData();
    f.set('file', new File([content as BlobPart], name, { type }));
    return req('/api/depots', { method: 'POST', body: f });
  };
  const count = (t: string) => (h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { h, queue, good, req, upload, count };
}

describe('notes and depots', () => {
  it('a depot leaves a run that « Dernier traitement » shows; a refused one leaves none', async () => {
    const t = setup();
    t.queue.push(...t.good());
    await t.upload('d.txt', 'text/plain', 'Le client X a signé.');
    expect(dashboard(t.h.db, t.h.clock()).lastRun).toMatchObject({
      observations: 1,
      drafts: 1,
      questions: 0,
    });
    const none = setup(false);
    expect((await none.upload('d.txt', 'text/plain', 'Le client X a signé.')).status).toBe(503);
    expect(none.count('runs')).toBe(0);
    expect(dashboard(none.h.db, none.h.clock()).lastRun).toBeUndefined();
  });

  it('a note becomes drafts at once, sourced to its stored text', async () => {
    const t = setup();
    t.queue.push(...t.good());
    const res = await t.req('/api/notes', { method: 'POST', json: { text: 'Le client X a signé.' } });
    expect(await res.json()).toEqual({ drafts: 1 });
    expect(t.count('depots')).toBe(1);
    expect(t.h.db.prepare('SELECT origin FROM drafts').get()).toEqual({ origin: 'note' });
  });

  it('a pause, local or of the core, lets a note and a depot through: they are asked by hand', async () => {
    for (const by of ['local', 'core'] as const) {
      const t = setup();
      setPaused(t.h.db, true, by);
      t.queue.push(...t.good());
      const note = await t.req('/api/notes', { method: 'POST', json: { text: 'Le client X a signé.' } });
      expect(await note.json()).toEqual({ drafts: 1 });
      t.queue.push(...t.good());
      expect(await (await t.upload('d.txt', 'text/plain', 'Le client X a signé.')).json()).toMatchObject({
        drafts: 1,
      });
    }
  });

  it('a .md depot gives drafts attached to it, listed with their count; deleting keeps the drafts', async () => {
    const t = setup();
    t.queue.push(...t.good());
    const res = await t.upload('compte-rendu.md', 'text/markdown', '# Réunion\nLe client X a signé.');
    expect(await res.json()).toEqual({ depot: 1, drafts: 1 });
    const list = (await (await t.req('/api/depots')).json()) as { depots: unknown[] };
    expect(list.depots).toMatchObject([{ id: 1, name: 'compte-rendu.md', pending: 1, total: 1 }]);
    expect((await t.req('/api/depots/1', { method: 'DELETE' })).status).toBe(204);
    expect((await t.req('/api/depots/1', { method: 'DELETE' })).status).toBe(404);
    expect(t.count('drafts')).toBe(1);
  });

  it('refuses a PDF, other formats, bad UTF-8 and an oversized document: 400, nothing stored', async () => {
    const t = setup();
    const pdf = await t.upload('a.pdf', 'application/pdf', '%PDF-1.4');
    expect(pdf.status).toBe(400);
    expect(await pdf.json()).toEqual({ error: 'PDF non pris en charge en v1' });
    expect((await t.upload('a.png', 'image/png', 'x')).status).toBe(400);
    expect((await t.upload('a.txt', 'text/plain', new Uint8Array([0xff, 0xfe, 0xfd]))).status).toBe(400);
    expect((await t.upload('big.txt', 'text/plain', 'x'.repeat(200_001))).status).toBe(400);
    expect(t.count('depots')).toBe(0);
  });

  it('answers 413 to an oversize body before buffering it, storing nothing', async () => {
    const t = setup();
    const big = 'x'.repeat(1_100_000);
    expect((await t.upload('big.txt', 'text/plain', big)).status).toBe(413);
    expect((await t.req('/api/notes', { method: 'POST', json: { text: big } })).status).toBe(413);
    const vaultBig = { files: [{ path: 'a.md', text: 'x'.repeat(26_000_000) }] };
    expect((await t.req('/api/import', { method: 'POST', json: vaultBig })).status).toBe(413);
    expect(t.count('depots') + t.count('drafts')).toBe(0);
  });

  it('maps pending and failed outcomes, keeping the text, and says what to do with it', async () => {
    const note = { method: 'POST', json: { text: 'Un texte.' } };
    const said = async (t: ReturnType<typeof setup>) => {
      const res = await t.req('/api/notes', note);
      return { status: res.status, error: ((await res.json()) as { error: string }).error };
    };
    // Nothing processes a kept text again: each answer says where it stays, and how to have it processed.
    const kept = /le texte est gardé dans Dépôts, sans traitement\. .*envoie-le à nouveau/;

    const none = setup(false);
    const noKey = await said(none);
    expect(noKey.status).toBe(503);
    expect(noKey.error).toMatch(/^Aucune clé de fournisseur d’IA : .*Ajoute une clé dans Réglages/);
    expect(noKey.error).toMatch(kept);
    expect(none.count('depots')).toBe(1);

    // A key, but no model for one of the uses.
    const noModel = await said(
      setup(false, { brainProvider: () => undefined, llmEnv: { openai: { key: 'sk-x' } } }),
    );
    expect(noModel.status).toBe(503);
    expect(noModel.error).toMatch(/^Aucun modèle d’IA choisi : .*Choisis un modèle dans Réglages/);
    expect(noModel.error).toMatch(kept);

    const capped = setup();
    recordCost(capped.h.db, { provider: 'anthropic', amount: 99, calls: 1 }, capped.h.clock(), 'tri');
    const cap = await said(capped);
    expect(cap.status).toBe(409);
    expect(cap.error).toMatch(/^Plafond de coût mensuel atteint : /);
    expect(cap.error).toMatch(kept);

    // The provider's own words, as the agent says them; never its raw code.
    const refusals = {
      key: /^Le fournisseur d’IA refuse la clé : .*Vérifie-la dans Réglages/,
      credit: /^Plus de crédit chez le fournisseur d’IA : .*Recharge ton crédit/,
      unavailable: /^Le fournisseur d’IA ne répond pas : .*Envoie-le à nouveau dans un instant\.$/,
    };
    for (const [kind, words] of Object.entries(refusals)) {
      const down = setup();
      down.queue.push(new ProviderError(kind as keyof typeof refusals, 'x'));
      const said503 = await said(down);
      expect(said503.status).toBe(503);
      expect(said503.error).toMatch(words);
      expect(said503.error).toMatch(/le texte est gardé dans Dépôts, sans traitement\./);
      expect(said503.error).not.toMatch(/provider-/);
    }

    const bad = setup();
    bad.queue.push({ nope: 1 }, { nope: 1 });
    expect((await bad.req('/api/notes', note)).status).toBe(502);
    expect(bad.count('depots')).toBe(1);
  });
});

describe('/api/import', () => {
  it('previews warnings in one draft; accepting creates one Note per note and the resolved links', async () => {
    const t = setup();
    const res = await t.req('/api/import', { method: 'POST', json: { files: vault } });
    const body = (await res.json()) as { draft: number; notes: number; warnings: string[] };
    expect(body.notes).toBe(6);
    expect(body.warnings.length).toBeGreaterThanOrEqual(3);
    applyDraft(t.h.db, body.draft, undefined, '2026-11-02T08:00:00Z');
    const noteType = listTypes(t.h.db).find((x) => x.name === 'Note')!.id;
    expect(t.count('fiches')).toBe(6);
    const atelier = getFiche(t.h.db, 1)!;
    expect(atelier.typeId).toBe(noteType);
    expect(atelier.links.map((l) => l.relation)).toEqual(Array(4).fill('mentionne')); // 2 out, 2 in
  });

  it('refuses too many files, a bad body, and a vault without notes', async () => {
    const t = setup();
    const many = Array.from({ length: 2001 }, (_, i) => ({ path: `${i}.md`, text: 'x' }));
    expect((await t.req('/api/import', { method: 'POST', json: { files: many } })).status).toBe(400);
    expect((await t.req('/api/import', { method: 'POST', json: { files: 'no' } })).status).toBe(400);
    expect((await t.req('/api/import', { method: 'POST', json: { files: [] } })).status).toBe(400);
    expect(t.count('drafts')).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { recordCost } from '../contract/costs.ts';
import { fakeProvider } from '../testing/fake-provider.ts';
import { makeHarness } from '../testing/harness.ts';
import { applyDraft } from './drafts.ts';
import { vault } from './obsidian.test.ts';
import { getFiche, listTypes } from './store.ts';

function setup(withProvider = true) {
  const queue: unknown[] = [];
  const fake = fakeProvider(queue);
  const h = makeHarness(
    withProvider ? { brainProvider: () => ({ provider: fake.provider, model: 'claude-sonnet-5-5' }) } : {},
  );
  const typeId = listTypes(h.db)[0]!.id;
  const good = () => [
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
  it('a note becomes drafts at once, sourced to its stored text', async () => {
    const t = setup();
    t.queue.push(...t.good());
    const res = await t.req('/api/notes', { method: 'POST', json: { text: 'Le client X a signé.' } });
    expect(await res.json()).toEqual({ drafts: 1 });
    expect(t.count('depots')).toBe(1);
    expect(t.h.db.prepare('SELECT origin FROM drafts').get()).toEqual({ origin: 'note' });
  });

  it('a .md depot gives drafts attached to it, listed with their count; deleting keeps the drafts', async () => {
    const t = setup();
    t.queue.push(...t.good());
    const res = await t.upload('compte-rendu.md', 'text/markdown', '# Réunion\nLe client X a signé.');
    expect(await res.json()).toEqual({ depot: 1, drafts: 1 });
    const list = (await (await t.req('/api/depots')).json()) as { depots: unknown[] };
    expect(list.depots).toMatchObject([{ id: 1, name: 'compte-rendu.md', drafts: 1 }]);
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

  it('maps pending and failed outcomes, keeping the text', async () => {
    const none = setup(false);
    const note = { method: 'POST', json: { text: 'Un texte.' } };
    expect((await none.req('/api/notes', note)).status).toBe(503);
    expect(none.count('depots')).toBe(1);

    const capped = setup();
    recordCost(capped.h.db, { provider: 'anthropic', amount: 99, calls: 1 }, capped.h.clock(), 'tri');
    expect((await capped.req('/api/notes', note)).status).toBe(409);

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

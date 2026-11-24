import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { brainDeps } from '../app.ts';
import { fakeProvider } from '../testing/fake-provider.ts';
import { makeHarness } from '../testing/harness.ts';
import { readZip } from '../testing/read-zip.ts';
import { setPaused } from '../contract/state.ts';
import { runPending } from './ingest.ts';
import { addDraft, getDraft, refuseDraft } from './drafts.ts';
import { createClient } from '../contract/auth.ts';
import { addFact, createFiche, getFiche, link, listTypes, versions } from './store.ts';

function setup(extra: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(extra);
  const typeId = listTypes(h.db)[0]!.id;
  const req = async (path: string, method = 'GET', json?: unknown) =>
    h.app.request(path, {
      method,
      headers: h.auth(await h.pairClient()),
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  return { h, typeId, req };
}

describe('fiches, settings, dashboard and export API', () => {
  it('PATCH applies at once and creates a version; merged fiches are not listed', async () => {
    const { h, typeId, req } = setup();
    const now = h.clock().toISOString();
    const id = createFiche(h.db, { typeId, title: 'Client X', synthesis: 'Avant.' }, now);
    const ghost = createFiche(h.db, { typeId, title: 'Doublon', synthesis: '' }, now);
    h.db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(id, ghost);

    expect((await req(`/api/fiches/${id}`, 'PATCH', { synthesis: 'Après.' })).status).toBe(200);
    expect(getFiche(h.db, id)!.synthesis).toBe('Après.');
    expect(versions(h.db, id)).toHaveLength(1);
    expect(versions(h.db, id)[0]!.synthesis).toBe('Avant.');
    expect((await req('/api/fiches/999', 'PATCH', { title: 'x' })).status).toBe(400);
    expect((await req(`/api/fiches/${id}`, 'PATCH', { title: '  ' })).status).toBe(400);
    expect((await req(`/api/fiches/${id}`, 'PATCH', { synthesis: 'x'.repeat(20_001) })).status).toBe(400);
    expect(getFiche(h.db, id)!.title).toBe('Client X');

    const list = (await (await req('/api/fiches')).json()) as { fiches: { id: number }[] };
    expect(list.fiches.map((f) => f.id)).toEqual([id]);
    const one = (await (await req(`/api/fiches/${id}`)).json()) as {
      fiche: { title: string };
      versions: unknown[];
    };
    expect(one.fiche.title).toBe('Client X');
    expect(one.versions).toHaveLength(1);
  });

  it('GET on a merged fiche redirects to the kept one; PATCH on it is a 400', async () => {
    const { h, typeId, req } = setup();
    const now = h.clock().toISOString();
    const kept = createFiche(h.db, { typeId, title: 'Gardée', synthesis: '' }, now);
    const ghost = createFiche(h.db, { typeId, title: 'Doublon', synthesis: '' }, now);
    h.db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(kept, ghost);
    const one = (await (await req(`/api/fiches/${ghost}`)).json()) as {
      fiche: { id: number };
      redirectedFrom: number;
    };
    expect(one.fiche.id).toBe(kept);
    expect(one.redirectedFrom).toBe(ghost);
    expect((await req(`/api/fiches/${ghost}`, 'PATCH', { title: 'x' })).status).toBe(400);
    expect(getFiche(h.db, ghost)!.title).toBe('Doublon');
  });

  it('manages the types, answering 400 on a refusal', async () => {
    const { req } = setup();
    expect((await req('/api/types', 'POST', { name: 'Lieu' })).status).toBe(200);
    expect((await req('/api/types', 'POST', { name: 'Lieu' })).status).toBe(400);
    const { types } = (await (await req('/api/types')).json()) as { types: { id: number; name: string }[] };
    const lieu = types.find((t) => t.name === 'Lieu')!;
    expect((await req(`/api/types/${lieu.id}`, 'PATCH', { name: 'Endroit' })).status).toBe(200);
    expect((await req(`/api/types/${lieu.id}`, 'DELETE')).status).toBe(204);
    expect((await req(`/api/types/${lieu.id}`, 'DELETE')).status).toBe(400);
  });

  it('settings: drafts.cap 0 is a 400, a valid value is kept', async () => {
    const { req } = setup();
    expect((await req('/api/settings', 'PUT', { 'drafts.cap': 0 })).status).toBe(400);
    expect((await req('/api/settings', 'PUT', { 'drafts.cap': 20 })).status).toBe(200);
    const s = (await (await req('/api/settings')).json()) as { settings: Record<string, unknown> };
    expect(s.settings['drafts.cap']).toBe(20);
  });

  it('dashboard answers the counts', async () => {
    const { req } = setup();
    const d = (await (await req('/api/dashboard')).json()) as { pending: { drafts: number } };
    expect(d.pending.drafts).toBe(0);
  });

  it('export answers a stored ZIP as an attachment named after the day, one entry per fiche', async () => {
    const { h, typeId, req } = setup();
    const at = h.clock().toISOString();
    // Accents and a fact beyond ASCII: an entry's size counts bytes, not characters.
    const cafe = createFiche(h.db, { typeId, title: 'Café Élan', synthesis: 'Un client fictif.' }, at);
    addFact(h.db, cafe, 'Rendez-vous à 9 h — « Nœud » ✓', { kind: 'core', origin: 'acedia', at }, at);
    createFiche(h.db, { typeId, title: 'Client Y', synthesis: '' }, at);
    const res = await req('/api/export', 'POST');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="avaritia-export-2026-11-02.zip"',
    );
    expect(res.headers.get('x-avaritia-fiches')).toBe('2');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK
    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(['cafe-elan.md', 'client-y.md']);
    expect(entries[0]!.text).toContain('# Café Élan');
    expect(entries[0]!.text).toContain('Un client fictif.');
    expect(entries[0]!.text).toContain('- Rendez-vous à 9 h — « Nœud » ✓\n');
    for (const e of entries) {
      expect(e.method).toBe(0); // stored, not deflated
      expect(e.crc).toBe(crc32(Buffer.from(e.text, 'utf8')));
    }
  });

  it('export without a fiche is a valid empty archive, and needs no data directory', async () => {
    const { req } = setup();
    const res = await req('/api/export', 'POST');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-avaritia-fiches')).toBe('0');
    expect(readZip(new Uint8Array(await res.arrayBuffer()))).toEqual([]);
  });

  it('export is protected like the other routes', async () => {
    const { h } = setup();
    expect((await h.app.request('/api/export', { method: 'POST' })).status).toBe(401);
  });

  it('a pause during a pass stops before the next lot', async () => {
    const replies: unknown[] = [];
    const fake = fakeProvider(replies);
    const { h, typeId } = setup();
    const json = fake.provider.json.bind(fake.provider);
    // The pause lands while the first lot is being processed.
    fake.provider.json = async (r) => {
      const out = await json(r);
      if (fake.calls.length === 2) setPaused(h.db, true);
      return out;
    };
    const brainProvider = () => ({ provider: fake.provider, model: 'm' });
    const src = JSON.stringify({ kind: 'core', at: '2026-11-01T18:00:00Z' });
    for (const id of [1, 2]) {
      h.db.prepare("INSERT INTO lots (status, created_at) VALUES ('queued', ?)").run(h.clock().toISOString());
      h.db
        .prepare('INSERT INTO observations (lot, text, source) VALUES (?, ?, ?)')
        .run(id, `Fait ${id}.`, src);
    }
    replies.push(
      { groups: [{ observations: [0], ficheId: null, typeId, title: 'Client X' }] },
      {
        fiches: [
          {
            group: 0,
            synthesis: 's',
            facts: [{ text: 'f', observation: 0, replaces: null, due: null }],
            links: [],
          },
        ],
        questions: [],
      },
    );
    await runPending(
      brainDeps({ db: h.db, clock: h.clock, version: 'x', actions: h.actions, brainProvider }),
    );
    const status = (id: number) =>
      (h.db.prepare('SELECT status FROM lots WHERE id = ?').get(id) as { status: string }).status;
    expect([status(1), status(2)]).toEqual(['done', 'queued']);
    expect(fake.calls).toHaveLength(2);
  });

  it('a pause processes nothing; resume runs the waiting lots', async () => {
    const replies: unknown[] = [];
    const fake = fakeProvider(replies);
    const brainProvider = () => ({ provider: fake.provider, model: 'm' });
    const { h, typeId } = setup({ brainProvider });
    const token = await h.pairClient();
    await h.app.request('/lun/v1/pause', { method: 'POST', headers: h.auth(token) });
    h.db.prepare("INSERT INTO lots (status, created_at) VALUES ('queued', ?)").run(h.clock().toISOString());
    h.db
      .prepare('INSERT INTO observations (lot, text, source) VALUES (1, ?, ?)')
      .run('Le client X a signé.', JSON.stringify({ kind: 'core', at: '2026-11-01T18:00:00Z' }));
    const lot = () =>
      (h.db.prepare('SELECT status FROM lots WHERE id = 1').get() as { status: string }).status;

    await runPending(
      brainDeps({ db: h.db, clock: h.clock, version: 'x', actions: h.actions, brainProvider }),
    );
    expect(fake.calls).toHaveLength(0);
    expect(lot()).toBe('queued');

    replies.push(
      { groups: [{ observations: [0], ficheId: null, typeId, title: 'Client X' }] },
      {
        fiches: [
          {
            group: 0,
            synthesis: 's',
            facts: [{ text: 'f', observation: 0, replaces: null, due: null }],
            links: [],
          },
        ],
        questions: [],
      },
    );
    await h.app.request('/lun/v1/resume', { method: 'POST', headers: h.auth(token) });
    for (let i = 0; i < 200 && lot() !== 'done'; i++) await new Promise((r) => setTimeout(r, 10));
    expect(lot()).toBe('done');
  });
});

describe('reads for the app: drafts, graph, neighbors', () => {
  const src = { kind: 'depot' as const, ref: '7', at: '2026-11-02T08:00:00.000Z' };
  const fill = () => {
    const { h, typeId, req } = setup();
    const now = h.clock().toISOString();
    const a = createFiche(h.db, { typeId, title: 'Client A', synthesis: '' }, now);
    const b = createFiche(h.db, { typeId, title: 'Projet B', synthesis: '' }, now);
    const f1 = addFact(h.db, a, 'Contact : a@example.org', src, now);
    const f2 = addFact(h.db, a, 'Contact : b@example.org', src, now);
    link(h.db, a, b, 'concerne');
    return { h, typeId, req, a, b, f1, f2, now };
  };

  it('GET /api/drafts: queue order, names, facts, held beyond the cap', async () => {
    const t = fill();
    const fiche = {
      kind: 'fiche' as const,
      typeId: t.typeId,
      title: 'Nouvelle',
      synthesis: '',
      facts: [],
      links: [],
    };
    addDraft(t.h.db, fiche, { source: 'note' }, t.now);
    addDraft(t.h.db, { kind: 'doublon', keep: t.a, merge: t.b, reason: 'r' }, { source: 'core' }, t.now);
    addDraft(
      t.h.db,
      { kind: 'contradiction', ficheId: t.a, keep: t.f2, strike: t.f1, reason: 'r' },
      { source: 'core' },
      t.now,
    );
    type R = {
      drafts: {
        kind: string;
        names: Record<string, string>;
        facts: Record<string, { text: string; struck: boolean }>;
      }[];
      held: number;
    };
    const res = (await (await t.req('/api/drafts')).json()) as R;
    expect(res.drafts.map((d) => d.kind)).toEqual(['contradiction', 'doublon', 'fiche']);
    expect(res.drafts[0]!.names[String(t.a)]).toBe('Client A');
    expect(res.drafts[0]!.facts[String(t.f1)]).toEqual({ text: 'Contact : a@example.org', struck: false });
    expect(res.held).toBe(0);
    await t.req('/api/settings', 'PUT', { 'drafts.cap': 1 });
    const capped = (await (await t.req('/api/drafts')).json()) as R;
    expect(capped.drafts).toHaveLength(1);
    expect(capped.held).toBe(2);
  });

  it('POST /api/drafts/:id/restore: 200 and the draft, 404, 409 in plain words, devices only', async () => {
    const t = fill();
    const fiche = {
      kind: 'fiche' as const,
      typeId: t.typeId,
      title: 'Nouvelle',
      synthesis: '',
      facts: [],
      links: [],
    };
    const id = addDraft(t.h.db, fiche, { source: 'note' }, t.now);
    const restore = (n: number) => t.req(`/api/drafts/${n}/restore`, 'POST');
    // pending: nothing to undo
    const pending = await restore(id);
    expect(pending.status).toBe(409);
    expect(((await pending.json()) as { error: string }).error).toMatch(/Trop tard/);
    refuseDraft(t.h.db, id, t.h.clock().toISOString());
    const ok = await restore(id);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { draft: { id: number; status: string } }).draft).toMatchObject({
      id,
      status: 'pending',
    });
    expect(getDraft(t.h.db, id)!.status).toBe('pending');
    // too old
    refuseDraft(t.h.db, id, t.h.clock().toISOString());
    t.h.advance(31_000);
    const late = await restore(id);
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toBe(
      'Trop tard pour annuler : le refus est fait.',
    );
    expect((await restore(999)).status).toBe(404);
    // the core's token (an app, not a device) is refused like on any /api route
    const app = createClient(t.h.db, 'core', 'app', t.h.clock());
    const asApp = await t.h.app.request(`/api/drafts/${id}/restore`, {
      method: 'POST',
      headers: t.h.auth(app),
    });
    expect(asApp.status).toBe(403);
    expect((await t.h.app.request(`/api/drafts/${id}/restore`, { method: 'POST' })).status).toBe(401);
  });

  it('GET /api/graph: nodes, degree, edges, merged excluded, flagged by a pending contradiction', async () => {
    const t = fill();
    const ghost = createFiche(t.h.db, { typeId: t.typeId, title: 'Fantôme', synthesis: '' }, t.now);
    t.h.db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(t.b, ghost);
    link(t.h.db, ghost, t.a, 'vers');
    type G = {
      nodes: { id: number; degree: number; flagged: boolean }[];
      edges: { from: number; to: number; relation: string }[];
    };
    let g = (await (await t.req('/api/graph')).json()) as G;
    expect(g.nodes.map((n) => n.id).sort()).toEqual([t.a, t.b]);
    expect(g.nodes.find((n) => n.id === t.a)!.degree).toBe(2);
    expect(g.edges).toContainEqual({ from: t.a, to: t.b, relation: 'concerne' });
    expect(g.edges).toContainEqual({ from: t.b, to: t.a, relation: 'vers' });
    expect(g.nodes.every((n) => !n.flagged)).toBe(true);
    addDraft(
      t.h.db,
      { kind: 'contradiction', ficheId: t.a, keep: t.f2, strike: t.f1, reason: 'r' },
      { source: 'core' },
      t.now,
    );
    g = (await (await t.req('/api/graph')).json()) as G;
    expect(g.nodes.find((n) => n.id === t.a)!.flagged).toBe(true);
    expect(g.nodes.find((n) => n.id === t.b)!.flagged).toBe(false);
  });

  it('GET /api/graph: no dangling edge when the kept fiche is itself merged', async () => {
    const t = fill();
    const c = createFiche(t.h.db, { typeId: t.typeId, title: 'C', synthesis: '' }, t.now);
    const d = createFiche(t.h.db, { typeId: t.typeId, title: 'D', synthesis: '' }, t.now);
    t.h.db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(c, t.b);
    t.h.db.prepare('UPDATE fiches SET merged_into = ? WHERE id = ?').run(d, c);
    const g = (await (await t.req('/api/graph')).json()) as {
      nodes: { id: number; degree: number }[];
      edges: { from: number; to: number }[];
    };
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(g.nodes.find((n) => n.id === t.a)!.degree).toBe(0);
  });

  it('GET /api/fiches/:id: neighbors both ways, depots; 401 without a token', async () => {
    const t = fill();
    t.h.db
      .prepare(
        "INSERT INTO depots (id, name, type, bytes, created_at) VALUES (7, 'Notes.pdf', 'application/pdf', x'00', ?)",
      )
      .run(t.now);
    const one = (await (await t.req(`/api/fiches/${t.a}`)).json()) as {
      neighbors: { id: number; title: string; relation: string; direction: string }[];
      depots: { id: number; name: string }[];
    };
    expect(one.neighbors).toEqual([{ id: t.b, title: 'Projet B', relation: 'concerne', direction: 'out' }]);
    expect(one.depots).toEqual([{ id: 7, name: 'Notes.pdf' }]);
    const back = (await (await t.req(`/api/fiches/${t.b}`)).json()) as typeof one;
    expect(back.neighbors).toEqual([{ id: t.a, title: 'Client A', relation: 'concerne', direction: 'in' }]);
    expect((await t.h.app.request(`/api/fiches/${t.a}`)).status).toBe(401);
  });
});

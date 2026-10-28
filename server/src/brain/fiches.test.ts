import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brainDeps } from '../app.ts';
import { fakeProvider } from '../testing/fake-provider.ts';
import { makeHarness } from '../testing/harness.ts';
import { runPending } from './ingest.ts';
import { createFiche, getFiche, listTypes, versions } from './store.ts';

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

    const list = (await (await req('/api/fiches')).json()) as { fiches: { id: number }[] };
    expect(list.fiches.map((f) => f.id)).toEqual([id]);
    const one = (await (await req(`/api/fiches/${id}`)).json()) as {
      fiche: { title: string };
      versions: unknown[];
    };
    expect(one.fiche.title).toBe('Client X');
    expect(one.versions).toHaveLength(1);
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

  it('export writes under the data directory and returns the files', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'avaritia-data-'));
    const { h, typeId, req } = setup({ dataDir });
    createFiche(h.db, { typeId, title: 'Client X', synthesis: '' }, h.clock().toISOString());
    const body = (await (await req('/api/export', 'POST')).json()) as { dir: string; files: string[] };
    expect(body.files).toEqual(['client-x.md']);
    expect(body.dir).toBe(join(dataDir, 'export', '2026-11-02'));
    expect(existsSync(join(body.dir, 'client-x.md'))).toBe(true);
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
            facts: [{ text: 'f', observation: 0, replaces: null }],
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

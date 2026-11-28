import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { issuePairingCode } from './auth.ts';
import { addDraft } from '../brain/drafts.ts';
import { addFact, createFiche, listTypes } from '../brain/store.ts';
import { eventsSince } from './events.ts';

const json = { 'content-type': 'application/json' };

describe('POST /lun/v1/pair lock', () => {
  it('voids pending codes after 5 wrong codes and logs a warning', async () => {
    const h = makeHarness();
    const code = issuePairingCode(h.db, h.clock());
    const pair = (c: string) =>
      h.app.request('/lun/v1/pair', { method: 'POST', headers: json, body: JSON.stringify({ code: c }) });
    for (let i = 0; i < 5; i++) expect((await pair('000000')).status).toBe(401);
    expect(h.logs).toContain('Appairage verrouillé : 5 codes faux en 10 min, codes en cours annulés.');
    expect((await pair(code)).status).toBe(401);
  });

  it('records the device kind for a six-digit pairing', async () => {
    const h = makeHarness();
    await h.pairClient('phone');
    expect(h.db.prepare('SELECT name, kind FROM clients').all()).toEqual([{ name: 'phone', kind: 'device' }]);
  });
});

describe('body limit', () => {
  it('answers 413 to an oversize body on actions and card acceptance', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const body = JSON.stringify({ x: 'x'.repeat(26_000_000) });
    for (const path of ['actions/brain.search', 'cards/1/accept']) {
      const res = await h.app.request(`/lun/v1/${path}`, { method: 'POST', headers: h.auth(token), body });
      expect(res.status).toBe(413);
    }
  });
});

describe('answers to questions', () => {
  it('accepts an answer through the contract', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const t = listTypes(h.db)[0]!.id;
    const mk = (title: string) => createFiche(h.db, { typeId: t, title, synthesis: '' }, 't0');
    const f = mk('Lulu');
    const old = addFact(h.db, f, 'vieux fait', { kind: 'note', at: 't0' }, 't0');
    const neu = addFact(h.db, f, 'neuf fait', { kind: 'note', at: 't0' }, 't0');
    const q = addDraft(
      h.db,
      { kind: 'contradiction', ficheId: f, keep: neu, strike: old, reason: 'r' },
      { source: 'core' },
      't1',
    );
    const dup = addDraft(
      h.db,
      { kind: 'doublon', keep: mk('Dora'), merge: mk('Dorah'), reason: 'r' },
      { source: 'core' },
      't1',
    );
    const post = (id: number, answer: string) =>
      h.app.request(`/lun/v1/cards/${id}/accept`, {
        method: 'POST',
        headers: h.auth(token),
        body: JSON.stringify({ input: { answer } }),
      });
    const ok = await post(q, 'vieux fait');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { card: { status: string } }).card.status).toBe('done');
    const bad = await post(dup, 'Autre');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Choisis l’une des deux fiches.' });
  });
});

describe('one card, and the signal when it leaves the queue', () => {
  const setup = async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const t = listTypes(h.db)[0]!.id;
    const draft = () =>
      addDraft(
        h.db,
        { kind: 'fiche', typeId: t, title: 'Exemple', synthesis: '', facts: [], links: [] },
        { source: 'core' },
        't0',
      );
    const call = (path: string, body?: unknown) =>
      h.app.request(`/lun/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: h.auth(token),
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    return { h, token, draft, call, signals: () => eventsSince(h.db) };
  };

  it('reads a card whatever its status, 404 when unknown, 401 without a token', async () => {
    const { h, draft, call } = await setup();
    const [a, b, c] = [draft(), draft(), draft()];
    await call(`cards/${b}/accept`, {});
    await call(`cards/${c}/refuse`, {});
    const status = async (id: number) =>
      ((await (await call(`cards/${id}`)).json()) as { card: { id: string; status: string } }).card.status;
    expect([await status(a), await status(b), await status(c)]).toEqual(['pending', 'done', 'refused']);
    expect(((await (await call(`cards/${a}`)).json()) as { card: { id: string } }).card.id).toBe(String(a));
    expect((await call('cards/999')).status).toBe(404);
    expect((await h.app.request(`/lun/v1/cards/${a}`)).status).toBe(401);
  });

  it('emits one log event per card accepted or refused, without the decision', async () => {
    const { draft, call, signals } = await setup();
    const [a, b] = [draft(), draft()];
    expect(signals()).toEqual([]);
    await call(`cards/${a}/accept`, {});
    await call(`cards/${b}/refuse`, {});
    const events = signals();
    expect(events.map((e) => [e.type, e.importance])).toEqual([
      ['card.changed', 'log'],
      ['card.changed', 'log'],
    ]);
    expect(events.map((e) => e.data)).toEqual([{ id: String(a) }, { id: String(b) }]);
    expect(JSON.stringify(events)).not.toMatch(/done|refused/);
  });

  it('emits one event when a refusal is taken back, none for a failed gesture', async () => {
    const { h, token, draft, call, signals } = await setup();
    const a = draft();
    await call(`cards/${a}/refuse`, {});
    const restored = await h.app.request(`/api/drafts/${a}/restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(restored.status).toBe(200);
    expect(signals()).toHaveLength(2);
    const before = signals().length;
    expect((await call(`cards/${a}/refuse`, {})).status).toBe(200);
    expect((await call(`cards/${a}/accept`, {})).status).toBe(409);
    expect((await call(`cards/999/refuse`, {})).status).toBe(404);
    expect(signals()).toHaveLength(before + 1);
  });

  it('answers 400, with no signal, to values in a gesture body', async () => {
    const { draft, call, signals } = await setup();
    const a = draft();
    expect((await call(`cards/${a}/accept`, { values: { x: ['y'] } })).status).toBe(400);
    expect((await call(`cards/${a}/refuse`, { values: {} })).status).toBe(400);
    expect(signals()).toEqual([]);
  });
});

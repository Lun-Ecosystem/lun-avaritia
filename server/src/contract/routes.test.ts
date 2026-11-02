import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { issuePairingCode } from './auth.ts';
import { addDraft } from '../brain/drafts.ts';
import { addFact, createFiche, listTypes } from '../brain/store.ts';

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

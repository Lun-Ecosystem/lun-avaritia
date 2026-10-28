import { describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import { makeHarness } from '../testing/harness.ts';
import { addDraft, applyDraft, cardOf, getDraft, refuseDraft } from './drafts.ts';
import { digestAction } from './digest.ts';
import { listTypes } from './store.ts';

const src = { kind: 'note', at: '2026-10-28T10:00:00Z' } as const;

describe('day.digest', () => {
  it('lists what arrived, what was decided in the range, and what waits', () => {
    const db = openDb(':memory:');
    const typeId = listTypes(db)[0]!.id;
    db.prepare("INSERT INTO lots (status, created_at) VALUES ('done', ?)").run('2026-10-28T08:00:00.000Z');
    db.prepare("INSERT INTO lots (status, created_at) VALUES ('done', ?)").run('2026-10-29T00:00:00.000Z');
    db.prepare("INSERT INTO observations (lot, text, source) VALUES (1, 'x', '{}')").run();
    const dep = db.prepare('INSERT INTO depots (name, type, bytes, created_at) VALUES (?, ?, ?, ?)');
    dep.run('note', 'text/plain', Buffer.from('a'), '2026-10-28T09:00:00.000Z');
    dep.run('plan.md', 'text/markdown', Buffer.from('b'), '2026-10-28T11:00:00.000Z');
    const draft = (title: string) =>
      addDraft(
        db,
        { kind: 'fiche', typeId, title, synthesis: 's', facts: [{ text: 't', source: src }], links: [] },
        { source: 'core' },
        't',
      );
    const a = draft('Alice');
    const b = draft('Bob');
    draft('Carl');
    applyDraft(db, a, undefined, '2026-10-28T12:00:00.000Z');
    refuseDraft(db, b, '2026-10-28T13:00:00.000Z');
    const d = digestAction({ since: '2026-10-28T00:00:00Z', until: '2026-10-29T00:00:00Z' }, db);
    expect(d.received.map((i) => [i.type, i.title])).toEqual([
      ['lot', 'Lot de 1 observation(s)'],
      ['note', 'Note'],
      ['depot', 'plan.md'],
    ]);
    expect(d.done.map((i) => [i.type, i.title])).toEqual([
      ['draft.applied', cardOf(db, getDraft(db, a)!).title],
      ['draft.refused', cardOf(db, getDraft(db, b)!).title],
    ]);
    expect(d.pending).toBe(1);
  });

  it('is a registered read action', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/day.digest', {
      method: 'POST',
      headers: h.auth(token),
      body: JSON.stringify({ since: '2026-10-28T00:00:00Z', until: '2026-10-29T00:00:00Z' }),
    });
    expect(((await res.json()) as { result: { pending: number } }).result.pending).toBe(0);
    const list = (await (await h.app.request('/lun/v1/actions', { headers: h.auth(token) })).json()) as {
      actions: { name: string; effect: string }[];
    };
    expect(list.actions.find((a) => a.name === 'day.digest')?.effect).toBe('read');
  });
});

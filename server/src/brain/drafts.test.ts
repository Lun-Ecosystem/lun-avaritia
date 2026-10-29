import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, putSetting } from '../db.ts';
import { InvalidInputError } from '../contract/actions.ts';
import { makeHarness } from '../testing/harness.ts';
import { addFact, createFiche, editFiche, getFiche, link, listTypes, searchFiches } from './store.ts';
import { addDraft, applyDraft, cardOf, ConflictError, getDraft, queue, refuseDraft } from './drafts.ts';

const src = { kind: 'note', at: '2026-10-28T10:00:00Z' } as const;
const origin = { source: 'core' } as const;
let db: DatabaseSync;
let typeId: number;
beforeEach(() => {
  db = openDb(':memory:');
  typeId = listTypes(db)[0]!.id;
});
const fiche = (title: string) => createFiche(db, { typeId, title, synthesis: 'base' }, 't0');
const draft = (over: Record<string, unknown> = {}) =>
  addDraft(
    db,
    {
      kind: 'fiche',
      typeId,
      title: 'Alice',
      synthesis: 'neuve',
      facts: [{ text: 'a un chat', source: src }],
      links: [],
      ...over,
    } as never,
    origin,
    't1',
  );

describe('drafts', () => {
  it('creates a fiche and its facts', () => {
    const d = applyDraft(db, draft(), undefined, 't2');
    expect(d.status).toBe('done');
    const f = getFiche(db, 1)!;
    expect(f.title).toBe('Alice');
    expect(f.facts.map((x) => x.text)).toEqual(['a un chat']);
  });

  it('enriches without touching a synthesis the user edited since', () => {
    const f = fiche('Bob');
    const id = draft({ ficheId: f, title: 'Bob', synthesis: 'agent' });
    editFiche(db, f, { synthesis: 'humaine' }, 't1b');
    const d = applyDraft(db, id, undefined, 't2');
    expect(d.skippedSynthesis).toBe(true);
    expect(getFiche(db, f)!.synthesis).toBe('humaine');
    expect(getFiche(db, f)!.facts).toHaveLength(1);
    expect(cardOf(db, d).lines.join('\n')).toMatch(/synthèse/i);
  });

  it('applies the synthesis when the fiche is untouched', () => {
    const f = fiche('Bob');
    applyDraft(db, draft({ ficheId: f, synthesis: 'agent' }), undefined, 't2');
    expect(getFiche(db, f)!.synthesis).toBe('agent');
  });

  it('refuses a replacement of a fact that is not active on the fiche, and stays pending', () => {
    const f = fiche('Bob');
    const g = fiche('Carl');
    const foreign = addFact(db, g, 'ailleurs', src, 't0');
    const id = draft({ ficheId: f, title: 'Bob', facts: [{ text: 'neuf', source: src, replaces: foreign }] });
    expect(() => applyDraft(db, id, undefined, 't2')).toThrow(InvalidInputError);
    expect(getDraft(db, id)!.status).toBe('pending');
    expect(getFiche(db, f)!.facts).toHaveLength(0);
  });

  it('strikes the losing fact on an accepted contradiction', () => {
    const f = fiche('C');
    const a = addFact(db, f, 'vieux', src, 't0');
    const b = addFact(db, f, 'neuf', src, 't0');
    const id = addDraft(
      db,
      { kind: 'contradiction', ficheId: f, keep: b, strike: a, reason: 'r' },
      origin,
      't1',
    );
    applyDraft(db, id, undefined, 't2');
    expect(getFiche(db, f)!.facts[0]).toMatchObject({ struckAt: 't2', struckBy: b });
  });

  it('refuses a contradiction that is self-referent, already struck or whose keep is struck', () => {
    const f = fiche('C');
    const a = addFact(db, f, 'vieux', src, 't0');
    const b = addFact(db, f, 'neuf', src, 't0');
    const c = addFact(db, f, 'autre', src, 't0');
    const add = (keep: number, strike: number) =>
      addDraft(db, { kind: 'contradiction', ficheId: f, keep, strike, reason: 'r' }, origin, 't1');
    const same = add(b, b);
    expect(() => applyDraft(db, same, undefined, 't2')).toThrow(InvalidInputError);
    expect(getDraft(db, same)!.status).toBe('pending');
    applyDraft(db, add(b, a), undefined, 't2');
    const again = add(c, a);
    expect(() => applyDraft(db, again, undefined, 't3')).toThrow(InvalidInputError);
    const dead = add(a, c);
    expect(() => applyDraft(db, dead, undefined, 't3')).toThrow(InvalidInputError);
    expect(getDraft(db, dead)!.status).toBe('pending');
    expect(getFiche(db, f)!.facts.find((x) => x.id === c)!.struckAt).toBeUndefined();
  });

  it('merges a duplicate into the kept fiche', () => {
    const keep = fiche('Keep');
    const gone = fiche('Gone');
    const other = fiche('Other');
    addFact(db, gone, 'un fait', src, 't0');
    link(db, gone, other, 'connaît');
    link(db, other, gone, 'cite');
    link(db, keep, gone, 'même que');
    const id = addDraft(db, { kind: 'doublon', keep, merge: gone, reason: 'r' }, origin, 't1');
    applyDraft(db, id, undefined, 't2');
    const k = getFiche(db, keep)!;
    expect(k.facts.map((x) => x.text)).toEqual(['un fait']);
    expect(k.links).toEqual(
      expect.arrayContaining([
        { from: keep, to: other, relation: 'connaît' },
        { from: other, to: keep, relation: 'cite' },
      ]),
    );
    expect(k.links).toHaveLength(2);
    const g = getFiche(db, gone)!;
    expect(g.mergedInto).toBe(keep);
    expect(g.facts).toHaveLength(0);
    expect(searchFiches(db, 'Gone', 5)).toEqual([]);
  });

  it('refuses a card already treated', () => {
    const id = draft();
    applyDraft(db, id, undefined, 't2');
    expect(() => applyDraft(db, id, undefined, 't3')).toThrow(ConflictError);
    const id2 = draft();
    refuseDraft(db, id2, 't2');
    expect(() => refuseDraft(db, id2, 't3')).toThrow(ConflictError);
    expect(() => applyDraft(db, id2, undefined, 't3')).toThrow(ConflictError);
  });

  it('replaces the payload by a valid input, rejects an invalid one and leaves it pending', () => {
    const id = draft();
    expect(() => applyDraft(db, id, { kind: 'fiche', title: 3 }, 't2')).toThrow(InvalidInputError);
    expect(queue(db, 10)).toHaveLength(1);
    applyDraft(db, id, { kind: 'fiche', typeId, title: 'Autre', synthesis: '', facts: [], links: [] }, 't2');
    expect(getFiche(db, 1)!.title).toBe('Autre');
  });

  it('orders the queue contradiction, doublon, rest, and caps it', () => {
    const f = fiche('F');
    const a = addFact(db, f, 'x', src, 't0');
    const b = addFact(db, f, 'y', src, 't0');
    const plain = draft();
    const dup = addDraft(db, { kind: 'doublon', keep: f, merge: fiche('G'), reason: 'r' }, origin, 't1');
    const con = addDraft(
      db,
      { kind: 'contradiction', ficheId: f, keep: a, strike: b, reason: 'r' },
      origin,
      't1',
    );
    expect(queue(db, 10).map((d) => d.id)).toEqual([con, dup, plain]);
    expect(queue(db, 2).map((d) => d.id)).toEqual([con, dup]);
  });

  it('resolves links by title, warns on the unresolved', () => {
    const other = fiche('Carol');
    const d = applyDraft(
      db,
      draft({
        links: [
          { to: 'carol', relation: 'connaît' },
          { to: 'Nobody', relation: 'x' },
          { to: other, relation: 'y' },
        ],
      }),
      undefined,
      't2',
    );
    expect(
      getFiche(db, 2)!
        .links.map((l) => l.relation)
        .sort(),
    ).toEqual(['connaît', 'y']);
    expect(d.warnings).toEqual([expect.stringContaining('Nobody')]);
  });

  it('imports notes, linking by title inside the batch', () => {
    const id = addDraft(
      db,
      {
        kind: 'import',
        fiches: [
          { title: 'A', body: 'corps a', links: ['B', 'Z'], frontmatter: {} },
          { title: 'B', body: 'corps b', links: [], frontmatter: {} },
        ],
        warnings: ['w'],
      },
      { source: 'import', lot: 4 },
      't1',
    );
    const d = applyDraft(db, id, undefined, 't2');
    expect(getFiche(db, 1)!.links).toEqual([{ from: 1, to: 2, relation: 'mentionne' }]);
    expect(d.warnings).toEqual(['w', expect.stringContaining('Z')]);
  });

  it('writes a card for a human', () => {
    const card = cardOf(db, getDraft(db, draft())!);
    expect(card).toMatchObject({ action: 'brain.fiche', effect: 'write', status: 'pending', at: 't1' });
    expect(card.lines.join('\n')).toContain('a un chat');
  });
});

describe('due dates', () => {
  const dated = { text: 'rappeler Paul', source: src, due: '2026-11-05' };

  it('a fiche draft with a due date writes it on the fact', () => {
    applyDraft(db, draft({ facts: [dated] }), undefined, 't2');
    expect(getFiche(db, 1)!.facts[0]!.due).toBe('2026-11-05');
  });

  it('the card shows the due date', () => {
    const d = getDraft(db, draft({ facts: [dated] }))!;
    expect(cardOf(db, d).lines).toContain('Échéance : jeudi 5 novembre 2026');
  });

  it('an impossible due date is refused', () => {
    expect(() => draft({ facts: [{ ...dated, due: '2026-02-30' }] })).toThrow(InvalidInputError);
  });
});

describe('drafts review fixes', () => {
  it('applies a second enrichment synthesis after the first was accepted', () => {
    const f = fiche('Bob');
    const a = draft({ ficheId: f, synthesis: 'A' });
    const b = draft({ ficheId: f, synthesis: 'B' });
    applyDraft(db, a, undefined, 't2');
    const d = applyDraft(db, b, undefined, 't3');
    expect(d.skippedSynthesis).toBe(false);
    expect(getFiche(db, f)!.synthesis).toBe('B');
  });

  it('rolls back a failing apply, stays pending, then accepts a corrected input', () => {
    const id = draft({ ficheId: 999 });
    expect(() => applyDraft(db, id, undefined, 't2')).toThrow(InvalidInputError);
    expect(getDraft(db, id)!.status).toBe('pending');
    const ok = applyDraft(
      db,
      id,
      { kind: 'fiche', typeId, title: 'Bon', synthesis: '', facts: [], links: [] },
      't3',
    );
    expect(ok.status).toBe('done');
    const id2 = draft({ ficheId: 999 });
    expect(() => applyDraft(db, id2, undefined, 't2')).toThrow(InvalidInputError);
    expect(refuseDraft(db, id2, 't3').status).toBe('refused');
  });

  it('writes human lines for a contradiction, a doublon and a numeric link', () => {
    const f = fiche('Dora');
    const g = fiche('Dorah');
    const a = addFact(db, f, 'vieux fait', src, 't0');
    const b = addFact(db, f, 'neuf fait', src, 't0');
    const c = cardOf(
      db,
      getDraft(
        db,
        addDraft(db, { kind: 'contradiction', ficheId: f, keep: b, strike: a, reason: 'r' }, origin, 't1'),
      )!,
    );
    expect(c.title).toContain('Dora');
    expect(c.lines).toEqual(expect.arrayContaining(['Garder : neuf fait', 'Barrer : vieux fait']));
    const dup = cardOf(
      db,
      getDraft(db, addDraft(db, { kind: 'doublon', keep: f, merge: g, reason: 'r' }, origin, 't1'))!,
    );
    expect(dup.lines.join('\n')).toContain('Dorah');
    const lk = cardOf(db, getDraft(db, draft({ links: [{ to: g, relation: 'x' }] }))!);
    expect(lk.lines).toContain('Lien : x → Dorah');
  });

  it('rejects a merge of an already merged fiche, leaving the draft pending', () => {
    const k = fiche('K');
    const m = fiche('M');
    const n = fiche('N');
    const first = addDraft(db, { kind: 'doublon', keep: k, merge: m, reason: 'r' }, origin, 't1');
    applyDraft(db, first, undefined, 't2');
    const id = addDraft(db, { kind: 'doublon', keep: n, merge: m, reason: 'r' }, origin, 't1');
    expect(() => applyDraft(db, id, undefined, 't3')).toThrow(InvalidInputError);
    expect(getDraft(db, id)!.status).toBe('pending');
  });
});

describe('cards routes', () => {
  it('lists the queue, answers 400 on an invalid input, 409 on a settled card, 404 on an unknown one', async () => {
    const h = makeHarness();
    const token = await h.pairClient();
    const t = listTypes(h.db)[0]!.id;
    putSetting(h.db, 'drafts.cap', 1);
    const mk = () =>
      addDraft(
        h.db,
        { kind: 'fiche', typeId: t, title: 'T', synthesis: '', facts: [], links: [] },
        origin,
        't1',
      );
    const id = mk();
    mk();
    const get = await h.app.request('/lun/v1/cards', { headers: h.auth(token) });
    const body = (await get.json()) as { cards: { id: string; action: string; status: string }[] };
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ id: String(id), action: 'brain.fiche', status: 'pending' });
    const post = (path: string, b?: unknown) =>
      h.app.request(`/lun/v1/cards/${id}/${path}`, {
        method: 'POST',
        headers: h.auth(token),
        body: JSON.stringify(b ?? {}),
      });
    expect((await post('accept', { input: { kind: 'fiche' } })).status).toBe(400);
    const ok = await post('accept');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { card: { status: string } }).card.status).toBe('done');
    expect((await post('refuse')).status).toBe(409);
    const missing = await h.app.request('/lun/v1/cards/999/refuse', {
      method: 'POST',
      headers: h.auth(token),
    });
    expect(missing.status).toBe(404);
    const done = await h.app.request('/lun/v1/cards?status=done', { headers: h.auth(token) });
    expect(((await done.json()) as { cards: unknown[] }).cards).toHaveLength(1);
  });
});

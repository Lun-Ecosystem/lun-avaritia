import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, putSetting } from '../db.ts';
import { InvalidInputError } from '../contract/actions.ts';
import { makeHarness } from '../testing/harness.ts';
import { addFact, createFiche, editFiche, getFiche, link, listTypes, searchFiches } from './store.ts';
import {
  addDraft,
  applyDraft,
  cardOf,
  ConflictError,
  getDraft,
  NotFoundError,
  queue,
  refuseDraft,
  restoreDraft,
} from './drafts.ts';
import { digestAction } from './digest.ts';

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
    const d = applyDraft(db, draft(), undefined, '2026-11-02T08:00:02.000Z');
    expect(d.status).toBe('done');
    const f = getFiche(db, 1)!;
    expect(f.title).toBe('Alice');
    expect(f.facts.map((x) => x.text)).toEqual(['a un chat']);
  });

  it('enriches without touching a synthesis the user edited since', () => {
    const f = fiche('Bob');
    const id = draft({ ficheId: f, title: 'Bob', synthesis: 'agent' });
    editFiche(db, f, { synthesis: 'humaine' }, 't1b');
    const d = applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z');
    expect(d.skippedSynthesis).toBe(true);
    expect(getFiche(db, f)!.synthesis).toBe('humaine');
    expect(getFiche(db, f)!.facts).toHaveLength(1);
    expect(cardOf(db, d).lines.join('\n')).toMatch(/synthèse/i);
  });

  it('applies the synthesis when the fiche is untouched', () => {
    const f = fiche('Bob');
    applyDraft(db, draft({ ficheId: f, synthesis: 'agent' }), undefined, '2026-11-02T08:00:02.000Z');
    expect(getFiche(db, f)!.synthesis).toBe('agent');
  });

  it('refuses a replacement of a fact that is not active on the fiche, and stays pending', () => {
    const f = fiche('Bob');
    const g = fiche('Carl');
    const foreign = addFact(db, g, 'ailleurs', src, 't0');
    const id = draft({ ficheId: f, title: 'Bob', facts: [{ text: 'neuf', source: src, replaces: foreign }] });
    expect(() => applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z')).toThrow(InvalidInputError);
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
    applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z');
    expect(getFiche(db, f)!.facts[0]).toMatchObject({ struckAt: '2026-11-02T08:00:02.000Z', struckBy: b });
  });

  it('refuses a contradiction that is self-referent, already struck or whose keep is struck', () => {
    const f = fiche('C');
    const a = addFact(db, f, 'vieux', src, 't0');
    const b = addFact(db, f, 'neuf', src, 't0');
    const c = addFact(db, f, 'autre', src, 't0');
    const add = (keep: number, strike: number) =>
      addDraft(db, { kind: 'contradiction', ficheId: f, keep, strike, reason: 'r' }, origin, 't1');
    const same = add(b, b);
    expect(() => applyDraft(db, same, undefined, '2026-11-02T08:00:02.000Z')).toThrow(InvalidInputError);
    expect(getDraft(db, same)!.status).toBe('pending');
    applyDraft(db, add(b, a), undefined, '2026-11-02T08:00:02.000Z');
    const again = add(c, a);
    expect(() => applyDraft(db, again, undefined, '2026-11-02T08:00:03.000Z')).toThrow(InvalidInputError);
    const dead = add(a, c);
    expect(() => applyDraft(db, dead, undefined, '2026-11-02T08:00:03.000Z')).toThrow(InvalidInputError);
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
    applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z');
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
    applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z');
    expect(() => applyDraft(db, id, undefined, '2026-11-02T08:00:03.000Z')).toThrow(ConflictError);
    const id2 = draft();
    refuseDraft(db, id2, '2026-11-02T08:00:02.000Z');
    expect(() => refuseDraft(db, id2, '2026-11-02T08:00:03.000Z')).toThrow(ConflictError);
    expect(() => applyDraft(db, id2, undefined, '2026-11-02T08:00:03.000Z')).toThrow(ConflictError);
  });

  it('replaces the payload by a valid input, rejects an invalid one and leaves it pending', () => {
    const id = draft();
    expect(() => applyDraft(db, id, { kind: 'fiche', title: 3 }, '2026-11-02T08:00:02.000Z')).toThrow(
      InvalidInputError,
    );
    expect(queue(db, 10)).toHaveLength(1);
    applyDraft(
      db,
      id,
      { kind: 'fiche', typeId, title: 'Autre', synthesis: '', facts: [], links: [] },
      '2026-11-02T08:00:02.000Z',
    );
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
      '2026-11-02T08:00:02.000Z',
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
    const d = applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z');
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
    applyDraft(db, draft({ facts: [dated] }), undefined, '2026-11-02T08:00:02.000Z');
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
    applyDraft(db, a, undefined, '2026-11-02T08:00:02.000Z');
    const d = applyDraft(db, b, undefined, '2026-11-02T08:00:03.000Z');
    expect(d.skippedSynthesis).toBe(false);
    expect(getFiche(db, f)!.synthesis).toBe('B');
  });

  it('rolls back a failing apply, stays pending, then accepts a corrected input', () => {
    const id = draft({ ficheId: 999 });
    expect(() => applyDraft(db, id, undefined, '2026-11-02T08:00:02.000Z')).toThrow(InvalidInputError);
    expect(getDraft(db, id)!.status).toBe('pending');
    const ok = applyDraft(
      db,
      id,
      { kind: 'fiche', typeId, title: 'Bon', synthesis: '', facts: [], links: [] },
      '2026-11-02T08:00:03.000Z',
    );
    expect(ok.status).toBe('done');
    const id2 = draft({ ficheId: 999 });
    expect(() => applyDraft(db, id2, undefined, '2026-11-02T08:00:02.000Z')).toThrow(InvalidInputError);
    expect(refuseDraft(db, id2, '2026-11-02T08:00:03.000Z').status).toBe('refused');
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
    applyDraft(db, first, undefined, '2026-11-02T08:00:02.000Z');
    const id = addDraft(db, { kind: 'doublon', keep: n, merge: m, reason: 'r' }, origin, 't1');
    expect(() => applyDraft(db, id, undefined, '2026-11-02T08:00:03.000Z')).toThrow(InvalidInputError);
    expect(getDraft(db, id)!.status).toBe('pending');
  });
});

describe('card links', () => {
  const cardFor = (payload: Record<string, unknown>) =>
    cardOf(db, getDraft(db, addDraft(db, payload as never, origin, 't1'))!);

  it('an enrichment card links to its fiche', () => {
    const f = fiche('Eve');
    expect(cardOf(db, getDraft(db, draft({ ficheId: f }))!).link).toBe(`/memoire?fiche=${f}`);
  });

  it('a new fiche card links to its draft in the validation screen', () => {
    const id = draft();
    expect(cardOf(db, getDraft(db, id)!).link).toBe(`/valider?brouillon=${id}`);
  });

  it('contradiction and doublon cards link to the fiche they keep, an import to its draft', () => {
    const f = fiche('Fay');
    const g = fiche('Fayy');
    const a = addFact(db, f, 'vieux', src, 't0');
    const b = addFact(db, f, 'neuf', src, 't0');
    expect(cardFor({ kind: 'contradiction', ficheId: f, keep: b, strike: a, reason: 'r' }).link).toBe(
      `/memoire?fiche=${f}`,
    );
    expect(cardFor({ kind: 'doublon', keep: f, merge: g, reason: 'r' }).link).toBe(`/memoire?fiche=${f}`);
    const imp = addDraft(db, { kind: 'import', fiches: [], warnings: [] }, origin, 't1');
    expect(cardOf(db, getDraft(db, imp)!).link).toBe(`/valider?brouillon=${imp}`);
  });
});

describe('restoreDraft', () => {
  const T0 = '2026-11-24T10:00:00.000Z';
  const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

  it('puts a fresh refusal back to pending, without decidedAt, at its place in the queue', () => {
    const a = draft({ title: 'A' });
    const b = draft({ title: 'B' });
    const c = draft({ title: 'C' });
    refuseDraft(db, b, T0);
    expect(queue(db, 10).map((d) => d.id)).toEqual([a, c]);
    const back = restoreDraft(db, b, at(10_000));
    expect(back.status).toBe('pending');
    expect(back.decidedAt).toBeUndefined();
    expect(queue(db, 10).map((d) => d.id)).toEqual([a, b, c]);
  });

  it('is too late at 30 s: ConflictError, the draft stays refused', () => {
    const id = draft();
    refuseDraft(db, id, T0);
    expect(() => restoreDraft(db, id, at(30_000))).toThrow(ConflictError);
    expect(getDraft(db, id)!.status).toBe('refused');
    expect(() => restoreDraft(db, id, at(120_000))).toThrow(ConflictError);
  });

  it('is still possible just before 30 s', () => {
    const id = draft();
    refuseDraft(db, id, T0);
    expect(restoreDraft(db, id, at(29_999)).status).toBe('pending');
  });

  it('refuses a draft that is pending or done, and an unknown one', () => {
    const p = draft();
    expect(() => restoreDraft(db, p, T0)).toThrow(ConflictError);
    const d = draft();
    applyDraft(db, d, undefined, T0);
    expect(() => restoreDraft(db, d, at(1000))).toThrow(ConflictError);
    expect(getDraft(db, d)!.status).toBe('done');
    expect(() => restoreDraft(db, 999, T0)).toThrow(NotFoundError);
  });

  it('refuses a draft being applied', () => {
    const id = draft();
    db.prepare("UPDATE drafts SET status = 'applying' WHERE id = ?").run(id);
    expect(() => restoreDraft(db, id, T0)).toThrow(ConflictError);
  });

  it('the day digest no longer cites a refusal that was undone', () => {
    const id = draft();
    refuseDraft(db, id, T0);
    const range = { since: '2026-11-24T00:00:00Z', until: '2026-11-25T00:00:00Z' };
    expect(digestAction(range, db).done.map((x) => x.type)).toEqual(['draft.refused']);
    restoreDraft(db, id, at(5000));
    expect(digestAction(range, db).done).toEqual([]);
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

describe('questions and answers (v1.4)', () => {
  const seedContradiction = () => {
    const f = fiche('Lulu');
    const old = addFact(db, f, 'vieux fait', src, 't0');
    const neu = addFact(db, f, 'neuf fait', src, 't0');
    const id = addDraft(
      db,
      { kind: 'contradiction', ficheId: f, keep: neu, strike: old, reason: 'Deux dates citées.' },
      origin,
      't1',
    );
    return { f, old, neu, id };
  };
  const seedDoublon = () => {
    const a = fiche('Dora');
    const b = fiche('Dorah');
    return {
      a,
      b,
      id: addDraft(db, { kind: 'doublon', keep: a, merge: b, reason: 'Même nom.' }, origin, 't1'),
    };
  };

  it('gives kind, reason and options to its questions, kind alone to a fiche', () => {
    const c = cardOf(db, getDraft(db, seedContradiction().id)!);
    expect(c).toMatchObject({
      kind: 'Question',
      reason: 'Deux dates citées.',
      options: ['neuf fait', 'vieux fait'],
    });
    expect(c.lines.some((l) => l.startsWith('Raison'))).toBe(false);
    const d = cardOf(db, getDraft(db, seedDoublon().id)!);
    expect(d).toMatchObject({ kind: 'Question', options: ['Dora', 'Dorah'] });
    const n = cardOf(db, getDraft(db, draft())!);
    expect(n.kind).toBe('Nouvelle fiche');
    expect(n).not.toHaveProperty('reason');
    expect(n).not.toHaveProperty('options');
    expect(cardOf(db, getDraft(db, draft({ ficheId: fiche('Bob') }))!).kind).toBe('Fiche enrichie');
    expect(
      cardOf(db, getDraft(db, addDraft(db, { kind: 'import', fiches: [], warnings: [] }, origin, 't1'))!)
        .kind,
    ).toBe('Import');
  });

  it('an answer naming the proposed loser swaps the contradiction', () => {
    const { f, old, neu, id } = seedContradiction();
    applyDraft(db, id, { answer: 'vieux fait' }, '2026-11-02T08:00:02.000Z');
    const facts = getFiche(db, f)!.facts;
    expect(facts.find((x) => x.id === neu)!.struckBy).toBe(old);
  });

  it('an answer naming the proposed winner keeps the proposal', () => {
    const { f, old, neu, id } = seedContradiction();
    applyDraft(db, id, { answer: 'neuf fait' }, '2026-11-02T08:00:02.000Z');
    expect(getFiche(db, f)!.facts.find((x) => x.id === old)!.struckBy).toBe(neu);
  });

  it('a free answer replaces both facts with the answer', () => {
    const { f, old, neu, id } = seedContradiction();
    applyDraft(db, id, { answer: 'Chez Lulu' }, '2026-11-02T08:00:02.000Z');
    const facts = getFiche(db, f)!.facts;
    const added = facts.find((x) => x.text === 'Chez Lulu')!;
    expect(added.struckBy).toBeUndefined();
    expect(facts.find((x) => x.id === old)!.struckBy).toBe(added.id);
    expect(facts.find((x) => x.id === neu)!.struckBy).toBe(added.id);
  });

  it('an answer naming the other fiche merges the doublon the other way', () => {
    const { a, b, id } = seedDoublon();
    applyDraft(db, id, { answer: 'Dorah' }, '2026-11-02T08:00:02.000Z');
    expect(getFiche(db, a)!.mergedInto).toBe(b);
  });

  it('refuses a free answer to a doublon and any answer to a fiche, writing nothing', () => {
    const { id: dup } = seedDoublon();
    expect(() => applyDraft(db, dup, { answer: 'Autre' }, '2026-11-02T08:00:02.000Z')).toThrow(
      'Choisis l’une des deux fiches.',
    );
    expect(getDraft(db, dup)!.status).toBe('pending');
    const fd = draft();
    expect(() => applyDraft(db, fd, { answer: 'x' }, '2026-11-02T08:00:02.000Z')).toThrow(
      'Cette carte n’attend pas de réponse.',
    );
    expect(getDraft(db, fd)!.status).toBe('pending');
  });
});

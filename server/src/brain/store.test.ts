import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.ts';
import { InvalidInputError } from '../contract/actions.ts';
import {
  addFact,
  addType,
  createFiche,
  editFiche,
  getFiche,
  link,
  listTypes,
  neighbors,
  removeType,
  renameType,
  searchFiches,
  strikeFact,
  versions,
} from './store.ts';

const src = { kind: 'note', at: '2026-10-28T10:00:00Z' } as const;
let db: DatabaseSync;
let personne: number;
beforeEach(() => {
  db = openDb(':memory:');
  personne = listTypes(db).find((t) => t.name === 'Personne')!.id;
});
const fiche = (title: string, synthesis = '') =>
  createFiche(db, { typeId: personne, title, synthesis }, 't0');

describe('store', () => {
  it('seeds the initial types', () => {
    expect(listTypes(db).map((t) => t.name)).toEqual([
      'Personne',
      'Organisation',
      'Projet',
      'Service',
      'Échange',
      'Note',
    ]);
  });

  it('keeps a struck fact, dated', () => {
    const f = fiche('Alice Example');
    const a = addFact(db, f, 'travaille chez Example', src, 't1');
    const b = addFact(db, f, 'travaille chez Autre', src, 't2');
    strikeFact(db, a, b, 't3');
    const facts = getFiche(db, f)!.facts;
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({ id: a, struckAt: 't3', struckBy: b });
    expect(facts[1]!.struckAt).toBeUndefined();
  });

  it('writes a version per edit', () => {
    const f = fiche('Alice', 'v0');
    editFiche(db, f, { synthesis: 'v1' }, 't1');
    editFiche(db, f, { title: 'Alice E.' }, 't2');
    expect(versions(db, f)).toHaveLength(2);
    expect(getFiche(db, f)).toMatchObject({ title: 'Alice E.', synthesis: 'v1', updatedAt: 't2' });
  });

  it('searches active facts only', () => {
    const f = fiche('Alice');
    const a = addFact(db, f, 'préfère la visio', src, 't1');
    expect(searchFiches(db, 'visio', 5).map((r) => r.id)).toEqual([f]);
    const b = addFact(db, f, 'préfère le téléphone', src, 't2');
    strikeFact(db, a, b, 't3');
    expect(searchFiches(db, 'visio', 5)).toEqual([]);
    expect(searchFiches(db, 'téléphone "', 5)[0]).toMatchObject({ id: f, type: 'Personne' });
  });

  it('refuses removing a used type, allows an unused one', () => {
    fiche('Alice');
    expect(() => removeType(db, personne)).toThrow(InvalidInputError);
    const id = addType(db, 'Lieu');
    renameType(db, id, 'Endroit');
    removeType(db, id);
    expect(listTypes(db).some((t) => t.name === 'Endroit')).toBe(false);
  });

  it('refuses a link to a missing fiche and lists neighbors', () => {
    const a = fiche('Alice');
    const b = fiche('Bob');
    expect(() => link(db, a, 999, 'connaît')).toThrow(InvalidInputError);
    link(db, a, b, 'connaît');
    expect(neighbors(db, a)).toEqual([{ id: b, title: 'Bob', relation: 'connaît', direction: 'out' }]);
    expect(neighbors(db, b)[0]).toMatchObject({ id: a, direction: 'in' });
    expect(getFiche(db, a)!.links).toEqual([{ from: a, to: b, relation: 'connaît' }]);
  });
});

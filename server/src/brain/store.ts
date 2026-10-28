import type { DatabaseSync } from 'node:sqlite';
import { InvalidInputError } from '../contract/actions.ts';
import type { Fact, Fiche, FicheType, Link, Source } from '../types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped SQLite rows, mapped to typed values below
type Row = Record<string, any>;

// The FTS index is kept in step here, not by triggers: every write that changes
// a fiche's title, synthesis or active facts calls reindex().
export function reindex(db: DatabaseSync, id: number): void {
  const f = db.prepare('SELECT title, synthesis, merged_into FROM fiches WHERE id = ?').get(id) as
    Row | undefined;
  db.prepare('DELETE FROM fiche_search WHERE rowid = ?').run(id);
  if (!f || f.merged_into !== null) return; // a merged fiche leaves the search
  const facts = (
    db.prepare('SELECT text FROM facts WHERE fiche_id = ? AND struck_at IS NULL').all(id) as Row[]
  )
    .map((r) => r.text)
    .join('\n');
  db.prepare('INSERT INTO fiche_search (rowid, title, synthesis, facts) VALUES (?, ?, ?, ?)').run(
    id,
    f.title,
    f.synthesis,
    facts,
  );
}

const exists = (db: DatabaseSync, id: number) => !!db.prepare('SELECT 1 FROM fiches WHERE id = ?').get(id);

export function createFiche(
  db: DatabaseSync,
  f: { typeId: number; title: string; synthesis: string },
  now: string,
): number {
  if (!f.title.trim()) throw new InvalidInputError('Titre vide.');
  if (!db.prepare('SELECT 1 FROM fiche_types WHERE id = ?').get(f.typeId))
    throw new InvalidInputError('Type inconnu.');
  const id = Number(
    db
      .prepare(
        'INSERT INTO fiches (type_id, title, synthesis, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(f.typeId, f.title, f.synthesis, now, now).lastInsertRowid,
  );
  reindex(db, id);
  return id;
}

export function getFiche(db: DatabaseSync, id: number): Fiche | undefined {
  const r = db.prepare('SELECT * FROM fiches WHERE id = ?').get(id) as Row | undefined;
  if (!r) return undefined;
  const facts = (db.prepare('SELECT * FROM facts WHERE fiche_id = ? ORDER BY id').all(id) as Row[]).map(
    (x): Fact => ({
      id: x.id,
      ficheId: x.fiche_id,
      text: x.text,
      source: JSON.parse(x.source) as Source,
      at: x.at,
      ...(x.struck_at !== null && { struckAt: x.struck_at, struckBy: x.struck_by ?? undefined }),
    }),
  );
  const links = (
    db
      .prepare('SELECT from_id, to_id, relation FROM links WHERE from_id = ? OR to_id = ? ORDER BY rowid')
      .all(id, id) as Row[]
  ).map((l): Link => ({ from: l.from_id, to: l.to_id, relation: l.relation }));
  return {
    id,
    typeId: r.type_id,
    title: r.title,
    synthesis: r.synthesis,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    facts,
    links,
    ...(r.merged_into !== null && { mergedInto: r.merged_into as number }),
  };
}

export function addFact(
  db: DatabaseSync,
  ficheId: number,
  text: string,
  source: Source,
  now: string,
): number {
  if (!exists(db, ficheId)) throw new InvalidInputError('Fiche absente.');
  const id = Number(
    db
      .prepare('INSERT INTO facts (fiche_id, text, source, at) VALUES (?, ?, ?, ?)')
      .run(ficheId, text, JSON.stringify(source), now).lastInsertRowid,
  );
  reindex(db, ficheId);
  return id;
}

export function strikeFact(db: DatabaseSync, factId: number, byFactId: number, now: string): void {
  const f = db.prepare('SELECT fiche_id FROM facts WHERE id = ?').get(factId) as Row | undefined;
  if (!f) throw new InvalidInputError('Fait absent.');
  if (!db.prepare('SELECT 1 FROM facts WHERE id = ?').get(byFactId))
    throw new InvalidInputError('Fait démentant absent.');
  db.prepare('UPDATE facts SET struck_at = ?, struck_by = ? WHERE id = ? AND struck_at IS NULL').run(
    now,
    byFactId,
    factId,
  );
  reindex(db, f.fiche_id);
}

export function link(db: DatabaseSync, from: number, to: number, relation: string): void {
  if (!exists(db, from) || !exists(db, to)) throw new InvalidInputError('Fiche absente.');
  if (!relation.trim()) throw new InvalidInputError('Relation vide.');
  db.prepare('INSERT OR IGNORE INTO links (from_id, to_id, relation) VALUES (?, ?, ?)').run(
    from,
    to,
    relation,
  );
}

/** Records the previous state as a version, then applies the patch. */
export function editFiche(
  db: DatabaseSync,
  id: number,
  patch: { title?: string; synthesis?: string },
  now: string,
  by: 'user' | 'agent' = 'user',
): void {
  const f = db.prepare('SELECT title, synthesis FROM fiches WHERE id = ?').get(id) as Row | undefined;
  if (!f) throw new InvalidInputError('Fiche absente.');
  const title = patch.title ?? f.title;
  if (!title.trim()) throw new InvalidInputError('Titre vide.');
  db.prepare('INSERT INTO fiche_versions (fiche_id, at, title, synthesis) VALUES (?, ?, ?, ?)').run(
    id,
    now,
    f.title,
    f.synthesis,
  );
  // user_edited_at moves only on the user's edits: drafts compare against it, not updated_at.
  db.prepare(
    'UPDATE fiches SET title = ?, synthesis = ?, updated_at = ?, user_edited_at = CASE WHEN ? THEN ? ELSE user_edited_at END WHERE id = ?',
  ).run(title, patch.synthesis ?? f.synthesis, now, by === 'user' ? 1 : 0, now, id);
  reindex(db, id);
}

export function versions(db: DatabaseSync, id: number): { at: string; title: string; synthesis: string }[] {
  return db
    .prepare('SELECT at, title, synthesis FROM fiche_versions WHERE fiche_id = ? ORDER BY id')
    .all(id) as unknown as { at: string; title: string; synthesis: string }[];
}

export function searchFiches(
  db: DatabaseSync,
  query: string,
  limit: number,
): { id: number; title: string; type: string; excerpt: string }[] {
  // Each word becomes a quoted prefix term, so user input never reaches the FTS5 syntax.
  const terms = query.match(/[\p{L}\p{N}]+/gu)?.map((t) => `"${t}"*`);
  if (!terms) return [];
  return db
    .prepare(
      `SELECT f.id, f.title, t.name AS type, snippet(fiche_search, -1, '', '', '…', 12) AS excerpt
         FROM fiche_search JOIN fiches f ON f.id = fiche_search.rowid JOIN fiche_types t ON t.id = f.type_id
        WHERE fiche_search MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(terms.join(' '), limit) as unknown as { id: number; title: string; type: string; excerpt: string }[];
}

export function neighbors(
  db: DatabaseSync,
  id: number,
): { id: number; title: string; relation: string; direction: 'out' | 'in' }[] {
  return db
    .prepare(
      `SELECT f.id, f.title, l.relation, 'out' AS direction FROM links l JOIN fiches f ON f.id = l.to_id WHERE l.from_id = ?
       UNION ALL
       SELECT f.id, f.title, l.relation, 'in' AS direction FROM links l JOIN fiches f ON f.id = l.from_id WHERE l.to_id = ?`,
    )
    .all(id, id) as unknown as { id: number; title: string; relation: string; direction: 'out' | 'in' }[];
}

export function listTypes(db: DatabaseSync): FicheType[] {
  return db.prepare('SELECT id, name FROM fiche_types ORDER BY id').all() as unknown as FicheType[];
}

function typeName(name: string): string {
  const n = name.trim();
  if (!n) throw new InvalidInputError('Nom de type vide.');
  return n;
}

function guardUnique<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) throw new InvalidInputError('Ce type existe déjà.');
    throw e;
  }
}

export function addType(db: DatabaseSync, name: string): number {
  return guardUnique(() =>
    Number(db.prepare('INSERT INTO fiche_types (name) VALUES (?)').run(typeName(name)).lastInsertRowid),
  );
}

export function renameType(db: DatabaseSync, id: number, name: string): void {
  const r = guardUnique(() =>
    db.prepare('UPDATE fiche_types SET name = ? WHERE id = ?').run(typeName(name), id),
  );
  if (!r.changes) throw new InvalidInputError('Type inconnu.');
}

export function removeType(db: DatabaseSync, id: number): void {
  if (db.prepare('SELECT 1 FROM fiches WHERE type_id = ?').get(id))
    throw new InvalidInputError('Des fiches utilisent ce type.');
  if (!db.prepare('DELETE FROM fiche_types WHERE id = ?').run(id).changes)
    throw new InvalidInputError('Type inconnu.');
}

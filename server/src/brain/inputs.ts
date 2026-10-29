import type { DatabaseSync } from 'node:sqlite';
import { processLot, type BrainDeps, type ProcessResult } from './process.ts';

/** A refusal with the HTTP status it maps to. */
export class InputError extends Error {
  readonly status: 400 | 409 | 502 | 503;
  constructor(status: InputError['status'], message: string) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

export const MAX_DEPOT_CHARS = 200_000;

const PENDING: Record<string, string> = {
  'cost-cap':
    'Plafond de coût mensuel atteint : le texte est gardé, sans traitement tant que le plafond est atteint.',
  'no-provider': "Aucun modèle d'IA configuré : le texte est gardé, choisis un modèle dans Réglages.",
};

/** done → drafts; pending → 409 (cap) or 503 (no provider, provider down); failed → 502. The text stays stored. */
function outcome(r: ProcessResult): number {
  if (r.status === 'done') return r.drafts;
  if (r.status === 'failed') throw new InputError(502, r.reason);
  throw new InputError(
    r.reason === 'cost-cap' ? 409 : 503,
    PENDING[r.reason] ?? `Fournisseur indisponible (${r.reason}) : le texte est gardé.`,
  );
}

function store(db: DatabaseSync, name: string, type: string, bytes: Uint8Array, now: string): number {
  return Number(
    db
      .prepare('INSERT INTO depots (name, type, bytes, created_at) VALUES (?, ?, ?, ?)')
      .run(name, type, bytes, now).lastInsertRowid,
  );
}

async function ingest(deps: BrainDeps, kind: 'note' | 'depot', depot: number, text: string) {
  const start = deps.clock();
  const r = await processLot(
    deps,
    [{ text, source: { kind, ref: String(depot), at: start.toISOString() } }],
    {
      source: kind,
    },
  );
  const drafts = outcome(r);
  // « Dernier traitement » also shows what a note or a depot just did (no lot behind it).
  const end = deps.clock();
  deps.db
    .prepare(
      'INSERT INTO runs (lot, at, duration_ms, cost, observations, drafts, questions) VALUES (NULL, ?, ?, ?, 1, ?, ?)',
    )
    .run(
      end.toISOString(),
      end.getTime() - start.getTime(),
      r.cost,
      drafts,
      r.status === 'done' ? r.questions : 0,
    );
  return drafts;
}

const checkText = (text: string) => {
  if (!text.trim()) throw new InputError(400, 'Texte vide.');
  if (text.length > MAX_DEPOT_CHARS)
    throw new InputError(400, `Document trop long (${MAX_DEPOT_CHARS} caractères au plus).`);
};

/** A note is kept as a text depot named « note », so a refused pass loses nothing. */
export async function addNote(deps: BrainDeps, text: string): Promise<{ drafts: number }> {
  checkText(text);
  const bytes = new TextEncoder().encode(text);
  const depot = store(deps.db, 'note', 'text/plain', bytes, deps.clock().toISOString());
  return { drafts: await ingest(deps, 'note', depot, text) };
}

export async function addDepot(
  deps: BrainDeps,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<{ depot: number; drafts: number }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    throw new InputError(400, 'PDF non pris en charge en v1');
  if (!/\.(txt|md)$/i.test(file.name) && !/^text\/(plain|markdown)$/.test(file.type))
    throw new InputError(400, 'Format non pris en charge en v1 (texte ou Markdown).');
  if (file.bytes.length > MAX_DEPOT_CHARS * 4) throw new InputError(400, 'Document trop long.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
  } catch {
    throw new InputError(400, 'Document illisible : UTF-8 attendu.');
  }
  checkText(text);
  const depot = store(deps.db, file.name, file.type, file.bytes, deps.clock().toISOString());
  return { depot, drafts: await ingest(deps, 'depot', depot, text) };
}

/** Drafts whose facts cite the depot (a note is a depot too). */
export function listDepots(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT d.id, d.name, d.type, length(d.bytes) AS size, d.created_at AS createdAt,
        (SELECT COUNT(*) FROM drafts dr WHERE dr.kind = 'fiche' AND dr.status = 'pending' AND EXISTS (
           SELECT 1 FROM json_each(dr.payload, '$.facts')
            WHERE json_extract(value, '$.source.kind') IN ('depot', 'note')
              AND json_extract(value, '$.source.ref') = CAST(d.id AS TEXT))) AS pending,
        (SELECT COUNT(*) FROM drafts dr WHERE dr.kind = 'fiche' AND EXISTS (
           SELECT 1 FROM json_each(dr.payload, '$.facts')
            WHERE json_extract(value, '$.source.kind') IN ('depot', 'note')
              AND json_extract(value, '$.source.ref') = CAST(d.id AS TEXT))) AS total
       FROM depots d ORDER BY d.id DESC`,
    )
    .all();
}

/** Removes the document only: validated fiches keep their source reference. */
export const deleteDepot = (db: DatabaseSync, id: number): boolean =>
  db.prepare('DELETE FROM depots WHERE id = ?').run(id).changes > 0;

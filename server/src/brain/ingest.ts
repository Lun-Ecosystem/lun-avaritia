import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InvalidInputError } from '../contract/actions.ts';
import { getState } from '../contract/state.ts';
import { overCap, processLot, type BrainDeps, type Observation } from './process.ts';

const Iso = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)), 'ISO 8601 attendu');

export const IngestSchema = z.strictObject({
  version: z.literal(1),
  observations: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(2000),
        source: z.strictObject({
          kind: z.literal('core'),
          origin: z.string().max(200).optional(),
          ref: z.string().max(200).optional(),
          at: Iso,
        }),
      }),
    )
    .min(1)
    .max(500),
});

export type IngestResult = { lot: number; accepted: number; status: 'queued' | 'held' };

/** Stores a lot and its observations in one transaction; no LLM call. */
export function ingestLot(deps: BrainDeps, observations: Observation[]): IngestResult {
  const { db } = deps;
  const held = overCap(db, deps.clock());
  const status = held ? 'held' : 'queued';
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO lots (status, reason, created_at) VALUES (?, ?, ?)')
      .run(status, held ? 'cost-cap' : null, deps.clock().toISOString());
    const add = db.prepare('INSERT INTO observations (lot, text, source) VALUES (?, ?, ?)');
    for (const o of observations) add.run(lastInsertRowid, o.text, JSON.stringify(o.source));
    db.exec('COMMIT');
    return { lot: Number(lastInsertRowid), accepted: observations.length, status };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const running = new WeakSet<DatabaseSync>();
const DAY = 86_400_000;

/**
 * Processes the queued lots one at a time, after giving the held ones another chance when the cap and the
 * providers allow; a lot whose tri was paid gets it only once its day of wait (`retry_at`) is over.
 */
export async function runPending(deps: BrainDeps): Promise<void> {
  const { db } = deps;
  // A pause stops the automatic actions: lots wait, and `resume` runs them again.
  if (running.has(db) || getState(db).paused) return;
  running.add(db);
  try {
    // A lot left `running` by a crash is replayed.
    db.exec("UPDATE lots SET status = 'queued' WHERE status = 'running'");
    if (!overCap(db, deps.clock()) && deps.provider('tri') && deps.provider('agent'))
      db.prepare(
        "UPDATE lots SET status = 'queued', reason = NULL, retry_at = NULL WHERE status = 'held' AND (retry_at IS NULL OR retry_at <= ?)",
      ).run(deps.clock().toISOString());
    for (;;) {
      if (getState(db).paused) return; // a pause during the pass: no further LLM call
      const lot = db.prepare("SELECT id FROM lots WHERE status = 'queued' ORDER BY id LIMIT 1").get() as
        { id: number } | undefined;
      if (!lot) return;
      await runLot(deps, lot.id);
    }
  } finally {
    running.delete(db);
  }
}

async function runLot(deps: BrainDeps, id: number): Promise<void> {
  const { db } = deps;
  const set = (status: string, reason: string | null, retryAt: string | null = null) =>
    db
      .prepare('UPDATE lots SET status = ?, reason = ?, retry_at = ? WHERE id = ?')
      .run(status, reason, retryAt, id);
  set('running', null);
  const rows = db.prepare('SELECT id, text, source FROM observations WHERE lot = ? ORDER BY id').all(id) as {
    id: number;
    text: string;
    source: string;
  }[];
  const observations = rows.map((o): Observation => ({ text: o.text, source: JSON.parse(o.source) }));
  const start = deps.clock().getTime();
  const r = await processLot(deps, observations, { lot: id, source: 'core' }).catch(
    (err): Awaited<ReturnType<typeof processLot>> => ({
      status: 'failed',
      reason: `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      cost: 0,
    }),
  );
  // Its tri paid, the lot runs again a day later at the earliest: not a tri paid every hour.
  // Taken at the lot's end, `retry_at` falls just after the pass a day on: the next one takes it, near +25 h.
  if (r.status === 'pending')
    return void set(
      'held',
      r.reason,
      r.afterTri ? new Date(deps.clock().getTime() + DAY).toISOString() : null,
    );
  // The state and the trace go together: a stop between them must not leave a done lot with no trace.
  const dropped = r.status === 'done' ? r.dropped : undefined;
  db.exec('BEGIN');
  try {
    set(r.status, r.status === 'failed' ? r.reason : null);
    // A replayed lot overwrites its trace; a held or failed one sets nothing aside.
    db.prepare('UPDATE observations SET dropped_reason = NULL WHERE lot = ?').run(id);
    const drop = db.prepare('UPDATE observations SET dropped_reason = ? WHERE id = ?');
    for (const o of dropped?.observations ?? []) drop.run(o.reason, rows[o.index]!.id);
    db.prepare('UPDATE lots SET dropped_questions = ? WHERE id = ?').run(
      JSON.stringify(dropped?.questions ?? []),
      id,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const at = deps.clock();
  db.prepare(
    'INSERT INTO runs (lot, at, duration_ms, cost, observations, drafts, questions) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    at.toISOString(),
    at.getTime() - start,
    r.cost,
    observations.length,
    r.status === 'done' ? r.drafts : 0,
    r.status === 'done' ? r.questions : 0,
  );
}

export interface LastRun {
  at: string;
  durationMs: number;
  cost: number;
  observations: number;
  drafts: number;
  questions: number;
}

export function lastRun(db: DatabaseSync): LastRun | undefined {
  return db
    .prepare(
      `SELECT at, duration_ms AS durationMs, cost, observations, drafts, questions
       FROM runs ORDER BY id DESC LIMIT 1`,
    )
    .get() as LastRun | undefined;
}

export const LotSchema = z.strictObject({ lot: z.number().int() });

/** The bilan of one lot: its state, what it holds, and what the pass set aside. */
export function lotAction({ lot }: z.infer<typeof LotSchema>, { db }: Pick<BrainDeps, 'db'>) {
  const row = db
    .prepare('SELECT status, reason, created_at AS receivedAt, dropped_questions AS q FROM lots WHERE id = ?')
    .get(lot) as { status: string; reason: string | null; receivedAt: string; q: string } | undefined;
  if (!row) throw new InvalidInputError('Lot inconnu');
  const obs = db
    .prepare('SELECT text, dropped_reason AS reason FROM observations WHERE lot = ? ORDER BY id')
    .all(lot) as {
    text: string;
    reason: string | null;
  }[];
  const drafts = (kinds: string) =>
    db
      .prepare(
        `SELECT kind, status, json_extract(payload, '$.title') AS title FROM drafts WHERE lot = ? AND kind ${kinds} ORDER BY id`,
      )
      .all(lot) as { kind: string; status: string; title: string }[];
  return {
    lot,
    status: row.status,
    ...(row.reason && { reason: row.reason }),
    receivedAt: row.receivedAt,
    observations: obs.length,
    fiches: drafts("= 'fiche'").map((d) => ({ title: d.title, status: d.status })),
    questions: drafts("IN ('contradiction', 'doublon')").map((d) => ({ kind: d.kind, status: d.status })),
    dropped: [
      ...obs.flatMap((o) => (o.reason ? [{ kind: 'observation', text: o.text, reason: o.reason }] : [])),
      ...(JSON.parse(row.q) as { text: string; reason: string }[]).map((q) => ({ kind: 'question', ...q })),
    ],
  };
}

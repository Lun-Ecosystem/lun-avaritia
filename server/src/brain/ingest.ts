import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
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

/**
 * Processes the queued lots one at a time, after giving the held ones another chance when the cap allows.
 * shortcut: a held lot is only retried on the next ingest or restart, not on a timer; add one if nights
 * under the cap must resume by themselves.
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
      db.exec("UPDATE lots SET status = 'queued', reason = NULL WHERE status = 'held'");
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
  const set = (status: string, reason: string | null) =>
    db.prepare('UPDATE lots SET status = ?, reason = ? WHERE id = ?').run(status, reason, id);
  set('running', null);
  const observations = (
    db.prepare('SELECT text, source FROM observations WHERE lot = ? ORDER BY id').all(id) as {
      text: string;
      source: string;
    }[]
  ).map((o): Observation => ({ text: o.text, source: JSON.parse(o.source) }));
  const start = deps.clock().getTime();
  const r = await processLot(deps, observations, { lot: id, source: 'core' }).catch(
    (err): Awaited<ReturnType<typeof processLot>> => ({
      status: 'failed',
      reason: `Erreur inattendue : ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      cost: 0,
    }),
  );
  if (r.status === 'pending') return void set('held', r.reason);
  set(r.status, r.status === 'failed' ? r.reason : null);
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

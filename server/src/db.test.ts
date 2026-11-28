import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.ts';

const OLD_LOTS = ['id', 'status', 'reason', 'created_at', 'retry_at'];
const OLD_OBSERVATIONS = ['id', 'lot', 'text', 'source'];

describe('the migration that adds the trace of what a lot sets aside', () => {
  it('keeps the lots and observations of a base from before, with an empty trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lun-db-'));
    const file = join(dir, 'old.db');
    const open: { close(): void }[] = [];
    try {
      // Rebuild "a base from before": drop every column the trace added, and rewind the version.
      const first = openDb(file);
      open.push(first);
      const columns = (d: DatabaseSync, table: string) =>
        (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      const added = [
        ...columns(first, 'lots')
          .filter((c) => !OLD_LOTS.includes(c))
          .map((c) => ['lots', c]),
        ...columns(first, 'observations')
          .filter((c) => !OLD_OBSERVATIONS.includes(c))
          .map((c) => ['observations', c]),
      ];
      expect(added.length).toBeGreaterThanOrEqual(2); // one column per table, at least
      for (const [table, column] of added) first.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      const { version } = first.prepare('SELECT version FROM schema_version').get() as { version: number };
      first.prepare('UPDATE schema_version SET version = ?').run(version - 1);
      first.exec("INSERT INTO lots (status, created_at) VALUES ('done', '2026-10-01T04:00:00.000Z')");
      first.exec("INSERT INTO observations (lot, text, source) VALUES (1, 'Une observation.', '{}')");
      first.close();

      const db = openDb(file);
      open.push(db);
      expect(db.prepare('SELECT status FROM lots').all()).toEqual([{ status: 'done' }]);
      expect(db.prepare('SELECT text FROM observations').all()).toEqual([{ text: 'Une observation.' }]);
      expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version });
      expect(columns(db, 'lots').length).toBeGreaterThan(OLD_LOTS.length);
      expect(columns(db, 'observations').length).toBeGreaterThan(OLD_OBSERVATIONS.length);
    } finally {
      for (const d of open)
        try {
          d.close();
        } catch {
          /* already closed */
        }
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

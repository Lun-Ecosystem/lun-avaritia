import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, openDb } from './db.ts';

describe('the migration that adds the trace of what a lot sets aside', () => {
  it('keeps the lots and observations of a base from before, with an empty trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lun-db-'));
    const file = join(dir, 'old.db');
    const open: DatabaseSync[] = [];
    try {
      // The base from before: every migration up to the one that adds the trace, found by its text.
      const at = MIGRATIONS.findIndex((m) => m.includes('dropped_reason'));
      expect(at).toBeGreaterThan(0);
      const old = new DatabaseSync(file);
      open.push(old);
      old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
      for (const m of MIGRATIONS.slice(0, at)) old.exec(m);
      old.prepare('INSERT INTO schema_version (version) VALUES (?)').run(at);
      old.exec("INSERT INTO lots (status, created_at) VALUES ('done', '2026-10-01T04:00:00.000Z')");
      old.exec("INSERT INTO observations (lot, text, source) VALUES (1, 'Une observation.', '{}')");
      old.close();

      const db = openDb(file);
      open.push(db);
      expect(db.prepare('SELECT status, dropped_questions FROM lots').all()).toEqual([
        { status: 'done', dropped_questions: '[]' },
      ]);
      expect(db.prepare('SELECT text, dropped_reason FROM observations').all()).toEqual([
        { text: 'Une observation.', dropped_reason: null },
      ]);
      expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: MIGRATIONS.length });
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

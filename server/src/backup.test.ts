import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { BACKUP_TMP, backupDatabase, backupIfMissing } from './backup.ts';
import { openDb } from './db.ts';

const day = (d: number, hour = 5) => new Date(2026, 10, d, hour);

function base() {
  const dir = mkdtempSync(join(tmpdir(), 'copie-'));
  const db = openDb(join(dir, 'avaritia.db'));
  db.exec('CREATE TABLE t (v TEXT)');
  return { db, backups: join(dir, 'backups') };
}

const rows = (file: string) => {
  const copy = new DatabaseSync(file, { readOnly: true });
  const { n } = copy.prepare('SELECT count(*) AS n FROM t').get() as { n: number };
  copy.close();
  return n;
};

describe('backupDatabase', () => {
  it('writes a copy that opens with node:sqlite and holds a row written just before', () => {
    const { db, backups } = base();
    db.prepare('INSERT INTO t VALUES (?)').run('juste avant');
    const { file } = backupDatabase(db, backups, day(7));
    expect(file).toBe(join(backups, 'avaritia-2026-11-07.db'));
    const copy = new DatabaseSync(file, { readOnly: true });
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'juste avant' });
    copy.close();
    expect(existsSync(join(backups, BACKUP_TMP))).toBe(false);
  });

  it('keeps the seven latest copies, and a file of another name', () => {
    const { db, backups } = base();
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, 'notes.txt'), 'à moi');
    for (let d = 1; d <= 8; d++) backupDatabase(db, backups, day(d));
    const left = readdirSync(backups).sort();
    expect(left.filter((f) => f.endsWith('.db'))).toHaveLength(7);
    expect(left).not.toContain('avaritia-2026-11-01.db');
    expect(left).toContain('avaritia-2026-11-08.db');
    expect(left).toContain('notes.txt');
  });

  it('fails without touching the earlier copies, and leaves no temporary file', () => {
    const { db, backups } = base();
    backupDatabase(db, backups, day(6));
    // A temporary file left by a stop in the middle of a copy.
    writeFileSync(join(backups, BACKUP_TMP), 'à moitié');
    db.close();
    expect(() => backupDatabase(db, backups, day(7))).toThrow();
    expect(readdirSync(backups)).toEqual(['avaritia-2026-11-06.db']);
  });
});

describe('backupIfMissing', () => {
  it('copies when there is no copy at all', () => {
    const { db, backups } = base();
    const lines: string[] = [];
    backupIfMissing(db, backups, day(7), (l) => lines.push(l));
    expect(readdirSync(backups)).toEqual(['avaritia-2026-11-07.db']);
    expect(lines).toEqual([`Base copiée : ${join(backups, 'avaritia-2026-11-07.db')}`]);
  });

  it('leaves the day’s copy as it is, hour after hour', () => {
    const { db, backups } = base();
    backupIfMissing(db, backups, day(7, 5), () => {});
    db.prepare('INSERT INTO t VALUES (?)').run('plus tard');
    const lines: string[] = [];
    backupIfMissing(db, backups, day(7, 6), (l) => lines.push(l));
    expect(rows(join(backups, 'avaritia-2026-11-07.db'))).toBe(0);
    expect(lines).toEqual([]);
  });

  it('catches up a post off at night: only yesterday’s copy, today’s is made', () => {
    const { db, backups } = base();
    backupIfMissing(db, backups, day(6, 22), () => {});
    backupIfMissing(db, backups, day(7, 9), () => {});
    expect(readdirSync(backups).sort()).toEqual(['avaritia-2026-11-06.db', 'avaritia-2026-11-07.db']);
  });

  it('says a failed copy in the server log without throwing, and tries again the next time', () => {
    const { backups } = base();
    const lines: string[] = [];
    const closed = new DatabaseSync(':memory:');
    closed.close();
    expect(() => backupIfMissing(closed, backups, day(7), (l) => lines.push(l))).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Copie de la base ratée : /);
    const { db } = base();
    backupIfMissing(db, backups, day(7, 6), (l) => lines.push(l));
    expect(readdirSync(backups)).toEqual(['avaritia-2026-11-07.db']);
  });
});

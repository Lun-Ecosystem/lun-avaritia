import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { backupDatabase, backupIfMissing } from './backup.ts';
import { openDb } from './db.ts';

const day = (d: number, hour = 5) => new Date(2026, 10, d, hour);
const TMP = '.avaritia-copie.tmp';

function base() {
  const dir = mkdtempSync(join(tmpdir(), 'copie-'));
  const path = join(dir, 'avaritia.db');
  const db = openDb(path);
  db.exec('CREATE TABLE t (v TEXT)');
  return { db, path, backups: join(dir, 'backups') };
}

const rows = (file: string) => {
  const copy = new DatabaseSync(file, { readOnly: true });
  const { n } = copy.prepare('SELECT count(*) AS n FROM t').get() as { n: number };
  copy.close();
  return n;
};

describe('backupDatabase', () => {
  it('writes a copy that opens with node:sqlite and holds a row written just before', () => {
    const { db, path, backups } = base();
    db.prepare('INSERT INTO t VALUES (?)').run('juste avant');
    const { file } = backupDatabase(db, path, day(7));
    expect(file).toBe(join(backups, 'avaritia-2026-11-07.db'));
    const copy = new DatabaseSync(file, { readOnly: true });
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'juste avant' });
    copy.close();
    expect(existsSync(join(backups, TMP))).toBe(false);
  });

  it('keeps the seven latest copies, and a file of another name', () => {
    const { db, path, backups } = base();
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, 'notes.txt'), 'à moi');
    for (let d = 1; d <= 8; d++) backupDatabase(db, path, day(d));
    const left = readdirSync(backups).sort();
    expect(left.filter((f) => f.endsWith('.db'))).toHaveLength(7);
    expect(left).not.toContain('avaritia-2026-11-01.db');
    expect(left).toContain('avaritia-2026-11-08.db');
    expect(left).toContain('notes.txt');
  });

  it('names each copy after its base: another base in the same folder keeps its own copies', () => {
    const { db, path, backups } = base();
    // As long a name as avaritia: only the name tells their copies apart.
    const other = join(dirname(path), 'archives.db');
    const essai = new DatabaseSync(other);
    backupDatabase(db, path, day(1));
    for (let d = 1; d <= 8; d++) backupDatabase(essai, other, day(d));
    essai.close();
    backupIfMissing(db, path, day(8), () => {});
    const left = readdirSync(backups);
    expect(left.filter((f) => f.startsWith('archives-'))).toHaveLength(7);
    expect(left).toContain('avaritia-2026-11-01.db');
    expect(left).toContain('avaritia-2026-11-08.db');
  });

  it('fails without touching the earlier copies, and leaves no temporary file', () => {
    const { db, path, backups } = base();
    backupDatabase(db, path, day(6));
    // A temporary file left by a stop in the middle of a copy.
    writeFileSync(join(backups, TMP), 'à moitié');
    db.close();
    expect(() => backupDatabase(db, path, day(7))).toThrow();
    expect(readdirSync(backups)).toEqual(['avaritia-2026-11-06.db']);
  });
});

describe('backupIfMissing', () => {
  it('copies when there is no copy at all', () => {
    const { db, path, backups } = base();
    const lines: string[] = [];
    backupIfMissing(db, path, day(7), (l) => lines.push(l));
    expect(readdirSync(backups)).toEqual(['avaritia-2026-11-07.db']);
    expect(lines).toEqual([`Base copiée : ${join(backups, 'avaritia-2026-11-07.db')}`]);
  });

  it('leaves the day’s copy as it is, hour after hour', () => {
    const { db, path, backups } = base();
    backupIfMissing(db, path, day(7, 5), () => {});
    db.prepare('INSERT INTO t VALUES (?)').run('plus tard');
    const lines: string[] = [];
    backupIfMissing(db, path, day(7, 6), (l) => lines.push(l));
    expect(rows(join(backups, 'avaritia-2026-11-07.db'))).toBe(0);
    expect(lines).toEqual([]);
  });

  it('catches up a post off at night: only yesterday’s copy, today’s is made', () => {
    const { db, path, backups } = base();
    backupIfMissing(db, path, day(6, 22), () => {});
    backupIfMissing(db, path, day(7, 9), () => {});
    expect(readdirSync(backups).sort()).toEqual(['avaritia-2026-11-06.db', 'avaritia-2026-11-07.db']);
  });

  it('says a failed copy in the server log without throwing, and tries again the next time', () => {
    const { db, path, backups } = base();
    const lines: string[] = [];
    const closed = new DatabaseSync(':memory:');
    closed.close();
    expect(() => backupIfMissing(closed, path, day(7), (l) => lines.push(l))).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Copie de la base ratée : /);
    backupIfMissing(db, path, day(7, 6), (l) => lines.push(l));
    expect(readdirSync(backups)).toEqual(['avaritia-2026-11-07.db']);
  });

  it('says an old copy it could not remove apart from the copy, which is made', () => {
    const { db, path, backups } = base();
    // A folder of that name stands for a copy held open on Windows: it cannot be removed.
    mkdirSync(join(backups, 'avaritia-2026-11-01.db'), { recursive: true });
    for (let d = 2; d <= 7; d++) backupDatabase(db, path, day(d));
    const lines: string[] = [];
    backupIfMissing(db, path, day(8), (l) => lines.push(l));
    expect(lines).toEqual([
      `Base copiée : ${join(backups, 'avaritia-2026-11-08.db')}`,
      `Ancienne copie non retirée : ${join(backups, 'avaritia-2026-11-01.db')}`,
    ]);
  });
});

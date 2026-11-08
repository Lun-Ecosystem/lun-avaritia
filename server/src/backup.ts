import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** The copy is written here first: `VACUUM INTO` refuses a target that exists. */
export const BACKUP_TMP = '.avaritia-copie.tmp';
const NAME = /^avaritia-\d{4}-\d{2}-\d{2}\.db$/;

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Where the copy of that day goes, on the post's own calendar. */
const copyOf = (dir: string, now: Date) => join(dir, `avaritia-${ymd(now)}.db`);

/**
 * Copies the base, consistent while the server runs, to `<dir>/avaritia-YYYY-MM-DD.db`, and keeps the `keep` latest
 * (the core's own copy, `backupDatabase` in lun-anima). Synchronous. Throws on failure; the older copies stay.
 */
export function backupDatabase(db: DatabaseSync, dir: string, now: Date, keep = 7): { file: string } {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, BACKUP_TMP);
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  const file = copyOf(dir, now);
  renameSync(tmp, file);
  // The names sort by date: the oldest go first.
  const copies = readdirSync(dir)
    .filter((f) => NAME.test(f))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep)))
    rmSync(join(dir, old), { force: true });
  return { file };
}

/**
 * The day's copy, when it is missing: called at start then every hour, so a post off at night catches up as soon
 * as it is back. A failed copy is only logged, never thrown: the next call tries again.
 */
export function backupIfMissing(db: DatabaseSync, dir: string, now: Date, log: (line: string) => void): void {
  if (existsSync(copyOf(dir, now))) return;
  try {
    log(`Base copiée : ${backupDatabase(db, dir, now).file}`);
  } catch (err) {
    log(`Copie de la base ratée : ${err instanceof Error ? err.message : String(err)}`);
  }
}

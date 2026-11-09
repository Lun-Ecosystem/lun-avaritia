import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const DAY = /^\d{4}-\d{2}-\d{2}\.db$/;

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Where the copies of the base at `path` go: `backups/` next to it, each named after the base and its day on the
 * post's own calendar (`avaritia-AAAA-MM-JJ.db` by default). Another base in the same folder keeps its own copies.
 */
function copiesOf(path: string, now: Date) {
  const dir = join(dirname(path), 'backups');
  const name = basename(path, extname(path));
  return { dir, name, file: join(dir, `${name}-${ymd(now)}.db`) };
}

/**
 * Copies the base, consistent while the server runs, and keeps the `keep` latest, like the core's own copy.
 * Synchronous. Throws when the copy fails; the older copies stay. Returns the old copies it could not remove (one
 * held open, on Windows): the next copy tries them again.
 */
export function backupDatabase(
  db: DatabaseSync,
  path: string,
  now: Date,
  keep = 7,
): { file: string; stuck: string[] } {
  const { dir, name, file } = copiesOf(path, now);
  mkdirSync(dir, { recursive: true });
  // `VACUUM INTO` refuses a target that exists: the copy is written here first, never counted among the copies.
  const tmp = join(dir, `.${name}-copie.tmp`);
  rmSync(tmp, { force: true });
  // shortcut: VACUUM INTO holds the server while it copies (about 0.1 s for 30 MB); move to the asynchronous
  // backup() of node:sqlite once a base reaches a few hundred MB, after checking the Node versions accepted.
  db.prepare('VACUUM INTO ?').run(tmp);
  renameSync(tmp, file);
  // The names sort by date: the oldest go first.
  const copies = readdirSync(dir)
    .filter((f) => f.startsWith(`${name}-`) && DAY.test(f.slice(name.length + 1)))
    .sort();
  const stuck: string[] = [];
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) {
    try {
      rmSync(join(dir, old), { force: true });
    } catch {
      stuck.push(join(dir, old));
    }
  }
  return { file, stuck };
}

/**
 * The day's copy, when it is missing: called at start then every hour, so a post off at night catches up as soon
 * as it is back. A failed copy is only logged, never thrown: the next call tries again.
 */
export function backupIfMissing(
  db: DatabaseSync,
  path: string,
  now: Date,
  log: (line: string) => void,
): void {
  if (existsSync(copiesOf(path, now).file)) return;
  try {
    const { file, stuck } = backupDatabase(db, path, now);
    log(`Base copiée : ${file}`);
    for (const old of stuck) log(`Ancienne copie non retirée : ${old}`);
  } catch (err) {
    log(`Copie de la base ratée : ${err instanceof Error ? err.message : String(err)}`);
  }
}

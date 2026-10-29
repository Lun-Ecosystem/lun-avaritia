import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Ordered schema migrations. Adding one means appending to the list, never editing a past entry:
 * `schema_version` records how many have run.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE clients (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL,
     revoked_at TEXT,
     kind TEXT NOT NULL DEFAULT 'device' CHECK (kind IN ('device', 'app'))
   );
   CREATE TABLE pairing_codes (code TEXT PRIMARY KEY, expires_at TEXT NOT NULL, used_at TEXT);
   CREATE TABLE pairing_failures (at TEXT NOT NULL);
   CREATE TABLE authorization_codes (
     code TEXT PRIMARY KEY,
     client TEXT NOT NULL,
     redirect_uri TEXT NOT NULL,
     code_challenge TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at TEXT
   );
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL,
     importance TEXT NOT NULL,
     at TEXT NOT NULL,
     title TEXT NOT NULL,
     data TEXT
   );
   CREATE TABLE costs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     provider TEXT NOT NULL,
     model TEXT,
     amount REAL NOT NULL,
     calls INTEGER NOT NULL,
     purpose TEXT
   );`,
  `CREATE TABLE fiche_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
   INSERT INTO fiche_types (name) VALUES ('Personne'), ('Organisation'), ('Projet'), ('Service'), ('Échange'), ('Note');
   CREATE TABLE fiches (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type_id INTEGER NOT NULL REFERENCES fiche_types(id),
     title TEXT NOT NULL,
     synthesis TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE facts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     fiche_id INTEGER NOT NULL REFERENCES fiches(id),
     text TEXT NOT NULL,
     source TEXT NOT NULL,
     at TEXT NOT NULL,
     struck_at TEXT,
     struck_by INTEGER REFERENCES facts(id)
   );
   CREATE TABLE links (
     from_id INTEGER NOT NULL REFERENCES fiches(id),
     to_id INTEGER NOT NULL REFERENCES fiches(id),
     relation TEXT NOT NULL,
     PRIMARY KEY (from_id, to_id, relation)
   );
   CREATE TABLE fiche_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     fiche_id INTEGER NOT NULL REFERENCES fiches(id),
     at TEXT NOT NULL,
     title TEXT NOT NULL,
     synthesis TEXT NOT NULL
   );
   CREATE VIRTUAL TABLE fiche_search USING fts5(title, synthesis, facts, tokenize = 'unicode61 remove_diacritics 2');`,
  `ALTER TABLE fiches ADD COLUMN merged_into INTEGER REFERENCES fiches(id);
   ALTER TABLE fiches ADD COLUMN user_edited_at TEXT;
   CREATE TABLE drafts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     payload TEXT NOT NULL,
     lot INTEGER,
     origin TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applying', 'done', 'refused', 'failed')),
     created_at TEXT NOT NULL,
     decided_at TEXT,
     error TEXT,
     skipped_synthesis INTEGER NOT NULL DEFAULT 0,
     warnings TEXT NOT NULL DEFAULT '[]'
   );`,
  `CREATE TABLE lots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     status TEXT NOT NULL CHECK (status IN ('queued', 'held', 'running', 'done', 'failed')),
     reason TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE observations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     lot INTEGER NOT NULL REFERENCES lots(id),
     text TEXT NOT NULL,
     source TEXT NOT NULL
   );
   CREATE TABLE runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     lot INTEGER NOT NULL REFERENCES lots(id),
     at TEXT NOT NULL,
     duration_ms INTEGER NOT NULL,
     cost REAL NOT NULL,
     observations INTEGER NOT NULL,
     drafts INTEGER NOT NULL,
     questions INTEGER NOT NULL
   );`,
  `CREATE TABLE depots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     type TEXT NOT NULL,
     bytes BLOB NOT NULL,
     created_at TEXT NOT NULL
   );`,
  // A note or a depot also leaves a run, without a lot: `runs.lot` becomes nullable.
  `CREATE TABLE runs_new (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     lot INTEGER REFERENCES lots(id),
     at TEXT NOT NULL,
     duration_ms INTEGER NOT NULL,
     cost REAL NOT NULL,
     observations INTEGER NOT NULL,
     drafts INTEGER NOT NULL,
     questions INTEGER NOT NULL
   );
   INSERT INTO runs_new SELECT * FROM runs;
   DROP TABLE runs;
   ALTER TABLE runs_new RENAME TO runs;`,
  // The day a thing to do is due (ISO date), when the note said one.
  `ALTER TABLE facts ADD COLUMN due TEXT;`,
];

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout: the `pair-code` command writes to the same file while the server runs.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** Reads a JSON value from the settings table. */
export function getSetting<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function putSetting(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

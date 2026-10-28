import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MiddlewareHandler } from 'hono';

const CODE_TTL_MS = 10 * 60_000;
const LOCK_WINDOW_MS = 10 * 60_000;
const LOCK_FAILURES = 5;

export type ClientKind = 'device' | 'app';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The token of an `Authorization: Bearer <token>` header, or an empty string. */
export function bearerToken(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice(7) : '';
}

/** « 482 917 »: a code is shown grouped by three, everywhere. */
export const groupCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/** A one-time six-digit code, valid for 10 minutes. */
export function issuePairingCode(db: DatabaseSync, now: Date): string {
  let code: string;
  do {
    code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  } while (db.prepare('SELECT 1 FROM pairing_codes WHERE code = ?').get(code));
  db.prepare('INSERT INTO pairing_codes (code, expires_at) VALUES (?, ?)').run(
    code,
    new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  );
  return code;
}

export function codeExpiry(db: DatabaseSync, code: string): string | undefined {
  const row = db.prepare('SELECT expires_at FROM pairing_codes WHERE code = ?').get(code) as
    { expires_at: string } | undefined;
  return row?.expires_at;
}

/** Exchanges a valid code for a token; `null` when the code is unknown, used or expired. */
export function pair(
  db: DatabaseSync,
  code: string,
  clientName: string,
  now: Date,
  kind: ClientKind = 'device',
): { token: string } | null {
  const row = db.prepare('SELECT expires_at, used_at FROM pairing_codes WHERE code = ?').get(code) as
    { expires_at: string; used_at: string | null } | undefined;
  if (!row || row.used_at || new Date(row.expires_at) < now) return null;
  db.prepare('UPDATE pairing_codes SET used_at = ? WHERE code = ?').run(now.toISOString(), code);
  return { token: createClient(db, clientName, kind, now) };
}

/** Registers a client and returns its bearer token; only the token's hash is stored. */
export function createClient(db: DatabaseSync, name: string, kind: ClientKind, now: Date): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO clients (name, kind, token_hash, created_at) VALUES (?, ?, ?, ?)').run(
    name,
    kind,
    hashToken(token),
    now.toISOString(),
  );
  return token;
}

/**
 * Records a failed `POST /lun/v1/pair`. The fifth failure within a sliding 10-minute window voids
 * every pending pairing and authorization code, starts the count over and re-issues the first-run
 * code if no client exists. The count lives in the database: the `pair-code` command and the server
 * share it, hence one write transaction from the count to the voiding.
 */
export function recordPairingFailure(db: DatabaseSync, now: Date, log: (line: string) => void): void {
  // Logged after the commit only: a rolled-back lock must not announce a code that does not exist.
  const lines: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO pairing_failures (at) VALUES (?)').run(now.toISOString());
    db.prepare('DELETE FROM pairing_failures WHERE at <= ?').run(
      new Date(now.getTime() - LOCK_WINDOW_MS).toISOString(),
    );
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM pairing_failures').get() as { n: number };
    if (n >= LOCK_FAILURES) {
      db.exec('DELETE FROM pairing_codes WHERE used_at IS NULL');
      db.exec('DELETE FROM authorization_codes WHERE used_at IS NULL');
      db.exec('DELETE FROM pairing_failures');
      lines.push('Appairage verrouillé : 5 codes faux en 10 min, codes en cours annulés.');
      bootstrapPairing(db, now, (line) => lines.push(line));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  lines.forEach((line) => log(line));
}

export interface ClientRow {
  id: number;
  name: string;
  kind: ClientKind;
  createdAt: string;
  tokenHash: string;
}

/** Clients that still have access (devices and apps), oldest first. */
export function listClients(db: DatabaseSync): ClientRow[] {
  return db
    .prepare(
      `SELECT id, name, kind, created_at AS createdAt, token_hash AS tokenHash
       FROM clients WHERE revoked_at IS NULL ORDER BY id`,
    )
    .all() as unknown as ClientRow[];
}

/** Soft revocation; `false` when the client is unknown or already revoked. */
export function revokeClient(db: DatabaseSync, id: number, now = new Date()): boolean {
  const { changes } = db
    .prepare('UPDATE clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(now.toISOString(), id);
  return Number(changes) > 0;
}

export function isValidToken(db: DatabaseSync, token: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM clients WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token)),
  );
}

export function requireToken(db: DatabaseSync): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token || !isValidToken(db, token))
      return c.json({ error: 'Jeton absent, invalide ou révoqué' }, 401);
    await next();
  };
}

/** The kind of a live client's token; `undefined` when the token is unknown or revoked. */
export function clientKind(db: DatabaseSync, token: string): ClientKind | undefined {
  const row = db
    .prepare('SELECT kind FROM clients WHERE token_hash = ? AND revoked_at IS NULL')
    .get(hashToken(token)) as { kind: ClientKind } | undefined;
  return row?.kind;
}

/**
 * Runs after `requireToken`: the `/api` surface (pairing, revocation, keys...) belongs to
 * paired devices; an app token obtained by authorization only reaches the contract under `/lun/v1`.
 */
export function requireDevice(db: DatabaseSync): MiddlewareHandler {
  return async (c, next) => {
    if (clientKind(db, bearerToken(c.req.header('authorization'))) !== 'device')
      return c.json(
        { error: 'Réservé aux appareils reliés : une application n’a accès qu’au contrat /lun/v1' },
        403,
      );
    await next();
  };
}

/** First start: with no paired client yet, the pairing code of the first device goes to the logs. */
export function bootstrapPairing(db: DatabaseSync, now: Date, log: (line: string) => void): void {
  if (db.prepare('SELECT 1 FROM clients WHERE revoked_at IS NULL').get()) return;
  const code = issuePairingCode(db, now);
  log(`Aucun appareil appairé. Code d’appairage du premier appareil (10 min) : ${groupCode(code)}`);
}

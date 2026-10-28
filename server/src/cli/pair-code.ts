import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { codeExpiry, groupCode, issuePairingCode } from '../contract/auth.ts';
import { openDb } from '../db.ts';

/** Issues a pairing code, whether clients exist or not, and returns the line to print. */
export function pairCodeLine(db: DatabaseSync, now: Date): string {
  const code = issuePairingCode(db, now);
  const expiry = new Date(codeExpiry(db, code)!).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Code d’appairage : ${groupCode(code)} · expire à ${expiry} · usage unique`;
}

// `npm run pair-code`: same `.env` and same database as the server, running or not.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const envFile = resolve(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const db = openDb(resolve(root, process.env.DB_PATH ?? 'data/avaritia.db'));
  try {
    console.log(pairCodeLine(db, new Date()));
  } finally {
    db.close();
  }
}

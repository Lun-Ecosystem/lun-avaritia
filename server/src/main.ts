import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { ActionRegistry } from './contract/actions.ts';
import { bootstrapPairing } from './contract/auth.ts';
import { pruneEvents } from './contract/events.ts';
import { openDb } from './db.ts';
import { isValidDate } from './keys/expiry.ts';
import {
  checkKeyExpiries,
  checkWithProvider,
  configuredProviders,
  expiresEnvName,
  llmEnvFrom,
  PROVIDERS,
} from './llm/keys.ts';

// Paths are resolved from the repository root, whatever the working directory (npm -w runs in server/).
const root = fileURLToPath(new URL('../../', import.meta.url));
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const db = openDb(resolve(root, process.env.DB_PATH ?? 'data/avaritia.db'));
const clock = () => new Date();
const actions = new ActionRegistry();
const appDist = resolve(root, 'app/dist');
const staticDir = existsSync(resolve(appDist, 'index.html')) ? appDist : undefined;
const secretKey = process.env.AVARITIA_SECRET_KEY || undefined;
const llmEnv = llmEnvFrom(process.env);
const app = createApp({
  db,
  clock,
  version,
  actions,
  staticDir,
  secretKey,
  llmEnv,
  checkKey: checkWithProvider,
});

bootstrapPairing(db, clock(), (line) => console.log(line));
if (!configuredProviders(db, secretKey, llmEnv).length)
  console.log('Aucune clé de fournisseur d’IA (Réglages ou .env) : l’IA ne travaillera pas.');
for (const id of PROVIDERS) {
  const expires = llmEnv[id]?.expires;
  if (expires && !isValidDate(expires))
    console.log(`${expiresEnvName(id)} ignorée : date attendue au format AAAA-MM-JJ.`);
}
// The declared expiry of each key in service: checked at start, then every hour.
const checkKeyExpiry = () => checkKeyExpiries(db, secretKey, llmEnv, clock());
checkKeyExpiry();
setInterval(checkKeyExpiry, 3600_000).unref();
setInterval(() => pruneEvents(db, clock()), 3600_000).unref();

const port = Number(process.env.PORT ?? 8789);
// Loopback by default: a deployment that must be reachable gives its address explicitly.
const hostname = process.env.HOST?.trim() || '127.0.0.1';
serve({ fetch: app.fetch, port, hostname }, () => console.log(`Lun'Avaritia écoute sur ${hostname}:${port}`));

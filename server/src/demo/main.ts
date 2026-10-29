// DEV ONLY: `npm run demo`. Lun'Avaritia on invented data (in-memory database, no key, no network), port 8798.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from '../app.ts';
import { addDraft } from '../brain/drafts.ts';
import { addFact, createFiche, link, listTypes } from '../brain/store.ts';
import { ActionRegistry } from '../contract/actions.ts';
import { groupCode, issuePairingCode } from '../contract/auth.ts';
import { recordCost } from '../contract/costs.ts';
import { openDb } from '../db.ts';

// No network at all: nothing here may reach a provider.
globalThis.fetch = () => Promise.reject(new Error('demo : réseau interdit'));

const db = openDb(':memory:');
const now = new Date();
const at = now.toISOString();
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const type = (name: string) => listTypes(db).find((t) => t.name === name)!.id;
const src = (days: number, ref: string) => ({ kind: 'core' as const, origin: 'acedia', ref, at: ago(days) });

// Fictional fiches, linked and sourced.
const studio = createFiche(
  db,
  {
    typeId: type('Organisation'),
    title: 'Studio Exemple',
    synthesis: 'Studio de design fictif, client depuis 2025.',
  },
  ago(30),
);
const jean = createFiche(
  db,
  { typeId: type('Personne'), title: 'Jean Martin', synthesis: 'Directeur du Studio Exemple.' },
  ago(30),
);
const refonte = createFiche(
  db,
  { typeId: type('Projet'), title: 'Refonte du site', synthesis: 'Refonte du site vitrine du studio.' },
  ago(20),
);
const doublon = createFiche(
  db,
  { typeId: type('Organisation'), title: 'Studio Exemple SAS', synthesis: '' },
  ago(10),
);
const lyon = addFact(db, studio, 'Le studio est basé à Lyon.', src(30, 'm1'), ago(30));
const nantes = addFact(db, studio, 'Le studio a déménagé à Nantes.', src(2, 'm9'), ago(2));
addFact(db, jean, 'Préfère les échanges par mail.', src(12, 'm4'), ago(12));
addFact(db, refonte, 'Devis signé le 3 octobre.', src(25, 'm2'), ago(25));
link(db, jean, studio, 'dirige');
link(db, refonte, studio, 'pour');
addFact(db, doublon, 'Facture de novembre en attente.', src(1, 'm11'), ago(1));

// A lot already processed into drafts, with one contradiction and one doublon: its run counts these 3 drafts.
db.prepare("INSERT INTO lots (status, created_at) VALUES ('done', ?)").run(ago(1));
db.prepare(
  'INSERT INTO runs (lot, at, duration_ms, cost, observations, drafts, questions) VALUES (1, ?, 4200, 0.0042, 3, 3, 2)',
).run(ago(1));
recordCost(db, { provider: 'anthropic', amount: 0.0042, calls: 2 }, now, 'tri');
addDraft(
  db,
  {
    kind: 'fiche',
    ficheId: refonte,
    typeId: type('Projet'),
    title: 'Refonte du site',
    synthesis: 'Refonte du site vitrine du studio, livraison prévue en décembre.',
    facts: [{ text: 'Livraison prévue le 12 décembre.', source: src(1, 'm12') }],
    links: [{ to: 'Jean Martin', relation: 'suivi par' }],
  },
  { lot: 1, source: 'core' },
  at,
);
addDraft(
  db,
  {
    kind: 'contradiction',
    ficheId: studio,
    keep: nantes,
    strike: lyon,
    reason: 'Deux adresses pour le studio : la plus récente est à Nantes.',
  },
  { lot: 1, source: 'core' },
  at,
);
addDraft(
  db,
  {
    kind: 'doublon',
    keep: studio,
    merge: doublon,
    reason: '« Studio Exemple SAS » et « Studio Exemple » semblent désigner la même organisation.',
  },
  { lot: 1, source: 'core' },
  at,
);

// DEMO_FICHES=<n>: n more invented fiches, linked, to try the graph under load. A fixed seed keeps
// every run identical.
const extra = Math.max(0, Math.min(20_000, Number(process.env.DEMO_FICHES) || 0));
if (extra) {
  let seed = 42;
  const rand = (n: number) => ((seed = (seed * 48_271) % 2_147_483_647), seed % n);
  const types = listTypes(db).map((t) => t.id);
  const relations = ['cite', 'concerne', 'travaille avec', 'dépend de', 'suit'];
  const ids = [studio, jean, refonte];
  db.exec('BEGIN');
  for (let i = 1; i <= extra; i++) {
    const id = createFiche(
      db,
      { typeId: types[rand(types.length)]!, title: `Fiche ${String(i).padStart(4, '0')}`, synthesis: '' },
      ago(rand(60)),
    );
    for (let k = 1 + rand(3); k > 0; k--)
      link(db, id, ids[rand(ids.length)]!, relations[rand(relations.length)]!);
    ids.push(id);
  }
  db.exec('COMMIT');
}

const appDist = fileURLToPath(new URL('../../../app/dist', import.meta.url));
const app = createApp({
  db,
  clock: () => new Date(),
  version: 'demo',
  actions: new ActionRegistry(),
  // The built app (`npm run build`), as `npm start` serves it; without it, the API alone.
  staticDir: existsSync(join(appDist, 'index.html')) ? appDist : undefined,
  dataDir: mkdtempSync(join(tmpdir(), 'avaritia-demo-')),
});
const code = issuePairingCode(db, now);
const browserCode = issuePairingCode(db, now);
const port = Number(process.env.DEMO_PORT ?? 8798);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, async () => {
  const res = await app.request('/lun/v1/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, client: 'demo' }),
  });
  const { token } = (await res.json()) as { token: string };
  console.log(`Démo Lun'Avaritia (données inventées, aucune clé requise) : http://127.0.0.1:${port}`);
  console.log(`Code d’appairage pour le navigateur (10 min) : ${groupCode(browserCode)}`);
  console.log(
    `Appareil déjà appairé. Exemple :\n  curl -H "Authorization: Bearer ${token}" http://127.0.0.1:${port}/api/dashboard`,
  );
});

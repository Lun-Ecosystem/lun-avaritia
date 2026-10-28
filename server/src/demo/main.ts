// DEV ONLY: `npm run demo`. Lun'Avaritia on invented data (in-memory database, no key, no network), port 8798.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../app.ts';
import { addDraft } from '../brain/drafts.ts';
import { addFact, createFiche, link, listTypes } from '../brain/store.ts';
import { ActionRegistry } from '../contract/actions.ts';
import { issuePairingCode } from '../contract/auth.ts';
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

// A lot already processed into drafts, with one contradiction and one doublon.
db.prepare("INSERT INTO lots (status, created_at) VALUES ('done', ?)").run(ago(1));
db.prepare(
  'INSERT INTO runs (lot, at, duration_ms, cost, observations, drafts, questions) VALUES (1, ?, 4200, 0.0042, 3, 1, 2)',
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

const app = createApp({
  db,
  clock: () => new Date(),
  version: 'demo',
  actions: new ActionRegistry(),
  dataDir: mkdtempSync(join(tmpdir(), 'avaritia-demo-')),
});
const code = issuePairingCode(db, now);
const port = Number(process.env.DEMO_PORT ?? 8798);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, async () => {
  const res = await app.request('/lun/v1/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, client: 'demo' }),
  });
  const { token } = (await res.json()) as { token: string };
  console.log(`Démo Lun'Avaritia (données inventées, aucune clé requise) : http://127.0.0.1:${port}`);
  console.log(
    `Appareil déjà appairé. Exemple :\n  curl -H "Authorization: Bearer ${token}" http://127.0.0.1:${port}/api/dashboard`,
  );
});

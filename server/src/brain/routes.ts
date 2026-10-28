import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { join } from 'node:path';
import { InvalidInputError } from '../contract/actions.ts';
import { brainDeps, type AppDeps } from '../app.ts';
import { ask, ChatSchema } from './agent.ts';
import { addDraft } from './drafts.ts';
import { MAX_DEPOT_CHARS, addDepot, addNote, deleteDepot, InputError, listDepots } from './inputs.ts';
import { dashboard } from './dashboard.ts';
import { exportMarkdown } from './export.ts';
import { parseVault } from './obsidian.ts';
import { readSettings, saveSettings } from './settings.ts';
import { addType, editFiche, getFiche, listTypes, removeType, renameType, versions } from './store.ts';

const MAX_FILES = 2000;
const MAX_VAULT_CHARS = 20_000_000;

async function jsonBody(c: Context): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await c.req.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const limit = (maxSize: number) =>
  bodyLimit({ maxSize, onError: (c) => c.json({ error: 'Envoi trop volumineux' }, 413) });

export function brainRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError((err, c) =>
    err instanceof InputError
      ? c.json({ error: err.message }, err.status)
      : err instanceof InvalidInputError
        ? c.json({ error: err.message }, 400)
        : c.json({ error: err.message }, 500),
  );

  r.get('/settings', (c) => c.json({ settings: readSettings(deps.db) }));
  r.put('/settings', async (c) => c.json({ settings: saveSettings(deps.db, await jsonBody(c)) }));
  r.get('/dashboard', (c) => c.json(dashboard(deps.db, deps.clock())));

  r.get('/fiches', (c) =>
    c.json({
      fiches: deps.db
        .prepare(
          `SELECT f.id, f.title, f.type_id AS typeId, t.name AS type, f.updated_at AS updatedAt
             FROM fiches f JOIN fiche_types t ON t.id = f.type_id
            WHERE f.merged_into IS NULL ORDER BY f.updated_at DESC, f.id DESC`,
        )
        .all(),
    }),
  );
  r.get('/fiches/:id', (c) => {
    const fiche = getFiche(deps.db, Number(c.req.param('id')));
    if (!fiche) return c.json({ error: 'Fiche inconnue' }, 404);
    return c.json({ fiche, versions: versions(deps.db, fiche.id) });
  });
  // The user's own edit: applied at once, versioned (the agent never goes through here).
  r.patch('/fiches/:id', limit(1_000_000), async (c) => {
    const body = await jsonBody(c);
    const { title, synthesis } = body ?? {};
    if (
      (title !== undefined && typeof title !== 'string') ||
      (synthesis !== undefined && typeof synthesis !== 'string')
    )
      return c.json({ error: 'title et synthesis : texte attendu' }, 400);
    if (typeof synthesis === 'string' && synthesis.length > 20_000)
      return c.json({ error: 'Synthèse trop longue (20 000 caractères au plus)' }, 400);
    const id = Number(c.req.param('id'));
    editFiche(
      deps.db,
      id,
      { ...(title !== undefined && { title }), ...(synthesis !== undefined && { synthesis }) },
      deps.clock().toISOString(),
    );
    return c.json({ fiche: getFiche(deps.db, id), versions: versions(deps.db, id) });
  });

  r.get('/types', (c) => c.json({ types: listTypes(deps.db) }));
  r.post('/types', async (c) => {
    const name = (await jsonBody(c))?.name;
    if (typeof name !== 'string') return c.json({ error: 'name attendu' }, 400);
    return c.json({ id: addType(deps.db, name) });
  });
  r.patch('/types/:id', async (c) => {
    const name = (await jsonBody(c))?.name;
    if (typeof name !== 'string') return c.json({ error: 'name attendu' }, 400);
    renameType(deps.db, Number(c.req.param('id')), name);
    return c.json({ types: listTypes(deps.db) });
  });
  r.delete('/types/:id', (c) => {
    removeType(deps.db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  r.post('/export', (c) => {
    if (!deps.dataDir) return c.json({ error: 'Dossier de données inconnu' }, 400);
    const date = deps.clock().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    const dir = join(deps.dataDir, 'export', date);
    return c.json({ dir, files: exportMarkdown(deps.db, dir) });
  });

  r.post('/notes', limit(1_000_000), async (c) => {
    const body = await jsonBody(c);
    if (typeof body?.text !== 'string') return c.json({ error: 'text attendu' }, 400);
    return c.json(await addNote(brainDeps(deps), body.text));
  });

  r.post('/agent', limit(100_000), async (c) => {
    const parsed = ChatSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const { request, context, history } = parsed.data;
    return c.json(await ask(brainDeps(deps), request, context, history));
  });

  r.get('/depots', (c) => c.json({ depots: listDepots(deps.db) }));
  r.post('/depots', limit(1_000_000), async (c) => {
    let file: unknown;
    try {
      file = (await c.req.formData()).get('file');
    } catch {
      return c.json({ error: 'Envoi multipart attendu (champ « file »)' }, 400);
    }
    if (!(file instanceof File)) return c.json({ error: 'Champ « file » attendu' }, 400);
    if (file.size > MAX_DEPOT_CHARS * 4) return c.json({ error: 'Document trop long.' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return c.json(await addDepot(brainDeps(deps), { name: file.name, type: file.type, bytes }));
  });
  r.delete('/depots/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !deleteDepot(deps.db, id)) return c.json({ error: 'Dépôt inconnu' }, 404);
    return c.body(null, 204);
  });

  r.post('/import', limit(25_000_000), async (c) => {
    const files = (await jsonBody(c))?.files;
    if (
      !Array.isArray(files) ||
      !files.every((f) => typeof f?.path === 'string' && typeof f?.text === 'string')
    )
      return c.json({ error: 'files attendu : [{ path, text }]' }, 400);
    if (files.length > MAX_FILES) return c.json({ error: `${MAX_FILES} fichiers au plus` }, 400);
    if (files.reduce((n: number, f: { text: string }) => n + f.text.length, 0) > MAX_VAULT_CHARS)
      return c.json({ error: 'Coffre trop gros (20 Mo au plus)' }, 400);
    const { notes, warnings } = parseVault(files);
    if (!notes.length) return c.json({ error: 'Aucune note Markdown trouvée' }, 400);
    const draft = addDraft(
      deps.db,
      { kind: 'import', fiches: notes, warnings },
      { source: 'import' },
      deps.clock().toISOString(),
    );
    return c.json({ draft, notes: notes.length, warnings });
  });
  return r;
}

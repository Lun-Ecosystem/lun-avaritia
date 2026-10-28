import type { Context } from 'hono';
import { Hono } from 'hono';
import { brainDeps, type AppDeps } from '../app.ts';
import { addDraft } from './drafts.ts';
import { addDepot, addNote, deleteDepot, InputError, listDepots } from './inputs.ts';
import { parseVault } from './obsidian.ts';

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

export function brainRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.onError((err, c) =>
    err instanceof InputError
      ? c.json({ error: err.message }, err.status)
      : c.json({ error: err.message }, 500),
  );

  r.post('/notes', async (c) => {
    const body = await jsonBody(c);
    if (typeof body?.text !== 'string') return c.json({ error: 'text attendu' }, 400);
    return c.json(await addNote(brainDeps(deps), body.text));
  });

  r.get('/depots', (c) => c.json({ depots: listDepots(deps.db) }));
  r.post('/depots', async (c) => {
    let file: unknown;
    try {
      file = (await c.req.formData()).get('file');
    } catch {
      return c.json({ error: 'Envoi multipart attendu (champ « file »)' }, 400);
    }
    if (!(file instanceof File)) return c.json({ error: 'Champ « file » attendu' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return c.json(await addDepot(brainDeps(deps), { name: file.name, type: file.type, bytes }));
  });
  r.delete('/depots/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !deleteDepot(deps.db, id)) return c.json({ error: 'Dépôt inconnu' }, 404);
    return c.body(null, 204);
  });

  r.post('/import', async (c) => {
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

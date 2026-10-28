import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppDeps } from '../app.ts';
import { SATELLITE } from '../identity.ts';
import { DegradedError, InvalidInputError } from './actions.ts';
import { pair, recordPairingFailure, requireToken } from './auth.ts';
import { authorizationPage, exchangeAuthorizationCode, readAuthorizationRequest } from './authorize.ts';
import { costsSince } from './costs.ts';
import { eventsSince, subscribe, type LunEvent } from './events.ts';
import { getState, setPaused, statusOf } from './state.ts';

const HEARTBEAT_MS = 25_000;

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  return JSON.parse(text);
}

/** The satellite contract v1 (`standards/contrat-satellite.md` in lun-docs). */
export function contractRoutes(deps: AppDeps): Hono {
  const { db, clock, actions } = deps;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const r = new Hono();

  r.post('/pair', async (c) => {
    let body: { code?: unknown; client?: unknown; code_verifier?: unknown };
    try {
      body = (await readJson(c.req.raw)) as typeof body;
    } catch {
      return c.json({ error: 'Corps JSON invalide' }, 400);
    }
    const byAuthorization = body.code_verifier !== undefined;
    let result: { token: string } | null = null;
    if (typeof body.code === 'string') {
      if (byAuthorization)
        result =
          typeof body.code_verifier === 'string'
            ? exchangeAuthorizationCode(db, body.code, body.code_verifier, clock())
            : null;
      // The code is shown « 482 917 »: its spaces (also U+00A0, U+202F) go, nothing else does.
      else
        result = pair(
          db,
          body.code.replace(/\s/g, ''),
          typeof body.client === 'string' ? body.client : 'client',
          clock(),
        );
    }
    if (!result) {
      recordPairingFailure(db, clock(), log);
      const error = byAuthorization
        ? 'Code d’autorisation invalide, déjà utilisé, expiré ou code_verifier faux'
        : 'Code d’appairage invalide, déjà utilisé ou expiré';
      return c.json({ error }, 401);
    }
    return c.json({ token: result.token, satellite: { ...SATELLITE, version: deps.version } });
  });

  // Public, like /pair: the front's page then tests its own device token.
  r.get('/authorize', (c) => {
    const read = readAuthorizationRequest(c.req.query());
    if ('error' in read) return c.text(read.error, 400);
    return c.redirect(authorizationPage(read.request), 302);
  });

  r.use('*', requireToken(db));

  r.get('/health', (c) => {
    const state = getState(db);
    const status = statusOf(state);
    // Degraded hides the pause in `status`: said apart, so a front can still offer to resume.
    const paused = status.status === 'degraded' && state.paused ? { paused: true } : {};
    return c.json({ ...status, ...paused, version: deps.version, agent: true });
  });

  r.get('/costs', (c) => {
    const raw = c.req.query('since');
    const since = raw ? new Date(raw) : new Date(0);
    if (Number.isNaN(since.getTime())) return c.json({ error: `Date illisible : ${raw}` }, 400);
    return c.json(costsSince(db, since, clock()));
  });

  r.post('/pause', (c) => {
    if (getState(db).paused) return c.json({ error: 'Déjà en pause' }, 409);
    setPaused(db, true);
    return c.json({ status: 'paused' });
  });

  r.post('/resume', (c) => {
    if (!getState(db).paused) return c.json({ error: 'Déjà actif' }, 409);
    setPaused(db, false);
    return c.json({ status: statusOf(getState(db)).status });
  });

  r.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: LunEvent[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = subscribe(db, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      const send = (e: LunEvent) => stream.writeSSE({ id: e.id, event: e.type, data: JSON.stringify(e) });
      let last = c.req.header('last-event-id');
      for (const e of eventsSince(db, last)) {
        await send(e);
        last = e.id;
      }
      while (!stream.aborted) {
        const next = queue.shift();
        if (next) {
          if (Number(next.id) > Number(last ?? 0)) await send(next);
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, HEARTBEAT_MS);
        });
        wake = undefined;
        if (!queue.length && !stream.aborted) await stream.write(': ping\n\n');
      }
    }),
  );

  r.get('/actions', (c) => c.json({ actions: actions.list() }));

  r.post('/actions/:name', async (c) => {
    const entry = actions.get(c.req.param('name'));
    if (!entry) return c.json({ error: `Action inconnue : ${c.req.param('name')}` }, 404);
    let raw: unknown;
    try {
      raw = await readJson(c.req.raw);
    } catch {
      return c.json({ error: 'Corps JSON invalide' }, 400);
    }
    const parsed = entry.schema.safeParse(raw);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    try {
      return c.json({ ok: true, result: await entry.run(parsed.data) });
    } catch (err) {
      if (err instanceof DegradedError) return c.json({ error: err.message }, 503);
      if (err instanceof InvalidInputError) return c.json({ error: err.message }, 400);
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return r;
}

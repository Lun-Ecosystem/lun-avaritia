import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeHarness } from '../testing/harness.ts';
import { DegradedError } from './actions.ts';

describe('/lun/v1/actions', () => {
  function withEcho() {
    const h = makeHarness();
    h.actions.register(
      'test.echo',
      'Renvoie le texte',
      z.object({ text: z.string() }),
      async ({ text }) => ({
        text,
      }),
      'read',
    );
    h.actions.register(
      'test.degraded',
      'Toujours indisponible',
      z.object({}),
      async () => {
        throw new DegradedError('credit');
      },
      'write',
    );
    h.actions.register(
      'test.fails',
      'Échoue',
      z.object({}),
      async () => {
        throw new Error('Mail introuvable');
      },
      'write',
    );
    return h;
  }

  it('lists the actions with a JSON Schema input', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions', { headers: h.auth(token) });
    const { actions } = await res.json();
    const echo = actions.find((a: { name: string }) => a.name === 'test.echo');
    expect(echo.description).toBe('Renvoie le texte');
    expect(echo.input.type).toBe('object');
    expect(echo.input.properties.text.type).toBe('string');
  });

  it('runs an action with a valid body', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/test.echo', {
      method: 'POST',
      headers: h.auth(token),
      body: JSON.stringify({ text: 'salut' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { text: 'salut' } });
  });

  it('answers 404 for an unknown action', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/inconnue', {
      method: 'POST',
      headers: h.auth(token),
      body: '{}',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it('answers 400 for an invalid body', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/test.echo', {
      method: 'POST',
      headers: h.auth(token),
      body: JSON.stringify({ text: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/test.echo', {
      method: 'POST',
      headers: h.auth(token),
      body: 'pas du json',
    });
    expect(res.status).toBe(400);
  });

  it('answers 503 when the action is degraded', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/test.degraded', {
      method: 'POST',
      headers: h.auth(token),
      body: '{}',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it('reports a business failure as ok: false', async () => {
    const h = withEcho();
    const token = await h.pairClient();
    const res = await h.app.request('/lun/v1/actions/test.fails', {
      method: 'POST',
      headers: h.auth(token),
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'Mail introuvable' });
  });
});

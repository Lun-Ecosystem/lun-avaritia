import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, UnauthorizedError } from './api.ts';

const reply = (body: unknown, status = 200, statusText = '') =>
  vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(body), { status, statusText }));

describe('createApi', () => {
  it('sends the device token on every call, and the JSON body', async () => {
    const fetch = reply({ ok: true });
    const api = createApi('http://avaritia.test/', 'tok-1', { fetch });
    expect(await api.get('/api/dashboard')).toEqual({ ok: true });
    await api.send('PATCH', '/api/fiches/f1', { title: 'Projet A' });
    const form = new FormData();
    form.append('file', new Blob(['# Note']), 'note.md');
    await api.upload('/api/depots', form);

    const [[url0, get], [url1, patch], [url2, up]] = fetch.mock.calls as [
      [string, RequestInit],
      [string, RequestInit],
      [string, RequestInit],
    ];
    expect(url0).toBe('http://avaritia.test/api/dashboard');
    expect(url1).toBe('http://avaritia.test/api/fiches/f1');
    expect(url2).toBe('http://avaritia.test/api/depots');
    for (const init of [get, patch, up])
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok-1');
    expect(patch.method).toBe('PATCH');
    expect(JSON.parse(String(patch.body))).toEqual({ title: 'Projet A' });
    expect(new Headers(patch.headers).get('content-type')).toBe('application/json');
    // The browser sets the multipart boundary itself.
    expect(up.method).toBe('POST');
    expect(up.body).toBe(form);
    expect(new Headers(up.headers).get('content-type')).toBeNull();
  });

  it('a 401 calls onUnauthorized once and throws UnauthorizedError', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi('', 'tok-1', {
      fetch: reply({ error: 'Jeton absent, invalide ou révoqué' }, 401),
      onUnauthorized,
    });
    const err = await api.get('/api/dashboard').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('a 409 throws ApiError with the status and the server message', async () => {
    const api = createApi('', 'tok-1', { fetch: reply({ error: 'X' }, 409) });
    const err = await api.send('POST', '/lun/v1/cards/1/accept').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
    expect(err).toMatchObject({ status: 409, message: 'X' });
  });

  it('an error without a JSON body says the status text', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    const api = createApi('', 'tok-1', { fetch });
    await expect(api.get('/api/dashboard')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
  });

  it('an empty answer (204) resolves to undefined', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const api = createApi('', 'tok-1', { fetch });
    expect(await api.send('DELETE', '/api/depots/d1')).toBeUndefined();
  });
});

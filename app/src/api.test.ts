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

  describe('download', () => {
    const zip = (init: ResponseInit = {}) =>
      vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
            status: 200,
            headers: {
              'content-type': 'application/zip',
              'content-disposition': 'attachment; filename="avaritia-export-2026-11-02.zip"',
              'x-avaritia-fiches': '3',
            },
            ...init,
          }),
      );

    it('sends the token and the method, and gives the bytes, the file name and the headers', async () => {
      const fetch = zip();
      const api = createApi('http://avaritia.test/', 'tok-1', { fetch });
      const got = await api.download('POST', '/api/export');
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe('http://avaritia.test/api/export');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok-1');
      expect(got.name).toBe('avaritia-export-2026-11-02.zip');
      expect(got.blob).toBeInstanceOf(Blob);
      expect([...new Uint8Array(await got.blob.arrayBuffer())]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      expect(got.headers.get('x-avaritia-fiches')).toBe('3');
    });

    it('a 401 calls onUnauthorized once and throws UnauthorizedError', async () => {
      const onUnauthorized = vi.fn();
      const api = createApi('', 'tok-1', {
        fetch: reply({ error: 'Jeton absent, invalide ou révoqué' }, 401),
        onUnauthorized,
      });
      const err = await api.download('POST', '/api/export').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });

    it('an error answer throws ApiError with the server message', async () => {
      const api = createApi('', 'tok-1', { fetch: reply({ error: 'Trop gros' }, 413) });
      await expect(api.download('POST', '/api/export')).rejects.toMatchObject({
        status: 413,
        message: 'Trop gros',
      });
    });
  });
});

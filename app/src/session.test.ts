import { describe, expect, it, vi } from 'vitest';
import { clearToken, loadToken, pair, saveToken } from './session.ts';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe('session', () => {
  it('pairs with the 6-digit code and returns the token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ token: 'tok-9', satellite: {} }), { status: 200 }),
    );
    expect(await pair('http://avaritia.test/', ' 042517 ', { fetch })).toBe('tok-9');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://avaritia.test/lun/v1/pair');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ code: '042517', client: "Lun'Avaritia (app)" });
  });

  it('keeps only the digits of a pasted « 482 917 »', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ token: 'tok-9', satellite: {} }), { status: 200 }),
    );
    await pair('', '482 917', { fetch });
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).code).toBe('482917');
  });

  it('reports a refused code without saying whether it existed', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ error: 'Code d’appairage invalide, déjà utilisé ou expiré' }), {
          status: 401,
        }),
    );
    await expect(pair('', '000000', { fetch })).rejects.toThrow(
      'Code incorrect ou expiré. Demander un nouveau code.',
    );
  });

  it('reports another failure with the server message', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ error: 'Corps JSON invalide' }), { status: 400 }),
    );
    await expect(pair('', '000000', { fetch })).rejects.toThrow('Corps JSON invalide');
  });

  it('keeps the token across launches and forgets it on demand', () => {
    const storage = memory();
    expect(loadToken(storage)).toBeNull();
    saveToken(storage, 'tok-9');
    expect(loadToken(storage)).toBe('tok-9');
    clearToken(storage);
    expect(loadToken(storage)).toBeNull();
  });

  it('treats unavailable storage as not paired', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadToken(broken)).toBeNull();
  });
});

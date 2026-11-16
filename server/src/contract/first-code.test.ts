import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { createClient } from './auth.ts';
import { localOriginFor } from './first-code.ts';

const LOCAL = 'http://127.0.0.1:8789';
const REFUSED = { error: 'Pas de code ici' };
type Harness = ReturnType<typeof makeHarness>;

/**
 * `POST /first-code` as the page of this machine sends it; `change` sets or (null) removes headers,
 * `address` is the caller's socket address (null: no socket at all, as in a bare `app.request`).
 */
function ask(h: Harness, change: Record<string, string | null> = {}, address: string | null = '127.0.0.1') {
  const headers = new Headers({ host: '127.0.0.1:8789', origin: LOCAL });
  for (const [name, value] of Object.entries(change))
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  const env = address === null ? undefined : { incoming: { socket: { remoteAddress: address } } };
  return h.app.request('/first-code', { method: 'POST', headers }, env);
}

const count = (h: Harness, table: string) =>
  (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

async function expectRefused(h: Harness, res: Response | Promise<Response>, codesBefore = 0) {
  const r = await res;
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual(REFUSED);
  expect(count(h, 'pairing_codes')).toBe(codesBefore);
  // A refusal is not a code tried: the lock does not count it.
  expect(count(h, 'pairing_failures')).toBe(0);
}

const pairWith = (h: Harness, code: string) =>
  h.app.request('/lun/v1/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, client: 'navigateur' }),
  });

describe('localOriginFor', () => {
  it('gives Avaritia’s address only when it listens on a loopback address or localhost', () => {
    for (const hostname of ['127.0.0.1', 'localhost'])
      expect(localOriginFor(hostname, 8789), hostname).toBe(LOCAL);
    for (const hostname of ['0.0.0.0', '::', '192.168.1.2', '127.exemple.org'])
      expect(localOriginFor(hostname, 8789), hostname).toBeUndefined();
  });
});

describe('POST /first-code', () => {
  it('gives the first code to the page of this machine, a code that pairs once', async () => {
    const h = makeHarness({ localOrigin: LOCAL });
    const res = await ask(h);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { code: string; expiresAt: string };
    expect(body).toEqual({ code: expect.stringMatching(/^\d{6}$/), expiresAt: '2026-11-02T08:10:00.000Z' });
    expect((await pairWith(h, body.code)).status).toBe(200);
    expect((await pairWith(h, body.code)).status).toBe(401);
  });

  it('takes loopback in IPv4, IPv6 and IPv4 written as IPv6', async () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const h = makeHarness({ localOrigin: LOCAL });
      expect((await ask(h, {}, address)).status).toBe(200);
    }
  });

  it('gives the same code while it is valid, a new one 10 minutes later', async () => {
    const h = makeHarness({ localOrigin: LOCAL });
    const code = async () => ((await (await ask(h)).json()) as { code: string }).code;
    const first = await code();
    expect(await code()).toBe(first);
    h.advance(10 * 60_000);
    const next = await code();
    expect(next).not.toBe(first);
    expect(count(h, 'pairing_codes')).toBe(2);
  });

  it('gives nothing once a device is paired', async () => {
    const h = makeHarness({ localOrigin: LOCAL });
    await h.pairClient('phone');
    await expectRefused(h, ask(h), 1);
  });

  it('gives nothing once an app is linked by authorization', async () => {
    const h = makeHarness({ localOrigin: LOCAL });
    createClient(h.db, 'core', 'app', h.clock());
    await expectRefused(h, ask(h));
  });

  it('refuses a caller outside loopback', async () => {
    for (const address of ['192.0.2.10', '2001:db8::1', '::ffff:192.0.2.10']) {
      const h = makeHarness({ localOrigin: LOCAL });
      await expectRefused(h, ask(h, {}, address));
    }
  });

  it('refuses when the socket cannot be read, without a 500', async () => {
    const h = makeHarness({ localOrigin: LOCAL });
    await expectRefused(h, ask(h, {}, null));
  });

  it('refuses a Host that is not Avaritia’s own address', async () => {
    for (const host of ['avaritia.example-tailnet.ts.net', 'localhost:8789', '127.0.0.1:8788', null]) {
      const h = makeHarness({ localOrigin: LOCAL });
      await expectRefused(h, ask(h, { host }));
    }
  });

  it('refuses an Origin absent, null, of another local port or of another site', async () => {
    for (const origin of [
      null,
      'null',
      'http://127.0.0.1:5173',
      'https://example.com',
      'http://localhost:8789',
    ]) {
      const h = makeHarness({ localOrigin: LOCAL });
      await expectRefused(h, ask(h, { origin }));
    }
  });

  it('refuses every relayed request', async () => {
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-user-login']) {
      const h = makeHarness({ localOrigin: LOCAL });
      await expectRefused(h, ask(h, { [header]: '127.0.0.1' }));
    }
  });

  it('refuses when Avaritia does not listen on loopback (no local origin)', async () => {
    const h = makeHarness();
    await expectRefused(h, ask(h));
  });

  it('gives no code at the lock; the next request gives one', async () => {
    const h = makeHarness({ localOrigin: LOCAL });
    for (let i = 0; i < 5; i++) expect((await pairWith(h, '000000')).status).toBe(401);
    expect(h.logs).toContain('Appairage verrouillé : 5 codes faux en 10 min, codes en cours annulés.');
    expect(count(h, 'pairing_codes')).toBe(0);
    const res = await ask(h);
    expect(res.status).toBe(200);
    expect(count(h, 'pairing_codes')).toBe(1);
  });
});

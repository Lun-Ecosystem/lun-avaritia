import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testing/harness.ts';
import { isLoopbackRedirect, readAuthorizationRequest } from './authorize.ts';

const json = { 'content-type': 'application/json' };
const VERIFIER = 'a-verifier-of-enough-length-for-pkce-0123456789';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const REDIRECT = 'http://127.0.0.1:43123/callback';

type Harness = ReturnType<typeof makeHarness>;

function authorizeUrl(params: Record<string, string>): string {
  return `/lun/v1/authorize?${new URLSearchParams(params).toString()}`;
}

async function decide(h: Harness, token: string, decision: 'allow' | 'deny', redirect = REDIRECT) {
  return h.app.request('/api/authorizations', {
    method: 'POST',
    headers: h.auth(token),
    body: JSON.stringify({
      client: "Lun'Anima",
      redirect_uri: redirect,
      state: 'st4te',
      code_challenge: CHALLENGE,
      decision,
    }),
  });
}

async function allowCode(h: Harness, token: string): Promise<string> {
  const res = await decide(h, token, 'allow');
  const { redirect } = (await res.json()) as { redirect: string };
  return new URL(redirect).searchParams.get('code')!;
}

function exchange(h: Harness, code: string, verifier = VERIFIER) {
  return h.app.request('/lun/v1/pair', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ code, code_verifier: verifier, client: 'ignored' }),
  });
}

function failures(h: Harness): number {
  return (h.db.prepare('SELECT COUNT(*) AS n FROM pairing_failures').get() as { n: number }).n;
}

describe('isLoopbackRedirect', () => {
  it('rejects tricky redirect_uri', () => {
    for (const uri of [
      'http://localhost.evil.test/',
      'http://127.0.0.1@evil.test/',
      'https://localhost/',
      'javascript:alert(1)',
      'http://user:pass@127.0.0.1/',
      'http://127.0.0.2/',
      'not a url',
    ])
      expect(isLoopbackRedirect(uri), uri).toBe(false);
    for (const uri of ['http://127.0.0.1:43123/callback', 'http://localhost:8080/', 'http://localhost/x?y=1'])
      expect(isLoopbackRedirect(uri), uri).toBe(true);
  });
});

describe('GET /lun/v1/authorize', () => {
  const valid = { client: "Lun'Anima", redirect_uri: REDIRECT, state: 'st4te', code_challenge: CHALLENGE };

  it('redirects a valid request to the front', async () => {
    const h = makeHarness();
    const res = await h.app.request(authorizeUrl(valid));
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('location')!, 'http://satellite.test');
    expect(target.pathname).toBe('/');
    expect(Object.fromEntries(target.searchParams)).toEqual({ autoriser: '1', ...valid });
  });

  it('answers 400 in plain text, without redirecting, on a bad request', async () => {
    const h = makeHarness();
    for (const params of [
      { ...valid, redirect_uri: 'http://localhost.evil.test/' },
      { client: valid.client, redirect_uri: REDIRECT, state: 'st4te' },
    ]) {
      const res = await h.app.request(authorizeUrl(params));
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect((await res.text()).length).toBeGreaterThan(0);
    }
  });
});

describe('readAuthorizationRequest', () => {
  const valid = { client: "Lun'Anima", redirect_uri: REDIRECT, state: 'st4te', code_challenge: CHALLENGE };

  it('accepts fields at their maximum length', () => {
    expect(readAuthorizationRequest({ ...valid, client: 'c'.repeat(64), state: 's'.repeat(256) })).toEqual({
      request: { ...valid, client: 'c'.repeat(64), state: 's'.repeat(256) },
    });
  });

  it('rejects an overlong client or state and a code_challenge that is not S256', () => {
    for (const [field, value, error] of [
      ['client', 'c'.repeat(65), 'client trop long : 64 caractères au plus'],
      ['state', 's'.repeat(257), 'state trop long : 256 caractères au plus'],
      [
        'code_challenge',
        CHALLENGE.slice(1),
        'code_challenge refusé : 43 caractères base64url attendus (S256)',
      ],
      ['code_challenge', `${CHALLENGE}x`, 'code_challenge refusé : 43 caractères base64url attendus (S256)'],
      [
        'code_challenge',
        `${CHALLENGE.slice(1)}=`,
        'code_challenge refusé : 43 caractères base64url attendus (S256)',
      ],
      ['code_challenge', 'plain-verifier', 'code_challenge refusé : 43 caractères base64url attendus (S256)'],
    ] as const)
      expect(readAuthorizationRequest({ ...valid, [field]: value }), `${field}=${value}`).toEqual({ error });
  });

  it('is enforced by GET /lun/v1/authorize and POST /api/authorizations', async () => {
    const h = makeHarness();
    const res = await h.app.request(authorizeUrl({ ...valid, client: 'c'.repeat(65) }));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    const device = await h.pairClient('phone');
    const post = await h.app.request('/api/authorizations', {
      method: 'POST',
      headers: h.auth(device),
      body: JSON.stringify({ ...valid, code_challenge: 'plain-verifier', decision: 'allow' }),
    });
    expect(post.status).toBe(400);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM authorization_codes').get()).toEqual({ n: 0 });
  });
});

describe('POST /api/authorizations', () => {
  it('issues a code only to a device token', async () => {
    const h = makeHarness();
    const device = await h.pairClient('phone');
    const res = await exchange(h, await allowCode(h, device));
    const { token: appToken } = (await res.json()) as { token: string };
    expect((await decide(h, appToken, 'allow')).status).toBe(403);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM authorization_codes').get()).toEqual({ n: 1 });
  });

  it('revalidates redirect_uri', async () => {
    const h = makeHarness();
    const device = await h.pairClient('phone');
    expect((await decide(h, device, 'allow', 'http://127.0.0.1@evil.test/')).status).toBe(400);
    expect((await decide(h, device, 'deny', 'https://localhost/')).status).toBe(400);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM authorization_codes').get()).toEqual({ n: 0 });
  });

  it('allow then pair with the right verifier creates one app client', async () => {
    const h = makeHarness();
    const device = await h.pairClient('phone');
    const res = await decide(h, device, 'allow');
    expect(res.status).toBe(200);
    const redirect = new URL(((await res.json()) as { redirect: string }).redirect);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('st4te');
    const code = redirect.searchParams.get('code')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const paired = await exchange(h, code);
    expect(paired.status).toBe(200);
    const body = await paired.json();
    expect(body.token).toMatch(/.{32,}/);
    expect(body.satellite).toEqual({ id: 'lunavaritia', nom: "Lun'Avaritia", version: '0.0.0-test' });
    expect(h.db.prepare('SELECT name, kind FROM clients ORDER BY id').all()).toEqual([
      { name: 'phone', kind: 'device' },
      { name: "Lun'Anima", kind: 'app' },
    ]);
    const health = await h.app.request('/lun/v1/health', { headers: h.auth(body.token) });
    expect(health.status).toBe(200);
  });

  it('wrong verifier, expired code (2 min 1 s), reused code: 401, counted as failures', async () => {
    const h = makeHarness();
    const device = await h.pairClient('phone');

    const wrong = await allowCode(h, device);
    expect((await exchange(h, wrong, 'another-verifier-of-enough-length-0123456789')).status).toBe(401);
    expect(failures(h)).toBe(1);

    const expired = await allowCode(h, device);
    h.advance(2 * 60_000 + 1_000);
    expect((await exchange(h, expired)).status).toBe(401);
    expect(failures(h)).toBe(2);

    const reused = await allowCode(h, device);
    expect((await exchange(h, reused)).status).toBe(200);
    const again = await exchange(h, reused);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({
      error: 'Code d’autorisation invalide, déjà utilisé, expiré ou code_verifier faux',
    });
    expect(failures(h)).toBe(3);

    expect((await exchange(h, 'unknown-code')).status).toBe(401);
    expect(failures(h)).toBe(4);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM clients WHERE kind = 'app'").get()).toEqual({ n: 1 });
  });

  it('deny returns error=access_denied and creates nothing', async () => {
    const h = makeHarness();
    const device = await h.pairClient('phone');
    const res = await decide(h, device, 'deny');
    expect(res.status).toBe(200);
    const redirect = new URL(((await res.json()) as { redirect: string }).redirect);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
    expect(Object.fromEntries(redirect.searchParams)).toEqual({ error: 'access_denied', state: 'st4te' });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM authorization_codes').get()).toEqual({ n: 0 });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM clients').get()).toEqual({ n: 1 });
    expect(failures(h)).toBe(0);
  });

  it('the lock also voids pending authorization codes', async () => {
    const h = makeHarness();
    const device = await h.pairClient('phone');
    const pending = await allowCode(h, device);
    for (let i = 0; i < 5; i++)
      await h.app.request('/lun/v1/pair', { method: 'POST', headers: json, body: '{"code":"000000"}' });
    expect(h.logs).toContain('Appairage verrouillé : 5 codes faux en 10 min, codes en cours annulés.');
    expect((await exchange(h, pending)).status).toBe(401);
    // Codes asked afterwards work normally.
    expect((await exchange(h, await allowCode(h, device))).status).toBe(200);
  });
});

describe('app token scope', () => {
  async function appToken(h: Harness): Promise<string> {
    const device = await h.pairClient('phone');
    const res = await exchange(h, await allowCode(h, device));
    return ((await res.json()) as { token: string }).token;
  }

  it('answers 403 to an app token on the /api admin routes', async () => {
    const h = makeHarness({ secretKey: 'k'.repeat(64) });
    const token = await appToken(h);
    const appId = (h.db.prepare("SELECT id FROM clients WHERE kind = 'app'").get() as { id: number }).id;
    for (const [method, path, body] of [
      ['POST', '/api/pairing-codes', null],
      ['DELETE', `/api/clients/${appId}`, null],
      ['PUT', '/api/llm/providers/anthropic/key', JSON.stringify({ key: 'sk-ant-test-0000' })],
      ['DELETE', '/api/llm/providers/anthropic/key', null],
      ['GET', '/api/llm/providers', null],
    ] as const) {
      const res = await h.app.request(path, { method, headers: h.auth(token), body });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toEqual({
        error: 'Réservé aux appareils reliés : une application n’a accès qu’au contrat /lun/v1',
      });
    }
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM pairing_codes WHERE used_at IS NULL').get()).toEqual({
      n: 0,
    });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM clients WHERE revoked_at IS NULL').get()).toEqual({
      n: 2,
    });
    expect(h.keyCheck.calls).toEqual([]);
  });

  it('still lets a device token use /api and an app token use /lun/v1', async () => {
    const h = makeHarness();
    const token = await appToken(h);
    const device = await h.pairClient('laptop');
    expect(
      (await h.app.request('/api/pairing-codes', { method: 'POST', headers: h.auth(device) })).status,
    ).toBe(200);
    expect((await h.app.request('/api/llm/providers', { headers: h.auth(device) })).status).toBe(200);
    expect((await h.app.request('/lun/v1/health', { headers: h.auth(token) })).status).toBe(200);
    expect((await h.app.request('/lun/v1/costs', { headers: h.auth(token) })).status).toBe(200);
    expect((await h.app.request('/lun/v1/pause', { method: 'POST', headers: h.auth(token) })).status).toBe(
      200,
    );
  });

  it('keeps answering 401 to a missing or unknown token', async () => {
    const h = makeHarness();
    expect((await h.app.request('/api/pairing-codes', { method: 'POST' })).status).toBe(401);
    expect((await h.app.request('/api/clients', { headers: h.auth('nope') })).status).toBe(401);
  });
});

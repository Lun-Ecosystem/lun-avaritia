import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createClient } from './auth.ts';

const AUTHORIZATION_CODE_TTL_MS = 2 * 60_000;

/** What `GET /lun/v1/authorize` carries, and what the front sends back with its decision. */
export interface AuthorizationRequest {
  client: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
}

const FIELDS = ['client', 'redirect_uri', 'state', 'code_challenge'] as const;
const MAX_CLIENT = 64;
const MAX_STATE = 256;
/** An S256 challenge: the base64url SHA-256 of the verifier, without padding. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Loopback only: `http:`, host exactly `127.0.0.1` or `localhost`, no credentials, any port. */
export function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    !url.username &&
    !url.password
  );
}

/**
 * The request when every field is a non-empty string, `client` and `state` are not too long,
 * `code_challenge` is an S256 challenge and `redirect_uri` is loopback; else the reason.
 */
export function readAuthorizationRequest(
  input: Record<string, unknown>,
): { request: AuthorizationRequest } | { error: string } {
  const missing = FIELDS.filter((f) => typeof input[f] !== 'string' || !input[f]);
  if (missing.length) return { error: `Paramètres manquants : ${missing.join(', ')}` };
  const request = Object.fromEntries(FIELDS.map((f) => [f, input[f]])) as unknown as AuthorizationRequest;
  if (request.client.length > MAX_CLIENT)
    return { error: `client trop long : ${MAX_CLIENT} caractères au plus` };
  if (request.state.length > MAX_STATE) return { error: `state trop long : ${MAX_STATE} caractères au plus` };
  if (!S256_CHALLENGE.test(request.code_challenge))
    return { error: 'code_challenge refusé : 43 caractères base64url attendus (S256)' };
  if (!isLoopbackRedirect(request.redirect_uri))
    return {
      error: 'redirect_uri refusé : seule une adresse http://127.0.0.1 ou http://localhost est acceptée',
    };
  return { request };
}

/** The front's authorization page, carrying the request. */
export function authorizationPage(request: AuthorizationRequest): string {
  return `/?${new URLSearchParams({ autoriser: '1', ...request }).toString()}`;
}

function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** "Autoriser": a single-use code valid 2 minutes, bound to the request; returns the redirect. */
export function allowAuthorization(db: DatabaseSync, request: AuthorizationRequest, now: Date): string {
  const code = randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO authorization_codes (code, client, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    code,
    request.client,
    request.redirect_uri,
    request.code_challenge,
    new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
  );
  return redirectWith(request.redirect_uri, { code, state: request.state });
}

/** "Refuser": nothing is stored. */
export function denyAuthorization(request: AuthorizationRequest): string {
  return redirectWith(request.redirect_uri, { error: 'access_denied', state: request.state });
}

function matchesChallenge(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * Exchanges an authorization code and its PKCE verifier for an app token, named after the stored
 * client; `null` when the code is unknown, used or expired, or the verifier does not match.
 */
export function exchangeAuthorizationCode(
  db: DatabaseSync,
  code: string,
  verifier: string,
  now: Date,
): { token: string } | null {
  const row = db
    .prepare('SELECT client, code_challenge, expires_at, used_at FROM authorization_codes WHERE code = ?')
    .get(code) as
    { client: string; code_challenge: string; expires_at: string; used_at: string | null } | undefined;
  if (
    !row ||
    row.used_at ||
    new Date(row.expires_at) < now ||
    !matchesChallenge(verifier, row.code_challenge)
  )
    return null;
  db.exec('BEGIN IMMEDIATE');
  try {
    // The `used_at IS NULL` guard keeps a code single-use even if two exchanges race.
    const { changes } = db
      .prepare('UPDATE authorization_codes SET used_at = ? WHERE code = ? AND used_at IS NULL')
      .run(now.toISOString(), code);
    const token = Number(changes) > 0 ? createClient(db, row.client, 'app', now) : null;
    db.exec('COMMIT');
    return token ? { token } : null;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

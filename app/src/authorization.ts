/** What `GET /lun/v1/authorize` carries (server `contract/authorize.ts`). */
export interface AuthorizationRequest {
  client: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
}

const FIELDS = ['client', 'redirect_uri', 'state', 'code_challenge'] as const;

/** An authorization page to show: the request, or why it is refused. */
export type PendingAuthorization = { request: AuthorizationRequest } | { error: string };

/**
 * The authorization request carried by the page address (`/?autoriser=1&…`, sent by
 * `GET /lun/v1/authorize`), or null when the page is not an authorization page. The server checks
 * the request again when the decision is sent.
 */
export function readAuthorization(search: string): PendingAuthorization | null {
  const params = new URLSearchParams(search);
  if (params.get('autoriser') !== '1') return null;
  const values = FIELDS.map((f) => params.get(f) ?? '');
  if (values.some((v) => !v)) return { error: 'Demande d’accès incomplète.' };
  const [client, redirect_uri, state, code_challenge] = values as [string, string, string, string];
  if (!returnHost(redirect_uri))
    return {
      error:
        'Adresse de retour refusée : seule une adresse http://127.0.0.1 ou http://localhost est acceptée.',
    };
  return { request: { client, redirect_uri, state, code_challenge } };
}

/** `host:port` where a loopback `http:` address leads, else null. */
export function returnHost(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  const loopback =
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    !url.username &&
    !url.password;
  return loopback ? `${url.hostname}:${url.port || '80'}` : null;
}

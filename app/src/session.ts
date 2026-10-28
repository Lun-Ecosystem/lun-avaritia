const KEY = 'lunavaritia.token';
const CLIENT = "Lun'Avaritia (app)";

/** The paired token, or null when the device is not paired or storage is unavailable. */
export function loadToken(storage: Storage): string | null {
  try {
    return storage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Keeps the token across launches; with storage blocked it lives in memory for this visit only. */
export function saveToken(storage: Storage, token: string): void {
  try {
    storage.setItem(KEY, token);
  } catch {
    // Paired anyway: the app keeps the token in memory.
  }
}

export function clearToken(storage: Storage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** Said for any refused code: it never tells whether the code existed. */
export const REFUSED_CODE = 'Code incorrect ou expiré. Demander un nouveau code.';

/** Exchanges a one-time pairing code for the device's token. */
export async function pair(
  baseUrl: string,
  code: string,
  opts: { fetch?: typeof fetch } = {},
): Promise<string> {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const res = await doFetch(`${baseUrl.replace(/\/$/, '')}/lun/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.replace(/\D/g, ''), client: CLIENT }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (res.status === 401) throw new Error(REFUSED_CODE);
  if (!res.ok || !body.token) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body.token;
}

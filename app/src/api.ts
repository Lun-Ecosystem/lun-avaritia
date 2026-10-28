/** An error answered by Lun'Avaritia, with its HTTP status (409: already decided elsewhere…). */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The token was refused (revoked or never paired): the device has to pair again. */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  send<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** Posts a form (files): the browser sets its multipart type. */
  upload<T>(path: string, form: FormData): Promise<T>;
}

export interface ApiOptions {
  /** Called when the server refuses the token, so the app can ask to pair again. */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** The HTTP client of the app, for a server at `baseUrl` and the device token. */
export function createApi(baseUrl: string, token: string, opts: ApiOptions = {}): Api {
  const base = baseUrl.replace(/\/$/, '');
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const auth = { authorization: `Bearer ${token}` };

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await doFetch(`${base}${path}`, init);
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const message =
        (json as { error?: string } | undefined)?.error ?? (res.statusText || `Erreur ${res.status}`);
      if (res.status === 401) {
        opts.onUnauthorized?.();
        throw new UnauthorizedError(message);
      }
      throw new ApiError(res.status, message);
    }
    return json as T;
  }

  return {
    get: (path) => call(path, { method: 'GET', headers: auth }),
    send: (method, path, body) =>
      call(path, {
        method,
        headers: { ...auth, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    upload: (path, form) => call(path, { method: 'POST', headers: auth, body: form }),
  };
}

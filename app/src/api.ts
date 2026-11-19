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
  /** Fetches a file: its bytes, the name from `content-disposition`, and the answer's headers. */
  download(method: string, path: string): Promise<{ blob: Blob; name: string; headers: Headers }>;
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

  const parse = (text: string): unknown => {
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Fetches, and turns an error answer into ApiError (401: UnauthorizedError). */
  async function request(path: string, init: RequestInit): Promise<Response> {
    const res = await doFetch(`${base}${path}`, init);
    if (res.ok) return res;
    const json = parse(await res.text()) as { error?: string } | undefined;
    const message = json?.error ?? (res.statusText || `Erreur ${res.status}`);
    if (res.status === 401) {
      opts.onUnauthorized?.();
      throw new UnauthorizedError(message);
    }
    throw new ApiError(res.status, message);
  }

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await request(path, init);
    return parse(await res.text()) as T;
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
    download: async (method, path) => {
      const res = await request(path, { method, headers: auth });
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
      return { blob: await res.blob(), name: name ?? 'avaritia-export.zip', headers: res.headers };
    },
  };
}

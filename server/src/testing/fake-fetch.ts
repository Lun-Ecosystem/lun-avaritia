export interface RecordedCall {
  method: string;
  url: string;
  body: string | undefined;
  headers: Record<string, string>;
}

type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };
export type Handler = (call: RecordedCall) => Reply | undefined;

/**
 * A `fetch` that answers from handlers tried in order (the first one returning a reply wins) and
 * records every call. An unmatched call fails the test loudly.
 */
export function fakeFetch(...handlers: Handler[]) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body === undefined || init.body === null ? undefined : String(init.body);
    const call: RecordedCall = { method: (init?.method ?? 'GET').toUpperCase(), url, body, headers };
    calls.push(call);
    for (const handler of handlers) {
      const reply = handler(call);
      if (!reply) continue;
      const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
      return new Response(reply.status === 204 ? null : text, {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json', ...reply.headers },
      });
    }
    throw new Error(`fakeFetch: no handler for ${call.method} ${url}`);
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

/** Matches a method and a URL prefix. */
export function on(
  method: string,
  urlPrefix: string,
  reply: Reply | ((call: RecordedCall) => Reply),
): Handler {
  return (call) =>
    call.method === method && call.url.startsWith(urlPrefix)
      ? typeof reply === 'function'
        ? reply(call)
        : reply
      : undefined;
}

/** Replies from a queue, one reply per matching call; returns nothing once the queue is empty. */
export function sequence(method: string, urlPrefix: string, replies: Reply[]): Handler {
  const queue = [...replies];
  return (call) =>
    call.method === method && call.url.startsWith(urlPrefix) && queue.length ? queue.shift() : undefined;
}

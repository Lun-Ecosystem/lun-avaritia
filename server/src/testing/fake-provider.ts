import type { LlmProvider } from '../llm/types.ts';

export type JsonRequest = Parameters<LlmProvider['json']>[0];

/**
 * A provider that answers `json` from programmed replies, in order (an `Error` is thrown), and records
 * every request. Running out of replies fails the test loudly.
 */
export function fakeProvider(replies: unknown[], usage = { inputTokens: 1000, outputTokens: 200 }) {
  const calls: JsonRequest[] = [];
  const provider: LlmProvider = {
    id: 'anthropic',
    async json(req) {
      calls.push(req);
      if (!replies.length) throw new Error('fake provider: no reply programmed');
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { value: reply, usage };
    },
    chat: () => Promise.reject(new Error('fake provider: chat not programmed')),
    check: async () => 'ok',
  };
  return { provider, calls };
}

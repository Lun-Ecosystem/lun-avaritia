import { describe, expect, it } from 'vitest';
import { createOpenAiCompatProvider, type OpenAiApi } from './openai-compat.ts';

function fakeClient(reply: unknown) {
  const requests: Record<string, unknown>[] = [];
  const client: OpenAiApi = {
    chat: {
      completions: {
        async create(params) {
          requests.push(params as unknown as Record<string, unknown>);
          if (reply instanceof Error) throw reply;
          return reply as Awaited<ReturnType<OpenAiApi['chat']['completions']['create']>>;
        },
      },
    },
    models: {
      async list() {
        if (reply instanceof Error) throw reply;
        return {};
      },
    },
  };
  return { client, requests };
}

const usage = { prompt_tokens: 10, completion_tokens: 5 };
const answer = (message: object, finish_reason = 'stop') => ({
  choices: [{ message: { role: 'assistant', content: null, ...message }, finish_reason }],
  usage,
});

describe('OpenAI-compatible provider', () => {
  it('openai-compat: maps tool_calls (arguments JSON) to toolCalls', async () => {
    const { client } = fakeClient(
      answer(
        {
          content: 'Je regarde.',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'list_events', arguments: '{"day":"2026-11-02"}' },
            },
          ],
        },
        'tool_calls',
      ),
    );
    const result = await createOpenAiCompatProvider({ id: 'openai', apiKey: 'k', client }).chat({
      model: 'gpt-x',
      system: 'S',
      messages: [{ role: 'user', text: 'Mon agenda ?' }],
      tools: [{ name: 'list_events', description: 'Liste', input: { type: 'object' } }],
      maxTokens: 1000,
    });
    expect(result).toEqual({
      text: 'Je regarde.',
      toolCalls: [{ id: 'c1', name: 'list_events', input: { day: '2026-11-02' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stop: 'tools',
    });
  });

  it('openai-compat: tool messages carry tool_call_id; assistant messages carry tool_calls', async () => {
    const { client, requests } = fakeClient(answer({ content: 'Fini.' }));
    const result = await createOpenAiCompatProvider({ id: 'mistral', apiKey: 'k', client }).chat({
      model: 'm',
      system: 'S',
      messages: [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'c0', name: 'list_mails', input: { n: 1 } }] },
        { role: 'tool', callId: 'c0', content: '[]', isError: false },
      ],
      tools: [{ name: 'list_mails', description: 'Liste', input: { type: 'object' } }],
      maxTokens: 100,
    });
    expect(result.stop).toBe('end');
    expect(requests[0]!.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Q' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c0', type: 'function', function: { name: 'list_mails', arguments: '{"n":1}' } }],
      },
      { role: 'tool', tool_call_id: 'c0', content: '[]' },
    ]);
    expect(requests[0]!.tools).toEqual([
      {
        type: 'function',
        function: { name: 'list_mails', description: 'Liste', parameters: { type: 'object' } },
      },
    ]);
  });

  it('openai-compat: json() sends response_format json_schema', async () => {
    const { client, requests } = fakeClient(answer({ content: '{"a":1}' }));
    const schema = { type: 'object' };
    const result = await createOpenAiCompatProvider({ id: 'google', apiKey: 'k', client }).json({
      model: 'gemini-x',
      system: 'S',
      user: 'U',
      schema,
      maxTokens: 512,
    });
    expect(result).toEqual({ value: { a: 1 }, usage: { inputTokens: 10, outputTokens: 5 } });
    expect(requests[0]).toMatchObject({
      model: 'gemini-x',
      max_tokens: 512,
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'answer', schema } },
    });
  });

  it('openai-compat: json() asks for strict mode only from OpenAI', async () => {
    const formatOf = async (id: 'openai' | 'google' | 'mistral' | 'custom') => {
      const { client, requests } = fakeClient(answer({ content: '{}' }));
      await createOpenAiCompatProvider({ id, apiKey: 'k', baseURL: 'http://x', client }).json({
        model: 'm',
        system: 'S',
        user: 'U',
        schema: {},
        maxTokens: 1,
      });
      return (requests[0]!.response_format as { json_schema: object }).json_schema;
    };
    expect(await formatOf('openai')).toEqual({ name: 'answer', schema: {}, strict: true });
    for (const id of ['google', 'mistral', 'custom'] as const)
      expect(await formatOf(id)).toEqual({ name: 'answer', schema: {} });
  });

  it('openai-compat: keeps a call whose arguments are not JSON, marked invalid', async () => {
    const { client } = fakeClient(
      answer(
        {
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'list_events', arguments: '{"day":' } },
          ],
        },
        'tool_calls',
      ),
    );
    const result = await createOpenAiCompatProvider({ id: 'openai', apiKey: 'k', client }).chat({
      model: 'm',
      system: 'S',
      messages: [{ role: 'user', text: 'Q' }],
      tools: [],
      maxTokens: 10,
    });
    expect(result.stop).toBe('tools');
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'list_events', input: {}, invalidArguments: '{"day":' },
    ]);
  });

  it('openai-compat: max_completion_tokens for OpenAI only, max_tokens elsewhere', async () => {
    const sent = async (id: 'openai' | 'google' | 'mistral' | 'custom') => {
      const { client, requests } = fakeClient(answer({ content: '{}' }));
      const p = createOpenAiCompatProvider({ id, apiKey: 'k', baseURL: 'http://x', client });
      await p.json({ model: 'm', system: 'S', user: 'U', schema: {}, maxTokens: 7 });
      await p.chat({ model: 'm', system: 'S', messages: [], tools: [], maxTokens: 9 });
      return requests.map((r) => ({
        max_tokens: r.max_tokens,
        max_completion_tokens: r.max_completion_tokens,
      }));
    };
    expect(await sent('openai')).toEqual([
      { max_tokens: undefined, max_completion_tokens: 7 },
      { max_tokens: undefined, max_completion_tokens: 9 },
    ]);
    for (const id of ['google', 'mistral', 'custom'] as const)
      expect(await sent(id)).toEqual([
        { max_tokens: 7, max_completion_tokens: undefined },
        { max_tokens: 9, max_completion_tokens: undefined },
      ]);
  });

  it('openai-compat: a custom provider needs a base URL', () => {
    expect(() => createOpenAiCompatProvider({ id: 'custom', apiKey: 'k' })).toThrow();
  });
});

describe('both: errors', () => {
  const json = (reply: unknown) =>
    createOpenAiCompatProvider({ id: 'openai', apiKey: 'k', client: fakeClient(reply).client }).json({
      model: 'm',
      system: 'S',
      user: 'U',
      schema: {},
      maxTokens: 1,
    });

  it('openai-compat: 401/403 → key, 402 or insufficient_quota → credit, unparsable JSON → format', async () => {
    for (const status of [401, 403])
      await expect(json(Object.assign(new Error('no'), { status }))).rejects.toMatchObject({ kind: 'key' });
    await expect(json(Object.assign(new Error('pay'), { status: 402 }))).rejects.toMatchObject({
      kind: 'credit',
    });
    await expect(
      json(Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' })),
    ).rejects.toMatchObject({ kind: 'credit' });
    await expect(json(answer({ content: 'pas du json' }))).rejects.toMatchObject({ kind: 'format' });
    await expect(json(new Error('down'))).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('openai-compat: check() maps a refused key', async () => {
    const refused = Object.assign(new Error('no'), { status: 401 });
    const check = (reply: unknown) =>
      createOpenAiCompatProvider({ id: 'openai', apiKey: 'k', client: fakeClient(reply).client }).check();
    expect(await check({})).toBe('ok');
    expect(await check(refused)).toBe('refused');
    expect(await check(new Error('down'))).toBe('unreachable');
  });
});

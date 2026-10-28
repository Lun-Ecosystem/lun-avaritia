import { describe, expect, it } from 'vitest';
import { createAnthropicProvider, type AnthropicApi } from './anthropic.ts';

function fakeApi(reply: unknown) {
  const requests: Record<string, unknown>[] = [];
  const api: AnthropicApi = {
    messages: {
      async create(params) {
        requests.push(params as unknown as Record<string, unknown>);
        if (reply instanceof Error) throw reply;
        return reply as Awaited<ReturnType<AnthropicApi['messages']['create']>>;
      },
    },
    models: {
      async list() {
        if (reply instanceof Error) throw reply;
        return {};
      },
    },
  };
  return { api, requests };
}

const usage = { input_tokens: 10, output_tokens: 5 };

describe('Anthropic provider', () => {
  it('anthropic: maps tool_use blocks to toolCalls and stop "tools"', async () => {
    const { api, requests } = fakeApi({
      content: [
        { type: 'text', text: 'Je regarde.' },
        { type: 'tool_use', id: 'tu1', name: 'list_events', input: { day: '2026-11-02' } },
      ],
      stop_reason: 'tool_use',
      usage,
    });
    const result = await createAnthropicProvider({ apiKey: 'k', api }).chat({
      model: 'claude-haiku-5-5',
      system: 'S',
      messages: [
        { role: 'user', text: 'Mon agenda ?' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'tu0', name: 'list_mails', input: {} }] },
        { role: 'tool', callId: 'tu0', content: '[]', isError: false },
      ],
      tools: [{ name: 'list_events', description: 'Liste', input: { type: 'object' } }],
      maxTokens: 1000,
    });
    expect(result).toEqual({
      text: 'Je regarde.',
      toolCalls: [{ id: 'tu1', name: 'list_events', input: { day: '2026-11-02' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stop: 'tools',
      replay: expect.any(Array),
    });
    expect(requests[0]!.tools).toEqual([
      { name: 'list_events', description: 'Liste', input_schema: { type: 'object' } },
    ]);
    expect(requests[0]!.messages).toEqual([
      { role: 'user', content: 'Mon agenda ?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu0', name: 'list_mails', input: {} }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu0', content: '[]', is_error: false }],
      },
    ]);
  });

  it('anthropic: an assistant message with replay is sent back verbatim (thinking block kept)', async () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu1', name: 'list_events', input: {} },
    ];
    const first = fakeApi({ content, stop_reason: 'tool_use', usage });
    const provider = createAnthropicProvider({ apiKey: 'k', api: first.api });
    const req = { model: 'm', system: 'S', tools: [], maxTokens: 100 };
    const result = await provider.chat({ ...req, messages: [{ role: 'user', text: 'Q' }] });
    expect(result.replay).toEqual(content);
    expect(first.requests[0]).not.toHaveProperty('thinking');

    await provider.chat({
      ...req,
      messages: [
        { role: 'user', text: 'Q' },
        { role: 'assistant', text: result.text, toolCalls: result.toolCalls, replay: result.replay },
        { role: 'tool', callId: 'tu1', content: '[]', isError: false },
      ],
    });
    expect((first.requests[1]!.messages as unknown[])[1]).toEqual({ role: 'assistant', content });
  });

  it('anthropic: json() sends output_config json_schema and parses the text block', async () => {
    const { api, requests } = fakeApi({
      content: [{ type: 'text', text: '{"a":1}' }],
      stop_reason: 'end_turn',
      usage,
    });
    const schema = { type: 'object' };
    const result = await createAnthropicProvider({ apiKey: 'k', api }).json({
      model: 'claude-haiku-5-5',
      system: 'S',
      user: 'U',
      schema,
      maxTokens: 512,
    });
    expect(result).toEqual({ value: { a: 1 }, usage: { inputTokens: 10, outputTokens: 5 } });
    expect(requests[0]).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 512,
      thinking: { type: 'disabled' },
      system: 'S',
      messages: [{ role: 'user', content: 'U' }],
      output_config: { format: { type: 'json_schema', schema } },
    });
  });

  it('anthropic: json() refuses a cut or refused answer as "format"', async () => {
    const { api } = fakeApi({ content: [], stop_reason: 'refusal', usage });
    await expect(
      createAnthropicProvider({ apiKey: 'k', api }).json({
        model: 'm',
        system: 'S',
        user: 'U',
        schema: {},
        maxTokens: 1,
      }),
    ).rejects.toMatchObject({ kind: 'format' });
  });

  it('anthropic: check() lists the models', async () => {
    expect(await createAnthropicProvider({ apiKey: 'k', api: fakeApi({}).api }).check()).toBe('ok');
    const refused = Object.assign(new Error('invalid x-api-key'), { status: 401 });
    expect(await createAnthropicProvider({ apiKey: 'k', api: fakeApi(refused).api }).check()).toBe('refused');
    expect(await createAnthropicProvider({ apiKey: 'k', api: fakeApi(new Error('down')).api }).check()).toBe(
      'unreachable',
    );
  });
});

describe('both: errors', () => {
  const json = (reply: unknown) =>
    createAnthropicProvider({ apiKey: 'k', api: fakeApi(reply).api }).json({
      model: 'm',
      system: 'S',
      user: 'U',
      schema: {},
      maxTokens: 1,
    });

  it('anthropic: 401/403 → key, 402 or "credit balance" → credit, unparsable JSON → format', async () => {
    for (const status of [401, 403])
      await expect(json(Object.assign(new Error('no'), { status }))).rejects.toMatchObject({ kind: 'key' });
    await expect(json(Object.assign(new Error('billing'), { status: 402 }))).rejects.toMatchObject({
      kind: 'credit',
    });
    await expect(
      json(Object.assign(new Error('Your credit balance is too low'), { status: 400 })),
    ).rejects.toMatchObject({ kind: 'credit' });
    await expect(
      json({ content: [{ type: 'text', text: 'pas du json' }], stop_reason: 'end_turn', usage }),
    ).rejects.toMatchObject({ kind: 'format' });
    await expect(json(new Error('socket hang up'))).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

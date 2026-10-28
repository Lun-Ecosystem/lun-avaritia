import Anthropic from '@anthropic-ai/sdk';
import {
  parseJson,
  ProviderError,
  toProviderError,
  type ChatMessage,
  type ChatResult,
  type LlmProvider,
  type Usage,
} from './types.ts';

/** The slice of the SDK the provider uses, so that tests can stand in for it. */
export interface AnthropicApi {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Pick<Anthropic.Message, 'content' | 'stop_reason' | 'usage'>>;
  };
  models: { list(params: { limit: number }): Promise<unknown> };
}

/** 401 (invalid, revoked or expired key) or 403 (no permission): the key itself is refused. */
export function isKeyRefusedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403;
}

const usageOf = (u: Anthropic.Usage): Usage => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
});

function toParam(m: ChatMessage): Anthropic.MessageParam {
  if (m.role === 'user') return { role: 'user', content: m.text };
  if (m.role === 'tool')
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.callId, content: m.content, is_error: m.isError }],
    };
  // The raw blocks keep the thinking blocks the next tool round needs.
  if (m.replay) return { role: 'assistant', content: m.replay as Anthropic.ContentBlockParam[] };
  return {
    role: 'assistant',
    content: [
      ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
      ...m.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
    ],
  };
}

export function createAnthropicProvider(opts: { apiKey: string; api?: AnthropicApi }): LlmProvider {
  const api: AnthropicApi =
    opts.api ??
    (new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 60_000 }) as unknown as AnthropicApi);

  async function call(params: Anthropic.MessageCreateParamsNonStreaming) {
    try {
      return await api.messages.create(params);
    } catch (err) {
      throw toProviderError(err);
    }
  }

  return {
    id: 'anthropic',

    async json(req) {
      const res = await call({
        model: req.model,
        max_tokens: req.maxTokens,
        thinking: { type: 'disabled' },
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: { type: 'json_schema', schema: req.schema as Record<string, unknown> } },
      });
      if (res.stop_reason !== 'end_turn')
        throw new ProviderError('format', `Réponse inutilisable (${res.stop_reason})`);
      const text = res.content.find((b) => b.type === 'text')?.text ?? '';
      return { value: parseJson(text), usage: usageOf(res.usage) };
    },

    async chat(req): Promise<ChatResult> {
      const res = await call({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages.map(toParam),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input as Anthropic.Tool.InputSchema,
        })),
      });
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const toolCalls = res.content.flatMap((b) =>
        b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [],
      );
      const stop =
        res.stop_reason === 'tool_use' ? 'tools' : res.stop_reason === 'max_tokens' ? 'length' : 'end';
      return { text, toolCalls, usage: usageOf(res.usage), stop, replay: res.content };
    },

    async check() {
      try {
        await api.models.list({ limit: 1 });
        return 'ok';
      } catch (err) {
        return isKeyRefusedError(err) ? 'refused' : 'unreachable';
      }
    },
  };
}

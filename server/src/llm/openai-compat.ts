import OpenAI from 'openai';
import {
  parseJson,
  ProviderError,
  toProviderError,
  type ChatMessage,
  type ChatResult,
  type LlmProvider,
  type ProviderId,
  type ToolCall,
  type Usage,
} from './types.ts';

/** The slice of the SDK the provider uses, so that tests can stand in for it. */
export interface OpenAiApi {
  chat: {
    completions: {
      create(
        params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      ): Promise<Pick<OpenAI.Chat.ChatCompletion, 'choices' | 'usage'>>;
    };
  };
  models: { list(): Promise<unknown> };
}

/** Where each provider serves its OpenAI-compatible API; `openai` keeps the SDK default. */
const BASE_URLS: Partial<Record<ProviderId, string>> = {
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  mistral: 'https://api.mistral.ai/v1',
};

const usageOf = (u: OpenAI.CompletionUsage | undefined): Usage => ({
  inputTokens: u?.prompt_tokens ?? 0,
  outputTokens: u?.completion_tokens ?? 0,
});

function toParam(m: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (m.role === 'user') return { role: 'user', content: m.text };
  // shortcut: the chat-completions tool message has no error flag, the error reads in the content.
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.callId, content: m.content };
  return {
    role: 'assistant',
    content: m.text || null,
    ...(m.toolCalls.length
      ? {
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: c.invalidArguments ?? JSON.stringify(c.input) },
          })),
        }
      : {}),
  };
}

function toolCall(id: string, name: string, args: string): ToolCall {
  try {
    return { id, name, input: JSON.parse(args || '{}') };
  } catch {
    return { id, name, input: {}, invalidArguments: args };
  }
}

export function createOpenAiCompatProvider(opts: {
  id: Exclude<ProviderId, 'anthropic'>;
  apiKey: string;
  baseURL?: string;
  client?: OpenAiApi;
}): LlmProvider {
  const baseURL = opts.baseURL ?? BASE_URLS[opts.id];
  if (opts.id === 'custom' && !baseURL) throw new Error('Adresse du fournisseur requise');
  const client: OpenAiApi =
    opts.client ??
    (new OpenAI({
      apiKey: opts.apiKey,
      maxRetries: 1,
      timeout: 60_000,
      ...(baseURL ? { baseURL } : {}),
    }) as unknown as OpenAiApi);

  // OpenAI's newer models take only `max_completion_tokens`; the other endpoints know `max_tokens`.
  const maxTokens = (n: number) => (opts.id === 'openai' ? { max_completion_tokens: n } : { max_tokens: n });

  async function call(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming) {
    let res: Awaited<ReturnType<OpenAiApi['chat']['completions']['create']>>;
    try {
      res = await client.chat.completions.create(params);
    } catch (err) {
      throw toProviderError(err);
    }
    const choice = res.choices[0];
    if (!choice) throw new ProviderError('format', 'Réponse vide');
    return { choice, usage: usageOf(res.usage) };
  }

  return {
    id: opts.id,

    async json(req) {
      const { choice, usage } = await call({
        model: req.model,
        ...maxTokens(req.maxTokens),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'answer',
            schema: req.schema as Record<string, unknown>,
            // Other OpenAI-compatible endpoints may reject strict mode.
            ...(opts.id === 'openai' ? { strict: true } : {}),
          },
        },
      });
      if (choice.finish_reason !== 'stop')
        throw new ProviderError('format', `Réponse inutilisable (${choice.finish_reason})`);
      return { value: parseJson(choice.message.content ?? ''), usage };
    },

    async chat(req): Promise<ChatResult> {
      const { choice, usage } = await call({
        model: req.model,
        ...maxTokens(req.maxTokens),
        messages: [{ role: 'system', content: req.system }, ...req.messages.map(toParam)],
        ...(req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function' as const,
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.input as Record<string, unknown>,
                },
              })),
            }
          : {}),
      });
      const toolCalls = (choice.message.tool_calls ?? []).flatMap((c) =>
        c.type === 'function' ? [toolCall(c.id, c.function.name, c.function.arguments)] : [],
      );
      const stop =
        choice.finish_reason === 'tool_calls' || toolCalls.length
          ? 'tools'
          : choice.finish_reason === 'length'
            ? 'length'
            : 'end';
      return { text: choice.message.content ?? '', toolCalls, usage, stop };
    },

    async check() {
      try {
        await client.models.list();
        return 'ok';
      } catch (err) {
        return toProviderError(err).kind === 'key' ? 'refused' : 'unreachable';
      }
    },
  };
}

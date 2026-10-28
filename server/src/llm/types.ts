import type { ProviderId } from '../types.ts';

export type { ProviderId };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input. */
  input: object;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /**
   * The raw arguments when the model sent arguments that are not JSON (`input` is then `{}`): the call is
   * kept so that the loop answers it with a tool error instead of losing the whole reply.
   */
  invalidArguments?: string;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /** `ChatResult.replay`, sent back verbatim by the provider that produced it. */
      replay?: unknown;
    }
  | { role: 'tool'; callId: string; content: string; isError: boolean };

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stop: 'end' | 'tools' | 'length';
  /** Provider-specific content (Anthropic: the raw blocks, thinking included) to replay on the next round. */
  replay?: unknown;
}

export interface LlmProvider {
  readonly id: ProviderId;
  /** JSON constrained by `schema`, already parsed. */
  json(req: {
    model: string;
    system: string;
    user: string;
    schema: object;
    maxTokens: number;
  }): Promise<{ value: unknown; usage: Usage }>;
  chat(req: {
    model: string;
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    maxTokens: number;
  }): Promise<ChatResult>;
  /** Free check of a key: `models.list`. */
  check(): Promise<'ok' | 'refused' | 'unreachable'>;
}

/**
 * What a provider failure means for Avaritia: `key` refused, `credit` exhausted, `unavailable` (network,
 * outage, anything else), `format` (an answer that cannot be used).
 */
export class ProviderError extends Error {
  readonly kind: 'key' | 'credit' | 'unavailable' | 'format';
  constructor(kind: ProviderError['kind'], message: string) {
    super(message);
    this.kind = kind;
    this.name = 'ProviderError';
  }
}

/** Maps an SDK error (both SDKs carry `status`, OpenAI also `code`) to a `ProviderError`. */
export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { status?: number; code?: string | null; message?: string };
  const message = e?.message ?? String(err);
  if (e?.status === 401 || e?.status === 403) return new ProviderError('key', message);
  if (e?.status === 402 || e?.code === 'insufficient_quota' || /credit balance/i.test(message))
    return new ProviderError('credit', message);
  return new ProviderError('unavailable', message);
}

/** Parses a JSON answer, or fails as `format`. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('format', 'Réponse hors du format attendu');
  }
}

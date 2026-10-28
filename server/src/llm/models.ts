import type { DatabaseSync } from 'node:sqlite';
import { parisDayStart } from '../util.ts';
import type { CostTier, ModelInfo } from '../types.ts';
import type { ProviderId, Usage } from './types.ts';

export type { CostTier, ModelInfo };

/**
 * Built-in table, prices in dollars per million tokens (standard tier, short prompts), read on 2026-10-26:
 * - Anthropic: Claude model table of the claude-api skill (cached 2026-10-06).
 * - OpenAI: https://developers.openai.com/api/docs/pricing ("Flagship models").
 * - Google: https://ai.google.dev/gemini-api/docs/pricing (paid tier, prompts of 200K tokens or fewer;
 *   gemini-3.8-flash is $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50).
 * - Mistral: https://mistral.ai/pricing gives a price for Mistral Large only; the other models have none.
 * Complete or override with `.env` LLM_PRICES.
 */
export const MODELS: ModelInfo[] = [
  {
    provider: 'anthropic',
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    tools: true,
    price: { input: 0.1, output: 0.5 },
  },
  {
    provider: 'anthropic',
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    tools: true,
    price: { input: 2, output: 10 },
  },
  {
    provider: 'anthropic',
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    tools: true,
    price: { input: 4, output: 20 },
  },
  {
    provider: 'openai',
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    tools: true,
    price: { input: 0.1, output: 0.5 },
  },
  {
    provider: 'openai',
    id: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    tools: true,
    price: { input: 2, output: 10 },
  },
  {
    provider: 'openai',
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    tools: true,
    price: { input: 10, output: 50 },
  },
  {
    provider: 'google',
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    tools: true,
    price: { input: 0.1, output: 0.4 },
  },
  {
    provider: 'google',
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    tools: true,
    price: { input: 0.75, output: 3.75 },
  },
  {
    provider: 'google',
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (aperçu)',
    tools: true,
    price: { input: 2, output: 12 },
  },
  { provider: 'mistral', id: 'mistral-small-latest', label: 'Mistral Small', tools: true },
  { provider: 'mistral', id: 'mistral-medium-latest', label: 'Mistral Medium', tools: true },
  {
    provider: 'mistral',
    id: 'mistral-large-latest',
    label: 'Mistral Large',
    tools: true,
    price: { input: 0.5, output: 1.5 },
  },
];

/** Marker by output price: € under $2, €€ from $2 to under $15, €€€ beyond; null without a price, never 0. */
export function tierOf(m: ModelInfo): CostTier {
  if (!m.price) return null;
  return m.price.output < 2 ? '€' : m.price.output < 15 ? '€€' : '€€€';
}

/** `.env` LLM_PRICES: `{"provider/model":[input, output]}`; an unreadable value is ignored. */
function envPrices(env: NodeJS.ProcessEnv): Record<string, unknown> {
  try {
    return env['LLM_PRICES'] ? (JSON.parse(env['LLM_PRICES']) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// `env` is injectable for tests; `_db` is kept for prices saved in the settings later.
export function priceOf(
  _db: DatabaseSync,
  provider: ProviderId,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): { input: number; output: number } | undefined {
  const o = envPrices(env)[`${provider}/${model}`];
  if (Array.isArray(o) && typeof o[0] === 'number' && typeof o[1] === 'number') {
    return { input: o[0], output: o[1] };
  }
  return MODELS.find((m) => m.provider === provider && m.id === model)?.price;
}

export function costOf(price: { input: number; output: number }, usage: Usage): number {
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/** The models of the configured providers; the agent needs tool calling. Prices include the `.env` ones. */
export function modelsFor(db: DatabaseSync, use: 'tri' | 'agent', configured: ProviderId[]): ModelInfo[] {
  return MODELS.filter((m) => configured.includes(m.provider) && (use === 'tri' || m.tools)).map((m) => {
    const price = priceOf(db, m.provider, m.id);
    const out: ModelInfo = { ...m };
    delete out.price;
    if (price) out.price = price;
    return out;
  });
}

/** Dollars spent for one use since the Paris day started. */
export function spentToday(db: DatabaseSync, purpose: 'tri' | 'agent', now: Date): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM costs WHERE purpose = ? AND at >= ?')
    .get(purpose, parisDayStart(now).toISOString()) as { total: number };
  return row.total;
}

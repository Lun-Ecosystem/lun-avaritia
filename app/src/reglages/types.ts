/* What the model settings read from `/api/llm/*` (the server's `src/types.ts`). */

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'custom';

/** A provider (`GET /api/llm/providers`): never more of its key than the last 4 characters. */
export interface ProviderView {
  id: ProviderId;
  label: string;
  state: 'ok' | 'refused' | 'credit' | 'absent';
  last4?: string;
  /** Declared expiry, `AAAA-MM-JJ`. */
  expires?: string;
  source?: 'saved' | 'env';
  baseUrl?: string;
}

/** A model offered for a use (`GET /api/llm/models?use=`). */
export interface ModelOffer {
  provider: ProviderId;
  id: string;
  label: string;
  price?: { input: number; output: number };
  tier: '€' | '€€' | '€€€' | null;
}

/** The model of a use (`GET /api/llm/choice`). */
export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

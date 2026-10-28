/** Types shared by the contract, the LLM layer and the API of the front. */

export type Importance = 'urgent' | 'normal' | 'low' | 'info' | 'log';

export interface LunEvent {
  id: string;
  type: string;
  importance: Importance;
  at: string;
  title: string;
  data?: unknown;
}

/** The AI providers the user can pick; `custom` is any OpenAI-compatible endpoint. */
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'custom';

/** A provider as the settings show it (`GET /api/llm/providers`): never more of its key than the last 4 characters. */
export interface ProviderView {
  id: ProviderId;
  label: string;
  /** `credit`: the key works but its credit is spent. */
  state: 'ok' | 'refused' | 'credit' | 'absent';
  /** Absent when the key has 4 characters or fewer. */
  last4?: string;
  /** Declared expiry, `AAAA-MM-JJ`. */
  expires?: string;
  /** Where the key in service comes from: saved in the settings or declared in `.env`. */
  source?: 'saved' | 'env';
  /** The custom endpoint's address, without credentials. */
  baseUrl?: string;
}

export interface ModelInfo {
  provider: ProviderId;
  id: string;
  label: string;
  /** The provider documents tool calling for this model. */
  tools: boolean;
  /** Dollars per million tokens; absent when no official price was found (shown « prix inconnu »). */
  price?: { input: number; output: number };
}

/** Marker by output price: € under $2, €€ from $2 to under $15, €€€ beyond; `null` without a price. */
export type CostTier = '€' | '€€' | '€€€' | null;

/** A model offered for a use (`GET /api/llm/models`), with its cost marker. */
export type ModelOffer = ModelInfo & { tier: CostTier };

/** The model of a use (`GET /api/llm/choice`); `null` while nothing is chosen nor configured. */
export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

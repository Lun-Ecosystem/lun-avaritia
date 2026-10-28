import type { DatabaseSync } from 'node:sqlite';
import { emitEvent } from '../contract/events.ts';
import { addDegraded, clearDegraded, getState } from '../contract/state.ts';
import { decrypt, encrypt } from '../crypto.ts';
import { getSetting, putSetting } from '../db.ts';
import type { ModelChoice, ProviderView } from '../types.ts';
import { checkExpiry, isValidDate, warnedKey } from '../keys/expiry.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { modelsFor } from './models.ts';
import { createOpenAiCompatProvider } from './openai-compat.ts';
import type { LlmProvider, ProviderId } from './types.ts';

export const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'google', 'mistral', 'custom'];

/** How each provider is named on screen and in the events. */
export const LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  mistral: 'Mistral',
  custom: 'Point d’accès compatible',
};

export type KeyCheck = 'ok' | 'refused' | 'unreachable';
/** Tries a key without spending anything. */
export type KeyChecker = (id: ProviderId, apiKey: string, baseUrl?: string) => Promise<KeyCheck>;
/** Builds the provider for a key; tests stand in for it. */
export type ProviderFactory = (id: ProviderId, apiKey: string, baseUrl?: string) => LlmProvider;

/** What `.env` declares per provider (see `.env.example`). */
export type LlmEnv = Partial<
  Record<ProviderId, { key?: string | undefined; expires?: string | undefined; baseUrl?: string | undefined }>
>;

export type { ProviderView };
export type Choice = ModelChoice;

const ENV_NAMES: Record<ProviderId, string> = {
  anthropic: 'ANTHROPIC',
  openai: 'OPENAI',
  google: 'GEMINI',
  mistral: 'MISTRAL',
  custom: 'CUSTOM_LLM',
};

/** `<NAME>_API_KEY` and `<NAME>_KEY_EXPIRES` per provider, plus `CUSTOM_LLM_BASE_URL`. */
export function llmEnvFrom(env: NodeJS.ProcessEnv): LlmEnv {
  const out: LlmEnv = {};
  for (const id of PROVIDERS) {
    const name = ENV_NAMES[id];
    out[id] = {
      key: env[`${name}_API_KEY`] || undefined,
      expires: env[`${name}_KEY_EXPIRES`] || undefined,
      baseUrl: id === 'custom' ? env['CUSTOM_LLM_BASE_URL'] || undefined : undefined,
    };
  }
  return out;
}

/** The name of a `.env` expiry variable, for the start-up warnings. */
export const expiresEnvName = (id: ProviderId) => `${ENV_NAMES[id]}_KEY_EXPIRES`;

/** The degraded reason, same convention as `credit` and `google-reauth`. */
export const keyReason = (id: ProviderId) => `${id}-key`;

// The settings of a provider live under `<id>.`: the former `anthropic.*` ones are read as they are.
const keyOf = (id: ProviderId) => `${id}.key`;
const expiresOf = (id: ProviderId) => `${id}.expires`;
/** `refused` from the first refusal until a call works again; kept across restarts. */
const stateOf = (id: ProviderId) => `${id}.keyState`;
const BASE_URL = 'custom.baseUrl';
const isRefused = (db: DatabaseSync, id: ProviderId) =>
  getSetting<'ok' | 'refused'>(db, stateOf(id), 'ok') === 'refused';

/** The key in service: the saved one wins over `.env` until it is replaced. */
export function currentKey(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
  id: ProviderId,
): { key: string; source: 'saved' | 'env' } | undefined {
  const blob = getSetting<string | null>(db, keyOf(id), null);
  if (blob && secretKey) {
    try {
      return { key: decrypt(blob, secretKey), source: 'saved' };
    } catch {
      // Unreadable with this AVARITIA_SECRET_KEY: the `.env` key, if any, takes over.
    }
  }
  const envKey = env[id]?.key;
  return envKey ? { key: envKey, source: 'env' } : undefined;
}

/** The address of the custom endpoint, from where its key comes; `undefined` for the others. */
function baseUrlOf(
  db: DatabaseSync,
  env: LlmEnv,
  id: ProviderId,
  source: 'saved' | 'env',
): string | undefined {
  if (id !== 'custom') return undefined;
  return (
    (source === 'saved' ? getSetting<string | null>(db, BASE_URL, null) : env.custom?.baseUrl) ?? undefined
  );
}

/** A key and, for the custom endpoint, its address: what a provider is built from. */
export function credentials(db: DatabaseSync, secretKey: string | undefined, env: LlmEnv, id: ProviderId) {
  const current = currentKey(db, secretKey, env, id);
  if (!current) return undefined;
  const baseUrl = baseUrlOf(db, env, id, current.source);
  // A custom key without an address cannot serve.
  if (id === 'custom' && !baseUrl) return undefined;
  return { ...current, baseUrl };
}

export const makeProvider: ProviderFactory = (id, apiKey, baseUrl) =>
  id === 'anthropic'
    ? createAnthropicProvider({ apiKey })
    : createOpenAiCompatProvider({ id, apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });

/** The real check: each provider's free `models.list`. */
export const checkWithProvider: KeyChecker = (id, apiKey, baseUrl) =>
  makeProvider(id, apiKey, baseUrl).check();

const built = new WeakMap<ProviderFactory, Map<ProviderId, { sig: string; provider: LlmProvider }>>();

/**
 * The provider for the key in service, looked up at each use: a saved key serves from the next call on,
 * without a restart. `undefined` without a key.
 */
export function providerFor(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
  id: ProviderId,
  make: ProviderFactory = makeProvider,
): LlmProvider | undefined {
  const cred = credentials(db, secretKey, env, id);
  if (!cred) return undefined;
  const sig = `${cred.key}\n${cred.baseUrl ?? ''}`;
  let cache = built.get(make);
  if (!cache) built.set(make, (cache = new Map()));
  const cached = cache.get(id);
  if (cached?.sig === sig) return cached.provider;
  const provider = make(id, cred.key, cred.baseUrl);
  cache.set(id, { sig, provider });
  return provider;
}

/** The providers with a key in service, in the order of `PROVIDERS`. */
export function configuredProviders(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
): ProviderId[] {
  return PROVIDERS.filter((id) => credentials(db, secretKey, env, id));
}

/** Saves a checked key, encrypted, with its declared expiry; the expiry warnings start over. */
export function saveKey(
  db: DatabaseSync,
  secretKey: string,
  id: ProviderId,
  key: string,
  expires?: string,
  baseUrl?: string,
): void {
  putSetting(db, keyOf(id), encrypt(key, secretKey));
  putSetting(db, expiresOf(id), expires ?? null);
  putSetting(db, warnedKey(id), []);
  if (id === 'custom') putSetting(db, BASE_URL, baseUrl ?? null);
}

/** Changes (or clears) the declared expiry of a saved key, the key untouched; a new date's warnings start over. */
export function saveExpiry(db: DatabaseSync, id: ProviderId, expires: string | null): void {
  // The same date again keeps its warnings: J-14 and J-3 are not said twice.
  if (getSetting<string | null>(db, expiresOf(id), null) === expires) return;
  putSetting(db, expiresOf(id), expires);
  putSetting(db, warnedKey(id), []);
}

/** Forgets the saved key and its expiry; without a key nothing is refused any more. */
export function removeKey(db: DatabaseSync, id: ProviderId): void {
  putSetting(db, keyOf(id), null);
  putSetting(db, expiresOf(id), null);
  putSetting(db, warnedKey(id), []);
  putSetting(db, stateOf(id), 'ok');
  if (id === 'custom') putSetting(db, BASE_URL, null);
  clearDegraded(db, keyReason(id));
}

/** The declared expiry of the key in service. */
export function currentExpiry(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
  id: ProviderId,
): string | undefined {
  const current = currentKey(db, secretKey, env, id);
  if (!current) return undefined;
  const expires =
    current.source === 'saved' ? getSetting<string | null>(db, expiresOf(id), null) : env[id]?.expires;
  return expires && isValidDate(expires) ? expires : undefined;
}

/** The expiry warnings of every configured provider: at start, then every hour. */
export function checkKeyExpiries(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
  now: Date,
): void {
  for (const id of configuredProviders(db, secretKey, env))
    checkExpiry(db, now, currentExpiry(db, secretKey, env, id), `Clé ${LABELS[id]}`, id);
}

/**
 * The provider refused the key; one `key.invalid` per change. When the AI work uses it (`pausesAi`), it
 * pauses; another use on another provider leaves it as it is.
 */
export function keyRefused(db: DatabaseSync, id: ProviderId, now: Date, pausesAi = true): void {
  if (pausesAi) addDegraded(db, keyReason(id));
  if (isRefused(db, id)) return;
  putSetting(db, stateOf(id), 'refused');
  emitEvent(
    db,
    {
      type: 'key.invalid',
      importance: 'normal',
      title: pausesAi ? `Clé ${LABELS[id]} refusée : l’IA est en pause` : `Clé ${LABELS[id]} refusée`,
      data: { provider: id },
    },
    now,
  );
}

/** A call went through (or a new key was checked): back in service after a refusal. */
export function keyWorks(db: DatabaseSync, id: ProviderId, now: Date): void {
  if (!isRefused(db, id)) return;
  putSetting(db, stateOf(id), 'ok');
  clearDegraded(db, keyReason(id));
  emitEvent(
    db,
    {
      type: 'key.restored',
      importance: 'log',
      title: `Clé ${LABELS[id]} de nouveau en service`,
      data: { provider: id },
    },
    now,
  );
}

/**
 * The model chosen for a use, if its provider still has a key; otherwise the computed default, never
 * written: the first model of `modelsFor(use)`, so `anthropic/claude-haiku-5-5` (first of the table) as
 * soon as an Anthropic key exists. `tri` is the small model that sorts, `agent` the one that drafts and
 * calls tools. `null` without any key.
 */
export function choiceFor(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
  use: 'tri' | 'agent',
): Choice | null {
  const configured = configuredProviders(db, secretKey, env);
  const saved = getSetting<Choice | null>(db, `llm.${use}`, null);
  if (saved && configured.includes(saved.provider)) return saved;
  const first = modelsFor(db, use, configured)[0];
  return first ? { provider: first.provider, model: first.id } : null;
}

export function saveChoice(db: DatabaseSync, use: 'tri' | 'agent', choice: Choice): void {
  putSetting(db, `llm.${use}`, choice);
}

/** An address as shown: never its user name nor its password (a `.env` one may carry them). */
function withoutCredentials(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = '';
    u.password = '';
    return u.href;
  } catch {
    return undefined;
  }
}

/** What the settings screen shows of one provider; never more of the key than its last 4 characters. */
export function providerView(
  db: DatabaseSync,
  secretKey: string | undefined,
  env: LlmEnv,
  id: ProviderId,
): ProviderView {
  const label = LABELS[id];
  const current = currentKey(db, secretKey, env, id);
  if (!current) return { id, label, state: 'absent' };
  // The credit state comes from the sorting: it is shown on the provider `tri` uses.
  const credit =
    getState(db).degraded.includes('credit') && choiceFor(db, secretKey, env, 'tri')?.provider === id;
  const state = isRefused(db, id) ? 'refused' : credit ? 'credit' : 'ok';
  const expires = currentExpiry(db, secretKey, env, id);
  const baseUrl = withoutCredentials(baseUrlOf(db, env, id, current.source));
  return {
    id,
    label,
    state,
    // A key of 4 characters or fewer would show whole.
    ...(current.key.length > 4 ? { last4: current.key.slice(-4) } : {}),
    ...(expires ? { expires } : {}),
    source: current.source,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function providersView(db: DatabaseSync, secretKey: string | undefined, env: LlmEnv): ProviderView[] {
  return PROVIDERS.map((id) => providerView(db, secretKey, env, id));
}

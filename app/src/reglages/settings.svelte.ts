import { untrack } from 'svelte';
import type { Api } from '../api.ts';
import { takeIdentity } from '../agent/conversation.svelte.ts';
import type { AgentIcon } from '../agent/icons.ts';

/** The settings of `GET|PUT /api/settings`, bounds as the server checks them. */
export interface Settings {
  'drafts.cap': number;
  'cost.monthlyCap': number;
  'agent.name': string;
  'agent.icon': AgentIcon;
  'agent.tone': 'neutre' | 'chaleureux' | 'concis';
  'agent.persona': string;
}
export type SettingKey = keyof Settings;

/** The same bounds as the server: an obvious mistake is said at once, without a call. */
const CHECKS: Partial<{ [K in SettingKey]: (v: Settings[K]) => string | null }> = {
  'drafts.cap': (v) => (Number.isInteger(v) && v >= 1 && v <= 100 ? null : 'Entre 1 et 100.'),
  'cost.monthlyCap': (v) => (Number.isFinite(v) && v >= 0 && v <= 50 ? null : 'Entre 0 et 50 $.'),
  'agent.name': (v) => (v.trim().length >= 1 && v.trim().length <= 40 ? null : 'Entre 1 et 40 caractères.'),
};

/**
 * The settings shown by the cards: each change is saved alone; a refused value (here or by the
 * server) leaves the saved one as it is and is said next to its field.
 */
export class SettingsStore {
  values = $state<Settings | null>(null);
  errors = $state<Partial<Record<SettingKey, string>>>({});
  failure = $state<string | null>(null);
  #api: Api;

  constructor(api: Api) {
    this.#api = api;
  }

  load() {
    this.#api
      .get<{ settings: Settings }>('/api/settings')
      .then((r) => {
        this.values = r.settings;
        takeIdentity({ ...r.settings });
      })
      .catch((e: Error) => (this.failure = e.message));
  }

  /**
   * The saved value a field shows again after a save, or `undefined` while the field holds a refused
   * value: that value stays as typed, next to its error. Only the saved values are followed.
   */
  shown<K extends SettingKey>(key: K): Settings[K] | undefined {
    const values = this.values;
    if (!values || untrack(() => this.errors[key])) return undefined;
    return values[key];
  }

  async save<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    const refused = (CHECKS[key] as ((v: Settings[K]) => string | null) | undefined)?.(value);
    if (refused) {
      this.errors[key] = refused;
      return;
    }
    delete this.errors[key];
    try {
      const r = await this.#api.send<{ settings: Settings }>('PUT', '/api/settings', { [key]: value });
      this.values = r.settings;
      // The bubble and the panel follow at once.
      takeIdentity({ ...r.settings });
    } catch (e) {
      this.errors[key] = e instanceof Error && e.message ? e.message : 'Réglage refusé.';
    }
  }
}

/** « 1,20 » */
export const dollars = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The value of a number field (Svelte gives a number, or `null` once emptied): empty is not 0. */
export const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));

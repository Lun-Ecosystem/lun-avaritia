import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InvalidInputError } from '../contract/actions.ts';
import { getSetting, putSetting } from '../db.ts';

/** The single source of the brain's settings: key, default and validation. */
const SCHEMAS = {
  'drafts.cap': z.number().int().min(1).max(100),
  'cost.monthlyCap': z.number().min(0).max(50),
  'agent.name': z.string().trim().min(1).max(40),
  'agent.icon': z.enum(['sparkles', 'brain', 'book-open', 'library', 'feather', 'moon', 'gem', 'scroll']),
  'agent.tone': z.enum(['neutre', 'chaleureux', 'concis']),
  'agent.persona': z.string().max(500),
};
const DEFAULTS: { [K in keyof typeof SCHEMAS]: z.infer<(typeof SCHEMAS)[K]> } = {
  'drafts.cap': 15,
  'cost.monthlyCap': 5,
  'agent.name': 'Agent',
  'agent.icon': 'sparkles',
  'agent.tone': 'neutre',
  'agent.persona': '',
};
export type Settings = typeof DEFAULTS;

export function setting<K extends keyof Settings>(db: DatabaseSync, key: K): Settings[K] {
  return getSetting(db, key, DEFAULTS[key]);
}

export function readSettings(db: DatabaseSync): Settings {
  return Object.fromEntries(
    (Object.keys(DEFAULTS) as (keyof Settings)[]).map((k) => [k, setting(db, k)]),
  ) as Settings;
}

/** Validates the whole patch first, then saves it: a bad value saves nothing. */
export function saveSettings(db: DatabaseSync, patch: unknown): Settings {
  const parsed = z.strictObject(SCHEMAS).partial().safeParse(patch);
  if (!parsed.success) throw new InvalidInputError(`Réglage invalide : ${parsed.error.message}`);
  for (const [key, value] of Object.entries(parsed.data)) putSetting(db, key, value);
  return readSettings(db);
}

import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InvalidInputError } from '../contract/actions.ts';
import { getSetting, putSetting } from '../db.ts';

/** The single source of the brain's settings: key, default and validation. */
const SCHEMAS = {
  'core.lots': z.boolean(),
  'drafts.cap': z.number().int().min(1).max(100),
  'cost.monthlyCap': z.number().min(0).max(50),
};
const DEFAULTS: { [K in keyof typeof SCHEMAS]: z.infer<(typeof SCHEMAS)[K]> } = {
  'core.lots': true,
  'drafts.cap': 15,
  'cost.monthlyCap': 5,
};
export type Settings = typeof DEFAULTS;

export function setting<K extends keyof Settings>(db: DatabaseSync, key: K): Settings[K] {
  return getSetting(db, key, DEFAULTS[key]);
}

export function readSettings(db: DatabaseSync): Settings {
  return {
    'core.lots': setting(db, 'core.lots'),
    'drafts.cap': setting(db, 'drafts.cap'),
    'cost.monthlyCap': setting(db, 'cost.monthlyCap'),
  };
}

/** Validates the whole patch first, then saves it: a bad value saves nothing. */
export function saveSettings(db: DatabaseSync, patch: unknown): Settings {
  const parsed = z.strictObject(SCHEMAS).partial().safeParse(patch);
  if (!parsed.success) throw new InvalidInputError(`Réglage invalide : ${parsed.error.message}`);
  for (const [key, value] of Object.entries(parsed.data)) putSetting(db, key, value);
  return readSettings(db);
}

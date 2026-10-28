import type { DatabaseSync } from 'node:sqlite';
import { getSetting, putSetting } from '../db.ts';

export type Status = 'ok' | 'paused' | 'degraded';

export interface SatelliteState {
  paused: boolean;
  /** Why the satellite is degraded (`credit`, `key-refused`…); empty when it is not. */
  degraded: string[];
}

export function getState(db: DatabaseSync): SatelliteState {
  return { paused: getSetting(db, 'paused', false), degraded: getSetting<string[]>(db, 'degraded', []) };
}

export function setPaused(db: DatabaseSync, paused: boolean): void {
  putSetting(db, 'paused', paused);
}

export function addDegraded(db: DatabaseSync, reason: string): void {
  const reasons = getState(db).degraded;
  if (!reasons.includes(reason)) putSetting(db, 'degraded', [...reasons, reason]);
}

export function clearDegraded(db: DatabaseSync, reason: string): void {
  putSetting(
    db,
    'degraded',
    getState(db).degraded.filter((r) => r !== reason),
  );
}

/** Degraded wins over paused: the core must learn that something is broken. */
export function statusOf(state: SatelliteState): { status: Status; reason?: string } {
  if (state.degraded.length > 0) return { status: 'degraded', reason: state.degraded.join(', ') };
  return { status: state.paused ? 'paused' : 'ok' };
}

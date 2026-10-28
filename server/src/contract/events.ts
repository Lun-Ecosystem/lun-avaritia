import type { DatabaseSync } from 'node:sqlite';
import type { Importance, LunEvent } from '../types.ts';

export type { Importance, LunEvent };

const RETENTION_MS = 7 * 24 * 3600_000;
const listeners = new Map<DatabaseSync, Set<(e: LunEvent) => void>>();

interface Row {
  id: number;
  type: string;
  importance: Importance;
  at: string;
  title: string;
  data: string | null;
}

function toEvent(row: Row): LunEvent {
  const e: LunEvent = {
    id: String(row.id),
    type: row.type,
    importance: row.importance,
    at: row.at,
    title: row.title,
  };
  if (row.data !== null) e.data = JSON.parse(row.data);
  return e;
}

export function emitEvent(db: DatabaseSync, e: Omit<LunEvent, 'id' | 'at'>, now: Date): LunEvent {
  const info = db
    .prepare('INSERT INTO events (type, importance, at, title, data) VALUES (?, ?, ?, ?, ?)')
    .run(
      e.type,
      e.importance,
      now.toISOString(),
      e.title,
      e.data === undefined ? null : JSON.stringify(e.data),
    );
  const event = toEvent(
    db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid) as unknown as Row,
  );
  for (const listener of listeners.get(db) ?? []) listener(event);
  return event;
}

export function eventsSince(db: DatabaseSync, lastId?: string): LunEvent[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE id > ? ORDER BY id')
    .all(Number(lastId ?? 0)) as unknown as Row[];
  return rows.map(toEvent);
}

/** Calls `listener` for each event emitted from now on; returns the unsubscribe function. */
export function subscribe(db: DatabaseSync, listener: (e: LunEvent) => void): () => void {
  const set = listeners.get(db) ?? new Set();
  set.add(listener);
  listeners.set(db, set);
  return () => set.delete(listener);
}

export function pruneEvents(db: DatabaseSync, now: Date): void {
  db.prepare('DELETE FROM events WHERE at < ?').run(new Date(now.getTime() - RETENTION_MS).toISOString());
}

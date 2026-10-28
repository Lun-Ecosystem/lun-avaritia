import type { DatabaseSync } from 'node:sqlite';

export interface CostItem {
  provider: string;
  model?: string;
  amount: number;
  calls: number;
}

export interface Costs {
  currency: 'USD';
  since: string;
  until: string;
  total: number;
  items: CostItem[];
}

/** Every paid call (LLM, API) is counted here by the satellite itself. */
export function recordCost(db: DatabaseSync, item: CostItem, at: Date, purpose?: 'tri' | 'agent'): void {
  db.prepare('INSERT INTO costs (at, provider, model, amount, calls, purpose) VALUES (?, ?, ?, ?, ?, ?)').run(
    at.toISOString(),
    item.provider,
    item.model ?? null,
    item.amount,
    item.calls,
    purpose ?? null,
  );
}

export function costsSince(db: DatabaseSync, since: Date, until: Date): Costs {
  const rows = db
    .prepare(
      `SELECT provider, model, SUM(amount) AS amount, SUM(calls) AS calls FROM costs
       WHERE at >= ? AND at <= ? GROUP BY provider, model ORDER BY provider, model`,
    )
    .all(since.toISOString(), until.toISOString()) as {
    provider: string;
    model: string | null;
    amount: number;
    calls: number;
  }[];
  const items = rows.map((r) => {
    const item: CostItem = { provider: r.provider, amount: r.amount, calls: r.calls };
    if (r.model !== null) item.model = r.model;
    return item;
  });
  return {
    currency: 'USD',
    since: since.toISOString(),
    until: until.toISOString(),
    total: items.reduce((sum, i) => sum + i.amount, 0),
    items,
  };
}

import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { cardOf, getDraft } from './drafts.ts';

export const DigestSchema = z.object({ since: z.iso.datetime(), until: z.iso.datetime() });

interface DigestItem {
  type: string;
  title: string;
  at: string;
}

/** The day's balance sheet, read only: what arrived, what was decided, what still waits. */
export function digestAction(input: z.infer<typeof DigestSchema>, db: DatabaseSync) {
  const since = new Date(input.since).toISOString();
  const until = new Date(input.until).toISOString();
  const rows = (sql: string) => db.prepare(sql).all(since, until) as Record<string, string | number>[];
  const received: DigestItem[] = [
    ...rows(
      `SELECT l.created_at AS at, (SELECT COUNT(*) FROM observations WHERE lot = l.id) AS n
       FROM lots l WHERE l.created_at >= ? AND l.created_at < ?`,
    ).map((r) => ({ type: 'lot', title: `Lot de ${r.n} observation(s)`, at: String(r.at) })),
    ...rows('SELECT created_at AS at, name FROM depots WHERE created_at >= ? AND created_at < ?').map((r) =>
      r.name === 'note'
        ? { type: 'note', title: 'Note', at: String(r.at) }
        : { type: 'depot', title: String(r.name), at: String(r.at) },
    ),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const done = rows(
    `SELECT id, decided_at AS at FROM drafts
     WHERE status IN ('done', 'refused') AND decided_at >= ? AND decided_at < ? ORDER BY decided_at`,
  ).map((r) => {
    const card = cardOf(db, getDraft(db, Number(r.id))!);
    return {
      type: card.status === 'done' ? 'draft.applied' : 'draft.refused',
      title: card.title,
      at: String(r.at),
    };
  });
  const pending = (
    db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE status = 'pending'").get() as { n: number }
  ).n;
  return { since, until, received, done, pending };
}

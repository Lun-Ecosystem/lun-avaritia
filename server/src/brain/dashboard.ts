import type { DatabaseSync } from 'node:sqlite';
import { lastRun, type LastRun } from './ingest.ts';
import { monthSpend, overCap } from './process.ts';
import { setting } from './settings.ts';

export interface Dashboard {
  lastRun: LastRun | undefined;
  pending: { drafts: number; contradictions: number; doublons: number };
  /** Kept fiches (merged ones don't count): the rail counter. */
  fiches: number;
  /** Lots held by the monthly cap only: the Tableau's banner names the cap. */
  heldLots: number;
  monthSpend: number;
  /** The monthly cost cap, shown beside the spend. */
  monthlyCap: number;
  recent: ActivityLine[];
  /** There is more activity than `recent` shows: `GET /api/activity` has the rest. */
  recentMore: boolean;
}

export interface ActivityLine {
  at: string;
  what: string;
}

const RECENT = 5;
export const ACTIVITY_PAGE = 20;

const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const PENDING = "status IN ('pending', 'applying')";

/** The events of the memory, newest first; one line more is read to know whether others follow. */
export function activity(
  db: DatabaseSync,
  limit: number,
  offset: number,
): { items: ActivityLine[]; more: boolean } {
  const rows = db
    .prepare(
      `SELECT at, what FROM (
           SELECT decided_at AS at,
                  CASE status WHEN 'done' THEN 'Brouillon appliqué (' ELSE 'Brouillon refusé (' END || kind || ')' AS what
             FROM drafts WHERE status IN ('done', 'refused') AND decided_at IS NOT NULL
           UNION ALL SELECT created_at, 'Dépôt ajouté : ' || name FROM depots
           UNION ALL SELECT r.at, CASE l.status WHEN 'done' THEN 'Lot traité (n° ' ELSE 'Lot en échec (n° ' END || l.id || ')'
             FROM runs r JOIN lots l ON l.id = r.lot WHERE l.status IN ('done', 'failed')
         ) ORDER BY at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit + 1, offset) as unknown as ActivityLine[];
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

export function dashboard(db: DatabaseSync, now: Date): Dashboard {
  const recent = activity(db, RECENT, 0);
  return {
    lastRun: lastRun(db),
    pending: {
      drafts: count(db, `SELECT COUNT(*) AS n FROM drafts WHERE ${PENDING}`),
      // A fiche draft that replaces a fact is a contradiction too (same rule as the queue).
      contradictions: count(
        db,
        `SELECT COUNT(*) AS n FROM drafts WHERE ${PENDING} AND (kind = 'contradiction' OR (kind = 'fiche' AND
           EXISTS (SELECT 1 FROM json_each(payload, '$.facts') WHERE json_extract(value, '$.replaces') IS NOT NULL)))`,
      ),
      doublons: count(db, `SELECT COUNT(*) AS n FROM drafts WHERE ${PENDING} AND kind = 'doublon'`),
    },
    fiches: count(db, 'SELECT COUNT(*) AS n FROM fiches WHERE merged_into IS NULL'),
    // The cap raised, a lot held at it waits for the next one (ingest.ts): the cap is no longer reached.
    heldLots: overCap(db, now)
      ? count(db, "SELECT COUNT(*) AS n FROM lots WHERE status = 'held' AND reason = 'cost-cap'")
      : 0,
    monthSpend: monthSpend(db, now),
    monthlyCap: setting(db, 'cost.monthlyCap'),
    recent: recent.items,
    recentMore: recent.more,
  };
}

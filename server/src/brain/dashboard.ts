import type { DatabaseSync } from 'node:sqlite';
import { lastRun, type LastRun } from './ingest.ts';
import { monthSpend } from './process.ts';

export interface Dashboard {
  lastRun: LastRun | undefined;
  pending: { drafts: number; contradictions: number; doublons: number };
  heldLots: number;
  monthSpend: number;
  recent: { at: string; what: string }[];
}

const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const PENDING = "status IN ('pending', 'applying')";

export function dashboard(db: DatabaseSync, now: Date): Dashboard {
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
    heldLots: count(db, "SELECT COUNT(*) AS n FROM lots WHERE status = 'held'"),
    monthSpend: monthSpend(db, now),
    recent: db
      .prepare(
        `SELECT at, what FROM (
           SELECT decided_at AS at,
                  CASE status WHEN 'done' THEN 'Brouillon appliqué (' ELSE 'Brouillon refusé (' END || kind || ')' AS what
             FROM drafts WHERE status IN ('done', 'refused') AND decided_at IS NOT NULL
           UNION ALL SELECT created_at, 'Dépôt ajouté : ' || name FROM depots
           UNION ALL SELECT r.at, CASE l.status WHEN 'done' THEN 'Lot traité (n° ' ELSE 'Lot en échec (n° ' END || l.id || ')'
             FROM runs r JOIN lots l ON l.id = r.lot WHERE l.status IN ('done', 'failed')
         ) ORDER BY at DESC LIMIT 10`,
      )
      .all() as unknown as { at: string; what: string }[],
  };
}

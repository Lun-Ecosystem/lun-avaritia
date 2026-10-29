import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InvalidInputError } from '../contract/actions.ts';
import type { Source } from '../types.ts';
import { parisDay } from '../util.ts';
import { ImportedNoteSchema } from './obsidian.ts';
import { addFact, createFiche, editFiche, getFiche, link, listTypes, reindex, strikeFact } from './store.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped SQLite rows, mapped to typed values below
type Row = Record<string, any>;

/** The card was already treated (HTTP 409). */
export class ConflictError extends Error {
  constructor(message = 'Carte déjà traitée') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** No such draft (HTTP 404). */
export class NotFoundError extends Error {
  constructor() {
    super('Carte inconnue');
    this.name = 'NotFoundError';
  }
}

const SourceSchema = z.object({
  kind: z.enum(['core', 'note', 'depot', 'import']),
  origin: z.string().optional(),
  ref: z.string().optional(),
  at: z.string(),
});
const id = z.number().int().positive();
/** A real calendar day: `z.iso.date()` alone lets 30 February through. */
export const DaySchema = z.iso
  .date()
  .refine((d) => new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d, 'Jour inexistant');

export const DraftPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fiche'),
    ficheId: id.optional(),
    typeId: id,
    title: z.string(),
    synthesis: z.string(),
    // `replaces`: an active fact of the same fiche that the new fact supersedes (struck on apply).
    // `due`: the day a thing to do is due, only when the note said a date.
    facts: z.array(
      z.object({
        text: z.string().min(1),
        source: SourceSchema,
        replaces: id.optional(),
        due: DaySchema.optional(),
      }),
    ),
    links: z.array(z.object({ to: z.union([id, z.string().min(1)]), relation: z.string().min(1) })),
  }),
  z.object({ kind: z.literal('contradiction'), ficheId: id, keep: id, strike: id, reason: z.string() }),
  z.object({ kind: z.literal('doublon'), keep: id, merge: id, reason: z.string() }),
  z.object({ kind: z.literal('import'), fiches: z.array(ImportedNoteSchema), warnings: z.array(z.string()) }),
]);
export type DraftPayload = z.infer<typeof DraftPayloadSchema>;

export type DraftStatus = 'pending' | 'applying' | 'done' | 'refused' | 'failed';

export interface Draft {
  id: number;
  payload: DraftPayload;
  origin: { lot?: number; source: Source['kind'] };
  status: DraftStatus;
  createdAt: string;
  decidedAt?: string;
  error?: string;
  /** An enrichment whose synthesis was left alone because the user edited the fiche since. */
  skippedSynthesis: boolean;
  warnings: string[];
}

export interface Card {
  id: string;
  action: string;
  effect: 'write' | 'delete';
  title: string;
  lines: string[];
  status: 'pending' | 'done' | 'refused' | 'failed' | 'expired';
  at: string;
  error?: string;
}

const toDraft = (r: Row): Draft => ({
  id: r.id,
  payload: JSON.parse(r.payload) as DraftPayload,
  origin: { ...(r.lot !== null && { lot: r.lot as number }), source: r.origin },
  status: r.status,
  createdAt: r.created_at,
  ...(r.decided_at !== null && { decidedAt: r.decided_at as string }),
  ...(r.error !== null && { error: r.error as string }),
  skippedSynthesis: r.skipped_synthesis === 1,
  warnings: JSON.parse(r.warnings) as string[],
});

function parsePayload(raw: unknown): DraftPayload {
  const p = DraftPayloadSchema.safeParse(raw);
  if (!p.success) throw new InvalidInputError(`Brouillon invalide : ${p.error.message}`);
  if (p.data.kind === 'doublon' && p.data.keep === p.data.merge)
    throw new InvalidInputError('Une fiche ne fusionne pas avec elle-même.');
  return p.data;
}

export function addDraft(
  db: DatabaseSync,
  payload: DraftPayload,
  origin: { lot?: number; source: Source['kind'] },
  now: string,
): number {
  const p = parsePayload(payload);
  return Number(
    db
      .prepare('INSERT INTO drafts (kind, payload, lot, origin, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.kind, JSON.stringify(p), origin.lot ?? null, origin.source, now).lastInsertRowid,
  );
}

export function getDraft(db: DatabaseSync, draftId: number): Draft | undefined {
  const r = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId) as Row | undefined;
  return r && toDraft(r);
}

/** Pending drafts shown first: contradictions, then duplicates, then the rest; the surplus waits. */
export function queue(db: DatabaseSync, limit: number): Draft[] {
  return (
    db
      .prepare(
        `SELECT * FROM drafts WHERE status IN ('pending', 'applying')
          ORDER BY CASE
            WHEN kind = 'contradiction' THEN 0
            WHEN kind = 'fiche' AND EXISTS (SELECT 1 FROM json_each(payload, '$.facts')
                                            WHERE json_extract(value, '$.replaces') IS NOT NULL) THEN 0
            WHEN kind = 'doublon' THEN 1 ELSE 2 END, id LIMIT ?`,
      )
      .all(limit) as Row[]
  ).map(toDraft);
}

export function draftsByStatus(db: DatabaseSync, status: DraftStatus): Draft[] {
  return (db.prepare('SELECT * FROM drafts WHERE status = ? ORDER BY id DESC').all(status) as Row[]).map(
    toDraft,
  );
}

type Warn = (w: string) => void;

/** A fiche id, or the oldest live fiche of that title (case-insensitive), or undefined. */
function resolve(db: DatabaseSync, to: number | string): number | undefined {
  const r =
    typeof to === 'number'
      ? db.prepare('SELECT id FROM fiches WHERE id = ? AND merged_into IS NULL').get(to)
      : db
          .prepare('SELECT id FROM fiches WHERE lower(title) = lower(?) AND merged_into IS NULL ORDER BY id')
          .get(to);
  return (r as Row | undefined)?.id;
}

function applyFiche(
  db: DatabaseSync,
  d: Draft,
  p: Extract<DraftPayload, { kind: 'fiche' }>,
  now: string,
  warn: Warn,
) {
  let ficheId = p.ficheId;
  let skipped = false;
  if (ficheId === undefined) {
    ficheId = createFiche(db, { typeId: p.typeId, title: p.title, synthesis: p.synthesis }, now);
  } else {
    const f = getFiche(db, ficheId);
    if (!f || f.mergedInto !== undefined) throw new InvalidInputError('Fiche absente.');
    if (p.synthesis && p.synthesis !== f.synthesis) {
      // Edited after the draft was written: the user's text wins.
      const edited = db.prepare('SELECT user_edited_at AS at FROM fiches WHERE id = ?').get(ficheId) as Row;
      if (edited.at !== null && edited.at > d.createdAt) skipped = true;
      else editFiche(db, ficheId, { synthesis: p.synthesis }, now, 'agent');
    }
  }
  for (const f of p.facts) {
    if (f.replaces !== undefined) {
      const old = db.prepare('SELECT fiche_id, struck_at FROM facts WHERE id = ?').get(f.replaces) as
        Row | undefined;
      if (!old || old.fiche_id !== ficheId || old.struck_at !== null)
        throw new InvalidInputError(`Le fait remplacé n° ${f.replaces} n'est plus actif sur cette fiche.`);
    }
    const added = addFact(db, ficheId, f.text, f.source as Source, now, f.due);
    if (f.replaces !== undefined) strikeFact(db, f.replaces, added, now);
  }
  for (const l of p.links) {
    const target = resolve(db, l.to);
    if (target === undefined) warn(`Lien « ${l.relation} » vers « ${l.to} » : fiche introuvable.`);
    else if (target !== ficheId) link(db, ficheId, target, l.relation);
  }
  return skipped;
}

function applyImport(
  db: DatabaseSync,
  p: Extract<DraftPayload, { kind: 'import' }>,
  now: string,
  warn: Warn,
) {
  const types = listTypes(db);
  const typeId = (types.find((t) => t.name === 'Note') ?? types[0])?.id;
  if (typeId === undefined) throw new InvalidInputError('Aucun type de fiche.');
  const byTitle = new Map<string, number>();
  const ids = p.fiches.map((n) => {
    const fid = createFiche(db, { typeId, title: n.title, synthesis: n.body }, now);
    if (!byTitle.has(n.title.toLowerCase())) byTitle.set(n.title.toLowerCase(), fid);
    return fid;
  });
  p.fiches.forEach((n, i) => {
    for (const t of n.links) {
      const target = byTitle.get(t.toLowerCase()) ?? resolve(db, t);
      if (target === undefined) warn(`« ${n.title} » : lien vers « ${t} » introuvable.`);
      else if (target !== ids[i]) link(db, ids[i]!, target, 'mentionne');
    }
  });
}

function applyContradiction(
  db: DatabaseSync,
  p: Extract<DraftPayload, { kind: 'contradiction' }>,
  now: string,
) {
  const owned = (fact: number) =>
    !!db.prepare('SELECT 1 FROM facts WHERE id = ? AND fiche_id = ?').get(fact, p.ficheId);
  if (!owned(p.keep) || !owned(p.strike)) throw new InvalidInputError('Fait absent de cette fiche.');
  if (p.keep === p.strike) throw new InvalidInputError('Un fait ne se barre pas lui-même.');
  const active = (fact: number) =>
    !!db.prepare('SELECT 1 FROM facts WHERE id = ? AND struck_at IS NULL').get(fact);
  if (!active(p.strike)) throw new InvalidInputError('Le fait à barrer l’est déjà.');
  if (!active(p.keep)) throw new InvalidInputError('Le fait à garder n’est plus actif.');
  strikeFact(db, p.strike, p.keep, now);
}

function applyDoublon(db: DatabaseSync, p: Extract<DraftPayload, { kind: 'doublon' }>, now: string) {
  if (p.keep === p.merge) throw new InvalidInputError('Une fiche ne fusionne pas avec elle-même.');
  for (const f of [p.keep, p.merge]) {
    const fiche = getFiche(db, f);
    if (!fiche) throw new InvalidInputError('Fiche absente.');
    if (fiche.mergedInto !== undefined)
      throw new InvalidInputError(`La fiche « ${fiche.title} » est déjà fusionnée.`);
  }
  db.prepare('UPDATE facts SET fiche_id = ? WHERE fiche_id = ?').run(p.keep, p.merge);
  db.prepare('UPDATE OR IGNORE links SET from_id = ? WHERE from_id = ?').run(p.keep, p.merge);
  db.prepare('UPDATE OR IGNORE links SET to_id = ? WHERE to_id = ?').run(p.keep, p.merge);
  // What could not move is a duplicate of a link the kept fiche has; links between the two become self-links.
  db.prepare('DELETE FROM links WHERE from_id = ? OR to_id = ? OR from_id = to_id').run(p.merge, p.merge);
  db.prepare('UPDATE fiches SET merged_into = ?, updated_at = ? WHERE id = ?').run(p.keep, now, p.merge);
  reindex(db, p.merge);
  reindex(db, p.keep);
}

/** Validates, then writes in one transaction; the claim on `pending` makes a second caller fail. */
export function applyDraft(
  db: DatabaseSync,
  draftId: number,
  input: unknown | undefined,
  now: string,
): Draft {
  const current = getDraft(db, draftId);
  if (!current) throw new NotFoundError();
  let payload = current.payload;
  if (input !== undefined) {
    payload = parsePayload(input);
    if (payload.kind !== current.payload.kind)
      throw new InvalidInputError('Le type de brouillon ne change pas.');
  }
  const warnings: string[] = payload.kind === 'import' ? [...payload.warnings] : [];
  let skipped = false;
  // The claim and the writes share one transaction: any error rolls both back, the draft stays pending.
  db.exec('BEGIN');
  try {
    const claim = db
      .prepare("UPDATE drafts SET status = 'applying' WHERE id = ? AND status = 'pending'")
      .run(draftId);
    if (!claim.changes) throw new ConflictError();
    const warn: Warn = (w) => warnings.push(w);
    if (payload.kind === 'fiche') skipped = applyFiche(db, current, payload, now, warn);
    else if (payload.kind === 'import') applyImport(db, payload, now, warn);
    else if (payload.kind === 'contradiction') applyContradiction(db, payload, now);
    else applyDoublon(db, payload, now);
    db.prepare(
      "UPDATE drafts SET status = 'done', payload = ?, decided_at = ?, skipped_synthesis = ?, warnings = ? WHERE id = ?",
    ).run(JSON.stringify(payload), now, skipped ? 1 : 0, JSON.stringify(warnings), draftId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getDraft(db, draftId)!;
}

export function refuseDraft(db: DatabaseSync, draftId: number, now: string): Draft {
  const r = db
    .prepare("UPDATE drafts SET status = 'refused', decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(now, draftId);
  if (!r.changes) throw getDraft(db, draftId) ? new ConflictError() : new NotFoundError();
  return getDraft(db, draftId)!;
}

const CARD_STATUS: Record<DraftStatus, Card['status']> = {
  pending: 'pending',
  applying: 'pending',
  done: 'done',
  refused: 'refused',
  failed: 'failed',
};

/** The card a human reads: names and texts, not ids. */
export function cardOf(db: DatabaseSync, d: Draft): Card {
  const p = d.payload;
  const ficheTitle = (n: number) =>
    ((db.prepare('SELECT title FROM fiches WHERE id = ?').get(n) as Row | undefined)?.title as string) ??
    `fiche n° ${n}`;
  const factText = (n: number) =>
    ((db.prepare('SELECT text FROM facts WHERE id = ?').get(n) as Row | undefined)?.text as string) ??
    `fait n° ${n}`;
  const lines: string[] = [];
  let title: string;
  if (p.kind === 'fiche') {
    title = p.ficheId === undefined ? `Nouvelle fiche : ${p.title}` : `Enrichir la fiche : ${p.title}`;
    if (p.synthesis) lines.push(`Synthèse : ${p.synthesis}`);
    for (const f of p.facts) {
      lines.push(
        f.replaces === undefined ? `Fait : ${f.text}` : `Remplace : ${factText(f.replaces)} → ${f.text}`,
      );
      if (f.due !== undefined) lines.push(`Échéance : ${parisDay(`${f.due}T12:00:00Z`)}`);
    }
    for (const l of p.links)
      lines.push(`Lien : ${l.relation} → ${typeof l.to === 'number' ? ficheTitle(l.to) : l.to}`);
    if (d.skippedSynthesis) lines.push('Synthèse non appliquée : la fiche a été modifiée depuis.');
  } else if (p.kind === 'contradiction') {
    title = `Contradiction sur la fiche : ${ficheTitle(p.ficheId)}`;
    lines.push(`Garder : ${factText(p.keep)}`, `Barrer : ${factText(p.strike)}`, `Raison : ${p.reason}`);
  } else if (p.kind === 'doublon') {
    title = `Doublon probable : ${ficheTitle(p.keep)} et ${ficheTitle(p.merge)}`;
    lines.push(
      `Garder la fiche : ${ficheTitle(p.keep)}`,
      `Fusionner dedans : ${ficheTitle(p.merge)}`,
      `Raison : ${p.reason}`,
    );
  } else {
    title = `Import de ${p.fiches.length} note${p.fiches.length > 1 ? 's' : ''}`;
    for (const n of p.fiches.slice(0, 10)) lines.push(`Note : ${n.title}`);
    if (p.fiches.length > 10) lines.push(`… et ${p.fiches.length - 10} autres`);
  }
  for (const w of d.warnings) lines.push(`Attention : ${w}`);
  return {
    id: String(d.id),
    action: `brain.${p.kind}`,
    effect: 'write',
    title,
    lines,
    status: CARD_STATUS[d.status],
    at: d.createdAt,
    ...(d.error && { error: d.error }),
  };
}

export interface DraftView {
  id: number;
  kind: DraftPayload['kind'];
  card: Card;
  payload: DraftPayload;
  /** Title of each fiche the payload cites, by id. */
  names: Record<string, string>;
  /** Text of each fact the payload cites (keep, strike, replaces), by id. */
  facts: Record<string, { text: string; struck: boolean }>;
  createdAt: string;
  origin: Draft['origin'];
}

export function draftView(db: DatabaseSync, d: Draft): DraftView {
  const p = d.payload;
  const ficheIds: number[] = [];
  const factIds: number[] = [];
  if (p.kind === 'fiche') {
    if (p.ficheId !== undefined) ficheIds.push(p.ficheId);
    for (const l of p.links) if (typeof l.to === 'number') ficheIds.push(l.to);
    for (const f of p.facts) if (f.replaces !== undefined) factIds.push(f.replaces);
  } else if (p.kind === 'contradiction') {
    ficheIds.push(p.ficheId);
    factIds.push(p.keep, p.strike);
  } else if (p.kind === 'doublon') ficheIds.push(p.keep, p.merge);
  const names: DraftView['names'] = {};
  for (const n of ficheIds) {
    const r = db.prepare('SELECT title FROM fiches WHERE id = ?').get(n) as Row | undefined;
    if (r) names[n] = r.title;
  }
  const facts: DraftView['facts'] = {};
  for (const n of factIds) {
    const r = db.prepare('SELECT text, struck_at FROM facts WHERE id = ?').get(n) as Row | undefined;
    if (r) facts[n] = { text: r.text, struck: r.struck_at !== null };
  }
  return {
    id: d.id,
    kind: p.kind,
    card: cardOf(db, d),
    payload: p,
    names,
    facts,
    createdAt: d.createdAt,
    origin: d.origin,
  };
}

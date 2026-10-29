import type { Tone } from '../lib/ui/index.ts';

/** A draft of the queue, as `GET /api/drafts` serves it (`DraftView` of the server). */

interface Source {
  kind: string;
  origin?: string;
  ref?: string;
  at: string;
}
export type FicheDraft = {
  kind: 'fiche';
  ficheId?: number;
  typeId: number;
  title: string;
  synthesis: string;
  facts: { text: string; source: Source; replaces?: number; due?: string }[];
  links: { to: number | string; relation: string }[];
};
export type DraftPayload =
  | FicheDraft
  | { kind: 'contradiction'; ficheId: number; keep: number; strike: number; reason: string }
  | { kind: 'doublon'; keep: number; merge: number; reason: string }
  | {
      kind: 'import';
      fiches: { title: string; body: string; links: string[]; frontmatter: Record<string, string> }[];
      warnings: string[];
    };

export interface DraftView {
  id: number;
  kind: DraftPayload['kind'];
  card: { title: string };
  payload: DraftPayload;
  /** Fiche id → title, for the fiches the draft names. */
  names: Record<number, string>;
  /** Fact id → text, for the facts the draft names. */
  facts: Record<number, { text: string; struck: boolean }>;
  createdAt: string;
}

export const replacesFact = (p: DraftPayload) =>
  p.kind === 'fiche' && p.facts.some((f) => f.replaces !== undefined);

/** The label of a draft and its tone, as on the dashboard. */
export function kindOf(p: DraftPayload): { label: string; tone: Tone } {
  if (p.kind === 'contradiction' || replacesFact(p)) return { label: 'contradiction', tone: 'danger' };
  if (p.kind === 'doublon') return { label: 'doublon', tone: 'accent' };
  if (p.kind === 'import') return { label: 'import', tone: 'neutre' };
  return p.ficheId === undefined
    ? { label: 'nouvelle fiche', tone: 'ok' }
    : { label: 'enrichissement', tone: 'info' };
}

/** `?filtre=` of the dashboard: contradictions (fiches replacing a fact included) or duplicates. */
export function matches(d: DraftView, filtre: string | null): boolean {
  if (filtre === 'contradictions') return d.kind === 'contradiction' || replacesFact(d.payload);
  if (filtre === 'doublons') return d.kind === 'doublon';
  return true;
}

/** The other choice of a contradiction or a duplicate: the two fiches or facts swapped. */
export function swapped(p: DraftPayload): DraftPayload | undefined {
  if (p.kind === 'contradiction') return { ...p, keep: p.strike, strike: p.keep };
  if (p.kind === 'doublon') return { ...p, keep: p.merge, merge: p.keep };
  return undefined;
}

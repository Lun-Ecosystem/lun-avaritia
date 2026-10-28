import { vi } from 'vitest';
import type { Api } from '../api.ts';

export const list = [
  { id: 1, title: 'Client X', typeId: 1, type: 'Personnes', updatedAt: '2026-10-28T09:00:00Z' },
  { id: 2, title: 'Jeanne D.', typeId: 1, type: 'Personnes', updatedAt: '2026-10-27T09:00:00Z' },
  { id: 3, title: 'Entreprise Z', typeId: 2, type: 'Organisations', updatedAt: '2026-10-26T09:00:00Z' },
];

const src = { kind: 'core', at: '2026-10-27T10:00:00Z' };
export const detail = (over: Record<string, unknown> = {}) => ({
  fiche: {
    id: 1,
    typeId: 1,
    title: 'Client X',
    synthesis: 'Responsable chez [[Entreprise Z]], voir **Atelier Test**.',
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-10-28T09:00:00Z',
    facts: [
      { id: 10, ficheId: 1, text: 'Demande une visio', source: src, at: '2026-10-27T10:00:00Z' },
      {
        id: 11,
        ficheId: 1,
        text: 'Recette le 3 juin',
        source: { kind: 'note', ref: '5', at: '2026-09-12T10:00:00Z' },
        at: '2026-09-12T10:00:00Z',
        struckAt: '2026-10-20T10:00:00Z',
      },
    ],
    links: [],
  },
  versions: [{ at: '2026-09-01T09:00:00Z', title: 'Client X', synthesis: 'Première version.' }],
  neighbors: [
    { id: 3, title: 'Entreprise Z', relation: 'travaille chez', direction: 'out' },
    { id: 4, title: 'Entretien du 04/11', relation: 'concerne', direction: 'in' },
  ],
  depots: [{ id: 5, name: 'note-exemple' }],
  ...over,
});

export function fakeApi(details: Record<number, unknown> = { 1: detail() }, results: unknown[] = []) {
  const get = vi.fn(async (path: string) => {
    if (path === '/api/fiches') return { fiches: list };
    if (path === '/api/types')
      return {
        types: [
          { id: 1, name: 'Personnes' },
          { id: 2, name: 'Organisations' },
        ],
      };
    const m = /^\/api\/fiches\/(\d+)$/.exec(path);
    if (m && details[Number(m[1])]) return details[Number(m[1])];
    throw new Error('Fiche inconnue');
  });
  const send = vi.fn(async (method: string, path: string, body?: unknown) => {
    if (path === '/lun/v1/actions/brain.search') return { ok: true, result: results };
    if (method === 'PATCH') {
      const b = body as { title?: string; synthesis?: string };
      const d = detail();
      return {
        fiche: { ...d.fiche, ...b, updatedAt: '2026-10-28T11:00:00Z' },
        versions: [
          ...d.versions,
          { at: '2026-10-28T11:00:00Z', title: b.title ?? 'Client X', synthesis: b.synthesis ?? '' },
        ],
      };
    }
    return {};
  });
  return { api: { get, send, upload: vi.fn() } as unknown as Api, get, send };
}

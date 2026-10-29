import type { Api } from '../api.ts';

export type Listed = { id: number; title: string; type: string };

/** The fiches of the memory; an unreadable list is an empty one (links stay plain text). */
export async function listFiches(api: Api): Promise<Listed[]> {
  try {
    const r = await api.get<{ fiches?: Listed[] }>('/api/fiches');
    return r.fiches ?? [];
  } catch {
    return [];
  }
}

export const titleKey = (title: string) => title.trim().toLowerCase();

/** Id by title (case apart), to know a `[[Titre]]` and open it. */
export const idsByTitle = (fiches: Listed[]) => new Map(fiches.map((f) => [titleKey(f.title), f.id]));

/** Changes the address like a click on a link of the app: the app follows it and the back button works. */
export function go(href: string): void {
  history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Opens `/memoire?fiche=<id>` from any screen. */
export const openFiche = (id: number): void => go(`/memoire?fiche=${id}`);

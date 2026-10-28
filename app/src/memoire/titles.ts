import type { Api } from '../api.ts';

/** The id of the fiche titled `title` (case apart), from the list of the memory; undefined when unknown. */
export async function ficheIdByTitle(api: Api, title: string): Promise<number | undefined> {
  const { fiches } = await api.get<{ fiches: { id: number; title: string }[] }>('/api/fiches');
  const wanted = title.trim().toLowerCase();
  return fiches.find((f) => f.title.trim().toLowerCase() === wanted)?.id;
}

/** Opens `/memoire?fiche=<id>` from any screen: the app follows the address like a back button. */
export function openFiche(id: number): void {
  history.pushState(null, '', `/memoire?fiche=${id}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import type { Api } from '../api.ts';
  import { Banner, EmptyState, icons, Segmented, Skeleton, TextInput } from '../lib/ui/index.ts';
  import Arbre from '../memoire/Arbre.svelte';
  import FichePanel from '../memoire/FichePanel.svelte';
  import { go } from '../memoire/titles.ts';

  /*
   * The memory: search and the tree / graph switch on one row, the tree (or the search results) on
   * the left, the fiche on the right. The address (`?fiche=&mode=`) is the state; under 760 px the
   * fiche covers the tree.
   */

  type Props = { fiche?: string | null | undefined; mode?: string | null | undefined };
  let { fiche = null, mode = null }: Props = $props();

  type Item = { id: number; title: string; typeId: number; type: string };
  type Hit = { id: number; title: string; type: string; excerpt: string };

  const api = getContext<Api>('api');
  const asId = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

  let fiches = $state<Item[] | null>(null);
  let failure = $state<string | null>(null);
  let selected = $state<number | null>(untrack(() => asId(fiche)));
  let view = $state(untrack(() => (mode === 'graphe' ? 'graphe' : 'arbre')));
  let query = $state('');
  let hits = $state<Hit[] | null>(null);
  let searchError = $state<string | null>(null);

  // The address changed from outside (back button, a link of another screen).
  $effect(() => {
    selected = asId(fiche);
    view = mode === 'graphe' ? 'graphe' : 'arbre';
  });

  function load() {
    api
      .get<{ fiches: Item[] }>('/api/fiches')
      .then((r) => (fiches = r.fiches))
      .catch((e: Error) => (failure = e.message));
  }
  load();

  function push() {
    const q = new URLSearchParams();
    if (selected !== null) q.set('fiche', String(selected));
    if (view === 'graphe') q.set('mode', 'graphe');
    const s = q.toString();
    go(`/memoire${s ? `?${s}` : ''}`);
  }
  function open(id: number | null) {
    selected = id;
    push();
  }

  // Search: 250 ms after the last key; an older answer never replaces a newer one.
  $effect(() => {
    const q = query.trim();
    if (!q) {
      hits = null;
      searchError = null;
      return;
    }
    const timer = setTimeout(() => {
      api
        .send<{ result: Hit[] }>('POST', '/lun/v1/actions/brain.search', { query: q })
        .then((r) => {
          if (q !== query.trim()) return;
          hits = r.result;
          searchError = null;
        })
        .catch((e: Error) => {
          if (q === query.trim()) searchError = e.message;
        });
    }, 250);
    return () => clearTimeout(timer);
  });
</script>

<div class="ecran">
  <div class="entete">
    <div class="recherche">
      <TextInput
        type="search"
        icon={icons.Search}
        placeholder="Rechercher une fiche, une personne, un projet…"
        aria-label="Rechercher une fiche"
        bind:value={query}
      />
    </div>
    <Segmented
      label="Mode d’affichage"
      options={[
        { value: 'arbre', label: 'Arborescence' },
        { value: 'graphe', label: 'Graphe' },
      ]}
      bind:value={view}
      onchange={push}
    />
  </div>

  {#if failure}
    <Banner title="Mémoire indisponible">{failure}</Banner>
  {:else if !fiches}
    <Skeleton height={220} />
  {:else if view === 'graphe'}
    <EmptyState size="grand" tone="neutre" icon={icons.Clock} title="Graphe" message="Bientôt ici." />
  {:else if fiches.length === 0}
    <EmptyState
      size="grand"
      tone="neutre"
      icon={icons.FileText}
      title="Aucune fiche. Écrire une note ou déposer un document."
      message="Les fiches naissent de ce que l’on valide."
    >
      <a href="/depots">Écrire une note</a>
      <a href="/depots">Déposer un document</a>
    </EmptyState>
  {:else}
    <div class={['corps', { ouverte: selected !== null }]}>
      <div class="liste">
        {#if searchError}<p class="erreur" role="alert">{searchError}</p>{/if}
        {#if hits}
          <ul class="resultats" aria-label="Résultats">
            {#each hits as h (h.id)}
              <li>
                <button type="button" class={{ sel: h.id === selected }} onclick={() => open(h.id)}>
                  <span>{h.title}</span>
                  <small>{h.type}</small>
                  <span class="extrait">{h.excerpt}</span>
                </button>
              </li>
            {:else}
              <li class="vide">Aucune fiche ne correspond.</li>
            {/each}
          </ul>
        {:else}
          <Arbre {fiches} {selected} onOpen={open} />
        {/if}
      </div>
      <div class="detail">
        {#if selected !== null}
          {#key selected}
            <FichePanel id={selected} onOpen={open} onClose={() => open(null)} onSaved={load} />
          {/key}
        {:else}
          <p class="vide">Choisir une fiche dans la liste.</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .ecran {
    display: grid;
    align-content: start;
    gap: 16px;
    padding: 22px 26px;
  }
  .entete {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .recherche {
    flex: 0 1 420px;
    min-width: 200px;
  }
  .corps {
    display: flex;
    gap: 18px;
    position: relative;
  }
  .liste {
    flex: none;
    width: 260px;
    padding-right: 14px;
    border-right: 1px solid var(--bordure);
  }
  .detail {
    flex: 1;
    min-width: 0;
  }
  .resultats {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
  }
  .resultats button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--r-1);
    background: none;
    color: var(--texte);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .resultats button:hover {
    background: var(--surface-2);
  }
  .resultats button.sel {
    background: var(--accent-doux);
  }
  .resultats small,
  .extrait {
    color: var(--texte-3);
    font-size: 12px;
  }
  .erreur {
    margin: 0 0 8px;
    color: var(--danger);
    font-size: 13px;
  }
  .vide {
    margin: 0;
    color: var(--texte-3);
    font-size: 13px;
  }
  @media (max-width: 759.98px) {
    .ecran {
      padding: 16px;
    }
    .liste {
      width: 100%;
      padding-right: 0;
      border-right: 0;
    }
    .detail {
      display: none;
    }
    .ouverte .liste {
      display: none;
    }
    .ouverte .detail {
      display: block;
    }
  }
</style>

<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import type { Api } from '../api.ts';
  import { formatDay } from '../format.ts';
  import { Badge, Banner, Button, icons, Skeleton } from '../lib/ui/index.ts';
  import Prose from '../Prose.svelte';
  import FicheEdit from './FicheEdit.svelte';
  import { idsByTitle, listFiches, titleKey, type Listed } from './titles.ts';

  /* One fiche: synthesis, sourced facts (struck ones kept and dated), links, versions, edition. */

  type Source = { kind: string; origin?: string; ref?: string; at?: string };
  type Fact = { id: number; text: string; source: Source; at: string; struckAt?: string };
  type Fiche = {
    id: number;
    typeId: number;
    title: string;
    synthesis: string;
    updatedAt: string;
    facts: Fact[];
  };
  type Version = { at: string; title: string; synthesis: string };
  type Data = {
    fiche: Fiche;
    versions: Version[];
    neighbors: { id: number; title: string; relation: string; direction: 'out' | 'in' }[];
    depots: { id: number; name: string }[];
    redirectedFrom?: number;
  };

  type Props = {
    id: number;
    onOpen: (id: number) => void;
    onClose?: (() => void) | undefined;
    /** The title may have changed: the list around has to be read again. */
    onSaved?: ((fiche: { id: number; title: string }) => void) | undefined;
    /** The memory's list, when the caller already holds it: the panel then reads nothing. */
    fiches?: Listed[] | undefined;
  };
  let { id, onOpen, onClose, onSaved, fiches }: Props = $props();

  const api = getContext<Api>('api');
  let data = $state<Data | null>(null);
  let fetched = $state<Listed[]>([]);
  const listed = $derived(fiches ?? fetched);
  let failure = $state<string | null>(null);
  let editing = $state(false);
  let busy = $state(false);
  let saveError = $state<string | undefined>();

  // The list gives the type name and the titles a [[link]] can open; without it the fiche still shows.
  const ids = $derived(idsByTitle(listed));
  const typeName = $derived(listed.find((l) => l.id === data?.fiche.id)?.type ?? '');
  if (!untrack(() => fiches)) void listFiches(api).then((l) => (fetched = l));

  $effect(() => {
    const asked = id;
    data = null;
    failure = null;
    editing = false;
    api
      .get<Data>(`/api/fiches/${asked}`)
      .then((d) => {
        if (asked === id) data = d;
      })
      .catch((e: Error) => {
        if (asked === id) failure = e.message;
      });
  });

  function openTitle(title: string) {
    const found = ids.get(titleKey(title));
    if (found !== undefined) onOpen(found);
  }

  async function save(edit: { title: string; synthesis: string }) {
    busy = true;
    saveError = undefined;
    try {
      const r = await api.send<{ fiche: Fiche; versions: Version[] }>('PATCH', `/api/fiches/${id}`, edit);
      if (data) data = { ...data, fiche: r.fiche, versions: r.versions };
      editing = false;
      onSaved?.({ id, title: r.fiche.title });
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'L’enregistrement a échoué.';
    } finally {
      busy = false;
    }
  }

  const sourceOf = (s: Source) => {
    const depot = data?.depots.find((d) => String(d.id) === s.ref)?.name;
    if (s.kind === 'core') return 'le core';
    if (depot) return depot;
    return s.kind === 'note' ? 'note' : s.kind === 'depot' ? 'dépôt' : (s.origin ?? 'import');
  };
</script>

<article class="fiche" aria-busy={!data && !failure}>
  {#if onClose}
    <div class="retour">
      <Button variant="fantome" size="petit" icon={icons.ArrowLeft} onclick={onClose}>Retour</Button>
    </div>
  {/if}
  {#if failure}
    <Banner title="Fiche indisponible">{failure}</Banner>
  {:else if !data}
    <Skeleton height={28} />
    <Skeleton height={90} />
  {:else}
    {@const f = data.fiche}
    {#if data.redirectedFrom !== undefined}
      <p class="fusion">Fusionnée dans cette fiche</p>
    {/if}
    {#if editing}
      <FicheEdit
        title={f.title}
        synthesis={f.synthesis}
        {busy}
        error={saveError}
        onsave={save}
        oncancel={() => (editing = false)}
      />
    {:else}
      <header>
        {#if typeName}<span class="type"><Badge tone="neutre">{typeName}</Badge></span>{/if}
        <h2>{f.title}</h2>
        <span class="muted">
          mise à jour le {formatDay(f.updatedAt)} · {new Set(
            f.facts.map((x) => `${x.source.kind}:${x.source.ref ?? x.source.at}`),
          ).size} sources
        </span>
        <Button variant="secondaire" size="petit" icon={icons.Pencil} onclick={() => (editing = true)}
          >Modifier</Button
        >
      </header>
      {#if f.synthesis}<Prose
          text={f.synthesis}
          onLink={openTitle}
          known={(t) => ids.has(titleKey(t))}
        />{/if}

      {#if f.facts.length}
        <h3 class="label">Faits</h3>
        <ul class="faits">
          {#each f.facts as fact (fact.id)}
            <li>
              {#if fact.struckAt}<s>{fact.text}</s>{:else}<span>{fact.text}</span>{/if}
              <span class="src">
                {sourceOf(fact.source)} · {formatDay(fact.at)}{#if fact.struckAt}
                  · barré le {formatDay(fact.struckAt)}{/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if data.neighbors.length}
        <h3 class="label">Liens</h3>
        <ul class="liens">
          {#each data.neighbors as n, i (i)}
            <li>
              {#if n.direction === 'out'}<span class="rel">{n.relation} →</span>{:else}<span class="rel"
                  >← {n.relation}</span
                >{/if}
              <button type="button" class="lien" onclick={() => onOpen(n.id)}>{n.title}</button>
            </li>
          {/each}
        </ul>
      {/if}

      <details class="histo">
        <summary>Historique ({data.versions.length} version{data.versions.length > 1 ? 's' : ''})</summary>
        <ol>
          {#each [...data.versions].reverse() as v, i (i)}
            <li>
              <span class="src">{formatDay(v.at)}</span>
              <strong>{v.title}</strong>
              <p>{v.synthesis}</p>
            </li>
          {/each}
        </ol>
      </details>
    {/if}
  {/if}
</article>

<style>
  .fiche {
    display: grid;
    align-content: start;
    gap: 10px;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
  }
  .type,
  header h2 {
    flex-basis: 100%;
  }
  h2 {
    margin: 0;
    font: 400 24px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  header :global(.btn) {
    margin-left: auto;
  }
  .muted,
  .src {
    color: var(--texte-3);
    font-size: 12.5px;
  }
  .fusion {
    margin: 0;
    color: var(--accent-texte);
    font-size: 13px;
  }
  .label {
    margin: 10px 0 0;
    color: var(--texte-2);
    font: 400 11px/1.4 var(--sans);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  ul,
  ol {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13.5px;
  }
  .faits li {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }
  s {
    color: var(--texte-3);
  }
  .rel {
    margin-right: 6px;
    color: var(--texte-3);
  }
  .lien {
    padding: 0;
    border: 0;
    border-bottom: 1px dotted var(--accent-texte);
    background: none;
    color: var(--accent-texte);
    font: inherit;
    cursor: pointer;
  }
  .lien:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .histo {
    margin-top: 10px;
    color: var(--texte-2);
    font-size: 13px;
  }
  .histo summary {
    cursor: pointer;
  }
  .histo ol {
    margin-top: 8px;
  }
  .histo p {
    margin: 2px 0 0;
    white-space: pre-wrap;
  }
  .retour {
    display: none;
  }
  @media (max-width: 759.98px) {
    .retour {
      display: block;
    }
  }
</style>

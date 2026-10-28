<script lang="ts">
  import { getContext } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { ApiError, type Api } from '../api.ts';
  import { Banner, bindShortcuts, Button, EmptyState, icons, Skeleton, toast } from '../lib/ui/index.ts';
  import { idsByTitle, listFiches } from '../memoire/titles.ts';
  import DraftItem from '../valider/DraftItem.svelte';
  import { matches, type DraftPayload, type DraftView } from '../valider/drafts.ts';

  /*
   * The drafts to validate, one card each, in the order served (contradictions first). Nothing enters
   * the memory but by « Valider » here; V and R act on the active card.
   */

  type Props = { filtre?: string | null | undefined };
  let { filtre = null }: Props = $props();

  const api = getContext<Api>('api');
  let queue = $state<DraftView[] | null>(null);
  let held = $state(0);
  let failure = $state<string | null>(null);
  const busy = new SvelteSet<number>();
  const errors = new SvelteMap<number, string>();
  let chosen = $state<number | null>(null);
  let editing = $state<number | null>(null);

  function load() {
    api
      .get<{ drafts: DraftView[]; held: number }>('/api/drafts')
      .then((q) => {
        queue = q.drafts;
        held = q.held;
        failure = null;
      })
      .catch((e: Error) => (failure = e.message));
  }
  load();

  // The titles of the memory, read once when a fiche draft first links to another ([[Fiche]]).
  let ids = $state(new Map<string, number>());
  let titlesRead = false;
  $effect(() => {
    if (titlesRead || !queue?.some((d) => d.payload.kind === 'fiche' && d.payload.synthesis.includes('[[')))
      return;
    titlesRead = true;
    void listFiches(api).then((l) => (ids = idsByTitle(l)));
  });

  const shown = $derived((queue ?? []).filter((d) => matches(d, filtre)));
  const active = $derived(shown.find((d) => d.id === chosen) ?? shown[0]);
  const scope = $derived(
    filtre === 'contradictions' ? 'Contradictions' : filtre === 'doublons' ? 'Doublons probables' : null,
  );

  async function decide(d: DraftView, verb: 'accept' | 'refuse', input?: DraftPayload) {
    if (busy.has(d.id)) return;
    busy.add(d.id);
    errors.delete(d.id);
    try {
      await api.send('POST', `/lun/v1/cards/${d.id}/${verb}`, input ? { input } : {});
      queue = queue?.filter((x) => x.id !== d.id) ?? null;
      if (editing === d.id) editing = null;
      toast(verb === 'accept' ? 'Appliqué' : 'Refusé');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast('Déjà tranché ailleurs');
        load();
      } else errors.set(d.id, e instanceof Error ? e.message : 'La décision a échoué.');
    } finally {
      busy.delete(d.id);
    }
  }

  $effect(() =>
    bindShortcuts({
      v: () => active && editing !== active.id && decide(active, 'accept'),
      r: () => active && editing !== active.id && decide(active, 'refuse'),
    }),
  );

  const plural = (n: number) =>
    n > 1
      ? `${n} autres brouillons attendent le prochain passage`
      : `${n} autre brouillon attend le prochain passage`;
</script>

<div class="ecran" aria-busy={!queue && !failure}>
  <header class="entete">
    <h1>À valider</h1>
    {#if queue}
      <span class="muted">
        {scope ? `${scope} : ` : ''}{shown.length} brouillon{shown.length > 1 ? 's' : ''}
      </span>
    {/if}
    {#if scope}<Button variant="fantome" size="petit" href="/valider">Tout voir</Button>{/if}
  </header>

  {#if failure}
    <Banner title="File indisponible">{failure}</Banner>
  {:else if !queue}
    <Skeleton height={140} />
    <Skeleton height={140} />
  {:else}
    {#each shown as d (d.id)}
      <DraftItem
        draft={d}
        active={d.id === active?.id}
        editing={editing === d.id}
        busy={busy.has(d.id)}
        error={errors.get(d.id)}
        onaccept={(input) => decide(d, 'accept', input)}
        onrefuse={() => decide(d, 'refuse')}
        onedit={(on) => (editing = on ? d.id : null)}
        onactivate={() => (chosen = d.id)}
        {ids}
      />
    {:else}
      <EmptyState
        size="grand"
        title="Rien à valider."
        message="Les brouillons du prochain passage arriveront ici."
        icon={icons.Check}
      />
    {/each}
    {#if held > 0}<p class="pied">{plural(held)}</p>{/if}
  {/if}
</div>

<style>
  .ecran {
    display: grid;
    gap: 14px;
    max-width: 760px;
    margin: 0 auto;
    padding: 24px;
  }
  .entete {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
  }
  h1 {
    margin: 0;
    font: 400 26px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .muted {
    color: var(--texte-2);
    font-size: 12.5px;
  }
  .entete :global(.btn) {
    margin-left: auto;
  }
  .pied {
    margin: 4px 0 0;
    color: var(--texte-3);
    font-size: 12.5px;
    text-align: center;
  }
  @media (max-width: 759.98px) {
    .ecran {
      padding: 16px;
    }
  }
</style>

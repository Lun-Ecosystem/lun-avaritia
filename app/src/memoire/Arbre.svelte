<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { icons } from '../lib/ui/index.ts';

  /* The fiches grouped by type, each group folding. The first group and the one holding the chosen fiche start open. */

  type Item = { id: number; title: string; typeId: number; type: string };
  type Props = { fiches: Item[]; selected: number | null; onOpen: (id: number) => void };
  let { fiches, selected, onOpen }: Props = $props();

  const groups = $derived.by(() => {
    const by = new Map<number, { name: string; items: Item[] }>();
    for (const f of fiches) {
      const g = by.get(f.typeId) ?? { name: f.type, items: [] };
      g.items.push(f);
      by.set(f.typeId, g);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([typeId, g]) => ({ typeId, ...g }));
  });

  const folded = new SvelteMap<number, boolean>();
  const isOpen = (g: { typeId: number; items: Item[] }, i: number) =>
    !(folded.get(g.typeId) ?? !(i === 0 || g.items.some((f) => f.id === selected)));
</script>

<nav class="arbo" aria-label="Fiches par type">
  {#each groups as g, i (g.typeId)}
    {@const open = isOpen(g, i)}
    <button type="button" class="grp" aria-expanded={open} onclick={() => folded.set(g.typeId, open)}>
      {#if open}<icons.ChevronDown size={14} />{:else}<icons.ChevronRight size={14} />{/if}
      {g.name} · {g.items.length}
    </button>
    {#if open}
      {#each g.items as f (f.id)}
        <button
          type="button"
          class={['item', { sel: f.id === selected }]}
          aria-current={f.id === selected ? 'true' : undefined}
          onclick={() => onOpen(f.id)}>{f.title}</button
        >
      {/each}
    {/if}
  {/each}
</nav>

<style>
  .arbo {
    display: grid;
    align-content: start;
    gap: 2px;
    font-size: 13px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--r-1);
    background: none;
    color: var(--texte-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-2);
    color: var(--texte);
  }
  button:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: -2px;
  }
  .grp {
    margin-top: 10px;
    color: var(--texte);
  }
  .grp:first-child {
    margin-top: 0;
  }
  .item {
    padding-left: 22px;
  }
  .item.sel,
  .item.sel:hover {
    background: var(--accent-doux);
    color: var(--texte);
  }
</style>

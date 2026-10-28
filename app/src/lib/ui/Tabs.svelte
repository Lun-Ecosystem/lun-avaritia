<script lang="ts">
  import { Tabs } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { DemoState, TabItem } from './types.ts';

  /*
   * Underlined tabs of a sub-view (Bits Tabs: arrows move, the active tab is underlined in accent,
   * never just a little lighter). The panel of the active tab is `children(value)`.
   */

  type Props = {
    items: TabItem[];
    value?: string | undefined;
    /** Accessible name of the tab list. */
    label: string;
    onchange?: ((value: string) => void) | undefined;
    /** Tools at the end of the bar (sorting, filters). */
    tools?: Snippet | undefined;
    children?: Snippet<[string]> | undefined;
    class?: string | undefined;
    /** Forced state of one tab, for the catalogue: `[value, state]`. */
    etat?: [string, DemoState] | undefined;
  };

  let {
    items,
    value = $bindable(items[0]?.value ?? ''),
    label,
    onchange,
    tools,
    children,
    class: className,
    etat,
  }: Props = $props();
</script>

<Tabs.Root
  bind:value={
    () => value,
    (next) => {
      value = next;
      onchange?.(next);
    }
  }
  class={['onglets', className]}
>
  <div class="barre">
    <Tabs.List aria-label={label} class="liste">
      {#each items as item (item.value)}
        <Tabs.Trigger value={item.value}>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="onglet"
              data-etat={etat?.[0] === item.value ? etat[1] : undefined}
            >
              {item.label}
              {#if item.count !== undefined}<small>{item.count}</small>{/if}
            </button>
          {/snippet}
        </Tabs.Trigger>
      {/each}
    </Tabs.List>
    {#if tools}<div class="outils">{@render tools()}</div>{/if}
  </div>
  {#if children}
    {#each items as item (item.value)}
      <Tabs.Content value={item.value} class="panneau">
        {#if item.value === value}{@render children(item.value)}{/if}
      </Tabs.Content>
    {/each}
  {/if}
</Tabs.Root>

<style>
  .barre {
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid var(--bordure);
  }
  .barre :global(.liste) {
    display: flex;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .onglet {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 44px;
    margin-bottom: -1px;
    padding: 0 12px;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--texte-2);
    font: 400 13px var(--sans);
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .onglet:hover,
  .onglet[data-etat='survol'] {
    border: 0;
    border-bottom: 2px solid var(--bordure-forte);
    color: var(--texte);
  }
  .onglet[data-state='active'] {
    border-bottom: 2px solid var(--accent-texte);
    color: var(--texte);
  }
  .onglet:focus-visible,
  .onglet[data-etat='focus'] {
    outline: 2px solid var(--accent-texte);
    outline-offset: -4px;
    border-radius: var(--r-1);
  }
  small {
    font-size: 11.5px;
    color: var(--texte-3);
  }
  .outils {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin-left: auto;
    color: var(--texte-3);
    font-size: 12.5px;
  }
</style>

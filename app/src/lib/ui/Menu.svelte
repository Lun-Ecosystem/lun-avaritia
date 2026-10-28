<script lang="ts">
  import { DropdownMenu } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { ICON_STROKE, Search } from './Icon.ts';
  import Kbd from './Kbd.svelte';
  import { mondeOf } from './monde.ts';
  import type { MenuItem, MenuSection } from './types.ts';

  /*
   * Menu in a layer above the page (Bits DropdownMenu, portalled): placed alone, flipped when space
   * lacks, closed by Escape and a click outside, keyboard focus kept. With `filter`, a field on top
   * narrows the entries as one types and Enter chooses the first one left.
   */

  type Props = {
    sections: MenuSection[];
    /** Placeholder (and name) of the filter field; no filter without it. */
    filter?: string | undefined;
    /** The trigger: spread `props` on a button (Button, IconButton or a bare one). */
    trigger?: Snippet<[{ props: Record<string, unknown> }]> | undefined;
    /** Element the menu opens from, when it has no trigger of its own (a row, a shortcut). */
    anchor?: HTMLElement | null | undefined;
    open?: boolean | undefined;
    onselect?: ((id: string) => void) | undefined;
    side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
    align?: 'start' | 'center' | 'end' | undefined;
    /** Shown when the filter leaves nothing. */
    empty?: string | undefined;
    /** Accessible name of the menu, when its trigger does not say it. */
    label?: string | undefined;
  };

  let {
    sections,
    filter,
    trigger,
    anchor: customAnchor = null,
    open = $bindable(false),
    onselect,
    side = 'bottom',
    align = 'start',
    empty = 'Aucun résultat',
    label,
  }: Props = $props();

  let query = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let anchor = $state<HTMLElement | null>(null);
  const monde = $derived(mondeOf(anchor ?? customAnchor));

  /** Lower case, without accents: « Boîte » and « boite » match. */
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  const visible = $derived.by(() => {
    const needle = fold(query.trim());
    return sections
      .map((section) => ({
        ...section,
        items:
          !needle || section.fixed
            ? section.items
            : section.items.filter((item) => fold(item.label).includes(needle)),
      }))
      .filter((section) => section.items.length > 0);
  });

  const matching = $derived(visible.filter((s) => !s.fixed).some((s) => s.items.length > 0));
  /** What Enter chooses from the filter: the first entry left that can be chosen. */
  const first = $derived(visible.flatMap((s) => s.items).find((item) => !item.disabled));

  $effect(() => {
    if (!open) query = '';
  });

  function choose(item: MenuItem) {
    item.onselect?.();
    onselect?.(item.id);
  }

  function onFilterKeydown(event: KeyboardEvent) {
    // Arrows leave the field towards the entries; Escape and Tab are the menu's.
    if (['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) return;
    // Every other key belongs to the field, not to the type-ahead of the menu.
    event.stopPropagation();
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (!first) return;
      choose(first);
      open = false;
    }
  }

  function onContentKeydown(event: KeyboardEvent) {
    if (event.target === input || event.ctrlKey || event.metaKey || event.altKey) return;
    const item = visible
      .flatMap((s) => s.items)
      .find((i) => i.shortcut && !i.disabled && i.shortcut.toLowerCase() === event.key.toLowerCase());
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    choose(item);
    open = false;
  }

  /** With a filter, the pointer does not take the focus from the field (hover still shows). */
  const keepFocus = (event: PointerEvent) => {
    if (filter) event.preventDefault();
  };
</script>

<DropdownMenu.Root bind:open>
  {#if trigger}
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <span class="ancre" bind:this={anchor}>{@render trigger({ props })}</span>
      {/snippet}
    </DropdownMenu.Trigger>
  {/if}
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      {side}
      {align}
      sideOffset={6}
      collisionPadding={8}
      {...customAnchor && !trigger ? { customAnchor } : {}}
      onCloseAutoFocus={(event) => {
        // Without a trigger, the focus goes back to the element the menu came from.
        if (trigger || !customAnchor?.isConnected) return;
        event.preventDefault();
        customAnchor.focus();
      }}
      onOpenAutoFocus={(event) => {
        if (!filter) return;
        event.preventDefault();
        input?.focus();
      }}
      onkeydown={onContentKeydown}
    >
      {#snippet child({ wrapperProps, props })}
        <div {...wrapperProps}>
          <div {...props} class="menu" data-monde={monde} aria-label={label}>
            {#if filter}
              <label class="filtre">
                <Search size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <input
                  bind:this={input}
                  bind:value={query}
                  type="text"
                  placeholder={filter}
                  aria-label={filter}
                  autocomplete="off"
                  spellcheck="false"
                  onkeydown={onFilterKeydown}
                />
              </label>
            {/if}
            {#if filter && query.trim() && !matching}
              <p class="vide">{empty}</p>
            {/if}
            {#each visible as section, index (section.title ?? `section-${index}`)}
              {#if index > 0}<DropdownMenu.Separator class="sep" />{/if}
              <DropdownMenu.Group>
                {#if section.title}
                  <DropdownMenu.GroupHeading class="titre">{section.title}</DropdownMenu.GroupHeading>
                {/if}
                {#each section.items as item (item.id)}
                  {@const Icon = item.icon}
                  {@const enter = Boolean(filter && item === first)}
                  <DropdownMenu.Item
                    disabled={item.disabled ?? false}
                    onSelect={() => choose(item)}
                    onpointermove={keepFocus}
                    onpointerleave={keepFocus}
                  >
                    {#snippet child({ props: itemProps })}
                      <div
                        {...itemProps}
                        class={['item', item.tone, { premier: enter }]}
                        aria-keyshortcuts={item.shortcut}
                      >
                        {#if Icon}
                          <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        {:else if item.color}
                          <span class="pastille" style:background={item.color} aria-hidden="true"></span>
                        {/if}
                        <span class="texte">{item.label}</span>
                        {#if item.note}<small class="note">{item.note}</small>{/if}
                        {#if enter}
                          <span class="raccourci"><Kbd>↵</Kbd></span>
                        {:else if item.shortcut}
                          <span class="raccourci"><Kbd>{item.shortcut}</Kbd></span>
                        {/if}
                      </div>
                    {/snippet}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Group>
            {/each}
          </div>
        </div>
      {/snippet}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  .ancre {
    display: contents;
  }
  .menu {
    box-sizing: border-box;
    min-width: 230px;
    max-width: min(340px, calc(100vw - 16px));
    max-height: min(420px, var(--bits-dropdown-menu-content-available-height));
    overflow-y: auto;
    padding: 6px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font-family: var(--sans);
    outline: none;
    /* Above the dialogs (51): a menu opened from inside one must not hide behind it. */
    z-index: 55;
  }
  .filtre {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    margin: 0 2px 4px;
    padding: 0 8px;
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-1);
    color: var(--texte-3);
  }
  .filtre:focus-within {
    border-color: var(--accent-bord);
  }
  .filtre :global(svg) {
    flex: none;
  }
  .filtre input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 0;
    color: var(--texte);
    font: 300 12.5px var(--sans);
    outline: none;
  }
  .filtre input::placeholder {
    color: var(--texte-3);
  }
  .vide {
    margin: 0;
    padding: 8px 10px;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .menu :global(.titre) {
    padding: 6px 10px 4px;
    font: 500 10.5px var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  .menu :global(.sep) {
    height: 1px;
    margin: 6px 4px;
    background: var(--bordure);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-1);
    color: var(--texte);
    font: 400 13.5px var(--sans);
    cursor: pointer;
    outline: none;
    user-select: none;
  }
  .item :global(svg) {
    flex: none;
  }
  .item.premier,
  .item:hover:not([data-disabled]) {
    background: var(--survol);
  }
  /* Keyboard (or pointer) focus: one step stronger than the hover, so it stays visible. */
  .item[data-highlighted] {
    background: var(--appui);
  }
  .item.ia {
    color: var(--ia);
  }
  .item.danger {
    color: var(--danger);
  }
  .item[data-disabled] {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .pastille {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .texte {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    font-size: 11.5px;
    color: var(--ia);
  }
  .raccourci {
    margin-left: auto;
    padding-left: 12px;
  }
</style>

<script lang="ts">
  import { Popover } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { mondeOf } from './monde.ts';

  /*
   * Detail bubble in a layer above the page (Bits Popover, portalled): an event of the agenda, the
   * « Corriger » panel of a proposal. Placed alone, flipped when space lacks, closed by Escape and a
   * click outside, focus kept inside while open.
   */

  type Props = {
    /** The trigger: spread `props` on a button. Without it, `anchor` places the bubble. */
    trigger?: Snippet<[{ props: Record<string, unknown> }]> | undefined;
    /** Element the bubble points at, when it opens without a trigger of its own. */
    anchor?: HTMLElement | null | undefined;
    open?: boolean | undefined;
    side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
    align?: 'start' | 'center' | 'end' | undefined;
    /** Width of the bubble, in px. */
    width?: number | undefined;
    /** Accessible name of the bubble. */
    label?: string | undefined;
    class?: string | undefined;
    children: Snippet<[{ close: () => void }]>;
  };

  let {
    trigger,
    anchor = null,
    open = $bindable(false),
    side = 'bottom',
    align = 'start',
    width,
    label,
    class: className,
    children,
  }: Props = $props();

  let own = $state<HTMLElement | null>(null);
  const monde = $derived(mondeOf(own ?? anchor));
  const close = () => (open = false);
</script>

<Popover.Root bind:open>
  {#if trigger}
    <Popover.Trigger>
      {#snippet child({ props })}
        <span class="ancre" bind:this={own}>{@render trigger({ props })}</span>
      {/snippet}
    </Popover.Trigger>
  {/if}
  <Popover.Portal>
    <Popover.Content
      {side}
      {align}
      sideOffset={6}
      collisionPadding={8}
      {...anchor && !trigger ? { customAnchor: anchor } : {}}
    >
      {#snippet child({ wrapperProps, props })}
        <div {...wrapperProps}>
          <div
            {...props}
            role="dialog"
            class={['bulle', className]}
            data-monde={monde}
            aria-label={label}
            style:width={width ? `${width}px` : undefined}
          >
            {@render children({ close })}
          </div>
        </div>
      {/snippet}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  .ancre {
    display: contents;
  }
  .bulle {
    box-sizing: border-box;
    max-width: calc(100vw - 16px);
    max-height: var(--bits-popover-content-available-height);
    overflow-y: auto;
    padding: 6px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 300 13.5px/1.5 var(--sans);
    outline: none;
  }
</style>

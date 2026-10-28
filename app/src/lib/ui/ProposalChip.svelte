<script lang="ts">
  import type { ProposalView } from '../types.ts';
  import { Check, ChevronDown, ICON_STROKE, Sparkles } from './Icon.ts';
  import Tooltip from './Tooltip.svelte';

  /*
   * Compact proposal of the AI, in a list row: where it would go and how sure it is, validated (V)
   * or corrected (C) in place. Without a box, says so plainly (« Aucune boîte trouvée »).
   */

  type Props = {
    proposal: ProposalView;
    /** Name of the proposed box. */
    boxName: string;
    /** Names of the proposed tags, after the box (« Factures + Urgent »). */
    tagNames?: string[] | undefined;
    onvalidate: () => void;
    /** Opens the correction, anchored on the button given. */
    oncorrect: (anchor: HTMLElement) => void;
    class?: string | undefined;
  };

  let { proposal, boxName, tagNames = [], onvalidate, oncorrect, class: className }: Props = $props();

  const found = $derived(proposal.boxId !== null || tagNames.length > 0);
  const what = $derived([...(proposal.boxId !== null ? [boxName] : []), ...tagNames].join(' + '));
  const confidence = $derived(Math.round(proposal.confidence));
</script>

{#if found}
  <span class={['propo', className]}>
    <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
    <span class="quoi">
      <span class="sr">Proposition de l’IA : </span>{what} · {confidence}&nbsp;%
    </span>
    <Tooltip label="Valider" shortcut="V">
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          class="rond"
          aria-label="Valider : {what}"
          aria-keyshortcuts="V"
          onclick={(event) => {
            event.stopPropagation();
            onvalidate();
          }}
        >
          <Check size={11} strokeWidth={2.25} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
    <Tooltip label="Corriger" shortcut="C">
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          class="rond"
          aria-label="Corriger la proposition"
          aria-keyshortcuts="C"
          onclick={(event) => {
            event.stopPropagation();
            oncorrect(event.currentTarget);
          }}
        >
          <ChevronDown size={11} strokeWidth={2.25} aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
  </span>
{:else}
  <span class={['propo', 'rien', className]}>
    <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />Aucune boîte trouvée
  </span>
{/if}

<style>
  .propo {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 22px;
    padding: 0 3px 0 8px;
    border: 1px solid var(--ia-bord);
    border-radius: var(--r-rond);
    background: var(--ia-doux);
    color: var(--ia);
    font: 400 11.5px/1 var(--sans);
    white-space: nowrap;
  }
  .propo :global(svg) {
    flex: none;
  }
  .quoi {
    font-variant-numeric: tabular-nums;
  }
  .rien {
    padding-right: 8px;
    border-color: var(--bordure-forte);
    background: var(--surface-2);
    color: var(--texte-2);
  }
  .rond {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ia) 20%, transparent);
    color: var(--texte);
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .rond:hover {
    border: 0;
    background: color-mix(in srgb, var(--ia) 38%, transparent);
  }
  .rond:focus-visible {
    outline: 2px solid var(--ia);
    outline-offset: 1px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>

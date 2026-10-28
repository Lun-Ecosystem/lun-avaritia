<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Rows of one day (« Aujourd’hui », « mer. 21 oct. »), under a small heading. */

  type Props = {
    label: string;
    /** Level of the heading in the page. */
    level?: 2 | 3 | 4 | undefined;
    children: Snippet;
    class?: string | undefined;
  };

  let { label, level = 3, children, class: className }: Props = $props();
  const uid = $props.id();
</script>

<section class={['jour', className]} aria-labelledby="{uid}-titre">
  <svelte:element this={`h${level}`} id="{uid}-titre" class="titre">{label}</svelte:element>
  {@render children()}
</section>

<style>
  .titre {
    margin: 0;
    padding: 12px 18px 6px;
    font: 500 10.5px/1.4 var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  @media (max-width: 767.98px) {
    .titre {
      padding-left: 14px;
    }
  }
</style>

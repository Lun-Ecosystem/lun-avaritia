<script lang="ts">
  import { Check, ICON_STROKE } from './Icon.ts';

  /*
   * Mark of what the AI did alone (« Rangé seul · Newsletters »), dashed to tell it from a proposal
   * that waits. Undone from the toast or the journal, not from here.
   */

  type Props = {
    boxName: string;
    class?: string | undefined;
  };

  let { boxName, class: className }: Props = $props();
</script>

<span class={['fait', className]}>
  <Check size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />Rangé seul · {boxName}
</span>

<style>
  .fait {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    height: 22px;
    padding: 0 8px;
    border: 1px dashed var(--ia-bord);
    border-radius: var(--r-rond);
    color: var(--ia);
    font: 400 11.5px/1 var(--sans);
    white-space: nowrap;
  }
  .fait :global(svg) {
    flex: none;
  }
</style>

<script lang="ts">
  import Button from './Button.svelte';
  import { Check, CircleAlert, ICON_STROKE, X } from './Icon.ts';
  import Kbd from './Kbd.svelte';
  import { bindShortcuts } from './shortcuts.ts';
  import { dismiss, lastUndoable, toasts, undo, undoLast } from './toasts.svelte.ts';

  /*
   * Shows the toasts of the page, at the bottom, above the mobile bar. Mounted once by the app,
   * inside the view root (it takes the world's accent from there).
   */

  const list = $derived(toasts());
  const undoable = $derived(lastUndoable());

  // Z undoes the last toast, only while one can be undone (never from a field: bindShortcuts).
  $effect(() => {
    if (!undoable) return;
    return bindShortcuts({ z: undoLast });
  });
</script>

<div class="toaster" aria-live="polite" aria-relevant="additions text">
  {#each list as item (item.id)}
    <div class="toast" data-ton={item.tone ?? 'ok'}>
      {#if item.tone === 'danger'}
        <CircleAlert size={16} strokeWidth={ICON_STROKE} aria-hidden="true" class="ico" />
      {:else}
        <Check size={16} strokeWidth={ICON_STROKE} aria-hidden="true" class="ico" />
      {/if}
      <span class="message">{item.message}</span>
      {#if item.undo}
        <span class="annuler">
          <Button variant="fantome" size="petit" loading={item.undoing} onclick={() => undo(item.id)}
            >Annuler</Button
          >
          {#if item.id === undoable?.id}<Kbd>Z</Kbd>{/if}
        </span>
      {:else}
        <button type="button" class="fermer" aria-label="Fermer" onclick={() => dismiss(item.id)}>
          <X size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    left: 50%;
    bottom: 22px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: calc(100vw - 32px);
    transform: translateX(-50%);
    pointer-events: none;
  }
  .toast {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    max-width: 100%;
    padding: 6px 8px 6px 16px;
    background: var(--surface-3);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 400 13.5px/1.35 var(--sans);
    pointer-events: auto;
    animation: monte 160ms ease-out;
  }
  .toast[data-ton='danger'] {
    border-color: var(--danger-bord);
  }
  .toast :global(.ico) {
    flex: none;
    color: var(--ok);
  }
  .toast[data-ton='danger'] :global(.ico) {
    color: var(--danger);
  }
  .message {
    min-width: 0;
  }
  .annuler {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding-right: 4px;
  }
  .annuler :global(.btn) {
    color: var(--accent-texte);
  }
  .fermer {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--r-1);
    background: none;
    color: var(--texte-3);
    cursor: pointer;
  }
  .fermer:hover {
    background: var(--survol);
    border-color: transparent;
    color: var(--texte);
  }
  .fermer:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }

  @keyframes monte {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
  /* Above the bottom bar of the mobile layout (68 px). */
  @media (max-width: 767.98px) {
    .toaster {
      bottom: calc(84px + env(safe-area-inset-bottom, 0px));
    }
    .toast {
      white-space: normal;
    }
  }
</style>

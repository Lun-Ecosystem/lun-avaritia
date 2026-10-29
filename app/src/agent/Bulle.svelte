<script lang="ts">
  import { ICON_STROKE, Kbd, type IconComponent } from '../lib/ui/index.ts';

  /** The agent's bubble, the only fixed element of the bottom right corner: its icon, its name, its key. */

  type Props = {
    name: string;
    icon: IconComponent;
    onclick: () => void;
    element?: HTMLButtonElement | null | undefined;
  };

  let { name, icon: Icon, onclick, element = $bindable(null) }: Props = $props();
</script>

<button
  bind:this={element}
  type="button"
  class="bulle"
  aria-haspopup="dialog"
  aria-keyshortcuts="Control+J"
  {onclick}
>
  <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
  <span class="nom">{name}</span>
  <!-- Said by aria-keyshortcuts: the name of the button stays the agent's. -->
  <span class="touche" aria-hidden="true"><Kbd>Ctrl J</Kbd></span>
</button>

<style>
  .bulle {
    position: fixed;
    right: var(--agent-lanceur-bas);
    /* Set by the shell: higher on a phone, above the bottom navigation. */
    bottom: var(--agent-bas, var(--agent-lanceur-bas));
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: calc(100vw - 2 * var(--agent-lanceur-bas));
    height: var(--agent-lanceur-h);
    padding: 0 16px 0 14px;
    box-sizing: border-box;
    border: 1px solid var(--ia-bord);
    border-radius: 22px;
    background: var(--surface-2);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 400 13.5px var(--sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .bulle :global(svg) {
    flex: none;
    color: var(--ia);
  }
  .nom {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .touche {
    display: flex;
    margin-left: 4px;
  }
  .bulle:hover {
    background: var(--surface-3);
  }
  .bulle:focus-visible {
    outline: 2px solid var(--ia);
    outline-offset: 2px;
  }
  /* No keyboard on a phone. */
  @media (max-width: 767.98px) {
    .touche {
      display: none;
    }
  }
</style>

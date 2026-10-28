<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';

  /** Floating button of the mobile layout: the main action of the screen, above the bottom bar. */

  type Props = Omit<HTMLButtonAttributes, 'children'> & {
    label: string;
    icon: IconComponent;
  };

  let { label, icon: Icon, type = 'button', class: className, ...rest }: Props = $props();
</script>

<button {...rest} {type} class={['fab', className]}>
  <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />{label}
</button>

<style>
  .fab {
    position: fixed;
    right: 16px;
    bottom: calc(84px + env(safe-area-inset-bottom, 0px));
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 52px;
    padding: 0 20px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 16px;
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 400 14px var(--sans);
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .fab:hover {
    background: var(--accent-survol);
    border-color: var(--accent-survol);
  }
  .fab:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
</style>

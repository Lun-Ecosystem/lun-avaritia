<script lang="ts">
  import { ToggleGroup } from 'bits-ui';
  import { getField } from './field.ts';
  import type { DemoState, Option } from './types.ts';

  type Props = {
    options: Option[];
    value?: string | undefined;
    /** Accessible name of the group, when it is not inside a Field. */
    label?: string | undefined;
    disabled?: boolean | undefined;
    size?: 'petit' | 'normal' | undefined;
    onchange?: ((value: string) => void) | undefined;
    class?: string | undefined;
    /** Forced state of the option `etatValue`, for the catalogue page only. */
    'data-etat'?: DemoState | undefined;
    etatValue?: string | undefined;
  };

  let {
    options,
    value = $bindable(''),
    label,
    disabled = false,
    size = 'normal',
    onchange,
    class: className,
    'data-etat': etat,
    etatValue,
  }: Props = $props();

  const field = getField();
</script>

<!-- An exclusive choice: pressing the current option again keeps it, the group is never empty. -->
<ToggleGroup.Root
  type="single"
  bind:value={
    () => value,
    (next) => {
      if (!next || next === value) return;
      value = next;
      onchange?.(next);
    }
  }
  {disabled}
>
  {#snippet child({ props })}
    <div
      {...props}
      class={['groupe', size, className]}
      aria-label={field ? undefined : label}
      aria-labelledby={field?.labelId}
    >
      {#each options as option (option.value)}
        <ToggleGroup.Item value={option.value} disabled={option.disabled ?? false}>
          {#snippet child({ props: itemProps, pressed })}
            <button
              {...itemProps}
              type="button"
              class={['option', { on: pressed }]}
              data-etat={option.value === etatValue ? etat : undefined}
            >
              {option.label}
            </button>
          {/snippet}
        </ToggleGroup.Item>
      {/each}
    </div>
  {/snippet}
</ToggleGroup.Root>

<style>
  .groupe {
    display: inline-flex;
    flex: none;
    max-width: 100%;
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    background: var(--surface-2);
    overflow: hidden;
  }
  .option {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-left: 1px solid var(--bordure);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--texte-2);
    font: 400 13px/1 var(--sans);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  .option:first-child {
    border-left: 0;
  }
  .petit .option {
    height: 26px;
    padding: 0 10px;
    font-size: 12.5px;
  }
  /* Each hover names its border: base.css still styles bare buttons for the views not yet redone. */
  .option:enabled:hover,
  .option[data-etat='survol'] {
    background: var(--surface-3);
    border-color: var(--bordure);
    color: var(--texte);
  }
  .option.on,
  .option.on:enabled:hover {
    background: var(--accent-doux);
    color: var(--texte);
  }
  .option:focus-visible,
  .option[data-etat='focus'] {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--accent-texte);
    outline-offset: -2px;
  }
  .option:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
</style>

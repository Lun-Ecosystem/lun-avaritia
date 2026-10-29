<script lang="ts">
  import { SettingsCard, SettingsRow, TextInput } from '../lib/ui/index.ts';
  import { num, type SettingsStore } from './settings.svelte.ts';

  /* How many drafts one lot may leave at most. */

  let { store }: { store: SettingsStore } = $props();
  let cap = $state('');
  $effect(() => {
    const saved = store.shown('drafts.cap');
    if (saved !== undefined) cap = String(saved);
  });
</script>

<SettingsCard title="Lots">
  <SettingsRow
    label="Brouillons maximum par lot"
    hint="Le reste attend le lot suivant"
    error={store.errors['drafts.cap']}
  >
    {#snippet children({ labelId })}
      <TextInput
        type="number"
        size="petit"
        class="nombre"
        min="1"
        max="100"
        step="1"
        aria-labelledby={labelId}
        disabled={!store.values}
        bind:value={cap}
        onchange={() => store.save('drafts.cap', num(cap))}
      />
    {/snippet}
  </SettingsRow>
</SettingsCard>

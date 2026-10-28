<script lang="ts">
  import { SettingsCard, SettingsRow, TextInput } from '../lib/ui/index.ts';
  import Switch from '../lib/ui/Switch.svelte';
  import { num, type SettingsStore } from './settings.svelte.ts';

  /* The lots sent by the core: accepted or not, and how many drafts one lot may leave at most. */

  let { store }: { store: SettingsStore } = $props();
  let cap = $state('');
  $effect(() => {
    const saved = store.shown('drafts.cap');
    if (saved !== undefined) cap = String(saved);
  });
</script>

<SettingsCard title="Lots du core">
  <SettingsRow
    label="Accepter les lots du core"
    hint="Uniquement si le core est relié"
    error={store.errors['core.lots']}
  >
    {#snippet children({ labelId })}
      <Switch
        aria-labelledby={labelId}
        disabled={!store.values}
        checked={store.values?.['core.lots'] ?? false}
        onchange={(on) => store.save('core.lots', on)}
      />
    {/snippet}
  </SettingsRow>
  <SettingsRow label="Heure de passage" hint="Heure fixée par le core" />
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

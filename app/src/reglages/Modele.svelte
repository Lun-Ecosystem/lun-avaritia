<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import { SettingsCard, SettingsRow, Skeleton, TextInput, toast } from '../lib/ui/index.ts';
  import ModelPicker from './ModelPicker.svelte';
  import Providers from './Providers.svelte';
  import { dollars, num, type SettingsStore } from './settings.svelte.ts';
  import type { ModelChoice, ModelOffer, ProviderView } from './types.ts';

  /*
   * The language model: the keys of the providers, the model of the lots and of the agent, the
   * monthly cap with the month spend.
   */

  type Use = 'tri' | 'agent';
  let { store, spend }: { store: SettingsStore; spend: number | null } = $props();

  const api = getContext<Api>('api');
  /** `null`: the keys could not be read (Providers offers to retry); `loaded` false: not yet. */
  let providers = $state<ProviderView[] | null>(null);
  let loaded = $state(false);
  let models = $state<Record<Use, ModelOffer[]>>({ tri: [], agent: [] });
  let choice = $state<Record<Use, ModelChoice | null>>({ tri: null, agent: null });
  let cap = $state('');

  $effect(() => {
    const saved = store.shown('cost.monthlyCap');
    if (saved !== undefined) cap = String(saved);
  });

  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Lecture impossible.');

  function loadModels() {
    for (const use of ['tri', 'agent'] as const)
      api
        .get<{ models: ModelOffer[] }>(`/api/llm/models?use=${use}`)
        .then((r) => {
          models[use] = r.models;
        })
        .catch(() => {
          models[use] = [];
        });
    api
      .get<Record<Use, ModelChoice | null>>('/api/llm/choice')
      .then((r) => (choice = r))
      .catch(() => {});
  }

  api
    .get<{ providers: ProviderView[] }>('/api/llm/providers')
    .then((r) => (providers = r.providers))
    .catch(() => (providers = null))
    .finally(() => (loaded = true));
  loadModels();

  async function choose(use: Use, next: ModelChoice) {
    try {
      choice[use] = await api.send<ModelChoice>('PUT', '/api/llm/choice', { use, ...next });
      toast('Modèle enregistré');
    } catch (e) {
      toast(message(e), { tone: 'danger' });
    }
  }
</script>

<SettingsCard title="Modèle de langage">
  {#if loaded}
    <Providers {api} bind:providers onchange={loadModels} />
  {:else}
    <div class="attente" role="status" aria-label="Chargement des clés"><Skeleton height={40} /></div>
  {/if}
  <SettingsRow label="Modèle des lots" hint="Lecture des lots et des dépôts, rédaction des brouillons">
    <ModelPicker
      label="Modèle des lots"
      models={models.tri}
      value={choice.tri}
      onchange={(c) => choose('tri', c)}
    />
  </SettingsRow>
  <SettingsRow label="Modèle de l’agent" hint="Conversation et recherche dans la mémoire">
    <ModelPicker
      label="Modèle de l’agent"
      models={models.agent}
      value={choice.agent}
      onchange={(c) => choose('agent', c)}
    />
  </SettingsRow>
  <SettingsRow
    label="Plafond de coût mensuel"
    hint={!store.values
      ? undefined
      : spend === null
        ? 'Dépense du mois inconnue'
        : `${dollars(spend)} $ sur ${dollars(store.values['cost.monthlyCap'])} $`}
    error={store.errors['cost.monthlyCap']}
  >
    {#snippet children({ labelId })}
      <TextInput
        type="number"
        size="petit"
        class="nombre"
        min="0"
        max="50"
        step="0.5"
        suffix="$"
        aria-labelledby={labelId}
        disabled={!store.values}
        bind:value={cap}
        onchange={() => store.save('cost.monthlyCap', num(cap))}
      />
    {/snippet}
  </SettingsRow>
</SettingsCard>

<style>
  .attente {
    padding: 14px 18px;
    border-bottom: 1px solid var(--bordure);
  }
</style>

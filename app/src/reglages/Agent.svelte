<script lang="ts">
  import { AGENT_ICONS, agentIcon, type AgentIcon } from '../agent/icons.ts';
  import {
    Field,
    ICON_STROKE,
    Segmented,
    SettingsCard,
    SettingsRow,
    TextArea,
    TextInput,
    type Option,
  } from '../lib/ui/index.ts';
  import type { Settings, SettingsStore } from './settings.svelte.ts';

  /*
   * The voice of the agent: its name, its icon (previewed in the bubble), its tone and the context of
   * its character. None of it changes what the agent may do.
   */

  let { store }: { store: SettingsStore } = $props();
  let name = $state('');
  let persona = $state('');
  $effect(() => {
    if (!store.values) return;
    name = store.values['agent.name'];
    persona = store.values['agent.persona'];
  });

  const ICON_OPTIONS: Option[] = Object.entries(AGENT_ICONS).map(([value, { label, icon }]) => ({
    value,
    label,
    icon,
  }));
  const TONES: Option[] = [
    { value: 'neutre', label: 'Neutre' },
    { value: 'chaleureux', label: 'Chaleureux' },
    { value: 'concis', label: 'Concis' },
  ];

  const shownName = $derived(store.values?.['agent.name'] ?? '');
  const Icon = $derived(agentIcon(store.values?.['agent.icon'] ?? 'sparkles'));
</script>

<SettingsCard title="Agent" description="Sa voix, jamais ses droits.">
  {#snippet aside()}
    <span class="apercu" role="img" aria-label={`Aperçu de la bulle : ${shownName}`}>
      <span class="bulle"><Icon size={18} strokeWidth={ICON_STROKE} aria-hidden="true" /></span>
      <span class="nom" aria-hidden="true">{shownName}</span>
    </span>
  {/snippet}
  <div class="bloc">
    <Field label="Nom" error={store.errors['agent.name']}>
      <TextInput
        size="petit"
        maxlength={40}
        disabled={!store.values}
        bind:value={name}
        onchange={() => store.save('agent.name', name.trim())}
      />
    </Field>
  </div>
  <SettingsRow label="Icône" error={store.errors['agent.icon']}>
    <Segmented
      options={ICON_OPTIONS}
      iconOnly
      size="petit"
      label="Icône"
      disabled={!store.values}
      value={store.values?.['agent.icon'] ?? ''}
      onchange={(v) => store.save('agent.icon', v as AgentIcon)}
    />
  </SettingsRow>
  <SettingsRow label="Ton" error={store.errors['agent.tone']}>
    <Segmented
      options={TONES}
      size="petit"
      label="Ton"
      disabled={!store.values}
      value={store.values?.['agent.tone'] ?? ''}
      onchange={(v) => store.save('agent.tone', v as Settings['agent.tone'])}
    />
  </SettingsRow>
  <div class="bloc">
    <Field
      label="Contexte du personnage"
      hint="Règle la voix de l’agent, jamais ce qu’il a le droit de faire"
      error={store.errors['agent.persona']}
    >
      <TextArea
        rows={3}
        maxlength={500}
        disabled={!store.values}
        bind:value={persona}
        onchange={() => store.save('agent.persona', persona)}
      />
    </Field>
    <span class="compteur">{persona.length} / 500</span>
  </div>
</SettingsCard>

<style>
  .bloc {
    position: relative;
    padding: 14px 18px;
    border-bottom: 1px solid var(--bordure);
  }
  .bloc:last-child {
    border-bottom: 0;
  }
  .compteur {
    position: absolute;
    top: 14px;
    right: 18px;
    font-size: 12px;
    color: var(--texte-3);
    font-variant-numeric: tabular-nums;
  }
  .apercu {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 180px;
  }
  .bulle {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--accent);
    border: 1px solid var(--accent-survol);
    color: var(--texte);
  }
  .nom {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 400 16px/1.2 var(--serif);
  }
  @media (max-width: 767.98px) {
    .bloc {
      padding: 14px;
    }
    .compteur {
      right: 14px;
    }
  }
</style>

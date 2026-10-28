<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import { Badge, Banner, Button, icons, SettingsCard, SettingsRow } from '../lib/ui/index.ts';
  import Agent from '../reglages/Agent.svelte';
  import Appareils from '../reglages/Appareils.svelte';
  import Donnees from '../reglages/Donnees.svelte';
  import Lots from '../reglages/Lots.svelte';
  import Modele from '../reglages/Modele.svelte';
  import { SettingsStore } from '../reglages/settings.svelte.ts';
  import Types from '../reglages/Types.svelte';

  /*
   * The settings, in the cards of the mockup (language model, core lots, structure, data), then the
   * agent, the devices and the service. The whole screen is loaded on demand by the app.
   */

  type Props = {
    /** The service paused by hand, as the rail shows it. */
    paused: boolean;
    /** After a pause or a resume: the app reads the service state again. */
    onservice: () => Promise<void>;
  };
  let { paused, onservice }: Props = $props();

  const api = getContext<Api>('api');
  const store = new SettingsStore(api);
  store.load();
  let spend = $state<number | null>(null);
  api
    .get<{ monthSpend: number }>('/api/dashboard')
    .then((d) => (spend = d.monthSpend))
    .catch(() => {});

  let switching = $state(false);
  let serviceError = $state<string | null>(null);
  async function toggleService() {
    switching = true;
    serviceError = null;
    try {
      await api.send('POST', paused ? '/lun/v1/resume' : '/lun/v1/pause');
    } catch (e) {
      serviceError = e instanceof Error && e.message ? e.message : 'L’action a échoué.';
    } finally {
      // Even refused (409: already in that state), the rail must show the state of the server.
      await onservice();
      switching = false;
    }
  }
</script>

<div class="ecran">
  <header class="entete">
    <h1>Réglages</h1>
  </header>

  {#if store.failure}
    <Banner title="Réglages indisponibles">{store.failure}</Banner>
  {/if}

  <div class="grille">
    <Modele {store} {spend} />
    <Lots {store} />
    <Types />
    <Donnees />
    <Agent {store} />
    <Appareils />
    <SettingsCard title="Service" description="La pause arrête tout ce qui est automatique.">
      {#snippet aside()}
        <Badge tone={paused ? 'attention' : 'ok'} dot>{paused ? 'En pause' : 'Actif'}</Badge>
      {/snippet}
      <SettingsRow
        label="Traitement"
        hint={paused
          ? 'Aucun lot ni dépôt n’est lu, aucun appel au modèle.'
          : 'Les lots et les dépôts sont lus dès leur arrivée.'}
        error={serviceError}
      >
        <Button
          size="petit"
          icon={paused ? icons.Play : icons.Pause}
          loading={switching}
          onclick={toggleService}>{paused ? 'Reprendre' : 'Pause'}</Button
        >
      </SettingsRow>
    </SettingsCard>
  </div>
</div>

<style>
  .ecran {
    display: grid;
    gap: 16px;
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px;
  }
  h1 {
    margin: 0;
    font: 400 26px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .grille {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    align-items: start;
  }
  .ecran :global(.entree.nombre) {
    width: 104px;
  }
  @media (max-width: 759.98px) {
    .ecran {
      padding: 16px;
    }
    .grille {
      grid-template-columns: 1fr;
    }
  }
</style>

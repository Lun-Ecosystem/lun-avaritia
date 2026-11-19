<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import { Button, SettingsCard, SettingsRow } from '../lib/ui/index.ts';

  /* What comes in (an Obsidian vault, on the screen of the deposits) and what goes out (Markdown). */

  const api = getContext<Api>('api');
  let busy = $state(false);
  let written = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function exportMarkdown() {
    busy = true;
    error = null;
    try {
      const { blob, name, headers } = await api.download('POST', '/api/export');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = name;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      const n = Number(headers.get('x-avaritia-fiches') ?? 0);
      written =
        n === 0
          ? 'Aucune fiche, l’archive est vide'
          : `${n} fiche${n > 1 ? 's' : ''} téléchargée${n > 1 ? 's' : ''}`;
    } catch (e) {
      error = e instanceof Error && e.message ? e.message : 'L’export a échoué.';
    } finally {
      busy = false;
    }
  }
</script>

<SettingsCard title="Données">
  <SettingsRow label="Importer un coffre Obsidian" hint="Dossier Markdown, en brouillons à valider">
    <Button size="petit" href="/depots">Importer</Button>
  </SettingsRow>
  <SettingsRow label="Exporter en Markdown" hint={written ?? 'Une archive, un fichier par fiche'} {error}>
    <Button size="petit" loading={busy} onclick={exportMarkdown}>Exporter</Button>
  </SettingsRow>
</SettingsCard>

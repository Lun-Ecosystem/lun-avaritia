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
      const r = await api.send<{ dir: string; files: string[] }>('POST', '/api/export');
      const n = r.files.length;
      written = `${n} fichier${n > 1 ? 's' : ''} dans ${r.dir}`;
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
  <SettingsRow
    label="Exporter en Markdown"
    hint={written ?? 'Un fichier par fiche, dans le dossier de données'}
    {error}
  >
    <Button size="petit" loading={busy} onclick={exportMarkdown}>Exporter</Button>
  </SettingsRow>
</SettingsCard>

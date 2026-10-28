<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import { readVault } from '../depots/vault.ts';
  import { formatWhen } from '../format.ts';
  import {
    Banner,
    Button,
    ConfirmDialog,
    DropZone,
    EmptyState,
    icons,
    ListRow,
    Skeleton,
  } from '../lib/ui/index.ts';

  /*
   * Documents dropped for the memory, and the import of an Obsidian vault. Both end as drafts to
   * validate. A deposit is read by the model at once: without a key the server says so, and the
   * message is shown as is.
   */

  type Depot = {
    id: number;
    name: string;
    type: string;
    size: number;
    createdAt: string;
    pending: number;
    total: number;
  };

  const api = getContext<Api>('api');
  let depots = $state<Depot[] | null>(null);
  let failure = $state<string | null>(null);
  let busy = $state(false);
  let result = $state<{ text: string; link: boolean; extra?: string } | null>(null);
  let error = $state<string | null>(null);
  let removing = $state<Depot | null>(null);
  let confirmOpen = $state(false);
  const now = new Date();

  function load() {
    api
      .get<{ depots: Depot[] }>('/api/depots')
      .then((r) => {
        depots = r.depots;
        failure = null;
      })
      .catch((e: Error) => (failure = e.message));
  }
  load();

  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'L’envoi a échoué.');
  const n = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
  const size = (bytes: number) => (bytes < 1024 ? `${bytes} o` : `${Math.round(bytes / 1024)} ko`);

  async function drop(files: File[]) {
    busy = true;
    result = null;
    error = null;
    let drafts = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        try {
          drafts += (await api.upload<{ drafts: number }>('/api/depots', form)).drafts;
        } catch (e) {
          error = files.length > 1 ? `${file.name} : ${message(e)}` : message(e);
          break;
        }
      }
      if (!error)
        result = {
          text:
            drafts > 1 ? `${drafts} brouillons créés` : drafts ? 'Brouillon créé' : 'Aucun brouillon créé',
          link: drafts > 0,
        };
      load();
    } finally {
      busy = false;
    }
  }

  async function importVault(files: File[]) {
    busy = true;
    result = null;
    error = null;
    try {
      const vault = await readVault(files);
      if (vault.tooBig) {
        error = 'Coffre trop gros (20 Mo au plus)';
        return;
      }
      const sent = await api.send<{ notes: number }>('POST', '/api/import', { files: vault.files });
      result = {
        text: `1 brouillon d’import, ${n(sent.notes, 'note', 'notes')}`,
        link: true,
        ...(vault.skipped && {
          extra: `${n(vault.skipped, 'fichier non Markdown ignoré', 'fichiers non Markdown ignorés')}`,
        }),
      };
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!removing) return;
    await api.send('DELETE', `/api/depots/${removing.id}`);
    load();
  }
</script>

<div class="ecran">
  <header class="entete">
    <h1>Dépôts</h1>
    <span class="muted">Chaque dépôt devient des brouillons à valider.</span>
  </header>

  <div class="zones">
    <DropZone
      title="Déposer un document"
      hint="Texte ou Markdown. Les PDF ne sont pas pris en charge."
      label="Choisir un document"
      icon={icons.FileText}
      {busy}
      onfiles={drop}
    />
    <DropZone
      title="Importer un coffre Obsidian"
      hint="Un dossier : seules les notes Markdown sont lues."
      label="Importer un coffre Obsidian"
      icon={icons.Folder}
      directory
      {busy}
      onfiles={importVault}
    />
  </div>

  {#if error}
    <Banner title="Dépôt refusé">{error}</Banner>
  {:else if result}
    <Banner tone="info" title={result.text}>
      {#if result.link}<a href="/valider">Voir à valider</a>{/if}
    </Banner>
    {#if result.extra}<p class="muted">{result.extra}</p>{/if}
  {/if}

  {#if failure}
    <Banner title="Liste indisponible">{failure}</Banner>
  {:else if !depots}
    <Skeleton height={60} />
  {:else if !depots.length}
    <EmptyState
      tone="neutre"
      title="Aucun dépôt."
      message="Les documents déposés apparaissent ici."
      icon={icons.Inbox}
    />
  {:else}
    <section class="carte" aria-label="Dépôts">
      {#each depots as d (d.id)}
        <ListRow>
          <div class="nom">{d.name}</div>
          <div class="muted">
            {size(d.size)} · {formatWhen(d.createdAt, now)} ·
            <span>{`${n(d.pending, 'brouillon', 'brouillons')} en attente sur ${d.total}`}</span>
          </div>
          {#snippet actions()}
            <Button
              variant="fantome"
              size="petit"
              onclick={() => {
                removing = d;
                confirmOpen = true;
              }}>Supprimer</Button
            >
          {/snippet}
        </ListRow>
      {/each}
    </section>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Supprimer ce dépôt ?"
  message={`« ${removing?.name ?? ''} » est retiré. Les fiches déjà validées gardent leur source.`}
  confirmLabel="Supprimer le dépôt"
  confirmVariant="danger-plein"
  onconfirm={remove}
/>

<style>
  .ecran {
    display: grid;
    gap: 14px;
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  .entete {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
  }
  h1 {
    margin: 0;
    font: 400 26px/1.2 var(--serif);
  }
  .muted {
    color: var(--texte-2);
    font-size: 12.5px;
  }
  .zones {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .carte {
    background: var(--surface);
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
    overflow: hidden;
  }
  .nom {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a {
    color: var(--accent-texte);
  }
  @media (max-width: 759.98px) {
    .ecran {
      padding: 16px;
    }
    .zones {
      grid-template-columns: 1fr;
    }
  }
</style>

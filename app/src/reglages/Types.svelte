<script lang="ts">
  import { getContext } from 'svelte';
  import type { Api } from '../api.ts';
  import {
    Banner,
    Button,
    ConfirmDialog,
    Field,
    icons,
    SettingsCard,
    SettingsRow,
    Skeleton,
    TextInput,
  } from '../lib/ui/index.ts';
  import Dialog from '../lib/ui/Dialog.svelte';

  /*
   * The types of fiche: added, renamed, removed. The server refuses to remove a type still used by a
   * fiche; its reason is shown in the confirmation.
   */

  type FicheType = { id: number; name: string };

  const api = getContext<Api>('api');
  const uid = $props.id();
  let types = $state<FicheType[] | null>(null);
  let failure = $state<string | null>(null);
  let name = $state('');
  let addError = $state<string | undefined>();
  let adding = $state(false);
  let renaming = $state<FicheType | null>(null);
  let newName = $state('');
  let renameError = $state<string | undefined>();
  let renamingBusy = $state(false);
  let removing = $state<FicheType | null>(null);

  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'L’action a échoué.');

  async function load() {
    try {
      types = (await api.get<{ types: FicheType[] }>('/api/types')).types;
      failure = null;
    } catch (e) {
      failure = message(e);
    }
  }
  void load();

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || adding) return;
    adding = true;
    addError = undefined;
    try {
      await api.send('POST', '/api/types', { name: name.trim() });
      name = '';
      await load();
    } catch (err) {
      addError = message(err);
    } finally {
      adding = false;
    }
  }

  async function rename(e: SubmitEvent) {
    e.preventDefault();
    if (!renaming || !newName.trim() || renamingBusy) return;
    renamingBusy = true;
    renameError = undefined;
    try {
      types = (
        await api.send<{ types: FicheType[] }>('PATCH', `/api/types/${renaming.id}`, { name: newName.trim() })
      ).types;
      renaming = null;
    } catch (err) {
      renameError = message(err);
    } finally {
      renamingBusy = false;
    }
  }

  async function remove() {
    await api.send('DELETE', `/api/types/${removing!.id}`);
    await load();
  }
</script>

<SettingsCard title="Structure des fiches" description="Les types proposés aux brouillons et aux fiches.">
  {#if failure}
    <div class="bloc"><Banner title="Types indisponibles">{failure}</Banner></div>
  {:else if !types}
    <div class="bloc"><Skeleton height={40} /></div>
  {:else}
    {#each types as t (t.id)}
      <SettingsRow label={t.name}>
        <Button
          variant="fantome"
          size="petit"
          aria-label={`Renommer ${t.name}`}
          onclick={() => {
            renaming = t;
            newName = t.name;
            renameError = undefined;
          }}>Renommer</Button
        >
        <Button variant="fantome" size="petit" aria-label={`Retirer ${t.name}`} onclick={() => (removing = t)}
          >Retirer</Button
        >
      </SettingsRow>
    {/each}
    <form class="bloc ajout" onsubmit={add}>
      <Field label="Nouveau type" error={addError}>
        <TextInput size="petit" bind:value={name} maxlength={60} />
      </Field>
      <Button type="submit" size="petit" icon={icons.Plus} loading={adding} disabled={!name.trim()}
        >Ajouter</Button
      >
    </form>
  {/if}
</SettingsCard>

<Dialog
  bind:open={() => renaming !== null, (open) => !open && (renaming = null)}
  title="Renommer le type"
  description={renaming ? `Les fiches de « ${renaming.name} » suivent le nouveau nom.` : undefined}
>
  {#snippet children()}
    <form id="{uid}-nom" onsubmit={rename}>
      <Field label="Nom" error={renameError}>
        <TextInput bind:value={newName} maxlength={60} />
      </Field>
    </form>
  {/snippet}
  {#snippet footer({ close })}
    <Button onclick={close}>Annuler</Button>
    <Button
      type="submit"
      form="{uid}-nom"
      variant="principal"
      loading={renamingBusy}
      disabled={!newName.trim()}>Renommer</Button
    >
  {/snippet}
</Dialog>

<ConfirmDialog
  bind:open={() => removing !== null, (open) => !open && (removing = null)}
  title={`Retirer le type ${removing?.name ?? ''} ?`}
  message="Un type encore utilisé par une fiche reste en place."
  confirmLabel="Retirer le type"
  onconfirm={remove}
/>

<style>
  .bloc {
    padding: 14px 18px;
  }
  .ajout {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .ajout :global(.champ) {
    flex: 1;
  }
  @media (max-width: 767.98px) {
    .bloc {
      padding: 14px;
    }
  }
</style>

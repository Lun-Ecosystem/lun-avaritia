<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Field, icons, TextArea, TextInput } from '../lib/ui/index.ts';

  /* The user's own correction of a fiche: title and synthesis, written at once by « Enregistrer ». */

  type Props = {
    title: string;
    synthesis: string;
    busy?: boolean | undefined;
    error?: string | undefined;
    onsave: (edit: { title: string; synthesis: string }) => void;
    oncancel: () => void;
  };

  let { title: t0, synthesis: s0, busy = false, error, onsave, oncancel }: Props = $props();

  let title = $state(untrack(() => t0));
  let synthesis = $state(untrack(() => s0));
</script>

<div class="edition">
  <Field label="Titre">
    <TextInput bind:value={title} />
  </Field>
  <Field label="Synthèse" hint="Gras **ainsi**, italique *ainsi*, lien vers une fiche [[Titre]].">
    <TextArea bind:value={synthesis} rows={8} maxlength={20000} />
  </Field>
  {#if error}<p class="erreur" role="alert">{error}</p>{/if}
  <div class="actions">
    <Button
      variant="principal"
      size="petit"
      icon={icons.Check}
      loading={busy}
      disabled={!title.trim()}
      onclick={() => onsave({ title: title.trim(), synthesis })}>Enregistrer</Button
    >
    <Button variant="fantome" size="petit" disabled={busy} onclick={oncancel}>Annuler</Button>
  </div>
</div>

<style>
  .edition {
    display: grid;
    gap: 14px;
  }
  .erreur {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
</style>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Checkbox, Field, TextArea, TextInput, icons } from '../lib/ui/index.ts';
  import type { FicheDraft } from './drafts.ts';

  /*
   * A fiche draft corrected before it is accepted: its title, its synthesis, and a box per fact or
   * link (unticked, it is left out). Nothing is written until « Valider ».
   */

  type Props = {
    draft: FicheDraft;
    names: Record<number, string>;
    busy?: boolean | undefined;
    onsubmit: (payload: FicheDraft) => void;
    oncancel: () => void;
  };

  let { draft, names, busy = false, onsubmit, oncancel }: Props = $props();

  // The editor starts from the draft once; later changes of the queue do not reset a correction.
  const start = untrack(() => $state.snapshot(draft)) as FicheDraft;
  let title = $state(start.title);
  let synthesis = $state(start.synthesis);
  let facts = $state(start.facts.map(() => true));
  let links = $state(start.links.map(() => true));

  const linkLabel = (l: FicheDraft['links'][number]) =>
    `${l.relation} : ${typeof l.to === 'number' ? (names[l.to] ?? `fiche n° ${l.to}`) : l.to}`;

  function submit() {
    onsubmit({
      ...start,
      title: title.trim() || start.title,
      synthesis,
      facts: start.facts.filter((_, i) => facts[i]),
      links: start.links.filter((_, i) => links[i]),
    });
  }
</script>

<div class="edition">
  <Field label="Titre">
    <TextInput bind:value={title} />
  </Field>
  <Field label="Synthèse" hint="Gras **ainsi**, italique *ainsi*, lien vers une fiche [[Titre]].">
    <TextArea bind:value={synthesis} rows={5} />
  </Field>
  {#if start.facts.length}
    <fieldset>
      <legend>Faits ajoutés</legend>
      {#each start.facts as f, i (i)}
        <Checkbox bind:checked={facts[i]} label={f.text} />
      {/each}
    </fieldset>
  {/if}
  {#if start.links.length}
    <fieldset>
      <legend>Liens</legend>
      {#each start.links as l, i (i)}
        <Checkbox bind:checked={links[i]} label={linkLabel(l)} />
      {/each}
    </fieldset>
  {/if}
  <div class="actions">
    <Button variant="principal" size="petit" icon={icons.Check} loading={busy} onclick={submit}
      >Valider</Button
    >
    <Button variant="fantome" size="petit" onclick={oncancel}>Annuler</Button>
  </div>
</div>

<style>
  .edition {
    display: grid;
    gap: 14px;
  }
  fieldset {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 8px;
    padding: 0;
    font: 400 13px/1.4 var(--sans);
    color: var(--texte);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>

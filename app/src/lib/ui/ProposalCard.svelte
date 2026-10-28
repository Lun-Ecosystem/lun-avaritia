<script lang="ts">
  import type { ProposalView } from '../types.ts';
  import Button from './Button.svelte';
  import { Check, ICON_STROKE, Sparkles } from './Icon.ts';
  import Kbd from './Kbd.svelte';

  /*
   * Full proposal of the AI, in the reading pane: what it wants to do, how sure it is, why, and the
   * three answers (validate, put elsewhere, keep in the inbox).
   */

  type Props = {
    proposal: ProposalView;
    boxName: string;
    /** Tags the AI proposes besides the box. */
    tagNames?: string[] | undefined;
    /** Short justification of the AI (160 characters at most), when it gave one. */
    reason?: string | undefined;
    /** Auto-sort threshold, in %: under it, the proposal waits for a validation. */
    threshold: number;
    onvalidate: () => void;
    oncorrect: (anchor: HTMLElement) => void;
    /** « Garder en réception »; the button is left out without it. */
    onkeep?: (() => void) | undefined;
    class?: string | undefined;
  };

  let {
    proposal,
    boxName,
    tagNames = [],
    reason,
    threshold,
    onvalidate,
    oncorrect,
    onkeep,
    class: className,
  }: Props = $props();

  const confidence = $derived(Math.round(proposal.confidence));
  const waiting = $derived(confidence < threshold);
</script>

<section class={['propo', className]} aria-label="Proposition de l’IA">
  <div class="tete">
    <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
    <span>Proposition de l’IA</span>
    <span class="jauge">
      confiance
      <span class="barre" aria-hidden="true"><span style:width="{confidence}%"></span></span>
      <span class="valeur">{confidence}&nbsp;%</span>
    </span>
  </div>
  <p class={['quoi', { seul: !reason && !waiting }]}>
    Ranger dans <b>{boxName}</b>{#if tagNames.length}{' · '}étiquette{tagNames.length > 1 ? 's' : ''}
      <b>{tagNames.join(', ')}</b>{/if}
  </p>
  {#if reason || waiting}
    <p class="pourquoi">
      {#if reason}{reason}{/if}
      {#if waiting}{reason ? ' ' : ''}Sous le seuil de {threshold}&nbsp;% : en attente de validation.{/if}
    </p>
  {/if}
  <div class="actions">
    <Button variant="doux" size="petit" icon={Check} aria-keyshortcuts="V" onclick={onvalidate}
      >Valider</Button
    >
    <Button
      variant="secondaire"
      size="petit"
      aria-keyshortcuts="C"
      onclick={(event) => oncorrect(event.currentTarget)}>Ranger ailleurs…</Button
    >
    {#if onkeep}
      <Button variant="fantome" size="petit" onclick={onkeep}>Garder en réception</Button>
    {/if}
    <span class="touches" aria-hidden="true"><Kbd>V</Kbd><Kbd>C</Kbd></span>
  </div>
</section>

<style>
  .propo {
    padding: 12px 14px;
    border: 1px solid var(--ia-bord);
    border-radius: var(--r-2);
    background: linear-gradient(180deg, var(--ia-doux), color-mix(in srgb, var(--ia) 2%, transparent));
  }
  .tete {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ia);
    font: 400 12.5px var(--sans);
  }
  .tete :global(svg) {
    flex: none;
  }
  .jauge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    color: var(--texte-3);
    font-size: 12px;
  }
  .barre {
    width: 52px;
    height: 4px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--surface-3);
  }
  .barre span {
    display: block;
    height: 100%;
    background: var(--ia);
  }
  .valeur {
    font-variant-numeric: tabular-nums;
  }
  .quoi {
    margin: 6px 0 2px;
    font: 400 14.5px var(--sans);
  }
  .quoi b {
    font-weight: 500;
  }
  .pourquoi {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--texte-2);
  }
  .quoi.seul {
    margin-bottom: 10px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .touches {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
  }
  @media (max-width: 767.98px) {
    .touches {
      display: none;
    }
  }
</style>

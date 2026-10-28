<script lang="ts">
  import { getContext, tick } from 'svelte';
  import type { Api } from '../api.ts';
  import { formatCost } from '../format.ts';
  import { ICON_STROKE, IconButton, icons } from '../lib/ui/index.ts';
  import Prose from '../Prose.svelte';
  import Bulle from './Bulle.svelte';
  import { agentIdentity, agentPanel, Conversation, takeIdentity } from './conversation.svelte.ts';
  import { agentIcon } from './icons.ts';

  /*
   * The agent: a bubble in the bottom right corner of every screen, and a panel over the screen that
   * never resizes it (400 px on a desktop, the full screen under 760 px). The thread lives in the page.
   */

  type Props = {
    /** The fiche open in the memory (`?fiche=<id>`), sent as context. */
    fiche?: string | null | undefined;
  };

  let { fiche = null }: Props = $props();

  const api = getContext<Api>('api');
  const conversation = new Conversation(api);
  const name = $derived(agentIdentity.name);
  const Icon = $derived(agentIcon(agentIdentity.icon));

  let text = $state('');
  let bubble = $state<HTMLButtonElement | null>(null);
  let fil = $state<HTMLElement | null>(null);

  // Read once; Réglages updates the identity on each save.
  api
    .get<{ settings: Record<string, unknown> }>('/api/settings')
    .then(({ settings }) => takeIdentity(settings))
    .catch(() => {});

  /** Under 760 px the panel takes the screen: it is modal, the rest of the page is inert. */
  let modal = $state(false);
  function holdPage(panel: HTMLElement) {
    // shortcut: decided at opening, a resize across 760 px while open keeps that mode; reopen to switch.
    if (!(window.matchMedia?.('(max-width: 759.98px)').matches ?? false)) return;
    modal = true;
    const held: HTMLElement[] = [];
    for (
      let node: HTMLElement = panel;
      node.parentElement && node !== document.body;
      node = node.parentElement
    )
      for (const sibling of node.parentElement.children)
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          held.push(sibling);
        }
    return () => {
      modal = false;
      for (const h of held) h.inert = false;
    };
  }

  /** Tab and Shift Tab go round inside the panel while it is modal. */
  function trap(event: KeyboardEvent, panel: HTMLElement) {
    if (!modal || event.key !== 'Tab') return;
    const stops = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, a[href]')];
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // A request handed by another screen (« Écrire une note ») lands in the field.
  $effect(() => {
    if (!agentPanel.open || !agentPanel.draft) return;
    text = agentPanel.draft;
    agentPanel.draft = '';
  });

  // The latest message in view.
  $effect(() => {
    void [conversation.messages.length, conversation.asking];
    if (fil) fil.scrollTop = fil.scrollHeight;
  });

  async function close(refocus = true) {
    agentPanel.open = false;
    await tick();
    if (refocus) bubble?.focus();
  }

  function ask() {
    const request = text;
    if (!request.trim() || conversation.asking) return;
    text = '';
    void conversation.send(request, fiche ? { fiche } : undefined).then((ok) => {
      // A failed request comes back to the field, unless a new one is being typed.
      if (!ok && !text) text = request;
    });
  }

  function onfieldkey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }
</script>

{#if agentPanel.open}
  <div
    class="panneau"
    role="dialog"
    aria-label={name}
    tabindex="-1"
    aria-modal={modal}
    onkeydown={(e) => {
      // The screen's shortcuts (V, R on À valider) stay outside the panel.
      e.stopPropagation();
      if (e.key === 'Escape') void close();
      else trap(e, e.currentTarget);
    }}
    {@attach holdPage}
  >
    <header>
      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <h2>{name}</h2>
      <span class="fin">
        {#if conversation.messages.length}
          <IconButton
            icon={icons.Trash}
            size="petit"
            label="Effacer l’échange"
            onclick={() => conversation.clear()}
          />
        {/if}
        <IconButton icon={icons.X} size="petit" label="Fermer" shortcut="Échap" onclick={() => close()} />
      </span>
    </header>

    <div class="fil" bind:this={fil} role="log" aria-label="Échange avec {name}">
      {#if fiche}<span class="contexte">Contexte : la fiche ouverte</span>{/if}
      {#if !conversation.messages.length && !conversation.asking}
        <p class="vide">
          Poser une question sur la mémoire, ou dicter une note : « note que … ». Une note devient un
          brouillon à valider, rien n’entre sans validation.
        </p>
      {/if}
      {#each conversation.messages as m, i (i)}
        {#if m.role === 'user'}
          <div class="msg moi">{m.text}</div>
        {:else}
          <div class={['msg', 'ia', { erreur: m.error }]}>
            <Prose text={m.text} />
            {#if m.drafts}
              <a href="/valider" class="suite" onclick={() => close(false)}>Voir dans À valider</a>
            {/if}
            {#if m.cost}<span class="cout">{formatCost(m.cost)}</span>{/if}
          </div>
        {/if}
      {/each}
      {#if conversation.asking}
        <div class="msg ia attente" aria-live="polite">
          <span class="sr">{name} réfléchit</span><i></i><i></i><i></i>
        </div>
      {/if}
    </div>

    <div class="saisie">
      <textarea
        bind:value={text}
        rows="1"
        aria-label="Demande à {name}"
        placeholder="Demander à {name}…"
        maxlength={4000}
        onkeydown={onfieldkey}
        {@attach (node) => node.focus()}></textarea>
      <IconButton
        icon={icons.Send}
        size="petit"
        variant="principal"
        label="Envoyer"
        disabled={!text.trim() || conversation.asking}
        onclick={ask}
      />
    </div>
  </div>
{:else}
  <Bulle bind:element={bubble} {name} icon={Icon} onclick={() => (agentPanel.open = true)} />
{/if}

<style>
  .panneau {
    position: fixed;
    right: var(--agent-lanceur-bas);
    bottom: var(--agent-lanceur-bas);
    /* Over the graph's side panel (30), under the dialogs (50) and the toasts (60). */
    z-index: 45;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 400px;
    height: min(600px, calc(100dvh - 2 * var(--agent-lanceur-bas)));
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-3);
    background: var(--surface-1);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 300 14px/1.5 var(--sans);
  }
  header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    height: 50px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--bordure);
  }
  header > :global(svg) {
    flex: none;
    color: var(--ia);
  }
  h2 {
    margin: 0;
    overflow: hidden;
    font: 500 18px var(--serif);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .fin {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .fil {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 14px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .contexte {
    align-self: flex-start;
    padding: 2px 9px;
    border: 1px solid var(--bordure);
    border-radius: 12px;
    background: var(--surface-2);
    font-size: 11.5px;
    color: var(--texte-2);
  }
  .vide {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--texte-3);
  }
  .msg {
    max-width: 86%;
    padding: 9px 12px;
    border-radius: 12px;
    font-size: 13.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .moi {
    align-self: flex-end;
    border: 1px solid var(--accent-bord);
    border-bottom-right-radius: 4px;
    background: var(--accent-doux);
    white-space: pre-line;
  }
  .ia {
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    gap: 6px;
    border: 1px solid var(--bordure);
    border-bottom-left-radius: 4px;
    background: var(--surface-2);
  }
  .erreur {
    border-color: var(--danger);
  }
  .suite {
    align-self: flex-start;
    color: var(--accent-texte);
    font-size: 12.5px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .suite:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .cout {
    font-size: 11.5px;
    color: var(--texte-3);
  }
  .attente {
    flex-direction: row;
    gap: 4px;
    padding: 13px 14px;
  }
  .attente i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ia);
    animation: pouls 1.2s ease-in-out infinite;
  }
  .attente i:nth-of-type(2) {
    animation-delay: 0.15s;
  }
  .attente i:nth-of-type(3) {
    animation-delay: 0.3s;
  }
  @keyframes pouls {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .attente i {
      animation: none;
      opacity: 0.7;
    }
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .saisie {
    display: flex;
    flex: none;
    align-items: flex-end;
    gap: 8px;
    margin: 10px 12px 12px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    background: var(--fond);
  }
  .saisie:focus-within {
    border-color: var(--accent-bord);
  }
  textarea {
    flex: 1;
    box-sizing: border-box;
    min-height: 28px;
    max-height: 140px;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--texte);
    font: 300 13.5px/1.45 var(--sans);
    resize: none;
    field-sizing: content;
  }
  textarea:focus-visible {
    outline: none;
  }
  textarea::placeholder {
    color: var(--texte-3);
  }

  @media (max-width: 759.98px) {
    .panneau {
      inset: 0;
      width: auto;
      height: auto;
      border: 0;
      border-radius: 0;
    }
    .saisie {
      margin-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }
  }
</style>

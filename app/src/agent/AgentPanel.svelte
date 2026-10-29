<script lang="ts">
  import { getContext, tick, untrack } from 'svelte';
  import type { Api } from '../api.ts';
  import { formatCost } from '../format.ts';
  import { bindShortcuts, ICON_STROKE, IconButton, icons } from '../lib/ui/index.ts';
  import { comboOf } from '../lib/ui/shortcuts.ts';
  import Prose from '../Prose.svelte';
  import Bulle from './Bulle.svelte';
  import { agentIdentity, agentPanel, Conversation, takeIdentity } from './conversation.svelte.ts';
  import { agentIcon } from './icons.ts';
  import { MIN_SIZE, PanelSize, type Size } from './size.svelte.ts';

  /*
   * The agent: a bubble in the bottom right corner of every screen, and a panel over the screen that
   * never resizes it, as Lun'Acedia's Pina. On a desktop it is resized by its left edge, its top edge
   * or its top-left corner (or the arrows on a focused edge), or set to the full height on the right;
   * the size is kept. Ctrl J opens and closes it from anywhere, a field included. Under 768 px: no
   * bubble (the shell's top bar has the agent's button), a sheet rising from the bottom, pulled down to
   * close. The thread lives in the page.
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
  let field = $state<HTMLTextAreaElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  const size = new PanelSize();

  // Read once; Réglages updates the identity on each save.
  api
    .get<{ settings: Record<string, unknown> }>('/api/settings')
    .then(({ settings }) => takeIdentity(settings))
    .catch(() => {});

  const isPhone = () => window.matchMedia?.('(max-width: 767.98px)').matches ?? false;
  /** Under 768 px the top bar has the agent's button: no bubble. */
  let phone = $state(isPhone());
  /** Where the focus was at opening (the top bar's button on a phone), given back at closing. */
  let opener: HTMLElement | null = null;
  $effect.pre(() => {
    if (agentPanel.open)
      opener = untrack(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  });

  /** Under 768 px the panel takes the screen: it is modal, the rest of the page is inert. */
  let modal = $state(false);
  function holdPage(panel: HTMLElement) {
    // shortcut: decided at opening, a resize across 768 px while open keeps that mode; reopen to switch.
    if (!isPhone()) return;
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
    // The veil, drawn once `modal` is set, comes after this walk: it stays clickable to close.
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

  // A request handed by another screen (« Nouvelle note ») lands in the field, the focus with it.
  $effect(() => {
    if (!agentPanel.open || !agentPanel.draft) return;
    text = agentPanel.draft;
    agentPanel.draft = '';
    // After the current task: the palette that asked gives the focus back as it closes. (No cleanup:
    // emptying the draft above runs this effect again.)
    setTimeout(() => field?.focus());
  });

  // The latest message in view.
  $effect(() => {
    void [conversation.messages.length, conversation.asking];
    if (fil) fil.scrollTop = fil.scrollHeight;
  });

  /** Another window has the keyboard (a dialog of a screen): Ctrl J leaves it alone. */
  const otherDialog = () =>
    [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(
      (d) => d !== panel && d.getAttribute('aria-modal') === 'true',
    );

  /** Ctrl J: opens, or closes and gives the focus back to the bubble when it was in the panel. */
  function toggle() {
    if (otherDialog()) return;
    if (!agentPanel.open) {
      agentPanel.open = true;
      return;
    }
    const active = document.activeElement;
    void close(!active || active === document.body || !!panel?.contains(active));
  }

  // Ctrl J from anywhere, a field included (inside the panel, its own keydown handles it).
  $effect(() => bindShortcuts({ 'Ctrl+j': toggle }, window, { fromFields: ['Ctrl+j'] }));

  async function close(refocus = true) {
    agentPanel.open = false;
    await tick();
    if (refocus) (bubble ?? opener)?.focus();
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

  // ---- Size: the left edge, the top edge and the corner pull the panel; it stays anchored bottom right.
  type Edge = 'gauche' | 'haut' | 'coin';
  let drag: { edge: Edge; x: number; y: number; start: Size; id: number } | null = null;

  function grab(edge: Edge) {
    return (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      drag = { edge, x: event.clientX, y: event.clientY, start: { ...size.size }, id: event.pointerId };
    };
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const { edge, x, y, start } = drag;
    size.set({
      width: edge === 'haut' ? start.width : start.width + x - event.clientX,
      height: edge === 'gauche' ? start.height : start.height + y - event.clientY,
    });
    if (edge !== 'gauche') size.maximized = false;
  }
  function release(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    size.set(size.size, true);
  }
  /** Arrows on a focused edge: 16 px a press. */
  function nudge(edge: 'gauche' | 'haut') {
    return (event: KeyboardEvent) => {
      const step = { ArrowLeft: 16, ArrowRight: -16, ArrowUp: 16, ArrowDown: -16 }[event.key];
      const along = edge === 'gauche' ? /Left|Right/.test(event.key) : /Up|Down/.test(event.key);
      if (!step || !along) return;
      event.preventDefault();
      const { width, height } = size.size;
      size.set(edge === 'gauche' ? { width: width + step, height } : { width, height: height + step }, true);
      if (edge === 'haut') size.maximized = false;
    };
  }

  // ---- Phone: the sheet goes down when its handle is pulled.
  let pull: { y: number; id: number } | null = null;

  function onfieldkey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }
</script>

<svelte:window
  onresize={() => {
    size.fit();
    phone = isPhone();
  }}
/>

{#if agentPanel.open}
  {#if modal}
    <button type="button" class="voile" tabindex="-1" aria-label="Fermer {name}" onclick={() => close()}
    ></button>
  {/if}
  <div
    bind:this={panel}
    class={['panneau', { grande: size.maximized }]}
    role="dialog"
    aria-label={name}
    tabindex="-1"
    aria-modal={modal}
    style:--largeur="{size.size.width}px"
    style:--hauteur="{size.size.height}px"
    onkeydown={(e) => {
      // The screen's shortcuts (V, R on À valider) stay outside the panel.
      e.stopPropagation();
      if (e.key === 'Escape') void close();
      else if (comboOf(e) === 'Ctrl+j' && !e.isComposing && !e.repeat) {
        e.preventDefault();
        void close();
      } else trap(e, e.currentTarget);
    }}
    onpointermove={move}
    onpointerup={release}
    onpointercancel={release}
    {@attach holdPage}
  >
    {#if modal}
      <div
        class="poignee"
        aria-hidden="true"
        onpointerdown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          pull = { y: e.clientY, id: e.pointerId };
        }}
        onpointerup={(e) => {
          if (pull && e.pointerId === pull.id && e.clientY - pull.y > 60) void close();
          pull = null;
        }}
      ></div>
    {:else}
      <!-- A focusable separator is a resize control (WAI-ARIA window splitter): arrows change the size. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="bord gauche"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label="Largeur de {name}"
        aria-valuenow={size.size.width}
        aria-valuemin={MIN_SIZE.width}
        onpointerdown={grab('gauche')}
        onkeydown={nudge('gauche')}
      ></div>
      {#if !size.maximized}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="bord haut"
          role="separator"
          tabindex="0"
          aria-orientation="horizontal"
          aria-label="Hauteur de {name}"
          aria-valuenow={size.size.height}
          aria-valuemin={MIN_SIZE.height}
          onpointerdown={grab('haut')}
          onkeydown={nudge('haut')}
        ></div>
      {/if}
      <div class="bord coin" aria-hidden="true" onpointerdown={grab('coin')}></div>
    {/if}

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
        {#if !modal}
          <IconButton
            icon={size.maximized ? icons.Minimize : icons.Maximize}
            size="petit"
            label={size.maximized ? 'Rétablir la taille' : 'Pleine hauteur'}
            onclick={() => (size.maximized = !size.maximized)}
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
        bind:this={field}
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
{:else if !phone}
  <Bulle bind:element={bubble} {name} icon={Icon} onclick={() => (agentPanel.open = true)} />
{/if}

<style>
  .panneau {
    position: fixed;
    /* 22 px from the edges, down to 12 when the panel takes the whole viewport minus 24. */
    right: min(var(--agent-lanceur-bas), calc(100vw - 12px - var(--largeur)));
    bottom: min(var(--agent-lanceur-bas), calc(100dvh - 12px - var(--hauteur)));
    /* Over the graph's side panel (30), under the dialogs (50) and the toasts (60). */
    z-index: 45;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: var(--largeur);
    height: var(--hauteur);
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-3);
    background: var(--surface-1);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 300 14px/1.5 var(--sans);
  }
  .panneau.grande {
    top: var(--agent-lanceur-bas);
    bottom: var(--agent-lanceur-bas);
    height: auto;
  }
  .bord {
    position: absolute;
    z-index: 2;
  }
  .bord:focus-visible {
    outline: 2px solid var(--ia);
    outline-offset: -2px;
  }
  .gauche {
    top: 14px;
    bottom: 14px;
    left: -4px;
    width: 8px;
    cursor: ew-resize;
  }
  .haut {
    top: -4px;
    right: 14px;
    left: 14px;
    height: 8px;
    cursor: ns-resize;
  }
  .coin {
    top: -4px;
    left: -4px;
    width: 18px;
    height: 18px;
    cursor: nwse-resize;
  }
  .grande .coin {
    cursor: ew-resize;
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
    font-variant-numeric: lining-nums;
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

  /* Drawn only while modal (under 768 px at opening): styled whatever the width meanwhile. */
  .voile {
    position: fixed;
    inset: 0;
    z-index: 44;
    border: 0;
    background: color-mix(in srgb, var(--fond) 70%, transparent);
  }
  .poignee {
    flex: none;
    width: 40px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--bordure-forte);
    touch-action: none;
  }
  @media (max-width: 767.98px) {
    .panneau,
    .panneau.grande {
      inset: 64px 0 0;
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
      border-width: 1px 0 0;
      border-radius: 20px 20px 0 0;
    }
    header {
      border-bottom: 0;
    }
    .saisie {
      margin-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
